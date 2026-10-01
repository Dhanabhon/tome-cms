---
title: Installing on a VPS
description: Install TomeCMS on one Linux server with the managed installer, which runs a verified release and lets the admin install updates, and how to build from source instead.
sidebar:
  order: 3
---

From 1.0.0, a VPS gets a managed install. The installer, `scripts/install-managed-vps.sh`, pulls the release's application image from GHCR by its digest and checks it against the release's attestations. It runs PostgreSQL, SeaweedFS and the application with Docker Compose, and sets up a systemd service, `tomecms-updater`, with which the owner installs a verified update from "System" in the admin.

Before you start, have the server, the DNS for both origins and the reverse proxy ready, as [What the server needs](/tome-cms/start/requirements/) describes. The installer runs as root on Linux. It needs Docker Engine with the Compose plugin, Git, systemd 235 or later, Node.js 22 at `/usr/bin/node` with npm, curl, and a GitHub CLI whose `gh attestation verify` supports `--bundle`, `--signer-workflow`, `--source-ref`, `--source-digest` and `--deny-self-hosted-runners`.

On a new Ubuntu 24.04 server, [Preparing a new server](/tome-cms/start/prepare-server/) sets all of this up with one script, and can install TomeCMS for you as well.

## 1. Get the release

As root, in the folder [Preparing a new server](/tome-cms/start/prepare-server/) cloned, install the release's packages:

```sh
cd /opt/tome-cms-src
npm ci
```

On a server you prepared another way, clone the release's tag there first:

```sh
git clone --depth 1 --branch v1.7.0 https://github.com/Dhanabhon/tome-cms.git /opt/tome-cms-src
```

Use the latest version from the [Releases page](https://github.com/Dhanabhon/tome-cms/releases), here and in the commands below. The installer works only from a clean checkout of that exact tag, and builds the updater with the packages `npm ci` installs. Keep the folder: the restore check on the [backups](/tome-cms/running/backups/) page runs from a checkout of the same release.

## 2. Set the three addresses

```sh
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
```

`TOME_CMS_PUBLIC_URL` is the CMS origin, with no path after it. `S3_ENDPOINT` is the media origin. `MEDIA_PUBLIC_URL` is where readers load files from: the media origin followed by the bucket, which is `tomecms-media`. Leave it out and the installer builds that same address from `S3_ENDPOINT` and the bucket name.

## 3. Run the installer

Try it first with `--dry-run`, then install:

```sh
./scripts/install-managed-vps.sh --dry-run --version 1.7.0
./scripts/install-managed-vps.sh --version 1.7.0
```

From an ordinary account, keep the addresses through `sudo` with `sudo --preserve-env=TOME_CMS_PUBLIC_URL,S3_ENDPOINT,MEDIA_PUBLIC_URL ./scripts/install-managed-vps.sh --version 1.7.0`.

The installer works through these steps and stops at the first one that fails:

1. It checks that it runs as root on Linux, on `amd64` or `arm64`, with Node.js 22 at `/usr/bin/node`, and that the checkout is clean and sits on the tag of the version you asked for.
2. It checks that nothing is installed yet: its folders are empty, and there is no `tomecms` Compose project or volume. It never installs over another install.
3. It reads the release from GitHub, and requires it to be published, stable and immutable, with the three files `update-manifest.json`, `update-manifest.attestation.json` and `tomecms-image.attestation.json`, each matching its SHA-256 digest.
4. It verifies the manifest and the image against those attestations with `gh attestation verify`. Both must come from `release.yml` in the official repository, for this tag and this commit, and not from a self-hosted runner.
5. It generates the secrets and checks that all three addresses are HTTPS on a public host name. A dry run stops here, prints its plan as JSON, and changes nothing.
6. It builds the updater, pulls the image by its digest, and checks the image's platform, version and commit.
7. It creates the system account `tomecms-updater`, and writes the secrets to `/etc/tome-cms/tome-cms.env`, the Compose file to `/opt/tome-cms`, and the `tomecms-updater` service.
8. It starts PostgreSQL and SeaweedFS, runs the database migrations, starts the application, and checks `/health/ready`.
9. It starts `tomecms-updater`, checks that the updater reports the version just installed, and prints the address of the first-run wizard.

The end of its output looks like this:

```text
Installer: https://cms.example.com/install
Installation token: sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env
Current version: 1.7.0
Backups: /var/backups/tome-cms
```

Run the second line's command to read the token. The file puts every value between single quotes. Copy the token without them.

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

If the first answers and the second does not, look at the DNS and the proxy. If the first shows `"storage":"unavailable"`, the application cannot reach the bucket: it reaches the bundled SeaweedFS at `http://seaweedfs:8333` (`S3_INTERNAL_ENDPOINT`), so give the containers a minute and check again. A media origin whose DNS or proxy is not answering yet does not show here, because the browser uploads through `S3_ENDPOINT` and the application does not. When both answer, open `https://cms.example.com/install` and go on with [the first-run wizard](/tome-cms/start/first-run/).

Later versions install from the admin, as [Updating](/tome-cms/running/updating/) describes.

## If the installer stops

It prints one line that says what is wrong. Until it has written its files, it also removes everything it created, so you can fix the cause and run it again. The common ones:

| Message | What to do |
| --- | --- |
| `Run installation as root using sudo.` | Run it as root, or through `sudo` as above. |
| `Checkout must match the exact stable release tag.` or `Requested version must equal package.json.` | Clone the release's tag as in step 1, and give `--version` the same version. |
| `Managed installer requires a clean release checkout.` | Something in the checkout was changed. `git status` shows what. Clone the tag again. |
| `Managed installation requires fresh empty destinations; existing files are retained.` or `Managed installation requires fresh Docker project and volumes.` | TomeCMS, or part of an earlier attempt, is already on this server. Install on a fresh server. |
| `Invalid or non-immutable official release.` | That version is not a published stable release. Check the tag on the Releases page. |
| `TOME_CMS_PUBLIC_URL is not set.` or `S3_ENDPOINT is not set.` | Export the addresses as in step 2, in the same shell you run the installer from. |
| `Port 4321 is unavailable.` (or `5432`, `9000`) | Something else listens on that port, often an earlier install on this server. The managed install needs a fresh server. |
| `systemd requires Node 22+ installed at /usr/bin/node.` or `Missing 'gh'.` | Install what it names. `prepare-vps.sh` installs both. |
| `TOME_CMS_PUBLIC_URL requires a browser-reachable public host; local or special-use address forms are not allowed.` | Use the public host name that DNS points at the server, not an IP address or a local name. |

If it stops after writing its files, it says `Managed installation failed; inspect the private diagnostics.`, keeps the configuration, the data and the logs, and prints the command that shows the logs. [Recovery](/tome-cms/running/recovery/#recovering-a-managed-installation) covers what to do next.

[Troubleshooting](/tome-cms/running/troubleshooting/) has more messages, from installing to uploading a file, with what each one means.

## Moving from 0.x

A 0.x install cannot become a managed one in place, through the admin or by running the installer over it. Make and verify a full backup, keep the old secrets somewhere private, and set up a separate fresh server for 1.0.0. Move the content over by hand and check it there. Switch the DNS only once HTTPS, passkeys, content and media all work on the new server, and keep the old server and the backup until you are sure.

## Building from source

The deploy helper, `scripts/deploy-vps.sh`, builds the application image on the server from any checkout, such as `develop`. This is how 0.x releases were installed. An install built this way only checks for updates: "System" shows a new release, but cannot install it. On a checkout of a release tag from `v1.0.0` on, the helper hands over to the managed installer instead.

Run it as an account that can use `docker`, not as root, from the checkout, with the three addresses exported as in step 2:

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

The token stays in `.env.local`, so you can read it again later with `grep '^TOME_CMS_INSTALL_TOKEN=' .env.local`.

### If the helper stops

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

### Running it again

Running the helper again from a newer checkout is how a source build is upgraded. Back up PostgreSQL and the media bucket together first. Then:

```sh
git pull
./scripts/deploy-vps.sh
```

It keeps `.env.local` as it is. It builds the new application image while the old one keeps serving the site, runs the new migrations, and then replaces the application container.
