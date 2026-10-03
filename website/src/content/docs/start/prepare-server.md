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
`prepare-vps.sh` has been run end to end on a DigitalOcean server (`amd64`, Ubuntu 24.04) on 2026-09-28, followed by a 0.x install. The cloud-init file, and the managed install from 1.0.0 after it, have not been run on a real server yet. Read what the script prints, and keep your provider's web console at hand in case SSH stops answering.
:::

## Before you start

- A server with Ubuntu 24.04 LTS, `amd64` or `arm64`, sized as [What the server needs](/tome-cms/start/requirements/#server-size) says.
- Two host names, such as `cms.example.com` and `media.example.com`, with DNS pointing at the server. Caddy asks for a certificate for each as soon as it starts, and keeps trying until the DNS points at the server.
- Root on the server, or an account that can use `sudo`.

## Run the script

Work as root. On a server that logs you in as another account, run `sudo -i` first. Get the release once, into the folder the install uses as well, and run the script from it:

```sh
git clone --depth 1 --branch v1.14.0 https://github.com/Dhanabhon/tome-cms.git /opt/tome-cms-src
cd /opt/tome-cms-src
./scripts/prepare-vps.sh --cms-url https://cms.example.com --media-url https://media.example.com
```

Use the latest version from the [Releases page](https://github.com/Dhanabhon/tome-cms/releases). Add `--dry-run` the first time to see what the script would do. A dry run checks the server and prints each step, and changes nothing. When it is done, go on with [Installing on a VPS](/tome-cms/start/install/) in the same folder: there is nothing to clone again.

### An account for SSH or a build from source

The managed install runs as root and needs no other account. Two cases want one:

- **To stop logging in as root.** `--create-user --user tomecms` creates an account with no password and root's SSH keys, so `ssh tomecms@your-server` works.
- **For [a build from source](/tome-cms/start/install/#building-from-source).** The deploy helper runs as an account in the `docker` group. `--user <name>` adds one, and so does running the script through `sudo`, which adds the account that ran it. Switch to it with `sudo -iu <name>`, which starts a new login so that the group applies.

The script works through these steps:

1. It checks the server before it changes anything: root, Ubuntu 24.04, `amd64` or `arm64`, systemd 235 or later, the account if you named one, both addresses, and that nothing but Caddy holds ports 80 and 443. It lists every problem it finds, then stops.
2. It installs `ca-certificates`, `curl`, `git` and `gnupg`.
3. With `--create-user`, it creates the account, with no password, and gives it the SSH keys root has. Each key keeps its options, such as `from=`, except the "log in as ubuntu" command a cloud image puts in front of root's keys, which is dropped.
4. It installs Docker Engine and its Compose plugin from Docker's own apt repository, starts Docker, and adds the account, if there is one, to the `docker` group. A Docker that already has Compose is kept.
5. It installs Node.js 22 from NodeSource's apt repository at `/usr/bin/node`, unless that is already 22.12 or later.
6. It installs the GitHub CLI from GitHub's apt repository. The managed install from 1.0.0 uses it to check what it downloads.
7. With less than 4 GB of memory and no swap, it creates a swap file of 2 GB, or of the size `--swap-size` gives.
8. It allows SSH, then ports 80 and 443, in `ufw`, and turns `ufw` on. It reads the SSH port from the SSH server's settings, and never changes those settings.
9. It installs Caddy and writes `/etc/caddy/Caddyfile` for the two origins.
10. It looks up both host names and prints the addresses they point at, for you to compare with the server's.
11. It prints the commands that install TomeCMS, from the same folder when it runs from a clone of the release tag.

Each step says whether it changed something or found it done, so running the script again is safe. If Docker's, NodeSource's, GitHub's or Caddy's apt repository is already set up some other way, the script keeps that source rather than add a second one. Before it adds one, it checks the vendor's signing key against the fingerprint the vendor publishes, and stops if the key it downloaded is a different one.

### Options

| Option | What it does |
| --- | --- |
| `--cms-url <url>` | The CMS origin, such as `https://cms.example.com`. Without it, the script reads `TOME_CMS_PUBLIC_URL`. |
| `--media-url <url>` | The media origin, such as `https://media.example.com`. Without it, the script reads `S3_ENDPOINT`. |
| `--user <name>` | An account to add to the `docker` group, for a build from source. Without it, the script uses the account that ran `sudo`, and run by root it adds none. |
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
5. Wait. The first boot takes several minutes.
6. Log in over SSH. While it is still installing, the login message says so. Once it finishes, the message says where to finish the install and how to read the installation token.

On its first boot, the server:

- clones TomeCMS, at the release the file names, into `/opt/tome-cms-src`
- runs `prepare-vps.sh` with `--create-user --user tomecms`
- from 1.0.0, runs the managed installer as root from `/opt/tome-cms-src`. For an older `0.x` release it clones TomeCMS again into `/home/tomecms/tome-cms` and runs the deploy helper there as `tomecms`.
- writes everything it does to `/var/log/tomecms-install.log`, which only root can read

The file holds no secret. The server generates every secret itself. That matters because the provider keeps your user data, and anything running on the server can read it back.

### If it did not finish

The login message says so. Read the end of the log:

```sh
sudo tail -n 50 /var/log/tomecms-install.log
```

Fix what it says, then run the install again. It skips what is already done and keeps the log:

```sh
sudo /usr/local/sbin/tomecms-first-boot
```

To run one step by hand instead, use the commands it runs:

```sh
sudo /opt/tome-cms-src/scripts/prepare-vps.sh --create-user --user tomecms --cms-url https://cms.example.com --media-url https://media.example.com
cd /opt/tome-cms-src && sudo npm ci
sudo TOME_CMS_PUBLIC_URL=https://cms.example.com S3_ENDPOINT=https://media.example.com ./scripts/install-managed-vps.sh --version 1.14.0
```

The installer refuses to run over an install it already started. If it stopped after writing its files, [Recovery](/tome-cms/running/recovery/#recovering-a-managed-installation) says what to do instead.
