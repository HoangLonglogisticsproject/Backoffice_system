#!/usr/bin/env bash
# Proves the public nginx hosts refuse the internal API namespace — in ANY case.
#
# ★ WHY THIS IS A TEST AND NOT A CODE REVIEW. `location ^~ /api/internal/` is
# case-SENSITIVE, so `/api/Internal/v1/...` fell through to the general `/api/`
# proxy, whose trailing `proxy_pass .../` strips `/api/` and hands
# `/Internal/v1/...` to Express — which matches routes case-INSENSITIVELY by
# default. The internal read models were therefore reachable from the internet,
# with only the service token in the way. The architecture invariant (ADR-0007)
# is that the NETWORK refuses those paths before authentication is consulted,
# so the invariant has to be verified by making requests, not by reading the
# config and reasoning about nginx's matching order.
#
# Runs the REAL deploy configs in an nginx container, with a stand-in upstream
# that echoes the path it was handed. If a probe ever prints APP_SAW for an
# internal path, the request reached the application and the invariant is gone.
#
#   bash .github/scripts/check-nginx-internal-block.sh
#
# Requires Docker. Skips (exit 0) with a clear message when Docker is absent,
# so it never fails a machine that simply cannot run it.
set -euo pipefail

IMAGE="${NGINX_IMAGE:-nginx:1.27-alpine}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! docker version >/dev/null 2>&1; then
  echo "check-nginx-internal-block: Docker is not available — skipping."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/sites"
cp "$ROOT/deploy/nginx.conf" "$WORK/sites/public.conf"
cp "$ROOT/deploy/nginx-bo-api.conf" "$WORK/sites/bo-api.conf"

cat > "$WORK/nginx.conf" <<'CONF'
worker_processes 1;
events { worker_connections 64; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log off;
    error_log  /dev/stderr warn;

    # The stand-in for the NestJS app. It echoes the path the proxy handed it,
    # which is what `proxy_pass http://upstream/` rewrote the request to.
    server {
        listen 127.0.0.1:3000;
        location / { add_header Content-Type text/plain; return 200 "APP_SAW:$uri\n"; }
    }

    include /etc/nginx/sites/*.conf;
}
CONF

cat > "$WORK/probe.sh" <<'SH'
#!/bin/sh
set -e
SITE="$1"; HOSTNAME="$2"
apk add --no-cache openssl >/dev/null 2>&1
mkdir -p /certs /var/www/opsystem /var/www/certbot /etc/nginx/sites
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$HOSTNAME" \
  -keyout /certs/key -out /certs/cert >/dev/null 2>&1
cp "/work/sites/$SITE" /etc/nginx/sites/site.conf
# The real certificate paths do not exist here; point them at the throwaway pair.
sed -i "s#ssl_certificate  *[^;]*;#ssl_certificate /certs/cert;#" /etc/nginx/sites/site.conf
sed -i "s#ssl_certificate_key  *[^;]*;#ssl_certificate_key /certs/key;#" /etc/nginx/sites/site.conf
echo "<html>spa</html>" > /var/www/opsystem/index.html
cp /work/nginx.conf /etc/nginx/nginx.conf

nginx -t
nginx
sleep 1

fail=0

# Every one of these must be refused at the edge, and none may reach the app.
for path in \
  /api/internal/v1/read-models/dispatch/unassigned-trips \
  /api/Internal/v1/read-models/dispatch/unassigned-trips \
  /api/INTERNAL/v1/read-models/dispatch/unassigned-trips \
  /api/InTeRnAl/v1/read-models/dispatch/unassigned-trips \
  /api/iNTERNAl/v1/subjects/lookup \
  /api/%49nternal/v1/health \
  /api/internal \
  /api/Internal ; do
    code=$(curl -sk -o /tmp/body -w '%{http_code}' -H "Host: $HOSTNAME" "https://127.0.0.1$path")
    body=$(cat /tmp/body)
    case "$body" in *APP_SAW*) echo "  ✘ $path REACHED THE APP: $body"; fail=1; continue;; esac
    if [ "$code" != "404" ]; then echo "  ✘ $path -> $code, expected 404"; fail=1; continue; fi
    echo "  ✔ $path -> 404, blocked at the edge"
done

# And the ordinary public API must be completely unaffected, including a path
# that merely begins with the same letters.
for path in /api/auth/login /api/health /api/departments /api/internalize/list ; do
    body=$(curl -sk -H "Host: $HOSTNAME" "https://127.0.0.1$path")
    expected="APP_SAW:$(echo "$path" | sed 's#^/api##')"
    if [ "$body" != "$expected" ]; then echo "  ✘ $path -> '$body', expected '$expected'"; fail=1; continue; fi
    echo "  ✔ $path -> $body"
done

nginx -s stop >/dev/null 2>&1 || true
exit $fail
SH

status=0
for pair in "public.conf opsystem.hoanglonglti.com" "bo-api.conf bo-api.hoanglonglti.com"; do
  set -- $pair
  echo "── $1 ($2)"
  if ! MSYS_NO_PATHCONV=1 docker run --rm -v "$(cd "$WORK" && pwd -W 2>/dev/null || pwd):/work" \
      "$IMAGE" sh -c "sh /work/probe.sh $1 $2"; then
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "✘ the internal namespace is reachable through a public host"
  exit 1
fi

echo "✔ both public hosts refuse /api/internal in every case variant, and the public API still routes"
