# `core/` — Backoffice Foundation

Thứ **mọi** Backoffice cần, không phụ thuộc doanh nghiệp nào.

```
core/
├── identity/        ai đang gọi · login · session · CSRF · throttle
├── users/           user và credential của họ
├── organization/    đơn vị tổ chức · ai thuộc đơn vị nào
└── authorization/   ai được làm gì · guard · authorization context
```

Mỗi context cắt theo **tầng trách nhiệm**, không theo loại file:

```
<context>/
├── api/           controller · DTO/schema · guard · HTTP mapping
├── application/   use case · TRANSACTION BOUNDARY · điều phối
├── domain/        model · invariant · luật thuần — không Nest, không pg
├── persistence/   repository · SQL · mapping — nhận executor, KHÔNG mở transaction
└── <context>.module.ts
```

Folder chỉ tồn tại khi có nội dung thật. `users/` không có `api/` vì chưa có
HTTP; nó có `cli/` vì entry point của nó là dòng lệnh.

## `infrastructure` nghĩa là gì trong repo này

Đúng **một** nghĩa, và đó là lý do chỉ có một thư mục mang tên đó:

| Đường dẫn | Trả lời câu hỏi |
|---|---|
| `src/infrastructure/` | *hệ thống dùng hạ tầng kỹ thuật gì?* — driver database, migration runner, adapter |
| `core/<context>/persistence/` | *context này đọc/ghi dữ liệu của nó thế nào?* |

**Không tạo `core/*/infrastructure/`.** Hai thư mục cùng tên ở hai scope khác nhau
là cách nhanh nhất để từ "infrastructure" mất nghĩa. `B8` canh điều này.

Đúng bốn thư mục, và đó là toàn bộ những gì tồn tại hôm nay. Danh sách này mô tả
source, không mô tả kế hoạch — một README liệt kê module chưa viết như thể đã có
là README khiến người đọc đi tìm thứ không tồn tại.

`organization/` và `authorization/` đều có `README.md` riêng: bất biến của chúng
chỉ được database canh một phần, và phần còn lại giải thích vì sao service được
viết như hiện tại.

## Ai sở hữu cái gì

Bốn context, bốn loại sự thật khác nhau. Đọc bảng này trước khi đặt file mới ở đâu:

| Context | Sở hữu | Trả lời câu hỏi |
|---|---|---|
| `identity/` | **authentication facts** — identity, credential, session, password | *ai đang gọi, và họ đã chứng minh thế nào?* |
| `organization/` | **organizational facts** — department, membership, vòng đời của cả hai | *người này đang thuộc đơn vị nào?* |
| `authorization/` | **access decisions** — role key, permission key, scope, context, `can()`, guard | *người này có được làm việc này không?* |
| `capabilities/*` | **business workflow** — approval, invitation, chính sách của một khách hàng | *quy trình của công ty này chạy ra sao?* |

Hai capability đã tồn tại: `membership-approval` và `account-invitation`. Xem
`src/capabilities/README.md` — phép thử của một capability là **xoá được cả thư
mục cùng migration của nó mà hệ thống vẫn chạy**.

Ranh giới quan trọng nhất trong bảng này:

```text
organization = FACTS          (ai đang ở đâu)
authorization = DECISIONS     (ai được làm gì)
```

`organization` **không** quyết định "ai được truy cập gì" — nó chỉ biết ai đang
thuộc phòng nào và phòng nào còn active. `authorization` mới trả lời câu hỏi truy
cập, và nó **đọc** organizational facts để làm việc đó.

Không để:

* `organization` chứa authorization policy
* `authorization` chứa business workflow
* `capability` chứa authentication logic
* `identity` chứa organization policy

### Chiều phụ thuộc

```text
capability ──→ users ──→ organization ──→ (DATABASE port)
     │           │            │
     │           └──→ identity ◄──── authorization ──→ organization
     └──→ authorization
```

Đọc theo luật thay vì theo mũi tên: **capability gọi core, core không bao giờ gọi
capability** (`B1`). Trong core, `users` điều phối hai transaction xuyên context
(provisioning, disable) nên nó biết `identity`, `organization` và `authorization`;
ba context đó không biết `users`.

`authorization → organization` là chiều **đúng**: quyết định truy cập cần biết sự
thật tổ chức. Chiều ngược lại không tồn tại ở tầng file.

Có đúng **một** ngoại lệ ở tầng module, và nó được ghi lại chứ không giấu: xem
`organization/README.md` mục *forwardRef*. `B12` canh cho ngoại lệ đó không lan
sang context thứ ba.

## Ba luật

**1. `core/` không bao giờ import `capabilities/`.**
Chiều ngược lại thì được. Core mà biết tên một capability là core đã hỏng.

**2. `core/` không bao giờ import `infrastructure/`.**
Core định nghĩa **port** (interface); `infrastructure/` viết **adapter**; `app.module.ts`
đấu dây. Nếu `core/identity` import `infrastructure/auth`, thì đổi từ mật khẩu sang
OIDC phải mổ vào foundation — đúng thứ ranh giới này sinh ra để ngăn.

**3. Không từ vựng nghiệp vụ.**
Không customer, order, product, invoice, shipment. Không tên phòng ban. Không tên
vai trò của một công ty cụ thể. Những thứ đó là dữ liệu hoặc capability.

## Chưa có ở đây

Phân quyền, đơn vị tổ chức, vai trò, quyền hạn, audit. Chúng không bị bỏ quên —
chúng chưa được yêu cầu, và foundation phải trả lời được "ai đang gọi" mà không
cần bất kỳ thứ nào trong số đó.

Khi một trong chúng xuất hiện, nó là một thư mục mới ở đây, và ba luật trên áp
dụng cho nó y như với `identity/`.

## Frontend integration contract

Frontend **chỉ tiêu thụ API**. Nó không phải một lớp bảo mật thứ hai, và không
được viết như thể là một.

| Frontend KHÔNG làm | Vì sao |
|---|---|
| tự quyết caller được làm gì | quyết định nằm ở `PermissionGuard`, chạy lại trên **mọi** request |
| suy ra role / department từ dữ liệu tự có | `GET /authorization/me` là nguồn duy nhất, và nó được tính lại server-side mỗi lần gọi |
| tách username từ email | `username` đã có sẵn trong `/authorization/me`; parse lại là hai luật cho một giá trị |
| gọi thẳng endpoint core để đi vòng approval | `POST /users` và `POST /departments/:id/members` là GLOBAL-only, HEAD nhận 403 |
| đọc `permissions[]` rồi coi đó là quyền | đó là **gợi ý render**. Ẩn nút là tiện lợi, không bao giờ là kiểm soát |

Ẩn một nút vì `permissions[]` không chứa key tương ứng là đúng. Tin rằng nút bị
ẩn nghĩa là hành động không xảy ra được là sai — server vẫn là chỗ duy nhất từ
chối.

### Giao thức chung cho mọi endpoint

| Thứ | Giá trị |
|---|---|
| Session | cookie `HttpOnly`, trình duyệt tự gửi. Không có token nào cho JS đọc |
| CSRF | mọi mutation — `POST` · `PATCH` · `DELETE` — phải có header `X-Requested-With: XMLHttpRequest`; thiếu → **403**. `GET` · `HEAD` · `OPTIONS` không cần |
| Lỗi | luôn là `{ "error": { "code", "message", "details?" } }` — `code` là thứ để switch, `message` là thứ để hiện |
| 401 | phải đăng nhập lại |
| 403 `FORBIDDEN` | đăng nhập lại không giúp gì |
| 403 `PASSWORD_CHANGE_REQUIRED` | credential tạm chưa đổi → điều hướng sang màn đổi mật khẩu |
| 409 `CONFLICT` | trạng thái đã đổi → **tải lại rồi thử lại**, không retry mù |
| 422 `VALIDATION_FAILED` | `details` là map `field → message` |
| 429 `TOO_MANY_ATTEMPTS` | tôn trọng header `Retry-After` |

### Trình tự khởi động

```text
POST /auth/login            → 200, cookie được set
GET  /auth/me               → user tối thiểu (id, displayName, status)
GET  /authorization/me      → 200: role · departmentIds · permissions · username
                              403 PASSWORD_CHANGE_REQUIRED: đi đổi mật khẩu trước
POST /auth/password         → 204, MỌI session chết, kể cả session hiện tại
                              → phải đăng nhập lại
```

Bốn endpoint `auth/login`, `auth/logout`, `auth/me`, `auth/password` là những
route **duy nhất** dùng được khi credential còn tạm. Mọi route khác trả 403 với
code ở trên.
