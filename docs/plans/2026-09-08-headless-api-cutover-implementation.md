# Headless Content API and Supabase Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the versioned read-only REST API, draft-preview tokens, OpenAPI contract, conditional caching, optional headless-only mode, complete operational scripts/docs, remove every Supabase runtime dependency, and release TomeCMS 0.2.0.

**Architecture:** Public `/api/v1/content/*` routes validate requests with shared Zod schemas and call the same published-content functions as the bundled Astro theme. Public DTOs are explicit allowlists. Signed query-bound cursors provide deterministic pagination. A common response layer adds Problem Details, request IDs, CORS, cache headers, ETags, and conditional `304`. Final cutover removes Supabase only after fresh install, restore, reset/reinstall, Admin, media, public, and headless tests pass.

**Tech Stack:** Astro SSR, PostgreSQL/Kysely, Zod 4 JSON Schema, Node crypto, Better Auth, S3/MinIO, Playwright, Docker Compose, OpenAPI 3.1.

**Spec:** [`docs/specs/2026-09-08-headless-core-migration-design.md`](../specs/2026-09-08-headless-core-migration-design.md)

## Global Constraints

- Complete the previous four plans first.
- Run commands directly; do not use RTK.
- Public v1 is anonymous, read-only, Published-only REST. Do not add API keys, write tokens, GraphQL, dynamic collections, plugins, webhooks, or SDK generation.
- Keep the bundled Astro Blog enabled by default; `TOME_CMS_FRONTEND_MODE=headless` disables only bundled public pages, not Admin, auth, installer, recovery, health, media, preview, or Content API routes.
- Bundled Astro pages call server services directly. They must never fetch their own REST API.
- Public DTOs include only documented fields. Never spread database rows into JSON.
- Public v1 routes do not read cookies and use `Access-Control-Allow-Origin: *`. Admin/auth/installer/recovery/preview routes remain same-origin and never receive wildcard CORS.
- Preview tokens are content-scoped, hashed at rest, short-lived, non-listing, and `private, no-store`.
- Preserve zero application JavaScript, canonical/locale metadata, JSON-LD, sitemap behavior, and public URL shapes in bundled mode.
- Delete Supabase only after equivalent PostgreSQL/S3 behavior passes. There is no dual-run or migration importer.
- Final version is exactly `0.2.0`.
- Before every commit, stage only named files, run staged checks, inspect the staged patch, and scan for real secrets.

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| API schemas | `src/server/http/public-schemas.ts`, `src/server/http/serialize.ts`, `tests/unit/public-serialization.test.ts` | `src/types/cms.ts` |
| Cursor | `src/server/http/cursor.ts`, `tests/unit/cursor.test.ts` | none |
| Public HTTP | `src/server/http/problem.ts`, `src/server/http/public-response.ts`, `src/server/http/request-log.ts`, `tests/unit/public-http.test.ts` | none |
| Published queries | none | `src/server/content/published.ts`, settings/categories/navigation/media resolvers |
| REST routes | `src/pages/api/v1/content/site.ts`, `posts/index.ts`, `posts/[slug].ts`, `pages/index.ts`, `pages/[slug].ts`, `categories.ts`, `navigation.ts`, `openapi.json.ts` | none |
| OpenAPI | `src/server/http/openapi.ts`, `tests/unit/openapi.test.ts` | none |
| Preview | `src/server/db/migrations/005_preview_tokens.ts`, `src/server/content/previews.ts`, `src/pages/api/admin/previews.ts`, `src/pages/api/v1/content/preview/[token].ts`, `tests/integration/preview-tokens.test.ts` | DB types/migrator and Admin preview actions |
| Frontend mode/feeds | `src/pages/rss.xml.ts`, `tests/e2e/headless-mode.spec.ts` | `src/middleware.ts`, public Astro routes, `src/pages/robots.txt.ts`, `src/pages/sitemap.xml.ts` |
| Supabase removal | none | `package.json`, `package-lock.json`, `.gitignore`, source/tests/scripts/docs listed in Task 9 |
| Operations/release | `scripts/backup.ts`, `scripts/restore-check.ts`, `tests/operations/fresh-install.test.ts` | `scripts/dev-local-macos.sh`, `scripts/dev-local-windows.ps1`, `scripts/deploy-vps.sh`, `scripts/reset-installation.mjs`, `README.md`, `.env.example`, `package.json` |

---

## Task 1: Define explicit public DTO and query schemas

**Files:**

- Create: `src/server/http/public-schemas.ts`
- Create: `src/server/http/serialize.ts`
- Create: `tests/unit/public-serialization.test.ts`
- Modify: `src/types/cms.ts`

- [ ] **Step 1: Write the failing allowlist tests**

Feed serializers rows containing owner/auth/storage/internal fields and assert those fields are absent. Cover Post/Page content, resolved cover/media, translated siblings, Categories, Navigation, Site Settings, nullable SEO fields, timestamps, and exact camelCase output.

- [ ] **Step 2: Define query schemas**

```ts
export const localeQuerySchema = z.enum(['th', 'en']);
export const listQuerySchema = z.object({
  locale: localeQuerySchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2048).optional(),
}).strict();

export const postListQuerySchema = listQuerySchema.extend({
  category: z.string().trim().min(1).max(80).optional(),
}).strict();
```

Reject repeated singleton query params rather than silently choosing one. Detail routes require `locale` and validate slug with the existing normalized slug contract.

- [ ] **Step 3: Define output schemas and serializers**

Create Zod schemas for `PublicSite`, `PublicPost`, `PublicPage`, `PublicCategory`, `PublicNavigation`, `PublicMedia`, `PublicTranslation`, list metadata, links, and Problem Details. Export named serializers such as:

```ts
export function serializePublicPost(row: PublishedPost): PublicPost;
export function serializePublicPage(row: PublishedPage): PublicPage;
export function serializePublicSite(row: SiteSettings): PublicSite;
```

Post/Page serializers include `contentJson`, sanitized `contentHtml`, SEO fields, locale, `translationGroupId`, timestamps, Published siblings, resolved media, and Categories where relevant. They never use object spread on database rows.

- [ ] **Step 4: Run and commit**

```sh
npm run test:unit -- tests/unit/public-serialization.test.ts
npm run check
git add src/server/http/public-schemas.ts src/server/http/serialize.ts tests/unit/public-serialization.test.ts src/types/cms.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(api): define public content contract"
```

## Task 2: Add signed deterministic pagination cursors

**Files:**

- Create: `src/server/http/cursor.ts`
- Create: `tests/unit/cursor.test.ts`

- [ ] **Step 1: Write failing cursor tests**

Cover round trip, signature tamper, malformed base64url/JSON, wrong version, wrong resource, wrong locale/category query, invalid timestamp/UUID, deterministic encoding, and no cursor expiry. Cursors are query-bound, not time-bound.

- [ ] **Step 2: Implement the versioned cursor**

```ts
interface CursorClaims {
  v: 1;
  resource: 'posts' | 'pages';
  queryHash: string;
  publishedAt: string;
  id: string;
}

export function encodeCursor(claims: CursorClaims): string;
export function decodeCursor(cursor: string, expected: {
  resource: CursorClaims['resource'];
  query: Record<string, string | number | undefined>;
}): CursorClaims;
```

Canonicalize query keys in lexical order, hash with domain-separated HMAC using `TOME_CMS_CONTEXT_SECRET`, and sign the base64url payload with a second domain label. Verify using `timingSafeEqual`. Invalid/mismatched values throw `HttpError(400, 'Invalid pagination cursor.')` without explaining the signature.

- [ ] **Step 3: Run and commit**

```sh
npm run test:unit -- tests/unit/cursor.test.ts
git add src/server/http/cursor.ts tests/unit/cursor.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(api): sign pagination cursors"
```

## Task 3: Add Problem Details, conditional caching, CORS, and safe request logs

**Files:**

- Create: `src/server/http/problem.ts`
- Create: `src/server/http/public-response.ts`
- Create: `src/server/http/request-log.ts`
- Create: `tests/unit/public-http.test.ts`

- [ ] **Step 1: Write failing HTTP policy tests**

Assert Problem Details fields/content type, one request ID per response/log, `400/404/503` mappings, wildcard CORS only for public routes, no `Set-Cookie`, public cache headers, preview no-store, matching `If-None-Match` returning empty `304`, `If-Modified-Since`, and logs redacting known secret-like values.

- [ ] **Step 2: Implement the public response boundary**

```ts
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
}

export function problem(request: Request, status: 400 | 404 | 429 | 500 | 503, detail: string): Response;
export function publicJson(request: Request, value: unknown, options: {
  lastModified: Date;
  maxAge?: number;
}): Response;
export function privatePreviewJson(request: Request, value: unknown): Response;
```

Serialize once, derive a quoted SHA-256 ETag from bytes, compare `If-None-Match` before returning the body, and set `Last-Modified`. Public success and public Problem Details use `Access-Control-Allow-Origin: *` and `Vary` only for request headers that actually vary output. Preview responses omit wildcard CORS.

Use `crypto.randomUUID()` for request IDs. Log one structured JSON line with request ID, method, pathname, status, duration, and safe error class. Do not log query cursor/token values or request/response bodies.

- [ ] **Step 3: Run and commit**

```sh
npm run test:unit -- tests/unit/public-http.test.ts
git add src/server/http/problem.ts src/server/http/public-response.ts src/server/http/request-log.ts tests/unit/public-http.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(api): add cacheable public responses"
```

## Task 4: Add cursor-aware Published query services

**Files:**

- Modify: `src/server/content/published.ts`
- Modify: `src/server/content/categories.ts`
- Modify: `src/server/content/navigation.ts`
- Modify: `src/server/content/settings.ts`
- Modify: `src/server/media/service.ts`
- Create: `tests/integration/published-api-queries.test.ts`

- [ ] **Step 1: Write failing Published-only query tests**

Seed two owners, Thai/English editions, drafts/published rows with tied timestamps, Categories, missing/unpublished translations, Navigation, and media. Assert deterministic `(published_at desc, id desc)` pagination, no duplicates/gaps, query-bound cursors, draft exclusion from every resource, owner/internal-field exclusion at serialization, and last-modified changes after relevant updates.

- [ ] **Step 2: Extend focused services**

```ts
export interface PublishedPageResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  lastModified: Date;
}

export async function listPublishedPosts(input: PublicPostListInput): Promise<PublishedPageResult<PublishedPost>>;
export async function listPublishedPages(input: PublicPageListInput): Promise<PublishedPageResult<PublishedPage>>;
export async function listPublishedCategories(locale: PostLocale): Promise<PublishedCategory[]>;
```

Fetch `limit + 1`, then trim. Detail and list enrichment batch Categories/translations/media; do not issue one query per row. Category filtering matches the shared Category identity while returning only editions in the requested locale.

- [ ] **Step 3: Run and commit**

```sh
npm run test:integration:foundation -- tests/integration/published-api-queries.test.ts
npm run check
git add src/server/content/published.ts src/server/content/categories.ts src/server/content/navigation.ts src/server/content/settings.ts src/server/media/service.ts tests/integration/published-api-queries.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(api): paginate published content queries"
```

## Task 5: Implement REST v1 routes

**Files:**

- Create: `src/pages/api/v1/content/site.ts`
- Create: `src/pages/api/v1/content/posts/index.ts`
- Create: `src/pages/api/v1/content/posts/[slug].ts`
- Create: `src/pages/api/v1/content/pages/index.ts`
- Create: `src/pages/api/v1/content/pages/[slug].ts`
- Create: `src/pages/api/v1/content/categories.ts`
- Create: `src/pages/api/v1/content/navigation.ts`
- Create: `tests/e2e/content-api.spec.ts`

- [ ] **Step 1: Write the failing route contract**

Cover exact success envelopes, locale requirement, max/default limits, Category filter, next link, invalid/replayed-across-query cursor, Published details and translations, missing/draft 404, Categories, Header/Footer Navigation, Site Settings, `OPTIONS`, CORS, ETag/304, Last-Modified, cache directives, content type, and absence of cookies/internal fields.

- [ ] **Step 2: Implement thin route handlers**

Each handler performs only: parse path/query → call one published service → serialize explicit DTO → return through `publicJson`; errors pass through `problem`. List shape is exactly:

```ts
{
  data: items,
  meta: { locale, limit, hasMore },
  links: { next: nextCursor ? nextUrl(request.url, nextCursor) : null },
}
```

Detail routes use `Astro.params.slug` only after schema validation. No route imports Better Auth or reads cookies. Add `OPTIONS` with allowed methods/headers and no credentials.

- [ ] **Step 3: Run and commit**

```sh
npm run test:e2e -- tests/e2e/content-api.spec.ts --project=desktop
npm run check
npm run build
git add src/pages/api/v1/content tests/e2e/content-api.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(api): publish content rest v1"
```

## Task 6: Generate and verify OpenAPI 3.1 from runtime schemas

**Files:**

- Create: `src/server/http/openapi.ts`
- Create: `src/pages/api/v1/content/openapi.json.ts`
- Create: `tests/unit/openapi.test.ts`

- [ ] **Step 1: Write the failing contract-drift test**

Assert OpenAPI version `3.1.0`, all eight public routes, methods/parameters/statuses/content types, reusable schemas, no Admin/preview/storage/auth routes, and representative runtime success/Problem payloads parsing against exported schemas.

- [ ] **Step 2: Build the document without a new OpenAPI dependency**

Use Zod 4:

```ts
const schemas = {
  PublicPost: z.toJSONSchema(publicPostSchema, { target: 'draft-2020-12' }),
  PublicPage: z.toJSONSchema(publicPageSchema, { target: 'draft-2020-12' }),
  ProblemDetails: z.toJSONSchema(problemDetailsSchema, { target: 'draft-2020-12' }),
};
```

Build the small `paths` object explicitly so operation IDs, parameters, and response codes stay intentional. Serve through `publicJson` with long public caching and ETag.

- [ ] **Step 3: Run and commit**

```sh
npm run test:unit -- tests/unit/openapi.test.ts
npm run test:e2e -- tests/e2e/content-api.spec.ts --project=desktop
git add src/server/http/openapi.ts src/pages/api/v1/content/openapi.json.ts tests/unit/openapi.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "docs(api): serve the openapi contract"
```

## Task 7: Add content-scoped draft preview tokens

**Files:**

- Create: `src/server/db/migrations/005_preview_tokens.ts`
- Modify: `src/server/db/types.ts`
- Modify: `src/server/db/migrator.ts`
- Create: `src/server/content/previews.ts`
- Create: `src/pages/api/admin/previews.ts`
- Create: `src/pages/api/v1/content/preview/[token].ts`
- Modify: Post/Page editor preview actions
- Create: `tests/integration/preview-tokens.test.ts`
- Create: `tests/e2e/content-preview.spec.ts`

- [ ] **Step 1: Write failing scope/expiry/leak tests**

Cover Post and Page tokens, 30-minute expiry, hashed-at-rest token, owner authorization, wrong content/type, revoked/expired/random token, no list access, no sibling draft leakage, private no-store, no wildcard CORS, no referrer leakage, and token rotation.

- [ ] **Step 2: Add the exact table contract**

```ts
export interface PreviewTokenTable {
  id: string;
  owner_id: string;
  token_hash: string;
  content_type: 'post' | 'page';
  content_id: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
}
```

Use owner/content indexes and a unique hash. Store `sha256(rawToken)`, return the raw 32-byte base64url token once, and delete expired/revoked rows during token creation within a bounded owner scope.

- [ ] **Step 3: Implement preview endpoints**

Admin creation requires owner session/same-origin and returns one URL. Public preview looks up exactly one token hash, validates expiry/scope, loads exactly one owner's content row regardless of status, serializes through the public DTO, and returns `privatePreviewJson`. Never accept cookies as an alternative.

- [ ] **Step 4: Update editor Preview**

After autosave, request a scoped token then open the returned preview URL in a new tab. Keep the current popup-first technique so browsers do not block the tab while async save/token creation runs.

- [ ] **Step 5: Run and commit**

```sh
npm run test:integration:foundation -- tests/integration/preview-tokens.test.ts
npm run test:e2e -- tests/e2e/content-preview.spec.ts --project=desktop
npm run check
git add src/server/db/migrations/005_preview_tokens.ts src/server/db/types.ts src/server/db/migrator.ts src/server/content/previews.ts src/pages/api/admin/previews.ts src/pages/api/v1/content/preview src/components/admin/Editor.tsx src/components/admin/PageEditor.tsx tests/integration/preview-tokens.test.ts tests/e2e/content-preview.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(preview): add scoped draft links"
```

## Task 8: Add headless mode and first-party feed parity

**Files:**

- Create: `src/pages/rss.xml.ts`
- Create: `tests/e2e/headless-mode.spec.ts`
- Modify: `src/middleware.ts`
- Modify: bundled public Astro routes
- Modify: `src/pages/robots.txt.ts`
- Modify: `src/pages/sitemap.xml.ts`
- Modify: `tests/e2e/public-blog.spec.ts`
- Modify: `tests/e2e/public-pages-navigation.spec.ts`

- [ ] **Step 1: Write failing bundled/headless matrix tests**

Bundled mode: homepage, locale indexes, Posts, Pages, sitemap, RSS, canonical/JSON-LD, Navigation/Categories/media, and no hydration script. Headless mode: those bundled content routes return `404`; Admin/auth/install/health/media/preview/Content API remain available. Test path boundaries so `/api/v1/content/pages` is never hidden as a public Page.

- [ ] **Step 2: Add one route classifier**

```ts
export function isBundledFrontendPath(pathname: string): boolean;
```

Match only actual bundled route families and exact feed/sitemap paths. In middleware, return a plain Astro 404 before rendering when mode is `headless`. Do not conditionally delete routes at build time.

- [ ] **Step 3: Add RSS from shared services**

Build escaped XML from Published Posts with canonical URLs, title, description, and publication date. Use the same locale/site origin helpers as HTML/sitemap. Node/Astro response is XML with public cache headers and no client JavaScript; no new feed dependency is needed.

- [ ] **Step 4: Verify API/theme equivalence**

For seeded content, compare IDs/status/locale/categories/navigation/media decisions between rendered Astro pages and API DTOs. HTML presentation may differ; inclusion/exclusion decisions may not.

- [ ] **Step 5: Run and commit**

```sh
npm run test:e2e -- tests/e2e/headless-mode.spec.ts tests/e2e/public-blog.spec.ts tests/e2e/public-pages-navigation.spec.ts --project=desktop
npm run check
npm run build
git add src/pages/rss.xml.ts src/middleware.ts src/pages/robots.txt.ts src/pages/sitemap.xml.ts src/pages/[locale] src/pages/blog src/pages/index.astro tests/e2e/headless-mode.spec.ts tests/e2e/public-blog.spec.ts tests/e2e/public-pages-navigation.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(headless): make the bundled frontend optional"
```

## Task 9: Remove Supabase runtime and obsolete files

**Files:**

- Delete: `src/lib/supabase.ts`
- Delete: `scripts/configure-supabase.sh`
- Delete: `scripts/lib/supabase-environment.mjs`
- Delete: `supabase/config.toml`
- Delete: all `supabase/migrations/*.sql`
- Delete: obsolete Supabase-only API routes and E2E specs/helpers
- Modify: all remaining `src/`, `scripts/`, `tests/`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `README.md`

- [ ] **Step 1: Inventory every remaining reference before deletion**

```sh
rg -n -i 'supabase|PUBLIC_SUPABASE|SERVICE_ROLE|SUPABASE_SECRET|blog-media' --glob '!docs/specs/**' --glob '!docs/plans/**' .
```

Classify each hit as runtime, test, script, config, current documentation, or historical release note. Do not blindly replace strings.

- [ ] **Step 2: Remove runtime packages and provider files**

```sh
npm uninstall @supabase/ssr @supabase/supabase-js
```

Delete the Supabase client/config/migrations/configurator and obsolete `/api/upload`, `/api/media`, and old `/api/*` content routes after confirming all imports/callers use PostgreSQL/S3 `/api/admin/*` routes.

- [ ] **Step 3: Remove Supabase-only tests and fixtures**

Delete RLS/Data API/Storage policy tests whose guarantees are now covered by PostgreSQL service/auth/S3 tests. Keep user-visible behavior tests, changing setup to the disposable Compose stack. Do not preserve dead fixtures for history; Git already does that.

- [ ] **Step 4: Prove removal**

```sh
rg -n -i 'from .?@supabase|createClient\(|PUBLIC_SUPABASE|SUPABASE_(SERVICE_ROLE|SECRET)|supabase (start|stop|status|db|migration)' src scripts tests package.json .env.example README.md compose.yaml Dockerfile
npm ls @supabase/ssr @supabase/supabase-js
```

Expected: both commands report no runtime reference/package. Product-history documents may mention the migration; active prerequisites and commands may not.

- [ ] **Step 5: Run and commit**

```sh
npm run test:unit
npm run test:integration:foundation
npm run check
npm run build
git add -A src scripts tests supabase package.json package-lock.json .env.example .gitignore README.md
git diff --cached --check
git diff --cached --stat
git commit -m "refactor(core): remove supabase runtime"
```

Before committing, inspect `git diff --cached --name-status` to confirm no unrelated design/category work was swept into `git add -A`.

## Task 10: Replace local/VPS/reset/backup operations

**Files:**

- Create: `scripts/backup.ts`
- Create: `scripts/restore-check.ts`
- Create: `tests/operations/fresh-install.test.ts`
- Modify: `scripts/dev-local-macos.sh`
- Modify: `scripts/dev-local-windows.ps1`
- Modify: `scripts/deploy-vps.sh`
- Modify: `scripts/reset-installation.mjs`
- Modify: `scripts/bootstrap-core.mjs`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Write destructive-script self-tests first**

Cover dry-run defaults, explicit database/bucket display, exact confirmation phrase, no broad paths/globs, non-TTY refusal, preserved schema/env/install token, failed object deletion abort, and fresh Wizard readiness after successful reset.

- [ ] **Step 2: Make macOS the primary local path**

`npm run dev:macos` invokes the bootstrap helper, starts/waits PostgreSQL+MinIO, migrates, then starts Astro on the host. It must not require a manually prestarted Supabase container. Keep Windows helper functionally equivalent but label it secondary until its E2E operation test exists.

- [ ] **Step 3: Replace VPS deployment with Compose**

The VPS script checks Docker/Compose, writes a protected env only when absent, validates HTTPS public URL, pulls/builds pinned services, runs migrations as a one-shot application command, starts the production profile, and waits on `/health/ready`. Reverse-proxy/TLS configuration remains explicit and separate; do not silently obtain certificates or edit firewall rules.

- [ ] **Step 4: Add consistent backup and restore verification**

Backup creates one timestamped directory containing `pg_dump --format=custom`, a provider-neutral S3 mirror command output, and a manifest of checksums/config identifiers without secrets. Restore-check operates only on an explicitly named disposable Compose project, restores both Postgres and objects, then runs readiness plus representative content/media checks. Documentation states database-only backup is incomplete.

- [ ] **Step 5: Make reset return to Wizard safely**

Reset defaults to dry run, counts content/auth/sessions/recovery/reservations/media objects, requires `--execute` and `RESET <origin> <database-name> <bucket>`, deletes known objects, truncates application/auth data in FK-safe transaction, retains Kysely migration tables/schema/env/install token, and verifies `site_settings` absence plus empty object inventory.

- [ ] **Step 6: Run operations gate and commit**

Add a final `test:integration` package script that starts the explicitly named disposable Compose project, runs every `tests/integration/**/*.test.ts` file, and tears the project down in `finally`; the full-release command in Task 11 must not depend on an undefined script.

```sh
node scripts/reset-installation.mjs --self-test
node --import tsx scripts/backup.ts --self-test
node --import tsx scripts/restore-check.ts --self-test
bash -n scripts/dev-local-macos.sh scripts/deploy-vps.sh
MINIO_LICENSE_FILE=/dev/null docker compose --env-file .env.example config --quiet
npm run check
git add scripts package.json README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat(ops): operate postgres and s3 deployments"
```

## Task 11: Release TomeCMS 0.2.0 from a clean installation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `DESIGN.md` only if the shipped auth/installer UI introduced approved token changes
- Create: `docs/releases/0.2.0.md`

- [ ] **Step 1: Run the complete fresh-install acceptance matrix**

From an explicit disposable Compose project and empty volumes:

1. bootstrap infrastructure;
2. migrate;
3. complete Wizard with virtual Passkey;
4. exercise Posts/Pages/Categories/Navigation/File Manager/Profile/Settings;
5. verify REST/OpenAPI/cursors/CORS/cache/preview;
6. verify bundled public SEO/no-JS;
7. verify headless route suppression;
8. backup and restore to a second disposable project;
9. reset and reinstall;
10. verify recovery code, spare Passkey, and CLI recovery.

- [ ] **Step 2: Run security and leakage searches**

```sh
rg -n -i 'supabase|PUBLIC_SUPABASE|SERVICE_ROLE|SUPABASE_SECRET' src scripts tests package.json .env.example README.md compose.yaml Dockerfile
rg -n 'client:(load|idle|visible|media|only)' src/pages src/layouts src/components/blog
rg -n '(DATABASE_URL|BETTER_AUTH_SECRET|RECOVERY_PEPPER|S3_SECRET_ACCESS_KEY).*console' src scripts
```

Expected: no Supabase runtime hit, no public hydration directive, and no secret logging. Intentional Admin `client:only="react"` stays outside public route/component scope.

- [ ] **Step 3: Run every automated gate**

```sh
npm run test:unit
npm run test:integration
npm run test:e2e
npm run check
npm run build
```

Also run the operation suite on macOS. VPS HTTPS/Passkey acceptance must be performed on a real test hostname before claiming VPS readiness.

- [ ] **Step 4: Set and document the version**

```sh
npm version 0.2.0 --no-git-tag-version
```

Release notes list the clean-reinstall requirement, Passkey requirement, backup boundary, new environment contract, public API root, bundled/headless modes, and explicitly state no Supabase import path exists.

- [ ] **Step 5: Commit the release gate**

```sh
git add package.json package-lock.json README.md DESIGN.md docs/releases/0.2.0.md
git diff --cached --check
git diff --cached --stat
git diff --cached | rg -n '(password|secret|token|access[_-]?key)\s*[=:]\s*[^$<{]'
git commit -m "chore(release): prepare TomeCMS 0.2.0"
```

Stage `DESIGN.md` only if it actually changed for the shipped UI.

## Final Release Acceptance Gate

- [ ] Clean macOS bootstrap reaches the six-step Wizard with one documented command after prerequisites.
- [ ] Clean HTTPS VPS deployment reaches the same Wizard and registers/signs in with a Passkey.
- [ ] Recovery works with spare Passkey, one-time code, and local CLI.
- [ ] All Admin/content/media workflows use PostgreSQL, Better Auth, and S3 only.
- [ ] Published Site, Posts, Pages, Categories, and Navigation are documented at `/api/v1/content`.
- [ ] Drafts never leak into anonymous list/detail/category/navigation/sitemap/RSS/cache variants.
- [ ] Bundled Astro and REST API make equivalent inclusion/media/navigation decisions.
- [ ] `headless` mode disables only bundled public content routes.
- [ ] Public HTML ships zero application JavaScript.
- [ ] Reset retains schema/env/install token and returns to Wizard.
- [ ] PostgreSQL plus S3 backup/restore is verified as one recovery point.
- [ ] No Supabase runtime dependency, environment variable, command, or prerequisite remains.
- [ ] Version is `0.2.0`; unit, integration, E2E, build, type, security, and operations gates pass.
