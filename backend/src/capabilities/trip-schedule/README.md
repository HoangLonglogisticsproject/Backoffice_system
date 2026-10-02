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
trip.read         global | function sales·accounting·dispatch·customer_service — board, detail, history, events, assignments, completion list, danh mục
trip.create       global | function sales·accounting·dispatch·customer_service — CHỈ thêm chuyến (DL-111)
customer.create   global | function sales·accounting·dispatch·customer_service — POST /trip-customers (DL-112)
location.create   global | function sales·accounting·dispatch·customer_service — POST /trip-locations, /trip-customers/:id/locations
vehicle.create    global | function dispatch                                  — POST /trip-vehicles: đội xe là của điều phối
trip.write        'head-anywhere' & function sales·accounting·dispatch — SUPERADMIN, hoặc trưởng phòng CỦA MỘT PHÒNG CHỨC NĂNG (không mở cho customer_service)
dispatch.write    global | function dispatch     (0032) — assign / replace / end / danh sách tài xế
trip.price.read   global | function accounting   (DL-111) — Sales / CS / Điều phối không thấy giá
trip.price.write  global | function accounting   — key giá trong body POST / PATCH
cost.read         global                        — hộp thoại Chi phí chuyến + cột chi phí board (cost.create / cost.void cũng global)
cost.export       global | function accounting   (DL-117) — CHỈ khối chi phí trong Excel, GET /trip-schedules/export
```

Dữ liệu chuyến thuộc **bốn phòng nghiệp vụ** (Sales, Kế toán, Điều phối, Customer
Service) và SUPERADMIN — phòng khác (Marketing, HR, IT…) không đọc, không thêm,
không sửa, dù là trưởng phòng (làm rõ nghiệp vụ 2026-09-17; mở rộng 2026-09-18).
Giá bán / giá mua là của **Kế toán**: ba phòng còn lại tạo chuyến **không giá**,
Kế toán bổ sung qua PATCH chỉ-key-giá. Trong bốn phòng đó: ai cũng đọc board và
tạo chuyến; sửa, đổi trạng thái hoặc archive cần SUPERADMIN hoặc trưởng phòng
của Sales / Kế toán / Điều phối (Customer Service **không** có `trip.write`);
điều phối, thêm xe và đề nghị tài khoản tài xế là việc của phòng Điều phối;
nhập giá là việc của Kế toán. `PATCH /trip-schedules/:id` phân quyền theo
field: key giá → `trip.price.write`, key khác → `trip.write`.

**Vì sao người đặt chuyến cũng thêm được khách / địa điểm — nhưng không thêm xe
(DL-112).** Giới hạn việc thêm khách cho quản trị viên trông có vẻ an toàn hơn
nhưng không phải: người đang nhập một chuyến cho khách chưa có trong danh sách sẽ
phải dừng lại, tìm quản trị viên, và đợi. Thứ họ thực sự làm là ghi tên khách vào
ô ghi chú — và danh mục bị đi vòng đúng ở những dòng nó sinh ra để kỷ luật. Đội
xe thì khác: xe là tài sản vận hành, `vehicle.create` chỉ của Điều phối và
SUPERADMIN, để người đặt chuyến không "bịa" ra một chiếc xe rồi đưa lên chuyến.

**Vì sao sửa vẫn là quản trị.** Đổi tên một khách hàng thay đổi ý nghĩa của mọi
chuyến trong quá khứ đã trỏ tới nó. Đó là quản trị, không phải nhập liệu — nên
nó không mở cho mọi thành viên của phòng chức năng.

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

### ★ `global | orFunction` — lịch xe không thuộc phòng nào, nhưng thuộc bốn *chức năng*

`PERMISSION_REQUIREMENT` trước đây chỉ có `'head' | 'member' | 'global'` — ba
quan hệ với một **phòng ban**. Lịch xe không thuộc phòng nào: xe là của công ty,
khách là của công ty, và điều vận không phải một đơn vị ai đó là thành viên. Gán
nó vào một phòng nào đó là bịa ra một sự thật.

Thứ nó thuộc về là **chức năng** của phòng (`departments.function`, 0032/0033):
`trip.read` · `trip.create` · `customer.create` · `location.create` là
`{ tier: 'global', orFunction: ['sales', 'accounting', 'dispatch',
'customer_service'] }` — SuperAdmin, hoặc bất kỳ thành viên (head lẫn member)
của một phòng mang một trong bốn function đó. `trip.price.read` /
`trip.price.write` chỉ liệt kê `accounting`; `vehicle.create` ·
`dispatch.write` · `driver.account.request` chỉ liệt kê `dispatch` (DL-111 /
DL-112). Phòng không có function, và driver không có membership, mang
`functions: []` và không bao giờ qua được. Không còn key nào ở bậc `'any'`;
architecture test giữ điều đó.

Các route vẫn đi qua `PermissionGuard` chứ không chạy bằng `AuthGuard` trần — vì
`PermissionGuard` (và `ProvisionedAccountGuard` ở Driver Portal) là nơi từ chối
`mustChangeSecret`. Một người còn mật khẩu tạm không đọc được lịch xe, đúng thứ
§12 của hợp đồng frontend hứa; `can()` kiểm tra điều đó trước cả `global`.

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

## Sắp xếp và tổng chi phí trên board

`?sort=executionDate|bookingCreated|lastUpdated&direction=asc|desc`, mặc định
`executionDate desc` — đúng thứ tự trước đây. `executionDate` là `scheduled_on`, tức
ngày lấy hàng — UI "Ngày lấy hàng". ⚠ `lastUpdated` là `updated_at` của
**dòng chuyến** (UI: "Chỉnh sửa gần nhất"), không phải hoạt động gộp: phân công, chi
phí và mốc tài xế ghi bảng khác và không làm nó đổi. Enum → SQL ở **một** chỗ,
`persistence/trip-board-order.ts`; mọi thứ tự kết thúc bằng `t.id` cùng chiều để
trang offset không lặp/mất dòng khi trùng giá trị. Không cần index mới:
`COUNT(*) OVER()` vốn đã đọc trọn khoảng ngày (qua `idx_trip_schedule_page`), nên
thứ tự nào cũng chỉ là top-N sort trên tập đã bị chặn 366 ngày.

Mỗi dòng có `costSummary` — cùng con số với `cost-summary.combined`, **một** câu
aggregate cho cả trang (`persistence/trip-board-cost.repository.ts`, `UNION ALL` hai
sổ rồi mới `GROUP BY`, nên không nhân dòng). Không có `cost.read` → `null` và câu đó
**không chạy**. `application/trip-board.service.ts` ghép hai thứ; controller chỉ
quyết ai được thấy. Cùng câu đó tách `byCategory` (năm khoản mục) và `hires` — phần
chi tiết cho export Excel, cộng lại đúng bằng `total`. ⚠ `hires` và "Giá cước mua"
(`purchase_price`) có thể là cùng một khoản trả nhà xe, không có đối soát; đừng cộng.

## Lịch xe và Lịch sử chuyến — một Trip, hai projection

`?lifecycle=operational|history` (mặc định `operational`) trên `GET /trip-schedules`
và `/export`. Lịch xe = `status <> 'finished'`, Lịch sử = `status = 'finished'` — tách
ở trạng thái kết thúc chuẩn, **không** ở ngày: chuyến hôm qua chưa đóng vẫn là việc
của Lịch xe. Không phải `closed_at`: chuyến `done` trước 0017 thành `finished` mà
không có dấu đóng. Predicate trên chính dòng chuyến, không join, trong cùng khoảng
ngày `idx_trip_schedule_page` đã đọc — không cần index mới.

## Mô hình thời gian — `domain/trip-timeline.ts`

`created_at` do hệ thống ghi, không back-date · `scheduled_on` = **ngày lấy hàng dự
kiến** ("Ngày lấy hàng", luôn có) · `pickup_at` = giờ lấy hàng chính xác khi đã biết,
và ngày (Hồ Chí Minh) của nó **là** `scheduled_on` · `delivery_at` = thời điểm giao khi
đã biết. Kiểm trong `resolve()` — chung cho create, update và nhập chuyến cũ.

* **Giao sau lấy, nghiêm ngặt**, chỉ khi có cả hai giờ — 422 `NOT_AFTER_PICKUP`. Như
  kiểm tra danh mục, chỉ áp khi write **đổi** một mốc: dòng cũ vẫn được định giá.
* **Ngày ↔ giờ lấy không lệch** — 422 `NOT_THE_PICKUP_DAY`. Dòng đang lệch giữ nguyên
  qua sửa không liên quan; đổi pickup là thứ làm nó hội tụ. Không migration dữ liệu.
* **Lịch theo ý định tạo** (`calendarRefusal`): `entryMode: operational` từ chối ngày
  đã qua (`PAST_DAY`); `entryMode: historical` từ chối ngày sau hôm nay
  (`FUTURE_DAY`) và giờ lấy / giao **có giá trị** mà sau thời điểm hiện tại
  (`FUTURE_INSTANT`) — chuyến đã chạy thì đã xảy ra. Chỉ khi tạo.

## Nhập chuyến cũ — cùng `POST /trip-schedules`, `entryMode: historical`

Một route tạo, một quyền (`trip.create`), một pipeline (`TripScheduleService.create`).
Client nói **vì sao** nhập chuyến (`entryMode`); server quyết **chuyến bắt đầu thế nào**
(`initialLifecycle` trong `domain/trip-status-history.ts`): booking **luôn** mở `pending`
(gửi `pending` là no-op; trạng thái khác → 422 `STATUS_SET_BY_SERVER`, `finished` → 409);
chuyến đã chạy sinh ra `finished`
bằng `createFinished` (dòng + `closed_by`/`closed_at` = người và lúc nhập), một dòng
history `null → finished` lý do `historical_entry`, và crew
(`application/trip-entry-crew.ts`) là assignment ghi-rồi-kết-thúc với cùng lý do — kiểm
bằng đúng luật điều độ (`application/dispatch-eligibility.ts`). Không completion request,
không execution event, không notification. Chi phí vào sau qua đường backoffice của sổ
chi phí (`cost.create`), đường vốn không đọc trạng thái chuyến; khoản tài xế khai thì
không.

Đây là đường duy nhất **sinh ra** `finished` (`createFinished`); mọi đường **chuyển**
một chuyến sang `finished` đều qua `closeTrip` — mục dưới
(`tests/architecture/trip-write-paths.spec.ts`).

⚠ Crew của board là assignment `active` — **và** trên chuyến `finished`, các lượt
`ended` mang dấu `historical_entry` (`IS_CREW` trong repository). Lượt bị điều độ gỡ
tay không bao giờ mang dấu đó.

## "Đã xác nhận" = `finished` — một closure, ba cửa (2026-09-29)

Chủ doanh nghiệp chốt ba trạng thái CEO nhìn thấy: Chờ xử lý (`pending`), Đang thực
hiện (`executing`) và **Đã xác nhận (`finished`) — chuyến đã XONG**, không phải "đã chốt
xe". `confirmed` **ngừng dùng**: dòng cũ vẫn đọc được (UI "Đã xác nhận (dữ liệu cũ)"),
nhưng tạo chuyến, PATCH và đổi trạng thái đều từ chối ghi nó — 422 `RETIRED_STATUS`
(`isRetiredStatus`). Bỏ `confirmed` khỏi CHECK là migration SAU khi production đã chuẩn hoá.

Chỉ `closeTrip` (`application/trip-closure.ts`) ghi `finished` + `closed_by`/`closed_at`
+ một dòng history, trong transaction của người gọi. Ba cửa, cùng một nghĩa, phân biệt
bằng `reason`:

| Cửa | `reason` |
|---|---|
| duyệt lượt cuối (`TripCompletionService.approve`) — luồng đích, do tài xế | `All assignments approved.` |
| **break-glass**: `POST /trip-schedules/:id/complete`, `trip.complete.review` — chỉ cho chuyến mà tài xế sẽ không bao giờ gửi yêu cầu; **không màn hình nào gọi**; tạm thời | `manual_completion` |
| chuẩn hoá `confirmed` cũ (`LegacyConfirmedNormalization`) | `legacy_status_normalization` |

Đóng tay bị từ chối (409) khi tài xế còn yêu cầu hoàn tất đang chờ — duyệt yêu cầu đó mới là cách.

## Vòng đời thuộc về server — văn phòng không đổi trạng thái (2026-10-02)

| Bước | Ai | Ở đâu |
|---|---|---|
| `null → pending` | người tạo booking | `POST /trip-schedules` (`entryMode: operational`) |
| `pending → executing` | **tài xế** — mốc thực hiện sống đầu tiên được chấp nhận; lý do `execution_started`, `changed_by` = tài xế | `TripExecutionService.recordEvent`, cùng transaction, dưới khoá dòng chuyến |
| `→ finished` | SuperAdmin duyệt yêu cầu hoàn tất (hoặc break-glass ở trên) | `closeTrip` |

`PATCH /trip-schedules/:id/status` **đã bị gỡ**. `PATCH /trip-schedules/:id` nhận `status`
chỉ khi bằng trạng thái hiện tại (no-op — form sửa của Lịch sử chuyến gửi lại `finished`);
khác đi → 422 `STATUS_SET_BY_SERVER` (`finished` → 409, mở lại chuyến đã xong → 409,
`confirmed` → 422). Huỷ (void) mốc không đổi trạng thái: chuyến vẫn `executing` kể cả khi
mọi mốc đã bị huỷ. Tạo booking có yêu cầu hoàn tất mà không có mốc nào (mất sóng) vẫn
`pending` cho tới khi được duyệt.
Chuyến `finished` không còn là việc của ai: danh sách việc của tài xế và hàng chờ duyệt
loại nó; mọi thao tác ghi của tài xế từ chối chuyến đã đóng (kể cả sửa chi phí, `editCost`).

**Chuẩn hoá `confirmed` cũ** — không phải migration (migration chạy mỗi lần deploy):
`npm run trips:normalize-confirmed` mặc định là dry run trong transaction READ ONLY, phân
loại `ELIGIBLE` / `CONFLICT_PENDING_COMPLETION` / `CONFLICT_CLOSED_PARTIAL` /
`SKIPPED_ARCHIVED` (`domain/legacy-confirmed.ts`). Ghi cần `--apply --by <email> --ids
<id,…>` — người có `trip.complete.review`, đúng các id đã duyệt từ dry run; mỗi id một
transaction, kiểm lại dưới khoá, id không còn eligible được báo và để nguyên. Dấu đóng sẵn
có được giữ; thiếu thì ghi người chạy và lúc chạy; nửa dấu đóng không bao giờ bị ghép.
Không bịa event, request, notification; không kết thúc lượt xe; không đụng mốc thời gian.
Kiểm toán production trước khi deploy: `backend/scripts/legacy-confirmed-dry-run.sql` (chỉ đọc).

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

## Địa điểm của khách — Location Master (0022)

`trip_locations` là **địa điểm thuộc một khách hàng** (tên · địa chỉ · liên hệ ·
toạ độ *tuỳ chọn*), quản lý ngay trong danh mục Khách. Không có danh sách địa
điểm toàn công ty và không có route nào không mang `customerId`; tài xế không
đọc được danh mục này.

Điều độ **không nhập toạ độ trên chuyến**. Form chuyến chọn Khách → Điểm lấy →
Điểm giao; service **chụp** address/contact/lat-lng của địa điểm vào chính row
chuyến trong cùng transaction (`pickup_location_id` chỉ để truy vết). Sửa
địa điểm sau đó **không** đổi chuyến cũ; chuyến mới mới lấy giá trị mới.
Geofence vẫn đọc snapshot trên chuyến như trước — không đọc master. Địa điểm
chưa có toạ độ vẫn dùng được; tài xế bị từ chối `DESTINATION_MISSING` như cũ.
Địa điểm phải **cùng khách với chuyến**, kiểm ở server; gửi kèm toạ độ bên
cạnh một địa điểm bị từ chối (địa điểm là nguồn).

## Điều độ nhiều xe — ADR-0004

Một chuyến có **0..N** assignment; mỗi assignment là **một xe + một tài xế** trên
chính `trip_driver_assignments` (`0027` thêm `vehicle_id`). Cùng một tài xế được
giữ nhiều xe; một xe chỉ ở trên chuyến một lần khi còn active. Execution event,
chi phí và completion request **thuộc assignment** — chuyến chỉ *finished* khi
mọi assignment active đã được duyệt, quyết định trong chính transaction approve.

Ba điều dễ làm sai:

1. **Không bao giờ** thêm `UNIQUE(trip_id, driver_user_id)`. Test kiến trúc
   `tests/architecture/trip-write-paths.spec.ts` fail nếu migration nào thêm.
2. `trip_schedules.vehicle_id` là **legacy**: đọc để hiển thị, **không ghi**, không
   DROP. Cùng test kiến trúc cấm mọi write path chạm cột này.
3. *Started* là **có event chưa void** trên assignment — không có `started_at`.
   Đổi tài xế / gỡ chỉ trước lúc đó; sau đó cặp bất biến, không takeover.

Hai grain đọc, cố ý: `GET /trip-schedules` là **một dòng/trip** (crew gộp trong
`assignments[]`); `GET /trip-schedules/operational-board` là **một dòng/assignment
active** — Operations theo dõi từng xe đang chạy, không gộp về trip (ADR-0004 §2.3).

Thứ tự khoá luôn là **trip → assignment → request/cost**. Xem
[`docs/architecture/adr-0004-dispatch-assignment-multi-vehicle.md`](../../../../docs/architecture/adr-0004-dispatch-assignment-multi-vehicle.md)
để biết vì sao không có bảng mới, không có lineage và không có transfer.

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
application/trip-execution.service.ts   assign / replace / end theo assignment; requireNotStarted → 409
application/trip-completion.service.ts  approve / reject theo request; completeManually ("Đã xác nhận")
application/trip-closure.ts          closeTrip — đường duy nhất chuyển một chuyến sang finished
api/active-assignment.guard.ts          tài xế chỉ vào assignment của mình, theo :assignmentId
api/trip-schedule.security.spec.ts   61 case: ai được gì, trên từng route
domain/trip-board.ts                 thứ tự board, TripCostSummary, canSeeTripCosts
application/trip-board.service.ts    trang board + tổng chi phí cho người có cost.read
persistence/trip-board-order.ts      enum → ORDER BY cố định, luôn có tiebreaker id
persistence/trip-board-cost.repository.ts  tổng chi phí cả trang trong một câu
domain/trip-timeline.ts              giao sau lấy · ngày = ngày lấy hàng · lịch theo ý định
application/trip-entry-crew.ts       crew của chuyến sinh ra đã đóng: ghi rồi kết thúc, một transaction
application/dispatch-eligibility.ts  xe còn dùng · tài xế còn hoạt động — chung cho điều độ và nhập cũ
domain/legacy-confirmed.ts           phân loại confirmed cũ: ELIGIBLE / CONFLICT_* / SKIPPED_ARCHIVED
application/legacy-confirmed-normalization.ts  dry run + apply theo từng id đã duyệt
cli/normalize-legacy-confirmed.cli.ts  CLI (mặc định dry run); scripts/legacy-confirmed-dry-run.sql cho production
```
