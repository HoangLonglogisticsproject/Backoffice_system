#!/usr/bin/env bash
#
# Canh ranh giới kiến trúc backend. 0 dependency — chỉ grep.
#
# Chạy: npm run check      Thoát != 0 khi vi phạm, cắm thẳng vào CI được.
#
# Vì sao không phải ESLint: các quy tắc dưới đây là quy tắc VỀ ĐƯỜNG DẪN, không
# phải về cú pháp. grep diễn đạt chúng trực tiếp. Thêm ESLint khi cần cảnh báo
# ngay trong editor — lúc đó chép đúng các pattern này sang no-restricted-imports.
#
#   config/          môi trường đã validate
#   infrastructure/  adapter công nghệ — database, health, sau này auth/storage
#   common/          primitive cross-cutting, KHÔNG phải sọt rác
#   core/            Backoffice Foundation
#   capabilities/    module nghiệp vụ, tuỳ chọn

cd "$(dirname "$0")/.." || exit 2

# Bốn rule B1-B4 chỉ soi CÂU LỆNH IMPORT, không soi toàn văn file. Comment
# giải thích ranh giới đương nhiên phải nhắc tên các tầng — một checker vấp vào
# chính tài liệu của nó là checker sẽ bị tắt.

# `grep -n` output whose CODE part is a comment — `path:12:   // ...`.
#
# Four rules below strip these, and all four learned the same lesson: a rule
# that trips over the comment explaining it is a rule somebody switches off.
# B7 names business words while forbidding them, B11 and B12 explain why they
# do NOT open a transaction or use forwardRef, and B13 ships the DELETE the
# deployment's cron is supposed to run. Each would report itself.
#
# One definition, so the four cannot drift apart — a fifth rule spelling the
# pattern slightly differently would silently stop skipping comments.
readonly COMMENT_LINE=':[0-9]+: *(\*|//|/\*)'

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

  # Explicit: this reports, it does not decide. Letting the exit status fall
  # through from the `if` would make a violation look like a failed command to
  # any caller that runs this with `set -e`.
  return 0
}

# --- B1 ── core không bao giờ biết capability nào tồn tại -------------------
# Quy tắc quan trọng nhất. Core biết tên một capability là core đã hỏng, và
# foundation hết tái sử dụng được cho project tiếp theo.
report "B1  core ↛ capabilities" \
  "$(grep -rn "capabilities/" --include=*.ts src/core 2>/dev/null | grep -v "^src/core/capabilities/")"

# --- B2 ── core định nghĩa PORT, infrastructure viết ADAPTER ----------------
# Nếu core import infrastructure thì đổi provider auth phải mổ vào foundation.
# Đấu dây là việc của app.module.ts, không phải của core.
report "B2  core ↛ infrastructure" \
  "$(grep -rnE "^\s*(import|export).*from '[^']*infrastructure/" --include=*.ts src/core 2>/dev/null)"

# --- B3 ── common là primitive, không phải sọt rác --------------------------
# common/ mà biết core hay capability thì nó không còn cross-cutting nữa.
report "B3  common ↛ core · capabilities · infrastructure" \
  "$(grep -rnE "^\s*(import|export).*from '[^']*(core|capabilities|infrastructure)/" --include=*.ts src/common 2>/dev/null)"

# --- B4 ── infrastructure là công nghệ, không phải nghiệp vụ ----------------
report "B4  infrastructure ↛ capabilities" \
  "$(grep -rn "capabilities/" --include=*.ts src/infrastructure 2>/dev/null)"

# --- B5 ── cắt theo trách nhiệm, không theo loại file -----------------------
# Không có top-level controllers/ services/ repositories/ entities/ dto/.
# Chúng nằm TRONG module của chúng.
report "B5  không có thư mục top-level theo loại file" \
  "$(ls -d src/controllers src/services src/repositories src/entities src/dto src/models 2>/dev/null)"

# --- B6 ── không đọc biến môi trường mà không qua validate -----------------
# Thứ đáng cấm là `process.env.SOMETHING` — đọc thẳng một biến, bỏ qua schema.
# Truyền cả `process.env` cho envSchema thì HỢP LỆ: vẫn là một cửa duy nhất, và
# CLI migrate chạy ngoài DI container nên buộc phải làm vậy.
#
# Bắt CẢ HAI dạng truy cập. Trước đây rule chỉ bắt dấu chấm, nên
# `process.env['FOO']` đi lọt hoàn toàn — và create-user.cli.ts đã nằm trong
# đúng điểm mù đó mà không ai thấy. Một rule né được bằng cách đổi cú pháp
# thì không phải là rule.
#
# Ngoại lệ là ALLOWLIST THEO TÊN FILE, không phải glob: một CLI mới hay một
# integration spec mới sẽ đỏ cho tới khi được thêm vào đây một cách có ý thức.
# Glob "*.cli.ts" sẽ khiến mọi CLI tương lai âm thầm thừa hưởng quyền đọc
# config ngoài schema.
#
#   cli/create-user.cli.ts  BOOTSTRAP_PASSWORD cố ý KHÔNG nằm trong envSchema.
#                        Đó là credential dùng một lần, không phải cấu hình
#                        deployment; đưa vào schema là để mật khẩu sống trong
#                        AppConfig suốt vòng đời tiến trình.
#   *.integration.spec   DATABASE_URL_TEST chỉ để test tự tắt khi máy không có
#                        PostgreSQL. Không phải đường chạy thật.
report "B6  không đọc process.env.X ngoài validate" \
  "$(grep -rnE "process\.env(\.[A-Za-z_]|\[)" --include=*.ts src 2>/dev/null \
     | grep -vE "(src/core/users/cli/create-user\.cli\.ts|\.integration\.spec\.ts):")"

# --- B7 ── foundation không mang từ vựng nghiệp vụ -------------------------
# Danh sách này là ví dụ, không phải giới hạn: nếu một domain mới rò rỉ vào
# foundation, thêm nó vào đây.
# Chỉ soi CODE, không soi comment — "in filename order" là văn xuôi tiếng Anh,
# không phải entity Order. Một checker hay báo nhầm là một checker bị tắt.
#
# KHÔNG dùng ranh giới từ hai đầu, và soi không phân biệt hoa thường. Bản cũ
# viết \bcustomer\b nên bỏ lọt gần như mọi dạng rò rỉ thật:
#
#   customerId          \b phía sau vấp vào 'I'
#   customers           \b phía sau vấp vào 's'
#   CustomerRepository  chữ hoa
#   getCustomerName     \b phía trước vấp vào 't'
#
# Bốn dạng đó mới là hình dạng rò rỉ thực tế; từ trần "customer" thì hiếm.
# Kiểm chứng trên cây hiện tại: 0 false positive.
#
# 'crm' vẫn giữ ranh giới hai đầu — ba ký tự quá ngắn, bỏ ranh giới ra là nó
# sẽ khớp vào giữa những định danh không liên quan.
report "B7  foundation ↛ từ vựng nghiệp vụ" \
  "$(grep -rinE "(customer|invoice|shipment|warehouse|recruitment|\bcrm\b)" \
       --include=*.ts src/core src/common src/infrastructure src/config 2>/dev/null \
     | grep -vE "$COMMENT_LINE")"

# --- B8 ── chỉ MỘT thư mục infrastructure, ở gốc src ------------------------
# `src/infrastructure/` = hạ tầng kỹ thuật của TOÀN HỆ THỐNG (driver database,
# migration runner, adapter framework). Việc lưu trữ dữ liệu CỦA MỘT CONTEXT
# thuộc `core/<context>/persistence/`.
#
# Hai thư mục cùng tên `infrastructure` ở hai scope khác nhau là cách nhanh nhất
# để người đọc không còn biết "infrastructure" nghĩa là gì trong repo này.
report "B8  không có infrastructure lồng trong context"   "$(find src/core src/capabilities -type d -name infrastructure 2>/dev/null)"

# --- B9 ── api/ không chứa SQL ----------------------------------------------
# Controller map HTTP; SQL thuộc persistence/. Một controller biết tên bảng là
# một controller không test được nếu không có database.
report "B9  api ↛ SQL"   "$(grep -rlniE "(SELECT|INSERT INTO|UPDATE|DELETE FROM) " --include=*.ts        src/core/*/api src/capabilities/*/api 2>/dev/null | grep -v '\.spec\.ts')"

# --- B10 ── domain/ không phụ thuộc framework hay driver --------------------
# Domain là luật nghiệp vụ thuần: nó phải chạy được trong một test không có
# Nest, không có HTTP, không có PostgreSQL. Nếu domain import @nestjs thì luật
# đó chỉ kiểm chứng được bằng cách dựng cả một container.
report "B10 domain ↛ @nestjs · pg · express"   "$(grep -rnE "from '(@nestjs|pg|express)" --include=*.ts        src/core/*/domain src/capabilities/*/domain 2>/dev/null)"

# --- B11 ── persistence không tự mở transaction -----------------------------
# Transaction boundary thuộc application/use-case: chỉ tầng đó biết những lệnh
# ghi nào phải cùng thành công hoặc cùng thất bại. Repository tự mở transaction
# thì không compose được, và hai repository trong cùng một flow sẽ commit rời
# nhau — partial commit chỉ lộ ra khi đã xảy ra trên production.
# Chỉ soi CODE, không soi comment — repository giải thích VÌ SAO nó không mở
# transaction, và một checker vấp vào chính tài liệu của nó là checker sẽ bị tắt.
# Cùng bài học như B7.
report "B11 persistence ↛ tự mở transaction"   "$(grep -rn "\.transaction(" --include=*.ts        src/core/*/persistence src/capabilities/*/persistence 2>/dev/null      | grep -v '\.spec\.ts'      | grep -vE "$COMMENT_LINE")"

# --- B12 ── forwardRef chỉ được tồn tại ở đúng cặp đã biết -------------------
# `organization ↔ authorization` là cycle DUY NHẤT được chấp nhận, và lý do nằm
# trong README của cả hai context. Rule này không cấm cycle đó; nó cấm cycle thứ
# hai — vì hai cycle chồng nhau là lúc đồ thị module không còn đọc được.
#
# Ngưỡng là 2: một forwardRef ở mỗi phía của cặp đó.
# Soi lời gọi THẬT `forwardRef(`, bỏ qua dòng comment — module giải thích vì sao
# nó KHÔNG dùng forwardRef, và checker vấp vào chính tài liệu đó là checker sẽ bị
# tắt. Bài học thứ ba cùng loại, sau B7 và B11.
report "B12 không có forwardRef mới ngoài cặp đã biết"   "$(found=$(grep -rn "forwardRef(" --include=*.module.ts src 2>/dev/null        | grep -vE "$COMMENT_LINE"        | cut -d: -f1 | sort -u);      count=$(printf '%s
' "$found" | grep -c . );      if [[ $count -gt 2 ]]; then printf '%s
' "$found"; fi)"

# --- B13 ── runtime không phát lệnh DELETE ----------------------------------
# Vòng đời của hệ này là disable / archive / end / revoke — toàn UPDATE, vì lịch
# sử là mục đích: membership, role assignment và audit trail phải đọc được sau
# khi người ta rời đi.
#
# `scripts/provision-db-roles.sql` biến điều đó thành ràng buộc thật: role
# runtime (bo_app) được GRANT SELECT, INSERT, UPDATE và KHÔNG có DELETE. Nên một
# câu DELETE mới trong code sẽ không fail lúc review — nó fail trên production,
# bằng `permission denied for table ...`, đúng lúc ai đó đang bấm nút.
#
# Rule này bắt nó ở CI thay vì ở đó. Nếu một DELETE thật sự cần thiết thì nó là
# một quyết định kiến trúc: sửa grant, sửa rule này, và ghi lý do — không phải
# lặng lẽ thêm một câu lệnh.
#
# Chỉ soi CODE, không soi comment — session.service.ts chép sẵn câu DELETE cho
# cron của deployment, và một checker vấp vào chính tài liệu của nó là checker
# sẽ bị tắt. Bài học thứ tư cùng loại, sau B7, B11 và B12.
report "B13 runtime ↛ DELETE"                  "$(grep -rniE "delete[[:space:]]+from" --include=*.ts src 2>/dev/null      | grep -v '\.spec\.ts'      | grep -vE "$COMMENT_LINE")"

echo
if [[ $fail -eq 0 ]]; then
  printf '\033[32mTất cả ranh giới đều sạch.\033[0m\n'
else
  printf '\033[31mCó vi phạm ranh giới — xem ở trên.\033[0m\n'
fi
exit $fail
