# DRIVER PORTAL — BUSINESS CONTRACT

> **Trạng thái: CONTRACT ĐÃ CHỐT — BẢN 2. ĐÃ IMPLEMENT PHASE 1–3.**
>
> Tài liệu này là **source of truth về nghiệp vụ** cho Driver Portal. Nó mô tả
> *cái gì* và *vì sao*, **không** mô tả *làm thế nào* — thiết kế kỹ thuật thuộc về
> architecture phase và phải tuân theo tài liệu này.
>
> **Ngày chốt bản 2:** 2026-08-30 · **Người chốt:** CEO
>
> **Trạng thái code:** §17 Phase 1–3 đã được implement. Migration `0013`–`0017`;
> Driver Portal routes dưới `/driver`; Completion Review dưới `/trip-schedules`.
>
> | Đã có | Bằng chứng |
> |---|---|
> | Assignment Trip ↔ Driver, có history, 1 active | `0014` `trip_driver_assignments` |
> | Execution Event là khái niệm hạng nhất | `0015` `trip_execution_events` |
> | Vòng đời chi phí editable → locked → approve/reject | `0016` `trip_costs` + `trip_cost_edits` |
> | Completion Request + Review, lý do từ chối được lưu | `0017` `trip_completion_requests` |
> | DONE là điểm đóng vĩnh viễn, có lịch sử trạng thái | `0017` `trip_status_history` + trigger `trip_schedules_guard_done` |
> | Vùng "Chỉ dẫn cho tài xế" tách khỏi ghi chú nội bộ | `0017` `trip_schedules.driver_instructions` |
>
> ★ **Các mục [FUTURE] ở §11, §12 và §17 vẫn CHƯA IMPLEMENT** và không phải điều
> kiện của MVP: GPS/geofencing, face verification, ràng buộc thiết bị, OCR chứng
> từ, AI anomaly detection, quy trình Kế toán, quyền đọc commercial pricing.
> Các mục **[DEFERRED]** (E-4…E-8 ở §9.5, giới hạn resubmit, ánh xạ Dispatch ↔
> Execution) vẫn **chưa được quyết** — implementation không tự quyết thay.
>
> ### ⚠ Bản 2 thay thế bản 1 ở hai điểm
>
> | | Bản 1 | **Bản 2 — hiệu lực** |
> |---|---|---|
> | **Sửa chi phí** | Driver **không** được sửa khoản đã khai | Driver **được** sửa khoản của mình **khi còn ở trạng thái editable**. Sau khi khoá → correction/void, không sửa trực tiếp (§9) |
> | **Vòng đời thực thi** | Chỉ nêu ở mức khái niệm | Có **từ vựng chuẩn** và **state machine đề xuất** (§6, §7) |
>
> **Tài liệu liên quan**
> · [design.md](design.md) — khảo sát kỹ thuật, gap analysis
> · [../../archive/DRIVER-PORTAL-CEO-DECISION-BRIEF.md](../../archive/DRIVER-PORTAL-CEO-DECISION-BRIEF.md) — các phương án đã cân nhắc

## Cách đọc

| Nhãn | Nghĩa |
|---|---|
| **[CONFIRMED]** | Đã chốt. Ràng buộc. Mọi thiết kế sau phải tuân theo. |
| **[PROPOSED]** | Đề xuất để CEO xem xét. **Chưa** ràng buộc. Không được implement như đã chốt. |
| **[DEFERRED]** | Cố ý chưa quyết. Sẽ chốt ở phase sau. **Không** được tự quyết thay. |
| **[FUTURE]** | Định hướng tương lai. **Không** phải điều kiện của MVP. |
| **[LEGACY]** | Hệ thống hiện tại chưa đáp ứng contract. Ghi nhận, xử lý ở architecture phase. |

---

## 1. Bốn ranh giới — nguyên tắc bao trùm

**[CONFIRMED]** Driver Portal là **một source/application riêng với Backoffice** —
không phải một màn hình khác của Backoffice.

| Vùng | Trách nhiệm |
|---|---|
| **Backoffice** | Quản lý · điều phối · kiểm soát · tài chính · audit |
| **Driver Portal** | Nhận booking được phân công · thực hiện booking · khai operating expense · gửi Completion Request |
| **AI** *(chưa có)* | Phân tích · phát hiện bất thường · cảnh báo |
| **SuperAdmin** | Quyết định cuối cùng |

★ Nếu một tính năng làm mờ một trong bốn ranh giới này, tính năng đó sai — kể cả
khi nó tiện.

### 1.1 ★ Driver Portal là MỘT MẮT XÍCH, không phải một hệ thống độc lập

**[CONFIRMED]** Mục tiêu của hệ thống **không phải** là xây một Driver Portal. Mục
tiêu là chuẩn hoá **toàn bộ quy trình vận hành** của Hoàng Long Logistics:

```text
BOOKING → ĐIỀU PHỐI → GÁN XE → GÁN DRIVER → DRIVER EXECUTION
        → PICKUP → DELIVERY → COMPLETION REQUEST → SUPERADMIN CONFIRM → DONE
        → phục vụ CSKH · báo giá · đối soát · quản trị
```

★ **Driver chỉ là một mắt xích trong chuỗi này.**

⚠ **Phân biệt hai thứ hay bị gộp:**

| | |
|---|---|
| **Bề mặt ứng dụng** | Driver Portal là một **application riêng** với Backoffice — giao diện riêng, phiên riêng, bán kính dữ liệu riêng |
| **Vòng đời nghiệp vụ** | ★ **CÙNG MỘT Trip lifecycle.** Driver Portal **không** có vòng đời riêng, **không** có bản sao dữ liệu riêng, **không** tách khỏi Trip |

**[CONFIRMED] Không xây Driver Portal như một hệ thống độc lập tách khỏi Trip
lifecycle hiện tại.**

### 1.2 ★ Hệ thống phải trả lời được — yêu cầu quản trị

**[CONFIRMED]** CEO / Backoffice phải nhìn được, cho bất kỳ Trip nào:

| Câu hỏi | Dựa trên |
|---|---|
| Trip đang nằm ở **khâu nào** | Execution Event mới nhất |
| **Ai chịu trách nhiệm** ngay lúc này | Assignment đang active |
| Driver có đến điểm lấy **đúng giờ** không · **trễ bao lâu** | scheduled time ↔ actual execution time |
| Driver có **xác nhận pickup** không, lúc nào | Pickup Confirmation |
| Driver có đến điểm giao **đúng thời gian** không | scheduled ↔ actual |
| **Delivery thực tế** xảy ra lúc nào | Delivery Confirmation |
| Trip đang **chậm ở khâu nào** | khoảng cách giữa các event |
| **Chi phí phát sinh** trên Trip | Driver operational expense |
| **Completion Request** và kết quả xác nhận | bảng completion request |

★ Đây là lý do §10.6 đòi **cả scheduled time lẫn actual execution time**: thiếu một
trong hai thì không câu nào ở trên trả lời được.

---

## 2. Actors

| Actor | Trong Driver Portal | Trạng thái quyền |
|---|---|---|
| **SuperAdmin / CEO** | Cấp tài khoản Driver, phân công/đổi phân công, xem Trip và expense, xác nhận Completion Request, xem audit | **[CONFIRMED]** toàn quyền theo authorization hiện tại |
| **Operations / Điều độ** | Phân công Driver vào Trip | **[CONFIRMED]** đúng một quyền này. Phần còn lại **[DEFERRED]** |
| **Driver / Tài xế** | Nhận booking, thực hiện, khai expense, gửi Completion Request | **[CONFIRMED]** — xem §5, §8, §9, §10 |
| **Accounting / Kế toán** | — | **[DEFERRED]** toàn bộ. Xem §13 |

---

## 3. Driver identity & account lifecycle

**[CONFIRMED]** Driver là **User bình thường** trong hệ thống hiện tại, tài khoản do
**SuperAdmin cấp**. Không có hệ thống authentication riêng, không đăng nhập bằng số
điện thoại, không dùng PIN.

Vòng đời tài khoản giữ nguyên như nhân viên:

```text
SuperAdmin tạo tài khoản
        ↓
Hệ thống sinh mật khẩu tạm
        ↓
Mật khẩu tạm được giao cho Driver
        ↓
Driver đăng nhập lần đầu
        ↓
BẮT BUỘC đổi mật khẩu
        ↓
Sau đó mới sử dụng được hệ thống
```

**[CONFIRMED]** Trước khi đổi mật khẩu, Driver **không làm được bất cứ việc gì**.
Đây là hành vi hiện có, và Driver không phải ngoại lệ.

**[CONFIRMED]** SuperAdmin vô hiệu hoá được tài khoản Driver. Vô hiệu hoá **không**
xoá dữ liệu: mọi Trip, expense, assignment và execution event do người đó tạo vẫn
phải đọc được sau khi họ rời đi.

### 3.1 ★ Department — và điều nó KHÔNG dùng để làm

**[CONFIRMED]** Driver phải có membership theo bất biến hiện tại (mỗi user active có
**đúng một** active membership). Tạo **một department riêng cho Driver / Đội xe** —
tên có thể là **"Đội xe"** nếu hợp convention hiện tại.

★ **[CONFIRMED] Department CHỈ phục vụ identity/organization.**

```text
ĐÚNG:  Trip access  ←  active Driver Assignment
SAI:   Trip access  ←  department của Driver
```

⚠ **Không bao giờ dùng department làm cơ chế xác định Trip nào Driver được xem.**
Hai người cùng phòng "Đội xe" **không** vì thế mà thấy chuyến của nhau. Bán kính dữ
liệu đến từ **assignment đang active**, không đến từ đơn vị tổ chức.

★ **[CONFIRMED] Driver KHÔNG phải một role mới trong authorization core.**

Tư cách thực hiện chuyến của một người được xác lập bằng **việc người đó được
Operations/Điều độ phân công vào Trip** — không bằng một nhãn gắn vào tài khoản.
Điều này không làm giảm quyền kiểm soát của SuperAdmin: SuperAdmin vẫn là người cấp
tài khoản, và là người (hoặc uỷ quyền Operations) phân công.

---

## 4. Trip assignment

### 4.1 Bản chất quan hệ

**[CONFIRMED]** Driver **nhận booking từ công ty** và thực hiện booking đó ngoài
thực tế. Trip là **nhiệm vụ được giao**, không phải đơn hàng Driver tự chọn.

```text
Operations / Điều độ
        │  phân công
        ▼
      Trip  ──────────  1 Driver ACTIVE tại một thời điểm
```

**[CONFIRMED] Không tồn tại trong mô hình này:** nhiều Driver cùng lúc · phụ xe ·
driver pool · marketplace · Driver tự chọn Trip.

### 4.1a ★ MÔ HÌNH B — thứ tự bắt buộc

**[CONFIRMED]** Thứ tự là ràng buộc nghiệp vụ, không phải gợi ý quy trình:

```text
Trip  →  Vehicle  →  Driver  →  Execution
```

| Bước | Ràng buộc |
|---|---|
| Trip | Operations tạo booking |
| **Vehicle** | ★ Phải được **xác định TRƯỚC** khi gán Driver |
| **Driver** | Gán sau khi đã có Vehicle |
| **Execution + Expense** | ★ Chỉ bắt đầu **SAU KHI** Trip đã có Vehicle |

★ **[CONFIRMED] Driver KHÔNG được khai expense khi Trip chưa có Vehicle.**

**Vì sao ràng buộc này quan trọng hơn vẻ ngoài:** quy tắc cấm khai `fuel`/`toll`
trên chuyến xe thuê (§8.6) **chỉ đánh giá được nếu đã biết xe**. Nếu Driver khai
được trước khi có xe, một khoản dầu khai lúc chưa biết xe sẽ trở thành vi phạm khi
xe thuê được gán sau đó — và không có thời điểm nào để chặn nó. Mô hình B loại bỏ
khả năng đó ở mức nghiệp vụ.

### 4.1b ★ Xe thuê ngoài đi CÙNG một execution flow

**[CONFIRMED]** Một Trip có **một Vehicle** và **một Driver chịu trách nhiệm thực
hiện**. Vehicle có thể là **xe công ty** hoặc **xe thuê ngoài** — và điều đó **không**
tạo ra một luồng riêng.

```text
Xe công ty      ─┐
                 ├─→  CÙNG MỘT execution flow:
Xe thuê ngoài   ─┘    nhận booking → thực hiện chuyến → khai chi phí phát sinh
                      → Delivery Confirmation → Completion Request
                      → SuperAdmin xác nhận DONE
```

★ **[CONFIRMED] KHÔNG tạo flow riêng cho xe thuê ngoài.** Driver của xe thuê ngoài
vẫn là Driver, vẫn được phân công vào Trip, vẫn đi qua đúng các bước trên, và vẫn
chịu ràng buộc "1 Trip = 1 Driver active".

⚠ **Điều này KHÔNG nới lỏng ranh giới tiền — xem §8.1b.**

### 4.1c ★ Vehicle: hai loại, một danh mục

**[CONFIRMED]** Xe công ty và xe thuê ngoài là **hai loại Vehicle trong cùng một hệ
thống**, cùng một danh mục xe. Loại xe là một **thuộc tính**, không phải một danh mục
thứ hai.

**[CONFIRMED]** **Nhà xe là một thực thể**, và **một nhà xe có nhiều xe**. Xe thuê
ngoài thuộc về một nhà xe.

```text
Nhà xe (carrier)
   └── Vehicle (xe thuê ngoài)   ─┐
                                  ├── cùng danh mục, khác thuộc tính "sở hữu"
       Vehicle (xe công ty)      ─┘
                 │
                 └── được dùng cho Trip, cùng một Driver assignment flow
```

### 4.1d ★ Xe thuê ⟹ bắt buộc có giá thuê. Chiều ngược lại KHÔNG đúng

**[CONFIRMED]** Ràng buộc là **một chiều**:

```text
Trip dùng xe thuê ngoài   ⟹   BẮT BUỘC có bản ghi giá thuê

Có bản ghi giá thuê       ⇏   Trip đó dùng xe thuê ngoài
```

★ Lý do chiều ngược lại không đúng: có thể tồn tại **dữ liệu giá / commercial pricing
độc lập**, không phải cứ có một con số giá là chuyến đó thuê xe ngoài.

### 4.1e ★ Trạng thái điều độ ≠ Sở hữu xe

**[CONFIRMED]** *"BOOK XE NGOÀI"* (trạng thái điều độ) và *"xe này là xe thuê"* (sở
hữu xe) là **hai thông tin khác nhau**:

| | Là gì | Ai quyết |
|---|---|---|
| **Trạng thái điều độ** | Một quyết định vận hành trên bảng lịch xe | Operations |
| **Sở hữu xe** | Một **dữ kiện** về chiếc xe | Dữ liệu danh mục |

★ Không suy diễn cái này từ cái kia. Một chuyến có thể ở trạng thái "BOOK XE NGOÀI"
vì lý do điều độ, và điều đó **không tự động** nói lên xe nào được dùng.

### 4.2 Lịch sử phân công — bắt buộc

**[CONFIRMED]** Phân công **phải có history**. Đổi Driver **không được** ghi đè làm
mất dấu người trước.

Hệ thống phải trả lời được, cho bất kỳ Trip nào:

| Câu hỏi | Bắt buộc |
|---|---|
| Ai được phân công | ✅ |
| Thời điểm bắt đầu mỗi lượt phân công | ✅ |
| Thời điểm kết thúc mỗi lượt phân công | ✅ |
| Ai thực hiện việc thay đổi assignment | ✅ |

★ **Mục tiêu là audit trách nhiệm.** Khi có tranh chấp về một chuyến — hàng hỏng,
chi phí bất thường, giao trễ — câu hỏi đầu tiên là *"lúc đó ai đang chạy"*, và hệ
thống phải trả lời được mà không cần hỏi người.

### ★ CURRENT ASSIGNMENT ≠ ASSIGNMENT HISTORY

**[CONFIRMED]** Đây là hai thứ khác nhau và không được nhầm lẫn:

| | **CURRENT ASSIGNMENT** | **ASSIGNMENT HISTORY** |
|---|---|---|
| Trả lời | *Ai đang được giao chuyến này **ngay bây giờ*** | *Ai đã từng được giao, trong khoảng nào, do ai thay đổi* |
| Số lượng | Đúng **1** tại một thời điểm | Nhiều bản ghi, cộng dồn theo thời gian |
| Ghi đè | Có thể thay đổi | ★ **KHÔNG BAO GIỜ ghi đè** |

★ **[CONFIRMED]** Nếu architecture phase chọn dùng một con trỏ "driver hiện tại"
trên chuyến (ví dụ `trip_schedules.driver_id`) cho tiện đọc, thì **con trỏ đó
KHÔNG được là nguồn duy nhất của historical provenance**. Ghi đè con trỏ mà không
ghi lại lượt cũ là làm mất lịch sử — đúng thứ mục này cấm.

Bốn dữ kiện phải giữ được cho **mỗi lượt** phân công, không chỉ lượt hiện tại:

```text
driver            ai được giao
trip              chuyến nào
assigned_at       bắt đầu khi nào
unassigned_at     kết thúc khi nào (nếu đã kết thúc)
actor             ai thực hiện việc phân công / thay đổi
```

**[CONFIRMED]** Không mở rộng thành multi-driver trong MVP. "Đúng 1 active Driver"
là ràng buộc về **current assignment**, không phải giới hạn về số bản ghi lịch sử.

### 4.3 Ai được phân công

**[CONFIRMED]** Operations / Điều độ · SuperAdmin (theo quyền toàn hệ thống).
**[DEFERRED]** Có vai trò nào khác được phân công hoặc đổi phân công không.

### 4.4 Truy vết chi phí về người khai

**[CONFIRMED]** Mỗi khoản expense phải truy được về **đúng người đã khai nó**, và
việc đổi Driver **không** làm thay đổi điều đó. Khoản do Driver A khai vẫn mãi là
khoản do Driver A khai, kể cả sau khi Trip chuyển sang Driver B.

---

## 5. Driver data boundary

### 5.1 Khái niệm — hai vùng dữ liệu tách biệt

**[CONFIRMED]**

| Vùng | Nội dung | Ai đọc |
|---|---|---|
| **DRIVER EXECUTION DATA** | Những gì cần để **thực hiện** booking | Driver + Backoffice |
| **COMMERCIAL / INTERNAL DATA** | Giá, tiền, biên lợi nhuận, ghi chú nội bộ | Chỉ Backoffice |

**DRIVER EXECUTION DATA** gồm: tên khách hàng · thông tin hàng hoá cần thiết · điểm
lấy hàng · điểm giao hàng · liên hệ hai đầu · ngày giờ theo lịch · thông tin xe cần
cho chuyến · **chỉ dẫn dành riêng cho Driver** · thông tin cần thiết khác để hoàn
thành booking.

### 5.2 "Chỉ dẫn cho tài xế" — vùng nội dung riêng

**[CONFIRMED]** *Chỉ dẫn cho tài xế* là vùng nội dung **dành riêng cho Driver**.

⚠ **Vai trò của nó thu hẹp sau DL-68.** Driver **đã** đọc được địa chỉ, liên hệ và
thông tin hàng hoá trực tiếp. Vậy `driver_instructions` **không** phải nơi chép lại
những thứ đó — nó là **đối trọng của `note`**: chỗ để điều độ viết chỉ dẫn dành cho
tài xế, khi nội dung đó lẽ ra sẽ bị gõ vào ô ghi chú nội bộ (vốn **không** expose).

★ **[CONFIRMED] Rủi ro còn lại, được chấp nhận có ý thức.** Bốn ô Driver đọc được
vẫn là **văn bản tự do** — về lý thuyết chúng vẫn có thể chứa một con số giá. DL-68
chấp nhận rủi ro đó cho các ô **phục vụ execution**, và bù lại bằng hai thứ: `note`
**không** expose, và Driver đọc qua một **read model riêng** (§5.4), không qua DTO
của Backoffice.

★ **Ghi chú nội bộ (`note`) và các ô văn bản tự do cũ KHÔNG được đưa nguyên trạng
sang Driver Portal** nếu chúng có nguy cơ chứa thông tin thương mại.

Lý do: ghi chú nội bộ là nơi người điều độ ghi mọi thứ, kể cả giá và điều khoản
thanh toán. Nội dung phải được **đưa vào có chủ đích** thì mới đến tay Driver.

★ **[CONFIRMED] Hướng kiến trúc ưu tiên** — bốn ràng buộc, không phải gợi ý:

| # | Ràng buộc |
|---|---|
| 1 | Thêm trường **`driver_instructions` có cấu trúc**, dành riêng cho Driver |
| 2 | Driver API **chỉ trả các field được whitelist** — danh sách cho phép, không phải danh sách chặn |
| 3 | **Không trả nguyên `note`**, và không trả nguyên bất kỳ free-text field nào **chưa được phân loại an toàn** |
| 4 | Commercial data bị **loại bỏ ở backend response boundary**, không phải ở giao diện |

★ **Đào tạo KHÔNG phải security control.** Việc dặn điều độ đừng gõ giá vào ghi chú
là **lớp bổ sung**, và nó không thay thế được ba ràng buộc kỹ thuật ở trên.

### 5.3 Bảng ranh giới dữ liệu

| Field / Domain | Backoffice | Driver | Lý do |
|---|---|---|---|
| Tên khách hàng | ✅ | ✅ | Cần để giao đúng nơi. Chọn từ danh mục — nội dung được kiểm soát |
| Xe (thông tin cần cho chuyến) | ✅ | ✅ | Cần để nhận đúng xe. Chọn từ danh mục |
| Ngày giờ theo lịch (lấy / giao) | ✅ | ✅ | Cần để thực hiện đúng giờ |
| **Điểm lấy hàng · điểm giao hàng** | ✅ | ✅ **[CONFIRMED]** | Bắt buộc để làm việc — DL-68 |
| **Liên hệ lấy hàng · liên hệ giao hàng** | ✅ | ✅ **[CONFIRMED]** | Bắt buộc để làm việc — DL-68 |
| **Thông tin hàng hoá** *(phần cần cho execution)* | ✅ | ✅ **[CONFIRMED]** | Cần biết chở gì, bao nhiêu, lưu ý gì — DL-68 |
| **Chỉ dẫn cho tài xế** | ✅ | ✅ | Vùng dành riêng cho Driver — §5.2 |
| **Ghi chú nội bộ** | ✅ | ❌ | Không kiểm soát được nội dung; có thể chứa dữ liệu thương mại |
| **Giá hàng hoá · giá lấy hàng · giá giao hàng** | ✅ | ❌ | Commercial. Không phục vụ việc thực hiện |
| **Tiền khách trả · customer recharge · doanh thu · lợi nhuận** | ✅ | ❌ | Commercial |
| **Giá thuê nhà xe ngoài** | ✅ | ❌ | Chi phí đối tác — thông tin thương mại nội bộ |
| **Tổng chi phí chuyến** | ✅ | ❌ | Con số tổng bao gồm cả chi phí thuê ngoài, nên nó **là** dữ liệu thương mại |
| **Operating expense do chính Driver khai** | ✅ | ✅ | §8.4. ⚠ Đây là **quyền đọc riêng**, không suy ra từ quyền khai — xem §8.5 |
| Toàn bộ expense của Trip mình chạy | ✅ | **[OPEN]** | §8.5 |
| Operating expense do **người khác** nhập vào cùng Trip | ✅ | **[OPEN]** | §8.5 |
| **Dữ liệu không cần cho execution** | ✅ | ❌ | DL-68 — nguyên tắc least privilege |
| Trip **không** được phân công cho Driver này | ✅ | ❌ | Driver chỉ thấy booking của mình |
| Danh mục khách hàng / đội xe đầy đủ | ✅ | ❌ | Không thuộc việc thực hiện chuyến |

### 5.4 Nguyên tắc thi hành

**[CONFIRMED]**

```text
Ẩn field ở giao diện KHÔNG PHẢI là ranh giới bảo mật.
Ranh giới bảo mật là NỘI DUNG MÀ MÁY CHỦ TRẢ VỀ.
```

Ba hệ quả bắt buộc:

1. Máy chủ **không bao giờ gửi** dữ liệu thương mại cho Driver — chứ không phải gửi
   rồi tin tưởng giao diện sẽ giấu.
2. ★ **Driver Portal KHÔNG được dùng đường đọc lịch xe của Backoffice.** Đường đó
   cho phép đọc **toàn bộ dữ liệu chuyến của công ty** và được thiết kế cho nhân
   viên văn phòng. Driver Portal phải có data boundary riêng.
3. Driver **chỉ** truy cập được Trip mà Driver được phân công.

### ★ Driver Execution Read Model

**[CONFIRMED]** Backend phải có một **Driver Execution Read Model riêng**.

```text
SAI:   lấy Trip DTO của Backoffice  →  ẩn field ở frontend
ĐÚNG:  read model riêng             →  máy chủ chỉ trả field thuộc execution
```

Một cột mới thêm vào bảng chuyến sau này **không** được tự động chảy sang Driver.

#### ★ 5.4.1 Whitelist — danh sách đóng · `DL-82`

**[CONFIRMED]** Read model là **whitelist**, không phải blacklist.

```text
BLACKLIST:  trả cả dòng, xoá vài field nhạy cảm   →  sai ngay khi thêm cột mới
WHITELIST:  gọi tên từng field được phép rời máy chủ  →  cột mới không xuất hiện
```

★ Khác biệt không phải phong cách. Blacklist hỏng **im lặng**: thêm cột `margin`
sang năm, không ai sửa bộ lọc, điện thoại tài xế bắt đầu hiển thị nó và **không
test nào đỏ**. Whitelist hỏng theo chiều ngược lại — cột mới đơn giản là không
xuất hiện cho tới khi có người quyết định là nên.

**Driver ĐƯỢC nhận:**

| Field | Nguồn |
|---|---|
| `tripId` | `trip_schedules.id` |
| `scheduledOn` | `scheduled_on` |
| `vehicle` — **chỉ** id + biển số | `trip_vehicles.plate` |
| `customer` — **chỉ** id + tên | `trip_customers.name` |
| `pickupAddress` · `pickupContact` | `trip_schedules` |
| `deliveryAddress` · `deliveryContact` | `trip_schedules` |
| `cargoInfo` | `cargo_info` |
| `scheduledPickupAt` · `scheduledDeliveryAt` | `pickup_at` · `delivery_at` |
| `driverInstructions` | `driver_instructions` |
| `assignment` — id + thời điểm gán | `trip_driver_assignments` |
| `events` | `trip_execution_events` (chưa void) |
| `expenses` | ★ **chỉ dòng của chính tài xế đó** — `source='driver_portal'` **và** `created_by = tài xế` |
| `accountability` | suy ra — §9.7.2 |
| `completion` | lần gửi mới nhất, **kèm lý do từ chối** |

**Driver KHÔNG nhận:**

| | Vì sao |
|---|---|
| `note` | ★ Free text **chưa có contract** về việc ai viết và viết gì vào đó. Không thể đưa cho người mà contract đang bảo vệ |
| `status` (dispatch) | Khái niệm của Operations. Tài xế hành động theo event và chỉ dẫn |
| Mọi khoản tiền của công ty | Giá khách · chi phí nội bộ · lợi nhuận · **giá thuê nhà xe** · điều khoản nhà cung cấp · kế toán |
| ★ **Tổng chi phí chuyến** | Tổng **bao gồm** giá thuê ngoài — chính là con số thương mại phải giấu. Màn hình tài xế **không cộng gì cả** |
| `created_by` · `archived_*` · `closed_*` | Bookkeeping nội bộ |

★ **Cách "tài xế không thấy tiền" được bảo đảm:** query của read model **không
join** `trip_costs` và `trip_outsource_hires` **chút nào**. Không có số tiền nào
trong result set để mà lọt — đúng nghĩa *by construction*, không phải *by filtering*.

#### 5.4.2 ⚠ Rủi ro còn lại — ghi ra, không giấu đi

**[CONFIRMED]** Năm field ở whitelist trên là **free text do Operations gõ**:
`cargoInfo` · hai địa chỉ · hai liên hệ. **Không có whitelist nào chặn được** việc
ai đó gõ một cái giá vào trong đó.

Chúng vẫn được đưa vào vì **tài xế không giao hàng được nếu thiếu**. Đây là rủi ro
**được chấp nhận có ý thức**, và `driverInstructions` tồn tại chính là để có **một**
field an toàn *by construction* thay vì an toàn *nhờ mọi người nhớ*.

★ Đây là câu trả lời cho **CONFLICT-1**. Nó **giảm** xung đột chứ không xoá bỏ.

---

## 6. Từ vựng chuẩn — Execution terminology

**[CONFIRMED]** Từ vựng dưới đây là chuẩn nghiệp vụ. Dùng thống nhất trong mọi tài
liệu, thiết kế và giao diện về sau.

| Thuật ngữ | Nghĩa nghiệp vụ |
|---|---|
| **Arrival Confirmation** | Driver xác nhận **đã đến** đúng điểm cần thực hiện |
| **Pickup Confirmation** | Driver xác nhận **đã hoàn tất lấy hàng** |
| **Delivery Confirmation** | Driver xác nhận **đã hoàn tất giao hàng** |
| **Completion Request** | Driver **gửi yêu cầu** xác nhận Trip đã hoàn thành |
| **Execution Event** | Khái niệm chung cho các sự kiện thực thi của Driver |

### ★ Execution Event là first-class concept

**[CONFIRMED]** Driver Execution Lifecycle được xây trên **sự kiện**, không phải
trên việc Driver tuỳ ý sửa một trường trạng thái.

```text
Driver action
     ↓
EXECUTION EVENT          ← bản ghi bất biến, có actor + thời điểm máy chủ
     ↓
Execution state / evidence   ← SUY RA từ chuỗi event
     ↓
Completion Request
     ↓
SuperAdmin approval
     ↓
Dispatch status = DONE
```

**[CONFIRMED] Ba event nghiệp vụ tối thiểu:**

| Event | Tương ứng |
|---|---|
| `ARRIVAL` | Arrival Confirmation |
| `PICKUP_CONFIRMED` | Pickup Confirmation |
| `DELIVERY_CONFIRMED` | Delivery Confirmation |

**[PROPOSED] / [OPEN]** Các event trung gian khác — chưa chốt, xem §7.3.

★ **[CONFIRMED] Hai điều cấm:**

1. **Không biến mọi event thành một giá trị của status enum.** Event là thứ *đã xảy
   ra*; status là thứ *đang đúng*. Nhân bản mỗi event thành một trạng thái sẽ tạo ra
   một enum phình to mà không trả lời thêm được câu hỏi nào.
2. **Driver KHÔNG được sửa trực tiếp `trip_schedules.status`** — hay bất kỳ trường
   trạng thái điều độ nào. Driver phát sinh event; trạng thái là hệ quả.

### ★ "Check-in / Check-out" — không phải business concept

**[CONFIRMED]** *Check-in / Check-out* **không** được dùng làm khái niệm nghiệp vụ.
Nó chỉ là **thuật ngữ giao diện/kỹ thuật cho phần xác minh GPS**, nếu sau này GPS
được triển khai (§11).

★ **Đặc biệt: Delivery Confirmation KHÔNG đồng nghĩa với Completed.**

```text
SAI:    Delivery Check-out  →  Trip = COMPLETED

ĐÚNG:   Delivery Confirmation
              ↓
        Driver submits Completion Request
              ↓
        SuperAdmin Review
              ↓
        APPROVED → Trip Completed
        REJECTED → Driver xử lý → Resubmit
```

### Hai chuỗi xác nhận

```text
Tại điểm LẤY HÀNG                Tại điểm GIAO HÀNG
─────────────────                ──────────────────
Arrival Confirmation             Arrival Confirmation
        ↓                                ↓
Pickup Confirmation              Delivery Confirmation
                                         ↓
                                 Completion Request
```

---

## 7. Hai lifecycle — tách biệt, không gộp

### 7.1 Nguyên tắc

**[CONFIRMED] KHÔNG gộp Dispatch Lifecycle và Driver Execution Lifecycle thành một
status machine duy nhất.**

| | **A. Dispatch Lifecycle** | **B. Driver Execution Lifecycle** |
|---|---|---|
| Ai quản lý | Backoffice / Operations | Driver tạo event, SuperAdmin xác nhận cuối |
| Trả lời câu hỏi | Chuyến này đang ở tình trạng nào **trên bảng điều độ** | Nhiệm vụ này đang ở **bước thực thi** nào ngoài thực tế |
| Trạng thái | 5 giá trị hiện có | Xem §7.3 |
| Trong task này | **[CONFIRMED] Giữ nguyên. Không thay đổi.** | Mô hình hoá mới |

★ Hai lifecycle **độc lập nhưng có quan hệ rõ ràng**: một chuyến có thể vừa ở một
trạng thái điều độ, vừa ở một bước thực thi. Gộp chúng vào một chỗ sẽ khiến một
trong hai nói sai.

**[DEFERRED]** Quan hệ ánh xạ chính xác giữa hai lifecycle — cụ thể là sự kiện nào ở
B kéo theo thay đổi nào ở A. Architecture phase đề xuất, CEO chốt.

### 7.2 Dispatch Lifecycle — giữ nguyên

**[CONFIRMED]** 5 trạng thái hiện có phục vụ công việc điều độ hằng ngày và mọi báo
cáo dựa trên chúng. **Không xoá, không đổi ý nghĩa, không thay đổi trong task này.**

### 7.3 Driver Execution Lifecycle — đề xuất

**[PROPOSED]** — trình bày để CEO xem xét. **Chưa** ràng buộc.

```text
ASSIGNED
   ↓
ACCEPTED                    [PROPOSED]
   ↓
AT_PICKUP                   [PROPOSED]   ← Arrival Confirmation
   ↓
PICKUP_CONFIRMED            [PROPOSED]   ← Pickup Confirmation
   ↓
IN_TRANSIT                  [PROPOSED]
   ↓
AT_DELIVERY                 [PROPOSED]   ← Arrival Confirmation
   ↓
DELIVERY_CONFIRMED          [PROPOSED]   ← Delivery Confirmation
   ↓
COMPLETION_REQUESTED
   ↓
SUPERADMIN_REVIEW
   ├── REJECTED  → RESUBMIT
   └── APPROVED  → COMPLETED
```

### 7.4 Điểm đã CONFIRMED trong lifecycle này

**[CONFIRMED]** Bất kể các bước trung gian được chốt thế nào:

1. **Driver KHÔNG được tự quyết trạng thái COMPLETED** — bằng bất kỳ đường nào, kể
   cả đường đổi trạng thái đang có sẵn cho Backoffice.
2. **SuperAdmin phải xác nhận Completion Request** thì Trip mới được coi là hoàn
   thành.
3. **Delivery Confirmation không phải Completed.**

**[DEFERRED]** Các trạng thái trung gian ở §7.3 — có cần đủ tám bước không, hay một
tập rút gọn là đủ.

---

## 8. Driver expense — phạm vi

### 8.1 Năm nhóm, và ranh giới tuyệt đối

**[CONFIRMED]** Driver khai báo chi phí **vận hành phát sinh trong quá trình thực
hiện booking**, đúng năm nhóm:

| # | Nhóm |
|---|---|
| 1 | Dầu |
| 2 | Cầu trạm |
| 3 | Phí kho |
| 4 | Bốc xếp |
| 5 | Tăng ca |

Các khoản này **thuộc về Trip**.

★ **[CONFIRMED] Ranh giới tuyệt đối:**

```text
DRIVER OPERATING EXPENSE        ≠        COMMERCIAL MONEY
─────────────────────────                ─────────────────────
Dầu, cầu trạm, phí kho,                  Giá hàng hoá
bốc xếp, tăng ca                         Phí lấy hàng
                                         Phí giao hàng
Tiền RA, do Driver khai                  Tiền khách trả
khi thực hiện booking                    Customer recharge
                                         Doanh thu · Lợi nhuận
```

### 8.1b ★ Hai loại tiền, có thể cùng một chuyến

**[CONFIRMED]** Sau §4.1b, một chuyến dùng xe thuê ngoài có thể mang **cả hai** loại
tiền cùng lúc. Chúng vẫn là **hai thứ khác nhau về nghiệp vụ**:

| | **DRIVER OPERATIONAL EXPENSE** | **OUTSOURCED VEHICLE HIRE** |
|---|---|---|
| Là gì | Chi phí phát sinh **trong quá trình Driver thực hiện Trip** | Chi phí công ty **thoả thuận với nhà xe** để thuê phương tiện |
| Gồm | Dầu · Cầu trạm · Phí kho · Bốc xếp · Tăng ca | Giá thuê · VAT · chứng từ |
| Ai khai | **Driver** — trách nhiệm của Driver | **Backoffice** — không phải Driver |
| Driver thấy? | ✅ khoản của chính mình | ❌ **tuyệt đối không** |

★ **[CONFIRMED] Không được trộn hai loại này** — kể cả khi chúng cùng thuộc một
chuyến. Ranh giới ngữ nghĩa phải giữ được để **báo cáo · phân quyền · audit · AI** về
sau không nhầm lẫn.

⚠ **[OPEN] — câu hỏi phát sinh từ chính quyết định này.** Trên một chuyến thuê ngoài,
Driver có khai operational expense không, và nếu có thì khai những khoản nào? Xem
§8.6.

### 8.6 ★ Chi phí trên chuyến thuê xe ngoài

**[CONFIRMED] Nguyên tắc:** Driver xe thuê ngoài **chỉ khai những khoản công ty phải
trả THÊM, ngoài giá thuê nhà xe**.

★ **[CONFIRMED] Cấm khai lại thứ đã nằm trong giá thuê — đặc biệt DẦU và CẦU TRẠM.**

Lý do nghiệp vụ: giá thuê là **giá trọn gói cho cả chuyến**, và nhiên liệu cùng phí
cầu đường của nhà xe **đã nằm bên trong con số đó**. Nếu tài xế xe thuê khai lại dầu,
sổ sách **tính hai lần** cho cùng một khoản chi — và không dữ liệu nào cho biết dòng
nào bị trùng.

| Nhóm | Xe công ty | Xe thuê ngoài |
|---|---|---|
| Dầu | ✅ khai | ❌ **cấm** — đã trong giá thuê |
| Cầu trạm | ✅ khai | ❌ **cấm** — đã trong giá thuê |
| Phí kho | ✅ khai | ✅ **khai được** — nếu công ty thực tế phát sinh/trả |
| Bốc xếp | ✅ khai | ✅ **khai được** — nếu công ty thực tế phát sinh/trả |
| Tăng ca | ✅ khai | ✅ **khai được** — nếu công ty thực tế phát sinh/trả |

★ **[CONFIRMED] Giá thuê xe ngoài KHÔNG phải "gói trọn mọi chi phí phát sinh".**

Nó bao gồm **nhiên liệu và phí cầu đường của nhà xe** — đó là lý do `fuel` và `toll`
bị loại. Nó **không** vì thế mà bao gồm phí kho, bốc xếp hay tăng ca. Ba nhóm đó
Driver **khai được**, với điều kiện **công ty thực tế phát sinh hoặc chi trả**.

⚠ **Điều kiện "công ty thực tế trả" là một sự thật nghiệp vụ, không phải một ràng
buộc dữ liệu.** Database không biết ai đã trả tiền. Nó chỉ enforce được phần suy ra
từ **sở hữu xe** — tức là lệnh cấm `fuel`/`toll`. Phần còn lại thuộc về khai báo
trung thực và khâu review.

**[CONFIRMED]** Dù kết luận thế nào: **giá thuê xe ngoài tuyệt đối KHÔNG phải Driver
operational expense**, và hai thứ không bao giờ được cộng chung như một loại.

### 8.2 Driver là người trực tiếp khai

**[CONFIRMED]** Driver là người **trực tiếp khai báo** chi phí phát sinh trong quá
trình thực hiện booking.

### 8.3 Driver không chạm tới commercial money

**[CONFIRMED]** Driver **không** khai, **không** nhìn thấy, và **không** có bất kỳ
đường nào chạm tới nhóm bên phải của bảng §8.1.

### 8.4 Driver thấy gì về chi phí

**[CONFIRMED]** Driver được thấy:

- khoản chi vận hành **do chính mình khai báo**
- **trạng thái** của khoản chi đó
- dữ liệu cần thiết để **sửa trước khi khoá**

### 8.5 ★ Quyền khai và quyền đọc là HAI quyền độc lập

**[CONFIRMED]** Quyền **đọc** expense **không được suy ra** từ quyền **khai**
expense. Chúng phải chốt được riêng, và phải thi hành được riêng.

```text
SAI:   Driver khai được  →  nghĩa là Driver đọc được
ĐÚNG:  hai quyền riêng biệt, quyết định riêng, kiểm tra riêng
```

Ba câu hỏi **tách bạch**, không được trả lời gộp:

| # | Câu hỏi | Trạng thái |
|---|---|---|
| R-1 | Driver có xem được expense **do chính mình khai** không? | **[CONFIRMED] CÓ** — §8.4 |
| R-2 | Driver có xem được **toàn bộ expense của Trip mình chạy** không? | **[OPEN]** |
| R-3 | Driver có thấy expense **do người khác nhập** vào cùng Trip không? | **[OPEN]** |

★ **Không tự chọn thay Business** cho R-2 và R-3.

---

## 9. Driver expense — vòng đời và quyền sửa

> ⚠ **Mục này thay thế quy định tương ứng ở bản 1.**

### 9.1 Driver được sửa khi còn editable

**[CONFIRMED]** Driver **được phép sửa** khoản chi phí do chính mình nhập, **nếu
khoản đó vẫn đang ở trạng thái editable**.

Ví dụ nghiệp vụ:

```text
Driver nhập:      Dầu = 1.500.000
Phát hiện nhầm:   Dầu = 1.200.000
→ ĐƯỢC sửa, vì khoản chi chưa được submit/khoá
```

### 9.2 Sau khi khoá — không sửa trực tiếp

**[CONFIRMED]** Sau khi khoản chi đã được **submit / locked**:

- **KHÔNG** cho edit trực tiếp
- Nếu cần sửa → **correction / void workflow**, với:
  - **lý do bắt buộc**
  - **giữ lại record cũ**
  - **tạo record mới**
  - **audit đầy đủ**
- **KHÔNG DELETE** trong mọi trường hợp

```text
Driver khai một khoản
        ↓
   [ EDITABLE ]  ──── Driver sửa được ────┐
        ↓                                  │
   SUBMIT / LOCK                           │
        ↓                                  │
   [ LOCKED ]  ← bản ghi tài chính, bất biến
        ↓
   Sai?  →  CORRECTION / VOID
              ├── lý do BẮT BUỘC
              ├── record cũ GIỮ NGUYÊN
              ├── record mới được tạo
              └── audit đầy đủ

        KHÔNG BAO GIỜ:  DELETE
```

### 9.3 ★ Một entity, ba khái niệm tách bạch

**[CONFIRMED]** Phải phân biệt rõ ba thứ. Nhầm lẫn giữa chúng là nguồn của mọi hiểu
sai về mục này:

| Khái niệm | Nghĩa |
|---|---|
| **Expense entity** | **MỘT** thực thể nghiệp vụ duy nhất. Nó **là** một khoản chi phí ngay từ lúc Driver khai — không có giai đoạn nào nó "chưa phải expense" |
| **Expense lifecycle** | Các trạng thái mà **cùng một** entity đó đi qua: `EDITABLE` ⇄ `LOCKED` → `IMMUTABLE`. ★ Vòng đời **có chu trình** — xem §9.6 |
| **Financial immutability boundary** | ★ **Mốc APPROVE, không phải mốc LOCK.** `LOCKED` là **tạm khoá** và mở lại được khi bị từ chối; chỉ khi SuperAdmin **duyệt** thì khoản chi mới bất biến vĩnh viễn |

★ **Không mô tả khoản chi ở trạng thái editable như thể "nó chưa phải một khoản
chi".** Nó là một khoản chi, đang ở giai đoạn đầu của vòng đời của chính nó. Điều
thay đổi khi vượt mốc là **quyền sửa**, không phải **bản chất của thực thể**.

**Vì sao mốc nằm ở APPROVE:** một khoản chi chỉ thực sự "được dùng" khi SuperAdmin
đã xác nhận chuyến hoàn thành. Trước đó, kể cả khi đang `LOCKED`, nó vẫn là con số
đang chờ duyệt — và nếu đề nghị bị từ chối thì việc sửa nó chính là điều cần làm.

### 9.6 ★ Vòng đời expense — có chu trình

**[CONFIRMED]**

```text
      Driver khai
           ↓
    ┌─► EDITABLE ──────────────────────┐
    │      │                            │
    │      │ Driver gửi Completion Request
    │      ▼                            │
    │   LOCKED  ── toàn bộ expense của Trip khoá cùng lúc
    │      │                            │
    │      ├── SuperAdmin REJECT ───────┘   mở lại EDITABLE
    │      │
    │      └── SuperAdmin APPROVE
    │             ↓
    └────────  IMMUTABLE  ★ vĩnh viễn, cùng lúc Trip → DONE
```

| Mốc | Cái gì xảy ra |
|---|---|
| **Trước khi gửi đề nghị** | Driver khai · Driver **sửa được** khoản của chính mình |
| **Driver gửi Completion Request** | ★ **Toàn bộ expense của Trip bị khoá cùng lúc.** Không còn sửa trực tiếp |
| **SuperAdmin REJECT** | ★ Expense **mở lại EDITABLE**. Driver sửa khoản khai sai rồi **gửi lại**. Request cũ **giữ nguyên**; lý do từ chối **bắt buộc lưu** |
| **SuperAdmin APPROVE** | Trip → **DONE**. Expense **bất biến vĩnh viễn**: không sửa, không xoá trực tiếp |

★ **Khoá là hành động ở mức TRIP, không ở mức từng khoản.** Nó là hệ quả của việc
gửi Completion Request, không phải một nút riêng cho mỗi dòng chi phí.

**[DEFERRED]** Sau khi đã DONE, correction/void chỉ thuộc về **một quy trình quản trị
riêng chưa được định nghĩa**. Không tự thiết kế quy trình đó ở phase này.

### 9.7 ★ Khai báo chi phí — Driver phải nói, hệ thống không được suy diễn

**[CONFIRMED]** — `DL-81`

Mỗi **Completion Request** bắt buộc mang một khai báo tường minh, đúng một trong hai:

| Giá trị | Nghĩa |
|---|---|
| `none` | Driver khẳng định chuyến này **không phát sinh** khoản chi nào |
| `expenses` | Driver khẳng định **có** phát sinh, và đã khai đủ |

★ **Lý do tồn tại: KHÔNG dòng chi phí nào KHÔNG PHẢI là một câu trả lời.**

Một chuyến không có dòng chi phí có thể là *chuyến không tốn gì*, hoặc là *tài xế
quên khai*. Hai việc này khác hẳn nhau — một là **sự thật**, một là **thiếu sót** —
nhưng trong dữ liệu chúng **giống hệt nhau**: đều là zero row. Chỉ tài xế phân biệt
được, nên tài xế phải nói ra. `none` là một **lời khẳng định của con người**; việc
không có dòng nào thì không phải.

**[CONFIRMED]** Khai báo được **nêu lại ở mỗi lần gửi**. Resubmit sau REJECT sinh ra
một Completion Request **mới**, mang khai báo **mới** — không kế thừa câu trả lời của
lần trước.

#### 9.7.1 Ràng buộc nhất quán

**[CONFIRMED]** Khai báo phải khớp với dữ liệu tài xế đã nhập. Hệ thống **từ chối**
việc gửi khi hai vế mâu thuẫn:

| Khai báo | Còn khoản chi **chưa void** | Kết quả |
|---|---|---|
| `none` | có | ❌ **Từ chối** — void các khoản đó trước, hoặc khai `expenses` |
| `expenses` | không | ❌ **Từ chối** — khai các khoản trước, hoặc khai `none` |
| `none` | không | ✅ |
| `expenses` | có | ✅ |

★ **Khoản đã VOID không tính là "còn khoản chi".** Một khoản bị thu hồi không còn
được tính vào bất kỳ tổng nào (§8), nên nó cũng không được buộc tài xế phải khai
`expenses`. Chuyến chỉ còn toàn khoản đã void là chuyến khai `none` hợp lệ.

★ **Vì sao là ràng buộc chứ không phải cảnh báo.** Cả hai vế đều do **chính tài xế**
nhập, nên lệch nhau là **lỗi nhập liệu**, không phải hai ý kiến khác nhau. Và nếu cho
phép lệch thì hai trạng thái `DECLARED_NO_EXPENSE` và `DECLARED_WITH_EXPENSE` ở
§9.7.2 mất nghĩa — không ai đọc được chuyến đó thực sự là loại nào.

#### 9.7.2 Năm trạng thái trách nhiệm chi phí

**[CONFIRMED]** Read model phải phân biệt được **năm** trạng thái, **suy ra** từ lịch
sử Completion Request — **không lưu** thành cột:

| Trạng thái | Suy ra từ |
|---|---|
| `NOT_DECLARED` | Chưa có Completion Request nào |
| `DECLARED_NO_EXPENSE` | Lần gửi mới nhất khai `none` |
| `DECLARED_WITH_EXPENSE` | Lần gửi mới nhất khai `expenses` |
| `REJECTED_NEEDS_CORRECTION` | Lần gửi mới nhất bị `rejected` |
| `APPROVED_IMMUTABLE` | Tồn tại một request `approved` — **thắng mọi giá trị khác** |

★ **Hai giá trị đầu là toàn bộ lý do mục này tồn tại.** `NOT_DECLARED` và
`DECLARED_NO_EXPENSE` đều hiển thị **không có tiền**. Một cái là **nghĩa vụ chưa
làm**, một cái là **chuyến đã xong**. Màn hình nào gộp hai cái đó lại là màn hình
giấu đi đúng những chuyến cần đi đòi.

### 9.4 Ghi nhận actor và thời điểm

**[CONFIRMED]**

- Danh tính người khai **luôn** lấy từ phiên đăng nhập. Không có đường nào để một
  yêu cầu tự khai mình là người khác.
- Thời điểm do **máy chủ** ghi, không lấy từ thiết bị gửi lên.

### 9.5 [DEFERRED] — architecture phase phải làm rõ, CEO chốt

| # | Chưa chốt |
|---|---|
| ~~E-1~~ | ✅ **CHỐT** — `EDITABLE` khi khai; `LOCKED` khi gửi Completion Request (§9.6) |
| ~~E-2~~ | ✅ **CHỐT** — khoá **khi Driver gửi Completion Request**, toàn bộ expense của Trip cùng lúc |
| ~~E-3~~ | ✅ **CHỐT** — không ai submit từng khoản; khoá là hệ quả của Completion Request do **Driver** gửi |
| E-4 | Void / correct **sau khi đã DONE** — thuộc quy trình quản trị riêng (§9.6) |
| E-5 | Hình dạng **audit history** cho các lần sửa trước khi khoá |
| E-6 | Có bước **duyệt** chi phí không, và ai duyệt |
| E-7 | Có bắt buộc **ảnh chứng từ** không |
| E-8 | Operations có được nhập chi phí thay Driver không |

★ **Không tự quyết các chi tiết này.** Không tự mở quyền Operations hoặc Accounting
với chi phí khi chưa có contract.

**[PROPOSED] — một lưu ý kỹ thuật để architecture phase cân nhắc, không phải quyết
định:** hệ thống hiện tại **không có** khái niệm trạng thái sửa được cho khoản chi,
và **không có đường sửa nào ở bất kỳ tầng nào** — đó là thiết kế có chủ đích để bảo
vệ tính bất biến.

Cách đọc giữ được cả hai yêu cầu là: **tính bất biến gắn với MỐC KHOÁ, không gắn với
sự tồn tại của bản ghi.** Một khoản chi vẫn là một khoản chi từ lúc được khai; điều
mốc khoá quyết định là **từ thời điểm nào nó không còn sửa trực tiếp được nữa**.

Đây là đề xuất, không phải quyết định.

---

## 10. Completion

### 10.1 Luồng bắt buộc

**[CONFIRMED]**

```text
Trip assigned
    ↓
Driver receives booking
    ↓
Driver executes booking
    ↓
Arrival / Pickup / Delivery Confirmations
    ↓
Driver khai / sửa expense          ← EDITABLE
    ↓
Driver submits COMPLETION REQUEST
    ↓  ★ toàn bộ expense của Trip → LOCKED
SuperAdmin reviews
    ├── APPROVE → Trip DONE · expense IMMUTABLE vĩnh viễn
    └── REJECT  → rejection reason BẮT BUỘC + lưu history
                        ↓
                 ★ expense → mở lại EDITABLE
                        ↓
                   Driver sửa khoản khai sai
                        ↓
                    RESUBMIT  (request cũ giữ nguyên)
```

★ Bất biến của contract:

```text
DRIVER GỬI COMPLETION REQUEST
SUPERADMIN XÁC NHẬN
```

### 10.2 Mỗi Completion Request là một record riêng

**[CONFIRMED]**

- Mỗi Completion Request là **một record / history riêng**.
- **Không overwrite** request cũ.
- **Rejection reason phải được persist.**

★ **[CONFIRMED] Không được lặp lại lỗi hiện có.** Hệ thống đã có hai luồng duyệt mà
giao diện thu lý do từ chối rồi backend **bỏ đi**. Đó là nợ sản phẩm đã ghi nhận.
Completion Request **không** được đi vào vết đó.

Một chuyến bị từ chối ba lần phải đọc lại được cả ba lần, kèm ba lý do.

### 10.3 Lịch sử bắt buộc

**[CONFIRMED]** Mỗi hành động để lại dấu vết riêng:

| Hành động | Phải truy được |
|---|---|
| **SUBMIT** | ai gửi · thời điểm |
| **REJECT** | ai từ chối · thời điểm · **lý do (bắt buộc)** |
| **RESUBMIT** | ai gửi · thời điểm · lần thứ mấy |
| **APPROVE** | ai duyệt · thời điểm |

### 10.4 Ai duyệt

**[CONFIRMED]** SuperAdmin.
**[DEFERRED]** Có uỷ quyền cho vai trò nào khác không · có giới hạn số lần resubmit không.

⚠ *"Chuyến đã DONE có mở lại được không"* **không còn là câu hỏi mở** — §10.5 đã
chốt: **không**.

### 10.5 ★ DONE là điểm cuối vĩnh viễn

**[CONFIRMED]** Trip được SuperAdmin xác nhận DONE thì **kết thúc vĩnh viễn**.
**KHÔNG reopen**, không có ngoại lệ.

**[CONFIRMED] Bốn hệ quả, tất cả đều bắt buộc:**

| # | Khi Trip đã DONE |
|---|---|
| 1 | **Không reopen** |
| 2 | **Không** tạo Completion Request mới |
| 3 | **Không** sửa trạng thái ngược |
| 4 | Phải có **audit/provenance đầy đủ** về ai xác nhận và khi nào |

★ *"Không tạo Execution Event mới"* và *"không tạo expense mới"* sau DONE — xem
[`design.md`](design.md) §B-18.8, nơi liệt kê đủ **năm** nghĩa vụ chứng minh.

**[CONFIRMED]** Completion phải dựa trên **Execution Events** và **Delivery
Confirmation** — không phải một thao tác đổi trạng thái đứng một mình.

★ *"Check-in / check-out"* **không** được dùng làm tên của lifecycle hay của business
status. Từ vựng chuẩn ở §6 là bắt buộc.

✅ **[LEGACY — ĐÃ XỬ LÝ]** `PATCH /trip-schedules/:id/status` từng không kiểm tra
thứ tự, nên chuyến "ĐÃ XONG" đặt ngược lại được và không để dấu vết. Nay `done`
không đặt được qua board ở cả hai đường ghi status, mọi lần chuyển đều ghi vào
`trip_status_history`, và trigger `trip_schedules_guard_done` (`0017`) chốt lại ở
tầng cơ sở dữ liệu. Trip chỉ đóng bằng cách duyệt Completion Request.

### 10.6 ★ Thời gian: dự kiến và thực tế

**[CONFIRMED]** Timezone nghiệp vụ là **Asia/Ho_Chi_Minh**.

**[CONFIRMED]** Hệ thống phải lưu được **cả hai**:

| | Nghĩa | Nguồn |
|---|---|---|
| **Scheduled time** | Giờ dự kiến lấy / giao theo kế hoạch | Điều độ nhập |
| **Actual execution time** | Giờ thực tế Driver xác nhận | Execution Event, **do máy chủ ghi** |

★ Mục đích: để sau này dựng được rule giám sát **đúng giờ**. Không có cả hai thì
không so sánh được, và không so sánh được thì không có gì để giám sát.

---

## 11. GPS / Location — FUTURE

**[FUTURE] — chưa phải MVP. Không implement ở phase này.**

**[CONFIRMED]** Architecture **phải để sẵn extension point** cho GPS, để việc thêm
sau này không phải thiết kế lại vòng đời thực thi.

★ **[CONFIRMED] GPS KHÔNG được gọi là "proof tuyệt đối".** Nó là **evidence /
verification signal**, không phải nguồn sự thật duy nhất.

Nếu sau này triển khai, GPS chèn vào **giữa** hai bước xác nhận đã có:

```text
Tại điểm LẤY HÀNG                    Tại điểm GIAO HÀNG
─────────────────                    ──────────────────
Arrival Confirmation                 Arrival Confirmation
        ↓                                    ↓
GPS verification / geofence          GPS verification / geofence
        ↓                                    ↓
Pickup Confirmation                  Delivery Confirmation
```

### Face verification

**[FUTURE]** — và **không** phải giải pháp thay thế GPS.

```text
Face verification trả lời:   "đúng người không?"
GPS trả lời:                 "thiết bị có ở vị trí đó không?"
```

★ **Hai vấn đề khác nhau.** Không cái nào thay thế cái nào.

---

## 12. AI — FUTURE / service riêng

**[CONFIRMED]** AI là **source/service riêng**. Không nhúng logic AI vào Driver
Portal, cũng không nhúng vào backend core.

**[CONFIRMED]** AI là **decision-support**, **không phải source of truth**.

```text
Backend  (source of truth)
    ↓  dữ liệu/sự kiện đã chuẩn hoá, đã được kiểm soát quyền
AI Service
    ↓  anomaly / risk signal
Cảnh báo
    ↓
SuperAdmin  ──  quyết định
```

**[FUTURE]** AI có thể phân tích: lịch sử chi phí · tần suất đổ dầu · số tiền ·
khoảng cách · thời gian · tuyến đường · execution events · các bất thường khác.

Ví dụ:

```text
Hôm qua:  Dầu = 1.500.000
Hôm nay:  Dầu = 1.500.000
→ AI flag: "Unusual fuel expense pattern"
```

**[CONFIRMED] AI KHÔNG được:**

| Cấm |
|---|
| Tự kết luận *"Driver gian lận"* |
| Tự khoá tài khoản Driver |
| Tự huỷ chi phí |
| Tự duyệt Completion Request |
| Tự đổi trạng thái Trip |
| Trở thành nguồn sự thật cho bất kỳ dữ liệu nghiệp vụ nào |

### Thứ tự bắt buộc

★ **[CONFIRMED] Business rule deterministic phải chạy TRƯỚC AI.**

Ví dụ trên là một phép tra cứu xác định — nó cho kết quả nhất quán, giải thích được,
và không sai theo cách khó lường. AI dành cho tầng cao hơn: nhận diện mẫu · giải
thích theo ngữ cảnh · chấm điểm rủi ro · tương quan nhiều nguồn · hỗ trợ điều tra.

---

## 13. Operations & Accounting

### Operations / Điều độ

**[CONFIRMED]** Operations phân công Driver vào Trip.

**[DEFERRED] — không tự mở rộng.** Chưa chốt và **không** mặc định cấp: xem/nhập/huỷ
chi phí · duyệt bất kỳ thứ gì về tài chính · truy cập commercial pricing · duyệt
Completion Request.

### Accounting / Kế toán

**[DEFERRED] — toàn bộ.** Contract này **không** thiết kế mô hình quyền của Kế toán.
Xem chi phí · nhập chi phí thay Driver · huỷ chi phí · duyệt chi phí · đối soát ·
truy cập commercial pricing — tất cả chốt ở một phase riêng.

★ **[CONFIRMED] Kế toán và Operations KHÔNG mặc định có quyền như SuperAdmin.**

---

## 14. Audit

**[CONFIRMED] Audit là first-class requirement**, không phải tính năng phụ.

Phải truy được:

| Sự kiện | Phải biết |
|---|---|
| **Assignment** | ai phân công · cho ai · bắt đầu khi nào · kết thúc khi nào · ai thay đổi |
| **Execution events** | ai · loại sự kiện · thời điểm · thuộc Trip nào |
| **Expense creation** | ai khai · khi nào · thuộc Trip nào |
| **Expense edits trước khi lock** | ai sửa · khi nào · sửa từ gì sang gì |
| **Expense void / correction** | ai · khi nào · **lý do** · record cũ · record mới |
| **Completion Request** | ai gửi · khi nào · lần thứ mấy |
| **Rejection** | ai · khi nào · **lý do** |
| **Approval** | ai · khi nào |

**[CONFIRMED] Ba quy tắc tuyệt đối:**

```text
KHÔNG DELETE lịch sử nghiệp vụ
KHÔNG OVERWRITE lịch sử quan trọng
THỜI ĐIỂM do MÁY CHỦ ghi, không lấy từ thiết bị
```

---

## 15. Security principles

**[CONFIRMED]**

```text
"Ẩn trên giao diện" KHÔNG PHẢI authorization.
```

| # | Yêu cầu bắt buộc |
|---|---|
| 1 | **Kiểm tra quyền ở máy chủ** — mọi truy cập, mọi lần |
| 2 | **Kiểm tra quyền sở hữu nhiệm vụ** — Driver chỉ chạm được Trip được phân công cho mình |
| 3 | **Ranh giới ở mức từng trường dữ liệu** — máy chủ không gửi thứ Driver không được thấy |
| 4 | **Least privilege** — Driver có đúng quyền tối thiểu để làm việc, không hơn |
| 5 | **Data boundary riêng cho Driver Portal** — không dùng lại đường đọc của Backoffice |

---

## 16. Những điểm hệ thống hiện tại chưa đáp ứng contract

Bảng này mô tả **hiện trạng**, không phải quyết định nghiệp vụ. Cột *Hiện trạng*
được cập nhật theo code trên nhánh, kèm bằng chứng.

| # | Contract yêu cầu | Hiện trạng | Mức |
|---|---|---|---|
| **L-1** | Driver chỉ thấy Trip của mình; Driver Portal có data boundary riêng | ✅ **Đã xử lý.** Routes riêng dưới `/driver`, đọc qua Driver Execution Read Model; quyền theo lượt phân công đang hiệu lực, không dùng đường đọc lịch xe của Backoffice | — |
| **L-2** | Quan hệ Trip ↔ Driver có history | ✅ **Đã xử lý.** `0014` `trip_driver_assignments`, 1 assignment `active` mỗi Trip, lượt cũ không bị ghi đè | — |
| **L-3** | Ranh giới dữ liệu ở mức trường | ⚠ **Đã xử lý một nửa.** Ranh giới **ở mức trường** đã có: read model whitelist từng trường, `note` nội bộ không lọt sang Driver. Nhưng địa chỉ · liên hệ · thông tin hàng hoá vẫn là **văn bản tự do**, nội dung vẫn không kiểm soát được | TRUNG BÌNH |
| **L-4** | Vùng "Chỉ dẫn cho tài xế" riêng | ✅ **Đã xử lý.** `0017` thêm `trip_schedules.driver_instructions`, tách hẳn khỏi `note` nội bộ | — |
| **L-5** | Hai lifecycle tách biệt; Completed phải qua duyệt | ✅ **Đã xử lý.** `done` không đặt được qua board ở cả hai đường ghi status; mọi lần chuyển ghi vào `trip_status_history`; trigger `trip_schedules_guard_done` (`0017`) chốt ở tầng CSDL | — |
| **L-6** | Completion Request có history, rejection reason được persist | ✅ **Đã xử lý.** `0017` `trip_completion_requests`; mỗi lần gửi là một bản ghi riêng; lý do từ chối bắt buộc bằng CHECK, không bị bỏ đi | — |
| **L-7** | Chi phí truy được về người khai **và** lượt assignment | ✅ **Đã xử lý.** `0016` thêm `trip_costs.driver_assignment_id`, bắt buộc với dòng do Driver khai | — |
| **L-8** | Driver không thấy tổng chi phí chuyến | ✅ **Đã xử lý.** Read model **không có trường tổng nào**, và chỉ trả về dòng do chính Driver khai — lọc theo cả `source` lẫn tác giả | — |
| **L-9** | Khoản chi có trạng thái **editable** rồi mới khoá (§9) | ✅ **Đã xử lý.** `0016` thêm vòng đời trên chính `trip_costs`; `state` mặc định `immutable` nên các dòng cũ giữ nguyên quy tắc của `0012` | — |
| **L-10** | Execution Event là khái niệm hạng nhất | ✅ **Đã xử lý.** `0015` `trip_execution_events` | — |
| **L-11** | Audit lưu cả các lần sửa trước khi khoá | ✅ **Đã xử lý.** `0016` `trip_cost_edits` | — |

★ **Không có mâu thuẫn nào ở ranh giới tiền.** Chi phí vận hành của Driver và tiền
thương mại của khách hàng nằm ở hai chỗ khác nhau, và nhóm thứ hai vẫn chưa được
xây. Contract §8.1 khớp với hệ thống hiện tại.

★ **L-9 đã hết là mâu thuẫn.** Cách hoà giải trên thực tế là mở rộng chính
`trip_costs` thay vì dựng bảng thứ hai; bản ghi tài chính cũ giữ nguyên tính bất
biến vì `state` mặc định là `immutable`.

⚠ Điều đó **không** nâng cấp §9.5 thành quyết định. Đề xuất ở §9.5 vẫn là
**[PROPOSED]**, và các mục **[DEFERRED]** E-4…E-8 của nó — void sau DONE, duyệt,
chứng từ, Ops nhập thay — vẫn **chưa được quyết**. Tài liệu này ghi *cái đã được
xây*, không tự chốt thay CEO.

★ **L-3 là mục duy nhất còn mở.** Contract yêu cầu ranh giới ở mức trường và điều
đó đã có; nhưng nội dung *bên trong* các trường văn bản tự do vẫn phụ thuộc vào
người nhập. Đây là vấn đề quy trình, không phải schema, và chưa có quyết định
nghiệp vụ nào cho nó.

---

## 17. IMPLEMENTATION GATE

### Phase 1 — Driver access & assignment

```text
[CONFIRMED]  Tài khoản Driver — User bình thường, email công ty, SuperAdmin cấp
[CONFIRMED]  Department "Đội xe" — CHỈ cho identity, KHÔNG cho trip access (§3.1)
[CONFIRMED]  Mật khẩu tạm + bắt buộc đổi lần đầu
[CONFIRMED]  Driver KHÔNG phải role mới trong authorization core
[CONFIRMED]  Assignment Trip ↔ Driver, 1 Driver active tại một thời điểm
[CONFIRMED]  Assignment history đầy đủ — không overwrite
[CONFIRMED]  Driver chỉ thấy booking được phân công cho mình
[CONFIRMED]  Data boundary riêng — không dùng đường đọc lịch xe của Backoffice
[CONFIRMED]  Kiểm tra quyền ở máy chủ, không dựa vào giao diện
```

### Phase 2 — Execution data & expense

```text
[CONFIRMED]  Vùng "Chỉ dẫn cho tài xế" tách khỏi ghi chú nội bộ
[CONFIRMED]  Cách ly commercial data — Driver Execution Read Model riêng (§5.4)
[CONFIRMED]  Driver đọc địa chỉ · liên hệ · thông tin hàng hoá (DL-68)
[CONFIRMED]  MÔ HÌNH B — Vehicle trước Driver trước Execution (§4.1a)
[CONFIRMED]  Driver khai 5 nhóm operating expense, CHỈ khi Trip đã có Vehicle
[CONFIRMED]  Driver SỬA ĐƯỢC khoản của mình khi còn editable
[CONFIRMED]  Khoá khi gửi Completion Request — toàn bộ expense của Trip cùng lúc
[CONFIRMED]  REJECT → mở lại EDITABLE; APPROVE → bất biến vĩnh viễn (§9.6)
[CONFIRMED]  Driver thấy khoản của mình và trạng thái của nó
[CONFIRMED]  Audit chi phí — gồm cả các lần sửa trước khi khoá
[DEFERRED]   E-4…E-8 (§9.5): void sau DONE, duyệt, chứng từ, Ops nhập thay
```

### Phase 3 — Execution lifecycle & completion

```text
[CONFIRMED]  Execution Event là khái niệm hạng nhất
[CONFIRMED]  Arrival / Pickup / Delivery Confirmation
[CONFIRMED]  Delivery Confirmation ≠ Completed
[CONFIRMED]  Driver gửi Completion Request
[CONFIRMED]  SuperAdmin approve / reject
[CONFIRMED]  Rejection reason bắt buộc và ĐƯỢC LƯU
[CONFIRMED]  Mỗi request là một record riêng — không overwrite
[CONFIRMED]  Driver resubmit được
[PROPOSED]   State machine 8 bước ở §7.3
[DEFERRED]   Ánh xạ giữa Dispatch và Execution lifecycle
[CONFIRMED]  DONE là điểm đóng vĩnh viễn — không reopen (§10.5)
[DEFERRED]   Giới hạn số lần resubmit
```

### Future — không phải điều kiện của MVP

```text
[FUTURE]  GPS verification / geofencing  (extension point phải có sẵn)
[FUTURE]  GPS gắn trên xe
[FUTURE]  Face verification  (KHÔNG thay thế GPS)
[FUTURE]  Ràng buộc thiết bị
[FUTURE]  OCR hoá đơn / chứng từ
[FUTURE]  AI anomaly detection  (service riêng, decision-support)
[FUTURE]  Phát hiện gian lận nâng cao
[FUTURE]  Quy trình nghiệp vụ Kế toán
[FUTURE]  Quyền truy cập commercial pricing
```

---

*Tài liệu này là BUSINESS CONTRACT — nguồn sự thật về nghiệp vụ cho Driver Portal.
Không kèm code, migration, API, UI hay thay đổi phân quyền. Mọi mục **[PROPOSED]**
cần CEO chốt trước khi được coi là ràng buộc; mọi mục **[DEFERRED]** cần chốt trước
khi thiết kế phần tương ứng; mọi mục **[FUTURE]** không được biến thành điều kiện
bắt buộc của MVP; mọi mục **[LEGACY]** phải được architecture phase xử lý.*
