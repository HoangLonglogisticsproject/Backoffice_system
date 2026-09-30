#!/bin/bash
# Runs github.test.sh and e2e.sh from a dev machine (Windows, macOS or Linux),
# inside a throwaway Linux container that drives the host's docker daemon. The
# wrapper, the sudo rule, the bo-ops account and the test sshd live in THAT
# container, never on the host.
set -euo pipefail
export MSYS_NO_PATHCONV=1
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && { pwd -W 2>/dev/null || pwd; })"
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$repo:/repo:ro" docker:28-cli sh -c '
  apk add --no-cache -q bash sudo coreutils grep sed util-linux-misc shadow diffutils \
    openssh-keygen openssh-client openssh-server >/dev/null &&
  install -d -m 755 /usr/local/sbin &&
  ln -sf /usr/local/bin/docker /usr/bin/docker &&
  bash /repo/ops/prod-ops/test/github.test.sh &&
  bash /repo/ops/prod-ops/test/e2e.sh'
