import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../common/errors/domain.error';
import type { PushDevice } from '../domain/push';
import { PushDeviceRepository } from '../persistence/push-device.repository';

/** Token FCM thực tế dài khoảng 150–300 ký tự; trần này rộng rãi và vẫn có trần. */
const MAX_TOKEN_LENGTH = 4096;
/** Chuỗi `User-Agent` chỉ để chẩn đoán, nên cắt ngắn thay vì từ chối. */
const MAX_USER_AGENT_LENGTH = 255;

/**
 * Thiết bị nào của tài xế sẽ rung.
 *
 * ★ CHỦ SỞ HỮU LÀ PHIÊN ĐĂNG NHẬP, KHÔNG BAO GIỜ LÀ MỘT TRƯỜNG TRONG BODY. Mọi
 * phương thức ở đây nhận `userId` như tham số ĐẦU TIÊN, và controller chỉ có
 * một nguồn để truyền vào: `@CurrentUser()`. Không có đường nào cho một caller
 * gắn thiết bị của mình vào tài khoản người khác, vì không có tham số nào để
 * nói điều đó.
 */
@Injectable()
export class PushDeviceService {
  constructor(private readonly devices: PushDeviceRepository) {}

  async register(
    userId: string,
    input: { token: string; userAgent?: string | null },
  ): Promise<PushDevice> {
    const token = input.token.trim();
    if (token === '') throw new ValidationError('Thiếu token thiết bị.');
    if (token.length > MAX_TOKEN_LENGTH) {
      throw new ValidationError('Token thiết bị không hợp lệ.');
    }

    return this.devices.upsert({
      userId,
      fcmToken: token,
      userAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      now: new Date(),
    });
  }

  /**
   * Tắt thông báo, hoặc đăng xuất khỏi máy này.
   *
   * ★ IM LẶNG KHI KHÔNG CÓ GÌ ĐỂ TẮT. Một token đã bị thu hồi, một token của
   * người khác, một token bịa ra — cả ba đều trả về cùng một kết quả rỗng. Trả
   * về 404 cho trường hợp thứ hai sẽ biến route này thành công cụ dò xem một
   * token có thuộc về ai đó hay không.
   */
  async unregister(userId: string, token: string): Promise<void> {
    const trimmed = token.trim();
    if (trimmed === '') throw new ValidationError('Thiếu token thiết bị.');
    await this.devices.revoke(userId, trimmed);
  }
}
