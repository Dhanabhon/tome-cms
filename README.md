# TomeCMS

TomeCMS is a small Astro CMS for blog posts and standalone Pages with a private React editor. Public Pages, articles, Header, and Footer render on the server and send no application JavaScript. Better Auth protects the Admin, PostgreSQL stores content and media metadata, and an S3-compatible bucket stores image bytes.

> **Migration status:** this branch is not a release. The File Manager now uses PostgreSQL and S3-compatible storage, but the versioned Headless Content API and final legacy Supabase removal are still in progress. Do not deploy it as TomeCMS 0.2.0 yet.

## What is included

- Server-rendered homepage and article pages
- Draft and published post workflows
- Standalone Pages and independently ordered Header (MenuBar) and Footer navigation
- Novel editor with formatting, slash commands, and image uploads
- Debounced draft saving
- Admin shell routes for Posts, Pages, Navigation, File Manager, Profile, and Settings; focused Post and Page editors are outside that shell
- Manual Thai (TH) and English (EN) editions with independent draft, publish, and unpublish states
- Localized public routes at `/<locale>`, `/<locale>/blog/<slug>`, and `/<locale>/<slug>`, with legacy blog routes redirected to their localized equivalents
- Owner-only Preview that saves and opens the newest draft
- Profile details reused by the global post author block
- Better Auth Passkeys and owner-scoped PostgreSQL services
- S3-compatible File Manager with folders, search, upload progress, stable media URLs, and reference-safe deletion
- A secure first-run installer for site settings and the owner account
- SEO, GEO, and AEO foundations with canonical URLs, social metadata, structured data, and automatic discovery files
- Sanitized HTML output for public articles
- A deployment script for Ubuntu and Debian VPS hosts

## Prerequisites

Before using either local setup helper, prepare:

- A local copy of this repository. Open your terminal in the `tome-cms` directory containing `package.json`.
- [Node.js](https://nodejs.org/en/download) and npm. Choose a supported LTS release; TomeCMS requires Node.js 22 or newer.
- Docker Desktop installed and running. Follow the operating-system instructions below.
- An internet connection for downloading dependencies and Docker images on the first run.
- Available ports: `4321` for TomeCMS, `5432` for PostgreSQL, `9000` for the S3 API, and `9001` for the storage console. If a port is occupied, use the bootstrap overrides described below.

The core bootstrap creates the PostgreSQL and licensed AIStor containers, persistent volumes, media bucket, and exact bucket CORS policy. TomeCMS runs on your computer through Node.js in local development.

## Development architecture

The active application uses Better Auth and PostgreSQL/Kysely for installation, owner sessions, site settings, Posts, Pages, Categories, Navigation, File Manager metadata, bundled public reads, and the sitemap. Image bytes use the single configured S3-compatible endpoint. Browser uploads receive only a short-lived signed URL for one generated object key; S3 credentials remain server-only.

Use Node.js 22 or newer and Docker Desktop with Compose v2. The default local ports are `4321` (TomeCMS), `5432` (PostgreSQL), `9000` (AIStor S3 API), and `9001` (AIStor console). Keep these services bound to loopback. When a port is occupied, supply `APP_PORT`, `POSTGRES_PORT`, `MINIO_PORT`, or `MINIO_CONSOLE_PORT` to bootstrap, for example `POSTGRES_PORT=55433 node scripts/bootstrap-core.mjs --force`; this refreshes dependent generated URLs while preserving secrets. Hand-editing only a port in `.env.local` also requires updating its dependent URL (`DATABASE_URL`, `TOME_CMS_PUBLIC_URL`, or `S3_ENDPOINT` and `MEDIA_PUBLIC_URL`). Explicit custom URLs are preserved.

`TOME_CMS_PUBLIC_URL` is the Passkey relying-party and origin boundary. Development HTTP is allowed only at the exact `localhost` hostname, for example `http://localhost:4321`; IP loopback origins such as `http://127.0.0.1` and `http://[::1]` are rejected. Changing the scheme, hostname, or port after registering credentials can make existing Passkeys unusable and lock out the owner.

`.env.local` is the local runtime and Compose environment file. The bootstrap can create it with permissions `0600`; keep real secrets out of Git. The `MINIO_LICENSE_FILE` value must be an absolute path to a readable, non-empty AIStor Free license file stored outside this repository. Obtain an AIStor Free license from MinIO, save the downloaded file outside the checkout, and pass its path to the first bootstrap command; the repository does not contain or provide a license.

After installing dependencies and saving the external license outside the checkout, initialize a first checkout by setting the path in the current shell and then running:

```sh
export MINIO_LICENSE_FILE=/absolute/path/outside-this-repository/aistor-free.license
node scripts/bootstrap-core.mjs
npm run db:migrate
```

If `.env.local` already exists and only its license path needs correction, preserve its other values with `MINIO_LICENSE_FILE=/absolute/path/to/aistor-free.license node scripts/bootstrap-core.mjs --force`; `--force` merges the supplied value and does not rotate existing secrets.

The bootstrap validates Node, Docker, Compose, ports, environment ownership, and the external license before starting PostgreSQL and licensed AIStor. It writes no license into the repository. Bucket setup allows anonymous image reads and permits browser `PUT`, `HEAD`, and `GET` only from the exact `TOME_CMS_PUBLIC_URL` origin. `npm run test:integration:foundation` starts only disposable PostgreSQL unless a storage-specific test explicitly starts AIStor; it does not prove a real licensed AIStor runtime by itself.

Production bootstrap (`--production`) requires public HTTPS application and storage URLs and uses the bundled Compose PostgreSQL database. Its host-side `DATABASE_URL` must match the generated URL for `POSTGRES_PASSWORD` and `POSTGRES_PORT`; the application uses `postgres:5432` inside Compose to reach that same database. Custom database targets are supported only for local development in this foundation release.

Transitional Supabase files and production-preflight compatibility remain until the final cutover task deletes them. The current File Manager, owner authentication, content, settings, Navigation, and public rendering no longer use Supabase at runtime.

The application exposes `GET /health/live` for a process liveness response and `GET /health/ready` for dependency readiness. Readiness returns HTTP `200` only when the foundation is ready, otherwise `503`; neither route exposes topology, credentials, or other secrets.

## Run it locally

For the migration branch, initialize PostgreSQL and AIStor with `node scripts/bootstrap-core.mjs`, apply `npm run db:migrate`, then use `npm run dev`. The older `dev:macos` and `dev:windows` helpers still describe the legacy all-Supabase runtime and are not a validation path for this branch; they will be replaced during the final operations cutover.

### Legacy Supabase helper reference

The operating-system helpers below are retained for the 0.1.x runtime and legacy File Manager debugging. They start Supabase, not the new PostgreSQL/AIStor stack, and do not boot this migration branch by themselves.

#### macOS

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/), choosing the download for your Mac's Apple silicon or Intel chip.
2. Open Docker from Applications, complete its first-launch setup, and wait until the Docker engine is running. Keep Docker Desktop open while using TomeCMS.
3. Open Terminal in the project directory and check the prerequisites:

   ```sh
   node --version
   npm --version
   supabase --version
   docker info
   ```

The first three commands should print version numbers. `docker info` should include server details without a connection error. If a command is missing, install that tool and reopen Terminal. If Docker cannot connect, wait for Docker Desktop to finish starting.

Once those checks pass, run:

```sh
npm run dev:macos
```

#### Windows

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) with WSL 2 enabled and use Linux containers.
2. Start Docker Desktop, complete its first-launch setup, and wait until the Docker engine is running.
3. Install Node.js, npm, and the Supabase CLI on Windows so they are available in PowerShell. Open PowerShell in the project directory and check:

   ```powershell
   node --version
   npm.cmd --version
   supabase --version
   docker info
   ```

Each check should succeed before continuing. Reopen PowerShell after installing a missing tool. Then run:

```powershell
npm run dev:windows
```

When the setup is ready, the terminal prints:

- Installer: `http://localhost:4321/install`
- Supabase Studio: `http://127.0.0.1:54323`
- The installation token to paste into the final step of the wizard

Keep that terminal open while developing. Press `Ctrl+C` to stop TomeCMS. The local Supabase services keep running, so later starts are faster. Stop them when you are finished:

```sh
supabase stop
```

Your local database is kept between runs. Only use the following command when you deliberately want to erase all local data and rebuild it from the migrations:

```sh
supabase db reset
```

The helper will not overwrite an `.env.local` file that it did not create. If you already manage that file yourself, move it aside or use the manual setup below.

The local Supabase credentials are for development only. Do not expose ports `54321` through `54324` to a public network.

### Connect Supabase Cloud or Self-hosted

TomeCMS uses the same Auth, Data API, and Storage client for both deployments. Supabase Cloud is the recommended option for most sites because Supabase operates the platform, managed updates, and plan-dependent backup features. Choose Self-hosted only when you are prepared to operate its Docker stack, HTTPS, Postgres, Storage, monitoring, backups, and upgrades.

On macOS or Linux, run the bootstrap helper before opening the web installer:

```sh
npm run configure:supabase
```

Choose `1` for Supabase Cloud or `2` for an existing Self-hosted Supabase deployment. The helper accepts either the current publishable/secret keys or legacy anon/service-role keys, verifies Auth and the Data API without printing the secret, and atomically updates `.env.local` without discarding unrelated settings. For non-interactive use:

```sh
PUBLIC_SUPABASE_URL=https://supabase.example.com \
PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key \
SUPABASE_SECRET_KEY=your-secret-key \
TOMECMS_CONFIGURE_CONFIRM=yes \
npm run configure:supabase -- self-hosted
```

The Self-hosted option connects TomeCMS to an existing production deployment; it deliberately does not install or upgrade the Supabase stack. Follow the [official Docker guide](https://supabase.com/docs/guides/self-hosting/docker), use a valid HTTPS endpoint, and maintain database and Storage backups separately. The local stack created by `npm run dev:macos` or `npm run dev:windows` remains development-only.

On Windows, create `.env.local` from `.env.example` and fill in the same values manually. The native Windows development helper continues to configure the local Docker stack automatically.

1. Install the locked dependency set:

   ```sh
   npm ci
   ```

2. If you did not use the bootstrap helper, create the local environment file:

   ```sh
   cp .env.example .env.local
   chmod 600 .env.local
   ```

3. Add your deployment mode, Supabase credentials, and installation token to `.env.local`:

   ```dotenv
   TOME_CMS_SUPABASE_MODE=cloud
   PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
   SUPABASE_SECRET_KEY=your-secret-or-service-role-key
   TOME_CMS_INSTALL_TOKEN=use-a-random-value-with-at-least-24-characters
   ```

4. Run the SQL files in `supabase/migrations/` in filename order. They create Posts, Pages, Navigation, access policies, media tables and bucket, and the single-row site settings table used to lock the installer. The wizard requires all of these tables to be queryable before installation.

5. Start Astro:

   ```sh
   npm run dev
   ```

6. Open `http://localhost:4321/install`. The wizard checks the database and storage, saves the site settings, creates the first owner account, and signs it in. The completion screen shows the full `/admin` URL so you can copy or bookmark it; later visits to `/install` redirect to `/admin`.

`SUPABASE_SECRET_KEY` and `TOME_CMS_INSTALL_TOKEN` are server-only. Never expose either value through a variable prefixed with `PUBLIC_`. Existing `PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` configurations remain supported.

Set `TOME_CMS_SUPABASE_MODE=cloud` explicitly when Supabase Cloud is exposed through a custom domain; otherwise TomeCMS infers non-`supabase.co` endpoints as Self-hosted.

## Commands

```sh
npm run dev         # Start the development server
npm run dev:macos   # Start local Supabase and TomeCMS on macOS
npm run dev:windows # Start local Supabase and TomeCMS on Windows
npm run configure:supabase # Choose Supabase Cloud or an existing Self-hosted deployment
npm run build       # Build the production server
npm run preview     # Run the production build locally
npm run check       # Check Astro, TypeScript, and the helper scripts
npm run admin:reset-installation # Preview a reset to the Wizard Installer
npm run media:cleanup # Preview expired uploads and failed deletions
npm run admin:reset-password # Reset the installed owner password
npm run test:e2e:media # Run focused File Manager and public blog regressions
npm run test:e2e:publishing # Run focused multilingual publishing regressions
npm run test:e2e:pages # Run Pages, Navigation, public blog, and admin shell regressions
```

Run `npm run test:e2e:media` and `npm run test:e2e:publishing` after the local Supabase stack is ready. On macOS, start Docker Desktop and use `npm run dev:macos`; the helper applies pending local migrations automatically.

The legacy browser suites still contain Supabase fixtures and are not a release gate for this migration branch. They will be replaced by PostgreSQL/S3 fixtures during the final cutover. Install the locked dependencies with `npm ci` and the Playwright browsers with `npx playwright install chromium webkit` before running any focused suite:

```sh
npm run test:e2e:pages
```

Playwright starts Astro at `http://127.0.0.1:4322` (or reuses a running server there) and runs desktop Chromium and mobile WebKit projects. The database contracts run once on desktop. Local migrations can also be applied directly with `supabase migration up --local`; the macOS and Windows development helpers run that command automatically.

## Versioning

TomeCMS follows [Semantic Versioning](https://semver.org/). The `version` field in `package.json` is the single source of truth and is shown automatically in the Wizard Installer. `package-lock.json` must carry the same version.

Create a release with npm's standard version command:

```sh
npm version patch # bug fix: 0.1.0 -> 0.1.1
npm version minor # backward-compatible feature: 0.1.0 -> 0.2.0
npm version major # breaking change: 0.1.0 -> 1.0.0
git push --follow-tags
```

`npm version` updates both package files, runs the project checks and production build, then creates the version commit and `vX.Y.Z` Git tag. It requires a clean working tree.

## Search and answer visibility

Public pages are server-rendered with self-referencing canonical URLs, indexable robots metadata, Open Graph and X cards, and JSON-LD that describes the site or published article. `/sitemap.xml` contains both locale homepages (`/th` and `/en`) and each published locale edition, while `/robots.txt` advertises that sitemap and allows OAI-SearchBot to crawl public content.

For each article, write a specific title, add a concise meta description when the opening text is not a good summary, structure the body with descriptive headings, cite primary sources for factual claims, and keep published information current. TomeCMS falls back to the article text when the meta description is empty.

After deploying a public site, submit `/sitemap.xml` in Google Search Console and Bing Webmaster Tools. Search indexing, rich results, and AI citations remain decisions made by each search or answer engine.

## Recover Passkey access

Before relying on a primary device, register a spare Passkey in Admin Security and securely store the displayed recovery codes outside that device. If neither is available, inspect the configured local site and owner without changing anything:

```sh
npm run admin:recover
```

After verifying the target, explicitly start recovery:

```sh
npm run admin:recover -- --execute
```

Execution revokes active sessions and prints a one-time, ten-minute replacement-Passkey URL. Keep that URL, its context, recovery codes, installation tokens, and environment contents out of logs, tickets, and shared shell history.

## Reset the owner password

From the project directory, run:

```sh
npm run admin:reset-password
```

The command reads `.env.local`, `.env`, or `/etc/tome-cms/tome-cms.env`, identifies the installed owner from `site_settings`, and asks you to confirm the displayed Supabase URL and owner email. The new password is entered twice without being displayed and must contain 12–128 characters.

On a VPS where only root can read the environment file, run the same command with `sudo`:

```sh
sudo npm run admin:reset-password
```

For a custom environment file, set `TOMECMS_ENV_FILE` to its path before running the command.

## Reset TomeCMS to the Wizard Installer

This reset permanently deletes all TomeCMS content, File Manager metadata and folders, every known object in the configured S3 bucket, site settings, sessions, recovery data, and owner accounts. It keeps the PostgreSQL schema and Kysely migration history, S3 bucket, `.env.local`, and installation token.

Back up PostgreSQL and the S3 bucket first. Close every Admin tab and stop TomeCMS so an active editor cannot write during the reset. Apply all pending migrations, then preview the exact site origin, database, bucket, and record counts without changing anything:

```sh
npm run admin:reset-installation -- --dry-run
```

Run the destructive reset only after checking that preview:

```sh
npm run admin:reset-installation -- --execute
```

The default command is also a dry run. Destructive mode requires `--execute`, an interactive terminal, and the exact phrase `RESET <site-origin> <database-name> <bucket>`. If a recently issued signed upload URL is still valid, the reset stops before changing anything; keep TomeCMS stopped, wait five minutes, and retry. Object keys must match TomeCMS's generated prefix, and database deletion starts only after every known object is removed and verified absent.

If object storage is unavailable, the installer marker and database data are preserved. Some objects may already be gone, but rerunning the command is safe. If a database failure occurs after object deletion, keep TomeCMS stopped, restore PostgreSQL and S3 from the same recovery point, and rerun the dry run. A database-only backup is incomplete.

After completion, restart TomeCMS, open `/install`, and use the existing `TOME_CMS_INSTALL_TOKEN`. All stored Better Auth sessions are removed with the accounts.

## File Manager

Authenticated owners manage images at `/admin/media`. Version 1 accepts images only: JPEG, PNG, WebP, GIF, and AVIF, with a hard limit of 8 MB per file. SVG, video, audio, PDFs, and other documents are not supported.

The browser first reserves a generated object key, uploads directly with a short-lived signed URL, and asks TomeCMS to verify the size, MIME type, checksum, and image dimensions. Only verified files appear in File Manager. Posts, Pages, covers, and avatars store stable TomeCMS media IDs instead of provider URLs, so the delivery origin can change without rewriting content.

For cover images, use a 1600 × 900 px canvas when possible, with a recommended minimum of 1200 × 675 px. Aim for 2 MB or less for faster delivery; the hard upload limit remains 8 MB.

Failed deletions and expired unfinished uploads remain visible to the maintenance command. Preview them first, then clean them only from an interactive terminal:

```sh
npm run media:cleanup
npm run media:cleanup -- --execute
```

Execution requires `CLEAN <site-origin> <bucket>` exactly. The command processes at most 1,000 database-selected TomeCMS objects per run and never scans or deletes arbitrary bucket paths.

## Pages and Navigation

Posts are dated blog articles at `/<locale>/blog/<slug>`. Pages are standalone content such as About or Contact at `/<locale>/<slug>`, for example `/th/about` and `/en/about`. The `blog` Page slug is reserved. Manage Pages at `/admin/pages`; create, edit, and preview them through the Page routes listed below.

Thai and English Page editions have independent content, slugs, and Draft/Published states. Publishing, unpublishing, or deleting one edition does not change its sibling. Only Published editions appear publicly; a missing or Draft edition returns `404` without substituting another language.

At `/admin/navigation`, choose one of the two fixed locations, Header (labelled MenuBar) or Footer, then Thai or English. Each flat menu has its own labels and order; nested menus are not supported. Add Home (the locale's blog index), a Page edition in the selected language, or a custom relative URL starting with `/` or an absolute HTTP(S) URL. Adding to both locations creates independent entries; save each changed menu with **Save menu**.

Draft Page menu items remain saved but hidden publicly. Publishing makes them visible; unpublishing hides them while retaining their positions, and republishing restores them. Deleting a Page edition also deletes its menu references. Public Pages, Header, and Footer are server-rendered; the mobile menu uses a native disclosure and requires no application JavaScript.

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Redirect to the default locale's published post list |
| `/<locale>` | Localized published post list (`th` or `en`) |
| `/<locale>/blog/<slug>` | Public article with no application JavaScript |
| `/blog/[slug]` | Legacy article redirect to its localized URL |
| `/<locale>/<slug>` | Published standalone Page with no application JavaScript |
| `/sitemap.xml` | Published canonical URLs with accurate modification dates |
| `/robots.txt` | Crawler rules and sitemap discovery, including OAI-SearchBot |
| `/admin` | Sign-in and post dashboard |
| `/admin/media` | Authenticated image File Manager |
| `/admin/new` | New post editor |
| `/admin/edit/[id]` | Existing post editor |
| `/admin/pages` | Authenticated Page list |
| `/admin/pages/new` | New Page editor |
| `/admin/pages/edit/[id]` | Existing Page editor |
| `/admin/pages/preview/[id]` | Owner-only Page preview, excluded from indexing |
| `/admin/navigation` | Header/Footer menus by language |
| `/install` | First-run installation wizard |
| `/api/install/status` | Installer readiness check |
| `/api/install/enroll` | Begin the one-time Passkey installation ceremony |
| `/api/install/finalize` | Finalize the owner and site installation |
| `/api/admin/posts` | Authenticated Post list, CRUD, translation, and publication API |
| `/api/admin/pages` | Authenticated Page list, CRUD, translation, and publication API |
| `/api/admin/categories` | Authenticated Category management API |
| `/api/admin/navigation` | Authenticated menu list and replacement API |
| `/api/admin/settings` | Authenticated site settings API |
| `/api/admin/profile` | Authenticated author profile API |
| `/api/upload` | Retired upload endpoint; returns `410 Gone` |

## Deploy to a VPS

The deployment script targets Ubuntu or Debian with Node.js 22 or newer, npm, curl, systemd, and sudo access. It builds a versioned release, installs production dependencies, runs TomeCMS as a systemd service, checks the new release, and restores the previous release if the health check fails.

### First deployment

From the project directory on the server, run:

```sh
./scripts/deploy-vps.sh
```

The first run asks you to choose Supabase Cloud (recommended) or an existing Self-hosted deployment, verifies the connection, creates `/etc/tome-cms/tome-cms.env`, generates a random installation token, and exits so you can apply the TomeCMS migrations. The secret key is read without being displayed.

To configure the backend separately or change it later, run:

```sh
sudo TOMECMS_ENV_FILE=/etc/tome-cms/tome-cms.env ./scripts/configure-supabase.sh
```

To configure an existing Nginx installation, set `TOME_CMS_DOMAIN` before the final deployment:

```sh
sudoedit /etc/tome-cms/tome-cms.env
```

```dotenv
TOME_CMS_DOMAIN=blog.example.com
```

Before running the deployment script again, back up existing Postgres metadata and Supabase Storage objects separately when applicable, then apply every pending SQL migration in `supabase/migrations/`. A database backup does not include the stored image objects.

Only after the backups and migrations are complete, deploy and restart TomeCMS:

```sh
./scripts/deploy-vps.sh
```

The service listens on `127.0.0.1:4321`.

The script creates the Nginx reverse proxy configuration. Configure HTTPS with the certificate tooling used on the server; VPS installation and Passkey registration or sign-in are blocked over plain HTTP.

After deployment, open `https://your-domain/install`. When the wizard asks for the token, read it on the VPS:

```sh
sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env
```

### Later deployments

Existing Cloud and Self-hosted installations must apply `supabase/migrations/20260907210000_create_pages_and_navigation.sql` before deploying the Pages/Navigation code. Apply any earlier pending SQL files first, in filename order; existing Posts and site settings need no backfill. For Cloud, run the pending SQL in the target project's SQL Editor. For Self-hosted, run the same SQL against the existing Supabase database using the deployment's administrative SQL client. Track which migrations have already been applied and do not rerun earlier files indiscriminately.

`npm run configure:supabase` configures and verifies the connection; `./scripts/deploy-vps.sh` builds and restarts TomeCMS. Neither command applies remote database migrations or upgrades a Self-hosted Supabase stack. Keep the existing application release running until the database migration succeeds, then deploy the new code.

For every later deployment:

1. Pull the new code.
2. Back up Postgres metadata and Supabase Storage objects separately.
3. Apply every pending SQL migration in `supabase/migrations/`.
4. Deploy and restart the application:

```sh
./scripts/deploy-vps.sh
```

5. Run smoke checks for the public homepage, a localized article and Page URL, Header/Footer links, owner sign-in, and a new draft save. `/api/install/status` should report `migration: true` when all required tables are queryable.

Never seed or reset production. `supabase db reset` is only for deliberately disposable local development data.

TomeCMS stores images through its server-side S3 client and includes licensed AIStor in the bundled Compose topology. Browser code receives only short-lived single-object upload URLs and never receives S3 credentials.

Check the service when needed:

```sh
sudo systemctl status tome-cms
sudo journalctl -u tome-cms -n 100
```

Owner recovery ships with every VPS release. Inspect the target without making changes:

```sh
sudo -u tomecms npm --prefix /opt/tome-cms/current run admin:recover
```

After verifying the displayed site and owner, explicitly create the one-time recovery link:

```sh
sudo -u tomecms npm --prefix /opt/tome-cms/current run admin:recover -- --execute
```

Run recovery only in a private terminal and do not copy the one-time URL or its context into logs or tickets.

## Project structure

```text
src/components/admin/   React editor and upload helpers
src/components/blog/    Public blog components
src/layouts/            Public and admin layouts
src/server/             Better Auth, PostgreSQL services, migrations, and server boundaries
src/lib/                Browser-safe helpers plus the temporary Supabase media client
src/pages/              Blog, admin, and API routes
src/types/              CMS types
supabase/migrations/    Database and storage setup
supabase/config.toml    Local Supabase configuration
scripts/                macOS, Windows, and VPS helpers
```
