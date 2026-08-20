# Frontend integration contract

Hợp đồng **duy nhất** giữa backoffice backend và frontend. Đọc file này là đủ để
tích hợp — không cần đọc source để đoán hành vi.

Mọi ví dụ trong tài liệu này được ghi lại từ một deployment thật (PostgreSQL 17,
build production), không phải viết tay.

---

## 0. Nguyên tắc

Frontend **chỉ tiêu thụ API**. Nó không phải lớp bảo mật thứ hai.

Server quyết định quyền trên **mọi** request, đọc lại từ database mỗi lần, không
cache. Ẩn một nút là tiện lợi cho người dùng; nó **không bao giờ** là kiểm soát.
Nếu frontend có bug và gọi vào endpoint không được phép, server trả 403 — đó là
thiết kế, không phải sự cố.

| Frontend KHÔNG làm | Vì sao |
|---|---|
| tự quyết caller được làm gì | `PermissionGuard` quyết, mỗi request |
| suy ra role/department từ dữ liệu tự có | `GET /authorization/me` là nguồn duy nhất |
| tự tách username từ email | server đã trả `username` |
| gọi endpoint core để đi vòng approval | các đường đó là GLOBAL-only, HEAD nhận 403 |
| coi `permissions[]` là quyền thật | đó là gợi ý render |
| đoán department từ body gửi lên | scope luôn nằm trên URL |

---

## 1. Authentication flow

Session là **cookie `HttpOnly`**. JavaScript không đọc được, và không có token
nào để lưu. Mọi request chỉ cần `credentials: 'include'`.

### `POST /auth/login` → 200

⚠️ **Field tên là `subject`, không phải `email`.** Giá trị điền vào là email —
email là định danh đăng nhập duy nhất — nhưng tên field giữ nguyên `subject` vì
nó là khoá của identity provider. Gửi `email` sẽ nhận 422.

```jsonc
// request
{ "subject": "admin@example.com", "password": "…" }

// 200 — cookie phiên được set kèm response
{
  "user": { "id": "8b18fa79-…", "displayName": "Root Admin", "status": "active" },
  "expiresAt": "2026-08-18T20:30:44.911Z"
}
```

`expiresAt` để cảnh báo trước khi hết hạn. Token **không** có trong response và
sẽ không bao giờ có.

Sai mật khẩu → **401**. Quá nhiều lần → **429** kèm `Retry-After`. Cả hai đều
không tiết lộ email có tồn tại hay không.

### `GET /auth/me` → 200

```jsonc
{ "id": "fab71f53-…", "displayName": "Head Person", "status": "active" }
```

Chỉ danh tính, không có quyền. Dùng được **ngay cả khi** credential còn tạm.

### `POST /auth/logout` → 204

### `POST /auth/password` → 204

```jsonc
{ "currentPassword": "…", "newPassword": "…" }
```

`currentPassword` bắt buộc dù đã có session: cookie có thể bị đánh cắp, và
chứng minh biết mật khẩu cũ là thứ chặn một cookie bị lộ thành chiếm quyền vĩnh
viễn.

**Mọi session chết, kể cả session đang gọi.** Cookie bị xoá. Frontend phải điều
hướng về màn đăng nhập — không có cách nào tiếp tục phiên cũ.

---

## 2. CSRF contract

Guard nhìn **method**, không nhìn route. Mọi method ngoài `GET` · `HEAD` ·
`OPTIONS` là mutation và bị đòi header — không có ngoại lệ nào theo endpoint.

| Method | Yêu cầu |
|---|---|
| `GET` · `HEAD` · `OPTIONS` | không cần gì |
| `POST` · `PATCH` · `DELETE` | **bắt buộc** header `X-Requested-With: XMLHttpRequest` |

Thiếu header → **403**. Cơ chế: một trang cross-origin không thể đặt custom
header mà không kích hoạt CORS preflight.

Thứ tự guard: trên `/auth/*` guard CSRF chạy **trước** authentication, nên
`POST /auth/login` thiếu header nhận 403 chứ không phải 401; trên các route
khác `AuthGuard` chạy trước, nên một request vừa không có phiên vừa thiếu header
nhận 401. Với một phiên hợp lệ — tức mọi tình huống frontend thật sự gặp — thiếu
header luôn là **403**.

```ts
fetch(url, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  body: JSON.stringify(payload),
});
```

Đặt header này **một lần** ở HTTP interceptor, theo method chứ không theo danh
sách endpoint. Quên ở một chỗ là 403 khó hiểu ở đúng chỗ đó.

Hai chỗ dễ quên nhất, vì trông không giống "gửi form": `DELETE
/departments/:departmentId/head` (§15b) và `POST /auth/login`.

---

## 3. `GET /authorization/me`

Hợp đồng render của toàn bộ frontend. Gọi ngay sau khi đăng nhập.

**Điều kiện tiên quyết: một session đã xác thực.** Endpoint này không có chế độ
ẩn danh — không cookie, cookie hết hạn, hoặc cookie đã bị huỷ → **401
`UNAUTHORIZED`**, không phải 200 với `permissions: []`. Không có câu trả lời
"anonymous authorization" nào tồn tại.

**Ngoại lệ duy nhất của điều kiện đó: `must_change_secret = true`.** Session hợp
lệ, authentication đã xong, nhưng credential còn tạm → **403
`PASSWORD_CHANGE_REQUIRED`** (§12). Đây **không phải** hết phiên: cookie vẫn
sống, `GET /auth/me` vẫn 200, `POST /auth/password` vẫn gọi được. Xem §3b trước
khi viết interceptor.

```jsonc
{
  "userId": "8b18fa79-…",
  "username": "admin",                 // local part của email, server suy ra
  "role": "SUPERADMIN",                // SUPERADMIN | DEPARTMENT_HEAD | MEMBER
  "departmentIds": [],                 // rỗng với SUPERADMIN
  "permissions": ["unit.read", "unit.write", "unit.member.read",
                  "unit.member.write", "role.assign", "user.write"]
}
```

| Trường | Dùng để | KHÔNG dùng để |
|---|---|---|
| `role` | nhãn, layout | quyết định cho phép |
| `departmentIds` | biết gọi `/departments/:id` nào | suy quyền trên phòng khác |
| `permissions` | ẩn/hiện nút | thay cho kiểm ở server |
| `username` | hiển thị | parse lại từ email |

`departmentIds` có **tối đa một phần tử**: một người active thuộc đúng một phòng.
Đừng dựng UI nhiều phòng cho một người — trạng thái đó không tồn tại được.

Response được tính lại từ database mỗi request. **Nạp lại nó** sau khi đổi mật
khẩu, sau bất kỳ 403 nào, và sau bất kỳ 409 nào: role có thể đã bị thu hồi.

**403 `PASSWORD_CHANGE_REQUIRED`** ở đây nghĩa là credential còn tạm — xem §12.

---

## 3b. `SessionRepository.current()`

Frontend cần **một** chỗ trả lời câu hỏi "phiên hiện tại là gì", và câu trả lời
có **ba** giá trị, không phải hai. Nhánh thứ ba là chỗ mọi tích hợp làm sai.

| Trạng thái | Nhận ra bằng | `current()` trả về | Điều hướng |
|---|---|---|---|
| authenticated + authorization thành công | `GET /authorization/me` → **200** | `{ status: 'ready', authorization }` | vào app |
| authenticated + `PASSWORD_CHANGE_REQUIRED` | **403** + `code === 'PASSWORD_CHANGE_REQUIRED'` | `{ status: 'password-change-required', identity }` | màn **đổi mật khẩu** |
| anonymous | **401** `UNAUTHORIZED` | `{ status: 'anonymous' }` | màn **login** |

```ts
async function current(): Promise<SessionState> {
  try {
    return { status: 'ready', authorization: await get('/authorization/me') };
  } catch (e) {
    const status = statusOf(e);
    const body = bodyOf(e);
    const code = typeof body?.error === 'object' ? body.error.code : undefined;

    if (status === 401) return { status: 'anonymous' };
    if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
      // Phiên còn sống: `/auth/me` vẫn trả danh tính để hiện trên màn đổi mật khẩu.
      return { status: 'password-change-required', identity: await get('/auth/me') };
    }
    throw e;   // không phải trạng thái phiên — để tầng lỗi chung xử lý
  }
}
```

⚠️ **`PASSWORD_CHANGE_REQUIRED` không được biến thành logout.** Một interceptor
kiểu `if (status === 401 || status === 403) redirectToLogin()` khoá người dùng
ra ngoài vĩnh viễn: họ đăng nhập được, nhưng `/authorization/me` trả 403, bị đá
về login, đăng nhập lại, lại 403 — vòng lặp không có lối ra, vì lối ra duy nhất
(`POST /auth/password`) nằm ở màn hình mà interceptor không bao giờ cho tới.

| Mã | Có phải logout không |
|---|---|
| 401 `UNAUTHORIZED` | **có** — xoá state, về login |
| 403 `PASSWORD_CHANGE_REQUIRED` | **không** — phiên còn sống, đi tới màn đổi mật khẩu |
| 403 `FORBIDDEN` | **không** — đăng nhập lại không giúp gì; hiện thông báo tại chỗ |

Chỉ khi `POST /auth/password` thành công thì mới đăng xuất — và lúc đó là do
server đã huỷ mọi session (§1), không phải do interceptor quyết định.

Nạp lại `current()` sau khi đổi mật khẩu, sau bất kỳ 403 nào, và sau bất kỳ 409
nào.

---

## 4. User provisioning

### `POST /users` → 201 · GLOBAL only

```jsonc
// request
{
  "displayName": "Head Person",
  "email": "head@example.com",
  "initialPassword": "a valid head passphrase",
  "departmentId": "7ce2630e-…"          // BẮT BUỘC
}

// 201
{
  "id": "fab71f53-…",
  "displayName": "Head Person",
  "username": "head",
  "status": "active",
  "departmentId": "7ce2630e-…"
}
```

Một transaction tạo cùng lúc: `users` + `identities` + credential + membership.
Không tồn tại account "chưa có phòng" — thiếu `departmentId` → **422**.

⚠️ **`initialPassword` là mật khẩu TẠM.** Account tạo ra có
`must_change_secret = true`: người đó đăng nhập được, nhưng **mọi** endpoint
khác trả 403 cho tới khi họ đổi mật khẩu. Xem §12.

Mật khẩu tạm chỉ cần **≥ 8 ký tự** — nó do người quản trị đọc cho nhân viên,
nên `12345678` là hợp lệ. Mật khẩu **vĩnh viễn** người dùng tự đặt ở
`POST /auth/password` phải **≥ 12**. Hai ngưỡng khác nhau, cố ý — xem §13.

HEAD gọi vào đây → **403**. Đường của HEAD là account invitation (§9).

### `PATCH /users/:userId/status` → 200 · GLOBAL only

```jsonc
{ "status": "disabled" }   // giá trị hợp lệ duy nhất
```

```jsonc
// 200
{ "id": "7d47b2ac-…", "status": "disabled" }
```

Đây là **offboarding**, một transaction: kết thúc membership, thu hồi role, huỷ
mọi session, disable account. Người đó lập tức mất phiên và không đăng nhập lại
được.

`{"status":"active"}` → **422**. Bật lại account **không được implement** — xem
§18.

---

## 5. Department API

| Endpoint | Ai gọi được | Thành công |
|---|---|---|
| `GET /departments` | **chỉ GLOBAL** | 200 |
| `GET /departments/:id` | member của phòng đó, hoặc GLOBAL | 200 |
| `POST /departments` | GLOBAL | 201 |
| `PATCH /departments/:id` | GLOBAL | 200 |
| `POST /departments/:id/archive` | GLOBAL | 200 |

⚠️ `GET /departments` **không có scope**, nên chỉ GLOBAL qua được. HEAD và MEMBER
nhận **403**. Đừng dùng nó để dựng menu — lấy id từ `/authorization/me`, rồi gọi
`GET /departments/:id`.

```jsonc
// GET /departments — 200
[
  { "id": "60630e75-…", "slug": "finance", "name": "Finance", "status": "active",
    "createdAt": "2026-08-18T08:34:22.918Z", "updatedAt": "2026-08-18T08:34:22.918Z" }
]
```

```jsonc
// POST /departments — 201
{ "slug": "ops", "name": "Operations" }
```

Archive một phòng còn người active → **409**. Chuyển hết người đi trước.

---

## 5b. List envelope và identity projection

Hai thay đổi đã ship, ảnh hưởng **mọi endpoint trả danh sách** dưới đây. Cả hai
đều **additive** — không field cũ nào bị đổi tên hay bỏ đi.

### Envelope phân trang (ADR-0002)

Năm endpoint danh sách **không trả mảng trần nữa**. Chúng trả:

```jsonc
{
  "items": [ /* … */ ],
  "nextCursor": "eyJ0IjoiMjAyNi0wOC0yMC…",   // null ở trang cuối
  "hasMore": true
}
```

| Query param | Mặc định | Giới hạn |
|---|---|---|
| `limit` | 50 | 1–200. Ngoài khoảng → **422**, KHÔNG bị cắt xuống im lặng |
| `cursor` | không có | lấy nguyên văn từ `nextCursor` của trang trước |

- `cursor` là **opaque**. Client không được parse, sinh, sửa hay đoán nội dung.
- Cursor **hỏng → 422** (`VALIDATION_FAILED`), **không** âm thầm trả về trang 1.
- **KHÔNG có tổng số bản ghi.** `hasMore` được trả lời bằng một hàng thăm dò
  `limit + 1`, không phải `COUNT(*)`. Đừng dựng phân trang kiểu "trang 1/N".
- Đọc tiếp cho tới khi `hasMore` là `false`.
- `GET /departments` **không** phân trang: nó sắp theo `name`, mà `name` đổi
  được — một cursor trên cột đổi được thì không thể đúng.

### `UserSummary` (ADR-0001)

Mọi resource có tham chiếu tới một con người giờ kèm theo tên của người đó:

```jsonc
{ "id": "fab71f53-…", "displayName": "Head Person" }
```

**`displayName` và không gì khác.** Không `email` — email không phải tên hiển
thị và tuyệt đối không được dùng thay. Không `username` — server không lưu, nó
suy ra từ email, nên trả về là lộ phần local của địa chỉ email.

| Resource | Field id (GIỮ NGUYÊN) | Sibling mới |
|---|---|---|
| members | `userId` | `user` |
| membership request | `targetUserId` · `requestedBy` | `targetUser` · `requestedByUser` |
| account invitation | `requestedBy` | `requestedByUser` |
| department head (chỉ READ) | `userId` | `user` |

**Không có `decidedByUser`, không có `createdUser`.** Hai field đó nullable và
chưa màn hình nào hiển thị; thêm join cho field không ai đọc thì trả giá trên
mọi hàng của mọi trang. Sibling là additive nên thêm sau lúc nào cũng được.

### Projection KHÔNG phải một quyền mới

`UserSummary` chỉ đi kèm bên trong một resource mà caller **đã được phép đọc**.
Tên hiện ra đúng khi và chỉ khi hàng tham chiếu tới nó hiện ra.

- **KHÔNG có `GET /users/:id`.** Không có bulk lookup. Không có cách nào biến
  một user id bất kỳ thành một cái tên.
- Thứ tự không đổi: authn → authz → scope → query → projection.
- Caller **không** chọn được ai bị project. Không đọc user id từ query string
  hay body cho việc này — chỉ những hàng mà query đã trả về mới có tên.
- 403 thì không có hàng nào, nên cũng không có tên nào lọt ra.

Frontend vì thế **không được** tự join phía client, không N+1 `GET /users/:id`,
và không tự bịa một định nghĩa thứ hai về "người dùng là gì".

---

## 6. Membership API

| Endpoint | Ai gọi được |
|---|---|
| `GET /departments/:id/members` | **HEAD** của phòng đó, hoặc GLOBAL |
| `POST /departments/:id/members` | **chỉ GLOBAL** |

⚠️ MEMBER thường **không** xem được danh sách đồng nghiệp, kể cả phòng của chính
mình → 403. Đây là mặc định đã chốt, không phải thiếu sót.

```jsonc
// GET /departments/:id/members?limit=50 — 200
{
  "items": [
    { "id": "d4b58fd3-…",                     // ← id của MEMBERSHIP
      "userId": "fab71f53-…",                 // ← id của NGƯỜI (giữ nguyên)
      "user": { "id": "fab71f53-…", "displayName": "Head Person" },   // ← mới
      "departmentId": "7ce2630e-…",
      "status": "active", "createdAt": "2026-08-18T08:34:04.975Z", "endedAt": null }
  ],
  "nextCursor": "eyJ0IjoiMjAyNi0wOC0xOCAwODozNDowNC45NzUxODIrMDAi…",
  "hasMore": true
}
```

⚠️ `id` là membership, `user.id` là con người. Hai thứ khác nhau — nhầm là có
ngày xoá sai hàng.

---

## 7. Transfer flow

### Đường trực tiếp — `POST /departments/:id/members` → 201 · GLOBAL only

```jsonc
{ "userId": "7d47b2ac-…" }    // CHỈ userId
```

Đây là **TRANSFER**, không phải "add":

* **đích** = phòng trên URL
* **nguồn** = phòng người đó đang ở, đọc từ database
* body chỉ nói *ai*

Không có `ADD_MEMBER`, và không có endpoint "gỡ khỏi phòng" — người active luôn
thuộc đúng một phòng.

Gửi thêm `departmentId`, `toDepartmentId`, `sourceDepartmentId`, `role`,
`permissions` trong body: các field đó bị **strip im lặng**, không đổi được gì và
cũng không báo lỗi. Đừng gửi.

### Đường của HEAD — request + approve (§10)

HEAD gọi `POST /departments/:id/members` → **403**.

---

## 8. Remove flow

`REMOVE_MEMBER` **là offboarding khỏi Backoffice**, không phải gỡ khỏi phòng.

Duyệt một `REMOVE_MEMBER` làm đúng những gì `PATCH /users/:id/status` làm: kết
thúc membership, thu hồi role, huỷ session, disable account — trong một
transaction.

**Copy trên UI phải nói đúng điều đó.** Nút ghi "Xoá khỏi phòng" là mô tả sai
một hành động không đảo ngược được.

Hai đường:

| Ai | Đường |
|---|---|
| SUPERADMIN | `PATCH /users/:id/status {"status":"disabled"}` — hiệu lực ngay |
| HEAD | `POST /departments/:id/membership-requests` với `action: "REMOVE_MEMBER"` → chờ duyệt |

---

## 9. Account invitation flow

Người **chưa có account**. HEAD mời, SUPERADMIN duyệt, và account chỉ tồn tại
lúc duyệt.

| Endpoint | Ai | Thành công |
|---|---|---|
| `POST /departments/:id/account-invitations` | HEAD phòng đó, hoặc GLOBAL | 201 |
| `GET /departments/:id/account-invitations` | như trên | 200 |
| `GET /account-invitations` | GLOBAL | 200 |
| `POST /account-invitations/:id/approve` | GLOBAL | **201** |
| `POST /account-invitations/:id/reject` | GLOBAL | 200 |

```jsonc
// POST /departments/:id/account-invitations
{ "email": "newcomer@example.com", "reason": "tuyển mới" }   // reason tuỳ chọn

// 201
{
  "id": "…", "departmentId": "7ce2630e-…", "email": "newcomer@example.com",
  "status": "pending", "requestedBy": "fab71f53-…",
  "requestedAt": "2026-08-18T08:34:20.114Z",
  "decidedBy": null, "decidedAt": null, "reason": null, "createdUserId": null
}
```

Khi `pending`: **chưa có** user, identity, credential, membership nào.

```jsonc
// POST /account-invitations/:id/approve — body TUỲ CHỌN
{ "displayName": "New Comer" }

// 201
{
  "invitation": { "…": "…", "status": "approved", "createdUserId": "d68579df-…" },
  "username": "newcomer",
  "temporaryPassword": "…"           // ← chỉ ở đây, chỉ lần này
}
```

Duyệt trả **201** (không phải 200) vì nó **tạo ra một account**. Gọi approve
không kèm body là hợp lệ.

Người mới vào **đúng phòng của HEAD đã mời**.

`GET /account-invitations` trả `{ "items": [], "nextCursor": null, "hasMore": false }`
khi không có gì chờ duyệt — **rỗng là một trang, không phải lỗi**.

Mỗi invitation trong `items` kèm `requestedByUser` (§5b) bên cạnh `requestedBy`.
`email` vẫn là địa chỉ được mời và **không bao giờ** được dùng thay tên hiển thị.
Không có `decidedByUser` hay `createdUser`.

---

## 10. Approval / rejection flow

Membership change request: **HEAD đề xuất, SUPERADMIN quyết**.

| Endpoint | Ai | Thành công |
|---|---|---|
| `POST /departments/:id/membership-requests` | HEAD phòng đó, hoặc GLOBAL | 201 |
| `GET /departments/:id/membership-requests` | như trên | 200 |
| `GET /membership-requests` | GLOBAL | 200 |
| `POST /membership-requests/:id/approve` | GLOBAL | **200** |
| `POST /membership-requests/:id/reject` | GLOBAL | 200 |

⚠️ **Field là `userId`, không phải `targetUserId`.** Response trả về
`targetUserId` — request nhận `userId`. Hai tên khác nhau, và đây là chỗ dễ sai
nhất trong toàn bộ API.

```jsonc
// POST /departments/:id/membership-requests
{
  "userId": "7d47b2ac-…",                 // ← request dùng tên này
  "action": "TRANSFER_MEMBER",            // TRANSFER_MEMBER | REMOVE_MEMBER
  "targetDepartmentId": "60630e75-…",     // bắt buộc cho TRANSFER, cấm cho REMOVE
  "reason": "…"                           // tuỳ chọn
}
```

```jsonc
// POST → 201 trả THẲNG object dưới đây (không có envelope).
// GET /membership-requests — 200 trả envelope { items, nextCursor, hasMore }.
{
  "id": "f6d42eed-…",
  "departmentId": "60630e75-…",        // NGUỒN — server suy ra, không nhận từ client
  "targetDepartmentId": null,          // ĐÍCH — chỉ transfer mới có
  "targetUserId": "7d47b2ac-…",        // ← response dùng tên này
  "targetUser":      { "id": "7d47b2ac-…", "displayName": "Moved Person" },  // ← mới
  "action": "REMOVE_MEMBER",
  "status": "pending",                 // pending | approved | rejected
  "requestedBy": "8b18fa79-…",
  "requestedByUser": { "id": "8b18fa79-…", "displayName": "Head Person" },   // ← mới
  "requestedAt": "2026-08-18T08:34:23.633Z",
  "decidedBy": null, "decidedAt": null, "reason": null
  // KHÔNG có decidedByUser — xem §5b
}
```

⚠️ Hai sibling chỉ có trên **danh sách**. `POST` tạo request trả shape cũ,
không kèm tên: người gọi vừa tự đặt các id đó nên server không đi join lại.

Ba giá trị, ba nguồn:

| Giá trị | Đến từ |
|---|---|
| route department | **URL** — phòng HEAD quản lý |
| source department | **DATABASE** — membership hiện tại của target |
| target department | **body** `targetDepartmentId` |

Approve trả **200**: không tạo resource nào, chỉ chuyển một membership hoặc đóng
một account.

**HEAD không duyệt được gì**, kể cả request của chính mình → 403. Hai lớp độc lập
nói điều đó: permission, và CHECK `decided_by <> requested_by` ở database.

Mọi giá trị được **đọc lại lúc duyệt**. Request tạo thứ Hai có thể được duyệt thứ
Sáu, và trong khoảng đó target có thể đã chuyển phòng, đã bị disable, hoặc người
đề xuất đã thôi làm HEAD → **409**.

---

## 11. Error codes

Mọi lỗi đều cùng một hình dạng:

```jsonc
{ "error": { "code": "…", "message": "…", "details": { "field": "…" } } }
```

`code` để `switch`. `message` để hiện. `details` chỉ có ở `VALIDATION_FAILED`.

| HTTP | `code` | Nghĩa | Frontend làm gì |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | chưa/hết đăng nhập | về màn login |
| 403 | `FORBIDDEN` | không được phép | đăng nhập lại **không** giúp gì |
| 403 | `PASSWORD_CHANGE_REQUIRED` | credential còn tạm | → màn đổi mật khẩu (§12) |
| 404 | `NOT_FOUND` | không có | |
| 409 | `CONFLICT` | trạng thái đã đổi | **tải lại rồi thử lại**, không retry mù |
| 422 | `VALIDATION_FAILED` | body sai | map `details` vào field |
| 429 | `TOO_MANY_ATTEMPTS` | quá nhiều lần login | tôn trọng `Retry-After` |

⚠️ **Hai mã 403 khác nhau.** Phân biệt bằng `code`, không bằng `message`.

```jsonc
// 422
{ "error": { "code": "VALIDATION_FAILED", "message": "Request failed validation.",
             "details": { "subject": "Required" } } }
```

### ⚠️ Hai hình dạng lỗi, không phải một

Envelope ở trên là của **lỗi nghiệp vụ** — thứ backend chủ động ném ra. Lỗi do
framework sinh (URL không khớp route nào, method sai, body không phải JSON) giữ
hình dạng mặc định của Nest:

```jsonc
// GET /nope — 404
{ "message": "Cannot GET /nope", "error": "Not Found", "statusCode": 404 }
```

Ở đây `error` là **string**, không phải object — nên `body.error.code` là
`undefined`. Interceptor của frontend phải chịu được cả hai:

```ts
const code = typeof body?.error === 'object' ? body.error.code : undefined;
// code === undefined  →  lỗi không thuộc nghiệp vụ: log rồi hiện thông báo chung
```

Gặp hình dạng thứ hai ở một endpoint có thật gần như luôn nghĩa là **URL sai** —
kiểm lại đường dẫn trước khi nghi ngờ backend.

### 409 hay gặp

| Tình huống | Endpoint |
|---|---|
| email đã có account (kể cả disabled) | invitation create |
| đã có invitation pending cho email đó (bất kể phòng nào) | invitation create |
| request/invitation đã được người khác quyết | approve · reject |
| tự quyết request của mình | approve · reject |
| target đã chuyển phòng / bị disable từ lúc đề xuất | approve |
| archive phòng còn người | department archive |
| disable SuperAdmin cuối cùng | user status |

---

## 12. `must_change_secret` behavior

Account được cấp credential tạm — qua `POST /users` hoặc qua duyệt invitation —
**chưa hoàn tất provisioning**. Người đó:

| Được | Không được |
|---|---|
| `POST /auth/login` | mọi endpoint khác |
| `GET /auth/me` | |
| `POST /auth/password` | |
| `POST /auth/logout` | |

Mọi endpoint khác — **kể cả `GET /authorization/me`** — trả:

```jsonc
// 403
{ "error": { "code": "PASSWORD_CHANGE_REQUIRED",
             "message": "Password change required before using this deployment." } }
```

### Trình tự bắt buộc của frontend

```text
POST /auth/login              → 200
GET  /authorization/me
   ├─ 200                     → vào app bình thường
   └─ 403 PASSWORD_CHANGE_REQUIRED
        → màn đổi mật khẩu (dữ liệu hiển thị lấy từ GET /auth/me)
        → POST /auth/password → 204, MỌI session chết
        → về màn login
        → đăng nhập lại bằng mật khẩu mới
```

Không có cờ nào trong `/auth/me` báo trạng thái này. **Mã 403 là tín hiệu duy
nhất**, và đó là lý do nó có `code` riêng.

Trạng thái này là một trạng thái phiên hợp lệ, không phải hết phiên — cách mô
hình hoá nó ở một chỗ duy nhất nằm ở §3b.

---

## 13. `temporaryPassword` behavior

Chỉ tồn tại ở **một** response: `POST /account-invitations/:id/approve`.

Không có ở: list, detail, `/auth/me`, `/authorization/me`, response của reject,
response 409 của approve lần hai. **Không cột nào trong database chứa nó** — chỉ
có hash.

| Frontend PHẢI | Frontend KHÔNG ĐƯỢC |
|---|---|
| hiện ngay, một lần, kèm cảnh báo không lấy lại được | ghi vào `localStorage`/`sessionStorage` |
| để người duyệt copy và tự chuyển cho người mới | log ra console, gửi analytics |
| coi việc rời màn hình là mất vĩnh viễn | đưa vào URL, query string, title |

Approve lần hai → **409**, không có password trong response. Mất rồi thì không có
endpoint "xem lại".

**Hạn chế đã biết:** plaintext đi qua browser của người duyệt. Deployment này cố
ý chưa có email adapter, nên người duyệt là kênh giao duy nhất.

### Hai chính sách mật khẩu

| | Tối thiểu | Ai đặt | Khi nào |
|---|---|---|---|
| **tạm** | 8 ký tự | SUPERADMIN, hoặc server sinh ra | lúc tạo account / duyệt invitation |
| **vĩnh viễn** | 12 ký tự | chính người dùng | ở `POST /auth/password` |

Ngưỡng tạm thấp hơn là **cố ý**: mật khẩu tạm được đọc cho nhau nghe, mỗi người
một cái khác nhau, và nó không mở được gì ngoài màn đổi mật khẩu. Frontend phải
dùng đúng ngưỡng ở đúng form — bắt 12 ký tự ở form tạo nhân sự sẽ chặn những giá
trị mà backend chấp nhận.

Form đổi mật khẩu **phải** validate 12 ký tự phía client để báo lỗi sớm, nhưng
server vẫn là nơi quyết định: gửi mật khẩu ngắn → **422**.

---

## 14. Role / permission matrix

Ba role. `MEMBER` là **sự vắng mặt** của role row, không phải một giá trị được
lưu.

| Permission | SUPERADMIN | DEPARTMENT_HEAD | MEMBER |
|---|---|---|---|
| `unit.read` | mọi phòng | phòng của mình | phòng của mình |
| `unit.member.read` | mọi phòng | **phòng mình quản lý** | ✗ |
| `unit.write` | ✓ | ✗ | ✗ |
| `unit.member.write` | ✓ | ✗ | ✗ |
| `role.assign` | ✓ | ✗ | ✗ |
| `user.write` | ✓ | ✗ | ✗ |

Server quyết theo **quan hệ** (`headOf`, `memberOf`), không theo role. Role chỉ
là nhãn suy ra để hiển thị.

### HEAD dứt khoát KHÔNG có

* `POST /users` — tạo account
* `PATCH /users/:id/status` — offboard
* `POST /departments/:id/members` — chuyển phòng trực tiếp
* `GET` · `POST` · `DELETE /departments/:id/head` — kể cả phòng mình quản lý
* `POST /departments` · `PATCH` · `archive`
* `GET /departments` — danh sách toàn hệ thống
* approve/reject bất cứ thứ gì, kể cả request của chính mình
* gán/thu hồi role

HEAD chỉ **đề xuất**: membership request và account invitation.

### SUPERADMIN

* GLOBAL, **không** bị scope vào phòng nào — `departmentIds` luôn rỗng
* mọi permission, mọi phòng, kể cả phòng chưa tồn tại
* trực tiếp: tạo user · gán phòng · transfer · offboard · bổ nhiệm/bãi nhiệm
  trưởng phòng · approve/reject
* **không** tự duyệt request của chính mình (409)
* SuperAdmin cuối cùng không disable được (409)

---

## 15. Department scope rules

**Scope luôn nằm trên URL, không bao giờ trong body.**

```text
POST /departments/:departmentId/membership-requests
                  ^^^^^^^^^^^^^ phòng HEAD quản lý — server kiểm cái này
```

Không DTO nào nhận `departmentId` như một field quyết định phạm vi. Body có gửi
thì bị strip.

| Loại | Ý nghĩa |
|---|---|
| route param | phòng caller phải có thẩm quyền — luôn được kiểm |
| `targetDepartmentId` (body) | dữ liệu nghiệp vụ: chuyển ĐI ĐÂU |
| source department | **không bao giờ** từ client — đọc từ database |

Đổi id trên URL sang phòng khác → **403**, không phải 404: không có IDOR.

---

## 15b. Department head API

Bổ nhiệm và bãi nhiệm trưởng phòng. **GLOBAL only** (`role.assign`) — HEAD
không gọi được route nào ở đây, kể cả route đọc.

| Endpoint | Thành công |
|---|---|
| `GET /departments/:departmentId/head` | 200, hoặc **404** nếu phòng chưa có trưởng phòng |
| `POST /departments/:departmentId/head` | 201 |
| `DELETE /departments/:departmentId/head` | 200 |

```jsonc
// POST /departments/:departmentId/head
{ "userId": "fab71f53-…" }        // CHỈ userId — phòng lấy từ URL

// 201 · 200 — assign, revoke và read dùng chung hình dạng này
{
  "assignmentId": "…",
  "departmentId": "7ce2630e-…",
  "userId": "fab71f53-…",
  "membershipId": "d4b58fd3-…",
  "grantedAt": "2026-01-01T00:00:00.000Z",

  // CHỈ trên GET. assign/revoke trả lời từ đường ghi và KHÔNG có field này:
  // người gọi vừa tự nêu tên user đó, server không join lại để nói lại.
  "user": { "id": "fab71f53-…", "displayName": "Head Person" }
}
```

**Người được bổ nhiệm phải đang là member active của đúng phòng đó** — đây là
invariant #6, được foreign key canh ở database. Bổ nhiệm người ngoài phòng →
**409**.

| Tình huống | Mã |
|---|---|
| người đó không phải member active của phòng | 409 |
| phòng đã có trưởng phòng | 409 — `DELETE` trước rồi `POST` |
| phòng đã archive | 409 |
| phòng chưa có trưởng phòng (`GET`/`DELETE`) | 404 |

**Đổi trưởng phòng = `DELETE` rồi `POST`**, không có một lời gọi "set head":
unique index không cho hai active head cùng lúc, nên hai thao tác không hoán vị
được.

Bãi nhiệm **không phải** cho nghỉ việc: membership giữ nguyên, account vẫn
active, người đó thành member thường. Copy trên UI phải nói đúng vậy.

`DELETE` là mutation → **vẫn cần header CSRF**.

---

## 16. Bootstrap và những gì KHÔNG có endpoint

### Tài khoản đầu tiên

Không có endpoint nào tạo SuperAdmin. Đường duy nhất là CLI trên máy chủ:

```bash
npm run user:create -- --email admin@example.com --name "Root Admin" --superadmin
```

Frontend không có màn hình nào cho việc này, và không nên có.

### Gán / thu hồi DEPARTMENT_HEAD

**Đã có endpoint** — xem §15b. Frontend dựng được màn hình bổ nhiệm trưởng
phòng cho SUPERADMIN.

### Chuyển SUPERADMIN — **chưa có endpoint**

`transferSuperAdmin` đã implement và đã test ở tầng application, nhưng chưa có
route HTTP. Việc chuyển quyền SuperAdmin hiện làm bằng CLI/SQL trên máy chủ.
Frontend **không** dựng màn hình cho việc này — xem §18.

---

## 17. Frontend forbidden assumptions

Danh sách những điều **sai**, kèm chuyện gì thật sự xảy ra:

| Giả định sai | Thực tế |
|---|---|
| "ẩn nút là đủ" | server vẫn là chỗ duy nhất từ chối |
| "login dùng field `email`" | field là **`subject`** → gửi `email` nhận 422 |
| "membership request dùng `targetUserId`" | request dùng **`userId`**; response mới là `targetUserId` |
| "approve luôn trả 200" | invitation approve trả **201** |
| "`GET /departments` ai cũng gọi được" | **GLOBAL only**, HEAD nhận 403 |
| "MEMBER xem được đồng nghiệp cùng phòng" | 403 |
| "một người có thể ở nhiều phòng" | tối đa **một** active membership |
| "`ADD_MEMBER` là một action" | **422** — chỉ có TRANSFER và REMOVE |
| "REMOVE_MEMBER = gỡ khỏi phòng" | = **offboarding khỏi hệ thống** |
| "HEAD tự duyệt được request của mình" | 403 (permission) + CHECK ở DB |
| "có thể lấy lại `temporaryPassword`" | không, ở đâu cũng không |
| "đổi mật khẩu xong dùng tiếp phiên cũ" | mọi session chết, phải đăng nhập lại |
| "`initialPassword` là mật khẩu chính thức" | là mật khẩu **tạm**, bị gate cho tới khi đổi |
| "403 nghĩa là hết phiên" | 403 ≠ 401; xem `code` để phân biệt |
| "gặp `PASSWORD_CHANGE_REQUIRED` thì đăng xuất người dùng" | phiên vẫn sống → đi màn đổi mật khẩu; đá về login là vòng lặp không lối ra (§3b) |
| "`GET /authorization/me` gọi được khi chưa đăng nhập" | **401** — session là điều kiện tiên quyết (§3) |
| "`DELETE` không cần header CSRF" | cần — guard tính theo method, mọi thứ ngoài `GET`/`HEAD`/`OPTIONS` đều phải có (§2) |
| "`POST /auth/login` không cần header CSRF vì chưa có session" | vẫn cần; thiếu → 403 trước cả khi kiểm mật khẩu |
| "retry khi gặp 409" | 409 = trạng thái đã đổi → **tải lại** trước |
| "gửi `role` khi tạo user thì được cấp role" | field bị strip, không có tác dụng |
| "HEAD tự bổ nhiệm được người kế nhiệm" | 403 — `role.assign` là GLOBAL only |
| "đổi trưởng phòng bằng một lời gọi" | `DELETE` rồi `POST` — §15b |
| "mật khẩu tạm phải ≥ 12 ký tự" | tạm cần ≥ 8; **vĩnh viễn** mới cần ≥ 12 |
| "có endpoint bật lại account đã disable" | chưa có — §18 |

---

## 18. Known limitations

| Hạn chế | Ảnh hưởng tới frontend |
|---|---|
| Không có endpoint chuyển SUPERADMIN | không dựng màn hình chuyển quyền; làm bằng CLI/SQL |
| Không có endpoint bật lại account disabled | `PATCH …/status` chỉ nhận `disabled`; `active` → 422 |
| Không có email adapter | `temporaryPassword` giao tay qua người duyệt |
| Không có endpoint đổi `displayName` | không dựng màn hình sửa hồ sơ |
| Không có phân trang trên các list | tất cả list trả toàn bộ; sẽ đổi khi dữ liệu lớn |
| `POST /auth/login` dùng field `subject` | đặt tên biến ở frontend cho khớp, hoặc map ở API client |

---

## 19. Nguồn sự thật

Tài liệu này mô tả hành vi đã được xác minh trên deployment thật. Chi tiết thiết
kế của từng vùng nằm ở README của nó:

| Vùng | README |
|---|---|
| foundation, chiều phụ thuộc | `backend/src/core/README.md` |
| quyết định truy cập | `backend/src/core/authorization/README.md` |
| phòng ban và membership | `backend/src/core/organization/README.md` |
| approval workflow | `backend/src/capabilities/membership-approval/README.md` |
| onboarding | `backend/src/capabilities/account-invitation/README.md` |
| migration | `backend/migrations/README.md` |

Khi tài liệu này và source mâu thuẫn: **source đúng, và tài liệu này là bug.**

---

## 20. API matrix

Toàn bộ bề mặt HTTP của deployment này, một hàng một endpoint. Bảng này là bản
tra cứu; ngữ nghĩa vẫn nằm ở các mục ở trên và không có gì ở đây mở rộng nó.

Bốn luật đúng cho **mọi** hàng, nên không lặp lại trong bảng:

* mọi `POST` · `PATCH` · `DELETE` phải có header `X-Requested-With` — với một
  phiên hợp lệ, thiếu header là **403** (§2);
* mọi endpoint cần session, khi không có session hợp lệ, trả **401
  `UNAUTHORIZED`** (§11);
* mọi endpoint ngoài `/auth/*` và `/health`, khi caller còn credential tạm, trả
  **403 `PASSWORD_CHANGE_REQUIRED`** trước mọi kiểm tra khác (§12);
* lỗi nghiệp vụ luôn là `{ error: { code, message, details? } }`; lỗi framework
  (URL sai route) thì không (§11).

| Method | Path | Auth | Permission | Scope | Thành công | Lỗi hay gặp |
|---|---|---|---|---|---|---|
| `GET` | `/health` | không | — | — | **200**, hoặc **503** khi database không tới được | — |
| `POST` | `/auth/login` | không (header CSRF vẫn bắt buộc) | — | — | **200** + cookie phiên | 401 sai credential · 422 thiếu `subject` · 429 `Retry-After` |
| `GET` | `/auth/me` | session — **kể cả credential tạm** | — | — | **200** | 401 |
| `POST` | `/auth/password` | session — **kể cả credential tạm** | — | — | **204**, mọi session chết | 401 · 422 mật khẩu < 12 ký tự hoặc `currentPassword` sai |
| `POST` | `/auth/logout` | session — **kể cả credential tạm** | — | — | **204** | 401 |
| `GET` | `/authorization/me` | session | — | — | **200** | 401 · **403 `PASSWORD_CHANGE_REQUIRED`** (§3b) |
| `POST` | `/users` | session | `user.write` | GLOBAL | **201** | 403 HEAD · 409 email đã có account · 422 thiếu `departmentId`, mật khẩu < 8 |
| `PATCH` | `/users/:userId/status` | session | `user.write` | GLOBAL | **200** | 403 · 404 user · 409 đã disabled / SuperAdmin cuối cùng · 422 `status` ≠ `disabled` |
| `GET` | `/departments` | session | `unit.read` (**không scope**) | **GLOBAL only** | **200** | 403 với HEAD và MEMBER (§5) |
| `GET` | `/departments/:departmentId` | session | `unit.read` scoped theo route param | member của phòng đó, hoặc GLOBAL | **200** | 403 phòng khác · 404 |
| `POST` | `/departments` | session | `unit.write` | GLOBAL | **201** | 403 · 409 `slug` trùng · 422 |
| `PATCH` | `/departments/:departmentId` | session | `unit.write` | GLOBAL | **200** | 403 · 404 · 409 `slug` trùng · 422 |
| `POST` | `/departments/:departmentId/archive` | session | `unit.write` | GLOBAL | **200** | 403 · 404 · 409 còn người active / đã archive |
| `GET` | `/departments/:departmentId/members` | session | `unit.member.read` scoped theo route param | HEAD của phòng đó, hoặc GLOBAL | **200** | 403 MEMBER thường · 404 |
| `POST` | `/departments/:departmentId/members` | session | `unit.member.write` | GLOBAL | **201** (đây là TRANSFER, §7) | 403 HEAD · 404 phòng/user · 409 đã ở phòng đó / phòng archived / không có membership · 422 |
| `GET` | `/departments/:departmentId/head` | session | `role.assign` | GLOBAL | **200** | 403 · **404 phòng chưa có trưởng phòng** |
| `POST` | `/departments/:departmentId/head` | session | `role.assign` | GLOBAL | **201** | 403 · 404 phòng · 409 đã có head / không phải member active / phòng archived · 422 |
| `DELETE` | `/departments/:departmentId/head` | session | `role.assign` | GLOBAL | **200** | 403 · 404 chưa có head · 409 vừa bị thu hồi song song |
| `POST` | `/departments/:departmentId/account-invitations` | session | `HeadOfRouteDepartmentGuard` | HEAD của phòng **trên URL**, hoặc GLOBAL | **201** | 403 phòng khác · 404 phòng · 409 email đã có account / đã có invitation pending / phòng archived · 422 |
| `GET` | `/departments/:departmentId/account-invitations` | session | `HeadOfRouteDepartmentGuard` | như trên | **200** | 403 · 404 |
| `GET` | `/account-invitations` | session | `user.write` | GLOBAL | **200**, `[]` khi rỗng | 403 |
| `POST` | `/account-invitations/:invitationId/approve` | session | `user.write` | GLOBAL | **201** — tạo account, trả `temporaryPassword` một lần (§13) | 403 · 409 đã quyết / id không tồn tại / tự quyết / email đã có account / người đề xuất thôi làm HEAD / phòng archived |
| `POST` | `/account-invitations/:invitationId/reject` | session | `user.write` | GLOBAL | **200** | 403 · 409 đã quyết / id không tồn tại / tự quyết |
| `POST` | `/departments/:departmentId/membership-requests` | session | `HeadOfRouteDepartmentGuard` | HEAD của phòng **trên URL**, hoặc GLOBAL | **201** | 403 phòng khác · 404 user/phòng đích · 409 target không active / khác phòng / đã có request trùng / phòng đích archived · 422 `action` sai, thiếu `targetDepartmentId` |
| `GET` | `/departments/:departmentId/membership-requests` | session | `HeadOfRouteDepartmentGuard` | như trên | **200** | 403 · 404 |
| `GET` | `/membership-requests` | session | `unit.member.write` | GLOBAL | **200**, `[]` khi rỗng | 403 |
| `POST` | `/membership-requests/:requestId/approve` | session | `unit.member.write` | GLOBAL | **200** — không tạo resource (§10) | 403 HEAD · 404 target user · 409 đã quyết / id không tồn tại / tự quyết / target đã chuyển phòng hoặc bị disable / người đề xuất thôi làm HEAD |
| `POST` | `/membership-requests/:requestId/reject` | session | `unit.member.write` | GLOBAL | **200** | 403 · 409 đã quyết / id không tồn tại / tự quyết |

Hai chi tiết dễ đọc nhầm khỏi bảng:

* **approve/reject với id không tồn tại trả 409, không phải 404.** Cùng một mã
  với "đã được người khác quyết" — từ ngoài nhìn vào, cả hai đều là "request này
  không còn chờ duyệt", và đó là câu trả lời cố ý.
* **`Permission` không phải quyền của caller trên phòng nào đó.** Nó là key mà
  `PermissionGuard` đòi; cột `Scope` mới nói key đó được kiểm trên phạm vi nào
  (§15).

