# `core/` — Backoffice Foundation

Thứ **mọi** Backoffice cần, không phụ thuộc doanh nghiệp nào.

```
core/
├── identity/        ai đang gọi · login · session · CSRF · throttle
└── users/           user và credential của họ
```

Đúng hai thư mục, và đó là toàn bộ những gì tồn tại hôm nay. Danh sách này mô tả
source, không mô tả kế hoạch — một README liệt kê module chưa viết như thể đã có
là README khiến người đọc đi tìm thứ không tồn tại.

## Ba luật

**1. `core/` không bao giờ import `capabilities/`.**
Chiều ngược lại thì được. Core mà biết tên một capability là core đã hỏng.

**2. `core/` không bao giờ import `infrastructure/`.**
Core định nghĩa **port** (interface); `infrastructure/` viết **adapter**; `app.module.ts`
đấu dây. Nếu `core/identity` import `infrastructure/auth`, thì đổi từ mật khẩu sang
OIDC phải mổ vào foundation — đúng thứ ranh giới này sinh ra để ngăn.

**3. Không từ vựng nghiệp vụ.**
Không customer, order, product, invoice, shipment. Không tên phòng ban. Không tên
vai trò của một công ty cụ thể. Những thứ đó là dữ liệu hoặc capability.

## Chưa có ở đây

Phân quyền, đơn vị tổ chức, vai trò, quyền hạn, audit. Chúng không bị bỏ quên —
chúng chưa được yêu cầu, và foundation phải trả lời được "ai đang gọi" mà không
cần bất kỳ thứ nào trong số đó.

Khi một trong chúng xuất hiện, nó là một thư mục mới ở đây, và ba luật trên áp
dụng cho nó y như với `identity/`.
