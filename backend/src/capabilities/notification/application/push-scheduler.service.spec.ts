import type { DatabaseQuery } from '../../../common/types/database.port';
import { PushSchedulerService } from './push-scheduler.service';

/**
 * Lịch nhắc đi theo nghiệp vụ.
 *
 * ★ MỌI TÌNH HUỐNG TRONG FILE NÀY ĐỀU LÀ MỘT CÂU HỎI VỀ `push_jobs` SAU KHI
 * NGHIỆP VỤ ĐỔI, và tất cả đi qua đúng một phương thức. Đó là điều đáng khẳng
 * định nhất: không có đường riêng cho "đổi giờ" và đường khác cho "đổi tài
 * xế", nên không có đường nào bị bỏ quên.
 */
describe('PushSchedulerService', () => {
  const TRIP = 'a1b2c3d4-0000-4000-8000-000000000000';
  const ASSIGNMENT = '55555555-5555-4555-8555-555555555555';
  const OTHER_ASSIGNMENT = '66666666-6666-4666-8666-666666666666';
  const DRIVER = '77777777-7777-4777-8777-777777777777';
  const OTHER_DRIVER = '88888888-8888-4888-8888-888888888888';

  const NOW = new Date('2026-03-01T00:00:00.000Z');
  /** 10:00 giờ Việt Nam — mốc nhắc là 09:00, tức 02:00Z. */
  const PICKUP = new Date('2026-03-01T03:00:00.000Z');

  /** Transaction của người gọi. Scheduler không được phép tự mở cái nào. */
  const TX = { query: jest.fn() } as unknown as DatabaseQuery;

  const build = () => {
    const jobs = {
      schedule: jest.fn().mockResolvedValue({ id: 'job-1' }),
      cancelForAssignment: jest.fn().mockResolvedValue(0),
      cancelForTrip: jest.fn().mockResolvedValue(0),
    };
    return { jobs, scheduler: new PushSchedulerService(jobs as never) };
  };

  const subject = (over: Record<string, unknown> = {}) => ({
    tripId: TRIP,
    assignmentId: ASSIGNMENT,
    driverUserId: DRIVER,
    pickupAt: PICKUP,
    tripStatus: 'pending',
    ...over,
  });

  describe('phân công tài xế cho một chuyến có giờ khởi hành', () => {
    it('★ đặt lịch đúng một tiếng trước giờ khởi hành, trong transaction của người gọi', async () => {
      const { jobs, scheduler } = build();

      await scheduler.syncForAssignment(subject(), TX, NOW);

      expect(jobs.schedule).toHaveBeenCalledWith(
        {
          tripId: TRIP,
          assignmentId: ASSIGNMENT,
          recipientUserId: DRIVER,
          kind: 'departure_reminder',
          runAt: new Date('2026-03-01T02:00:00.000Z'),
          pickupAt: PICKUP,
        },
        TX,
      );
    });

    it('huỷ lịch cũ TRƯỚC khi đặt lịch mới, nên không bao giờ có hai hàng cùng sống', async () => {
      const { jobs, scheduler } = build();
      const order: string[] = [];
      jobs.cancelForAssignment.mockImplementation(async () => void order.push('cancel'));
      jobs.schedule.mockImplementation(async () => void order.push('schedule'));

      await scheduler.syncForAssignment(subject(), TX, NOW);

      expect(order).toEqual(['cancel', 'schedule']);
    });
  });

  describe('giờ khởi hành thay đổi', () => {
    it('★ lịch cũ bị huỷ và lịch mới mang giờ mới', async () => {
      const { jobs, scheduler } = build();
      const moved = new Date('2026-03-01T06:00:00.000Z');

      await scheduler.syncForAssignment(subject({ pickupAt: moved }), TX, NOW);

      expect(jobs.cancelForAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
      expect(jobs.schedule).toHaveBeenCalledWith(
        expect.objectContaining({ runAt: new Date('2026-03-01T05:00:00.000Z'), pickupAt: moved }),
        TX,
      );
    });

    it('giờ khởi hành bị xoá thì chỉ còn huỷ, không đặt lại', async () => {
      const { jobs, scheduler } = build();

      await scheduler.syncForAssignment(subject({ pickupAt: null }), TX, NOW);

      expect(jobs.cancelForAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
      expect(jobs.schedule).not.toHaveBeenCalled();
    });

    it('★ dời giờ về sát hiện tại thì lịch bị huỷ và KHÔNG có lượt nhắc trễ nào thay thế', async () => {
      const { jobs, scheduler } = build();
      const soon = new Date(NOW.getTime() + 10 * 60 * 1000);

      await scheduler.syncForAssignment(subject({ pickupAt: soon }), TX, NOW);

      expect(jobs.cancelForAssignment).toHaveBeenCalledWith(ASSIGNMENT, TX);
      expect(jobs.schedule).not.toHaveBeenCalled();
    });
  });

  describe('đổi tài xế', () => {
    it('★ lượt nhắc của người cũ bị huỷ theo id CŨ, người mới được đặt theo id MỚI', async () => {
      // Đây là tình huống yêu cầu cấm tuyệt đối: thông báo của tài xế cũ không
      // được chạm tới tài xế mới. Hai assignment id khác nhau là thứ làm điều
      // đó đúng theo cấu trúc, chứ không theo một phép kiểm tra phải nhớ.
      const { jobs, scheduler } = build();

      await scheduler.cancelForAssignment(ASSIGNMENT, TX);
      await scheduler.syncForAssignment(
        subject({ assignmentId: OTHER_ASSIGNMENT, driverUserId: OTHER_DRIVER }),
        TX,
        NOW,
      );

      expect(jobs.cancelForAssignment).toHaveBeenNthCalledWith(1, ASSIGNMENT, TX);
      expect(jobs.schedule).toHaveBeenCalledWith(
        expect.objectContaining({ assignmentId: OTHER_ASSIGNMENT, recipientUserId: OTHER_DRIVER }),
        TX,
      );
      // Và không có lịch nào được đặt cho người cũ.
      expect(jobs.schedule).not.toHaveBeenCalledWith(
        expect.objectContaining({ recipientUserId: DRIVER }),
        expect.anything(),
      );
    });
  });

  describe('chuyến không còn hợp lệ', () => {
    it('chuyến đã hoàn thành thì không ai được nhắc đi lấy hàng', async () => {
      const { jobs, scheduler } = build();

      await scheduler.syncForAssignment(subject({ tripStatus: 'finished' }), TX, NOW);

      expect(jobs.schedule).not.toHaveBeenCalled();
    });

    it('★ huỷ chuyến tắt mọi lượt nhắc chưa gửi của chuyến, không chỉ của một lượt phân công', async () => {
      const { jobs, scheduler } = build();

      await scheduler.cancelForTrip(TRIP, TX);

      expect(jobs.cancelForTrip).toHaveBeenCalledWith(TRIP, TX);
    });
  });
});
