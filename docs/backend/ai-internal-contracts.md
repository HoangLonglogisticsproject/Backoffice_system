# Backend ↔ AI internal contracts

**Loại:** REFERENCE · **Trạng thái:** đang áp dụng cho Phase 1a và 1b (read models, scan engine, 3 detector).
**Nguồn quyết định:** [ADR-0007](../architecture/adr-0007-ai-platform-boundary.md).

Hợp đồng duy nhất giữa `/backend` và `/AI`. Hai bên không chia sẻ source; mọi kiểu dữ liệu được khai báo hai lần và mỗi bên có spec pin đúng hình dạng này.

---

## 1. Service direction

```
Frontend ──cookie──▶ Backend ──Bearer(SERVICE_TOKEN_BACKEND_TO_AI) + signed context──▶ AI  /internal/v1/alerts*
AI ──Bearer(SERVICE_TOKEN_AI_TO_BACKEND)──▶ Backend /internal/v1/read-models/dispatch/*
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

Mọi route service-to-service nằm dưới `/internal/v1/…` ở cả hai bên. `v1` là bắt buộc; thay đổi phá vỡ contract = `v2` mới, không sửa `v1`. Reverse proxy trả **404** cho `/api/internal/` trên mọi host public — đã cấu hình ở cả `deploy/nginx.conf` và `deploy/nginx-bo-api.conf` (`location ^~ /api/internal/ { return 404; }`). AI không publish port ra host.

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

**`occurrence_count`** = số **scan run khác nhau** đã quan sát incident, không phải số lần upsert — được PostgreSQL bảo đảm bằng khoá chính `ai.alert_scan_observations (alert_id, scan_run_id)`. Insert đầu = 1; cùng run (retry, duplicate, worker song song) → không tăng; run khác → +1; **A, B, A → 2** (retry trễ của A vẫn là A); A, B, A, B → 2; hai run khác nhau chạy đồng thời → mỗi run đúng một lần; `lastScanRunId` = run thấy incident gần nhất. Quan sát không có run (`null`) → không ghi observation, không tăng, không đổi `lastScanRunId`. Không có SELECT-rồi-quyết-định ở service.

**System resolution** (`AlertService.resolveBySystem`, application-internal, không có HTTP route): bắt buộc `scanRunId`; trong cùng transaction phải có run tồn tại, `phase='resolution'`, `outcome='succeeded'`, `detector_code` trùng alert, và alert đang ở trạng thái cho phép system resolve. Sai bất kỳ điều nào → không đổi alert, không ghi history (`409 CONFLICT` / `INVALID_ALERT_TRANSITION` / `422`). Actor `system` bị từ chối ở cửa `transition()` của người dùng.

## 10. Backend read-model API (Phase 1b — đã implement)

**Nguyên tắc:** Backend read models sở hữu **CANONICAL FACTS**. AI sở hữu **ALERT POLICY**.

| Backend trả (facts) | AI quyết (policy) |
|---|---|
| trip `status`, `archived`, `pickupAt`, `deliveryAt`, `scheduledOn`, `activeAssignmentCount` | ngưỡng warning/high |
| assignment `state`, `assignedAt`, `endedAt`, `hasLiveEvents`, `latestCompletionState` | "fact này có phải alert không" |
| completion `state`, `attemptNo`, `submittedAt`, `decidedAt` | severity mapping, exclusion riêng của detector, quyết định active/clear |

Backend **được** lọc thô vì hiệu năng: cửa sổ thời gian kỹ thuật (`before`), thu hẹp trạng thái canonical (`archived IS NULL`, `status <> 'finished'`, `state = 'active'`, `voided_at IS NULL`, `state = 'pending'`), pagination. Backend **không** chứa threshold, severity hay predicate alert hoàn chỉnh — integration spec khẳng định điều này bằng các case "REPORTS … — the exclusion is the AI's rule".

Base: backend, `Authorization: Bearer SERVICE_TOKEN_AI_TO_BACKEND` trên **mọi** route. Không session, không CSRF, không `PermissionGuard`.

| Method & path | Query / body | Trả về |
|---|---|---|
| `GET /internal/v1/read-models/dispatch/unassigned-trips` | `before` (ISO instant, bắt buộc), `limit` (≤200, mặc định 50), `cursor` | `Page<TripFacts>` — trip live, `pickup_at IS NOT NULL`, `pickup_at <= before`, không có active assignment; sắp `(pickup_at, id)` tăng dần |
| `GET …/unstarted-assignments` | như trên | `Page<AssignmentFacts>` — assignment `active`, trip live, `pickup_at <= before`, không có execution event non-void |
| `GET …/pending-completions` | như trên | `Page<CompletionRequestFacts>` — request `pending`, `submitted_at <= before` |
| `POST …/subjects/lookup` | `{ tripIds?, assignmentIds?, completionRequestIds? }` (uuid[], tổng ≤ 200 sau khi dedupe) | `{ trips, assignments, completionRequests }` |

`TripFacts` = `{ tripId, scheduledOn, pickupAt, deliveryAt, status, archived, activeAssignmentCount, customer }`.
`AssignmentFacts` = `{ assignmentId, tripId, driverUserId, vehicleId, vehiclePlate, state, assignedAt, endedAt, hasLiveEvents, latestCompletionState, trip }`.
`CompletionRequestFacts` = `{ requestId, assignmentId, tripId, attemptNo, state, submittedAt, decidedAt, trip }`.

★ **`lookup` KHÔNG lọc gì cả** — archived, finished, ended, approved đều trả về kèm trạng thái. Đây là điều kiện để Resolution kết luận "điều kiện đã hết" từ **facts nhận được**, không bao giờ từ việc một id vắng mặt khỏi danh sách đã lọc. Id không tồn tại thì vắng mặt; AI coi đó là **không xác minh được** và **giữ alert**.

★ **Refused, not truncated:** lookup quá 200 id → `422`, không cắt bớt. Một lookup bị cắt sẽ khiến AI nhầm "không trả về" thành "không tồn tại".

## 11. Scan engine (Phase 1b — đã implement, phía AI)

**Discovery ≠ Resolution.** Discovery quét candidate window, đánh giá rule, upsert positives; **không bao giờ** resolve. Vắng mặt khỏi window không chứng minh điều gì. Resolution liệt kê alert đang `open|acknowledged|dismissed` của detector, lookup **theo id**, đánh giá lại, và chỉ resolve khi facts nhận được nói điều kiện đã hết.

| Tình huống | Kết quả |
|---|---|
| timeout / 5xx / 401 / body sai contract | `ReadModelError` → run `partial` → **không resolve gì** |
| lỗi lập trình | run `failed` → không resolve |
| dừng sau 100 trang mà còn dữ liệu | run `partial` |
| id không có trong kết quả lookup | giữ alert, ghi log `warn` |
| batch đầu clear, batch sau lỗi | **không resolve batch nào** |
| người dùng vừa chuyển trạng thái alert | resolve bị từ chối, log `warn`, không phải lỗi scan |

Resolution ghi `scan_runs` là `succeeded` **trước** khi resolve, vì `resolveBySystem` từ chối run còn `running`; số lượng resolved ghi lại sau bằng `recordResolved`.

**Lock:** `pg_try_advisory_lock(771053318, key(detectorCode, phase))` trên connection riêng, ngoài transaction, release trong `finally`; connection chết → session chết → lock tự nhả. Try chứ không wait: tick không lấy được lock thì bỏ qua.

**Correlation id:** một id cho cả tick, đi vào read-model request (`X-Correlation-Id`), `scan_runs.correlation_id`, `alert_transition_history.correlation_id` và mọi dòng log.

**Log:** một dòng JSON mỗi run — `event, detector, phase, runId, outcome, durationMs, candidates, signals, created, updated, resolved, correlationId, error?`. Không log token, trusted context, secret hay payload nghiệp vụ.

## 12. Detector & cấu hình (Phase 1b)

| Detector | Subject | Anchor | Đã duyệt | CHƯA duyệt |
|---|---|---|---|---|
| `UNASSIGNED_TRIP_APPROACHING_EXECUTION` v1 | trip | `pickup_at` | warning lead **2h** | ngưỡng HIGH |
| `STALE_ASSIGNMENT_START` v1 | assignment | `pickup_at` | — | **grace (bắt buộc để chạy)**, ngưỡng HIGH |
| `COMPLETION_REVIEW_OVERDUE` v1 | completion request | `submitted_at` | warning sau **12h** | ngưỡng HIGH |

★ **Giá trị chưa duyệt thì KHÔNG có mặc định.** Thiếu ngưỡng HIGH → detector chỉ phát `warning`. Thiếu grace của D2 → **D2 bị tắt** và ghi rõ lý do lúc boot (zero không phải mặc định). Thiếu `SCAN_INTERVAL` → scheduler không arm.

v1 chỉ dùng `warning` và `high`; `info`/`critical` không được phát. `confidence` luôn `null` với rule detector.

**Evidence** (deterministic, `evidenceVersion = 1`, chỉ facts giải thích alert — không dump read model, không secret):
- D1: `tripId, scheduledOn, pickupAt, tripStatus, activeAssignmentCount, remainingSeconds, warningLeadSeconds, highLeadSeconds, observedAt`
- D2: `assignmentId, tripId, driverUserId, vehicleId, pickupAt, assignedAt, hasLiveExecutionEvent, latestCompletionState, elapsedSincePickupSeconds, configuredGraceSeconds, highAfterSeconds, observedAt`
- D3: `completionRequestId, assignmentId, tripId, attemptNo, submittedAt, elapsedSeconds, warningThresholdSeconds, highThresholdSeconds, observedAt`
