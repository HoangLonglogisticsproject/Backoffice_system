# Backend ↔ AI internal contracts

**Loại:** REFERENCE · **Trạng thái:** đang áp dụng cho Phase 1a; §10 là ranh giới cho Phase 1b, chưa implement.
**Nguồn quyết định:** [ADR-0007](../architecture/adr-0007-ai-platform-boundary.md).

Hợp đồng duy nhất giữa `/backend` và `/AI`. Hai bên không chia sẻ source; mọi kiểu dữ liệu được khai báo hai lần và mỗi bên có spec pin đúng hình dạng này.

---

## 1. Service direction

```
Frontend ──cookie──▶ Backend ──Bearer(SERVICE_TOKEN_BACKEND_TO_AI) + signed context──▶ AI  /internal/v1/alerts*
AI (Phase 1b) ──Bearer(SERVICE_TOKEN_AI_TO_BACKEND)──▶ Backend /internal/v1/read-models/*   (chưa có)
```
Frontend không bao giờ gọi AI. AI không bao giờ gọi endpoint mutation nào của backend.

## 2. Trust model

| Lớp | Ai quyết | Cơ chế |
|---|---|---|
| Human authorization | Backend | `AuthGuard` + `CsrfGuard` + `@RequirePermission` — trước khi gọi AI |
| Service authentication | Mỗi bên tự verify | Bearer secret **theo chiều**, so sánh constant-time trên SHA-256 digest; secret rỗng = đóng |
| Trusted user context | Backend ký, AI verify | HMAC-SHA256 với secret thứ ba; AI không tính lại permission |

Không dùng header `X-User-Role` / `X-User-Scope` không chữ ký làm boundary.

## 3. Internal namespace

Mọi route service-to-service nằm dưới `/internal/v1/…` ở cả hai bên. `v1` là bắt buộc; thay đổi phá vỡ contract = `v2` mới, không sửa `v1`. Reverse proxy trả **404** cho `/api/internal/` trên mọi host public (Phase 1b, khi backend có route internal đầu tiên). AI không publish port ra host.

## 4. Service authentication

Header: `Authorization: Bearer <secret>`.

| Chiều | Secret (tên biến môi trường) | Ai giữ |
|---|---|---|
| Backend → AI | `SERVICE_TOKEN_BACKEND_TO_AI` | backend (gửi), AI (verify) |
| AI → Backend | `SERVICE_TOKEN_AI_TO_BACKEND` | AI (gửi, Phase 1b), backend (verify) |

Ràng buộc: ≥ 32 ký tự, sinh bằng generator, không commit, không log, không xuất hiện trong error. Sai/thiếu → `401 { error: { code: 'UNAUTHORIZED', message: 'Service authentication required.' } }` — một message cho mọi trường hợp. Phía backend biến này **optional với mặc định rỗng** (chưa có route internal), rỗng nghĩa là guard từ chối tất cả. Phía AI **bắt buộc** để boot.

## 5. Trusted user context

Kèm mọi lifecycle action của người dùng (`POST …/transitions`, trường `context`).

```
v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256(TRUSTED_CONTEXT_SECRET, "v1." + payloadB64))>

payload = {
  sub:   uuid            // backend user id — AI ghi làm actor, không tra cứu
  perms: string[]        // PermissionKey backend đã cấp — token mờ với AI (Phase 2 dùng pre-filter)
  fn:    string[]        // DepartmentFunction của người gọi — token mờ với AI
  aud:   'ai'
  iat:   number          // giây epoch
  exp:   number          // giây epoch; mặc định iat + 60
  cid:   string          // correlation id của request gốc
}
```
**Bản chất:** KHÔNG phải user session token. Là *short-lived signed delegation context*, chỉ được tạo SAU KHI backend đã (1) authenticate session và (2) authorize `PermissionKey` tương ứng cho action đó. AI không dùng nó để chạy lại business authorization — chỉ ghi `sub` làm actor, `cid` làm correlation.

AI verify, theo thứ tự: chữ ký (constant-time, so độ dài trước) → shape → `aud === 'ai'` → cửa sổ thời gian:

| Điều kiện | Hằng số |
|---|---|
| `iat ≤ now + skew` (không đến từ tương lai) | skew = **30 s** |
| `exp > now − skew` (chưa hết hạn, tha thứ lệch giờ) | |
| `iat ≤ exp` | |
| `exp − iat ≤ maxTtl` (token tự khai sống ngắn, bất kể ai ký) | maxTtl = **60 s** |

Signer phát hành TTL **60 s** (= maxTtl) và từ chối TTL ≤ 0 hoặc > 60 s. Skew 30 s là dung sai đồng hồ giữa hai host, KHÔNG phải quyền phát hành token sống lâu hơn: một token bình thường được chấp nhận tối đa 60 s đời sống khai báo + 30 s lệch giờ. Mọi thất bại → `401 { error: { code: 'INVALID_TRUSTED_CONTEXT' } }` cùng một message, verify **trước** khi tra alert. Backend: `TrustedContextSigner.issue()` (`backend/src/infrastructure/service-auth/trusted-context.signer.ts`), từ chối ký khi secret rỗng. Không phải JWT, không phải session, không đăng nhập được ai. Không log token, chữ ký, secret hay payload.

## 6. Error envelope

Giống backend, để gateway forward nguyên vẹn:
```json
{ "error": { "code": "…", "message": "…", "details": { "field": "why" } } }
```

| code | HTTP |
|---|---|
| `UNAUTHORIZED` | 401 |
| `INVALID_TRUSTED_CONTEXT` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` | 409 |
| `INVALID_ALERT_TRANSITION` | 409 |
| `VALIDATION_FAILED` (có `details`) | 422 |

## 7. Pagination

Keyset (ADR-0002), hình dạng `{ items, nextCursor: string | null, hasMore }`, `limit` mặc định 50, tối đa 200, `cursor` mờ (base64url của `{ t, i }` với `t` là `timestamp::text` đầy đủ microsecond). Cursor sai định dạng → 422, không bao giờ âm thầm về trang đầu. Alert list sắp theo `(last_seen_at DESC, id DESC)`.

## 8. Correlation id

Header `X-Correlation-Id` truyền xuyên suốt. Với transition: header nếu có, nếu không lấy `cid` trong context. Ghi vào `alert_transition_history.correlation_id` và (Phase 1b) `scan_runs.correlation_id` và log.

## 9. Internal AI Alert API (Phase 1a — đã implement)

Base: AI service, `Authorization: Bearer SERVICE_TOKEN_BACKEND_TO_AI` trên **mọi** route.

| Method & path | Query / body | Trả về |
|---|---|---|
| `GET /internal/v1/alerts` | `status` (CSV, mặc định `open,acknowledged`), `severity` (CSV), `detectorCode`, `tripId` (uuid), `limit`, `cursor` | `Page<Alert>` |
| `GET /internal/v1/alerts/summary` | — | `{ open, acknowledged, dismissed, bySeverity: { info, warning, high, critical } }` (chỉ incident live) |
| `GET /internal/v1/alerts/:alertId` | — | `{ alert, history[] }` · 404 · 422 nếu id sai |
| `POST /internal/v1/alerts/:alertId/transitions` | `{ to: 'acknowledged' \| 'dismissed' \| 'resolved', reason?: string(≤1000), context: string }` | `{ alert, history[] }` · 409 sai transition · 422 dismiss không reason · 401 context sai |
| `GET /health` (không auth) | — | `{ status: 'ok' \| 'degraded', uptimeSeconds, environment, checks: { database } }`, 503 khi DB down |

`Alert` = các trường của `ai.alerts` dạng camelCase (`id, detectorCode, detectorVersion, sourceType, subjectType, subjectId, tripId, severity, status, title, summary, evidence, evidenceVersion, dedupeKey, firstSeenAt, lastSeenAt, occurrenceCount, acknowledgedAt/By, dismissedAt/By/Reason, resolvedAt/By, resolutionKind, firstScanRunId, lastScanRunId, resolvedScanRunId, confidence, createdAt, updatedAt`). `history[]` = `{ id, alertId, fromStatus, toStatus, actorType: 'user' \| 'system', actorId, reason, scanRunId, correlationId, createdAt }`, cũ nhất trước. Actor chỉ là UUID: backend join `UserSummary` khi trả ra frontend (ADR-0001).

Không có route tạo alert. Không có route system-resolve — đường system là application-internal (`AlertService.resolveBySystem`).

**`occurrence_count`** = số **scan run khác nhau** đã quan sát incident, không phải số lần upsert. Insert đầu = 1; cùng `scan_run_id` (retry, duplicate, worker song song) → không tăng; `scan_run_id` khác → +1 và `lastScanRunId` đổi; quan sát không có run (`null`) → không tăng, không đổi `lastScanRunId`. Quyết định trong SQL (`ON CONFLICT … DO UPDATE`), an toàn concurrency.

## 10. Backend read-model boundary (Phase 1b — CHƯA implement, chỉ nguyên tắc)

**Backend read models sở hữu CANONICAL FACTS. AI sở hữu ALERT POLICY.**

| Backend trả (facts) | AI quyết (policy) |
|---|---|
| trip `status`, `archived`, `pickupAt`, `deliveryAt`, `scheduledOn`, `activeAssignmentCount` | ngưỡng warning/high |
| assignment `state`, `assignedAt`, `endedAt`, `hasLiveEvents` (tính bằng đúng predicate `hasLiveEvents()` của backend), `latestCompletionState` | "fact này có phải alert không" |
| completion `state`, `attemptNo`, `submittedAt`, `decidedAt` | severity mapping |
| | exclusion riêng của detector |
| | quyết định active / clear cuối cùng |

Backend **được** lọc thô vì hiệu năng: cửa sổ thời gian kỹ thuật (`pickupBefore`, `submittedBefore`), thu hẹp trạng thái canonical (`state=active`), pagination, predicate factual ổn định. Backend **không được** chứa predicate alert hoàn chỉnh, threshold hay severity.

Hình dạng dự kiến (sẽ chốt ở Phase 1b, không phải hợp đồng hôm nay): `GET /internal/v1/read-models/dispatch/{unassigned-trips | unstarted-assignments | pending-completions}` (keyset, ≤ 200) và `POST /internal/v1/read-models/dispatch/subjects:lookup` (≤ 200 id, trả cả archived/finished) cho Resolution theo id. Guard: `ServiceAuthGuard` phía backend (`backend/src/infrastructure/service-auth/service-auth.guard.ts`, đã có, chưa gắn route).
