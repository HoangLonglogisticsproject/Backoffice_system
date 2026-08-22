#!/usr/bin/env bash
#
# Which half of the monorepo does a set of changed files actually touch?
#
# ★ ONE MATRIX, TWO CONSUMERS. The `detect` job asks "what did this PR change?"
# to decide which CI jobs to run. The `release` job asks "what changed between
# what is DEPLOYED and what is on main?" to decide what to deploy. Same
# question, different range — so it is answered in one place, because a matrix
# maintained in two places is a matrix that disagrees with itself on the day it
# matters.
#
# ★ FAIL-CLOSED, ALWAYS. A path nobody has classified yet marks BOTH halves
# affected and is reported by name. Being wrong that way costs one unnecessary
# deploy; being wrong the other way is the skew this pipeline exists to prevent.
#
# Usage:
#   affected.sh <base> <head>    classify a git range
#   affected.sh --stdin          classify a newline-separated file list
#   affected.sh --self-test      run the assertions at the bottom
#
# Writes `key=value` lines, suitable for appending to $GITHUB_OUTPUT.

set -euo pipefail

# ---------------------------------------------------------------- the matrix --
#
# Order is significant: the first matching pattern wins, so the narrow
# documentation cases must precede the directory-wide ones. `frontend/*` sitting
# after `frontend/README.md` is the entire reason a README does not ship a
# deployment.
classify() {
  case "$1" in
    # -- documentation and editor furniture: no build, no runtime, no deploy --
    docs/*|__screenshots__/*|.vscode/*|.claude/*)          echo docs ;;
    README.md|.editorconfig|.gitignore|LICENSE)            echo docs ;;
    frontend/README.md|backend/README.md|deploy/README.md) echo docs ;;
    deploy/env.example)                                    echo docs ;;

    # -- the pipeline describing itself --
    #
    # A workflow change changes HOW we deploy, never WHAT runs. It makes CI
    # re-run — a broken pipeline should fail on its own pull request, not on the
    # next unrelated one — and it deliberately marks nothing for deployment.
    # Drift detection already covers the case where a pipeline fix finally ships
    # what an earlier, broken one failed to.
    .github/*)                                             echo ci ;;

    # -- genuinely shared: the Node version both halves compile against --
    .nvmrc)                                                echo shared ;;

    # -- frontend: everything under it, minus the README claimed above --
    #
    # `frontend/*` rather than an enumeration of src/, public/, api/ … because
    # an enumeration silently omits whatever directory somebody adds next, and
    # omitted means "not affected", which means "never deployed".
    frontend/*)                                            echo frontend ;;

    # -- migrations are backend, and additionally demand a backup --
    backend/migrations/*)                                  echo migrations ;;
    backend/*)                                             echo backend ;;

    # -- deploy/: the Dockerfile, compose and nginx that define the VPS runtime.
    #    README and env.example were already claimed by the docs rules above.
    deploy/*)                                              echo backend ;;

    *)                                                     echo unknown ;;
  esac
}

# ------------------------------------------------------------------ the sums --
summarise() {
  frontend=false
  backend=false
  migrations=false
  ci=false
  shared=false
  unknown=""

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    kind="$(classify "$file")"
    case "$kind" in
      frontend)   frontend=true ;;
      backend)    backend=true ;;
      migrations) backend=true; migrations=true ;;
      shared)     shared=true ;;
      ci)         ci=true ;;
      docs)       : ;;
      unknown)    unknown="${unknown}${file} "; frontend=true; backend=true ;;
    esac
  done

  # `shared` widens both halves. `ci` widens validation only — never deployment.
  if [ "$shared" = true ]; then frontend=true; backend=true; fi

  ci_frontend="$frontend"
  ci_backend="$backend"
  if [ "$ci" = true ]; then ci_frontend=true; ci_backend=true; fi

  # The contract between the two halves is what this suite measures, so either
  # side moving is reason enough to re-measure it.
  ci_integration=false
  if [ "$ci_frontend" = true ] || [ "$ci_backend" = true ]; then ci_integration=true; fi

  echo "deploy_frontend=$frontend"
  echo "deploy_backend=$backend"
  echo "migrations=$migrations"
  echo "ci_frontend=$ci_frontend"
  echo "ci_backend=$ci_backend"
  echo "ci_integration=$ci_integration"
  echo "unknown=${unknown% }"
}

# ---------------------------------------------------------------- self-test --
#
# Not a framework, and not one test per function: one runnable check that fails
# if the matrix stops meaning what the audit said it means. Run it with
# `bash .github/scripts/affected.sh --self-test`.
self_test() {
  failures=0

  check() {
    label="$1"
    expected="$2"
    input="$3"
    actual="$(printf '%s\n' "$input" | summarise | grep "^${expected%%=*}=")"
    if [ "$actual" = "$expected" ]; then
      printf '  ok    %-46s %s\n' "$label" "$expected"
    else
      printf '  FAIL  %-46s want %s, got %s\n' "$label" "$expected" "$actual"
      failures=$((failures + 1))
    fi
  }

  echo "docs must never deploy"
  check 'docs/ -> no backend deploy'        'deploy_backend=false'  'docs/architecture/x.md'
  check 'docs/ -> no frontend deploy'       'deploy_frontend=false' 'docs/architecture/x.md'
  check 'root README -> no integration'     'ci_integration=false'  'README.md'
  check 'frontend README is docs'           'deploy_frontend=false' 'frontend/README.md'
  check 'deploy README is docs'             'deploy_backend=false'  'deploy/README.md'
  check 'env.example is docs'               'deploy_backend=false'  'deploy/env.example'
  check 'screenshots are docs'              'deploy_frontend=false' '__screenshots__/a.png'

  echo "frontend and backend do not bleed into each other"
  check 'frontend src -> frontend'          'deploy_frontend=true'  'frontend/src/App.tsx'
  check 'frontend src -> NOT backend'       'deploy_backend=false'  'frontend/src/App.tsx'
  check 'vercel edge proxy is frontend'     'deploy_frontend=true'  'frontend/api/[...path].ts'
  check 'vercel edge proxy is NOT backend'  'deploy_backend=false'  'frontend/api/[...path].ts'
  check 'vercel.json is frontend'           'deploy_frontend=true'  'frontend/vercel.json'
  check 'backend src -> backend'            'deploy_backend=true'   'backend/src/main.ts'
  check 'backend src -> NOT frontend'       'deploy_frontend=false' 'backend/src/main.ts'

  echo "deploy/ belongs to the backend runtime"
  check 'Dockerfile -> backend'             'deploy_backend=true'   'deploy/backend.Dockerfile'
  check 'compose -> backend'                'deploy_backend=true'   'deploy/docker-compose.yml'
  check 'nginx -> backend'                  'deploy_backend=true'   'deploy/nginx.conf'
  check 'Dockerfile -> NOT frontend'        'deploy_frontend=false' 'deploy/backend.Dockerfile'

  echo "migrations additionally demand a backup"
  check 'migration sets the flag'           'migrations=true'       'backend/migrations/0011_x.sql'
  check 'migration implies backend deploy'  'deploy_backend=true'   'backend/migrations/0011_x.sql'
  check 'plain backend change: no backup'   'migrations=false'      'backend/src/main.ts'

  echo "a workflow change validates, but never deploys"
  check 'workflow runs backend CI'          'ci_backend=true'       '.github/workflows/ci.yml'
  check 'workflow runs frontend CI'         'ci_frontend=true'      '.github/workflows/ci.yml'
  check 'workflow deploys no backend'       'deploy_backend=false'  '.github/workflows/ci.yml'
  check 'workflow deploys no frontend'      'deploy_frontend=false' '.github/workflows/ci.yml'
  check 'this script deploys nothing'       'deploy_backend=false'  '.github/scripts/affected.sh'

  echo "shared and unknown widen, never narrow"
  check '.nvmrc widens to backend'          'deploy_backend=true'   '.nvmrc'
  check '.nvmrc widens to frontend'         'deploy_frontend=true'  '.nvmrc'
  check 'unclassified -> backend'           'deploy_backend=true'   'weird-new-thing.py'
  check 'unclassified -> frontend'          'deploy_frontend=true'  'weird-new-thing.py'
  check 'unclassified is reported by name'  'unknown=weird-new-thing.py' 'weird-new-thing.py'

  echo "either half moving re-measures the contract"
  check 'backend change runs integration'   'ci_integration=true'   'backend/src/main.ts'
  check 'frontend change runs integration'  'ci_integration=true'   'frontend/src/App.tsx'

  echo
  if [ "$failures" -eq 0 ]; then
    echo "affected.sh: all checks passed"
  else
    echo "affected.sh: ${failures} check(s) FAILED" >&2
    return 1
  fi
}

# ------------------------------------------------------------------- entry --
case "${1:-}" in
  --self-test)
    self_test
    ;;
  --stdin)
    summarise
    ;;
  "")
    echo "usage: affected.sh <base> <head> | --stdin | --self-test" >&2
    exit 2
    ;;
  *)
    base="$1"
    head="${2:?head ref required}"
    git diff --name-only "$base" "$head" | summarise
    ;;
esac
