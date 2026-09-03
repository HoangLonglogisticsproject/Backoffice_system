# Migrations

Chạy bằng `npm run migrate`. Runner: `src/infrastructure/database/migration-runner.ts`.

## Quy ước

```
0001_snake_case_description.sql
0002_...
```

Thứ tự là thứ tự sắp xếp tên file — nên số phải có padding.

## Ba ràng buộc

1. **Forward-only.** Không rollback script. Sửa sai bằng một migration mới.
2. **Idempotent hoặc có guard.** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`.
   Một migration vỡ khi chạy lần hai là một migration không chạy tự động được.
3. **Không seed dữ liệu nghiệp vụ.** Migration tạo cấu trúc. Phòng ban, vai trò,
   người dùng là dữ liệu do admin nhập lúc chạy — hardcode chúng vào migration là
   cách biến dữ liệu thành code.

Mỗi file chạy trong một transaction; hỏng thì rollback file đó và dừng.
`schema_migrations` do runner tự tạo, không phải bằng migration.

## Test runner trên PostgreSQL thật

`migration-runner.spec.ts` chạy bằng fake client — nó chứng minh runner gọi
BEGIN/COMMIT/ROLLBACK đúng thứ tự, nhưng không chứng minh được PostgreSQL có
tôn trọng thứ đó không. Ba thứ chỉ đúng khi một server thật nói vậy: DDL
rollback được, `pg_advisory_lock` thật sự tuần tự hoá hai kết nối, và file
hỏng không để lại vết trong ledger.

`migration-runner.integration.spec.ts` kiểm chứng cả ba, và **tự tắt** khi
không có biến dưới đây — nên nó sẽ skip trong im lặng nếu CI quên khai báo:

```bash
DATABASE_URL_TEST=postgres://user:pass@localhost:5432/backoffice_itest npm test
```

Database đó bị **XOÁ SCHEMA** giữa các case. Đừng trỏ vào database có dữ liệu.

Không có Docker? Bất kỳ PostgreSQL nào cũng được — `docker-compose.yml` chỉ là
đường tiện nhất, không phải đường duy nhất.

## Migration hiện có

| File | Owner | Nội dung |
|---|---|---|
| `0001_identity.sql` | core | users · identities · sessions |
| `0002_users_updated_at.sql` | core | `set_updated_at()` + trigger trên users |
| `0003_organization.sql` | core | departments · department_memberships · `uq_single_active_membership` |
| `0004_authorization.sql` | core | role_assignments · 2 partial unique index · FK invariant #6 |
| `0005_identity_credential_state.sql` | core | `identities.must_change_secret` |
| `0006_membership_change_requests.sql` | project | membership_change_requests · `uq_pending_membership_request` |
| `0007_account_invitations.sql` | project | account_invitations · `uq_pending_invitation_email` |
| `0008_role_assignment_membership_fk_index.sql` | core | partial index cho FK check của invariant #6 |
| `0009_list_pagination_indexes.sql` | core | 3 index keyset cho các list phòng ban (ADR-0002) |
| `0010_canonical_email_identity.sql` | core | email canonical: CHECK + unique index trên dạng đã chuẩn hoá |
| `0011_trip_schedule.sql` | project | trip_vehicles · trip_customers · trip_schedules · 2 unique index chuẩn hoá |
| `0012_trip_cost.sql` | project | trip_costs · trip_outsource_hires · 2 partial index · void-state CHECK |
| `0013_trip_carrier_and_vehicle_ownership.sql` | project | trip_carriers · `trip_vehicles.ownership` (**nullable, không default**) + `carrier_id` + provenance |
| `0014_trip_driver_assignment.sql` | project | trip_driver_assignments · partial unique 1 active/trip · UNIQUE `(id, trip_id)` cho composite FK |
| `0015_trip_execution_event.sql` | project | trip_execution_events · composite FK · idempotency `(trip_id, client_event_id)` |
| `0016_trip_cost_lifecycle.sql` | project | MỞ RỘNG `trip_costs`: `state`/`source`/snapshot/lock · trip_cost_edits · **trigger T2** |
| `0017_trip_completion_and_history.sql` | project | trip_completion_requests · trip_status_history · `closed_at`/`driver_instructions` · **trigger T1 + T3** |
| `0018_driver_account.sql` | project | `users.account_type` — tài khoản tài xế |
| `0019_trip_location.sql` | project | GAP-14: `pickup_*`/`delivery_*` lat/lng trên `trip_schedules` · bằng chứng vị trí + verdict geofence trên `trip_execution_events` · CHECK phạm vi + cặp đủ đôi |
| `0020_notifications.sql` | project | notifications: một dòng cho mỗi sự kiện nghiệp vụ tới một người nhận · unique `(recipient, event_key)` · T3 deny delete |

`0003` dùng lại hàm `set_updated_at()` mà `0002` tạo — hàm ở scope database, không
gắn với bảng nào, nên mọi bảng có `updated_at` đều gắn trigger vào nó được. `0011`
dùng lại đúng hàm đó cho cả ba bảng của nó.

## 0013–0017 · vòng đời vận hành

Năm file này dựng phần **vận hành** của chuyến: ai lái, chuyện gì đã xảy ra,
chuyến kết thúc thế nào. Ba điều đáng nhớ:

1. **`0013` cố ý KHÔNG backfill.** `trip_vehicles.ownership` là `NULL` cho mọi
   dòng sau khi chạy xong, và đó là trạng thái đích chứ không phải việc còn dở.
   `DEFAULT 'company'` sẽ là hệ thống tự bịa ra một đội xe; `'unknown'` sẽ là
   bịa ra một loại xe thứ ba mà nghiệp vụ không có. Việc phân loại thuộc một
   migration sau, dựa trên bằng chứng, và mỗi giá trị đều phải ghi **ai** khẳng
   định.
2. **`0016` mở rộng `trip_costs`, không tạo bảng expense thứ hai.** `state`
   mặc định `'immutable'` nên mọi dòng cũ và mọi dòng route `cost.create` hiện
   tại ghi vẫn giữ nguyên luật của `0012`. Vòng đời mới chỉ áp cho dòng do
   driver portal ghi.
3. **Ba trigger.** `T1` chặn `done → non-done`; `T2` chặn sửa dòng chi phí đã
   `immutable` (**trừ** bộ ba void — void không phải là sửa); `T3` chặn `DELETE`
   trên bảy bảng lịch sử. `T3` bổ sung răng cho ranh giới B13, thứ chỉ grep được
   source code.

Mỗi migration có một spec kiểm **hình dạng** file, chạy không cần database:
`migration-schema.spec.ts` cho `0001`, `organization-schema.spec.ts` cho `0003`,
`authorization-schema.spec.ts` cho `0004` và `0005`,
`trip-schedule-schema.spec.ts` cho `0011`,
`trip-operational-schema.spec.ts` cho `0013`–`0017`,
`trip-location-schema.spec.ts` cho `0019`,
`notification-schema.spec.ts` cho `0020`.
Chúng bắt đúng loại lỗi sống sót qua review rồi thành lỗ hổng: thiếu unique index,
cascade ăn mất lịch sử, seed dữ liệu nghiệp vụ.
