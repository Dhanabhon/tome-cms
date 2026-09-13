# TomeCMS

TomeCMS is a lightweight, bilingual CMS built with Astro. It ships a server-rendered Blog and a React-based Admin editor, while exposing the same Published content through a versioned Headless REST API.

> **Development status:** the `0.2.0` storage and authentication cutover is still in progress. Use a clean installation for this branch and do not treat it as a production release until the release checklist is complete.

## What is included

- Six-step first-run Wizard with a configurable Admin URL
- Passkey-only owner authentication and one-time recovery codes
- Posts in Thai and English, shared Categories, drafts, previews, and SEO fields
- Pages and configurable Header/Footer Navigation
- File Manager backed by S3-compatible object storage
- Server-rendered public pages with no application JavaScript
- Published-only REST API, OpenAPI 3.1 document, sitemap, and RSS feed
- Optional Headless mode that keeps Admin and APIs while hiding the bundled Blog

## Runtime architecture

| Layer | Technology |
| --- | --- |
| Application | Astro SSR with Node.js 22 |
| Admin UI | React islands and Tiptap/Novel |
| Database | PostgreSQL 17 through Kysely |
| Authentication | Better Auth with Passkeys |
| Media | S3-compatible storage; local Compose uses licensed AIStor |
| Deployment | Docker Compose |

Database migrations live in `src/server/db/migrations/` and are applied with `npm run db:migrate`.

## Prerequisites

### macOS — primary local workflow

Install these before the first run:

- macOS with Docker Desktop running
- Node.js 22 or newer and npm
- Git
- A readable AIStor license file stored **outside** this repository
- Free local ports `4321`, `5432`, `9000`, and `9001`

Check the main tools:

```sh
node --version
npm --version
docker version
docker compose version
```

### Windows — secondary local workflow

Use Windows 11 with Docker Desktop, Node.js 22+, npm, Git, PowerShell, and the same external AIStor license requirement. The Windows helper follows the same bootstrap flow, but macOS is the currently validated development path.

## First local installation on macOS

From the project directory:

```sh
MINIO_LICENSE_FILE=/absolute/path/outside/the/repository/aistor.license npm run dev:macos
```

The helper installs locked packages when needed, creates a private `.env.local`, starts PostgreSQL and object storage, initializes the bucket, applies migrations, prints the installation token, and starts Astro.

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
MINIO_LICENSE_FILE=/absolute/path/to/aistor.license npm run dev:macos -- --force
```

## First local installation on Windows

In PowerShell:

```powershell
$env:MINIO_LICENSE_FILE = 'C:\absolute\path\outside\the\repository\aistor.license'
npm run dev:windows
```

The Wizard and installation-token flow are identical to macOS. The token is also stored in `.env.local`.

## Manual local workflow

Use this when you want infrastructure and Astro in separate terminals:

```sh
MINIO_LICENSE_FILE=/absolute/path/to/aistor.license npm run bootstrap:core
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
MINIO_LICENSE_FILE=/absolute/path/outside/the/repository/aistor.license
```

Never commit `.env.local`, credentials, license files, database dumps, or object-storage backups. The bootstrap writes `.env.local` with owner-only permissions on macOS/Linux.

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

Use a spare Passkey or a one-time recovery code from `/recovery`. The local owner-recovery command is:

```sh
npm run admin:recover
```

To return a disposable installation to the Wizard, preview the exact scope first:

```sh
npm run admin:reset-installation
npm run admin:reset-installation -- --execute
```

The execute form requires an exact interactive confirmation. It deletes application data and known media objects while retaining the schema, environment file, and installation token.

## VPS deployment preview

This branch uses Docker Compose for PostgreSQL, object storage, and the application. Before deploying, configure public DNS and TLS reverse proxies for both the CMS origin and the S3 endpoint. The script does not edit firewall rules or obtain certificates.

Example from a clean checkout:

```sh
export MINIO_LICENSE_FILE=/srv/tomecms-secrets/aistor.license
export TOME_CMS_PUBLIC_URL=https://cms.example.com
export S3_ENDPOINT=https://media.example.com
export MEDIA_PUBLIC_URL=https://media.example.com/tomecms-media/
./scripts/deploy-vps.sh
```

The generated `.env.local` remains local to that checkout. Back up PostgreSQL and the object bucket together before upgrades. Production backup/restore automation and real-host HTTPS acceptance are still release gates for `0.2.0`.

## Development checks

Install locked dependencies:

```sh
npm ci
```

Run focused checks as needed:

```sh
npm run test:unit
npm run test:integration:foundation
npm run test:e2e -- tests/e2e/passkey-installer.spec.ts --project=desktop
npm run check
npm run build
```

The integration runner starts an explicitly named disposable PostgreSQL Compose project and removes its volumes in `finally`.

## Project layout

```text
src/components/admin/        Interactive Admin islands
src/components/blog/         Server-rendered public components
src/pages/admin/             Internal Admin route templates
src/pages/api/admin/         Same-origin authenticated mutations
src/pages/api/v1/content/    Anonymous Published-content REST API
src/server/auth/             Better Auth, Passkeys, enrollment, recovery
src/server/content/          PostgreSQL content services
src/server/db/               Kysely schema, client, and migrations
src/server/media/            S3 storage boundary and media services
scripts/                     Bootstrap, maintenance, and deployment helpers
tests/unit/                  Small deterministic contracts
tests/integration/           Disposable PostgreSQL/S3 service contracts
tests/e2e/                   Browser-level installation acceptance
```
