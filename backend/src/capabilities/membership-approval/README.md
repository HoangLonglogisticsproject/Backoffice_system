# `capabilities/membership-approval/`

## Trách nhiệm

Chính sách của Hoàng Long: **HEAD đề xuất, SUPERADMIN quyết**. Hai hành động,
không có hành động thứ ba.

| Action | Nghĩa |
|---|---|
| `TRANSFER_MEMBER` | chuyển người sang phòng khác |
| `REMOVE_MEMBER` | **loại khỏi tổ chức** — không phải chỉ gỡ khỏi phòng |

**Không có `ADD_MEMBER`.** Một người active luôn thuộc đúng một phòng, nên không
tồn tại trạng thái để "thêm vào phòng" có nghĩa. Người mới đi qua
`account-invitation`.

## Sở hữu

`membership_change_requests` (`0006`, project-owned) · luật ai được đề xuất, ai
được quyết · việc kiểm lại thế giới lúc quyết định.

## KHÔNG sở hữu

Việc chuyển phòng và việc offboard. Cả hai đã có trong core và được **gọi**, không
viết lại — xem `capabilities/README.md`.

## Entry points

| Endpoint | Guard | Ai |
|---|---|---|
| `POST /departments/:departmentId/membership-requests` | `HeadOfRouteDepartmentGuard` | HEAD của phòng đó, hoặc GLOBAL |
| `GET /departments/:departmentId/membership-requests` | `HeadOfRouteDepartmentGuard` | như trên |
| `GET /membership-requests` | `unit.member.write` | GLOBAL |
| `POST /membership-requests/:id/approve` · `/reject` | `unit.member.write` | GLOBAL |

HEAD không có `unit.member.write`, nên **không quyết được gì**, kể cả request của
chính mình. Hai lớp độc lập nói điều đó: permission, và CHECK
`decided_by <> requested_by` ở database.

## Ba giá trị, ba nguồn

| Giá trị | Đến từ |
|---|---|
| route department | **route param** — scope của HEAD |
| source department | **DATABASE** — active membership của target |
| target department | **body** `targetDepartmentId` |

Source không bao giờ lấy từ client. Gộp source vào route sẽ hỏng khi HEAD B kéo
người từ phòng A về B: route là B, source là A.

## Transaction boundaries

```text
create   db.transaction: đọc target → đọc membership (= source) → check duplicate → insert
approve  db.transaction: lockPending → revalidate → core.transfer | core.disable → decide
reject   db.transaction: lockPending → decide
```

Approve mở transaction rồi truyền `tx` xuống core. Quyết định và hiệu lực của nó
là **một commit**.

## Vì sao phải revalidate lúc approve

Request tạo thứ Hai có thể được duyệt thứ Sáu. Trong khoảng đó target có thể đã
chuyển phòng, đã bị disable, hoặc requester đã thôi làm HEAD. Tin vào giá trị lúc
tạo nghĩa là chuyển nhầm người, ra khỏi nhầm chỗ, theo thẩm quyền của người không
còn thẩm quyền. Nên mọi giá trị được **đọc lại trong transaction đang quyết**.

## Failure modes

| Tình huống | Kết quả |
|---|---|
| Target không thuộc phòng HEAD quản lý | 409 |
| Transfer không kèm đích, hoặc đích trùng nguồn | 409 (+ CHECK ở DB) |
| Duplicate pending | 409 (partial unique index) |
| Tự duyệt request của mình | 409 (+ CHECK ở DB) |
| Target đã chuyển phòng trước khi duyệt | 409 |
| Requester mất role HEAD trước khi duyệt | 409 |
| Đích bị archive trước khi duyệt | 409 |
| Hai người duyệt đồng thời | đúng một thắng (`FOR UPDATE` + rowcount) |

## Tests

| File | Chứng minh | PostgreSQL |
|---|---|---|
| `api/membership-request.security.spec.ts` | 28 test qua HTTP: 401/403 theo vai, IDOR chéo phòng, spoof body, 409 lifecycle, CSRF | không |
| `application/membership-request.integration.spec.ts` | 20 test: 2 concurrency, 3 CHECK ở tầng database, offboarding thật | **có** |

Suite integration chiếm schema riêng `approval_itest`. Đừng báo PASS khi nó đang
skip.

## Frontend integration contract

Hai màn hình, hai vai, không dùng chung:

```text
HEAD        POST /departments/:departmentId/membership-requests
              { action, targetUserId, targetDepartmentId? }
            GET  /departments/:departmentId/membership-requests   ← chỉ phòng mình
SUPERADMIN  GET  /membership-requests                             ← hàng đợi toàn hệ thống
            POST /membership-requests/:id/approve  → 200
            POST /membership-requests/:id/reject   → 200
```

| Frontend KHÔNG làm | Chuyện gì xảy ra nếu cứ làm |
|---|---|
| gửi `action: 'ADD_MEMBER'` | **422** — chỉ tồn tại `TRANSFER_MEMBER` và `REMOVE_MEMBER` |
| gửi `sourceDepartmentId` | bị bỏ qua; nguồn đọc từ database |
| cho HEAD thấy nút approve | HEAD gọi vào sẽ nhận **403**, kể cả với request của chính mình |
| gọi `REMOVE_MEMBER` là "gỡ khỏi phòng" | nó là **offboarding**: account bị disable, session bị huỷ, role bị thu hồi. Copy trên UI phải nói đúng điều đó |
| dùng danh sách đã tải để quyết định | request có thể đã bị người khác quyết → **409**, phải tải lại |

Approve trả **200** (không phải 201): không có resource nào được tạo, một
membership được chuyển hoặc một account bị đóng.

Mọi 409 ở đây đều có nghĩa "thế giới đã đổi từ lúc bạn mở màn hình này". Hành vi
đúng của UI là nạp lại hàng đợi rồi hiện trạng thái mới, không phải thử lại.
