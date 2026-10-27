import { MAX_PUSH_ATTEMPTS, type PushJob } from '../domain/push';
import { PushWorkerService } from './push-worker.service';

/**
 * Worker gửi lượt nhắc.
 *
 * ★ ĐIỀU ĐÁNG KHẲNG ĐỊNH NHẤT Ở ĐÂY LÀ NHỮNG LÚC NÓ KHÔNG GỬI. Một lượt nhắc
 * đúng hạn gửi đi là hành vi bình thường; một lượt nhắc gửi cho người đã bị
 * thay, cho chuyến đã huỷ, hay gửi lại lần thứ hai mới là thứ phá hỏng lòng
 * tin — nên phần lớn các case dưới đây kết thúc bằng `cancelled` và một khẳng
 * định rằng `sender.send` chưa hề được gọi.
 */
describe('PushWorkerService', () => {
  const TRIP = 'a1b2c3d4-0000-4000-8000-000000000000';
  const ASSIGNMENT = '55555555-5555-4555-8555-555555555555';
  const DRIVER = '77777777-7777-4777-8777-777777777777';
  const OTHER_DRIVER = '88888888-8888-4888-8888-888888888888';
  const NOW = new Date('2026-03-01T02:00:00.000Z');
  const PICKUP = new Date('2026-03-01T03:00:00.000Z');

  const job = (over: Partial<PushJob> = {}): PushJob => ({
    id: 'job-1',
    tripId: TRIP,
    assignmentId: ASSIGNMENT,
    recipientUserId: DRIVER,
    kind: 'departure_reminder',
    runAt: new Date('2026-03-01T02:00:00.000Z'),
    pickupAt: PICKUP,
    status: 'processing',
    attempts: 0,
    nextAttemptAt: null,
    lockedAt: NOW,
    lockedBy: 'worker-1',
    sentAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  const liveSubject = (over: Record<string, unknown> = {}) => ({
    tripArchived: false,
    tripStatus: 'pending',
    tripPickupAt: PICKUP,
    assignmentActive: true,
    assignmentDriverUserId: DRIVER,
    ...over,
  });

  const build = (over: { claimed?: PushJob[]; subject?: unknown; devices?: unknown[] } = {}) => {
    const jobs = {
      claimDue: jest.fn().mockResolvedValue(over.claimed ?? [job()]),
      subjectOf: jest
        .fn()
        .mockResolvedValue(over.subject === undefined ? liveSubject() : over.subject),
      markSent: jest.fn().mockResolvedValue(undefined),
      markRetry: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markCancelled: jest.fn().mockResolvedValue(undefined),
      recoverStuck: jest.fn().mockResolvedValue(0),
    };
    const devices = {
      activeFor: jest
        .fn()
        .mockResolvedValue(
          over.devices ?? [{ fcmToken: 'token-phone' }, { fcmToken: 'token-tablet' }],
        ),
      revokeToken: jest.fn().mockResolvedValue(undefined),
    };
    const sender = {
      send: jest.fn().mockResolvedValue([
        { token: 'token-phone', outcome: 'delivered' },
        { token: 'token-tablet', outcome: 'delivered' },
      ]),
    };
    const config = { pushWorkerEnabled: true };

    const worker = new PushWorkerService(
      jobs as never,
      devices as never,
      sender as never,
      config as never,
    );
    return { worker, jobs, devices, sender, config };
  };

  describe('đường đi bình thường', () => {
    it('gửi tới mọi thiết bị đang bật của đúng tài xế, rồi đánh dấu đã gửi', async () => {
      const { worker, jobs, devices, sender } = build();

      await worker.drain(NOW);

      expect(devices.activeFor).toHaveBeenCalledWith(DRIVER);
      expect(sender.send).toHaveBeenCalledWith(
        ['token-phone', 'token-tablet'],
        expect.objectContaining({
          title: 'Nhắc nhở chuyến đi sắp khởi hành',
          link: `/driver/assignments/${ASSIGNMENT}`,
        }),
      );
      expect(jobs.markSent).toHaveBeenCalledWith('job-1', NOW);
    });

    it('★ chỉ xử lý những hàng giành được — không có gì được gửi sớm', async () => {
      // Điều kiện "đến hạn" nằm trong câu SQL của `claimDue`; worker không hề
      // tự lọc theo thời gian. Khẳng định ở đây là worker truyền ĐÚNG mốc hiện
      // tại xuống, nên câu lệnh kia có cái nó cần để không bao giờ gửi sớm.
      const { worker, jobs } = build({ claimed: [] });

      const processed = await worker.drain(NOW);

      expect(jobs.claimDue).toHaveBeenCalledWith(
        expect.objectContaining({ now: NOW, limit: expect.any(Number) }),
      );
      expect(processed).toBe(0);
    });
  });

  describe('nghiệp vụ đã đổi dưới chân job', () => {
    it.each([
      ['chuyến đã bị huỷ', liveSubject({ tripArchived: true })],
      ['chuyến đã hoàn thành', liveSubject({ tripStatus: 'finished' })],
      ['lượt phân công đã kết thúc', liveSubject({ assignmentActive: false })],
      ['lượt phân công không còn tồn tại', null],
    ])('★ không gửi khi %s', async (_label, subject) => {
      const { worker, jobs, sender } = build({ subject });

      await worker.drain(NOW);

      expect(sender.send).not.toHaveBeenCalled();
      expect(jobs.markSent).not.toHaveBeenCalled();
      expect(jobs.markCancelled).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    });

    it('★ không gửi cho sai tài xế khi người phụ trách đã thay đổi', async () => {
      const { worker, jobs, devices, sender } = build({
        subject: liveSubject({ assignmentDriverUserId: OTHER_DRIVER }),
      });

      await worker.drain(NOW);

      expect(sender.send).not.toHaveBeenCalled();
      // Và token của người mới cũng không hề được tra cứu — job này không
      // thuộc về họ, nên nó chết chứ không đổi người nhận.
      expect(devices.activeFor).not.toHaveBeenCalled();
      expect(jobs.markCancelled).toHaveBeenCalledWith({
        id: 'job-1',
        reason: 'Tài xế phụ trách đã thay đổi.',
      });
    });

    it('★ không gửi khi giờ khởi hành đã dời khỏi giờ mà job được lập', async () => {
      const { worker, jobs, sender } = build({
        subject: liveSubject({ tripPickupAt: new Date('2026-03-01T09:00:00.000Z') }),
      });

      await worker.drain(NOW);

      expect(sender.send).not.toHaveBeenCalled();
      expect(jobs.markCancelled).toHaveBeenCalledWith({
        id: 'job-1',
        reason: 'Giờ khởi hành đã thay đổi.',
      });
    });

    it('tài xế chưa bật thông báo thì job đóng lại, không thử lại vô ích', async () => {
      const { worker, jobs, sender } = build({ devices: [] });

      await worker.drain(NOW);

      expect(sender.send).not.toHaveBeenCalled();
      expect(jobs.markRetry).not.toHaveBeenCalled();
      expect(jobs.markCancelled).toHaveBeenCalled();
    });
  });

  describe('lỗi khi gửi', () => {
    it('★ lỗi tạm thời thì thử lại, với mốc lùi về tương lai', async () => {
      const { worker, jobs, sender } = build();
      sender.send.mockResolvedValue([
        { token: 'token-phone', outcome: 'retryable', error: 'messaging/server-unavailable: bận' },
        { token: 'token-tablet', outcome: 'retryable', error: 'messaging/server-unavailable: bận' },
      ]);

      await worker.drain(NOW);

      expect(jobs.markSent).not.toHaveBeenCalled();
      expect(jobs.markRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'job-1',
          error: expect.stringContaining('server-unavailable'),
        }),
      );
      const scheduled = jobs.markRetry.mock.calls[0][0].nextAttemptAt as Date;
      expect(scheduled.getTime()).toBeGreaterThan(Date.now());
    });

    it('hết số lần thử thì job thất bại hẳn', async () => {
      const { worker, jobs, sender } = build({
        claimed: [job({ attempts: MAX_PUSH_ATTEMPTS - 1 })],
      });
      sender.send.mockResolvedValue([
        { token: 'token-phone', outcome: 'retryable', error: 'vẫn lỗi' },
      ]);

      await worker.drain(NOW);

      expect(jobs.markRetry).not.toHaveBeenCalled();
      expect(jobs.markFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    });

    it('★ token không còn hiệu lực bị thu hồi, và thiết bị còn sống vẫn được tính là đã nhắc', async () => {
      const { worker, jobs, devices, sender } = build();
      sender.send.mockResolvedValue([
        { token: 'token-phone', outcome: 'delivered' },
        {
          token: 'token-tablet',
          outcome: 'invalid',
          error: 'messaging/registration-token-not-registered: đã gỡ',
        },
      ]);

      await worker.drain(NOW);

      expect(devices.revokeToken).toHaveBeenCalledWith('token-tablet');
      expect(devices.revokeToken).not.toHaveBeenCalledWith('token-phone');
      // Tài xế cầm điện thoại, không cầm cả hai máy: một máy nhận là đủ.
      expect(jobs.markSent).toHaveBeenCalled();
      expect(jobs.markRetry).not.toHaveBeenCalled();
    });

    it('mọi thiết bị đều chết hẳn thì thất bại ngay, không thử lại', async () => {
      const { worker, jobs, devices, sender } = build();
      sender.send.mockResolvedValue([
        { token: 'token-phone', outcome: 'invalid', error: 'đã gỡ' },
        { token: 'token-tablet', outcome: 'invalid', error: 'đã gỡ' },
      ]);

      await worker.drain(NOW);

      expect(devices.revokeToken).toHaveBeenCalledTimes(2);
      expect(jobs.markRetry).not.toHaveBeenCalled();
      expect(jobs.markFailed).toHaveBeenCalled();
    });

    it('một job ném lỗi không kéo theo cả lô', async () => {
      const { worker, jobs, sender } = build({
        claimed: [job({ id: 'job-1' }), job({ id: 'job-2' })],
      });
      sender.send.mockRejectedValueOnce(new Error('mạng hỏng'));

      await worker.drain(NOW);

      expect(jobs.markRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
      expect(jobs.markSent).toHaveBeenCalledWith('job-2', NOW);
    });
  });

  describe('nhiều worker và job kẹt', () => {
    it('★ worker không có đường nào lấy job ngoài `claimDue`', async () => {
      // Lời hứa "không gửi lại job đã hoàn thành" là lời hứa của câu SQL
      // (`WHERE status = 'pending'`). Cái đáng khẳng định ở tầng này là worker
      // không có đường vòng nào khác để nhặt một hàng lên.
      const { worker, jobs } = build({ claimed: [] });

      await worker.drain(NOW);

      expect(jobs.claimDue).toHaveBeenCalledTimes(1);
      expect(jobs.subjectOf).not.toHaveBeenCalled();
    });

    it('thả job mà một worker đã chết khi đang cầm', async () => {
      const { worker, jobs } = build();
      jobs.recoverStuck.mockResolvedValue(3);

      await worker.recoverStuck();

      expect(jobs.recoverStuck).toHaveBeenCalledWith(expect.any(Date));
    });

    it('tắt worker bằng cấu hình thì không giành job nào', async () => {
      const { worker, jobs, config } = build();
      config.pushWorkerEnabled = false;

      await worker.tick();
      await worker.recoverStuck();

      expect(jobs.claimDue).not.toHaveBeenCalled();
      expect(jobs.recoverStuck).not.toHaveBeenCalled();
    });
  });
});
