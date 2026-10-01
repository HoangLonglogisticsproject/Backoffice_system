#!/bin/bash
# shellcheck disable=SC2015,SC2016,SC2001 # `ok || nok` never fails, and hostile inputs are single-quoted on purpose
# Tests for the runner-side scripts: input validation, the SSH preparation and
# the summary. No root, no docker, no network - runs anywhere bash does.
set -euo pipefail
GH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../github" && pwd)"
readonly GH
readonly A1=a0000000-0000-4000-8000-000000000001 A2=a0000000-0000-4000-8000-000000000002
readonly SHA=0123456789abcdef0123456789abcdef01234567
pass=0 failed=0
ok()  { local what="$1"; pass=$((pass + 1)); printf '  ok    %s\n' "$what"; }
nok() {
  local what="$1" detail="${2:-}"
  failed=$((failed + 1)); printf '  FAIL  %s\n' "$what"
  [[ -z "$detail" ]] || sed 's/^/          /' <<< "$detail"
}
request() {  # request <ids> [email] [sha]: sets RC and OUT
  local ids="$1" email="${2-ops@example.com}" sha="${3-$SHA}"
  set +e
  OUT="$(TRIP_IDS="$ids" ACTOR_EMAIL="$email" EXPECTED_RELEASE_SHA="$sha" bash "$GH/normalize-request.sh" 2>&1)"
  RC=$?
  set -e
}

echo "== normalize-request.sh: explicit UUIDs only, validated before any secret exists"
request "$A1, ${A2^^}"$'\n'
[[ $RC == 0 && "$OUT" == $'ids='"$A1,$A2"$'\nby=ops@example.com\nexpected_release='"$SHA" ]] \
  && ok "comma/space/newline lists and upper case become the canonical request" || nok "canonical request" "$OUT"
for bad in all '*' '' '   ' "$A1;id" '$(id)' '`id`' "' OR 1=1 --" "$A1,$A1" "${A1:0:35}" "$A1|id" "$A1 && id" 'SELECT id FROM trip_schedules'; do
  request "$bad"
  [[ $RC == 2 ]] && ok "refused: ${bad:-<blank>}" || nok "accepted: $bad" "$OUT"
done
request "$(for i in $(seq 1 201); do printf 'a0000000-0000-4000-8000-%012d,' "$i"; done)"
[[ $RC == 2 && "$OUT" == *"at most 200"* ]] && ok "refused: more than 200 ids" || nok "201 ids" "$OUT"
for email in '' 'not-an-email' 'x;id@example.com' '$(id)@example.com' 'a b@example.com'; do
  request "$A1" "$email"
  [[ $RC == 2 ]] && ok "refused actor: ${email:-<blank>}" || nok "accepted actor: $email" "$OUT"
done
for sha in '' HEAD main "${SHA:0:39}" "${SHA^^}" "$SHA;id"; do
  request "$A1" ops@example.com "$sha"
  [[ $RC == 2 ]] && ok "refused release: ${sha:-<blank>}" || nok "accepted release: $sha" "$OUT"
done

echo "== connect.sh: a pinned host key or nothing"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
connect() {  # connect <known_hosts>: sets RC and OUT
  local known_hosts="$1"
  set +e
  OUT="$(RUNNER_TEMP="$tmp" GITHUB_ENV="$tmp/env" PROD_OPS_HOST=203.0.113.7 PROD_OPS_PORT=24700 \
    PROD_OPS_SSH_KEY='-----BEGIN OPENSSH PRIVATE KEY-----' PROD_OPS_KNOWN_HOSTS="$known_hosts" bash "$GH/connect.sh" 2>&1)"
  RC=$?
  set -e
}
hostkey='AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
connect ''
[[ $RC != 0 && "$OUT" == *PROD_OPS_KNOWN_HOSTS* ]] && ok "no known_hosts: refused" || nok "no known_hosts accepted" "$OUT"
connect "other.example.com ssh-ed25519 $hostkey"
[[ $RC != 0 && "$OUT" == *"no key for [203.0.113.7]:24700"* ]] && ok "known_hosts for another host: refused" || nok "wrong host accepted" "$OUT"
connect "[203.0.113.7]:24700 ssh-ed25519 $hostkey"
config="$tmp/prod-ops-ssh/config"
if [[ $RC == 0 ]] && grep -q '^  StrictHostKeyChecking yes$' "$config" && grep -q '^  User bo-ops$' "$config" \
   && grep -q '^  GlobalKnownHostsFile /dev/null$' "$config" && grep -q "^PROD_OPS_SSH_CONFIG=$config$" "$tmp/env"; then
  ok "pinned host: strict checking, bo-ops, only the pinned known_hosts"
else
  nok "pinned host config" "$OUT"
fi
[[ -f "$tmp/prod-ops-ssh/key" && "$(stat -c '%a' "$tmp/prod-ops-ssh/key")" == 600 ]] && ok "the private key is written 0600" || nok "key mode"
grep -q 'BEGIN OPENSSH' <<< "$OUT" && nok "connect.sh printed the private key" || ok "connect.sh never prints the key"

echo "== summarize.sh"
cat > "$tmp/out.txt" <<EOF
meta|backend_release|$SHA
count|ELIGIBLE|2
ids|ELIGIBLE|$A1,$A2
preflight|$A1|ELIGIBLE
result|$A1|NORMALIZED
error|7|1 of 2 ids were left unchanged - see the result lines
EOF
summary="$(bash "$GH/summarize.sh" Normalization "$tmp/out.txt")"
[[ "$summary" == *"**Stopped - exit 7:**"* && "$summary" == *"| result | \`$A1\` | NORMALIZED |"* && "$summary" == *"ELIGIBLE ids (2)"* ]] \
  && ok "errors, outcomes and id lists all reach the summary" || nok "summary" "$summary"
[[ "$(bash "$GH/summarize.sh" Audit "$tmp/missing.txt")" == *"No output"* ]] && ok "no output is said, not hidden" || nok "missing output"

echo
echo "github: $pass passed, $failed failed"
(( failed == 0 ))
