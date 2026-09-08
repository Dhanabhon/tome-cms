# PostgreSQL Content Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Site Settings, Posts, Pages, Categories, Navigation, and every Admin content workflow from Supabase to focused Kysely services, while making the server—not the editor browser—the authority for generated sanitized HTML.

**Architecture:** Fixed PostgreSQL tables preserve the existing bilingual row model and translation-group Category membership. Focused functions under `src/server/content/` own authorization and transactions. Admin React islands call same-origin `/api/admin/*` routes; Astro pages call server services directly. Mutation inputs include `updatedAt` for optimistic concurrency and include TipTap JSON but never trusted HTML.

**Tech Stack:** PostgreSQL, Kysely, Better Auth owner sessions, Astro API routes, Zod 4, TipTap 2.27.3 server HTML generation, `sanitize-html`, React/Novel editor, Node/Playwright tests.

**Spec:** [`docs/specs/2026-09-08-headless-core-migration-design.md`](../specs/2026-09-08-headless-core-migration-design.md)

## Global Constraints

- Complete the Foundation and Passkey/Installer plans first. Activate the Better Auth middleware switch only after every Admin content endpoint in this plan uses PostgreSQL.
- Run commands directly; do not use RTK.
- This is a clean-reinstall schema. Do not import, read, copy, or dual-write Supabase data.
- Keep fixed content types only: Site Settings, Posts, Pages, Categories, and Navigation. No dynamic schema, generic repository, taxonomy framework, or plugin hooks.
- The browser never supplies `owner_id`, `author_id`, `translation_group_id`, `content_html`, publication timestamps, or resolved storage URLs.
- Preserve `/<locale>`, `/<locale>/blog/<slug>`, legacy default-locale redirects, canonical metadata, preview behavior, and zero application JavaScript on public routes.
- Keep the current save queue and 900 ms draft debounce. Fix the shared payload boundary once instead of adding special cases to each caller.
- Use PostgreSQL constraints/transactions for uniqueness, translation identity, Category fallback, and complete Navigation replacement.
- A stale `updatedAt` must return `409` and leave the newer row untouched.
- Do not delete Supabase packages, migrations, or storage code yet; Plan 4 migrates media and Plan 5 performs final removal.
- Before every commit, stage only named files and inspect/check/secret-scan the staged patch.

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| Packages/editor | `src/server/content/editor.ts`, `tests/unit/editor-rendering.test.ts` | `package.json`, `package-lock.json`, `src/lib/editor-content.ts`, `src/components/admin/DocumentCanvas.tsx` |
| Content schema | `src/server/db/migrations/003_content.ts`, `tests/integration/content-schema.test.ts` | `src/server/db/types.ts`, `src/server/db/migrator.ts` |
| HTTP common | `src/server/http/errors.ts`, `src/server/http/json.ts`, `tests/unit/http-errors.test.ts` | none |
| Settings/profile | `src/server/content/settings.ts` | `src/server/content/site-settings.ts`, `src/pages/api/settings.ts`, `src/pages/api/profile.ts`, `src/components/admin/SettingsForm.tsx`, `src/components/admin/ProfileForm.tsx` |
| Posts | `src/server/content/posts.ts`, `src/pages/api/admin/posts/index.ts`, `src/pages/api/admin/posts/categories.ts` | `src/components/admin/Editor.tsx`, Post Admin/preview Astro pages, `src/types/cms.ts` |
| Pages | `src/server/content/pages.ts`, `src/pages/api/admin/pages/index.ts` | `src/components/admin/PageEditor.tsx`, Page Admin/preview Astro pages, `src/types/cms.ts` |
| Categories | `src/server/content/categories.ts`, `src/pages/api/admin/categories/index.ts` | `src/components/admin/CategoryManager.tsx`, Category/Post Admin pages |
| Navigation | `src/server/content/navigation.ts`, `src/pages/api/admin/navigation/index.ts` | `src/components/admin/NavigationManager.tsx`, Admin/public navigation callers |
| Runtime cutover | none | `src/middleware.ts`, `src/components/admin/AdminShell.astro`, all public content Astro routes, `src/pages/sitemap.xml.ts` |
| Tests | `tests/integration/content-services.test.ts`, `tests/e2e/postgres-admin-content.spec.ts` | existing Admin/public E2E specs and `tests/e2e/support.ts` |

---

## Task 1: Make server-rendered editor HTML the only stored HTML

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/server/content/editor.ts`
- Modify: `src/lib/editor-content.ts`
- Modify: `src/components/admin/DocumentCanvas.tsx`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/components/admin/PageEditor.tsx`
- Create: `tests/unit/editor-rendering.test.ts`

- [ ] **Step 1: Pin the TipTap packages already selected by Novel**

The lockfile currently resolves TipTap 2.27.3. Make server imports explicit and keep one compatible version:

```sh
npm install --save-exact @tiptap/core@2.27.3 @tiptap/html@2.27.3 @tiptap/starter-kit@2.27.3 @tiptap/extension-image@2.27.3 @tiptap/extension-link@2.27.3
```

- [ ] **Step 2: Write the failing rendering and safety test**

Cover headings, lists, quote, code block, bold/italic/link/inline-code, image, an unsupported node, `javascript:` URLs, event attributes, deeply nested input, oversized JSON, empty publishable content, and deterministic output. Assert client HTML is absent from the accepted mutation schema.

```ts
test('generates and sanitizes HTML from TipTap JSON', () => {
  const document = editorDocumentSchema.parse({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Safe', marks: [{ type: 'bold' }] }] }],
  });
  assert.equal(renderEditorHtml(document), '<p><strong>Safe</strong></p>');
});
```

- [ ] **Step 3: Implement one shared extension set and render function**

Export the server contract:

```ts
export interface StoredEditorContent {
  contentJson: EditorDocument;
  contentHtml: string;
}

export function prepareEditorContent(input: unknown): StoredEditorContent;
export function renderEditorHtml(document: EditorDocument): string;
```

`prepareEditorContent` validates the existing 1 MB and depth bounds, uses `generateHTML(document, extensions)` from `@tiptap/html/server`, sanitizes through the existing allowlist, and throws `ValidationError` for unsupported structure. The extension configuration must match `DocumentCanvas` node/mark names. Do not accept a `contentHtml` argument.

- [ ] **Step 4: Remove HTML from the browser save state**

Change the shared editor callback to:

```ts
interface DocumentCanvasProps {
  initialContent: JSONContent;
  onChange: (contentJson: JSONContent) => void;
}
```

Remove `contentHtml` state, draft fields, effect dependencies, and request properties from both Post and Page editors. Novel may still call `editor.getHTML()` for its own UI only if required, but it is never serialized to the server.

- [ ] **Step 5: Run and commit**

```sh
npm run test:unit -- tests/unit/editor-rendering.test.ts
npm run check
git add package.json package-lock.json src/server/content/editor.ts src/lib/editor-content.ts src/components/admin/DocumentCanvas.tsx src/components/admin/Editor.tsx src/components/admin/PageEditor.tsx tests/unit/editor-rendering.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(content): render editor html on the server"
```

## Task 2: Create the fixed content schema and invariants

**Files:**

- Create: `src/server/db/migrations/003_content.ts`
- Modify: `src/server/db/types.ts`
- Modify: `src/server/db/migrator.ts`
- Create: `tests/integration/content-schema.test.ts`

- [ ] **Step 1: Write failing constraint and transaction tests**

Against disposable PostgreSQL, assert:

- unique `(translation_group_id, locale)` and `(locale, slug)` for Posts and Pages;
- draft/published status and publication timestamp behavior;
- owner-safe translation groups;
- one case-insensitive Category name per owner and one immutable `Uncategorized`;
- every Post translation group has at least one Category after create/replace/delete;
- Category assignments are shared by both editions;
- valid Home/Page/custom Navigation target shapes and atomic ordered replacement;
- owner foreign keys cannot cross accounts;
- content rows reject documents/HTML above the 1 MB storage ceiling.

- [ ] **Step 2: Add concrete Kysely table interfaces**

Extend `Database` with:

```ts
export interface TranslationGroupTable { id: string; owner_id: string; created_at: Timestamp; }
export interface PostTable extends ContentEditionColumns { cover_media_id: string | null; }
export interface PageTable extends ContentEditionColumns {}
export interface CategoryTable { id: string; owner_id: string; name: string; is_default: boolean; created_at: Timestamp; updated_at: Timestamp; }
export interface PostCategoryAssignmentTable { translation_group_id: string; category_id: string; owner_id: string; created_at: Timestamp; }
export interface NavigationItemTable {
  id: string;
  owner_id: string;
  locale: 'th' | 'en';
  location: 'header' | 'footer';
  kind: 'home' | 'page' | 'custom';
  label: string;
  page_id: string | null;
  url: string | null;
  position: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Define `ContentEditionColumns` explicitly with UUID IDs, translation group, locale, title, slug, JSON content, sanitized HTML, SEO fields, status, `published_at`, owner, and timestamps. Do not use `unknown` for JSON; reuse the existing `Json`/`EditorDocument` storage type.

- [ ] **Step 3: Implement `003_content`**

Create `post_translation_groups`, `page_translation_groups`, `posts`, `pages`, `categories`, `post_category_assignments`, and `navigation_items`. Use Postgres UUID generation, check constraints, composite owner FKs, partial published indexes, and timestamp triggers/functions defined in this migration.

Implement transaction helpers at the service layer rather than public SQL RPCs, because browsers no longer connect to PostgreSQL. For the at-least-one Category invariant, lock the translation-group row and perform create/replace/delete in one Kysely transaction; also add a deferred constraint trigger that raises at commit when an owned Post group has no assignment.

Backfill one `Uncategorized` row and any missing assignment for an owner/site finalized while Plan 2 was being developed, so applying `003_content` leaves both fresh and already-finalized development installations valid.

Navigation replacement validates target rows first, then deletes/inserts only the owner's selected locale/location inside one transaction.

- [ ] **Step 4: Extend installer finalization**

Modify the finalization transaction from Plan 2 to insert `Uncategorized` for the owner in the same transaction as `site_settings`. It must be idempotent under concurrent retries.

- [ ] **Step 5: Run and commit**

```sh
npm run test:integration:foundation -- tests/integration/content-schema.test.ts
npm run check
git add src/server/db/migrations/003_content.ts src/server/db/types.ts src/server/db/migrator.ts src/pages/api/install/finalize.ts tests/integration/content-schema.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(content): add fixed postgres content schema"
```

## Task 3: Standardize Admin HTTP errors and JSON parsing

**Files:**

- Create: `src/server/http/errors.ts`
- Create: `src/server/http/json.ts`
- Create: `tests/unit/http-errors.test.ts`

- [ ] **Step 1: Write failing classification tests**

Cover invalid JSON, Zod failures, unauthenticated/forbidden, not found, unique conflict, stale update, payload too large, and unexpected database errors. Assert unexpected provider text and SQL never enters the response.

- [ ] **Step 2: Implement the minimum shared boundary**

Export:

```ts
export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503, message: string) { super(message); }
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T>;
export function adminErrorResponse(error: unknown, requestId: string): Response;
```

`parseJson` rejects malformed, non-finite, over-depth, and over-byte input before domain work. `adminErrorResponse` maps known errors to `{ error, requestId }`, logs a safe classification for unknown errors, and returns generic `500` without serializing raw errors.

- [ ] **Step 3: Run and commit**

```sh
npm run test:unit -- tests/unit/http-errors.test.ts
git add src/server/http/errors.ts src/server/http/json.ts tests/unit/http-errors.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(http): normalize admin request failures"
```

## Task 4: Move Site Settings and Profile services

**Files:**

- Create: `src/server/content/settings.ts`
- Modify: `src/server/content/site-settings.ts`
- Modify: `src/pages/api/settings.ts`
- Modify: `src/pages/api/profile.ts`
- Modify: `src/components/admin/SettingsForm.tsx`
- Modify: `src/components/admin/ProfileForm.tsx`
- Modify: Settings/Profile Admin Astro pages
- Modify: `tests/e2e/site-settings.spec.ts`

- [ ] **Step 1: Freeze the current public/Admin behavior in tests**

Add stale-update, wrong-owner, validation, Tagline, locale, timezone, author links, and missing-avatar cases. New mutations include the loaded `updatedAt`.

- [ ] **Step 2: Implement focused services**

Export only the concrete calls used by routes/pages:

```ts
export async function getSiteSettings(): Promise<SiteSettings | null>;
export async function getOwnerSettings(ownerId: string): Promise<SiteSettings | null>;
export async function updateSiteSettings(ownerId: string, input: SiteSettingsMutation): Promise<SiteSettings>;
export async function updateOwnerProfile(ownerId: string, input: ProfileMutation): Promise<SiteSettings>;
```

Updates use `where owner_id = ? and updated_at = ?`, set `updated_at = now()`, and distinguish not-found from stale by one bounded existence check. Avatar ownership validation is deferred to Plan 4 until media tables exist; accept only `null` in this plan.

- [ ] **Step 3: Replace Supabase route calls**

Each endpoint calls `requireOwner`, `assertSameOrigin`, `parseJson`, and the focused service. Keep the existing public response keys used by React forms. Update forms to send `updatedAt` and refresh it from the response.

- [ ] **Step 4: Run and commit**

```sh
npm run test:e2e -- tests/e2e/site-settings.spec.ts --project=desktop
npm run check
git add src/server/content/settings.ts src/server/content/site-settings.ts src/pages/api/settings.ts src/pages/api/profile.ts src/components/admin/SettingsForm.tsx src/components/admin/ProfileForm.tsx src/pages/admin/settings.astro src/pages/admin/profile.astro tests/e2e/site-settings.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(settings): move site configuration to postgres"
```

## Task 5: Move Categories and shared Post membership

**Files:**

- Create: `src/server/content/categories.ts`
- Create: `src/pages/api/admin/categories/index.ts`
- Create: `src/pages/api/admin/posts/categories.ts`
- Modify: `src/components/admin/CategoryManager.tsx`
- Modify: Category/Post Admin Astro pages
- Modify: `tests/e2e/categories-api.spec.ts`
- Modify: `tests/e2e/category-manager.spec.ts`
- Modify: `tests/e2e/post-categories-editor.spec.ts`

- [ ] **Step 1: Point existing Category contracts at the new routes and make them red**

Switch test calls from `/api/categories` and `/api/posts/categories` to `/api/admin/categories` and `/api/admin/posts/categories`. Preserve all approved cases: default first, case-insensitive uniqueness, max 20, cross-owner rejection, shared editions, empty restores default, immutable default, deletion fallback, and post counts by logical group.

- [ ] **Step 2: Implement transaction-owned Category operations**

Export:

```ts
export async function listCategories(ownerId: string): Promise<PostCategorySummary[]>;
export async function createCategory(ownerId: string, name: string): Promise<PostCategory>;
export async function renameCategory(ownerId: string, id: string, name: string): Promise<PostCategory>;
export async function deleteCategory(ownerId: string, id: string): Promise<{ affectedPostGroups: number }>;
export async function replacePostCategories(ownerId: string, postId: string, categoryIds: string[]): Promise<string[]>;
export async function categoryIdsForPost(ownerId: string, postId: string): Promise<string[]>;
```

Lock affected translation groups with `for update`, validate all IDs in the same transaction, and rely on the deferred constraint trigger as the final invariant guard.

- [ ] **Step 3: Replace browser calls and remove Supabase Category helpers**

Update UI fetch paths and safe error parsing. Delete `src/lib/categories.ts` only after every import points to `src/server/content/categories.ts` from server code or the Admin API from browser code.

- [ ] **Step 4: Run and commit**

```sh
npm run test:e2e -- tests/e2e/categories-api.spec.ts tests/e2e/category-manager.spec.ts tests/e2e/post-categories-editor.spec.ts --project=desktop
npm run check
git add src/server/content/categories.ts src/pages/api/admin/categories src/pages/api/admin/posts/categories.ts src/components/admin/CategoryManager.tsx src/pages/admin/categories.astro src/pages/admin/index.astro tests/e2e/categories-api.spec.ts tests/e2e/category-manager.spec.ts tests/e2e/post-categories-editor.spec.ts src/lib/categories.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(categories): move category workflows to postgres"
```

## Task 6: Move Posts and Pages with optimistic concurrency

**Files:**

- Create: `src/server/content/posts.ts`
- Create: `src/server/content/pages.ts`
- Create: `src/pages/api/admin/posts/index.ts`
- Create: `src/pages/api/admin/pages/index.ts`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/components/admin/PageEditor.tsx`
- Modify: Post/Page Admin and preview Astro pages
- Modify: `src/types/cms.ts`
- Modify: existing Post/Page API and editor E2E tests

- [ ] **Step 1: Make Post/Page route contracts red at the new endpoints**

Switch tests to `/api/admin/posts` and `/api/admin/pages`. Add explicit assertions that `contentHtml`, `authorId`, `translationGroupId`, `publishedAt`, and unknown keys return `400`; the server response HTML is generated from JSON; stale `updatedAt` returns `409`; create/edit/publish/unpublish/delete and bilingual editions retain current behavior.

- [ ] **Step 2: Define mutation schemas once**

```ts
export const contentMutationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).or(z.literal('')),
  contentJson: editorDocumentSchema,
  metaTitle: z.string().trim().max(70).nullable(),
  metaDescription: z.string().trim().max(320).nullable(),
  status: z.enum(['draft', 'published']),
  updatedAt: z.iso.datetime().optional(),
}).strict();
```

Create schemas extend it with source edition IDs and locale. Update schemas require `id` and `updatedAt`. Post payloads also include Category IDs and nullable `coverMediaId`; until Plan 4, `coverMediaId` must be null.

- [ ] **Step 3: Implement focused Post/Page services**

Services derive owner/group/publication timestamps, call `prepareEditorContent`, normalize slugs, and use one transaction for Post plus Category membership. Creating a translation inherits Post cover and shared membership but not content. Publishing rejects empty content. Status mutation also uses optimistic concurrency.

Export concrete list/get/create/update/status/delete functions; do not create a generic `ContentRepository` shared by Posts and Pages.

- [ ] **Step 4: Update editor payloads and Admin pages**

Post save becomes one `/api/admin/posts` transaction including `categoryIds`, removing the current second membership request and its partial-save failure mode. Both editors track response `updated_at` in refs and send it on every subsequent save. Use `adminHref` for history replacement, preview, back, and language-edition navigation.

- [ ] **Step 5: Move previews to PostgreSQL**

Authenticated preview pages load the owner row through services and keep `noindex`, `no-store`, and sanitized `set:html`. Preview tokens for external/unauthed access are Plan 5; do not add them here.

- [ ] **Step 6: Run and commit**

```sh
npm run test:e2e -- tests/e2e/pages-api.spec.ts tests/e2e/pages-editor.spec.ts tests/e2e/admin-pages.spec.ts tests/e2e/admin-posts.spec.ts tests/e2e/editor-workflow.spec.ts tests/e2e/multilingual-posts.spec.ts --project=desktop
npm run check
git add src/server/content/posts.ts src/server/content/pages.ts src/pages/api/admin/posts src/pages/api/admin/pages src/components/admin/Editor.tsx src/components/admin/PageEditor.tsx src/pages/admin src/types/cms.ts tests/e2e
git diff --cached --check
git diff --cached --stat
git commit -m "feat(content): move posts and pages to postgres"
```

Review `git diff --cached --name-only` and unstage unrelated E2E files before committing; the broad path above is permitted only for files actually modified by this task.

## Task 7: Move Navigation and public query services

**Files:**

- Create: `src/server/content/navigation.ts`
- Create: `src/server/content/published.ts`
- Create: `src/pages/api/admin/navigation/index.ts`
- Modify: `src/components/admin/NavigationManager.tsx`
- Modify: Navigation Admin page
- Modify: public index/Post/Page routes and blog components
- Modify: `src/pages/sitemap.xml.ts`
- Modify: navigation/public E2E tests

- [ ] **Step 1: Freeze published-only decisions**

Add tests for locale isolation, draft exclusion, unpublished Navigation target exclusion, Header/Footer order, custom URL validation, missing content 404, translated siblings, Category badges, SEO metadata, sitemap draft exclusion, and no public hydration scripts.

- [ ] **Step 2: Implement Navigation replacement and resolution**

Export owner CRUD plus:

```ts
export async function getPublicNavigation(locale: PostLocale): Promise<{
  header: PublicNavigationItem[];
  footer: PublicNavigationItem[];
}>;
```

Resolve page targets only when the exact locale edition is Published. Use a five-second bounded in-process cache with explicit invalidation after settings/page/navigation mutations; one-process deployment is the approved ceiling.

- [ ] **Step 3: Add shared published queries**

Export direct service functions for bundled Astro callers:

```ts
export async function listPublishedPosts(input: PublishedListInput): Promise<PublishedPost[]>;
export async function getPublishedPost(locale: PostLocale, slug: string): Promise<PublishedPost | null>;
export async function listPublishedPages(input: PublishedListInput): Promise<PublishedPage[]>;
export async function getPublishedPage(locale: PostLocale, slug: string): Promise<PublishedPage | null>;
```

Implement only the current bundled needs now. Cursor pagination and stable public DTO serialization belong to Plan 5.

- [ ] **Step 4: Switch Astro public routes without self-HTTP**

Replace direct Supabase reads with the published/settings/navigation services. Preserve canonical redirects, `Astro.response.status = 404`, sanitized HTML, and zero client directives. Update sitemap to use the same published decisions.

- [ ] **Step 5: Activate Better Auth middleware and remove old content routes**

Once Tasks 4–7 are green, flip the single middleware switch prepared in Plan 2. Delete `/api/posts`, `/api/pages`, `/api/categories`, `/api/navigation`, `/api/settings`, and `/api/profile` only after every browser caller uses `/api/admin/*`. Supabase media/upload endpoints remain until Plan 4.

- [ ] **Step 6: Run and commit**

```sh
npm run test:e2e -- tests/e2e/navigation.spec.ts tests/e2e/public-pages-navigation.spec.ts tests/e2e/public-blog.spec.ts tests/e2e/admin-shell.spec.ts --project=desktop
npm run check
npm run build
git add src/server/content/navigation.ts src/server/content/published.ts src/pages/api/admin/navigation src/components/admin/NavigationManager.tsx src/pages/admin/navigation.astro src/pages/[locale] src/pages/blog src/pages/index.astro src/pages/sitemap.xml.ts src/middleware.ts src/pages/api tests/e2e
git diff --cached --check
git diff --cached --stat
git commit -m "feat(content): cut admin and public reads to postgres"
```

Again stage only actually modified route/test files; do not stage Supabase upload/media files yet.

## Task 8: Verify the PostgreSQL content cutover

**Files:**

- Create: `tests/integration/content-services.test.ts`
- Create: `tests/e2e/postgres-admin-content.spec.ts`
- Modify: `tests/e2e/support.ts`
- Modify: `README.md`

- [ ] **Step 1: Add transaction/concurrency integration coverage**

Test two simultaneous edits, duplicate slugs, translation collision, Category replacement rollback, Category delete fallback, Navigation rollback, and server HTML sanitation against real PostgreSQL.

- [ ] **Step 2: Add one end-to-end owner journey**

Fresh install → Passkey sign-in → create Categories → create Thai Post → assign several Categories → create English edition → create bilingual Pages → configure Header/Footer → publish → verify public output → unpublish and verify 404/sitemap removal.

- [ ] **Step 3: Remove Supabase fixtures from non-media tests**

Replace `createOwner`, Supabase client, RLS, and service-role setup with disposable PostgreSQL plus Better Auth helpers in every content/auth/public test. Keep media-specific Supabase fixtures only until Plan 4.

- [ ] **Step 4: Document the temporary boundary**

README states content/auth now use PostgreSQL/Better Auth while File Manager still uses Supabase until the next plan. Do not present this intermediate branch as release-ready.

- [ ] **Step 5: Run and commit**

```sh
npm run test:unit
npm run test:integration:foundation -- tests/integration/content-schema.test.ts tests/integration/content-services.test.ts
npm run test:e2e -- tests/e2e/postgres-admin-content.spec.ts --project=desktop
npm run check
npm run build
git add tests/integration/content-services.test.ts tests/e2e/postgres-admin-content.spec.ts tests/e2e/support.ts README.md
git diff --cached --check
git diff --cached --stat
git commit -m "test(content): verify postgres content workflows"
```

## PostgreSQL Content Completion Gate

- [ ] Every non-media Admin API uses Better Auth plus Kysely and lives under `/api/admin/*`.
- [ ] Client-provided HTML is rejected; stored HTML is generated and sanitized on the server.
- [ ] All update paths enforce `updatedAt` and return `409` on stale writes.
- [ ] Post + Category save is one transaction.
- [ ] Built-in public pages and sitemap use shared PostgreSQL published services directly.
- [ ] Public pages still ship no application JavaScript.
- [ ] Supabase remains only in media/upload and historical files pending Plans 4–5.
