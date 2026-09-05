# TomeCMS

TomeCMS is a small Astro blog with a private React editor. Public pages render on the server and send no application JavaScript. The admin area uses Novel for block editing and Supabase for authentication, posts, and image storage.

## What is included

- Server-rendered homepage and article pages
- Draft and published post workflows
- Novel editor with formatting, slash commands, and image uploads
- Debounced draft saving
- Supabase authentication, Row Level Security, and Storage policies
- A secure first-run installer for site settings and the owner account
- Sanitized HTML output for public articles
- A deployment script for Ubuntu and Debian VPS hosts

## Prerequisites

Before using either local setup helper, prepare:

- A local copy of this repository. Open your terminal in the `tome-cms` directory containing `package.json`.
- [Node.js](https://nodejs.org/en/download) and npm. Choose a supported LTS release; the helper requires Node.js 20 or newer.
- Docker Desktop installed and running. Follow the operating-system instructions below.
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), installed with Homebrew on macOS or Scoop on Windows so the `supabase` command is available in your terminal.
- An internet connection for downloading dependencies and Docker images on the first run.
- Available ports: `4321` for TomeCMS and `54321` through `54324` for the configured local Supabase services. If a port is occupied, stop the conflicting app or local stack first.

The helper creates the Supabase containers and storage volumes, downloads their images, and configures the database. You do not need to create these manually, write a Docker Compose file, or create a hosted Supabase project. Docker runs Supabase; TomeCMS runs on your computer through Node.js.

A hosted or self-hosted Supabase project is only needed for the [manual connection option](#use-a-hosted-or-self-hosted-supabase-project).

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

### Use a hosted or self-hosted Supabase project

1. Install the locked dependency set:

   ```sh
   npm ci
   ```

2. Create the local environment file:

   ```sh
   cp .env.example .env
   ```

3. Add your Supabase credentials and an installation token to `.env`:

   ```dotenv
   PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   TOME_CMS_INSTALL_TOKEN=use-a-random-value-with-at-least-24-characters
   ```

4. Run the SQL files in `supabase/migrations/` in filename order. They create the posts table, access policies, media bucket, and the single-row site settings table used to lock the installer.

5. Start Astro:

   ```sh
   npm run dev
   ```

6. Open `http://localhost:4321/install`. The wizard checks the database and storage, saves the site settings, creates the first owner account, and signs it in. After installation, `/install` redirects to `/admin`.

`SUPABASE_SERVICE_ROLE_KEY` and `TOME_CMS_INSTALL_TOKEN` are server-only. Never expose either value through a variable prefixed with `PUBLIC_`.

## Commands

```sh
npm run dev         # Start the development server
npm run dev:macos   # Start local Supabase and TomeCMS on macOS
npm run dev:windows # Start local Supabase and TomeCMS on Windows
npm run build       # Build the production server
npm run preview     # Run the production build locally
npm run check       # Check Astro, TypeScript, and the helper scripts
npm run test:e2e:media # Run focused Media Library and public blog regressions
```

Run `npm run test:e2e:media` after the local Supabase stack is ready. On macOS, start Docker Desktop and use `npm run dev:macos`; the helper applies pending local migrations automatically.

## Media Library

Authenticated owners manage images at `/admin/media`. Version 1 accepts images only: JPEG, PNG, WebP, GIF, and AVIF, with a hard limit of 8 MB per file. SVG, video, audio, PDFs, and other documents are not supported.

For cover images, use a 1600 × 900 px canvas when possible, with a recommended minimum of 1200 × 675 px. Aim for 2 MB or less for faster delivery; the hard upload limit remains 8 MB.

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Published post list |
| `/blog/[slug]` | Public article with no client-side JavaScript |
| `/admin` | Sign-in and post dashboard |
| `/admin/media` | Authenticated image Media Library |
| `/admin/new` | New post editor |
| `/admin/edit/[id]` | Existing post editor |
| `/install` | First-run installation wizard |
| `/api/install/status` | Installer readiness check |
| `/api/install` | One-time installation endpoint |
| `/api/posts` | Authenticated post API |
| `/api/upload` | Retired upload endpoint; returns `410 Gone` |

## Deploy to a VPS

The deployment script targets Ubuntu or Debian with Node.js 20 or newer, npm, curl, systemd, and sudo access. It builds a versioned release, installs production dependencies, runs TomeCMS as a systemd service, checks the new release, and restores the previous release if the health check fails.

### First deployment

From the project directory on the server, run:

```sh
./scripts/deploy-vps.sh
```

The first run creates `/etc/tome-cms/tome-cms.env`, generates a random installation token, and exits. Add the required Supabase values. To configure an existing Nginx installation, also set `TOME_CMS_DOMAIN` before deployment:

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

For every later deployment:

1. Pull the new code.
2. Back up Postgres metadata and Supabase Storage objects separately.
3. Apply every pending SQL migration in `supabase/migrations/`.
4. Only then deploy and restart the application:

```sh
./scripts/deploy-vps.sh
```

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
