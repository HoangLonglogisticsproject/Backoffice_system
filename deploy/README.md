# VPS deployment — opsystem.hoanglonglti.com

Runtime only. Nothing here builds on the VPS if it can be avoided: 1 CPU / 2 GB.

```
THE FRONTEND USERS ACTUALLY LOAD IS ON VERCEL, not on this box:

  browser → Vercel (static + /api edge function)
                        │
                        ├─ PRIMARY   bo-api.hoanglonglti.com ─┐
                        └─ FALLBACK  Cloudflare Tunnel ──────┤
                                                             ↓
                                              nginx :443 (host) → /api/ → 127.0.0.1:3000
                                                                              ↓ compose network
                                                                          postgres (no port)

THE SECOND INGRESS, opsystem.hoanglonglti.com, is unchanged and still serves the
static build from /var/www/opsystem behind Cloudflare. Keep it: it is the route
that survives Vercel, the same way the tunnel is the route that survives DNS.
```

Which backend route is live is decided by one Vercel environment variable —
see **bo-api.hoanglonglti.com** below for both directions.

## Layout on the VPS

The repository is cloned whole and compose is run from `deploy/`, because that
is what the relative paths in `docker-compose.yml` already resolve against:

```
/opt/hoanglong-bo/            ← git clone of this repository
├── backend/                  ← build context
├── frontend/
└── deploy/                   ← RUN COMPOSE FROM HERE
    ├── docker-compose.yml
    ├── backend.Dockerfile
    └── postgres-data/        ← the database (gitignored)

/etc/hoanglong-bo/staging.env ← runtime secrets, root:root 0600, NEVER in git
/var/www/opsystem/            ← frontend dist/, uploaded from a build machine
/etc/ssl/cloudflare/          ← origin certificate
```

★ **The runtime env lives outside the git tree, and every compose command names
it explicitly.** Compose reads `.env` from the directory holding the compose
file — not the working directory, and it does not walk upwards — so leaving it
implicit made the secret's location a consequence of where you happened to be
standing. It also failed quietly: with no readable file, `${POSTGRES_USER}`
becomes a blank string, compose warns, and exits 0 having built
`postgres://:@postgres:5432/`. `--env-file` makes that a hard failure.

The checkout is rewritten by every release and will eventually belong to an
unprivileged deploy user, which is the other reason the secret is not in it.

Redeploying is a `git checkout` of an exact commit in `/opt/hoanglong-bo`, which
is the reason for cloning rather than copying files around.

**Releases are the pipeline's job now.** `release` in `.github/workflows/ci.yml`
compares the commit each half is actually running against `main` and deploys the
half that drifted, backend first. The commands below are what it does — kept
here because they are also what you run when you have to do it by hand.

★ **`APP_VERSION` is the release identity.** It becomes the image tag *and* the
`release.sha` label the pipeline reads back to prove which build is serving.
Leave it unset and you get `hoanglong-bo-backend:local`, which is honest: a hand
build is not a release and should not be able to pass for one.

## First deploy

```bash
git clone <repo-url> /opt/hoanglong-bo
cd /opt/hoanglong-bo/deploy

# secrets, once, OUTSIDE the git tree. Generated here and stored nowhere else.
ENV_FILE=/etc/hoanglong-bo/staging.env
install -d -m 700 -o root -g root /etc/hoanglong-bo
umask 077
cp env.example "$ENV_FILE"
# hex, not base64: this ends up inside postgres://user:PASSWORD@host/db, and a
# "/" in the password makes that URL unparseable. 39.7% of base64 values have one.
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" "$ENV_FILE"
chmod 600 "$ENV_FILE" && chown root:root "$ENV_FILE"

docker compose --env-file "$ENV_FILE" up -d --build

# schema. Refuses rather than repairs — read the error, do not force it
docker compose --env-file "$ENV_FILE" run --rm --no-deps backend npm run migrate

# the first SuperAdmin. Password is typed here and stored nowhere
read -rsp 'Bootstrap password: ' BOOTSTRAP_PASSWORD && echo
docker compose --env-file "$ENV_FILE" run --rm --no-deps -e BOOTSTRAP_PASSWORD backend   npm run user:create -- --email 'admin@hoanglonglti.com' --name 'Tong Giam Doc' --superadmin
unset BOOTSTRAP_PASSWORD
```

## Frontend

Built on a machine that is not the VPS, then copied:

```bash
# build machine
cd frontend && npm ci && npm run build      # .env.production sets VITE_API_URL=/api
rsync -az --delete -e 'ssh -p 24700' dist/ root@162.4.177.62:/var/www/opsystem/
```

## nginx + TLS

```bash
# Cloudflare origin certificate, pasted from the dashboard
install -d -m 700 /etc/ssl/cloudflare
nano /etc/ssl/cloudflare/opsystem.pem      # certificate
nano /etc/ssl/cloudflare/opsystem.key      # private key
chmod 600 /etc/ssl/cloudflare/opsystem.key

cp deploy/nginx.conf /etc/nginx/sites-available/opsystem
ln -sf /etc/nginx/sites-available/opsystem /etc/nginx/sites-enabled/opsystem
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Only after `curl -I https://162.4.177.62 --resolve …` answers from the origin:
set Cloudflare SSL/TLS to **Full (strict)**. Never Flexible — it would leave
Cloudflare→origin in clear text while the padlock claims otherwise.

## Firewall

```bash
ufw allow 24700/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
ufw status verbose
ss -lntp        # 5432 and 3000 must NOT appear on 0.0.0.0
```

## Day to day

```bash
cd /opt/hoanglong-bo/deploy
export ENV_FILE=/etc/hoanglong-bo/staging.env

docker compose --env-file "$ENV_FILE" ps                 # health
docker compose --env-file "$ENV_FILE" logs -f --tail=100 backend
docker compose --env-file "$ENV_FILE" restart backend    # restart app only
systemctl reload nginx                                   # after an nginx.conf change

# which commit is actually serving? the question the pipeline asks
docker inspect --format '{{index .Config.Labels "release.sha"}}'   "$(docker compose --env-file "$ENV_FILE" ps -q backend)"
```

## Migrations 0027–0029 — multi-vehicle dispatch, and the 0030 gate

`npm run migrate` applies `0027`–`0029` like any other release. They are idempotent
and forward-only; `0027` adds the CHECK as **NOT VALID** so it cannot fail on legacy
rows, and `0029` only backfills rows whose `vehicle_id` is still NULL. `0029` prints
`RAISE NOTICE` counts for Case B/E/F — read them in the migrate output and keep them
with the release notes.

**The rollout window.** `vps-release.sh` builds the image first, then migrates, then
swaps the container, so the previous backend keeps running for the few seconds between
`0027` landing and `compose up -d` replacing it. In that window a dispatch from the OLD
code inserts an assignment with no `vehicle_id`, which the new CHECK refuses: that
request fails with a 500 and **nothing is written** — the constraint is what keeps the
data clean. The same holds if a release is rolled back to the previous image after
`0027` applied: every route works except assigning a driver, until the new code is
released again. No data is at risk either way; a dispatcher retries after the swap.

**Before** promoting a release that contains `0030` (VALIDATE), run the audit on
production and require **Case B = 0**:

```sql
-- Case B: an ACTIVE assignment with no lorry — the rows VALIDATE would reject.
SELECT a.id, a.trip_id, a.driver_user_id, a.assigned_at
FROM trip_driver_assignments a
WHERE a.state = 'active' AND a.vehicle_id IS NULL;

-- The rest of the picture, for the log:
SELECT
  count(*) FILTER (WHERE state = 'active' AND vehicle_id IS NULL) AS case_b_active_no_vehicle,
  count(*) FILTER (WHERE state = 'ended'  AND vehicle_id IS NULL) AS ended_no_vehicle,
  count(*) FILTER (WHERE vehicle_id IS NOT NULL)                  AS with_vehicle
FROM trip_driver_assignments;
```

If Case B is not empty, Operations fixes each row from the dispatch panel (remove the
turn, add it again as a pair) — **never** by hand-editing `vehicle_id`. Only then:

```sql
-- 0030, when it is committed, is exactly this and nothing else:
ALTER TABLE trip_driver_assignments VALIDATE CONSTRAINT trip_driver_assignments_active_has_vehicle;
```

## Restricted deploy user

GitHub Actions does not SSH as root, and the account it does use cannot reach
the Docker daemon, cannot read the runtime secret, and cannot write the
repository. It is allowed exactly one privileged action:

```
GitHub Actions
  -> ssh deploy@vps
  -> sudo -n /usr/local/bin/bo-release <40-hex-sha>
  -> root wrapper: validate, fetch, checkout, verify HEAD
  -> exec /opt/hoanglong-bo/.github/scripts/vps-release.sh <sha>
```

### Why the wrapper is split in two

`/usr/local/bin/bo-release` lives on the box, is root-owned, and almost never
changes: it is the trust anchor. It does the four things that must be true
before any repository code runs, then hands over to a script that is **versioned
with the commit being released** — so a release brings its own deployment logic
while the anchor stays still.

⚠ **Root therefore executes repository code.** That is not new — `docker build`
has always run this repository's Dockerfile with root-equivalent privilege — but
say it plainly: the gate is branch protection and review, not file permissions.
What this arrangement buys is that `deploy` cannot WRITE the repository, so only
merged code ever runs as root.

### `/usr/local/bin/bo-release`

Install verbatim, `root:root 0755`:

```bash
#!/usr/bin/env bash
# The only command the deploy user may run as root. Small enough to read in one
# sitting: everything it does is a precondition for trusting the script it hands
# over to.
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

REPO_DIR=/opt/hoanglong-bo

[ "$#" -eq 1 ] || { echo "usage: bo-release <40-hex-sha>" >&2; exit 2; }
SHA="$1"

# Lowercase hex, exactly forty. The shape alone removes every shell
# metacharacter, every path, and any leading "-" that could become a git OPTION.
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "ERROR: not a 40-char lowercase hex sha" >&2; exit 2; }

cd "$REPO_DIR"
git fetch --all --prune --tags --quiet
git rev-parse --verify --quiet "${SHA}^{commit}" >/dev/null \
  || { echo "ERROR: $SHA is not a commit in this repository" >&2; exit 2; }
git checkout --detach --quiet "$SHA"

# Belt and braces: prove we are where we asked to be before running anything.
HEAD_SHA="$(git rev-parse HEAD)"
[ "$HEAD_SHA" = "$SHA" ] || { echo "ERROR: HEAD is $HEAD_SHA, expected $SHA" >&2; exit 1; }

# A dirty tree means the image would carry code that is not $SHA while the
# release.sha label claims it is.
if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  echo "ERROR: working tree is dirty - refusing to release" >&2
  exit 1
fi

exec /usr/bin/env bash "$REPO_DIR/.github/scripts/vps-release.sh" "$SHA"
```

### sudoers

Generated rather than typed — forty character classes is an invitation to a
typo, and the wrong one fails open:

```bash
pat=$(printf '[0-9a-f]%.0s' $(seq 40))
printf 'Cmnd_Alias BO_RELEASE = /usr/local/bin/bo-release %s\n' "$pat" > /etc/sudoers.d/bo-release
printf 'Defaults!BO_RELEASE  env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"\n' >> /etc/sudoers.d/bo-release
printf 'deploy ALL=(root) NOPASSWD: BO_RELEASE\n' >> /etc/sudoers.d/bo-release
chmod 440 /etc/sudoers.d/bo-release

visudo -c            # MUST say "parsed OK" before you log out
sudo -l -U deploy    # MUST list exactly this one entry
```

⚠ **Never write `bo-release *`.** A free wildcard accepts any argument,
including a path, and is the classic way a sudo rule becomes a root shell. Each
`[0-9a-f]` matches exactly one character, so the pattern pins both length and
alphabet: a 39- or 41-character argument, an uppercase sha, `--upload-pack=…` or
`/etc/…` all fail to match and sudo refuses.

The pattern is a second opinion, not the defence — `bo-release` and
`vps-release.sh` each validate the argument again. Three checks that can
disagree beat one that is trusted.

### Filesystem

| Path | Owner | Mode | What `deploy` can do |
|---|---|---|---|
| `/opt/hoanglong-bo` | `root:root` | `0750` | nothing |
| `/etc/hoanglong-bo/staging.env` | `root:root` | `0600` | nothing |
| `deploy/postgres-data` | `70:70` | `0700` | nothing |
| `/usr/local/bin/bo-release` | `root:root` | `0755` | execute, through sudo only |

`0750` rather than `0755`: the deploy user runs everything through root and has
no reason to read the checkout at all.

⚠ `postgres-data` must stay `0700` owned by uid/gid 70 — PostgreSQL refuses to
start if its data directory is group- or world-accessible.

### Bootstrap, in three separate steps

Each one fails differently. Do not combine them.

```bash
# 1. install the wrapper and the sudo rule, change nothing else. Set
#    VPS_USER=deploy in GitHub and run one real release, while `deploy` still
#    has its old privileges to fall back on.

# 2. take the repository away from the deploy user
#
#    ★ postgres-data is EXCLUDED, not chowned and put back. It belongs to
#    uid/gid 70 inside the container, and `chown -R root:root` across a LIVE
#    data directory is a running database losing access to its own files — for
#    the second it takes to restore it, which is a second too long. Prune it.
find /opt/hoanglong-bo -path /opt/hoanglong-bo/deploy/postgres-data -prune \
  -o -exec chown root:root {} +
chmod 750 /opt/hoanglong-bo

#    it should not have moved; check rather than assume
stat -c '%u:%g %a  %n' /opt/hoanglong-bo/deploy/postgres-data   # MUST be 70:70 700
#    then run another release

# 3. take the Docker daemon away
gpasswd -d deploy docker
```

⚠ Group membership only changes on a **new** login session; an SSH connection
already open keeps the old groups.

### Prove it

These four lines are the whole point of the exercise. If the first three
succeed, `deploy` is still root-equivalent and the rest is decoration.

```bash
sudo -u deploy -i docker ps                           # MUST be denied
sudo -u deploy -i cat /etc/hoanglong-bo/staging.env   # MUST be denied
sudo -u deploy -i ls /opt/hoanglong-bo                # MUST be denied
sudo -u deploy -i sudo -n /usr/local/bin/bo-release "$(git -C /opt/hoanglong-bo rev-parse origin/main)"
```

### Rolling back the restriction

Reverse order, one step at a time, same exclusion:

```bash
# 3. give the Docker daemon back
gpasswd -a deploy docker

# 2. give the repository back — postgres-data pruned, for the same reason it was
#    pruned on the way in: it is uid/gid 70's, not the deploy user's, and a
#    recursive chown that sweeps it up breaks a database that is running fine.
find /opt/hoanglong-bo -path /opt/hoanglong-bo/deploy/postgres-data -prune \
  -o -exec chown deploy:deploy {} +
chmod 755 /opt/hoanglong-bo

stat -c '%u:%g %a  %n' /opt/hoanglong-bo/deploy/postgres-data   # MUST still be 70:70 700

# 1. set VPS_USER back to root in GitHub, and revert the commit
```

⚠ **`chown -R deploy:deploy /opt/hoanglong-bo` is not an acceptable shorthand
for step 2.** It reaches `deploy/postgres-data`, and PostgreSQL refuses to start
on a data directory it does not own — turning a routine rollback into an
outage. Both directions prune it, and both verify afterwards.

### Releasing by hand

Normally one line, as root:

```bash
/usr/local/bin/bo-release '<40-hex-sha>'
```

That is the same code the pipeline runs, because the pipeline runs exactly this.
The long form below is what `vps-release.sh` does; keep it for the case where
the wrapper is not installed yet, or when debugging one step in isolation.

Same order it uses, and the order matters: `migrate` runs ts-node from *inside*
the image, so the image has to exist first, and the schema has to be in place
before the container expecting it starts.

Paste it whole. Every check below **stops** the release rather than warning
about it — a comment saying "this must be empty" is not a check, and the one
time it matters is the one time nobody reads it.

```bash
set -euo pipefail

SHA='<full 40-char commit sha>'

cd /opt/hoanglong-bo
git fetch --all --prune
git checkout --detach "$SHA"

# A dirty tree means the image would carry code that is not $SHA, while the
# label claims it is. Refuse.
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  echo "Working tree is dirty - refusing to release." >&2
  exit 1
fi

cd deploy
export APP_VERSION="$SHA"
ENV_FILE=/etc/hoanglong-bo/staging.env
[ -r "$ENV_FILE" ] || { echo "Cannot read $ENV_FILE" >&2; exit 1; }
docker compose --env-file "$ENV_FILE" build backend

# ASK THE DATABASE, not yourself. "Does this release add a migration file?" is a
# different question from "does this database have one waiting". A release whose
# migration failed leaves the file unapplied; the next release touches nothing
# under migrations/ and would migrate it unprotected.
pg_user=$(sed -n 's/^POSTGRES_USER=//p' "$ENV_FILE" | head -1)
pg_db=$(sed -n 's/^POSTGRES_DB=//p' "$ENV_FILE" | head -1)
pending=$(bash ../.github/scripts/pending-migrations.sh . "$ENV_FILE" "$pg_user" "$pg_db")

# THE DUMP IS GATED, THE MIGRATE IS NOT. Two different questions:
#   does the schema need CHANGING?   -> decides the backup
#   does the schema MATCH the repo?  -> checked every single time
if [ -n "$pending" ]; then
  printf 'pending:\n%s\n' "$pending"

  # The backup is a GATE. A forward-only migration with no dump behind it is a
  # change with no way back, so a failed or empty dump stops here - before migrate.
  dump=~/bo-pre-$SHA.dump
  if ! docker compose --env-file "$ENV_FILE" exec -T postgres pg_dump -U "$pg_user" -Fc "$pg_db" > "$dump"; then
    rm -f "$dump"; echo "pg_dump failed - not migrating." >&2; exit 1
  fi
  [ -s "$dump" ] || { rm -f "$dump"; echo "pg_dump wrote an empty file - not migrating." >&2; exit 1; }
  ls -lh "$dump"
else
  echo "nothing pending - no dump, but the schema is still verified below"
fi

# ALWAYS, pending or not. With nothing pending it applies nothing, but it still
# compares every applied migration's recorded checksum against the file in this
# image. A migration edited after it was applied has no pending row, so this is
# the only thing that catches it - and CI cannot, because CI starts from an
# empty database where nothing has ever been "already applied".
docker compose --env-file "$ENV_FILE" run --rm -T --interactive=false --no-deps backend npm run migrate

# The runner exits 0 whether it applied anything or not, so ask the ledger.
still=$(bash ../.github/scripts/pending-migrations.sh . "$ENV_FILE" "$pg_user" "$pg_db")
[ -z "$still" ] || { printf 'still unapplied:\n%s\n' "$still" >&2; exit 1; }

docker compose --env-file "$ENV_FILE" up -d backend

curl -fsS http://127.0.0.1:3000/health
running=$(docker inspect --format '{{index .Config.Labels "release.sha"}}'   "$(docker compose --env-file "$ENV_FILE" ps -q backend)")
[ "$running" = "$SHA" ] || { echo "Container reports '$running', expected '$SHA'." >&2; exit 1; }
echo "released $SHA"
```

### Rolling back

```bash
ENV_FILE=/etc/hoanglong-bo/staging.env
docker images hoanglong-bo-backend        # the tags ARE the releases
APP_VERSION='<previous-sha>' docker compose --env-file "$ENV_FILE" up -d --no-build backend
```

⚠ **Code rollback is not schema rollback.** Migrations here are forward-only and
refuse rather than repair, so putting the previous image back does not undo one
that ran. If the release you are undoing carried a migration, the dump taken
above is the only way back — and restoring it is a decision a person makes, on
purpose. Nothing automated will do it for you.

## Backup / restore

```bash
ENV_FILE=/etc/hoanglong-bo/staging.env

# backup — run before every migration
docker compose --env-file "$ENV_FILE" exec -T postgres   pg_dump -U backoffice -Fc backoffice > ~/bo-$(date +%F-%H%M).dump

# restore into an empty database
docker compose --env-file "$ENV_FILE" exec -T postgres   pg_restore -U backoffice -d backoffice --clean --if-exists < ~/bo-XXXX.dump
```

`postgres-data/` is a bind mount, so `docker compose down` does not lose data;
only `rm -rf postgres-data` does. Take a dump before anything that migrates.

## bo-api.hoanglonglti.com — the direct HTTPS path to the API

### Why it exists

The frontend on Vercel does not talk to the backend directly; it calls its own
`/api/*` route, which is an edge function (`frontend/api/[...path].ts`) that
forwards to `BACKEND_ORIGIN`. That indirection is not a convenience — `bo_session`
is `SameSite=Strict`, so a browser calling the VPS directly would send no cookie
and every user would log in and be anonymous on the next request. The proxy is
what keeps every browser request same-origin.

**`BACKEND_ORIGIN` used to be a Cloudflare Tunnel hostname**, which made
`cloudflared` a single point of failure for the whole frontend: the tunnel
restarts, and every request becomes `BACKEND_UNAVAILABLE`.
`bo-api.hoanglonglti.com` is a second, independent route to the same nginx, and
is now the one in use:

```
                        ┌─ PRIMARY ─────────────────────────────────────────────┐
browser ──HTTPS──> Vercel ──> edge fn ──> bo-api.hoanglonglti.com ──> nginx :443 ──> 127.0.0.1:3000
                        │                (Matbao A record → VPS, Let's Encrypt)      │
                        └─ FALLBACK ────────────────────────────────────────────┘    │
                                         Cloudflare Tunnel ──> cloudflared ──────────┘
                                         (kept, unchanged, still running)
```

Failing over is one variable and a redeploy, in either direction — see
**Cutover, and going back** below.

⚠ **`hoanglonglti.com`, with the `l`.** `hoanglongti.com` is a *former* company
domain and is explicitly not ours any more —
`utils/validation/companyEmail.spec.ts` asserts that an address there is NOT
unwrapped as a company address. Typing the API hostname without the `l` points
it at a domain this company does not control. The certificate would simply fail
to issue, which is the good outcome; the bad one is a DNS record sitting in the
wrong zone while somebody debugs nginx.

### Why the cutover cannot affect login, cookies or CORS

Worth writing down, because "we changed where the API lives" sounds like exactly
the kind of change that breaks a session, and the reason it does not is the same
reason the edge function exists at all.

**The browser is never told.** `VITE_API_URL=/api` is relative, so the bundle
asks its own origin and nothing in it names a backend — grep it and the only
absolute URLs are in test fixtures. `BACKEND_ORIGIN` is read server-side, inside
the edge function. Swapping it changes the *second* hop of a two-hop path; the
first hop, the only one a browser participates in, is byte-for-byte identical
before and after.

Each of the four things that could plausibly break, and why it does not:

| | why the cutover is neutral |
|---|---|
| **Cookie scope** | `sessionCookieOptions` sets no `Domain`, so `bo_session` is host-only. The browser attributes it to the host in the URL bar — the Vercel origin — because that is the response it sees. The backend's own hostname has never been part of the cookie's identity, tunnel or not. |
| **`SameSite=Strict`** | About *site*, and the site is Vercel's. Every request the browser makes is same-origin to it. The hop from the edge function to `bo-api` is a server-side `fetch` with no browser and no SameSite to enforce. |
| **`Secure`** | Was HTTPS through the tunnel, is HTTPS through `bo-api`. No mixed content either way, and the browser-facing leg was always Vercel's TLS. |
| **CORS** | `CORS_ORIGINS` stays empty and stays unused. The browser issues no cross-origin request, so there is no preflight to answer. A server-side `fetch` is not subject to CORS at all. |

**CSRF survives because the guard does not look at the origin.** `CsrfGuard`
requires the `x-requested-with` header on unsafe methods and nothing else — it
never inspects `Origin` or `Referer`. The client sets that header in an axios
interceptor, and the edge function's header filtering removes only hop-by-hop
headers and the forwarding-identity set (`x-forwarded-*`, `forwarded`,
`x-real-ip`). `x-requested-with` is in neither list, so it arrives intact.

★ **One thing genuinely does change, and it is an improvement.** The login
throttle keys on `req.ip`, which resolves through `TRUSTED_PROXIES` to the
leftmost `X-Forwarded-For` entry nginx wrote from its own socket. Through the
tunnel that socket was `cloudflared` on loopback, so every caller in the world
collapsed onto one address and the per-IP throttle was effectively a single
global bucket. Through `bo-api` the peer is the Vercel POP that forwarded the
request — still shared, but by far fewer callers, and it varies by region. The
throttle gets *more* granular, not less.

`TRUSTED_PROXIES` itself needs no change: it names `172.16.0.0/12`, the Docker
bridge, which is the backend's immediate peer in both topologies because both
arrive through the same nginx.

### Cutover, and going back

The change is one variable in the Vercel project, and reverting is the same
variable. Neither is in this repository, on purpose — see the header comment in
`frontend/api/[...path].ts` for why the origin is configuration rather than code.

```
Vercel → Project → Settings → Environment Variables → BACKEND_ORIGIN (Production)
   now       https://bo-api.hoanglonglti.com
   fallback  https://<the tunnel hostname>   ← keep this recorded somewhere
then: Deployments → ⋯ → Redeploy       (the redeploy is what applies it)
```

Then set the same value on the GitHub `staging` environment so the pipeline
gates on the same endpoint the frontend actually calls:

```
staging environment → Variables → BACKEND_ORIGIN = https://bo-api.hoanglonglti.com
```

⚠ **Keep `cloudflared` running.** It costs nothing idle and it is the route that
survives a DNS problem, an expired certificate, or a Matbao outage — none of
which the direct path can ride out on its own. Reverting is a two-minute
dashboard change *only* while the tunnel is still up; if it has been torn down,
it is a two-hour one.

### DNS

One A record at Matbao, **unproxied and unrelated to Cloudflare** — that
independence is the whole point:

```
bo-api    A    162.4.177.62    TTL 300
```

Verify from somewhere that is not the VPS before going further:

```bash
dig +short bo-api.hoanglonglti.com A          # MUST be the VPS address
```

### Certificate

★ **HTTP-01, not DNS-01, and this is a deliberate deviation worth reading.**
DNS-01 was the requested flow. Matbao has no certbot DNS plugin, so DNS-01 here
means `--manual --preferred-challenges dns`, which **cannot renew unattended** —
certbot refuses to run a manual authenticator from the renewal timer. The
requirement was a certificate that renews automatically; HTTP-01 delivers that
with no extra moving parts, because the A record already points straight at this
box and this hostname is not behind Cloudflare. Use DNS-01 only if `:80` cannot
be opened — and then accept a diary entry every 60 days.

```bash
apt-get install -y certbot                      # no DNS plugin needed; webroot only
install -d -m 755 /var/www/certbot

# the :80 block must be live first — it is what answers the challenge
cp deploy/nginx-bo-api.conf /etc/nginx/sites-available/bo-api
ln -sf /etc/nginx/sites-available/bo-api /etc/nginx/sites-enabled/bo-api
```

⚠ `nginx -t` **will fail at this point**, because the `:443` block names
certificate files that do not exist yet. That is expected. Comment out the
`listen 443` server block, reload, get the certificate, then put it back:

```bash
nginx -t && systemctl reload nginx              # with :443 commented out

certbot certonly --webroot -w /var/www/certbot \
  -d bo-api.hoanglonglti.com \
  --non-interactive --agree-tos -m ops@hoanglonglti.com

# restore the :443 block, then
nginx -t && systemctl reload nginx
```

**Renewal is already automatic** — the `certbot` package installs
`certbot.timer`, which runs twice a day and renews inside 30 days of expiry. It
needs exactly one thing added: nginx must be told to pick up the new file.

```bash
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

systemctl list-timers certbot.timer             # MUST be listed and active
certbot renew --dry-run                         # MUST succeed — this is the test
```

⚠ `certbot renew --dry-run` is the only proof that renewal works. A certificate
that issues once and can never renew looks identical to a working one for 89
days.

### Firewall

`:80` must be open for the ACME challenge and stay open — HTTP-01 renews the
same way it issued.

```bash
ufw allow 80/tcp && ufw allow 443/tcp
ufw status verbose
```

### ⚠ Is the deployed vhost actually this file?

The box was configured by hand before `nginx-bo-api.conf` existed, so the two
are not automatically the same thing. Measured at cutover: the live host answers
`/api/health` 200 and `/` 404 exactly as this file specifies, but sends **no
`Strict-Transport-Security` header** — so the deployed vhost is the hand-written
one, not this.

That particular gap is harmless today (the only client is a server-side `fetch`,
which ignores HSTS), which is precisely why it will sit there unnoticed. This
file is the version to converge on; it is a superset, so applying it is safe:

```bash
curl -sI https://bo-api.hoanglonglti.com/api/health | grep -i strict-transport \
  || echo "repo config NOT applied"

# converge, when you next have a window
cp deploy/nginx-bo-api.conf /etc/nginx/sites-available/bo-api
nginx -t && systemctl reload nginx
```

### Verify the whole path

From a machine that is **not** the VPS, so the answer includes DNS, TLS, nginx
and the app:

```bash
curl -fsS https://bo-api.hoanglonglti.com/api/health          # {"status":"ok",…}
curl -sI https://bo-api.hoanglonglti.com/ | head -1           # MUST be 404 — no site here
openssl s_client -connect bo-api.hoanglonglti.com:443 -servername bo-api.hoanglonglti.com </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates
```

The pipeline asks the first of those on every release, through the `staging`
environment variable set under **Cutover, and going back**. Leave it unset and
the release only warns — but then the frontend is promoted on
the strength of a loopback health check, which is the skew this whole
arrangement exists to prevent.

### The authenticated check, done by a person, once

CI verifies everything that can be verified without a credential: `/api/health`
answers, and a guarded endpoint refuses an anonymous caller in JSON. It stops
there on purpose — a standing production password in GitHub Secrets is a worse
risk than the one an automated login smoke retires.

So the authenticated leg is checked by hand at cutover, in a browser, against
the **production frontend origin** — not against `bo-api`, because the point is
to prove the cookie works where the browser actually sets it.

1. Open the production site in a **private window** (no cached session, and an
   old cookie cannot mask a broken login).
2. Open DevTools → Network before logging in. Log in.
3. Check, in order:

| what | expected | what it would mean otherwise |
|---|---|---|
| `POST /api/auth/login` | `200`, and a `Set-Cookie: bo_session=…` on the **site's own origin** | If the cookie names any other domain, the edge function is rewriting it — it is not, but that is the thing to look at. |
| the cookie's attributes | `HttpOnly`, `Secure`, `SameSite=Strict`, **no `Domain`** | A `Domain` attribute appearing would mean the backend started setting one; host-only is what makes this cutover invisible to the browser. |
| `GET /api/authorization/me` | `200` with the permission set | `401` here, right after a `200` login, is the cookie not coming back — the one genuine cutover-shaped failure. |
| any one real read, e.g. open the trip schedule | rows load | Proves an authenticated, non-trivial query traverses Vercel → `bo-api` → nginx → app → PostgreSQL. |
| a write, e.g. edit something harmless and save | `200`, not `403` | `403` with "must send the x-requested-with header" means the header was stripped in transit. It is not in the proxy's strip lists, so this should not happen — but it is the one CSRF failure mode worth a deliberate look. |

4. Leave the tab open for a minute and confirm the notification stream stays
   connected (`GET /api/notifications/stream`, status `200`, pending). SSE is
   the one long-lived connection, and a proxy that buffers it looks fine for
   exactly as long as nobody waits.

If any of these fail, revert `BACKEND_ORIGIN` to the tunnel and redeploy —
**Cutover, and going back**, above. Two minutes, while the tunnel is still up.

## Frontend cache semantics

`frontend/vercel.json` carries two `headers` rules, and the reasoning does not
fit in JSON:

| path | header | why |
|---|---|---|
| `/((?!assets/\|api/).*)` | `public, max-age=0, must-revalidate` | Every SPA route serves `index.html`, and `index.html` names the hashed bundle. Cache it and a deploy stays invisible until the browser decides otherwise — the "clear your cache" ticket. Revalidating costs a 304. |
| `/assets/(.*)` | `public, max-age=31536000, immutable` | Content-addressed filenames. The name changes when the bytes do, so there is nothing to revalidate. |

The two sources do not overlap, on purpose: Vercel applies **every** matching
rule and the last one wins per header name, so overlapping sources would make
the order load-bearing and invisible.

★ **There is no service worker and never has been** — no `vite-plugin-pwa`, no
`navigator.serviceWorker.register` anywhere in `frontend/src`. Verified rather
than assumed, because a stale service worker is the one cache a header cannot
reach, and it is the usual reason "clear your cache" is the only advice that
works. If one is ever added, the unregister path has to be added with it.

★ **One lazy chunk exists**: `utils/export/tripScheduleWorkbook.ts` imports
`xlsx` on demand. A tab open across a deploy asks for a chunk filename the new
build no longer emits, and the export button then silently does nothing.
`frontend/src/main.tsx` handles `vite:preloadError` and reloads once, keyed to
the URL so a genuinely broken deploy surfaces instead of looping.

★ **Vercel Skew Protection is a project setting, not a repository one.** It is
worth turning on (Settings → Advanced), and it is not what makes the above safe:
it pins a *client* to the deployment it loaded, which helps the API function and
does nothing about a hashed asset the production alias no longer serves. The two
are complementary; neither replaces the other.

<!-- ponytail: no image registry, no automated backup cron. Releases now run
     from .github/workflows/ci.yml, but the image is still built on the VPS and
     the dump is still taken per-release rather than on a schedule. Add a
     registry when two machines need the same image, and a cron dump when losing
     a day of staging data starts to matter. -->
