import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type { PushDevice, PushDeviceStatus } from '../domain/push';

/**
 * SQL cho "gửi tới đâu". Không mở transaction (B11), không quyết định gì.
 *
 * ⚠ MỌI CÂU GHI ĐỀU MANG `user_id` CỦA PHIÊN. Không có phương thức nào nhận
 * một id thiết bị trần: id luôn đi kèm chủ của nó, nên một caller cầm token của
 * người khác nhận lại đúng cái không-có-gì mà một token bịa ra nhận được. Ngoại
 * lệ duy nhất là `revokeToken`, và nó không nhận lệnh từ người dùng — chỉ FCM
 * mới gọi được nó, qua worker, khi chính FCM nói token đã chết.
 */

interface PushDeviceRow {
  id: string;
  user_id: string;
  fcm_token: string;
  user_agent: string | null;
  status: PushDeviceStatus;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

const toDevice = (row: PushDeviceRow): PushDevice => ({
  id: row.id,
  userId: row.user_id,
  fcmToken: row.fcm_token,
  userAgent: row.user_agent,
  status: row.status,
  lastSeenAt: row.last_seen_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = `id, user_id, fcm_token, user_agent, status, last_seen_at, created_at, updated_at`;

@Injectable()
export class PushDeviceRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Ghi nhận một thiết bị, hoặc nhận lại thiết bị đã biết.
   *
   * ★ `ON CONFLICT (fcm_token) DO UPDATE`, VÀ `user_id` NẰM TRONG DANH SÁCH
   * CẬP NHẬT. Đó là cách một máy dùng chung chuyển chủ: tài xế B đăng nhập trên
   * cùng chiếc máy tính bảng và FCM trả về đúng token cũ của tài xế A. Nếu chỉ
   * `DO NOTHING`, hàng vẫn mang tên A và mọi lượt nhắc của A sẽ nổ trước mặt B.
   * Ghi đè chủ sở hữu là hành vi ĐÚNG, và unique index của 0038 là thứ khiến nó
   * khả thi.
   *
   * Cũng là cách một thiết bị đã thu hồi sống lại: `status` về `active` khi
   * người ta bật lại thông báo.
   */
  async upsert(
    input: { userId: string; fcmToken: string; userAgent: string | null; now: Date },
    executor: DatabaseQuery = this.db,
  ): Promise<PushDevice> {
    const rows = await executor.query<PushDeviceRow>(
      `INSERT INTO push_devices (user_id, fcm_token, user_agent, status, last_seen_at)
       VALUES ($1, $2, $3, 'active', $4)
       ON CONFLICT (fcm_token) DO UPDATE
         SET user_id      = EXCLUDED.user_id,
             user_agent   = EXCLUDED.user_agent,
             status       = 'active',
             last_seen_at = EXCLUDED.last_seen_at
       RETURNING ${COLUMNS}`,
      [input.userId, input.fcmToken, input.userAgent, input.now],
    );
    const written = rows[0];
    // `DO UPDATE` luôn trả về một hàng, nên nhánh này là lỗi lập trình chứ
    // không phải một trạng thái nghiệp vụ — nói thẳng thay vì che bằng 404.
    if (!written) throw new Error('Upsert thiết bị không trả về hàng nào.');
    return toDevice(written);
  }

  /**
   * Tài xế tắt thông báo, hoặc đăng xuất.
   *
   * Lọc theo CẢ chủ sở hữu: một người không thể tắt thiết bị của người khác dù
   * có đoán đúng token. Không có hàng nào khớp thì không có gì xảy ra — giống
   * hệt như token chưa từng tồn tại.
   */
  async revoke(
    userId: string,
    fcmToken: string,
    executor: DatabaseQuery = this.db,
  ): Promise<PushDevice | null> {
    const rows = await executor.query<PushDeviceRow>(
      `UPDATE push_devices SET status = 'revoked'
        WHERE fcm_token = $2 AND user_id = $1 AND status = 'active'
        RETURNING ${COLUMNS}`,
      [userId, fcmToken],
    );
    return rows[0] ? toDevice(rows[0]) : null;
  }

  /**
   * FCM nói token này đã chết.
   *
   * Không có `user_id` ở đây, và đó là chủ ý: lời khẳng định đến từ FCM về một
   * token, không từ một người về một thiết bị. Chỉ worker gọi.
   */
  async revokeToken(fcmToken: string, executor: DatabaseQuery = this.db): Promise<void> {
    await executor.query(
      `UPDATE push_devices SET status = 'revoked' WHERE fcm_token = $1 AND status = 'active'`,
      [fcmToken],
    );
  }

  /** Các máy đang sống của một người. Phục vụ bởi `idx_push_device_owner`. */
  async activeFor(userId: string, executor: DatabaseQuery = this.db): Promise<PushDevice[]> {
    const rows = await executor.query<PushDeviceRow>(
      `SELECT ${COLUMNS} FROM push_devices
        WHERE user_id = $1 AND status = 'active'
        ORDER BY last_seen_at DESC`,
      [userId],
    );
    return rows.map(toDevice);
  }
}
