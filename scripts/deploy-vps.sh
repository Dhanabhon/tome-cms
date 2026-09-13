#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "${BASH_SOURCE[0]%/*}/.." && pwd)"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Linux" ]] || fail "VPS deployment requires Linux. Use npm run dev:macos for local macOS development."

for command_name in node docker; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing '${command_name}'. Install it and run this command again."
done
docker info >/dev/null 2>&1 || fail "Docker is not running or the current user cannot access it."

cd "$ROOT_DIR"
tag="$(git describe --tags --exact-match HEAD 2>/dev/null || true)"
if [[ "$tag" =~ ^v([1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  exec /bin/bash scripts/install-managed-vps.sh --version "${tag#v}" "$@"
fi
node scripts/bootstrap-core.mjs --production "$@"
