# Tài liệu — bản đồ & quy tắc

> **Đây là file đọc đầu tiên.** Nó trả lời hai câu: *"tôi cần đọc gì trước khi làm
> việc ở vùng này"* và *"tôi được phép tạo file mới khi nào"*.
>
> **Ngày:** 2026-08-30 · **Trạng thái:** ĐANG ÁP DỤNG — migration §7 **đã thực hiện**.

---

## 1. Đọc gì trước

| Bạn sắp làm việc ở… | Đọc trước |
|---|---|
| Bất kỳ đâu | [`../README.md`](../README.md) — kiến trúc tổng thể, ranh giới Foundation/Project |
| `core/identity`, `core/users`, `core/organization`, `core/authorization` | [`architecture/core-001-…-invariants.md`](architecture/core-001-identity-organization-account-lifecycle-invariants.md) — sổ đăng ký bất biến |
| Bất kỳ API nào | [`backend/frontend-integration-contract.md`](backend/frontend-integration-contract.md) |
| Tạo tài khoản, email, định danh | [`backend/company-email-policy.md`](backend/company-email-policy.md) |
| Read model trả về người | [`architecture/adr-0001-user-identity-projection.md`](architecture/adr-0001-user-identity-projection.md) |
| Danh sách có phân trang | [`architecture/adr-0002-list-pagination.md`](architecture/adr-0002-list-pagination.md) — keyset, mặc định toàn API |
| Lịch xe: `total` và "trang 2/3" | [`architecture/adr-0003-trip-schedule-offset-pagination.md`](architecture/adr-0003-trip-schedule-offset-pagination.md) — **ngoại lệ duy nhất**, kèm điều kiện làm nó mất hiệu lực |
| Đặt file test | [`architecture/test-placement.md`](architecture/test-placement.md) |
| Bảo mật · triển khai · trước khi lên production | [`operations/`](operations/) |
| **Driver Portal** | [`domains/driver-portal/`](domains/driver-portal/) — đọc `contract.md` trước, rồi `design.md`, `decisions.md` khi cần trace |

### Bản đồ thư mục

| Thư mục | Chứa gì | Source of truth cho |
|---|---|---|
| [`architecture/`](architecture/) | **Chỉ cross-cutting** — ADR + bất biến core + quy ước | Quyết định kiến trúc lâu dài, xuyên module |
| [`domains/<domain>/`](domains/) | Mọi thứ về **một** domain, tối đa 3 file | Nghiệp vụ · quyết định · thiết kế của domain đó |
| [`backend/`](backend/) | Hợp đồng API và chính sách đang có hiệu lực | Hình dạng API, chính sách định danh |
| [`operations/`](operations/) | Bảo mật · triển khai · hardening · checklist production | Tình trạng vận hành và bảo mật |
| [`archive/`](archive/) | Tài liệu **đã bị thay thế** hoặc audit đóng băng | ★ **Không là source of truth cho bất kỳ thứ gì.** Chỉ tra cứu lịch sử |

### Bộ ba canonical của mỗi domain

| File | Loại | Trả lời | Không chứa |
|---|---|---|---|
| `contract.md` | CONTRACT | *Luật nghiệp vụ là gì* | Thiết kế kỹ thuật |
| `decisions.md` | DECISIONS | *Câu nào đã chốt, câu nào còn mở* | ★ **Không chép lại luật** — chỉ con trỏ |
| `design.md` | DESIGN | *Hiện trạng · gap · schema proposal* | Business rule mới |

**Driver Portal** hôm nay:
[`domains/driver-portal/contract.md`](domains/driver-portal/contract.md) ·
[`domains/driver-portal/decisions.md`](domains/driver-portal/decisions.md) ·
[`domains/driver-portal/design.md`](domains/driver-portal/design.md)

---

## 2. Vấn đề đã xử lý — bằng số

| | |
|---|---|
| Tổng tài liệu | 15 file · 8 887 dòng → **15 file** (gồm README này), Driver Portal **5 → 3** |
| Riêng Driver Portal | 5 file · 4 096 dòng → **3 file** · ~3 900 dòng |
| Số dòng code Driver Portal | **0** |
| ID quyết định vẫn nằm rải rác **sau khi** đã có ledger | `OD-` ở 2 file · `E-` ở **3** file · `GAP-` ở 3 file · `L-` ở 2 file |
| File tự xưng "source of truth" cho cùng một domain | **2** (contract + ledger) |
| Link hỏng | 1 → **0**. `adr-0003` đã được viết thay vì bỏ tham chiếu |

★ **Chẩn đoán (trước migration):** tài liệu đang scale theo **số cuộc hội thoại**, không theo **project**.
Mỗi vòng thảo luận sinh một file mới, và file thứ năm (`DECISION-LEDGER`) ra đời chỉ
để gom lại thứ mà bốn file trước làm rơi vãi. Nếu chín domain còn lại đi cùng đường
này, `docs/` sẽ có **~45 file / 37 000 dòng** trước khi có dòng code nào.

---

## 3. Taxonomy — sáu loại tài liệu

| Loại | Trả lời câu | Vòng đời | Ai sở hữu |
|---|---|---|---|
| **CONTRACT** | *"Nghiệp vụ quy định gì?"* | draft → reviewed → **approved** → superseded | Business Owner |
| **DECISIONS** | *"Câu nào đã chốt, câu nào còn mở?"* | sống mãi, cập nhật liên tục | Business + Kiến trúc |
| **DESIGN** | *"Hệ thống hiện có gì, thiếu gì, sẽ làm thế nào?"* | discovery → proposal → **review** → approved → implemented | Kiến trúc |
| **ADR** | *"Vì sao chọn hướng này, và đã cân nhắc gì?"* | proposed → **accepted** → superseded. **Bất biến sau khi accepted** | Kiến trúc |
| **REFERENCE** | *"Hợp đồng/chính sách hiện hành là gì?"* | sống, cập nhật khi hệ thống đổi | Chủ của module |
| **AUDIT** | *"Tại thời điểm X, tình trạng thế nào?"* | **đóng băng** sau khi viết | Người audit |

### ★ ADR dùng khi nào

**Chỉ** cho quyết định kiến trúc **lâu dài, xuyên module, khó đảo ngược**. Phép thử:
*"Sáu tháng nữa có ai hỏi vì sao lại thế này không?"*

| Là ADR | **Không** phải ADR |
|---|---|
| Keyset hay offset pagination | "Tài xế có được xem chi phí của mình không" → **DECISIONS** |
| Read model có trả tên người không | "Đặt cột này ở bảng nào" → **DESIGN** |
| Bậc quyền theo ownership đặt ở đâu | "Phòng ban của tài xế tên gì" → **DECISIONS** |

---

## 4. Ba mô hình — đánh giá

### A — Flat: `docs/architecture/*.md`

| ✅ | Không cần quyết định gì. Tìm bằng tên file |
|---|---|
| ❌ | **Đang vỡ ở 15 file.** Tên file phải mang cả domain lẫn loại (`DRIVER-PORTAL-DB-DESIGN-BRIEF`) → dài, và không ngăn được file thứ sáu |
| ❌ | Không có chỗ cho tài liệu đã lỗi thời → hoặc xoá (mất lịch sử) hoặc để lẫn (gây nhầm) |
| ❌ | Không phân biệt được *cross-cutting* với *thuộc một domain* |

### B — Domain-oriented: `docs/architecture/` + `docs/domains/<domain>/`

| ✅ | Mỗi domain có **một nhà**. Tên file ngắn lại: `contract.md`, không phải `X-BUSINESS-CONTRACT.md` |
| ✅ | Thêm domain = thêm một thư mục, **không** làm thư mục nào khác phình ra |
| ✅ | Trả lời được câu *"đọc gì trước khi làm việc ở domain này"* — đọc thư mục đó |
| ⚠ | Vẫn cần chỗ cho security/deployment và cho tài liệu đã bị thay thế |

### C — Hybrid 5 thư mục: `architecture/` `domains/` `features/` `decisions/` `archive/`

| ✅ | Rành mạch trên giấy |
|---|---|
| ❌ | ★ **`domains/` vs `features/` không ai áp dụng nhất quán được.** "Driver Portal" là domain hay feature? Hai người sẽ trả lời khác nhau, và đó là lúc file bắt đầu nằm sai chỗ |
| ❌ | ★ **`decisions/` tách rời tái tạo đúng vấn đề đang có.** Quyết định về Driver Portal nằm xa contract của Driver Portal → lại phải nhớ hai chỗ |
| ✅ | `archive/` là ý đúng — giữ lại |

### ★ Khuyến nghị: **B, cộng hai thứ mượn từ C**

```text
docs/
├── README.md                     ← file này: index + governance
├── architecture/                 ← CHỈ cross-cutting: ADR + bất biến core + quy ước
├── domains/<domain>/             ← mọi thứ về một domain, TỐI ĐA 3 file
├── operations/                   ← bảo mật, triển khai, checklist vận hành
└── archive/                      ← tài liệu đã bị thay thế. KHÔNG BAO GIỜ xoá
```

**Vì sao bỏ `features/`:** một feature hoặc **là** một domain, hoặc **thuộc** một
domain. Không có trường hợp thứ ba, nên thư mục thứ ba chỉ tạo ra câu hỏi *"cái này
để đâu"*.

**Vì sao bỏ `decisions/` riêng:** quyết định phải nằm **cạnh** contract mà nó quyết
định. Tách ra là tái tạo đúng lỗi đang phải sửa.

---

## 5. Bộ ba canonical — tối đa 3 file mỗi domain

```text
docs/domains/<domain>/
├── contract.md     CONTRACT   — nghiệp vụ. Source of truth DUY NHẤT về "luật là gì"
├── decisions.md    DECISIONS  — sổ quyết định. Source of truth DUY NHẤT về "chốt chưa"
└── design.md       DESIGN     — hiện trạng · gap · schema proposal · điểm cần review
```

★ **File thứ tư cần lý do kiến trúc, không phải lý do "cuộc hội thoại này dài".**
Lý do hợp lệ: một ADR (→ `architecture/`), hoặc một audit đóng băng (→ `operations/`).

### ★ 5.1 Quy tắc chống trùng lặp — trả lời câu "ledger liên kết với contract thế nào"

Đây là quy tắc quan trọng nhất của toàn bộ tài liệu này:

```text
Một quyết định đã CONFIRMED:
   NỘI DUNG   sống ở  contract.md    (luật, viết thành văn xuôi, để người làm theo)
   TRẠNG THÁI sống ở  decisions.md   (ID · câu hỏi · trạng thái · CON TRỎ tới contract)

decisions.md KHÔNG chép lại nội dung luật.
```

**Sai** — hai nguồn sự thật cho cùng một luật:

```text
| DL-01 | Driver có phải User? | Có. User bình thường, SuperAdmin cấp tài khoản | CONFIRMED |
```

**Đúng** — một nguồn, một con trỏ:

```text
| DL-01 | Driver có phải User? | → contract §3 | CONFIRMED |
```

Với quyết định **chưa** chốt thì ngược lại: `decisions.md` giữ đủ ngữ cảnh và các
phương án, vì chưa có luật nào để trỏ tới.

★ Quy tắc này giải quyết vấn đề gốc: hôm nay **42 dòng CONFIRMED** trong ledger đang
chép lại luật đã có trong contract. Sửa contract mà quên ledger là hai tài liệu nói
khác nhau — và không có cách nào biết bên nào đúng.

---

## 6. Quy tắc

### 6.1 Source of truth

1. **Một domain, một `contract.md`.** Không tài liệu nào khác được tuyên bố là nguồn
   nghiệp vụ cho domain đó.
2. **Một domain, một `decisions.md`.** Mọi ID quyết định của domain sống ở đó — không
   có `Q-`/`P0-`/`OD-`/`BD-` rải rác nơi khác.
3. **Tài liệu khác chỉ được TRỎ TỚI, không chép lại.**
4. Nếu hai file nói khác nhau → file canonical đúng, file kia là **bug tài liệu**.

### 6.2 Đặt tên

| Nơi | Quy ước | Ví dụ |
|---|---|---|
| `architecture/` ADR | `adr-NNNN-<chủ-đề>.md`, số tăng dần, **không tái sử dụng số** | `adr-0003-trip-schedule-offset-pagination.md` |
| `architecture/` khác | `<chủ-đề>.md`, chữ thường, gạch nối | `test-placement.md` |
| `domains/<domain>/` | thư mục chữ thường gạch nối; file **đúng ba tên**: `contract.md` · `decisions.md` · `design.md` | `domains/driver-portal/contract.md` |
| `operations/` | `<chủ-đề>.md` | `production-launch-checklist.md` |
| `archive/` | **giữ nguyên tên cũ** + banner SUPERSEDED ở đầu file | |

★ Tên file **không** mang loại tài liệu nữa (`-BRIEF`, `-DISCOVERY`, `-LEDGER`) — thư
mục đã nói domain, tên file đã nói loại.

### 6.3 Khi nào tạo file mới

| Tình huống | Làm gì |
|---|---|
| Domain mới | Tạo `domains/<domain>/` với **contract.md**. Hai file kia chỉ tạo khi thực sự có nội dung |
| Vòng thảo luận mới về domain đã có | ★ **SỬA file hiện có.** Không tạo file mới |
| Discovery / khảo sát kỹ thuật | Vào `design.md` của domain, mục "Hiện trạng" |
| Quyết định mới, dù nhỏ | Một dòng trong `decisions.md`. **Không** phải một file |
| Quyết định kiến trúc lâu dài, xuyên module | **ADR mới** ở `architecture/` |
| Audit tại một thời điểm | File mới ở `operations/`, và nó **đóng băng** sau khi viết |

★ **Phép thử trước khi tạo file:** *"Nội dung này có thuộc về một trong ba file
canonical của domain không?"* Nếu có — và gần như luôn có — thì **sửa**, đừng tạo.

### 6.4 Khi nào archive

Khi một tài liệu bị thay thế:

1. Thêm banner ở **đầu** file cũ:
   ```
   > ⚠ SUPERSEDED — 2026-08-30. Nội dung đã chuyển sang <đường dẫn>.
   > Giữ lại để tra cứu lịch sử. KHÔNG dùng làm nguồn.
   ```
2. Chuyển vào `archive/`.
3. **Không bao giờ xoá.** Tài liệu đã bị thay thế vẫn là bằng chứng về việc *đã từng
   quyết định gì, khi nào*.
4. Cập nhật index ở §1 của file này.

### 6.5 Vòng đời

**CONTRACT:** `draft` → `reviewed` → **`approved`** → `superseded`
Mỗi trạng thái ghi ở đầu file kèm ngày và người duyệt. Bản mới thay bản cũ thì bản cũ
đi vào `archive/` — **không** tồn tại song song.

**DESIGN:** `discovery` → `proposal` → **`workik-review`** → `approved` → `implemented`
★ Không viết migration khi `design.md` chưa ở trạng thái `approved`.

**ADR:** `proposed` → **`accepted`** → `superseded`
★ ADR đã `accepted` thì **không sửa nội dung**. Đổi ý = ADR mới, trỏ ngược về cái cũ.

### 6.6 Ownership

| Loại | Ai duyệt |
|---|---|
| CONTRACT | Business Owner / CEO |
| DECISIONS — dòng `CONFIRMED` | Business Owner |
| DECISIONS — dòng `WORKIK` | Kiến trúc + Workik |
| DESIGN | Kiến trúc, và **Workik** trước khi chuyển `approved` |
| ADR | Kiến trúc |
| REFERENCE | Chủ của module tương ứng |

---

## 7. Migration — ĐÃ THỰC HIỆN (2026-08-30)

> ✅ Đã thực hiện. Mục này giữ lại làm hồ sơ: đã đổi những gì và vì sao.

### 7.1 Bản đồ trùng lặp hiện tại

| Nội dung | Nằm ở | Vấn đề |
|---|---|---|
| Luật nghiệp vụ đã chốt | CONTRACT **và** LEDGER (42 dòng) | ★ Hai nguồn cho một luật |
| Gate OD-2 / OD-3 / OD-9 | DB-DESIGN-BRIEF §1–3 **và** LEDGER (DL-04/05/07) | Phân tích ở một chỗ, trạng thái ở chỗ khác |
| Bảng trạng thái gate | DB-DESIGN-BRIEF §16 **và** LEDGER §8 | Hai bảng cùng nội dung |
| `E-1…E-8` | CONTRACT §9.5 · DB-DESIGN-BRIEF · LEDGER | **Ba** nơi |
| `GAP-*` | DISCOVERY (88) · DB-DESIGN-BRIEF (3) · LEDGER (2) | Ba nơi |
| `L-1…L-11` legacy | CONTRACT §16 **và** LEDGER §8-D | Hai nơi |
| Phương án D-01…D-05 | CEO-DECISION-BRIEF | **Đã bị LEDGER thay thế hoàn toàn** |

### 7.2 Số phận năm file Driver Portal

| File hiện tại | Đề xuất | Thành | Lý do |
|---|---|---|---|
| `DRIVER-PORTAL-BUSINESS-CONTRACT.md` | ★ **GIỮ — canonical** | `domains/driver-portal/contract.md` | Nguồn nghiệp vụ duy nhất. Nội dung không đổi |
| `DRIVER-PORTAL-DECISION-LEDGER.md` | ★ **GIỮ — canonical**, có sửa | `domains/driver-portal/decisions.md` | Áp quy tắc §5.1: 42 dòng CONFIRMED đổi từ *chép lại luật* sang *trỏ tới contract* |
| `DRIVER-PORTAL-DB-DESIGN-BRIEF.md` | **GIỮ — canonical**, có sửa | `domains/driver-portal/design.md` | Phần A (gates) chuyển phần *trạng thái* sang `decisions.md`, giữ phần *phân tích*. §16 bỏ (trùng ledger) |
| `DRIVER-PORTAL-DISCOVERY.md` | **MERGE** | mục "Hiện trạng & Gap" của `design.md` | Nó **là** nửa đầu của design. §2 đã bị rút ruột từ trước — nó không còn đứng độc lập |
| `DRIVER-PORTAL-CEO-DECISION-BRIEF.md` | **ARCHIVE** | `archive/` + banner SUPERSEDED | D-01…D-05 đã map hết vào `DL-`. Không còn nội dung nào chỉ có ở đây |

**Kết quả: 5 file → 3 file.** Không mất nội dung nào; không sửa một quyết định
nghiệp vụ nào đã được CEO chốt.

### 7.3 Cấu trúc đích

```text
docs/
├── README.md
├── architecture/
│   ├── adr-0001-user-identity-projection.md
│   ├── adr-0002-list-pagination.md
│   ├── core-001-identity-organization-account-lifecycle-invariants.md
│   └── test-placement.md
├── domains/
│   └── driver-portal/
│       ├── contract.md
│       ├── decisions.md
│       └── design.md
├── backend/
│   ├── company-email-policy.md
│   └── frontend-integration-contract.md
├── operations/
│   ├── production-launch-checklist.md
│   ├── security-hardening-audit.md
│   └── security-test-plan.md
└── archive/
    ├── DRIVER-PORTAL-CEO-DECISION-BRIEF.md
    └── sonar-production-audit.md
```

⚠ **Di chuyển file làm hỏng link.** Mọi tài liệu và mọi README trong `backend/src/`
trỏ tới `docs/` phải được cập nhật cùng lượt. Đó là lý do migration này cần được
duyệt trước, không làm lẻ tẻ.

⚠ **`sonar-production-audit.md`** là audit tại một thời điểm (741 dòng) — theo §3 nó
thuộc loại AUDIT và đã đóng băng. Đề xuất `archive/`; **cần xác nhận** nó không còn
được dùng làm tài liệu sống.

---

## 8. Scale tới các domain tương lai

Booking · Driver · Operations · Pricing · Accounting · Customer · Warehouse · AI ·
Reporting — mỗi cái **một thư mục, tối đa ba file**:

```text
docs/domains/
├── booking/     contract.md · decisions.md · design.md
├── pricing/     contract.md · decisions.md · design.md
├── accounting/  …
└── …
```

| Nếu chín domain đi theo… | Số file | Số dòng ước tính |
|---|---|---|
| Cách hiện tại (5 file/domain) | ~45 | ~37 000 |
| Governance này (3 file/domain) | ~27 | ~22 000 |

★ **Con số quan trọng hơn không phải tổng, mà là "đọc gì trước".** Hôm nay muốn hiểu
Driver Portal phải mở 5 file và tự ghép. Sau đó: mở một thư mục, đọc `contract.md`.

### Domain dùng chung thứ gì đó

Nếu Booking và Pricing chia sẻ một quy tắc → quy tắc đó là **cross-cutting**, thuộc
`architecture/` (ADR hoặc tài liệu bất biến), và cả hai `contract.md` **trỏ tới** nó.
**Không** chép vào cả hai.

---

## 9. Quy tắc cho Claude — kiểm tra trước mỗi task kiến trúc

```text
1.  Đọc docs/README.md §1 → xác định tài liệu canonical của vùng sắp đụng tới
2.  Đọc contract.md của domain đó   → luật nghiệp vụ là gì
3.  Đọc decisions.md                → câu nào còn mở; KHÔNG đoán thay
4.  Đọc design.md                   → hiện trạng và gap đã biết
5.  Trace SOURCE, không tin tài liệu → source thắng khi hai bên khác nhau
6.  ★ MẶC ĐỊNH LÀ SỬA FILE HIỆN CÓ  → tạo file mới phải nêu lý do kiến trúc
7.  Phát hiện mâu thuẫn giữa hai tài liệu → BÁO CÁO, không tự chọn bên nào
8.  Quyết định mới → một DÒNG trong decisions.md, không phải một FILE
9.  Nội dung luật đã CONFIRMED → viết vào contract.md, ledger chỉ trỏ tới
10. Kết thúc task → cập nhật index §1 nếu có file mới hoặc bị archive
```

★ **Quy tắc số 6 là quy tắc mà chính tôi đã vi phạm năm lần** để tạo ra tình trạng
này. Nó là quy tắc quan trọng nhất trong danh sách.

---

## 10. Workik review — quy trình

**Đầu vào:** `design.md` ở trạng thái `proposal`, với một checklist review ở cuối.

**Workik xem xét:**

| | |
|---|---|
| 1 | Từng mục trong checklist — mỗi mục ra **đạt / không đạt / cần đổi** |
| 2 | Ràng buộc nào **phải** ở database, ràng buộc nào chấp nhận ở application |
| 3 | Concurrency và transaction boundary |
| 4 | Chiến lược index đối chiếu với truy vấn thật |
| 5 | An toàn migration: thứ tự · khoá bảng · dữ liệu đã tồn tại |
| 6 | Tính đúng đắn riêng của PostgreSQL |

**Đầu ra:** ghi thẳng vào `design.md` — không sinh file mới. Mỗi mục checklist có kết
luận và ngày. Khi tất cả đạt: trạng thái chuyển `approved`.

★ **Chỉ khi `design.md` ở trạng thái `approved` mới được viết migration.**

---

## 11. Quy ước hiện có, giữ nguyên

| | |
|---|---|
| Migration | Forward-only, có checksum. Sửa sai bằng file mới |
| Không `DELETE` | Rule **B13** ở CI **và** GRANT của `bo_app` |
| Ranh giới kiến trúc | 14 rule ở `backend/scripts/check-boundaries.sh` |
| Đặt file test | [`architecture/test-placement.md`](architecture/test-placement.md) |
| README theo module | Mỗi context trong `backend/src/` có README riêng nói nó **sở hữu** gì và **không sở hữu** gì. Governance này **không** thay thế chúng — đó là tài liệu ở tầng code, gần code nhất |

---

## 12. Việc cần làm

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Duyệt governance này | ✅ xong |
| 2 | Gộp 5 file Driver Portal thành 3 | ✅ xong |
| 3 | Áp quy tắc §5.1 — ledger chỉ giữ con trỏ | ✅ xong — 49 dòng |
| 4 | Di chuyển sang cấu trúc mới + sửa mọi link | ✅ xong |
| 5 | Archive `sonar-production-audit.md` | ✅ xong — có banner HISTORICAL |
| 6 | `adr-0003` — viết ADR còn thiếu | ✅ xong |
| 7 | `security/` → `operations/` | ✅ xong |
| 8 | Chuẩn hoá path domain → `domains/driver-portal/` | ✅ xong |
| 9 | Rà `L-1…L-11` xuất hiện ở cả `contract §16` và `decisions §8-D` | ⏳ đúng theo quy tắc §5.1, nhưng nên gọn hơn ở vòng sau |

---

*Tài liệu này là DOCUMENTATION GOVERNANCE. Nó quy định cách viết tài liệu, không quy
định nghiệp vụ. Không có nội dung nghiệp vụ nào bị thay đổi bởi nó.*
