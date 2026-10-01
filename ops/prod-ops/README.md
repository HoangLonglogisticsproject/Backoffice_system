# Production ops — `bo-prod-ops`

Routine production data operations — today the legacy `confirmed` trip audit and
its normalization — run from GitHub Actions through **one root-owned command on
the VPS that accepts only registered operations**. Nobody has to chain
PowerShell → `git show` → checksum → `scp` → `ssh` → `docker ps` → `docker exec`
→ `psql` by hand again, and nothing on that path becomes a general root trampoline.

```
GitHub Actions — workflow_dispatch only, from main, approved on the `production` environment
  │  ssh bo-ops@vps          dedicated key · host key pinned · key forced to ONE command
  ▼
sudo -n /usr/local/sbin/bo-prod-ops <operation>      sudoers: exact argument, sha256-pinned file
  │  parameters: key=value lines on stdin, validated, never evaluated
  ▼
root wrapper ── verifies its own files · finds exactly ONE container per compose labels
  ├─ trip-confirmed-audit      docker exec <postgres> psql   read-only session, reviewed SQL
  └─ trip-confirmed-normalize  release check → preflight audit → docker exec <backend> node <CLI> (argv only)
```

| File | Role |
|---|---|
| `bo-prod-ops` | The root wrapper. The whole command surface. |
| `trip-confirmed-audit.sql` | The read-only, sanitized audit. Its sha256 is pinned inside the wrapper. |
| `install.sh` | Root install/update: wrapper, SQL, sudoers, the ops key's `authorized_keys`. Idempotent. |
| `github/connect.sh` | Runner side: pinned-host-key SSH config. Refuses without a pinned key. |
| `github/normalize-request.sh` | Runner side: validates the normalize inputs, prints the stdin request. |
| `github/summarize.sh` | Runner side: wrapper output → job summary. |
| `test/` | `e2e.sh` (real docker/postgres/sudo/sshd), `github.test.sh`, `workflows.py`, `run-local.sh`. |
| `../../.github/workflows/prod-trip-audit.yml` | **Production Trip Audit** (read only). |
| `../../.github/workflows/prod-trip-normalize.yml` | **Normalize Legacy Confirmed Trips** (writes). |
| `../../.github/workflows/ops-checks.yml` | CI for all of the above. No environment, no secret, no SSH. |

## Trust model

| Who | Can | Cannot |
|---|---|---|
| A workflow run | open SSH to `bo-ops` with the production key, **after** the `production` environment approves a run from `main` | pick the host key, run a shell, forward ports, name a file, send SQL |
| `bo-ops` (the key's account) | exactly `sudo -n bo-prod-ops trip-confirmed-audit` and `… trip-confirmed-normalize`, stdin passed through | log in with a password, get a shell or pty, run any other sudo command, pass a second argument |
| `bo-prod-ops` (root) | resolve containers, run the pinned SQL read-only, run the trip capability's CLI with validated argv | run anything taken from its input; it has no `run-sql` or `exec` |
| `deploy` | **unchanged**: `sudo bo-release <sha>` only | anything above — it gets no new sudo rule |
| root, by hand | bootstrap and update (`install.sh`) | — |

**Why a separate `bo-ops` account instead of `deploy`.** The `deploy` key lives on
the `staging` environment and is used automatically by `release` on every push
to `main`. If `deploy` could `sudo bo-prod-ops`, anyone able to get a job holding
that key would run production writes **without** the `production` approval. So
`deploy` keeps exactly its one rule, and the ops key reaches a different account
whose only possible action is the forced command.

### The ops key

`install.sh` writes this line, and only this line, to `/home/bo-ops/.ssh/authorized_keys`:

```
restrict,command="sudo -n /usr/local/sbin/bo-prod-ops \"$SSH_ORIGINAL_COMMAND\"" ssh-ed25519 AAAA… bo-prod-ops@github-actions
```

- `restrict` turns off **everything** a key could otherwise ask for: pty, port
  forwarding (`-L`, `-R`, `-D`, `-W`), agent forwarding (`-A`), X11 forwarding
  (`-X`/`-Y`) and `~/.ssh/rc`. New capabilities OpenSSH adds later are off by
  default under `restrict` too.
- `command=` replaces whatever the client asks to run — a shell, `id`, `scp`, an
  `sftp` subsystem — with the one command. The remote shell (`/bin/sh`) expands
  `"$SSH_ORIGINAL_COMMAND"` as ONE word, so the client's text becomes a single
  argument that sudoers then matches exactly against the two operation names.
- `e2e.sh` proves each refusal against a real sshd that **allows** all of these
  server-wide, side by side with an unrestricted control key on the same sshd
  that gets every one of them — so the refusals come from the key, not from a
  lenient server config. Dropping `restrict` turns eight of those tests red.

| Client attempt | bo-ops (this key) | control key, same sshd |
|---|---|---|
| `ssh bo-ops@host` (interactive, `-tt`) | `PTY allocation request failed`; no shell; typed `id` never runs | pty + shell, `id` runs |
| `ssh bo-ops@host id` / `'trip-confirmed-audit; id'` / `'sh -c id'` / `'sudo -n /bin/sh'` / `'scp -t /tmp'` / no command | refused by sudo as one unknown argument | `id` runs |
| `ssh -L …` | nothing reaches the far end; sshd: `refused local port forward` | reaches it |
| `ssh -W …` | `stdio forwarding failed` | reaches it |
| `ssh -R …` | `remote port forwarding failed` | granted |
| `ssh -A …` | sshd: `agent forwarding disabled` (the operation itself still runs) | `SSH_AUTH_SOCK` set |
| `ssh -X/-Y …` | `X11 forwarding request failed` | `DISPLAY=localhost:…` |
| `sftp` | no session, no listing | lists `/` |
| any of it with another host key | `Host key verification failed` — no connection | — |

### Every file root trusts at run time

Nothing in this chain is writable by `bo-ops`, `deploy`, the application
containers or ordinary users. `install.sh` checks it before writing (and refuses
a target or home entry it did not expect to be root's); the wrapper re-checks
its own files on every run and refuses one that is not root-owned, is group- or
world-writable, or (the SQL) whose sha256 is not the pinned one.

| Path | Owner:group | Mode | Who can modify | Used by, how |
|---|---|---|---|---|
| `/usr/local/sbin/bo-prod-ops` | root:root | 0755 | root | executed by sudo; sudoers pins its sha256, sudo refuses a changed file |
| `/usr/local/lib/bo-prod-ops/` | root:root | 0755 | root | directory of the two assets below |
| `/usr/local/lib/bo-prod-ops/trip-confirmed-audit.sql` | root:root | 0644 | root | read by the wrapper, piped to psql; sha256 pinned in the wrapper |
| `/usr/local/lib/bo-prod-ops/SOURCE` | root:root | 0644 | root | read for display only; printed only if it is a 40-hex sha |
| `/`, `/usr`, `/usr/local`, `/usr/local/sbin`, `/usr/local/lib` | root:root | 0755 | root | parents of the above, checked by the wrapper on every run |
| `/etc/sudoers.d/bo-prod-ops` | root:root | 0440 | root | read by sudo; validated with `visudo -cf` before install |
| `/etc/sudoers`, `/etc/sudoers.d/` | root:root | 0440, 0755 | root | sudo's own configuration; `install.sh` refuses to add to one `visudo -c` rejects |
| `/home/bo-ops/` | root:root | 0755 | root | contains only `.ssh/` — `install.sh` refuses a home holding anything not root's |
| `/home/bo-ops/.ssh/` | root:root | 0755 | root | only `authorized_keys` (so no `authorized_keys2` can appear) |
| `/home/bo-ops/.ssh/authorized_keys` | root:root | 0644 | root | read by sshd: the restricted, forced-command key |
| `/etc/passwd` entry `bo-ops` | root:root | 0644 | root | shell `/bin/sh` (reads no startup file for `-c`), password `*` |
| `/etc/ssh/sshd_config` | root:root | 0644 | root | server-wide; unchanged by this |
| `/bin/bash`, `/usr/bin/{docker,logger,sudo,sha256sum,stat,grep,sed,…}` | root:root | 0755 | root (package manager) | the only commands the wrapper runs: `PATH` is fixed to `/usr/sbin:/usr/bin:/sbin:/bin` |

The wrapper **sources nothing** and reads no configuration besides the SQL and
`SOURCE`: no `.bashrc` (non-interactive), and sudo's `env_reset` drops
`BASH_ENV`, `ENV` and the caller's `PATH`. The Docker daemon is reached through
`/var/run/docker.sock` (root:docker 0660); membership of `docker` is
root-equivalent, and `deploy` was taken out of it (`deploy/README.md`) — check
`getent group docker` during bootstrap.

A release (`bo-release` → `vps-release.sh`) never touches these paths; they
change only through `install.sh`, run by a person, from a reviewed commit.

### The release image: a separate, deliberate trust boundary

Two things run **inside containers**, never on the host as root:

- **psql**, in the `postgres:17-alpine` container the wrapper resolved, fed the
  pinned SQL on stdin in a session opened read-only. A tampered database
  container could at most lie in the audit's output; it gains nothing on the host.
- **The trip capability's CLI**, `node /app/dist/…/normalize-legacy-confirmed.cli.js`,
  in the running backend container, as that image's `app` user, with the
  container's own `DATABASE_URL`. It is code from the release, not from this
  directory, and it is pinned to the release a person approved:
  `expected_release_sha` must equal the container's `release.sha` label, the
  image tag must be `hoanglong-bo-backend:<that sha>`, and the CLI must exist in
  it — otherwise exit 5 and nothing runs. Any argv it gets has been validated
  three times. Residual, stated plainly: the image's files belong to `app`, so a
  backend *already compromised at run time* could alter its own copy of the CLI
  inside its container — but that process already holds the same database
  credentials, so this grants it nothing new, and nothing it runs reaches the
  host as root. (`docker diff` could also pin the container's files to the image;
  not added — the risk it closes is one the attacker has already won.)

⚠ **Known limit, stated plainly.** The release pipeline already executes
repository code as root (`deploy/README.md`, "Root therefore executes repository
code"). A malicious commit merged to `main` could therefore rewrite these files
during a release. The sudoers digest makes a silently replaced wrapper **fail
closed** (sudo refuses it) and the SQL pin does the same for the audit, but root
can rewrite sudoers too. The real control is what may reach `main` — which is
why its protection is a **rollout prerequisite** below, not a recommendation.

## Command surface

One argument — the operation — and `key=value` lines on stdin (max 16 KiB).
Unknown operation, second argument, unknown key, duplicate key or malformed line
→ exit 2 before anything else happens.

| Operation | stdin | Does |
|---|---|---|
| `trip-confirmed-audit` | optional `github_run=<id>-<attempt>`, `github_actor=<login>` | read-only audit, see below |
| `trip-confirmed-normalize` | `ids=<uuid,…>` (1–200, lowercase canonical, no duplicates), `by=<email>`, `expected_release=<40-hex>`, optional run/actor | release check → preflight → apply → per-id result |

There is no `--all`, no date range, no query, no file argument, no `exec`.

| Exit | Meaning | Written? |
|---|---|---|
| 0 | done (normalize: every id `NORMALIZED`) | as reported |
| 1 | a step failed — the message says whether anything may have been written | stated |
| 2 | bad request | nothing |
| 3 | integrity: not root, a file not root-owned / writable by others, SQL checksum mismatch | nothing |
| 4 | target: not exactly one running `hoanglong-bo`/`postgres` (or `backend`) container, or wrong image | nothing |
| 5 | release: deployed `release.sha` ≠ `expected_release`, unknown, image tag disagrees, or no CLI in it | nothing |
| 6 | preflight: some id is not ELIGIBLE right now | nothing |
| 7 | applied, but some ids were left unchanged by the CLI's own re-check (reported per id) | the NORMALIZED ones |

Output is one `section|key|value` line per fact: `meta`, `count`, `temporal`,
`assignments`, `ids`, `preflight`, `result`, `done`, `warn`, `error`.

**Database target.** `docker ps` filtered on `com.docker.compose.project=hoanglong-bo`
**and** `com.docker.compose.service=postgres`, running only; exactly one or stop;
labels re-read with `docker inspect`; image must be `postgres:17-alpine`. Never a
name, never `grep`, never "the first one". Everything afterwards uses that
container's full ID. Only safe metadata is printed: container name, compose
project and service, database name.

**Logging.** Every run writes to the journal (`logger -t bo-prod-ops -p auth.notice`):
operation, GitHub run and actor, `SUDO_USER`, releases, each requested id and each
outcome. Only validated values are logged. sudo logs the command line itself. If
`logger` is missing the wrapper says so on stdout, which the workflow keeps.
`journalctl -t bo-prod-ops` reads it back.

## Contract with the trip capability (PR #89)

The business rules belong to the trip capability; this directory only calls them.
If any item below changes there, change it here in the same reviewed step
(and `test/fake-normalize-cli.js`, which stands in for the CLI in tests).

1. **Classification** — `classify()` in
   `backend/src/capabilities/trip-schedule/domain/legacy-confirmed.ts`: archived →
   `SKIPPED_ARCHIVED`; else a pending driver completion request →
   `CONFLICT_PENDING_COMPLETION`; else exactly one of `closed_at`/`closed_by` →
   `CONFLICT_CLOSED_PARTIAL`; else `ELIGIBLE`. Stamp: `CLOSED_COMPLETE`,
   `CLOSED_MISSING`, `CLOSED_PARTIAL`. `trip-confirmed-audit.sql` implements the
   same rules — but only to **gate**: the CLI re-classifies every id under its row
   lock, so a disagreement can refuse a write, never cause one.
2. **CLI** — in the deployed image at
   `/app/dist/capabilities/trip-schedule/cli/normalize-legacy-confirmed.cli.js`,
   run as `node <path> --apply --by <email> --ids <uuid,…>`. `--by` must be an
   active account holding `trip.complete.review` whose password has been changed.
   Exit 0 prints JSON `{mode, by, summary, results: [{id, outcome}]}` with one
   result per id; outcomes `NORMALIZED`, `CONFLICT_PENDING_COMPLETION`,
   `CONFLICT_CLOSED_PARTIAL`, `SKIPPED_ARCHIVED`, `SKIPPED_ALREADY_FINISHED`,
   `SKIPPED_MISSING`, `SKIPPED_STATE_CHANGED`. Exit 1 = refused or failed. The
   wrapper requires exactly one known outcome per requested id, or it fails and
   says the state is unknown.
3. **Release identity** — the backend image label `release.sha` (set from
   `APP_VERSION` by `deploy/backend.Dockerfile`) and the tag
   `hoanglong-bo-backend:<sha>` (`deploy/docker-compose.yml`) — the same label
   `bo-release` reads to decide a deploy.

Normalize therefore works only once #89 is deployed; before that it stops with
exit 5 ("no normalization CLI"). The audit needs nothing from #89.

## Privacy

GitHub logs and summaries are not a place for customer data. The audit prints
trip UUIDs, classifications, closing-stamp categories, counts and dates — never
customer names, contacts, phones, addresses, notes, cargo, prices, costs, actor
ids or free-text reasons. That is why it is a **separate, sanitized SQL**: the
human-run `backend/scripts/legacy-confirmed-dry-run.sql` (#89) prints cost totals
and groups by the free-text `end_reason`, fine at a root terminal, not in CI.
`e2e.sh` seeds every such column with a sentinel and fails if one ever appears.

## Rollout prerequisites — REQUIRED before the first run

Repository settings, set by a repository admin. None of this is configured by
code, and the bootstrap must not start until every line holds.

### `main` — a branch ruleset (Settings → Rules → Rulesets), enforcement **Active**

| Rule | Setting |
|---|---|
| Target | `main` (the default branch) |
| Restrict deletions | **on** |
| Block force pushes | **on** |
| Require a pull request before merging | **on** — required approvals **1**, dismiss stale approvals when new commits are pushed, require approval of the most recent reviewable push. (With a single maintainer, approvals 0 still forces every change through a PR and the checks; the `production` reviewers then remain the second pair of eyes.) |
| Require status checks to pass | **on**, each with source **GitHub Actions** (SonarCloud: the SonarCloud app) so no other app can satisfy it: `detect · which half of the monorepo changed`, `backend · boundaries, types, build, tests`, `frontend · lint, types, build, unit tests`, `ai · boundaries, types, build, tests`, `integration · frontend ↔ real backend ↔ real PostgreSQL`, `ops · wrapper, audit SQL, installer, workflows`, `SonarCloud Code Analysis` |
| Bypass list | **empty**. Nothing pushes to `main` directly — `release` deploys, it never pushes. Add a named admin or bot only by an explicit, recorded decision. |

The check names are exact; they are what the jobs report. Not required, on
purpose: `release · …` (runs only after a push to `main`), CodeRabbit (quota-limited),
Vercel (preview deploys). `ops · …` runs on **every** pull request and finishes
in seconds when nothing it guards changed — a required check must always report.
Classic branch protection is equivalent if rulesets are not available: the same
rules plus "Do not allow bypassing the above settings".

### Environment `production` (Settings → Environments)

| Setting | Value |
|---|---|
| Required reviewers | named people (or a team), at least one; **Prevent self-review on** |
| Allow administrators to bypass configured protection rules | **off** |
| Deployment branches and tags | **Selected branches and tags → branch `main` only**, no tag rules. This is the real gate; the workflows' own `if: github.ref == 'refs/heads/main'` only stops a run earlier. |
| Environment secrets | exactly the four below — and **no** repository- or organization-level secret with these names |

| Secret | Value |
|---|---|
| `PROD_OPS_HOST` | the VPS address |
| `PROD_OPS_PORT` | the SSH port |
| `PROD_OPS_SSH_KEY` | private half of the **dedicated** ops key (bootstrap step 2) — never the `staging` `VPS_SSH_KEY` |
| `PROD_OPS_KNOWN_HOSTS` | `[host]:port ssh-ed25519 AAAA…` — the VPS host key, read on the VPS and compared out of band |

The workflows declare `permissions: contents: read`, pin `actions/checkout` to a
commit, never persist its token, pass inputs through `env:` only, and never
`ssh-keyscan`. `test/workflows.py` enforces all of that on every change.

## Bootstrap — one time, as root on the VPS

Nothing below has been run. Each step fails differently; do not combine them.

```bash
# 0. The host key GitHub will pin. Compare the fingerprint over a channel you trust.
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
awk '{print "[<host>]:<port> " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub   # -> PROD_OPS_KNOWN_HOSTS

# 1. The ops account: no password (`*`, not the `!` lock sshd refuses without PAM),
#    /bin/sh, and NO home created here - install.sh creates it root-owned, holding
#    only .ssh/authorized_keys. If sshd restricts logins, allow it.
useradd --system --no-create-home --home-dir /home/bo-ops --shell /bin/sh bo-ops
usermod -p '*' bo-ops
sshd -T | grep -Ei '^(allowusers|allowgroups|denyusers|denygroups|authorizedkeysfile|permituserenvironment)'
#    add bo-ops to AllowUsers/AllowGroups if they are set (then sshd -t; reload);
#    PermitUserEnvironment must be "no"

# 2. The ops key, generated OFF the server. Private half -> PROD_OPS_SSH_KEY only.
ssh-keygen -t ed25519 -N '' -C bo-prod-ops@github-actions -f bo-prod-ops     # on your machine
#    copy bo-prod-ops.pub to /root/bo-prod-ops.pub on the VPS

# 3 + 4. The reviewed sources, from main - never from a branch - then install.
#    ONE subshell with `set -e`: if the commit is not on origin/main, or any
#    step fails, nothing after it runs (and your root shell stays open).
#    install.sh checks everything, validates the sudo rule with visudo -cf, then
#    writes atomically; it prints checksums, modes and `sudo -l -U bo-ops`.
( set -euo pipefail
  SHA=<the merge commit on main>
  git -C /opt/hoanglong-bo fetch --quiet origin
  git -C /opt/hoanglong-bo merge-base --is-ancestor "$SHA" origin/main \
    || { echo "REFUSING: $SHA is not on origin/main" >&2; exit 1; }
  rm -rf /root/bo-prod-ops-src && mkdir -p /root/bo-prod-ops-src
  git -C /opt/hoanglong-bo archive "$SHA" ops/prod-ops | tar -x -C /root/bo-prod-ops-src
  bash /root/bo-prod-ops-src/ops/prod-ops/install.sh "$SHA" /root/bo-prod-ops.pub
)

# 5. Prove it - every "denied" line MUST be denied, every listing MUST match.
sudo -u bo-ops sudo -n /usr/local/sbin/bo-prod-ops trip-confirmed-audit </dev/null  # runs
sudo -u bo-ops sudo -n /usr/local/sbin/bo-prod-ops trip-confirmed-audit x           # denied
sudo -u bo-ops sudo -n /bin/sh -c id                                                # denied
sudo -u bo-ops docker ps                                                            # denied
sudo -l -U bo-ops                    # exactly the two bo-prod-ops commands
sudo -l -U deploy                    # still only bo-release
getent group docker                  # neither deploy nor bo-ops
stat -c '%U:%G %a %n' /home/bo-ops /home/bo-ops/.ssh /home/bo-ops/.ssh/authorized_keys  # root:root 755/755/644
find /home/bo-ops ! -user root       # prints nothing
#    and from your machine, with the private key: `ssh -i bo-prod-ops -p <port> bo-ops@<host>`
#    must answer "PTY allocation request failed" and a sudo refusal, never a prompt.
```

The generated sudo rule (the digest is the wrapper's sha256):

```
Cmnd_Alias BO_PROD_OPS = sha256:<digest> /usr/local/sbin/bo-prod-ops trip-confirmed-audit, \
                         sha256:<digest> /usr/local/sbin/bo-prod-ops trip-confirmed-normalize
Defaults!BO_PROD_OPS env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"
bo-ops ALL=(root) NOPASSWD: BO_PROD_OPS
```

A command with arguments in sudoers matches **exactly those arguments**: a second
argument, a different operation, `-E`, `-u` or any other binary is refused by sudo
itself — tested in `e2e.sh`, including that a tampered wrapper is refused on the
digest. Never write `*` here: it is how a sudo rule becomes a root shell (and it
does not even match the zero-extra-argument call). The key line is in "The ops
key" above.

### Updating an operation

Change it here, in a reviewed PR (the SQL pin, the wrapper and the tests move
together; `ops-checks` must be green). After merge, repeat steps 3 and 4 with the
new commit. The previous version stays live until step 4 — and between the
wrapper's replacement and the sudo rule's, sudo refuses the new file, so a half
update fails closed. Re-running with the same commit changes nothing.

### Rolling back / removing

Reinstall a previous commit with step 3–4, or remove it entirely:
`rm /etc/sudoers.d/bo-prod-ops && visudo -c`, then
`rm -r /usr/local/sbin/bo-prod-ops /usr/local/lib/bo-prod-ops /home/bo-ops/.ssh/authorized_keys`,
and delete the `PROD_OPS_*` secrets.

## Running it

**Production Trip Audit** — Actions → run from `main` → approve. It prints the
counts, the id lists and `meta|backend_release|<sha>`. Conflicts are reported,
not failures; an infrastructure problem fails the run. It never starts a
normalization.

**Normalize Legacy Confirmed Trips** — a person decides, from an audit, which
ELIGIBLE ids to close, then runs this with those ids, their own app email and
the `backend_release` the audit printed. Inputs are validated in a job with no
secret (a malformed request fails before anyone is asked to approve). After
approval: release check, preflight (every id ELIGIBLE now, or nothing is
written), the CLI, then the audit again. Any id not `NORMALIZED` fails the run
and is listed.

## Rollout order

0. The rollout prerequisites above are in place. 1. Review and merge this PR.
2. Bootstrap (above). 3. Run **Production Trip Audit**. 4. Review its output.
5. Merge PR #89. 6. Deploy #89. 7. Audit again. 8. Run **Normalize Legacy
Confirmed Trips** with explicit ELIGIBLE ids. 9. The closing audit shows what is
left. 10. Later, a separate migration drops `confirmed` from the status CHECK.
Do not collapse these steps.

## Testing

`ops-checks` runs on every pull request and every push to `main`; when the diff
touches `ops/`, the migrations or the ops workflows it runs shellcheck,
`test/workflows.py`, `test/github.test.sh`, and `sudo bash test/e2e.sh` on the
runner — the real wrapper installed by the real `install.sh`, against a real
`postgres:17-alpine` with this repository's migrations, real sudo and a real
sshd (every SSH escape above, against the unrestricted control key), with a
stand-in backend whose only fake part is the CLI. From a dev machine with Docker:
`bash ops/prod-ops/test/run-local.sh` (everything is installed inside a
throwaway container, never on your machine). `e2e.sh` refuses to run beside a
real `hoanglong-bo` compose project.
