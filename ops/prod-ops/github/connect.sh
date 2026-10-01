#!/bin/bash
# Prepares the SSH connection of a production ops job and proves it answers.
#
# ★ THE HOST KEY IS PINNED OR NOTHING HAPPENS. No ssh-keyscan, no TOFU, no
# StrictHostKeyChecking=no: PROD_OPS_KNOWN_HOSTS must already name this host.
# ★ THE KEY CAN ONLY REACH bo-prod-ops. On the server it is installed with a
# forced command (README.md), so what we send is the operation name and nothing
# else; the account behind it has no shell to fall back to.
#
# Env (from the `production` environment): PROD_OPS_HOST, PROD_OPS_PORT,
# PROD_OPS_SSH_KEY, PROD_OPS_KNOWN_HOSTS. Writes PROD_OPS_SSH_CONFIG to $GITHUB_ENV.
set -euo pipefail
readonly OPS_USER=bo-ops

die() { printf '::error::%s\n' "$*" >&2; exit 1; }
for name in PROD_OPS_HOST PROD_OPS_SSH_KEY PROD_OPS_KNOWN_HOSTS; do
  [[ -n "${!name:-}" ]] || die "$name is not set on the production environment"
done
port="${PROD_OPS_PORT:-22}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] || die "PROD_OPS_PORT is not a port number"
[[ "$PROD_OPS_HOST" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || die "PROD_OPS_HOST is not a host name or address"

dir="${RUNNER_TEMP:?}/prod-ops-ssh"
install -d -m 700 "$dir"
( umask 077
  printf '%s\n' "$PROD_OPS_SSH_KEY" > "$dir/key"
  printf '%s\n' "$PROD_OPS_KNOWN_HOSTS" > "$dir/known_hosts" )

hostspec="$PROD_OPS_HOST"
[[ "$port" == 22 ]] || hostspec="[$PROD_OPS_HOST]:$port"
ssh-keygen -F "$hostspec" -f "$dir/known_hosts" >/dev/null \
  || die "PROD_OPS_KNOWN_HOSTS has no key for $hostspec - pin it; this job never trusts a key on sight"

cat > "$dir/config" <<EOF
Host prod-ops
  HostName $PROD_OPS_HOST
  Port $port
  User $OPS_USER
  IdentityFile $dir/key
  IdentitiesOnly yes
  UserKnownHostsFile $dir/known_hosts
  GlobalKnownHostsFile /dev/null
  StrictHostKeyChecking yes
  UpdateHostKeys no
  BatchMode yes
  RequestTTY no
  ForwardAgent no
  ClearAllForwardings yes
  ConnectTimeout 20
  ServerAliveInterval 15
  ServerAliveCountMax 4
EOF
printf 'PROD_OPS_SSH_CONFIG=%s\n' "$dir/config" >> "${GITHUB_ENV:?}"
echo "SSH prepared for $OPS_USER@$hostspec with a pinned host key."
