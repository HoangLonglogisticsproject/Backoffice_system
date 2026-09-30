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

**What nobody but root can change** (checked by `install.sh` before it writes,
and by the wrapper on every run — it refuses a file that is not root-owned or is
group/world-writable, and an SQL whose sha256 is not the pinned one):

| Path | Owner | Mode |
|---|---|---|
| `/usr/local/sbin/bo-prod-ops` (and `/`, `/usr`, `/usr/local`, `/usr/local/sbin`) | root:root | 0755 |
| `/usr/local/lib/bo-prod-ops/` · `trip-confirmed-audit.sql` · `SOURCE` | root:root | 0755 · 0644 · 0644 |
| `/etc/sudoers.d/bo-prod-ops` | root:root | 0440 |
| `~bo-ops/.ssh/` · `authorized_keys` | root:root | 0755 · 0644 |

A release (`bo-release` → `vps-release.sh`) never touches these paths; they
change only through `install.sh`, run by a person, from a reviewed commit.

⚠ **Known limit, stated plainly.** The release pipeline already executes
repository code as root (`deploy/README.md`, "Root therefore executes repository
code"). A malicious commit merged to `main` could therefore rewrite these files
during a release. The sudoers digest makes a silently replaced wrapper **fail
closed** (sudo refuses it) and the SQL pin does the same for the audit, but root
can rewrite sudoers too. The real control is review on `main` — which currently
has **no branch protection**. Turn it on (required review) before relying on this.

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

## GitHub setup (repository settings — not in code)

**Environment `production`:**
- Required reviewers: at least one person, **prevent self-review** on.
- Deployment branches: **selected branches → `main` only**. This is the real
  gate; the workflows' own `if: github.ref == 'refs/heads/main'` only stops early.
- Environment secrets (never repository secrets):

| Secret | Value |
|---|---|
| `PROD_OPS_HOST` | the VPS address |
| `PROD_OPS_PORT` | the SSH port |
| `PROD_OPS_SSH_KEY` | private half of the **dedicated** ops key (bootstrap step 2) |
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
#    home owned by it, nothing else. If sshd restricts logins, allow it.
useradd --system --create-home --home-dir /home/bo-ops --shell /bin/sh bo-ops
usermod -p '*' bo-ops
sshd -T | grep -Ei '^(allowusers|allowgroups|denyusers|denygroups)'   # add bo-ops if listed; sshd -t; reload

# 2. The ops key, generated OFF the server. Private half -> PROD_OPS_SSH_KEY only.
ssh-keygen -t ed25519 -N '' -C bo-prod-ops@github-actions -f bo-prod-ops     # on your machine
#    copy bo-prod-ops.pub to /root/bo-prod-ops.pub on the VPS

# 3. The reviewed sources, from main - never from a branch.
SHA=<the merge commit on main>
git -C /opt/hoanglong-bo fetch --quiet origin
git -C /opt/hoanglong-bo merge-base --is-ancestor "$SHA" origin/main && echo "on main"
rm -rf /root/bo-prod-ops-src && mkdir -p /root/bo-prod-ops-src
git -C /opt/hoanglong-bo archive "$SHA" ops/prod-ops | tar -x -C /root/bo-prod-ops-src

# 4. Install. Checks everything, validates the sudo rule with visudo -cf, then
#    writes atomically; prints checksums, modes and `sudo -l -U bo-ops`.
bash /root/bo-prod-ops-src/ops/prod-ops/install.sh "$SHA" /root/bo-prod-ops.pub

# 5. Prove it - every "denied" line MUST be denied.
sudo -u bo-ops sudo -n /usr/local/sbin/bo-prod-ops trip-confirmed-audit </dev/null  # runs
sudo -u bo-ops sudo -n /usr/local/sbin/bo-prod-ops trip-confirmed-audit x           # denied
sudo -u bo-ops sudo -n /bin/sh -c id                                                # denied
sudo -u bo-ops docker ps                                                            # denied
sudo -l -U deploy                                                                   # still only bo-release
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
does not even match the zero-extra-argument call).

The key line `install.sh` writes: `restrict,command="sudo -n /usr/local/sbin/bo-prod-ops \"$SSH_ORIGINAL_COMMAND\"" <key>`.
The remote shell expands `"$SSH_ORIGINAL_COMMAND"` as one word, so whatever a
client sends becomes a single argument that sudoers then matches exactly.

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

1. Review and merge this PR. 2. Bootstrap (above). 3. Run **Production Trip
Audit**. 4. Review its output. 5. Merge PR #89. 6. Deploy #89. 7. Audit again.
8. Run **Normalize Legacy Confirmed Trips** with explicit ELIGIBLE ids.
9. The closing audit shows what is left. 10. Later, a separate migration drops
`confirmed` from the status CHECK. Do not collapse these steps.

## Testing

`ops-checks` runs on every change here: shellcheck, `test/workflows.py`,
`test/github.test.sh`, and `sudo bash test/e2e.sh` on the runner — the real
wrapper installed by the real `install.sh`, against a real `postgres:17-alpine`
with this repository's migrations, real sudo and a real sshd, with a stand-in
backend whose only fake part is the CLI. From a dev machine with Docker:
`bash ops/prod-ops/test/run-local.sh` (everything is installed inside a
throwaway container, never on your machine). `e2e.sh` refuses to run beside a
real `hoanglong-bo` compose project.
