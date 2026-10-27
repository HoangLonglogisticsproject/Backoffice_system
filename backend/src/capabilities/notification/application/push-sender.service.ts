import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../config/app.config';
import { outcomeOfError, type PushDeliveryOutcome, type PushMessage } from '../domain/push';

/** Kết quả gửi tới MỘT thiết bị. Lỗi được giữ nguyên văn để ghi vào `last_error`. */
export interface PushDeliveryResult {
  token: string;
  outcome: PushDeliveryOutcome;
  error?: string;
}

/**
 * Cái bọc quanh Firebase Admin, và là nơi DUY NHẤT trong backend biết Firebase
 * tồn tại.
 *
 * ★ CHƯA CẤU HÌNH LÀ KHÔNG GỬI, KHÔNG PHẢI LÀ KHÔNG BOOT. Một developer vừa
 * clone repo, một job CI, một môi trường staging chưa xin được service account
 * — cả ba đều phải chạy được toàn bộ phần còn lại của hệ. Nên thiếu cấu hình
 * thì mọi thiết bị trả về `retryable` kèm một dòng cảnh báo: job ở lại hàng đợi
 * thay vì biến mất, và ngày service account được nạp thì chúng tự đi tiếp.
 *
 * ⚠ KHÔNG CÓ LỜI HỨA "ĐÚNG MỘT LẦN" Ở ĐÂY HAY Ở BẤT KỲ ĐÂU. `sendEachForMulticast`
 * trả lời rằng FCM đã NHẬN thông điệp, không phải rằng điện thoại đã HIỂN THỊ
 * nó đúng một lần. FCM không đảm bảo điều đó, nên hệ này cũng không.
 */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);
  /** `undefined` = chưa thử nạp; `null` = đã thử và deployment này không có cấu hình. */
  private messaging?: FirebaseMessaging | null;

  constructor(private readonly config: AppConfig) {}

  /**
   * Gửi một thông điệp tới nhiều thiết bị của CÙNG một người.
   *
   * ★ KẾT QUẢ THEO TỪNG THIẾT BỊ, KHÔNG PHẢI MỘT CHỮ "THÀNH CÔNG" CHUNG. Một
   * tài xế có điện thoại và máy tính bảng; chiếc đã gỡ ứng dụng phải bị thu hồi
   * token trong khi chiếc kia vẫn nhận bình thường. Gộp lại thành một kết quả
   * sẽ hoặc giết nhầm token còn sống, hoặc giữ mãi token đã chết.
   */
  async send(tokens: readonly string[], message: PushMessage): Promise<PushDeliveryResult[]> {
    if (tokens.length === 0) return [];

    const messaging = await this.resolve();
    if (!messaging) {
      // Cấu hình thiếu là lỗi của deployment, không phải của thiết bị — nên
      // đây là lỗi TẠM THỜI: nó sẽ hết khi ai đó nạp credentials.
      return tokens.map((token) => ({
        token,
        outcome: 'retryable' as const,
        error: 'Firebase chưa được cấu hình trên deployment này.',
      }));
    }

    const response = await messaging.sendEachForMulticast({
      tokens: [...tokens],
      notification: { title: message.title, body: message.body },
      // ★ `data` LÀ THỨ SERVICE WORKER ĐỌC KHI NGƯỜI TA BẤM VÀO. Chỉ đường dẫn
      // tương đối, không origin: service worker ghép với origin của chính nó,
      // nên một thông điệp không thể điều hướng trình duyệt ra ngoài hệ.
      data: { link: message.link },
      webpush: {
        notification: { title: message.title, body: message.body, requireInteraction: false },
        fcmOptions: { link: this.absoluteLink(message.link) },
      },
    });

    return response.responses.map((result, index): PushDeliveryResult => {
      // FCM trả về đúng một kết quả cho mỗi token, theo thứ tự đã gửi. Chuỗi
      // rỗng là nhánh không bao giờ xảy ra, viết ra chỉ để không phải khẳng
      // định kiểu bằng dấu chấm than.
      const token = tokens[index] ?? '';
      if (result.success) return { token, outcome: 'delivered' };
      const code = result.error?.code;
      return {
        token,
        outcome: outcomeOfError(code),
        error: `${code ?? 'unknown'}: ${result.error?.message ?? 'không rõ nguyên nhân'}`,
      };
    });
  }

  /**
   * `fcmOptions.link` của FCM đòi một URL tuyệt đối HTTPS. Khi deployment chưa
   * khai báo địa chỉ công khai thì bỏ trống trường đó — service worker vẫn mở
   * được đúng trang từ `data.link`, nên đây là một tiện nghi chứ không phải
   * một phụ thuộc.
   */
  private absoluteLink(path: string): string | undefined {
    const base = this.config.pushAppBaseUrl;
    if (base === '') return undefined;
    return `${base.replace(/\/+$/, '')}${path}`;
  }

  /**
   * Nạp Firebase Admin một lần, lười.
   *
   * ★ `import()` ĐỘNG CHỨ KHÔNG PHẢI IMPORT Ở ĐẦU FILE. Firebase Admin mở
   * connection pool và đọc credentials ngay khi khởi tạo; kéo nó vào đồ thị
   * module vô điều kiện nghĩa là mọi bài test unit của capability này đều phải
   * trả giá cho một thứ chúng không dùng.
   */
  private async resolve(): Promise<FirebaseMessaging | null> {
    if (this.messaging !== undefined) return this.messaging;

    const credentials = this.config.firebase;
    if (!credentials) {
      this.logger.warn(
        'FIREBASE_* chưa được cấu hình — không gửi được Web Push. Lượt nhắc sẽ nằm chờ trong push_jobs.',
      );
      this.messaging = null;
      return null;
    }

    try {
      const admin = (await import('firebase-admin/app')) as unknown as FirebaseAppModule;
      const messagingModule = (await import(
        'firebase-admin/messaging'
      )) as unknown as FirebaseMessagingModule;

      // Một app cho cả tiến trình. `getApps()` khiến lần nạp thứ hai — một
      // integration spec dựng lại module chẳng hạn — không ném "app đã tồn tại".
      const existing = admin.getApps();
      const app =
        existing[0] ??
        admin.initializeApp({
          credential: admin.cert({
            projectId: credentials.projectId,
            clientEmail: credentials.clientEmail,
            privateKey: credentials.privateKey,
          }),
        });

      this.messaging = messagingModule.getMessaging(app);
      return this.messaging;
    } catch (error) {
      // Credentials sai định dạng, hoặc gói chưa được cài. Cả hai đều là lỗi
      // deployment, và cả hai đều không được phép làm sập worker.
      this.logger.error(
        `Không khởi tạo được Firebase Admin: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.messaging = null;
      return null;
    }
  }
}

/**
 * Bề mặt của Firebase Admin mà file này thật sự dùng.
 *
 * Khai báo tại chỗ thay vì import kiểu từ `firebase-admin`, để phần còn lại của
 * backend — và mọi bài test — biên dịch được mà không cần gói đó có mặt.
 */
interface FirebaseApp {
  readonly name: string;
}

interface FirebaseAppModule {
  getApps(): FirebaseApp[];
  initializeApp(options: { credential: unknown }): FirebaseApp;
  cert(serviceAccount: { projectId: string; clientEmail: string; privateKey: string }): unknown;
}

interface FirebaseMessagingModule {
  getMessaging(app: FirebaseApp): FirebaseMessaging;
}

interface FirebaseMessaging {
  sendEachForMulticast(message: {
    tokens: string[];
    notification: { title: string; body: string };
    data: Record<string, string>;
    webpush: {
      notification: { title: string; body: string; requireInteraction: boolean };
      fcmOptions: { link?: string };
    };
  }): Promise<{ responses: Array<{ success: boolean; error?: { code?: string; message?: string } }> }>;
}
