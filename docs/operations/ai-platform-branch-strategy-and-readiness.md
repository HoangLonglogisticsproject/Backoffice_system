# AI Platform — nhánh tích hợp và cổng production-readiness

**Loại:** OPERATIONS · **Trạng thái:** đang áp dụng từ 2026-09-24 (Phase 1b trở đi).
**Nguồn quyết định kiến trúc:** [ADR-0007](../architecture/adr-0007-ai-platform-boundary.md) (ranh giới) · [ADR-0008](../architecture/adr-0008-operational-alert-engine.md) (alert engine Phase 1b).

Tài liệu này là **living document** — sửa trực tiếp khi quy trình đổi. Nó ghi *cách code AI đi từ nhánh feature tới production*, không ghi lại quyết định kiến trúc (chỗ đó là ADR, và ADR đã `accepted` thì không sửa nội dung — xem `docs/README.md`).

---

## 1. `ai/integration` là gì

> **Long-lived integration branch for AI platform development before production-readiness promotion to `main`.**

Nhánh dài hạn để các phase của AI Platform gộp vào nhau và được kiểm chứng cùng nhau, **trước khi** toàn bộ subsystem đủ điều kiện lên `main`.

**Nó KHÔNG phải:**

| Không phải | Vì sao |
|---|---|
| POC branch | Code Phase 1a/1b đã viết theo chuẩn production: invariant có test, migration có checksum, role least-privilege, boundary check trong CI. Không gọi là `AI-poc`. |
| production branch | Không có gì deploy từ đây. |
| deployment branch | `release` job chỉ chạy trên `main`; `ai/integration` không kích hoạt deploy nào. |

Lý do tồn tại: **code đã production-oriented, nhưng subsystem chưa production-enabled.** Hai việc khác nhau. Gộp từng phase thẳng vào `main` sẽ đưa vào nhánh production một hệ thống chưa provisioning, chưa có đường cho người vận hành đọc alert, và chưa chốt cadence quét — mà không thu được gì.

### Phase 1a vẫn nằm trên `main`, và cứ để yên

Phase 1a đã merge vào `main` (PR #77, `03935a0`) trước khi có quyết định này. **Không revert.** Nó là nền tảng ngủ đông và hành vi production hiện tại không đổi, bởi vì:

- service AI không được deploy,
- role và migration của `ai` chưa provisioning trên production,
- scheduler không arm (`SCAN_INTERVAL` không đặt),
- service secret chưa provisioning.

## 2. Luồng phát triển

```
main
  │
  └── ai/integration                     ← nhánh dài hạn, tạo từ main
        │
        └── feat/ai-platform-phase-1x    ← nhánh feature của từng phase
              │
              └── PR ──────────────────► ai/integration
```

Thăng hạng lên production:

```
ai/integration
      │
      └── PR + release-readiness review ──► main
```

### Quy tắc

1. **Mọi nhánh phase AI cắt từ `origin/ai/integration`**, không cắt từ `main`:

   ```sh
   git fetch origin
   git switch -c feat/ai-platform-phase-1c origin/ai/integration
   ```

2. **PR của phase AI nhắm vào `ai/integration`**, không nhắm `main`. Áp dụng cho mọi phase tiếp theo cho tới khi thăng hạng.

3. **Sync xuôi thường xuyên.** Mọi thay đổi liên quan trên `main` (backend, CI, deploy config, contract) phải được đưa vào `ai/integration` đều đặn để tránh drift của nhánh dài hạn:

   ```sh
   git fetch origin
   git switch -c sync/main-into-ai-integration origin/ai/integration
   git merge origin/main          # merge, không rebase
   git push origin sync/main-into-ai-integration
   # rồi mở PR: sync/main-into-ai-integration → ai/integration
   ```

   ★ **Qua PR, không push thẳng.** `ai-integration-protection` bắt buộc pull
   request cho mọi thay đổi trên `ai/integration`, kể cả của admin (ruleset
   không có bypass actor). `git push origin ai/integration` bị từ chối với
   `GH013: Changes must be made through a pull request`. Đây là chủ ý: một
   nhánh dài hạn mà nhiều PR bám vào không nên đổi dưới chân người khác mà
   không ai nhìn thấy.

   Merge chứ không rebase: **không rewrite lịch sử `ai/integration`**. Nhánh này có nhiều người và nhiều PR bám vào, force push sẽ phá hết — và ruleset chặn force push.

4. **Không force push, không xoá nhánh** — ruleset `ai-integration-protection` enforce cả hai.

## 3. Bảo vệ nhánh

Ruleset `ai-integration-protection` (active) áp cho `refs/heads/ai/integration`:

| Rule | Trạng thái |
|---|---|
| Chặn xoá nhánh | bật |
| Chặn force push (non-fast-forward) | bật |
| Bắt buộc pull request trước khi merge | bật |
| Required status check: `detect · which half of the monorepo changed` | bật |
| Required status check: `SonarCloud Code Analysis` | bật |

**Vì sao chỉ hai check này là required.** `ai`, `backend`, `frontend`, `integration` chạy có điều kiện theo `affected.sh` (`if: needs.detect.outputs.* == 'true'`), nên với một PR chỉ sửa tài liệu chúng bị skip. Đặt required một check có thể không bao giờ report là cách chắc chắn nhất để khoá merge vĩnh viễn. `detect` luôn chạy, và SonarCloud là GitHub App chạy trên mọi PR (repo này dùng automatic analysis, không có Sonar job trong workflow) — cả hai đều ổn định.

**CodeRabbit cố ý KHÔNG required:** quota/rate-limit của bot có thể chặn merge vì lý do không liên quan tới code.

**Số approval hiện là 0.** Đủ để chặn push thẳng, nhưng không khoá một maintainer duy nhất (GitHub không cho tự approve PR của mình). Khi team có từ hai người review trở lên, nâng lên 1 và cân nhắc bật `required_review_thread_resolution`.

Protection của `main` **không bị thay đổi** bởi thiết lập này.

## 4. Cổng production-readiness

`ai/integration → main` **chỉ** mở khi tất cả mục dưới đây đạt. Danh sách này là điều kiện *tối thiểu*; nó không tự sinh ra giá trị nghiệp vụ nào — chỗ nào ghi "đã duyệt" nghĩa là **cần một quyết định của người có thẩm quyền**, không phải một giá trị do kỹ thuật tự chọn.

### CODE

- [ ] Phase 1a hoàn tất
- [ ] Phase 1b hoàn tất
- [ ] Phần tích hợp hướng người vận hành cần cho bản phát hành đã hoàn tất
- [ ] CI xanh
- [ ] Sonar xanh (Quality Gate OK, không còn issue new-code mở)
- [ ] Các phát hiện bảo mật đã đóng

### INFRA

- [ ] Service/container AI deploy được
- [ ] Role database của AI đã provisioning và đã kiểm chứng (`ai_migrator`, `ai_app`, `ai_maintenance`)
- [ ] Quy trình chạy migration AI trên production đã được kiểm chứng

### AUTH

- [ ] `SERVICE_TOKEN_AI_TO_BACKEND` đã provisioning
- [ ] `SERVICE_TOKEN_BACKEND_TO_AI` đã provisioning
- [ ] `TRUSTED_CONTEXT_SECRET` đã provisioning **nếu** bật hành động do người dùng uỷ quyền
- [ ] Quy trình xoay vòng (rotation) và khôi phục secret đã có tài liệu

### NETWORK

- [ ] Đường riêng Backend ↔ AI hoạt động
- [ ] API `/internal/*` bị chặn trên mọi public host (`.github/scripts/check-nginx-internal-block.sh` xanh)
- [ ] Hành vi health/readiness đã kiểm chứng

### CONFIG

- [ ] `SCAN_INTERVAL` production được **duyệt tường minh** và đã đặt
- [ ] Grace của D2 được duyệt, **hoặc** D2 tắt một cách tường minh
- [ ] Không có ngưỡng HIGH nào chưa được duyệt

### OPERATIONS

- [ ] Log có cấu trúc
- [ ] Health check
- [ ] Hành vi restart
- [ ] Quy trình rollback
- [ ] Chiến lược rollback/forward-recovery cho migration

### UX

- [ ] Người vận hành có đường chính thức để tiêu thụ alert **trước khi** bật scan trên production

★ Một alert engine chạy mà không ai đọc được alert thì chỉ là tải lên database. Mục UX này là điều kiện, không phải mong muốn.
