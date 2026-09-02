> # ⚠ SUPERSEDED — 2026-08-30
>
> **Tài liệu này KHÔNG còn là nguồn. Giữ lại chỉ để tra cứu lịch sử.**
>
> Nội dung đã được thay thế hoàn toàn bởi:
>
> | Phần | Đã chuyển sang |
> |---|---|
> | Business contract (Phần 2) | [`../domains/driver-portal/contract.md`](../domains/driver-portal/contract.md) |
> | Các quyết định `D-01`…`D-05` và quyết định kèm theo | [`../domains/driver-portal/decisions.md`](../domains/driver-portal/decisions.md) — đã map vào `DL-nn` |
> | Phân tích kỹ thuật, technical design | [`../domains/driver-portal/design.md`](../domains/driver-portal/design.md) |
>
> Mọi ID `D-0n` trong tài liệu này đã có ID canonical `DL-nn` ở `decisions.md`.
> **Không dùng tài liệu này để ra quyết định.**
>
> ---

# DRIVER PORTAL — CEO DECISION BRIEF

> **Mục đích:** để CEO đọc nhanh và **quyết định 5 vấn đề đang chặn** Phase 1/Phase 2.
>
> **Ngày:** 2026-08-30 · **Trạng thái:** chưa có dòng code nào cho Driver Portal.
> Tài liệu này không kèm code, migration, API, UI hay thay đổi permission.
>
> Chi tiết kỹ thuật đầy đủ: [design.md](../domains/driver-portal/design.md).
> Brief này **không** lặp lại tài liệu đó — chỉ lấy ra phần cần CEO.

---

# PHẦN 1 — EXECUTIVE SUMMARY

**Driver hiện được định nghĩa thế nào trong hệ thống?**
Không được định nghĩa. Không có bảng, không có cột, không có permission nào tên
"driver". Tên tài xế hôm nay nằm lẫn trong **ô ghi chú tự do** của bảng lịch xe,
dưới dạng chữ — cùng chỗ với địa chỉ và số kiện hàng.

**Trip ↔ Driver hiện thiếu gì?**
Thiếu toàn bộ. Hệ thống biết chuyến nào dùng **xe** nào, nhưng không có gì nối
chuyến tới **người**. Nghĩa là hôm nay câu hỏi *"chuyến của tôi là những chuyến
nào"* chưa có cách nào trả lời.

**Driver Portal cần đạt được gì?**
Một tài xế đăng nhập, thấy **đúng những chuyến được giao cho mình** (không thấy
chuyến của người khác, không thấy giá), khai chi phí phát sinh, và gửi đề nghị xác
nhận hoàn thành chuyến để SuperAdmin duyệt.

**Đã CONFIRMED** (CEO đã chốt — xem Phần 2): Driver là User do SuperAdmin cấp tài
khoản · 1 chuyến = 1 tài xế · Operations phân công · tài xế chỉ thấy chuyến của
mình · tuyệt đối không thấy dữ liệu thương mại · khai 5 nhóm chi phí vận hành ·
không tự chuyển chuyến sang DONE · SuperAdmin xác nhận hoàn thành.

**Chưa được quyết định:** 5 vấn đề ở Phần 3.

**Vấn đề nào thực sự chặn?**

| | Chặn | Vì sao chặn |
|---|---|---|
| **D-01** Tài xế đăng nhập bằng gì | **Phase 1** | Hệ thống hiện chỉ cho đăng nhập bằng **email công ty**. Nếu tài xế không có email công ty thì phải sửa phần nền của hệ thống — việc lớn hơn nhiều |
| **D-02** Gán tài xế vào chuyến kiểu gì | **Phase 1** | Quyết định hình dạng cơ sở dữ liệu. Sửa sai sau khi đã chạy là tốn kém |
| **D-03** Tài xế đọc được ô ghi chú không | **Phase 2** | ★ Hiện có **mâu thuẫn thật** giữa cam kết "tuyệt đối không thấy giá" và cách dữ liệu đang được lưu |
| **D-04** Quyền của tài xế với chi phí | **Phase 2** | Quyết định luồng nghiệp vụ và cách kế toán đối soát |
| **D-05** Quy tắc xác nhận hoàn thành | **Phase 3** | Không chặn Phase 1–2, nhưng quyết sớm thì rẻ hơn |

★ **Một câu đáng lưu ý nhất trong toàn bộ brief này:** hôm nay **bất kỳ tài khoản
nào đã kích hoạt cũng đọc được toàn bộ bảng lịch xe của công ty**. Không phải lỗ
hổng — đó là thiết kế cho nhân viên văn phòng. Nhưng nghĩa là **chỉ cần cấp tài
khoản cho một tài xế là người đó đọc được mọi chuyến của mọi khách hàng**, mà
không ai phải làm gì sai. Đây là lý do Driver Portal cần một ranh giới dữ liệu
mới, chứ không chỉ một màn hình mới.

---

# PHẦN 2 — CONFIRMED BUSINESS CONTRACT

Những điều CEO đã xác nhận. **Không hỏi lại.**

### A. Driver identity
- Driver là **User** trong hệ thống hiện tại, tài khoản do **SuperAdmin cấp**.
- **Không** dựng hệ thống đăng nhập riêng cho Driver.
- **Không** tạo role "DRIVER" chỉ vì tên gọi, nếu kiến trúc không yêu cầu.

### B. Trip assignment
- **1 Trip = đúng 1 Driver.**
- **Operations / Điều độ** là bên phân công tài xế cho chuyến.
- Không có: nhiều tài xế · phụ xe · driver pool · marketplace nhận chuyến.

### C. Driver visibility
- Driver **chỉ thấy chuyến được giao cho chính mình**.
- Driver **không** thấy toàn bộ lịch xe của công ty.
- Driver **không** quản lý danh mục xe / khách hàng.

### D. Driver responsibility
Nhận chuyến → thực hiện → khai chi phí phát sinh → gửi đề nghị hoàn thành.
Driver **không phải** người vận hành backoffice.

### E. Expense
- Driver khai 5 nhóm: **Dầu/nhiên liệu · Cầu trạm · Phí kho · Bốc xếp · Tăng ca**.
- Đây là **DRIVER OPERATING EXPENSE**, thuộc về chuyến.
- **Hoàn toàn khác** với tiền thương mại (xem H).

### F. Completion
- Driver **không** tự chuyển chuyến sang DONE.
- Driver gửi **completion request**; **SuperAdmin** kiểm tra và xác nhận.

### G. SuperAdmin control
SuperAdmin có toàn quyền hệ thống: cấp tài khoản Driver, xem chuyến, xem chi phí,
kiểm tra bất thường, xác nhận hoàn thành.

### H. Commercial-data boundary
Driver **tuyệt đối không** thấy: giá hàng hoá · giá lấy hàng · giá giao hàng · tiền
thu khách · doanh thu · lợi nhuận · margin · dữ liệu tài chính không phục vụ việc
thực hiện chuyến.

### I. AI / verification direction
- AI là **service riêng**, dùng để cảnh báo bất thường cho SuperAdmin.
- AI **không** tự kết luận gian lận, không tự huỷ chi phí, không tự đổi trạng thái.
- GPS / face verification là **lớp xác minh nâng cao ở phase sau**, không phải bằng
  chứng tuyệt đối.

### Chưa chốt, và chưa cần chốt bây giờ
Phân quyền cụ thể của **Kế toán** và **Operations** với dữ liệu chi phí — sẽ làm
dần về sau, không chặn Driver Portal.

---

# PHẦN 3 — CEO DECISIONS

---

## D-01 — Tài xế đăng nhập bằng gì

### Hiện trạng

Hệ thống có **một** cách đăng nhập duy nhất: **email + mật khẩu**, và email **bắt
buộc** thuộc tên miền công ty `@hoanglonglti.com`. Quy tắc này nằm trong mã nguồn
(cố ý, để một cấu hình thiếu không vô hiệu hoá nó), và áp dụng khi **tạo tài
khoản** — không áp dụng lúc đăng nhập.

Quy trình cấp tài khoản hiện tại: SuperAdmin tạo → hệ thống sinh **mật khẩu tạm**,
hiện **đúng một lần** cho người duyệt → người duyệt giao tận tay → người dùng đăng
nhập lần đầu và **buộc phải đổi mật khẩu trước khi làm được bất cứ việc gì**.

Phiên đăng nhập được lưu ở máy chủ và **thu hồi được ngay**. Hiện **không có** giới
hạn số thiết bị hay số phiên đồng thời.

### Business question

> **Công ty có cấp email `@hoanglonglti.com` cho tài xế không?**

### Các lựa chọn

**Option A — Cấp email công ty cho tài xế**
- **Ưu:** Không phải sửa gì ở phần nền hệ thống. Tài xế dùng đúng cơ chế nhân viên
  đang dùng, đã được kiểm chứng về bảo mật. Rẻ nhất và nhanh nhất.
- **Nhược:** Việc hành chính — mỗi tài xế cần một địa chỉ. Tài xế phải nhớ một địa
  chỉ email dài để đăng nhập trên điện thoại.
- **Ảnh hưởng:** Phase 1 bắt đầu được ngay.

**Option B — Tài xế đăng nhập bằng số điện thoại**
- **Ưu:** Tự nhiên nhất với tài xế. Không cần cấp email.
- **Nhược:** Phải **sửa phần nền** của hệ thống — nơi đang phục vụ toàn bộ nhân viên
  văn phòng. Mọi thay đổi ở đó đều rủi ro hơn thay đổi ở phần nghiệp vụ.
- **Ảnh hưởng:** Phase 1 dài hơn đáng kể; cần kiểm thử lại đường đăng nhập chung.

**Option C — Mã nhân viên nội bộ + PIN**
- **Ưu:** Không cần email, không cần số điện thoại.
- **Nhược:** Nhược điểm của B, **cộng thêm** việc PIN yếu hơn mật khẩu — và tài
  khoản này chạm tới dữ liệu khách hàng.
- **Ảnh hưởng:** Như B, và mở thêm một câu hỏi về độ mạnh của thông tin đăng nhập.

### Recommendation

`[RECOMMENDATION]` **Option A.** Đây là khuyến nghị **kỹ thuật**: A là phương án duy
nhất không đụng vào phần nền. Nếu vận hành thấy A không khả thi thì **nghiệp vụ
thắng** — chỉ cần biết trước rằng B/C đắt hơn, không phải rẻ hơn.

### Quyết định của CEO

`[ ] Option A — cấp email công ty`
`[ ] Option B — đăng nhập bằng số điện thoại`
`[ ] Option C — mã nhân viên + PIN`

### Quyết định kèm theo

| # | Câu hỏi | Hiện trạng | Lựa chọn |
|---|---|---|---|
| D-01.1 | Ai giao mật khẩu tạm cho tài xế? | Hệ thống hiện **không có email adapter** — mật khẩu tạm giao **tận tay** | `[ ] SuperAdmin trực tiếp` · `[ ] Operations` · `[ ] Cách khác` |
| D-01.2 | Tài xế có buộc đổi mật khẩu lần đầu như nhân viên không? | Hiện **buộc**, và chặn mọi thao tác cho tới khi đổi | `[ ] Giữ nguyên` · `[ ] Miễn cho tài xế` ⚠ miễn là nới lỏng bảo mật |
| D-01.3 | Có giới hạn số thiết bị / phiên đăng nhập của tài xế không? | Hiện **không giới hạn** | `[ ] Chưa cần` · `[ ] Cần — 1 thiết bị/tài xế` |

---

## D-02 — Gán tài xế vào chuyến

> **Đây là quyết định quan trọng nhất**, vì nó quyết định hình dạng cơ sở dữ liệu.
> Cơ sở dữ liệu của hệ thống này chỉ đi tới, không lùi lại — sửa sai sau khi đã
> chạy nghĩa là làm thêm việc và không xoá được vết cũ.

### Hiện trạng

Chuyến hiện nối tới **xe** (và mối nối này được phép để trống — bảng tính gốc có
những dòng ghi "ĐIỀN SAU" khi chưa biết xe nào chạy). **Không có gì nối chuyến tới
người.** Tên tài xế đang được gõ vào ô ghi chú tự do.

Vì chưa có mối nối này, hệ thống hôm nay **không thể** trả lời *"những chuyến nào
được giao cho người này"* — và đó chính là màn hình đầu tiên của Driver Portal.

### Business question

> **Việc phân công tài xế có thay đổi sau khi đã giao không — và nếu có, công ty có
> cần lưu lại lịch sử "ai đã từng được giao chuyến này" không?**

### Các lựa chọn

**Option A — Một ô "tài xế" trên chuyến (ghi đè khi đổi)**
- **Ưu:** Đơn giản nhất, nhanh nhất, đủ cho cam kết *1 chuyến = 1 tài xế*. Sau này
  nâng cấp lên B được mà **không phải nhập lại dữ liệu nào**.
- **Nhược:** Đổi tài xế thì **mất dấu người cũ**. Nếu tháng sau cần hỏi "ai chạy
  chuyến này lúc 8 giờ sáng", hệ thống chỉ trả lời được người **hiện tại**.
- **Ảnh hưởng:** Phù hợp nếu đổi tài xế là hiếm, và khi đổi thì người mới chịu
  trách nhiệm toàn bộ chuyến.

**Option B — Bảng phân công riêng, giữ lịch sử**
- **Ưu:** Trả lời được "ai từng được giao, từ lúc nào đến lúc nào, ai đổi". Quan
  trọng nếu có tranh chấp về chi phí hoặc trách nhiệm giao hàng.
- **Nhược:** Nặng hơn về kỹ thuật. Mọi màn hình "chuyến của tôi" đều phải tra thêm
  một bảng.
- **Ảnh hưởng:** Phù hợp nếu đổi tài xế giữa chuyến là chuyện thường, hoặc nếu chi
  phí do tài xế khai cần quy trách nhiệm chính xác theo thời điểm.

### Recommendation

`[RECOMMENDATION]` **Option A cho giai đoạn đầu**, với đường nâng cấp lên B đã tính
sẵn — đúng cách hệ thống này đã xử lý một tình huống tương tự trước đây (ghi cái
chắc chắn đúng trước, thêm cấu trúc khi nghiệp vụ đã rõ).

⚠ Khuyến nghị này **đảo chiều** nếu câu trả lời cho các câu kèm theo là "có đổi tài
xế giữa chuyến" **và** "cần biết ai chạy lúc nào".

### Quyết định của CEO

`[ ] Option A — một ô tài xế trên chuyến`
`[ ] Option B — bảng phân công riêng, có lịch sử`

### Quyết định kèm theo

| # | Câu hỏi | Lựa chọn |
|---|---|---|
| D-02.1 | Đổi tài xế **trước khi** chuyến bắt đầu? | `[ ] Được` · `[ ] Không` |
| D-02.2 | Đổi tài xế **sau khi** chuyến đã bắt đầu? | `[ ] Được` · `[ ] Không` |
| D-02.3 | Nếu đổi giữa chuyến: chi phí người cũ đã khai thuộc về ai? | `[ ] Giữ nguyên tên người khai` · `[ ] Chuyển sang người mới` · `[ ] Chưa xảy ra bao giờ` |
| D-02.4 | Ai được **phân công** tài xế? | `[ ] Operations` (contract) · `[ ] + Trưởng phòng` · `[ ] + SuperAdmin` |
| D-02.5 | Ai được **đổi** tài xế đã phân công? | `[ ] Cùng người ở D-02.4` · `[ ] Chỉ SuperAdmin` |

---

## D-03 — Tài xế được nhìn thấy những gì

> ★ **Đây là mâu thuẫn thật giữa cam kết nghiệp vụ và cách dữ liệu đang được lưu.**
> Trong tài liệu kỹ thuật nó được ghi là **CONFLICT-1**.

### Hiện trạng

Thông tin một chuyến hiện gồm hai loại:

**Loại 1 — có cấu trúc, sạch, an toàn.** Tên khách hàng và biển số xe được chọn từ
danh mục, nên chúng chỉ chứa đúng thứ chúng nói. Cho tài xế xem là an toàn.

**Loại 2 — ô chữ tự do.** Bốn ô: **thông tin lô hàng · địa chỉ & liên hệ lấy hàng ·
địa chỉ & liên hệ giao hàng · ghi chú**. Đây là chữ do người điều độ **gõ tay**, hệ
thống không kiểm soát nội dung.

★ **Vấn đề:** điều độ hoàn toàn có thể gõ vào ô ghi chú:

```
"giá lấy hàng 12tr, khách trả sau, nhớ thu tiền"
```

và **không cơ chế kỹ thuật nào ngăn được**. Cho tài xế đọc bốn ô này là cho đọc bất
cứ thứ gì từng được gõ vào đó — kể cả thứ mà mục **H** của contract cấm **tuyệt đối**.

**Không thể vừa cho tài xế đọc ô ghi chú nguyên trạng, vừa bảo đảm "tuyệt đối không
thấy giá". Hai điều đó loại trừ nhau.**

### Bảng hiển thị

| Thông tin | Driver thấy? | Lý do |
|---|---|---|
| Tên khách hàng | ✅ Có | Chọn từ danh mục — sạch. Cần để giao đúng nơi |
| Biển số xe | ✅ Có | Chọn từ danh mục — sạch |
| Ngày chạy, giờ lấy, giờ giao | ✅ Có | Có cấu trúc — sạch |
| Trạng thái chuyến | ✅ Có | Cần để biết việc của mình |
| Thông tin lô hàng | ⚠ **D-03 quyết** | Ô chữ tự do — cần nhưng không kiểm soát được nội dung |
| Địa chỉ lấy / giao hàng | ⚠ **D-03 quyết** | Như trên. Bắt buộc phải có để làm việc |
| Liên hệ lấy / giao hàng | ⚠ **D-03 quyết** | Như trên |
| Ghi chú điều độ | ⚠ **D-03 quyết** | Ô rủi ro nhất — đây là chỗ người ta gõ mọi thứ |
| **Giá lấy hàng / giá giao hàng** | ❌ **Không** | Contract H. *Hiện chưa tồn tại trong hệ thống* |
| **Tiền thu khách / doanh thu / lợi nhuận / margin** | ❌ **Không** | Contract H. *Hiện chưa tồn tại trong hệ thống* |
| **Giá thuê nhà xe ngoài** | ❌ **Không** | Đã tồn tại, và đã được khoá ở mức cao nhất — giữ nguyên |
| **Tổng chi phí chuyến** | ❌ **Không** | Xem D-04.4 — con số này bao gồm cả giá thuê nhà xe ngoài |
| Chuyến của tài xế khác | ❌ **Không** | Contract C |
| Danh mục khách hàng / đội xe đầy đủ | ❌ **Không** | Contract C |

### Business question

> **Làm thế nào để bảo đảm dữ liệu thương mại không lọt sang tài xế qua các ô chữ
> tự do — chấp nhận rủi ro và quản bằng quy trình, hay tách một ô riêng "chỉ dẫn
> cho tài xế" mà hệ thống bảo đảm được?**

### Các lựa chọn

**Option A — Không cho tài xế đọc ô ghi chú và thông tin lô hàng**
- **Ưu:** An toàn tuyệt đối. Không cần thay đổi cách điều độ làm việc.
- **Nhược:** Tài xế mất thông tin thật sự cần — "1 kg hàng", "hàng dễ vỡ", "gọi
  trước 30 phút" đều nằm trong hai ô đó.
- **Ảnh hưởng:** Tài xế sẽ hỏi qua điện thoại, và thông tin quay về ngoài hệ thống.

**Option B — Thêm ô riêng "Chỉ dẫn cho tài xế", tài xế chỉ đọc ô đó**
- **Ưu:** Ranh giới trở thành **thuộc tính của hệ thống**, không phải một lời hứa.
  Ô ghi chú cũ ở lại với backoffice, muốn gõ gì cũng được. Đây là cách duy nhất làm
  cho chữ "tuyệt đối" trong contract đúng theo nghĩa đen.
- **Nhược:** Điều độ phải nhập **thêm một ô** cho mỗi chuyến. Nếu họ không nhập, tài
  xế không có chỉ dẫn nào.
- **Ảnh hưởng:** Thêm một bước trong quy trình điều độ hằng ngày.

**Option C — Cho tài xế đọc như hiện tại, quản bằng quy trình + đào tạo**
- **Ưu:** Không thay đổi gì. Nhanh nhất.
- **Nhược:** ★ **Không thi hành được bằng hệ thống.** Một lần gõ nhầm là một lần rò
  rỉ, và không ai biết cho tới khi đã muộn. Đây là **chấp nhận rủi ro**, không phải
  giải pháp — CEO cần biết rõ điều đó khi chọn.
- **Ảnh hưởng:** Contract H trở thành mục tiêu phấn đấu, không phải cam kết.

### Recommendation

`[RECOMMENDATION]` **Option B, kèm quy trình của C.** Nếu chữ "tuyệt đối" trong
contract được hiểu đúng nghĩa đen thì B là lựa chọn duy nhất đạt được nó. C một mình
không đạt.

⚠ Ghi rõ để CEO cân nhắc: **địa chỉ lấy/giao hàng cũng là ô chữ tự do** nhưng tài xế
**bắt buộc** phải có. Nếu chọn B thì địa chỉ nên nằm trong nhóm nào — đó là câu
D-03.1.

### Quyết định của CEO

`[ ] Option A — giấu ô ghi chú và thông tin lô hàng`
`[ ] Option B — thêm ô "Chỉ dẫn cho tài xế" *(khuyến nghị)*`
`[ ] Option C — cho đọc như hiện tại, chấp nhận rủi ro`

### Quyết định kèm theo

| # | Câu hỏi | Lựa chọn |
|---|---|---|
| D-03.1 | Địa chỉ + liên hệ lấy/giao hàng: tài xế đọc trực tiếp hay qua ô "Chỉ dẫn"? | `[ ] Đọc trực tiếp` (rủi ro thấp hơn ghi chú, nhưng vẫn là chữ tự do) · `[ ] Qua ô Chỉ dẫn` |
| D-03.2 | Tài xế xem lại được chuyến cũ của mình bao xa? | `[ ] Chỉ chuyến đang chạy` · `[ ] 30 ngày` · `[ ] 90 ngày` · `[ ] Toàn bộ` |

---

## D-04 — Quyền của tài xế với chi phí vận hành

> Chỉ nói về **chi phí vận hành chuyến**: Dầu · Cầu trạm · Phí kho · Bốc xếp · Tăng
> ca. **Không** liên quan gì tới giá lấy hàng, giá giao hàng, tiền thu khách, doanh
> thu hay lợi nhuận — đó là nhóm nghiệp vụ khác hoàn toàn.

### Hiện trạng

Hệ thống **đã có** đúng 5 nhóm chi phí này, và đã có ba nguyên tắc đang chạy:

1. **Không sửa được.** Một khoản đã ghi thì không có cách nào sửa số tiền — không
   có nút, không có chức năng, không tồn tại ở bất kỳ tầng nào. Sai thì **huỷ bỏ
   kèm lý do bắt buộc** rồi ghi khoản mới. Lý do: để con số đã tính vào báo cáo
   tháng trước vẫn giải thích được vào tháng sau.
2. **Luôn biết ai ghi và ghi lúc nào.**
3. **Chỉ SuperAdmin chạm được** — đây là mức khoá tạm thời, đặt ra để chờ đúng
   quyết định này.

Hệ thống **chưa có**: khái niệm "duyệt chi phí", chỗ lưu ảnh chứng từ, và cách phân
biệt khoản do tài xế khai với khoản do văn phòng nhập.

### Business question

> **Tài xế được làm gì với khoản chi phí mình đã khai — chỉ khai rồi thôi, hay còn
> được tự huỷ khi khai sai?**

### Các lựa chọn

**Option A — Tài xế chỉ khai. Sai thì văn phòng huỷ**
- **Ưu:** An toàn nhất, và đơn giản nhất để bắt đầu.
- **Nhược:** Mỗi lần tài xế gõ nhầm là một cuộc điện thoại về văn phòng.
- **Ảnh hưởng:** Nếu tài xế gõ nhầm thường xuyên, văn phòng gánh việc.

**Option B — Tài xế tự huỷ được khoản của mình, bất cứ lúc nào**
- **Ưu:** Tài xế tự sửa sai, văn phòng không phải can thiệp.
- **Nhược:** Tài xế có thể rút lại một khoản ngay trước khi bị soi. ⚠ Rủi ro này
  **nhỏ hơn vẻ ngoài** — huỷ không phải xoá; khoản bị huỷ vẫn còn nguyên trong hệ
  thống kèm lý do và tên người huỷ.
- **Ảnh hưởng:** Cần có báo cáo cho SuperAdmin xem những khoản bị huỷ.

**Option C — Tài xế tự huỷ được trong một khoảng thời gian, sau đó chỉ văn phòng**
- **Ưu:** Khớp thực tế nhất — gõ nhầm thường được phát hiện ngay.
- **Nhược:** Tốn công nhất để làm.
- **Ảnh hưởng:** Cần CEO cho một con số cụ thể (24 giờ? tới khi chuyến được xác
  nhận hoàn thành?).

### Recommendation

`[RECOMMENDATION]` **Option A cho giai đoạn đầu**, C là mục tiêu sau khi có số liệu
thật về tần suất gõ nhầm. Lý do kỹ thuật: A không đòi hỏi một cơ chế phân quyền hoàn
toàn mới phải hoạt động đúng ngay trên **đường ghi tiền** ở ngay giai đoạn đầu.

### Quyết định của CEO

`[ ] Option A — chỉ khai, văn phòng huỷ *(khuyến nghị)*`
`[ ] Option B — tự huỷ bất cứ lúc nào`
`[ ] Option C — tự huỷ trong ___ giờ`

### Quyết định kèm theo

| # | Câu hỏi | Hiện trạng | Lựa chọn |
|---|---|---|---|
| D-04.1 | Tài xế có xem lại được các khoản **mình đã khai** không? | Chưa có khái niệm này | `[ ] Có` · `[ ] Không` |
| D-04.2 | Tài xế có thấy khoản do **văn phòng nhập** cho chuyến của mình không? | Chưa có | `[ ] Có` · `[ ] Không` |
| D-04.3 | **Operations có được nhập chi phí thay tài xế không?** (tài xế gọi điện đọc số) | Chưa có | `[ ] Có` · `[ ] Không` |
| D-04.4 | Tài xế có thấy **tổng chi phí chuyến** không? | Chưa có | `[ ] Không` *(khuyến nghị)* · `[ ] Có` — ⚠ con số tổng hiện **bao gồm cả giá thuê nhà xe ngoài**, tức là dữ liệu contract H cấm |
| D-04.5 | Chi phí tài xế khai có cần **duyệt** trước khi vào sổ không? | Chưa có khái niệm duyệt | `[ ] Không duyệt` · `[ ] Operations duyệt` · `[ ] Kế toán duyệt` |
| D-04.6 | Nếu có duyệt: khoản **chưa duyệt** có tính vào tổng chi phí không? | — | `[ ] Có` · `[ ] Không` — ⚠ đây là quyết định **kế toán**, nó thay đổi ý nghĩa của chữ "tổng" |
| D-04.7 | Có bắt buộc **ảnh chứng từ** ngay giai đoạn đầu không? | Hệ thống **chưa có** chỗ lưu file nào | `[ ] Chưa cần` *(khuyến nghị)* · `[ ] Bắt buộc mọi khoản` · `[ ] Chỉ khoản trên ___ đồng` — ⚠ bất kỳ lựa chọn nào ngoài "chưa cần" đều kéo theo một hạng mục hạ tầng mới và làm chậm giai đoạn này |
| D-04.8 | Giữ nguyên nguyên tắc **không sửa, chỉ huỷ + ghi lại**? | Đang là như vậy | `[ ] Giữ nguyên` *(khuyến nghị)* · `[ ] Cho phép sửa` — ⚠ cho phép sửa là **thay đổi lớn về kiến trúc**, và làm mất khả năng giải thích lại báo cáo cũ |

---

## D-05 — Quy tắc xác nhận hoàn thành chuyến

### Hiện trạng

**Chưa có gì cả.** Hôm nay đổi trạng thái chuyến là một thao tác **một bước**: bất
kỳ ai có quyền sửa lịch xe đều đặt được chuyến sang "ĐÃ XONG", và cũng **đặt ngược
lại được** — hệ thống **không kiểm tra thứ tự chuyển trạng thái**, và **không lưu
lại việc đó đã xảy ra**. Không có đề nghị, không có duyệt, không có lịch sử ai xác nhận.

★ **Một tiền lệ CEO nên biết trước khi trả lời câu "lý do từ chối":** hệ thống đã có
hai luồng duyệt khác (duyệt chuyển phòng, duyệt mở tài khoản). Ở cả hai, màn hình
**có ô nhập "Lý do từ chối"**, người dùng gõ vào, bấm gửi thành công — và **hệ thống
âm thầm bỏ đi đoạn chữ đó**. Đây là nợ sản phẩm đã được ghi nhận trong tài liệu, cố
ý chưa xử lý. Nếu completion request làm theo mặc định cùng kiểu, công ty sẽ có
**món nợ thứ ba giống hệt**.

### Business question

> **Khi SuperAdmin từ chối một đề nghị hoàn thành, hệ thống có phải lưu lại lý do từ
> chối không — và tài xế có được gửi lại đề nghị sau khi sửa không?**

### Các lựa chọn

**Option A — Lưu đầy đủ lịch sử: mọi lần gửi, mọi lần duyệt/từ chối, kèm lý do bắt buộc**
- **Ưu:** Trả lời được "chuyến này bị từ chối mấy lần, vì sao, ai duyệt cuối cùng".
  Tài xế biết mình phải sửa gì. Tránh lặp lại món nợ đã có ở hai luồng duyệt kia.
- **Nhược:** SuperAdmin phải gõ lý do mỗi lần từ chối.
- **Ảnh hưởng:** Nhiều việc hơn một chút khi làm, nhưng đây là dữ liệu mà AI ở giai
  đoạn sau cần để phát hiện bất thường.

**Option B — Chỉ lưu kết quả cuối: duyệt hay không, ai duyệt. Không lưu lý do**
- **Ưu:** Nhanh nhất, ít thao tác nhất cho SuperAdmin.
- **Nhược:** ★ Lặp lại đúng vấn đề của hai luồng duyệt hiện có — tài xế bị từ chối
  mà **không biết vì sao**, và sẽ gọi điện hỏi. Không có dữ liệu để cải thiện.
- **Ảnh hưởng:** Món nợ sản phẩm thứ ba cùng loại.

### Recommendation

`[RECOMMENDATION]` **Option A.** Không phải vì "đầy đủ thì tốt hơn", mà vì hệ thống
đã có **hai** ví dụ cho thấy chuyện gì xảy ra khi bỏ qua: giao diện hứa một điều mà
hệ thống không làm, và không ai phát hiện ra cho tới khi cần tra lại.

### Quyết định của CEO

`[ ] Option A — lưu đầy đủ, lý do từ chối bắt buộc *(khuyến nghị)*`
`[ ] Option B — chỉ lưu kết quả cuối`

### Quyết định kèm theo

| # | Câu hỏi | Lựa chọn |
|---|---|---|
| D-05.1 | Bị từ chối rồi, tài xế có được **gửi lại** không? | `[ ] Được, không giới hạn` · `[ ] Được, tối đa ___ lần` · `[ ] Không — Operations xử lý` |
| D-05.2 | SuperAdmin có được duyệt **ngay** không, hay phải có bằng chứng kèm theo? | `[ ] Duyệt ngay` · `[ ] Cần ảnh/chứng từ` — ⚠ lựa chọn thứ hai phụ thuộc D-04.7 |
| D-05.3 | Chuyến đã ĐÃ XONG có được **mở lại** không? | `[ ] Không` · `[ ] Được, chỉ SuperAdmin, có ghi lý do` — ⚠ hôm nay **mở lại được, và không để lại dấu vết nào** |
| D-05.4 | Ngoài SuperAdmin, còn ai được xác nhận hoàn thành? | `[ ] Chỉ SuperAdmin` (contract) · `[ ] + người khác: ___` |

---

# PHẦN 5 — KHÔNG CẦN CEO QUYẾT ĐỊNH

`[TECHNICAL DESIGN — KHÔNG CẦN CEO QUYẾT ĐỊNH]`

Những thứ dưới đây do đội kỹ thuật quyết, và **không** ảnh hưởng tới cam kết
nghiệp vụ. Đưa vào đây để chúng không chiếm chỗ trong cuộc họp:

- Tên bảng, tên cột, tên endpoint, tên class, cấu trúc thư mục
- Cách kiểm tra "chuyến này có phải của tài xế này không" ở tầng kỹ thuật
- Cấu trúc DTO, cấu trúc component React, cách dùng TanStack Query
- Chỉ mục cơ sở dữ liệu, tối ưu truy vấn, phân trang
- Cách tổ chức module NestJS, ranh giới giữa các tầng
- Driver Portal là dự án frontend riêng hay chung — kỹ thuật quyết
- Nhà cung cấp AI, model, cách gọi — kỹ thuật quyết
- Dấu thời gian do máy chủ sinh (không phải do điện thoại tài xế gửi) — **kỹ thuật
  mặc định làm đúng**, không cần hỏi

**Ngoại lệ — hai việc kỹ thuật cần CEO biết, dù không cần CEO chọn:**

1. **Driver Portal đặt ở tên miền nào** ảnh hưởng tới cách đăng nhập hoạt động. Đội
   kỹ thuật cần khảo sát điều này **trước Phase 1**; nếu kết quả là "phải làm khác
   đi", sẽ báo lại CEO.
2. **Không tạo role "DRIVER" riêng.** Tư cách tài xế được xác lập bằng **việc được
   phân công chuyến**, không bằng một nhãn gắn vào tài khoản. Điều này khớp với cách
   hệ thống đang hoạt động và **không** làm giảm quyền kiểm soát của SuperAdmin.

---

# PHẦN 6 — GIAI ĐOẠN SAU, KHÔNG CHẶN PHASE 1

Những thứ sau **không** phải điều kiện để Driver Portal chạy được. Chúng chỉ được
làm khi contract yêu cầu, và mỗi thứ đều cần một quyết định riêng vào lúc đó:

| Hạng mục | Ghi chú cho CEO |
|---|---|
| **GPS / geofence khi lấy và giao hàng** | Cần thu thập **toạ độ các kho và điểm giao** trước — đây là việc thu thập dữ liệu ngoài thực địa, có thể lâu hơn phần lập trình |
| **Xác minh vị trí** | ⚠ Toạ độ do điện thoại gửi lên là thông tin **do thiết bị khai báo**, giả được. Nó là **dấu vết** và **rào cản**, không phải bằng chứng tuyệt đối |
| **Xác minh khuôn mặt** | ⚠ Nó trả lời *"có đúng người không"*, **không** trả lời *"có đúng chỗ không"*. Nếu vấn đề cần giải là vị trí thì thiết bị định vị **gắn trên xe** hiệu quả hơn nhiều, rẻ hơn về pháp lý, và không đụng tới dữ liệu sinh trắc học |
| **Ràng buộc thiết bị** (một tài xế – một máy) | Rẻ và hiệu quả hơn GPS. Nên cân nhắc **trước** xác minh khuôn mặt |
| **AI phát hiện bất thường** | Ví dụ CEO nêu — *dầu 1.500.000 hai ngày liên tiếp* — thực ra là một phép tra cứu đơn giản, **không cần AI**. AI có giá trị ở tầng cao hơn, sau khi có dữ liệu lịch sử. AI **chỉ cảnh báo**, người quyết |
| **Đọc tự động hoá đơn (OCR)** | Phụ thuộc D-04.7 |
| **Phát hiện gian lận nâng cao** | Cần dữ liệu lịch sử trước |

---

# PHẦN 7 — IMPLEMENTATION GATE

| Decision | Nội dung | Block Phase | Owner | Status |
|---|---|---|---|---|
| — | Driver là User, SuperAdmin cấp tài khoản | — | CEO | **CONFIRMED** |
| — | 1 Trip = 1 Driver | — | CEO | **CONFIRMED** |
| — | Operations phân công tài xế | — | CEO | **CONFIRMED** |
| — | Driver chỉ thấy chuyến của mình | — | CEO | **CONFIRMED** |
| — | Driver không thấy dữ liệu thương mại | — | CEO | **CONFIRMED** |
| — | Driver khai 5 nhóm chi phí vận hành | — | CEO | **CONFIRMED** |
| — | Driver không tự chuyển sang DONE; SuperAdmin xác nhận | — | CEO | **CONFIRMED** |
| — | AI là decision-support, không tự kết luận | — | CEO | **CONFIRMED** |
| **D-01** | Tài xế đăng nhập bằng gì | **Phase 1** | CEO | **OPEN** |
| **D-02** | Gán tài xế vào chuyến kiểu gì | **Phase 1** | CEO + Điều độ | **OPEN** |
| **D-03** | Tài xế đọc được ô chữ tự do không | **Phase 2** | CEO + Điều độ | **OPEN** |
| **D-04** | Quyền của tài xế với chi phí | **Phase 2** | CEO + Kế toán | **OPEN** |
| **D-05** | Quy tắc xác nhận hoàn thành | **Phase 3** | CEO | **OPEN** |
| — | Phân quyền chi tiết của Kế toán / Operations | Phase 3–5 | CEO + Kế toán | **DEFERRED** — contract nói làm dần về sau |
| — | Tên miền của Driver Portal (ảnh hưởng đăng nhập) | Phase 1 | Kiến trúc | **UNKNOWN / NEEDS INVESTIGATION** |

### Còn tồn tại — CONFLICT

| ID | Nội dung | Xử lý bằng |
|---|---|---|
| **CONFLICT-1** | Contract cam kết tài xế **tuyệt đối không** thấy dữ liệu thương mại, nhưng bốn ô chữ tự do của chuyến **có thể chứa** dữ liệu đó và hệ thống không kiểm soát được nội dung | **D-03** |

Không có conflict nào khác giữa contract và hệ thống hiện tại. Đặc biệt: ranh giới
giữa **chi phí vận hành của tài xế** và **tiền thương mại của khách hàng** đang được
hệ thống tôn trọng đúng — hai nhóm nằm ở hai bảng khác nhau, và nhóm thứ hai chưa
được xây.

---

## Cần gì để bắt đầu

**Trả lời D-01 và D-02** là đủ để khởi động Phase 1.
**D-03** cần trước khi tài xế nhìn thấy màn hình chuyến đầu tiên.

*Tài liệu này là bản tóm tắt để quyết định. Chi tiết kỹ thuật đầy đủ, gồm toàn bộ
phân tích khoảng trống và các phương án kiến trúc, nằm ở
[design.md](../domains/driver-portal/design.md).*
