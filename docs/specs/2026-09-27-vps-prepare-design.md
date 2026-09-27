# Preparing a new server

Date: 2026-09-27
Status: Approved by the owner; not yet built

## Why

Before `scripts/deploy-vps.sh` can run, the owner of a new VPS has to install and set up everything below by hand:

- Docker Engine with its Compose plugin
- Node.js 22.12 or newer
- Git
- a user in the `docker` group
- swap on a 2 GB server
- a reverse proxy with TLS for two origins
- a firewall

The helper checks for some of this and stops. The requirements page says plainly that "the install scripts leave the firewall alone and do not obtain certificates". That is the step where a new owner is most likely to give up.

This adds two things:

- **A script** that prepares a new Ubuntu server for TomeCMS.
- **A cloud-init file** that prepares a server and installs TomeCMS when the VPS is created, so the owner only has to open `/install`.

## Decisions

- **Approach:** one bash script, `scripts/prepare-vps.sh`, and a cloud-init file that calls it. A pure cloud-init file could not be reused on a server that already exists. Ansible would need Ansible first.
- **Firewall and proxy:** both are on by default, with a flag to turn each off.
- **cloud-init:** prepares the server and installs TomeCMS in one go.
- **1.0.0 managed install:** the script also prepares what it needs, which is `gh` and Node at `/usr/bin/node`. One prepared server serves both the 0.x deploy helper and the 1.0.0 managed installer.
- **Scope:** this is operations tooling, not an application feature. It prepares the operating system and installs nothing that the deploy helper or the managed installer already installs.

## `scripts/prepare-vps.sh`

Runs as root, on Ubuntu 24.04 LTS only, on `amd64` or `arm64`. Running it again is safe: each step says whether it made a change or found the work already done.

### Options

| Option | Meaning |
| --- | --- |
| `--cms-url <url>` | The CMS origin, such as `https://cms.example.com`. Falls back to `TOME_CMS_PUBLIC_URL`. |
| `--media-url <url>` | The media origin, such as `https://media.example.com`. Falls back to `S3_ENDPOINT`. |
| `--user <name>` | The account that will run the deploy helper and join the `docker` group. Defaults to `SUDO_USER`. Required when the script runs as root without `sudo`. It cannot be `root`. |
| `--create-user` | Create `--user` as a normal login account if it does not exist, with no password. Its SSH keys are the keys in root's `authorized_keys`, without the options in front of them: a cloud image puts a "log in as ubuntu" command there. |
| `--no-firewall` | Leave the firewall alone. |
| `--no-proxy` | Install no proxy. The owner provides one, as the requirements page describes. |
| `--swap-size <size>` | Swap to create when the server needs it. Default `2G`. |
| `--dry-run` | Print every step and what it would do, and change nothing. |
| `--help` | Print the options. |

The two URLs are required unless `--no-proxy` is given. Without the proxy, the script needs no origins.

### Steps

1. **Checks, before anything changes.** The script runs every check and lists each problem with a sentence saying what to do, then stops if there was any. Nothing on the server has changed at that point.
   - It runs as root.
   - `/etc/os-release` is Ubuntu 24.04.
   - The architecture is `amd64` or `arm64`.
   - systemd is 235 or newer.
   - Both URLs are `https://`, with a host name that has a dot, no path, no port, no credentials, and is not an IP address or `localhost`. The deploy helper checks them more strictly later; this catches typing mistakes early.
   - With the proxy on, nothing other than Caddy listens on ports 80 or 443. If nginx or Apache is found, the message names it and suggests `--no-proxy`.
2. **Base packages:** `ca-certificates`, `curl`, `git`, `gnupg`, through `apt-get` with `DEBIAN_FRONTEND=noninteractive`.
3. **Docker Engine.**
   - Installed from Docker's own apt repository, with its signing key in `/etc/apt/keyrings`. Packages: `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`.
   - The service is enabled and started.
   - The user is added to the `docker` group. The summary says to log in again for that to apply.
   - Never `curl | sh`.
4. **Node.js 22** from NodeSource's apt repository. It installs to `/usr/bin/node`, where the managed installer requires it. When `/usr/bin/node` is already 22 or newer, it is kept. A Node installed somewhere else, such as through nvm, does not count.
5. **GitHub CLI (`gh`)** from GitHub's apt repository. The managed installer uses it to verify attestations, which `gh attestation` does from 2.49. Ubuntu 24.04's own `gh` is 2.45, so a `gh` without `gh attestation` is upgraded from GitHub's repository.
6. **Swap**, when there is less than 4 GB of memory and no swap. A server sold as 4 GB reports a little less than 4 GiB, so the line is drawn at 3.5 GiB:
   - creates `/swapfile` of `--swap-size` with mode `0600`
   - adds it to `/etc/fstab`
   - sets `vm.swappiness=10` in `/etc/sysctl.d/99-tomecms.conf`
   Existing swap is left alone.
7. **Firewall (ufw),** unless `--no-firewall`.
   - It reads the SSH port from `sshd -T`, falling back to 22, and allows it **before** anything else.
   - It then allows `80/tcp` and `443/tcp` and enables ufw.
   - Rules already present are kept.
   - The script never changes the SSH daemon's configuration.
8. **Caddy,** unless `--no-proxy`. Installed from Caddy's apt repository. It writes `/etc/caddy/Caddyfile`, which starts with the line `# Managed by TomeCMS prepare-vps.sh`:

   ```caddyfile
   cms.example.com {
     reverse_proxy 127.0.0.1:4321
   }

   media.example.com {
     request_body {
       max_size 25MB
     }
     reverse_proxy 127.0.0.1:9000
   }
   ```

   - Caddy passes the `Host` header upstream unchanged. Presigned uploads need that.
   - The 25 MB body limit matches the largest document the File Manager takes.
   - If a Caddyfile exists without the marker line, the script stops and says so, rather than overwrite it.
   - Caddy is reloaded after the file is written.
9. **DNS.** It looks up both host names with `getent ahosts` and prints the addresses they resolve to, so the owner can compare them with the server's public address. It does not compare them itself: on a provider such as AWS the public address is not on any interface of the server. If a name does not resolve yet, it warns, and does not stop: Caddy keeps trying and gets the certificates once the DNS points at the server.
10. **Summary.** What was installed or changed, what was already there, and the next command:
    - `sudo -iu <user>`
    - then clone the repository and run `./scripts/deploy-vps.sh` with the three addresses

### Structure

- **Arguments and URL checks:** small functions at the top. The Caddyfile is produced by one function, `render_caddyfile <cms-host> <media-host>`, so it can be tested.
- **The logic:**
  - `--dry-run` goes through the same steps and prints "would install …" instead of running them.
  - Every command that changes the system goes through one `run` function, which honours `--dry-run`.
- **Errors:** `set -Eeuo pipefail`. Each step reports its own failure in a sentence. Nothing prints a secret; there are none, because the deploy helper generates them later.

## `deploy/cloud-init.yaml`

A `#cloud-config` file an owner pastes into the "user data" field when creating the VPS.

**What the owner fills in:** the CMS URL and the media URL, as two clearly marked lines near the top.

**What the file pins:** the TomeCMS version tag. Each release updates it.

At first boot, it:

1. Clones the repository at the pinned tag into `/opt/tome-cms-src`.
2. Runs `scripts/prepare-vps.sh --create-user --user tomecms` with both URLs.
3. Runs `scripts/deploy-vps.sh` with the three addresses:
   - For a `0.x` tag, it runs as `tomecms` through `runuser`, which picks up the new `docker` group without a new login. It runs from a clone of `/opt/tome-cms-src` that the user owns, `/home/tomecms/tome-cms`.
   - For a `1.x` tag, the deploy helper hands over to `install-managed-vps.sh`, which creates root-owned files and a systemd service, so it runs as root.
4. Writes the output of steps 1 to 3 to `/var/log/tomecms-install.log` only, with mode `0600`, and not to `cloud-init-output.log`. For a `0.x` tag the deploy helper prints the installation token itself, so the log holds it until the site is installed.
5. Adds a short message to `/etc/motd`, shown at the next SSH login. It says where the install log is, the installer address, and the command that prints the installation token:
   - `0.x`: `sudo grep '^TOME_CMS_INSTALL_TOKEN=' /home/tomecms/tome-cms/.env.local`
   - `1.x`: `sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env`, which the managed installer prints too
   The token itself is never written to the motd.

The file holds no secret: the deploy helper generates every secret on the server. This matters because a provider's metadata service keeps user data, readable from inside the server.

**Failure:** if a step fails, the log says which one. The motd says the install did not finish and points at the log. `prepare-vps.sh` and `deploy-vps.sh` can both be run again by hand.

## Documentation, in English and Thai

- **A new page, "Preparing a new server"**, under Start. It covers:
  - what the script does and every option
  - cloud-init step by step, with where to paste user data on common providers (DigitalOcean, Hetzner, Vultr, AWS)
  - the DNS requirement
  - how to read the install log
  - that this path has not yet been tried on a real server
- **`start/requirements.md`:** the sentence that the scripts leave the firewall alone and obtain no certificates changes. It now says `prepare-vps.sh` can do both, and that without it they are the owner's.
- **`start/install.md`** points to the new page before step 1.
- **`CHANGELOG.md`:** Unreleased > Added.

## Testing

- **`bash -n` and `shellcheck`** on `scripts/prepare-vps.sh`, in CI. Neither runs in CI today. The `ubuntu-24.04` runner has `shellcheck` already.
- **Unit tests.** A `node --test` file runs the script and asserts what it can on any machine, macOS included, because each of these exits before the operating system checks:
  - the argument and URL checks, accepted and refused
  - the output of `render_caddyfile`, called through a `--print-caddyfile` option that prints it and exits
- **A dry run on Ubuntu.** CI runs on `ubuntu-24.04`, a real Ubuntu 24.04 with systemd. A CI step runs `sudo scripts/prepare-vps.sh --dry-run` with two example URLs and checks that it passes every check and prints the plan. A container would not do: it has no systemd.
- **cloud-init.**
  - A unit test parses the file with the `yaml` package and checks that it starts with `#cloud-config` and holds no secret. `yaml` 2.9.0 is already in the lock file through Astro; it becomes a direct dev dependency at that version, so nothing new is downloaded. `cloud-init schema` is not used: the CI runner does not have it.
  - The unit test also checks that the pinned tag is `v` plus `package.json`'s version, so a release that forgets to update it fails CI.
- **Real servers.** A full run on a real VPS is not possible here. It belongs with the VPS acceptance planned before 1.0.0. Until then, the docs say the path has not been tried on a real server.

## Out of scope

- Other distributions. Debian and other versions of Ubuntu are refused with a message.
- Changing SSH, creating keys, or hardening beyond the firewall, such as fail2ban.
- Backups and monitoring.
- Installing TomeCMS outside the deploy helper or the managed installer. The script only prepares the system; cloud-init calls the existing installers.
