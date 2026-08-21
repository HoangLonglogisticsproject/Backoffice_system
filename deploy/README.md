# VPS deployment — opsystem.hoanglonglti.com

Runtime only. Nothing here builds on the VPS if it can be avoided: 1 CPU / 2 GB.

```
Cloudflare (DNS, proxy, TLS)  →  nginx :443 (host)  →  /        static files
                                                     →  /api/   127.0.0.1:3000
                                                                   ↓ compose network
                                                                postgres (no port)
```

## Layout on the VPS

```
/opt/hoanglong-bo/
├── docker-compose.yml     from deploy/
├── backend.Dockerfile     from deploy/
├── .env                   from deploy/env.example — NEVER committed
├── postgres-data/         bind mount, the database lives here
└── backend/               the backend source, for the build context
/var/www/opsystem/         frontend dist/, copied from a build machine
```

## First deploy

```bash
# 1. secrets, on the VPS, once
install -d -m 750 /opt/hoanglong-bo && cd /opt/hoanglong-bo
cp env.example .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24)|" .env
chmod 600 .env

# 2. bring up the database and the app
docker compose up -d --build

# 3. schema. Refuses rather than repairs — read the error, do not force it
docker compose run --rm --no-deps backend npm run migrate

# 4. the first SuperAdmin. Password is typed here and stored nowhere
read -rsp 'Bootstrap password: ' BOOTSTRAP_PASSWORD && echo
docker compose run --rm --no-deps -e BOOTSTRAP_PASSWORD backend \
  npm run user:create -- --email 'admin@hoanglongti.com' --name 'Tong Giam Doc' --superadmin
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
cd /opt/hoanglong-bo
docker compose ps                      # health
docker compose logs -f --tail=100 backend
docker compose restart backend         # restart app only
docker compose up -d --build           # redeploy backend after a code change
docker compose run --rm --no-deps backend npm run migrate   # after new migrations
systemctl reload nginx                 # after an nginx.conf change
```

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
