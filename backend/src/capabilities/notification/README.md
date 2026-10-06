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

## Web Push

Chưa có. SSE chỉ đẩy khi portal đang mở; điện thoại khoá màn hình thì đọc lại
từ API khi mở lại (`visibilitychange` + reconnect đều refetch). Web Push cần cặp
khoá VAPID cấp ở deployment, package `web-push`, service worker và bảng
subscription — quyết định hạ tầng, ghi ở báo cáo phát hành.
