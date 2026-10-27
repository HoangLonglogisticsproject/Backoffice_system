import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DomainErrorFilter } from '../../../common/http/domain-error.filter';
import { AppConfig } from '../../../config/app.config';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { DriverOnlyGuard } from '../../../core/identity/api/driver-only.guard';
import { SESSION_COOKIE } from '../../../core/identity/api/session.cookie';
import { SessionService } from '../../../core/identity/application/session.service';
import type { AccountType } from '../../../core/users/domain/user.entity';
import { PushDeviceService } from '../application/push-device.service';
import { PushDeviceRepository } from '../persistence/push-device.repository';
import { PushDeviceController } from './push-device.controller';

/**
 * Đăng ký thiết bị nhận Web Push, qua HTTP.
 *
 * ★ TÍNH CHẤT CẦN GHIM: KHÔNG AI ĐĂNG KÝ THIẾT BỊ THAY CHO NGƯỜI KHÁC. Không
 * phải vì có một phép kiểm tra, mà vì không có tham số nào để nói điều đó —
 * route không nhận user, service không nhận user từ body, và câu ghi mang id
 * của phiên. Các case dưới đây khẳng định điều đó tại ranh giới HTTP, với
 * repository được mock, nên một caller biết URL bị TỪ CHỐI bởi máy chủ chứ
 * không bởi việc giao diện thiếu một cái nút.
 */
describe('push-device HTTP security', () => {
  const TOKEN = 'a-session-token-value';
  const DRIVER = '77777777-7777-4777-8777-777777777777';
  const SOMEBODY_ELSE = '88888888-8888-4888-8888-888888888888';
  const FCM = 'fcm-token-of-this-browser';

  let app: INestApplication;
  let accountType: AccountType;
  let sessionUserId: string;
  let rows: { upsert: jest.Mock; revoke: jest.Mock; revokeToken: jest.Mock; activeFor: jest.Mock };

  beforeEach(async () => {
    accountType = 'driver';
    sessionUserId = DRIVER;
    rows = {
      upsert: jest.fn().mockResolvedValue({ id: 'device-1', userId: DRIVER }),
      revoke: jest.fn().mockResolvedValue(null),
      revokeToken: jest.fn(),
      activeFor: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PushDeviceController],
      providers: [
        AuthGuard,
        CsrfGuard,
        DriverOnlyGuard,
        PushDeviceService,
        { provide: PushDeviceRepository, useValue: rows },
        { provide: AppConfig, useValue: { isProduction: true } },
        {
          provide: SessionService,
          useValue: {
            resolve: jest.fn().mockImplementation(async () => ({
              id: sessionUserId,
              displayName: 'Tài Xế',
              status: 'active',
              accountType,
            })),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const authed = (method: 'post' | 'delete') =>
    request(app.getHttpServer())
      [method]('/notifications/push-devices')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('X-Requested-With', 'XMLHttpRequest');

  describe('không có phiên đăng nhập', () => {
    it.each(['post', 'delete'] as const)('từ chối %s với 401', async (method) => {
      const response = await request(app.getHttpServer())
        [method]('/notifications/push-devices')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ token: FCM });

      expect(response.status).toBe(401);
      expect(rows.upsert).not.toHaveBeenCalled();
      expect(rows.revoke).not.toHaveBeenCalled();
    });
  });

  describe('không có header chống CSRF', () => {
    it('từ chối đăng ký', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/push-devices')
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
        .send({ token: FCM });

      expect(response.status).toBe(403);
      expect(rows.upsert).not.toHaveBeenCalled();
    });
  });

  describe('tài khoản không phải tài xế', () => {
    it('★ bị từ chối, vì lượt nhắc chỉ gửi cho người đang cầm lượt phân công', async () => {
      accountType = 'employee';

      const response = await authed('post').send({ token: FCM });

      expect(response.status).toBe(403);
      expect(rows.upsert).not.toHaveBeenCalled();
    });
  });

  describe('đăng ký thiết bị', () => {
    it('ghi token kèm chủ sở hữu lấy từ phiên', async () => {
      await authed('post').send({ token: FCM }).expect(200);

      expect(rows.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: DRIVER, fcmToken: FCM }),
      );
    });

    it('★ KHÔNG THỂ đăng ký thiết bị thay cho tài khoản khác', async () => {
      // Body cố tình nói "chủ của thiết bị này là người kia". Schema `.strict()`
      // từ chối thẳng, nên client biết mình sai thay vì tưởng đã thành công —
      // và dù có lọt qua, service cũng không có tham số nào để nhận giá trị đó.
      const response = await authed('post').send({ token: FCM, userId: SOMEBODY_ELSE });

      expect(response.status).toBe(422);
      expect(rows.upsert).not.toHaveBeenCalled();
    });

    it('★ và cũng không qua được bằng tên trường khác', async () => {
      const response = await authed('post').send({
        token: FCM,
        recipientUserId: SOMEBODY_ELSE,
        driverUserId: SOMEBODY_ELSE,
      });

      expect(response.status).toBe(422);
      expect(rows.upsert).not.toHaveBeenCalled();
    });

    it('từ chối token rỗng', async () => {
      const response = await authed('post').send({ token: '   ' });

      expect(response.status).toBe(422);
      expect(rows.upsert).not.toHaveBeenCalled();
    });

    it('gọi lại với cùng token là chuyện bình thường, không phải lỗi', async () => {
      await authed('post').send({ token: FCM }).expect(200);
      await authed('post').send({ token: FCM }).expect(200);

      expect(rows.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('huỷ đăng ký', () => {
    it('chỉ chạm tới thiết bị của chính người gọi', async () => {
      await authed('delete').send({ token: FCM }).expect(204);

      expect(rows.revoke).toHaveBeenCalledWith(DRIVER, FCM);
    });

    it('★ một token không thuộc về người gọi trả về đúng cái không-có-gì', async () => {
      // `revoke` lọc theo cả chủ sở hữu, nên không có hàng nào khớp. Trả về
      // 404 ở đây sẽ biến route này thành công cụ dò xem một token có tồn tại
      // hay không.
      rows.revoke.mockResolvedValue(null);

      await authed('delete').send({ token: 'token-của-người-khác' }).expect(204);

      expect(rows.revoke).toHaveBeenCalledWith(DRIVER, 'token-của-người-khác');
    });
  });
});
