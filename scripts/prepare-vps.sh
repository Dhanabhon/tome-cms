#!/usr/bin/env bash
# Prepares a new Ubuntu 24.04 server for TomeCMS: Docker Engine, Node.js 22, the
# GitHub CLI, swap, the firewall and Caddy. Running it again is safe: each step says
# whether it changed something or found the work already done.
# Design: docs/specs/2026-09-27-vps-prepare-design.md
#
# Everything above the "changes the server" line runs on the bash 3.2 that macOS
# ships, because the unit tests run it there.
set -Eeuo pipefail

export MARKER='# Managed by TomeCMS prepare-vps.sh'
export CADDYFILE=/etc/caddy/Caddyfile

export cms_url="${TOME_CMS_PUBLIC_URL:-}"
export media_url="${S3_ENDPOINT:-}"
export cms_host=""
export media_host=""
export target_user="${SUDO_USER:-}"
export create_user=false
export firewall=true
export proxy=true
export swap_size=2G
export dry_run=false
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

fail "The server steps are not written yet."
