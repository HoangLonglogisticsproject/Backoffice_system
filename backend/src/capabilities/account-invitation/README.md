# `capabilities/account-invitation/`

## Trách nhiệm

Chính sách của Hoàng Long cho người **chưa có account**: HEAD mời bằng email,
SUPERADMIN duyệt, và chỉ lúc duyệt account mới tồn tại.

## Sở hữu

`account_invitations` (`0007`, project-owned) · luật ai được mời, ai được quyết.

## KHÔNG sở hữu

Việc tạo account. `AccountProvisioningService` của `core/users` làm việc đó và
được **gọi** với transaction của capability. Một implementation thứ hai sẽ là chỗ
thứ hai để email normalization, domain policy, password hashing và
`must_change_secret` lệch nhau.

## Entry points

| Endpoint | Guard | Ai |
|---|---|---|
| `POST /departments/:departmentId/account-invitations` | `HeadOfRouteDepartmentGuard` | HEAD phòng đó, hoặc GLOBAL |
| `GET /departments/:departmentId/account-invitations` | `HeadOfRouteDepartmentGuard` | như trên |
| `GET /account-invitations` | `user.write` | GLOBAL |
| `POST /account-invitations/:id/approve` · `/reject` | `user.write` | GLOBAL |

Duyệt cần `user.write` vì duyệt **là** tạo account.

## Flow

```text
HEAD A -> POST /departments/A/account-invitations { email }
       -> pending: KHONG user, KHONG identity, KHONG credential, KHONG membership
SUPERADMIN -> approve
       -> MOT transaction: users + identity + temporary credential + membership A
                           + invitation.approved (created_user_id)
       -> response mang temporaryPassword DUNG MOT LAN
```

Người mới vào **đúng phòng của HEAD đã mời**. Sau đó SUPERADMIN có thể chuyển họ
trực tiếp, hoặc HEAD đề xuất `TRANSFER_MEMBER`.

## Temporary password

CSPRNG · plaintext chỉ trong memory · hash vào `identities.secret_hash` ·
`must_change_secret = true` · trả về **một lần** ở response của approve · không
log · **không cột nào trong `account_invitations` chứa nó** · không endpoint nào
lấy lại được · approve lần hai = 409.

**Hạn chế đã biết:** plaintext xuất hiện ở người duyệt và browser của họ. Phase
này cố ý không có email adapter, nên đó là kênh giao duy nhất. Đây là MVP
provisioning trade-off, không phải security primitive của tầng authorization. Gỡ
được bằng email adapter + invitation token ở một phase riêng.

## Uniqueness — ba lớp, không lớp nào đủ một mình

| Lớp | Chặn gì |
|---|---|
| `UNIQUE (email) WHERE status='pending'` | hai invitation cùng email cùng lúc, **bất kể phòng nào** |
| Service kiểm `identities` | email đã có account (kể cả account đã disable) |
| `UNIQUE (provider, subject)` | race lọt qua hai lớp trên |

Index chỉ canh `pending`. Sau khi approve, thứ chặn là hai lớp còn lại — README
này nói rõ để không ai tưởng index làm hết.

## Transaction boundaries

```text
create   db.transaction: kiem department -> kiem identities -> kiem pending -> insert
approve  db.transaction: lockPending -> revalidate -> provision(tx) -> decide(tx)
reject   db.transaction: lockPending -> decide
```

Approve fail giữa chừng thì rollback toàn bộ, invitation **trở lại pending**,
không có account mồ côi.

## Failure modes

| Tình huống | Kết quả |
|---|---|
| Email đã có account (kể cả disabled) | 409 |
| Email ngoài `ALLOWED_EMAIL_DOMAINS` | 422 |
| Pending trùng email | 409 |
| Tự duyệt invitation của mình | 409 (+ CHECK ở DB) |
| Department bị archive trước khi duyệt | 409 |
| Requester mất HEAD trước khi duyệt | 409 |
| Account được tạo trực tiếp trước khi duyệt | 409, invitation vẫn pending |
| Hai người duyệt đồng thời | đúng một account |

## Tests

| File | Chứng minh | PostgreSQL |
|---|---|---|
| `api/account-invitation.security.spec.ts` | 28 test qua HTTP: 401/403 theo vai, IDOR chéo phòng, spoof body, và `temporaryPassword` **chỉ** có ở response của approve | không |
| `application/account-invitation.integration.spec.ts` | 18 test: 2 concurrency, 2 CHECK ở database, rollback không để lại account mồ côi | **có** |

Suite integration chiếm schema riêng `invitation_itest`. Đừng báo PASS khi nó
đang skip.

## Frontend integration contract

```text
HEAD        POST /departments/:departmentId/account-invitations
              { email, reason? }                                   → 201
            GET  /departments/:departmentId/account-invitations     ← chỉ phòng mình
SUPERADMIN  GET  /account-invitations                               ← hàng đợi toàn hệ thống
            POST /account-invitations/:id/approve { displayName? }  → 201
            POST /account-invitations/:id/reject                    → 200
```

Approve trả **201** trong khi reject trả 200: duyệt **tạo ra một account**, và mã
trạng thái nói đúng điều đó. Body của approve là tuỳ chọn — gọi không kèm body
vẫn hợp lệ.

### `temporaryPassword` — một lần, một chỗ

```json
{ "invitation": { "…": "…" }, "username": "a.person", "temporaryPassword": "…" }
```

Chỉ response của **approve** mang nó. Không có ở list, ở detail, ở `/auth/me`,
ở `/authorization/me`, và không cột nào lưu nó.

| Frontend PHẢI | Frontend KHÔNG ĐƯỢC |
|---|---|
| hiện nó ngay, một lần, kèm cảnh báo không lấy lại được | ghi vào `localStorage`/`sessionStorage` |
| để người duyệt copy rồi tự chuyển cho người mới | log ra console hoặc gửi sang analytics |
| coi việc rời màn hình là mất vĩnh viễn | đưa vào URL, query string hay title |

Approve lần hai → **409**, và response 409 đó **không** chứa password. Mất rồi thì
đường duy nhất là SUPERADMIN đặt lại credential, không có endpoint "xem lại".

### Những thứ khác

`email` là **định danh đăng nhập duy nhất**; `username` do server suy ra từ local
part — frontend hiển thị cái server trả, không tự tách.

| Tình huống | Mã | UI nên nói |
|---|---|---|
| email đã có account (kể cả disabled) | 409 | "địa chỉ này đã thuộc về một tài khoản" |
| email ngoài domain được phép | 422 | lấy `details` để chỉ đúng field |
| đã có invitation pending cho email đó | 409 | "đang chờ duyệt" — kể cả khi do phòng khác mời |

HEAD **không** có đường tạo account trực tiếp: `POST /users` là GLOBAL-only. Nếu
UI của HEAD có nút "tạo nhân sự", nó phải trỏ vào invitation.
