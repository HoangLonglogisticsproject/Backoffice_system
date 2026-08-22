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
    ├── .env                  ← created on the VPS, never committed
    └── postgres-data/        ← the database (gitignored)

/var/www/opsystem/            ← frontend dist/, uploaded from a build machine
/etc/ssl/cloudflare/          ← origin certificate
```

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

# secrets, once. Generated here and stored nowhere else
cp env.example .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24)|" .env
chmod 600 .env

docker compose up -d --build

# schema. Refuses rather than repairs — read the error, do not force it
docker compose run --rm --no-deps backend npm run migrate

# the first SuperAdmin. Password is typed here and stored nowhere
read -rsp 'Bootstrap password: ' BOOTSTRAP_PASSWORD && echo
docker compose run --rm --no-deps -e BOOTSTRAP_PASSWORD backend   npm run user:create -- --email 'admin@hoanglonglti.com' --name 'Tong Giam Doc' --superadmin
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
docker compose ps                      # health
docker compose logs -f --tail=100 backend
docker compose restart backend         # restart app only
systemctl reload nginx                 # after an nginx.conf change

# which commit is actually serving? the question the pipeline asks
docker inspect --format '{{index .Config.Labels "release.sha"}}' "$(docker compose ps -q backend)"
```

### Releasing by hand

Only when the pipeline cannot. Same order it uses, and the order matters:
`migrate` runs ts-node from *inside* the image, so the image has to exist first,
and the schema has to be in place before the container expecting it starts.

```bash
SHA=<full 40-char commit sha>
cd /opt/hoanglong-bo
git fetch --all --prune && git checkout --detach "$SHA"
git status --porcelain    # must be empty; a dirty tree is not a release

cd deploy
export APP_VERSION="$SHA"
docker compose build backend
docker compose exec -T postgres pg_dump -U backoffice -Fc backoffice > ~/bo-pre-$SHA.dump   # if this release migrates
docker compose run --rm --no-deps backend npm run migrate
docker compose up -d backend

curl -fsS http://127.0.0.1:3000/health
docker inspect --format '{{index .Config.Labels "release.sha"}}' "$(docker compose ps -q backend)"   # must equal $SHA
```

### Rolling back

```bash
docker images hoanglong-bo-backend        # the tags ARE the releases
APP_VERSION=<previous-sha> docker compose up -d --no-build backend
```

⚠ **Code rollback is not schema rollback.** Migrations here are forward-only and
refuse rather than repair, so putting the previous image back does not undo one
that ran. If the release you are undoing carried a migration, the dump taken
above is the only way back — and restoring it is a decision a person makes, on
purpose. Nothing automated will do it for you.

## Backup / restore

```bash
# backup — run before every migration
docker compose exec -T postgres pg_dump -U backoffice -Fc backoffice > ~/bo-$(date +%F-%H%M).dump

# restore into an empty database
docker compose exec -T postgres pg_restore -U backoffice -d backoffice --clean --if-exists < ~/bo-XXXX.dump
```

`postgres-data/` is a bind mount, so `docker compose down` does not lose data;
only `rm -rf postgres-data` does. Take a dump before anything that migrates.

<!-- ponytail: no CI/CD, no image registry, no automated backup cron. This is a
     demo deploy driven by hand. Add a registry when two machines need the same
     image, and a cron dump when losing a day of staging data starts to matter. -->
