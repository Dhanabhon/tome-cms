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

# BASH_SUBSHELL keeps a failing command substitution from printing this a second time.
trap 'if [[ -n "$current_step" && $BASH_SUBSHELL -eq 0 ]]; then echo "Error: the step \"${current_step}\" failed. Fix what the lines above say, then run this script again: it skips what is already done." >&2; fi' ERR

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
  install -m "$mode" "$tmp" "$path" || { rm -f "$tmp"; return 1; }
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
    run apt-get -o DPkg::Lock::Timeout=300 update -q
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
  run env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y -q $missing
}

# Installs a package, or upgrades it when a newer version is on offer.
apt_install_latest() {
  apt_update_once
  run env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y -q "$1"
}

# Fetches a vendor's signing key into keyring, but only when its fingerprints are the
# ones the vendor publishes: a key swapped on the download server is refused.
fetch_key() {
  local url="$1" format="$2" expected="$3" keyring="$4" tmp found
  tmp="$(mktemp)"
  if ! curl -fsSL "$url" -o "$tmp"; then
    rm -f "$tmp"
    fail "Could not download the signing key from ${url}."
  fi
  found="$(gpg --show-keys --with-colons "$tmp" 2>/dev/null \
    | awk -F: '$1 == "pub" { want = 1 } $1 == "fpr" && want { print $10; want = 0 }' | sort | paste -sd ' ' - || true)"
  if [[ "$found" != "$(tr ' ' '\n' <<<"$expected" | sort | paste -sd ' ' -)" ]]; then
    rm -f "$tmp"
    fail "The signing key from ${url} has the fingerprint ${found:-none}, not ${expected}. Nothing was added."
  fi
  if [[ "$format" == armored ]]; then
    gpg --dearmor --yes -o "$keyring" "$tmp"
  else
    install -m 0644 "$tmp" "$keyring"
  fi
  rm -f "$tmp"
}

# add_apt_repo <name> <key url> <armored|binary> <fingerprints> <source>: adds a vendor's apt
# repository, with its signing key in a keyring of its own.
add_apt_repo() {
  local name="$1" key_url="$2" key_format="$3" fingerprints="$4" source="$5"
  local keyring="/etc/apt/keyrings/${name}.gpg" list="/etc/apt/sources.list.d/${name}.list"
  local uri="${source%% *}" line other file
  line="$(printf 'deb [arch=%s signed-by=%s] %s' "$arch" "$keyring" "$source")"
  if [[ -s "$keyring" && "$(cat "$list" 2>/dev/null || true)" == "$line" ]]; then
    note "the ${name} apt repository is already set up"
    return 0
  fi
  other=""
  for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [[ -f "$file" && "$file" != "$list" ]] || continue
    if [[ -n "$(grep -vE '^[[:space:]]*#' "$file" 2>/dev/null | grep -F -- "$uri" || true)" ]]; then
      other="${other}${other:+ }${file}"
    fi
  done
  if [[ -n "$other" ]]; then
    note "${uri} already has a source in ${other}, and is left alone"
    return 0
  fi
  run install -d -m 0755 /etc/apt/keyrings
  if $dry_run; then
    note "would fetch ${key_url} into ${keyring}, if its fingerprint is ${fingerprints}"
  else
    fetch_key "$key_url" "$key_format" "$fingerprints" "$keyring"
  fi
  run chmod 0644 "$keyring"
  printf '%s\n' "$line" | write_file "$list" 0644
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
  # A cloud image puts a "log in as ubuntu" command in front of root's keys, and that is
  # dropped. Every other key keeps its options, such as from= or restrict.
  keys="$(perl -ne 'next if /^\s*(#|$)/; s/^.*?(?=(?:sk-)?(?:ssh|ecdsa)-\S+\s)// if /Please login as the user/; print' \
    /root/.ssh/authorized_keys 2>/dev/null || true)"
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
    add_apt_repo docker https://download.docker.com/linux/ubuntu/gpg armored \
      9DC858229FC7DD38854AE2D88D81803C0EBFCD88 "https://download.docker.com/linux/ubuntu ${codename} stable"
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

# True when /usr/bin/node is the version this script needs, 22.12 or later.
node_is_current() {
  [[ -x /usr/bin/node ]] \
    && /usr/bin/node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'
}

install_node() {
  step "Node.js 22"
  if node_is_current; then
    note "/usr/bin/node is already $(/usr/bin/node --version)"
    return 0
  fi
  add_apt_repo nodesource https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key armored \
    6F71F525282841EEDAF851B42F59B5F99B1BE0B4 "https://deb.nodesource.com/node_22.x nodistro main"
  apt_install_latest nodejs
  if ! $dry_run && ! node_is_current; then
    local found
    found="$(/usr/bin/node --version 2>/dev/null || true)"
    fail "/usr/bin/node is ${found:-missing} after installing, not 22.12 or later. Another Node apt source may be pinned ahead of NodeSource's."
  fi
}

# True when the installed gh can verify attestations the way the managed installer
# does, with --source-ref, --source-digest, --signer-workflow and
# --deny-self-hosted-runners. Those arrived after Ubuntu 24.04's own gh, 2.45.
gh_can_verify_attestations() {
  local help
  help="$(gh attestation verify --help 2>/dev/null || true)"
  [[ "$help" == *--source-digest* ]]
}

install_gh() {
  step "GitHub CLI"
  if command -v gh >/dev/null 2>&1 && gh_can_verify_attestations; then
    note "gh is already installed and can verify attestations"
    return 0
  fi
  add_apt_repo githubcli https://cli.github.com/packages/githubcli-archive-keyring.gpg binary \
    "2C6106201985B60E6C7AC87323F3D4EA75716059 7F38BBB59D064DBCB3D84D725612B36462313325" "https://cli.github.com/packages stable main"
  apt_install_latest gh
  if ! $dry_run && ! gh_can_verify_attestations; then
    fail "gh cannot verify attestations even after installing, so it is still older than 2.49. Another gh apt source may be pinned ahead of the official one."
  fi
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
  # Swap is off at this point, so a /swapfile here is left over from a run that
  # failed partway through. Recreate it rather than trust its contents.
  if [[ -e /swapfile ]]; then
    run rm -f /swapfile
  fi
  run fallocate -l "$swap_size" /swapfile
  run chmod 0600 /swapfile
  run mkswap /swapfile
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
  local ssh_config ports port
  if ! $firewall; then
    note "left alone (--no-firewall)"
    return 0
  fi
  # sshd -T lists every "port" line, and every "listenaddress" line, which can name
  # its own port (IPv4 host:port, or IPv6 [host]:port) that differs from all of them.
  ssh_config="$(sshd -T 2>/dev/null || true)"
  ports="$(printf '%s\n' "$ssh_config" | awk '
    $1 == "port" { print $2 }
    $1 == "listenaddress" {
      addr = $2
      if (sub(/^\[[^]]*\]:/, "", addr)) { print addr; next }
      n = split(addr, parts, ":")
      if (n >= 2) print parts[n]
    }
  ' | grep -E '^[0-9]+$' | sort -un || true)"
  if [[ -z "$ports" ]]; then
    ports=22
    note "could not read the SSH port from sshd -T, so port 22 stays open. If SSH listens on another port, allow it with ufw before you log out."
  fi
  apt_install ufw
  # SSH first, so turning the firewall on cannot cut off the session this runs in.
  # Compose publishes its ports on 127.0.0.1 only, so Docker's own rules open nothing.
  while IFS= read -r port; do
    [[ -n "$port" ]] || continue
    run ufw allow "${port}/tcp"
  done <<<"$ports"
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
  add_apt_repo caddy https://dl.cloudsmith.io/public/caddy/stable/gpg.key armored \
    65760C51EDEA2017CEA2CA15155B6D79CA56EA34 "https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main"
  apt_install caddy
  wanted="$(render_caddyfile "$cms_host" "$media_host")"
  if [[ -f "$CADDYFILE" && "$(cat "$CADDYFILE")" == "$wanted" ]]; then
    note "${CADDYFILE} already serves ${cms_host} and ${media_host}"
  else
    printf '%s\n' "$wanted" | write_file "$CADDYFILE" 0644
  fi
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
  note "  export TOME_CMS_PUBLIC_URL=https://${cms_host:-cms.example.com} S3_ENDPOINT=https://${media_host:-media.example.com}"
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
