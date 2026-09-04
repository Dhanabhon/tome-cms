# TomeCMS

TomeCMS is a small Astro blog with a private React editor. Public pages render on the server and send no application JavaScript. The admin area uses Novel for block editing and Supabase for authentication, posts, and image storage.

## What is included

- Server-rendered homepage and article pages
- Draft and published post workflows
- Novel editor with formatting, slash commands, and image uploads
- Debounced draft saving
- Supabase authentication, Row Level Security, and Storage policies
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

3. Add your Supabase project URL and anonymous key to `.env`:

   ```dotenv
   PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

4. Run `supabase/migrations/0001_create_posts.sql` in the Supabase SQL Editor. The migration creates the posts table, access policies, and the `blog-media` storage bucket.

5. Create an email and password user under Authentication in the Supabase dashboard. TomeCMS does not provide public registration.

6. Start Astro:

   ```sh
   npm run dev
   ```

Open `http://localhost:4321` for the blog and `http://localhost:4321/admin` for the dashboard.

`SUPABASE_SERVICE_ROLE_KEY` is optional for the current application. Leave it unset unless you add a server-only job that needs it, and never expose it through a variable prefixed with `PUBLIC_`.

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
| `/api/posts` | Authenticated post API |
| `/api/upload` | Authenticated image upload API |

## Deploy to a VPS

The deployment script targets Ubuntu or Debian with Node.js 20 or newer, npm, curl, systemd, and sudo access. It builds a versioned release, installs production dependencies, runs TomeCMS as a systemd service, checks the new release, and restores the previous release if the health check fails.

### First deployment

From the project directory on the server, run:

```sh
./scripts/deploy-vps.sh
```

The first run creates `/etc/tome-cms/tome-cms.env` and exits. Add the required Supabase values:

```sh
sudoedit /etc/tome-cms/tome-cms.env
./scripts/deploy-vps.sh
```

The service listens on `127.0.0.1:4321`. To configure an existing Nginx installation, set a domain before the second deployment:

```dotenv
TOME_CMS_DOMAIN=blog.example.com
```

The script creates the Nginx reverse proxy configuration. Configure HTTPS separately with the certificate tooling used on the server.

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
