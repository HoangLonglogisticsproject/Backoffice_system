# `core/organization/` — đơn vị tổ chức và ai thuộc đơn vị nào

## Bất biến trung tâm

```text
active user  ⇒  ĐÚNG MỘT active membership
disabled user ⇒  KHÔNG có active membership (lịch sử vẫn còn)

HỢP LỆ:      disabled + không thuộc phòng nào
BẤT HỢP LỆ:  active   + không thuộc phòng nào
```

Ngoại lệ duy nhất: người giữ role GLOBAL (SuperAdmin) đứng **trên** department, nên
họ không cần membership. Nếu không có ngoại lệ này thì SuperAdmin đầu tiên không thể
tồn tại — lúc bootstrap chưa có department nào.

Bất biến được canh **hai nơi, và chỉ một nơi là database**:

| Nửa | Canh bởi | Cơ chế |
|---|---|---|
| tối đa 1 | **DATABASE** | `uq_single_active_membership` — partial unique index trên `(user_id) WHERE status='active'` |
| ít nhất 1 | **SERVICE** | Không ràng buộc SQL nào diễn đạt được "phải tồn tại row ở bảng khác". Service không có method nào để lại user không có phòng |

Nửa thứ hai là lý do `MembershipService` **không có** `remove` hay `end`. Rời phòng
nghĩa là rời tổ chức, và đó là thay đổi vòng đời tài khoản (disable user) — không
phải sửa sơ đồ tổ chức. Có một test khẳng định đúng điều đó, để ai thêm method sẽ
thấy nó đỏ.

## Use case

**Hai aggregate, hai service, hai repository.** Đơn vị được đổi tên và archive;
membership được mở và đóng. Tách ra là thứ ngăn một class sở hữu cả hai rồi dần
thành file không ai muốn đụng.

| Use case | Ở đâu | Transaction làm gì |
|---|---|---|
| `CreateDepartment` | `DepartmentService.create` | insert; unique index là chốt chặn cho race |
| `RenameDepartment` | `DepartmentService.rename` | chỉ đổi `name`; `slug` bất biến vì thứ khác trỏ vào nó |
| `ArchiveDepartment` | `DepartmentService.archive` | lock unit → đếm member → archive. **409 nếu còn member** |
| `EnrollMember` | `MembershipService.enroll` | cho người **chưa** thuộc phòng nào |
| `TransferMembership` | `MembershipService.transfer` | **end phòng cũ → tạo phòng mới**, một transaction |

`MembershipService.enroll` nhận `tx` tuỳ chọn: Phase 3 và Phase 5 phải tạo account và
membership **cùng một transaction**, nếu không sẽ lộ ra đúng trạng thái bị cấm ở
giữa hai lời gọi.

**Không có `ADD_MEMBER`.** Một người active luôn thuộc một phòng, nên đưa họ vào
phòng này nghĩa là lấy họ ra khỏi phòng đang ở — đó là *transfer*.
`MembershipService.enroll` chỉ dành cho người **chưa** có phòng nào.

### Canonical transfer semantics — ba giá trị, ba nguồn

| Giá trị | Đến từ | Trả lời |
|---|---|---|
| route department | **route param** | "anh có quyền đề xuất không" — scope của HEAD |
| source department | **DATABASE** — active membership của target user | "X đang ở đâu" |
| target department | **body** `targetDepartmentId` | "muốn chuyển X đi đâu" |

Gộp source vào route sẽ hỏng ở trường hợp HEAD B kéo người từ phòng A về B: route
là B, source là A. Đọc source từ DB gỡ được điều đó và giữ đúng nguyên tắc không
tin client.

`POST /departments/:departmentId/members` (SUPERADMIN, trực tiếp) là dạng rút gọn
của đúng luật đó: route = đích, source đọc từ DB, không có approval. HEAD không
gọi được endpoint này — đường của họ là request mà SUPERADMIN duyệt (Phase 4).

## Đọc một flow từ đầu tới cuối

Ví dụ `TransferMembership`:

```text
POST /departments/:departmentId/members        api/organization.controller
  ↓  AuthGuard → CsrfGuard → PermissionGuard('unit.member.write')
MembershipService.transfer({ userId, toDepartmentId })      application/
  ↓  db.transaction()                  ← TRANSACTION BẮT ĐẦU Ở ĐÂY, tầng application
  ├─ departments.findById(target, tx)  → NotFoundError · ConflictError nếu archived
  ├─ memberships.lockActiveForUser(tx) → SELECT … FOR UPDATE
  │                                    → ConflictError nếu chưa thuộc phòng nào
  │                                    → ConflictError nếu đã ở đúng phòng đó
  ├─ memberships.end(current.id, tx)   ← PHẢI trước
  └─ memberships.create(target, tx)    ← đảo thứ tự: 23505 → rollback
  ↓                                       persistence/ — chỉ SQL, KHÔNG mở transaction
DomainError → domain-error.filter.ts → HTTP status
```

Thứ tự end-trước-create không phải quy ước: làm ngược lại va vào
`uq_single_active_membership` và transaction rollback. Database ép đúng thứ tự nên
không ai phải nhớ.

## Entry points

| Endpoint | Permission | Ai |
|---|---|---|
| `GET /departments` | `unit.read` (không scope) | chỉ GLOBAL |
| `GET /departments/:id` | `unit.read` scoped | GLOBAL · HEAD · MEMBER của phòng đó |
| `POST` · `PATCH` · `POST /:id/archive` | `unit.write` | chỉ GLOBAL |
| `GET /:id/members` | `unit.member.read` scoped | GLOBAL · HEAD của phòng đó |
| `POST /:id/members` (transfer) | `unit.member.write` | chỉ GLOBAL |

Controller tới cùng lúc với guard bảo vệ nó (Phase 2), cố ý không sớm hơn.

## Không sở hữu — đọc kỹ mục này trước khi thêm code

**Organization không quyết định "ai được làm gì".** Nó chỉ quản lý ba sự thật:

```text
ai đang thuộc department nào
department nào đang active
membership nào đang active
```

Câu hỏi *"người này có được truy cập department/resource này không?"* thuộc
`core/authorization/`. Nếu một hàm ở context này bắt đầu nhận `role` hay
`permission` làm tham số, nó đã đi lạc.

Cũng không sở hữu: role assignment, session, credential, account lifecycle.
Context này **không đọc** `role_assignments` — authorization sở hữu bảng đó, và
đọc ngược lại membership qua repository của context này.

## forwardRef organization ↔ authorization — vì sao còn, và khi nào gỡ

```text
authorization → organization   ĐÚNG chiều: quyết định truy cập cần biết sự thật
                               tổ chức (invariant #6: HEAD phải là member)

organization  → authorization  chỉ vì CONTROLLER cần PermissionGuard
```

Chiều thứ hai không phải phụ thuộc kiến trúc — nó là wiring HTTP. Ba cách gỡ đều
đắt hơn giá trị thu được ở phase này:

| Cách | Vì sao chưa làm |
|---|---|
| Authorization tự query membership | Nhân đôi SQL, phá "organization sở hữu membership facts" |
| Port `OrganizationReader` | Abstraction chỉ có một implementation, cho một điểm gọi — trái nguyên tắc "chỉ trừu tượng khi có ≥2 nhu cầu thật" |
| Đưa controller ra module composition riêng | Tách controller khỏi context của nó, đổi cohesion lấy một dòng `forwardRef` |

Nên: **giữ, ghi lại, và chặn nó lan rộng.** `B12` fail nếu có `forwardRef` thứ ba
xuất hiện ở bất kỳ module nào.

**Điều kiện để refactor:** khi một context thứ ba cần cycle, hoặc khi
`authorization` cần nhiều hơn 2 method của organization. Lúc đó port có ≥2 lý do
tồn tại và trở thành lựa chọn rẻ hơn.

## Ranh giới

`core/` không import `capabilities/`, không import `infrastructure/`. Repository
chỉ phụ thuộc port `DATABASE` — nó không biết PostgreSQL nằm sau, và
`isUniqueViolation` đọc SQLSTATE `23505` như một property thay vì import từ `pg`.

Mọi method của repository nhận `executor` tuỳ chọn, và **không repository nào tự mở
transaction** (`B11` canh). Transaction boundary thuộc tầng application: chỉ nó biết
những lệnh ghi nào phải cùng thành công. `Database.transaction()` đưa cho callback
một connection *khác*, nên repository luôn dùng `this.db` sẽ chạy trên pool và
commit độc lập — partial commit không nhìn thấy được cho tới khi nó xảy ra trên
production.

## Test

| File | Chứng minh | Cần PostgreSQL |
|---|---|---|
| `api/organization.security.spec.ts` | 32 test qua HTTP: mỗi route từ cả bốn vị thế, IDOR trên route param, spoof body, CSRF | không |
| `application/department.service.spec.ts` | luật vòng đời đơn vị: conflict nào, thứ tự nào | không |
| `application/membership.service.spec.ts` | luật membership + khẳng định service **không** có method rời phòng | không |
| `persistence/organization.integration.spec.ts` | điều PostgreSQL làm: unique index dưới tranh chấp thật, transfer nguyên tử, CHECK trạng thái, archive dưới lock | **có** |
| `../../../migrations/organization-schema.spec.ts` | hình dạng migration: index, CHECK, không cascade, không seed | không |

```bash
DATABASE_URL_TEST=postgres://user:pass@localhost:5432/backoffice_itest npm test
```

Integration suite **tự skip** khi thiếu biến đó. Một invariant chỉ được canh bởi
test đang skip là một invariant chưa được canh — đừng báo PASS khi nó skip.

Suite này chiếm schema riêng `organization_itest`, **không** dùng `public`:
`migration-runner.integration.spec.ts` drop `public` giữa các case và Jest chạy
song song. Integration suite mới nên chiếm schema riêng theo cùng cách.

## Frontend integration contract

| Endpoint | Ai gọi được | Ghi chú cho frontend |
|---|---|---|
| `GET /departments` | **chỉ GLOBAL** | HEAD/MEMBER nhận **403**. Đừng dùng nó để dựng menu — lấy id từ `/authorization/me` rồi gọi endpoint dưới |
| `GET /departments/:id` | member của phòng đó, hoặc GLOBAL | |
| `GET /departments/:id/members` | **HEAD** của phòng đó, hoặc GLOBAL | member thường nhận 403 kể cả với phòng của chính mình — đây là mặc định đã chốt |
| `POST /departments` · `PATCH /departments/:id` · `POST /departments/:id/archive` | GLOBAL | 201 · 200 · 200 |
| `POST /departments/:id/members` | **GLOBAL** | đây là **TRANSFER**, không phải "add". HEAD nhận 403 và phải đi đường approval |

`departmentId` **luôn nằm trên URL**, không bao giờ trong body. Body có thêm
`departmentId` thì field đó bị strip — nó không đổi được mục tiêu, và cũng không
báo lỗi. Đừng gửi.

Transfer chỉ nhận `{ userId }`: phòng **đích** là phòng trên URL, phòng **nguồn**
là phòng người đó đang ở, đọc từ database. Frontend không gửi nguồn.

Archive một phòng còn người → **409**. Muốn archive thì chuyển hết người đi trước;
UI nên nói vậy thay vì retry.
