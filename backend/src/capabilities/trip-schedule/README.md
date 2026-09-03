# Trip schedule — lịch xe

Thay thế file Excel `LỊCH XE - CHI PHÍ XE.xlsx`: mỗi tháng một sheet, mỗi chuyến
một dòng.

**PROJECT-OWNED.** Một deployment khác xoá cả thư mục này, bỏ `0011`, và không
bao giờ biết đến xe tải.

## Ba bảng, và vì sao là ba

| Bảng | Nội dung |
|---|---|
| `trip_vehicles` | đội xe |
| `trip_customers` | khách hàng |
| `trip_schedules` | chính bảng lịch xe |

Trong file Excel, biển số và tên khách được gõ vào ô mỗi lần. Dữ liệu thật cho
thấy cái giá của việc đó: `50H44266` và `50H49266` là hai cách viết của một xe,
`51D.65233` và `51D65233` là hai cách nữa, `VIỄN ĐẠT` và `VIẼN ĐẠT` là một khách
hàng hai lần. Không thống kê được gì theo xe hay theo khách khi điều đó còn
đúng, và cẩn thận hơn lúc nhập liệu không sửa được — bảng tính không cho ai cách
nào để cẩn thận.

Khoá ngoại làm cho việc gõ sai **không biểu diễn được**, thay vì chỉ là không
nên. Cột `plate_key` / `name_key` là `GENERATED ALWAYS` — chuẩn hoá do database
tính, không phải service, vì một chuẩn hoá do ứng dụng tính là một chuẩn hoá bị
bỏ qua ngày có người INSERT thẳng bằng script, và lúc đó unique index lặng lẽ
hết ý nghĩa.

⚠ `name_key` bắt được hoa/thường và khoảng trắng. Nó **không** bắt được `VIỄN`
với `VIẼN` — hai chuỗi Unicode khác nhau thật, và về nguyên tắc có thể là hai
công ty. Thứ chặn cặp đó là người điều vận **chọn từ danh sách** thay vì gõ.
Index là lớp thứ hai, không phải lớp thứ nhất.

## Quyền — bất đối xứng, và cố ý

```
trip.read    'any'            mọi tài khoản đã hoàn tất provisioning
trip.create  'any'            như trên
trip.write   'head-anywhere'  SUPERADMIN, hoặc trưởng phòng của BẤT KỲ phòng nào
```

Ai cũng đọc và thêm dòng; sửa, đổi trạng thái hoặc archive thì cần SUPERADMIN
hoặc một trưởng phòng.

**Vì sao ai cũng thêm được, kể cả vào danh mục xe/khách.** Giới hạn việc thêm
cho quản trị viên trông có vẻ an toàn hơn nhưng không phải: người điều vận đang
nhập một chuyến cho khách chưa có trong danh sách sẽ phải dừng lại, tìm quản trị
viên, và đợi. Thứ họ thực sự làm là ghi tên khách vào ô ghi chú — và danh mục bị
đi vòng đúng ở những dòng nó sinh ra để kỷ luật.

**Vì sao sửa vẫn là quản trị.** Đổi tên một khách hàng thay đổi ý nghĩa của mọi
chuyến trong quá khứ đã trỏ tới nó. Đó là quản trị, không phải nhập liệu — nên
nó không mở cho `'any'`.

**★ Vì sao `'head-anywhere'` chứ không phải `'head'`.** `can()` fail-closed khi
một requirement có phạm vi được hỏi mà không kèm `departmentId`, và các route
lịch xe **không khai báo** department nào vì một chuyến không thuộc phòng ban
nào. Đánh dấu `'head'` sẽ khiến guard từ chối mọi trưởng phòng, trong khi
`grantedPermissions()` — vốn cũng không có target và trả lời "ở đâu đó" — vẫn
liệt kê quyền đó: client vẽ nút Sửa, server trả 403. Bậc này là hình dạng duy
nhất giữ hai bên đồng ý với nhau.

⚠ Và nó **không** có nghĩa "trưởng phòng của phòng sở hữu dòng này", vì không có
phòng nào sở hữu. Trưởng phòng Sales sửa được một chuyến không ai ở Sales nhập.
Đó là cái giá của việc đặt dữ liệu toàn công ty sau một vai trò theo phòng ban,
và ở đây nó được chấp nhận: trưởng phòng chính là người điều vận tìm đến khi gõ
sai một dòng.

### ★ Bậc `'any'` là thay đổi vào `core`, và nó không phải một lỗ hổng

`PERMISSION_REQUIREMENT` trước đây chỉ có `'head' | 'member' | 'global'` — ba
quan hệ với một **phòng ban**. Lịch xe không thuộc phòng nào: xe là của công ty,
khách là của công ty, và điều vận không phải một đơn vị ai đó là thành viên. Gán
nó vào một phòng nào đó là bịa ra một sự thật.

Nếu không có bậc này, các route ở đây sẽ phải bỏ `PermissionGuard` và chạy bằng
`AuthGuard` trần — **và đó mới là lỗ hổng thật**, vì `PermissionGuard` cũng là
nơi duy nhất từ chối `mustChangeSecret`. Một người còn mật khẩu tạm sẽ đọc và ghi
được lịch xe, đúng thứ §12 của hợp đồng frontend hứa là không xảy ra.

Nó vẫn fail-closed: `'any'` là một giá trị **phải viết ra** cho một key cụ thể
trong bảng. Một permission thiếu entry không mặc định thành `'any'` — nó không
compile. Và `can()` vẫn từ chối `'any'` cho người còn credential tạm, vì kiểm tra
đó chạy trước.

## Phân trang — ngoại lệ duy nhất trong API này

`GET /trip-schedules` trả `{ items, page, limit, total, totalPages }`, không phải
`{ items, nextCursor, hasMore }` như năm list còn lại.

Lý do đầy đủ ở
[`docs/architecture/adr-0003`](../../../../docs/architecture/adr-0003-trip-schedule-offset-pagination.md).
Tóm tắt: `from`/`to` là **bắt buộc** (thiếu thì mặc định tháng hiện tại, quá 366
ngày thì 422), nên tập kết quả luôn nhỏ — offset không bao giờ sâu và `COUNT(*)`
không bao giờ quét bảng. Đổi lại có được hai thứ keyset cố ý không cung cấp:
"Trang 2/3", và "tháng này bao nhiêu chuyến" — chính là câu hỏi bảng tính sinh ra
để trả lời.

**★ Điều kiện kèm theo:** nếu khoảng ngày thôi bắt buộc, hoặc trần 366 ngày bị
nới, lập luận trên hết hiệu lực và list phải quay về keyset.

## Hai cái bẫy về ngày, cả hai đều lệch một ngày

**Đọc ra.** `scheduled_on` là `DATE`. `pg` parse kiểu đó thành `Date` của
JavaScript ở nửa đêm **local**, nên server chạy UTC biến `2026-08-04` thành một
thời điểm mà người ở Hồ Chí Minh nhìn thấy là `2026-08-03`. Mọi query trong
repository vì thế `::text` cột này — giá trị không bao giờ thành `Date` nên không
bao giờ dịch chuyển.

**Mặc định vào.** "Tháng hiện tại" phải tính theo lịch **Á Châu/Hồ Chí Minh**,
không theo đồng hồ server. 23:00 UTC ngày 31/08 đã là 06:00 ngày 01/09 ở văn
phòng; một server UTC sẽ trả về tháng 8 cho người đang nhập những chuyến đầu tiên
của tháng 9.

## Vị trí lấy hàng — GAP-14 và geofence phía server

`0019` thêm toạ độ cho hai đầu chuyến (`pickup_latitude/longitude`,
`delivery_latitude/longitude`, nullable, đủ đôi hoặc không có gì) và bằng chứng
vị trí trên `trip_execution_events`. Tài xế `PICKUP_CONFIRMED` phải gửi kèm một
**reading** của điện thoại; server tự đo và tự quyết.

```
browser gửi      latitude · longitude · accuracyM · capturedAt      (chỉ là số đo)
server quyết     distance · geofence_passed · actual_at             (không nhận từ client)
```

Luật nằm ở **một chỗ**: `domain/trip-location.ts`, hằng `MILESTONE_LOCATION_POLICY`.

| Ngưỡng | Mặc định | Ý nghĩa |
|---|---|---|
| `geofenceRadiusM` | **300 m** | khoảng cách tới điểm lấy hàng, bao gồm biên |
| `maxAccuracyM` | **100 m** | `accuracy` điện thoại tự khai; lớn hơn là "đâu đó trong quận" |
| `maxAgeMs` | **2 phút** | tuổi của fix, đo theo `deviceReportedAt` — cùng đồng hồ với `capturedAt`, nên đồng hồ sai vẫn ra tuổi đúng |

Ba con số này **chưa được nghiệp vụ chốt** — chúng là mặc định làm việc, và cố
ý là một hằng chứ không phải biến môi trường hay bảng cấu hình: nâng lên
cấu hình khi có deployment thứ hai hoặc yêu cầu bán kính theo khách hàng.

Thứ tự kiểm tra: lock chuyến → quyền (đúng tài xế) → thứ tự mốc → toạ độ đích
có chưa → reading có chưa → hợp lệ → accuracy → tươi → khoảng cách. Từ chối là
`ValidationError` 422 với `details.location` mang mã (`DESTINATION_MISSING` ·
`LOCATION_REQUIRED` · `INVALID_COORDINATES` · `ACCURACY_INSUFFICIENT` ·
`LOCATION_STALE` · `OUTSIDE_GEOFENCE`); portal đổi mã thành câu, không bao giờ
hiện khoảng cách hay bán kính.

Đây là **location assurance**, không phải chống gian lận: GPS trình duyệt là
tín hiệu, không phải bằng chứng tuyệt đối (contract §11). Không có offline,
không có device attestation, không lưu vết GPS liên tục — chỉ một reading tại
mốc.

## Những gì cố ý KHÔNG có

**Khối CHI PHÍ.** Bảng tính có nhóm cột thứ hai (DẦU · CẦU TRẠM · PHÍ KHO · BỐC
XẾP · TĂNG CA) được điền ở 2 trong 7 sheet. Đó là một luồng khác với người duyệt
khác, và đoán hình dạng của nó từ một tá ô đã điền là bịa ra schema chứ không
phải ghi lại schema. Nó sẽ có migration riêng khi có người mô tả nó.

**Cột SỐ CHUYẾN.** Chỉ tồn tại ở Sheet1; các sheet tháng sau bỏ đi và thay bằng
THÔNG TIN LÔ HÀNG.

**`DELETE`.** Rule B13 — runtime không bao giờ phát `DELETE FROM`. Xoá một dòng
là xoá bản ghi điều vận của một ngày; thay vào đó là `archived_at` + `archived_by`.

## Các file

```
domain/trip-schedule.ts              interface thuần, 5 trạng thái, không framework
application/trip-schedule.service.ts giữ transaction, kiểm xe/khách còn hoạt động
application/trip-catalogue.service.ts hai danh mục
persistence/trip-schedule.repository.ts   SQL, COUNT(*) OVER(), ::text
persistence/trip-catalogue.repository.ts  hai class song sinh — xem comment đầu file
api/trip-schedule.controller.ts      zod DTO khai ngay trong file
api/trip-catalogue.controller.ts
api/trip-schedule.security.spec.ts   61 case: ai được gì, trên từng route
```
