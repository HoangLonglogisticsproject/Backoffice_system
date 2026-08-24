#!/usr/bin/env bash
#
# The backend release, as it runs ON THE VPS, AS ROOT.
#
# ★ REACHED ONLY THROUGH `/usr/local/bin/bo-release`. That wrapper is the trust
# anchor: root-owned, never changed, and the only thing `deploy` may run through
# sudo. It validates the sha, checks it out, proves `git rev-parse HEAD` equals
# what was asked for, and only then execs THIS file — which is therefore the
# version belonging to the commit being released. A release brings its own
# deployment logic with it; the anchor on the box stays still.
#
# ★ WHICH MEANS ROOT EXECUTES REPOSITORY CODE. That is not new — `docker build`
# has always run this repository's Dockerfile with root-equivalent privilege —
# but it is worth saying plainly: the gate is branch protection and review, not
# file permissions. What the deploy user gains from this arrangement is that it
# cannot WRITE the repository, so only merged code ever runs.
#
# ★ IT VALIDATES ITS OWN ARGUMENT ANYWAY. The wrapper checks, and sudoers pins
# the shape too, but a sudoers glob is easy to get subtly wrong and this file is
# the last thing standing between a string and a root shell. Three checks that
# disagree are better than one that is trusted.
#
# Usage:
#   vps-release.sh <40-hex-sha>
#   vps-release.sh --self-test
#
# Exit 0  the backend is running <sha> — deployed now, or already was.
# Exit 1  refused or failed; if the container had been replaced, it was rolled
#         back and the failure says whether that succeeded.
# Exit 2  the argument was not a 40-character lowercase hex sha.

set -euo pipefail
IFS=$'\n\t'
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# ★ CONSTANTS, NOT PARAMETERS. Nothing about where the repository lives or where
# the secret is kept may come from the caller — that is the whole point of the
# restricted design. Change them here, in a reviewed commit.
REPO_DIR=/opt/hoanglong-bo
ENV_FILE=/etc/hoanglong-bo/staging.env
COMPOSE_DIR="$REPO_DIR/deploy"
SERVICE=backend
IMAGE=hoanglong-bo-backend
HEALTH_URL=http://127.0.0.1:3000/health
DUMP_DIR=/var/backups/hoanglong-bo
HEALTH_ATTEMPTS=30
HEALTH_INTERVAL=2

log() { printf '%s  %s\n' "$(date -u '+%H:%M:%S')" "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ the sha --
#
# ★ THE ONLY UNTRUSTED INPUT IN THIS FILE. Everything a shell could be made to
# do with a hostile string is closed off by the shape alone:
#
#   no space, tab or newline   cannot become a second word or a second command
#   no ; | & $ ` ( ) < >       cannot become a command substitution or a pipe
#   no leading -               cannot become a `git` OPTION, which is the one
#                              people forget: `checkout --detach --upload-pack=…`
#   no / or ..                 cannot become a path
#   exactly 40 lowercase hex   cannot be a ref name, a branch, or `HEAD`
#
# Lowercase deliberately: git accepts an uppercase sha, but `git rev-parse HEAD`
# answers in lowercase, so allowing both would make the equality check in the
# wrapper compare two spellings of the same commit and refuse a valid release.
valid_sha() {
  [[ "${1-}" =~ ^[0-9a-f]{40}$ ]]
}

require_sha() {
  [ "$#" -eq 1 ] || { printf 'usage: vps-release.sh <40-hex-sha>\n' >&2; exit 2; }
  valid_sha "$1" || { printf 'ERROR: not a 40-character lowercase hex sha\n' >&2; exit 2; }
}

# ------------------------------------------------------------ what is running --
#
# Empty when nothing is running, or when the running image predates the label.
# Both read as "unknown", and unknown means deploy: see the caller.
current_sha() {
  local cid
  cid="$(compose ps -q "$SERVICE" 2>/dev/null || true)"
  [ -n "$cid" ] || return 0
  docker inspect --format '{{index .Config.Labels "release.sha"}}' "$cid" 2>/dev/null || true
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.yml" "$@"
}

# ------------------------------------------------------------------- gates --
gate_health() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      log "health OK on attempt ${attempt}"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  log "health NEVER came up after $((HEALTH_ATTEMPTS * HEALTH_INTERVAL))s"
  return 1
}

# "Is it alive" and "is it the build we shipped" are different questions. The
# skew this pipeline exists to prevent was a perfectly healthy container running
# the wrong code; health alone would have called it fine.
gate_identity() {
  local want="$1" running
  running="$(current_sha)"
  if [ "$running" != "$want" ]; then
    log "identity FAILED - container reports '${running:-<unlabelled>}', expected '${want}'"
    return 1
  fi
  log "identity OK - running ${running}"
  return 0
}

# ---------------------------------------------------------------- rollback --
#
# ⚠ CODE ROLLBACK IS NOT SCHEMA ROLLBACK. Migrations here are forward-only and
# refuse rather than repair, so restoring the previous image does not undo one
# that ran. If this release migrated, the dump named in the log is the only way
# back — and restoring it is a decision a person makes, never this file.
#
# ★ TWO FAILURES, TWO EXIT CODES, because they need different sentences. "We
# tried to roll back and the old version would not come up" and "there was
# nothing to roll back to" are read by the same person at the same hour, and the
# first draft of this said the former for both — on a FIRST deployment, where no
# rollback had been attempted at all. That line is what lands in the Actions
# error annotation, so it is the one sentence that has to be true.
#
#   0  rolled back and healthy
#   1  rolled back, still not healthy
#   2  nothing to roll back to - nothing was attempted
roll_back_to() {
  local previous="$1"

  if [ -z "$previous" ]; then
    log "NO previous release recorded - nothing to roll back to, nothing attempted"
    log "  the backend is left running the failed release; recover by hand:"
    log "    docker images $IMAGE"
    return 2
  fi

  if ! docker image inspect "${IMAGE}:${previous}" >/dev/null 2>&1; then
    log "image ${IMAGE}:${previous} is gone - nothing to roll back to"
    return 2
  fi

  log "rolling back to ${previous}"
  APP_VERSION="$previous" compose up -d --no-build "$SERVICE"

  if gate_health && gate_identity "$previous"; then
    log "rolled back to ${previous} and healthy"
    return 0
  fi

  log "ROLLED BACK BUT NOT HEALTHY - the service is down and needs a person"
  return 1
}

# --------------------------------------------------------------- the schema --
#
# Two different questions, and they coincide only when something is pending:
#   does the schema need CHANGING?   -> decides the backup
#   does the schema MATCH the repo?  -> checked every single time
#
# `migrate` is also what walks every ALREADY applied migration comparing its
# recorded checksum against the file in this image. A migration edited after it
# was applied produces no pending row, so skipping `migrate` when nothing is
# pending would skip the only thing that catches it.
settle_schema() {
  local pg_user pg_db pending still dump

  # ★ THE DATABASE HAS TO BE UP BEFORE WE CAN ASK IT ANYTHING. On this VPS
  # postgres runs continuously, so the first version of this script simply
  # assumed it — and then a sandbox run on a cold stack failed here with
  # `service "postgres" is not running`, which says nothing about what to do.
  # After a reboot, or any `compose down`, the very first release would have hit
  # that. `--wait` blocks on the healthcheck already declared for the service, so
  # this is idempotent when it is already running and correct when it is not.
  compose up -d --wait postgres

  pg_user="$(sed -n 's/^POSTGRES_USER=//p' "$ENV_FILE" | head -1)"
  pg_db="$(sed -n 's/^POSTGRES_DB=//p' "$ENV_FILE" | head -1)"
  [ -n "$pg_user" ] || die "POSTGRES_USER is missing from $ENV_FILE"
  [ -n "$pg_db" ] || die "POSTGRES_DB is missing from $ENV_FILE"

  pending="$(bash "$REPO_DIR/.github/scripts/pending-migrations.sh" \
    "$COMPOSE_DIR" "$ENV_FILE" "$pg_user" "$pg_db")"

  if [ -n "$pending" ]; then
    log "pending migrations on this database:"
    printf '%s\n' "$pending" | sed 's/^/    /'

    # The backup is a GATE. A forward-only migration with no dump behind it is a
    # change with no way back. `set -e` aborts on a failing pg_dump, but a
    # redirect truncates its target BEFORE the command runs, so a dump that dies
    # early leaves a plausible-looking file. The size check is what turns "a
    # file exists" into "a backup exists".
    install -d -m 700 "$DUMP_DIR"
    dump="${DUMP_DIR}/pre-${RELEASE_SHA:0:12}-$(date -u +%Y%m%d-%H%M%S).dump"
    log "dumping to $dump before touching the schema"

    if ! compose exec -T postgres pg_dump -U "$pg_user" -Fc "$pg_db" > "$dump"; then
      rm -f "$dump"
      die "pg_dump FAILED - refusing to migrate. Nothing has been changed."
    fi
    if [ ! -s "$dump" ]; then
      rm -f "$dump"
      die "pg_dump produced an empty file - refusing to migrate."
    fi
    ls -lh "$dump"
  else
    log "nothing pending - no dump taken, but the schema is still verified below"
  fi

  # ★ ALWAYS, PENDING OR NOT. With nothing pending this applies nothing — it
  # computes the same difference the script above does, so it CANNOT apply what
  # that gate did not see — and it still verifies every applied migration's
  # checksum. CI cannot do this: it drops and recreates its database every run,
  # so nothing there has ever been "already applied".
  compose run --rm -T --interactive=false --no-deps "$SERVICE" npm run migrate

  # The runner exits 0 both when it applies and when it has nothing to do, so
  # its exit code alone cannot say the schema arrived. Ask the ledger again.
  still="$(bash "$REPO_DIR/.github/scripts/pending-migrations.sh" \
    "$COMPOSE_DIR" "$ENV_FILE" "$pg_user" "$pg_db")"
  if [ -n "$still" ]; then
    printf 'ERROR: migrate exited 0 but these are still unapplied:\n' >&2
    printf '%s\n' "$still" | sed 's/^/    /' >&2
    [ -n "${dump:-}" ] && printf '  the dump is at %s\n' "$dump" >&2
    exit 1
  fi
  log "schema verified and up to date"
}

# ------------------------------------------------------------------- main --
main() {
  require_sha "$@"
  RELEASE_SHA="$1"

  [ -r "$ENV_FILE" ] || die "Cannot read $ENV_FILE - is the runtime env installed?"
  [ -d "$COMPOSE_DIR" ] || die "$COMPOSE_DIR does not exist"

  # ★ CHECKED HERE, BEFORE ANYTHING IS BUILT, because the health gate silences
  # its own probe. `curl … >/dev/null 2>&1` cannot tell "the service is not
  # answering" apart from "curl is not installed", so a missing binary would
  # spend sixty seconds and then report `health NEVER came up` — a message that
  # sends the reader to the wrong machine entirely. Found exactly that way: a
  # sandbox whose PATH had no curl produced a flawless deploy and a nonsense
  # failure.
  command -v curl >/dev/null 2>&1 \
    || die "curl is not on PATH ($PATH) - the health gate cannot run"

  cd "$COMPOSE_DIR"

  local previous
  previous="$(current_sha)"
  log "requested ${RELEASE_SHA}"
  log "running   ${previous:-<unknown>}"

  # ★ ALREADY THERE IS NOT NOTHING TO DO. The image does not need rebuilding and
  # the container does not need replacing — but the DATABASE can have moved
  # underneath it since, most obviously by being restored from a dump. The
  # schema is settled either way; only the expensive half is skipped.
  if [ "$previous" = "$RELEASE_SHA" ]; then
    log "already running this release - skipping build and restart"
    settle_schema
    log "release ${RELEASE_SHA} confirmed"
    return 0
  fi

  export APP_VERSION="$RELEASE_SHA"
  log "building ${IMAGE}:${RELEASE_SHA}"
  compose build "$SERVICE"

  # Everything above this line leaves the running container alone: a failure
  # here exits non-zero with nothing to roll back.
  settle_schema

  log "starting ${RELEASE_SHA}"
  compose up -d "$SERVICE"

  # From here the container HAS been replaced, so a failure needs undoing.
  if gate_health && gate_identity "$RELEASE_SHA"; then
    log "release ${RELEASE_SHA} is live"
    return 0
  fi

  log "gates failed - rolling back"
  local rc=0
  roll_back_to "$previous" || rc=$?
  case "$rc" in
    0) die "release ${RELEASE_SHA} failed its gates; rolled back to ${previous}, which is healthy" ;;
    2) die "release ${RELEASE_SHA} failed its gates and there was NOTHING TO ROLL BACK TO - MANUAL RECOVERY REQUIRED" ;;
    *) die "release ${RELEASE_SHA} failed its gates AND the rollback did not restore health - MANUAL RECOVERY REQUIRED" ;;
  esac
}

# ---------------------------------------------------------------- self-test --
#
# Covers the argument shape, which is the only untrusted input and the only part
# that can be tested without a Docker daemon, a database and a VPS. The flow
# above is exercised for real by the release; this is the piece that must be
# right before anything else gets a chance to run.
self_test() {
  local failures=0

  accepts() {
    if valid_sha "$1"; then
      printf '  ok    accepts  %-58s\n' "${1:0:58}"
    else
      printf '  FAIL  rejected a VALID sha: %s\n' "$1"
      failures=$((failures + 1))
    fi
  }

  rejects() {
    local label="$2"
    if valid_sha "$1"; then
      printf '  FAIL  ACCEPTED %-24s %s\n' "$label" "${1:0:40}"
      failures=$((failures + 1))
    else
      printf '  ok    rejects  %-24s %s\n' "$label" "${1:0:44}"
    fi
  }

  local good=0123456789abcdef0123456789abcdef01234567

  echo "a real sha is accepted"
  accepts "$good"
  accepts aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  accepts ffffffffffffffffffffffffffffffffffffffff

  echo "length is pinned"
  rejects "${good:0:39}"        'one char short'
  rejects "${good}a"            'one char long'
  rejects ''                    'empty'
  rejects "${good:0:7}"         'short sha'

  echo "alphabet is pinned"
  rejects "${good^^}"           'uppercase'
  rejects "0123456789ABCDEF0123456789abcdef01234567" 'mixed case'
  rejects "0123456789abcdeg0123456789abcdef01234567" 'non-hex letter'
  rejects "0123456789abcde 0123456789abcdef0123456"  'embedded space'

  echo "★ command injection cannot survive the shape"
  rejects "${good}; rm -rf /"          'trailing command'
  rejects "${good} && id"              'trailing &&'
  rejects "\$(id)"                     'command substitution'
  rejects '`id`'                       'backticks'
  rejects "${good}|id"                 'pipe'
  rejects "${good}"$'\n'"id"           'embedded newline'
  rejects "${good}"$'\t'"id"           'embedded tab'

  echo "★ option injection cannot survive it either"
  rejects "--upload-pack=id"           'git long option'
  rejects "-${good:0:39}"              'leading dash'

  echo "paths cannot survive it"
  rejects "../../etc/passwd"           'traversal'
  rejects "/etc/hoanglong-bo/staging.env" 'absolute path'
  rejects "HEAD"                       'a ref name'
  rejects "main"                       'a branch name'

  echo
  if [ "$failures" -eq 0 ]; then
    echo "vps-release.sh: all checks passed"
  else
    echo "vps-release.sh: ${failures} check(s) FAILED" >&2
    return 1
  fi
}

case "${1-}" in
  --self-test) self_test ;;
  *)           main "$@" ;;
esac
