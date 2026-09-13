#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="tome-cms"
APP_USER="tomecms"
APP_PORT="${APP_PORT:-4321}"
DEPLOY_ROOT="/opt/tome-cms"
ENV_FILE="/etc/tome-cms/tome-cms.env"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASES_DIR="${DEPLOY_ROOT}/releases"
CURRENT_LINK="${DEPLOY_ROOT}/current"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
RECOVERY_RELEASE_FILES=(
  scripts/recover-owner.mjs
  scripts/recover-owner.ts
  src/server/auth/context.ts
  src/server/auth/enrollment.ts
  src/server/auth/recovery.ts
  src/server/db/client.ts
  src/server/db/types.ts
  src/server/env.ts
)

if (( EUID == 0 )); then
  SUDO=()
else
  command -v sudo >/dev/null 2>&1 || { echo "Error: sudo is required." >&2; exit 1; }
  SUDO=(sudo)
fi

fail() {
  echo "Error: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing '$1'. Install it and run this script again."
}

as_app_user() {
  if (( EUID == 0 )); then
    runuser -u "$APP_USER" -- "$@"
  else
    "${SUDO[@]}" -u "$APP_USER" -- "$@"
  fi
}

env_value() {
  "${SUDO[@]}" sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

for command_name in node npm curl systemctl install readlink sed tail flock getent useradd id; do
  need "$command_name"
done
(( EUID != 0 )) || need runuser

[[ "$(uname -s)" == "Linux" ]] || fail "This deployment script supports Linux VPS hosts only."
if [[ ! "$APP_PORT" =~ ^[0-9]+$ ]] || (( APP_PORT < 1 || APP_PORT > 65535 )); then
  fail "APP_PORT must be between 1 and 65535."
fi
(( EUID == 0 )) || "${SUDO[@]}" -v

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 22 )); then
  fail "Node.js 22 or newer is required."
fi

for source_file in package.json package-lock.json astro.config.mjs scripts/configure-supabase.sh "${RECOVERY_RELEASE_FILES[@]}"; do
  [[ -f "${SOURCE_DIR}/${source_file}" ]] || fail "Run this script from a complete TomeCMS checkout."
done

configured_now=false
if ! "${SUDO[@]}" test -f "$ENV_FILE" || [[ -z "$(env_value PUBLIC_SUPABASE_URL)" ]]; then
  "${SUDO[@]}" install -d -m 0750 "$(dirname "$ENV_FILE")"
  echo 'Configure the Supabase backend before deploying TomeCMS.'
  "${SUDO[@]}" env TOMECMS_ENV_FILE="$ENV_FILE" "${SOURCE_DIR}/scripts/configure-supabase.sh"
  configured_now=true
fi
if [[ "$configured_now" == true ]]; then
  echo 'Apply every SQL file in supabase/migrations/ to that project, then run this deployment script again.'
  exit 0
fi

PUBLIC_SUPABASE_URL="$(env_value PUBLIC_SUPABASE_URL)"
PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(env_value PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
PUBLIC_SUPABASE_ANON_KEY="$(env_value PUBLIC_SUPABASE_ANON_KEY)"
SUPABASE_SECRET_KEY="$(env_value SUPABASE_SECRET_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(env_value SUPABASE_SERVICE_ROLE_KEY)"
TOME_CMS_INSTALL_TOKEN="$(env_value TOME_CMS_INSTALL_TOKEN)"
DOMAIN="${DOMAIN:-$(env_value TOME_CMS_DOMAIN)}"
[[ -n "$PUBLIC_SUPABASE_URL" ]] || fail "PUBLIC_SUPABASE_URL is missing in ${ENV_FILE}."
[[ -n "$PUBLIC_SUPABASE_PUBLISHABLE_KEY" || -n "$PUBLIC_SUPABASE_ANON_KEY" ]] || fail "A publishable or anon key is missing in ${ENV_FILE}."
[[ -n "$SUPABASE_SECRET_KEY" || -n "$SUPABASE_SERVICE_ROLE_KEY" ]] || fail "A secret or service-role key is missing in ${ENV_FILE}."
(( ${#TOME_CMS_INSTALL_TOKEN} >= 24 )) || fail "TOME_CMS_INSTALL_TOKEN must contain at least 24 characters."
[[ -z "$DOMAIN" || "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "TOME_CMS_DOMAIN must be a hostname without a scheme or path."
[[ -z "$DOMAIN" ]] || need nginx
export PUBLIC_SUPABASE_URL PUBLIC_SUPABASE_PUBLISHABLE_KEY PUBLIC_SUPABASE_ANON_KEY

lock_file="/tmp/${APP_NAME}-deploy.lock"
exec 9>"$lock_file"
flock -n 9 || fail "Another ${APP_NAME} deployment is already running."

echo "Checking and building TomeCMS..."
cd "$SOURCE_DIR"
npm ci
npm run check
npm run build

if ! getent passwd "$APP_USER" >/dev/null; then
  "${SUDO[@]}" useradd --system --user-group --home-dir "$DEPLOY_ROOT" --shell /usr/sbin/nologin "$APP_USER"
fi
APP_GROUP="$(id -gn "$APP_USER")"

NODE_BIN="$(command -v node)"
as_app_user "$NODE_BIN" --version >/dev/null 2>&1 || fail "Node at ${NODE_BIN} is not executable by ${APP_USER}; install Node system-wide."
"${SUDO[@]}" install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$RELEASES_DIR"
"${SUDO[@]}" chown root:"$APP_GROUP" "$(dirname "$ENV_FILE")" "$ENV_FILE"
"${SUDO[@]}" chmod 0750 "$(dirname "$ENV_FILE")"
"${SUDO[@]}" chmod 0640 "$ENV_FILE"
as_app_user test -r "$ENV_FILE" || fail "${APP_USER} cannot read ${ENV_FILE}."

release_id="$(date -u +%Y%m%d%H%M%S)-$$"
release_dir="${RELEASES_DIR}/${release_id}"
"${SUDO[@]}" install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$release_dir"
"${SUDO[@]}" cp -R dist package.json package-lock.json "$release_dir/"
for source_file in "${RECOVERY_RELEASE_FILES[@]}"; do
  "${SUDO[@]}" install -D -o "$APP_USER" -g "$APP_GROUP" -m 0640 "${SOURCE_DIR}/${source_file}" "${release_dir}/${source_file}"
  "${SUDO[@]}" test -f "${release_dir}/${source_file}" || fail "Release is missing ${source_file}."
done
"${SUDO[@]}" chown -R "$APP_USER:$APP_GROUP" "$release_dir"
as_app_user env HOME="$release_dir" PATH="$PATH" npm ci --omit=dev --ignore-scripts --prefix "$release_dir"
as_app_user env HOME="$release_dir" PATH="$PATH" npm --prefix "$release_dir" run admin:recover -- --self-test

unit_tmp="$(mktemp)"
trap 'rm -f "$unit_tmp"' EXIT
cat >"$unit_tmp" <<EOF
[Unit]
Description=TomeCMS Astro server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${CURRENT_LINK}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=${APP_PORT}
ExecStart=${NODE_BIN} ./dist/server/entry.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
"${SUDO[@]}" install -m 0644 "$unit_tmp" "$SERVICE_FILE"
"${SUDO[@]}" systemctl daemon-reload
"${SUDO[@]}" systemctl enable "$APP_NAME" >/dev/null

previous_release="$("${SUDO[@]}" readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
next_link="${CURRENT_LINK}.next.$$"
"${SUDO[@]}" ln -s "$release_dir" "$next_link"
"${SUDO[@]}" mv -Tf "$next_link" "$CURRENT_LINK"

healthy=false
if "${SUDO[@]}" systemctl restart "$APP_NAME"; then
  for _ in {1..20}; do
    if curl --fail --silent --max-time 2 "http://127.0.0.1:${APP_PORT}/" >/dev/null; then
      healthy=true
      break
    fi
    sleep 1
  done
fi

if [[ "$healthy" != true ]]; then
  echo "The new release failed its health check." >&2
  "${SUDO[@]}" journalctl -u "$APP_NAME" -n 30 --no-pager >&2 || true
  if [[ -n "$previous_release" && -d "$previous_release" && "$previous_release" == "$RELEASES_DIR"/* ]]; then
    rollback_link="${CURRENT_LINK}.rollback.$$"
    "${SUDO[@]}" ln -s "$previous_release" "$rollback_link"
    "${SUDO[@]}" mv -Tf "$rollback_link" "$CURRENT_LINK"
    "${SUDO[@]}" systemctl restart "$APP_NAME"
    echo "Rolled back to ${previous_release}." >&2
  fi
  exit 1
fi

if [[ -n "$DOMAIN" ]]; then
  nginx_tmp="$(mktemp)"
  nginx_backup="$(mktemp)"
  nginx_site="/etc/nginx/sites-available/${APP_NAME}"
  nginx_enabled="/etc/nginx/sites-enabled/${APP_NAME}"
  had_nginx_site=false
  previous_nginx_link="$("${SUDO[@]}" readlink "$nginx_enabled" 2>/dev/null || true)"
  if "${SUDO[@]}" test -e "$nginx_enabled" && [[ -z "$previous_nginx_link" ]]; then
    fail "${nginx_enabled} exists and is not a symbolic link; update it manually."
  fi
  if "${SUDO[@]}" test -f "$nginx_site"; then
    "${SUDO[@]}" cp "$nginx_site" "$nginx_backup"
    had_nginx_site=true
  fi
  trap 'rm -f "$unit_tmp" "${nginx_tmp:-}" "${nginx_backup:-}"' EXIT
  cat >"$nginx_tmp" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    client_max_body_size 9m;

    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;

    location = /api/auth/passkey/generate-register-options {
        access_log off;
        error_log /dev/null emerg;
        proxy_pass http://127.0.0.1:${APP_PORT};
    }

    location = /recovery {
        access_log off;
        error_log /dev/null emerg;
        proxy_pass http://127.0.0.1:${APP_PORT};
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
    }
}
EOF
  "${SUDO[@]}" install -m 0644 "$nginx_tmp" "$nginx_site"
  "${SUDO[@]}" ln -sfn "$nginx_site" "$nginx_enabled"
  if ! "${SUDO[@]}" nginx -t; then
    if [[ "$had_nginx_site" == true ]]; then
      "${SUDO[@]}" cp "$nginx_backup" "$nginx_site"
    else
      "${SUDO[@]}" rm -f "$nginx_site"
    fi
    if [[ -n "$previous_nginx_link" ]]; then
      "${SUDO[@]}" ln -sfn "$previous_nginx_link" "$nginx_enabled"
    else
      "${SUDO[@]}" rm -f "$nginx_enabled"
    fi
    fail "Nginx rejected the generated configuration; the previous configuration was restored."
  fi
  "${SUDO[@]}" systemctl reload nginx
fi

echo "Deployed ${release_id}; ${APP_NAME} is healthy on 127.0.0.1:${APP_PORT}."
