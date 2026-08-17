# `capabilities/` — module nghiệp vụ, tuỳ chọn

Rỗng có chủ đích. **Một deployment với 0 capability là một deployment hợp lệ** —
foundation phải tự nó dùng được, nếu không thì nó không phải foundation.

Mỗi project cài những capability nó cần:

```
Project A   foundation + <capability của A>
Project B   foundation + <capability của B>
```

## Một capability sở hữu gì

| Ở code | Ở database |
|---|---|
| definition · permission · migration · module · API | **chỉ** enablement + configuration |

- Bảng riêng, đặt tiền tố theo key: `<key>_*`
- Capability A **không** đọc/ghi bảng của capability B. Cần giao tiếp thì qua
  application service contract hoặc domain event trong cùng process.
- Modular monolith. Không microservice.

## Luật

- Được import contract từ `core/`. **Không** sửa bảng của core.
- `core/` không bao giờ biết capability nào tồn tại.
- Tắt một capability: API ngừng phục vụ, **dữ liệu giữ nguyên**. Xoá dữ liệu là
  hành động riêng, có chủ đích.
