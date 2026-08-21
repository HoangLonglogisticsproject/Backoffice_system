# Chính sách email công ty — `@hoanglongti.com`

> Trạng thái: **đang áp dụng**. Google Workspace / mailbox: **chưa có, là hạ tầng tương lai.**

## Quy tắc

Mọi tài khoản nhân viên có email dạng:

```
<local-part>@hoanglongti.com
```

Ví dụ hợp lệ:

```
uyen@hoanglongti.com
nuna@hoanglongti.com
uyen.sales@hoanglongti.com
```

Không hợp lệ — bị từ chối ở **backend**, không chỉ ở form:

```
uyen@gmail.com        domain ngoài
nuna@yahoo.com        domain ngoài
hlt58                 không có domain
uyen@                 không có domain
@hoanglongti.com      không có local part
```

**Email lưu và trả về luôn là địa chỉ đầy đủ.** Không bao giờ lưu `uyen` một
mình.

## Mô hình định danh — bốn giá trị, một nguồn sự thật

Đây là toàn bộ mô hình. Không có giá trị thứ năm, và **không có nguồn username
thứ hai được lưu trữ.**

| | Giá trị | Ai sở hữu | Lưu ở đâu |
|---|---|---|---|
| **Định danh chuẩn (canonical)** | `phuongle@hoanglongti.com` | backend | `identities.subject` |
| **Credential đăng nhập** | `phuongle@hoanglongti.com` | backend | cùng cột trên |
| **Username hiển thị trên dashboard** | `phuongle` | backend suy ra | **không lưu ở đâu cả** |
| **Định danh phân quyền nội bộ** | `userId` (UUID) | backend | `users.id` |

```
identities.subject = "phuongle@hoanglongti.com"   ← lưu, normalize, unique
        │
        │  localPartOf()  — mỗi request, KHÔNG bao giờ lưu lại
        ▼
GET /authorization/me → username: "phuongle"
        ▼
MainLayout hiển thị "phuongle"
```

### Username hiển thị

`username` mà API trả về là giá trị **suy ra** từ local part để hiển thị.
Không có cột `username`, không có credential `username`, không có đường đăng
nhập bằng `username`. Xem `core/authorization/domain/username.ts`.

Nó **là**: một giá trị trình bày.

Nó **không phải**:

- không phải role
- không phải permission
- không phải mật khẩu
- không phải `userId` nội bộ
- không phải thứ dùng để đăng nhập

`localPartOf()` chạy ở **backend**, không phải frontend. Frontend nhận thẳng
`username` đã suy ra sẵn và **không tự tách `@`**, không gọi thêm API nào để lấy
giá trị này, và không truy vấn cơ sở dữ liệu.

### `username` có thể là `null`

`GET /authorization/me` khai báo `username: string | null` và trả `null` khi tài
khoản **không có local identity** (`findLocalSubject` trả null). Điều này độc lập
với chính sách domain: chính sách quyết định *địa chỉ nào hợp lệ*, còn `null`
nghĩa là *chưa có địa chỉ nội bộ nào cả*. Chính sách email công ty **không** làm
cho `null` biến mất, nên kiểu dữ liệu ở frontend giữ nguyên `string | null`.

Frontend hiển thị sự vắng mặt đúng như nó là: avatar hiện `?`, phần tên không
render. **Không bịa ra danh tính thay thế** — không `Admin User`, không
`Unknown`, không in `userId` ra màn hình.

### Đăng nhập dùng địa chỉ đầy đủ

⚠️ Màn hình duyệt invitation trả mật khẩu tạm thời **hiển thị `Email đăng nhập:
nuna@hoanglongti.com`**, không phải `Tên đăng nhập: nuna`. `POST /auth/login`
nhận `subject` là **địa chỉ đầy đủ**; đưa cho người ta local part là đưa một thứ
không đăng nhập được. Mật khẩu tạm thời vẫn chỉ hiện **đúng một lần**.

## UI — người dùng chỉ gõ local part

Form thêm nhân viên (SuperAdmin tạo trực tiếp) và form đề nghị mở tài khoản
(Trưởng phòng) dùng chung một field:

```
Email *
┌────────────────────────────┬──────────────────┐
│ uyen                       │ @hoanglongti.com │
└────────────────────────────┴──────────────────┘
   người dùng gõ                 cố định, không sửa được
```

- Phần domain là `<span>`, **không phải input**. Không có ô chọn domain, không có
  "email builder" cho phép gõ domain tuỳ ý — cả deployment chỉ có một domain.
- Khi submit, frontend ghép: `uyen` → `uyen@hoanglongti.com`.
- Field **không** dùng `type="email"`: giá trị trong ô là local part, trình duyệt
  sẽ từ chối submit `uyen` nếu coi nó là địa chỉ.

### Dán cả địa chỉ đầy đủ

Nếu người dùng dán `uyen@hoanglongti.com`, hệ thống **chấp nhận và bóc đuôi**
(so sánh không phân biệt hoa thường), kết quả vẫn là `uyen@hoanglongti.com`.

Không bao giờ tạo ra `uyen@hoanglongti.com@hoanglongti.com`.

Lý do chọn "chấp nhận" thay vì "từ chối vì field chỉ nhận local part": dán cả địa
chỉ là việc dễ đoán nhất mà người ta làm với một ô email, và ý định không hề mơ
hồ. Dán `uyen@gmail.com` thì **bị từ chối** — đó là domain ngoài, không phải
chuyện bóc đuôi.

### Thông báo lỗi

```
Vui lòng nhập email công ty hợp lệ.
```

Hiện khi local part rỗng, có khoảng trắng, có `@` lạ, hoặc dài quá giới hạn.

## Backend là nơi quyết định

Frontend ghép domain **không phải là biện pháp bảo mật.** Kẻ tấn công gọi thẳng
API không đi qua form.

Quy tắc được áp dụng ở `core/users/domain/email.ts` (`assertProvisionableEmail`),
gọi từ đúng hai đường tạo tài khoản qua HTTP:

| Đường | Service |
|---|---|
| `POST /users` | `AccountProvisioningService.provision` |
| `POST /departments/:departmentId/account-invitations` | `AccountInvitationService.create` |

Approve invitation cũng đi qua `provision`, nên không có đường vòng.

Domain cho phép đến từ `ALLOWED_EMAIL_DOMAINS`, **mặc định `hoanglongti.com`**.

Mặc định nằm trong code chứ không nằm trong `.env` là có chủ ý: `.env` bị
gitignore, nên một chính sách chỉ sống ở đó sẽ **fail open** trên bất kỳ
deployment nào quên đặt biến. Đặt `ALLOWED_EMAIL_DOMAINS=` (rỗng tường minh) là
lối thoát có tài liệu, nghĩa là "không giới hạn domain".

### Chuẩn hoá (normalization)

Không đổi so với trước. `normalizeEmail` = `trim()` + `toLowerCase()`, áp dụng
cho **toàn bộ** địa chỉ, ở backend, tại thời điểm provisioning.

**Frontend không chuẩn hoá gì cả** — chỉ `trim()` rồi ghép domain. Gõ `Uyen` sẽ
gửi `Uyen@hoanglongti.com` và server lưu `uyen@hoanglongti.com`. Một bản sao thứ
hai của quy tắc chuẩn hoá ở phía client là một thứ nữa có thể lệch với bản thật.

Quy tắc domain **chỉ áp dụng lúc tạo tài khoản, không bao giờ lúc đăng nhập.** Từ
chối đăng nhập vì lý do domain sẽ nói cho kẻ tấn công biết deployment này dùng
domain nào — xem `authentication.service`.

## Google Workspace / mailbox — CHƯA LÀM

Không có, và không phần nào của thay đổi này thêm vào:

- Google OAuth
- Gmail API / Admin SDK / Directory sync
- xác minh mailbox tồn tại
- tra cứu MX

Đây thuần tuý là quy tắc **ở tầng ứng dụng** về việc địa chỉ nào được phép trở
thành tài khoản. Hệ thống enforce domain **độc lập với nhà cung cấp mail**, nên
`uyen@hoanglongti.com` được chấp nhận kể cả khi hộp thư đó chưa được tạo. Việc
tạo hộp thư thật là hạ tầng tương lai.

## Tệp liên quan

| Tệp | Vai trò |
|---|---|
| `backend/src/config/env.schema.ts` | `ALLOWED_EMAIL_DOMAINS`, mặc định là domain công ty |
| `backend/src/core/users/domain/email.ts` | shape + allowlist + normalize |
| `frontend/src/lib/companyEmail.ts` | ghép domain, bóc đuôi khi dán, validate local part |
| `frontend/src/pages/organization/components/AddEmployeeModal.tsx` | field local part + domain cố định |
