#!/usr/bin/env bash
#
# Canh ranh giới kiến trúc. 0 dependency — chỉ grep.
#
# Chạy: bash scripts/check-architecture.sh
# Thoát != 0 nếu có vi phạm, nên cắm thẳng vào CI được.
#
# Vì sao không phải ESLint: các quy tắc dưới đây là quy tắc VỀ ĐƯỜNG DẪN,
# không phải về cú pháp. grep diễn đạt chúng trực tiếp và không tốn một
# dependency nào. Thêm ESLint khi cần cảnh báo ngay lúc gõ trong editor —
# lúc đó chép đúng các pattern này sang `no-restricted-imports`.
#
# Hình dạng source được canh ở đây:
#
#   app/         lắp ráp ứng dụng của MỘT khách hàng
#   features/    nghiệp vụ
#   components/  UI tái sử dụng   ─┐
#   services/    hạ tầng Angular   │  nền tảng — khách hàng B dùng lại
#   store/       trạng thái toàn app │  nguyên vẹn, không sửa dòng nào
#   types/ utils/ constants/ styles/ ─┘

cd "$(dirname "$0")/.." || exit 2

fail=0
report() {
  if [ -n "$2" ]; then
    printf '\n\033[31m✘ %s\033[0m\n' "$1"
    printf '%s\n' "$2" | sed 's/^/    /'
    fail=1
  else
    printf '\033[32m✔\033[0m %s\n' "$1"
  fi
}

# --- R1 ── nền tảng không bao giờ biết tới nghiệp vụ hay khách hàng ---------
# Đây là quy tắc quan trọng nhất: nó chính là điều kiện để khách hàng B tái sử
# dụng components/services/store/types/utils mà không kéo theo code của THG.
FOUNDATION="components services store types utils constants"
report "R1  nền tảng ↛ features · app" \
  "$(grep -rnE "from '(\.\./)*(features|app)/|from '@bo/features" --include=*.ts $FOUNDATION 2>/dev/null)"

# --- R2 ── components là UI thuần ------------------------------------------
# Một component tái sử dụng không được biết Department, Role hay Capability.
# Nó nhận dữ liệu chung và trả sự kiện chung.
report "R2  components ↛ từ vựng tổ chức" \
  "$(grep -rnE "\b(Department|Role|Capability|AccessService|SessionStore|OrgStore)\b" \
       --include=*.ts components 2>/dev/null | grep -v '\.spec\.ts')"

# --- R3 ── luật phân quyền phải sạch để backend chép lại --------------------
report "R3  services/access/rules ↛ Angular · rxjs" \
  "$(grep -rn "@angular/\|from 'rxjs" --include=*.ts services/access/rules 2>/dev/null)"

# --- R4 ── nền tảng không mang tên hay từ vựng của khách hàng ---------------
# Kể cả trong comment và test-double. Một khách hàng mới đọc components/ không
# được thấy CRM của khách hàng cũ làm ví dụ — đó là cách "generic" âm thầm trở
# thành "generic cho đúng một công ty".
# Ngoại lệ đã biết và ghi nhận: copy tiếng Việt trong app/layout. Đó là khoá
# locale, không phải khoá nghiệp vụ, và gỡ nó cần một cơ chế i18n.
report "R4  nền tảng ↛ tên · từ vựng khách hàng" \
  "$(grep -rnE "\bTHG\b|khách hàng|phân công|potential.customer|\bcrm\b|dropship|fulfill" \
       --include=*.ts --include=*.scss $FOUNDATION styles 2>/dev/null)"

# --- R5 ── màu THÔ chỉ được sống ở styles/tokens ----------------------------
# Bất biến gọn nhất diễn đạt được ranh giới component ⟂ visual language: một
# giá trị màu nằm ngoài tokens/ là quyết định thị giác khách hàng không với tới.
report "R5  hex chỉ ở styles/tokens" \
  "$(grep -rn "#[0-9a-fA-F]\{3,8\}\b" --include=*.scss --include=*.ts \
       components services store types utils app/layout app/navigation app/routing 2>/dev/null \
     | grep -v "icon.paths")"

# --- R6 ── nền tảng không đặt tên một webfont cụ thể ------------------------
# Chọn chữ là bản sắc của khách. Foundation dừng ở stack hệ điều hành.
report "R6  nền tảng ↛ webfont cụ thể" \
  "$(grep -rniE "'(Inter|Roboto Flex|Manrope|Poppins|Montserrat)'" \
       --include=*.scss --include=*.ts $FOUNDATION styles/tokens 2>/dev/null)"

# --- R7 ── utils là hàm thuần ----------------------------------------------
# Bất cứ thứ gì cần inject là một service và thuộc services/.
report "R7  utils ↛ Angular DI" \
  "$(grep -rn "@angular/\|@Injectable\|inject(" --include=*.ts utils 2>/dev/null)"

# --- R8 ── feature không với sang feature khác ------------------------------
report "R8  feature ↛ feature khác" \
  "$(grep -rn "from '\.\./\.\./\(organization\|worklist\|leads\)/" --include=*.ts features 2>/dev/null)"

# --- I1-I3 ── đồ thị phụ thuộc: chiều đi, portability, vòng ------------------
# grep chỉ thấy từng cạnh một. Một cạnh có thể hợp lệ khi nhìn riêng mà vẫn
# khép thành vòng khi nhìn cả đồ thị, nên phần này cần đi hết graph.
echo
if node scripts/check-imports.mjs; then :; else fail=1; fi

echo
if [ $fail -eq 0 ]; then
  printf '\033[32mTất cả ranh giới đều sạch.\033[0m\n'
else
  printf '\033[31mCó vi phạm ranh giới — xem ở trên.\033[0m\n'
fi
exit $fail
