#!/usr/bin/env bash
#
# Read SonarCloud findings for this project — issues, security hotspots and the
# quality gate — for a pull request or for a branch.
#
#   npm run sonar                  # PR 2 by default, or $SONAR_PR
#   npm run sonar -- --pr 5
#   npm run sonar -- --branch feat/authorization-lifecycle
#   npm run sonar -- --projects    # list what this token can see, then stop
#   npm run sonar -- --json        # raw JSON, for diffing between runs
#
# READ-ONLY. Every endpoint below is a GET, and nothing here writes to
# SonarCloud, to GitHub, or to this repository.
#
# ---------------------------------------------------------------- the token --
#
# Supplied through the ENVIRONMENT, never through a file in the repo and never
# on the command line:
#
#   export SONAR_TOKEN=...          # or set it as a Claude Code secret
#
# It is read from the environment and handed to curl through stdin (--config -),
# so it does not appear in `ps`, in shell history, or in this script's output.
# The script refuses to run if the variable is empty, and never echoes its value.
#
# Generate one at https://sonarcloud.io/account/security as a USER TOKEN.
#
# Minimum permission: `Browse` on the project, plus `See Source Code` if you
# want the file and line locations this script prints. That is all. It does NOT
# need Administer, Execute Analysis, or any GitHub scope — the token talks to
# sonarcloud.io only, and the project can stay private.
#
# ------------------------------------------------------------- the project --
#
# The project key defaults to the `owner_repo` convention SonarCloud uses for
# projects it provisions from GitHub. Override either part if yours differs:
#
#   export SONAR_ORG=hoanglonglogisticsproject
#   export SONAR_PROJECT=HoangLonglogisticsproject_Backoffice_system
#
# `--projects` lists everything the token can see, which is the quickest way to
# find the real key when the default is wrong.
#
set -uo pipefail

API=https://sonarcloud.io/api
ORG=${SONAR_ORG:-hoanglonglogisticsproject}
PROJECT=${SONAR_PROJECT:-HoangLonglogisticsproject_Backoffice_system}
PR=${SONAR_PR:-2}
BRANCH=""
MODE=report
RAW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)       PR="$2"; BRANCH=""; shift 2 ;;
    --branch)   BRANCH="$2"; PR=""; shift 2 ;;
    --project)  PROJECT="$2"; shift 2 ;;
    --org)      ORG="$2"; shift 2 ;;
    --projects) MODE=projects; shift ;;
    --json)     RAW=true; shift ;;
    -h|--help)  sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

fatal() {
  printf '\n\033[31m%s\033[0m\n\n' "$1" >&2
  exit 1
}

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  cat >&2 <<'MISSING'
SONAR_TOKEN is not set.

  1. https://sonarcloud.io/account/security  ->  generate a User Token
  2. Give that token's user `Browse` on the project
     (Administration -> Permissions). Nothing more is required.
  3. export SONAR_TOKEN=...   (or set it as a Claude Code environment secret)

The project stays private and the token never enters this repository.
MISSING
  exit 1
fi

scope() {
  if [[ -n "$BRANCH" ]]; then printf 'branch=%s' "$BRANCH"; else printf 'pullRequest=%s' "$PR"; fi
}

# The token goes to curl over stdin so it never appears in the process list.
#
# The HTTP status is appended on its own last line and split off here, because
# SonarCloud answers 401 and 403 with an EMPTY body: a bare `curl` would hand
# the parser nothing and it would die with a stack trace instead of saying what
# actually went wrong.
api() {
  local path="$1" response status body
  response=$(
    printf 'header = "Authorization: Bearer %s"\n' "$SONAR_TOKEN" |
      curl --silent --show-error --max-time 30 --config - \
           --write-out '\n%{http_code}' "$API/$path"
  )
  status=${response##*$'\n'}
  body=${response%$'\n'*}

  case "$status" in
    200) printf '%s' "$body" ;;
    401) fatal "401 - SonarCloud rejected the token. Check that it has not expired and was pasted whole." ;;
    403) fatal "403 - the token is valid, but its user lacks Browse on ${PROJECT}. Grant it under Administration -> Permissions." ;;
    404) fatal "404 - no such project, branch or pull request: ${PROJECT} ($(scope)). Run with --projects to list what this token can see." ;;
    000) fatal "could not reach sonarcloud.io - check network access." ;;
    *)   fatal "SonarCloud answered HTTP ${status}." ;;
  esac
}

# ----------------------------------------------------------------- projects --

if [[ "$MODE" == projects ]]; then
  PROJECTS=$(api "components/search?organization=$ORG&qualifiers=TRK&ps=100") || exit 1
  printf '%s' "$PROJECTS" | python - <<'PY'
import json, sys
d = json.load(sys.stdin)
if 'errors' in d:
    print('SonarCloud refused the request:')
    for e in d['errors']:
        print('  ', e.get('msg'))
    sys.exit(1)
rows = d.get('components', [])
print(f"{len(rows)} project(s) visible to this token:\n")
for c in rows:
    print(f"  {c['key']}\n    name: {c.get('name', '')}")
PY
  exit $?
fi

printf '\033[1mSonarCloud - %s (%s)\033[0m\n' "$PROJECT" "$(scope)"

# ------------------------------------------------------------ quality gate --

GATE=$(api "qualitygates/project_status?projectKey=$PROJECT&$(scope)") || exit 1
printf '%s' "$GATE" | python - <<'PY'
import json, sys
d = json.load(sys.stdin)
if 'errors' in d:
    print('\n  quality gate: unavailable -', '; '.join(e.get('msg', '') for e in d['errors']))
    sys.exit(0)
s = d.get('projectStatus', {})
status = s.get('status', '?')
mark = '\033[32mPASSED\033[0m' if status == 'OK' else f'\033[31m{status}\033[0m'
print(f"\n  quality gate: {mark}")
for c in s.get('conditions', []):
    if c.get('status') != 'OK':
        print(f"    x {c.get('metricKey')}: actual {c.get('actualValue')} "
              f"{c.get('comparator', '')} {c.get('errorThreshold')}")
PY

# ----------------------------------------------------------------- issues --

ISSUES=$(api "issues/search?componentKeys=$PROJECT&$(scope)&resolved=false&ps=500&additionalFields=rules") || exit 1

if [[ "$RAW" == true ]]; then
  printf '%s\n' "$ISSUES"
  exit 0
fi

printf '%s' "$ISSUES" | python - <<'PY'
import collections, json, sys
d = json.load(sys.stdin)
if 'errors' in d:
    print('\n  issues: unavailable -', '; '.join(e.get('msg', '') for e in d['errors']))
    print('\n  If that says the project does not exist, run with --projects to')
    print('  list the keys this token can actually see.')
    sys.exit(1)

issues = d.get('issues', [])
print(f"\n  \033[1m{d.get('total', len(issues))} unresolved issue(s)\033[0m")

order = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']
by_sev = collections.Counter(i.get('severity', '?') for i in issues)
if issues:
    print('  ' + ' | '.join(f"{s} {by_sev[s]}" for s in order if by_sev[s]))

rank = {s: n for n, s in enumerate(order)}
for i in sorted(issues, key=lambda x: (rank.get(x.get('severity'), 9),
                                       x.get('component', ''), x.get('line') or 0)):
    where = i.get('component', '').split(':', 1)[-1]
    line = i.get('line')
    print(f"\n  [{i.get('severity')}] {i.get('rule')}   {i.get('type')}")
    print(f"    {where}" + (f":{line}" if line else ''))
    print(f"    {i.get('message')}")
    for flow in i.get('flows', []):
        for loc in flow.get('locations', []):
            t = loc.get('textRange', {})
            c = loc.get('component', '').split(':', 1)[-1]
            print(f"      -> {c}:{t.get('startLine')}  {loc.get('msg', '')}")
PY

# ------------------------------------------------------- security hotspots --
# Reported separately from issues: a project can show zero issues and still
# have hotspots waiting for review, so both have to be read.

HOTSPOTS=$(api "hotspots/search?projectKey=$PROJECT&$(scope)&ps=500") || exit 1
printf '%s' "$HOTSPOTS" | python - <<'PY'
import json, sys
d = json.load(sys.stdin)
if 'errors' in d:
    sys.exit(0)
hs = [h for h in d.get('hotspots', []) if h.get('status') != 'REVIEWED']
print(f"\n  \033[1m{len(hs)} security hotspot(s) to review\033[0m")
for h in hs:
    where = h.get('component', '').split(':', 1)[-1]
    print(f"\n  [{h.get('vulnerabilityProbability')}] {h.get('ruleKey')}")
    print(f"    {where}:{h.get('line')}")
    print(f"    {h.get('message')}")
PY

printf '\n'
