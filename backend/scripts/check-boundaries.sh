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
#   create-user.cli.ts   BOOTSTRAP_PASSWORD cố ý KHÔNG nằm trong envSchema.
#                        Đó là credential dùng một lần, không phải cấu hình
#                        deployment; đưa vào schema là để mật khẩu sống trong
#                        AppConfig suốt vòng đời tiến trình.
#   *.integration.spec   DATABASE_URL_TEST chỉ để test tự tắt khi máy không có
#                        PostgreSQL. Không phải đường chạy thật.
report "B6  không đọc process.env.X ngoài validate" \
  "$(grep -rnE "process\.env(\.[A-Za-z_]|\[)" --include=*.ts src 2>/dev/null \
     | grep -vE "(src/core/users/create-user\.cli\.ts|\.integration\.spec\.ts):")"

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
     | grep -vE ':[0-9]+: *(\*|//|/\*)')"

echo
if [[ $fail -eq 0 ]]; then
  printf '\033[32mTất cả ranh giới đều sạch.\033[0m\n'
else
  printf '\033[31mCó vi phạm ranh giới — xem ở trên.\033[0m\n'
fi
exit $fail
