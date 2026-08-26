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

`0003` dùng lại hàm `set_updated_at()` mà `0002` tạo — hàm ở scope database, không
gắn với bảng nào, nên mọi bảng có `updated_at` đều gắn trigger vào nó được. `0011`
dùng lại đúng hàm đó cho cả ba bảng của nó.

Mỗi migration có một spec kiểm **hình dạng** file, chạy không cần database:
`migration-schema.spec.ts` cho `0001`, `organization-schema.spec.ts` cho `0003`,
`authorization-schema.spec.ts` cho `0004` và `0005`,
`trip-schedule-schema.spec.ts` cho `0011`.
Chúng bắt đúng loại lỗi sống sót qua review rồi thành lỗ hổng: thiếu unique index,
cascade ăn mất lịch sử, seed dữ liệu nghiệp vụ.
