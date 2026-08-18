# `core/users/` — con người, tách khỏi cách họ đăng nhập

## Trách nhiệm

Row `users`: danh tính bền vững mà mọi thứ khác trỏ vào. Cố ý mỏng — tên và
trạng thái, không hơn.

## Sở hữu

`users` · vòng đời `active`/`disabled` · **hai transaction xuyên context**:
provisioning (tạo account) và disable (offboarding).

## Không sở hữu

`identities` — thuộc `core/identity/persistence/identity.repository.ts`. Trước đây
nằm ở đây, và đúng lúc context này cần authorization thì nó khép thành cycle ba
node `users → authorization → identity → users`. Tách bảng theo đúng ownership đã
ghi trong tài liệu là thứ gỡ cycle, thay vì dán `forwardRef` lên.

Cũng không sở hữu: role, department, membership, session. **Không có** cột `email`
hay `username` trên `users` — username là giá trị dẫn xuất từ email.

## Layer

```text
api/          UsersController — POST /users · PATCH /users/:id/status
application/  AccountProvisioningService · AccountLifecycleService · UserService
domain/       user.entity · email.ts (normalize · shape · domain allowlist)
persistence/  UserRepository — chỉ bảng `users`
cli/          create-user.cli — entry point dòng lệnh, không phải HTTP
```

## Entry points

| Endpoint | Permission | Ai |
|---|---|---|
| `POST /users` | `user.write` | GLOBAL |
| `PATCH /users/:userId/status` | `user.write` | GLOBAL |

`user.write` không có scope theo department, nên HEAD **không** với tới được. Một
HEAD tạo được account là một HEAD tạo được account cho chính mình.

`PATCH status` chỉ nhận `disabled` ở phase này. Bật lại một account đòi trả lời
"vào phòng nào" trong cùng hành động, vì active mà không có phòng là trạng thái bị
cấm — câu đó chưa được quyết, nên schema không hứa.

## Transaction rules

**Provisioning** — `AccountProvisioningService.provision(input, tx?)`:

```text
users -> identities (must_change_secret=true) -> department_memberships
```

Một commit hoặc không commit gì. Nhận `tx` tuỳ chọn vì có **hai** caller:
`POST /users`, và approve invitation (Phase 5) cần đóng invitation trong cùng
transaction. Không có implementation tạo account thứ hai ở đâu khác.

**Disable** — `AccountLifecycleService.disable(input, tx?)`, năm bước:

```text
kiểm invariant #7 -> revoke roles -> status=disabled -> revoke sessions -> end membership
```

Thứ tự revoke-roles **trước** end-membership do FK invariant #6 ép: kết thúc
membership khi assignment còn active bị database từ chối. Cũng nhận `tx` vì approve
`REMOVE_MEMBER` gọi lại chính nó.

## CLI và ranh giới B2

`create-user.cli.ts` chỉ orchestrate: parse argv → đọc secret qua port → gọi
`UserService` → in kết quả. Nó **không** import `infrastructure/` (B2 cấm) — việc
đọc mật khẩu từ terminal đi qua port `SECRET_READER` (`common/types/`), và
`infrastructure/tty` là adapter. Mật khẩu không bao giờ đến từ argv: `ps` nhìn
thấy argv và shell history giữ lại nó.

## Failure modes

| Tình huống | Kết quả |
|---|---|
| Identity đã tồn tại | `ConflictError`, **không** echo lại email — nếu không endpoint thành công cụ dò account |
| Mật khẩu không đạt policy | `ValidationError` trước khi chạm database |
| Race qua pre-check | unique index thắng, `23505` → cùng `ConflictError` |

## Test

| File | Chứng minh |
|---|---|
| `application/user.service.spec.ts` | luật: hash chứ không lưu password, normalize subject, thứ tự kiểm tra |
| `persistence/user.repository.spec.ts` | dịch `23505` thành conflict, và không nuốt lỗi khác |
| `../../infrastructure/tty/hidden-line-reader.spec.ts` | parser escape sequence của terminal |
