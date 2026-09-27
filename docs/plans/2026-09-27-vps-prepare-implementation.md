# Preparing a new server: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One script, `scripts/prepare-vps.sh`, that prepares a new Ubuntu 24.04 server for TomeCMS, and one cloud-init file, `deploy/cloud-init.yaml`, that runs it and installs TomeCMS on a server's first boot.

**Architecture:** The script is plain bash. Its top half parses the options, checks both addresses and renders the Caddyfile. That half runs on the bash 3.2 that macOS ships, so `node --test` can test it anywhere. Its bottom half checks the server and installs from each vendor's apt repository. Every command that changes the server goes through one `run` function, which `--dry-run` turns into a printed line, and CI runs that dry run on its real Ubuntu 24.04 runner. The cloud-init file writes the owner's two addresses and a first-boot script, and the first-boot script calls `prepare-vps.sh` and then the existing `deploy-vps.sh`.

**Tech stack:** bash, apt, systemd, ufw, Caddy, cloud-init, `node --test` with tsx, the `yaml` package, GitHub Actions on `ubuntu-24.04`.

**Spec:** [docs/specs/2026-09-27-vps-prepare-design.md](../specs/2026-09-27-vps-prepare-design.md)

## Global constraints

- Work in `.worktrees/vps-prepare` on branch `feat/vps-prepare`. Run `npm ci` there once before the first test.
- Never use `git stash`, `git reset --hard`, `git checkout --`, `git clean`, `git add -A` or `git add .`. Stage each file by its path.
- Write each commit message to a file under `/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/932419a0-46ec-45f2-92be-58217f48d21b/scratchpad/` and commit with `git commit -F <file>` in a Bash call of its own. No attribution line of any kind. `--no-verify` is blocked.
- Never touch the containers `tome-cms-postgres-1` and `tome-cms-seaweedfs-1`, or port 4321.
- Never print a secret or a `.env*` file.
- Run gates one at a time, in the foreground.
- Do not push. The owner decides when.
- Prose, in the docs and in the script's messages, has no em dash and no en dash. Thai prose does not use กรุณา or โปรด.
- Supported: Ubuntu 24.04 LTS only, `amd64` or `arm64`, systemd 235 or later, Node.js 22.12 or later at `/usr/bin/node`.
- Caddy forwards the CMS origin to `127.0.0.1:4321` and the media origin to `127.0.0.1:9000`, with `request_body` `max_size 25MB` on the media origin.
- The Caddyfile's first line is exactly `# Managed by TomeCMS prepare-vps.sh`.
- `shellcheck scripts/prepare-vps.sh` reports nothing. `shellcheck` is at `/opt/homebrew/bin/shellcheck` on the owner's Mac and preinstalled on the CI runner.
- The script up to the `--print-caddyfile` exit runs on bash 3.2: no `${var,,}`, no `declare -A`, no `mapfile`, no arrays.
- Below that point, never let a failing command substitution or pipeline end the script by accident: add `|| true` inside `$( )` where a failure is expected, and avoid `cmd | grep -q` under `pipefail` (grep closing early can fail the pipeline). Capture the output in a variable and match it with `[[ ]]` instead.

---

## File map

| File | Task | What it is |
| --- | --- | --- |
| `scripts/prepare-vps.sh` | 1, 2 | The script. Task 1 writes the top half, Task 2 appends the rest. Mode `755`. |
| `tests/unit/prepare-vps.test.ts` | 1 | Options, addresses, and the Caddyfile. |
| `package.json` | 1, 3 | `bash -n` in `check`; `yaml` as a dev dependency. |
| `.github/workflows/ci.yml` | 2 | `shellcheck` and a dry run as root. |
| `deploy/cloud-init.yaml` | 3 | User data for a new server. |
| `tests/unit/cloud-init.test.ts` | 3 | The file's shape, its pinned version, and its first-boot script. |
| `website/src/content/docs/start/prepare-server.md` and its Thai twin | 4 | The new page. |
| `website/src/content/docs/start/requirements.md`, `install.md` and their Thai twins | 4 | Point at the new page. |
| `CHANGELOG.md` | 4 | Unreleased > Added. |

---

### Task 1/4: Options, addresses and the Caddyfile

**Files:**
- Create: `scripts/prepare-vps.sh`
- Create: `tests/unit/prepare-vps.test.ts`
- Modify: `package.json` (the `check` script)

**Interfaces:**
- Produces, for Task 2: the globals `MARKER`, `CADDYFILE`, `cms_url`, `media_url`, `cms_host`, `media_host`, `target_user`, `create_user`, `firewall`, `proxy`, `swap_size`, `dry_run` (each boolean is the string `true` or `false`, run as a command), and the functions `fail <message>` and `render_caddyfile <cms-host> <media-host>`.
- Produces, for Task 4: the options table the docs quote, from `usage`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/prepare-vps.test.ts`:

```ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = 'scripts/prepare-vps.sh';
const cms = 'https://cms.example.com';
const media = 'https://media.example.com';

// Only PATH, so the addresses in the developer's own environment cannot leak in.
function prepare(args: string[], env: Record<string, string> = {}) {
  return spawnSync('/bin/bash', [script, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 10_000 });
}

function refused(args: string[], message: RegExp, env: Record<string, string> = {}) {
  const result = prepare(args, env);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, message);
}

const expected = `# Managed by TomeCMS prepare-vps.sh
# scripts/prepare-vps.sh wrote this file and rewrites it each time it runs.
# To keep changes of your own, run the script with --no-proxy.

cms.example.com {
\treverse_proxy 127.0.0.1:4321
}

media.example.com {
\trequest_body {
\t\tmax_size 25MB
\t}
\treverse_proxy 127.0.0.1:9000
}
`;

test('--help lists every option', () => {
  const result = prepare(['--help']);
  assert.equal(result.status, 0);
  for (const option of ['--cms-url', '--media-url', '--user', '--create-user', '--no-firewall', '--no-proxy', '--swap-size', '--dry-run', '--print-caddyfile']) {
    assert.match(result.stdout, new RegExp(option));
  }
});

test('the Caddyfile forwards each origin to its port', () => {
  const result = prepare(['--print-caddyfile', '--cms-url', cms, '--media-url', media]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test('an address may end in a slash and use capitals', () => {
  const result = prepare(['--print-caddyfile', '--cms-url', 'https://CMS.Example.com/', '--media-url', `${media}/`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test('the addresses fall back to the deploy helper variables', () => {
  const result = prepare(['--print-caddyfile'], { TOME_CMS_PUBLIC_URL: cms, S3_ENDPOINT: media });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test('an address that is not a public HTTPS origin is refused', () => {
  refused(['--print-caddyfile', '--media-url', media], /Give the CMS address with --cms-url/);
  refused(['--print-caddyfile', '--cms-url', 'http://cms.example.com', '--media-url', media], /must start with https:\/\//);
  refused(['--print-caddyfile', '--cms-url', `${cms}/blog`, '--media-url', media], /no path/);
  refused(['--print-caddyfile', '--cms-url', 'https://cms.example.com:8443', '--media-url', media], /must not name a port/);
  refused(['--print-caddyfile', '--cms-url', 'https://me:secret@cms.example.com', '--media-url', media], /user name or password/);
  refused(['--print-caddyfile', '--cms-url', 'https://203.0.113.7', '--media-url', media], /not an IP address/);
  refused(['--print-caddyfile', '--cms-url', 'https://localhost', '--media-url', media], /public host name/);
  refused(['--print-caddyfile', '--cms-url', 'https://cms.localhost', '--media-url', media], /public host name/);
  refused(['--print-caddyfile', '--cms-url', cms, '--media-url', 'https://media example.com'], /public host name/);
});

test('the CMS and the media need two host names', () => {
  refused(['--print-caddyfile', '--cms-url', cms, '--media-url', `${cms}/`], /two different host names/);
});

test('options are checked before anything else', () => {
  refused(['--frobnicate'], /Unknown option '--frobnicate'/);
  refused(['--cms-url'], /--cms-url needs a value/);
  refused(['--user', '--dry-run'], /--user needs a value/);
  refused(['--swap-size', 'lots', '--print-caddyfile', '--cms-url', cms, '--media-url', media], /--swap-size takes a size such as 2G/);
});

test('without the proxy, no address is needed', () => {
  // --no-proxy skips the address checks, so this fails later, at the server checks, and
  // never with a message about an address. On a Mac those checks refuse the system.
  const result = prepare(['--no-proxy', '--dry-run', '--user', 'nobody']);
  assert.doesNotMatch(result.stderr, /address/);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --import tsx --test tests/unit/prepare-vps.test.ts`
Expected: every test fails, because `scripts/prepare-vps.sh` does not exist (`bash: scripts/prepare-vps.sh: No such file or directory`).

- [ ] **Step 3: Write the top half of the script**

Create `scripts/prepare-vps.sh`, then `chmod 755 scripts/prepare-vps.sh`:

```bash
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

fail "The server steps are not written yet."
```

The heredoc in `render_caddyfile` indents with tabs, as `caddy fmt` does. Keep them as tabs: the test compares the output byte for byte.

The last line is a stand-in so the file runs end to end. Task 2 replaces it.

- [ ] **Step 4: Run the test to see it pass**

Run: `node --import tsx --test tests/unit/prepare-vps.test.ts`
Expected: 8 tests, all passing.

- [ ] **Step 5: Add the script to the syntax check**

In `package.json`, in the `check` script, change `bash -n scripts/deploy-vps.sh scripts/dev-local-macos.sh` to `bash -n scripts/deploy-vps.sh scripts/dev-local-macos.sh scripts/prepare-vps.sh`.

Run: `bash -n scripts/prepare-vps.sh && shellcheck scripts/prepare-vps.sh`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/prepare-vps.sh tests/unit/prepare-vps.test.ts package.json
```

Message file: `feat: prepare-vps.sh checks its options and renders the Caddyfile`. Then `git commit -F <file>` on its own.

---

### Task 2/4: Checking and preparing the server

**Files:**
- Modify: `scripts/prepare-vps.sh` (replace the stand-in last line)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes, from Task 1: the globals and `fail` and `render_caddyfile` named there.
- Produces, for Task 3: a script that, run as root with `--create-user --user tomecms --cms-url <url> --media-url <url>`, exits 0 once the server is ready, and non-zero with a sentence on standard error otherwise.

This half cannot run on a Mac. Its test is the CI step in Step 3: a dry run as root on the `ubuntu-24.04` runner, a real Ubuntu 24.04 with systemd. It must pass every check there and print the plan. `shellcheck` covers the rest locally.

- [ ] **Step 1: Replace the stand-in with the server steps**

In `scripts/prepare-vps.sh`, replace the line `fail "The server steps are not written yet."` with:

```bash
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
```

- [ ] **Step 2: Check it locally**

Run: `bash -n scripts/prepare-vps.sh && shellcheck scripts/prepare-vps.sh`
Expected: no output, exit 0. If shellcheck names a line, fix the line; do not add a `disable` beyond the one for SC2086 above.

Run: `node --import tsx --test tests/unit/prepare-vps.test.ts`
Expected: 8 tests, all passing. The last test now reaches `preflight`, which refuses macOS with problems about Ubuntu and systemd. Its standard error must still not mention an address.

- [ ] **Step 3: Add the CI step**

In `.github/workflows/ci.yml`, insert after the `Check` step and before `Run unit tests`:

```yaml
      # The runner is a real Ubuntu 24.04 with systemd, which a container is not, so
      # the dry run passes every check here and prints what it would install.
      - name: Check the server preparation script
        run: |
          shellcheck scripts/prepare-vps.sh
          sudo scripts/prepare-vps.sh --dry-run --cms-url https://cms.example.com --media-url https://media.example.com
```

The runner's account is `runner`, which `sudo` passes on as `SUDO_USER`, so the account check passes without `--user`.

- [ ] **Step 4: Commit**

```bash
git add scripts/prepare-vps.sh .github/workflows/ci.yml
```

Message file: `feat: prepare-vps.sh checks the server and installs what TomeCMS needs`. Then `git commit -F <file>` on its own.

The CI step runs when the owner pushes. If it fails there, the log names the check or step, and the fix goes in a new commit on this branch.

---

### Task 3/4: The cloud-init file

**Files:**
- Create: `deploy/cloud-init.yaml`
- Create: `tests/unit/cloud-init.test.ts`
- Modify: `package.json`, `package-lock.json` (the `yaml` dev dependency)

**Interfaces:**
- Consumes, from Task 2: `scripts/prepare-vps.sh --create-user --user tomecms --cms-url <url> --media-url <url>`, run as root.
- Consumes, from the existing code: `scripts/deploy-vps.sh`. It reads `TOME_CMS_PUBLIC_URL` and `S3_ENDPOINT` from the environment. On a `v1.x.y` tag it hands over to `install-managed-vps.sh`, which needs root and keeps the token in `/etc/tome-cms/tome-cms.env`. Otherwise it writes `.env.local` in the checkout and prints the token.

- [ ] **Step 1: Add `yaml` as a dev dependency**

`yaml` 2.9.0 is already in `package-lock.json` through Astro. Make it direct at that version, so nothing new is downloaded:

Run: `npm install --save-dev --save-exact yaml@2.9.0`
Expected: `package.json` gains `"yaml": "2.9.0"` under `devDependencies`, and `package-lock.json` changes only in the root package's entry.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/cloud-init.test.ts`:

```ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

interface WrittenFile {
  path: string;
  permissions: string;
  content: string;
}

interface CloudConfig {
  write_files: WrittenFile[];
  packages: string[];
  runcmd: string[][];
}

const text = await readFile('deploy/cloud-init.yaml', 'utf8');
const config = parse(text) as CloudConfig;

function written(path: string): WrittenFile {
  const found = config.write_files.find((file) => file.path === path);
  assert.ok(found, `${path} is written`);
  return found;
}

function settings(): Map<string, string> {
  const lines = written('/etc/tomecms-install.env').content.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
  return new Map(lines.map((line) => line.split('=', 2) as [string, string]));
}

test('the file is user data cloud-init reads', () => {
  assert.equal(text.split('\n')[0], '#cloud-config');
  assert.deepEqual(config.packages, ['git']);
  assert.deepEqual(config.runcmd, [['/usr/local/sbin/tomecms-first-boot']]);
});

test('the owner fills in two addresses, and nothing else', () => {
  assert.deepEqual([...settings().keys()], ['TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT', 'TOMECMS_VERSION']);
  assert.equal(settings().get('TOME_CMS_PUBLIC_URL'), 'https://cms.example.com');
  assert.equal(settings().get('S3_ENDPOINT'), 'https://media.example.com');
});

test('it installs the release in package.json', async () => {
  const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  assert.equal(settings().get('TOMECMS_VERSION'), `v${version}`, 'A release updates TOMECMS_VERSION in deploy/cloud-init.yaml to its own tag.');
});

test('only root can read the settings or run the first-boot script', () => {
  assert.equal(written('/etc/tomecms-install.env').permissions, '0600');
  assert.equal(written('/usr/local/sbin/tomecms-first-boot').permissions, '0700');
});

test('the first-boot script is valid bash', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-init-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'tomecms-first-boot');
  await writeFile(script, written('/usr/local/sbin/tomecms-first-boot').content);
  const result = spawnSync('/bin/bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('the first-boot script prepares the server, then installs', () => {
  const script = written('/usr/local/sbin/tomecms-first-boot').content;
  assert.match(script, /prepare-vps\.sh" --create-user --user tomecms --cms-url "\$TOME_CMS_PUBLIC_URL" --media-url "\$S3_ENDPOINT"/);
  assert.match(script, /runuser -u tomecms -- env -C "\$app"/);
  assert.match(script, /install -m 0600 \/dev\/null "\$log"/);
  assert.match(script, /\*example\.com\*\)/);
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `node --import tsx --test tests/unit/cloud-init.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'deploy/cloud-init.yaml'`.

- [ ] **Step 4: Write the cloud-init file**

Create `deploy/cloud-init.yaml`. The version is the one in `package.json` today, `0.13.0`:

```yaml
#cloud-config
# Prepares a new Ubuntu 24.04 server and installs TomeCMS on its first boot.
#
# Before you create the server:
#   1. Replace the two example addresses below with your own.
#   2. Point both host names at the server in DNS. Caddy gets their certificates
#      once they do, and keeps trying until then.
#
# This file holds no secret: the server generates every secret itself.
# Guide: https://dhanabhon.github.io/tome-cms/start/prepare-server/

write_files:
  - path: /etc/tomecms-install.env
    permissions: "0600"
    content: |
      # The CMS origin, where readers and the admin go.
      TOME_CMS_PUBLIC_URL=https://cms.example.com
      # The media origin, which serves uploads and images.
      S3_ENDPOINT=https://media.example.com
      # The TomeCMS release to install. Each release updates this line.
      TOMECMS_VERSION=v0.13.0

  - path: /usr/local/sbin/tomecms-first-boot
    permissions: "0700"
    content: |
      #!/usr/bin/env bash
      # Runs once, from cloud-init, on the server's first boot.
      set -Eeuo pipefail
      export HOME=/root

      # For a 0.x release the deploy helper prints the installation token, so only
      # root can read this log, and cloud-init's own log gets none of it.
      log=/var/log/tomecms-install.log
      install -m 0600 /dev/null "$log"
      exec >>"$log" 2>&1

      finish() {
        local status=$?
        if [[ $status -ne 0 ]]; then
          printf '%s\n' \
            "TomeCMS: the install did not finish." \
            "See what went wrong: sudo tail -n 50 ${log}" \
            "Both scripts are safe to run again once it is fixed." >/etc/motd
        fi
      }
      trap finish EXIT

      set -a
      # shellcheck source=/dev/null
      . /etc/tomecms-install.env
      set +a

      case "${TOME_CMS_PUBLIC_URL} ${S3_ENDPOINT}" in
        *example.com*)
          echo "The user data still has the example addresses. Put your own in, and create the server again."
          exit 1
          ;;
      esac

      repo=https://github.com/Dhanabhon/tome-cms.git
      src=/opt/tome-cms-src
      [[ -d "$src/.git" ]] || git clone --depth 1 --branch "$TOMECMS_VERSION" "$repo" "$src"
      if [[ ! -x "$src/scripts/prepare-vps.sh" ]]; then
        echo "TomeCMS ${TOMECMS_VERSION} came before scripts/prepare-vps.sh. Set TOMECMS_VERSION to a newer release."
        exit 1
      fi

      "$src/scripts/prepare-vps.sh" --create-user --user tomecms --cms-url "$TOME_CMS_PUBLIC_URL" --media-url "$S3_ENDPOINT"

      case "$TOMECMS_VERSION" in
        v0.*)
          app=/home/tomecms/tome-cms
          [[ -d "$app/.git" ]] || runuser -u tomecms -- git clone --depth 1 --branch "$TOMECMS_VERSION" "$repo" "$app"
          # runuser starts a new session, so the docker group prepare-vps.sh added applies.
          runuser -u tomecms -- env -C "$app" TOME_CMS_PUBLIC_URL="$TOME_CMS_PUBLIC_URL" S3_ENDPOINT="$S3_ENDPOINT" ./scripts/deploy-vps.sh
          token_file="$app/.env.local"
          ;;
        *)
          # From 1.0.0 the deploy helper hands over to the managed installer, which needs root.
          (cd "$src" && ./scripts/deploy-vps.sh)
          token_file=/etc/tome-cms/tome-cms.env
          ;;
      esac

      printf '%s\n' \
        "TomeCMS is installed. Finish in the browser: ${TOME_CMS_PUBLIC_URL%/}/install" \
        "The installation token: sudo grep '^TOME_CMS_INSTALL_TOKEN=' ${token_file}" \
        "The install log: ${log}" >/etc/motd

packages:
  - git

runcmd:
  - [/usr/local/sbin/tomecms-first-boot]
```

`v0.13.0` has no `prepare-vps.sh`, so this file only works from the release that ships the script. The first-boot script says so rather than fail on a missing file. The release that ships this plan's work moves `TOMECMS_VERSION` to its own tag, and the version test above fails until it does.

- [ ] **Step 5: Run the test to see it pass**

Run: `node --import tsx --test tests/unit/cloud-init.test.ts`
Expected: 6 tests, all passing.

- [ ] **Step 6: Check the first-boot script with shellcheck**

Run: `node -e "const {parse}=require('yaml');const c=parse(require('fs').readFileSync('deploy/cloud-init.yaml','utf8'));process.stdout.write(c.write_files.find(f=>f.path.endsWith('first-boot')).content)" > /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/932419a0-46ec-45f2-92be-58217f48d21b/scratchpad/first-boot.sh && shellcheck /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/932419a0-46ec-45f2-92be-58217f48d21b/scratchpad/first-boot.sh`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add deploy/cloud-init.yaml tests/unit/cloud-init.test.ts package.json package-lock.json
```

Message file: `feat: a cloud-init file prepares a new server and installs TomeCMS`. Then `git commit -F <file>` on its own.

---

### Task 4/4: The docs, in English and Thai, and the changelog

**Files:**
- Create: `website/src/content/docs/start/prepare-server.md`
- Create: `website/src/content/docs/th/start/prepare-server.md`
- Modify: `website/src/content/docs/start/requirements.md`, `website/src/content/docs/th/start/requirements.md`
- Modify: `website/src/content/docs/start/install.md`, `website/src/content/docs/th/start/install.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the options in Task 1's `usage`, the steps in Task 2, and the first boot in Task 3. The docs must say what those do, no more.

- [ ] **Step 1: Write the English page**

Create `website/src/content/docs/start/prepare-server.md`. `order: 2.5` puts it between "What the server needs" (2) and "Installing on a VPS" (3) without renumbering them.

````markdown
---
title: Preparing a new server
description: Prepare a new Ubuntu 24.04 server for TomeCMS with one script, or have it prepare itself and install TomeCMS on its first boot with cloud-init.
sidebar:
  order: 2.5
---

A new VPS has none of what [What the server needs](/tome-cms/start/requirements/) asks for. `scripts/prepare-vps.sh` sets it up on Ubuntu 24.04: Docker Engine with its Compose plugin, Node.js 22, the GitHub CLI, swap, the firewall, and Caddy as the reverse proxy. Caddy gets the certificates for both origins by itself.

There are two ways to use it:

- Run it yourself, on a server you already have. Then install TomeCMS as [Installing on a VPS](/tome-cms/start/install/) describes.
- Paste `deploy/cloud-init.yaml` into the user data when you create the server. The server prepares itself and installs TomeCMS on its first boot, and you only open `/install`.

:::caution
Neither has been run on a real server yet. That test is part of the checks planned before 1.0.0. Until then, read what the script prints, and keep your provider's web console at hand in case SSH stops answering.
:::

## Before you start

- A server with Ubuntu 24.04 LTS, `amd64` or `arm64`, sized as [What the server needs](/tome-cms/start/requirements/#server-size) says.
- Two host names, such as `cms.example.com` and `media.example.com`, with DNS pointing at the server. Caddy asks for a certificate for each as soon as it starts, and keeps trying until the DNS points at the server.
- Root on the server, or an account that can use `sudo`.

## Run the script

On the server, get the code and run the script as root:

```sh
git clone https://github.com/Dhanabhon/tome-cms.git
cd tome-cms
sudo ./scripts/prepare-vps.sh --cms-url https://cms.example.com --media-url https://media.example.com
```

Add `--dry-run` the first time to see what it would do. A dry run checks the server and prints each step, and changes nothing.

The script works through these steps:

1. It checks the server before it changes anything: root, Ubuntu 24.04, `amd64` or `arm64`, systemd 235 or later, the account that will run TomeCMS, both addresses, and that nothing but Caddy holds ports 80 and 443. It lists every problem it finds, then stops.
2. It installs `ca-certificates`, `curl`, `git` and `gnupg`.
3. With `--create-user`, it creates the account, with no password, and gives it the SSH keys root has.
4. It installs Docker Engine and its Compose plugin from Docker's own apt repository, starts Docker, and adds the account to the `docker` group. A Docker that already has Compose is kept.
5. It installs Node.js 22 from NodeSource's apt repository at `/usr/bin/node`, unless that is already 22.12 or later.
6. It installs the GitHub CLI from GitHub's apt repository. The managed install from 1.0.0 uses it to check what it downloads.
7. With less than 4 GB of memory and no swap, it creates a swap file of 2 GB, or of the size `--swap-size` gives.
8. It allows SSH, then ports 80 and 443, in `ufw`, and turns `ufw` on. It reads the SSH port from the SSH server's settings, and never changes those settings.
9. It installs Caddy and writes `/etc/caddy/Caddyfile` for the two origins.
10. It looks up both host names and prints the addresses they point at, for you to compare with the server's.
11. It prints the commands that install TomeCMS.

Each step says whether it changed something or found it done, so running the script again is safe.

### Options

| Option | What it does |
| --- | --- |
| `--cms-url <url>` | The CMS origin, such as `https://cms.example.com`. Without it, the script reads `TOME_CMS_PUBLIC_URL`. |
| `--media-url <url>` | The media origin, such as `https://media.example.com`. Without it, the script reads `S3_ENDPOINT`. |
| `--user <name>` | The account that will run the deploy helper. It joins the `docker` group. Without it, the script uses the account that ran `sudo`. |
| `--create-user` | Creates that account if it does not exist. |
| `--no-firewall` | Leaves the firewall alone. |
| `--no-proxy` | Installs no proxy, for a server that has one already. The addresses are then not needed. |
| `--swap-size <size>` | The size of the swap file, such as `2G` or `1536M`. |
| `--dry-run` | Checks the server and prints each step, and changes nothing. |
| `--print-caddyfile` | Prints the Caddyfile for the two addresses, and changes nothing. |

### The proxy it sets up

Caddy forwards the CMS origin to `127.0.0.1:4321` and the media origin to `127.0.0.1:9000`. It passes the `Host` header on unchanged and accepts uploads of up to 25 MB, the two settings [the reverse proxy](/tome-cms/start/requirements/#the-reverse-proxy) needs.

The Caddyfile's first line marks it as the script's, and the script rewrites it each time it runs. It stops rather than overwrite a Caddyfile someone else changed. If you want to keep changes of your own, run the script with `--no-proxy`.

If nginx or Apache already holds port 80 or 443, the script names it and stops. Run it with `--no-proxy` to keep that server, and set it up as [the reverse proxy](/tome-cms/start/requirements/#the-reverse-proxy) describes.

## Create the server with cloud-init

`deploy/cloud-init.yaml` prepares a new server and installs TomeCMS on its first boot.

1. Open [`deploy/cloud-init.yaml`](https://github.com/Dhanabhon/tome-cms/blob/main/deploy/cloud-init.yaml) and copy it.
2. Replace the two example addresses near the top with yours.
3. Create the server with Ubuntu 24.04, and paste the file into its user data. DigitalOcean, Hetzner, Vultr and AWS each have a field for it among the advanced or additional options of a new server, called user data or cloud config.
4. Point both host names at the new server's address.
5. Wait. The first boot takes several minutes, because the deploy helper builds the application image on the server.
6. Log in over SSH. The login message says where to finish the install and how to read the installation token.

On its first boot, the server:

- clones TomeCMS, at the release the file names, into `/opt/tome-cms-src`
- runs `prepare-vps.sh` with `--create-user --user tomecms`
- for a `0.x` release, clones TomeCMS again into `/home/tomecms/tome-cms` and runs the deploy helper there as `tomecms`. From 1.0.0 the deploy helper hands over to the managed install, which runs as root.
- writes everything it does to `/var/log/tomecms-install.log`, which only root can read

The file holds no secret. The server generates every secret itself. That matters because the provider keeps your user data, and anything running on the server can read it back.

### If it did not finish

The login message says so. Read the end of the log:

```sh
sudo tail -n 50 /var/log/tomecms-install.log
```

Fix what it says, then run the step that failed again by hand. Both scripts skip what is already done:

```sh
sudo /opt/tome-cms-src/scripts/prepare-vps.sh --create-user --user tomecms --cms-url https://cms.example.com --media-url https://media.example.com
sudo -iu tomecms
cd tome-cms
TOME_CMS_PUBLIC_URL=https://cms.example.com S3_ENDPOINT=https://media.example.com ./scripts/deploy-vps.sh
```

For a `0.x` release the log also holds the installation token the deploy helper prints. That is why only root can read it.
````

- [ ] **Step 2: Write the Thai page**

Create `website/src/content/docs/th/start/prepare-server.md`:

````markdown
---
title: เตรียมเซิร์ฟเวอร์ใหม่
description: เตรียมเซิร์ฟเวอร์ Ubuntu 24.04 ใหม่ให้พร้อมสำหรับ TomeCMS ด้วยสคริปต์เดียว หรือให้เซิร์ฟเวอร์เตรียมตัวเองและติดตั้ง TomeCMS ตอนบูตครั้งแรกด้วย cloud-init
sidebar:
  order: 2.5
---

VPS ที่เพิ่งสร้างยังไม่มีสิ่งที่หน้า[สิ่งที่เซิร์ฟเวอร์ต้องมี](/tome-cms/th/start/requirements/)ระบุไว้เลย `scripts/prepare-vps.sh` ตั้งให้ครบบน Ubuntu 24.04 ได้แก่ Docker Engine พร้อมปลั๊กอิน Compose, Node.js 22, GitHub CLI, swap, ไฟร์วอลล์ และ Caddy ที่ทำหน้าที่ reverse proxy ซึ่งขอใบรับรองของทั้งสอง origin ให้เอง

ใช้งานได้สองแบบ

- รันเองบนเซิร์ฟเวอร์ที่มีอยู่แล้ว จากนั้นติดตั้ง TomeCMS ตามหน้า[ติดตั้งบน VPS](/tome-cms/th/start/install/)
- วาง `deploy/cloud-init.yaml` ลงในช่อง user data ตอนสร้างเซิร์ฟเวอร์ เซิร์ฟเวอร์จะเตรียมตัวเองและติดตั้ง TomeCMS ตอนบูตครั้งแรก คุณแค่เปิด `/install`

:::caution
ทั้งสองแบบยังไม่เคยรันบนเซิร์ฟเวอร์จริง การทดสอบนั้นอยู่ในรายการที่ต้องทำก่อน 1.0.0 ระหว่างนี้ให้อ่านสิ่งที่สคริปต์พิมพ์ออกมา และเปิดคอนโซลบนเว็บของผู้ให้บริการไว้ใกล้มือ เผื่อ SSH เข้าไม่ได้
:::

## ก่อนเริ่ม

- เซิร์ฟเวอร์ Ubuntu 24.04 LTS แบบ `amd64` หรือ `arm64` ขนาดตามหน้า[สิ่งที่เซิร์ฟเวอร์ต้องมี](/tome-cms/th/start/requirements/#ขนาดเซิร์ฟเวอร์)
- ชื่อโฮสต์สองชื่อ เช่น `cms.example.com` และ `media.example.com` ที่ชี้ DNS มาที่เซิร์ฟเวอร์แล้ว Caddy จะขอใบรับรองของแต่ละชื่อทันทีที่เริ่มทำงาน และลองใหม่ไปเรื่อย ๆ จนกว่า DNS จะชี้มาที่เครื่อง
- สิทธิ์ root บนเซิร์ฟเวอร์ หรือบัญชีผู้ใช้ที่ใช้ `sudo` ได้

## รันสคริปต์

บนเซิร์ฟเวอร์ ให้ดึงโค้ดลงมาแล้วรันสคริปต์ด้วยสิทธิ์ root

```sh
git clone https://github.com/Dhanabhon/tome-cms.git
cd tome-cms
sudo ./scripts/prepare-vps.sh --cms-url https://cms.example.com --media-url https://media.example.com
```

ครั้งแรกให้เติม `--dry-run` เพื่อดูว่าสคริปต์จะทำอะไรบ้าง แบบ dry run จะตรวจเซิร์ฟเวอร์และพิมพ์ทุกขั้นตอนออกมา โดยไม่เปลี่ยนอะไรเลย

สคริปต์ทำงานตามลำดับนี้

1. ตรวจเซิร์ฟเวอร์ก่อนเปลี่ยนอะไร ได้แก่ สิทธิ์ root, Ubuntu 24.04, `amd64` หรือ `arm64`, systemd 235 ขึ้นไป, บัญชีผู้ใช้ที่จะรัน TomeCMS, ที่อยู่ทั้งสอง และดูว่าพอร์ต 80 กับ 443 ไม่มีโปรแกรมอื่นนอกจาก Caddy ใช้อยู่ ถ้าเจอปัญหาจะแสดงทุกข้อแล้วหยุด
2. ติดตั้ง `ca-certificates`, `curl`, `git` และ `gnupg`
3. ถ้าใส่ `--create-user` จะสร้างบัญชีผู้ใช้แบบไม่มีรหัสผ่าน แล้วให้ใช้ SSH key ชุดเดียวกับของ root
4. ติดตั้ง Docker Engine และปลั๊กอิน Compose จาก apt repository ของ Docker เอง เปิด Docker และเพิ่มบัญชีผู้ใช้เข้ากลุ่ม `docker` ถ้าเครื่องมี Docker ที่ใช้ Compose ได้อยู่แล้ว สคริปต์จะใช้ตัวเดิม
5. ติดตั้ง Node.js 22 จาก apt repository ของ NodeSource ไว้ที่ `/usr/bin/node` เว้นแต่ตัวที่อยู่ตรงนั้นเป็น 22.12 ขึ้นไปแล้ว
6. ติดตั้ง GitHub CLI จาก apt repository ของ GitHub การติดตั้งแบบ managed ตั้งแต่ 1.0.0 ใช้มันตรวจสิ่งที่ดาวน์โหลดมา
7. ถ้าหน่วยความจำน้อยกว่า 4 GB และยังไม่มี swap จะสร้างไฟล์ swap ขนาด 2 GB หรือตามที่ระบุใน `--swap-size`
8. อนุญาต SSH ก่อน ตามด้วยพอร์ต 80 และ 443 ใน `ufw` แล้วเปิด `ufw` สคริปต์อ่านพอร์ต SSH จากการตั้งค่าของ SSH server เอง และไม่แก้การตั้งค่านั้น
9. ติดตั้ง Caddy และเขียน `/etc/caddy/Caddyfile` สำหรับทั้งสอง origin
10. ค้นชื่อโฮสต์ทั้งสองแล้วพิมพ์ที่อยู่ที่ชี้ไป ให้คุณเทียบกับที่อยู่ของเซิร์ฟเวอร์
11. พิมพ์คำสั่งสำหรับติดตั้ง TomeCMS

ทุกขั้นตอนจะบอกว่าเปลี่ยนอะไรไป หรือพบว่าทำไว้แล้ว จึงรันสคริปต์ซ้ำได้อย่างปลอดภัย

### ตัวเลือก

| ตัวเลือก | ทำอะไร |
| --- | --- |
| `--cms-url <url>` | origin ของ CMS เช่น `https://cms.example.com` ถ้าไม่ใส่ สคริปต์จะอ่านจาก `TOME_CMS_PUBLIC_URL` |
| `--media-url <url>` | origin ของมีเดีย เช่น `https://media.example.com` ถ้าไม่ใส่ สคริปต์จะอ่านจาก `S3_ENDPOINT` |
| `--user <name>` | บัญชีผู้ใช้ที่จะรันสคริปต์ deploy และเข้ากลุ่ม `docker` ถ้าไม่ใส่ จะใช้บัญชีที่สั่ง `sudo` |
| `--create-user` | สร้างบัญชีผู้ใช้นั้นถ้ายังไม่มี |
| `--no-firewall` | ไม่แตะไฟร์วอลล์ |
| `--no-proxy` | ไม่ติดตั้ง proxy สำหรับเซิร์ฟเวอร์ที่มีอยู่แล้ว เมื่อใช้ตัวเลือกนี้ไม่ต้องใส่ที่อยู่ |
| `--swap-size <size>` | ขนาดไฟล์ swap เช่น `2G` หรือ `1536M` |
| `--dry-run` | ตรวจเซิร์ฟเวอร์และพิมพ์ทุกขั้นตอน โดยไม่เปลี่ยนอะไร |
| `--print-caddyfile` | พิมพ์ Caddyfile สำหรับที่อยู่ทั้งสอง โดยไม่เปลี่ยนอะไร |

### proxy ที่สคริปต์ตั้งให้

Caddy ส่ง origin ของ CMS ต่อไปที่ `127.0.0.1:4321` และ origin ของมีเดียไปที่ `127.0.0.1:9000` ส่ง header `Host` ต่อไปตามเดิม และรับไฟล์อัปโหลดได้ถึง 25 MB ครบทั้งสองข้อที่[การตั้ง reverse proxy](/tome-cms/th/start/requirements/#ตั้ง-reverse-proxy)ต้องการ

บรรทัดแรกของ Caddyfile บอกว่าไฟล์นี้เป็นของสคริปต์ และสคริปต์จะเขียนทับทุกครั้งที่รัน ถ้ามีคนอื่นแก้ Caddyfile ไว้ สคริปต์จะหยุดแทนที่จะเขียนทับ ถ้าต้องการเก็บสิ่งที่แก้เอง ให้รันสคริปต์ด้วย `--no-proxy`

ถ้า nginx หรือ Apache ใช้พอร์ต 80 หรือ 443 อยู่แล้ว สคริปต์จะบอกชื่อโปรแกรมนั้นแล้วหยุด ให้รันด้วย `--no-proxy` เพื่อใช้ตัวเดิม แล้วตั้งค่าตามหน้า[การตั้ง reverse proxy](/tome-cms/th/start/requirements/#ตั้ง-reverse-proxy)

## สร้างเซิร์ฟเวอร์ด้วย cloud-init

`deploy/cloud-init.yaml` เตรียมเซิร์ฟเวอร์ใหม่และติดตั้ง TomeCMS ตอนบูตครั้งแรก

1. เปิด [`deploy/cloud-init.yaml`](https://github.com/Dhanabhon/tome-cms/blob/main/deploy/cloud-init.yaml) แล้วคัดลอกไป
2. แทนที่อยู่ตัวอย่างสองบรรทัดด้านบนด้วยที่อยู่ของคุณ
3. สร้างเซิร์ฟเวอร์ด้วย Ubuntu 24.04 แล้ววางไฟล์ลงในช่อง user data ทั้ง DigitalOcean, Hetzner, Vultr และ AWS มีช่องนี้อยู่ในตัวเลือกขั้นสูงหรือตัวเลือกเพิ่มเติมตอนสร้างเซิร์ฟเวอร์ โดยเรียกว่า user data หรือ cloud config
4. ชี้ชื่อโฮสต์ทั้งสองไปที่ที่อยู่ของเซิร์ฟเวอร์ใหม่
5. รอ การบูตครั้งแรกใช้เวลาหลายนาที เพราะสคริปต์ deploy build image ของแอปบนเซิร์ฟเวอร์
6. เข้าเครื่องผ่าน SSH ข้อความตอนเข้าระบบจะบอกว่าไปติดตั้งต่อที่ไหน และอ่าน installation token ได้อย่างไร

ตอนบูตครั้งแรก เซิร์ฟเวอร์จะ

- clone TomeCMS ตามรุ่นที่ไฟล์ระบุ ไว้ที่ `/opt/tome-cms-src`
- รัน `prepare-vps.sh` ด้วย `--create-user --user tomecms`
- สำหรับรุ่น `0.x` จะ clone TomeCMS อีกชุดไว้ที่ `/home/tomecms/tome-cms` แล้วรันสคริปต์ deploy ที่นั่นในนามของ `tomecms` ตั้งแต่ 1.0.0 สคริปต์ deploy จะส่งต่อให้การติดตั้งแบบ managed ซึ่งรันด้วยสิทธิ์ root
- บันทึกทุกอย่างที่ทำไว้ใน `/var/log/tomecms-install.log` ซึ่งมีแต่ root ที่อ่านได้

ไฟล์นี้ไม่มีความลับอยู่เลย เซิร์ฟเวอร์สร้างความลับทุกตัวขึ้นเอง ข้อนี้สำคัญ เพราะผู้ให้บริการเก็บ user data ของคุณไว้ และโปรแกรมใดก็ตามบนเซิร์ฟเวอร์อ่านกลับมาได้

### ถ้าติดตั้งไม่เสร็จ

ข้อความตอนเข้าระบบจะบอกไว้ ให้อ่านท้ายไฟล์ log

```sh
sudo tail -n 50 /var/log/tomecms-install.log
```

แก้ตามที่ log บอก แล้วรันขั้นตอนที่ล้มเหลวซ้ำเอง สคริปต์ทั้งสองจะข้ามสิ่งที่ทำไว้แล้ว

```sh
sudo /opt/tome-cms-src/scripts/prepare-vps.sh --create-user --user tomecms --cms-url https://cms.example.com --media-url https://media.example.com
sudo -iu tomecms
cd tome-cms
TOME_CMS_PUBLIC_URL=https://cms.example.com S3_ENDPOINT=https://media.example.com ./scripts/deploy-vps.sh
```

สำหรับรุ่น `0.x` ไฟล์ log ยังเก็บ installation token ที่สคริปต์ deploy พิมพ์ออกมาด้วย จึงให้แต่ root อ่านได้
````

Check both anchors before committing. Run `npm --prefix website run build` in Step 6, then confirm `/tome-cms/th/start/requirements/` has the ids `ขนาดเซิร์ฟเวอร์` and `ตั้ง-reverse-proxy`:

Run: `grep -o 'id="[^"]*"' website/dist/th/start/requirements/index.html`
Expected: the list includes `id="ขนาดเซิร์ฟเวอร์"` and `id="ตั้ง-reverse-proxy"`. If the ids differ, use the ones printed. Do the same for the English anchors `server-size` and `the-reverse-proxy`.

- [ ] **Step 3: Point the requirements page at it**

In `website/src/content/docs/start/requirements.md`:

Replace `The proxy is yours to provide, with its certificates. Point each origin at its port on the server:` with:

```markdown
The proxy is yours to provide, with its certificates, unless [`prepare-vps.sh`](/tome-cms/start/prepare-server/) sets up Caddy for you. Point each origin at its port on the server:
```

Replace `The install scripts leave the firewall alone and do not obtain certificates. Both are yours to set up.` with:

```markdown
The install scripts leave the firewall alone and do not obtain certificates. [`prepare-vps.sh`](/tome-cms/start/prepare-server/) does both: it opens only SSH, 80 and 443 in `ufw`, and Caddy gets the certificates. Without it, both are yours to set up.
```

In `website/src/content/docs/th/start/requirements.md`:

Replace `proxy และใบรับรองเป็นส่วนที่คุณต้องเตรียมเอง ตั้งให้แต่ละ origin ส่งต่อไปที่พอร์ตของตัวเองบนเซิร์ฟเวอร์` with:

```markdown
proxy และใบรับรองเป็นส่วนที่คุณต้องเตรียมเอง เว้นแต่ใช้ [`prepare-vps.sh`](/tome-cms/th/start/prepare-server/) ตั้ง Caddy ให้ ตั้งให้แต่ละ origin ส่งต่อไปที่พอร์ตของตัวเองบนเซิร์ฟเวอร์
```

Replace `สคริปต์ติดตั้งไม่แตะไฟร์วอลล์และไม่ขอใบรับรองให้ ทั้งสองอย่างนี้คุณต้องตั้งเอง` with:

```markdown
สคริปต์ติดตั้งไม่แตะไฟร์วอลล์และไม่ขอใบรับรองให้ แต่ [`prepare-vps.sh`](/tome-cms/th/start/prepare-server/) ทำได้ทั้งสองอย่าง โดยเปิดใน `ufw` แค่ SSH, 80 และ 443 และให้ Caddy ขอใบรับรองเอง ถ้าไม่ใช้สคริปต์นี้ ทั้งสองอย่างคุณต้องตั้งเอง
```

- [ ] **Step 4: Point the install page at it**

In `website/src/content/docs/start/install.md`, after the paragraph that starts `Before you start, have the server`, add a paragraph:

```markdown
On a new Ubuntu 24.04 server, [Preparing a new server](/tome-cms/start/prepare-server/) sets all of this up with one script, and can install TomeCMS for you as well.
```

In `website/src/content/docs/th/start/install.md`, after the paragraph that starts `ก่อนเริ่ม ให้เตรียมเซิร์ฟเวอร์ให้พร้อม`, add:

```markdown
ถ้าเป็นเซิร์ฟเวอร์ Ubuntu 24.04 ที่เพิ่งสร้าง หน้า[เตรียมเซิร์ฟเวอร์ใหม่](/tome-cms/th/start/prepare-server/) ตั้งทุกอย่างนี้ได้ด้วยสคริปต์เดียว และติดตั้ง TomeCMS ให้ด้วยก็ได้
```

- [ ] **Step 5: Add the changelog entry**

In `CHANGELOG.md`, insert before `## 0.13.0 - 2026-09-27`:

```markdown
## Unreleased

### Added

- `scripts/prepare-vps.sh` prepares a new Ubuntu 24.04 server for TomeCMS: Docker Engine with Compose, Node.js 22, the GitHub CLI, swap on a small server, `ufw` with only SSH, 80 and 443 open, and Caddy as the reverse proxy with certificates for both origins. `--no-firewall` and `--no-proxy` leave those two alone, and `--dry-run` shows what would change. Running it again is safe.
- `deploy/cloud-init.yaml` prepares a server and installs TomeCMS on its first boot, from the user data a provider takes when you create the server. It holds no secret. Neither it nor the script has been run on a real server yet.

```

- [ ] **Step 6: Check the docs**

Run: `npm --prefix website run check`
Expected: exit 0. It finds each page's twin and no em or en dash.

Run: `npm --prefix website run build`
Expected: exit 0. Then run the anchor check from Step 2 and fix any link whose anchor differs.

Run: `grep -n '—\|–' website/src/content/docs/start/prepare-server.md website/src/content/docs/th/start/prepare-server.md CHANGELOG.md scripts/prepare-vps.sh deploy/cloud-init.yaml`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add website/src/content/docs/start/prepare-server.md website/src/content/docs/th/start/prepare-server.md website/src/content/docs/start/requirements.md website/src/content/docs/th/start/requirements.md website/src/content/docs/start/install.md website/src/content/docs/th/start/install.md CHANGELOG.md
```

Message file: `docs: preparing a new server, in English and Thai`. Then `git commit -F <file>` on its own.

---

## After the last task

Run the gates one at a time, in the foreground:

1. `npm run check`
2. `npm run test:unit`

The browser and integration suites cover nothing this branch changes, so they are not rerun here; CI runs them on push. The CI step from Task 2 is the only run of the server half, and it happens when the owner pushes `develop`.

The release that ships this work moves `TOMECMS_VERSION` in `deploy/cloud-init.yaml` to its own tag, in the same commit as the version in `package.json`. The unit test in Task 3 fails until it does.
