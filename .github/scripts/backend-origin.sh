#!/usr/bin/env bash
#
# Read the production backend origin from the ONE file that declares it, prove
# it is usable, and print it. Exit non-zero, loudly, if any of that fails.
#
#   backend-origin.sh [path]     print the validated origin (default path below)
#   backend-origin.sh --self-test
#
# ★ WHY THIS IS A SCRIPT AND NOT SIX LINES IN THE WORKFLOW.
#
# It used to be `vars.BACKEND_ORIGIN`, a GitHub Environment variable, while
# production read a Vercel Project environment variable of the same name. Two
# copies of one fact, with nothing comparing them: the release gate could verify
# one host, promote a frontend that calls another, and report success. The gate
# would have been measuring a backend that no user reaches.
#
# The fix is to delete the second copy rather than try to keep two in agreement.
# `frontend/api/[...path].ts` imports the constant this script reads, so "the
# origin the gate verified" and "the origin production calls" are the same
# string by construction.
#
# Being a script rather than an inline block is what makes that testable: the
# `detect` job runs `--self-test` on every pull request, so the rules below are
# exercised long before a release depends on them.
#
# ⚠ EVERY FAILURE MODE EXITS NON-ZERO. There is deliberately no path through
# this script that prints nothing and succeeds — a caller doing
# `origin="$(backend-origin.sh)"` under `set -e` must not be handed an empty
# string it then curls.
set -euo pipefail
IFS=$'\n\t'

DEFAULT_FILE='frontend/api/backend-origin.ts'

# ★ THE DECLARATION'S SHAPE IS PART OF THE CONTRACT. Pinning the whole line —
# not just "a string containing https" — is what makes "exactly one of these
# exists" a meaningful question to ask. A reformat that breaks this regex fails
# the build rather than silently matching nothing.
DECL_RE="^export const PRODUCTION_BACKEND_ORIGIN = '[^']*';$"
CAPTURE_RE="s/^export const PRODUCTION_BACKEND_ORIGIN = '([^']*)';\$/\1/p"

die() { echo "backend-origin: $*" >&2; exit 1; }

read_origin() {
  local file="$1" found origin rest

  [[ -r "$file" ]] \
    || die "$file is missing or unreadable. It is the only place the backend origin is written down."

  # ★ EXACTLY ONE. Zero means the file was reformatted out from under the regex
  # and this script is now reading nothing. More than one means two values
  # disagree INSIDE the single source of truth, which is precisely the failure
  # this whole arrangement exists to prevent. Neither is a warning.
  found="$(grep -cE "$DECL_RE" "$file" || true)"
  [[ "$found" == 1 ]] \
    || die "expected exactly one PRODUCTION_BACKEND_ORIGIN declaration in $file, found $found."

  origin="$(sed -nE "$CAPTURE_RE" "$file")"

  # ★ EMPTY IS A FAILURE, NEVER A WARNING. The step that calls this used to warn
  # and exit 0 when the origin was unset, which promoted the frontend on the
  # strength of a loopback health check — exactly the skew the gate was added to
  # stop. A gate that passes when it cannot run is not a gate.
  [[ -n "$origin" ]] \
    || die "PRODUCTION_BACKEND_ORIGIN is empty. Refusing to verify a backend that has not been named."

  # ★ https, RE-CHECKED THOUGH resolveOrigin ALREADY REFUSES IT. Two checks that
  # can disagree beat one that is trusted, and they fail at different moments:
  # the proxy's check fails a request in production, this one fails the release
  # before there is a production to fail in. The session cookie rides this hop,
  # so plaintext would put it on the public internet between Vercel and the VPS
  # — and `Secure` on the cookie says nothing about that leg, only the browser's.
  case "$origin" in
    https://*) ;;
    http://*)  die "PRODUCTION_BACKEND_ORIGIN must use https. Plaintext would carry the session cookie in the clear." ;;
    *)         die "PRODUCTION_BACKEND_ORIGIN must be an absolute https URL." ;;
  esac

  # ★ AN ORIGIN, NOT A URL. `new URL(path, base)` resolves against the base's
  # ORIGIN and silently discards any path on it, so `https://host/base` would
  # quietly become `https://host/api/health` — a routing bug that looks like an
  # application fault for as long as it takes somebody to read the proxy.
  rest="${origin#https://}"
  case "$rest" in
    */*) die "PRODUCTION_BACKEND_ORIGIN must be an origin only, with no path." ;;
    '')  die "PRODUCTION_BACKEND_ORIGIN has no host." ;;
    # A bare host, which is the whole point. Spelled out rather than left as a
    # fall-through: "accepted" and "nobody thought about this input" look
    # identical in a case with no default, and only one of them is intended.
    *)   ;;
  esac

  printf '%s\n' "$origin"
}

# ---------------------------------------------------------------- self-test --
#
# Run by `detect` on every pull request, so these rules are proven before any
# release leans on them. No network, no repository state: each case writes a
# throwaway file and asserts what the reader does with it.

self_test() {
  local dir out rc failures=0

  dir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$dir'" EXIT

  # ★ THE ONLY PLACE THAT RUNS THE READER, AND IT MUST STAY INSIDE `$(...)`.
  # `die` ends with `exit`. Called directly, the first refusal would tear down
  # the whole self-test — every later assertion skipped, and a non-zero exit
  # after printing nothing but passes. The command substitution keeps that exit
  # inside a subshell.
  try_read() {
    local file="$1"
    set +e
    out="$(read_origin "$file" 2>&1)"
    rc=$?
    set -e
  }

  pass() { local msg="$1"; echo "  ✔ $msg"; }
  fail() { local msg="$1"; echo "  ✘ $msg" >&2; failures=$((failures + 1)); }

  # `verify <expectation> <label> <path>` — the single assertion primitive.
  # Expectation is REJECT, ACCEPT (succeeds, value unimportant), or the exact
  # origin that must be printed.
  verify() {
    local expect="$1" label="$2" file="$3"
    try_read "$file"

    if [[ "$expect" == REJECT ]]; then
      if [[ "$rc" -eq 0 ]]; then
        fail "$label — accepted, should have been refused"
      else
        pass "$label — refused"
      fi
    elif [[ "$rc" -ne 0 ]]; then
      fail "$label — refused, should have been accepted: $out"
    elif [[ "$expect" != ACCEPT && "$out" != "$expect" ]]; then
      fail "$label — printed '$out', expected '$expect'"
    else
      pass "$label — '$out'"
    fi
  }

  # `check <expectation> <label> <file-contents...>` — write a fixture, verify it.
  check() {
    local expect="$1" label="$2" file="$dir/case.ts"
    shift 2
    printf '%s\n' "$@" > "$file"
    verify "$expect" "$label" "$file"
  }

  # `accepts <origin> <label>` / `refuses <origin> <label>` — the common shape,
  # where only the VALUE differs. Writing the declaration once here rather than
  # around every case is the difference between a table and ten copies of one
  # string with a word changed.
  decl() { local value="$1"; printf "export const PRODUCTION_BACKEND_ORIGIN = '%s';" "$value"; }
  accepts() { local value="$1" label="$2"; check "$value" "$label" "$(decl "$value")"; }
  refuses() { local value="$1" label="$2"; check REJECT "$label" "$(decl "$value")"; }

  echo "backend-origin.sh --self-test"

  # -- accepted ------------------------------------------------------------
  accepts 'https://bo-api.hoanglonglti.com' 'an https origin'
  accepts 'https://api.example.com:8443'    'an explicit port'

  # The one accepted case whose FILE is unusual rather than its value: the
  # declaration has to be found among other lines.
  check 'https://bo-api.hoanglonglti.com' 'surrounding comments and code' \
    '/** doc comment */' \
    "$(decl 'https://bo-api.hoanglonglti.com')" \
    'export const OTHER = 1;'

  # -- refused -------------------------------------------------------------
  #
  # ⚠ THE TWO `NOSONAR`S ARE THE POINT OF THE TEST, NOT AN EXCEPTION TO IT.
  # shell:S5332 flags clear-text URLs. These two fixtures ARE clear-text URLs,
  # because they are what proves a clear-text origin gets refused — the rule is
  # firing on the assertion that enforces it. Suppressed in the open with the
  # reason beside it. An earlier attempt to assemble the scheme from a variable
  # was worse: the analyser resolved it anyway, and the test read worse for it.
  refuses 'http://bo-api.hoanglonglti.com' 'a plaintext origin'  # NOSONAR
  refuses 'http://127.0.0.1:3000' 'plaintext loopback, never for a release'  # NOSONAR

  refuses ''                             'an empty value'
  refuses 'https://api.example.com/base' 'a path that would be silently discarded'
  refuses 'ftp://api.example.com'        'a scheme that is neither'
  refuses 'api.example.com'              'no scheme at all'

  check REJECT 'no declaration at all' 'export const SOMETHING_ELSE = 1;'

  check REJECT 'two declarations that disagree' \
    "$(decl 'https://a.example.com')" \
    "$(decl 'https://b.example.com')"

  verify REJECT 'a missing file' "$dir/absent.ts"

  # ★ AND THE REAL FILE, because everything above is a fixture. This is the
  # assertion that catches the regression that actually matters: the COMMITTED
  # origin must itself pass the rules this script enforces. ACCEPT rather than a
  # literal — asserting the value here would just re-read it and compare it to
  # itself; the proxy's own spec pins what it has to be.
  if [[ -r "$DEFAULT_FILE" ]]; then
    verify ACCEPT "the committed $DEFAULT_FILE" "$DEFAULT_FILE"
  fi

  if [[ "$failures" -ne 0 ]]; then
    echo "backend-origin: $failures self-test failure(s)" >&2
    exit 1
  fi
  echo "backend-origin: self-test passed"
}

case "${1:---default}" in
  --self-test) self_test ;;
  --default)   read_origin "$DEFAULT_FILE" ;;
  -*)          echo "usage: backend-origin.sh [path] | --self-test" >&2; exit 2 ;;
  *)           read_origin "$1" ;;
esac
