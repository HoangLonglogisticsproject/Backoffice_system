import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfig } from '../../../config/app.config';
import {
  backoffMs,
  MAX_PUSH_ATTEMPTS,
  reminderMessage,
  STUCK_AFTER_MS,
  type PushJob,
} from '../domain/push';
import { PushDeviceRepository } from '../persistence/push-device.repository';
import { PushJobRepository } from '../persistence/push-job.repository';
import { PushSenderService } from './push-sender.service';

/** Bao nhiêu lượt nhắc được xử lý trong một nhịp. Đủ cho một đội xe, có trần. */
const BATCH_SIZE = 50;

/**
 * Nhịp đập đẩy lượt nhắc đi.
 *
 * ★ MỘT CRON ĐỌC MỘT BẢNG, KHÔNG PHẢI MỘT HÀNG ĐỢI NGOÀI. Deployment này không
 * có Redis và không có broker; thêm một cái chỉ để hẹn giờ sẽ là thêm một thứ
 * phải vận hành, phải sao lưu và phải giải thích khi nó chết. PostgreSQL đã ở
 * đây, đã có transaction, và `FOR UPDATE SKIP LOCKED` làm đúng việc một hàng
 * đợi làm. Độ trễ đổi lại là tối đa một phút, điều hoàn toàn chấp nhận được với
 * một lời nhắc đặt trước sáu mươi phút.
 *
 * ★ NHIỀU INSTANCE LÀ TRƯỜNG HỢP BÌNH THƯỜNG, KHÔNG PHẢI NGOẠI LỆ. Mọi instance
 * đều chạy cron này. `claimDue` là thứ khiến điều đó an toàn — không có cờ
 * "chỉ chạy trên máy số một", vì một cờ như thế có nghĩa là lượt nhắc dừng hẳn
 * vào đúng ngày máy số một chết.
 */
@Injectable()
export class PushWorkerService {
  private readonly logger = new Logger(PushWorkerService.name);
  /**
   * Nhãn của tiến trình này trong cột `locked_by`, để người vận hành đọc log
   * biết máy nào đang cầm job. Không có vai trò nào trong việc giành job —
   * `SKIP LOCKED` mới là thứ quyết định, nên một nhãn trùng cũng vô hại.
   */
  private readonly workerId = `${process.pid}`;
  /** Chặn một nhịp mới chồng lên nhịp cũ còn đang chạy trong CÙNG tiến trình. */
  private running = false;

  constructor(
    private readonly jobs: PushJobRepository,
    private readonly devices: PushDeviceRepository,
    private readonly sender: PushSenderService,
    private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.config.pushWorkerEnabled || this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (error) {
      // Một nhịp hỏng không được phép giết scheduler của cả tiến trình.
      this.logger.error(`Nhịp gửi Web Push lỗi: ${describe(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Thả những job mà một worker đã chết khi đang cầm.
   *
   * Chạy thưa hơn nhịp chính: ngưỡng là năm phút, nên quét mỗi năm phút là đủ,
   * và quét dày hơn chỉ làm tăng nguy cơ thả nhầm một job đang được xử lý
   * chậm một cách hợp lệ.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverStuck(): Promise<void> {
    if (!this.config.pushWorkerEnabled) return;
    try {
      const released = await this.jobs.recoverStuck(new Date(Date.now() - STUCK_AFTER_MS));
      if (released > 0) {
        this.logger.warn(`Đã thả ${released} lượt nhắc bị kẹt về hàng đợi.`);
      }
    } catch (error) {
      this.logger.error(`Không thả được job kẹt: ${describe(error)}`);
    }
  }

  /** Giành một lô và xử lý tuần tự. Public để integration spec gọi thẳng. */
  async drain(now: Date = new Date()): Promise<number> {
    const claimed = await this.jobs.claimDue({ now, limit: BATCH_SIZE, workerId: this.workerId });
    for (const job of claimed) {
      try {
        await this.process(job, now);
      } catch (error) {
        // Một job hỏng không kéo theo cả lô. Nó quay lại hàng đợi theo đúng
        // chính sách thử lại, hoặc chết hẳn nếu đã hết lượt.
        await this.retryOrFail(job, describe(error));
      }
    }
    return claimed.length;
  }

  /**
   * Một lượt nhắc, từ lúc giành được tới lúc có kết quả.
   *
   * ★ NGHIỆP VỤ ĐƯỢC ĐỌC LẠI NGAY TRƯỚC KHI GỬI, VÀ ĐÓ LÀ HÀNG PHÒNG THỦ THỨ
   * HAI. Hàng thứ nhất là việc mọi thay đổi chuyến đều đồng bộ lịch trong
   * transaction của nó. Nhưng một job đã bị giành mất rồi mới tới lượt huỷ, một
   * đường ghi mà ai đó quên móc vào, một hàng còn sót từ trước khi tính năng
   * này tồn tại — cả ba đều dẫn tới cùng một hậu quả: rung máy một người không
   * còn liên quan. Năm điều kiện dưới đây là thứ khiến điều đó không xảy ra, và
   * chúng rẻ: một câu SELECT cho mỗi lượt nhắc.
   */
  private async process(job: PushJob, now: Date): Promise<void> {
    const subject = await this.jobs.subjectOf(job);

    if (!subject) {
      await this.jobs.markCancelled({ id: job.id, reason: 'Lượt phân công không còn tồn tại.' });
      return;
    }
    if (subject.tripArchived) {
      await this.jobs.markCancelled({ id: job.id, reason: 'Chuyến đi đã bị huỷ.' });
      return;
    }
    if (subject.tripStatus === 'finished') {
      await this.jobs.markCancelled({ id: job.id, reason: 'Chuyến đi đã hoàn thành.' });
      return;
    }
    if (!subject.assignmentActive) {
      await this.jobs.markCancelled({ id: job.id, reason: 'Lượt phân công đã kết thúc.' });
      return;
    }
    // ★ NGƯỜI NHẬN PHẢI VẪN LÀ NGƯỜI ĐANG CẦM LƯỢT. Nếu hai giá trị này lệch
    // nhau thì job đã lỗi thời theo một cách mà không ai dự tính, và gửi đi sẽ
    // là gửi cho sai tài xế — đúng thứ yêu cầu cấm tuyệt đối.
    if (subject.assignmentDriverUserId !== job.recipientUserId) {
      await this.jobs.markCancelled({ id: job.id, reason: 'Tài xế phụ trách đã thay đổi.' });
      return;
    }
    // Giờ khởi hành đã dời: lịch cũ không còn đúng. Huỷ ở đây, và lần đồng bộ
    // của chính thay đổi đó đã đặt một lịch mới.
    const pickupAt = subject.tripPickupAt;
    if (pickupAt === null || pickupAt.getTime() !== job.pickupAt.getTime()) {
      await this.jobs.markCancelled({ id: job.id, reason: 'Giờ khởi hành đã thay đổi.' });
      return;
    }

    // ★ TOKEN ĐƯỢC TRA THEO NGƯỜI NHẬN CỦA JOB, SAU KHI NGƯỜI ĐÓ ĐÃ ĐƯỢC ĐỐI
    // CHIẾU VỚI LƯỢT PHÂN CÔNG Ở TRÊN. Không có id nào từ client chạm được vào
    // câu truy vấn này.
    const devices = await this.devices.activeFor(job.recipientUserId);
    if (devices.length === 0) {
      // Tài xế chưa bật thông báo, hoặc đã tắt. Không có gì để gửi và cũng
      // không có gì hỏng — đóng job lại thay vì thử lại năm lần vô ích.
      await this.jobs.markCancelled({
        id: job.id,
        reason: 'Tài xế không có thiết bị nào đang bật thông báo.',
      });
      return;
    }

    const message = reminderMessage({
      tripId: job.tripId,
      assignmentId: job.assignmentId,
      // Giờ hiện hành của chuyến, không phải ảnh chụp trong job — hai giá trị
      // này vừa được chứng minh là bằng nhau ở trên.
      pickupAt,
    });

    const results = await this.sender.send(
      devices.map((device) => device.fcmToken),
      message,
    );

    // Token chết bị thu hồi dù lượt nhắc này thành công hay thất bại: lời
    // khẳng định của FCM về một token không phụ thuộc vào số phận của job.
    for (const result of results) {
      if (result.outcome === 'invalid') {
        await this.devices.revokeToken(result.token);
        this.logger.warn(`Thu hồi token FCM không còn hiệu lực (job ${job.id}).`);
      }
    }

    // ★ GIAO ĐƯỢC CHO MỘT MÁY LÀ ĐỦ ĐỂ COI LÀ ĐÃ NHẮC. Tài xế cầm điện thoại,
    // không cầm cả ba thiết bị; thử lại vì chiếc máy tính bảng bỏ quên ở nhà
    // không nhận được sẽ làm chiếc điện thoại rung thêm một lần nữa.
    if (results.some((result) => result.outcome === 'delivered')) {
      await this.jobs.markSent(job.id, now);
      return;
    }

    // Không máy nào nhận. Nếu tất cả đều chết hẳn thì thử lại cũng vô nghĩa.
    if (results.every((result) => result.outcome === 'invalid')) {
      await this.jobs.markFailed({
        id: job.id,
        error: 'Mọi thiết bị của tài xế đều không còn hiệu lực.',
      });
      return;
    }

    await this.retryOrFail(job, results.find((result) => result.error)?.error ?? 'Gửi thất bại.');
  }

  /**
   * Lỗi tạm thời: lùi lại rồi thử lần nữa, cho tới trần số lần.
   *
   * `attempts` trên hàng là số lần ĐÃ thử, nên khoảng lùi tính theo
   * `attempts + 1` — lần thử sắp tới.
   */
  private async retryOrFail(job: PushJob, error: string): Promise<void> {
    const attempted = job.attempts + 1;
    if (attempted >= MAX_PUSH_ATTEMPTS) {
      await this.jobs.markFailed({ id: job.id, error });
      this.logger.error(`Lượt nhắc ${job.id} thất bại sau ${attempted} lần thử: ${error}`);
      return;
    }
    await this.jobs.markRetry({
      id: job.id,
      nextAttemptAt: new Date(Date.now() + backoffMs(attempted)),
      error,
    });
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
