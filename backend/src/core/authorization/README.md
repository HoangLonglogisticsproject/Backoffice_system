# `core/authorization/` — ai được làm gì

## Trách nhiệm

Trả lời đúng một câu hỏi: *caller này có được làm hành động này, lên mục tiêu này
không?* Không chứa nghiệp vụ, không biết capability nào tồn tại.

## Ownership

| Thứ | Ở đâu | Vì sao |
|---|---|---|
| Role key (3), permission key (6), map role→permission | **code** | Guard tham chiếu chúng theo tên. Permission không có code đọc là row vô nghĩa |
| *Ai* giữ role nào, ở đâu | **database** | Đây mới là thứ phải đổi được không cần deploy — nghĩa thật của "SuperAdmin không được hardcode" |
| Permission của capability (`membership.request.create`…) | **capability** | Chúng đặt tên cho artifact chỉ capability có. Core không biết |

## Entry points

| Endpoint | Guard | Permission |
|---|---|---|
| `GET /authorization/me` | `AuthGuard` | — (chỉ cần đăng nhập; 403 nếu `must_change_secret`) |
| `GET /departments/:departmentId/head` | `AuthGuard` + `PermissionGuard` | `role.assign` |
| `POST /departments/:departmentId/head` | + `CsrfGuard` | `role.assign` |
| `DELETE /departments/:departmentId/head` | + `CsrfGuard` | `role.assign` |

Ba route trưởng phòng nằm ở controller riêng (`department-head.controller.ts`)
chứ không gộp vào `AuthorizationController`: cái kia trả lời câu hỏi **về chính
caller** và chỉ cần đăng nhập, ba cái này **đổi ai giữ thẩm quyền** và là
GLOBAL-only. Một controller mang hai câu chuyện guard là cách một route nằm nhầm
chỗ mà không ai thấy.

`role.assign` là global-only, nên HEAD không bổ nhiệm được người kế nhiệm, không
tự bãi nhiệm, và cũng không đọc được route đó. Thẩm quyền được trao **từ bên
ngoài** đơn vị — đó là toàn bộ lý do permission này tồn tại.

Đổi trưởng phòng là `DELETE` rồi `POST`. Không có "set head" một lời gọi: unique
index chặn hai active head, nên hai thao tác không hoán vị được, và một API giả
vờ chúng hoán vị được sẽ thất bại tuỳ thứ tự.

Guard `PermissionGuard` được **export** để module khác gắn vào route của họ —
`core/organization` là consumer đầu tiên. Không đăng ký global: opt-in theo route
nghĩa là endpoint quên guard thì *nhìn thấy được* ngay trên dòng phía trên handler,
thay vì im lặng núp dưới một rule chung có ngoại lệ.

## Request flow

```text
cookie
 → AuthGuard              (core/identity)   → SessionUser.id
 → PermissionGuard        (ở đây)
      ├─ loadContext(userId)                → 1 query, KHÔNG cache
      ├─ mustChangeSecret? → 403
      ├─ target = request.params[scopeParam]   ← ROUTE, không bao giờ body
      └─ can(context, permission, target)   → 403 nếu false
 → controller
```

`@RequirePermission('unit.member.read', 'departmentId')` — tham số thứ hai là tên
**route param** chứa department mục tiêu. Không có đường nào để body khai scope.

## Mô hình quyết định

`can()` là hàm thuần, và nó **không đọc role**. Nó đọc quan hệ:

| Permission | Yêu cầu |
|---|---|
| `unit.read` | target ∈ `memberOf` |
| `unit.member.read` | target ∈ `headOf` |
| `unit.write` · `unit.member.write` · `role.assign` · `user.write` | chỉ `global` |

Quan hệ là thứ database đã lưu; role là nhãn suy ra để hiển thị. Quyết định theo
quan hệ nghĩa là không có giá trị dẫn xuất nào có thể lệch khỏi row sinh ra nó.

HEAD tất nhiên cũng là member của chính phòng đó (FK invariant #6 bảo đảm), nên
permission mức `member` phủ luôn HEAD mà không phải khai hai lần.

**Fail-closed:** permission có scope mà gọi không kèm target → `false`. Trả `true`
ở đó sẽ cấp mọi department cùng lúc.

## Transaction rules

| Thao tác | Transaction |
|---|---|
| `assignDepartmentHead` | lock membership → grant. Không lock thì membership có thể kết thúc giữa kiểm và ghi |
| `transferSuperAdmin` | revoke → grant → `revokeAllForUser(…, tx)`. Thứ tự do DB ép: grant trước va vào unique index |
| `revokeAllForUser(…, tx)` | **phải** nhận `tx` của caller — dùng cho disable user / remove member |

Mọi repository method nhận `executor` tuỳ chọn. `Database.transaction()` đưa cho
callback một connection *khác*; repository luôn dùng `this.db` sẽ commit độc lập.

## Invariant — ai canh cái nào

| # | Nội dung | Canh bởi |
|---|---|---|
| 1 | tối đa 1 active SUPERADMIN | **DATABASE** — partial unique index |
| 2 | tối đa 1 active HEAD / department | **DATABASE** — partial unique index |
| 6 | active HEAD ⇒ có active membership cùng department | **DATABASE** — composite FK có `status` trong key |
| 7 | không về 0 SUPERADMIN qua API | **SERVICE** — không constraint SQL nào nói được "ít nhất một" |

Invariant #6 chặn **cả hai chiều**: không grant được HEAD cho người không phải
member, và không kết thúc được membership khi assignment còn active. Chiều thứ hai
là lý do mọi flow remove/transfer phải **revoke role trước**.

## Failure modes

| Tình huống | Kết quả |
|---|---|
| Handler sau `PermissionGuard` mà quên `@RequirePermission` | **403** — mistake đọc theo nghĩa an toàn |
| Handler quên `AuthGuard` | **401** — guard không thấy user |
| Grant HEAD race | `23505` → `ConflictError` |
| Grant HEAD cho người không đúng phòng | `23503` → `ConflictError` |
| Revoke SuperAdmin cuối cùng qua API | `ConflictError` |
| Credential tạm chưa đổi | **403** ở mọi route có permission |

## Tests

| File | Chứng minh | PostgreSQL |
|---|---|---|
| `authorization.context.spec.ts` | luật `can()`, fail-closed, role derivation | không |
| `authorization.security.spec.ts` | HTTP: 401/403, IDOR chéo phòng, spoof body, CSRF | không |
| `department-head.security.spec.ts` | 25 test: HEAD không tự bổ nhiệm được, spoof body, 409 theo invariant, CSRF trên `DELETE` | không |
| `authorization.integration.spec.ts` | invariant #1/#2/#6/#7, provenance, concurrency, context từ row thật | **có** |
| `../../../migrations/authorization-schema.spec.ts` | hình dạng `0004`/`0005` | không |

```bash
DATABASE_URL_TEST=postgres://user:pass@localhost:5432/backoffice_itest npm test
```

Suite integration chiếm schema riêng `authorization_itest`. Đừng báo PASS khi nó
đang skip.

## Frontend integration contract

`GET /authorization/me` là **hợp đồng render** của toàn bộ frontend:

```json
{
  "userId": "…",
  "username": "a.person",
  "role": "SUPERADMIN | DEPARTMENT_HEAD | MEMBER",
  "departmentIds": ["…"],
  "permissions": ["unit.read", "…"]
}
```

| Trường | Frontend dùng để | Frontend KHÔNG dùng để |
|---|---|---|
| `role` | hiện nhãn, chọn layout | quyết định cho phép — server quyết theo **quan hệ**, không theo role |
| `departmentIds` | biết gọi `/departments/:id` nào | suy ra quyền trên department khác |
| `permissions` | ẩn/hiện nút | thay cho một lần kiểm ở server |
| `username` | hiển thị | **không tự parse lại từ email** — đây đã là local part |

`departmentIds` rỗng với SUPERADMIN, và **tối đa một phần tử** với người khác
(invariant: một active membership). Frontend đừng dựng UI nhiều phòng cho một
người; trạng thái đó không tồn tại được.

Response này được tính lại từ database ở **mỗi** request và không cache ở server.
Frontend cache nó trong bộ nhớ thì phải nạp lại sau đổi mật khẩu, sau khi bị 403,
và sau bất kỳ 409 nào — role có thể đã bị thu hồi giữa hai lần gọi.

**Không có endpoint gán role.** Việc gán role hôm nay đi qua service và CLI, nên
frontend không có màn hình cho nó.
