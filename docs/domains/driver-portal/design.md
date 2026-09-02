# Driver Portal — Technical Design

> **Loại:** DESIGN · **Trạng thái vòng đời:** `workik-reviewed` → chờ **CEO decisions (W-12)** rồi schema final review
> · **Ngày:** 2026-08-30 · **Migration cao nhất:** `0012_trip_cost.sql`
>
> Không có SQL, migration, code, API hay UI trong tài liệu này.
>
> ★ **Nguồn sự thật nghiệp vụ:** [`contract.md`](contract.md) — tài liệu này **không**
> tạo ra business rule. Chỗ nào cần quyết định nghiệp vụ, nó dừng và trỏ sang
> [`decisions.md`](decisions.md).
>
> ★ **Workik verdict: `READY FOR CLAUDE DESIGN UPDATE`** — **KHÔNG** phải
> `READY FOR MIGRATION`. Cổng migration ở §W-13; hiện mới qua 1/4 cổng.

## Cách đánh số

Tài liệu này hợp nhất hai tài liệu trước. Số mục giữ nguyên gốc, có tiền tố để mọi
tham chiếu cũ vẫn tra được:

| Tiền tố | Nguồn gốc |
|---|---|
| **§0.n** | End-to-end operational flow — bức tranh toàn cảnh, đọc trước |
| **§A-n** | Khảo sát kỹ thuật (DISCOVERY cũ) |
| **§B-n** | Thiết kế DB & gates (DB-DESIGN-BRIEF cũ) |
| **contract §n** | Trỏ sang [`contract.md`](contract.md) — **không** đổi |

| Nhãn | Nghĩa |
|---|---|
| **[CONFIRMED]** | Contract đã chốt. Ràng buộc |
| **[PROPOSAL]** / **[REC]** | Đề xuất kỹ thuật. **Không** phải quyết định |
| **[CEO DECISION]** | Cần Business Owner chốt — trạng thái ở [`decisions.md`](decisions.md) |
| **[WORKIK]** | Bắt buộc qua review kỹ thuật |
| **[GAP]** / **[LEGACY]** | Source hiện tại chưa hỗ trợ / đang vi phạm contract |

---

---

# PHẦN 0 — END-TO-END OPERATIONAL FLOW

> **[CONFIRMED]** → [`contract.md`](contract.md) §1.1
>
> Đây là bức tranh toàn cảnh. Driver Portal là **một mắt xích**, không phải một hệ
> thống độc lập — nó chia sẻ **cùng một Trip lifecycle** với Backoffice.

## 0.1 Chuỗi vận hành

```text
 BOOKING          ĐIỀU PHỐI        GÁN XE          GÁN DRIVER
    │                 │               │                 │
    ▼                 ▼               ▼                 ▼
 Operations ────► Operations ───► Operations ───► Operations
                                      │                 │
                            ★ MÔ HÌNH B: Vehicle TRƯỚC Driver
                                                        │
                                                        ▼
                                            ┌─── DRIVER EXECUTION ───┐
                                            │                        │
                                   Arrival at Pickup                 │
                                            ↓                        │
                                   Pickup Confirmation      Driver Operational
                                            ↓                    Expense
                                   Arrival at Delivery      (chỉ SAU khi có Vehicle)
                                            ↓                        │
                                   Delivery Confirmation             │
                                            └──────────┬─────────────┘
                                                       ▼
                                             COMPLETION REQUEST      ← Driver gửi
                                                       ▼
                                             SUPERADMIN REVIEW
                                                       │
                                        ┌──────────────┴──────────────┐
                                     APPROVED                     REJECTED
                                        ▼                             ▼
                                   ★ TRIP DONE                 lý do BẮT BUỘC
                                   đóng vĩnh viễn                     ▼
                                        │                        Driver xử lý
                                        ▼                             ▼
                          CSKH · báo giá · đối soát · quản trị    RESUBMIT
```

## 0.2 Bảng trách nhiệm — từng bước

| # | Bước | Actor | Input | State / Event | Timestamp | Audit bắt buộc |
|---|---|---|---|---|---|---|
| 1 | **Booking** | Operations | Khách hàng · hàng hoá · điểm lấy/giao · giờ dự kiến | Trip được tạo · dispatch status | `scheduled_on` · `pickup_at` · `delivery_at` — **scheduled** | `created_by` · `created_at` |
| 2 | **Điều phối** | Operations | Quyết định vận hành | Dispatch status đổi | server | ⚠ **GAP** — hôm nay không lưu ai đổi status |
| 3 | **Gán xe** | Operations | Vehicle (công ty \| thuê ngoài) | `Trip.vehicle_id` | server | ⚠ **GAP** — xem §0.4 |
| 3b | *(nếu xe thuê)* | Operations / Kế toán | Giá thuê · VAT · chứng từ | Outsourced Vehicle Hire | server | `created_by` · `created_at` — **đã có** |
| 4 | **Gán Driver** | Operations | Driver (1 active) | Driver Assignment `active` | `assigned_at` | `assigned_by` · `assigned_via` |
| 5 | **Đến điểm lấy** | **Driver** | — | Execution Event `ARRIVAL@PICKUP` | ★ **actual**, máy chủ ghi | `driver_id` · `assignment_id` |
| 6 | **Xác nhận lấy hàng** | **Driver** | — | Execution Event `PICKUP_CONFIRMED` | ★ actual | như trên |
| 7 | **Khai chi phí** | **Driver** | 5 nhóm · số tiền | Expense `draft` → `locked` | `created_at` · `locked_at` | `created_by` · `source` · snapshot ownership · log sửa trước khoá |
| 8 | **Đến điểm giao** | **Driver** | — | Execution Event `ARRIVAL@DELIVERY` | ★ actual | như bước 5 |
| 9 | **Xác nhận giao hàng** | **Driver** | — | Execution Event `DELIVERY_CONFIRMED` | ★ actual | như trên |
| 10 | **Gửi đề nghị hoàn thành** | **Driver** | — | Completion Request `pending` | `submitted_at` | `submitted_by` · `attempt_no` |
| 11 | **Xét duyệt** | **SuperAdmin** | Quyết định + lý do nếu từ chối | `approved` \| `rejected` | `decided_at` | `decided_by` · ★ `decision_reason` **bắt buộc khi từ chối** |
| 12a | **Duyệt → DONE** | **SuperAdmin** | — | ★ **Trip DONE — đóng vĩnh viễn** | server | đủ provenance ai xác nhận, khi nào |
| 12b | **Từ chối → làm lại** | Driver / Operations | — | Driver resubmit (request **mới**, không ghi đè) | `submitted_at` mới | lịch sử đủ cả n lần |
| 13 | **Sử dụng dữ liệu** | Backoffice · CSKH · Kế toán | — | đọc | — | — |

## 0.3 Ai thao tác ở đâu — ba ranh giới

| Vùng | Bước | Không được làm |
|---|---|---|
| **Operations** | 1 · 2 · 3 · 3b · 4 | ❌ Không phát sinh Execution Event thay Driver *(trừ khi có contract riêng — chưa có)* |
| **Driver** | 5 · 6 · 7 · 8 · 9 · 10 | ❌ Không sửa `trip_schedules.status` · ❌ Không tự đặt DONE · ❌ Không khai expense khi chưa có Vehicle · ❌ Không thấy giá thuê / tổng chi phí / dữ liệu thương mại |
| **SuperAdmin** | 11 · 12a | Là **người duy nhất** xác nhận hoàn thành |

## 0.4 ★ Hai trục thời gian — và vì sao cần cả hai

```text
SCHEDULED  (dự kiến)          ACTUAL  (thực tế)
pickup_at, delivery_at        Execution Event.occurred_at
do Operations nhập            ★ do MÁY CHỦ ghi, không lấy từ thiết bị
         │                              │
         └──────────  so sánh  ──────────┘
                         ▼
        đúng giờ? · trễ bao lâu? · chậm ở khâu nào?
```

**[CONFIRMED]** Timezone nghiệp vụ: **`Asia/Ho_Chi_Minh`** — contract §10.6.

★ Thiếu một trong hai trục thì **không câu hỏi quản trị nào ở contract §1.2 trả lời
được**. Đó là toàn bộ lý do Execution Event tồn tại như một khái niệm hạng nhất.

## 0.5 Từ vựng canonical

| Dùng | Không dùng |
|---|---|
| Execution Event | ~~check-in / check-out~~ |
| Arrival at Pickup · Pickup Confirmation | ~~check-in điểm lấy~~ |
| Arrival at Delivery · Delivery Confirmation | ~~check-out điểm giao~~ |
| Completion Request → SuperAdmin Approval → DONE | ~~Driver đóng chuyến~~ |

★ *"Check-in / check-out"* chỉ được dùng **sau này**, và chỉ như tên gọi kỹ thuật của
cơ chế **GPS/geolocation** khi nó được triển khai làm **evidence** — không bao giờ là
tên của lifecycle. Xem contract §6.

## 0.6 GAP giữa flow này và source hiện tại

| Bước | Hiện trạng | GAP |
|---|---|---|
| 1 Booking | ✅ đã có — `trip_schedules` | — |
| 2 Điều phối | ⚠ có status, **không lưu ai đổi và khi nào** | **GAP-9 / L-5** |
| 3 Gán xe | ✅ có `vehicle_id` — nhưng **không có khái niệm sở hữu** | **GAP-21** |
| 3b Hire | ✅ đã có — nhưng `carrier_name` là free text | **GAP-22 / GAP-24** |
| 4 Gán Driver | ❌ **không tồn tại** | **GAP-1 / L-2** |
| 5–6, 8–9 Execution Event | ❌ **không tồn tại** | **GAP-10 / L-10** |
| 7 Expense | ⚠ có `trip_costs`, **không có draft/lock, không có ownership snapshot** | **GAP-18/19/20 / L-9** |
| 10–11 Completion Request | ❌ **không tồn tại** | **GAP-15 / L-6** |
| 12a DONE vĩnh viễn | ⚠ ❌ **status đảo ngược được, không để dấu vết** | **L-5** — vi phạm contract §10.5 |
| 13 Sử dụng dữ liệu | ⚠ chưa có read model vận hành cho contract §1.2 | **GAP-28** |
| 2 Ai điều phối | ❌ **không lưu ai đổi dispatch status** | **GAP-29** ★ *(mới)* |
| 3 Xe nào thực hiện | ⚠ chỉ biết xe **hiện tại**, không có lịch sử đổi xe | **GAP-30** ★ *(mới)* |
| — "Expense chưa khai" | ❌ không phân biệt được với "không phát sinh" | **GAP-31** |
| — Lọc Trip theo **Vehicle** / **Customer** | ❌ API chỉ nhận `from`/`to`/`page`/`limit`. ★ **[GAP — CURRENT IMPLEMENTATION]**, không phải câu hỏi nghiệp vụ | **GAP-32** |

★ **Mười một trong mười ba bước cần dữ liệu chưa tồn tại.** Đó là quy mô thật của
phase này — không phải "thêm một portal", mà là **hoàn thiện vòng đời vận hành**.

---

## 0.7 ★ Canonical model — clarification

**[CONFIRMED]** Mục tiêu của phase này là **chuẩn hoá form lịch xe thủ công hiện tại
thành một operational system quản lý được end-to-end**:

```text
Booking → Operations planning → Customer → Vehicle → Driver
        → Pickup execution → Delivery execution → Expense
        → Completion Request → SuperAdmin approval → DONE
```

### Vehicle là domain dùng chung

**[CONFIRMED]** Canonical model:

```text
Trip → Vehicle → Driver → Execution
```

**[CONFIRMED] MVP:** `1 Trip = 1 Customer + 1 Vehicle + 1 Driver`. Xem §0.8.

★ **Xe công ty và xe thuê ngoài nằm trong CÙNG Vehicle domain và CÙNG operational
lifecycle.** Xe thuê ngoài chỉ khác ở **ownership · carrier · hire information**.

**[CONFIRMED] KHÔNG tạo:** outsourced trip model · outsourced driver model ·
outsourced execution flow · assignment model thứ hai.

### Những gì hệ thống ĐÃ có

| | Trạng thái |
|---|---|
| Danh mục **Vehicle** (`trip_vehicles`) · **Customer** (`trip_customers`) | ✅ đã có |
| Form tạo Trip: Vehicle · Customer · pickup/delivery address · pickup/delivery contact · scheduled pickup/delivery · note | ✅ đã có |
| Trip lưu FK tới Vehicle và Customer | ✅ đã có |

### Trip là operational record — bốn dimension

**[CONFIRMED] BUSINESS REQUIREMENT:**

```text
Trip
├── Customer
├── Vehicle
├── Driver
└── Execution
```

Operations **phải** truy xuất được Trip theo **Vehicle** · **Customer** · **thời gian**.

```text
Filter Vehicle = 50C4566   → các Trip liên quan tới xe đó
Filter Customer = ABC      → các Trip của khách hàng đó
```

★ Đây là **requirement của operational system**, đã chốt. Việc source hiện tại chưa
implement **không** làm nó thôi là requirement.

### GAP-32 — [GAP — CURRENT IMPLEMENTATION]

Source hiện tại **chưa** có filter Vehicle/Customer. Bằng chứng:

| Nguồn | Nội dung |
|---|---|
| `date-range-page-query.dto.ts` | Query chỉ nhận **`from` · `to` · `page` · `limit`** |
| `trip-schedule.repository.ts` | `LEFT JOIN` vehicle/customer **chỉ để hiển thị**; không `WHERE` nào |
| `TripSchedulePage.tsx` | Thanh filter là **khoảng ngày**; comment cấm lọc phía client |
| `0011` — index | `idx_trip_schedule_vehicle` và `idx_trip_schedule_customer` **có tồn tại**, nhưng `0011` ghi rõ: *"**Not for reading trips**: these serve the foreign-key check PostgreSQL runs when a vehicle or customer row is updated."* Chúng là index **một cột**, không kèm ngày |

★ **Đây là GAP triển khai, KHÔNG phải câu hỏi nghiệp vụ.** Không cần CEO quyết.

### Query model — thiết kế, không phải câu hỏi

**[RECOMMENDATION]** Hai đường đọc **khác nhau**, và tách chúng ra là điều giữ cho
ADR-0003 nguyên vẹn:

| | Đường đọc | Phân trang | ADR-0003 |
|---|---|---|---|
| **R-A** | **Bảng điều độ**, có khoảng ngày bắt buộc, **cộng** filter Vehicle/Customer | Offset + `total` — **giữ nguyên** | ✅ **Vẫn hiệu lực.** Filter chỉ làm tập kết quả **nhỏ hơn**; tiền đề "bị chặn bởi khoảng ngày" không đổi |
| **R-B** | **Lịch sử của một Vehicle/Customer**, *không* khoảng ngày | ★ **Keyset** — theo đúng ADR-0002 | ✅ Không đụng ADR-0003, vì đây là **đường đọc thứ hai**, không phải nới lỏng đường thứ nhất |

★ **Sửa lại một kết luận sai ở bản trước của tài liệu này.** Requirement filter
Vehicle/Customer **KHÔNG** làm ADR-0003 mất hiệu lực. ADR-0003 nói về **bảng điều
độ**; một khung nhìn lịch sử theo xe là **một read model khác**, và nó dùng chiến
lược phân trang của riêng nó. Điều kiện **V-1** của ADR-0003 chỉ bị kích hoạt nếu
**chính bảng điều độ** cho đọc mà không có khoảng ngày — điều mà R-B không làm.

**Index — [WORKIK REVIEW REQUIRED]:**

| Đường đọc | Index đề xuất |
|---|---|
| R-A | Index hiện có `(scheduled_on DESC, id DESC) WHERE archived_at IS NULL` dẫn đầu bằng ngày → khoảng ngày đã chặn tập kết quả, filter xe/khách lọc trên vài chục dòng. **Có thể đủ.** Nếu đọc theo xe trở thành chủ đạo: composite `(vehicle_id, scheduled_on DESC, id DESC) WHERE archived_at IS NULL` |
| R-B | Keyset cần `(vehicle_id, scheduled_on DESC, id DESC)` — ⚠ hai index một cột hiện có **không** phục vụ được, vì chúng không mang cột sắp xếp |

★ **Chưa đo.** Việc R-A có cần composite index hay không là câu hỏi đo đạc, không phải
câu hỏi thiết kế.

---

## 0.8 Canonical MVP model — và điểm mở rộng tương lai

### 0.8.1 [CONFIRMED] Mô hình MVP

```text
1 Trip  =  1 Customer  +  1 Vehicle  +  1 Driver
```

```text
Trip
├── Customer
├── Vehicle
├── Driver
└── Execution
```

★ **Đây là mô hình cần thiết kế cho MVP.** Không có cấp Leg. Không có nhiều Vehicle
hay nhiều Driver trên một Trip.

**[CONFIRMED] KHÔNG:**

| Không làm | Vì sao |
|---|---|
| Biến Trip thành parent của nhiều Leg | Business chưa yêu cầu |
| Đổi rule `1 Trip = 1 Vehicle` | Đã CONFIRMED |
| Đổi rule `1 Trip = 1 Driver` | Đã CONFIRMED — contract §4.1 |
| Tạo **Vehicle Assignment History** | ★ Chỉ được đề xuất vì một **giả định** đổi xe. Giả định đó không phải yêu cầu MVP |
| Tạo thêm assignment model / lifecycle | — |

⚠ **Sửa lại một suy diễn sai của bản trước.** Bản trước của mục này đã nâng một khả
năng *"có thể phát sinh"* thành một thay đổi mô hình canonical. Đó là suy diễn quá xa
từ một ví dụ. **Mô hình canonical không đổi.**

### 0.8.2 [FUTURE EXTENSION] Nhiều operational segment

Một chuyến đường dài **có thể** phát sinh nhu cầu đổi xe giữa đường, hoặc cần nhiều
operational segment.

★ Đó là **một option của operational planning nếu thực tế có nhu cầu** — **không**
phải yêu cầu của MVP, và **không** được dùng làm cơ sở để đổi mô hình canonical.

**[FUTURE EXTENSION]** — không thiết kế schema cho nó bây giờ.

### 0.8.3 ★ Điều kiến trúc PHẢI làm đúng ngay: không khoá chết đường mở rộng

Yêu cầu duy nhất mà MVP phải tôn trọng là **không tự khoá mình lại**. Năm điểm cụ thể:

| # | Nguyên tắc | Vì sao |
|---|---|---|
| **X-1** | **Execution Event là một DÒNG cho mỗi sự kiện**, không phải một cột trạng thái tổng trên Trip | Nếu trạng thái thực thi là một cột trên Trip thì thêm segment sau này là viết lại mô hình. Là bảng thì thêm một cột `segment_id` nullable là xong |
| **X-2** | ★ **Chụp `vehicle_id` + `ownership` xuống mỗi Execution Event và Expense** — **không** suy ra bằng cách join ngược lên `Trip.vehicle_id` lúc đọc | ★ **Đây là điểm quan trọng nhất.** Join ngược lúc đọc sẽ **sai ngay** khi Vehicle của Trip thay đổi — và `PATCH /trip-schedules/:id` **đổi được `vehicleId`** hôm nay (`controller.ts:79,107`), không để dấu vết (`service.ts:138`). Snapshot đúng ngay cả trong MVP, **và** là thứ làm cho nhiều segment sau này khả thi mà không phải sửa dữ liệu cũ |
| **X-3** | **Không** đặt `UNIQUE (trip_id, event_type)` | Sẽ cấm cả sự kiện lặp hợp lệ lẫn nhiều segment sau này |
| **X-4** | Driver Assignment giữ **append + close có history** | Đã CONFIRMED ở contract §4.2 vì lý do riêng (đổi tài xế, audit trách nhiệm) — độc lập với chuyện segment. Thêm `segment_id` sau này là một cột nullable |
| **X-5** | Ràng buộc "1 active" đặt trên `trip_id` | Đúng cho MVP. Nếu segment xuất hiện, nó chuyển xuống `segment_id` — một migration thay index, không phải viết lại |

★ **Năm điểm này không tốn thêm gì trong MVP.** X-2 là cột snapshot vốn đã cần cho
quy tắc cấm `fuel`/`toll`; bốn điểm còn lại là **tránh làm một việc**, không phải làm
thêm việc.

### 0.8.4 Vehicle provenance trong MVP — không cần bảng assignment

| Câu hỏi | Trả lời trong MVP |
|---|---|
| Trip này dùng xe nào | `Trip.vehicle_id` ✅ đã có |
| Event/expense này thuộc xe nào | **Snapshot `vehicle_id`** trên chính dòng đó (X-2) |
| Xe của Trip từng đổi chưa, ai đổi | ❌ **không lưu** — cùng loại GAP-29. **[FUTURE EXTENSION]** |

★ **Không tạo Vehicle Assignment table cho MVP.** Snapshot đã đủ cho provenance của
event/expense, vốn là thứ duy nhất MVP cần.

### 0.8.5 Filter — vẫn là read capability, không đổi

**[CONFIRMED]** Operations filter/search Trip theo **Vehicle · Customer · Driver ·
thời gian**. Trong MVP mọi filter trả về **Trip** — không có cấp Leg nào để phân biệt.

Hiện trạng: **[GAP — CURRENT IMPLEMENTATION]** GAP-32, xem §0.7.

### 0.8.6 Xe thuê ngoài — không đổi

**[CONFIRMED]** Xe công ty và xe thuê ngoài dùng **chung Vehicle domain**. Xe thuê chỉ
khác ở **ownership · carrier · hire · quy tắc expense tương ứng**.

**Không** tạo: outsourced Trip · outsourced Driver flow · outsourced Execution flow.

---

# PHẦN I — HIỆN TRẠNG & GAP

## A-1. Executive Summary

Hệ thống hiện tại là backoffice một-deployment-một-tổ-chức, đã dựng xong identity,
authorization, organization, lịch xe (`0011`) và chi phí chuyến (`0012`). Chất
lượng kiến trúc cao và có chủ ý: tiền là `NUMERIC` không float, bản ghi tài chính
là void-không-sửa, runtime không bao giờ phát `DELETE`, và quyền được quyết theo
**quan hệ** chứ không theo nhãn role.

Năm kết luận sau khi đối chiếu Business Contract với source:

1. **Driver không tồn tại trong data model.** Không bảng, không cột, không
   permission. Tên tài xế đang nằm trong **free text** của `trip_schedules`.
   → **GAP-1**, gốc của mọi gap khác.

2. **★ Mô hình phân quyền không diễn đạt được "của tôi".** `can()` có đúng năm bậc
   — `any`, `member`, `head`, `head-anywhere`, `global` — và cả năm đều là quan hệ
   với **department** hoặc **toàn cục**. Không bậc nào nói được *"chỉ chuyến mà tôi
   là tài xế được phân công"*. → **GAP-2**, thay đổi kiến trúc lớn nhất.

3. **★ Contract "tuyệt đối không thấy giá" mâu thuẫn trực tiếp với schema hiện
   tại.** `cargo_info`, `note`, `pickup_contact`, `delivery_contact` là **free
   text**, và điều độ hoàn toàn có thể gõ giá lấy hàng vào đó. Business nói *tuyệt
   đối*; schema không có cách nào bảo đảm điều đó. → **CONFLICT-1** (§A-7), phải có
   lời giải kiến trúc **trước** khi tài xế đọc được bất kỳ ô nào trong bốn ô này.

4. **Completion request là một thực thể chưa tồn tại.** Hôm nay đổi trạng thái
   chuyến là `PATCH /trip-schedules/:id/status` với `trip.write` (`head-anywhere`).
   Không có "đề nghị", không có "duyệt", không có SuperAdmin xác nhận. → **GAP-15**.

5. **"Không tạo role mới" là một ràng buộc thuận lợi, không phải hạn chế.** Vì
   Driver được xác lập bằng **assignment** chứ bằng một role row, mô hình quan hệ
   sẵn có của `can()` là chỗ đúng để diễn đạt nó — xem §A-8.1.

**Định hướng kiến trúc tổng thể:** giữ nguyên backend NestJS một tiến trình, thêm
**một capability mới** (`capabilities/driver-portal/`) và **một frontend project
riêng** cho tài xế. Không rewrite. Không tách microservice — trừ AI, vốn đã
`[CONFIRMED]` là service riêng.

---

## A-3. TECHNICAL DISCOVERY — Current State

> Toàn bộ mục 3 là **[DISCOVERY]** — sự thật đọc được từ source, không phải ý kiến.

### A-3.1. Existing capabilities

| Vùng | Trạng thái | Nguồn |
|---|---|---|
| Authentication (email + password, session server-side) | ✅ đã dựng | `core/identity/` |
| Authorization (permission đóng, quyết theo quan hệ) | ✅ đã dựng | `core/authorization/` |
| Users / provisioning / offboarding | ✅ đã dựng | `core/users/` |
| Department + membership | ✅ đã dựng | `core/organization/` |
| Membership approval · Account invitation | ✅ đã dựng | `capabilities/` |
| Trip schedule (lịch xe) | ✅ đã dựng | `capabilities/trip-schedule/` + `0011` |
| Trip cost + outsource hire | ✅ đã dựng | cùng capability + `0012` |
| **Driver** | ❌ không tồn tại | — |
| **Completion request / approval** | ❌ không tồn tại | — |
| **Commercial / doanh thu / công nợ** | ❌ không tồn tại | — |
| File / chứng từ / attachment | ❌ không tồn tại | — |
| Geolocation / Execution Event / event log | ❌ không tồn tại | — |
| AI / anomaly detection | ❌ không tồn tại | — |
| Job nền · scheduler · queue · outbound HTTP | ❌ không tồn tại | — |

### A-3.2. Existing data model

12 migration, forward-only, có checksum — runner từ chối khởi động nếu file cũ bị sửa.

```text
users ─────────────┬── identities        (provider, subject, secret_hash, must_change_secret)
                   ├── sessions          (token_hash, expires_at, revoked_at)
                   ├── department_memberships ── departments
                   └── role_assignments  (SUPERADMIN | DEPARTMENT_HEAD)

trip_vehicles ─┐
trip_customers ┴─── trip_schedules ─┬── trip_costs            (5 category, NUMERIC, void)
                                    └── trip_outsource_hires  (carrier_name TEXT, VAT flag, void)
```

**Những cột quyết định cho Driver Portal:**

| Bảng | Cột | Ý nghĩa |
|---|---|---|
| `trip_schedules` | `vehicle_id` → `trip_vehicles` | Xe **có** khoá ngoại, nhưng **NULLABLE** — bảng tính có dòng `ĐIỀN SAU` |
| `trip_schedules` | `cargo_info`, `pickup_contact`, `delivery_contact`, `note` | **Free text.** `0011` ghi rõ chúng chứa *"driver names with licence numbers"* |
| `trip_schedules` | `status` (5 giá trị) | Là **màu dòng của bảng tính**, không phải vòng đời thực thi |
| `trip_costs` | `created_by` → `users(id)` | Có provenance, nhưng **không phân biệt** tài xế hay backoffice |
| `trip_costs` | *(không có)* `driver_id`, `evidence`, `review_status` | `0012`: *"IT ADDS NO STATUS AND NO WORKFLOW"* |

### A-3.3. Existing authorization

**Role là CODE. Ai giữ role là DATA.** Split đã ghi thành văn ở
`core/authorization/README.md` và `domain/permission.ts`.

```ts
ROLE_KEYS            = ['SUPERADMIN', 'DEPARTMENT_HEAD', 'MEMBER']   // 3 contract
ASSIGNABLE_ROLE_KEYS = ['SUPERADMIN', 'DEPARTMENT_HEAD']             // 2 được lưu
// MEMBER = sự VẮNG MẶT của row, không phải một giá trị
```

```sql
-- 0004_authorization.sql
role_key TEXT NOT NULL CHECK (role_key IN ('SUPERADMIN', 'DEPARTMENT_HEAD'))
```

**12 permission key, đóng, khai trong source:**

| Key | Requirement | Ai với tới |
|---|---|---|
| `unit.read` | `member` | thành viên phòng đó |
| `unit.member.read` | `head` | trưởng phòng đó |
| `unit.write` · `unit.member.write` · `role.assign` · `user.write` | `global` | chỉ SUPERADMIN |
| `trip.read` · `trip.create` | `any` | **mọi account đã đổi mật khẩu** |
| `trip.write` | `head-anywhere` | SUPERADMIN hoặc trưởng phòng bất kỳ |
| `cost.read` · `cost.create` · `cost.void` | `global` | **chỉ SUPERADMIN** |

**Năm bậc requirement:**

```ts
type PermissionRequirement = 'any' | 'head' | 'member' | 'head-anywhere' | 'global';
```

★ **Không bậc nào diễn đạt được quan hệ giữa caller và MỘT BẢN GHI.** → **GAP-2**.

**Bốn thuộc tính bảo mật phải giữ nguyên khi mở rộng:**

1. **Fail-closed** — permission có scope mà gọi không kèm target → `false`.
2. **Provisioning gate chạy trước** — `mustChangeSecret` từ chối tất cả, kể cả
   SuperAdmin. Đây là lý do mọi route phải khai `PermissionGuard`, không chỉ `AuthGuard`.
3. **Không cache** — context nạp lại từ database ở **mỗi** request.
4. **Scope luôn trên URL**, không bao giờ trong body.

**Bất biến do DATABASE canh:**

| # | Nội dung | Cơ chế |
|---|---|---|
| 1 | Tối đa 1 active SUPERADMIN toàn deployment | partial unique index |
| 2 | Tối đa 1 active HEAD mỗi department | partial unique index |
| 6 | Mỗi user tối đa **1** active membership | `uq_single_active_membership` |
| 13 | Active HEAD ⇒ có active membership cùng phòng | composite FK có `status` trong key |

### A-3.4. Existing trip lifecycle

```text
awaiting_production  ĐANG ĐỢI SX              hàng chưa có
awaiting_vehicle     SX RỒI ĐANG ĐỢI XE       có hàng, chưa có xe
needs_confirmation   THÔNG TIN CẦN XÁC NHẬN   phải gọi lại khách
external_booking     BOOK XE NGOÀI            thuê ngoài
done                 ĐÃ XONG                  xong
```

★ Đây là **màu dòng của file Excel** được nâng lên thành cột. Nó mô tả **trạng thái
điều độ**, không phải **tiến trình thực địa**. Từ `awaiting_vehicle` sang `done` là
một bước nhảy mà tài xế không có chỗ nào để đứng vào.

Đổi trạng thái: `PATCH /trip-schedules/:tripId/status`, permission `trip.write`
(`head-anywhere`). **Không có** khái niệm đề nghị hay duyệt.

> ★ Source đã tự dự đoán nhu cầu này. Comment trên route đó viết: *"relaxing it
> later — letting whoever is on shift mark a trip delivered — is a change to one
> decorator rather than a redesign of the edit path."* Route status được tách riêng
> khỏi PATCH chung **chính vì** ngày này.

### A-3.5. Existing cost model

| Đặc điểm | Giá trị hiện tại |
|---|---|
| Category | Đúng **5**, khớp hoàn toàn với §A-2.6 |
| Không có `other` | Chủ ý, ghi thành văn |
| Kiểu tiền | `NUMERIC(14,2)`, **string suốt đường** — row → domain → JSON |
| Cộng tiền | **Chỉ bằng `SUM()` của PostgreSQL**, không bao giờ bằng `+` của JS |
| Sửa bản ghi | **Không tồn tại** — không route, không service method, không repository method |
| Sửa sai | `void` + lý do bắt buộc + tạo bản ghi mới |
| `updated_at` | **Cố ý không có**, và không có trigger |
| Chuyến đã archive | **Vẫn nhận được chi phí** (`requireTrip()` không đọc `status`) |
| Ai tạo | `created_by` từ **session**, không bao giờ từ body |
| Trạng thái duyệt | **Không có** |

Ranh giới đã thi hành ở tầng HTTP: `cost.*` sống ở **controller riêng**, và **không
một con số tiền nào lọt vào response của trip API**. `0012` ghi: *"no amount ever
reaches the trip API, because the people allowed to enter a price are not the people
allowed to read the board."*

★ **Đây chính là pattern mà §A-2.7 cần dùng lại.**

---

## A-5. Driver Persona — đối chiếu contract với source

### A-5.1. Driver được thấy (theo §2.7) và nguồn dữ liệu hôm nay

| Trường contract | Nguồn hôm nay | Trạng thái |
|---|---|---|
| Tên khách hàng | `trip_customers.name` qua FK | ✅ có, sạch |
| Thông tin hàng hoá | `trip_schedules.cargo_info` | ⚠ **free text** — CONFLICT-1 |
| Điểm lấy hàng | `pickup_address` | ⚠ free text |
| Điểm giao hàng | `delivery_address` | ⚠ free text |
| Vehicle information | `trip_vehicles.plate` qua FK | ✅ có, sạch |
| Giờ lấy / giao | `pickup_at` / `delivery_at` | ✅ có, sạch |
| Operational instructions | *(chưa có trường riêng)* | **GAP-17** |
| Liên hệ lấy / giao | `pickup_contact` / `delivery_contact` | ⚠ free text |
| Chi phí do chính mình khai | *(chưa có ownership)* | **GAP-8** |

### A-5.2. Driver không được thấy — trạng thái thi hành hôm nay

| Contract cấm | Thi hành được chưa? |
|---|---|
| Giá lấy hàng / giao hàng / commercial pricing | ⚠ **Chưa model ở đâu.** Khi xây phải nằm ngoài tầm Driver ngay từ đầu |
| Revenue / margin / profit / công nợ | ⚠ Như trên |
| Giá thuê nhà xe (`trip_outsource_hires.agreed_amount`) | ✅ Đã ở bậc `global` — giữ nguyên |
| Tổng chi phí chuyến (`cost-summary`) | ✅ `cost.read` = `global` |
| Chuyến của người khác | ❌ **`trip.read` = `'any'`** → mọi account đọc toàn bộ bảng. **GAP-2 là chặn này** |
| Danh mục khách hàng / đội xe đầy đủ | ❌ `trip.read` phủ luôn hai catalogue |
| Expense của Driver khác | ❌ Chưa có khái niệm ownership |

★ **Kết luận persona:** Driver **không phải** một MEMBER bị giấu bớt UI. Driver là
một **bán kính dữ liệu khác hẳn**, hẹp hơn MEMBER, và hôm nay bán kính đó không
biểu diễn được.

---

## A-6. Data Model Gap Analysis

| # | Cần có (theo contract) | Hôm nay | Kết luận |
|---|---|---|---|
| 1 | Gán Driver vào Trip (1-1) | ✗ không có gì nối Trip tới người | **GAP-1** |
| 2 | ★ Bậc quyền theo **assignment** | 5 bậc, đều theo department hoặc global | **GAP-2** — lớn nhất |
| 3 | Driver là user | `users` có sẵn, cố ý mỏng, không phân loại người | ✅ dùng lại được |
| 4 | Driver thuộc department nào | Bất biến #6: user active phải có **đúng 1** membership | **GAP-4** → `[OPEN]` OD-2 |
| 5 | Đăng nhập | `identities.provider` là TEXT (mở), nhưng login path + policy + UI đều giả định email công ty | **GAP-5** → `[OPEN]` OD-1 |
| 6 | Trường operational instructions riêng | ✗ chỉ có `note` free text | **GAP-17** |
| 7 | Trip status cho thực thi | 5 giá trị = màu Excel | **GAP-9** |
| 8 | **Completion request + approval** | ✗ hoàn toàn không có | **GAP-15** |
| 9 | Expense ownership (`driver_id`) | `created_by` = ai gõ, không phải tiền của ai | **GAP-8** |
| 10 | Phân biệt driver-created vs backoffice-created | ✗ | **GAP-8** — cần cột `source` |
| 11 | Review state cho expense | ✗ `0012` cố ý không có | **GAP-6** → `[OPEN]` OD-4 |
| 12 | Evidence / chứng từ | ✗ không có hạ tầng file nào | **GAP-7** → `[OPEN]` OD-6 |
| 13 | **Execution Event** (Arrival / Pickup / Delivery Confirmation) là khái niệm hạng nhất | ✗ | **GAP-10** |
| 14 | Toạ độ điểm lấy/giao | `pickup_address` là free text, không lat/lng | **GAP-14** |
| 15 | Model dữ liệu thương mại | ✗ chưa tồn tại | Không phải gap của phase này, nhưng **phải** tách khỏi Driver ngay khi sinh ra |
| 16 | Frontend riêng cho Driver | Một SPA React, một `MainLayout`, một `RequireSession` | **GAP-11** |
| 17 | Hạ tầng gọi AI (HTTP client, queue, job) | ✗ backend có 11 dependency, không có cái nào | **GAP-12** |
| 18 | Trạng thái **editable/draft** cho khoản chi (contract bản 2 §A-9) | ✗ Không có `updated_at`, không trigger, **không đường sửa nào ở bất kỳ tầng nào** — cố ý | **GAP-18** ★ |
| 19 | Khái niệm **submit / lock** khoản chi | ✗ | **GAP-19** |
| 20 | Audit các lần **sửa trước khi khoá** | ✗ | **GAP-20** |
| 21 | Phân biệt **xe công ty / xe thuê ngoài** trên danh mục xe | ✗ `trip_vehicles` chỉ có `plate`, `note`, `status` — **không có khái niệm sở hữu** | **GAP-21** ★ |
| 22 | Nối **nhà xe** ↔ **xe** ↔ **chuyến** | ✗ `trip_outsource_hires.carrier_name` là **free text**, cố ý không phải FK | **GAP-22** ★ |
| 23 | Thực thể **Nhà xe (Carrier)** — 1 nhà xe có nhiều xe | ✗ không tồn tại | **GAP-24** ★ |
| 24 | Ràng buộc *xe thuê ⟹ có giá thuê* | ✗ — và là ràng buộc **liên bảng**, `CHECK` không làm được | **GAP-25** ★ |
| 25 | Cấm khai `fuel`/`toll` trên chuyến xe thuê | ✗ — cũng **liên bảng** | **GAP-26** ★ |
| 26 | **Actual execution time** đối chiếu scheduled time | ✗ chỉ có giờ dự kiến | **GAP-27** |

## Ghi chú GAP-4 — membership

Bất biến #6 nói *user active có tối đa 1 active membership*, và service không bao
giờ tạo user active mà không có membership. Vậy tài xế **phải** vào một phòng.

**[REC]** Tạo một department (ví dụ "Đội xe"), **không** sửa bất biến. Department là
**data** — `0003` ghi rõ *"a unit's name is data an administrator types, so no name
appears anywhere in this repository"*. Thêm một dòng là thao tác quản trị, chi phí
bằng không. Nới bất biến #6 thì ngược lại: nó được canh bởi partial unique index và
là nền cho bất biến #13.

⚠ Hệ quả cần chốt: `unit.read` là bậc `member`, nên tài xế trong phòng đó **mặc định
đọc được phòng đó**. → `[OPEN]` **OD-3**.

---

## A-7. ★ CONFLICT-1 — Contract "tuyệt đối" gặp schema "free text"

> Đây là phát hiện quan trọng nhất của lần cập nhật này, và nó **chặn** phần đọc dữ
> liệu của Driver Portal.

**Contract (§2.7) nói:** Driver **tuyệt đối không** được thấy giá lấy hàng, giá giao
hàng, commercial pricing.

**Schema (§A-3.2) nói:** `cargo_info`, `note`, `pickup_contact`, `delivery_contact` là
**prose do người gõ**, không có cấu trúc, không validate nội dung.

**Mâu thuẫn:** điều độ hoàn toàn có thể gõ

```text
note: "giá lấy hàng 12tr, khách trả sau, nhớ thu tiền"
```

và **không cơ chế kỹ thuật nào chặn được**. Cho Driver đọc bốn ô này là cho đọc bất
cứ thứ gì từng được gõ vào đó — kể cả thứ contract cấm tuyệt đối.

★ **Không thể vừa cho Driver đọc `note` nguyên trạng, vừa bảo đảm "tuyệt đối
không".** Hai điều đó loại trừ nhau. Phải chọn.

**Ba hướng, không loại trừ nhau — cần Business chốt (`[OPEN]` OD-5):**

| # | Hướng | Đánh giá kỹ thuật |
|---|---|---|
| 1 | **Không cho Driver đọc `note` và `cargo_info`** | An toàn tuyệt đối. Nhưng `cargo_info` chính là *"1 kg hàng"* mà tài xế cần biết → mất thông tin nghiệp vụ |
| 2 | **Thêm trường có cấu trúc dành riêng cho Driver** (`driver_instructions` — GAP-17), và `/driver/*` **chỉ** trả trường đó. Ô ghi chú cũ ở lại với backoffice | Biến ranh giới thành **thuộc tính của schema** thay vì một lời hứa. Đây là cách duy nhất khiến "tuyệt đối" trở thành đúng nghĩa đen |
| 3 | **Quy trình + đào tạo**: điều độ không gõ giá vào ghi chú | Không thi hành được bằng code. Là lớp bổ sung, **không** thay thế được 1 hoặc 2 |

**[REC]** Hướng **2**, có **3** kèm theo. Hướng 3 một mình không đáp ứng được chữ
"tuyệt đối" trong contract.

⚠ **Cho tới khi OD-5 được chốt, Phase 2 không nên bắt đầu** — vì trường nào tài xế
đọc được chính là toàn bộ nội dung của phase đó.

---

### A-2.2. GAP mới phát sinh từ contract bản 2

| ID | Nội dung | Vì sao căng |
|---|---|---|
| **GAP-18** | Không có trạng thái **editable / draft** cho khoản chi, và không có đường sửa nào | `trip_costs` cố ý **không có** `updated_at`, không có trigger, không có service method hay repository method nào sửa được. "Không sửa được" hiện là thứ **không phát biểu được**, chứ không phải một luật ai đó nhớ |
| **GAP-19** | Không có khái niệm **submit / lock** cho khoản chi | Ranh giới giữa "bản nháp" và "bản ghi tài chính" chưa tồn tại |
| **GAP-20** | Audit không lưu **các lần sửa trước khi khoá** | Chưa có gì để lưu, vì chưa có sửa |

★ **Đề xuất hoà giải** cho GAP-18/19 nằm ở §A-9.5 của contract và mang nhãn
**[PROPOSED]** — *tính bất biến gắn với **mốc khoá**, không gắn với sự tồn tại của
bản ghi*. Một khoản chi **là** một khoản chi ngay từ lúc được khai; mốc khoá chỉ
quyết định từ thời điểm nào nó không còn sửa trực tiếp được. Đó là đề xuất để CEO
xem xét, **không** phải quyết định.

⚠ **Không mô tả** khoản chi ở trạng thái editable như thể "nó chưa phải một khoản
chi" — xem contract §9.3.


---

# PHẦN II — PHASE-1 GATES

## B-1. OD-2 — Driver department / membership

### B-1.1. Source hiện tại nói gì

**Bất biến #6 là THẬT, và được database canh, không phải quy ước.**

| Bằng chứng | Nội dung |
|---|---|
| `0003_organization.sql` | `uq_single_active_membership` — partial unique index trên `(user_id) WHERE status = 'active'`. **Tối đa 1** active membership/người, trên toàn hệ thống |
| `AccountProvisioningService.provision()` | Tham số `departmentId: string` — **bắt buộc, không nullable**. Không có đường nào tạo account active mà không có membership |
| `0003` header | *"an active user holds EXACTLY ONE active membership"* — nửa "at most one" do index canh, nửa "at least one" do service canh |
| `0004_authorization.sql` | Composite FK `role_assignments_head_membership_matches` **phụ thuộc** vào membership. Nới bất biến #6 là đụng vào nền của bất biến #13 |

★ **Kết luận trace: không thể lờ đi.** Driver là User bình thường (contract §3), nên
Driver **bắt buộc** có đúng 1 active membership. Đây không phải lựa chọn thiết kế —
nó là hệ quả của việc Driver là User.

### B-1.2. Contract yêu cầu gì

Contract §3 [CONFIRMED]: Driver là User bình thường · SuperAdmin cấp tài khoản ·
không tạo role DRIVER. Contract **không** nói gì về department.

### B-1.3. Options

| | Nội dung | Ưu | Nhược |
|---|---|---|---|
| **A** | Tạo **một department mới** cho tài xế (ví dụ "Đội xe") | Department là **data** — `0003` ghi rõ tên đơn vị là thứ quản trị viên gõ vào, không nằm trong code. Thêm một dòng, chi phí bằng 0. Không đụng schema, không đụng bất biến | Sinh ra một đơn vị tổ chức có thể không tồn tại trên sơ đồ công ty thật |
| **B** | Xếp tài xế vào **một phòng đã có** (ví dụ phòng điều độ) | Không tạo đơn vị mới | Tài xế đọc được phòng đó (§B-2). Và nếu phòng đó có trưởng phòng, trưởng phòng đọc được danh sách tài xế — có thể đúng, có thể không |
| **C** | **Nới bất biến #6** để user active tồn tại không cần membership | Mô hình hoá đúng nếu tài xế thật sự không thuộc phòng nào | ★ Đụng vào **móng**: một partial unique index + service invariant + nền của bất biến #13. Đắt nhất, rủi ro nhất, và ảnh hưởng toàn bộ nhân viên văn phòng |

### B-1.4. Trả lời các câu hỏi của Phần 2 đề bài

| Câu hỏi | Trả lời |
|---|---|
| Driver có cần membership không? | **Có — bắt buộc.** Không phải lựa chọn |
| Đúng 1 hay nhiều? | **Đúng 1.** Database chặn cái thứ hai |
| Department nào? | **[CEO DECISION]** — A hay B |
| Ai cấp? | SuperAdmin, cùng lúc tạo account (`provision` nhận `departmentId`) |
| Driver đổi department thì assignment cũ có bị ảnh hưởng? | **Không**, nếu assignment tham chiếu `users(id)` chứ không tham chiếu membership. Xem §B-6.2 — đây là một ràng buộc thiết kế, không phải điều hiển nhiên |

★ **Cảnh báo thiết kế quan trọng:** `role_assignments` trong `0004` **cố ý** gắn với
`membership_id`, nên đổi phòng là bãi nhiệm. Trip assignment **không được** sao chép
mẫu đó — tài xế đổi phòng vẫn phải giữ nguyên lịch sử chuyến đã chạy.

### B-1.5. Khuyến nghị

**[REC] Option A.** Lý do kỹ thuật, không phải lý do tổ chức: A là phương án duy
nhất **không thay đổi gì** trong schema hay trong bất biến. B tạo hệ quả phụ về khả
năng đọc; C đụng vào móng.

**[CEO DECISION]** — chọn A hay B, và nếu A thì đơn vị đó tên gì.

---

## B-2. OD-3 — Driver department read scope

### B-2.1. Source hiện tại nói gì — chính xác Driver sẽ đọc được gì

`unit.read` có requirement `'member'`. Trace hai route:

| Route | Scope param | Kết quả với một MEMBER |
|---|---|---|
| `GET /departments` | **không có** | ★ **403.** `can()` fail-closed khi requirement có scope mà gọi không kèm target → member **không** liệt kê được danh sách phòng ban toàn hệ thống |
| `GET /departments/:departmentId` | có | **200** — nhưng **chỉ** cho phòng của chính mình |
| `GET /departments/:id/members` | có | **403** — đó là `unit.member.read`, requirement `'head'` |

**Vậy bán kính lộ ra thực tế là: một dòng department của chính mình** — `id`, `slug`,
`name`, `status`, `created_at`, `updated_at`.

★ Không phải danh sách phòng ban. Không phải danh sách đồng nghiệp. **Một dòng.**

### B-2.2. Contract yêu cầu gì

Contract §5.4 [CONFIRMED]: Driver chỉ truy cập được Trip được phân công cho mình; máy
chủ không gửi thứ Driver không được thấy. Contract **không** nói gì về department.

### B-2.3. Options

| | Nội dung | Trade-off |
|---|---|---|
| **A** | Chấp nhận — Driver đọc được dòng department của mình | Không phải làm gì. Lộ ra tên một đơn vị nội bộ, không có dữ liệu thương mại, không có nhân sự |
| **B** | Chặn — Driver Portal không expose route department nào | Cũng gần như không phải làm gì **ở Driver Portal** (chỉ cần không gọi). ⚠ Nhưng route Backoffice vẫn tồn tại và vẫn trả 200 nếu tài xế gọi thẳng — nên "chặn" thật sự nghĩa là thêm một điều kiện vào `core/authorization`, tức **đụng foundation** |

★ **Điểm dễ hiểu nhầm:** không gọi route ở giao diện Driver **không phải** là chặn.
Contract §5.4 nói rõ ranh giới là *nội dung máy chủ trả về*, không phải giao diện.

### B-2.4. Khuyến nghị

**[REC] Option A.** Bán kính lộ ra là một dòng chứa tên đơn vị — không phải dữ liệu
thương mại, không phải nhân sự, không phải chuyến của người khác. Đổi lấy việc đụng
vào `core/authorization` cho một dòng dữ liệu đó là đánh đổi tồi.

**[CEO DECISION]** — chấp nhận A, hay yêu cầu B.

---

## B-3. OD-9 — Domain + session / cookie architecture

### B-3.1. Source hiện tại — trace đầy đủ

| Hạng mục | Giá trị thật |
|---|---|
| Cookie phiên | `bo_session` |
| `HttpOnly` | **true** |
| `Secure` | **true** ở production |
| `SameSite` | **`strict`** |
| `path` | `/` |
| ★ `domain` | **KHÔNG ĐƯỢC ĐẶT** → cookie là **host-only** |
| Loại token | Token mờ phía server; DB chỉ lưu **hash**; thu hồi được ngay |
| CSRF | Header bắt buộc `X-Requested-With` trên mọi method không an toàn. Lớp phòng thủ **chính** là `SameSite=strict`; guard là lớp hai |
| CORS | **Tắt mặc định**. Khi bật: allowlist origin cụ thể, `credentials: true`, `allowedHeaders: ['Content-Type','X-Requested-With']`. Schema **từ chối `*`** |
| Topology production | `Cloudflare → nginx :443 (opsystem.hoanglonglti.com)` → `location /` phục vụ static từ `/var/www/opsystem`, `location /api/` proxy sang `127.0.0.1:3000` |
| Frontend origin (prod) | **Cùng origin với API.** CORS không tham gia |
| Frontend origin (dev) | `:4200`, API `:3000` → khác origin nhưng **cùng site**, nên `SameSite=strict` vẫn gửi cookie; `CORS_ORIGINS` khai `http://localhost:4200` |

★ **Hai sự thật quyết định toàn bộ mục này:**

1. **`SameSite` là về SITE, không phải ORIGIN.** Source ghi rõ điều này. Nên
   `driver.<parent>` và `app.<parent>` là **same-site** — `SameSite=strict` **không**
   cản trở chúng.
2. **Cookie là host-only** (không có `domain`). Nên cookie phát ở host này **không tự
   động** được gửi tới host khác, ngay cả cùng parent domain.

### B-3.2. Đánh giá ba phương án

> Tài liệu này **không** đặt tên miền thật. Deployment hiện tại chỉ cung cấp một tên:
> `opsystem.hoanglonglti.com`. Mọi tên khác dưới đây là **placeholder**.

#### Option A — Cùng origin, phân tách bằng path

```text
<host>/            Backoffice
<host>/driver      Driver Portal
<host>/api/        API dùng chung
```

| | |
|---|---|
| Cookie | ✅ Không đổi gì. Host-only cookie hoạt động tự nhiên |
| `SameSite=strict` | ✅ Same-origin |
| CSRF | ✅ Không đổi |
| CORS | ✅ Không cần |
| Session isolation | ❌ **Một cookie duy nhất.** Ai đăng nhập cũng có phiên dùng được cho cả hai vùng — ranh giới hoàn toàn dựa vào authorization ở API |
| Chi phí | Thấp nhất |

#### Option B — Subdomain cùng parent domain ★

```text
<app>.<parent>      Backoffice   → static + /api/ proxy (cùng host)
<driver>.<parent>   Driver Portal → static + /api/ proxy (cùng host)
```

★ **Phát hiện quan trọng:** nếu mỗi host tự phục vụ static **và** proxy `/api/` về
cùng backend — **đúng mẫu nginx đang chạy hôm nay** — thì:

| | |
|---|---|
| Cookie | ✅ **Không phải sửa gì.** Mỗi host nhận cookie host-only **của riêng nó** |
| `SameSite=strict` | ✅ Same-site, và cũng same-origin trong mỗi portal |
| CSRF | ✅ Không đổi |
| CORS | ✅ **Không cần** — mỗi portal gọi API dưới chính origin của nó |
| Session isolation | ✅ **Có sẵn, miễn phí.** Hai host = hai cookie độc lập. Đăng xuất ở portal này không ảnh hưởng portal kia |
| Chi phí | Thêm một server block nginx + một bản build frontend + một chứng chỉ/DNS |

⚠ **Nếu KHÔNG proxy `/api/` dưới host của Driver Portal** mà gọi thẳng sang host
Backoffice, bức tranh đảo ngược: cookie host-only **không được gửi** → phải đặt
`domain=.<parent>`, và điều đó **nới cookie ra mọi subdomain**, xoá luôn phần session
isolation vừa nêu, đồng thời cần CORS + `credentials`.

#### Option C — Domain khác hoàn toàn

| | |
|---|---|
| Cookie | ❌ **Cross-site.** `SameSite=strict` **không gửi cookie** |
| Để chạy được | Phải đổi sang `SameSite=None; Secure` |
| Hệ quả | ★ **Xoá lớp phòng thủ CSRF chính** mà toàn bộ thiết kế đang dựa vào. Guard header trở thành lớp duy nhất, và nó phụ thuộc CORS được cấu hình đúng |
| Chi phí | Cao, và làm yếu bảo mật hiện có |

**[REC]** Option C **nên bị loại** trừ khi có lý do nghiệp vụ bắt buộc.

### B-3.3. Driver Portal có nên dùng chung session với Backoffice?

**[REC] Không nên dùng chung** — và Option B cho điều đó miễn phí.

Lý do: tài xế dùng thiết bị cá nhân, ngoài đường, dễ mất máy. Một phiên dùng được ở
cả hai vùng nghĩa là một điện thoại thất lạc là một lối vào Backoffice — dù
authorization vẫn chặn, đó là một lớp phòng thủ đã mất.

★ **Lưu ý:** cả hai portal vẫn dùng **chung `users` / `identities`** (contract §3 —
Driver là User bình thường). Chỉ **phiên** là tách. Đây không phải hai hệ thống xác
thực; nó là **cùng một danh tính, hai phiên**.

### B-3.4. Các hành vi phải giữ nguyên ở cả hai portal

| Hành vi | Ghi chú |
|---|---|
| Đăng nhập bằng email đầy đủ | Route login nhận `subject` là địa chỉ đầy đủ |
| Bắt buộc đổi mật khẩu lần đầu | `must_change_secret` chặn **mọi** route có permission |
| Đổi mật khẩu → **thu hồi mọi phiên** | ⚠ Hành vi hiện tại cắt **tất cả** phiên của user. Với Option B, tài xế đổi mật khẩu trên điện thoại sẽ **bị đăng xuất khỏi cả hai portal**. Đúng về bảo mật; cần biết trước |
| Logout | Thu hồi phiên phía server, không chỉ xoá cookie |
| Throttle đăng nhập | Giữ nguyên |

### B-3.5. Khuyến nghị

**[REC] Option B**, với điều kiện bắt buộc: **mỗi portal proxy `/api/` dưới chính
host của nó** (đúng mẫu nginx hiện tại). Đây là phương án duy nhất vừa **không phải
sửa cookie/CSRF/CORS**, vừa **có session isolation**.

**[CEO DECISION]** — chọn A, B hay C; và nếu B thì tên miền cụ thể.

---


---

# PHẦN III — ARCHITECTURE BOUNDARY

## A-8. Architecture Boundary

### A-8.1. ★ Driver được xác lập bằng ASSIGNMENT, không bằng ROLE

Contract nói: *"Không tạo thêm role mới chỉ để phục vụ Driver Portal."*

Đây **không** phải một hạn chế phải lách. Nó khớp chính xác với triết lý đã có của
`core/authorization/`:

```text
MEMBER   = sự vắng mặt của một role row        (đã là như vậy hôm nay)
DRIVER   = sự hiện diện của một trip assignment (đề xuất cùng hình dạng)
```

`can()` **quyết theo quan hệ, không theo role** — và *"được gán vào chuyến này"* là
một quan hệ có thật trong database, hoàn toàn cùng loại với `headOf` và `memberOf`.

**Hệ quả:** không cần sửa `CHECK` constraint của `0004`, không cần migration cho
authorization, không cần role key thứ ba được lưu.

### A-8.2. GAP-2 — ba cách diễn đạt "của tôi"

Bậc cần có, về mặt khái niệm:

```ts
// ĐỀ XUẤT KỸ THUẬT — CHƯA IMPLEMENT
| 'assigned'   // caller phải là người được gán vào chính bản ghi đó
```

**Vấn đề:** hôm nay `can()` nhận `target?: { departmentId?: string }` — lấy từ
**route param**, không chạm database. `'assigned'` cần biết *"user X có được gán vào
trip Y không"*, tức là một **truy vấn**. Điều đó phá vỡ tính thuần của `can()`.

| Cách | Nội dung | Đánh giá |
|---|---|---|
| **A. Nạp sẵn vào context** | `AuthorizationContext.assignedTripIds: string[]` | ✓ Giữ `can()` thuần. ✗ Không scale — một tài xế 2 năm có hàng nghìn chuyến, và context nạp lại **mỗi request** |
| **B. Guard riêng ở capability** | `PermissionGuard` giữ nguyên; capability thêm guard kiểm một truy vấn có index | ✓ Không đụng `core/`. ✓ Scale được. ✗ Hai nơi quyết định quyền |
| **C. Ownership resolver port** | `core/` khai port, capability cài đặt | ✓ Quyết định vẫn ở một chỗ. ✗ `can()` thành async |

**[REC] B** — cách duy nhất không làm `can()` thành async và không đưa một mảng
không giới hạn vào context của mọi request. Cái giá (hai nơi quyết định) được trả
bằng cách đặt guard đó **trong capability**, nơi nó là quy tắc nghiệp vụ — đúng như
README §A-4 phân định. `core/` vẫn không biết "trip" là gì.

> ⚠ Nếu chọn B thì `grantedPermissions()` (thứ frontend render theo) cũng phải trả
> lời được cho Driver. Bài học đã ghi trong `permission.ts` về `head-anywhere`: nếu
> `can()` và `grantedPermissions()` bất đồng, client vẽ nút mà server trả 403.

### A-8.3. Permission key — naming

**[DISCOVERY]** Convention hiện tại: `<resource>.<action>`, chữ thường, chấm phân
cách, **không** có tiền tố persona. Hôm nay là `unit.read`, `trip.write`,
`cost.void` — không phải `head.unit.read`.

★ Vì vậy dạng `driver.trip.read` **không khớp convention** — nó đặt persona vào tên
permission, đúng thứ mà mô hình quan hệ này tránh.

**[REC]** Hình dạng key (chưa chốt, phụ thuộc `[OPEN]` OD-7/OD-8):

| Key | Requirement | Ai |
|---|---|---|
| `trip.read.assigned` | `assigned` | Driver — **không** dùng `trip.read` vì bậc đó là `any` = toàn bộ bảng |
| `trip.completion.submit` | `assigned` | Driver — gửi đề nghị hoàn thành |
| `trip.completion.confirm` | `global` | SuperAdmin — xác nhận |
| `cost.create.assigned` | `assigned` | Driver |
| `cost.read.assigned` | `assigned` | Driver — xem lại của chính mình. ⚠ **Quyền ĐỘC LẬP với `cost.create.assigned`** — không suy ra từ nhau, không cấp kèm nhau (contract §8.5). Phạm vi R-2/R-3 còn `[OPEN]` — OD-15 |
| `trip.assign` | *(mới)* | Operations — phân công Driver |
| `cost.read` · `cost.review` · `cost.void` | *(còn `[OPEN]`)* | Accounting / Operations |

### A-8.4. API boundary

★ **Namespace riêng, không phải filter thêm vào route cũ.**

Lý do lấy thẳng từ `0012`: *"a caller without `cost.read` must never RECEIVE the
figures, rather than receive them and be trusted to hide them."*

Áp dụng cho Driver: thêm `?assignedToMe=true` vào `GET /trip-schedules` là **sai
kiến trúc**, vì handler đó chạy `@RequirePermission('trip.read')` — bậc `any` — và
một quên sót ở tầng service sẽ trả về toàn bộ bảng. Route riêng với permission riêng
làm cho lỗi đó **không biểu diễn được**.

```text
# --- Driver: My Bookings / My Trips ---------------------------------------
GET   /driver/trips                              trip.read.assigned
GET   /driver/trips/:tripId                      trip.read.assigned

# --- Driver: khai chi phí --------------------------------------------------
GET   /driver/trips/:tripId/expenses             cost.read.assigned
POST  /driver/trips/:tripId/expenses             cost.create.assigned
        { category, amount /* string */, note }

# --- Driver: đề nghị hoàn thành --------------------------------------------
POST  /driver/trips/:tripId/completion-request   trip.completion.submit

# --- SuperAdmin: xác nhận hoàn thành ---------------------------------------
GET   /trip-schedules/completion-requests        trip.completion.confirm
POST  /trip-schedules/:tripId/completion-request/:id/approve   trip.completion.confirm
POST  /trip-schedules/:tripId/completion-request/:id/reject    trip.completion.confirm

# --- Operations: phân công Driver ------------------------------------------
POST  /trip-schedules/:tripId/driver             trip.assign
```

**Ràng buộc bắt buộc, kế thừa từ hệ thống hiện tại:**

| Ràng buộc | Vì sao |
|---|---|
| `amount` là **string** trên wire, không bao giờ `z.number()` | JSON không có kiểu decimal; `z.number()` đi qua float64 và làm hỏng đúng thứ `NUMERIC` được chọn để tránh |
| Mọi route ghi phải có `CsrfGuard` | Quy tắc hiện hành trên mọi POST/PATCH |
| Mọi route phải có `PermissionGuard`, **không chỉ** `AuthGuard` | `PermissionGuard` là nơi duy nhất từ chối `mustChangeSecret` |
| `driverId` / `createdBy` **không bao giờ** từ body | Body tự khai tác giả là body khai được tên người khác |
| `tripId` trên **URL**, kiểm quyền theo URL | Scope không bao giờ trong body |
| Response `/driver/*` **không chứa** `agreed_amount`, tổng chi phí, hay trường thương mại nào | §A-2.7 |
| Không có route sửa bản ghi tài chính | Bản ghi tài chính bất biến |
| Không có `DELETE` | Rule B13 + GRANT của `bo_app` |
| List phải có phân trang | ADR-0002 (keyset), hoặc offset chỉ khi date range bắt buộc và có trần |

### A-8.5. Vị trí trong repo

```text
backend/src/capabilities/driver-portal/       ← MỚI, project-owned
├── api/          controller + zod DTO + security spec
├── application/  service
├── domain/       type thuần, không framework  (rule B10)
└── persistence/  SQL                          (rule B9, B11)
```

**Không** đặt vào `core/` — nó mang từ vựng nghiệp vụ (`driver`, `trip`), rule **B7**
sẽ báo đỏ. **Không** gộp vào `trip-schedule/` — bán kính dữ liệu khác hẳn và
controller phải guard khác.

### A-8.6. Frontend boundary

**[CONFIRMED]** UI theo mô hình **"My Bookings / My Trips"**, không phải bảng quản
trị Trip Schedule.

**[DISCOVERY]** Frontend hiện là **một** SPA React với **một** `MainLayout` và
**một** `RequireSession`. Không có app shell thứ hai, và repo **không có monorepo
tooling** — `backend/` và `frontend/` là hai project npm riêng, không workspace.

**[REC]** Một frontend project riêng cho Driver, mobile-first. Chấp nhận trùng lặp
component/API client ban đầu; dựng monorepo tooling chỉ vì việc này là
over-engineering. → `[OPEN]` **OD-9** cần trả lời **trước**: cookie `bo_session` là
`SameSite=Strict`; nếu Driver Portal ở domain khác thì cookie không được gửi và
người dùng đăng nhập thành công rồi ẩn danh ở request kế tiếp.

---

## B-4. Phân tách Driver Portal — boundary

**[CONFIRMED]** theo contract §1:

```text
Backoffice      →  Trip / Dispatch / Commercial / Admin
Driver Portal   →  Assigned Trips · Execution · Expense Declaration · Completion Request
AI              →  Decision support / anomaly. KHÔNG phải source of truth
```

**Backend:** một tiến trình NestJS, thêm **một capability mới**. Không tách service.
Không đặt vào `core/` — mang từ vựng nghiệp vụ, rule **B7** sẽ báo đỏ.

**Frontend:** dự án riêng. Repo hiện **không có** monorepo tooling (hai project npm
độc lập, không workspace) — dựng nó chỉ vì việc này là over-engineering.

**[REC] Nếu sau này cần shared package**, chỉ những thứ sau đáng chia sẻ — và **không
refactor gì bây giờ**: auth contract · API contract/types · design tokens · validation
primitives · common utilities. **Không** chia sẻ business logic giữa hai portal.

---


---

# PHẦN IV — DB DESIGN

## B-5. Identity — không có gì mới

**[CONFIRMED]** Dùng lại nguyên vẹn `users` · `identities` · `sessions` ·
`department_memberships`.

**[CONFIRMED] Không tạo role `DRIVER`.** `0004` khoá `role_key` ở hai giá trị bằng
CHECK constraint; contract §3 nói tư cách tài xế đến từ **assignment**, không từ nhãn.
Vậy **không cần đụng `0004`**.

★ **Câu hỏi phái sinh — [CEO DECISION]:** hệ thống có nên **ngăn** việc phân công một
người rõ ràng không phải tài xế (ví dụ kế toán) vào một chuyến không? Hôm nay không có
thứ gì để kiểm tra điều đó, vì không có nhãn tài xế. Ba hướng: (1) không kiểm, tin
người phân công; (2) kiểm theo department của người đó; (3) tạo một danh sách tài xế
riêng. **Chưa chốt.**

---

## B-6. Trip assignment

### B-6.1. Yêu cầu từ contract §4.2

```text
CURRENT ASSIGNMENT  ≠  ASSIGNMENT HISTORY

Đúng 1 ACTIVE assignment / trip        ← ràng buộc về hiện tại
Nhiều historical assignments / trip    ← lịch sử, KHÔNG BAO GIỜ ghi đè
```

Phải lưu được **mỗi lượt**: `trip_id` · `driver_id` · `assigned_at` · `assigned_by` ·
`ended_at` · `ended_by` · trạng thái assignment · provenance.

### B-6.2. Hình dạng đề xuất

**[REC]** Một bảng assignment riêng, **append + close**, không ghi đè.

| Trường khái niệm | Ghi chú thiết kế |
|---|---|
| `trip_id` | FK → `trip_schedules`. **Không** `ON DELETE CASCADE` — chuyến được archive, không xoá |
| `driver_id` | FK → **`users(id)`**, ★ **không** FK tới membership |
| `state` | `active` \| `ended` |
| `assigned_at` · `assigned_by` | `assigned_by` FK → `users(id)`, NOT NULL |
| `ended_at` · `ended_by` | NULL khi đang active; cả hai **đi cùng nhau** |
| `assigned_via` / `ended_via` | **[REC]** provenance kênh (`api` \| `bootstrap`), theo đúng mẫu `granted_via`/`revoked_via` của `0004` — nếu không có, một `ended_by` NULL không phân biệt được với cột ai đó quên điền |
| `end_reason` | **[CEO DECISION]** — đổi tài xế có bắt buộc nêu lý do không? |

★ **[CONFIRMED] Xe thuê ngoài KHÔNG tạo hình dạng assignment thứ hai.** Contract
§B-4.1b: xe công ty và xe thuê ngoài đi cùng một execution flow, nên **một** bảng
assignment phục vụ cả hai. Sự khác biệt nằm ở **Vehicle**, không nằm ở Assignment.

★ **`driver_id` phải trỏ tới `users(id)`, KHÔNG tới `department_memberships`.**
`0004` cố ý gắn head assignment với `membership_id` để đổi phòng là bãi nhiệm. Trip
assignment cần điều **ngược lại**: tài xế đổi phòng vẫn giữ nguyên lịch sử chuyến đã
chạy. Sao chép nhầm mẫu ở đây sẽ làm mất lịch sử đúng lúc cần nhất.

### B-6.3. ★ Làm sao DATABASE bảo đảm "1 trip = 1 active driver" mà vẫn giữ history

Đây là câu hỏi trung tâm của Phần 7 đề bài. Trả lời:

**Partial unique index trên `(trip_id)` với điều kiện `WHERE state = 'active'`.**

| Vì sao nó đủ | |
|---|---|
| Chỉ index các dòng **đang active** | Dòng `ended` **không** nằm trong index → lịch sử được giữ nguyên vẹn, muốn bao nhiêu dòng cũng được |
| Là ràng buộc **của database** | Không phải kiểm tra ở application. Hai request đồng thời → một thắng, một nhận `23505` |
| ★ **Đã có tiền lệ trong chính repo này** | `uq_single_active_membership` (`0003`) làm đúng việc này cho membership; `uq_single_active_head_per_department` (`0004`) làm đúng việc này cho trưởng phòng. Đây là mẫu của nhà, không phải phát minh |

**Kèm theo — CHECK constraint hai cột không được nói khác nhau:**
`(state = 'ended') = (ended_at IS NOT NULL)` — cùng hình dạng
`memberships_state_consistent` của `0003` và `trip_costs_void_state` của `0012`.

### B-6.4. Concurrency & transaction

| Tình huống | Cách xử lý |
|---|---|
| Hai người cùng phân công một chuyến | Partial unique index chặn. Bên thua nhận `23505` → dịch thành lỗi xung đột |
| **Đổi tài xế** | ★ **end-then-insert trong MỘT transaction.** Thứ tự do database ép: insert trước sẽ va vào unique index. Đây đúng là bài học `0004` đã ghi cho việc bàn giao SuperAdmin |
| Đổi tài xế song song với một thao tác khác trên cùng chuyến | **[REC]** khoá dòng chuyến (`lockById`) — đúng mẫu `membership.service` dùng khi enroll/transfer/archive |
| Repository tự mở transaction | ❌ **Cấm** — rule **B11**. Mọi method nhận `executor` tuỳ chọn |

**[WORKIK]** Xác nhận thứ tự end→insert và phạm vi khoá là đủ dưới tải thật.

### B-6.5. Index

| Mục đích | Hình dạng đề xuất |
|---|---|
| Bảo đảm 1 active/trip | **Partial unique** `(trip_id) WHERE state='active'` |
| ★ **"Chuyến của tôi"** — truy vấn nóng nhất của Driver Portal | **Partial** `(driver_id) WHERE state='active'` |
| Đọc lịch sử của một chuyến | `(trip_id)` — không partial, vì đọc lịch sử cần cả dòng đã kết thúc |
| Lịch sử của một tài xế | `(driver_id)` — không partial, cùng lý do |

⚠ **Bài học từ `0011`/ADR-0002 phải áp dụng:** danh sách "chuyến của tôi" gần như
chắc chắn sắp theo ngày. Chiều của index phải khớp `ORDER BY` **kể cả cột phá hoà**,
nếu không PostgreSQL thêm một bước sắp xếp lên trên. `0011` đã ghi lại đúng phát hiện
này cho `idx_trip_schedule_page`.

**[WORKIK]** Chiến lược index cho truy vấn join `assignment × trip_schedules` có phân
trang — chưa được đo.

---

## B-7. Driver execution

### B-7.1. Execution Event — append-only

**[CONFIRMED]** contract §6: Execution Event là khái niệm hạng nhất. Driver phát sinh
event; trạng thái là **hệ quả**, không phải thứ Driver sửa trực tiếp.

| Trường khái niệm | Ghi chú |
|---|---|
| `trip_id` | FK → `trip_schedules` |
| `driver_id` | Ai phát sinh — từ **phiên đăng nhập**, không bao giờ từ body |
| `assignment_id` | **[REC]** trỏ tới **lượt assignment** đang hiệu lực. Đây là thứ trả lời *"sự kiện này thuộc lượt giao nào"* khi chuyến đã đổi tài xế |
| `event_type` | `ARRIVAL` · `PICKUP_CONFIRMED` · `DELIVERY_CONFIRMED` — **[CONFIRMED]** ba giá trị tối thiểu |
| `occurred_at` | ★ **Do máy chủ ghi.** Không lấy từ thiết bị |
| `note` | **[CEO DECISION]** — tài xế có được ghi chú kèm event không? |

**Ràng buộc:** append-only. **Không** `UPDATE`, **không** `DELETE`, **không**
`updated_at`, **không** trigger — cùng lý do `trip_costs` không có (`0012`).

★ **Danh sách `event_type` là đóng, và mở rộng bằng migration có chủ đích** — đúng
nguyên tắc `0012` đặt ra cho category chi phí: *"a sixth REAL heading is welcome — as
a sixth named value, added by a migration somebody had to write on purpose."*

**[CEO DECISION]** Có cần event trung gian nào khác (`ACCEPTED`, `IN_TRANSIT`…) không
— contract §7.3 đang để ở **[PROPOSED]**.

### B-7.2. Điều cấm

**[CONFIRMED]**

1. **Không** biến mọi event thành một giá trị của `trip_schedules.status`.
2. **Driver không được sửa `trip_schedules.status`** — đó là trục điều độ.

**[GAP]** Hôm nay `PATCH /trip-schedules/:id/status` **không kiểm tra thứ tự chuyển
trạng thái** và **không lưu lại việc đó đã xảy ra**. Chuyến "ĐÃ XONG" đặt ngược lại
được, không để dấu vết.

### B-7.3. Index

`(trip_id, occurred_at)` — mọi lần đọc đều là "các sự kiện của chuyến này, theo thứ
tự thời gian".

---

## B-8. Completion Request

### B-8.1. Yêu cầu từ contract §10

```text
Driver → Completion Request → SuperAdmin Review → APPROVED / REJECTED → DONE
```

**[CONFIRMED]** Mỗi request là một record riêng · **không overwrite** request cũ ·
reject **bắt buộc có lý do và lý do phải được lưu** · Driver resubmit được.

### B-8.2. Hình dạng đề xuất

| Trường khái niệm | Ghi chú |
|---|---|
| `trip_id` · `assignment_id` | Lượt giao nào gửi đề nghị này |
| `submitted_by` · `submitted_at` | Từ phiên đăng nhập; thời điểm do máy chủ ghi |
| `state` | `pending` \| `approved` \| `rejected` |
| `decided_by` · `decided_at` | NULL khi `pending` |
| `decision_reason` | ★ **Bắt buộc khi `rejected`** |
| `attempt_no` | **[REC]** lần thứ mấy — để trả lời "bị từ chối mấy lần" mà không phải đếm |

### B-8.3. Ràng buộc bắt buộc

| Ràng buộc | Hình dạng |
|---|---|
| Trạng thái và quyết định không nói khác nhau | CHECK: `(state='pending') = (decided_at IS NULL)`, và `decided_at`/`decided_by` đi cùng nhau |
| ★ **Reject phải có lý do** | CHECK: `state='rejected'` ⟹ `decision_reason IS NOT NULL AND length(trim(...)) > 0`. **Cùng hình dạng** `trip_costs_void_state` + `trip_costs_void_reason_not_blank` của `0012` |
| Tối đa **1 pending** mỗi chuyến | **Partial unique** `(trip_id) WHERE state='pending'` — cùng mẫu §B-6.3. Ngăn Driver bấm hai lần tạo hai đề nghị |
| Nhiều request lịch sử | Được — dòng đã quyết định không nằm trong partial index |

★ **Đây là chỗ chặn "lỗi lý do từ chối bị vứt đi" lặp lại lần thứ ba.** Hai luồng
duyệt hiện có thu lý do trên giao diện rồi backend bỏ đi — nợ sản phẩm đã ghi nhận
trong tài liệu. Ở đây ràng buộc nằm ở **database**, nên nó không thể bị bỏ quên.

### B-8.4. Concurrency

Hai SuperAdmin cùng duyệt một request: `UPDATE ... WHERE state = 'pending'`, ai không
nhận được dòng trả về là người thua → lỗi xung đột. **Đúng mẫu** `trip_costs` dùng cho
void (`WHERE voided_at IS NULL`), và `0012` ghi rõ vì sao mẫu đó không cần transaction.

**[CONFIRMED]** Approve → Trip DONE, và DONE **đóng vĩnh viễn** — contract §10.5.
Bốn hệ quả (không reopen · không request mới · không đảo trạng thái · audit đầy đủ)
cộng với hai nghĩa vụ ở §B-18.8 tạo thành **năm** điều phải chứng minh.

**[CEO DECISION]** Chỉ còn: có giới hạn số lần resubmit không?

---

## B-9. Driver instructions & read boundary

### B-9.1. Yêu cầu

**[CONFIRMED]** contract §5.2: trường `driver_instructions` có cấu trúc · Driver API
**chỉ trả field được whitelist** · **không** trả nguyên `note` · commercial data bị
loại ở **backend response boundary** · đào tạo **không phải** security control.

### B-9.2. Phân loại từng trường

| Trường (hiện có) | Driver | Vì sao |
|---|---|---|
| `trip_customers.name` (qua FK) | ✅ | Chọn từ danh mục — nội dung được kiểm soát |
| `trip_vehicles.plate` (qua FK) | ✅ | Như trên |
| `scheduled_on` · `pickup_at` · `delivery_at` | ✅ | Có cấu trúc |
| `status` (dispatch) | **[CEO DECISION]** | Tài xế có cần thấy trạng thái điều độ không? |
| `pickup_address` · `delivery_address` | ⚠ văn bản tự do — **[CEO DECISION]** | Bắt buộc để làm việc, nhưng không kiểm soát nội dung |
| `pickup_contact` · `delivery_contact` | ⚠ văn bản tự do — **[CEO DECISION]** | Như trên |
| `cargo_info` | ⚠ văn bản tự do — **[CEO DECISION]** | Như trên |
| `note` | ❌ **Không** | Contract §5.2 — nơi điều độ ghi mọi thứ |
| `driver_instructions` *(mới)* | ✅ | Vùng dành riêng, đưa vào có chủ đích |
| `trip_costs.*` | Xem §B-10 | |
| `trip_outsource_hires.*` | ❌ **Không** | Thông tin thương mại đối tác |
| Tổng chi phí chuyến | ❌ **Không** | Con số tổng **bao gồm** giá thuê ngoài |

### B-9.3. Vị trí của `driver_instructions`

| Option | Ưu | Nhược |
|---|---|---|
| **A** — cột mới trên `trip_schedules` | Đơn giản, một join ít hơn | Thêm cột vào bảng đang nóng |
| **B** — bảng riêng 1-1 | Tách sạch vùng dữ liệu; sau này thêm cấu trúc (nhiều chỉ dẫn, có thứ tự) dễ hơn | Một join |

**[REC] A cho MVP**, vì contract đang mô tả một vùng nội dung đơn, không phải một tập
hợp. **[WORKIK]** xác nhận.

★ **[GAP] Dữ liệu đã tồn tại.** Các chuyến đã nhập trước ngày Driver Portal chạy
**không có** `driver_instructions`. **[CEO DECISION]:** để trống (tài xế không thấy
chỉ dẫn cho chuyến cũ), hay có một đợt xử lý dữ liệu cũ? ⚠ **Không** được backfill tự
động từ `note` — đó chính là điều contract §5.2 cấm.

### B-9.4. Thi hành ở đâu

**[CONFIRMED]** Whitelist phải nằm ở **read model của Driver Portal**, không phải ở
giao diện. Driver Portal đọc qua đường riêng của nó; **không dùng lại** đường đọc lịch
xe của Backoffice.

**[REC]** Chọn cột **tường minh** trong truy vấn, không `SELECT *` rồi loại bớt. Một
cột mới thêm vào `trip_schedules` sau này sẽ **không** tự động chảy sang Driver.

**[WORKIK]** Cách nào bảo đảm một cột mới thêm vào tương lai không tự động lộ ra —
đây là câu hỏi kiến trúc, không chỉ là quy ước code.

---

## B-10. Expense lifecycle

### B-10.1. Yêu cầu từ contract §9

```text
EXPENSE  (một entity duy nhất, vòng đời CÓ CHU TRÌNH)

        ┌──────────────────────────────┐
        ▼                              │
   EDITABLE ──(Driver gửi Completion)──► LOCKED
                                        │
                     ┌──────────────────┤
               (REJECT)            (APPROVE)
                     │                  ▼
                     └──────────►   IMMUTABLE   ★ vĩnh viễn, Trip → DONE
```

★ **`LOCKED` KHÔNG phải ranh giới bất biến** — nó là **tạm khoá**, mở lại được khi
bị từ chối. Ranh giới bất biến là **APPROVE**. contract §9.6.

Category giữ nguyên đúng 5: Dầu · Cầu trạm · Phí kho · Bốc xếp · Tăng ca.

★ **Ranh giới tuyệt đối:** operational expense **≠** commercial money. Hai nhóm hiện
đã nằm ở hai chỗ khác nhau trong schema và nhóm thương mại chưa được xây — contract
khớp với hệ thống hiện tại.

### B-10.2. ★ Xung đột với thiết kế hiện tại — và ba lối ra

**[GAP]** `trip_costs` hôm nay **không có** `updated_at`, **không có** trigger, và
**không có method sửa nào ở bất kỳ tầng nào** (controller / service / repository).
`0012` nói thẳng: *"An `updated_at` column would advertise an in-place edit that the
application must never perform."* Việc sửa hiện **không phát biểu được**, chứ không
phải bị cấm bằng quy ước.

| Option | Nội dung | Ưu | Nhược |
|---|---|---|---|
| **A** | Thêm `state` vào `trip_costs`, cho `UPDATE` **chỉ khi** `state='draft'` | Một bảng, một tổng, một nơi | Mở một đường sửa trên chính bảng được thiết kế để không có. **Phải** có cơ chế DB chặn update dòng đã khoá (§B-10.3) |
| **B** | Bảng nháp riêng; khi submit thì ghi sang `trip_costs` | `trip_costs` giữ nguyên **tuyệt đối** bất biến | Hai bảng cho một khái niệm; câu hỏi "tổng bao gồm nháp không" trở nên dễ nhầm; entity bị chẻ đôi trong khi contract §9.3 nói đây là **một** entity |
| **C** | `trip_costs` bất biến; sửa = void + tạo mới, kể cả khi còn nháp | Không thay đổi gì | ❌ **Vi phạm contract §9.1** — tài xế gõ nhầm một chữ số sẽ sinh ra hai dòng và một lý do void. Đây đúng là thứ contract bản 2 sửa |

**[REC] Option A**, với điều kiện §B-10.3 được thoả. Lý do: contract §9.3 nói rõ đây là
**một entity với một vòng đời**, và A là phương án duy nhất mô hình hoá đúng như vậy.
B chẻ một entity thành hai bảng để bảo vệ một thuộc tính mà A cũng bảo vệ được — bằng
ràng buộc thay vì bằng sự vắng mặt.

★ **[WORKIK] — đây là quyết định thiết kế quan trọng nhất trong toàn bộ tài liệu.**

⚠ **Bối cảnh đã đổi sau khi DL-40/DL-44 chốt:** vòng đời có **chu trình**
(`EDITABLE ⇄ LOCKED → IMMUTABLE`), nên phương án **B** (bảng nháp riêng, ghi sang
bảng chính khi submit) giờ phải xử lý cả chiều **ghi ngược** khi bị từ chối — nó
đắt hơn hẳn so với lúc được đề xuất. Cần đánh giá lại trong bối cảnh mới.

### B-10.3. Nếu chọn A — bất biến phải do DATABASE canh

Đề bài Phần 7 nói rõ: *không chấp nhận câu trả lời chỉ dựa vào application code.*

| Cần bảo đảm | Cơ chế đề xuất |
|---|---|
| ⚠ **Đã đổi:** dòng `locked` **vẫn mở lại được** khi REJECT | Cái phải chặn là dòng **`immutable`** (sau APPROVE), không phải `locked`. Xem §W-8 |
| Dòng `immutable` không bị `UPDATE` | **[WORKIK]** trigger, hay cột dẫn xuất? Repo hiện chỉ có trigger `set_updated_at`; đây sẽ là trigger mang **luật nghiệp vụ** đầu tiên |
| Không `DELETE` | Đã có: rule **B13** ở CI, **và** role runtime `bo_app` chỉ được `GRANT SELECT, INSERT, UPDATE` |
| Chuyển trạng thái một chiều | CHECK không diễn đạt được "trạng thái cũ"; cùng trigger ở trên xử lý |
| Void chỉ áp dụng cho dòng `locked` | CHECK giữa `state` và ba cột void |
| Ba cột void đi cùng nhau + lý do không rỗng | **Đã có sẵn** trong `0012` — giữ nguyên |
| Ai được sửa | `driver_id`/`created_by` = phiên đăng nhập; Driver chỉ sửa dòng của **chính mình** ở trạng thái `draft` |

**Concurrency:** submit/lock và void đều dùng mẫu `UPDATE ... WHERE state = <kỳ vọng>`
— ai không nhận được dòng là người thua. Đúng mẫu `trip_costs` đang dùng cho void.

### B-10.4. Cột bổ sung đề xuất

| Trường | Vì sao |
|---|---|
| `state` | `editable` \| `locked` \| `immutable` (+ trạng thái void đã có) — ★ chu trình, không tuyến tính |
| `locked_at` · `locked_by` | Mốc **tạm khoá** — do Completion Request gây ra, không phải mốc bất biến |
| `vehicle_ownership` *(snapshot)* | ★ Enforce cấm `fuel`/`toll` bằng `CHECK` cục bộ — DL-55 đã chốt là **đủ** |
| `source` | `driver_portal` \| `backoffice` — ★ trả lời câu *"khoản này do kênh nào nhập"*, thứ **không** suy ra được từ `created_by` vì một người có thể dùng cả hai |
| `assignment_id` | **[REC]** trỏ tới lượt giao đang hiệu lực — contract §4.4 đòi truy vết chi phí về đúng người khai, kể cả sau khi đổi tài xế |

**[CEO DECISION]** `total` của một chuyến có bao gồm khoản `draft` không? Contract để
mục này ở **[DEFERRED]** (E-6). ⚠ Đây là quyết định **kế toán**, và nó thay đổi ý
nghĩa của chữ "tổng".

### B-10.5. Audit các lần sửa trước khi khoá

**[CONFIRMED]** contract §14 đòi truy được "ai sửa expense trước lock".

**[REC]** Một bảng log append-only ghi mỗi lần sửa: khoản nào · ai sửa · khi nào · giá
trị trước · giá trị sau. **Không** dùng `updated_at` trên `trip_costs` làm câu trả lời
— một cột như vậy chỉ nói *lần cuối*, còn contract hỏi *tất cả các lần*.

**[WORKIK]** Phạm vi log: chỉ số tiền, hay mọi trường?

---

## B-11. Audit — tổng hợp

**[CONFIRMED]** contract §14. Cách repo này làm audit là **provenance nằm trên chính
bảng nghiệp vụ**, không phải một bảng audit vạn năng — xem `role_assignments` với
`granted_by`/`granted_via`/`revoked_by`/`revoked_via`. **[REC]** giữ nguyên phong cách
đó.

| Sự kiện | Được trả lời bởi |
|---|---|
| Ai assign / thay assignment | bảng assignment (§B-6.2) |
| Ai tạo expense | `trip_costs.created_by` — đã có |
| Ai sửa expense trước lock | log sửa (§B-10.5) — **mới** |
| Ai submit / lock | `locked_by` (§B-10.4) — **mới** |
| Ai void / correction | `voided_by` + `void_reason` — đã có |
| Ai submit completion | bảng completion request (§B-8.2) |
| Ai approve / reject + lý do | cùng bảng |
| Execution events | bảng event (§B-7.1) |
| Timestamp server-side | Mọi bảng. ★ **Không** nhận thời điểm từ thiết bị |

**Hai quy tắc tuyệt đối:** không `DELETE` · không ghi đè lịch sử quan trọng.

---

## B-12. Nguyên tắc chung & an toàn migration

| Nguyên tắc | Nội dung |
|---|---|
| Forward-only | Migration có checksum; runner từ chối khởi động nếu file đã chạy bị sửa. **Sửa sai bằng file mới** |
| Không `DELETE` | Rule **B13** ở CI **và** GRANT của `bo_app` (chỉ `SELECT, INSERT, UPDATE`) |
| Tiền | `NUMERIC`, **không bao giờ** float; string suốt đường; cộng bằng `SUM()` của PostgreSQL |
| Chuẩn hoá do DB tính | Cột `GENERATED ALWAYS` thay vì service tính — mẫu `plate_key` (`0011`), `requires_membership_status` (`0004`) |
| Ranh giới tầng | Rule **B9** (api ↛ SQL) · **B10** (domain ↛ framework) · **B11** (persistence ↛ tự mở transaction) |
| Đặt tên bảng | Tiền tố theo capability, như `trip_*` hiện có |

★ **[REC] Tách thành nhiều migration theo khái niệm**, không gộp tất cả vào một file:
assignment · execution events · completion requests · expense lifecycle ·
driver instructions. Mỗi file mang lập luận của chính nó — đúng văn hoá `0011`/`0012`.

**[WORKIK]** Thứ tự migration và ảnh hưởng khoá lên bảng đang có dữ liệu.

---

## B-13b. ★ Xe thuê ngoài — hệ quả lên schema

**[CONFIRMED]** contract §4.1b: cùng execution flow, cùng bảng assignment.
**[CONFIRMED]** contract §8.1b: hai loại tiền vẫn tách tuyệt đối.

### Ba GAP mới mà quyết định này làm lộ ra

| ID | Nội dung | Vì sao căng |
|---|---|---|
| **GAP-21** | `trip_vehicles` **không có khái niệm sở hữu** — chỉ `plate`, `note`, `status` | Nếu Trip phải có Vehicle và Vehicle có thể là xe thuê, danh mục xe phải nói được xe nào là của ai |
| **GAP-22** | `trip_outsource_hires.carrier_name` là **free text, cố ý không phải FK** | `0012` ghi rõ lý do: dữ liệu thật gồm `Hai Thành`, `Hải Râu`, `xe Út`, `Mr Đạt` — *một công ty, một biệt danh, xe của ai đó, và một con người*. Không ai biết dòng danh mục sẽ là **nhà xe**, **xe**, hay **tài xế**. ★ Quyết định mới **trả lời một phần** câu đó |
| **GAP-23** | Trạng thái `external_booking` và "xe này là xe thuê" có thể là **cùng một thông tin ở hai chỗ** | Hai nguồn sự thật cho cùng một sự kiện là hai thứ có thể lệch nhau |

★ **`0012` đã dự liệu ngày này** và ghi sẵn đường đi: *"When the shape is settled, a
nullable `carrier_id` is added beside this column and backfilled FROM it. Nothing
written before that day becomes wrong, and no row has to be re-entered."*
Quyết định của CEO là bước đầu tiên làm rõ hình dạng đó — nhưng **chưa đủ**; xem
câu hỏi Q-1…Q-6 trong báo cáo kèm theo.

### Ranh giới tiền phải giữ được ở tầng schema

**[REC]** Hai loại tiền tiếp tục sống ở **hai bảng riêng** như `0012` đã tách. Quyết
định mới **không** phải lý do để gộp chúng: nó chỉ nói hai loại có thể cùng xuất
hiện trên một chuyến, và `0012` vốn đã cho phép điều đó.

⚠ **[CEO DECISION]** Trên chuyến thuê ngoài, Driver khai operational expense nào —
xem Q-3. Đây là câu ảnh hưởng trực tiếp tới ý nghĩa của mọi báo cáo chi phí.

---

---


---

# PHẦN V — SCHEMA PROPOSAL

## B-17. Chín thực thể và quan hệ giữa chúng

```text
                         Carrier  (nhà xe)                         [MỚI]
                             │ 1
                             │ có nhiều
                             ▼ n
 users ──────────────────► Vehicle  (xe)                    [MỞ RỘNG 0011]
   │ (Driver = user            │  · sở hữu: công ty | thuê ngoài
   │  được assign)             │  · xe thuê ngoài thuộc một Carrier
   │                           │ 1
   │                           ▼ n
   │        ┌──────────────  Trip  (trip_schedules)         [MỞ RỘNG 0011]
   │        │                  │   + driver_instructions
   │        │                  │
   │ n      │ 1                ├──1──n──► Driver Assignment          [MỚI]
   └────────┴──────────────────┤             · 1 ACTIVE / trip
                               │             · nhiều historical
                               │
                               ├──1──n──► Execution Event            [MỚI]
                               │             · append-only
                               │
                               ├──1──n──► Completion Request         [MỚI]
                               │             · tối đa 1 PENDING / trip
                               │
                               ├──1──n──► Driver Operational Expense [MỞ RỘNG 0012]
                               │             · draft → locked → void
                               │             · 5 category
                               │
                               └──1──n──► Outsourced Vehicle Hire    [MỞ RỘNG 0012]
                                             · + carrier_id
                                             · ★ KHÔNG phải driver expense
```

★ **Driver KHÔNG phải một bảng.** Driver là `users` được gán vào Trip — contract §3.

★ **Không mô hình hoá quan hệ Driver ↔ Carrier.** Quy tắc chi phí ở contract §8.6 phụ
thuộc vào **sở hữu của chiếc xe trên chuyến đó**, không phụ thuộc vào việc tài xế làm
cho ai. Thêm quan hệ đó bây giờ là mô hình hoá một thứ chưa có câu hỏi nào cần tới.

---

## B-18. Từng thực thể

### B-18.1. Carrier — nhà xe · **[MỚI]**

**[CONFIRMED]** Q-4: nhà xe là một thực thể, một nhà xe có nhiều xe.

| Trường khái niệm | Ghi chú |
|---|---|
| `name` + khoá chuẩn hoá | **[REC]** dùng lại đúng mẫu `trip_customers.name_key` (`GENERATED ALWAYS`) — chuẩn hoá do database tính, không do service |
| `status` | `active` / `archived` — archive, không xoá |
| `created_by` · `created_at` · `updated_at` | Như hai danh mục hiện có |

★ **Đây chính là câu `0012` đã bỏ ngỏ.** Nó viết: *"A catalogue built now would have
to pick between carrier, vehicle and driver, and picking wrong means every row points
at the wrong kind of thing."* Quyết định Q-2 + Q-4 vừa chọn: **nhà xe** và **xe** là
hai thực thể riêng; **tài xế** không nằm trong đó.

**[REC] Đường di trú:** thêm `carrier_id` **nullable** cạnh `carrier_name` đang có,
backfill **từ** nó — đúng đường `0012` đã ghi sẵn. Không dòng nào đã ghi trở thành
sai, không dòng nào phải nhập lại.

### B-18.2. Vehicle — xe · **[MỞ RỘNG `trip_vehicles`]**

**[CONFIRMED]** Q-2: cùng một danh mục, sở hữu là một thuộc tính.

| Trường | Trạng thái |
|---|---|
| `plate`, `plate_key`, `note`, `status`, provenance | **Đã có** — giữ nguyên |
| `ownership` | **[MỚI]** `company` / `outsourced` |
| `carrier_id` | **[MỚI]** nullable — FK tới Carrier |

**Ràng buộc đề xuất:** `(ownership = 'outsourced') = (carrier_id IS NOT NULL)` — cùng
hình dạng `role_assignments_scope_shape` của `0004`.

⚠ **[WORKIK]** `uq_trip_vehicle_plate` hiện unique trên `plate_key WHERE status =
'active'`, **không phân biệt sở hữu**. Hai nhà xe khác nhau không thể có hai xe trùng
biển — điều đó đúng trong thực tế, nhưng cần xác nhận là **cố ý**.

### B-18.3. Trip — chuyến · **[MỞ RỘNG `trip_schedules`]**

| Trường | Trạng thái |
|---|---|
| 12 cột hiện có + `status` (5 giá trị điều độ) | **Đã có** — contract §7.2: **không đổi** |
| `driver_instructions` | **[MỚI]** — vùng dành riêng cho Driver (§B-9.3) |

★ **[CONFIRMED] contract §4.1e:** trạng thái điều độ và sở hữu xe là **hai thông tin
khác nhau**. Trạng thái `external_booking` **không** được suy ra từ `vehicle.ownership`
và ngược lại.

### B-18.4. Driver Assignment · **[MỚI]**

Đã mô tả ở §B-6. **[CONFIRMED] contract §4.1b:** xe thuê ngoài dùng **cùng** bảng này —
không có hình dạng assignment thứ hai.

### B-18.5. Execution Event · **[MỚI]**

Đã mô tả ở §B-7. Bổ sung theo contract §10.6:

★ **`occurred_at` là ACTUAL EXECUTION TIME** — đối chiếu với `pickup_at` /
`delivery_at` của Trip, vốn là **scheduled time**. Hai thứ này là nền cho rule giám
sát đúng giờ về sau, và **phải cùng tồn tại** thì mới so sánh được.

### B-18.6. Driver Operational Expense · **[MỞ RỘNG `trip_costs`]**

Đã mô tả ở §B-10. Bổ sung theo contract §8.6:

★ **Quy tắc mới cần enforce:** trên chuyến dùng **xe thuê ngoài**, không được khai
`fuel` và `toll` — vì hai khoản đó đã nằm trong giá thuê.

⚠ **Đây là ràng buộc LIÊN BẢNG** (`expense.category` × `trip.vehicle.ownership`), và
PostgreSQL **không** diễn đạt được bằng `CHECK`. Ba hướng — **[WORKIK]**:

| Hướng | Nội dung | Đánh giá |
|---|---|---|
| **1** | Trigger đọc sang Trip rồi sang Vehicle | Enforce ở DB. Thêm một trigger mang luật nghiệp vụ |
| **2** | Chụp `vehicle_ownership` xuống dòng expense lúc tạo, rồi `CHECK` cục bộ | ★ `CHECK` thuần, không trigger. Và nó **ghi lại sự thật tại thời điểm khai** — đúng văn hoá provenance của repo |
| **3** | Chỉ kiểm ở application | ❌ Không đạt yêu cầu "DB enforce" |

### B-18.7. Outsourced Vehicle Hire · **[MỞ RỘNG `trip_outsource_hires`]**

| Trường | Trạng thái |
|---|---|
| `carrier_name`, `agreed_amount`, `amount_includes_vat`, `document_ref`, void, provenance | **Đã có** — giữ nguyên |
| `carrier_id` | **[MỚI]** nullable, backfill từ `carrier_name` (§B-18.1) |

★ **[CONFIRMED] Đây KHÔNG phải Driver operational expense.** Hai bảng, hai ý nghĩa,
không bao giờ cộng chung như một loại. `0012` đã tách sẵn — quyết định mới **không**
phải lý do để gộp.

### B-18.8. Completion Request · **[MỚI]**

Đã mô tả ở §B-8. Bổ sung theo contract §10.5:

★ **DONE là điểm cuối vĩnh viễn — không reopen.** Nghĩa là sau khi có một request
`approved` cho một chuyến, chuyến đó **không** nhận thêm request nào nữa.

**[REC]** Diễn đạt bằng **partial unique index trên `(trip_id) WHERE state =
'approved'`** — tối đa một lần duyệt, mãi mãi. Cùng mẫu §B-6.3 và §B-8.3.

### B-18.9. Audit · **[phong cách hiện có]**

**[REC]** Provenance nằm trên chính bảng nghiệp vụ (§B-11), **cộng** một bảng log
append-only cho các lần sửa expense trước khi khoá (§B-10.5). Không dựng bảng audit vạn
năng.

---

## B-19. ★ Ràng buộc khó nhất: "xe thuê ⟹ bắt buộc có giá thuê"

**[CONFIRMED]** contract §4.1d, **một chiều**.

★ **PostgreSQL không diễn đạt được ràng buộc này bằng `CHECK` hay `FOREIGN KEY`** —
nó là một **ràng buộc tồn tại liên bảng**: *trip dùng xe outsourced* ⟹ *tồn tại ít
nhất một dòng hire chưa void cho trip đó*.

⚠ **Và nó còn khó hơn thế: hire có thể bị VOID.** Void dòng hire duy nhất sẽ làm
chuyến vi phạm ràng buộc **sau khi** nó đã hợp lệ.

Ba hướng — **[WORKIK]**, không tự chọn:

| Hướng | Nội dung | Đánh giá |
|---|---|---|
| **1** | Trigger hai chiều: chặn gán xe thuê khi chưa có hire, **và** chặn void hire cuối cùng | Enforce thật ở DB. Đắt, và trigger phải đúng ở cả hai chiều |
| **2** | Enforce ở service + một truy vấn đối soát định kỳ báo cáo chuyến vi phạm | Rẻ. ⚠ **Không** đạt "DB enforce" — vi phạm tồn tại trong khoảng giữa hai lần đối soát |
| **3** | Coi đây là ràng buộc **quy trình**, không phải ràng buộc dữ liệu | Rẻ nhất. Cần CEO chấp nhận rằng dữ liệu có thể tạm thời không nhất quán |

★ **Câu hỏi thật cho Workik:** ràng buộc này **cần chặt tới mức nào**? Đây là câu hỏi
về *hậu quả khi nó bị vi phạm*, không phải về kỹ thuật.

---

## B-20. Thời gian — scheduled vs actual

**[CONFIRMED]** contract §10.6.

| Khái niệm | Nguồn | Kiểu |
|---|---|---|
| Ngày của bảng điều độ | `trip_schedules.scheduled_on` | `DATE` — **không** timezone |
| Giờ lấy / giao **dự kiến** | `trip_schedules.pickup_at` / `delivery_at` | `TIMESTAMPTZ` |
| Giờ **thực tế** | Execution Event `occurred_at` | `TIMESTAMPTZ`, **do máy chủ ghi** |

⚠ **Hai cái bẫy `0011` đã ghi lại, vẫn áp dụng nguyên vẹn:**

1. `DATE` bị `pg` parse thành nửa đêm **local** — server UTC biến `2026-08-04` thành
   `2026-08-03` với người ở Hồ Chí Minh. Repository hiện ép `::text` cột này để tránh.
2. *"Tháng hiện tại"* phải tính theo lịch **Asia/Ho_Chi_Minh**, không theo đồng hồ
   server. Rule giám sát đúng giờ sau này phải theo cùng nguyên tắc.

★ **[REC]** Lưu mọi thời điểm ở `TIMESTAMPTZ`; **hiển thị và so sánh nghiệp vụ** theo
`Asia/Ho_Chi_Minh`. Không lưu giờ địa phương dưới dạng không có timezone.

---

## B-21. Điểm mở rộng cho GPS / evidence / AI

**[FUTURE]** — không implement. Nhưng schema phải **không cản đường**:

| Cần thêm sau này | Chỗ nó sẽ gắn vào | Có phải phá schema không? |
|---|---|---|
| Toạ độ + độ chính xác + nguồn định vị | Cột thêm vào **Execution Event** | Không — thêm cột nullable |
| Geofence verdict | Cột thêm vào Execution Event | Không |
| Toạ độ điểm lấy/giao | Cột thêm vào Trip, hoặc bảng địa điểm riêng | Không |
| Ảnh chứng từ | Bảng riêng trỏ tới expense / event | Không |
| Face verification | ★ **Ngoài database này** — contract §12.4 | — |
| AI finding | Bảng riêng trỏ tới expense / trip | Không |

★ **Lý do mô hình này không cản đường:** vì Execution Event là **append-only và
first-class**, mọi lớp giám sát về sau chỉ là **thuộc tính thêm vào một sự kiện đã
tồn tại**, không phải một trục dữ liệu mới.

---


---

# PHẦN VI — EXECUTION · GPS · AI · SECURITY

## A-9. Trip Execution & Completion

### A-9.1. Completion — GAP-15

Contract §2.5 đòi một thực thể **chưa tồn tại**: completion request có vòng đời
submit → approve/reject.

**[DISCOVERY]** Hôm nay: `PATCH /trip-schedules/:id/status` với `trip.write`. Không
đề nghị, không duyệt, không lịch sử ai xác nhận.

**[REC]** Bảng riêng append-only (`trip_completion_requests`), không phải một cột
trên `trip_schedules`. Ba lý do:

1. Nó có **vòng đời riêng** (pending → approved/rejected) và cần biết **ai** xác
   nhận, **khi nào**, và **vì sao** nếu từ chối.
2. Nó phải giữ được **nhiều lần đề nghị** — bị từ chối rồi gửi lại là chuyện bình thường.
3. Append-only khớp với rule B13 và với văn hoá provenance của repo.

Trip chuyển sang `done` là **hệ quả** của một approval, không phải một hành động độc
lập của Driver.

### A-9.2. Trạng thái thực thi — GAP-9

**[OPEN] OD-10.** Contract đã chốt hai đầu (được giao ↔ đề nghị hoàn thành) nhưng
**chưa** chốt các trạng thái ở giữa: `accepted`, `en_route_pickup`, `arrived_pickup`,
`picked_up`, `en_route_delivery`, `arrived_delivery`.

**[REC]** Nếu cần các trạng thái đó, dùng **bảng `trip_events` append-only** thay vì
thêm giá trị vào `trip_schedules.status`:

| Hướng | Đánh giá |
|---|---|
| Thêm giá trị vào `status` (5 → 10+) | ✗ Trộn hai chiều thông tin vào một cột. *"SX RỒI ĐANG ĐỢI XE"* và *"ĐÃ ĐẾN ĐIỂM LẤY"* không loại trừ nhau — cột sẽ nói dối một trong hai |
| Cột `execution_status` thứ hai | ✓ Giữ nguyên nghĩa cột cũ |
| **Bảng `trip_events` append-only** | ✓✓ Khớp B13, khớp provenance, và **là thứ Execution Event cần dù sao đi nữa** — contract §6 đã chốt Execution Event là khái niệm hạng nhất, và mỗi xác nhận GPS sau này chỉ là một event mang thêm toạ độ |

★ **Ranh giới rõ:** Driver **không** đổi `trip_schedules.status` (dispatch status).
Driver phát sinh event và gửi completion request; SuperAdmin xác nhận.

---

## A-10. GPS Verification Architecture

> ⚠ **Đổi từ vựng theo contract bản 2 §A-6.** *Check-in / check-out* **không** phải
> khái niệm nghiệp vụ — nó chỉ là thuật ngữ giao diện/kỹ thuật cho phần xác minh
> GPS. Khái niệm nghiệp vụ là **Arrival Confirmation**, **Pickup Confirmation**,
> **Delivery Confirmation** và **Completion Request**. GPS chèn vào *giữa* Arrival
> và Pickup/Delivery Confirmation, không thay thế chúng.

### A-10.1. Contract đã chốt khung — kỹ thuật bổ sung độ chính xác

Contract §2.9 nói GPS là **lớp xác minh + evidence**, không phải bằng chứng tuyệt
đối. Bổ sung kỹ thuật cho đúng nghĩa:

**[DISCOVERY]** GPS từ trình duyệt hoặc app là **dữ liệu do client khai báo**.
`navigator.geolocation` bị ghi đè bằng devtools trong vài giây; Android có nhiều
"fake GPS" app dùng được không cần root. Không có cách nào để server tin toạ độ mà
client gửi lên.

Nghĩa là thiết kế phải **ghi CLAIM kèm verdict**, không ghi PROOF.

### A-10.2. Thành phần đề xuất cho lớp xác minh đầu tiên

| Thành phần | Nội dung | Đã có? |
|---|---|---|
| Authenticated session | Cookie HttpOnly + CSRF | ✅ |
| Toạ độ do client khai | lat, lng | GAP-10 |
| **`accuracy` (mét)** | Accuracy 5m giữa thành phố là đáng ngờ; 2000m là wifi-positioning | GAP-10 |
| **Nguồn định vị** | GPS / network / fused | GAP-10 |
| `client_timestamp` **và** `server_timestamp` | Lệch giữa hai giá trị là tín hiệu bất thường rẻ nhất có thể có | GAP-10 |
| Geofence evaluation **ở server** | Server tính khoảng cách và **lưu verdict** | GAP-10 |
| Toạ độ điểm lấy/giao | ⚠ Hôm nay `pickup_address` là free text, không lat/lng | **GAP-14** |
| Append-only event | Không sửa, không xoá — hợp B13 | GAP-10 |
| Trip assignment | Ai đang xác nhận, cho chuyến nào | GAP-1 |

★ **GAP-14 là chặn cứng.** Không có toạ độ của kho SCSC, WENDELBO… thì không
geofence được. Đây là **dữ liệu nghiệp vụ phải đi thu thập**, không phải code — và
có thể là phần tốn thời gian nhất của phase GPS.

**[REC] Không chặn ở lần đầu triển khai.** Nếu tài xế ở ngoài bán kính, ghi event
kèm verdict `outside_geofence` và cho đi tiếp, đồng thời báo Operations. Chặn cứng
nghĩa là một tài xế ở tầng hầm không có sóng GPS không giao được hàng — và cách họ
giải quyết sẽ là gọi điện nhờ điều độ bấm hộ, tức là toàn bộ dấu vết trở thành vô
nghĩa. → `[OPEN]` **OD-11** (chặn / cảnh báo / chỉ ghi nhận).

### A-10.3. Verification signal — xếp theo hiệu quả trên chi phí

| Biện pháp | Chi phí | Hiệu quả | Giai đoạn |
|---|---|---|---|
| Server timestamp thay vì client timestamp | ~0 | Cao | ngay |
| Lưu `accuracy` + nguồn định vị | ~0 | Trung bình-cao (fake GPS thường trả accuracy hằng số) | ngay |
| Kiểm tính hợp lý vận tốc giữa hai event liên tiếp | thấp | **Cao** — 200km trong 10 phút là bất khả thi, và rule này chạy bằng SQL | sớm |
| Append-only + audit đầy đủ | ~0 (đã là văn hoá repo) | Cao (răn đe) | ngay |
| Device binding | trung bình | Cao | `[FUTURE]` |
| GPS của **xe** làm đối chứng | cao (phần cứng) | **Rất cao** — không do tài xế điều khiển | `[FUTURE]`, cần biết đội xe có thiết bị không → `[OPEN]` OD-12 |
| Face verification | rất cao (+ pháp lý) | Trung bình — xác thực *người*, không xác thực *vị trí* | `[FUTURE]` §A-12 |

---

## A-11. AI Architecture & Data Flow

### A-11.1. Điều chỉnh kỹ thuật quan trọng nhất

Contract §2.8 chốt AI là service riêng, decision support, trả `anomaly score` +
`signal` + `explanation` + `evidence`. Bổ sung một điểm về **thứ tự xây**:

★ **Ví dụ anomaly mà contract đưa ra không cần LLM. Nó là một câu SQL.**

```text
Driver A   28/08   Dầu = 1.500.000
           29/08   Dầu = 1.500.000
```

Đây là một rule: *cùng tài xế, cùng category, số tiền giống hệt, trong N ngày*. Chạy
bằng `SELECT` + `GROUP BY`, cho kết quả **tất định**, **giải thích được**, **không
tốn token**, và **không bao giờ hallucinate**. Một LLM làm việc này sẽ chậm hơn, đắt
hơn, và thỉnh thoảng sai.

**[REC] RULE ENGINE TRƯỚC, LLM SAU — và LLM không phải thứ ra quyết định:**

| Tầng | Việc | Công nghệ |
|---|---|---|
| 1. Rule engine | Ngưỡng, trùng lặp, tần suất, vận tốc bất khả thi, lệch so với trung bình theo tuyến | SQL / code thuần. **Không AI** |
| 2. Statistical | z-score, IQR trên chi phí theo tuyến/xe/tài xế | thư viện thống kê |
| 3. ML | Phát hiện mẫu không ai nghĩ ra trước | khi đã đủ dữ liệu lịch sử |
| 4. LLM | **Diễn giải** kết quả của 1–3 thành `explanation` cho người đọc | provider abstraction |

Tầng 4 **không** sinh ra anomaly score. Nó giải thích score đã có. Đó là ranh giới
giữ cho AI service không thành một chatbot đội lốt.

### A-11.2. Cấu trúc service

```text
ai/
├── README.md
├── docs/
├── src/
│   ├── main.ts
│   ├── config/
│   ├── api/            HTTP vào — backend gọi, không ai khác
│   ├── domain/         anomaly, severity, signal, finding — type thuần
│   ├── application/    orchestration
│   ├── rules/          ★ TẦNG 1 — nơi giá trị thật nằm ở giai đoạn đầu
│   ├── providers/      LLM abstraction (đổi được provider)
│   ├── persistence/    finding, prompt version, token/cost, audit
│   └── infrastructure/
├── tests/
└── Dockerfile
```

Chưa dựng ngay: `retrieval/` (chưa có gì để retrieve), `tools/` (chưa có tool nào để
gọi), `guardrails/` (chỉ cần khi LLM sinh text hướng người dùng). Thư mục rỗng "để
dành" là thứ README gốc §A-6 cấm thẳng: *"Không boilerplate, không scaffolding for later."*

### A-11.3. Phải có ngay từ ngày đầu

| Thứ | Vì sao không thể thêm sau |
|---|---|
| **Provider abstraction** | Đổi provider sau khi business logic đã dính vào một SDK là viết lại |
| **Prompt versioning** | Không có version thì không giải thích được vì sao tháng trước AI nói khác |
| **Model + version tracking trên mỗi finding** | Cùng lý do |
| **Token / cost tracking** | Chi phí LLM là thứ phát hiện khi hoá đơn về thì đã muộn |
| **Audit input** | Phải trả lời được: AI đã **nhận** dữ liệu gì khi đưa ra kết luận đó |
| **Determinism cho tầng 1** | Rule phải cho cùng kết quả với cùng input, mãi mãi |

### A-11.4. Data flow

```text
Driver khai expense
       │
       ▼
Backend NestJS  ── ghi trip_costs (nguồn sự thật)
       │
       │  ★ backend CHỦ ĐỘNG đẩy sang, AI không kéo về
       ▼
Payload đã authorize và tối giản
   { driverId, tripId, vehicleId, category, amount,
     expenseHistory[], tripHistory[], timestamps }
       │
       ▼
AI Service  ── rule engine → statistical → (LLM diễn giải)
       │
       ▼
Finding  { anomalyScore, signal, explanation, evidenceRefs[],
           severity, modelVersion, promptVersion }
       │
       ▼
Backend  ── lưu finding, gắn vào trip/driver
       │
       ▼
Backoffice  ── hiện cảnh báo cho SuperAdmin / Kế toán
       │
       ▼
CON NGƯỜI quyết định     ← AI không bao giờ tự kết luận (§2.8)
```

### A-11.5. Ranh giới dữ liệu AI

| # | Ràng buộc | Vì sao |
|---|---|---|
| 1 | AI service **không có credential database** — không phải "được cấu hình để không dùng", là **không tồn tại** | Cấu hình thì sửa được; credential không có thì không sửa được thành có |
| 2 | Backend đẩy payload **đã tối giản**, không đẩy row nguyên vẹn | Row nguyên vẹn mang theo cột hôm nay vô hại, ngày mai là thương mại |
| 3 | ★ Payload **không bao giờ** chứa dữ liệu thương mại | Anomaly về chi phí dầu không cần biết giá bán. Gửi kèm là mở rộng bán kính rò rỉ ra một service thứ hai, có thể là provider bên thứ ba |
| 4 | ★ Payload **không bao giờ** chứa PII không cần thiết — gửi `driverId` (UUID), **không** gửi tên, SĐT, số CMND | Nếu tầng 4 là LLM bên thứ ba thì payload rời khỏi tầm kiểm soát. UUID vô nghĩa với bên ngoài; tên thì không |

★ Ràng buộc 3 và 4 là **bổ sung kỹ thuật**, contract chưa nói tới. `note` của
`trip_costs` là **free text do tài xế gõ** — nó có thể chứa bất cứ thứ gì, kể cả
PII. Đẩy nguyên `note` sang một LLM bên ngoài là chuyển dữ liệu cá nhân qua biên
giới mà không có cơ sở pháp lý. → `[OPEN]` **OD-13**.

---

## A-12. Security, Privacy & Biometric

### A-12.1. Cơ chế đang đúng — phải giữ

| Cơ chế | |
|---|---|
| Session mờ phía server, DB chỉ lưu hash, cookie HttpOnly + SameSite=Strict | ✅ giữ |
| CSRF header trên mọi write | ✅ giữ |
| Guard opt-in theo route (sự vắng mặt nhìn thấy được) | ✅ giữ |
| Authorization nạp lại mỗi request, không cache | ✅ giữ |
| Fail-closed ở mọi nhánh không được cho phép tường minh | ✅ giữ |
| `mustChangeSecret` chặn mọi thứ | ✅ giữ |
| Login trả một phản hồi duy nhất cho 3 lý do hỏng | ✅ giữ |
| Runtime không có quyền `DELETE` ở tầng GRANT của PostgreSQL | ✅ giữ |
| CORS tắt mặc định, từ chối `*` lúc khởi động | ⚠ Driver Portal là origin thứ hai → phải khai thêm, **cụ thể** |

### A-12.2. Rủi ro mới

| # | Rủi ro | Mức |
|---|---|---|
| S-1 | **`trip.read` là `'any'`.** Tạo tài khoản cho tài xế = tài xế đọc toàn bộ lịch xe công ty, không cần khai thác gì | **CAO** |
| S-2 | **CONFLICT-1** (§A-7) — free text là đường rò rỉ thương mại, và contract nói *tuyệt đối không* | **CAO** |
| S-3 | Tài xế dùng thiết bị cá nhân, mạng công cộng, dễ mất máy | TRUNG BÌNH |
| S-4 | Endpoint driver là bề mặt tấn công mới, dùng bởi người không qua đào tạo bảo mật nội bộ | TRUNG BÌNH |
| S-5 | Toạ độ GPS là dữ liệu vị trí của **người lao động** — vừa là rủi ro vừa là nghĩa vụ pháp lý | TRUNG BÌNH-CAO |
| S-6 | AI service là nơi thứ hai dữ liệu tồn tại | TRUNG BÌNH |
| S-7 | Origin thứ hai + cookie `SameSite=Strict` có thể không hoạt động cross-site | TRUNG BÌNH — **cần trả lời trước Phase 1** (OD-9) |

### A-12.3. Khung pháp lý — Nghị định 13/2023/NĐ-CP (PDPD)

| Dữ liệu | Phân loại | Nghĩa vụ |
|---|---|---|
| Tên, SĐT, bằng lái tài xế | Dữ liệu cá nhân **cơ bản** | Thông báo, cơ sở xử lý, quyền truy cập/xoá |
| **Vị trí GPS theo thời gian** | Dữ liệu cá nhân — và với người lao động là **giám sát** | Thông báo rõ ràng, mục đích giới hạn, thời hạn lưu, có thể cần thoả thuận lao động |
| **Dữ liệu sinh trắc (khuôn mặt)** | Dữ liệu cá nhân **NHẠY CẢM** | ★ Đồng ý tường minh riêng biệt, đánh giá tác động, yêu cầu bảo mật cao hơn hẳn |

### A-12.4. Face verification — [FUTURE]

Contract §2.10 đã chốt: không phải requirement của MVP, và nó giải quyết **identity
assurance**, không giải quyết **location assurance**.

**Bổ sung kỹ thuật — nếu sau này quyết định làm:**

| Nguyên tắc | Nội dung |
|---|---|
| **Ngoài PostgreSQL chính** | Ảnh và template không bao giờ nằm trong database nghiệp vụ |
| **Qua bên thứ ba chuyên biệt** | Không tự dựng. Trách nhiệm tuân thủ chuyển được một phần |
| **Chỉ lưu template/hash + verdict** | Không bao giờ lưu ảnh thô |
| **Không đưa vào `ai/`** | Sinh trắc là xác thực, không phải operational intelligence. Trộn vào AI service là trộn hai loại rủi ro pháp lý vào một tiến trình |
| **Đồng ý riêng, thu hồi được** | Và phải có đường thay thế cho người từ chối — nếu không thì đó không phải đồng ý |
| **Thời hạn lưu tường minh** | ⚠ Va chạm trực tiếp với rule B13 |

★ **Mâu thuẫn kiến trúc cần biết trước:** PDPD cho người ta quyền yêu cầu **xoá** dữ
liệu cá nhân, còn rule B13 nói runtime không bao giờ phát `DELETE` và role `bo_app`
thậm chí **không được GRANT** quyền đó. Với dữ liệu vận hành thì không mâu thuẫn
(lưu trữ có cơ sở pháp lý). Với dữ liệu sinh trắc thì rất có thể mâu thuẫn.
**Cách giải: không để dữ liệu đó vào database này.**

---


---

# PHẦN VII — KẾ HOẠCH & REVIEW

## A-14. FUTURE ENHANCEMENTS

Không thuộc MVP, không chặn gì, ghi lại để không bị phát minh lại:

| Thứ | Trạng thái | Ghi chú |
|---|---|---|
| Multi-driver / co-driver / assistant driver | **[FUTURE]** | Contract §2.4 loại khỏi MVP. Đường nâng cấp: `driver_id` → bảng nối, backfill được |
| Driver pool / assignment marketplace | **[FUTURE]** | Như trên |
| Face verification / liveness | **[FUTURE]** §A-2.10, §A-12.4 | Identity assurance, không phải location assurance |
| Device binding | **[FUTURE]** | Rẻ và hiệu quả hơn GPS nhiều; nên cân nhắc **trước** face |
| GPS của xe làm đối chứng | **[FUTURE]** | ★ Nguồn đáng tin nhất vì không do tài xế điều khiển |
| Ảnh chứng từ giao hàng kèm EXIF | **[FUTURE]** | Phụ thuộc hạ tầng file (OD-6) |
| Báo cáo chi phí theo tài xế / xe / tuyến / tháng | **[FUTURE]** | Sau khi có dữ liệu thật |
| AI tầng 3 (ML) và retrieval | **[FUTURE]** | Chỉ khi tầng 1–2 đã chứng minh không đủ |
| Model dữ liệu thương mại (giá bán, doanh thu, công nợ) | **[FUTURE]** | ★ Khi xây **phải** nằm ngoài tầm Driver ngay từ migration đầu tiên |

---

## A-15. Implementation Phases

> Mỗi phase kết thúc bằng một thứ chạy được. Không phase nào chỉ là chuẩn bị.

### Phase 0 — Chốt các OPEN DECISION *(không code)*

Chốt §A-13. **Chặn.** Ưu tiên tuyệt đối: **OD-5** (CONFLICT-1), **OD-9** (domain +
cookie), **OD-1**, **OD-2**.

### Phase 1 — Driver identity & access

- OD-1 → mô hình credential; OD-2/OD-3 → membership
- ★ **GAP-2** — bậc quyền theo assignment (§A-8.2, hướng B)
- OD-9 phải có đáp án **trước** khi viết dòng frontend nào
- **Kết quả:** một tài xế đăng nhập được và **không** đọc được gì ngoài phần của mình

### Phase 2 — Driver trip portal ("My Bookings")

- **GAP-1** — gán Driver vào Trip (1-1, cột `driver_id`)
- Capability `driver-portal/` + `GET /driver/trips`
- ★ **OD-5 / CONFLICT-1** phải được giải quyết ở đây — có thể kéo theo **GAP-17**
  (`driver_instructions`)
- Frontend Driver riêng, mobile-first
- **Kết quả:** tài xế thấy chuyến của mình, không thấy chuyến người khác, không thấy
  bất kỳ dữ liệu thương mại nào

### Phase 3 — Driver expense

- `cost.create.assigned`, dùng lại nguyên `trip_costs` + 5 category
- **GAP-8** — cột `source` + ownership
- ⚠ Quyền sửa/void: xem **contract §9** (đã chốt: sửa được khi editable) + **[DEFERRED]** E-1…E-8
- **Không** kèm evidence — đó là Phase 3.5
- **Kết quả:** tài xế khai được chi phí, backoffice thấy ngay, provenance đầy đủ

### Phase 3.5 — Evidence *(chỉ khi OD-6 ≠ A)*

Hạ tầng file: object storage ngoài DB, ký URL có hạn hoặc proxy qua backend, giới
hạn kích thước, whitelist MIME, strip EXIF, vòng đời khi bản ghi bị void.

### Phase 4 — Execution events + Completion

- **GAP-15** — `trip_completion_requests`, submit → SuperAdmin confirm → Trip DONE
- **GAP-14 trước tiên** — thu thập toạ độ điểm lấy/giao (có thể là phần lâu nhất)
- **GAP-10** — `trip_events` append-only; OD-10, OD-11, OD-12, OD-13
- **Kết quả:** vòng đời chuyến khép kín, có dấu vết thực địa kiểm toán được

### Phase 5 — Expense review & reporting

- OD-4 → luồng review; OD-8 → nới `cost.read` đúng người
- Báo cáo theo tài xế / xe / tuyến / tháng
- **Kết quả:** kế toán làm việc trong hệ thống thay vì trong Excel

### Phase 6 — AI anomaly detection

- ★ **Rule engine trước** (§A-11.1) — nhiều khả năng đã bắt được phần lớn giá trị
- AI service riêng, provider abstraction, **không có credential DB**
- LLM chỉ diễn giải; output đúng dạng §A-2.8
- **Kết quả:** cảnh báo bất thường có `score` + `signal` + `explanation` + `evidence`,
  cho SuperAdmin quyết

### Phase 7 — Face verification *(chỉ khi thực sự cần)*

**[FUTURE]** §A-2.10, §A-12.4. Đánh giá lại sau Phase 4 bằng số liệu thật, thay vì lên
lịch trước.

---

## A-16. Risks

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R-1 | ★ **CONFLICT-1 chưa giải mà Phase 2 vẫn chạy** → contract "tuyệt đối không thấy giá" bị vi phạm ngay ngày đầu | **CAO** | OD-5 là điều kiện tiên quyết của Phase 2 |
| R-2 | **S-1: `trip.read` = `'any'`** → tạo tài khoản tài xế là rò rỉ toàn bộ lịch xe, **không ai phải viết dòng code sai nào** | **CAO** | Namespace `/driver/*` riêng + GAP-2, ngay từ Phase 1–2 |
| R-3 | **GAP-2 đụng vào ranh giới `core/`** | **CAO** | Hướng B (§A-8.2) — guard ở capability, `core/` không đổi |
| R-4 | Nới `cost.*` sai người → lộ cơ cấu chi phí. Source cảnh báo: *"un-disclosing is not possible"* | **CAO** | Giữ fail-closed; nới từng bậc, có OD-8 ký |
| R-5 | **GAP-15** bị coi nhẹ thành "một cột status" → mất lịch sử ai xác nhận, và mất khả năng gửi lại sau khi bị từ chối | TRUNG BÌNH-CAO | Bảng riêng append-only (§A-9.1) |
| R-6 | Coi GPS là bằng chứng chống gian lận | TRUNG BÌNH-CAO | Contract §2.9 đã chốt đúng; §A-10.1 giữ cho implementation không trôi |
| R-7 | **GAP-14** (toạ độ điểm lấy/giao) phát hiện muộn, chặn cả Phase 4 | TRUNG BÌNH | Bắt đầu thu thập từ Phase 2 |
| R-8 | **OD-9** trả lời muộn → phải làm lại kiến trúc xác thực của portal | TRUNG BÌNH | Khảo sát trước Phase 1 |
| R-9 | Frontend thứ hai = trùng lặp component, style, API client, auth logic | TRUNG BÌNH | Chấp nhận trùng lặp ban đầu; dựng monorepo tooling chỉ vì việc này là over-engineering |
| R-10 | AI thành chatbot vì thiếu usecase rõ | TRUNG BÌNH | Rule engine trước; AI **phải** trả `evidenceRefs`, không chỉ text |
| R-11 | Review state (OD-4) mâu thuẫn tính bất biến của bản ghi tài chính | TRUNG BÌNH | Bảng riêng, không thêm cột |
| R-12 | Hiểu nhầm "Accounting chỉnh sửa dữ liệu giá" thành "Accounting sửa `trip_costs`" | TRUNG BÌNH | Làm rõ ở cuối §A-13 |
| R-13 | `docs/architecture/adr-0003-trip-schedule-offset-pagination.md` được tham chiếu ở 2 nơi nhưng **không tồn tại** | THẤP | Ghi nhận; ngoài phạm vi |

---

## B-15. Assumptions đã dùng

Ghi ra để có thể bác bỏ. **Không** cái nào là quyết định.

| # | Assumption | Nếu sai thì sao |
|---|---|---|
| A-1 | Driver Portal gọi API dưới **cùng origin của chính nó** (nginx proxy `/api/`) | §B-3.2 Option B đảo chiều: phải sửa cookie `domain` + CORS |
| A-2 | Nhóm thương mại (giá bán, doanh thu) vẫn **chưa được xây** khi Driver Portal chạy | Phải rà lại §B-9.2 trước khi nhóm đó xuất hiện |
| A-3 | Một chuyến có **một** vùng chỉ dẫn cho tài xế, không phải danh sách | §B-9.3 chuyển sang Option B |
| A-4 | Đổi tài xế là **hiếm** | Không đổi thiết kế — history vẫn được giữ dù hiếm hay thường |
| A-5 | Tài xế khai chi phí **trong lúc** chạy, không phải hàng loạt sau đó | Ảnh hưởng thời điểm khoá (E-2) |
| A-6 | Không có yêu cầu pháp lý buộc **xoá** dữ liệu ở phase này | Va chạm với rule B13 — cần ngoại lệ tường minh |

---

## B-14. WORKIK REVIEW CHECKLIST

> ★ **DB design chưa được xem là final cho đến khi Workik review.**

| # | Hạng mục | Câu hỏi trọng tâm |
|---|---|---|
| 1 | **Assignment model** | Hình dạng ở §B-6.2 có đủ cho audit trách nhiệm không? `driver_id` → `users(id)` thay vì membership có đúng không? |
| 2 | **Active assignment uniqueness** | Partial unique `(trip_id) WHERE state='active'` có thật sự đủ dưới mọi đường ghi? |
| 3 | **Historical assignment integrity** | Có đường nào làm mất lịch sử không? CHECK state ↔ `ended_at` đã kín chưa? |
| 4 | **Execution Event model** | Append-only có đủ để suy ra trạng thái thực thi? `assignment_id` trên event có đúng chỗ? |
| 5 | **Completion Request model** | Partial unique trên `pending` có chặn đúng double-submit? Ràng buộc "reject phải có lý do" đã kín chưa? |
| 6 | **Expense lifecycle** | ★ **Option A/B/C ở §B-10.2 — chọn cái nào?** Đây là quyết định lớn nhất |
| 7 | **Expense immutability boundary** | Trigger ở §B-10.3 có phải cơ chế đúng? Repo chưa có trigger mang luật nghiệp vụ nào |
| 8 | **Audit model** | Provenance trên bảng nghiệp vụ có đủ, hay cần bảng audit riêng? Phạm vi log sửa? |
| 9 | **Driver data isolation** | Whitelist ở read model có chặn được cột mới thêm trong tương lai không? |
| 10 | **Index strategy** | Index cho "chuyến của tôi" + phân trang; chiều index khớp `ORDER BY` gồm cả tiebreaker |
| 11 | **Transaction / concurrency** | end-then-insert khi đổi tài xế; phạm vi khoá; các mẫu `UPDATE ... WHERE <state kỳ vọng>` |
| 12 | **Security / privacy boundary** | Driver read path; không rò rỉ qua văn bản tự do; ranh giới phiên (§B-3) |
| 13 | **Migration safety** | Forward-only; thứ tự; ảnh hưởng khoá; dữ liệu đã tồn tại (§B-9.3) |
| 15 | **Vehicle ownership & carrier model** | §B-18.1–18.2 — hình dạng Carrier; `carrier_id` backfill từ `carrier_name`; unique biển số không phân biệt sở hữu có cố ý không? |
| 16 | ★ **Cross-table constraint** | §B-19 — *xe thuê ⟹ có giá thuê* và §B-18.6 *cấm fuel/toll trên chuyến thuê*. Cả hai `CHECK` không làm được. Trigger, snapshot, hay chấp nhận lỏng? |
| 17 | **Completion permanence** | §B-18.8 — partial unique trên `approved` có đủ để bảo đảm DONE vĩnh viễn? |
| 18 | **Scheduled vs actual time** | §B-20 — mô hình thời gian có đủ cho rule giám sát đúng giờ, và có tránh được bẫy `DATE` của `0011`? |
| 14 | **PostgreSQL-specific correctness** | Ngữ nghĩa partial unique index; hành vi trigger; `NUMERIC` ↔ text; `DATE` vs `TIMESTAMPTZ` (bẫy lệch ngày đã ghi trong `0011`) |

---

## Phụ lục A — Bảng tra GAP

| ID | Nội dung | Vị trí | Phase |
|---|---|---|---|
| GAP-1 | Không có gán Driver ↔ Trip | schema + capability | 2 |
| **GAP-2** | ★ `can()` không có bậc quyền theo assignment | `core/authorization/` | 1 |
| GAP-4 | Bất biến #6 buộc Driver phải thuộc một department | `0003` | 1 |
| GAP-5 | Đăng nhập chỉ bằng email + domain allowlist | `core/identity/` + `core/users/domain/email.ts` | 1 (OD-1) |
| GAP-6 | Không có trạng thái review cho expense | `0012` | 3/5 |
| GAP-7 | Không có hạ tầng file / evidence | toàn hệ thống | 3.5 |
| GAP-8 | Expense không phân biệt ownership và kênh nhập | `trip_costs` | 3 |
| GAP-9 | Trip status là màu Excel, không phải vòng đời thực thi | `0011` | 4 |
| GAP-10 | Không có Execution Event / event log | mới | 4 |
| GAP-11 | Không có app shell thứ hai cho Driver | `frontend/` | 2 |
| GAP-12 | Không có hạ tầng gọi AI (HTTP client, queue, job) | `backend/` | 6 |
| GAP-14 | Điểm lấy/giao là free text, không có toạ độ | `0011` | 4 — bắt đầu sớm |
| **GAP-15** | ★ Không có completion request / approval | mới | 4 |
| **GAP-17** | Không có trường operational instructions riêng cho Driver | `0011` | 2 (OD-5) |
| **GAP-18** | ★ Không có trạng thái editable/draft cho khoản chi | `0012` | 2 |
| **GAP-19** | Không có submit / lock cho khoản chi | `0012` | 2 |
| **GAP-20** | Audit không lưu các lần sửa trước khi khoá | mới | 2 |
| **GAP-21** | ★ Danh mục xe không phân biệt xe công ty / xe thuê ngoài | `0011` | 1–2 |
| **GAP-22** | ★ `carrier_name` là free text, không nối tới xe hay chuyến | `0012` | 1–2 |
| **GAP-24** | ★ Không có thực thể **Nhà xe (Carrier)** | mới | 1–2 |
| **GAP-25** | ★ Ràng buộc *xe thuê ⟹ có giá thuê* là **liên bảng**, `CHECK` không diễn đạt được | mới | 1–2 |
| **GAP-26** | ★ Cấm khai `fuel`/`toll` trên chuyến xe thuê cũng là ràng buộc **liên bảng** | mới | 2 |
| **GAP-27** | Không lưu **actual execution time** để đối chiếu scheduled time | mới | 3 |

## Phụ lục B — Nguồn đã đọc

```text
backend/migrations/0001,0003,0004,0011,0012           schema thật
backend/src/core/authorization/domain/permission.ts   12 permission, 5 bậc requirement
backend/src/core/authorization/domain/authorization.context.ts        can(), grantedPermissions()
backend/src/core/authorization/domain/authorization.context.spec.ts   ★ hành vi đã được test
backend/src/core/authorization/README.md
backend/src/core/identity/README.md
backend/src/core/users/README.md · domain/email.ts
backend/src/capabilities/trip-schedule/  README, domain, application, api  (toàn bộ)
backend/src/app.module.ts                             composition root
backend/scripts/check-boundaries.sh                   14 rule ranh giới, gồm B13
backend/scripts/provision-db-roles.sql                bo_app: SELECT/INSERT/UPDATE, không DELETE
docs/architecture/core-001-…-invariants.md            bảng invariant register
docs/backend/frontend-integration-contract.md         role matrix, hạn chế đã biết
docs/backend/company-email-policy.md                  mô hình định danh 4 giá trị
frontend/package.json · src/App.tsx · src/pages/       stack và cấu trúc thật
deploy/README.md                                      contract triển khai
```

---

*Tài liệu này là CONTRACT + DISCOVERY. Không có code, migration, API, UI hay thay
đổi permission nào đi kèm. Mục §A-2 là nghiệp vụ đã chốt; mọi mục đánh dấu `[GAP]`,
`[OPEN]` hoặc `[REC]` chưa phải quyết định implement.*

---

# PHẦN VIII — WORKIK REVIEW: VERDICT & ACCEPTED DESIGN

> **Phạm vi:** **toàn bộ operational lifecycle của Trip**. Driver Portal là **một
> application surface** của lifecycle đó, không phải lifecycle riêng.

## W-0.0 Phạm vi mô hình của package này

**[CONFIRMED]** Toàn bộ PHẦN VIII viết theo mô hình MVP:

```text
1 Trip = 1 Customer + 1 Vehicle + 1 Driver
```

★ Đây là mô hình **đúng**, không phải giả định cần sửa. Xem **§0.8**.

Nhiều operational segment là **[FUTURE EXTENSION]** — không thiết kế ở phase này. Năm
nguyên tắc giữ đường mở rộng nằm ở **§0.8.3**, và chúng **không** thay đổi gì trong
package này ngoài một điểm: **§0.8.3 X-2** — chụp `vehicle_id` xuống event/expense
thay vì join ngược lên Trip.

---

## W-0. ★ FINAL WORKIK VERDICT

```text
FINAL WORKIK VERDICT:

        READY FOR CLAUDE DESIGN UPDATE
```

⚠ **KHÔNG phải `READY FOR MIGRATION`. Hai khái niệm khác nhau.**

**Workik xác nhận:** không còn technical blocker · schema đủ cho Driver accountability
· đủ cho CEO operational observability · stuck-trip detection khả thi · scheduled ↔
actual timeline khả thi · `Asia/Ho_Chi_Minh` canonical · Driver + Vehicle provenance
giữ được xuyên suốt · expense lifecycle khả thi · outsourced dùng chung execution flow
· DONE terminal · GPS/AI có extension point.

### Bốn cổng trước khi được viết migration

```text
1. design.md cập nhật            ← tài liệu này, ĐÃ XONG
2. CEO decisions cần thiết chốt  ← W-12, còn 5 câu OPEN
3. Schema final review           ← chưa
4. Migration plan được duyệt     ← chưa
```

★ **Chưa vượt cổng 2. Không viết migration.**

### Hai kết luận của Workik làm thay đổi thiết kế

| | |
|---|---|
| **Vehicle Assignment History** | ✅ **Được chấp nhận** — GAP-30 trở thành một entity thật. Xem W-2 |
| **Execution event là 4 loại phẳng** | `ARRIVED_PICKUP` · `PICKUP_CONFIRMED` · `ARRIVED_DELIVERY` · `DELIVERY_CONFIRMED`. Giải quyết DL-30 theo hướng **enum phẳng** |

⚠ **Cần đồng bộ:** hai điều trên là thay đổi **trạng thái quyết định**, mà theo
governance thì nơi quản lý trạng thái là [`decisions.md`](decisions.md). Task này
**chỉ cho phép sửa `design.md`**, nên `decisions.md` **chưa** được cập nhật — xem báo
cáo kèm theo.

---

## W-1. NĂM ĐIỀU KIỆN KỸ THUẬT CỦA WORKIK

### C1 — TI-1 · Composite provenance capture

★ **Mục tiêu: KHÔNG BAO GIỜ tạo được một tổ hợp provenance chưa từng tồn tại.**

Cấm tuyệt đối: một execution event hoặc expense mang `Driver A + Vehicle B` **nếu
hai giá trị đó chưa từng cùng có hiệu lực trên Trip tại thời điểm ghi**.

★ Trong MVP: `Driver` đến từ **Driver Assignment `active`**, `Vehicle` đến từ
**`Trip.vehicle_id`** — cả hai đọc trong **cùng một câu lệnh ghi**.

| Yêu cầu | Nội dung | Nhãn |
|---|---|---|
| **Single-statement capture** | Mọi execution event / expense phải lấy `driver_assignment_id` (từ Driver Assignment `active`) **và** `vehicle_id` + `ownership` (từ `Trip`) **trong chính câu lệnh ghi** — `INSERT … SELECT`. ★ **Không** nhận chúng từ client, và **không** đọc trước rồi ghi sau | **[APPLICATION MUST ENFORCE]** |
| **Kết quả rỗng = không ghi** | Nếu một trong hai assignment không `active` tại thời điểm câu lệnh chạy, `SELECT` trả 0 dòng → **không có row nào được tạo**. Không cần kiểm tra trước | [APPLICATION] |
| **Composite FK** | `(driver_assignment_id, trip_id)` phải tham chiếu khoá tổ hợp trên bảng Driver Assignment — để một event **không thể** trỏ tới assignment của Trip khác | **[DB MUST ENFORCE]** |
| **Vehicle provenance** | ★ Trong MVP không có Vehicle Assignment. Câu lệnh ghi **chụp `Trip.vehicle_id` + `ownership`** xuống dòng event/expense — §0.8.3 X-2 | **[APPLICATION MUST ENFORCE]** |
| **Transaction boundary** | Ghi event/expense là **một** transaction. Nếu nằm trong một thao tác lớn hơn (ví dụ submit Completion Request) thì dùng chung transaction của thao tác đó | [APPLICATION] |
| **Lock strategy** | Khoá dòng **Trip** (`SELECT … FOR UPDATE`) khi thao tác **đổi** assignment. Ghi event/expense **không** cần khoá — `INSERT … SELECT` đã đủ | **[WORKIK REVIEW REQUIRED]** xác nhận dưới tải thật |
| **Concurrency** | Đổi Driver ‖ Driver ghi event: một trong hai thắng. Nếu assignment kết thúc trước, event **không** được tạo — thay vì tạo với provenance sai | [APPLICATION] |

★ **Vì sao không đọc-rồi-ghi:** giữa lần đọc và lần ghi, điều độ có thể đổi tài xế.
Đọc trước rồi ghi sau tạo ra đúng thứ điều kiện này cấm — một tổ hợp chưa từng tồn tại.

### C2 — TI-3 · Execution Event voidable

| Trường | Nội dung | Nhãn |
|---|---|---|
| `is_voided` | Sự kiện này đã bị huỷ hiệu lực | [DB] |
| `cancels_event_id` | Sự kiện này **huỷ** sự kiện nào (nullable, tự tham chiếu) | [DB] |

**Quy tắc:**

| | Nhãn |
|---|---|
| Huỷ một sự kiện = **chèn một sự kiện mới** mang `cancels_event_id`, **không** xoá dòng cũ | **[DB MUST ENFORCE]** insert-only |
| ★ Dòng bị huỷ: **chỉ** cột `is_voided` được phép đổi. Mọi cột khác bất biến | **[WORKIK REVIEW REQUIRED]** trigger, hay cột dẫn xuất từ `cancels_event_id`? |
| **Canonical KPI chỉ tính sự kiện `is_voided = false`** | **[READ MODEL]** |
| Event history **không** bị overwrite / delete | **[DB]** — rule B13 + GRANT `bo_app` |

★ **[WORKIK REVIEW REQUIRED]** `is_voided` là **cột được cập nhật** hay **giá trị suy
ra** từ sự tồn tại của một dòng `cancels_event_id = <id này>`? Phương án thứ hai giữ
bảng **hoàn toàn** insert-only nhưng làm mọi truy vấn KPI phải tự loại trừ.

### C3 — Expense lifecycle

```text
   EDITABLE ──(Driver submit Completion Request)──► LOCKED
       ▲                                              │
       │                                    ┌─────────┤
       └────────────(REJECT)────────────────┘    (APPROVE)
                                                      ▼
                                                  IMMUTABLE
```

★ **Financial immutability thực sự bắt đầu tại APPROVE, không phải LOCK.**
`LOCKED` là **tạm khoá** — mở lại được. → contract §9.6.

| | Nhãn |
|---|---|
| Driver sửa được khi `EDITABLE`, chỉ dòng của chính mình | [APPLICATION] |
| **Mọi lần sửa phải có provenance** — Expense Edit Log append-only | **[DB MUST ENFORCE]** |
| Khoá toàn bộ expense của Trip cùng lúc khi submit | [APPLICATION] — cùng transaction |
| REJECT mở lại toàn bộ về `EDITABLE` | [APPLICATION] — cùng transaction |
| APPROVE → `IMMUTABLE` vĩnh viễn | **[DB MUST ENFORCE]** trigger T2, xem C4 |

### C4 — DONE enforcement

**Sáu write path phải bị chặn sau DONE:**

```text
DONE  ⟹  ❌ status transition      ❌ execution event mới
          ❌ expense mới / sửa      ❌ completion request mới
          ❌ đổi Driver assignment  ❌ đổi Vehicle assignment
```

| Lớp | Cơ chế | Nhãn |
|---|---|---|
| **Trip-row lock** | `SELECT … FOR UPDATE` trên dòng Trip trong mọi thao tác ghi con | **[APPLICATION MUST ENFORCE]** |
| **Application guard** | Kiểm `closed_at IS NULL` trước mọi write path | **[APPLICATION MUST ENFORCE]** |
| **Trigger T1** | Chặn `DONE → non-DONE` trên `trip_schedules.status` | **[DB MUST ENFORCE]** |
| **Trigger T2** | Chặn `UPDATE` dòng expense đã `IMMUTABLE` | **[DB MUST ENFORCE]** |
| **Trigger T3** | Deny `DELETE` — ★ lớp thứ hai bên cạnh GRANT `bo_app` đã không có `DELETE` | **[DB MUST ENFORCE]** |
| **Child-write guard** | Chặn INSERT vào event / expense / completion request khi Trip đã đóng | **[WORKIK REVIEW REQUIRED]** trigger hay `CHECK` dựa trên cột chụp? |
| **Transaction boundary** | APPROVE = ghi `approved` + Trip → `done` + expense → `IMMUTABLE` + đặt `closed_at` — **một** transaction | **[APPLICATION MUST ENFORCE]** |
| **Reconciliation / backstop job** | Quét định kỳ tìm vi phạm lọt lưới. ★ **Job không phải source of truth** — nó chỉ **báo cáo** | **[READ MODEL]** |

⚠ **Legacy:** `PATCH /trip-schedules/:id/status` hiện **rời DONE được và không để dấu
vết**. Bốn lớp trên phải có **trước** khi Trip đầu tiên đạt DONE. **Không** xử lý bằng
UI.

### C5 — Outsourced dual-link (Option B)

⚠ **Điều chỉnh cho MVP:** Workik mô tả dual-link trên `vehicle_assignment`. MVP
**không có** thực thể đó (§0.8.4), nên liên kết nằm ở **cấp Trip**:
`Trip.vehicle_id` (xe outsourced) ⟷ `trip_outsource_hires.trip_id` (hire).

| Yêu cầu | Nội dung | Nhãn |
|---|---|---|
| **Transaction** | Gán xe thuê vào Trip **và** tạo Hire trong **một** transaction. Không có trạng thái trung gian nào ở đó xe thuê đã gán mà chưa có hire | **[APPLICATION MUST ENFORCE]** |
| **FK** | `trip_outsource_hires.trip_id` → `trip_schedules.id` — **đã có** từ `0012` | **[DB MUST ENFORCE]** |
| **Invariant** | Trip dùng xe `outsourced` ⟹ tồn tại hire chưa void cho Trip đó — chính là **X-1** | **[WORKIK REVIEW REQUIRED]** |
| **Xử lý void** | Void hire cuối cùng khi assignment còn `active` → **chặn**, hoặc buộc kết thúc assignment cùng lúc | **[WORKIK REVIEW REQUIRED]** |
| **Reconciliation job** | Quét tìm desync: Trip dùng xe outsourced mà không hire · hire trên Trip dùng xe công ty | **[READ MODEL]** |

★ **Không để hai chiều desync.** Đây là lý do dual-link cần cả transaction, FK **và**
job — một mình FK không diễn đạt được ràng buộc tồn tại.

---

## W-2. Domain model — đã cập nhật

| # | Entity | Trạng thái |
|---|---|---|
| 1 | **Carrier** | MỚI |
| 2 | **Vehicle** (+`ownership`, +`carrier_id`) | MỞ RỘNG `trip_vehicles` |
| 3 | **Trip** (+`driver_instructions`, +`closed_at`) | MỞ RỘNG `trip_schedules` |
| 4 | **Driver Assignment** | MỚI |
| ~~5~~ | ~~**Vehicle Assignment**~~ | ★ **KHÔNG tạo cho MVP** — §0.8.4. Vehicle nằm trên `Trip.vehicle_id`; provenance bằng **snapshot** `vehicle_id` trên event/expense. **[FUTURE EXTENSION]** |
| 6 | **Execution Event** | MỚI, insert-only, voidable |
| 7 | **Driver Operational Expense** | MỞ RỘNG `trip_costs` |
| 8 | **Expense Edit Log** | MỚI, append-only |
| 9 | **Outsourced Vehicle Hire** (+`carrier_id`) | MỞ RỘNG `trip_outsource_hires` |
| 10 | **Completion Request** | MỚI |
| 11 | **Dispatch Status History** | ❓ **GAP-29** — vẫn mở, cần cho audit `status` |
| — | Driver · Audit · AI | ❌ không phải bảng |

### Quan hệ

```text
Carrier  1 ──< n  Vehicle
Trip     1 ──< n  Driver Assignment    ★ đúng 1 ACTIVE
Trip     0..1 ─►  Vehicle              (Trip.vehicle_id — MVP, không có bảng assignment)
Trip     1 ──< n  Outsourced Hire      (C5 — Trip dùng xe outsourced ⟹ có hire)
Trip     1 ──< n  Execution Event ──► driver_assignment + vehicle snapshot  ★ C1
Trip     1 ──< n  Expense         ──► driver_assignment + vehicle snapshot  ★ C1
Trip     1 ──< n  Completion Request   ★ ≤1 PENDING · ≤1 APPROVED
Expense  1 ──< n  Expense Edit Log
```

★ **MÔ HÌNH B giữ nguyên** — contract §4.1a:

```text
TRIP → VEHICLE ASSIGNED → DRIVER ASSIGNED → EXECUTION → EXPENSE → COMPLETION
```

⚠ `trip_schedules.vehicle_id` **nullable** trong legacy schema **không** có nghĩa Model
B bị bỏ. Model B là **operational ordering rule**; legacy data xử lý riêng ở W-11.

---

## W-3. Execution Event — đặc tả

**Canonical events:** `ARRIVED_PICKUP` · `PICKUP_CONFIRMED` · `ARRIVED_DELIVERY` ·
`DELIVERY_CONFIRMED`.

★ **Bốn giá trị này KHÔNG phải toàn bộ Trip lifecycle.** Chúng là sự kiện thực thi;
trạng thái vận hành được **suy ra** (W-8).

| Trường | Nội dung | Nhãn |
|---|---|---|
| `trip_id` | | [DB] |
| `driver_assignment_id` | ★ Composite provenance — C1 | **[DB MUST ENFORCE]** composite FK `(driver_assignment_id, trip_id)` |
| `vehicle_id` · `vehicle_ownership` *(snapshot)* | ★ §0.8.3 X-2 — **không** join ngược lên `Trip.vehicle_id` lúc đọc | **[APPLICATION MUST ENFORCE]** |
| `event_type` | Enum đóng, 4 giá trị. Mở rộng bằng migration có chủ đích | [DB] |
| `actual_at` | ★ **[ĐÃ SỬA — xem W-3.1]** Thời điểm sự kiện xảy ra, **do MÁY CHỦ đóng dấu** khi nhận thao tác. **Client không gửi được** | **[SERVER GENERATED]** |
| `recorded_at` | Thời điểm PostgreSQL ghi dòng — `DEFAULT now()` | **[DATABASE GENERATED]** |
| `device_reported_at` | Thiết bị tự khai — ★ **diagnostic only**, không bao giờ là truth, không tính KPI, không quyết định thứ tự | **[CLIENT DIAGNOSTIC ONLY]** |
| `scheduled_at` *(snapshot)* | ★ Chụp lịch tại thời điểm sự kiện, để KPI lịch sử **không đổi** nếu Operations chỉnh lịch sau | **[APPLICATION MUST ENFORCE]** |
| `client_event_id` | Idempotency — chống ghi trùng khi mạng chập chờn | **[DB MUST ENFORCE]** unique |
| `is_voided` · `cancels_event_id` | C2 | [DB] |
| Insert-only: không `UPDATE` *(trừ `is_voided`)*, không `DELETE`, không `updated_at` | | **[DB MUST ENFORCE]** |
| GPS: toạ độ · accuracy · nguồn · geofence verdict | ★ Cột **nullable thêm sau**, không phá lifecycle | [FUTURE] |

★ **Idempotency:** `client_event_id` unique theo `(trip_id, client_event_id)` hoặc
toàn cục — **[WORKIK REVIEW REQUIRED]** chọn phạm vi.
**[ĐÃ IMPLEMENT]** chọn `(trip_id, client_event_id)` — hai client không liên quan
không được chặn nhau vì trùng id.

### W-3.1 ★ Đính chính: `actual_at` KHÔNG do client gửi

**[ĐÃ IMPLEMENT VÀ ĐÃ VERIFY]** Bản trước của bảng trên ghi `actual_at` là
`[APPLICATION]` với lập luận *"tài xế có mặt ở đó, máy chủ thì không"*. Lập luận
đó **sai theo hướng làm hỏng số liệu một cách âm thầm**:

```text
actual_at  =  thứ MỌI delay được đo từ đó
đồng hồ điện thoại  =  do chủ điện thoại đặt
→ máy lệch 1 giờ ghi ra 1 giờ trễ không ai gây ra
   (hoặc xoá mất 1 giờ trễ có thật)
```

Vì vậy DTO của route `POST /driver/trips/:tripId/execution-events` **không còn
trường `actualAt`**. Máy chủ đóng dấu khi thao tác tới, đúng như nó vẫn đóng dấu
`recorded_at`.

| Trường | Ai đặt | Ghi chú |
|---|---|---|
| `actual_at` | **máy chủ** (`new Date()` trong service) | Nghiệp vụ đọc trường này |
| `recorded_at` | **PostgreSQL** (`DEFAULT now()`) | Dòng được ghi lúc nào |
| `device_reported_at` | **client**, tuỳ chọn | ★ Chỉ để đối chiếu khi có tranh cãi |

#### Hai trường này có phải hai sự thật khác nhau không?

**Có — nhưng khoảng cách chỉ có ý nghĩa khi có offline queue.**

`actual_at` là *thời điểm nghiệp vụ của sự kiện*; `recorded_at` là *thời điểm
dòng dữ liệu tồn tại*. Hôm nay không có hàng đợi offline nên hai mốc cách nhau
mili-giây và trùng nhau về mặt thực dụng. Khi (và chỉ khi) offline queue được
xây, `actual_at` sẽ là thời điểm thao tác được **nhận** ở máy chủ lần đầu, còn
`recorded_at` là lúc ghi — và khoảng cách trở nên thật.

★ **Vì vậy KHÔNG xoá `recorded_at`.** Nó là mốc audit của hàng dữ liệu, không
phải bản sao thừa của `actual_at`. Việc gộp hai trường sẽ mất khả năng phân biệt
ngay khi offline được thêm vào.

### W-3.3 ★ DL-86 — Canonical reading của mỗi milestone

**[CONFIRMED]** Khi cùng một milestone được báo nhiều lần (khác `client_event_id`,
đều chưa void), mốc chính thức là:

| Milestone | Lấy | Vì sao |
|---|---|---|
| `ARRIVED_PICKUP` · `ARRIVED_DELIVERY` | ★ **lần ĐẦU** | *Đến* là một **khoảnh khắc**. Một lần bấm trùng sau đó không được làm chuyến trông như đến muộn hơn thực tế |
| `PICKUP_CONFIRMED` · `DELIVERY_CONFIRMED` | ★ **lần CUỐI** | *Xong* là một **trạng thái**. Tài xế bấm xong, bốc thêm, bấm xong lần nữa → thật sự xong ở lần thứ hai |

**Tie-break — ba tầng, bắt buộc deterministic:**

```text
actual_at  →  recorded_at  →  id
```

★ Hai tap **có thể** rơi vào cùng một mili-giây (máy chủ đóng dấu `actual_at`).
Nếu chỉ dùng `min()`/`max()`, PostgreSQL trả về dòng nào tuỳ planner — cùng một
dữ liệu có thể cho **hai con số khác nhau ở hai lần chạy**. `DISTINCT ON` với thứ
tự đầy đủ thì không.

**Event đã void không được tính.**

★ **Cùng một luật ở cả hai phía.** Read model của backoffice và
`canonicalEventOf` của Driver Portal áp dụng y hệt — hai luật khác nhau sẽ đặt hai
giờ khác nhau lên hai màn hình cùng nói về một chuyến.

### W-3.4 ★ DL-87 — Thứ tự event: luật tiền tố

**[CONFIRMED]** Driver **không** được bỏ qua bước. Luật là **tiền tố**, không phải
*"phải đúng bước kế tiếp"*:

```text
Mọi milestone TRƯỚC nó phải có ít nhất một reading còn sống
Milestone đang báo được phép LẶP
```

★ Phân biệt này quan trọng: tài xế đến, rời đi, quay lại → báo `ARRIVED_PICKUP`
lần hai là **sự thật**, từ chối nó là làm mất dữ liệu. Thứ không bao giờ được
xảy ra là `PICKUP_CONFIRMED` trên một điểm chưa từng được báo là đã đến — vì mọi
con số phía sau sẽ đo với một bước không có giờ.

**Void làm bước đó trở lại "chưa báo"**, nên confirmation sau đó bị từ chối.

| | |
|---|---|
| Tầng thực thi | **[APPLICATION MUST ENFORCE]** |
| Vì sao không phải DB | Thứ tự là **vị từ liên dòng** — row-level `CHECK` không thấy các dòng khác. Đã kiểm chứng: 11 constraint trên `trip_execution_events`, không cái nào biểu diễn được |
| Race | ❌ Không có. Kiểm tra nằm **trong** transaction đã `SELECT … FOR UPDATE` dòng trip — đã đo trên PostgreSQL thật |
| Giới hạn trung thực | Script chạy SQL thẳng vẫn ghi được. Đó là giới hạn của tầng đã chọn, không phải lỗ hổng bị bỏ sót |

### W-3.2 ★ Read model hàng đợi duyệt — không lọc theo ngày

**[ĐÃ IMPLEMENT]** `GET /completion-review-queue`.

Hàng đợi duyệt **không** dùng date range của ADR-0003. Lý do:

```text
Trip scheduled 30/08 · completion pending · hôm nay 01/09
range tháng hiện tại = 01/09–30/09
→ chuyến BIẾN MẤT khỏi hàng đợi trong khi CHƯA AI QUYẾT ĐỊNH
```

★ Lịch chạy của chuyến và khối lượng việc của người duyệt là **hai trục khác
nhau**; lọc trục này bằng trục kia là một defect kỹ thuật, không phải luật
nghiệp vụ.

Vẫn bị chặn kích thước mà không cần range, đúng lập luận ADR-0002 §4: mỗi Trip
tối đa **một** request `pending` (`uq_trip_completion_pending`), và chuyến đã
quyết định thì rời khỏi tập. Tập trả về là *"việc duyệt chưa làm"* — hàng đợi
dài chính là **tín hiệu cảnh báo**, giấu nó sau bộ lọc ngày là làm tắt tín hiệu đó.

Bao gồm cả `rejected`: chuyến bị trả về vẫn là việc còn nợ của công ty, chỉ là
đang chờ tài xế thay vì chờ người duyệt.

---

## W-4. Expense — đặc tả

**Điều kiện tạo:** Trip có **active Vehicle Assignment** — Model B, contract §4.1a.

| Trường | Nhãn |
|---|---|
| `driver_assignment_id` | ★ C1 composite provenance — **[DB]** composite FK |
| `vehicle_id` *(snapshot)* | ★ §0.8.3 X-2 — chụp từ `Trip.vehicle_id` lúc ghi | **[APPLICATION]** |
| `vehicle_ownership` *(snapshot)* | Enforce cấm `fuel`/`toll` bằng `CHECK` cục bộ — **[DB MUST ENFORCE]** |
| `state` (`editable` \| `locked` \| `immutable`) + void đã có | [DB] |
| `locked_at` · `locked_by` | [DB] |
| `source` (`driver_portal` \| `backoffice`) | [DB] |
| Edit history | Expense Edit Log — **[DB]** |
| ❌ Không `DELETE` | **[DB]** |

**Quy tắc category** → contract §8.6 (không chép lại ở đây):
`fuel`/`toll` cấm trên chuyến xe thuê · phí kho · bốc xếp · tăng ca theo contract.
★ **Không tự thêm category hay rule mới.**

---

## W-5. Completion Request — đặc tả

| | Nhãn |
|---|---|
| `trip_id` · `driver_assignment_id` · `submitted_by` · `submitted_at` | [DB] |
| `state` · `decided_by` · `decided_at` · `attempt_no` | [DB] |
| `decision_reason` — bắt buộc khi `rejected` | **[DB MUST ENFORCE]** CHECK |
| ≤1 `pending` · ≤1 `approved` mỗi Trip | **[DB MUST ENFORCE]** partial unique |
| Không ghi đè request cũ | [DB] insert-only |
| Giới hạn resubmit | **[CEO DECISION REQUIRED]** — DL-63 |

---

## W-6. Timeline

**Canonical timezone: `Asia/Ho_Chi_Minh`.** Mọi timestamp lưu `timestamptz`.

**Tám mốc phải giữ được:**

```text
scheduled pickup            ← Trip.pickup_at
actual arrival pickup       ← event ARRIVED_PICKUP.actual_at
actual pickup confirmation  ← event PICKUP_CONFIRMED.actual_at
scheduled delivery          ← Trip.delivery_at
actual arrival delivery     ← event ARRIVED_DELIVERY.actual_at
actual delivery confirmation← event DELIVERY_CONFIRMED.actual_at
completion submitted_at     ← Completion Request.submitted_at
completion approved_at      ← Completion Request.decided_at
```

★ **`scheduled_at` snapshot trên event là bắt buộc** — nếu không, Operations chỉnh lịch
sau khi chuyến đã chạy sẽ **viết lại KPI lịch sử**.

**Read model tính — [READ MODEL], không lưu:**

| Chỉ số | Công thức |
|---|---|
| pickup delay | `ARRIVED_PICKUP.actual_at − scheduled_at (snapshot)` |
| delivery delay | `ARRIVED_DELIVERY.actual_at − scheduled_at (snapshot)` |
| execution duration | event đầu → `DELIVERY_CONFIRMED` |
| time at pickup | `ARRIVED_PICKUP` → `PICKUP_CONFIRMED` |
| time at delivery | `ARRIVED_DELIVERY` → `DELIVERY_CONFIRMED` |
| completion turnaround | `submitted_at` → `decided_at` |

★ **Không hard-code SLA threshold** — **[CEO DECISION REQUIRED]** O-4.

---

## W-7. Driver accountability — 10 tình huống phát hiện

★ **[READ MODEL]** — **không** tạo status enum cho 10 tình huống này. Chúng là
**derived operational state**.

| # | Tình huống | Suy ra từ |
|---|---|---|
| 1 | Driver assigned nhưng **chưa execution** | assignment `active`, 0 event non-voided |
| 2 | **Quá scheduled pickup** nhưng chưa `ARRIVED_PICKUP` | `now > scheduled pickup` ∧ thiếu event |
| 3 | `ARRIVED_PICKUP` nhưng chưa `PICKUP_CONFIRMED` | có event 1, thiếu event 2 |
| 4 | Pickup xong nhưng **chưa delivery** | có `PICKUP_CONFIRMED`, thiếu `ARRIVED_DELIVERY` |
| 5 | **Quá scheduled delivery** nhưng chưa `ARRIVED_DELIVERY` | `now > scheduled delivery` ∧ thiếu event |
| 6 | `ARRIVED_DELIVERY` nhưng chưa `DELIVERY_CONFIRMED` | có event 3, thiếu event 4 |
| 7 | Delivery xong nhưng **chưa Completion Request** | có `DELIVERY_CONFIRMED`, 0 request |
| 8 | Completion **rejected** nhưng chưa resubmit | request cuối `rejected`, không có `pending` sau đó |
| 9 | **Expense chưa submit** | expense `editable` tồn tại, chưa có `pending` request. ⚠ Xem O-3 |
| 10 | Completion **pending SuperAdmin** | request `pending` |

---

## W-8. CEO operational observability — 15 trạng thái suy ra

★ **[READ MODEL]** — **KHÔNG persist 15 trạng thái này thành một enum mới.**

```text
Persisted state    →  trip_schedules.status        (dispatch, 5 giá trị, giữ nguyên)
Execution truth    →  trip_execution_events        (insert-only)
Operational state  →  READ MODEL / QUERY           ← 15 giá trị dưới đây
```

| Trạng thái | Điều kiện suy ra |
|---|---|
| `WAITING_DRIVER` | có Vehicle Assignment `active`, chưa có Driver Assignment `active` |
| `DRIVER_ASSIGNED` | Driver Assignment `active`, 0 event |
| `WAITING_PICKUP` | chưa `ARRIVED_PICKUP`, chưa quá lịch |
| `PICKUP_DELAYED` | chưa `ARRIVED_PICKUP`, **đã quá** scheduled pickup |
| `ARRIVED_PICKUP` | có event 1, chưa event 2 |
| `PICKUP_COMPLETED` | có `PICKUP_CONFIRMED` |
| `IN_TRANSIT` | có `PICKUP_CONFIRMED`, chưa `ARRIVED_DELIVERY` |
| `WAITING_DELIVERY` | như trên, chưa quá lịch |
| `DELIVERY_DELAYED` | như trên, **đã quá** scheduled delivery |
| `ARRIVED_DELIVERY` | có event 3, chưa event 4 |
| `DELIVERY_COMPLETED` | có `DELIVERY_CONFIRMED` |
| `WAITING_EXPENSE` | delivery xong, có expense `editable` hoặc chưa có request. ⚠ O-3 |
| `COMPLETION_PENDING` | request `pending` |
| `COMPLETION_REJECTED` | request cuối `rejected` |
| `DONE` | request `approved` ∧ `Trip.closed_at IS NOT NULL` |

★ **Toàn bộ 15 trạng thái tính được từ dữ liệu ở W-2.** Không cần thêm bảng nào.

---

## W-9. Stuck trip detection

| | Nhãn |
|---|---|
| Schema **không** cần `stuck_status` persisted | [READ MODEL] |
| Background validation job quét: thiếu event · quá lịch · thiếu completion · rejected chưa resubmit | [READ MODEL] |
| ★ **Job KHÔNG phải source of truth** — nó chỉ báo cáo | **[APPLICATION MUST ENFORCE]** |
| SLA threshold | **[CEO DECISION REQUIRED]** O-4 — không tự thêm |

---

## W-10. Enforcement matrix

### [DB MUST ENFORCE]

| # | |
|---|---|
| 1 | Partial unique **active Driver Assignment** `(trip_id) WHERE state='active'` |
| 2 | Partial unique **active Vehicle Assignment** `(trip_id) WHERE state='active'` |
| 3 | ≤1 Completion Request `pending` `(trip_id) WHERE state='pending'` |
| 4 | ≤1 Completion Request `approved` `(trip_id) WHERE state='approved'` |
| 5 | Reject reason không rỗng — CHECK |
| 6 | FK toàn bộ quan hệ ở W-2 |
| 7 | ★ **Composite FK** `(assignment_id, trip_id)` — C1 |
| 8 | CHECK `(ownership='outsourced') = (carrier_id IS NOT NULL)` |
| 9 | ★ CHECK cấm `fuel`/`toll` khi `vehicle_ownership = 'outsourced'` (snapshot) |
| 10 | Idempotency unique trên `client_event_id` |
| 11 | Trigger **T1** — chặn `DONE → non-DONE` |
| 12 | Trigger **T2** — expense `IMMUTABLE` không `UPDATE` |
| 13 | Trigger **T3** — deny `DELETE` |
| 14 | State/timestamp đi cùng nhau — CHECK, mẫu `0003`/`0012` |

### [APPLICATION MUST ENFORCE]

| # | |
|---|---|
| 1 | Lifecycle transition — expense · completion · assignment |
| 2 | Transaction orchestration — bốn transaction ở W-1/C4 |
| 3 | Trip-row lock khi đổi assignment và khi ghi con sau DONE |
| 4 | ★ **Single-statement provenance capture** — C1 |
| 5 | Permission — Driver chỉ chạm Trip được assign |
| 6 | Read model whitelist — chọn cột tường minh |
| 7 | ★ **[ĐÃ SỬA]** `actual_at` **và** `recorded_at` đều do máy chủ/DB; client **không gửi được** timestamp nghiệp vụ nào. `device_reported_at` chỉ diagnostic — xem W-3.1 |
| 8 | `scheduled_at` snapshot lúc ghi event |
| 9 | *"Công ty thực tế trả"* — database không biết |
| 10 | Timezone `Asia/Ho_Chi_Minh` khi so sánh nghiệp vụ |

### [READ MODEL]

| # | |
|---|---|
| 1 | 15 operational state (W-8) |
| 2 | 10 accountability detection (W-7) |
| 3 | Delay · duration · turnaround (W-6) |
| 4 | Stuck detection job (W-9) |
| 5 | Reconciliation / backstop job (C4, C5) |
| 6 | KPI — chỉ tính event `is_voided = false` |

### [CEO DECISION REQUIRED]

Xem W-12.

### [WORKIK REVIEW REQUIRED] — còn lại sau vòng này

| # | |
|---|---|
| 1 | `is_voided`: cột cập nhật hay giá trị suy ra (C2) |
| 2 | Child-write guard sau DONE: trigger hay CHECK trên cột chụp (C4) |
| 3 | Invariant + xử lý void của dual-link (C5) |
| 4 | Phạm vi unique của `client_event_id` |
| 5 | Lock strategy dưới tải thật (C1) |
| 6 | Index cho read model W-7/W-8 — chưa đo |
| 7 | Phạm vi Expense Edit Log |
| 8 | GAP-29 — Dispatch Status History có cần bảng riêng |

---

## W-11. Migration safety & legacy strategy

★ **Không bắt đầu migration.** Đây là **design plan**.

**Forward-only.** Migration có checksum; sửa sai bằng file mới.

### Legacy strategy — tám quy tắc

| # | Tình huống legacy | Xử lý |
|---|---|---|
| 1 | **UNKNOWN ownership** | ★ **Không tự đoán.** Xem O-1 |
| 2 | Legacy expense **thiếu assignment** | Giữ legacy provenance + **quarantine/report**. Không bịa assignment |
| 3 | Legacy **Driver free-text** | ★ **Không tự tạo User** |
| 4 | Legacy **carrier free-text** | ★ **Không tự tạo Carrier** |
| 5 | Legacy Trip **thiếu Vehicle** | **Không ép backfill** nếu thiếu evidence |
| 6 | Legacy **DONE** | **Không tự suy diễn `closed_at`** |
| 7 | **Duplicate / orphan** | Quarantine |
| 8 | Invariant mới | Chỉ enforce cho **new data** nếu cần legacy exemption |

⚠ **Hệ quả:** một số invariant ở W-10 **không** áp được cho dữ liệu cũ ngay. Cách áp
(partial index có điều kiện thời gian · cột `legacy` · bảng quarantine) là
**[WORKIK REVIEW REQUIRED]** ở vòng schema final.

### Thứ tự migration đề xuất

```text
carrier → vehicle ownership → vehicle assignment → driver assignment
→ execution event → expense lifecycle + edit log → completion request
→ trip.closed_at + driver_instructions → triggers T1/T2/T3
```

**[WORKIK REVIEW REQUIRED]** thứ tự · khoá bảng · backfill `carrier_id`.

---

## W-12. CEO DECISIONS — CÒN MỞ

★ **Năm câu này giữ nguyên trạng thái `OPEN`. Không tự chuyển sang CONFIRMED.**

| ID | Câu hỏi | Khuyến nghị của Workik | Trạng thái |
|---|---|---|---|
| ~~**O-1**~~ | ~~Xử lý UNKNOWN ownership của xe legacy~~ | ★ **ĐÓNG — assumption không được source chứng minh.** Xem W-14.1 | **ĐÓNG** |
| **O-2** | **Void hire sau khi Trip đã DONE** — cho phép không? | Không cho phép qua đường thường; nếu cần thì thuộc correction workflow riêng (DL-80) | **OPEN** |
| **O-3** | Phân biệt **"không phát sinh expense"** với **"chưa khai"**? | Thêm một xác nhận tường minh của Driver *"không phát sinh chi phí"* khi gửi Completion Request | **OPEN** |
| **O-4** | **SLA thresholds** cho trễ pickup / trễ delivery | Không hard-code; để cấu hình được, và chỉ khi CEO cho con số | **OPEN** |
| ~~**O-5**~~ → **DL-86** | **Canonical KPI khi event lặp** | ★ **ĐÃ CHỐT** — xem W-3.3. `O-5` được trả về nghĩa gốc (nghĩa vụ DONE) | **ĐÓNG** |

⚠ **O-3 và O-4 chặn W-7/W-8 hoạt động đúng nghĩa** — không có chúng, hai chỉ số
*"expense chưa khai"* và *"trễ"* chỉ là gần đúng.

---

## W-14. ★ Clarification — hệ quả lên schema

### W-14.1 DL-81 đã ĐÓNG — không có "unknown ownership"

**Ba bằng chứng từ source:**

| # | Bằng chứng | Nguồn |
|---|---|---|
| E-1 | `trip_vehicles` được gọi là **"đội xe"** — đội xe công ty | `trip-schedule/README.md:13` |
| E-2 | Bảng tồn tại để chặn gõ sai biển số **nhằm đếm theo từng xe**; bốn biển thật được trích đều là xe đang được đếm | `0011:13` |
| ★ E-3 | **Xe thuê ngoài chưa bao giờ nằm trong danh mục xe.** Nhà xe là **free text trên bản ghi hire**, cố ý không phải FK: *"nobody knows what the row would be — `Hai Thành`, `Hải Râu`, `xe Út`, `Mr Đạt` là một công ty, một biệt danh, xe của ai đó, và một con người"* | `0012:145` |

★ **E-3 là bằng chứng phản bác.** Nếu xe thuê từng được đưa vào danh mục, vấn đề mà
`0012` mô tả sẽ không tồn tại ở dạng đó.

**[CONFIRMED]** Không thêm giá trị `unknown`. `ownership` có **hai** giá trị:
`company` · `outsourced`.

⚠ **[PRODUCTION DATA VERIFICATION REQUIRED]** Repo **không chứa dữ liệu production** —
không seed, không fixture, không dump. Ý định đã ghi thành văn nói danh mục là đội xe
công ty; điều đó chỉ xác nhận dứt điểm được bằng **một truy vấn trên database thật**.
Đây **không** phải business rule, và **không** phải CEO decision.

### W-14.2 ★ Hệ quả mới: chuyến thuê ngoài từ nay cần một dòng Vehicle

**Hôm nay** một chuyến thuê ngoài có thể **không có dòng Vehicle nào** — `vehicle_id`
nullable, và nhà xe chỉ là chữ trên bản ghi hire.

**Từ nay**, theo canonical model (§0.7) + Mô hình B: mỗi chuyến thuê ngoài **phải có
một Vehicle được khai báo trước** khi gán Driver.

→ ★ Đây là **một bước nhập liệu mới cho Operations** mà quy trình hiện tại không có.
**[CEO DECISION REQUIRED]** — Operations có chấp nhận bước này không?

### W-14.3 Vehicle Assignment — ĐÓNG, không làm cho MVP

**[CONFIRMED]** `1 Trip = 1 Vehicle`. Không tạo Vehicle Assignment History — §0.8.1.

Provenance của event/expense được bảo đảm bằng **snapshot `vehicle_id` + `ownership`**
(§0.8.3 X-2), không bằng một bảng assignment.

**Bằng chứng vẫn giữ giá trị và vẫn là GAP:** `PATCH /trip-schedules/:id` đổi được
`vehicleId` (`controller.ts:79,107`) và service **không lưu lại việc đổi**
(`service.ts:138`) — cùng loại GAP-29. ★ Snapshot ở X-2 làm cho GAP này **không làm
hỏng provenance**, dù nó vẫn là một GAP về audit.

**[FUTURE EXTENSION]** Nếu sau này business cần nhiều operational segment.

### W-14.4 Carrier ↔ Vehicle ↔ Hire — nguy cơ ba nguồn sự thật

Sau clarification, **nhà xe** xuất hiện ở **hai** chỗ:

```text
Vehicle.carrier_id   →  Carrier      (xe thuê thuộc nhà xe nào)
Hire.carrier_id      →  Carrier      (hợp đồng thuê với nhà xe nào)
```

⚠ **Hai giá trị này có thể lệch nhau** — gán xe của nhà xe A nhưng ghi hợp đồng với
nhà xe B. Không `CHECK` nào bắt được, vì chúng ở hai bảng.

| | Nội dung | Nhãn |
|---|---|---|
| **CA-1** | Carrier chỉ trên **Vehicle**; Hire suy ra carrier qua Vehicle | Một nguồn. Mất khả năng ghi hợp đồng khi chưa biết xe |
| **CA-2** | Carrier chỉ trên **Hire**; Vehicle không giữ carrier | Một nguồn. ⚠ Mâu thuẫn Q-4 (*1 nhà xe → n xe*) |
| **CA-3** | Cả hai, kèm ràng buộc bắt chúng khớp | Đủ diễn đạt, nhưng cần trigger hoặc composite FK |

**[WORKIK REVIEW REQUIRED]** — chọn hình dạng. **[CEO DECISION REQUIRED]** nếu CA-2
được cân nhắc, vì nó đụng Q-4 đã chốt.

### W-14.5 Provenance khi Vehicle của Trip thay đổi

**MVP:** `Trip.vehicle_id` đổi được (`PATCH`), và việc đổi **không được lưu lại**.

| Câu hỏi | Trả lời được? |
|---|---|
| Event/expense này thuộc xe nào | ✅ **snapshot `vehicle_id`** trên chính dòng đó — §0.8.3 X-2 |
| Ownership tại thời điểm khai | ✅ snapshot `ownership` |
| Xe của Trip từng đổi chưa · ai đổi · khi nào | ❌ **không lưu** — GAP, cùng loại GAP-29. **[FUTURE EXTENSION]** |

★ **Snapshot bảo toàn provenance của event/expense ngay cả khi Vehicle của Trip đổi.**
Đó là lý do X-2 phải làm đúng trong MVP, chứ không phải để chuẩn bị cho segment.

### W-14.6 Customer dimension — trace hiện trạng

**[CONFIRMED]** Customer là **operational dimension của Trip**, không phải một trường
để hiển thị trong form.

| Thành phần | Hiện trạng | Nguồn |
|---|---|---|
| **Customer entity** | ✅ **đã có** — `trip_customers`, có `name_key` chuẩn hoá `GENERATED ALWAYS`, archive-không-xoá | `0011` |
| **`customer_id` trên Trip** | ✅ **đã có** — FK, nullable *(chuyến nội bộ không có khách)* | `0011` |
| **Index** | ⚠ `idx_trip_schedule_customer (customer_id)` **có**, nhưng `0011` ghi rõ nó phục vụ **FK check**, không phục vụ đọc trip. Một cột, không kèm ngày | `0011` |
| **Query / filter** | ❌ **thiếu** — GAP-32 | `date-range-page-query.dto.ts` |
| **Read model** | ❌ **thiếu** | — |
| **Pagination** | ⚠ chỉ có offset theo khoảng ngày; R-B cần keyset | §0.7 |

★ **KHÔNG tạo thêm Customer model.** Entity hiện tại đã đáp ứng; thiếu là **query ·
index · read model**, không phải thiếu thực thể.

### W-14.7 ★ CEO phải trả lời được — 13 câu cho một Trip

**[READ MODEL]** — mọi câu đều suy ra được từ mô hình ở W-2:

| # | Câu hỏi | Nguồn |
|---|---|---|
| 1 | Khách hàng nào? | `Trip.customer_id` ✅ đã có |
| 2 | Xe nào? | `Trip.vehicle_id` ✅ đã có *(lịch sử: xem W-14.3)* |
| 3 | Driver nào? | Driver Assignment `active` |
| 4 | **Ai phân công?** | `Assignment.assigned_by` |
| 5 | Đã tới điểm lấy chưa? | event `ARRIVED_PICKUP` |
| 6 | **Tới đúng giờ không?** | `actual_at` ↔ `scheduled_at` snapshot |
| 7 | Đã lấy hàng chưa? | event `PICKUP_CONFIRMED` |
| 8 | Đang vận chuyển chưa? | có `PICKUP_CONFIRMED`, chưa `ARRIVED_DELIVERY` |
| 9 | Đã tới điểm giao chưa? | event `ARRIVED_DELIVERY` |
| 10 | **Giao đúng giờ không?** | `actual_at` ↔ `scheduled_at` snapshot |
| 11 | Có phát sinh expense không? | expense + `expense_declaration` *(DL-83)* |
| 12 | Completion đang ở đâu? | Completion Request `state` |
| 13 | **Ai approve? Khi nào DONE?** | `decided_by` · `decided_at` · `Trip.closed_at` |

★ **13/13 trả lời được** với mô hình đã đề xuất. Ba câu phụ thuộc quyết định chưa
chốt: #2 *(lịch sử xe — W-14.3)* · #11 *(DL-83)* · #6, #10 *(DL-85 quy tắc canonical
event)*.

---

## W-13. Migration gate

```text
[✅] 1. design.md cập nhật           ← tài liệu này
[  ] 2. CEO decisions chốt           ← W-12: O-1…O-5 còn OPEN
[  ] 3. Schema final review          ← chưa
[  ] 4. Migration plan được duyệt    ← chưa
```

★ **Chưa được viết migration.**

---

*Tài liệu này là DESIGN. Nguồn nghiệp vụ là [`contract.md`](contract.md); trạng thái
quyết định ở [`decisions.md`](decisions.md). Mọi **[WORKIK]** phải được review và
tài liệu phải ở trạng thái `approved` trước khi viết migration.*
