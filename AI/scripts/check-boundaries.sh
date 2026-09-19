#!/usr/bin/env bash
#
# Canh ranh giới kiến trúc của /AI. 0 dependency — chỉ grep, như backend/.
#
# Chạy: npm run check      Thoát != 0 khi vi phạm, cắm thẳng vào CI được.
#
#   config/          môi trường đã validate
#   common/          primitive cross-cutting (errors, http, pagination, port)
#   infrastructure/  adapter công nghệ — database, service-auth, health
#   core/<context>/  domain · application · persistence · api
#
# Rule A1/A2 là lý do file này tồn tại: /AI là một ứng dụng riêng (ADR-0007),
# và một câu import xuyên sang backend/src hay frontend/src là kết thúc của
# ranh giới đó, dù nhỏ đến đâu.

cd "$(dirname "$0")/.." || exit 2

# Dòng grep -n có phần CODE là comment — `path:12:   // ...`. Các rule soi từ
# vựng (A5, A7, A8) bỏ qua chúng: một checker vấp vào chính tài liệu của nó là
# checker sẽ bị tắt.
readonly COMMENT_LINE=':[0-9]+: *(\*|//|/\*|--)'

fail=0
report() {
  local rule="$1"
  local violations="$2"

  if [[ -n "$violations" ]]; then
    printf '\n\033[31m✘ %s\033[0m\n' "$rule"
    printf '%s\n' "$violations" | sed 's/^/    /'
    fail=1
  else
    printf '\033[32m✔\033[0m %s\n' "$rule"
  fi
  return 0
}

# --- A1 ── AI không bao giờ import backend/src ------------------------------
# Quy tắc quan trọng nhất. Soi cả src/ lẫn tests/: một integration spec kéo
# migration runner của backend qua đường tương đối cũng là vi phạm.
report "A1  AI ↛ backend/src" \
  "$(grep -rnE "^\s*(import|export).*from '[^']*backend/" --include=*.ts src tests 2>/dev/null; \
     grep -rnE "require\(['\"][^'\"]*backend/" --include=*.ts --include=*.js src tests 2>/dev/null)"

# --- A2 ── AI không bao giờ import frontend/src -----------------------------
report "A2  AI ↛ frontend/src" \
  "$(grep -rnE "^\s*(import|export).*from '[^']*frontend/" --include=*.ts src tests 2>/dev/null)"

# --- A3 ── domain/ không phụ thuộc framework, driver, hay tầng nào khác ------
# Luật nghiệp vụ thuần: chạy được trong test không có Nest, HTTP, PostgreSQL.
report "A3  domain ↛ @nestjs · pg · express · infrastructure · persistence · api" \
  "$(grep -rnE "from '(@nestjs|pg|express|[^']*/(infrastructure|persistence|api)/)" --include=*.ts \
       src/core/*/domain 2>/dev/null | grep -v '\.spec\.ts')"

# --- A4 ── application/ không biết HTTP -------------------------------------
# Use-case gọi được từ controller hôm nay và từ engine ngày mai mà không học
# status code là gì. Nest DI (@Injectable, @Inject) được phép; express thì không.
report "A4  application ↛ express · api" \
  "$(grep -rnE "from '(express|@nestjs/platform-express|[^']*/api/)" --include=*.ts \
       src/core/*/application 2>/dev/null | grep -v '\.spec\.ts')"

# --- A5 ── persistence không tự mở transaction ------------------------------
# Transaction boundary thuộc application: chỉ tầng đó biết status change và
# history row phải cùng commit. (Backend B11.)
report "A5  persistence ↛ tự mở transaction" \
  "$(grep -rn "\.transaction(" --include=*.ts src/core/*/persistence 2>/dev/null \
     | grep -v '\.spec\.ts' | grep -vE "$COMMENT_LINE")"

# --- A6 ── không đọc biến môi trường mà không qua validate ------------------
# `process.env.X` / `process.env['X']` bị cấm; truyền cả `process.env` cho
# envSchema thì hợp lệ (migrate.cli.ts). (Backend B6.)
report "A6  không đọc process.env.X ngoài validate" \
  "$(grep -rnE "process\.env(\.[A-Za-z_]|\[)" --include=*.ts src 2>/dev/null)"

# --- A7 ── runtime không phát lệnh DELETE -----------------------------------
# ai_app không có DELETE; retention là năng lực riêng với role riêng
# (ai_maintenance). Khi Phase 1b thêm retention CLI, thêm ĐÚNG TÊN FILE vào
# allowlist dưới đây — không glob. Hôm nay allowlist rỗng.
report "A7  runtime ↛ DELETE" \
  "$(grep -rniE "delete[[:space:]]+from" --include=*.ts src 2>/dev/null \
     | grep -v '\.spec\.ts' | grep -vE "$COMMENT_LINE")"

# --- A8 ── không tham chiếu schema public -----------------------------------
# Không FK, không SELECT, không JOIN vào public.*: dữ liệu vận hành đến qua
# read API của backend. Soi src/ và migrations/, bỏ comment.
report "A8  src · migrations ↛ public.*" \
  "$(grep -rniE "\bpublic\." --include=*.ts --include=*.sql src migrations 2>/dev/null \
     | grep -v '\.spec\.ts' | grep -vE "$COMMENT_LINE")"

# --- A9 ── src ↛ integration spec -------------------------------------------
# Spec cần PostgreSQL sống ở tests/; một *.integration.spec.ts trong src/ sẽ
# không được lệnh nào chạy. (Backend B14.)
report "A9  src ↛ integration spec" \
  "$(find src -name '*.integration.spec.ts' 2>/dev/null)"

# --- A10 ── không có dependency ngoài phạm vi Phase 1 -----------------------
# Không LLM SDK, không vector DB, không queue/broker, không cron package.
# Danh sách là ví dụ có chủ đích; thêm vào khi một phase sau cân nhắc chúng.
report "A10 package.json ↛ LLM · vector · queue · cron" \
  "$(grep -nE '"(langchain|@langchain/[^"]*|llamaindex|openai|@anthropic-ai/[^"]*|@google/generative-ai|pgvector|@qdrant/[^"]*|weaviate-[^"]*|@pinecone-database/[^"]*|ioredis|redis|bullmq|bull|@nestjs/bull[^"]*|kafkajs|amqplib|node-cron|cron|@nestjs/schedule)"\s*:' package.json 2>/dev/null)"

echo
if [[ $fail -eq 0 ]]; then
  printf '\033[32mTất cả ranh giới đều sạch.\033[0m\n'
else
  printf '\033[31mCó vi phạm ranh giới — xem ở trên.\033[0m\n'
fi
exit $fail
