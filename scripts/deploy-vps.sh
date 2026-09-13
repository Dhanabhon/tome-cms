#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "Error: $*" >&2
  exit 1
}

for command_name in node npm docker; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing '${command_name}'. Install it and run this command again."
done
docker info >/dev/null 2>&1 || fail "Docker is not running or the current user cannot access it."

cd "$ROOT_DIR"
npm ci
node scripts/bootstrap-core.mjs --production "$@"
