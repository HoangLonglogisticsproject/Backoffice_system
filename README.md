# Hoàng Long Logistics — Backoffice

## 1. Repo này là gì

Hệ thống backoffice của **Hoàng Long Logistics**, dựng trên một phần nền dùng lại
được cho nhiều dự án.

Hai thứ nằm trong cùng một repository, và ranh giới giữa chúng là điều quan trọng
nhất cần hiểu trước khi thêm code:

- **Foundation** — danh tính, đăng nhập, phiên làm việc, đơn vị tổ chức, phân
  quyền. Không mang từ vựng của khách hàng nào. Dự án sau fork và dùng lại nguyên si.
- **Project** — nghiệp vụ của Hoàng Long: lịch xe, chi phí chuyến, thuê xe ngoài.
  Một deployment khác xoá cả thư mục này và không bao giờ biết đến xe tải.

Repo chứa **hai tiến trình độc lập**. Chúng chạy song song, ở **hai terminal
riêng** — không phải hai lệnh dán liên tiếp vào cùng một shell:

```bash
# Terminal 1 — frontend
cd frontend && npm run dev    # :4200   React 19 + Vite
```

```bash
# Terminal 2 — backend
cd backend && npm run dev     # :3000   NestJS 11 + PostgreSQL 17
```

Không có `package.json` ở gốc repo và không có workspace. `backend/` và
`frontend/` là hai project npm riêng biệt, cài đặt riêng, chạy riêng.

---

## 2. Stack thực tế

### Backend — `backend/`

| | |
|---|---|
| Framework | NestJS 11 |
| Ngôn ngữ | TypeScript 5.7 |
| Database | PostgreSQL 17 |
| Truy cập DB | `pg` trực tiếp — **SQL viết tay trong `persistence/`**. Không ORM, không query builder |
| Validation | zod 3 (DTO khai ngay trong file controller) |
| Test | Jest 29 + supertest |
| Runtime deps | 11 gói. Không HTTP client ra ngoài, không queue, không scheduler, không tầng lưu file |

### Frontend — `frontend/`

| | |
|---|---|
| Framework | React 19 |
| Build tool | Vite 8 |
| Routing | react-router-dom 7 |
| Server state | TanStack Query 5 |
| HTTP | axios |
| UI | Tailwind CSS 4 + shadcn + `@base-ui/react` + `lucide-react` |
| Test | Vitest 3 + Testing Library + jsdom |
| Lint | oxlint |

Vite dev server chạy ở `:4200` (khai tường minh trong `vite.config.ts`, không phải
mặc định 5173) vì `CORS_ORIGINS` của backend khai đúng cổng đó.

---

## 3. Mô hình triển khai

```text
Dự án A  →  deployment A  →  database A
Dự án B  →  deployment B  →  database B
```

Một deployment phục vụ **một** tổ chức. Database chính là ranh giới cô lập.

Đây không phải SaaS multi-tenant. Không có `tenant_id`, không có tenant resolver,
không có cross-tenant routing. Khi bạn thiết kế bảng cho dự án của mình, đừng thêm
cột "thuộc công ty nào" — nó luôn thừa, và một câu `WHERE` quên mất nó là một vụ
rò rỉ dữ liệu.

---

## 4. Kiến trúc backend

```text
backend/src/
├── config/           môi trường đã validate
├── infrastructure/   adapter công nghệ — database, auth hạ tầng, health, tty
├── common/           tiện ích không biết gì về core lẫn capability
├── core/             FOUNDATION — dùng lại giữa các dự án
│   ├── identity/         ai đang gọi, và họ chứng minh thế nào
│   ├── users/            con người, tách khỏi cách họ đăng nhập
│   ├── organization/     phòng ban và membership
│   └── authorization/    ai được làm gì
└── capabilities/     PROJECT — nghiệp vụ của Hoàng Long
    ├── membership-approval/
    ├── account-invitation/
    └── trip-schedule/    lịch xe + chi phí chuyến + thuê xe ngoài
```

Mỗi context có bốn tầng, và ranh giới giữa chúng được script canh (§13):

```text
api/           controller · DTO zod · guard        — không viết SQL
application/   service — giữ transaction và luật
domain/        type + hàm thuần                    — không @nestjs, không pg
persistence/   repository — SQL                    — không tự mở transaction
```

`src/app.module.ts` là **composition root** — file duy nhất biết toàn hệ thống.
Một deployment không có capability nào vẫn là deployment hợp lệ.

### Cái gì thuộc Foundation, cái gì thuộc Project

Phép thử: *"Dự án tiếp theo, ở một ngành hoàn toàn khác, có dùng lại nguyên si thứ
này không?"* Có ⇒ `core/`. Không ⇒ `capabilities/`.

Ranh giới quan trọng nhất: **`core/` không chứa logic nghiệp vụ của một Project.
Project được phép dùng và compose `core/`.** Nếu `core/` biết tên một capability,
foundation đã hết dùng lại được — và rule **B1** báo đỏ ngay ở CI.

Không bao giờ được vào `core/`:

- **Từ vựng nghiệp vụ.** Không `customer`, `invoice`, `shipment`, `warehouse`.
  Foundation nói bằng ngôn ngữ nền tảng: user, session, unit, record, scope.
  Rule **B7** canh điều này.
- **Quy tắc riêng của một khách hàng.** "Đơn trên 50 triệu phải giám đốc duyệt"
  thuộc capability.
- **`tenant_id`.** Xem §3.
- **Generic record engine.** Không `EntityTable<T>`, không workflow engine vạn
  năng. Foundation chỉ nhận thứ đã có bằng chứng dùng chung.

---

## 5. Kiến trúc frontend

```text
frontend/
├── src/
│   ├── api/         nơi DUY NHẤT chạm backend — một file cho mỗi resource
│   ├── hooks/       TanStack Query hook, bọc quanh api/
│   ├── pages/       trang theo nghiệp vụ (account · leads · organization ·
│   │                system · trip · worklist)
│   ├── components/  ui/ (primitive dùng chung) · common/ (SessionGuard…)
│   ├── layouts/     MainLayout — shell sau đăng nhập
│   ├── contexts/    SessionProvider · LanguageContext
│   ├── config/  types/  utils/
│   ├── App.tsx      toàn bộ bảng route
│   └── main.tsx
├── api/             serverless function — proxy same-origin tới backend
└── tests/           helpers/ · integration/
```

`App.tsx` chia hai nhóm route: `/login` và `/change-password` mở, mọi thứ còn lại
nằm dưới `<RequireSession>` + `MainLayout`.

`RequireSession` định tuyến ba trạng thái phiên; nó **không** quyết định quyền —
server quyết ở mỗi request.

Alias `@` trỏ vào `src/` (`vite.config.ts`).

⚠ Frontend **không** có sự phân chia Foundation/Project như backend. Không có
`features/`, không có `services/`, không có `store/`, không có `app/tenant/` hay
`app/theme/`. Bản sắc thị giác nằm ở Tailwind + `index.css`, không phải file SCSS
token.

---

## 6. Capability đã có

**Đã triển khai và đang chạy:**

| Vùng | Ở đâu |
|---|---|
| Authentication — login, session, đổi mật khẩu, CSRF, throttle | `core/identity/` |
| Authorization — permission, role assignment, guard | `core/authorization/` |
| Users — provisioning, offboarding, CLI tạo/nâng quyền | `core/users/` |
| Departments + membership | `core/organization/` |
| Membership approval | `capabilities/membership-approval/` |
| Account invitation | `capabilities/account-invitation/` |
| Trip schedule (lịch xe) + danh mục xe/khách | `capabilities/trip-schedule/` |
| Trip cost (5 khoản chi phí) + outsourced hire (thuê xe ngoài) | cùng capability, controller riêng |

**Chưa triển khai** — xem §16.

---

## 7. Database

PostgreSQL 17. SQL viết tay; không ORM.

Migration ở `backend/migrations/`, đánh số tuần tự, **forward-only**. Hiện có 12
file, cao nhất là `0012_trip_cost.sql`.

```text
0001 identity          users · identities · sessions
0002 users_updated_at
0003 organization      departments · department_memberships
0004 authorization     role_assignments
0005 identity_credential_state
0006 membership_change_requests
0007 account_invitations
0008 role_assignment_membership_fk_index
0009 list_pagination_indexes
0010 canonical_email_identity
0011 trip_schedule     trip_vehicles · trip_customers · trip_schedules
0012 trip_cost         trip_costs · trip_outsource_hires
```

**Sửa sai bằng một file mới, không sửa file đã chạy** — runner lưu checksum và từ
chối khởi động nếu file cũ bị đổi.

Hai quy ước xuyên suốt schema:

- **Không hard-delete.** Vòng đời là disable / archive / end / revoke / void —
  toàn `UPDATE`, vì lịch sử là mục đích. Rule **B13** canh ở CI, và role runtime
  `bo_app` thậm chí không được `GRANT DELETE`.
- **Tiền là `NUMERIC`, không bao giờ float**, và đi suốt đường dưới dạng `string`
  — row → domain → JSON. Cộng tiền chỉ bằng `SUM()` của PostgreSQL.

---

## 8. Authentication

Đã dựng đầy đủ. `core/identity/` trả lời "ai đang gọi", và không biết gì về việc
người đó được làm gì.

| Endpoint | Guard |
|---|---|
| `POST /auth/login` | `CsrfGuard` |
| `POST /auth/logout` | `CsrfGuard` + `AuthGuard` |
| `GET /auth/me` | `AuthGuard` |
| `POST /auth/password` | `CsrfGuard` + `AuthGuard` |

Phiên đăng nhập là **token mờ phía server, không phải JWT**. Database chỉ lưu băm
của token; token thô chỉ tồn tại trong cookie `bo_session` — `HttpOnly`, `Secure`
ở production, `SameSite=Strict`. Không client nào cất được nó vào `localStorage`,
vì không client nào được cầm nó. Đăng xuất là thu hồi thật, vì có bảng để thu hồi.

Mật khẩu băm bằng **scrypt**, tham số ghi kèm trong digest. Thuật toán đứng sau
một port (`password-hasher.port.ts`), nên đổi được mà không chạm luật.

**Ba** lý do đăng nhập hỏng trả về **cùng một** phản hồi — subject không tồn tại,
sai mật khẩu, tài khoản bị vô hiệu hoá — nên endpoint không trở thành công cụ dò
xem tài khoản nào có thật. Các lỗi khác **vẫn phân biệt được**, và đó là chủ ý:
vượt ngưỡng thử (429 kèm `Retry-After`), payload sai định dạng (422), thiếu header
CSRF (403). Chúng không nói gì về việc một tài khoản có tồn tại hay không, nên
chúng nói thật được.

**`must_change_secret`** — người dùng còn giữ mật khẩu tạm thì bốn route trên là
toàn bộ những gì họ làm được. `POST /auth/password` cố ý **không** khai permission,
vì `PermissionGuard` từ chối chính những người cần nó.

---

## 9. Authorization

Đã dựng đầy đủ ở `core/authorization/` + migration `0004`. Nó trả lời đúng một
câu: *caller này có được làm hành động này, lên mục tiêu này không?*

### Cái gì là code, cái gì là data

| Thứ | Ở đâu | Vì sao |
|---|---|---|
| Permission key, role key, bảng requirement | **code** | Guard tham chiếu chúng theo tên. Một permission không có code nào đọc là một row vô nghĩa |
| **Ai** giữ role nào, ở đâu | **database** | Đây mới là thứ phải đổi được không cần deploy — nghĩa thật của "SuperAdmin không được hardcode" |

### Ba role, hai được lưu

`SUPERADMIN` · `DEPARTMENT_HEAD` · `MEMBER`.

`MEMBER` là **sự vắng mặt** của một assignment, không phải một giá trị được lưu —
một row "MEMBER" sẽ là nơi thứ hai ghi lại membership, tự do mâu thuẫn với `0003`.

### Quyết theo QUAN HỆ, không theo role

`can()` là hàm thuần và **không đọc role**. Nó đọc quan hệ giữa caller và mục tiêu:

```text
'any'            mọi caller đã hoàn tất provisioning
'member'         thành viên của department đó
'head'           trưởng phòng của department đó
'head-anywhere'  trưởng phòng của MỘT phòng nào đó; không hỏi target
'global'         chỉ một assignment GLOBAL mới thoả
```

Quan hệ là thứ database đã lưu; role chỉ là nhãn suy ra để hiển thị. Quyết theo
quan hệ nghĩa là không có giá trị dẫn xuất nào lệch được khỏi row sinh ra nó.

### Bốn thuộc tính giữ cho nó không hở

1. **Fail-closed.** Permission có scope mà gọi không kèm target → `false`. Trả
   `true` ở đó sẽ cấp mọi department cùng lúc.
2. **Provisioning gate chạy trước.** Còn mật khẩu tạm → từ chối tất cả, kể cả
   SuperAdmin. Đây cũng là lý do mọi route phải khai `PermissionGuard` chứ không
   chỉ `AuthGuard`.
3. **Không cache.** Context nạp lại từ database ở **mỗi** request. Thu quyền có
   hiệu lực ngay, không phải "có hiệu lực sau khi hết phiên".
4. **Scope luôn trên URL, không bao giờ trong body.**
   `@RequirePermission('unit.member.read', 'departmentId')` đọc route param.

### Bất biến do DATABASE canh

| Nội dung | Cơ chế |
|---|---|
| Tối đa 1 active SUPERADMIN toàn deployment | partial unique index |
| Tối đa 1 active HEAD mỗi department | partial unique index |
| Mỗi user tối đa 1 active membership | partial unique index |
| Active HEAD ⇒ có active membership cùng phòng | composite FK có `status` trong key |

Chi tiết ở
[`docs/architecture/core-001-…-invariants.md`](docs/architecture/core-001-identity-organization-account-lifecycle-invariants.md).

### `GET /authorization/me` là hợp đồng render

```json
{ "userId": "…", "username": "a.person",
  "role": "SUPERADMIN | DEPARTMENT_HEAD | MEMBER",
  "departmentIds": ["…"], "permissions": ["unit.read", "…"] }
```

Frontend dùng `permissions` để **ẩn/hiện nút**, không bao giờ để thay cho một lần
kiểm ở server. `grantedPermissions()` trả lời "ở đâu đó" và không mang target, nên
nó là gợi ý hiển thị — không phải một quyết định.

---

## 10. Ranh giới bảo mật

**Server là nơi thực thi. Client chỉ để không hiển thị ra thứ rồi phải giấu đi.**

Frontend không phải điểm thực thi bảo mật. `RequireSession` và các kiểm tra khi
render là **UX** — chúng quyết định hiển thị gì, không quyết định ai được làm gì.

Guard là **opt-in theo route**, không phải toàn cục có lối thoát. Hai cách này
hành xử giống nhau cho tới ngày ai đó thêm endpoint và quên decorator — với guard
toàn cục thì endpoint đó được bảo vệ, với opt-in thì nó **mở toang**. Đổi lại: sự
vắng mặt của guard nhìn thấy được ngay trên dòng phía trên handler, chỗ review
nhìn vào. Đó là đánh đổi có chủ đích, và nó đặt trách nhiệm lên người viết
capability.

**CORS tắt mặc định** — deployment nào cần thì khai origin cụ thể, và cấu hình từ
chối `*` ngay lúc khởi động.

Tiền có ranh giới riêng: `cost.*` sống ở controller riêng, và **không con số tiền
nào lọt vào response của trip API** — người được nhập giá không phải người được
đọc bảng lịch xe.

---

## 11. Chạy cục bộ

```bash
cd backend
cp .env.example .env
npm install
npm run db:up          # PostgreSQL qua docker compose
npm run migrate
npm run dev            # :3000
```

```bash
cd frontend
npm install
npm run dev            # :4200
```

`db:up` chỉ là đường tiện nhất. Bất kỳ PostgreSQL 17 nào cũng chạy được, chỉ cần
`DATABASE_URL` trỏ đúng.

`.env` cần `CORS_ORIGINS=http://localhost:4200` để frontend dev gọi được backend.

### Tài khoản đầu tiên

Không tạo được qua HTTP: `POST /users` đòi permission `user.write`, mà lúc chưa có
ai thì không ai giữ nó. Dùng CLI — mật khẩu đọc từ terminal, không bao giờ từ
`argv` (vì `ps` nhìn thấy argv và shell history giữ lại nó):

```bash
cd backend
npm run user:create -- --email a@b.c --name "A B"
npm run user:promote -- --email a@b.c     # chuyển SuperAdmin, cửa thoát hiểm offline
```

Email tài khoản phải thuộc domain công ty — mặc định `hoanglonglti.com`, khai
trong code chứ không trong `.env` để một deployment quên biến môi trường không
fail-open. Xem [`docs/backend/company-email-policy.md`](docs/backend/company-email-policy.md).

---

## 12. Test

```bash
cd backend
npm test                  # Jest — unit, component, security, race
npm run test:integration  # cần PostgreSQL thật
npm run typecheck
npm run build
```

```bash
cd frontend
npm test                  # Vitest
npm run test:integration  # cần backend thật
npm run typecheck
npm run lint
npm run build
```

Quy ước đặt file test: spec **không** cần hạ tầng nằm cạnh code; spec cần
PostgreSQL hoặc một server thật sống ở `backend/tests/integration/` và
`backend/tests/migrations/`. Rule **B14** canh đúng điều đó — không có nó, một
`*.integration.spec.ts` mới trong `src/` sẽ bị `npm test` bỏ qua trong im lặng.
Chi tiết ở [`docs/architecture/test-placement.md`](docs/architecture/test-placement.md).

Test integration cần `DATABASE_URL_TEST`. Đừng báo PASS khi suite đang skip.

---

## 13. Kiểm tra kiến trúc

```bash
cd backend && npm run check     # 14 ranh giới, B1–B14
```

Một script grep, không dependency, cắm thẳng vào CI. Nó canh đúng những ranh giới
ở §4: core không biết capability, core khai port còn infrastructure viết adapter,
foundation không mang từ vựng nghiệp vụ, api không viết SQL, domain không import
framework, persistence không tự mở transaction, runtime không phát `DELETE`.

Chạy trước mỗi PR. Khi nó báo đỏ, thứ hỏng gần như luôn là **vị trí của file mới**
— không phải bản thân đoạn code.

⚠ Frontend **không** có script `check` tương ứng. CI chạy `lint`, `typecheck`,
`build`, `test` cho frontend.

---

## 14. CI

`.github/workflows/ci.yml`, Node 24 (`.nvmrc`).

**Backend job:** `migrate` → `check` → `typecheck` → `build` → `test` →
`test:integration`, trên một PostgreSQL dịch vụ thật.

**Frontend job:** `lint` → `typecheck` → `build` → `test`.

Cả hai job đều đi qua `.github/scripts/assert-tests-ran.mjs` với một ngưỡng số
test tối thiểu — một suite lặng lẽ không chạy sẽ fail thay vì báo xanh.

---

## 15. Deployment

Contract nằm ở [`deploy/README.md`](deploy/README.md). Tóm tắt:

```text
Cloudflare (DNS, proxy, TLS) → nginx :443 (host) → /      static files
                                                 → /api/  127.0.0.1:3000
                                                            ↓ compose network
                                                          postgres (không mở port)
```

VPS 1 CPU / 2 GB, chạy `docker compose` từ thư mục `deploy/`. Frontend `dist/`
được build ở máy khác rồi upload — VPS không build nếu tránh được.

`frontend/api/[...path].ts` là proxy same-origin cho môi trường serverless: cookie
`SameSite=Strict` không được gửi cross-site, nên gọi thẳng backend từ trình duyệt
sẽ đăng nhập thành công rồi ẩn danh ở request kế tiếp. Proxy giữ mọi request trên
cùng một origin, và CORS không bao giờ vào cuộc.

---

## 16. Chưa triển khai

### Driver Portal — **DISCOVERY / SPECIFICATION ONLY**

Chưa có dòng code nào. Không có bảng, không có route, không có permission, không
có thực thể tài xế trong data model.

Tài liệu khảo sát và thiết kế:
[`docs/domains/driver-portal/`](docs/domains/driver-portal/).

Đừng đọc tài liệu đó thành "đã có nhưng chưa bật".

### AI — **PLANNED, SERVICE RIÊNG**

Chưa có. Khi được xây, nó là một **source/service độc lập**, không nằm trong
backend NestJS này, và **không** truy cập PostgreSQL trực tiếp — backend cấp dữ
liệu đã được authorize và tối giản. Chưa có thư mục `ai/`, chưa có package, chưa
có migration.

### Chưa có trong backend hôm nay

Tầng lưu file/chứng từ, geolocation, event log, job nền, scheduler, queue, HTTP
client gọi ra ngoài. Bất cứ tính năng nào cần một trong số đó là một hạng mục hạ
tầng mới, không phải một cột thêm vào bảng có sẵn.

---

## 17. Tài liệu

| File | Nội dung |
|---|---|
| ★ [`docs/README.md`](docs/README.md) | **Bản đồ tài liệu + quy tắc.** Đọc file này trước mọi task kiến trúc |
| [`docs/backend/frontend-integration-contract.md`](docs/backend/frontend-integration-contract.md) | Hợp đồng API đầy đủ — hình dạng response, mã lỗi, ma trận quyền |
| [`docs/backend/company-email-policy.md`](docs/backend/company-email-policy.md) | Mô hình định danh và chính sách domain email |
| [`docs/architecture/adr-0001-user-identity-projection.md`](docs/architecture/adr-0001-user-identity-projection.md) | Vì sao read model trả về tên người chứ không chỉ UUID |
| [`docs/architecture/adr-0002-list-pagination.md`](docs/architecture/adr-0002-list-pagination.md) | Keyset pagination |
| [`docs/architecture/core-001-…-invariants.md`](docs/architecture/core-001-identity-organization-account-lifecycle-invariants.md) | Sổ đăng ký bất biến, kèm bằng chứng từng cái |
| [`docs/architecture/test-placement.md`](docs/architecture/test-placement.md) | Spec nào nằm ở đâu, và vì sao |
| [`docs/domains/driver-portal/`](docs/domains/driver-portal/) | Driver Portal — `contract.md` · `decisions.md` · `design.md`. **Spec, chưa implement** |
| [`docs/operations/`](docs/operations/) | Audit hardening, kế hoạch test bảo mật, checklist trước khi lên production |
| [`deploy/README.md`](deploy/README.md) | Contract triển khai VPS |
| README của từng context | `backend/src/core/*/README.md`, `backend/src/capabilities/*/README.md` |

Mỗi module có README riêng nói nó **sở hữu** cái gì và **không sở hữu** cái gì. Đó
là chỗ đọc trước khi thêm một file vào context đó.

---

## 18. Bảng layer

| Layer | Vai trò | Dùng lại giữa các dự án? |
|---|---|:--:|
| `backend/src/core/` | platform primitive — identity, users, organization, authorization | ✅ |
| `backend/src/infrastructure/` | adapter công nghệ | ✅ |
| `backend/src/common/` | tiện ích không biết core lẫn capability | ✅ |
| `backend/src/capabilities/` | module nghiệp vụ của dự án | ❌ |
| `frontend/src/components/ui/` | primitive UI dùng chung | ✅ |
| `frontend/src/pages/` | trang theo nghiệp vụ | ❌ |
