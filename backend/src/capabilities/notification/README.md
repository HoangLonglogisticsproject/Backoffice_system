# Notification — người được bảo gì

**PROJECT-OWNED.** Một deployment khác xoá thư mục này, bỏ `0020`, và tài xế của
họ biết chuyến bằng cách được gọi điện.

## Dòng trước, tín hiệu sau

```
giao dịch nghiệp vụ  →  record(…, tx)  →  COMMIT  →  deliver(…)  →  SSE tới điện thoại
```

- `record` chạy **trong** transaction của thay đổi nghiệp vụ (phân công, quyết
  định hoàn tất). Rollback thì không có thông báo về một việc không xảy ra.
- `deliver` chạy **sau** commit, không trả promise, không thể huỷ gì. Điện thoại
  không nghe được thì phân công vẫn đúng và dòng vẫn còn đó.
- Idempotent bằng `event_key` do server đặt từ **dòng nghiệp vụ**
  (`assignment:<id>:assigned`, `completion:<id>:rejected`,
  `completion:<id>:submitted`) + unique index `(recipient_user_id, event_key)`.
  Retry, gửi lại, hai tab: một dòng.

## Bảy loại, đều là sự kiện đã tồn tại

Sáu loại đi **xuống** tài xế: `TRIP_ASSIGNED` · `TRIP_UNASSIGNED` ·
`COMPLETION_REJECTED` (kèm lý do) · `COMPLETION_APPROVED` ·
`ASSIGNMENT_REQUEST_REJECTED` · `ASSIGNMENT_REQUEST_SUPERSEDED` (0035).

Một loại đi **lên** văn phòng: `COMPLETION_SUBMITTED` (0036, DL-119) — tài xế đã
gửi hoàn tất và người giữ `trip.complete.review` phải quyết. Không có bảng mới và
không có cột mới cho nó: `recipient_user_id` vốn tham chiếu `users`, và SuperAdmin
là một user. Người nhận **hỏi lúc ghi** (`findActiveSuperAdmin` dưới transaction),
không cấu hình; đang handover thì không báo ai và request vẫn đứng trong queue.

Không có `EXPENSE_REJECTED` vì vòng đời chi phí không có từ chối theo từng dòng —
từ chối hoàn tất mở lại tất cả. Không có `COMPLETION_WITHDRAWN` vì tài xế không
rút lại được request đang chờ.

Dòng mang: loại, `trip_id`, `trip_scheduled_on` (snapshot — tài xế bị rút khỏi
chuyến không đọc được chuyến nữa), `detail` (lý do), `read_at`. **Không có tiền,
không có JSON, không có câu chữ** — portal tự ghép câu theo ngôn ngữ người dùng.

## Realtime: Server-Sent Events, không phải WebSocket

`GET /notifications/stream` là một GET có cookie phiên như mọi route khác:
`AuthGuard` quyết định, user id lấy từ phiên, **không có tham số nào** để đặt tên
kênh người khác. Trình duyệt tự reconnect; heartbeat 25 s giữ kết nối dưới
`proxy_read_timeout 60s` của nginx và ~100 s của Cloudflare.

Chọn SSE vì `deploy/nginx.conf` xoá header `Connection` trên `/api/` — WebSocket
cần sửa proxy, thêm ba package và một đường xác thực handshake riêng, trong khi
nhu cầu chỉ là server → client.

**Giới hạn kết nối.** Mỗi stream mở là một socket, một Subject và một heartbeat
sống suốt đời tab, nên có trần: `SSE_MAX_CONNECTIONS_PER_USER` (mặc định **5**
mỗi tài khoản — điện thoại, máy tính bảng, vài tab thừa) và
`SSE_MAX_CONNECTIONS` (mặc định **1000** cả tiến trình). Kiểm tra và đăng ký
trong **cùng một frame đồng bộ** — không có `await` ở giữa — nên hai request
tới cùng lúc vẫn được xử lý lần lượt và không lọt. Vượt ngưỡng: `429
TOO_MANY_CONNECTIONS` kèm `Retry-After: 30`, **không** đăng ký gì. Slot trả về
đúng một lần khi stream kết thúc (unsubscribe, complete hay error). Ở tầng
ingress, `deploy/nginx.conf` thêm `limit_conn` riêng cho `/api/notifications/stream`.

`NotificationStream` giữ kết nối **trong bộ nhớ, một tiến trình** — đúng với
`docker-compose.yml` hiện tại. Có instance thứ hai thì `publish()` cần fan-out
(PostgreSQL `LISTEN/NOTIFY` là bước nhỏ nhất) và không caller nào phải đổi.

Tín hiệu chỉ là `{ id, type, tripId, createdAt }`: đủ để điện thoại biết **đọc
lại gì**, không đủ để làm gì mà không hỏi server. Thông báo cũ không cấp quyền:
tài xế bấm vào thông báo của chuyến đã bị đổi người vẫn bị `ActiveAssignmentGuard`
từ chối.

## Web Push (0038)

Đã có, cho **một** việc: nhắc tài xế **trước giờ khởi hành 1 tiếng**. WebSocket
chỉ đẩy khi portal đang mở; một tài xế đóng trình duyệt lúc 8 giờ tối sẽ không
biết chuyến 10 giờ sáng hôm sau — Web Push đi qua hệ điều hành chứ không qua
tab, nên nó là đường duy nhất chạm tới người đã rời khỏi trang.

Hình dạng:

- `push_devices` — gửi tới đâu. Một tài xế, nhiều máy. `fcm_token` **duy nhất
  toàn cục**: máy dùng chung đổi chủ chứ không nhân bản.
- `push_jobs` — gửi cái gì, lúc nào. Một hàng cho một lượt nhắc, gắn với
  **assignment** chứ không với chuyến, nên đổi tài xế không thể lẫn người.
- `PushSchedulerService` — các service của chuyến đi gọi **trong transaction
  của chúng**, đúng kỷ luật `record(..., tx)` ở trên.
- `PushWorkerService` — cron mỗi phút, giành job bằng `FOR UPDATE SKIP LOCKED`,
  đọc lại nghiệp vụ ngay trước khi gửi, thử lại có backoff + jitter.

### Không hứa exactly-once

`sendEachForMulticast` chỉ nói FCM đã **nhận** thông điệp, không nói điện thoại
đã **hiển thị** nó đúng một lần — FCM không đảm bảo điều đó, nên hệ này cũng
không. Cụ thể: một tiến trình bị kill sau khi FCM nhận nhưng trước khi
`markSent` commit sẽ để job ở `processing`, và `recoverStuck` thả nó về
`pending` sau 5 phút. Không có cách nào từ phía backend phân biệt nó với một
job chết *trước* khi gửi. Lựa chọn là thả về: một tài xế thấy lượt nhắc hai
lần là cái giá chấp nhận được để không ai bị bỏ quên.

### Chưa có

Mọi loại thông báo đẩy khác. `TRIP_ASSIGNED`, `COMPLETION_*` vẫn chỉ đi qua
WebSocket và bảng `notifications`; đẩy chúng ra Web Push là một quyết định
nghiệp vụ riêng, không phải một phần mở rộng hiển nhiên.
