import { Injectable } from '@nestjs/common';
import type { DatabaseQuery } from '../../../common/types/database.port';
import { reminderRunAt, shouldSchedule } from '../domain/push';
import { PushJobRepository } from '../persistence/push-job.repository';

/** Những gì một lượt phân công cần nói để lịch nhắc của nó đúng. */
export interface ReminderSubject {
  tripId: string;
  assignmentId: string;
  driverUserId: string;
  pickupAt: Date | null;
  tripStatus: string;
}

/**
 * Lịch nhắc đi theo nghiệp vụ, chứ không đi riêng.
 *
 * ★ MỌI PHƯƠNG THỨC Ở ĐÂY CHẠY TRONG TRANSACTION CỦA NGƯỜI GỌI, và đó là cùng
 * một kỷ luật `NotificationService.record` đã đặt ra ở capability này:
 *
 *     transaction nghiệp vụ  →  syncForAssignment(…, tx)  →  COMMIT
 *
 * Một lượt nhắc cho lần phân công bị rollback là một lượt nhắc về việc không hề
 * xảy ra; một chuyến đã huỷ mà job còn sống là một cuộc gọi lúc 5 giờ sáng bảo
 * tài xế đi lấy hàng không tồn tại. Cả hai đều biến mất nếu lịch và nghiệp vụ
 * cùng commit hoặc cùng rollback — nên không có phương thức nào ở đây tự mở
 * transaction, và không có phương thức nào trả về thứ phải "giao sau".
 *
 * ★ VÀ ĐÂY LÀ THỨ DUY NHẤT `trip-schedule` GỌI. Capability kia không biết
 * `push_jobs` tồn tại, không viết SQL nào về nó, và không cần biết lượt nhắc
 * cách giờ khởi hành bao lâu.
 */
@Injectable()
export class PushSchedulerService {
  constructor(private readonly jobs: PushJobRepository) {}

  /**
   * Lịch nhắc của một lượt phân công, đặt lại từ đầu theo sự thật hiện tại.
   *
   * ★ HUỶ RỒI MỚI ĐẶT, KHÔNG PHẢI SỬA TẠI CHỖ. Đổi giờ khởi hành, đổi trạng
   * thái, xoá giờ — cả ba đều quy về một câu hỏi duy nhất: "theo những gì
   * đang đúng lúc này, lượt phân công này có đáng được nhắc không, và lúc
   * mấy giờ?". Viết theo lối đó thì mọi tình huống gọi đều dùng chung một
   * đường, kể cả tình huống chưa ai nghĩ tới.
   *
   * `cancel` chạy trước để một lượt phân công vừa mất giờ khởi hành không giữ
   * lại cái lịch cũ; `schedule` sau đó dùng `ON CONFLICT` nên hai lần gọi liên
   * tiếp không bao giờ sinh ra hai hàng.
   */
  async syncForAssignment(
    subject: ReminderSubject,
    tx: DatabaseQuery,
    now: Date = new Date(),
  ): Promise<void> {
    await this.jobs.cancelForAssignment(subject.assignmentId, tx);

    if (!shouldSchedule({ pickupAt: subject.pickupAt, tripStatus: subject.tripStatus, now })) {
      return;
    }

    // `shouldSchedule` đã khẳng định `pickupAt` khác null; khẳng định lại ở đây
    // là để trình kiểm kiểu thấy điều đó, không phải để kiểm tra lần hai.
    const pickupAt = subject.pickupAt as Date;

    await this.jobs.schedule(
      {
        tripId: subject.tripId,
        assignmentId: subject.assignmentId,
        recipientUserId: subject.driverUserId,
        kind: 'departure_reminder',
        runAt: reminderRunAt(pickupAt),
        pickupAt,
      },
      tx,
    );
  }

  /**
   * Lượt phân công kết thúc: tài xế bị thay, bị gỡ khỏi chuyến.
   *
   * ★ GỌI VỚI ID CỦA LƯỢT CŨ, VÀ ĐÓ LÀ THỨ CHẶN "GỬI NHẦM NGƯỜI". Đổi tài xế
   * sinh ra một assignment MỚI với id mới (ADR-0004), nên job của người cũ
   * không có đường nào biến thành job của người mới: một bên bị huỷ theo id
   * cũ, một bên được đặt theo id mới, trong cùng một transaction.
   */
  async cancelForAssignment(assignmentId: string, tx: DatabaseQuery): Promise<void> {
    await this.jobs.cancelForAssignment(assignmentId, tx);
  }

  /** Chuyến bị huỷ: mọi lượt nhắc chưa gửi của nó tắt theo. */
  async cancelForTrip(tripId: string, tx: DatabaseQuery): Promise<void> {
    await this.jobs.cancelForTrip(tripId, tx);
  }
}
