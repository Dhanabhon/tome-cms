#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "Use npm run dev:windows on Windows."
for command_name in node npm docker; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing '${command_name}'. Install it and run this command again."
done
docker info >/dev/null 2>&1 || fail "Docker Desktop is not running."

cd "$ROOT_DIR"
[[ -f node_modules/astro/package.json ]] || npm ci
node scripts/bootstrap-core.mjs "$@"
exec npm run dev
