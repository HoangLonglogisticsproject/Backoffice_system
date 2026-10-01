#!/bin/bash
# shellcheck disable=SC2015,SC2016,SC2034,SC2001 # assertions are strings that check() evaluates
# End-to-end test of bo-prod-ops: the REAL wrapper, installed by the REAL
# install.sh, against a REAL docker daemon, a REAL postgres:17-alpine carrying
# this repository's migrations, real sudo, and a stand-in backend whose only
# fake part is the normalization CLI (fake-normalize-cli.js).
#
# ⚠ IT INSTALLS bo-prod-ops, A SUDOERS RULE AND A bo-ops ACCOUNT ON THIS HOST.
# Throwaway hosts only: the CI runner (`sudo bash e2e.sh`) or the container
# run-local.sh starts. It refuses to run beside a real hoanglong-bo project.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS="$(dirname "$HERE")"
REPO="$(cd "$OPS/../.." && pwd)"
readonly HERE OPS REPO
readonly BIN=/usr/local/sbin/bo-prod-ops LIB=/usr/local/lib/bo-prod-ops SUDOERS=/etc/sudoers.d/bo-prod-ops
readonly TEST_LABEL=bo-prod-ops.e2e=1 PROJECT_LABEL=com.docker.compose.project=hoanglong-bo
readonly RELEASE=1111111111111111111111111111111111111111 OTHER=2222222222222222222222222222222222222222
readonly PG=bo-ops-e2e-postgres BE=bo-ops-e2e-backend PG_PASSWORD=pw-SENTINEL-must-never-print
readonly CLI_PATH=/app/dist/capabilities/trip-schedule/cli/normalize-legacy-confirmed.cli.js
readonly A1=a0000000-0000-4000-8000-000000000001 A2=a0000000-0000-4000-8000-000000000002
readonly A3=a0000000-0000-4000-8000-000000000003 A4=a0000000-0000-4000-8000-000000000004
readonly A5=a0000000-0000-4000-8000-000000000005 A6=a0000000-0000-4000-8000-000000000006
readonly A7=a0000000-0000-4000-8000-000000000007 A8=a0000000-0000-4000-8000-000000000008
readonly NOBODY_ID=f0000000-0000-4000-8000-00000000ffff
readonly AUDIT_RAN='count\|confirmed_total'  # a line only a completed audit prints
pass=0 failed=0 ALL=""

(( EUID == 0 )) || { echo "e2e.sh must run as root (it installs the wrapper)" >&2; exit 1; }
if docker ps -a --filter "label=$PROJECT_LABEL" --format '{{.Labels}}' | grep -v "$TEST_LABEL" | grep -q .; then
  echo "a real hoanglong-bo compose project exists on this docker daemon - refusing to run here" >&2
  exit 1
fi
cleanup() {
  docker ps -aq --filter "label=$TEST_LABEL" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker rmi "hoanglong-bo-backend:$RELEASE" "hoanglong-bo-backend:$OTHER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
for image in postgres:17-alpine node:24-alpine; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull -q "$image" >/dev/null
done

ok()  { local what="$1"; pass=$((pass + 1)); printf '  ok    %s\n' "$what"; }
nok() {
  local what="$1" detail="${2:-}"
  failed=$((failed + 1)); printf '  FAIL  %s\n' "$what"
  [[ -z "$detail" ]] || sed 's/^/          /' <<< "$detail"
}
check() { local what="$1" assertion="$2" detail="${3:-}"; if eval "$assertion"; then ok "$what"; else nok "$what" "$detail"; fi; }
# run <op...> : the wrapper as root with $REQ on stdin; sets RC and OUT
run() { set +e; OUT="$(printf '%s' "${REQ:-}" | "$BIN" "$@" 2>&1)"; RC=$?; set -e; ALL+="$OUT"$'\n'; }
# as_ops <command...> : as the bo-ops account, $REQ on stdin
as_ops() { set +e; OUT="$(printf '%s' "${REQ:-}" | sudo -u bo-ops -- "$@" 2>&1)"; RC=$?; set -e; ALL+="$OUT"$'\n'; }
expect() {  # expect <description> <exit code> [regex that must appear...]
  local what="$1" want="$2" pattern
  shift 2
  [[ "$RC" == "$want" ]] || { nok "$what (exit $RC, want $want)" "$OUT"; return 0; }
  for pattern in "$@"; do
    grep -qE -- "$pattern" <<< "$OUT" || { nok "$what (missing /$pattern/)" "$OUT"; return 0; }
  done
  ok "$what"
}
normalize_req() {
  local ids="$1" release="${2:-$RELEASE}"
  printf 'ids=%s\nby=ops@example.com\nexpected_release=%s\ngithub_run=42-1\ngithub_actor=octocat\n' "$ids" "$release"
}
psql_pg() { docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$PG" psql -X -q -A -t -v ON_ERROR_STOP=1 -U ops -d bo "$@"; }
wait_pg() { local i; for i in $(seq 1 60); do psql_pg -c 'SELECT 1' >/dev/null 2>&1 && return 0; sleep 1; done; echo "postgres never came up" >&2; exit 1; }
labels() { local service="$1"; printf -- '--label %s --label %s --label com.docker.compose.service=%s' "$TEST_LABEL" "$PROJECT_LABEL" "$service"; }
# The fake CLI's record and steering live in /app/e2e (root-only), not in /tmp.
cli_calls() { docker exec "$BE" sh -c 'cat /app/e2e/cli-calls 2>/dev/null; rm -f /app/e2e/cli-calls' || true; }
steer_cli() { local script="$1"; docker exec -i "$BE" sh -c 'cat > /app/e2e/outcomes' <<< "$script"; }
start_backend() {  # start_backend <release.sha label or ""> <image tag>
  local release="$1" tag="$2"
  docker rm -f "$BE" >/dev/null 2>&1 || true
  docker tag node:24-alpine "hoanglong-bo-backend:$tag"
  # shellcheck disable=SC2046 # labels() is word-split on purpose
  docker run -d --name "$BE" $(labels backend) ${release:+--label "release.sha=$release"} "hoanglong-bo-backend:$tag" sleep infinity >/dev/null
  docker exec "$BE" install -d -m 700 /app/e2e
  docker exec -i "$BE" sh -c "mkdir -p '$(dirname "$CLI_PATH")' && cat > '$CLI_PATH'" < "$HERE/fake-normalize-cli.js"
}

echo "== static: the reviewed SQL, its pin, and nothing that writes"
sql="$OPS/trip-confirmed-audit.sql"
pin="$(sed -n 's/^readonly AUDIT_SQL_SHA256=//p' "$OPS/bo-prod-ops")"
check "the wrapper pins the audit SQL's sha256" '[[ "$(sha256sum < "$sql" | cut -d" " -f1)" == "$pin" ]]'
code="$(sed 's/--.*$//' "$sql")"
check "the audit SQL has no write, DDL or procedural keyword" \
  '! grep -qiwE "insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|copy|call|do|vacuum|lock|reindex|cluster|comment|refresh|security|execute|prepare" <<< "$code"'
check "its only psql meta-command is ON_ERROR_STOP" '[[ "$(grep -E "^[[:space:]]*\\\\" <<< "$code")" == "\\set ON_ERROR_STOP on" ]]'
check "it opens READ ONLY and ends with ROLLBACK, no other transaction control" \
  '[[ "$(grep -iwE "^[[:space:]]*(begin|start|commit|end|rollback|abort|savepoint|release)" <<< "$code" | tr "\n" " ")" == "BEGIN TRANSACTION READ ONLY; ROLLBACK; " ]]'

echo "== install.sh: root-owned, pinned, idempotent"
id -u bo-ops >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /home/bo-ops --shell /bin/sh bo-ops
log="$(bash "$OPS/install.sh" "$RELEASE" 2>&1)" && ok "install.sh installs" || nok "install.sh failed" "$log"
check "wrapper root:root 0755"      '[[ "$(stat -c "%U:%G %a" "$BIN")" == "root:root 755" ]]'
check "audit SQL root:root 0644"    '[[ "$(stat -c "%U:%G %a" "$LIB/trip-confirmed-audit.sql")" == "root:root 644" ]]'
check "sudoers root:root 0440"      '[[ "$(stat -c "%U:%G %a" "$SUDOERS")" == "root:root 440" ]]'
check "sudoers passes visudo -cf"   'visudo -cf "$SUDOERS" >/dev/null'
check "sudoers pins the digest and the exact argument, no wildcard" \
  'grep -q "sha256:$(sha256sum < "$BIN" | cut -d" " -f1) $BIN trip-confirmed-audit," "$SUDOERS" && ! grep -q "\*" "$SUDOERS"'
log="$(bash "$OPS/install.sh" "$RELEASE" 2>&1 || true)"
check "a second install changes nothing" '[[ "$(grep -c "^unchanged" <<< "$log")" == 4 && "$(grep -c "^installed" <<< "$log" || true)" == 0 ]]' "$log"
chown nobody "$LIB/SOURCE"
check "install.sh refuses a target that is not root's" '! bash "$OPS/install.sh" "$RELEASE" >/dev/null 2>&1'
chown root:root "$LIB/SOURCE"
check "install.sh refuses a non-sha source commit" '! bash "$OPS/install.sh" main >/dev/null 2>&1'
printf 'this is not sudoers syntax\n' > /etc/sudoers.d/zz-e2e-broken
chmod 440 /etc/sudoers.d/zz-e2e-broken
log="$(bash "$OPS/install.sh" "$RELEASE" 2>&1 || true)"
check "install.sh refuses to add to a sudo configuration that is already invalid" 'grep -q "already invalid" <<< "$log"' "$log"
rm -f /etc/sudoers.d/zz-e2e-broken

echo "== requests are refused before anything else happens"
REQ='' run bogus-operation;                         expect "unknown operation"          2 'error\|2\|unknown operation'
REQ='' run;                                         expect "no operation"               2 'usage'
REQ='' run trip-confirmed-audit extra;              expect "a second argument"          2 'usage'
REQ=$'sql=DELETE FROM trip_schedules\n' run trip-confirmed-audit; expect "no SQL can be passed" 2 'unknown request key: sql'
REQ=$'github_run=1; id\n' run trip-confirmed-audit; expect "shell syntax in the run id" 2 'github_run'
REQ="$(head -c 17000 /dev/zero | tr '\0' a)" run trip-confirmed-audit; expect "an oversized request" 2 'larger than 16 KiB'
for bad in 'all' '*' '' "$A1;id" "$A1 $A2" "${A1^^}" "$A1,$A1" "' OR 1=1 --" '$(id)' '`id`' "${A1:0:35}" \
           "$A1,../../etc/passwd" "$A1)); DROP TABLE trip_schedules; --"; do
  REQ="$(normalize_req "$bad")" run trip-confirmed-normalize
  expect "ids refused: ${bad:0:40}" 2 'ids must be explicit|listed twice'
done
REQ="$(normalize_req "$(for i in $(seq 1 201); do printf 'a0000000-0000-4000-8000-%012d,' "$i"; done | sed 's/,$//')")" run trip-confirmed-normalize
expect "more than 200 ids"            2 'at most 200'
REQ="$(printf 'ids=%s\nsql=SELECT 1\n' "$A1"; normalize_req "$A1" | sed 1d)" run trip-confirmed-normalize
expect "an injected key line"         2 'unknown request key: sql'
REQ="$(normalize_req "$A1"; printf 'by=other@example.com\n')" run trip-confirmed-normalize
expect "a duplicated key"             2 'duplicate request key: by'
REQ="$(normalize_req "$A1" | sed 's/^by=.*/by=x;id@example.com/')" run trip-confirmed-normalize
expect "a hostile actor email"        2 'by must be'
for sha in HEAD ABCDEF0123456789ABCDEF0123456789ABCDEF01 "${RELEASE:0:39}" "$RELEASE;id"; do
  REQ="$(normalize_req "$A1" "$sha")" run trip-confirmed-normalize
  expect "expected release refused: $sha" 2 'expected_release must be'
done
REQ="$(normalize_req "$A1" | grep -v '^by=')" run trip-confirmed-normalize
expect "a missing actor"              2 'by must be'

echo "== the database target: exactly one, by compose labels and image"
REQ='' run trip-confirmed-audit;      expect "no postgres container: refuse" 4 'found 0'
# shellcheck disable=SC2046
docker run -d --name "$PG" $(labels postgres) -e POSTGRES_USER=ops -e "POSTGRES_PASSWORD=$PG_PASSWORD" -e POSTGRES_DB=bo postgres:17-alpine >/dev/null
wait_pg
for migration in "$REPO"/backend/migrations/0*.sql; do psql_pg -1 < "$migration" >/dev/null; done
psql_pg < "$HERE/fixtures.sql" >/dev/null
fingerprint() { psql_pg -c "SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM trip_schedules t" -c "SELECT md5(string_agg(a::text, '|' ORDER BY a.id)) FROM trip_driver_assignments a" -c "SELECT count(*) FROM trip_status_history"; }
before="$(fingerprint)"
REQ=$'github_run=42-1\ngithub_actor=octocat\n' run trip-confirmed-audit
expect "exactly one target: the audit runs" 0 "meta\|container\|$PG$" 'meta\|database\|bo$' 'meta\|transaction_read_only\|on$' \
  'meta\|compose_project\|hoanglong-bo$' 'meta\|compose_service\|postgres$' "meta\|audit_sql_sha256\|$pin$" "meta\|installed_from\|$RELEASE$" \
  'meta\|backend_release\|unavailable$' 'meta\|closed_state_constraint\|validated$'
expect "counts by classification and stamp" 0 "$AUDIT_RAN\|5$" 'count\|ELIGIBLE\|3$' 'count\|CONFLICT_PENDING_COMPLETION\|1$' \
  'count\|CONFLICT_CLOSED_PARTIAL\|0$' 'count\|SKIPPED_ARCHIVED\|1$' 'count\|CLOSED_COMPLETE\|1$' 'count\|CLOSED_MISSING\|4$' 'count\|CLOSED_PARTIAL\|0$'
expect "assignment and temporal summaries" 0 'assignments\|active\|1$' 'assignments\|ended\|1$' 'temporal\|pickup_day_mismatch\|1$' 'temporal\|delivery_not_after_pickup\|1$'
expect "complete id lists, in date order" 0 "ids\|ELIGIBLE\|$A1,$A2,$A5$" "ids\|CONFLICT_PENDING_COMPLETION\|$A3$" "ids\|SKIPPED_ARCHIVED\|$A4$" 'ids\|CLOSED_PARTIAL\|$'
check "trips that are not legacy confirmed never appear" '! grep -qE "$A6|$A7" <<< "$OUT"'
check "every output line is a section|key|value fact" '! grep -vqE "^(meta|count|temporal|assignments|ids|warn)\|" <<< "$OUT"' "$OUT"
check "the audit changed nothing" '[[ "$(fingerprint)" == "$before" ]]'
check "the audit session refuses a write" \
  'grep -q "read-only transaction" <<< "$(docker exec -e "PGOPTIONS=-c default_transaction_read_only=on" "$PG" psql -X -q -U ops -d bo -c "UPDATE trip_schedules SET note = NULL" 2>&1 || true)"'
# shellcheck disable=SC2046
docker run -d --name "$PG-twin" $(labels postgres) --entrypoint sleep postgres:17-alpine infinity >/dev/null
REQ='' run trip-confirmed-audit;      expect "two postgres containers: refuse" 4 'found 2'
docker rm -f "$PG-twin" >/dev/null
docker stop "$PG" >/dev/null
# shellcheck disable=SC2046
docker run -d --name "$PG-impostor" $(labels postgres) --entrypoint sleep node:24-alpine infinity >/dev/null
REQ='' run trip-confirmed-audit;      expect "right labels, wrong image: refuse" 4 'expected postgres:17-alpine'
docker rm -f "$PG-impostor" >/dev/null
REQ='' run trip-confirmed-audit;      expect "postgres stopped: refuse" 4 'found 0'
docker start "$PG" >/dev/null
wait_pg

echo "== a half closing stamp, once the constraint is gone"
psql_pg -c 'ALTER TABLE trip_schedules DROP CONSTRAINT trip_schedules_closed_state' \
  -c "INSERT INTO trip_schedules (id, scheduled_on, status, created_by, closed_at) VALUES ('$A8', '2026-08-17', 'confirmed', '00000000-0000-4000-8000-0000000000b0', now())" >/dev/null
REQ='' run trip-confirmed-audit
expect "CLOSED_PARTIAL is a conflict, listed twice over" 0 'meta\|closed_state_constraint\|absent$' 'count\|CONFLICT_CLOSED_PARTIAL\|1$' \
  "ids\|CONFLICT_CLOSED_PARTIAL\|$A8$" "ids\|CLOSED_PARTIAL\|$A8$"

echo "== normalize: release, preflight, apply, outcomes"
REQ="$(normalize_req "$A1")" run trip-confirmed-normalize;  expect "no backend container: refuse" 4 'backend container, found 0'
start_backend "" "$RELEASE"
REQ="$(normalize_req "$A1")" run trip-confirmed-normalize;  expect "an unlabelled backend: refuse" 5 'deployed release unknown'
start_backend "$RELEASE" "$OTHER"
REQ="$(normalize_req "$A1")" run trip-confirmed-normalize;  expect "label and image disagree: refuse" 5 'does not carry the release'
start_backend "$RELEASE" "$RELEASE"
REQ="$(normalize_req "$A1" "$OTHER")" run trip-confirmed-normalize
expect "release SHA mismatch: refuse" 5 "deployed release $RELEASE is not the approved $OTHER"
check "  ...and the CLI was never called" '[[ -z "$(cli_calls)" ]]'
docker exec "$BE" rm "$CLI_PATH"
REQ="$(normalize_req "$A1")" run trip-confirmed-normalize;  expect "a release without the CLI: refuse" 5 'no normalization CLI'
start_backend "$RELEASE" "$RELEASE"
REQ="$(normalize_req "$A1,$A3,$A4,$A6,$A8,$NOBODY_ID")" run trip-confirmed-normalize
expect "preflight: any non-ELIGIBLE id refuses the whole run" 6 "preflight\|$A1\|ELIGIBLE$" \
  "preflight\|$A3\|CONFLICT_PENDING_COMPLETION$" "preflight\|$A4\|SKIPPED_ARCHIVED$" "preflight\|$A6\|NOT_A_LEGACY_CONFIRMED_TRIP$" \
  "preflight\|$A8\|CONFLICT_CLOSED_PARTIAL$" "preflight\|$NOBODY_ID\|NOT_A_LEGACY_CONFIRMED_TRIP$" 'nothing was written'
check "  ...and the CLI was never called" '[[ -z "$(cli_calls)" ]]'
REQ="$(normalize_req "$A1,$A2")" run trip-confirmed-normalize
expect "all ELIGIBLE, right release: applied" 0 'meta\|database\|bo$' "meta\|backend_release\|$RELEASE$" \
  "result\|$A1\|NORMALIZED$" "result\|$A2\|NORMALIZED$" 'done\|normalized\|2$'
calls="$(cli_calls)"
check "  ...the CLI got exactly --apply --by <email> --ids <the supplied ids>" \
  '[[ "$calls" == "[\"--apply\",\"--by\",\"ops@example.com\",\"--ids\",\"$A1,$A2\"]" ]]' "$calls"
steer_cli "{\"$A2\": \"SKIPPED_STATE_CHANGED\"}"
REQ="$(normalize_req "$A1,$A2")" run trip-confirmed-normalize
expect "a row that changed under its lock: reported, run fails" 7 "result\|$A1\|NORMALIZED$" "result\|$A2\|SKIPPED_STATE_CHANGED$" '1 of 2 ids were left unchanged'
steer_cli '{"mode": "garbage"}'
REQ="$(normalize_req "$A1")" run trip-confirmed-normalize;  expect "unreadable CLI output: fail, say so" 1 'cannot verify'
steer_cli '{"mode": "drop-last"}'
REQ="$(normalize_req "$A1,$A2")" run trip-confirmed-normalize; expect "an id missing from the CLI output: fail" 1 'cannot verify'
steer_cli '{"mode": "fail"}'
REQ="$(normalize_req "$A1")" run trip-confirmed-normalize;  expect "CLI failure: fail, state unknown" 1 'MAY have been normalized'
docker exec "$BE" rm -f /app/e2e/outcomes /app/e2e/cli-calls

echo "== the transport: connect.sh -> sshd -> forced command -> sudo -> wrapper"
if [[ -x /usr/sbin/sshd ]] && command -v ssh >/dev/null; then
  ssh_dir="$(mktemp -d)"
  ssh-keygen -q -t ed25519 -N '' -C bo-prod-ops@e2e -f "$ssh_dir/client"
  ssh-keygen -q -t ed25519 -N '' -f "$ssh_dir/host"
  ssh-keygen -q -t ed25519 -N '' -f "$ssh_dir/impostor"
  usermod -p '*' bo-ops  # as the runbook: no password, but not '!'-locked
  home=/home/bo-ops
  install -d -o bo-ops -m 755 "$home"
  install -o bo-ops -m 644 /dev/null "$home/.profile"  # what useradd --create-home would leave behind
  log="$(bash "$OPS/install.sh" "$RELEASE" "$ssh_dir/client.pub" 2>&1 || true)"
  check "install.sh refuses a home holding files that are not root's" \
    'grep -q "not owned by root" <<< "$log" && [[ ! -e "$home/.ssh/authorized_keys" ]]' "$log"
  rm -rf "$home"
  log="$(bash "$OPS/install.sh" "$RELEASE" "$ssh_dir/client.pub" 2>&1 || true)"
  read -r forced <<'EOF'
restrict,command="sudo -n /usr/local/sbin/bo-prod-ops \"$SSH_ORIGINAL_COMMAND\""
EOF
  check "authorized_keys is exactly the restricted, forced-command line, root:root 0644" \
    '[[ "$(stat -c "%U:%G %a" "$home/.ssh/authorized_keys")" == "root:root 644" && "$(cat "$home/.ssh/authorized_keys")" == "$forced $(cat "$ssh_dir/client.pub")" ]]' "$log"
  check "every path sshd reads for bo-ops is root's: home and .ssh root:root 0755, nothing else inside" \
    '[[ "$(stat -c "%U:%G %a" "$home" "$home/.ssh" | tr "\n" " ")" == "root:root 755 root:root 755 " && -z "$(find "$home" ! -user root)" && "$(find "$home" -mindepth 1 | sort | tr "\n" " ")" == "$home/.ssh $home/.ssh/authorized_keys " ]]'
  # ★ A CONTROL ACCOUNT WITH THE SAME KEY AND NO RESTRICTION. This sshd allows
  # every capability server-wide, so whatever the control key can do and bo-ops
  # cannot is refused by the key's own options - not by a lenient test config.
  readonly CONTROL=bo-e2e-control
  id -u "$CONTROL" >/dev/null 2>&1 || useradd --create-home --shell /bin/sh "$CONTROL"
  usermod -p '*' "$CONTROL"
  install -d -o "$CONTROL" -m 700 "/home/$CONTROL/.ssh"
  install -o "$CONTROL" -m 600 "$ssh_dir/client.pub" "/home/$CONTROL/.ssh/authorized_keys"
  install -d -m 755 /run/sshd
  printf '%s\n' 'Port 2222' 'ListenAddress 127.0.0.1' "HostKey $ssh_dir/host" "PidFile $ssh_dir/sshd.pid" 'LogLevel DEBUG1' \
    'AuthorizedKeysFile .ssh/authorized_keys' "AllowUsers bo-ops $CONTROL" 'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' 'StrictModes yes' 'PermitTTY yes' 'AllowTcpForwarding yes' \
    'AllowAgentForwarding yes' 'X11Forwarding yes' 'Subsystem sftp internal-sftp' > "$ssh_dir/sshd_config"
  /usr/sbin/sshd -f "$ssh_dir/sshd_config" -E "$ssh_dir/sshd.log"
  prepare() {  # prepare <host public key file>: runs connect.sh as a workflow would
    local host_key="$1"
    RUNNER_TEMP="$ssh_dir" GITHUB_ENV="$ssh_dir/env" PROD_OPS_HOST=127.0.0.1 PROD_OPS_PORT=2222 \
      PROD_OPS_SSH_KEY="$(cat "$ssh_dir/client")" PROD_OPS_KNOWN_HOSTS="[127.0.0.1]:2222 $(cut -d' ' -f1,2 "$host_key")" \
      bash "$OPS/github/connect.sh" >/dev/null
  }
  cfg="$ssh_dir/prod-ops-ssh/config"
  over_ssh() { set +e; OUT="$(printf '%s' "${REQ:-}" | timeout 30 ssh -F "$cfg" "$@" 2>&1)"; RC=$?; set -e; ALL+="$OUT"$'\n'; }
  as_control() { over_ssh -l "$CONTROL" "$@"; }
  sshd_says() { local pattern="$1"; grep -c -- "$pattern" "$ssh_dir/sshd.log" || true; }
  tunnel() {  # tunnel <user> <local port>: the first bytes a connection through `ssh -L` receives
    local who="$1" port="$2" pid
    ssh -F "$cfg" -l "$who" -o ClearAllForwardings=no -N -L "127.0.0.1:$port:127.0.0.1:2222" prod-ops 2>/dev/null &
    pid=$!
    for _ in $(seq 1 40); do (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break; sleep 0.25; done
    timeout 5 bash -c 'exec 3<>"/dev/tcp/127.0.0.1/$1"; head -c 7 <&3' _ "$port" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  }
  prepare "$ssh_dir/host.pub"
  for _ in $(seq 1 20); do REQ='' over_ssh prod-ops trip-confirmed-audit; [[ "$RC" == 255 ]] || break; sleep 0.5; done
  REQ=$'github_run=7-1\ngithub_actor=octocat\n' over_ssh prod-ops trip-confirmed-audit
  expect "the audit, over ssh, exactly as the workflow sends it" 0 "$AUDIT_RAN\|6$" "ids\|ELIGIBLE\|$A1,$A2,$A5$"
  REQ="$(normalize_req "$A1")" over_ssh prod-ops trip-confirmed-normalize
  expect "the normalization, over ssh, request on stdin" 0 "result\|$A1\|NORMALIZED$"

  echo "   escapes - refused for bo-ops, granted to the unrestricted control key on the same sshd"
  REQ=$'id\nexit\n' over_ssh -o RequestTTY=force prod-ops
  check "ssh bo-ops@host: no pty, no shell - typed commands never run" \
    '[[ "$RC" != 0 ]] && grep -q "PTY allocation request failed" <<< "$OUT" && ! grep -q "uid=" <<< "$OUT"' "$OUT"
  check "  sshd: a pty is not permitted for this key" '(( $(sshd_says "Allocating a pty not permitted") >= 1 ))'
  REQ=$'id\nexit\n' as_control -o RequestTTY=force prod-ops
  check "  control: the same request gets a pty and a shell" '! grep -q "PTY allocation request failed" <<< "$OUT" && grep -q "uid=" <<< "$OUT"' "$OUT"
  for hostile in id 'trip-confirmed-audit; id' 'sh -c id' 'sudo -n /bin/sh' 'scp -t /tmp' ''; do
    REQ='' over_ssh prod-ops "$hostile"
    check "ssh bo-ops@host '${hostile:-<no command>}': nothing but the forced command runs" \
      '[[ "$RC" != 0 ]] && ! grep -qE "uid=|count\|" <<< "$OUT"' "$OUT"
  done
  REQ='' as_control prod-ops id
  check "  control: 'id' runs" 'grep -q "uid=" <<< "$OUT"' "$OUT"
  refused_before="$(sshd_says "refused local port forward")"
  got="$(tunnel bo-ops 15990)"
  check "ssh -L: nothing reaches the far end through bo-ops" '[[ -z "$got" ]] && (( $(sshd_says "refused local port forward") > refused_before ))' "$got"
  got="$(tunnel "$CONTROL" 15991)"
  check "  control: the same tunnel reaches it" '[[ "$got" == SSH-2.0 ]]' "$got"
  REQ='' over_ssh -o ClearAllForwardings=no -W 127.0.0.1:2222 prod-ops
  check "ssh -W: stdio forwarding refused" '[[ "$RC" != 0 ]] && grep -q "stdio forwarding failed" <<< "$OUT" && ! grep -q "SSH-2.0" <<< "$OUT"' "$OUT"
  REQ='' as_control -o ClearAllForwardings=no -W 127.0.0.1:2222 prod-ops
  check "  control: -W reaches the far end" 'grep -q "SSH-2.0" <<< "$OUT"' "$OUT"
  REQ='' over_ssh -o ClearAllForwardings=no -o ExitOnForwardFailure=yes -R 127.0.0.1:15433:127.0.0.1:1 prod-ops trip-confirmed-audit
  check "ssh -R: remote forwarding refused" '[[ "$RC" != 0 ]] && grep -q "remote port forwarding failed" <<< "$OUT"' "$OUT"
  REQ='' as_control -o ClearAllForwardings=no -o ExitOnForwardFailure=yes -R 127.0.0.1:15434:127.0.0.1:1 prod-ops true
  check "  control: -R is granted" '[[ "$RC" == 0 ]]' "$OUT"
  eval "$(ssh-agent -s)" >/dev/null
  ssh-add -q "$ssh_dir/client"
  agent_before="$(sshd_says "agent forwarding disabled")"
  REQ='' over_ssh -o ForwardAgent=yes prod-ops trip-confirmed-audit
  check "ssh -A: agent forwarding refused (the operation itself still runs)" \
    '[[ "$RC" == 0 ]] && (( $(sshd_says "agent forwarding disabled") == agent_before + 1 ))' "$OUT"
  REQ='' as_control -o ForwardAgent=yes prod-ops 'echo "agent=$SSH_AUTH_SOCK"'
  check "  control: -A is granted" 'grep -q "agent=/" <<< "$OUT"' "$OUT"
  ssh-agent -k >/dev/null
  REQ='' DISPLAY=:0 over_ssh -o ForwardX11=yes -o ForwardX11Trusted=yes prod-ops trip-confirmed-audit
  check "ssh -X: X11 forwarding refused" 'grep -q "X11 forwarding request failed" <<< "$OUT"' "$OUT"
  REQ='' DISPLAY=:0 as_control -o ForwardX11=yes -o ForwardX11Trusted=yes prod-ops 'echo "display=$DISPLAY"'
  check "  control: -X is granted" 'grep -q "display=localhost:" <<< "$OUT"' "$OUT"
  set +e; OUT="$(printf 'ls /\n' | timeout 30 sftp -F "$cfg" -b - prod-ops 2>&1)"; RC=$?; set -e
  check "sftp: no file access" '[[ "$RC" != 0 ]] && ! grep -q "/etc" <<< "$OUT"' "$OUT"
  set +e; OUT="$(printf 'ls /\n' | timeout 30 sftp -F "$cfg" -o "User=$CONTROL" -b - prod-ops 2>&1)"; RC=$?; set -e
  check "  control: sftp lists /" 'grep -q "/etc" <<< "$OUT"' "$OUT"
  prepare "$ssh_dir/impostor.pub"
  REQ='' over_ssh prod-ops trip-confirmed-audit
  expect "a host key other than the pinned one: no connection" 255 'Host key verification failed'
  kill "$(cat "$ssh_dir/sshd.pid")"
else
  printf '  note  no sshd/ssh here - the transport was not exercised\n'
fi

echo "== integrity: the wrapper refuses files it cannot trust"
printf ' ' >> "$LIB/trip-confirmed-audit.sql"
REQ='' run trip-confirmed-audit;      expect "a modified audit SQL" 3 'reviewed checksum'
bash "$OPS/install.sh" "$RELEASE" >/dev/null
chmod g+w "$LIB"
REQ='' run trip-confirmed-audit;      expect "a group-writable asset directory" 3 "$LIB is missing, not root-owned"
chmod 755 "$LIB"
chown nobody "$BIN"
REQ='' run trip-confirmed-audit;      expect "a wrapper not owned by root" 3 "$BIN is missing, not root-owned"
chown root:root "$BIN"
REQ='' run trip-confirmed-audit;      expect "restored: runs again" 0 "$AUDIT_RAN"

echo "== sudo: exactly two commands, one argument each, this exact file"
REQ='' as_ops sudo -n "$BIN" trip-confirmed-audit;     expect "bo-ops may run the audit" 0 "$AUDIT_RAN"
REQ="$(normalize_req "$A1")" as_ops sudo -n "$BIN" trip-confirmed-normalize; expect "bo-ops may run the normalization" 0 "result\|$A1\|NORMALIZED$"
for denied in "$BIN trip-confirmed-audit extra" "$BIN trip-confirmed-audit;id" "$BIN" "$BIN bogus" "/bin/sh -c id" "/usr/bin/docker ps" "-E $BIN trip-confirmed-audit" "-u nobody $BIN trip-confirmed-audit"; do
  # shellcheck disable=SC2086 # the word split is the test
  REQ='' as_ops sudo -n $denied
  check "sudo refuses: sudo -n ${denied/#$BIN/bo-prod-ops}" '[[ "$RC" != 0 ]] && ! grep -q "count|" <<< "$OUT"' "$OUT"
done
REQ='' as_ops env 'SSH_ORIGINAL_COMMAND=trip-confirmed-audit; id' sh -c 'sudo -n /usr/local/sbin/bo-prod-ops "$SSH_ORIGINAL_COMMAND"'
check "the forced command passes a hostile ssh command as ONE refused argument" '[[ "$RC" != 0 ]] && ! grep -q "uid=" <<< "$OUT"' "$OUT"
REQ='' as_ops env 'SSH_ORIGINAL_COMMAND=trip-confirmed-audit' sh -c 'sudo -n /usr/local/sbin/bo-prod-ops "$SSH_ORIGINAL_COMMAND"'
expect "the forced command runs the audit it names" 0 "$AUDIT_RAN"
printf '\n# tampered\n' >> "$BIN"
REQ='' as_ops sudo -n "$BIN" trip-confirmed-audit
check "sudo refuses a wrapper whose sha256 is not the installed one" '[[ "$RC" != 0 ]] && ! grep -q "count|" <<< "$OUT"' "$OUT"
bash "$OPS/install.sh" "$RELEASE" >/dev/null
rules="$(sudo -l -U bo-ops | grep -E '^[[:space:]]+\(' || true)"
check "sudo -l lists the two operations and nothing else" \
  '[[ "$(wc -l <<< "$rules")" == 1 && "$(sed "s/^.*NOPASSWD: *//" <<< "$rules" | tr "," "\n" | sed "s/^ *//" | grep -cvxE "sha256:[0-9a-f]{64} $BIN trip-confirmed-(audit|normalize)")" == 0 && "$(tr "," "\n" <<< "$rules" | wc -l)" == 2 ]]' \
  "$(sudo -l -U bo-ops)"

echo "== the record: journal, and no secrets or personal data anywhere"
if command -v journalctl >/dev/null && systemctl is-active -q systemd-journald 2>/dev/null; then
  check "the journal records the requested ids and their outcomes" \
    'journalctl -q -t bo-prod-ops --no-pager | grep -q "requested id=$A1 by=ops@example.com release=$RELEASE" && journalctl -q -t bo-prod-ops --no-pager | grep -q "result id=$A1 outcome=NORMALIZED"'
else
  printf '  note  no journald on this host to read the log back from\n'
fi
hidden=()
for dir in /usr/sbin /usr/bin /sbin /bin; do
  if [[ -e "$dir/logger" || -L "$dir/logger" ]]; then mv "$dir/logger" "$dir/logger.e2e-off"; hidden+=("$dir/logger"); fi
done
REQ='' run trip-confirmed-audit
expect "without a logger the wrapper says so, and still runs" 0 'warn\|journal\|logger unavailable' "$AUDIT_RAN"
for moved in "${hidden[@]}"; do mv "$moved.e2e-off" "$moved"; done
for secret in "$PG_PASSWORD" PII-SENTINEL 7777777 6666666 5555555; do
  check "never printed: $secret" '! grep -qF -- "$secret" <<< "$ALL"'
done

echo
echo "e2e: $pass passed, $failed failed"
(( failed == 0 ))
