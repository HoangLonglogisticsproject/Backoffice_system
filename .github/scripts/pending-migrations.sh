#!/usr/bin/env bash
#
# Which migrations has this database NOT applied yet?
#
# ★ THE DATABASE IS THE SOURCE OF TRUTH, NOT THE DIFF. The release pipeline used
# to decide "does this need a backup?" by asking whether the commit range touched
# `backend/migrations/`. That answers a different question. Consider:
#
#   Release A  adds 0011, takes a dump, and the migration FAILS. The runner rolls
#              0011 back and does not record it. The old container keeps serving.
#   Release B  changes one line of TypeScript. Nothing under `migrations/` moved,
#              so a diff-based gate says "no backup needed" — and then `migrate`
#              runs anyway and applies 0011, unprotected.
#
# The diff was never evidence about the database. `schema_migrations` is.
#
# ★ IT READS, IT NEVER WRITES. Deciding whether to back up must not itself change
# the thing being backed up. The migration runner has no status mode — asking it
# what is pending IS applying it — so this compares the ledger against the files
# instead. Two statements, both read-only, neither creating the ledger.
#
# ★ THE FILE LIST COMES FROM THE RELEASE IMAGE. Not from the working tree: the
# image is what will run `migrate`, and reading anything else would be answering
# about a different artifact. `docker compose build` must have run first.
#
# Usage:
#   pending-migrations.sh <compose-dir> <pg-user> <pg-db>   list pending, one per line
#   pending-migrations.sh --compare <applied-file> <files-file>
#   pending-migrations.sh --self-test
#
# Prints nothing and exits 0 when the schema is up to date.

set -euo pipefail

# ---------------------------------------------------------------- the sums --
#
# Set difference, kept separate from everything that touches Docker or psql so
# it can be tested without either. `comm -23` prints lines in the first list that
# are absent from the second; both must be sorted, which is why they are sorted
# here rather than being trusted to arrive that way.
compare() {
  local applied_file="$1" files_file="$2"
  comm -23 \
    <(sed '/^[[:space:]]*$/d' "$files_file" | sort -u) \
    <(sed '/^[[:space:]]*$/d' "$applied_file" | sort -u)
}

# ------------------------------------------------------------- the ledger --
#
# ★ TWO STATEMENTS, NOT ONE CLEVER ONE. The obvious version wraps the select in
# `CASE WHEN to_regclass(...) IS NULL THEN '' ELSE (SELECT …) END` — and it
# fails, because PostgreSQL parses the whole statement before evaluating any
# branch, so naming a table that does not exist is an error no CASE can guard.
# That version LOOKED correct: on an empty database the error produced empty
# output, which happens to mean "everything is pending". It was right by
# accident and would have become a hard failure under ON_ERROR_STOP.
applied_versions() {
  local dir="$1" user="$2" db="$3" exists

  exists="$(
    docker compose -f "$dir/docker-compose.yml" exec -T postgres \
      psql -U "$user" -d "$db" -tAc \
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL" \
      | tr -d '[:space:]'
  )"

  if [[ "$exists" != "t" ]]; then
    # No ledger means nothing has ever been applied here. Every file is pending.
    return 0
  fi

  docker compose -f "$dir/docker-compose.yml" exec -T postgres \
    psql -U "$user" -d "$db" -tAc \
    "SELECT version FROM schema_migrations ORDER BY version" \
    | tr -d '\r'
}

# --------------------------------------------------------- the image files --
image_migrations() {
  local dir="$1"
  docker compose -f "$dir/docker-compose.yml" run --rm -T --interactive=false \
    --no-deps --entrypoint sh backend -c 'ls -1 migrations | grep "\.sql$"' \
    | tr -d '\r'
}

# ---------------------------------------------------------------- self-test --
#
# Covers the comparison, which is the part that decides whether a database gets
# backed up. The psql and docker calls above are wiring, exercised for real by
# the release itself; this is the logic that can be wrong quietly.
self_test() {
  local failures=0 tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  check() {
    local label="$1" expected="$2" applied="$3" files="$4" actual
    printf '%s\n' "$applied" > "$tmp/applied"
    printf '%s\n' "$files" > "$tmp/files"
    actual="$(compare "$tmp/applied" "$tmp/files" | tr '\n' ' ' | sed 's/ *$//')"
    if [[ "$actual" == "$expected" ]]; then
      printf '  ok    %-52s [%s]\n' "$label" "$actual"
    else
      printf '  FAIL  %-52s want [%s], got [%s]\n' "$label" "$expected" "$actual"
      failures=$((failures + 1))
    fi
  }

  local all='0001_a.sql
0002_b.sql
0003_c.sql'

  echo "1. an up-to-date database needs nothing"
  check 'all applied -> no pending' '' "$all" "$all"

  echo "2. a new migration in this release"
  check 'one new file -> that file' '0003_c.sql' '0001_a.sql
0002_b.sql' "$all"

  echo "3. a database that has never been migrated"
  check 'empty ledger -> everything' '0001_a.sql 0002_b.sql 0003_c.sql' '' "$all"

  echo "4. ★ the scenario the diff-based gate got wrong"
  check 'previous release failed at 0003 -> still pending' '0003_c.sql' '0001_a.sql
0002_b.sql' "$all"

  echo "5. noise must not become a phantom migration"
  check 'blank lines in the ledger'   '0003_c.sql' '0001_a.sql

0002_b.sql
' "$all"
  check 'blank lines in the file list' '0003_c.sql' '0001_a.sql
0002_b.sql' '0001_a.sql

0002_b.sql
0003_c.sql
'
  check 'unsorted input still compares' '0003_c.sql' '0002_b.sql
0001_a.sql' '0003_c.sql
0001_a.sql
0002_b.sql'

  echo "6. a ledger row with no file is NOT pending"
  # A migration applied here but absent from this image — a rollback to an older
  # release. It is not something to apply, and it must not be reported as such.
  check 'extra applied row -> nothing pending' '' "$all
0004_d.sql" "$all"

  echo
  if [[ "$failures" -eq 0 ]]; then
    echo "pending-migrations.sh: all checks passed"
  else
    echo "pending-migrations.sh: ${failures} check(s) FAILED" >&2
    return 1
  fi
}

# ------------------------------------------------------------------- entry --
case "${1:-}" in
  --self-test)
    self_test
    ;;
  --compare)
    compare "${2:?applied file required}" "${3:?files list required}"
    ;;
  "")
    echo "usage: pending-migrations.sh <compose-dir> <pg-user> <pg-db> | --compare A F | --self-test" >&2
    exit 2
    ;;
  *)
    dir="$1"
    user="${2:?postgres user required}"
    db="${3:?postgres database required}"
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    applied_versions "$dir" "$user" "$db" > "$work/applied"
    image_migrations "$dir" > "$work/files"
    compare "$work/applied" "$work/files"
    ;;
esac
