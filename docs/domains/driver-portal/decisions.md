# Driver Portal — Decision Ledger

> **Loại:** DECISIONS · **Trạng thái:** sống, cập nhật liên tục · **Ngày:** 2026-08-30
> Không có SQL, migration, code, API, UI trong tài liệu này.
>
> ★ **Tài liệu này KHÔNG chứa nội dung luật nghiệp vụ.** Nó giữ **ID · câu hỏi ·
> trạng thái · con trỏ**. Luật đã CONFIRMED sống ở [`contract.md`](contract.md);
> phân tích kỹ thuật sống ở [`design.md`](design.md).
> Đây là quy tắc chống-hai-nguồn-sự-thật của [`../../README.md`](../../README.md) §5.1.
>
> **Ngày:** 2026-08-30 · **Migration cao nhất:** `0012_trip_cost.sql`
>
> **Mục đích:** gộp **mọi** quyết định rải rác qua nhiều vòng thảo luận thành **một sổ
> duy nhất**, và trả lời câu *"đã đủ để Workik review chưa"*.
>
> **Nguồn nghiệp vụ:** [`contract.md`](contract.md)
> · **Thiết kế kỹ thuật:** [`design.md`](design.md)
> · **Governance:** [`../../README.md`](../../README.md)

## Quy tắc của sổ này

| | |
|---|---|
| **Canonical ID** | `DL-nn`. Mọi ID cũ (`Q-`, `P0-`, `OD-`, `OBD-`, `BD-`, `E-`, `R-`) **map vào** một `DL-nn`, không tồn tại song song |
| **Không trùng lặp** | Nhiều ID cũ hỏi cùng một việc → **một** `DL`. Cột *"ID cũ"* giữ dấu vết |
| **Trạng thái** | `CONFIRMED` · `CEO DECISION` · `WORKIK` · `GAP` · `FUTURE` |
| ★ **Không chép luật** | Dòng `CONFIRMED` chỉ mang **con trỏ** tới `contract.md`. Sửa luật thì sửa ở contract, ledger không phải sửa theo |
| **★ BLOCKING** | Chặn thiết kế schema. Không đoán, không đi vòng |

---

# 1. LEDGER

## 1.1 Identity & Access

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-01** | Driver có phải User trong hệ thống? | → **contract §3** | `CONFIRMED` | OBD-1, BD-01 |
| **DL-02** | Đăng nhập bằng gì? | → **contract §3** | `CONFIRMED` | OBD-3, BD-03, OD-1 |
| **DL-03** | Vừa employee vừa driver? | → **contract §3** | `CONFIRMED` | OBD-2, BD-02 |
| **DL-04** | Driver thuộc department nào? | → **contract §3.1** — department riêng "Đội xe". ★ CHỈ cho identity, **không** cho trip access | `CONFIRMED` | OD-2, BD-04 |
| **DL-05** | Driver đọc được dòng department của mình? | Bán kính lộ ra = **một dòng**. Chấp nhận hay chặn: chưa | `CEO DECISION` | OD-3, BD-05 |
| **DL-06** | Có tạo role `DRIVER`? | → **contract §3** | `CONFIRMED` | contract §3 |
| **DL-07** | Driver Portal ở domain nào? | Cookie **host-only**; Option B cho session isolation miễn phí | **`CEO DECISION`** | OD-9, S-7 |
| **DL-08** | Tài xế xe thuê ngoài có tài khoản? | → **contract §3 + §4.1b** | `CONFIRMED` | Q-1 |
| **DL-09** | Chặn phân công người không phải tài xế? | Không có nhãn nào để kiểm | `CEO DECISION` | brief §5 |

## 1.2 Trip Assignment

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-10** | Bao nhiêu Driver / Trip? | → **contract §4.1** | `CONFIRMED` | OBD-7, BD-06 |
| **DL-11** | Gán vào Trip hay Vehicle? | → **contract §4.1** | `CONFIRMED` | BD-07 |
| **DL-12** | Có cần assignment history? | → **contract §4.2** | `CONFIRMED` | BD-10 |
| **DL-13** | Con trỏ "driver hiện tại" có được là nguồn duy nhất? | → **contract §4.2** | `CONFIRMED` | contract §4.2 |
| **DL-14** | Ai phân công? | → **contract §4.3** | `CONFIRMED` | BD-11 |
| **DL-15** | Đổi Driver trước / sau khi chuyến bắt đầu? | — | `CEO DECISION` | BD-08, BD-09 |
| **DL-16** | Đổi Driver → expense/event của người cũ xử lý sao? | — | **`CEO DECISION`** | P0-3, BD-02.3 |
| **DL-17** | Assignment có hiệu lực khi nào? | — | `CEO DECISION` | BD-12 |
| **DL-18** | Gán Driver trước khi có Vehicle? | **KHÔNG.** → **contract §4.1a** — MÔ HÌNH B: Trip → Vehicle → Driver → Execution | `CONFIRMED` | Q-8, P0-2 |
| **DL-19** | Đổi Driver có bắt buộc lý do? | — | `CEO DECISION` | P1-1 |

## 1.3 Vehicle & Carrier

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-20** | Xe thuê ngoài có flow riêng? | → **contract §4.1b** | `CONFIRMED` | contract §4.1b |
| **DL-21** | Xe thuê vào danh mục nào? | → **contract §4.1c** | `CONFIRMED` | Q-2 |
| **DL-22** | Nhà xe là gì? | → **contract §4.1c** | `CONFIRMED` | Q-4 |
| **DL-23** | Xe thuê ⟹ có giá thuê? | → **contract §4.1d** | `CONFIRMED` | Q-6 |
| **DL-24** | `external_booking` = "xe thuê"? | → **contract §4.1e** | `CONFIRMED` | Q-5 |
| **DL-25** | Unique biển số không phân biệt sở hữu — cố ý? | — | `WORKIK` | GAP-21 |
| **DL-26** | Cách enforce DL-23? | → **design §B-19** | **`WORKIK`** | GAP-25 |
| **DL-27** | Sở hữu của một xe có đổi được không? | → **design §A-5.2 / §B-18.2** | **`WORKIK`** | *mới* |

## 1.4 Execution

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-28** | Execution Event là gì? | → **contract §6** | `CONFIRMED` | contract §6 |
| **DL-29** | Event tối thiểu? | → **contract §6** | `CONFIRMED` | contract §6 |
| **DL-30** | ARRIVAL: 1 loại + stage, hay 2 loại? | → **design §7 (ledger)** | **`WORKIK`** | Q-9, P0-4 |
| **DL-31** | Event trung gian khác (`ACCEPTED`, `IN_TRANSIT`)? | — | `CEO DECISION` | BD-29, OD-10 |
| **DL-32** | Driver sửa `trip_schedules.status`? | → **contract §7.4** | `CONFIRMED` | BD-30 |
| **DL-33** | Hai lifecycle tách biệt? | → **contract §7.1** | `CONFIRMED` | contract §7.1 |
| **DL-34** | Note kèm event? | — | `CEO DECISION` | P1-3 |
| **DL-35** | Thời gian? | → **contract §10.6** | `CONFIRMED` | contract §10.6 |

## 1.5 Driver Operational Expense

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-36** | Driver khai gì? | → **contract §8.1** | `CONFIRMED` | BD-18 |
| **DL-37** | Expense là mấy entity? | → **contract §9.3** | `CONFIRMED` | contract §9.3 |
| **DL-38** | Driver sửa được khi nào? | → **contract §9.1** | `CONFIRMED` | contract §9.1 |
| **DL-39** | Sau khi khoá? | → **contract §9.2** | `CONFIRMED` | contract §9.2, BD-24 |
| **DL-40** | Khoá xảy ra lúc nào? | → **contract §9.6** — khi Driver gửi Completion Request, toàn bộ expense của Trip cùng lúc | `CONFIRMED` | P0-5, E-2 |
| **DL-41** | Ai bấm khoá? | → **contract §9.6** — khoá là hệ quả của Completion Request, không phải nút riêng từng khoản | `CONFIRMED` | P0-6, E-3 |
| **DL-42** | Ai void/correct **sau khi DONE**? | Quy trình quản trị riêng, chưa định nghĩa — contract §9.6 | `DEFERRED` | P0-7, E-4 |
| **DL-43** | Có bước duyệt expense? | — | `CEO DECISION` | P0-8, E-6, BD-19 |
| **DL-44** | Reject completion → expense mở lại được? | **CÓ** → **contract §9.6**. Vòng đời expense **có chu trình** | `CONFIRMED` | P0-10 |
| **DL-45** | Draft có vào `total`? | — | `CEO DECISION` | BD-21 |
| **DL-46** | Chứng từ bắt buộc? | — | `CEO DECISION` | BD-22, E-7 |
| **DL-47** | Operations nhập thay Driver? | — | `CEO DECISION` | BD-23, E-8 |
| **DL-48** | Driver đọc expense **của chính mình**? | → **contract §8.4** | `CONFIRMED` | R-1 |
| **DL-49** | Driver đọc expense của Trip / người khác? | — | `CEO DECISION` | R-2, R-3, OD-15 |
| **DL-50** | Quyền đọc có suy ra từ quyền khai? | → **contract §8.5** | `CONFIRMED` | contract §8.5 |
| **DL-51** | Hình dạng lifecycle (A/B/C) | → **design §B-10.2** | **`WORKIK`** | — |
| **DL-52** | Chuyến xe thuê: khai category nào? | → **contract §8.6** — `fuel`/`toll` **cấm**; phí kho · bốc xếp · tăng ca **khai được** nếu công ty thực tế trả | `CONFIRMED` | Q-7 |
| **DL-53** | fuel/toll trên chuyến xe thuê | → **contract §8.6** | `CONFIRMED` | contract §8.6 |
| **DL-54** | Audit các lần sửa trước khoá | → **contract §14 · hình dạng → design §B-10.5** | `CONFIRMED` / `WORKIK` | contract §14 |
| **DL-55** | Snapshot ownership có đủ để enforce DL-52? | ★ **CÓ — đủ.** DL-52 chốt theo **sở hữu xe**, không theo điều khoản hợp đồng. Xem §6 | `CONFIRMED` | *mới* |

## 1.6 Completion

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-56** | Ai submit / ai duyệt? | → **contract §10.1** | `CONFIRMED` | BD-31 |
| **DL-57** | Reject có bắt buộc lý do? | → **contract §10.2** | `CONFIRMED` | contract §10.2 |
| **DL-58** | Resubmit? | → **contract §10.2** | `CONFIRMED` | contract §10.2 |
| **DL-59** | Điều kiện submit? | → **contract §10.5** | `CONFIRMED` | nguyên tắc #10 |
| **DL-60** | Approve → Trip DONE? | → **contract §10.5** | `CONFIRMED` | nguyên tắc #9 |
| **DL-61** | DONE có reopen được? | → **contract §10.5** | `CONFIRMED` | nguyên tắc #9 |
| **DL-62** | ★ Chứng minh DONE permanence ở DB thế nào? | → **design §B-18.8** | **`WORKIK`** | *mới* |
| **DL-63** | Giới hạn số lần resubmit? | — | `CEO DECISION` | P1-9 |
| **DL-80** | Sau DONE: quy trình quản trị nào cho correction/void? | Chưa định nghĩa — contract §9.6 | `DEFERRED` | *mới* |
| **DL-81** | Completion Request có phải mang khai báo chi phí tường minh (`none` \| `expenses`) không, và khai báo có bị ràng buộc khớp với dữ liệu không? | → **contract §9.7** | `CONFIRMED` | *mới* |
| **DL-82** | Driver Execution Read Model gồm chính xác những field nào, và `note` có được expose không? | → **contract §5.4.1** — whitelist đóng; `note` **không**; rủi ro còn lại ở §5.4.2 | `CONFIRMED` | *mới* |
| **DL-86** | ★ **Canonical event khi milestone lặp** — lấy lần nào làm mốc chính thức? | `ARRIVED_*` → **lần đầu** · `CONFIRMED_*` → **lần cuối** · tie-break `actual_at` → `recorded_at` → `id` · không tính event đã void. → **design §W-3.3** | `CONFIRMED` | *mới* |
| **DL-87** | Driver có được báo event sai thứ tự không? | **Không.** Mọi milestone trước phải có ít nhất một reading còn sống; milestone đang báo được phép **lặp**. → **design §W-3.4** | `CONFIRMED` | *mới* |
| **DL-88** | Evidence (ảnh/GPS khi mất mạng) — có xây không, và hạ tầng file nào? | Thay thế **OD-6**. Xem design §B-21 / Phase 3.5 | `CEO DECISION` | *mới* |
| **DL-89** | Operations có được ghi Execution Event thay Driver không? | ⚠ Mâu thuẫn với design §0.3 hiện tại. Liên quan **DL-47** | `CEO DECISION` | *mới* |

## 1.7 Data Boundary

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-64** | Driver thấy trip nào? | → **contract §5.1** | `CONFIRMED` | contract §5 |
| **DL-65** | Dùng lại đường đọc của Backoffice? | → **contract §5.4** | `CONFIRMED` | contract §5.4 |
| **DL-66** | `driver_instructions` | → **contract §5.2** | `CONFIRMED` | contract §5.2 |
| **DL-67** | `note` nội bộ | → **contract §5.3** | `CONFIRMED` | contract §5.3 |
| **DL-68** | Driver đọc `pickup_address` / contact / `cargo_info`? | **CÓ** → **contract §5.3**, qua **Driver Execution Read Model** riêng (contract §5.4) | `CONFIRMED` | P0-12, OD-5 |
| **DL-69** | Driver thấy dispatch status? | — | `CEO DECISION` | brief §9.2 |
| **DL-70** | Driver thấy tổng chi phí / giá thuê? | → **contract §5.3** | `CONFIRMED` | contract §5.3 |
| **DL-71** | Phạm vi lịch sử chuyến Driver xem được | — | `CEO DECISION` | OD-14, BD-16 |
| **DL-72** | `driver_instructions`: cột hay bảng? | — | `WORKIK` | brief §9.3 |
| **DL-73** | Chuyến cũ không có `driver_instructions` | Không backfill từ `note` | `CEO DECISION` | brief §9.3 |

## 1.8 AI · GPS · Future

| ID | Câu hỏi | Quyết định | Trạng thái | ID cũ |
|---|---|---|---|---|
| **DL-74** | AI ở đâu? | → **contract §12** | `CONFIRMED` | contract §12 |
| **DL-75** | AI được tự quyết? | → **contract §12** | `CONFIRMED` | contract §12 |
| **DL-76** | Thứ tự? | → **contract §12** | `CONFIRMED` | contract §12 |
| **DL-77** | GPS là bằng chứng? | → **contract §11** | `CONFIRMED` | contract §11 |
| **DL-78** | Face verification | Identity assurance ≠ location assurance | `FUTURE` | contract §11 |
| **DL-79** | Geofence · device binding · retention · OCR | — | `FUTURE` | OBD-11/12/13 |

---

# 2. DL-52 — ĐÃ CHỐT

**[CONFIRMED]** → **contract §8.6**

| Nhóm | Xe công ty | Xe thuê ngoài | Phụ thuộc vào |
|---|---|---|---|
| `fuel` | ✅ | ❌ **cấm** | **Sở hữu xe** — đã nằm trong giá thuê |
| `toll` | ✅ | ❌ **cấm** | **Sở hữu xe** — đã nằm trong giá thuê |
| `warehouse` | ✅ | ✅ nếu công ty thực tế trả | Sự thật nghiệp vụ |
| `loading` | ✅ | ✅ nếu công ty thực tế trả | Sự thật nghiệp vụ |
| `overtime` | ✅ | ✅ nếu công ty thực tế trả | Sự thật nghiệp vụ |

★ **Giá thuê xe ngoài KHÔNG phải "gói trọn mọi chi phí".** Nó bao gồm nhiên liệu và
phí cầu đường **của nhà xe** — không bao gồm phí kho, bốc xếp, tăng ca.

## 2.1 ★ Hệ quả quan trọng nhất: mô hình điều khoản hợp đồng KHÔNG cần nữa

Trước khi chốt, tài liệu này cân nhắc ba hình dạng schema (`S-1` ba cột boolean trên
hire · `S-2` bảng con các category hợp đồng không bao gồm · `S-3` enum `hire_scope`)
cho trường hợp *"tuỳ hợp đồng"*.

★ **Cả ba đều KHÔNG cần nữa.** Quyết định chốt theo **sở hữu xe**, không theo điều
khoản của từng hợp đồng. Ràng buộc duy nhất database phải enforce là:

```text
vehicle.ownership = 'outsourced'   ⟹   category ∉ { fuel, toll }
```

## 2.2 Cái database enforce được, và cái không

| | |
|---|---|
| ✅ **[DB]** | Cấm `fuel`/`toll` trên chuyến xe thuê — suy ra được từ sở hữu xe |
| ❌ **không phải DB** | *"Công ty thực tế trả"* — database không biết ai đã trả tiền. Đây là **khai báo trung thực + khâu review**, không phải ràng buộc dữ liệu |

---

# 3. DL-18 — ĐÃ CHỐT: MÔ HÌNH B

**[CONFIRMED]** → **contract §4.1a**

```text
Trip  →  Vehicle  →  Driver  →  Execution
```

Vehicle phải được xác định **trước** khi gán Driver, và execution/expense chỉ bắt
đầu **sau khi** Trip đã có Vehicle. Driver **không** khai được expense khi chưa có xe.

## 3.1 ★ Quyết định này giải một thế lưỡng nan đã ghi nhận

Trước khi chốt, tài liệu này ghi một hệ quả nghiêm trọng: nếu Driver được phân công
**trước** khi có Vehicle thì Driver có thể khai chi phí **trước khi biết xe là xe
công ty hay xe thuê** —

```text
t0   Driver được phân công          (chưa có Vehicle)
t1   Driver khai "Dầu 1.500.000"    ← KHÔNG kiểm được DL-53
t2   Điều độ gán Vehicle = xe thuê  ← khoản ở t1 trở thành VI PHẠM
```

★ **Mô hình B loại bỏ kịch bản này ở mức nghiệp vụ.** Ba lối ra kỹ thuật từng được
cân nhắc (kiểm tại thời điểm khoá · bắt buộc có Vehicle trước · cho khai rồi đánh
dấu vi phạm) không còn cần thiết: **thứ hai đã trở thành quy tắc nghiệp vụ**.

## 3.2 Hệ quả kéo theo

| # | Hệ quả |
|---|---|
| **DL-53** (cấm `fuel`/`toll` trên chuyến xe thuê) | ✅ **Đánh giá được ngay tại thời điểm khai** — Vehicle luôn đã biết |
| **DL-55** (snapshot ownership có đủ không) | ✅ Snapshot lấy được ở thời điểm khai; câu còn lại chỉ phụ thuộc **DL-52** |
| **DL-23** (xe thuê ⟹ có hire) | Điểm thi hành vẫn nằm trên đường ghi `Trip.vehicle_id`, nhưng giờ nó xảy ra **trước** mọi expense |
| **DL-40** (khoá lúc nào) | ⚠ **Vẫn mở** — nhưng không còn bị DL-18 ràng buộc |

★ **Ba câu DL-18 / DL-40 / DL-52 trước đây khoá lẫn nhau. DL-18 đã chốt, nên hai câu
còn lại giờ trả lời độc lập được.**

⚠ **Một điều mô hình B KHÔNG thay đổi:** `trip_schedules.vehicle_id` vẫn **nullable**
ở tầng schema (`0011` — bảng tính gốc có dòng "ĐIỀN SAU", và một chuyến vẫn được
cam kết với khách trước khi có xe). Mô hình B là ràng buộc về **thứ tự thao tác**,
không phải lời mời bỏ tính nullable của cột đó.

---

# 4. ★ DL-62 — Chứng minh DONE là vĩnh viễn

**Yêu cầu đã nêu:** *không được coi partial unique trên `approved` là đủ.* Đúng.

### 4.1 Partial unique trên `approved` cho ta gì

**Chỉ đúng một điều:** *tối đa một completion request ở trạng thái `approved` cho mỗi
chuyến.*

### 4.2 Nó KHÔNG cho ta gì

| # | Điều cần đúng | Partial unique có bảo đảm không? |
|---|---|---|
| **O-1** | Không có completion request **mới** sau khi đã approved | ❌ Một dòng `pending` mới vẫn insert được — nó không nằm trong index đó |
| **O-2** | Không có execution event mới sau DONE | ❌ Bảng khác hoàn toàn |
| **O-3** | Không có expense mới sau DONE | ❌ Bảng khác hoàn toàn |
| **O-4** | `trip_schedules.status` không rời khỏi `done` | ❌ Bảng khác hoàn toàn. ⚠ Và hôm nay nó **rời được**, không để dấu vết |
| **O-5** | Dòng `approved` không bị UPDATE ngược về `pending`/`rejected` | ❌ Không có gì chặn `UPDATE` |

★ **Kết luận: "một request approved duy nhất" và "Trip DONE không đảo ngược" là HAI
mệnh đề khác nhau.** Mệnh đề thứ nhất là ràng buộc **trong một bảng**; mệnh đề thứ hai
là bất biến **xuyên bốn bảng cộng một chiều thời gian**.

### 4.3 Nghĩa vụ chứng minh — năm điều, không phải một

Muốn DL-61 đúng, phải có cơ chế cho **cả năm** O-1…O-5.

**[REC] — một quan sát, không phải quyết định:** cả năm đều là biến thể của cùng một
câu hỏi *"chuyến này đã đóng chưa"*. Một dấu **`closed_at` trên chính Trip**, đặt tại
thời điểm approve, biến năm phép kiểm khác nhau thành **một** phép kiểm chung.

Nó **không** tự động giải quyết — vẫn cần cơ chế chặn ở mỗi bảng — nhưng nó biến năm
truy vấn liên bảng thành năm phép đọc một cột.

**[WORKIK]** — bốn câu cho Workik:

1. Cơ chế nào chặn insert vào ba bảng con khi chuyến đã đóng: trigger, hay `CHECK` dựa
   trên cột snapshot, hay chấp nhận enforce ở service?
2. Cơ chế nào chặn `status` rời khỏi `done`? `CHECK` không đọc được giá trị cũ.
3. Cơ chế nào chặn `UPDATE` một dòng `approved`?
4. Nếu dùng `closed_at` trên Trip: ai đặt nó, trong transaction nào, và điều gì bảo
   đảm nó không lệch với bảng completion request?

⚠ **[LEGACY]** Hôm nay `PATCH /trip-schedules/:id/status` cho phép rời `done` **và
không lưu lại** — O-4 đang bị vi phạm ngay trong source hiện tại.

---

# 5. ★ DL-26 — Bất biến "outsourced vehicle ⟹ active hire exists"

Bảy kịch bản, phân tích từng cái. **Không chọn cơ chế** — toàn bộ vào WORKIK.

### 5.1 Bảy kịch bản

| # | Kịch bản | Điều gì xảy ra | Mức |
|---|---|---|---|
| **K-1** | Gán Vehicle (thuê) **trước**, hire sau | Chuyến vi phạm trong khoảng giữa. Cần: chặn ở bước gán, hoặc chấp nhận khoảng hở | **CAO** |
| **K-2** | Tạo hire **trước**, gán Vehicle sau | Không vi phạm. Nhưng ⚠ DL-23 là **một chiều** — hire tồn tại **không** hàm ý xe thuê, nên không suy ngược được | THẤP |
| **K-3** | **Void dòng hire cuối cùng** | ★ Chuyến **trở thành vi phạm sau khi đã hợp lệ**. Cần: chặn void dòng cuối, hoặc buộc gán lại xe công ty | **CAO** |
| **K-4** | Đổi Vehicle: company → outsourced | Vi phạm ngay lập tức nếu chưa có hire. Cùng loại K-1 | **CAO** |
| **K-5** | Đổi Vehicle: outsourced → company | Hire cũ trở nên **thừa** nhưng không sai. ⚠ Có phải void nó không? Là quyết định nghiệp vụ | TRUNG BÌNH |
| **K-6** | Đổi carrier của một xe | ⚠ Hire cũ trỏ tới carrier cũ. Chuyến lịch sử đổi nghĩa | TRUNG BÌNH |
| **K-7** | Đồng thời: gán xe thuê ‖ void hire | Cả hai kiểm tra đều thấy hợp lệ tại thời điểm của mình → **hai giao dịch cùng commit và kết quả vi phạm** | **CAO** |

★ **K-7 là kịch bản chỉ ràng buộc ở DB mới bắt được.** Kiểm ở service, mỗi bên đọc một
snapshot khác nhau và cả hai đều đúng khi đọc.

### 5.2 ★★ Một câu chưa ai hỏi — DL-27

**Sở hữu của một chiếc xe có đổi được không?**

Nếu `ownership` là một cột **sửa được** trên `trip_vehicles`, thì đổi nó **viết lại ý
nghĩa của mọi chuyến trong quá khứ đã dùng xe đó**. Một chuyến chạy năm ngoái bằng xe
công ty đột nhiên trở thành chuyến thuê ngoài — và quy tắc cấm fuel/toll áp ngược lên
những khoản đã khai đúng.

Hai hướng — **[WORKIK]**:

| | Nội dung | Đánh giá |
|---|---|---|
| **V-1** | `ownership` **bất biến**; đổi = archive dòng cũ + tạo dòng mới | ★ Khớp với cách `trip_vehicles` **đã** xử lý danh tính: archive, không sửa. Lịch sử không bao giờ bị viết lại |
| **V-2** | Cho sửa, nhưng **snapshot ownership xuống Trip** tại thời điểm gán xe | Chuyến giữ được sự thật tại thời điểm của nó. Thêm một cột trên Trip |

⚠ Cả hai hướng đều ảnh hưởng **DL-55** (snapshot có đủ không) — xem §6.

### 5.3 Câu hỏi thật cho Workik

★ **Ràng buộc này cần chặt tới mức nào?** Đó là câu hỏi về **hậu quả khi bị vi phạm**,
không phải câu hỏi kỹ thuật. Nếu hậu quả là "một báo cáo sai trong một giờ" thì đối
soát định kỳ là đủ. Nếu hậu quả là "trả tiền hai lần" thì phải chặt ở DB.

---

# 6. DL-55 — ĐÃ CHỐT: snapshot ownership LÀ ĐỦ

**[CONFIRMED]** DL-52 chốt theo **sở hữu xe**, không theo điều khoản hợp đồng.

| Câu hỏi | Trả lời |
|---|---|
| Snapshot `vehicle_ownership` xuống dòng expense có đủ để enforce DL-52 không? | ★ **CÓ.** Quy tắc duy nhất cần enforce là cấm `fuel`/`toll` trên chuyến xe thuê, và ownership trả lời trọn vẹn câu đó |
| Có cần snapshot điều khoản hợp đồng (`category_policy`) không? | ❌ **Không.** Ba câu hỏi phụ từng đặt ra ở đây (policy đến từ hire nào · lấy ở đâu nếu hire tạo sau · xử lý khi hire bị void) **tan biến cùng lúc** |

★ **Và mô hình B làm nó chắc chắn hơn nữa:** Vehicle luôn tồn tại trước khi Driver
khai, nên snapshot **luôn lấy được** tại thời điểm khai — không có kịch bản "khai
trước, biết xe sau".

## 6.1 Snapshot cần có trên dòng expense

| Snapshot | Vì sao | Trạng thái |
|---|---|---|
| `assignment_id` | Truy vết chi phí về đúng lượt giao — contract §4.4 | `CONFIRMED` |
| `source` (`driver_portal` / `backoffice`) | Kênh nhập, không suy ra được từ `created_by` | `CONFIRMED` |
| `vehicle_ownership` | Enforce DL-53 bằng `CHECK` cục bộ, không cần trigger | `CONFIRMED` |
| ~~`category_policy`~~ | ❌ **Không cần** — xem trên | — |

---

# 7. DL-30 — ARRIVAL: một loại hay hai?

Hai hình dạng, so sánh thẳng.

### 7.1 Hình dạng (a) — `event_type` + `stage`

```text
event_type ∈ { ARRIVAL, CONFIRMED }
stage      ∈ { PICKUP, DELIVERY }
```

| | |
|---|---|
| ✅ | **Trực giao.** Toàn bộ ba event tối thiểu = 2 × 2 trừ một tổ hợp không dùng |
| ✅ | Thêm chặng thứ ba (nhiều điểm dừng) **không** làm enum phình |
| ❌ | Cần `CHECK` cho tổ hợp hợp lệ, và một event tương lai **không có stage** sẽ phải nullable → mở đường cho tổ hợp vô nghĩa |
| ❌ | Truy vấn *"đã giao chưa"* thành điều kiện hai cột thay vì một |

### 7.2 Hình dạng (b) — enum phẳng

```text
event_type ∈ { ARRIVED_PICKUP, PICKUP_CONFIRMED, ARRIVED_DELIVERY, DELIVERY_CONFIRMED }
```

| | |
|---|---|
| ✅ | **Không có tổ hợp vô nghĩa** — mỗi giá trị tự nó đủ nghĩa |
| ✅ | Khớp phong cách repo: `0011` status phẳng, `0012` category phẳng |
| ✅ | Truy vấn một cột |
| ❌ | Chặng thứ ba sẽ **nhân đôi** số giá trị |

### 7.3 Dữ kiện quyết định

★ **Hôm nay một Trip có ĐÚNG một điểm lấy và một điểm giao** — `trip_schedules` chỉ có
một cặp cột địa chỉ, một cặp cột giờ. Không có mô hình nhiều điểm dừng.

Nên câu hỏi thật là: **có bao giờ một chuyến có nhiều điểm dừng không?**

- Nếu **không** → (b) đơn giản hơn và không mất gì.
- Nếu **có, trong tầm nhìn gần** → (a) tránh được một migration đau.

**`WORKIK`** — không mark CONFIRMED. Câu hỏi cho Workik: *nghiệp vụ nhiều điểm dừng có
nằm trong tầm nhìn không, và migration từ (b) sang (a) đắt tới đâu nếu cần?*

---

# 8. SCHEMA READINESS REPORT

## A. READY — đã đủ để Workik review

| Vùng | Vì sao đủ |
|---|---|
| **Driver Assignment** | Hình dạng, ràng buộc, index, concurrency đều đã xác định. Mẫu partial unique có tiền lệ trong repo |
| **Carrier** | Thực thể rõ; đường di trú từ `carrier_name` đã được `0012` ghi sẵn |
| **Vehicle — ownership** | Hình dạng rõ. ⚠ Trừ DL-27 (ownership có bất biến không) |
| **Execution Event — khung** | Append-only, provenance, thời gian. ⚠ Trừ DL-30 (hình dạng enum) |
| **Completion Request — hình dạng bảng** | Trường, CHECK reject-reason, partial unique pending. ⚠ Permanence là việc khác — xem C |
| **Audit** | Phong cách provenance-trên-bảng đã rõ và có tiền lệ |
| **Timezone** | scheduled + actual, `Asia/Ho_Chi_Minh`, hai cái bẫy đã biết |
| **AI boundary** | Không có bảng nào ở phase này |

## B. BLOCKED — cần CEO decision

★ Sáu câu này **chặn thiết kế schema**. Không câu nào đoán được.

| ID | Câu hỏi | Chặn cái gì |
|---|---|---|
| **DL-52** | Ba nhóm phí kho/bốc xếp/tăng ca trên chuyến xe thuê: ai trả? | Quyết định giữa *một cột snapshot* và *một mô hình điều khoản hợp đồng* (§2) |
| **DL-40** | Expense khoá lúc nào? | Hình dạng bảng expense, **và** điểm kiểm DL-53 (§3.3) |
| **DL-44** | Reject completion → expense đã khoá mở lại được? | Vòng đời expense có chu trình hay không |
| **DL-68** | Driver đọc `pickup_address` / contact / `cargo_info`? | Read model, và có cần thêm trường có cấu trúc không |
| **DL-04** | Driver thuộc department nào? | Phase 1 không khởi động được |

**Cần trước Phase 1 nhưng không chặn schema:** DL-05 · DL-07.

★ **DL-18 đã chốt** (§3) — DL-40 và DL-52 giờ trả lời độc lập được.

## C. TECHNICAL REVIEW — cần Workik

| ID | Hạng mục |
|---|---|
| **DL-51** | Expense lifecycle: option A/B/C (brief §10.2) — quyết định thiết kế lớn nhất |
| **DL-62** | ★ Chứng minh DONE permanence: **năm** nghĩa vụ O-1…O-5, không phải một (§4) |
| **DL-26** | Bất biến outsourced-hire: bảy kịch bản, đặc biệt K-3 và K-7 (§5) |
| **DL-27** | `ownership` có bất biến không, hay snapshot xuống Trip (§5.2) |
| **DL-55** | Snapshot có đủ không — hệ quả của DL-52 (§6) |
| **DL-30** | Hình dạng enum event: (a) hay (b) (§7) |
| **DL-25** | Unique biển số không phân biệt sở hữu — cố ý? |
| **DL-54** | Phạm vi log sửa trước khoá |
| **DL-72** | `driver_instructions`: cột hay bảng |
| — | Chiến lược index cho *"chuyến của tôi"* + phân trang |
| — | Thứ tự migration, ảnh hưởng khoá lên bảng có dữ liệu |

## D. LEGACY CONFLICT — source hiện tại vi phạm contract

| ID | Contract nói | Source làm | Mức |
|---|---|---|---|
| **L-1** | Driver chỉ thấy trip của mình | `trip.read` = `'any'` → **mọi account đọc toàn bộ lịch xe** | **CHẶN** |
| **L-2** | Trip ↔ Driver có history | Không tồn tại quan hệ Trip ↔ người | **CHẶN** |
| **L-3** | Ranh giới ở mức trường | Bốn ô văn bản tự do, nội dung không kiểm soát | **CHẶN** |
| **L-4** | Vùng chỉ dẫn riêng | Không tồn tại | **CHẶN** |
| **L-5** | ★ DONE **vĩnh viễn** | `PATCH .../status` cho rời `done`, **không lưu dấu vết** | **CHẶN** |
| **L-6** | Reject reason phải lưu | Không có completion request. ⚠ Tiền lệ ngược: hai luồng duyệt hiện có **vứt** lý do từ chối | **CHẶN** |
| **L-7** | Chi phí truy về lượt assignment | Chỉ ghi *ai gõ* | CAO |
| **L-8** | Driver không thấy tổng chi phí | Tổng **bao gồm** giá thuê ngoài | CAO |
| **L-9** | Expense có trạng thái editable | **Không có đường sửa nào ở bất kỳ tầng nào** — cố ý | **CHẶN** |
| **L-10** | Execution Event hạng nhất | Không tồn tại | **CHẶN** |
| **L-11** | Audit các lần sửa trước khoá | Không tồn tại | CAO |

---

# 9. Kết luận

| | |
|---|---|
| **Tổng decision** | **86** canonical (`DL-01` … `DL-89`, không dùng `DL-83`…`DL-85`) |
| **CONFIRMED** | **46** |
| **CEO DECISION** | **26** — trong đó **6 chặn schema** |
| **WORKIK** | **8** (+1 vừa CONFIRMED vừa WORKIK: DL-54) |
| **FUTURE** | **2** |
| **LEGACY CONFLICT** | **11** (L-1 … L-11) |

★ **Chưa đủ để Workik review toàn bộ.** Vùng **A** đủ; nhưng expense và completion —
hai vùng phức tạp nhất — phụ thuộc sáu câu ở **B**.

★ **Khuyến nghị về thứ tự:** **DL-52** trước (nó quyết định giữa *một cột snapshot*
và *một mô hình điều khoản hợp đồng*), rồi **DL-40** + **DL-44** (cặp vòng đời
expense), rồi **DL-68** và **DL-04**. Sau đó vùng C mới review được đầy đủ.

---

*Tài liệu này là DECISION LEDGER. Không có SQL, migration, code, API hay UI. Mọi
**[CEO DECISION]** phải được chốt và mọi **[WORKIK]** phải được review trước khi bắt
đầu implementation.*