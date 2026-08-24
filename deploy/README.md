# VPS deployment — opsystem.hoanglonglti.com

Runtime only. Nothing here builds on the VPS if it can be avoided: 1 CPU / 2 GB.

```
Cloudflare (DNS, proxy, TLS)  →  nginx :443 (host)  →  /        static files
                                                     →  /api/   127.0.0.1:3000
                                                                   ↓ compose network
                                                                postgres (no port)
```

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

### Releasing by hand

Only when the pipeline cannot. Same order it uses, and the order matters:
`migrate` runs ts-node from *inside* the image, so the image has to exist first,
and the schema has to be in place before the container expecting it starts.

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

<!-- ponytail: no image registry, no automated backup cron. Releases now run
     from .github/workflows/ci.yml, but the image is still built on the VPS and
     the dump is still taken per-release rather than on a schedule. Add a
     registry when two machines need the same image, and a cron dump when losing
     a day of staging data starts to matter. -->
