# TomeCMS

TomeCMS is a small Astro CMS for blog posts and standalone Pages with a private React editor. Public Pages, articles, Header, and Footer render on the server and send no application JavaScript. The admin area uses Novel for block editing and Supabase for authentication, content, navigation, and image storage.

## What is included

- Server-rendered homepage and article pages
- Draft and published post workflows
- Standalone Pages and independently ordered Header (MenuBar) and Footer navigation
- Novel editor with formatting, slash commands, and image uploads
- Debounced draft saving
- Admin shell routes for Posts, Pages, Navigation, Media, Profile, and Settings; focused Post and Page editors are outside that shell
- Manual Thai (TH) and English (EN) editions with independent draft, publish, and unpublish states
- Localized public routes at `/<locale>`, `/<locale>/blog/<slug>`, and `/<locale>/<slug>`, with legacy blog routes redirected to their localized equivalents
- Owner-only Preview that saves and opens the newest draft
- Profile details reused by the global post author block
- Supabase authentication, Row Level Security, and Storage policies
- A secure first-run installer for site settings and the owner account
- SEO, GEO, and AEO foundations with canonical URLs, social metadata, structured data, and automatic discovery files
- Sanitized HTML output for public articles
- A deployment script for Ubuntu and Debian VPS hosts

## Prerequisites

Before using either local setup helper, prepare:

- A local copy of this repository. Open your terminal in the `tome-cms` directory containing `package.json`.
- [Node.js](https://nodejs.org/en/download) and npm. Choose a supported LTS release; TomeCMS requires Node.js 22 or newer.
- Docker Desktop installed and running. Follow the operating-system instructions below.
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), installed with Homebrew on macOS or Scoop on Windows so the `supabase` command is available in your terminal.
- An internet connection for downloading dependencies and Docker images on the first run.
- Available ports: `4321` for TomeCMS and `54321` through `54324` for the configured local Supabase services. If a port is occupied, stop the conflicting app or local stack first.

The helper creates the Supabase containers and storage volumes, downloads their images, and configures the database. You do not need to create these manually, write a Docker Compose file, or create a hosted Supabase project. Docker runs Supabase; TomeCMS runs on your computer through Node.js.

A hosted or self-hosted Supabase project is only needed for the [external connection option](#connect-supabase-cloud-or-self-hosted).

## Run it locally

Choose the command for your operating system. The helper checks the required tools, starts the Supabase services TomeCMS needs, applies pending migrations, prepares `.env.local`, and launches the site. The first run may take a few minutes while Docker downloads the Supabase images.

### macOS

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

### Windows

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
npm run admin:reset-password # Reset the installed owner password
npm run test:e2e:media # Run focused Media Library and public blog regressions
npm run test:e2e:publishing # Run focused multilingual publishing regressions
npm run test:e2e:pages # Run Pages, Navigation, public blog, and admin shell regressions
```

Run `npm run test:e2e:media` and `npm run test:e2e:publishing` after the local Supabase stack is ready. On macOS, start Docker Desktop and use `npm run dev:macos`; the helper applies pending local migrations automatically.

For `npm run test:e2e:pages`, use an installed local development site with all pending migrations applied, the `blog-media` bucket, and `.env.local` containing the Supabase URL, public key, and server admin key. Complete the Wizard Installer first: the browser tests temporarily lease the existing `site_settings` owner and restore it afterward. Use a development database because tests create and remove accounts and content. Install the locked dependencies with `npm ci` and the Playwright browsers with `npx playwright install chromium webkit`, then run:

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

This reset permanently deletes all TomeCMS Navigation items, Pages, Posts, Media Library records and folders, every object in the dedicated `blog-media` bucket, site settings, and the configured owner account. The preview lists Navigation and Page counts, and content rows are deleted in that order before Posts and Media. It keeps the Supabase project, database schema, migrations, bucket, environment file, and installation token.

Back up Postgres and Supabase Storage first. Close every Admin tab and stop TomeCMS so an active editor cannot write during the reset. Apply all pending migrations, then preview the exact target and record counts without changing anything:

```sh
npm run admin:reset-installation -- --dry-run
```

Run the destructive reset only after checking that preview:

```sh
npm run admin:reset-installation -- --execute
```

The default command is also a dry run. Destructive mode requires the explicit `--execute` option and then requires you to type `RESET <supabase-origin>` exactly, including the scheme and any port. It supports local, Supabase Cloud, and Self-hosted connections and accepts current or legacy admin key names. Remote connections must use HTTPS; plain HTTP is accepted only for loopback development. For `/etc/tome-cms/tome-cms.env`, run it with `sudo`; use `TOMECMS_ENV_FILE` for any other path.

If the command exits after deletion begins, keep TomeCMS stopped. Restore the Postgres and `blog-media` Storage backups from the same recovery point, rerun the dry run to verify the restored counts, then retry with `--execute`. Database backups do not replace a separate Storage backup.

After completion, restart TomeCMS, open `/install`, and use the existing `TOME_CMS_INSTALL_TOKEN`. The old owner's refresh sessions are removed with the account, but an already-issued access token can remain valid until its expiry.

## Media Library

Authenticated owners manage images at `/admin/media`. Version 1 accepts images only: JPEG, PNG, WebP, GIF, and AVIF, with a hard limit of 8 MB per file. SVG, video, audio, PDFs, and other documents are not supported.

For cover images, use a 1600 × 900 px canvas when possible, with a recommended minimum of 1200 × 675 px. Aim for 2 MB or less for faster delivery; the hard upload limit remains 8 MB.

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
| `/admin/media` | Authenticated image Media Library |
| `/admin/new` | New post editor |
| `/admin/edit/[id]` | Existing post editor |
| `/admin/pages` | Authenticated Page list |
| `/admin/pages/new` | New Page editor |
| `/admin/pages/edit/[id]` | Existing Page editor |
| `/admin/pages/preview/[id]` | Owner-only Page preview, excluded from indexing |
| `/admin/navigation` | Header/Footer menus by language |
| `/install` | First-run installation wizard |
| `/api/install/status` | Installer readiness check |
| `/api/install` | One-time installation endpoint |
| `/api/posts` | Authenticated post API |
| `/api/pages` | Authenticated Page list, CRUD, translation, and publication API |
| `/api/navigation` | Authenticated menu list and replacement API |
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

The script creates the Nginx reverse proxy configuration. Configure HTTPS with the certificate tooling used on the server; production installation is blocked over plain HTTP.

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

TomeCMS continues to use Supabase Storage in managed and self-hosted deployments. An external S3-compatible backend is configured by the operator through Supabase Storage; TomeCMS adds no MinIO container, S3 SDK, or S3 credentials to browser code.

Check the service when needed:

```sh
sudo systemctl status tome-cms
sudo journalctl -u tome-cms -n 100
```

## Project structure

```text
src/components/admin/   React editor and upload helpers
src/components/blog/    Public blog components
src/layouts/            Public and admin layouts
src/lib/                Supabase clients
src/pages/              Blog, admin, and API routes
src/types/              CMS types
supabase/migrations/    Database and storage setup
supabase/config.toml    Local Supabase configuration
scripts/                macOS, Windows, and VPS helpers
```
