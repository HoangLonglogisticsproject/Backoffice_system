# Backoffice Foundation

## 1. Repo này là gì

Nền tảng để dựng backoffice cho **nhiều dự án khác nhau**.

Nó không phải sản phẩm của một công ty. Nó là phần nền mà mọi backoffice đều
cần — danh tính, đăng nhập, phiên làm việc, khung điều hướng, hệ thống UI,
hợp đồng token — cộng với những ranh giới giữ cho phần nền đó **không bị nghiệp
vụ của khách hàng đầu tiên làm hỏng**.

Cách dùng: fork repo, thêm module nghiệp vụ của dự án vào đúng chỗ, đổi bản sắc
thương hiệu. Không sửa phần nền.

Repo chứa **hai tiến trình độc lập**. Chúng chạy song song, ở **hai terminal
riêng** — không phải hai lệnh dán liên tiếp vào cùng một shell:

```bash
# Terminal 1 — frontend
cd frontend && npm start      # :4200   Angular 20
```

```bash
# Terminal 2 — backend
cd backend && npm run dev     # :3000   NestJS 11 + PostgreSQL 17
```

---

## 2. Mô hình triển khai

```text
Dự án A  →  deployment A  →  database A
Dự án B  →  deployment B  →  database B
```

Một deployment phục vụ **một** tổ chức. Database chính là ranh giới cô lập.

Đây không phải SaaS multi-tenant. Không có `tenant_id`, không có tenant
resolver, không có cross-tenant routing. Khi bạn thiết kế bảng cho dự án của
mình, đừng thêm cột "thuộc công ty nào" — nó luôn thừa, và một câu `WHERE` quên
mất nó là một vụ rò rỉ dữ liệu.

---

## 3. Cái gì thuộc về Foundation

Thứ gì **mọi** backoffice đều cần và **không** doanh nghiệp nào sở hữu riêng.

Phép thử: *"Dự án tiếp theo, ở một ngành hoàn toàn khác, có dùng lại nguyên si
thứ này không?"* Có ⇒ Foundation. Không ⇒ Project.

Phía backend, Foundation là `core/` (platform primitive) và `infrastructure/`
(adapter công nghệ: database, hạ tầng xác thực, health). Phía frontend là
`components/`, `services/`, `store/`, `styles/tokens/`, và khung `app/` — shell,
routing, điều hướng.

Phân quyền **sẽ** thuộc nhóm này — nó là cơ chế nền tảng, không phải nghiệp vụ.
Hiện chưa được dựng; xem §7.

---

## 4. Cái gì thuộc về một Project

Mọi thứ mang tên, quy tắc, hay từ vựng của một khách hàng cụ thể.

Phía backend là `capabilities/` — module nghiệp vụ tự chứa. Phía frontend là
`features/` — màn hình và logic nghiệp vụ, cộng với `app/tenant/` (khách này là
ai) và `app/theme/` (khách này trông thế nào).

Ranh giới quan trọng nhất trong toàn bộ repo: **Foundation không chứa logic
nghiệp vụ của một Project cụ thể. Project được phép sử dụng và compose
Foundation.** Nếu `core/` biết tên một capability, foundation đã hết dùng lại
được cho dự án sau — và có script canh đúng điều đó.

### Quy tắc quyết định nhanh

Code trả lời câu hỏi nào?

- *"Mọi Backoffice đều cần điều này?"* → **Foundation**
- *"Project này cần điều này?"* → **Project**
- *"Khách hàng này muốn hành xử khác?"* → **cấu hình** của project hoặc của capability
- Code chứa tên hoặc nghiệp vụ cụ thể của khách hàng → **không được vào Foundation**

---

## 5. Đặt code mới ở đâu

**Module nghiệp vụ backend** → `backend/src/capabilities/<tên>/`

Một module NestJS tự chứa: controller, service, repository, migration riêng. Nó
được phép import `core/` và `common/`. Đấu dây tại `src/app.module.ts` — file
duy nhất biết toàn hệ thống.

**Feature nghiệp vụ frontend** → `frontend/features/<tên>/`

Bốn thư mục con, và ranh giới giữa chúng là thứ giữ cho feature test được:

```text
domain/        model + quy tắc nghiệp vụ — không Angular, không UI
data-access/   nơi DUY NHẤT chạm backend
ui/            component câm của riêng feature này
feature/       trang smart theo persona
```

Feature không được import feature khác. Cần dùng chung thì đẩy xuống
`components/` nếu là UI thuần, hoặc `services/` nếu là cơ chế.

**Cấu hình dự án** → `frontend/app/tenant/`

`branding.ts` cho tên và monogram, `navigation.ts` cho sidebar chứa gì. Locale
và tiền tệ khai trong `app/app.config.ts`.

Thư mục mang tên `tenant/` là di sản. Đây **không** phải multi-tenant (§2) — nó
là cấu hình của một dự án. Tên nên đổi thành `project/`; chưa đổi.

**Bản sắc thị giác** → `frontend/app/theme/`

`_palette.scss` cho màu, `_type.scss` cho font và thang chữ. Component đọc
token, không đọc màu — nên đổi toàn bộ diện mạo không cần chạm một component
nào. Nếu bạn thấy mình phải sửa `components/`, tức là một giá trị thị giác đã
lọt vào chỗ không thuộc về nó.

**Nối vào API thật** → `frontend/app/app.config.ts`

Mọi repository đang bind vào fixture. Đổi `useClass` sang implementation gọi
HTTP là xong; không component nào bị sửa, vì không component nào biết nó đang
cầm implementation gì.

---

## 6. Cái gì KHÔNG BAO GIỜ được vào Foundation

**Từ vựng nghiệp vụ.** Không `customer`, `invoice`, `shipment`, `warehouse`.
Foundation nói bằng ngôn ngữ nền tảng: user, session, unit, record, scope.

**Quy tắc riêng của một khách hàng.** "Đơn trên 50 triệu phải giám đốc duyệt" là
quy tắc của một công ty, không phải của một nền tảng. Nó thuộc capability.

**`tenant_id`.** Xem §2. Một cột như vậy nghĩa là mô hình triển khai đã bị hiểu
sai, và nó sẽ lan ra mọi bảng, mọi truy vấn.

**Generic record engine.** Không `EntityTable<T>`, không `BusinessEntity`, không
workflow engine vạn năng. Những thứ đó ra đời từ phỏng đoán về nhu cầu tương
lai, và chúng luôn vừa quá phức tạp cho hôm nay vừa sai cho ngày mai. Foundation
chỉ nhận thứ đã có bằng chứng dùng chung.

---

## 7. Hiện đã dựng tới đâu

```text
Authentication trả lời: "Bạn là ai?"
Authorization  sẽ trả lời: "Bạn được phép làm gì?"
```

Vế thứ nhất đã dựng. Vế thứ hai **chưa**.

**Đã có (Foundation hiện tại)** — authentication, session, CSRF, rate limiting,
và một authenticated user context. Đăng nhập bằng mật khẩu, phiên phía server,
thu hồi được. Backend biết chắc chắn *ai* đang gọi.

**Chưa có (Core roadmap)** — organization/unit, role, permission, scope,
authorization evaluation, capability authorization. Backend **chưa** đánh giá
một quyết định phân quyền nào; `SessionUser` mà `AuthGuard` gắn vào request chỉ
có `id`, `displayName`, `status` — không role, không đơn vị.

Đừng đọc phần này thành "phân quyền đã có nhưng chưa bật". Nó chưa được viết.

Khi được viết, nó là **module của Core**, nằm trong `core/`. Điểm này hay bị
hiểu nhầm: **authorization không phải business feature, cũng không phải phần
customize của khách.** Cơ chế — ai thấy được bán kính dữ liệu nào — là thứ mọi
backoffice đều cần và dùng lại nguyên si giữa các dự án. Cái thuộc về khách hàng
chỉ là *chính sách*: họ đặt tên vai trò là gì, vai trò nào được cấp capability
nào.

### Trách nhiệm bảo mật ngay lúc này

Cho tới khi tầng authorization tồn tại, mỗi endpoint tự chịu trách nhiệm cho
chính nó:

- Endpoint nào cần đăng nhập thì **phải tự khai guard**. Không có guard toàn cục
  bảo vệ hộ.
- Kiểm tra ở route/render phía frontend **không phải** authorization. Chúng là
  UX — quyết định hiển thị gì, không quyết định ai được làm gì.
- Frontend **không bao giờ** là điểm thực thi bảo mật.

**Business modules** — không bao giờ thuộc Core. Chúng sống trong `capabilities/`
và `features/`, kể cả khi trông có vẻ dùng chung được.

Frontend hiện có shell hoàn chỉnh, bộ component, hợp đồng token, và ba feature
mẫu (organization, worklist, leads) chạy trên fixture. Ba feature đó là **ví dụ
tham khảo**, không phải phần bắt buộc — fork cho dự án mới thì xoá chúng đi.

---

## 8. Ranh giới bảo mật

Server là nơi thực thi. Client chỉ để không hiển thị ra thứ rồi phải giấu đi.

Frontend có một cơ chế access rules (`services/access/rules/`). Cơ chế đó
**thuộc Foundation** — giữ nó khi fork. Thứ thuộc về ứng dụng mẫu là bộ vai trò
cụ thể nó đang chạy (`SUPERADMIN | DEPARTMENT_HEAD | MEMBER`) và fixture dùng
chúng để mô phỏng hành vi; dự án mới thay bộ vai trò, không xoá cơ chế.

Dù vậy, cơ chế này chỉ điều khiển việc render. Backend **chưa** có tầng tương
ứng (§7). Khi có, backend viết bản của mình: hai bên **không chia sẻ code**, mỗi
bên tự sở hữu phần thi hành. Bản của client không bao giờ là thứ được tin.

Phiên đăng nhập là token mờ phía server, không phải JWT. Database chỉ lưu băm
của token; token thô chỉ tồn tại trong cookie `HttpOnly`, `Secure` ở production,
`SameSite=Strict`. Không client nào có thể cất nó vào `localStorage`, vì không
client nào được cầm nó.

Mật khẩu băm bằng scrypt với tham số ghi kèm trong digest.

**Ba** lý do đăng nhập hỏng trả về **cùng một** phản hồi — subject không tồn
tại, sai mật khẩu, tài khoản bị vô hiệu hoá — nên endpoint không trở thành công
cụ dò xem tài khoản nào có thật. Các lỗi khác **vẫn phân biệt được**, và đó là
chủ ý: vượt ngưỡng thử (429 kèm `Retry-After`), payload sai định dạng (422), và
thiếu header CSRF (403). Chúng không nói gì về việc một tài khoản có tồn tại hay
không, nên chúng nói thật được.

CORS **tắt mặc định** — deployment nào cần thì khai origin cụ thể, và cấu hình
từ chối `*` ngay lúc khởi động.

Guard là **opt-in theo route**, không phải toàn cục có lối thoát. Hai cách này
hành xử giống nhau cho tới ngày ai đó thêm endpoint và quên decorator — với
guard toàn cục thì endpoint đó được bảo vệ, với opt-in thì nó **mở toang**. Đổi
lại: sự vắng mặt của guard nhìn thấy được ngay trên dòng phía trên handler, chỗ
review nhìn vào. Đó là đánh đổi có chủ đích, và nó đặt trách nhiệm lên người
viết capability.

---

## 9. Chạy cục bộ

```bash
cd backend
cp .env.example .env
npm run db:up          # PostgreSQL qua docker compose
npm run migrate
npm run dev
```

`db:up` chỉ là đường tiện nhất. Bất kỳ PostgreSQL 17 nào cũng chạy được, chỉ cần
`DATABASE_URL` trỏ đúng.

Tạo người dùng đầu tiên — không có endpoint tạo user, vì tạo user qua HTTP đòi
hỏi trả lời "ai được phép", mà đó chính là authorization:

```bash
npm run user:create -- --email a@b.c --name "A B"
```

Frontend dev chạy `:4200` gọi backend `:3000`, nên `.env` cần
`CORS_ORIGINS=http://localhost:4200`.

Migration là forward-only. Sửa sai bằng một file mới, không sửa file đã chạy —
runner lưu checksum và sẽ từ chối khởi động nếu file cũ bị đổi.

---

## 10. Kiểm tra kiến trúc

```bash
cd backend  && npm run check     # 7 ranh giới
cd frontend && npm run check     # 8 ranh giới
```

Hai script grep, không dependency, cắm thẳng vào CI. Chúng canh đúng những ranh
giới ở §3, §4 và §6: core không biết capability, core khai port còn
infrastructure viết adapter, foundation không mang từ vựng nghiệp vụ hay tên
khách hàng, màu thô chỉ sống trong token, feature không với sang feature khác.

Chạy chúng trước mỗi PR. Khi một trong hai báo đỏ, thứ hỏng gần như luôn là vị
trí của file mới — không phải bản thân đoạn code.

---

| Layer | Vai trò | Dùng lại? |
|---|---|:--:|
| `core/` | platform primitive | ✅ |
| `infrastructure/` | adapter công nghệ | ✅ |
| `components/` | UI dùng chung | ✅ |
| `capabilities/` | module nghiệp vụ của dự án | ❌ |
| `features/` | UI/nghiệp vụ của dự án | ❌ |
| `app/tenant/` | cấu hình khách hàng | ❌ |
| `app/theme/` | bản sắc thị giác của khách | ❌ |
