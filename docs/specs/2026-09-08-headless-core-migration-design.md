# TomeCMS Headless Core Migration Design

Date: 2026-09-08
Status: Approved

## Context

TomeCMS is currently an Astro 5 standalone Node application with server-rendered public pages, React-based Admin islands, a Novel/Tiptap editor, and Supabase for authentication, Postgres access, Row Level Security, and media storage. The browser uses the Supabase client for authentication and some media operations, while public Astro routes query Supabase directly.

This design removes Supabase and turns TomeCMS into a headless-capable CMS without discarding the existing public theme or editing experience. PostgreSQL becomes the only metadata and content database. Media uses an S3-compatible object store, with MinIO supplied for local and VPS installations. The built-in Astro Blog remains enabled by default as a first-party consumer of the same published-content services exposed through a versioned REST API.

The migration is a clean reinstall for the pre-1.0 product. It does not import existing Supabase accounts, rows, sessions, or objects.

## Product Decisions

- TomeCMS is headless-capable, not API-only. The bundled Astro Blog remains an optional frontend.
- The canonical deployment is Node.js, PostgreSQL, and S3-compatible storage.
- Local development and the default VPS deployment use Docker Compose for PostgreSQL and MinIO.
- Astro runs on the macOS host during development for fast HMR; the production application runs in a container.
- Existing Astro 5, React 18, Tailwind 3, Novel/Tiptap, and TipTap JSON remain during the backend migration.
- Better Auth provides database-backed sessions and passkey-first authentication.
- The first owner uses a Passkey. Passwords, OAuth, and required email delivery are not part of this release.
- Account recovery uses spare Passkeys, one-time recovery codes, and a local CLI recovery flow.
- Content types remain fixed: Posts, Pages, Categories, Navigation, Media, and Site Settings.
- PostgreSQL access uses Kysely and `pg`. Runtime schema creation and a visual schema builder are out of scope.
- Media uses one S3 client configured by endpoint. MinIO, Cloudflare R2, AWS S3, and other compatible providers do not receive separate adapters.
- Rich content retains both TipTap JSON and server-generated sanitized HTML.
- Public content uses a versioned read-only REST API with an OpenAPI document.
- Public Published content is readable without an API key. Draft preview uses a short-lived scoped token.
- External write tokens, GraphQL, plugins, and dynamic collections are deferred.
- Existing public URL shapes and zero-application-JavaScript rendering remain stable.
- The release version for the completed migration is `0.2.0`.

## Goals

- Remove all runtime dependencies on Supabase Auth, Data API, Storage, RLS, CLI, and environment variables.
- Keep the current Admin, editor, bilingual publishing, navigation, category, file-management, installer, SEO, and public-rendering behavior.
- Give external applications a stable API for Published Posts, Pages, Categories, Navigation, and Site Settings.
- Keep browser code isolated from database and permanent object-storage credentials.
- Make a fresh local or VPS installation repeatable through scripts plus a friendly first-run Wizard.
- Support moving media between S3-compatible providers without rewriting content records.
- Preserve strong validation, optimistic concurrency, stored-XSS protection, and explicit recovery paths.

## Non-goals

- Importing or dual-writing Supabase data.
- Supporting SQLite, MariaDB, MySQL, D1, or multiple SQL dialects.
- A visual collection or field schema builder.
- Custom content types, arbitrary taxonomies, nested navigation, or a plugin marketplace.
- GraphQL or simultaneous REST and GraphQL APIs.
- Personal access tokens or external content mutation in the first Headless release.
- Multi-tenant hosting, multiple sites in one database, or horizontal application scaling.
- Redis, queues, background workers, or scheduled publishing.
- Private digital-asset management. Published and uploaded media are treated as public assets.
- Upgrading Astro, React, Tailwind, or the editor while replacing the backend.

## Architecture

```text
                                   +--------------------------+
                                   | Bundled Astro Blog       |
                                   | zero application JS      |
                                   +-------------+------------+
                                                 |
+----------------------+             +-----------v------------+
| External consumers   +------------>| Published content      |
| web, mobile, email   | REST v1     | query services         |
+----------------------+             +-----------+------------+
                                                 |
                                   +-------------v------------+
                                   | PostgreSQL via Kysely     |
                                   +--------------------------+

+----------------------+             +--------------------------+
| React Admin islands  +------------>| Admin API and services   |
+----------------------+ session     +------------+-------------+
                                                  |        |
                                    +-------------+        +----------------+
                                    |                                      |
                         +----------v-----------+                +---------v---------+
                         | PostgreSQL           |                | S3 / MinIO        |
                         | content/auth/session |                | media objects     |
                         +----------------------+                +-------------------+
```

The application has one server-side domain layer. Admin endpoints, public REST routes, bundled Astro routes, sitemap generation, RSS generation, and previews call this layer rather than issuing provider queries independently.

The browser never imports a database client. Admin React islands communicate with same-origin Astro endpoints. Large media bytes may travel directly from the browser to S3 through a short-lived signed upload URL, but every reservation, validation, finalization, and metadata change remains server-controlled.

## Server Module Boundaries

New server-only code lives under `src/server/`:

| Module | Responsibility |
| --- | --- |
| `db/` | PostgreSQL pool, Kysely database type, transactions, and migration runner |
| `auth/` | Better Auth configuration, session lookup, installer enrollment, and recovery |
| `content/` | Post, Page, Category, Navigation, Settings, and Published-content operations |
| `media/` | S3 client, upload reservations, metadata, URL resolution, and deletion |
| `http/` | Problem Details responses, request IDs, pagination cursor, cache headers, and CORS |

These boundaries expose focused functions rather than a generic provider framework. PostgreSQL is the only SQL implementation and the configured S3 endpoint is the only object-storage implementation. An abstraction is added only where two real callers need a stable contract, such as the shared Published-content services used by Astro pages and REST routes.

## Database and Migrations

The application uses one long-lived `pg.Pool` per Node process and one Kysely instance over that pool. Pool size is configurable and defaults conservatively for a single VPS.

Migrations are forward-only TypeScript migrations run by an explicit `npm run db:migrate` command. Deployment and bootstrap scripts run migrations before marking the application ready. Normal web requests never perform DDL. The application refuses readiness when its expected migration version is newer than the database.

Better Auth's generated schema is reviewed and incorporated into TomeCMS migrations so production has one ordered migration history. Deployment does not invoke an independent runtime auth migration command.

PostgreSQL constraints continue to enforce unique slugs, translation identity, Category ownership, at-least-one Category membership, valid Navigation target shapes, and referential integrity. Supabase RLS is removed because browsers can no longer query PostgreSQL directly. Authorization is enforced in server services, while foreign keys and check constraints protect database invariants.

## Data Model

### Authentication

Better Auth owns its required User, Session, Account, Verification, and Passkey tables. TomeCMS adds:

- `recovery_codes`: owner, keyed hash, creation time, and consumption time.
- `installation_enrollments`: opaque token hash, pending owner, expiry, and consumption time.

Only one installed owner exists in this release. The schema retains a role value of `owner` so a future multi-user milestone can add roles deliberately without changing content ownership semantics now.

### Site Settings

`site_settings` remains a singleton and stores:

- Site name and Tagline.
- Default locale and timezone.
- Owner User ID.
- Author profile fields.
- Configurable public Admin path.
- Installation and update timestamps.

Absence of the singleton row means TomeCMS is not installed. Inserting the row is the final installation commit.

The Admin path is an address choice, not an authorization mechanism. Middleware rewrites the configured public path to the internal Admin routes and returns `404` for the default `/admin` path when a different path is configured. Auth and API routes remain fixed and protected independently.

### Posts and Pages

Each language edition remains an independent row with:

- UUID identity and `translation_group_id`.
- Locale, title, slug, status, and publication timestamps.
- `content_json` for TipTap state.
- `content_html` generated and sanitized by the server.
- SEO fields and optional media relationship.
- Owner and creation/update timestamps.

Thai and English editions can be drafted, published, and unpublished independently. Unique constraints cover `(translation_group_id, locale)` and `(locale, slug)`.

The client submits TipTap JSON. The server validates the document, applies size/depth limits, generates HTML, and sanitizes the result. Client-supplied HTML is not trusted or stored. Both representations are returned by the Headless Content API.

`updated_at` is the optimistic concurrency token. Mutation requests include the version they loaded. A mismatched update returns `409 Conflict` and never overwrites the newer row.

### Categories

Categories remain shared between Thai and English. Assignments target a Post `translation_group_id`, so every edition in the group has identical membership by construction.

`Uncategorized` is created during installation, cannot be deleted, and is restored transactionally whenever removing custom Categories would otherwise leave a Post group without a Category.

### Navigation

Navigation remains locale-specific and location-specific for Header and Footer. Items target Home, a Page edition, or a validated custom HTTP(S) or relative URL. Complete-list replacement occurs in one PostgreSQL transaction so a consumer never receives a partially reordered menu.

### Media

`media_items` stores:

- Object key and original filename.
- MIME type and byte size.
- Checksum, width, and height.
- Folder, owner, and timestamps.

The database does not store a provider-specific public URL. Responses resolve the URL from `MEDIA_PUBLIC_URL` and the object key. Content documents refer to stable media identity or resolved public paths rather than MinIO hostnames.

`media_upload_reservations` records the expected key, MIME type, size limit, expiry, and finalization status for signed uploads. Expired reservations and unclaimed objects are removed by an explicit maintenance command.

## Authentication and Session Design

Better Auth is mounted at `/api/auth/[...all]` and uses PostgreSQL-backed opaque sessions. Production cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`. Cross-subdomain cookies and stateless sessions are disabled.

The Passkey Relying Party ID and expected origin come only from `TOME_CMS_PUBLIC_URL`. Forwarded Host headers do not define the WebAuthn security boundary. Loopback HTTP origins are allowed only in development; production installation and authentication require HTTPS.

Passkey-first registration uses Better Auth's pre-auth registration mechanism:

1. The installer validates the server-provided installation token.
2. The server creates a signed, single-use enrollment context with a ten-minute expiry.
3. Better Auth's Passkey `resolveUser` callback accepts only a valid enrollment context while no `site_settings` row exists.
4. The browser completes the WebAuthn ceremony.
5. Finalization verifies that the pending owner has a Passkey, creates recovery codes, inserts `site_settings`, seeds `Uncategorized`, consumes the enrollment, and creates the owner session.

Failed or abandoned ceremonies leave an expiring pending enrollment rather than a partially installed site. Retrying with the installation token reuses or safely replaces the pending owner. After installation, the pre-auth registration callback rejects all installer contexts.

An owner may register several Passkeys and label each one. The Admin refuses to remove the final Passkey.

Recovery codes contain sufficient CSPRNG entropy, are displayed once, and are stored only as keyed hashes. Consuming a code marks it used, revokes all sessions, and grants a short-lived recovery enrollment that can register a replacement Passkey. Generating a new set invalidates every unused code from the previous set.

The local recovery CLI verifies direct server and database access, displays the target site and owner, requires explicit confirmation, revokes active sessions, and creates a one-time ten-minute enrollment URL. It never prints private Passkey material or silently installs a credential.

## First-run Installation

Infrastructure bootstrap and browser installation remain separate.

The macOS helper:

1. Checks Node, npm, Docker, Compose, required ports, and filesystem permissions.
2. Creates a protected environment file without overwriting a user-managed file.
3. Generates database, MinIO, Better Auth, recovery, and installation secrets.
4. Starts PostgreSQL and MinIO and waits for health checks.
5. Creates the media bucket and its public-read policy.
6. Runs all migrations.
7. Starts Astro on the host and displays the Installer URL and installation token.

The production helper uses the same environment contract but runs the application in Docker and leaves TLS termination to the documented reverse-proxy deployment.

The Wizard contains these visible steps:

1. System readiness.
2. Site details, locale, timezone, and Admin path.
3. Owner identity.
4. Installation-token verification.
5. Primary Passkey registration.
6. Recovery-code acknowledgement and completion.

A progress bar reports both the current Wizard step and sub-step activity such as database checks, migrations, bucket access, Passkey verification, and finalization. Users may return to earlier form steps until Passkey registration begins. Every failure identifies the failed check and a safe recovery action without displaying secrets.

The installer uses a PostgreSQL advisory lock during finalization. Concurrent installers cannot create two owners. Completed installations redirect the configured Admin path and installer endpoints reject further enrollment.

## Media Upload and Delivery

Uploads use a reservation/finalization protocol:

1. An authenticated Admin submits filename, MIME type, and byte size.
2. The server validates the requested object and creates a unique object key.
3. The server returns a signed PUT URL with a short expiry and constrained content type.
4. The browser uploads bytes directly to S3.
5. The browser asks the server to finalize.
6. The server performs `HEAD`, verifies size/type/checksum expectations, reads image dimensions when required, and commits metadata.

The File Manager shows an object only after finalization. The server rejects unsupported types, oversized files, invalid keys, and MIME mismatches. Object keys are generated by TomeCMS and never derived as trusted filesystem paths from a user filename.

Published media is public and cacheable. The Admin explains that the File Manager is not suitable for secrets. Private assets and per-object access control are deferred.

Deletion checks Post and Page references before marking an item for deletion. It removes the S3 object, then finalizes metadata deletion. A retry-safe deleting state handles an object-store failure without presenting a deleted item as successfully removed.

## Headless Content API

The first public contract is rooted at `/api/v1/content`:

| Route | Purpose |
| --- | --- |
| `GET /site` | Public Site Settings and locale configuration |
| `GET /posts` | Cursor-paginated Published Post editions |
| `GET /posts/{slug}` | One Published Post edition selected by locale |
| `GET /pages` | Cursor-paginated Published Page editions |
| `GET /pages/{slug}` | One Published Page edition selected by locale |
| `GET /categories` | Categories attached to Published Posts |
| `GET /navigation` | Resolved Header and Footer items for one locale |
| `GET /openapi.json` | OpenAPI description for the public contract |

Collection routes accept validated `locale`, `limit`, `cursor`, and relevant filter parameters. Limits have a conservative default and hard maximum. Cursors are opaque, signed, query-bound values based on deterministic sort keys. Invalid or mismatched cursors return `400`.

Successful list responses use:

```json
{
  "data": [],
  "meta": {
    "locale": "th",
    "limit": 20,
    "hasMore": false
  },
  "links": {
    "next": null
  }
}
```

Post and Page responses include TipTap `contentJson`, sanitized `contentHtml`, resolved media, SEO fields, timestamps, locale, translation identity, and Published sibling links. Internal auth, recovery, installation, and storage fields never enter public schemas.

Published endpoints use `Access-Control-Allow-Origin: *`, never accept cookies, and emit `ETag`, `Last-Modified`, and public cache directives. A matching conditional request returns `304` without a response body.

Draft preview uses an unguessable, hashed, content-scoped token with a short expiry. Preview responses use `Cache-Control: private, no-store`, omit CORS by default, and cannot list other drafts. Creating a preview token requires an owner session.

The bundled Astro Blog calls the same Published-content service functions directly. It does not call its own REST endpoint over HTTP. This guarantees identical publication, locale, Category, Navigation, and media-resolution rules while avoiding an internal network hop.

`TOME_CMS_FRONTEND_MODE=bundled` is the default. Setting it to `headless` disables bundled public content routes while retaining Admin, health, media, preview, and Content API routes.

## HTTP Errors, Logging, and CORS

Public API errors use `application/problem+json` with `type`, `title`, `status`, `detail`, `instance`, and `requestId`. Status behavior is consistent:

- `400` for malformed input, query parameters, or cursors.
- `401` for a missing or invalid Admin session.
- `403` for a valid session without the required authority.
- `404` for missing or non-Published public content.
- `409` for optimistic-concurrency and uniqueness conflicts.
- `413` for oversized requests or upload declarations.
- `415` for unsupported media types.
- `429` for installer, recovery, or authentication rate limits.
- `503` when required infrastructure is unavailable or migrations are pending.

Admin-facing messages explain what failed and what the owner can do next. Server logs include a generated request ID, route, status, duration, and safe error classification. Logs never include database/S3 secrets, session tokens, installation tokens, recovery codes, signed URLs, or complete WebAuthn payloads.

Only anonymous Published-content GET routes use wildcard CORS. Admin, installer, auth, recovery, preview, and upload-management routes are same-origin by default and validate request origin for state-changing operations.

## Deployment and Operations

The production Compose topology contains:

- `app`: the built Astro standalone Node server.
- `postgres`: a pinned PostgreSQL major with a persistent volume and health check.
- `minio`: S3-compatible storage with a persistent volume and health check.
- `minio-init`: a one-shot bucket and policy initializer.

The existing reverse-proxy model remains responsible for TLS, canonical host forwarding, compression, and request-size limits. The application trusts forwarded headers only from the documented proxy topology and still uses the configured public URL for security-sensitive origins.

`/health/live` reports only that the Node process can serve requests. `/health/ready` checks migration compatibility plus bounded PostgreSQL and S3 operations and returns no credentials or internal topology.

Backups treat PostgreSQL and S3 as one recovery point. Documentation provides a `pg_dump` procedure and an S3 mirror/versioning procedure. A successful database backup alone is not described as a complete TomeCMS backup.

The reset command defaults to a dry run, reports content/object/account counts, identifies the exact configured database and bucket, and requires an explicit destructive flag plus typed confirmation. Reset removes the installed owner, sessions, recovery data, content metadata, and media objects while retaining schema, migrations, environment secrets, and the installation token so the Wizard can run again.

## Incremental Migration Strategy

The migration proceeds in vertical slices on an isolated implementation branch:

1. Freeze existing behavior with focused service and route contract tests.
2. Add PostgreSQL/MinIO Compose, environment validation, Kysely, and migrations.
3. Add Better Auth, Passkey enrollment, sessions, recovery codes, and Admin-route protection.
4. Move Site Settings and installer state to PostgreSQL.
5. Move Categories and Post assignments.
6. Move Posts, Pages, and Navigation.
7. Move File Manager and editor uploads to S3.
8. Add the REST v1 Content API and switch bundled routes to shared Published-content services.
9. Run fresh-install, reset/reinstall, security, browser, and operational verification.
10. Remove Supabase packages, clients, migrations, scripts, documentation, and environment variables.
11. Set version `0.2.0` and complete the final clean-install release gate.

There is no runtime dual-write mode and no shipped toggle between Supabase and PostgreSQL. Supabase remains intact only on earlier commits until final cutover. Each slice must leave its own tests green, but the new release is considered deliverable only after Supabase is removed completely.

## Testing Strategy

### Unit and contract tests

Use Node's built-in test runner for pure validation and service behavior, including:

- Pagination cursor signing, query binding, versioning, and tampering.
- Recovery-code hashing, consumption, regeneration, and replay rejection.
- TipTap document validation, server HTML generation, sanitation, and size/depth limits.
- Stable API serialization and Problem Details responses.
- Media-key generation and public-URL resolution.
- Admin-path validation and route rewriting.

OpenAPI output is generated from the same runtime schemas used by route validation. Contract tests parse the generated document and validate representative success and error responses to prevent schema drift.

### Integration tests

Integration tests use disposable PostgreSQL and MinIO Compose services rather than mocked SQL or object storage. They verify migrations, constraints, transactions, signed uploads, finalization, cleanup, deletion recovery, Category invariants, concurrent updates, and Published-only queries.

### Browser tests

Playwright Chromium uses a virtual WebAuthn authenticator to cover initial registration, sign-in, a second Passkey, recovery-code consumption, session revocation, and enrollment replay. WebKit covers unsupported-device messaging, recovery UX, responsive Admin behavior, and normal authenticated navigation where an injected test session is appropriate.

Existing public and Admin suites continue to cover Posts, Pages, Categories, Navigation, File Manager, bilingual editions, preview, SEO, sitemap, and safe editor navigation.

### Security and operations tests

Focused tests cover:

- Installer-token and enrollment replay.
- Concurrent finalization.
- WebAuthn origin and RP mismatch.
- CSRF and untrusted Origin rejection.
- Authentication and recovery rate limits.
- Draft leakage through lists, detail endpoints, Categories, Navigation, sitemap, and cache variants.
- Cross-owner access even though the first release has one owner.
- Object-key traversal, MIME spoofing, size mismatch, signed-URL expiry, and incomplete upload cleanup.
- Fresh macOS bootstrap, production Compose readiness, reset/reinstallation, and PostgreSQL plus S3 restore.

Public Astro routes must still contain no client hydration directives and ship no application JavaScript. Admin editor routes remain React islands.

## Release Acceptance Criteria

- A clean macOS setup reaches the Wizard using one documented command after prerequisites are installed.
- A clean VPS deployment reaches the same Wizard through HTTPS.
- The Wizard creates one owner with a working Passkey and usable recovery codes.
- Losing the primary device can be recovered with a spare Passkey, one recovery code, or local CLI access.
- All existing content-management workflows operate on PostgreSQL and S3 without Supabase.
- Published Posts, Pages, Categories, Navigation, and Site Settings are available through documented REST v1 endpoints.
- Draft content is absent from anonymous APIs and caches.
- The bundled Astro theme and external API return equivalent content decisions.
- Changing the configured S3 public base URL does not require rewriting database content.
- Public routes retain their canonical, locale, structured-data, sitemap, and zero-application-JavaScript guarantees.
- Reset returns the site to the Wizard without deleting schema or environment secrets.
- `rg` finds no Supabase runtime import, command, secret name, or deployment prerequisite outside historical release notes.
- Type checks, production build, unit, integration, browser, security, and operations suites pass.

## Risks and Mitigations

### Passkey origin mistakes

An incorrect public URL can make every credential unusable. Bootstrap validates the configured HTTPS origin, the Wizard displays the RP identity before registration, and security-sensitive code never derives it from an arbitrary request Host.

### Partial installation

WebAuthn spans multiple requests and cannot be one database transaction. Expiring enrollment records, idempotent pending-owner handling, final advisory locking, and insertion of `site_settings` only after Passkey verification keep partial state recoverable.

### Database and object-store inconsistency

PostgreSQL cannot transact with S3. Upload reservations, finalize-after-HEAD, retry-safe deletion state, and cleanup commands make partial failures observable and recoverable.

### Backend rewrite regression

The existing CMS already has broad browser coverage. Vertical migration slices, shared service contracts, and a final clean-install gate limit the number of changing dimensions in each step.

### Scope expansion toward EmDash

EmDash's dynamic schemas, Portable Text conversion, plugin sandbox, multi-platform database support, and marketplace are separate product commitments. They remain explicit non-goals until a real TomeCMS use case justifies their operational and security cost.

## Delivery Boundary

This specification authorizes an implementation plan for the backend migration and Headless read API. It does not authorize custom collections, external write tokens, plugins, GraphQL, multi-user roles beyond the installed owner, or adoption of EmDash itself.
