---
title: Installing on a VPS
description: Install today's pre-1.0 preview of TomeCMS on one Linux server with the deploy helper, and what the managed install changes at 1.0.0.
sidebar:
  order: 3
---

Today's install is a pre-1.0 preview. The deploy helper, `scripts/deploy-vps.sh`, runs PostgreSQL, SeaweedFS and the application with Docker Compose, and builds the application image on the server from your checkout of the code.

Before you start, have the server, the DNS for both origins and the reverse proxy ready, as [What the server needs](/tome-cms/start/requirements/) describes. The helper runs on Linux, and needs Node.js 22.12 or newer, Docker Engine with the Compose plugin, and Git. Run it as a user who can use `docker`.

## 1. Get the code

On the server, clone the repository and go into it:

```sh
git clone https://github.com/Dhanabhon/tome-cms.git
cd tome-cms
```

## 2. Set the three addresses

```sh
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
```

`TOME_CMS_PUBLIC_URL` is the CMS origin, with no path after it. `S3_ENDPOINT` is the media origin. `MEDIA_PUBLIC_URL` is where readers load files from: the media origin followed by the bucket, which is `tomecms-media`. Leave it out and the helper builds that same address from `S3_ENDPOINT` and the bucket name.

## 3. Run the deploy helper

```sh
./scripts/deploy-vps.sh
```

The helper works through these steps and stops at the first one that fails:

1. It checks that it is on Linux, that `node` and `docker` are there, that Docker answers, and that Node.js is 22 or later.
2. It generates the secrets: the database password, the S3 secret key, the installation token, and three secrets the application signs and hashes with. It checks that all three addresses are HTTPS on a public host name.
3. It checks that ports `5432`, `9000` and `4321` are free on `127.0.0.1`.
4. It writes `.env.local` in the checkout, readable by its owner only.
5. It pulls the pinned images, `postgres:17-alpine` and `chrislusf/seaweedfs:4.46`, starts them, and waits until both are healthy.
6. It builds the application image.
7. It runs the database migrations in a one-shot application container.
8. It starts the application and waits until `/health/ready` reports it ready.
9. It prints the address of the first-run wizard and the installation token.

The end of its output looks like this:

```text
Starting PostgreSQL and SeaweedFS…
Applying database migrations…
Installer: https://cms.example.com/install
Installation token: <the token>
```

The token stays in `.env.local`, so you can read it again later:

```sh
grep '^TOME_CMS_INSTALL_TOKEN=' .env.local
```

The file puts every value between single quotes. Copy the token without them.

## 4. Check that it answers

Ask the application whether it is ready, first on the server itself and then through the proxy:

```sh
curl -s http://127.0.0.1:4321/health/ready
curl -s https://cms.example.com/health/ready
```

Both should print:

```json
{"status":"ready","checks":{"database":"ready","migrations":"ready","storage":"ready"}}
```

If the first answers and the second does not, look at the DNS and the proxy. If the first shows `"storage":"unavailable"`, the media origin's DNS or proxy is not answering yet, because the application reaches the bucket through `S3_ENDPOINT`. When both answer, open `https://cms.example.com/install` and go on with [the first-run wizard](/tome-cms/start/first-run/).

## If the helper stops

It prints one line that says what is wrong. The common ones:

| Message | What to do |
| --- | --- |
| `Error: VPS deployment requires Linux. Use npm run dev:macos for local macOS development.` | Run it on the Linux server. |
| `Error: Docker is not running or the current user cannot access it.` | Start Docker, or add your user to the `docker` group and log in again. |
| `Port 4321 is unavailable.` (or `5432`, `9000`) | Something else listens on that port on `127.0.0.1`. Stop it, or export `APP_PORT`, `POSTGRES_PORT` or `S3_PORT` with a free port and, for `APP_PORT` or `S3_PORT`, point the proxy at the new port. Changing a port after the first run also needs `--force`. |
| `TOME_CMS_PUBLIC_URL requires HTTPS without credentials; configure TLS separately.` | Use an `https://` address with no user name or password in it. The same goes for `S3_ENDPOINT` and `MEDIA_PUBLIC_URL`. |
| `TOME_CMS_PUBLIC_URL requires a browser-reachable public host; local or special-use address forms are not allowed.` | Use the public host name that DNS points at the server, not an IP address or a local name. |
| `Set .env.local permissions to 0600 before continuing.` | Run `chmod 600 .env.local`. |
| `Existing .env.local needs updates; rerun with --force to merge values while preserving secrets.` | A value differs from the one in `.env.local`, usually an address or a port you changed. Run `./scripts/deploy-vps.sh --force` to write the new values and keep the secrets. |
| `docker compose failed; inspect the service privately.` | A Compose step failed. Its output can hold secrets, so the helper does not print it. Read the logs yourself with `docker compose -f compose.yaml --env-file .env.local --profile production logs --tail 100`. |

## Running it again

Running the helper again from a newer checkout is how a 0.x install is upgraded today. Back up PostgreSQL and the media bucket together first. Then:

```sh
git pull
./scripts/deploy-vps.sh
```

It keeps `.env.local` as it is. It builds the new application image while the old one keeps serving the site, runs the new migrations, and then replaces the application container.

## What changes at 1.0.0

:::caution[Not released yet]
The managed install does not work yet. It needs the official repository and its image on GHCR to be public, and a stable, published, immutable `v1.0.0` release carrying `update-manifest.json`, `update-manifest.attestation.json` and `tomecms-image.attestation.json`. A tag alone is not enough.
:::

From 1.0.0 a fresh VPS gets a managed install, which differs from today's in these ways:

- The application image is pulled from GHCR by its digest and verified against the release's attestations. The server builds only the updater service, from the same checkout.
- The secrets go in `/etc/tome-cms/tome-cms.env`, not `.env.local`. You read the token with `sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env`.
- A separate systemd service, `tomecms-updater`, lets the admin install a verified update, starting with 1.0.0 to 1.0.1. It takes a full backup before each one.
- The installer runs as root. On top of today's needs, it wants systemd 235 or later, Node.js at `/usr/bin/node`, npm, curl, and a GitHub CLI whose `gh attestation verify` supports `--bundle`, `--signer-workflow`, `--source-ref`, `--source-digest` and `--deny-self-hosted-runners`.
- The application port is fixed at `4321`.

The commands, once `v1.0.0` exists:

```sh
git checkout --detach v1.0.0
npm ci
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
./scripts/install-managed-vps.sh --dry-run --version 1.0.0
sudo --preserve-env=TOME_CMS_PUBLIC_URL,S3_ENDPOINT,MEDIA_PUBLIC_URL \
  ./scripts/install-managed-vps.sh --version 1.0.0
```

The dry run checks the release, its attestations, the checkout and the server, prints its plan as JSON and changes nothing. On a checkout of a stable tag from `v1.0.0` on, `./scripts/deploy-vps.sh` hands over to the managed installer by itself.

A 0.x install cannot become a managed one in place, through the admin or by running the installer over it. Make and verify a full backup, keep the old secrets somewhere private, and set up a separate fresh server for 1.0.0. Move the content over by hand and check it there. Switch the DNS only once HTTPS, passkeys, content and media all work on the new server, and keep the old server and the backup until you are sure.
