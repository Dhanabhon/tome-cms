#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env.local"

fail() {
  echo "Error: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing '$1'. Install it and run this script again."
}

env_value() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

normalize_url() {
  node - "$1" "$2" <<'NODE'
const [raw, mode] = process.argv.slice(2);
const url = new URL(raw);
const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);

if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
  throw new Error('Use the Supabase base URL without credentials, a path, query, or fragment.');
}
if (url.protocol !== 'https:' && !(mode === 'self-hosted' && loopback && url.protocol === 'http:')) {
  throw new Error('Use HTTPS. Plain HTTP is accepted only for a loopback self-hosted instance.');
}
process.stdout.write(url.origin);
NODE
}

validate_key() {
  local label="$1"
  local value="$2"
  (( ${#value} >= 20 )) || fail "${label} looks incomplete."
  [[ "$value" =~ ^[A-Za-z0-9._-]+$ ]] || fail "${label} contains unsupported characters."
}

preserve_env() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      TOME_CMS_SUPABASE_MODE=*|PUBLIC_SUPABASE_URL=*|PUBLIC_SUPABASE_PUBLISHABLE_KEY=*|SUPABASE_SECRET_KEY=*|PUBLIC_SUPABASE_ANON_KEY=*|SUPABASE_SERVICE_ROLE_KEY=*|TOME_CMS_INSTALL_TOKEN=*|TOME_CMS_DOMAIN=*) ;;
      *) printf '%s\n' "$line" ;;
    esac
  done
}

prompt_value() {
  local variable_name="$1"
  local label="$2"
  local current="$3"
  local value=""
  [[ -t 0 ]] || fail "${label} is missing. Set it as an environment variable for non-interactive use."
  if [[ -n "$current" ]]; then
    read -r -p "${label} [${current}]: " value
    value="${value:-$current}"
  else
    read -r -p "${label}: " value
  fi
  [[ -n "$value" ]] || fail "${label} is required."
  printf -v "$variable_name" '%s' "$value"
}

prompt_secret() {
  local variable_name="$1"
  local label="$2"
  local current="$3"
  local value=""
  [[ -t 0 ]] || fail "${label} is missing. Set it as an environment variable for non-interactive use."
  if [[ -n "$current" ]]; then
    read -r -s -p "${label} (press Enter to keep the current value): " value
    value="${value:-$current}"
  else
    read -r -s -p "${label}: " value
  fi
  echo
  [[ -n "$value" ]] || fail "${label} is required."
  printf -v "$variable_name" '%s' "$value"
}

self_test() {
  [[ "$(normalize_url 'https://example.supabase.co/' cloud)" == 'https://example.supabase.co' ]]
  [[ "$(normalize_url 'http://127.0.0.1:8000/' self-hosted)" == 'http://127.0.0.1:8000' ]]
  if normalize_url 'http://example.com' self-hosted >/dev/null 2>&1; then
    fail 'Supabase configuration self-check accepted public HTTP.'
  fi
  [[ "$(printf '%s\n' '# Keep this comment' 'CUSTOM_SETTING=keep' 'PUBLIC_SUPABASE_ANON_KEY=replace' | preserve_env)" == $'# Keep this comment\nCUSTOM_SETTING=keep' ]]
  echo 'Supabase configuration self-check passed.'
}

need node
node_major="$(node -p "process.versions.node.split('.')[0]")"
(( node_major >= 22 )) || fail 'Node.js 22 or newer is required.'
if [[ "${1:-}" == '--self-test' ]]; then
  self_test
  exit 0
fi
if [[ "${1:-}" == '--help' ]]; then
  echo "Usage: $0 [cloud|self-hosted] [environment-file]"
  exit 0
fi
(( $# <= 2 )) || fail "Usage: $0 [cloud|self-hosted] [environment-file]"

need curl
need cp
need dirname
need mkdir
need mktemp
need mv
need sed
need tail

ENV_FILE="${2:-${TOMECMS_ENV_FILE:-$DEFAULT_ENV_FILE}}"
requested_mode="${1:-${TOME_CMS_SUPABASE_MODE:-}}"
MODE="${requested_mode:-$(env_value "$ENV_FILE" TOME_CMS_SUPABASE_MODE)}"
[[ -n "$requested_mode" || "$MODE" != 'local' ]] || MODE=''

if [[ -z "$MODE" ]]; then
  [[ -t 0 ]] || fail 'Choose cloud or self-hosted as the first argument.'
  echo 'Choose the Supabase deployment for TomeCMS:'
  echo '  1) Supabase Cloud (recommended)'
  echo '  2) Existing self-hosted Supabase (advanced)'
  read -r -p 'Selection [1]: ' selection
  case "${selection:-1}" in
    1) MODE='cloud' ;;
    2) MODE='self-hosted' ;;
    *) fail 'Choose 1 or 2.' ;;
  esac
fi
[[ "$MODE" == 'cloud' || "$MODE" == 'self-hosted' ]] || fail "Mode must be 'cloud' or 'self-hosted'."

if [[ -f "$ENV_FILE" && "${TOMECMS_CONFIGURE_CONFIRM:-}" != 'yes' ]]; then
  [[ -t 0 ]] || fail "${ENV_FILE} already exists. Set TOMECMS_CONFIGURE_CONFIRM=yes to replace its Supabase connection."
  read -r -p "Update the Supabase connection in ${ENV_FILE}? [y/N]: " confirmation
  [[ "$confirmation" == 'y' || "$confirmation" == 'Y' ]] || fail 'Configuration cancelled; no file was changed.'
fi

existing_url="$(env_value "$ENV_FILE" PUBLIC_SUPABASE_URL)"
existing_public_key="$(env_value "$ENV_FILE" PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
existing_public_key="${existing_public_key:-$(env_value "$ENV_FILE" PUBLIC_SUPABASE_ANON_KEY)}"
existing_secret_key="$(env_value "$ENV_FILE" SUPABASE_SECRET_KEY)"
existing_secret_key="${existing_secret_key:-$(env_value "$ENV_FILE" SUPABASE_SERVICE_ROLE_KEY)}"

supabase_url="${PUBLIC_SUPABASE_URL:-$existing_url}"
public_key="${PUBLIC_SUPABASE_PUBLISHABLE_KEY:-${PUBLIC_SUPABASE_ANON_KEY:-$existing_public_key}}"
secret_key="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-$existing_secret_key}}"

if [[ -t 0 ]]; then
  prompt_value supabase_url 'Supabase URL' "$supabase_url"
  prompt_secret public_key 'Publishable or anon key' "$public_key"
  prompt_secret secret_key 'Secret or service-role key' "$secret_key"
else
  [[ -n "$supabase_url" ]] || fail 'PUBLIC_SUPABASE_URL is required for non-interactive use.'
  [[ -n "$public_key" ]] || fail 'A publishable or anon key is required for non-interactive use.'
  [[ -n "$secret_key" ]] || fail 'A secret or service-role key is required for non-interactive use.'
fi

supabase_url="$(normalize_url "$supabase_url" "$MODE")"
validate_key 'Publishable or anon key' "$public_key"
validate_key 'Secret or service-role key' "$secret_key"

echo "Checking ${supabase_url}..."
if ! printf 'apikey: %s\nAuthorization: Bearer %s\n' "$public_key" "$public_key" | \
  curl --fail --silent --show-error --max-time 10 \
  --header @- "${supabase_url}/rest/v1/" >/dev/null; then
  fail 'Could not authenticate with the Supabase Data API using the public key. No file was changed.'
fi
if ! printf 'apikey: %s\nAuthorization: Bearer %s\n' "$secret_key" "$secret_key" | \
  curl --fail --silent --show-error --max-time 10 --header @- \
    "${supabase_url}/auth/v1/admin/users?page=1&per_page=1" >/dev/null; then
  fail 'The supplied admin key cannot access the Supabase Auth Admin API. No file was changed.'
fi

install_token="${TOME_CMS_INSTALL_TOKEN:-$(env_value "$ENV_FILE" TOME_CMS_INSTALL_TOKEN)}"
if (( ${#install_token} < 24 )); then
  install_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"
fi
domain="${TOME_CMS_DOMAIN:-$(env_value "$ENV_FILE" TOME_CMS_DOMAIN)}"
[[ -z "$domain" || "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail 'TOME_CMS_DOMAIN must be a hostname without a scheme or path.'
[[ "$install_token" =~ ^[A-Za-z0-9._~-]+$ ]] || fail 'TOME_CMS_INSTALL_TOKEN contains unsupported characters.'

env_directory="$(dirname "$ENV_FILE")"
mkdir -p "$env_directory"
env_tmp="$(mktemp "${env_directory}/.tomecms-env.XXXXXX")"
trap 'rm -f "$env_tmp"' EXIT
if [[ -f "$ENV_FILE" ]]; then
  cp -p "$ENV_FILE" "$env_tmp"
  chmod o-rwx "$env_tmp"
else
  chmod 600 "$env_tmp"
fi
{
  if [[ -f "$ENV_FILE" ]]; then
    preserve_env <"$ENV_FILE"
  else
    echo '# Generated by TomeCMS Supabase setup'
  fi
  echo "TOME_CMS_SUPABASE_MODE=${MODE}"
  echo "PUBLIC_SUPABASE_URL=${supabase_url}"
  echo "PUBLIC_SUPABASE_PUBLISHABLE_KEY=${public_key}"
  echo "SUPABASE_SECRET_KEY=${secret_key}"
  echo "TOME_CMS_INSTALL_TOKEN=${install_token}"
  echo "TOME_CMS_DOMAIN=${domain}"
} >"$env_tmp"
mv "$env_tmp" "$ENV_FILE"
trap - EXIT

echo "Supabase ${MODE} connection saved to ${ENV_FILE}."
echo 'Next: apply the TomeCMS migrations, then start or deploy TomeCMS and open /install.'
