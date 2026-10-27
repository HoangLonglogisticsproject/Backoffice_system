import { Body, Controller, Delete, HttpCode, HttpStatus, Headers, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import { DriverOnlyGuard } from '../../../core/identity/api/driver-only.guard';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { PushDeviceService } from '../application/push-device.service';

/**
 * Thiết bị của tài xế đăng ký nhận Web Push.
 *
 * ★ BODY KHÔNG CÓ CHỖ NÀO ĐỂ NÓI "TÔI LÀ AI", VÀ ĐÓ LÀ CẢ THIẾT KẾ. Schema
 * dưới đây chỉ có đúng một trường: `token`. Một caller gửi kèm `userId` thì
 * zod loại bỏ nó trước khi service nhìn thấy, và service thì không có tham số
 * nào để nhận nó — chủ sở hữu luôn đến từ `@CurrentUser()`. Không có kiểm tra
 * nào phải nhớ thực hiện, vì không có đường nào để quên.
 *
 * ★ `DriverOnlyGuard`, VÌ ĐÂY LÀ TÍNH NĂNG CỦA CON ĐƯỜNG. Lượt nhắc trước giờ
 * khởi hành chỉ gửi cho người đang cầm lượt phân công; một tài khoản văn phòng
 * đăng ký thiết bị sẽ không bao giờ nhận được gì, nên để nó đăng ký chỉ tạo ra
 * một hàng không ai giải thích được sau này.
 *
 * ★ KHÔNG CÓ `@RequirePermission`, GIỐNG HỆT `NotificationController`. Không
 * tầng quyền nào diễn đạt được "thiết bị của chính anh"; câu truy vấn diễn đạt
 * điều đó. Vì vậy `PermissionGuard` cũng không nằm trong chồng guard — nó từ
 * chối mọi route không khai báo quyền.
 */

const registerDeviceSchema = z
  .object({
    token: z.string().min(1, 'Thiếu token thiết bị.').max(4096),
  })
  // `.strict()` chứ không phải mặc định: một body mang `userId` bị TỪ CHỐI
  // thẳng thay vì được bỏ qua trong im lặng. Client nào đang cố gắn thiết bị
  // cho người khác thì nên biết là nó đã sai, chứ không nên nghĩ nó đã thành công.
  .strict();

type RegisterDeviceBody = z.infer<typeof registerDeviceSchema>;

@Controller('notifications/push-devices')
export class PushDeviceController {
  constructor(private readonly devices: PushDeviceService) {}

  /**
   * Bật thông báo trên máy này — hoặc xác nhận lại một token đã biết.
   *
   * Idempotent: trình duyệt gọi lại mỗi lần tài xế mở trang thông báo, và FCM
   * trả về đúng token cũ khi không có gì đổi.
   */
  @Post()
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard)
  @HttpCode(HttpStatus.OK)
  async register(
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceBody,
    @CurrentUser() actor: SessionUser,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ registered: true }> {
    await this.devices.register(actor.id, { token: body.token, userAgent: userAgent ?? null });
    // Không trả lại hàng vừa ghi: client không cần id thiết bị để làm gì, và
    // một token dội ngược về là một bản sao nữa của nó trong log của ai đó.
    return { registered: true };
  }

  /** Tắt thông báo trên máy này. Gọi cả khi đăng xuất. */
  @Delete()
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<void> {
    await this.devices.unregister(actor.id, body.token);
  }
}
