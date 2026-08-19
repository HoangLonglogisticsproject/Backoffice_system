# Backoffice Foundation — Backend

Nền tảng backend dùng lại được cho nhiều dự án backoffice. **Đây không phải
backend của một công ty cụ thể.** Không có phòng ban, vai trò, quy trình duyệt
hay bất kỳ từ vựng nghiệp vụ nào trong `core/` — và có một checker canh điều đó.

Trạng thái hiện tại: **FROZEN — sẵn sàng đóng gói / tuỳ biến theo dự án.**

```bash
# terminal 1 — frontend
cd frontend && npm start        # :4200

# terminal 2 — backend
cd backend  && npm run dev      # :3000
```

Hai tiến trình độc lập, không chia sẻ build. Backend **không import source code
từ frontend**; mỗi bên tự sở hữu phần thi hành của mình.

---

## 1. Một deployment = một database

```
Công ty A  →  deployment A  →  database A
Công ty B  →  deployment B  →  database B
```

**Không phải SaaS multi-tenant.** Không có cột `tenant_id`, không có tenant
resolver, không có cross-tenant routing ở bất kỳ đâu trong codebase. Database
chính là ranh giới cô lập — biên giới mạnh nhất, và là biên giới không thể quên
áp dụng trong một câu `WHERE`.

## 2. Stack

NestJS 11 · PostgreSQL 17 · `pg` (không ORM) · `zod` cho env và request DTO ·
`scrypt` từ `node:crypto` cho mật khẩu.

Không ORM là lựa chọn có chủ đích: schema ở đây nhỏ và ổn định, còn SQL viết tay
thì đọc được nguyên văn thứ sẽ chạy trên database.

## 3. Core hiện có gì

**Chỉ Identity.** Người dùng, danh tính, phiên đăng nhập — không hơn.

```text
backend/
├── src/
│   ├── config/           môi trường đã validate — cửa DUY NHẤT đọc process.env
│   ├── infrastructure/   adapter công nghệ
│   │   ├── auth/             scrypt password hasher
│   │   ├── database/         pool, migration runner, CLI
│   │   └── health/           /health
│   ├── common/           primitive cross-cutting, KHÔNG phải sọt rác
│   │   ├── errors/           domain error
│   │   ├── http/             error filter, zod pipe
│   │   └── types/            database port
│   ├── core/             FOUNDATION
│   │   ├── identity/         login, session, CSRF, throttle
│   │   └── users/            user, bootstrap CLI
│   └── capabilities/     RỖNG CÓ CHỦ ĐÍCH — xem §4
├── migrations/
├── scripts/              check-boundaries.sh
├── docker-compose.yml
└── package.json
```

Chưa có: phân quyền, đơn vị tổ chức, vai trò, quyền hạn, audit, file, thông báo,
cấu hình. Chúng **không** bị bỏ quên — chúng chưa được yêu cầu, và foundation
phải dùng được khi chưa cài một capability nghiệp vụ nào.

## 4. `capabilities/` rỗng là kết quả đúng

Đó là chỗ module nghiệp vụ của từng dự án sẽ nằm. Nó rỗng vì chưa có dự án nào
đóng góp bằng chứng về thứ dùng chung được — và một thư mục rỗng trung thực thì
tốt hơn một abstraction đoán trước sẽ sai.

Ranh giới quan trọng nhất, do `npm run check` canh:

```
core  ↛  capabilities        core biết tên một capability là core đã hỏng
core  ↛  infrastructure      core khai PORT, infrastructure viết ADAPTER
```

## 5. Chạy cục bộ

```bash
cp .env.example .env
npm run db:up                 # PostgreSQL qua docker compose
npm run migrate
npm run dev
```

`db:up` là đường tiện nhất, không phải đường duy nhất — **bất kỳ PostgreSQL 17
nào cũng chạy được**, chỉ cần `DATABASE_URL` trỏ đúng. Máy không có Docker thì
cài PostgreSQL trực tiếp rồi bỏ qua `db:up`.

Tạo người dùng đầu tiên (không có endpoint tạo user: tạo user qua HTTP đòi hỏi
trả lời "ai được phép", mà đó là phân quyền — chưa tới):

```bash
BOOTSTRAP_PASSWORD='...' npm run user:create -- --email a@b.c --name "A B"
```

Mật khẩu đọc từ biến môi trường hoặc prompt, **không bao giờ từ tham số dòng
lệnh** — argv nhìn thấy được trong `ps` và rơi vào history của shell.

## 6. Lệnh

| | |
|---|---|
| `npm run dev` | chạy watch mode |
| `npm run migrate` | áp migration, forward-only, chạy lại thì skip |
| `npm run typecheck` | |
| `npm run build` | |
| `npm test` | 95 test; **103** nếu có PostgreSQL (xem dưới) |
| `npm run check` | 7 ranh giới kiến trúc, 0 dependency |

Test integration của migration runner **tự tắt** khi không có biến dưới đây, nên
nó sẽ skip trong im lặng nếu CI quên khai báo. Database đó bị **xoá schema** giữa
các case — đừng trỏ vào database có dữ liệu:

```bash
DATABASE_URL_TEST=postgres://user:pass@localhost:5432/backoffice_itest npm test
```

## 7. Ba principal PostgreSQL

Ứng dụng **không** được chạy bằng superuser. Ba role, mỗi role một lý do:

| Role | Dùng ở đâu | Quyền |
|---|---|---|
| `bo_migrator` | `npm run migrate`, bước deploy | owner của database + mọi object |
| `bo_app` | runtime + `npm run user:create` | `SELECT, INSERT, UPDATE` — **không DELETE** |
| `bo_ops` | cron dọn session | `SELECT, DELETE` trên `sessions` |

Tách được mà không phải sửa code, vì `migrate.cli.ts` vốn đã là entry point
riêng — migration là bước deploy, không phải bước boot.

**Vì sao bo_app không có DELETE:** vòng đời ở đây là disable / archive / end /
revoke, toàn UPDATE, vì lịch sử là mục đích. Không cấp DELETE biến quyết định
thiết kế đó thành thứ PostgreSQL cưỡng chế, thay vì thứ repository sau phải nhớ.
`npm run check` canh phía code bằng **B13**, nên một câu DELETE mới fail ở CI
chứ không fail trên production.

Provision một lần, bằng DBA:

```bash
psql -v ON_ERROR_STOP=1 -d postgres -v db=backoffice      -v migrator_pw="$MIGRATOR_PASSWORD" -v app_pw="$APP_PASSWORD" -v ops_pw="$OPS_PASSWORD"      -f scripts/provision-db-roles.sql
DATABASE_URL=postgres://bo_migrator:PW@HOST/backoffice npm run migrate
psql -c 'GRANT SELECT, DELETE ON sessions TO bo_ops;'      -c 'REVOKE ALL ON schema_migrations FROM bo_app;'
```

Script không chứa mật khẩu — chúng vào bằng biến psql từ môi trường.

## 8. Giới hạn vận hành đã biết

Không phải lỗi — là thứ deployment phải biết trước khi đưa lên production.

**Rate limiter đăng nhập nằm trong bộ nhớ, tính theo TIẾN TRÌNH.** Chạy nhiều
replica thì mỗi replica có ngân sách riêng, nên giới hạn thực tế nhân lên theo số
replica; restart cũng xoá bộ đếm.

Đây là ĐIỀU KIỆN TIÊN QUYẾT, không phải ghi chú: **trước khi chạy quá 1 replica**,
chuyển throttle sang shared store hoặc đặt rate limit ở edge/reverse proxy. Repo
này không chứa artifact deployment nào (không k8s, không Terraform, không
Dockerfile) nên số replica production là thứ chỉ deployment biết — mặc định đang
giả định 1.

Không thêm Redis sẵn cho việc này: một dependency hạ tầng mới cho một giới hạn
chưa tồn tại là chi phí vận hành thật đổi lấy một rủi ro giả định.

**HSTS và CSP thuộc về deployment, không phải ứng dụng.** HSTS là thuộc tính của
lớp kết thúc TLS — đặt từ một app có thể chạy HTTP ở dev thì hoặc vô tác dụng,
hoặc khoá lập trình viên khỏi localhost hàng tháng. CSP mô tả nguồn script/style
của *frontend*, thứ API này không phục vụ và không thể biết. Ứng dụng tự đặt
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` và tắt
`x-powered-by`.

**Session hết hạn không được dọn tự động.** Hàng `sessions` chỉ lớn dần. Chúng
không còn hiệu lực (`resolve` từ chối cả expired lẫn revoked), nên đây là chuyện
dung lượng chứ không phải bảo mật.

Không thêm scheduler vào ứng dụng cho việc này: một job runner kèm chuyện chọn
leader khi chạy nhiều replica là quá nhiều bộ máy cho một câu lệnh mà cron của
deployment vốn đã biết chạy.

```sql
DELETE FROM sessions
 WHERE expires_at < now() - interval '30 days'
    OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days');
```

Cửa sổ 30 ngày giữ lại lịch sử gần đây để còn trả lời được "phiên này kết thúc
lúc nào, bằng cách nào". `idx_sessions_expires_at` có sẵn để câu lệnh trên rẻ.

**Database sập ⇒ `/health` trả 503 và tự hồi phục khi database trở lại**, cùng
một tiến trình, không crash-loop. Nhưng `POST /auth/login` lúc đó trả 500 chứ
không phải 503. Nó đóng lại đúng cách và không lộ chi tiết nội bộ; chỉ là mã
trạng thái chưa mô tả đúng nguyên nhân.

## 9. Bảo mật — hình dạng hiện tại

Phiên đăng nhập là **token mờ phía server**, không phải JWT: database chỉ lưu
SHA-256 của token, còn token thô chỉ tồn tại trong một cookie `HttpOnly` —
`Secure` ở production, `SameSite=Strict`. Không client nào **có thể** cất nó vào
`localStorage`, vì không client nào được cầm nó.

CSRF có hai lớp: `SameSite=Strict` là lớp chính, và một guard đòi header
`x-requested-with` trên mọi request thay đổi trạng thái là lớp hai — vì
`SameSite` do trình duyệt thi hành, còn lớp hai thì không.

CORS **tắt mặc định** (same-origin, đúng hình dạng production). Deployment nào
cần thì khai `CORS_ORIGINS`; schema **từ chối `*` ngay lúc boot**, vì wildcard
không dùng được với cookie credentials. Domain của khách nằm trong environment
của deployment đó, không nằm trong Foundation.
