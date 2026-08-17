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

Rỗng ở Phase 0: chưa có bảng nghiệp vụ nào.
