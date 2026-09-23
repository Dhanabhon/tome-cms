<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/tomecms-logo-reverse.png">
    <img alt="TomeCMS" src="public/brand/tomecms-logo-color.png" width="360">
  </picture>
</h1>

TomeCMS is a lightweight CMS for sites in Thai and English, built with Astro. It ships a server-rendered blog and a React admin editor, and serves the same published content through a versioned headless REST API.

> **Status:** the package is `0.10.0`, and there is no production `v1.0.0` release yet. The managed `1.0.0` updater and its disposable operation harness are implemented. The production dependency audit reports no advisory at all. The integration, browser and operations gates run green against Astro 7. Two gates stay open because they need infrastructure this repository cannot stand up for itself: verifying a public, immutable release and its attestations, and accepting a real HTTPS VPS on `amd64` and `arm64`. Release notes: [0.10.0](docs/releases/0.10.0.md), [0.9.0](docs/releases/0.9.0.md), [0.8.0](docs/releases/0.8.0.md), [0.7.0](docs/releases/0.7.0.md), [0.6.0](docs/releases/0.6.0.md), [0.5.0](docs/releases/0.5.0.md), [0.4.0](docs/releases/0.4.0.md), [0.3.0](docs/releases/0.3.0.md), [0.2.0](docs/releases/0.2.0.md), and the [planned 1.0.0 boundary](docs/releases/1.0.0.md). The [changelog](CHANGELOG.md) sums up every version in one place.

This README has two parts. [Running TomeCMS](#running-tomecms) is for installing it and looking after a site. [Developing TomeCMS](#developing-tomecms) is for working on the code.

## Key features

### Writing

- An editor with headings, lists, quotes, code, images, files, tables, links and alignment; its writer decides whether a link opens in a new tab, and a file from the library goes into an article as a card a reader downloads, a PDF opening in the browser
- Posts in Thai and English, each language an edition of the same post, with shared categories, drafts, previews, scheduled publishing and SEO fields
- Pages, and header and footer navigation you configure
- A file manager backed by S3-compatible object storage, keeping documents (PDF, Word, Excel, PowerPoint, CSV, text and ZIP) beside images, with folders, search and a filter by type

### Publishing

- Server-rendered public pages: a reader downloads JavaScript only for a feature the owner turned on
- Addresses in the language of the title, Thai included, and permanent redirects from old ones
- A sitemap and an RSS feed
- A published-only REST API with an OpenAPI 3.1 document, and an optional headless mode that keeps the admin and the APIs and hides the bundled blog

### Look

- Themes chosen under Appearance, each previewed drawing your own posts: `paper`, and a spare second called `plain`
- Home slides for each language, kept under Content: a picture, a few words and a button, drawn as a still banner or a slider by the theme
- Light and dark for the admin and for readers, who can pick their own unless you turn that off
- The site's own logo (SVG included), an optional logo for the dark theme, and its icon

### Sign-in and plugins

- A six-step first-run wizard, with an admin address you choose
- Passkey-only owner sign-in, with one-time recovery codes
- An admin in Thai or English, following the site's language
- Plugins that fill hooks the core declares, each off until you switch it on: Cloudflare Turnstile on the sign-in form, a sticky banner, an image lightbox, and suggestions while writing from Jev (TypeSafe AI)

### Running a site

- Docker Compose with PostgreSQL and a bundled SeaweedFS, or external S3-compatible storage
- Backups that keep the database and the media together, and a check that restores one into throwaway containers and compares it
- A deploy helper for a single VPS, with minimum and recommended server sizes

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/tome-cms-overview.en.dark.png">
  <img alt="How TomeCMS fits together: a visitor reads public pages that the chosen theme draws and the Astro server renders on every request; the site owner writes in the React admin, which calls the same server; the server keeps content in PostgreSQL and files in S3-compatible storage; Better Auth signs the owner in with a passkey; plugins can check a sign-in with Cloudflare Turnstile and suggest while writing through Jev (TypeSafe AI)." src="docs/tome-cms-overview.en.light.png">
</picture>

One Node.js process serves the public pages, the admin and both APIs, and PostgreSQL and the object store hold everything that lasts. [docs/tome-cms-overview.en.html](docs/tome-cms-overview.en.html) is the same diagram to explore, with a guided view of each path through it: download it and open it in a browser. A Thai edition sits beside it.

# Running TomeCMS

## What the server needs

One VPS runs the whole site: the TomeCMS application, PostgreSQL 17 and SeaweedFS (the S3-compatible media store), all in Docker Compose, behind a TLS reverse proxy you provide.

| | Minimum | Recommended |
| --- | --- | --- |
| CPU | 1 vCPU | 2 vCPU |
| Memory | 2 GB, with 2 GB of swap | 4 GB |
| Disk | 25 GB SSD | 50 GB SSD, more for a large media library |
| Architecture | `amd64` or `arm64` | `amd64` or `arm64` |
| System | 64-bit Linux with systemd, Docker Engine and its Compose plugin, Node.js 22 and Git | Ubuntu 24.04 LTS, the system CI runs on |

These figures come from measuring the 0.7.0 code on an empty site, not from a production load. After a few hundred requests the application held about 180 MB, PostgreSQL about 75 MB and SeaweedFS about 90 MB. The peak is the build. Today's deploy helper builds the application image on the server itself, and on an upgrade it does so while the site keeps running. `npm run build` alone reached about 700 MB with a warm cache, after `npm ci` had already run, and a first build on a fresh server can go higher. That is where a 1 GB server runs out. Uploading an image takes more memory for a moment while it is inspected; that was not measured. The operating system and the TLS proxy need their share too.

On disk, the PostgreSQL and SeaweedFS images take about 1.1 GB together and the application image several hundred MB more. A build leaves a cache of about the same size, which `docker builder prune` reclaims. Media is stored once, in SeaweedFS. A complete backup copies the database and every media object again, and a managed installation (1.0.0 and later) takes one before each update and never deletes old ones. Plan for your media's size times the number of backups you keep on the server, or copy them somewhere else.

Before installing, point DNS at the server for two HTTPS origins: one for the CMS and one for the media (S3) endpoint. Configure the reverse proxy to send the CMS origin to `127.0.0.1:4321` and the media origin to `127.0.0.1:9000`. Compose binds PostgreSQL, SeaweedFS and the application to `127.0.0.1` only, so the firewall needs nothing open beyond SSH, HTTP and HTTPS. The install scripts do not change firewall rules or obtain certificates.

## Installing today (pre-1.0 preview)

The deploy helper runs PostgreSQL, SeaweedFS and the application with Docker Compose. It needs a Linux server with Node.js 22 or newer, Docker Engine with Compose, and Git.

From a clean checkout on the server:

```sh
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
./scripts/deploy-vps.sh
```

The helper writes `.env.local` in that checkout, readable by its owner only. It pulls the pinned infrastructure images, builds the application image, runs migrations in a one-shot application container, starts the production profile and waits for `/health/ready`. Accepting a real HTTPS host is still a release gate.

Back up PostgreSQL and the media bucket together before every upgrade; see [Backups](#backups).

## The first-run wizard

Open `/install` on the CMS origin. The wizard asks for the installation token, which is in `.env.local`:

```sh
grep '^TOME_CMS_INSTALL_TOKEN=' .env.local
```

It also asks for the admin path, for example `/studio`. Bookmark that address: the public header and footer do not link to the admin.

## Upgrading

The application's migrations are applied with `npm run db:migrate`, and the deploy helper runs them for you. An installation created from 0.9.0 or 0.8.0 has one waiting, `023_home_slides`. One created from 0.7.0 or 0.6.0 has three, `021_media_documents`, `022_navigation_new_tab` and `023_home_slides`. One created from 0.5.0 or 0.4.0 has four, those and `020_site_brand`. One created from 0.3.0 has seven, and one from before 0.3.0 has those and nine more; see the [0.10.0](docs/releases/0.10.0.md#upgrading), [0.8.0](docs/releases/0.8.0.md#upgrading), [0.6.0](docs/releases/0.6.0.md#upgrading), [0.4.0](docs/releases/0.4.0.md#upgrading) and [0.3.0](docs/releases/0.3.0.md#upgrading) notes. The admin names any migration it finds unapplied at the top of every screen.

## Configuration

`.env.example` documents every setting. The important ones:

```dotenv
DATABASE_URL=postgresql://tomecms:password@127.0.0.1:5432/tomecms
TOME_CMS_PUBLIC_URL=http://localhost:4321
TOME_CMS_INSTALL_TOKEN=at-least-32-characters
BETTER_AUTH_SECRET=at-least-32-characters
TOME_CMS_CONTEXT_SECRET=at-least-32-characters
TOME_CMS_RECOVERY_PEPPER=at-least-32-characters
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=tomecms
S3_SECRET_ACCESS_KEY=private-value
S3_BUCKET=tomecms-media
S3_FORCE_PATH_STYLE=true
MEDIA_PUBLIC_URL=http://127.0.0.1:9000/tomecms-media/
TOME_CMS_FRONTEND_MODE=bundled
```

In production the three URLs must be HTTPS on a public host; TomeCMS refuses to start otherwise.

Never commit `.env.local`, credentials, database dumps or object-storage backups. The bootstrap writes `.env.local` with owner-only permissions on macOS and Linux.

The bundled SeaweedFS is a single node, which suits local development and a single VPS. Point the same S3 settings at external object storage when you need high availability or more than one node.

The browser puts uploads straight into the bucket, so an external store needs a CORS rule for the site's origin that allows `PUT` with the `content-type`, `x-amz-checksum-sha256` and `content-disposition` headers. The last carries a document's name and how it opens, and is signed into the upload. The bundled SeaweedFS allows what the site's origin asks for, and nothing to any other origin.

### Bundled and headless modes

The default is:

```dotenv
TOME_CMS_FRONTEND_MODE=bundled
```

Set `TOME_CMS_FRONTEND_MODE=headless` and restart TomeCMS to answer `404` for the bundled homepage, the localized posts and pages, the sitemap and RSS. The admin, authentication, installation, recovery, health, media, draft previews and `/api/v1/content/*` stay available. In headless mode `robots.txt` stays too, and disallows crawling the origin.

## Running the site from the admin

### Themes

The public site is a theme. **Appearance → Themes** names which one draws it. `paper` is the one TomeCMS ships with, and `plain` is a deliberately spare second that exists so the theme contract has more than one reader.

The screen shows a card per theme, and each card shows that theme drawing this installation's own posts in a frame: `/admin/themes/preview/<id>`, the homepage route with the theme taken from the URL instead of the settings, behind the owner's session and never indexed. Nothing is committed beside a theme to stand in for it, because a picture of a theme is a thing that can come to disagree with the theme. Choosing one applies it; there is no save button.

Settings calls the light/dark choice **Appearance**, and **Theme** means the one above.

### Plugins

Plugins ship in the repository and are switched on and configured under **Appearance → Plugins**. Settings are stored per plugin. A setting the plugin marks secret is encrypted at rest with `TOME_CMS_CONTEXT_SECRET` and never sent to a browser: the screen is told only whether one is set, and leaving the field blank on save keeps what is stored rather than erasing it.

The screen is a card per plugin. Where a plugin directory fills the band under a card with ratings and install counts, this one has none to report, because plugins ship with the release. The band says what a directory could not: which of the core's hooks the plugin fills. Its icon is one of the admin's own, so nothing a plugin ships is drawn.

The switch on a card applies on the spot and says in a word which way it is thrown. A plugin that is not set up cannot be switched on there, which is the refusal the server already makes. The fields are behind **Set up**, in the panel the editors already use.

The first plugin is **Cloudflare Turnstile**. Give it the site key and secret key from your Cloudflare dashboard and switch it on; a challenge then appears on the sign-in form, and every attempt is verified before it reaches the Passkey ceremony.

What a failed verification means is decided in core, not by the plugin:

| What happened | What follows |
| --- | --- |
| The token is invalid, missing or already spent | The attempt is refused |
| The secret key is wrong, the request is malformed, Cloudflare answers 5xx, cannot be reached, or times out | The attempt proceeds, and the reason is logged |

The second row is the important one: mistyping a secret key cannot lock you out of your own site. Nor can the plugin close the way back in. The guard runs on the sign-in attempt and never on registration, so recovery works with the plugin on, misconfigured, or both.

If the challenge itself will not load in your browser, switch the plugin off from a shell:

```sh
npm run plugin:disable turnstile
npm run plugin:disable turnstile -- --forget
```

The first switches it off and keeps its settings. `--forget` clears them as well, which the admin deliberately cannot do.

Two more plugins reach the public site rather than the sign-in form.

**Sticky Banner** puts a band across the top of every public page, with a sentence you write in each language, in the background and text colours you choose (black and white until you do). Whether a reader can close it is yours to decide. Closable, it slides away, and what is remembered is the message rather than the plugin, so a new message is shown again to somebody who closed the last one. Kept up, it has no close control, and the page carries no script for it at all. The link field takes a path on this site or an `https` address; anything else, `javascript:` first among them, is dropped, and the message is shown without a link.

**Image lightbox** opens an article's images full size without leaving the page. It is asked for only where there are images to open: a homepage of cards never fetches its code.

A plugin that is switched off ships nothing at all. Each one's browser code is a chunk behind a dynamic import that only a mount point on the page asks for, so a reader of a site with both switched off downloads neither.

### Suggestions while writing

The post and page settings drawers can read what you have written and suggest which of your own categories it belongs under, a line from it for the excerpt, and a passage from it for the meta description. Nothing in the core does this. It is the **Jev (TypeSafe AI)** plugin, off until you switch it on under **Appearance → Plugins** and give it an API key from your TypeSafe console. The key is stored encrypted, like any plugin secret, and never sent to a browser.

An installation that leaves it off draws no suggestion buttons at all, and nothing a reader sees depends on it either way. With it on, nothing is applied for you: a category is a chip you press, and a line or a description is a quotation with its own button. The article's text is sent to `api.typesafe.ai` when you press one of those buttons, and at no other time.

What a plugin may return is decided by the core rather than by the plugin. A category comes back as a likelihood, and the core decides which are suggested and which are only offered as a maybe. An excerpt or a description comes back as a choice among passages the core found in your article, each short enough for where it goes: 120 characters for a card, 160 for a search result. The core keeps a choice only if it is one of those passages, so no plugin can put words on a card or in a search result that you did not write.

### Publishing, addresses and redirects

A post or page can be published for a date that has not come. Set **Publish at** in its settings drawer and press Publish, and it stays off the site until then: off the feed, its own address, the sitemap, its category and the menu. The list says *Scheduled* over it in the meantime. Left blank, it publishes the moment you press the button.

A title's address is made in its own language: a Thai title gets a Thai address, with a hyphen between each pair of words, and a browser shows it in Thai. The field stays editable for anyone who wants a Latin one.

When a published article's address changes, the old one keeps working. It answers with a permanent redirect to wherever the article is now, however many times it has moved since, and goes when the article is deleted. **Content → Redirects** lists every old address and where each one goes, lets you remove one, and lets you add one by hand, for an address that changed before these were recorded.

## Headless content API

The anonymous API is read-only and returns published content only:

```text
GET /api/v1/content/site
GET /api/v1/content/posts?locale=th
GET /api/v1/content/posts/{slug}?locale=th
GET /api/v1/content/pages?locale=th
GET /api/v1/content/pages/{slug}?locale=th
GET /api/v1/content/categories?locale=th
GET /api/v1/content/navigation?locale=th
GET /api/v1/content/openapi.json
```

List routes support signed cursor pagination. Public responses include cache validators and wildcard CORS. Draft preview responses are token-scoped and private, and never enable wildcard CORS.

In bundled mode the site also serves:

```text
GET /sitemap.xml
GET /rss.xml
GET /robots.txt
```

## Getting back in, and starting over

Sign in with a spare Passkey, or with a one-time recovery code at `/recovery`. If neither is to hand, the owner-recovery command issues a single-use recovery link from the server itself:

```sh
npm run admin:recover
npm run admin:recover -- --execute
```

The first form reports the site and owner it found and changes nothing. The second prints a link that expires in ten minutes and is spent the moment a replacement Passkey is registered; any saved recovery codes are left alone. It reads `.env.local`, or `/etc/tome-cms/tome-cms.env` on a managed VPS, or whatever `TOME_CMS_ENV_FILE` points at.

Register the replacement Passkey in an ordinary browser window. A Passkey created in a private or incognito window may not outlive it, which leaves a credential recorded here that no browser can offer.

If a sign-in plugin is what stands in the way, switch it off from the same shell; see [Plugins](#plugins).

To return an installation to the wizard, stop Astro or the production application, and preview the exact scope first:

```sh
npm run admin:reset-installation
npm run admin:reset-installation -- --execute
```

The execute form needs an interactive terminal and the exact phrase shown in its preview. It refuses while there are recent upload signatures or objects in the bucket it does not track. It deletes TomeCMS's application and authentication data and the media objects it knows, then checks that the site setting and the object inventory are empty. The database schema, the Kysely migration history, `.env.local` and the installation token remain, so restarting TomeCMS opens `/install` for a clean installation.

## Backups

A database-only backup is incomplete, because post and page media lives in object storage. Stop every writer first: stop a host-run Astro with `Ctrl+C`, or stop the production application container:

```sh
docker compose -f compose.yaml --env-file .env.local stop app
```

Then create one recovery point outside the repository:

```sh
npm run backup -- --offline --output-root /absolute/path/outside/the/repository/tomecms-backups
```

`--offline` confirms that no host-run TomeCMS process is writing, and the command also refuses while a Compose application is running. Each timestamped directory holds a custom-format PostgreSQL dump, a mirror of the S3 objects, and a checksum manifest with configuration identifiers but no credentials. A backup that failed or was interrupted has no final manifest and must not be restored.

Verify a backup by restoring it into a uniquely named, disposable Compose project:

```sh
npm run restore:check -- \
  --backup /absolute/path/to/tomecms-backups/tomecms-20260913T120000000Z \
  --project tomecms-restore-check-20260913
```

The check validates the checksums, restores PostgreSQL and every object, compares the record and object inventories, and always removes the disposable containers and volumes. It also puts back each document's `Content-Disposition` (the name it downloads under, and whether a PDF opens in the browser) from its row in `media_items`, because that header lives on the object in the store and the backup does not carry it. A restore done by hand has to set it the same way, with `contentDisposition` in `src/server/media/disposition.ts`. It never targets the normal `tomecms` project. Keep local ports `55432` and `59000` free while it runs.

## Managed installation from 1.0.0

The package is still pre-`1.0.0`, and this flow becomes available only once the official repository and GHCR image are public and a matching, published, immutable stable release exists. That release must contain `update-manifest.json`, `update-manifest.attestation.json` and `tomecms-image.attestation.json`, each at its exact official tag URL with a GitHub SHA-256 asset digest. The installer verifies the two downloaded bundles against the official release workflow, source tag and commit, and rejects attestations made on self-hosted runners. It does not use GitHub's default attestation API lookup. Publishing a tag alone does not meet these conditions.

Use a fresh Linux VPS (`amd64` or `arm64`) with:

- systemd 235 or newer
- Node.js 22 or newer at `/usr/bin/node`, npm and Git
- Docker Engine with the Compose plugin and the `docker` group
- GitHub CLI with `gh attestation verify` supporting `--bundle`, `--signer-workflow`, `--source-ref`, `--source-digest` and `--deny-self-hosted-runners`
- curl

Set up the public HTTPS origins for the CMS and the S3 service first. No permanent GitHub token is installed. The installer needs root for its fixed directories and its service account. It does not install Docker, configure DNS or TLS, or change a firewall.

After `v1.0.0` is released, use a clean checkout of that exact official tag:

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

The dry run verifies the public release metadata, the byte-exact digest of all three release assets, both attestations, the identity of the checkout, tag and package, the platform, the prerequisites, and that the destinations are fresh. It prints one JSON plan. Each download is capped at 512 KiB. It works in a private temporary directory that holds the three inputs at `0600` beside separate `0700` GitHub configuration and cache directories, and removes it afterwards. GitHub credentials and host overrides are kept out of verification. It does not build, pull, create an account, install files or start services. The tests use copied source and release fixtures and `--root-prefix`, with a complete set of executable stubs inside that prefix; that is a test boundary, not an option for a real VPS.

Installation builds the host updater from the matching checkout and pulls the official application by digest. It checks the image's labels, platform and migration inventory, generates the secrets in `/etc/tome-cms/tome-cms.env`, starts the pinned infrastructure, runs migrations, waits for the application to be ready, then starts and verifies the updater socket. `APP_PORT` is fixed at `4321` by the managed health contract. The installer prints the installation URL, a command for reading the token privately, the version and the backup directory, and never prints a secret. It stops if it finds existing environment files, service accounts, managed destinations, or `tomecms` containers or data volumes. On a stable `1.0.0` or later tag, `scripts/deploy-vps.sh` hands over to this same installer.

Local macOS and Windows setups, `npm run bootstrap:core`, source builds and `compose.yaml` stay check-only: they may discover releases but cannot install one from the admin. Installing from the web is a capability confirmed through the managed updater's socket, and setting an environment variable does not provide it. Bundled and headless modes use the same managed image.

The Astro container receives only `/run/tome-cms` and the dedicated updater group. It never mounts `/var/run/docker.sock`, because Docker access is control of the host. The separate `tomecms-updater` systemd service belongs to the Docker group and accepts a narrow protocol on a Unix socket; it has no inbound TCP listener. The infrastructure images stay `postgres:17-alpine` and `chrislusf/seaweedfs:4.46`, with the stable volumes `tomecms_postgres-data` and `tomecms_seaweedfs-data`. A routine web update replaces only the application image. Changing an infrastructure tag needs a separately reviewed manual release.

| Location | Contents and access |
| --- | --- |
| `/opt/tome-cms/` | Root-owned managed Compose files, configuration and the compiled updater; the service cannot write these files |
| `/etc/tome-cms/tome-cms.env` | Secrets, `root:tomecms-updater`, `0640`; back it up privately |
| `/etc/tome-cms/updater.json` | Root-owned fixed updater configuration, `0644` |
| `/var/lib/tome-cms/updater/` | Installed identity, job history and the digest-only `image.env`; service files `0600` |
| `/var/backups/tome-cms/` | Complete PostgreSQL and S3 update backups, service-owned `0700`; copy them off the host yourself |
| `/run/tome-cms/` | Socket `0660` and sanitized status `0640`; the runtime directory survives service restarts |
| `/var/log/tome-cms/` | Service-owned directory; root-owned `install-<id>.json` failure diagnostics are `0600`, and the updater service logs to journald |

Look at the managed installation without changing it:

```sh
sudo systemctl status tomecms-updater
sudo curl --unix-socket /run/tome-cms/updater.sock http://localhost/v1/status
sudo journalctl -u tomecms-updater -n 100 --no-pager
sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env
```

The fixed unit starts `/usr/bin/node /opt/tome-cms/updater/updater/main.js /etc/tome-cms/updater.json`, with the configuration path as a positional argument. The host updater itself is upgraded by hand, not through the website.

The first update the admin can install is `1.0.0 → 1.0.1`. Rolling back the application image is automatic only when the target's manifest declares the previous version schema-compatible. Restoring the database and objects uses the retained complete backup and stays a reviewed manual operation, and so do updating the updater itself and the infrastructure. `1.0.0` has no automatic updates, no beta channel and no backup pruning. The full release checklist and recovery boundary are in [the 1.0.0 release notes](docs/releases/1.0.0.md).

## Recovering a managed installation, and moving from pre-1.0

A pre-`1.0.0` installation cannot move to a managed one in place, neither through the admin nor by running the fresh installer over existing data. Stop the writers, create and verify a complete PostgreSQL and object-storage backup with the [backup and restore check](#backups), and keep the existing secrets privately. Prepare a separate, fresh managed `1.0.0` host, validate a manual migration of the content and data against its schema, and switch DNS only after HTTPS, Passkeys, content and media all check out. Keep the old host and the backup until that migration is accepted: there is no database downgrade and no automatic restore from backup.

Once the managed configuration exists, a failed installation saves bounded command and exit diagnostics, with the captured output, to the private `/var/log/tome-cms/install-<id>.json` path printed in its recovery message. The file is `0600`. Generated passwords, tokens, secrets, keys and database URLs are redacted, including their URL, JSON and base64 encodings. At most four failures are kept, with 2 KiB of arguments and 4 KiB per output stream each, under 256 KiB in all. Captured output is saved before the explicit one-shot cleanup and is not printed to the terminal. Read that exact file privately with `sudo less /var/log/tome-cms/install-<id>.json`, replacing `<id>` with the printed identifier. If the diagnostics filesystem is unavailable, the installer says so, and it still cleans up a migration container that may be running.

If installation fails before migrations start, only newly created, empty temporary, configuration and runtime artifacts may be cleaned up. Generated credentials, any configuration with content, pulled images and Docker data are kept. Once migrations have started, all recovery state stays. Never delete the volumes, run `down --volumes`, or generate new secrets to try again. Diagnose privately first:

```sh
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env logs --tail 100
sudo journalctl -u tomecms-updater -n 100 --no-pager
```

When the missing prerequisite or the failed migration is fixed, recovery starts from the retained managed Compose configuration. Review the migration results before running the forward-only migrations again, then start and verify the application before enabling the updater:

```sh
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env run --rm --no-deps --pull never app npm run db:migrate
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env up -d --wait --no-deps --pull never app
curl --fail http://127.0.0.1:4321/health/ready
sudo systemctl daemon-reload
sudo systemctl enable --now tomecms-updater
sudo curl --unix-socket /run/tome-cms/updater.sock http://localhost/v1/status
```

These are an operator's recovery steps, not a retry that resets the installation. A later web-update job marked `failed_manual_recovery` has to be investigated with its preserved backup and journal; never delete job state just to bring the button back. Verifying real public attestations and pulls, a real systemd installation, and the `1.0.0 → 1.0.1` acceptance run on both architectures remain external release gates.

Neither installation nor update stores a GitHub token. The credential-free path relies on the three exact public release assets named above, whose downloaded attestation bundles are verified against the official release workflow, tag and source commit.

# Developing TomeCMS

## Stack

| Layer | Technology |
| --- | --- |
| Application | Astro SSR on Node.js 22 |
| Admin UI | React islands, Tiptap and Novel |
| Database | PostgreSQL 17 through Kysely |
| Authentication | Better Auth with Passkeys |
| Media | S3-compatible storage; local and self-hosted Compose use SeaweedFS 4.46 |
| Deployment | Docker Compose |

Migrations live in `src/server/db/migrations/` and are applied with `npm run db:migrate`.

`src/styles/installer-tokens.css` owns every colour, spacing, radius and type token. `DESIGN.md` describes them and follows that file, and `npm run check` fails when the two drift apart.

## Local setup on macOS

macOS is the primary development workflow. Install these before the first run:

- macOS with Docker Desktop running
- Node.js 22 or newer, and npm
- Git
- Free local ports `4321`, `5432` and `9000`

Check the main tools:

```sh
node --version
npm --version
docker version
docker compose version
```

From the project directory:

```sh
npm run dev:macos
```

The helper installs the locked packages when needed, creates a private `.env.local`, starts PostgreSQL and SeaweedFS, creates the media bucket, applies migrations, prints the installation token and starts Astro. You do not need a storage account or a license file.

Open [http://localhost:4321/install](http://localhost:4321/install). If you need the token again:

```sh
grep '^TOME_CMS_INSTALL_TOKEN=' .env.local
```

Keep the terminal open while you work. Stop Astro with `Ctrl+C`, and stop the local infrastructure separately:

```sh
npm run infra:down
```

If an existing `.env.local` needs newly generated fields, review it first, then merge safe defaults in while keeping its secrets:

```sh
npm run dev:macos -- --force
```

## Local setup on Windows

Windows is a secondary workflow. Use Windows 11 with Docker Desktop, Node.js 22 or newer, npm, Git and PowerShell. In PowerShell:

```powershell
npm run dev:windows
```

The helper follows the same bootstrap flow as on macOS, and the wizard and token work the same way; the token is stored in `.env.local` here too. macOS is the path that is currently validated.

## Infrastructure and Astro in separate terminals

```sh
npm run bootstrap:core
npm run dev
```

Other commands you will want:

```sh
npm run infra:up
npm run db:migrate
npm run media:cleanup
npm run infra:down
```

## Project layout

```text
src/components/admin/        Interactive admin islands
src/components/blog/         Head-level public components shared by every theme
src/themes/                  The public site's templates and CSS, one directory per theme
src/plugins/                 Plugin hooks and the plugins that fill them
src/pages/admin/             Admin route templates
src/pages/api/admin/         Same-origin authenticated mutations
src/pages/api/v1/content/    Anonymous published-content REST API
src/server/auth/             Better Auth, Passkeys, enrollment, recovery
src/server/content/          PostgreSQL content services
src/server/db/               Kysely schema, client and migrations
src/server/media/            S3 storage boundary and media services
src/server/plugins/          Plugin settings, and the sealing of the secrets among them
scripts/                     Bootstrap, maintenance and deployment helpers
tests/unit/                  Small deterministic contracts
tests/integration/           Disposable PostgreSQL and S3 service contracts
tests/operations/            Backup, reset and restore safety contracts
tests/e2e/                   Browser-level acceptance
```

## Writing a theme

```text
src/themes/contract.ts        what each template is given, and what a theme must export
src/themes/registry.ts        id -> dynamic import, so a reader loads only the chosen theme
src/themes/<id>/Shell.astro   everything inside <body>: header, main, footer
src/themes/<id>/Home.astro    the feed
src/themes/<id>/Post.astro    an article
src/themes/<id>/Page.astro    a page
src/themes/<id>/theme.css     the theme's own stylesheet, linked by the page that uses it
src/themes/<id>/theme.ts      id, name, and the sentence the Themes screen shows
```

A theme owns its templates and its CSS and nothing else. Routing, queries, `<head>` and its SEO, the fonts and the design tokens stay in core, so a theme can be plain but not wrong or slow. Each template declares `interface Props extends Theme…Props`, which holds a new theme to the shape the routes hand over: a template that drifts fails the build at the call site instead of in front of a reader.

To add one, copy a directory under `src/themes/`, register its id in `registry.ts`, and run `npm run check`. Run `npm run css:snapshot` before a change and `npm run css:diff` after it to see which selectors the build serves; that is how the split between `global.css` and a theme's own stylesheet is kept honest.

## Writing a plugin

A plugin fills hooks the core declares, from a closed set of three: `signIn` for the admin's sign-in (what to put in the form, and what to make of an attempt), `publicPage` for every page a reader sees, and `editorSuggestions` for suggestions while writing. There is no hook for running code at startup, for reaching the database, or for adding a route.

A manifest names the hooks it fills, and the core supplies the words the Plugins screen shows for them: the screen offering a plugin must not load it to find out what it does. `tests/unit/plugin-admin.test.ts` holds each plugin to what it declared, so a plugin that names a hook has to implement it.

Settings are stored per plugin. One marked `secret` is sealed at rest with `TOME_CMS_CONTEXT_SECRET` and never sent to a browser. A write that does not mention a setting keeps it, which is what lets the switch on each card turn a plugin on or off without restating its fields.

What a plugin's answer is allowed to do is decided in core, not by the plugin: see the Turnstile failure table under [Plugins](#plugins) and the rules under [Suggestions while writing](#suggestions-while-writing). A plugin's browser code has to sit behind a dynamic import that only a mount point on the page asks for, so a site with the plugin switched off downloads none of it.

## Tests and checks

Install the locked dependencies:

```sh
npm ci
```

Then run what the change needs:

```sh
npm run test:unit
npm run test:integration:foundation
npm run test:integration
npm run test:operations:update
npm run test:e2e
npm run check
npm run build
```

The foundation readiness check and the full integration runner start PostgreSQL and SeaweedFS under an explicitly named, disposable test project, and remove its volumes even after a failure. The full runner runs every integration test one at a time. A single database-only file passed after `npm run test:integration:foundation --` starts PostgreSQL alone.

Each end-to-end spec stands up the stack it needs, PostgreSQL, SeaweedFS and a dev server, under a Compose project of its own, and removes it afterwards. None of them touches the stack `npm run dev:macos` started.

The managed-update operation harness needs a running Docker Engine with Compose, the pinned PostgreSQL 17 and SeaweedFS 4.46 images (or permission to pull them), and a Go compiler for its dependency-free fixture server. It builds local `1.0.0` and `1.0.1` scratch images and starts a real application, PostgreSQL, SeaweedFS, network and volumes under one random `tomecms-test-*` Compose project. The real Unix updater server then performs Compose stop, run, up and ps, backup, migration, readiness, inspection, the image switch and rollback against that disposable stack. Only three things are substituted: the public GitHub downloads and attestation checks, the mapping from the immutable official digest to the local fixture image, and the target's migration-inventory probe. A `test.after()` registered up front removes the exact labelled test resources, and fails if any matching container, network, volume, image or temporary root is left. Guarded commands refuse the production `tomecms` project and the fixed production paths.

This local check is not a release-host acceptance. Real public GitHub and GHCR verification, systemd installation and socket permissions, the HTTPS wizard, Passkey, content and media flows, and disposable Ubuntu `linux/amd64` and `linux/arm64` update and rollback runs all remain mandatory external release gates.
