import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { PushJob, PushJobKind, PushJobStatus } from '../domain/push';

/**
 * SQL cho "gửi cái gì, lúc nào". Không mở transaction (B11), không quyết định gì.
 *
 * ★ `claimDue` LÀ TRÁI TIM CỦA FILE NÀY, và nó là một câu lệnh duy nhất vì lý
 * do đúng đắn: giành job phải là một hành động nguyên tử. Hai instance backend
 * cùng chạy cron mỗi phút sẽ chạm vào đúng tập hàng đến hạn, và `FOR UPDATE
 * SKIP LOCKED` là thứ duy nhất khiến chúng chia nhau thay vì tranh nhau — hàng
 * nào đã có người cầm thì người sau ĐI QUA chứ không xếp hàng chờ.
 */

interface PushJobRow {
  id: string;
  trip_id: string;
  assignment_id: string;
  recipient_user_id: string;
  kind: PushJobKind;
  run_at: Date;
  pickup_at: Date;
  status: PushJobStatus;
  attempts: number;
  next_attempt_at: Date | null;
  locked_at: Date | null;
  locked_by: string | null;
  sent_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

const toJob = (row: PushJobRow): PushJob => ({
  id: row.id,
  tripId: row.trip_id,
  assignmentId: row.assignment_id,
  recipientUserId: row.recipient_user_id,
  kind: row.kind,
  runAt: row.run_at,
  pickupAt: row.pickup_at,
  status: row.status,
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
  lockedAt: row.locked_at,
  lockedBy: row.locked_by,
  sentAt: row.sent_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = `id, trip_id, assignment_id, recipient_user_id, kind, run_at, pickup_at,
                 status, attempts, next_attempt_at, locked_at, locked_by, sent_at,
                 last_error, created_at, updated_at`;

/**
 * Chuyến đi và lượt phân công như chúng ĐANG LÀ, đọc lại ngay trước khi gửi.
 * Không phải những gì job đã chép lúc lập lịch — đó mới là điều cần đối chiếu.
 */
export interface PushJobSubject {
  tripArchived: boolean;
  tripStatus: string;
  tripPickupAt: Date | null;
  assignmentActive: boolean;
  assignmentDriverUserId: string;
}

/** Lỗi ghi lại phải đọc được trong log, không phải một bãi stack trace. */
const MAX_ERROR_LENGTH = 500;
const trimError = (message: string): string => message.slice(0, MAX_ERROR_LENGTH);

@Injectable()
export class PushJobRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Đặt lịch một lượt nhắc, bên trong transaction của chính thay đổi nghiệp vụ
   * đã gây ra nó — giống hệt kỷ luật `NotificationRepository.record` giữ.
   *
   * ★ `ON CONFLICT … DO UPDATE` TRÊN INDEX PARTIAL. Vị từ `WHERE status IN
   * (...)` phải viết ra để PostgreSQL nhận đúng `uq_push_job_live`. Gặp một
   * hàng đang sống thì CẬP NHẬT giờ của nó thay vì sinh hàng thứ hai: đồng bộ
   * lại cùng một lượt nhắc là chuyện xảy ra mỗi lần ai đó sửa chuyến, và hai
   * hàng cùng sống sẽ là hai lần rung máy.
   *
   * Số lần thử được đặt lại, vì đây là một lịch mới chứ không phải lần thử tiếp
   * theo của lịch cũ.
   */
  async schedule(
    input: {
      tripId: string;
      assignmentId: string;
      recipientUserId: string;
      kind: PushJobKind;
      runAt: Date;
      pickupAt: Date;
    },
    executor: DatabaseQuery,
  ): Promise<PushJob> {
    const rows = await executor.query<PushJobRow>(
      `INSERT INTO push_jobs
         (trip_id, assignment_id, recipient_user_id, kind, run_at, pickup_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (assignment_id, kind) WHERE status IN ('pending', 'processing')
       DO UPDATE SET run_at            = EXCLUDED.run_at,
                     pickup_at         = EXCLUDED.pickup_at,
                     recipient_user_id = EXCLUDED.recipient_user_id,
                     status            = 'pending',
                     attempts          = 0,
                     next_attempt_at   = NULL,
                     locked_at         = NULL,
                     locked_by         = NULL,
                     last_error        = NULL
       RETURNING ${COLUMNS}`,
      [
        input.tripId,
        input.assignmentId,
        input.recipientUserId,
        input.kind,
        input.runAt,
        input.pickupAt,
      ],
    );
    const written = rows[0];
    // `DO UPDATE` luôn trả về một hàng; không có nhánh nghiệp vụ nào ở đây.
    if (!written) throw new Error('Đặt lịch nhắc không trả về hàng nào.');
    return toJob(written);
  }

  /**
   * Lượt phân công này không còn cần được nhắc: tài xế bị thay, lượt kết thúc,
   * hoặc giờ khởi hành bị xoá.
   *
   * Chỉ chạm vào hàng CHƯA gửi. Một lượt nhắc đã tới điện thoại thì không huỷ
   * được nữa, và giả vờ ngược lại là nói dối trong bản ghi.
   */
  async cancelForAssignment(assignmentId: string, executor: DatabaseQuery): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE push_jobs SET status = 'cancelled', locked_at = NULL, locked_by = NULL
        WHERE assignment_id = $1 AND status IN ('pending', 'processing')
        RETURNING id`,
      [assignmentId],
    );
    return rows.length;
  }

  /** Chuyến bị huỷ (archive): mọi lượt nhắc chưa gửi của nó tắt theo. */
  async cancelForTrip(tripId: string, executor: DatabaseQuery): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE push_jobs SET status = 'cancelled', locked_at = NULL, locked_by = NULL
        WHERE trip_id = $1 AND status IN ('pending', 'processing')
        RETURNING id`,
      [tripId],
    );
    return rows.length;
  }

  /**
   * Giành lấy các hàng đến hạn, và đánh dấu chúng là của worker này.
   *
   * ★ MỘT CÂU LỆNH, VÀ `SKIP LOCKED` LÀ LÝ DO. Câu con khoá đúng những hàng nó
   * đọc được; hàng nào một instance khác đang khoá thì bị BỎ QUA chứ không chờ,
   * nên hai worker chạy cùng giây chia nhau danh sách và không ai đứng im. Đây
   * là thứ thay thế cho một hàng đợi ngoài: không Redis, không broker, đúng một
   * bảng.
   *
   * ★ CHỈ `pending`, VÀ ĐIỀU KIỆN NÀY LÀ THỨ KHIẾN JOB ĐÃ GỬI KHÔNG BAO GIỜ
   * CHẠY LẠI trong điều kiện bình thường. `sent`, `cancelled`, `failed` không
   * lọt qua mệnh đề WHERE.
   */
  async claimDue(
    input: { now: Date; limit: number; workerId: string },
    executor: DatabaseQuery = this.db,
  ): Promise<PushJob[]> {
    const rows = await executor.query<PushJobRow>(
      `UPDATE push_jobs j
          SET status    = 'processing',
              locked_at = $1,
              locked_by = $3
        WHERE j.id IN (
          SELECT c.id FROM push_jobs c
           WHERE c.status = 'pending'
             AND c.run_at <= $1
             AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= $1)
           ORDER BY c.run_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED
        )
        RETURNING ${COLUMNS}`,
      [input.now, input.limit, input.workerId],
    );
    return rows.map(toJob);
  }

  /**
   * Chuyến và lượt phân công như chúng đang là, để worker đối chiếu trước khi
   * gửi.
   *
   * ⚠ CÂU NÀY ĐỌC BẢNG CỦA MỘT CAPABILITY KHÁC, CÓ CHỦ Ý. Thay thế duy nhất là
   * một cổng do `trip-schedule` hiện thực — mà `trip-schedule` đã import
   * capability này rồi, nên cổng đó sẽ tạo một vòng tròn module để đổi lấy đúng
   * một câu SELECT. 0020 đã đặt khoá ngoại tới `trip_schedules` từ trước; ràng
   * buộc ở đây không mới, chỉ rõ hơn. Chỉ ĐỌC, và chỉ những cột mà lượt nhắc
   * thật sự cần.
   */
  async subjectOf(job: PushJob, executor: DatabaseQuery = this.db): Promise<PushJobSubject | null> {
    const rows = await executor.query<{
      archived: boolean;
      status: string;
      pickup_at: Date | null;
      assignment_state: string;
      driver_user_id: string;
    }>(
      `SELECT (t.archived_at IS NOT NULL) AS archived,
              t.status,
              t.pickup_at,
              a.state AS assignment_state,
              a.driver_user_id
         FROM trip_driver_assignments a
         JOIN trip_schedules t ON t.id = a.trip_id
        WHERE a.id = $1`,
      [job.assignmentId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      tripArchived: row.archived,
      tripStatus: row.status,
      tripPickupAt: row.pickup_at,
      assignmentActive: row.assignment_state === 'active',
      assignmentDriverUserId: row.driver_user_id,
    };
  }

  /** Đã giao cho FCM. Trạng thái cuối cùng trong điều kiện bình thường. */
  async markSent(id: string, now: Date, executor: DatabaseQuery = this.db): Promise<void> {
    await executor.query(
      `UPDATE push_jobs
          SET status = 'sent', sent_at = $2, locked_at = NULL, locked_by = NULL, last_error = NULL
        WHERE id = $1 AND status = 'processing'`,
      [id, now],
    );
  }

  /** Lỗi tạm thời: trả về hàng đợi, với mốc sớm nhất được thử lại. */
  async markRetry(
    input: { id: string; nextAttemptAt: Date; error: string },
    executor: DatabaseQuery = this.db,
  ): Promise<void> {
    await executor.query(
      `UPDATE push_jobs
          SET status          = 'pending',
              attempts        = attempts + 1,
              next_attempt_at = $2,
              locked_at       = NULL,
              locked_by       = NULL,
              last_error      = $3
        WHERE id = $1 AND status = 'processing'`,
      [input.id, input.nextAttemptAt, trimError(input.error)],
    );
  }

  /** Hết số lần thử, hoặc một lỗi không đời nào tự khỏi. */
  async markFailed(
    input: { id: string; error: string },
    executor: DatabaseQuery = this.db,
  ): Promise<void> {
    await executor.query(
      `UPDATE push_jobs
          SET status = 'failed', attempts = attempts + 1,
              locked_at = NULL, locked_by = NULL, last_error = $2
        WHERE id = $1 AND status = 'processing'`,
      [input.id, trimError(input.error)],
    );
  }

  /** Nghiệp vụ đã đổi dưới chân job: không gửi nữa, và nói rõ vì sao. */
  async markCancelled(
    input: { id: string; reason: string },
    executor: DatabaseQuery = this.db,
  ): Promise<void> {
    await executor.query(
      `UPDATE push_jobs
          SET status = 'cancelled', locked_at = NULL, locked_by = NULL, last_error = $2
        WHERE id = $1 AND status = 'processing'`,
      [input.id, trimError(input.reason)],
    );
  }

  /**
   * Thả những hàng mà worker cầm rồi chết.
   *
   * ⚠ ĐÂY LÀ CHỖ "ĐÚNG MỘT LẦN" KHÔNG TỒN TẠI, VÀ NÓ ĐƯỢC NÓI THẲNG. Một tiến
   * trình bị kill sau khi FCM đã nhận thông điệp nhưng trước khi `markSent`
   * kịp commit sẽ để lại hàng ở `processing`. Không có cách nào từ phía này
   * phân biệt nó với một hàng chết trước khi gửi — FCM không có API hỏi lại.
   * Chọn thả về `pending`: khả năng một tài xế thấy lượt nhắc hai lần là cái
   * giá chấp nhận được để đổi lấy việc không ai bị bỏ quên. Bản thân FCM cũng
   * không hứa hiển thị đúng một lần, nên lời hứa đó không tồn tại ở bất kỳ tầng
   * nào của hệ này.
   */
  async recoverStuck(before: Date, executor: DatabaseQuery = this.db): Promise<number> {
    const rows = await executor.query<{ id: string }>(
      `UPDATE push_jobs
          SET status = 'pending', locked_at = NULL, locked_by = NULL,
              last_error = 'Worker đã mất kết nối khi đang xử lý; job được thả về hàng đợi.'
        WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < $1
        RETURNING id`,
      [before],
    );
    return rows.length;
  }

  /** Chỉ dùng cho bài test và cho việc chẩn đoán. */
  async findById(id: string, executor: DatabaseQuery = this.db): Promise<PushJob | null> {
    const rows = await executor.query<PushJobRow>(`SELECT ${COLUMNS} FROM push_jobs WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? toJob(rows[0]) : null;
  }
}
