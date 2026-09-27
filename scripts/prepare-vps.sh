#!/usr/bin/env bash
# Prepares a new Ubuntu 24.04 server for TomeCMS: Docker Engine, Node.js 22, the
# GitHub CLI, swap, the firewall and Caddy. Running it again is safe: each step says
# whether it changed something or found the work already done.
# Design: docs/specs/2026-09-27-vps-prepare-design.md
#
# Everything above the "changes the server" line runs on the bash 3.2 that macOS
# ships, because the unit tests run it there.
set -Eeuo pipefail

MARKER='# Managed by TomeCMS prepare-vps.sh'
CADDYFILE=/etc/caddy/Caddyfile

cms_url="${TOME_CMS_PUBLIC_URL:-}"
media_url="${S3_ENDPOINT:-}"
cms_host=""
media_host=""
target_user="${SUDO_USER:-}"
create_user=false
firewall=true
proxy=true
swap_size=2G
dry_run=false
print_caddyfile=false

fail() {
  echo "Error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: sudo scripts/prepare-vps.sh --cms-url https://cms.example.com --media-url https://media.example.com [options]

Prepares a new Ubuntu 24.04 server for TomeCMS. Running it again is safe.

  --cms-url <url>      The CMS origin. Falls back to TOME_CMS_PUBLIC_URL.
  --media-url <url>    The media origin. Falls back to S3_ENDPOINT.
  --user <name>        The account that runs the deploy helper and joins the docker
                       group. Defaults to the account that ran sudo.
  --create-user        Create that account if it does not exist.
  --no-firewall        Leave the firewall alone.
  --no-proxy           Install no proxy. The addresses are then not needed.
  --swap-size <size>   Swap to create when the server needs it. Default 2G.
  --dry-run            Check the server and print each step, and change nothing.
  --print-caddyfile    Print the Caddyfile for the two addresses, and exit.
  --help               Print this help.
EOF
}

need_value() {
  [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 needs a value."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cms-url) need_value "$@"; cms_url="$2"; shift 2 ;;
    --media-url) need_value "$@"; media_url="$2"; shift 2 ;;
    --user) need_value "$@"; target_user="$2"; shift 2 ;;
    --swap-size) need_value "$@"; swap_size="$2"; shift 2 ;;
    --create-user) create_user=true; shift ;;
    --no-firewall) firewall=false; shift ;;
    --no-proxy) proxy=false; shift ;;
    --dry-run) dry_run=true; shift ;;
    --print-caddyfile) print_caddyfile=true; shift ;;
    --help | -h) usage; exit 0 ;;
    *) fail "Unknown option '$1'. Run with --help to see the options." ;;
  esac
done

[[ "$swap_size" =~ ^[1-9][0-9]*[MG]$ ]] || fail "--swap-size takes a size such as 2G or 1536M, not '${swap_size}'."

# Prints the lower-case host of an HTTPS origin, or stops with what is wrong with it.
# The deploy helper checks the addresses more strictly later. This catches a typing
# mistake before anything is installed.
origin_host() {
  local label="$1" flag="$2" url="$3" host
  [[ -n "$url" ]] || fail "Give the ${label} address with ${flag}."
  [[ "$url" == https://* ]] || fail "The ${label} address must start with https://, not '${url}'."
  host="${url#https://}"
  host="${host%/}"
  [[ "$host" != */* ]] || fail "The ${label} address must be an origin with no path, not '${url}'."
  [[ "$host" != *@* ]] || fail "The ${label} address must not hold a user name or password."
  [[ "$host" != *:* ]] || fail "The ${label} address must not name a port, because Caddy serves it on 443: '${url}'."
  [[ ! "$host" =~ ^[0-9.]+$ ]] || fail "The ${label} address needs a host name, not an IP address: '${url}'."
  [[ "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] \
    || fail "The ${label} address needs a public host name with a dot in it, not '${url}'."
  host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
  [[ "$host" != *.localhost ]] || fail "The ${label} address needs a public host name, not '${url}'."
  printf '%s\n' "$host"
}

# Caddy gets and renews both certificates by itself, and passes the Host header on
# unchanged, which the presigned upload addresses need. 25 MB is the largest document
# the File Manager takes.
render_caddyfile() {
  cat <<EOF
${MARKER}
# scripts/prepare-vps.sh wrote this file and rewrites it each time it runs.
# To keep changes of your own, run the script with --no-proxy.

$1 {
	reverse_proxy 127.0.0.1:4321
}

$2 {
	request_body {
		max_size 25MB
	}
	reverse_proxy 127.0.0.1:9000
}
EOF
}

if $proxy || $print_caddyfile; then
  cms_host="$(origin_host CMS --cms-url "$cms_url")"
  media_host="$(origin_host media --media-url "$media_url")"
  [[ "$cms_host" != "$media_host" ]] || fail "The CMS and the media need two different host names, not both '${cms_host}'."
fi

if $print_caddyfile; then
  render_caddyfile "$cms_host" "$media_host"
  exit 0
fi

# ---- Everything below changes the server, and runs on Ubuntu 24.04 only. ----

problems=0
current_step=""
relogin=false
apt_fresh=false
arch=""
codename=""

trap 'if [[ -n "$current_step" ]]; then echo "Error: the step \"${current_step}\" failed. Fix what the lines above say, then run this script again: it skips what is already done." >&2; fi' ERR

step() {
  current_step="$1"
  echo
  echo "== $1"
}

note() {
  echo "   $*"
}

problem() {
  echo "   Problem: $*" >&2
  problems=$((problems + 1))
}

# Every command that changes the server goes through run, which --dry-run turns into
# a line of output.
run() {
  if $dry_run; then
    note "would run: $*"
    return 0
  fi
  "$@"
}

# write_file <path> <mode>: writes standard input to path.
write_file() {
  local path="$1" mode="$2" tmp
  if $dry_run; then
    cat >/dev/null
    note "would write ${path}"
    return 0
  fi
  tmp="$(mktemp)"
  cat >"$tmp"
  install -m "$mode" "$tmp" "$path"
  rm -f "$tmp"
}

os_field() {
  sed -n "s/^$1=//p" /etc/os-release 2>/dev/null | tr -d '"' || true
}

installed() {
  local status
  status="$(dpkg -s "$1" 2>/dev/null || true)"
  [[ "$status" == *"Status: install ok installed"* ]]
}

# True when the Caddyfile is missing, carries this script's first line, or is still the
# one the caddy package installed.
caddyfile_is_ours() {
  local changed
  [[ -f "$CADDYFILE" ]] || return 0
  [[ "$(head -n 1 "$CADDYFILE")" != "$MARKER" ]] || return 0
  installed caddy || return 1
  changed="$(dpkg --verify caddy 2>/dev/null || true)"
  [[ "$changed" != *" ${CADDYFILE}"* ]]
}

preflight() {
  step "Checking the server"
  local os_id os_version systemd_version holders names
  [[ "$(id -u)" == 0 ]] || problem "Run this as root, for example with sudo."
  os_id="$(os_field ID)"
  os_version="$(os_field VERSION_ID)"
  codename="$(os_field VERSION_CODENAME)"
  [[ "$os_id" == ubuntu && "$os_version" == 24.04 ]] \
    || problem "This script supports Ubuntu 24.04 only, and this server runs ${os_id:-an unknown system} ${os_version}."
  arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
  [[ "$arch" == amd64 || "$arch" == arm64 ]] || problem "TomeCMS runs on amd64 or arm64, and this server is ${arch}."
  systemd_version="$(systemctl --version 2>/dev/null | awk 'NR == 1 { print $2 }' || true)"
  if [[ ! "$systemd_version" =~ ^[0-9]+$ ]] || (( systemd_version < 235 )); then
    problem "TomeCMS needs systemd 235 or later${systemd_version:+, and this server has ${systemd_version}}."
  fi

  if [[ -z "$target_user" ]]; then
    problem "Name the account that will run TomeCMS with --user, because this script was not started through sudo."
  elif [[ "$target_user" == root ]]; then
    problem "The deploy helper should not run as root. Name another account with --user."
  elif ! id "$target_user" >/dev/null 2>&1; then
    if ! $create_user; then
      problem "The account '${target_user}' does not exist. Create it first, or add --create-user."
    elif [[ ! "$target_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
      problem "'${target_user}' cannot be an account name. Use lower-case letters, digits, - and _."
    fi
  fi

  if $proxy; then
    holders="$(ss -Htlnp '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v '"caddy"' || true)"
    if [[ -n "$holders" ]]; then
      names="$(printf '%s\n' "$holders" | grep -o 'users:(("[^"]*"' | cut -d '"' -f 2 | sort -u | paste -sd ' ' - || true)"
      problem "Something other than Caddy listens on port 80 or 443 (${names:-unknown}). Stop it, or add --no-proxy to keep it and point it at TomeCMS yourself."
    fi
    caddyfile_is_ours \
      || problem "${CADDYFILE} has changes this script did not make. Add --no-proxy to keep it, or move it away and run this script again."
  fi

  if (( problems > 0 )); then
    fail "${problems} problem(s) above. Nothing on this server has changed."
  fi
  note "every check passed"
}

apt_update_once() {
  if ! $apt_fresh; then
    run apt-get update -q
    apt_fresh=true
  fi
}

# Installs the packages that are missing, and says so when none is.
apt_install() {
  local missing="" package
  for package in "$@"; do
    installed "$package" || missing="${missing} ${package}"
  done
  if [[ -z "$missing" ]]; then
    note "already installed: $*"
    return 0
  fi
  apt_update_once
  # shellcheck disable=SC2086 # a list of package names
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q $missing
}

# Installs a package, or upgrades it when a newer version is on offer.
apt_install_latest() {
  apt_update_once
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$1"
}

# add_apt_repo <name> <key url> <armored|binary> <source>: adds a vendor's apt
# repository, with its signing key in a keyring of its own.
add_apt_repo() {
  local name="$1" key_url="$2" key_format="$3" source="$4"
  local keyring="/etc/apt/keyrings/${name}.gpg" list="/etc/apt/sources.list.d/${name}.list"
  if [[ -s "$keyring" && -f "$list" ]]; then
    note "the ${name} apt repository is already set up"
    return 0
  fi
  run install -d -m 0755 /etc/apt/keyrings
  if $dry_run; then
    note "would fetch ${key_url} into ${keyring}"
  elif [[ "$key_format" == armored ]]; then
    curl -fsSL "$key_url" | gpg --dearmor --yes -o "$keyring"
  else
    curl -fsSL "$key_url" -o "$keyring"
  fi
  run chmod 0644 "$keyring"
  printf 'deb [arch=%s signed-by=%s] %s\n' "$arch" "$keyring" "$source" | write_file "$list" 0644
  apt_fresh=false
}

ensure_user() {
  step "The ${target_user} account"
  local keys home="/home/${target_user}"
  if id "$target_user" >/dev/null 2>&1; then
    note "${target_user} already exists"
    return 0
  fi
  run useradd --create-home --shell /bin/bash "$target_user"
  # A cloud image puts a "log in as ubuntu" command in front of root's keys, so only
  # the keys themselves are copied.
  keys="$(grep -oE '(sk-)?(ssh|ecdsa)-[A-Za-z0-9@.-]+ [A-Za-z0-9+/=]+' /root/.ssh/authorized_keys 2>/dev/null || true)"
  if [[ -n "$keys" ]]; then
    run install -d -m 0700 -o "$target_user" -g "$target_user" "${home}/.ssh"
    printf '%s\n' "$keys" | write_file "${home}/.ssh/authorized_keys" 0600
    run chown "${target_user}:${target_user}" "${home}/.ssh/authorized_keys"
  else
    note "root has no SSH keys to copy, so ${target_user} has none yet"
  fi
}

install_docker() {
  step "Docker Engine"
  if ! installed docker-ce && docker compose version >/dev/null 2>&1; then
    note "Docker with its Compose plugin is already installed, and is kept"
  else
    add_apt_repo docker https://download.docker.com/linux/ubuntu/gpg armored "https://download.docker.com/linux/ubuntu ${codename} stable"
    apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  run systemctl enable --now docker
  if [[ " $(id -nG "$target_user" 2>/dev/null || true) " == *" docker "* ]]; then
    note "${target_user} is already in the docker group"
  else
    run usermod -aG docker "$target_user"
    relogin=true
  fi
}

install_node() {
  step "Node.js 22"
  if [[ -x /usr/bin/node ]] && /usr/bin/node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
    note "/usr/bin/node is already $(/usr/bin/node --version)"
    return 0
  fi
  add_apt_repo nodesource https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key armored "https://deb.nodesource.com/node_22.x nodistro main"
  apt_install_latest nodejs
}

install_gh() {
  step "GitHub CLI"
  # The managed installer runs gh attestation verify, which arrived in gh 2.49.
  # Ubuntu 24.04's own gh is 2.45.
  if command -v gh >/dev/null 2>&1 && gh attestation verify --help >/dev/null 2>&1; then
    note "gh is already installed and can verify attestations"
    return 0
  fi
  add_apt_repo githubcli https://cli.github.com/packages/githubcli-archive-keyring.gpg binary "https://cli.github.com/packages stable main"
  apt_install_latest gh
}

setup_swap() {
  step "Swap"
  local mem_kb
  if [[ -n "$(swapon --noheadings --show 2>/dev/null || true)" ]]; then
    note "swap is already on"
    return 0
  fi
  mem_kb="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  # A server sold as 4 GB reports a little less than 4 GiB, so the line is at 3.5 GiB.
  if (( mem_kb >= 3670016 )); then
    note "the server has 4 GB of memory or more, and needs no swap"
    return 0
  fi
  if [[ ! -e /swapfile ]]; then
    run fallocate -l "$swap_size" /swapfile
    run chmod 0600 /swapfile
    run mkswap /swapfile
  fi
  run swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    if $dry_run; then
      note "would add /swapfile to /etc/fstab"
    else
      echo '/swapfile none swap sw 0 0' >>/etc/fstab
    fi
  fi
  echo 'vm.swappiness=10' | write_file /etc/sysctl.d/99-tomecms.conf 0644
  run sysctl -q -w vm.swappiness=10
}

setup_firewall() {
  step "Firewall"
  local ssh_port
  if ! $firewall; then
    note "left alone (--no-firewall)"
    return 0
  fi
  ssh_port="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }' || true)"
  if [[ ! "$ssh_port" =~ ^[0-9]+$ ]]; then
    ssh_port=22
    note "could not read the SSH port from sshd -T, so port 22 stays open. If SSH listens on another port, allow it with ufw before you log out."
  fi
  apt_install ufw
  # SSH first, so turning the firewall on cannot cut off the session this runs in.
  # Compose publishes its ports on 127.0.0.1 only, so Docker's own rules open nothing.
  run ufw allow "${ssh_port}/tcp"
  run ufw allow 80/tcp
  run ufw allow 443/tcp
  run ufw --force enable
}

setup_proxy() {
  step "Caddy"
  local wanted
  if ! $proxy; then
    note "no proxy installed (--no-proxy)"
    return 0
  fi
  add_apt_repo caddy https://dl.cloudsmith.io/public/caddy/stable/gpg.key armored "https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main"
  apt_install caddy
  wanted="$(render_caddyfile "$cms_host" "$media_host")"
  if [[ -f "$CADDYFILE" && "$(cat "$CADDYFILE")" == "$wanted" ]]; then
    note "${CADDYFILE} already serves ${cms_host} and ${media_host}"
    return 0
  fi
  printf '%s\n' "$wanted" | write_file "$CADDYFILE" 0644
  run systemctl enable caddy
  run systemctl reload-or-restart caddy
}

# Only prints what the names resolve to. On a provider such as AWS the public address
# is not on any interface of the server, so comparing would warn for nothing.
check_dns() {
  step "DNS"
  local host addresses
  if ! $proxy; then
    note "not checked (--no-proxy)"
    return 0
  fi
  for host in "$cms_host" "$media_host"; do
    addresses="$(getent ahosts "$host" 2>/dev/null | awk '{ print $1 }' | sort -u | paste -sd ' ' - || true)"
    if [[ -n "$addresses" ]]; then
      note "${host} points at ${addresses}. Check that this is the server's public address."
    else
      note "Warning: ${host} does not resolve yet. Point it at this server. Caddy keeps trying, and gets the certificate once it does."
    fi
  done
}

summary() {
  step "Next"
  if $dry_run; then
    note "This was a dry run, and nothing changed. Run the script again without --dry-run to make these changes."
    return 0
  fi
  if $relogin; then
    note "${target_user} joined the docker group. It applies from that account's next login."
  fi
  note "Log in as ${target_user} and install TomeCMS:"
  note "  sudo -iu ${target_user}"
  note "  git clone https://github.com/Dhanabhon/tome-cms.git && cd tome-cms"
  note "  export TOME_CMS_PUBLIC_URL=${cms_host:+https://$cms_host} S3_ENDPOINT=${media_host:+https://$media_host}"
  note "  ./scripts/deploy-vps.sh"
}

preflight
step "Base packages"
apt_install ca-certificates curl git gnupg
if $create_user; then
  ensure_user
fi
install_docker
install_node
install_gh
setup_swap
setup_firewall
setup_proxy
check_dns
summary
