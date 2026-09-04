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

## Requirements

- Node.js 20 or newer
- npm
- A Supabase project

## Run it locally

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

5. Start Astro, then open `/install`. The wizard checks the database and storage, saves the site settings, creates the first owner account, and signs it in.

6. Start Astro:

   ```sh
   npm run dev
   ```

Open `http://localhost:4321/install` to finish setup. After installation, `/install` redirects to `/admin`.

`SUPABASE_SERVICE_ROLE_KEY` and `TOME_CMS_INSTALL_TOKEN` are server-only. Never expose either value through a variable prefixed with `PUBLIC_`.

## Commands

```sh
npm run dev       # Start the development server
npm run build     # Build the production server
npm run preview   # Run the production build locally
npm run check     # Check Astro, TypeScript, and the deployment script
```

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Published post list |
| `/blog/[slug]` | Public article with no client-side JavaScript |
| `/admin` | Sign-in and post dashboard |
| `/admin/new` | New post editor |
| `/admin/edit/[id]` | Existing post editor |
| `/install` | First-run installation wizard |
| `/api/install/status` | Installer readiness check |
| `/api/install` | One-time installation endpoint |
| `/api/posts` | Authenticated post API |
| `/api/upload` | Authenticated image upload API |

## Deploy to a VPS

The deployment script targets Ubuntu or Debian with Node.js 20 or newer, npm, curl, systemd, and sudo access. It builds a versioned release, installs production dependencies, runs TomeCMS as a systemd service, checks the new release, and restores the previous release if the health check fails.

### First deployment

From the project directory on the server, run:

```sh
./scripts/deploy-vps.sh
```

The first run creates `/etc/tome-cms/tome-cms.env`, generates a random installation token, and exits. Add the required Supabase values:

```sh
sudoedit /etc/tome-cms/tome-cms.env
./scripts/deploy-vps.sh
```

Run both SQL migrations in Supabase before the second deployment. The service listens on `127.0.0.1:4321`. To configure an existing Nginx installation, set a domain:

```dotenv
TOME_CMS_DOMAIN=blog.example.com
```

The script creates the Nginx reverse proxy configuration. Configure HTTPS with the certificate tooling used on the server; production installation is blocked over plain HTTP.

After deployment, open `https://your-domain/install`. When the wizard asks for the token, read it on the VPS:

```sh
sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env
```

### Later deployments

Pull the new code and run the same command:

```sh
./scripts/deploy-vps.sh
```

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
scripts/                VPS deployment
```
