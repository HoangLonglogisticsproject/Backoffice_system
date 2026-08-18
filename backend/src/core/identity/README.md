# `core/identity/` — ai đang gọi, và họ chứng minh thế nào

## Trách nhiệm

Authentication facts: credential, session, password policy. **Không** biết người
đó được làm gì — đó là `core/authorization/`.

## Sở hữu

`identities` · `sessions` · password hashing contract · CSRF · login throttle ·
đổi mật khẩu.

`identities` chuyển về đây ở vòng Phase 3 — trước đó nằm trong `core/users` và
khép thành cycle module. Ownership trong tài liệu luôn nói nó thuộc context này;
việc chuyển chỉ là làm cho source khớp với tài liệu.

## Không sở hữu

Role, permission, scope, department, membership. Nếu một file ở đây bắt đầu đọc
`role_assignments` hay `department_memberships`, nó đã đi lạc.

## Entry points

| Endpoint | Guard |
|---|---|
| `POST /auth/login` | `CsrfGuard` |
| `POST /auth/logout` | `CsrfGuard` + `AuthGuard` |
| `GET /auth/me` | `AuthGuard` |
| `POST /auth/password` | `CsrfGuard` + `AuthGuard` |

`POST /auth/password` **cố ý không khai permission**. `PermissionGuard` từ chối
mọi caller còn giữ credential tạm, nên đặt permission lên route này sẽ khoá đúng
những người cần nó. Bốn route trên là toàn bộ những gì một account chưa đổi mật
khẩu làm được.

`AuthGuard` là **opt-in theo route**, cố ý không global: endpoint quên guard thì
nhìn thấy được ngay trên dòng phía trên handler, thay vì im lặng núp dưới một rule
chung có ngoại lệ.

## Layer

```text
api/          controller · DTO · AuthGuard · CsrfGuard · cookie options
application/  SessionService · AuthenticationService · LoginThrottleService
domain/       password.policy · password-hasher.port
persistence/  SessionRepository · IdentityRepository — SQL của sessions và identities
```

`IdentityRepository.findWithUserBySubject` join sang `users` trong đúng một truy
vấn: nó chạy ở mỗi lần login, kể cả login hỏng, và là truy vấn kẻ tấn công được
quyền lên lịch. Đọc chéo context cho hot path là chấp nhận được; **ghi** thì luôn
thuộc đúng một context.

`SessionService` **không viết SQL**; nó quyết định (hết hạn? bị revoke? user còn
active?) và gọi `SessionRepository`. Nhờ vậy luật đọc được mà không cần database.

## Transaction rules

Repository không tự mở transaction. `revokeAllForUser(userId, now, tx)` nhận
executor vì cắt session **không bao giờ** là hành động đứng một mình: nó xảy ra
cùng lúc với revoke role (disable user), bàn giao SuperAdmin, hoặc đổi mật khẩu.

**Đổi mật khẩu** — `AuthenticationService.changePassword`:

```text
verify mật khẩu hiện tại (ngoài transaction: đoán sai không tốn lock)
-> policy cho mật khẩu MỚI
-> tx: thay secret_hash + clear must_change_secret -> revoke MỌI session
```

Cắt cả session đang gọi. Đổi lấy một lần đăng nhập lại: không session nào phát
hành bằng secret cũ sống sót qua thời điểm secret đó hết hiệu lực.

## Authorization

Context này không đánh giá quyền. Nó chỉ trả lời "ai" và gắn `SessionUser` vào
request; `PermissionGuard` của authorization chạy sau và dùng `SessionUser.id`.

## Failure modes

| Tình huống | Kết quả |
|---|---|
| Không cookie · token lạ · hết hạn · đã revoke · user disabled | **401**, một phản hồi duy nhất — không cái nào là công cụ dò |
| Sai mật khẩu · identity không tồn tại · user disabled | cùng một credential error |
| Vượt ngưỡng thử | **429** + `Retry-After` |
| Thiếu header CSRF | **403** |

## Test

| File | Chứng minh |
|---|---|
| `api/auth.security.spec.ts` | hợp đồng bảo mật quan sát được qua HTTP |
| `application/session.service.spec.ts` | luật session: revoked · expired · disabled |
| `application/authentication.service.spec.ts` | login, và việc không tiết lộ account nào tồn tại |
| `application/login-throttle.service.spec.ts` | ngưỡng thử |
