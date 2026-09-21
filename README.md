# TomeCMS

TomeCMS is a lightweight, bilingual CMS built with Astro. It ships a server-rendered Blog and a React-based Admin editor, while exposing the same Published content through a versioned Headless REST API.

> **Development status:** the package is `0.3.0`. The managed `1.0.0` updater foundation and disposable operation harness are implemented, but no production `v1.0.0` release exists. The dependency-security gate is partly closed: the production audit now reports no critical and no high advisories, and the moderate ones that remain are all `@tiptap/core`, blocked behind the editor's own dependency. The full integration, browser and operations gates now run green against Astro 7. Public immutable release/attestation verification and real `amd64`/`arm64` HTTPS VPS acceptance are still open, because both need infrastructure this repository cannot stand up for itself. See the [0.3.0 notes](docs/releases/0.3.0.md), the [0.2.0 notes](docs/releases/0.2.0.md), and the [planned 1.0.0 boundary](docs/releases/1.0.0.md).

## What is included

- Six-step first-run Wizard with a configurable Admin URL
- Passkey-only owner authentication and one-time recovery codes
- Posts in Thai and English, shared Categories, drafts, previews, and SEO fields
- Pages and configurable Header/Footer Navigation
- File Manager backed by S3-compatible object storage
- Server-rendered public pages with no application JavaScript
- Published-only REST API, OpenAPI 3.1 document, sitemap, and RSS feed
- Themes: the public site is one of several, chosen under Appearance
- Plugins: extras that fill hooks the core declares, switched on in the Admin
- Optional Headless mode that keeps Admin and APIs while hiding the bundled Blog

## Runtime architecture

| Layer | Technology |
| --- | --- |
| Application | Astro SSR with Node.js 22 |
| Admin UI | React islands and Tiptap/Novel |
| Database | PostgreSQL 17 through Kysely |
| Authentication | Better Auth with Passkeys |
| Media | S3-compatible storage; local/self-hosted Compose uses SeaweedFS 4.46 |
| Deployment | Docker Compose |

Database migrations live in `src/server/db/migrations/` and are applied with `npm run db:migrate`.
An installation created before 0.3.0 has six migrations waiting for it; see the [0.3.0 notes](docs/releases/0.3.0.md#upgrading).
The bundled SeaweedFS service is a single-node default for local development and a single VPS. Point the same S3 settings at external object storage when high availability or multi-node operations are required.

## Prerequisites

### macOS — primary local workflow

Install these before the first run:

- macOS with Docker Desktop running
- Node.js 22 or newer and npm
- Git
- Free local ports `4321`, `5432`, and `9000`

Check the main tools:

```sh
node --version
npm --version
docker version
docker compose version
```

### Windows — secondary local workflow

Use Windows 11 with Docker Desktop, Node.js 22+, npm, Git, and PowerShell. The Windows helper follows the same bootstrap flow, but macOS is the currently validated development path.

## First local installation on macOS

From the project directory:

```sh
npm run dev:macos
```

The helper installs locked packages when needed, creates a private `.env.local`, starts PostgreSQL and SeaweedFS, creates the media bucket, applies migrations, prints the installation token, and starts Astro. No storage account or license file is required.

Open [http://localhost:4321/install](http://localhost:4321/install). If you need the token again:

```sh
grep '^TOME_CMS_INSTALL_TOKEN=' .env.local
```

Keep the terminal open while developing. Stop Astro with `Ctrl+C`; stop local infrastructure separately with:

```sh
npm run infra:down
```

If an existing `.env.local` needs newly generated fields, review it first and then merge safe defaults while preserving secrets:

```sh
npm run dev:macos -- --force
```

## First local installation on Windows

In PowerShell:

```powershell
npm run dev:windows
```

The Wizard and installation-token flow are identical to macOS. The token is also stored in `.env.local`.

## Manual local workflow

Use this when you want infrastructure and Astro in separate terminals:

```sh
npm run bootstrap:core
npm run dev
```

Useful commands:

```sh
npm run infra:up
npm run db:migrate
npm run media:cleanup
npm run infra:down
```

## Environment contract

`.env.example` documents every active setting. Important values are:

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

Never commit `.env.local`, credentials, database dumps, or object-storage backups. The bootstrap writes `.env.local` with owner-only permissions on macOS/Linux.

## Themes

The public site is a theme. **Appearance → Themes** names which one draws it; `paper` is the
one TomeCMS ships with, and `plain` is a deliberately spare second that exists so the contract
has more than one reader.

The screen shows a card per theme, and each card shows that theme drawing this installation's
own posts in a frame -- `/admin/themes/preview/<id>`, the homepage route with the theme taken
from the URL instead of the settings, behind the owner's session and never indexed. Nothing is
committed beside a theme to stand in for it, because a picture of a theme is a thing that can
come to disagree with the theme. Choosing one applies it; there is no save button.

```text
src/themes/contract.ts        what each template is given, and what a theme must export
src/themes/registry.ts        id -> dynamic import, so a reader loads only the chosen theme
src/themes/<id>/Shell.astro   everything inside <body>: header, main, footer
src/themes/<id>/Home.astro    the feed
src/themes/<id>/Post.astro    an article
src/themes/<id>/Page.astro    a Page
src/themes/<id>/theme.css     the theme's own stylesheet, linked by the page that uses it
src/themes/<id>/theme.ts      id, name, and the sentence the Themes screen shows
```

A theme owns the templates and the CSS and nothing else. Routing, queries, `<head>` and its
SEO, the fonts and the design tokens stay in core, so a theme can be plain but not wrong or
slow. Each template declares `interface Props extends Theme…Props`, which is what holds a
new theme to the shape the routes hand over: a template that drifts fails the build at the
call site rather than at a reader's.

To add one, copy a directory under `src/themes/`, register its id in `registry.ts`, and run
`npm run check`. `npm run css:snapshot` before a change and `npm run css:diff` after reports
which selectors the build serves, which is how the split between `global.css` and a theme's
own stylesheet is kept honest.

Settings calls the light/dark choice **Appearance**, and **Theme** means the one above.

## Plugins

A plugin fills hooks the core declares. There are two, both about the Admin sign-in: what to
put in the form, and what to make of an attempt. There is no hook for running code at
startup, for reaching the database, or for adding a route.

Plugins ship in the repository and are switched on and configured under **Appearance → Plugins** in the
Admin. Settings are stored per plugin; a setting the manifest marks `secret` is encrypted at
rest with `TOME_CMS_CONTEXT_SECRET` and never sent to a browser — the screen is told only
whether one is set, and a blank field on save keeps what is stored rather than erasing it.
A setting a write does not mention is kept too, which is what lets the switch on each row
switch a plugin without restating its fields.

The screen is a card per plugin. Where a plugin directory fills the band under a card with
ratings and install counts, this has none to report — plugins ship with the release — so the
band says the thing a directory could not: which of the core's hooks the plugin fills. A
manifest names a hook from a closed set the core owns, and `tests/unit/plugin-admin.test.ts`
holds it to that: a plugin that names a hook has to implement it. Its icon is one of the
admin's own, so nothing a plugin ships is drawn.

The switch on a card applies on the spot and says in a word which way it is thrown. A plugin
that is not set up cannot be switched on there, which is the refusal the server already
makes. The fields are two inputs behind **Set up**, in the panel the editors already use.

The first plugin is **Cloudflare Turnstile**. Give it the site key and secret key from your
Cloudflare dashboard and switch it on; a challenge then appears on the sign-in form and every
attempt is verified before it reaches the Passkey ceremony.

What a failed verification means is decided in core, not by the plugin:

| What happened | What follows |
| --- | --- |
| The token is invalid, missing or already spent | The attempt is refused |
| The secret key is wrong, the request is malformed, Cloudflare answers 5xx, cannot be reached, or times out | The attempt proceeds, and the reason is logged |

The second row is the important one: mistyping a secret key cannot lock you out of your own
site. Neither can the plugin close the way back in — the guard runs on the sign-in attempt
and never on registration, so recovery works with the plugin on, misconfigured, or both.

If the challenge itself will not load in your browser, switch the plugin off from a shell:

```sh
npm run plugin:disable turnstile
npm run plugin:disable turnstile -- --forget
```

The first switches it off and keeps its settings. `--forget` clears them as well, which the
Admin deliberately cannot do.

Two more plugins reach the public site rather than the sign-in form.

**Sticky Banner** puts a band across the top of every public page, with a sentence you
write in each language, in the background and text colours you choose (black and white until
you do). Whether a reader can close it is yours to decide: closable, it slides away and what is
remembered is the message rather than the plugin, so a new message is shown again to somebody
who closed the last one; kept up, it has no close control and the page carries no script for
it at all. The
link field takes a path on this site or an `https` address; anything else — `javascript:`
first among them — is dropped, and the message is shown without a link.

**Image lightbox** opens an article's images full size without leaving the page. It is asked
for only where there are images to open: a homepage of cards never fetches its code.

A plugin that is switched off ships nothing at all. Each one's browser code is a chunk behind
a dynamic import that only a mount point on the page asks for, so a reader of a site with
both switched off downloads neither.

## Suggested categories

The post settings drawer can read what you have written and say which of your own
categories it belongs under. It is off unless you give the installation a key:

```dotenv
TYPESAFE_API_KEY=your-key
```

Without one the button is not drawn at all. With one, the drawer asks a yes-or-no question
per category -- your categories, under the names they have now -- and offers the likely ones
as chips. Nothing is filed for you: a suggestion is a button you press, which is what makes a
wrong guess cost a glance rather than a correction. The article's text is sent to
`api.typesafe.ai` when you press the button, and at no other time.

## Bundled and Headless modes

The default is:

```dotenv
TOME_CMS_FRONTEND_MODE=bundled
```

Set `TOME_CMS_FRONTEND_MODE=headless` and restart TomeCMS to return `404` for the bundled homepage, localized Posts/Pages, sitemap, and RSS. Admin, authentication, installation, recovery, health, media, draft previews, and `/api/v1/content/*` remain available. In Headless mode, `robots.txt` remains available and disallows crawling the origin.

## Headless Content API

The anonymous API is read-only and returns Published content only:

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

List routes support signed cursor pagination. Public responses include cache validators and wildcard CORS; draft preview responses are token-scoped, private, and never enable wildcard CORS.

Bundled-mode discovery endpoints:

```text
GET /sitemap.xml
GET /rss.xml
GET /robots.txt
```

## Admin and recovery

The Wizard asks for the Admin path, for example `/studio`. Bookmark that URL because the public Header and Footer do not expose an Admin link.

Use a spare Passkey or a one-time recovery code from `/recovery`. If neither is to hand, the
owner-recovery command issues a single-use recovery link from the server itself:

```sh
npm run admin:recover
npm run admin:recover -- --execute
```

The first form reports the site and owner it found and changes nothing. The second prints a
link that expires in ten minutes and is spent the moment a replacement Passkey is registered;
any saved recovery codes are left alone. It reads `.env.local`, or `/etc/tome-cms/tome-cms.env`
on a managed VPS, or whatever `TOME_CMS_ENV_FILE` points at.

Register the replacement Passkey in an ordinary browser window. A Passkey created in a
private or incognito window may not survive it, which leaves a credential recorded here that
no browser can offer.

If a sign-in plugin is what stands in the way, switch it off from the same shell — see
[Plugins](#plugins).

To return an installation to the Wizard, stop Astro/the production application and preview the exact scope first:

```sh
npm run admin:reset-installation
npm run admin:reset-installation -- --execute
```

The execute form requires an interactive terminal and the exact phrase shown in its preview. It refuses recent upload signatures or untracked bucket objects, deletes TomeCMS application/auth data and known media objects, then verifies that the site setting and object inventory are empty. The database schema, Kysely migration history, `.env.local`, and installation token remain, so restarting TomeCMS opens `/install` for a clean installation.

## Backup and restore verification

A database-only backup is incomplete because Post and Page media lives in object storage. Stop every writer first: stop host-run Astro with `Ctrl+C`, or stop the production application container:

```sh
docker compose -f compose.yaml --env-file .env.local stop app
```

Then create one recovery point outside the repository:

```sh
npm run backup -- --offline --output-root /absolute/path/outside/the/repository/tomecms-backups
```

`--offline` confirms that no host-run TomeCMS process is writing. The command also refuses a running Compose application. Each timestamped directory contains a custom-format PostgreSQL dump, the S3 object mirror, and a checksum manifest with configuration identifiers but no credentials. A failed or interrupted backup has no final manifest and must not be restored.

Verify a backup by restoring it into a uniquely named disposable Compose project:

```sh
npm run restore:check -- \
  --backup /absolute/path/to/tomecms-backups/tomecms-20260913T120000000Z \
  --project tomecms-restore-check-20260913
```

The check validates checksums, restores PostgreSQL and every object, compares record/object inventories, and always removes the disposable containers and volumes. It never targets the normal `tomecms` project. Keep local ports `55432` and `59000` free while it runs.

## VPS deployment preview

This branch uses Docker Compose for PostgreSQL, SeaweedFS, and the application. The helper requires a Linux VPS with Node.js 22+, Docker Engine with Compose, and Git. Before deploying, configure public DNS and TLS reverse proxies for both the CMS origin and the S3 endpoint. The script does not edit firewall rules or obtain certificates.

Example from a clean checkout:

```sh
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
./scripts/deploy-vps.sh
```

The generated `.env.local` remains local to that checkout with owner-only permissions. Deployment pulls the pinned infrastructure images, builds the application image, runs migrations in a one-shot application container, starts the production profile, and waits for `/health/ready`. Back up PostgreSQL and the object bucket together before every upgrade. Real-host HTTPS acceptance remains a release gate.

## Managed VPS installation from 1.0.0

The current package is still pre-`1.0.0`. The following flow is available only after the official repository and GHCR image are public and a matching, published, immutable stable release exists. The release must contain `update-manifest.json`, `update-manifest.attestation.json`, and `tomecms-image.attestation.json`, each at its exact official tag URL with a GitHub SHA-256 asset digest. The installer verifies the two downloaded bundles against the official release workflow, source tag and commit, and rejects attestations from self-hosted runners. It does not use GitHub's default attestation API lookup. Publishing a tag alone does not meet these prerequisites.

Use a fresh Linux VPS (`amd64` or `arm64`) with systemd 235+, Node.js 22+ at `/usr/bin/node`, npm, Git, Docker Engine with the Compose plugin and `docker` group, GitHub CLI (`gh attestation verify` supporting `--bundle`, `--signer-workflow`, `--source-ref`, `--source-digest`, and `--deny-self-hosted-runners`), and curl. Configure public HTTPS origins for the CMS and S3 service first. No permanent GitHub token is installed. The installer requires root for the fixed directories and service account; it does not install Docker, configure DNS/TLS, or change a firewall.

After `v1.0.0` is released, use a clean checkout of that exact official tag, then:

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

The dry-run verifies public release metadata, the byte-exact digest of all three release assets, both attestations, checkout/tag/package identity, platform, prerequisites and fresh destinations; it prints one JSON plan. Downloads are bounded to 512 KiB each. It creates a private temporary directory containing the three inputs at `0600` and separate `0700` GitHub configuration/cache directories, then removes that directory. GitHub credentials and host overrides are excluded from verification. It does not build, pull, create an account, install files, or start services. Tests use copied source/release fixtures and `--root-prefix` with a complete set of executable stubs inside that prefix; this is a test boundary, not a real VPS deployment option.

Installation builds the host updater from the matching checkout, pulls the official application by digest, checks its image labels/platform and migration inventory, generates secrets in `/etc/tome-cms/tome-cms.env`, starts the pinned infrastructure, runs migrations, waits for app readiness, and starts/verifies the updater socket. `APP_PORT` is fixed at `4321` by the managed health contract. The installer prints the installation URL, a command to retrieve the token privately, version, and backup directory; it never prints secret values. Existing environment files, service accounts, managed destinations or `tomecms` containers/data volumes cause it to stop. On a stable `1.0.0+` tag, `scripts/deploy-vps.sh` delegates to this same installer.

Local macOS/Windows, `npm run bootstrap:core`, source builds and `compose.yaml` remain `check-only`; they may discover releases but cannot install from Admin. Web installation is a capability confirmed through the managed updater socket. Setting an environment variable alone does not provision that capability. Both bundled and Headless modes use the same managed image.

The Astro container receives only `/run/tome-cms` and the dedicated updater group. It never mounts `/var/run/docker.sock`: Docker access grants host control. The separate `tomecms-updater` systemd service has Docker group membership and accepts a narrow Unix-socket protocol; it has no inbound TCP listener. Infrastructure images remain `postgres:17-alpine` and `chrislusf/seaweedfs:4.46`, with stable volumes `tomecms_postgres-data` and `tomecms_seaweedfs-data`. Routine web updates replace only the application image. Infrastructure tag changes require a separately reviewed manual release.

| Location | Contents and access |
| --- | --- |
| `/opt/tome-cms/` | Root-owned managed Compose/config and compiled updater; service cannot write these files |
| `/etc/tome-cms/tome-cms.env` | Secrets, `root:tomecms-updater`, `0640`; back up privately |
| `/etc/tome-cms/updater.json` | Root-owned fixed updater configuration, `0644` |
| `/var/lib/tome-cms/updater/` | Installed identity, job history and digest-only `image.env`; service files `0600` |
| `/var/backups/tome-cms/` | Complete PostgreSQL + S3 update backups, service-owned `0700`; copy off-host separately |
| `/run/tome-cms/` | Socket `0660` and sanitized status `0640`; runtime directory preserved across service restarts |
| `/var/log/tome-cms/` | Service-owned directory; root-owned `install-<id>.json` failure diagnostics are `0600`; updater service diagnostics are in journald |

Inspect the managed installation without changing it:

```sh
sudo systemctl status tomecms-updater
sudo curl --unix-socket /run/tome-cms/updater.sock http://localhost/v1/status
sudo journalctl -u tomecms-updater -n 100 --no-pager
sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env
```

The fixed unit starts `/usr/bin/node /opt/tome-cms/updater/updater/main.js /etc/tome-cms/updater.json`; the config path is a positional argument. The host updater itself is upgraded manually, not through the website.

## Managed installation recovery and pre-1.0 transition

A pre-`1.0.0` installation cannot transition in place through Admin or by rerunning this fresh installer over existing data. Stop writers, create and verify a complete PostgreSQL + object-storage backup using the existing backup/restore-check procedure, and retain the existing secrets privately. Prepare a separate fresh managed `1.0.0` host, validate a manual content/data migration against its schema, and switch DNS only after HTTPS, Passkeys, content and media checks pass. Keep the old host and backup until that migration is accepted; database downgrade and automatic backup restore are not provided.

After managed configuration exists, an installer failure saves bounded command/exit diagnostics and captured output to the exact private `/var/log/tome-cms/install-<id>.json` path printed in its recovery message. The file is `0600`; generated passwords, tokens, secrets, keys and database URLs are redacted, including URL, JSON and base64 encodings. At most four failures are retained, with 2 KiB of arguments and 4 KiB per output stream per failure (under 256 KiB total). Captured failure output is persisted before explicit one-shot cleanup and is not printed to the terminal. Inspect that exact file privately with `sudo less /var/log/tome-cms/install-<id>.json`; replace `<id>` with the printed identifier. An unavailable diagnostics filesystem is reported explicitly and never prevents cleanup of a possibly running migration container.

If installation fails before migrations, only newly created empty temporary/config/runtime artifacts are eligible for cleanup. Generated credentials, any non-empty configuration, pulled images and Docker data are retained. After migrations start, all recovery state remains. Never delete the volumes, run `down --volumes`, or regenerate secrets to retry. Diagnose privately first:

```sh
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env logs --tail 100
sudo journalctl -u tomecms-updater -n 100 --no-pager
```

After correcting the specific prerequisite or migration failure, the manual recovery entry point is the retained managed Compose configuration. Review migration results before rerunning the forward-only migrations, then start and verify the app before enabling the updater:

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

These are operator recovery steps, not a retry that resets the installation. A failed later web-update job marked `failed_manual_recovery` must be investigated with its preserved backup and journal; never delete job state simply to re-enable the button. Real public attestation/pull verification, a real systemd install and the `1.0.0 → 1.0.1` acceptance run on both architectures remain external release gates.

The first supported Admin-installed update is `1.0.0 → 1.0.1`; pre-`1.0.0` needs the manual transition above. App-image rollback is automatic only when the target manifest declares the previous version schema-compatible. Database/object restore uses the retained complete backup and remains a reviewed manual operation. Updater self-update and infrastructure updates are also manual. `1.0.0` does not include automatic updates, a beta channel, or backup pruning. The full release checklist and recovery boundary are in [the 1.0.0 release notes](docs/releases/1.0.0.md).

The credential-free release path requires the three exact public assets documented above. Their downloaded attestation bundles are verified against the official release workflow, tag, and source commit; neither installation nor update stores a GitHub token.

## Development checks

Install locked dependencies:

```sh
npm ci
```

Run focused checks as needed:

```sh
npm run test:unit
npm run test:integration:foundation
npm run test:integration
npm run test:operations:update
npm run test:e2e
npm run check
npm run build
```

The foundation readiness check and full integration runner start PostgreSQL plus SeaweedFS under the explicitly named disposable test project and remove its volumes even after failure; the full runner executes every integration test serially. A targeted database-only file passed after `npm run test:integration:foundation -- ...` starts PostgreSQL only.

The managed-update operation harness requires a running Docker Engine with Compose, the pinned PostgreSQL 17 and SeaweedFS 4.46 images (or pull access for them), and a Go compiler for its dependency-free fixture server. It builds local `1.0.0`/`1.0.1` scratch images and starts real app, PostgreSQL, SeaweedFS, network, and volumes under one random `tomecms-test-*` Compose project. The real Unix updater server then performs Compose stop/run/up/ps, backup, migration, readiness, inspection, image switch, and rollback against that disposable stack. Only public GitHub downloads/attestation execution, mapping the immutable official digest to the local fixture image, and the target migration-inventory probe are substituted. A pre-registered `test.after()` removes the exact labelled test resources and fails if any matching container, network, volume, image, or temporary root remains; guarded commands reject the production `tomecms` project and fixed production paths.

This local operation check is not a release-host acceptance. Genuine public GitHub/GHCR verification, systemd installation and socket permissions, HTTPS Wizard/Passkey/content/media flows, and disposable Ubuntu `linux/amd64` plus `linux/arm64` update/rollback runs remain mandatory external release gates.

## Project layout

```text
src/components/admin/        Interactive Admin islands
src/components/blog/         Head-level public components shared by every theme
src/themes/                  The public site's templates and CSS, one directory per theme
src/plugins/                 Plugin hooks and the plugins that fill them
src/pages/admin/             Internal Admin route templates
src/pages/api/admin/         Same-origin authenticated mutations
src/pages/api/v1/content/    Anonymous Published-content REST API
src/server/auth/             Better Auth, Passkeys, enrollment, recovery
src/server/content/          PostgreSQL content services
src/server/db/               Kysely schema, client, and migrations
src/server/media/            S3 storage boundary and media services
src/server/plugins/          Plugin settings, and sealing for the secrets among them
scripts/                     Bootstrap, maintenance, and deployment helpers
tests/unit/                  Small deterministic contracts
tests/integration/           Disposable PostgreSQL/S3 service contracts
tests/operations/            Backup/reset/restore safety contracts
tests/e2e/                   Browser-level installation acceptance
```
