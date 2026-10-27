/**
 * Web Push — lượt nhắc tài xế trước giờ khởi hành.
 *
 * ★ TẤT CẢ Ở ĐÂY LÀ LUẬT THUẦN, KHÔNG NEST, KHÔNG SQL, KHÔNG FIREBASE (B10).
 * Giờ nào thì nhắc, nhắc bằng câu gì, lỗi nào đáng thử lại và thử lại sau bao
 * lâu — bốn câu hỏi đó quyết định hành vi mà người vận hành nhìn thấy, nên
 * chúng phải kiểm chứng được bằng một bài test không cần database.
 *
 * ★ VÀ ĐÂY LÀ NƠI DUY NHẤT BIẾT "MỘT TIẾNG". Hằng số nằm rải trong service là
 * cách nhanh nhất để lịch và bài test nói hai con số khác nhau.
 */

/** Nhắc trước giờ khởi hành đúng một tiếng. */
export const REMINDER_LEAD_MS = 60 * 60 * 1000;

export const PUSH_JOB_STATUSES = [
  /** Đã lên lịch, chưa tới hạn (hoặc đang chờ thử lại). */
  'pending',
  /** Một worker đang cầm. */
  'processing',
  /** Đã giao cho FCM. */
  'sent',
  /** Nghiệp vụ không còn cần lượt nhắc này: đổi giờ, đổi tài xế, huỷ chuyến. */
  'cancelled',
  /** Đã thử hết số lần cho phép mà vẫn không giao được. */
  'failed',
] as const;

export type PushJobStatus = (typeof PUSH_JOB_STATUSES)[number];

/** Hôm nay chỉ có một loại; cột `kind` tồn tại để loại thứ hai không phải sửa schema. */
export const PUSH_JOB_KINDS = ['departure_reminder'] as const;
export type PushJobKind = (typeof PUSH_JOB_KINDS)[number];

export type PushDeviceStatus = 'active' | 'revoked';

export interface PushDevice {
  id: string;
  userId: string;
  fcmToken: string;
  userAgent: string | null;
  status: PushDeviceStatus;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PushJob {
  id: string;
  tripId: string;
  assignmentId: string;
  recipientUserId: string;
  kind: PushJobKind;
  runAt: Date;
  /** Giờ khởi hành như nó đứng LÚC LẬP LỊCH — xem 0038. */
  pickupAt: Date;
  status: PushJobStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  sentAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mã chuyến đi mà một con người đọc được.
 *
 * ⚠ HỆ NÀY KHÔNG CÓ CỘT "MÃ CHUYẾN". Danh tính của một chuyến là UUID của nó;
 * đọc nguyên 36 ký tự qua điện thoại thì vô dụng, nên tám ký tự đầu viết hoa là
 * thứ được in ra. Đủ để đối chiếu với màn hình chi tiết, và không phải một danh
 * tính mới — không có gì tra cứu theo chuỗi này.
 */
export const tripCode = (tripId: string): string => tripId.slice(0, 8).toUpperCase();

/**
 * Giờ Việt Nam, HH:mm, cho câu thông báo.
 *
 * ★ LƯU TRỮ LÀ UTC, HIỂN THỊ LÀ GIỜ NGHIỆP VỤ. Toàn bộ hệ dùng `TIMESTAMPTZ`;
 * nhưng một tài xế đọc "sẽ khởi hành lúc 03:00" khi lịch ghi 10:00 là một lượt
 * nhắc gây hại. Offset cố định +07:00 — Việt Nam không có giờ mùa hè, nên ở
 * đây một phép cộng là đúng, chứ không phải xấp xỉ.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const formatDepartureTime = (pickupAt: Date): string => {
  const local = new Date(pickupAt.getTime() + VN_OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mo = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${hh}:${mm} ngày ${dd}/${mo}`;
};

export interface PushMessage {
  title: string;
  body: string;
  /** Đường dẫn TƯƠNG ĐỐI trong ứng dụng. Service worker ghép với origin của nó. */
  link: string;
}

/**
 * Câu tài xế đọc, dựng tại thời điểm GỬI chứ không phải lúc lập lịch — nên nó
 * luôn nói đúng giờ khởi hành hiện hành.
 *
 * Link trỏ tới màn hình chi tiết của chính lượt phân công này
 * (`/driver/assignments/:id`), là trang duy nhất trong hệ hiển thị một chuyến
 * cho tài xế. Theo assignment chứ không theo trip: guard của trang đó cho qua
 * đúng người đang cầm lượt, nên một link gửi nhầm không mở ra gì cả.
 */
export const reminderMessage = (input: {
  tripId: string;
  assignmentId: string;
  pickupAt: Date;
}): PushMessage => ({
  title: 'Nhắc nhở chuyến đi sắp khởi hành',
  body:
    `Chuyến đi ${tripCode(input.tripId)} của bạn sẽ khởi hành lúc ` +
    `${formatDepartureTime(input.pickupAt)}. ` +
    'Vui lòng kiểm tra thông tin chuyến đi và chuẩn bị đúng giờ.',
  link: `/driver/assignments/${input.assignmentId}`,
});

/** Khi nào lượt nhắc của một chuyến đến hạn. */
export const reminderRunAt = (pickupAt: Date): Date =>
  new Date(pickupAt.getTime() - REMINDER_LEAD_MS);

/**
 * Có đáng lập lịch nhắc cho lượt phân công này không.
 *
 * ★ MỘT CHUYẾN TẠO SÁT GIỜ KHÔNG SINH RA MỘT LƯỢT NHẮC TRỄ. Nếu mốc "trước một
 * tiếng" đã trôi qua thì lượt nhắc đó không còn là lời nhắc nữa — nó là một
 * thông báo đến muộn, nói về việc sắp xảy ra ngay bây giờ, và đẩy nó đi chỉ làm
 * người nhận mất lòng tin vào những lượt nhắc đúng hạn. Không tạo job, không
 * gửi bù.
 */
export const shouldSchedule = (input: {
  pickupAt: Date | null;
  tripStatus: string;
  now: Date;
}): boolean => {
  if (!input.pickupAt) return false;
  // Một chuyến đã đóng sổ thì không ai cần được nhắc đi lấy hàng nữa.
  if (input.tripStatus === 'finished') return false;
  return reminderRunAt(input.pickupAt).getTime() > input.now.getTime();
};

// ------------------------------------------------------------------ retry ----

/** Quá số này thì job thành `failed` và thôi. */
export const MAX_PUSH_ATTEMPTS = 5;

/** Một worker cầm job quá lâu nghĩa là nó đã chết; job được thả về. */
export const STUCK_AFTER_MS = 5 * 60 * 1000;

const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_CEILING_MS = 15 * 60 * 1000;

/**
 * Chờ bao lâu trước lần thử thứ `attempts + 1`.
 *
 * ★ LUỸ THỪA CÓ TRẦN, CỘNG JITTER. Luỹ thừa để một sự cố FCM kéo dài không bị
 * nện bằng một nhịp cố định; trần để lần thử thứ năm không rơi vào ngày hôm
 * sau; jitter để một nghìn job hết hạn cùng một phút không cùng quay lại cùng
 * một giây — đó mới là thứ làm sập lần phục hồi.
 *
 * `random` là tham số để bài test ghim được, chứ không phải để ai đó thay thuật
 * toán từ bên ngoài.
 */
export const backoffMs = (attempts: number, random: () => number = Math.random): number => {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CEILING_MS);
  // Jitter cộng thêm tối đa 50% — không bao giờ RÚT NGẮN, nên khoảng chờ tối
  // thiểu vẫn là một lời hứa chắc chắn.
  return Math.round(exponential * (1 + random() * 0.5));
};

/**
 * Kết quả FCM trả về cho MỘT thiết bị.
 *
 * `invalid` là thiết bị đã chết hẳn — gỡ cài đặt, xoá dữ liệu site, token hết
 * hiệu lực. Token đó bị thu hồi và không bao giờ được thử lại.
 */
export type PushDeliveryOutcome = 'delivered' | 'invalid' | 'retryable';

/**
 * Mã lỗi nào của FCM có nghĩa là "token này chết rồi".
 *
 * Danh sách đóng, và mọi mã KHÔNG nằm trong đây đều được coi là tạm thời. Đó là
 * hướng an toàn: coi nhầm một lỗi tạm thời thành vĩnh viễn sẽ lặng lẽ ngắt
 * thông báo của một tài xế còn đang dùng máy bình thường, và không ai phát hiện
 * ra cho tới khi họ lỡ một chuyến.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export const outcomeOfError = (code: string | undefined): PushDeliveryOutcome =>
  code && DEAD_TOKEN_CODES.has(code) ? 'invalid' : 'retryable';
