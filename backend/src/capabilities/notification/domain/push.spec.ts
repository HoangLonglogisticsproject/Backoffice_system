import {
  backoffMs,
  formatDepartureTime,
  MAX_PUSH_ATTEMPTS,
  outcomeOfError,
  reminderMessage,
  reminderRunAt,
  REMINDER_LEAD_MS,
  shouldSchedule,
  tripCode,
} from './push';

/**
 * Luật của lượt nhắc, không có database và không có Firebase.
 *
 * ★ ĐÂY LÀ NƠI "MỘT TIẾNG" ĐƯỢC CHỨNG MINH. Mọi tầng khác chỉ gọi lại những
 * hàm ở đây, nên nếu con số này đúng thì nó đúng ở mọi đường ghi.
 */
describe('lượt nhắc trước giờ khởi hành', () => {
  const TRIP = 'a1b2c3d4-0000-4000-8000-000000000000';
  const ASSIGNMENT = '55555555-5555-4555-8555-555555555555';
  /** 2026-03-01T10:00+07:00 — mười giờ sáng theo giờ nghiệp vụ. */
  const PICKUP = new Date('2026-03-01T03:00:00.000Z');

  describe('mốc đến hạn', () => {
    it('★ đúng một tiếng trước giờ khởi hành', () => {
      expect(reminderRunAt(PICKUP).toISOString()).toBe('2026-03-01T02:00:00.000Z');
      expect(PICKUP.getTime() - reminderRunAt(PICKUP).getTime()).toBe(REMINDER_LEAD_MS);
    });
  });

  describe('câu thông báo', () => {
    it('mang mã chuyến và giờ khởi hành theo giờ Việt Nam', () => {
      const message = reminderMessage({ tripId: TRIP, assignmentId: ASSIGNMENT, pickupAt: PICKUP });

      expect(message.title).toBe('Nhắc nhở chuyến đi sắp khởi hành');
      expect(message.body).toBe(
        'Chuyến đi A1B2C3D4 của bạn sẽ khởi hành lúc 10:00 ngày 01/03. ' +
          'Vui lòng kiểm tra thông tin chuyến đi và chuẩn bị đúng giờ.',
      );
    });

    it('★ mở trang chi tiết của ĐÚNG lượt phân công, không phải của chuyến', () => {
      const message = reminderMessage({ tripId: TRIP, assignmentId: ASSIGNMENT, pickupAt: PICKUP });
      expect(message.link).toBe(`/driver/assignments/${ASSIGNMENT}`);
      expect(message.link).not.toContain(TRIP);
    });

    it('hiển thị theo +07:00 kể cả khi lưu trữ vắt qua nửa đêm UTC', () => {
      // 2026-03-02T05:30+07:00, lưu là 22:30 hôm trước theo UTC. Một cách đọc
      // ngây thơ sẽ nói "22:30 ngày 01/03" và gửi tài xế đi sai một ngày.
      expect(formatDepartureTime(new Date('2026-03-01T22:30:00.000Z'))).toBe('05:30 ngày 02/03');
    });

    it('mã chuyến là tám ký tự đầu của id, viết hoa', () => {
      expect(tripCode(TRIP)).toBe('A1B2C3D4');
      expect(tripCode(TRIP)).toHaveLength(8);
    });
  });

  describe('có đáng lập lịch không', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');

    it('có, khi mốc nhắc còn ở tương lai', () => {
      expect(shouldSchedule({ pickupAt: PICKUP, tripStatus: 'pending', now })).toBe(true);
    });

    it('không, khi chuyến chưa có giờ khởi hành', () => {
      expect(shouldSchedule({ pickupAt: null, tripStatus: 'pending', now })).toBe(false);
    });

    it('không, khi chuyến đã hoàn thành', () => {
      expect(shouldSchedule({ pickupAt: PICKUP, tripStatus: 'finished', now })).toBe(false);
    });

    it('★ không, khi chuyến được tạo sát giờ và mốc nhắc đã trôi qua', () => {
      // Khởi hành sau 30 phút nữa: mốc "trước một tiếng" nằm ở quá khứ. Gửi
      // bây giờ không còn là lời nhắc, nên không có job nào được tạo.
      const late = new Date(now.getTime() + 30 * 60 * 1000);
      expect(shouldSchedule({ pickupAt: late, tripStatus: 'pending', now })).toBe(false);
    });

    it('không, đúng tại ranh giới một tiếng chẵn', () => {
      const exactly = new Date(now.getTime() + REMINDER_LEAD_MS);
      expect(shouldSchedule({ pickupAt: exactly, tripStatus: 'pending', now })).toBe(false);
    });
  });

  describe('khoảng lùi khi thử lại', () => {
    /** Ghim jitter để khẳng định được con số, thay vì một khoảng. */
    const noJitter = () => 0;
    const fullJitter = () => 1;

    it('tăng theo luỹ thừa', () => {
      expect(backoffMs(1, noJitter)).toBe(30_000);
      expect(backoffMs(2, noJitter)).toBe(60_000);
      expect(backoffMs(3, noJitter)).toBe(120_000);
    });

    it('có trần, nên lần thử cuối không rơi sang ngày hôm sau', () => {
      expect(backoffMs(20, noJitter)).toBe(15 * 60 * 1000);
    });

    it('★ jitter chỉ CỘNG THÊM, nên khoảng chờ tối thiểu vẫn là một lời hứa chắc chắn', () => {
      expect(backoffMs(2, fullJitter)).toBe(90_000);
      expect(backoffMs(2, fullJitter)).toBeGreaterThan(backoffMs(2, noJitter));
    });

    it('không bao giờ âm, kể cả với số lần thử vô lý', () => {
      expect(backoffMs(0, noJitter)).toBeGreaterThan(0);
      expect(backoffMs(-5, noJitter)).toBeGreaterThan(0);
    });

    it('có một trần số lần thử', () => {
      expect(MAX_PUSH_ATTEMPTS).toBe(5);
    });
  });

  describe('phân loại lỗi FCM', () => {
    it('token đã gỡ đăng ký là chết hẳn', () => {
      expect(outcomeOfError('messaging/registration-token-not-registered')).toBe('invalid');
      expect(outcomeOfError('messaging/invalid-registration-token')).toBe('invalid');
    });

    it('★ mọi mã KHÔNG biết đều được coi là tạm thời', () => {
      // Hướng an toàn: coi nhầm lỗi tạm thời thành vĩnh viễn sẽ lặng lẽ ngắt
      // thông báo của một tài xế còn đang dùng máy bình thường.
      expect(outcomeOfError('messaging/server-unavailable')).toBe('retryable');
      expect(outcomeOfError('messaging/internal-error')).toBe('retryable');
      expect(outcomeOfError('một mã chưa ai gặp')).toBe('retryable');
      expect(outcomeOfError(undefined)).toBe('retryable');
    });
  });
});
