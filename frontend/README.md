# Backoffice Foundation — Frontend

Angular 20, zoneless, signals. Đọc [`../README.md`](../README.md) trước — file
đó nói cái gì thuộc Foundation, cái gì thuộc Project, và đặt code mới ở đâu.
File này chỉ nói những thứ riêng của frontend.

```bash
npm start           # dev server :4200
npm run build
npm test            # cần Chrome
npm run check       # 8 ranh giới kiến trúc
```

---

## Hai ý tưởng mọi thứ khác đi ra từ đó

**1. Đơn vị tổ chức là dữ liệu, capability là code.**

```text
Đơn vị              bản ghi runtime   (fixture hôm nay, API ngày mai — không hardcode)
Capability          module dùng lại   (đăng ký qua DI)
Đơn vị × Capability cấu hình
```

Không chỗ nào trong nền tảng biết tên một phòng ban cụ thể. Thêm một đơn vị vào
nguồn dữ liệu thì nó xuất hiện ở điều hướng, routing, danh bạ và dashboard —
không sửa component nào.

**2. Vai trò *chọn* workspace, không *ẩn* nút.**

Mỗi persona được resolve sang một component riêng sau cùng một URL, do
`WorkspaceHost` quyết định. Một member không có nút "Phân công" để ẩn, vì không
có bề mặt phân công nào được đăng ký cho persona đó ngay từ đầu.

Đây là khác biệt đáng giữ: ẩn nút bằng CSS thì cái nút vẫn còn đó. Không đăng ký
bề mặt thì không có gì để ẩn.

Nhưng cả hai đều **không** phải bảo mật — một persona khác chỉ là một lần sửa
state của client. Bề mặt không được đăng ký chỉ có nghĩa giao diện sạch hơn và
khó bấm nhầm hơn; endpoint phía sau vẫn phải tự bảo vệ mình.

---

## Hai tầng truy cập, cố ý không gộp

> **Đây là logic hiển thị, không phải bảo mật.** Cả hai tầng dưới đây chạy trong
> trình duyệt và chỉ quyết định *render cái gì*. Chúng không phải authorization,
> và không bao giờ được coi là ranh giới bảo mật — bất kỳ ai cũng sửa được state
> của client. Authorization thật là việc của server, và server **chưa** có nó
> (xem §7 của [`../README.md`](../README.md)).

**L1 — đơn vị.** Người này vào được đơn vị nào? Trả lời bởi `AccessService`.

**L2 — bản ghi.** Trong một đơn vị, đọc được dòng nào? Trả lời bởi
`canSeeRecord()`, áp dụng trong repository.

Gộp hai tầng thành một "scope" xếp hạng chính là đường dẫn tới lỗi kinh điển:
dashboard dùng chung cho mọi người rồi lọc bằng UI. Chúng ở lại là hai hàm
riêng, test riêng.

Luật viết dưới dạng **hàm thuần** trong `services/access/rules/` — không
Angular, không rxjs, có script canh (R3). Hàm thuần vì khi backend dựng tầng
authorization của nó, đây là **đặc tả tham chiếu** dễ đọc và dễ đối chiếu.
Backend sẽ **viết lại** logic tương đương, không import; hai bên tự sở hữu phần
thi hành của mình.

Capability cũng có thể khai policy phía frontend — điều hướng, tab, widget nào
xuất hiện cho persona nào. Cũng vậy: đó là **cấu hình hiển thị**, không phải
ranh giới bảo mật.

`SUPERADMIN | DEPARTMENT_HEAD | MEMBER` là lựa chọn của ứng dụng mẫu, không
phải bất biến của Foundation. Chúng mô tả **bán kính dữ liệu**, không phải chức
danh — nhiều chức danh có thể ánh xạ vào cùng một bán kính. Nhãn hiển thị thuộc
về dự án.

---

## Bố cục

```text
frontend/
├── app/                 khung ứng dụng
│   ├── app.config.ts        COMPOSITION ROOT — bind repository, đăng ký capability
│   ├── app.routes.ts
│   ├── layout/              shell · topbar · page-title · persona-switcher · viewport
│   ├── navigation/          dựng NavigationModel từ quyền + capability + config
│   ├── routing/             workspace-host · capability-outlet · capability-routes
│   ├── tenant/              branding · navigation · fixtures     ← cấu hình dự án
│   └── theme/               _palette · _type                     ← bản sắc dự án
│
├── components/          UI thuần — ui/ feedback/ navigation/ pipes/
├── services/            access/{rules/} · composition/ · branding
├── store/               session · organization · workspace-context
├── styles/tokens/       HỢP ĐỒNG token — nơi DUY NHẤT có màu thô
├── types/ utils/ constants/ assets/
│
├── features/            NGHIỆP VỤ — organization · worklist · leads
└── scripts/             check-architecture.sh · check-imports.mjs
```

Path alias: `@bo/components` `@bo/services` `@bo/store` `@bo/types` `@bo/utils`
`@bo/constants`. Chúng trỏ thẳng vào source, không có bước đóng gói.

Ba feature trong `features/` là **ví dụ tham khảo**. Fork cho dự án mới thì xoá
chúng đi; nền tảng vẫn boot — `WorkspaceHost` render empty-state khi không có
dashboard nào đăng ký.

Mỗi feature có bốn tầng:

```text
features/<tên>/
├── domain/        model + quy tắc nghiệp vụ — không Angular, không UI
├── data-access/   repository contract + implementation
├── ui/            component câm của riêng feature này
└── feature/       trang smart theo persona
```

Head và member **dùng chung** model và repository; chỉ `feature/` khác nhau.

---

## Capability lắp vào bằng cách nào

Feature export một manifest, `app.config.ts` gom các manifest lại, shell đọc kết
quả. Không gì import thẳng một page, nên mọi bề mặt đều lazy-load.

```ts
export const potentialCustomerCapabilities: CapabilityDescriptor[] = [{
  key: 'potential-customers',
  title: '…',
  presentations: {
    // Cùng capability, cùng repository — khác page theo persona.
    DEPARTMENT_HEAD: { title: '…', load: () => import('…/head/…') },
    MEMBER:          { title: '…', load: () => import('…/member/…') },
  },
}];
```

Thiếu một vai trò trong `presentations` nghĩa là persona đó **không bao giờ**
thấy capability — không ở điều hướng, không ở tab, và route guard từ chối.

Widget dashboard đi cùng cơ chế: chỉ render nếu capability của nó đang bật cho
đơn vị đang xem.

Shell hỏi đúng bốn câu và không hơn: ai đang đăng nhập, họ vào được đơn vị nào,
capability nào đã đóng góp điều hướng, persona này nhận workspace nào. Nó
**không thể** chứa `if (đơn vị === …)` vì nó không nhìn thấy capability nào cả.

---

## Truy cập dữ liệu

Chưa gọi HTTP. Mọi feature nói chuyện với một repository trừu tượng;
`app.config.ts` bind nó vào fixture:

```ts
{ provide: PotentialCustomerRepository, useClass: FixturePotentialCustomerRepository },
```

Nối vào backend thật = đổi `useClass` sang implementation gọi HTTP. Không
component nào bị sửa, vì không component nào biết nó đang cầm implementation gì.

### `UserContext` — đọc kỹ trước khi nối vào HTTP

Mọi method của repository nhận `user: UserContext` làm tham số đầu tiên. Ý nghĩa
của tham số đó **khác hẳn nhau** giữa hôm nay và production.

**Hôm nay — fixture, hành vi demo.** Fixture lọc dữ liệu theo `UserContext` để
bản demo cho thấy mỗi persona nhìn thấy gì. Persona switcher trên topbar tồn tại
**chỉ vì** fixture `SessionRepository` trả về một danh sách persona; bản
production trả `[]` và control đó biến mất. Đây là hành vi tham khảo, không phải
mô hình bảo mật.

**Production — HTTP.** Frontend **không được** tự quyết mình là ai. Cụ thể:

- Không gửi `userId`, `role`, hay `departmentId` lên rồi mong server dùng chúng
  để phân quyền. Client sửa được mọi giá trị đó.
- Danh tính người gọi do **server** xác định từ phiên đã xác thực — cookie →
  `AuthGuard` → `CurrentUser`. Không có đường nào khác.
- Server là authority. Nếu một câu trả lời phụ thuộc vào "ai đang hỏi", server
  phải tự trả lời câu đó, không đọc từ payload.

`UserContext` khi ấy là thứ để **render**: hiện tên gì, vẽ menu nào. Không phải
thứ để chứng minh quyền.

Cũng nên biết: `UserContext` phía frontend có `role` và `departmentId`, còn
`SessionUser` phía backend hiện chỉ có `id`, `displayName`, `status`. Hai type
**chưa** khớp nhau, và điều đó đúng — authorization là Core roadmap, chưa active.
Đừng sửa type nào để "đồng bộ" chúng; khớp nhau là việc của lúc tầng
authorization được dựng.

Xác thực thuộc backend (`backend/src/core/identity/`). Phiên đăng nhập đi bằng
cookie `HttpOnly`, nên frontend **không** cầm token và không cất gì vào
`localStorage`. `store/session/` là ranh giới.

---

## Ghi chú design system

Độ nổi khai một lần: card dùng viền tóc và **không** đổ bóng, để thang shadow
còn giữ nghĩa "thứ này nổi lên" khi menu hay drawer dùng tới.

Accent đi theo cặp solid/soft (`--c-teal` / `--c-teal-soft`); component đọc qua
`accentVars()` thay vì rẽ nhánh theo tên màu. Control lấy chiều cao từ
`--control-h`, con trỏ thô tự nâng lên 40px.

Dưới 900px mọi bảng dữ liệu bỏ header và thành khối có nhãn — điện thoại thấy
**đủ** số cột desktop thấy, thay vì giấu bớt cột phụ.

Màu thô chỉ được sống trong `styles/tokens/` (R5), và nền tảng không được đặt
tên một webfont cụ thể (R6). Đổi toàn bộ diện mạo = sửa `app/theme/`, không chạm
component nào.

---

## Ranh giới được canh bằng máy

```bash
npm run check
```

```text
R1  nền tảng ↛ features · app        R5  hex chỉ ở styles/tokens
R2  components ↛ từ vựng tổ chức     R6  nền tảng ↛ webfont cụ thể
R3  access/rules ↛ Angular · rxjs    R7  utils ↛ Angular DI
R4  nền tảng ↛ tên khách hàng        R8  feature ↛ feature khác
```

Khi một rule báo đỏ, thứ hỏng gần như luôn là **vị trí** của file mới, không
phải bản thân đoạn code.
