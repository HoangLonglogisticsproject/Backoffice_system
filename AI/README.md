# AI Platform — `/AI`

Ứng dụng riêng bên cạnh `/backend` và `/frontend` (ADR-0007).

**Phase 1a** — nền tảng Alert: schema `ai`, migration runner riêng, Alert aggregate +
lifecycle + history + dedupe, service-to-service auth, internal Alert API, `/health`.

**Phase 1b** — scan engine: 3 deterministic detector (D1 chuyến chưa có xe, D2 xe đã
điều chưa khởi hành, D3 yêu cầu hoàn tất chờ duyệt quá lâu), discovery/resolution tách
đôi, advisory lock theo (detector, phase), scan_runs lifecycle, backend read-model client.

**Chưa có:** frontend Alert UI, alert PermissionKey, RAG, pgvector, LLM.

NestJS 11 · PostgreSQL 17 · `pg` (không ORM) · zod · jest — cùng phiên bản với backend.

## Ranh giới

- Không import `backend/src` hay `frontend/src` (`npm run check`, rule A1/A2).
- Không FK, không SELECT vào `public.*`: dữ liệu vận hành đến qua read API của backend
  (Phase 1b). Runtime chạy bằng `ai_app`, role không có quyền nào trên `public`.
- Không DELETE ở runtime. Retention là năng lực riêng với role `ai_maintenance`.
- Frontend không bao giờ gọi AI. Backend là authority về quyền của người dùng; AI chỉ
  verify chữ ký trusted context.

## Chạy

```bash
cp .env.example .env            # điền 2 secret ≥ 32 ký tự
npm install
npm run migrate                 # tạo schema ai (dev: superuser cục bộ của backend)
npm run dev                     # :3100
```

Kiểm tra: `npm run check` · `npm run typecheck` · `npm run build` · `npm test` ·
`ALLOW_DESTRUCTIVE_DB_TESTS=1 DATABASE_URL_TEST=postgres://backoffice@localhost:5432/backoffice_itest npm run test:integration`

## Database roles (production)

`scripts/provision-ai-roles.sql` (một lần, DBA, superuser) → `npm run migrate` bằng
`ai_migrator` → `scripts/provision-ai-grants.sql`. Integration suite `privileges` chứng
minh boundary bằng chính hai script này.

| Role | Dùng cho | Có | Không |
|---|---|---|---|
| `ai_migrator` | `npm run migrate` | owner schema `ai` | runtime, cleanup |
| `ai_app` | runtime | SELECT/INSERT/UPDATE `ai.*` | DELETE, DDL, ledger, `public.*` |
| `ai_maintenance` | retention (Phase 1b) | SELECT/DELETE trên 3 bảng được duyệt | INSERT, DDL, ledger, `public.*` |

## Detector & cấu hình

| Detector | Anchor | Đã duyệt | CHƯA duyệt |
|---|---|---|---|
| `UNASSIGNED_TRIP_APPROACHING_EXECUTION` | `pickup_at` | warning 2h trước pickup | ngưỡng HIGH |
| `STALE_ASSIGNMENT_START` | `pickup_at` | — | **grace** → **detector TẮT** cho tới khi được chốt |
| `COMPLETION_REVIEW_OVERDUE` | `submitted_at` | warning sau 12h | ngưỡng HIGH |

★ Giá trị chưa duyệt **không có mặc định**. Thiếu ngưỡng HIGH → chỉ phát `warning`;
thiếu grace của D2 → D2 tắt (zero không phải mặc định); thiếu `SCAN_INTERVAL` →
scheduler không arm, Alert API vẫn phục vụ. Xem `.env.example`.

**Discovery ≠ Resolution:** discovery quét window và chỉ nâng alert; resolution liệt kê
alert đang sống, lookup theo id, và chỉ đóng khi facts nhận được nói điều kiện đã hết.
Scan lỗi/partial/timeout/id vắng mặt → **không đóng gì**.

## API nội bộ

`GET /internal/v1/alerts` · `GET /internal/v1/alerts/summary` · `GET /internal/v1/alerts/:id` ·
`POST /internal/v1/alerts/:id/transitions` — Bearer `SERVICE_TOKEN_BACKEND_TO_AI`;
transition kèm `context` ký HMAC. Hợp đồng đầy đủ: `docs/backend/ai-internal-contracts.md`.
