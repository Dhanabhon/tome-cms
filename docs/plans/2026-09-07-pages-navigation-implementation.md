# Pages and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independently translated Pages and owner-managed Header/Footer navigation while preserving TomeCMS's existing blog homepage, security boundaries, and zero-JavaScript public rendering.

**Architecture:** Add `pages` and `navigation_items` in one forward-only Supabase migration. Keep Page and Post UI shells separate, extracting only the Novel canvas and serialized save mechanics they share. Admin CRUD and menu management go through authenticated Astro API routes; public Page and navigation reads happen on the Astro server and render as plain HTML.

**Tech Stack:** Astro 5 SSR, React 18 islands, Novel/Tiptap, TypeScript strict mode, Supabase Postgres/Auth/RLS, Zod 4, `sanitize-html`, Playwright, existing Tailwind/global design tokens.

**Spec:** [`docs/specs/2026-09-07-pages-navigation-design.md`](../specs/2026-09-07-pages-navigation-design.md)

## Global Constraints

- Run every shell command through `rtk`, per `/Users/tom/.codex/RTK.md`.
- Do not add packages. Existing browser APIs, React, Zod, Supabase, `sanitize-html`, and HTML drag events cover this release.
- Preserve the current uncommitted installer work in `src/pages/install.astro`, `src/styles/installer.css`, and `tests/e2e/installer.spec.ts`. Do not reset, overwrite, stage, or commit those user-owned changes.
- Keep the public Page route, Header, and Footer free of React islands, Astro client directives, and application JavaScript.
- Keep `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` server-only. Public navigation must return only `href`, `label`, and `kind`.
- Derive `author_id`, `owner_id`, and translation-group membership on the server. Reject those fields when supplied by a browser.
- Use exact-locale publication rules. Never fall back to the other Page edition.
- Stage only files named by the current task. Before every commit, run `rtk git diff --cached --check` and inspect `rtk git diff --cached --stat`.

---

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| Database | `supabase/migrations/20260907210000_create_pages_and_navigation.sql` | none |
| Domain/types | `src/lib/editor-content.ts`, `src/lib/pages.ts`, `src/lib/navigation-url.ts`, `src/lib/navigation.ts` | `src/types/cms.ts`, `src/lib/posts.ts`, `src/lib/i18n.ts` |
| Page API | `src/pages/api/pages/index.ts` | `src/pages/api/posts/index.ts` |
| Shared editor | `src/components/admin/DocumentCanvas.tsx`, `src/components/admin/useEditorSaveQueue.ts` | `src/components/admin/Editor.tsx` |
| Page Admin | `src/components/admin/PageEditor.tsx`, `src/components/admin/PageSettingsDrawer.tsx`, `src/pages/admin/pages/index.astro`, `src/pages/admin/pages/new.astro`, `src/pages/admin/pages/edit/[id].astro`, `src/pages/admin/pages/preview/[id].astro` | `src/components/admin/AdminShell.astro`, `src/styles/global.css` |
| Navigation Admin/API | `src/components/admin/NavigationManager.tsx`, `src/pages/admin/navigation.astro`, `src/pages/api/navigation/index.ts` | `src/styles/global.css` |
| Public site | `src/components/blog/PageArticle.astro`, `src/components/blog/Footer.astro`, `src/pages/[locale]/[slug].astro` | `src/components/blog/Header.astro`, `src/layouts/BaseLayout.astro`, `src/components/blog/SEOHead.astro`, `src/pages/sitemap.xml.ts`, `src/styles/global.css` |
| Install/reset/docs | none | `src/lib/installation.ts`, `scripts/reset-installation.mjs`, `package.json`, `README.md` |
| Tests | `tests/e2e/pages-navigation-rls.spec.ts`, `tests/e2e/pages-api.spec.ts`, `tests/e2e/pages-editor.spec.ts`, `tests/e2e/admin-pages.spec.ts`, `tests/e2e/navigation.spec.ts`, `tests/e2e/public-pages-navigation.spec.ts` | `tests/e2e/support.ts`, `tests/e2e/admin-shell.spec.ts` |

## Task 1: Lock the database and type contracts

**Files:**

- Create: `tests/e2e/pages-navigation-rls.spec.ts`
- Create: `supabase/migrations/20260907210000_create_pages_and_navigation.sql`
- Modify: `src/types/cms.ts`
- Modify: `tests/e2e/support.ts`

- [ ] **Step 1: Write the failing RLS, constraint, timestamp, and transaction tests**

Create `tests/e2e/pages-navigation-rls.spec.ts` with one serial desktop test group that creates two owners and proves all of these behaviors:

1. An owner can insert/select/update/delete their own draft Page.
2. A different authenticated owner cannot directly select either that draft or its Published form, update it, delete it, or insert a navigation row targeting it; an anonymous client can select only the Published form.
3. `locale + slug` and `translation_group_id + locale` duplicates fail.
4. A second owner cannot join the first owner's Page translation group.
5. First publish sets `published_at`; later update, unpublish, and republish retain the same timestamp while `updated_at` advances.
6. `replace_navigation_items` normalizes positions and leaves the old list intact after an invalid replacement.
7. A Page delete removes only its own navigation references and does not delete its sibling edition.

Use the authenticated clients returned by `createOwner`, not the service-role client, for all ownership assertions. Add cleanup in `finally`, deleting `navigation_items` before `pages` and then deleting both owners.

- [ ] **Step 2: Run the focused test and confirm the schema is absent**

Run:

```sh
rtk npm run test:e2e -- tests/e2e/pages-navigation-rls.spec.ts --project=desktop
```

Expected: FAIL with `pages` or `navigation_items` missing. A connection/setup failure is not the intended failure; start local Supabase first if needed.

- [ ] **Step 3: Add the single forward-only migration**

Create `supabase/migrations/20260907210000_create_pages_and_navigation.sql`. The Page portion must use these exact constraints and timestamp semantics:

```sql
create table public.page_translation_groups (
  id uuid primary key,
  author_id uuid not null references auth.users(id) on delete cascade
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  translation_group_id uuid not null default gen_random_uuid(),
  locale text not null check (locale in ('th', 'en')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  slug text not null check (char_length(slug) between 1 and 160),
  content_json jsonb not null,
  content_html text not null,
  meta_title text check (meta_title is null or char_length(meta_title) <= 70),
  meta_description text check (meta_description is null or char_length(meta_description) <= 320),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  author_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, slug),
  unique (translation_group_id, locale),
  unique (id, author_id, locale)
);

create index pages_public_lookup_idx on public.pages (locale, status, slug);
create index pages_owner_updated_idx on public.pages (author_id, updated_at desc);

create function public.set_page_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create trigger pages_set_timestamps
before insert or update on public.pages
for each row execute function public.set_page_timestamps();
```

Copy the concurrency-safe ownership pattern from `protect_post_translation_ownership` into `protect_page_translation_ownership`: insert/lock `page_translation_groups` on Page insert; reject mixed owners; and make `locale`, `translation_group_id`, and `author_id` immutable on update. Unlike Posts, Page `author_id` is never nullable.

Enable RLS and use separate policies:

- `anon` may select only Published Pages.
- `authenticated` may select, insert, update, and delete only rows where `(select auth.uid()) = author_id`.
- Revoke all access to `page_translation_groups`; only its security-definer trigger function uses it.
- Grant `anon` only `select` on `pages`; grant authenticated CRUD on `pages`.

Create Navigation with the composite Page reference and owner-only RLS:

```sql
create table public.navigation_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  locale text not null check (locale in ('th', 'en')),
  location text not null check (location in ('header', 'footer')),
  kind text not null check (kind in ('home', 'page', 'custom')),
  label text not null check (char_length(label) between 1 and 80 and label = btrim(label)),
  page_id uuid,
  url text check (url is null or char_length(url) <= 2048),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint navigation_items_target_check check (
    (kind = 'home' and page_id is null and url is null)
    or (kind = 'page' and page_id is not null and url is null)
    or (kind = 'custom' and page_id is null and url is not null)
  ),
  constraint navigation_items_page_owner_locale_fkey
    foreign key (page_id, owner_id, locale)
    references public.pages (id, author_id, locale)
    on delete cascade
);

create unique index navigation_items_home_key
  on public.navigation_items (owner_id, locale, location)
  where kind = 'home';
create unique index navigation_items_page_key
  on public.navigation_items (owner_id, locale, location, page_id)
  where kind = 'page';
create index navigation_items_public_order_idx
  on public.navigation_items (owner_id, locale, location, position, id);
```

Add an `updated_at` trigger using the existing media-trigger pattern. Grant authenticated CRUD, revoke `anon`, and add owner-only select/insert/update/delete policies.

Implement `public.replace_navigation_items(target_locale text, target_location text, menu_items jsonb)` as `security invoker`. It must:

- require `auth.uid()`;
- accept only `th|en`, `header|footer`, a JSON array, and at most 50 items;
- trim and validate labels at 1–80 characters;
- accept exactly `home`, `page`, or `custom` target shapes;
- reject duplicate Home, Page IDs, and normalized custom URLs;
- verify each Page is owned by `auth.uid()` and has `target_locale`;
- accept relative URLs only when they start with one `/`, and absolute URLs only when they match an HTTP(S) scheme without whitespace;
- delete only the caller's selected locale/location;
- insert each row at its array ordinal minus one;
- `return query` the new rows ordered by `position, id`.

Revoke function execution from `public` and grant it only to `authenticated`. Any raised exception must roll back the earlier delete automatically; do not add a second transaction layer in application code.

- [ ] **Step 4: Add strict TypeScript rows, mutations, and RPC typing**

Extend `src/types/cms.ts` with these domain contracts:

```ts
export type PageLocale = PostLocale;
export type PageStatus = PostStatus;

export interface Page {
  id: string;
  translation_group_id: string;
  locale: PageLocale;
  title: string;
  slug: string;
  content_json: EditorDocument;
  content_html: string;
  meta_title: string | null;
  meta_description: string | null;
  status: PageStatus;
  published_at: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
}

export interface PageTranslationSummary {
  id: string;
  locale: PageLocale;
  status: PageStatus;
  title: string;
}

export type NavigationLocation = 'header' | 'footer';
export type NavigationKind = 'home' | 'page' | 'custom';

export interface NavigationItem {
  id: string;
  owner_id: string;
  locale: PageLocale;
  location: NavigationLocation;
  kind: NavigationKind;
  label: string;
  page_id: string | null;
  url: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface NavigationMutationItem {
  kind: NavigationKind;
  label: string;
  pageId: string | null;
  url: string | null;
}

export interface PublicNavigationItem {
  href: string;
  kind: NavigationKind;
  label: string;
}
```

Add `PageInsert`, `PageUpdate`, `PageMutationInput`, table mappings for `pages` and `navigation_items`, and this RPC entry under `Database.public.Functions`:

```ts
replace_navigation_items: {
  Args: {
    menu_items: Json;
    target_locale: PageLocale;
    target_location: NavigationLocation;
  };
  Returns: NavigationItem[];
};
```

Do not weaken existing Post types and do not introduce `any`.

- [ ] **Step 5: Apply the migration and run the database contract test**

Run:

```sh
rtk npx supabase migration up --local
rtk npm run test:e2e -- tests/e2e/pages-navigation-rls.spec.ts --project=desktop
rtk npm run check
```

Expected: all pass. Inspect local Supabase logs if PostgREST has not reloaded the schema cache.

- [ ] **Step 6: Commit the database contract**

```sh
rtk git add supabase/migrations/20260907210000_create_pages_and_navigation.sql src/types/cms.ts tests/e2e/pages-navigation-rls.spec.ts tests/e2e/support.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(db): add pages and navigation schema"
```

## Task 2: Share content validation and implement the Page API

**Files:**

- Create: `src/lib/editor-content.ts`
- Create: `src/lib/pages.ts`
- Create: `src/pages/api/pages/index.ts`
- Create: `tests/e2e/pages-api.spec.ts`
- Modify: `src/lib/posts.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `src/pages/api/posts/index.ts`

- [ ] **Step 1: Write failing Page API tests**

In `tests/e2e/pages-api.spec.ts`, cover unauthenticated `401`; malformed JSON and strict payload `400`; draft creation; generated slug; reserved `blog` slug `400`; duplicate locale slug `409`; linked translation creation; duplicate edition `409`; foreign source `404`; owner-scoped GET/PUT/PATCH/DELETE; stored-XSS removal; empty Publish rejection; and preservation of `published_at` across unpublish/republish.

Include hostile inputs for `author_id`, `authorId`, `owner_id`, and `translation_group_id` and expect `400`.

- [ ] **Step 2: Run the test and confirm the endpoint is missing**

```sh
rtk npm run test:e2e -- tests/e2e/pages-api.spec.ts --project=desktop
```

Expected: FAIL because `/api/pages` does not exist.

- [ ] **Step 3: Extract the existing editor-document and HTML boundary once**

Move the recursive editor schema, `MAX_DOCUMENT_BYTES`, sanitize options, `hasMeaningfulHtml`, `editorText`, and `hasMeaningfulContent` to `src/lib/editor-content.ts`. Export this exact surface:

```ts
export const MAX_DOCUMENT_BYTES = 1_000_000;
export const editorDocumentSchema: z.ZodType<EditorDocument>;
export const sanitizedContentHtmlSchema: z.ZodType<string>;
export function editorText(node: EditorNode): string;
export function hasMeaningfulContent(node: EditorNode): boolean;
export function hasMeaningfulHtml(html: string): boolean;
```

Retain the existing 100-level editor-node validation cap, 256-level request JSON cap, allowed tags/attributes/schemes, link `rel="noopener noreferrer"`, and lazy/async image transforms. Re-export `editorText` and `hasMeaningfulContent` from `src/lib/posts.ts` so existing imports remain stable.

Update `src/pages/api/posts/index.ts` to consume those exports without changing Post payloads, error copy, status codes, or sanitizer behavior. Keep the tiny request-body reader local for now; only two endpoints need it and a shared request framework is not justified.

- [ ] **Step 4: Add Page paths, filtering, descriptions, and reserved slugs**

Create `src/lib/pages.ts` with only these functions/constants:

```ts
export const RESERVED_PAGE_SLUGS = new Set(['blog']);

export function resolvePageSlug(value: string | undefined, title: string) {
  return slugify(value || title, { lower: true, strict: true, trim: true })
    || `page-${crypto.randomUUID().slice(0, 8)}`;
}

export function pageDescription(
  page: Pick<Page, 'content_json' | 'meta_description'>,
  fallback: string,
) {
  if (page.meta_description) return page.meta_description;
  const text = editorText(page.content_json).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text) : fallback;
}
```

Also add `AdminPageFilters` and `filterAdminPages` matching the current in-memory Post-list convention. Add `pagePath(page)` to `src/lib/i18n.ts` and reuse `isPostLocale` for the shared `th|en` domain; do not rename existing Post APIs in this release.

- [ ] **Step 5: Implement owner-scoped Page CRUD**

Create `src/pages/api/pages/index.ts` by following the existing Post endpoint's handler layout and response shape, replacing only Page-specific fields. Its common payload is:

```ts
const pageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.union([
    z.string().trim().max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    z.literal(''),
  ]).optional(),
  contentJson: editorDocumentSchema,
  contentHtml: sanitizedContentHtmlSchema,
  metaTitle: z.union([z.string().trim().max(70), z.null()]).optional(),
  metaDescription: z.union([z.string().trim().max(320), z.null()]).optional(),
  status: z.enum(POST_STATUSES),
}).strict();
```

Add the JSON-size refinement and publishable-content refinement used by Posts. `POST` may additionally accept only `locale` plus `sourcePageId`; `PUT` may additionally accept only `id`; `PATCH` accepts only `id` and `status`.

Before insert/update, resolve the slug and reject `RESERVED_PAGE_SLUGS` with `400`. On translation creation, look up the source by both `id` and `author_id`, derive its `translation_group_id`, and reject same-locale or existing editions. On a normal creation, derive locale from `site_settings.default_locale`.

Map errors consistently:

- `pages_translation_group_id_locale_key` → `409 That language edition already exists.`
- other `23505` → `409 A page with this slug already exists in this language.`
- missing/foreign row → `404 Page not found.`
- invalid request → `400 Invalid page payload.`
- unexpected database failure → generic `500`, detail in server log only.

Use optimistic `updated_at` matching for `PATCH`, exactly as Posts do, so a simultaneous autosave cannot be overwritten by Publish/Unpublish.

- [ ] **Step 6: Run Page and Post API regressions**

```sh
rtk npm run test:e2e -- tests/e2e/pages-api.spec.ts tests/e2e/admin-posts.spec.ts tests/e2e/multilingual-posts.spec.ts --project=desktop
rtk npm run check
```

Expected: all pass; the stored HTML contains no script or event-handler payload.

- [ ] **Step 7: Commit the Page API**

```sh
rtk git add src/lib/editor-content.ts src/lib/pages.ts src/lib/posts.ts src/lib/i18n.ts src/pages/api/pages/index.ts src/pages/api/posts/index.ts tests/e2e/pages-api.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(pages): add secured page API"
```

## Task 3: Extract the shared editor primitives without changing Posts

**Files:**

- Create: `src/components/admin/DocumentCanvas.tsx`
- Create: `src/components/admin/useEditorSaveQueue.ts`
- Modify: `src/components/admin/Editor.tsx`
- Verify: `tests/e2e/editor-workflow.spec.ts`
- Verify: `tests/e2e/editor-media.spec.ts`
- Verify: `tests/e2e/editor-cleanup.spec.ts`

- [ ] **Step 1: Record the passing Post-editor baseline**

```sh
rtk npm run test:e2e -- tests/e2e/editor-workflow.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/editor-cleanup.spec.ts --project=desktop
```

Expected: PASS before refactoring. Stop if this baseline is already red.

- [ ] **Step 2: Extract the Novel canvas**

Move `editorImage`, Novel extensions, `normalizedLink`, `FormattingBubble`, and the `EditorRoot`/`EditorContent` tree into `src/components/admin/DocumentCanvas.tsx` with this public contract:

```ts
interface DocumentCanvasProps {
  initialContent: JSONContent;
  onChange: (contentJson: JSONContent, contentHtml: string) => void;
}

export default function DocumentCanvas({ initialContent, onChange }: DocumentCanvasProps) {
  return (
    <EditorRoot>
      <EditorContent
        className="editor-canvas editor-content admin-editor-content"
        editorProps={{
          attributes: {
            class: 'prose max-w-none prose-headings:font-sans prose-a:text-link prose-img:rounded-lg',
          },
          handleDOMEvents: { keydown: (_view, event) => handleCommandNavigation(event) },
          handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadFn),
          handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
        }}
        extensions={extensions}
        initialContent={initialContent}
        onUpdate={({ editor }) => onChange(editor.getJSON(), editor.getHTML())}
      >
        <SlashCommands />
        <FormattingBubble />
        <BlockInsertMenu />
      </EditorContent>
    </EditorRoot>
  );
}
```

Do not change slash commands, bubble formatting, Media Library insertion, paste, or drop behavior.

- [ ] **Step 3: Extract only the serialized save lifecycle**

Create `src/components/admin/useEditorSaveQueue.ts`. It may be generic over draft/entity, but its returned surface must remain small:

```ts
export type EditorSaveState = 'Saved' | 'Saving…' | 'Unsaved' | 'Save failed';

export interface EditorSaveQueue<TEntity, TStatus> {
  dirty: boolean;
  dirtyRef: React.MutableRefObject<boolean>;
  markDirty: () => void;
  pendingCount: React.MutableRefObject<number>;
  persist: (status?: TStatus) => Promise<TEntity>;
  saveState: EditorSaveState;
}
```

The hook owns `changeVersion`, the promise tail, pending count, dirty state, and save-state transitions. It receives a `snapshot()` callback and a `save(snapshot, status)` callback. Preserve the current guarantees:

- saves execute in creation order;
- one failed save does not poison the tail;
- a response marks the editor Saved only when no newer change exists;
- errors leave content dirty and set `Save failed`;
- `persist` rejects so the caller can stop navigation or publishing.

Keep preview-window handling, page-departure locking, and route-specific navigation in each editor shell; those paths differ and extracting them would add conditionals without removing risk.

- [ ] **Step 4: Rewire the existing Post Editor**

Replace its inline Novel canvas with `DocumentCanvas` and its inline queue/version bookkeeping with `useEditorSaveQueue`. Do not change Post routes, payload fields, cover handling, translation switching, autosave delay (`900ms`), toolbar copy, or settings drawer.

- [ ] **Step 5: Re-run the Post-editor contract**

```sh
rtk npm run test:e2e -- tests/e2e/editor-workflow.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/editor-cleanup.spec.ts --project=desktop
rtk npm run check
```

Expected: all pass unchanged.

- [ ] **Step 6: Commit the shared editor primitives**

```sh
rtk git add src/components/admin/DocumentCanvas.tsx src/components/admin/useEditorSaveQueue.ts src/components/admin/Editor.tsx
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "refactor(editor): share document editing primitives"
```

## Task 4: Build the focused Page editor and preview workflow

**Files:**

- Create: `src/components/admin/PageEditor.tsx`
- Create: `src/components/admin/PageSettingsDrawer.tsx`
- Create: `src/components/blog/PageArticle.astro`
- Create: `src/pages/admin/pages/new.astro`
- Create: `src/pages/admin/pages/edit/[id].astro`
- Create: `src/pages/admin/pages/preview/[id].astro`
- Create: `tests/e2e/pages-editor.spec.ts`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/support.ts`

- [ ] **Step 1: Write the failing Page-editor workflow tests**

In `tests/e2e/pages-editor.spec.ts`, cover:

- unauthenticated deep links return through login to the exact Page editor URL;
- new Page editor mounts through `client:only="react"` and leaves exactly one `<main>` landmark;
- autosave serializes rapid title/body changes and changes history to `/admin/pages/edit/:id`;
- Preview opens immediately, flushes the newest draft, uses `noindex, nofollow`, and is owner-scoped;
- Publish requires content; Settings edits slug/meta title/meta description;
- TH/EN switch saves before navigation and creates only the missing edition;
- Page UI has no cover-image, author, or reading-time controls;
- 320/375/414/768/1280/1440 widths have no horizontal overflow and interactive targets remain at least 44px.

Reuse `cleanupEditor`; extend it to remove `navigation_items` and `pages` for the supplied owners before deleting them.

- [ ] **Step 2: Run the test and confirm Page editor routes are missing**

```sh
rtk npm run test:e2e -- tests/e2e/pages-editor.spec.ts --project=desktop
```

Expected: FAIL on the missing routes/components.

- [ ] **Step 3: Build Page settings without Post-only controls**

Create `PageSettingsDrawer.tsx` by retaining the accessible native `<dialog>` lifecycle from `PostSettingsDrawer`, but expose only:

```ts
interface PageSettingsDrawerProps {
  errorMessage: string | null;
  metaDescription: string;
  metaTitle: string;
  onChangeMetaDescription: (value: string) => void;
  onChangeMetaTitle: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onClose: () => void;
  open: boolean;
  slug: string;
}
```

Use the existing `.admin-editor-settings`, `.admin-field`, and `.admin-control` styles. Title the dialog `Page settings`. Do not include cover, author, template, parent, or menu placement.

- [ ] **Step 4: Build the separate Page editor shell**

Create `PageEditor.tsx` using `DocumentCanvas` and `useEditorSaveQueue`. Its draft is exactly:

```ts
interface PageEditorDraft {
  contentHtml: string;
  contentJson: JSONContent;
  metaDescription: string | null;
  metaTitle: string | null;
  slug: string;
  title: string;
}
```

Send creates/updates to `/api/pages`; use `sourcePageId` only when creating a translation. On first save, replace browser history with `/admin/pages/edit/${savedPage.id}`. The toolbar must say `Back to Pages` and link to `/admin/pages`, use Page-specific Preview/Edit routes, and retain the existing 900ms debounce, save-state live region, popup fallback, navigation cancellation, and save-before-language-switch behavior.

Use `Untitled page` and accessible label `Page title`. Publish/Update status comes only from the saved Page response.

- [ ] **Step 5: Add authenticated new/edit/preview routes**

Follow the current Post route patterns, changing paths and queries to `pages`:

- `/admin/pages/new` derives default locale from settings; a translation request requires valid `sourcePageId` and `locale`, verifies ownership, and rejects an already-existing edition.
- `/admin/pages/edit/[id]` fetches one owned Page plus same-group summaries and strips `translation_group_id` before passing props to the client island.
- `/admin/pages/preview/[id]` fetches one owned persisted Page, sets `Cache-Control: private, no-store`, renders `PageArticle`, and includes `noindex, nofollow` in the Admin layout.

Mount the editor exactly as a client-only island:

```astro
<PageEditor client:only="react" locale={locale} sourcePage={sourcePage} translations={translations}>
  <div class="admin-editor-fallback" slot="fallback" role="status">Loading editor…</div>
</PageEditor>
```

`PageArticle.astro` renders one `<h1>` and sanitized `content_html` inside the existing typography width. It receives a `preview` boolean only to show the preview label; it must not render cover, author, or date.

- [ ] **Step 6: Run the focused editor tests and Post regression**

```sh
rtk npm run test:e2e -- tests/e2e/pages-editor.spec.ts tests/e2e/editor-workflow.spec.ts --project=desktop
rtk npm run check
```

Expected: Page and Post editors pass.

- [ ] **Step 7: Commit the Page editor**

```sh
rtk git add src/components/admin/PageEditor.tsx src/components/admin/PageSettingsDrawer.tsx src/components/blog/PageArticle.astro src/pages/admin/pages/new.astro 'src/pages/admin/pages/edit/[id].astro' 'src/pages/admin/pages/preview/[id].astro' src/styles/global.css tests/e2e/pages-editor.spec.ts tests/e2e/support.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(pages): add page editor workflow"
```

## Task 5: Add the Pages dashboard and Admin information architecture

**Files:**

- Create: `src/pages/admin/pages/index.astro`
- Create: `tests/e2e/admin-pages.spec.ts`
- Modify: `src/components/admin/AdminShell.astro`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/admin-shell.spec.ts`

- [ ] **Step 1: Write failing dashboard and sidebar tests**

Test URL-backed status/language/search filters, updated-time formatting in configured timezone, sibling links, missing-translation action, Edit/Preview/Publish/Unpublish/Delete, delete confirmation naming the edition and menu-reference consequence, retained nav rows on unpublish, cascading nav deletion, empty state, mobile rows, and sidebar order.

The expected sidebar links are:

```ts
['Posts', 'Pages', 'Media', 'Navigation', 'Profile', 'Settings']
```

- [ ] **Step 2: Run the focused tests and confirm failure**

```sh
rtk npm run test:e2e -- tests/e2e/admin-pages.spec.ts tests/e2e/admin-shell.spec.ts --project=desktop
```

Expected: FAIL because Pages/Navigation links and Pages dashboard are absent.

- [ ] **Step 3: Extend AdminShell**

Change its active union to:

```ts
active: 'media' | 'navigation' | 'pages' | 'posts' | 'profile' | 'settings';
```

Insert `Pages` after Posts and `Navigation` after Media. Keep View site opening a new tab and preserve mobile-dialog focus behavior.

- [ ] **Step 4: Implement `/admin/pages` using established list controls**

Use server-side auth, `getSiteSettings`, `filterAdminPages`, `UiSelect`, and the Post dashboard's URL-query conventions. Each row must show title, `/${locale}/${slug}`, locale badge, status, updated/published timestamp, sibling link/action, and a `<details>` action menu.

Use `/api/pages` for row `PATCH` and `DELETE`. Confirmation copy for deletion must state that this edition and its menu references are permanently removed; confirmation copy for Unpublish must state that placements stay saved but disappear publicly until republished.

Do not add a client island for the list. The existing small inline action script is sufficient.

- [ ] **Step 5: Run the dashboard and shell tests**

```sh
rtk npm run test:e2e -- tests/e2e/admin-pages.spec.ts tests/e2e/admin-shell.spec.ts --project=desktop
rtk npm run check
```

Expected: all pass at desktop and mobile project widths covered by the tests.

- [ ] **Step 6: Commit the Pages dashboard**

```sh
rtk git add src/pages/admin/pages/index.astro src/components/admin/AdminShell.astro src/styles/global.css tests/e2e/admin-pages.spec.ts tests/e2e/admin-shell.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(pages): add admin page dashboard"
```

## Task 6: Implement the Navigation API and public resolver

**Files:**

- Create: `src/lib/navigation-url.ts`
- Create: `src/lib/navigation.ts`
- Create: `src/pages/api/navigation/index.ts`
- Create: `tests/e2e/navigation.spec.ts`

- [ ] **Step 1: Write failing API and resolver tests**

Cover authenticated GET, unauthenticated `401`, four independent locale/location lists, strict PUT payload, max 50 items, label limits, duplicate targets, Page ownership/locale, draft Page acceptance, relative URL rules, HTTP(S) normalization, unsafe scheme rejection, failed replacement rollback, returned normalized positions, and server resolver omission of Draft Page targets.

- [ ] **Step 2: Run the test and confirm the endpoint is missing**

```sh
rtk npm run test:e2e -- tests/e2e/navigation.spec.ts --project=desktop
```

Expected: FAIL on `/api/navigation`.

- [ ] **Step 3: Implement the shared URL normalizer**

Create `src/lib/navigation-url.ts` as a pure browser/server module:

```ts
export function normalizeNavigationUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || /\s/.test(candidate)) return null;
  if (candidate.startsWith('/')) return candidate.startsWith('//') ? null : candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement the authenticated Navigation endpoint**

`GET /api/navigation` returns all owned navigation rows ordered by locale/location/position/id plus all owned Page summaries (`id`, `translation_group_id`, `locale`, `title`, `slug`, `status`). This single response lets the React island retain edits while switching all four tabs.

`PUT /api/navigation` accepts only:

```ts
{
  locale: 'th' | 'en';
  location: 'header' | 'footer';
  items: Array<{
    kind: 'home' | 'page' | 'custom';
    label: string;
    pageId: string | null;
    url: string | null;
  }>;
}
```

Use discriminated strict Zod schemas so each kind has exactly the correct target. Normalize custom URLs before duplicate checks and RPC mapping. Map each item to database keys `{ kind, label, page_id, url }`, call `replace_navigation_items`, and return `{ items }`.

Map authentication to `401`, validation to `400`, missing/foreign/wrong-locale Page targets to `400`, and unexpected failures to generic `500`. Do not return owner IDs or Page content.

- [ ] **Step 5: Add the server-only public resolver and cache**

Create `src/lib/navigation.ts` with:

```ts
export interface PublicNavigation {
  footer: PublicNavigationItem[];
  header: PublicNavigationItem[];
}

export async function getPublicNavigation(locale: PageLocale): Promise<PublicNavigation>;
export function invalidatePublicNavigationCache(): void;
```

Use `getSiteSettings()` to identify the one installed owner and `createServiceRoleSupabaseClient()` to bypass owner-only Navigation RLS. Fetch at most 100 rows total and only `id, kind, label, location, page_id, position, url`. Fetch referenced Pages separately with exact owner, locale, and `published` status, selecting only `id, slug`. Resolve Home with `localePath`, Page with `pagePath`, and custom with its stored normalized URL. Sort by `position`, then `id`, and omit unresolved Page items.

Cache each locale for five seconds in process. Successful Navigation PUT calls `invalidatePublicNavigationCache`. Catch read errors, log them server-side, and return empty Header/Footer arrays so a temporary menu failure does not take down public content. Never import this server module from a `.tsx` client island.

- [ ] **Step 6: Run Navigation API/resolver tests**

```sh
rtk npm run test:e2e -- tests/e2e/navigation.spec.ts --project=desktop
rtk npm run check
```

Expected: all pass.

- [ ] **Step 7: Commit the Navigation boundary**

```sh
rtk git add src/lib/navigation-url.ts src/lib/navigation.ts src/pages/api/navigation/index.ts tests/e2e/navigation.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(navigation): add transactional menu API"
```

## Task 7: Build the Navigation manager React island

**Files:**

- Create: `src/components/admin/NavigationManager.tsx`
- Create: `src/pages/admin/navigation.astro`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/navigation.spec.ts`

- [ ] **Step 1: Add failing Navigation-manager interaction tests**

Extend `tests/e2e/navigation.spec.ts` to cover:

- loading, error, Retry, saving, success, and failed-save-retains-edits states;
- MenuBar/Footer and Thai/English tabs;
- Add Home, active-language Page, and custom URL;
- missing Page translation disabled with a clear reason;
- draft Page shown as `Hidden — Draft`;
- Page title copied only when first added, then label editable independently;
- placement Header, Footer, or Both; Both creates two independent local items;
- drag reorder plus Move up/Move down buttons;
- Remove and explicit Save menu;
- dirty badges remain when switching tabs; saving affects only the active list;
- duplicate-submit prevention, focus restoration, live-region announcements, reduced motion, and no horizontal overflow at required widths.

- [ ] **Step 2: Run the test and confirm the Admin route is missing**

```sh
rtk npm run test:e2e -- tests/e2e/navigation.spec.ts --project=desktop
```

Expected: API assertions pass; UI assertions fail on `/admin/navigation`.

- [ ] **Step 3: Implement the Navigation manager without a new drag library**

Create one `NavigationManager.tsx` island. Keep four local arrays keyed as `header:th`, `header:en`, `footer:th`, and `footer:en`; keep dirty state per key. Use `draggable` rows for pointer reordering and always-visible `Move up`/`Move down` buttons for keyboard/touch access.

Use semantic tabs with `aria-selected`, an accessible Add-item `<dialog>`, `UiSelect` for Page and placement selection, and the existing `.admin-button`/`.admin-control` tokens. Placement Both duplicates the new item into Header and Footer arrays for the active locale and marks both dirty; it does not share an ID or future label edits.

The Save menu button sends only the complete active array to `PUT /api/navigation`. On failure, keep the array and dirty marker unchanged. On success, replace temporary client IDs with returned rows and announce `Menu saved.` through `role="status"`.

- [ ] **Step 4: Add the authenticated Admin route**

Create `src/pages/admin/navigation.astro`, follow `media.astro` authentication/error handling, render `AdminShell active="navigation"`, and mount:

```astro
<NavigationManager client:only="react">
  <p class="admin-editor-fallback" slot="fallback" role="status">Loading navigation…</p>
</NavigationManager>
```

- [ ] **Step 5: Run desktop and mobile Navigation tests**

```sh
rtk npm run test:e2e -- tests/e2e/navigation.spec.ts
rtk npm run check
```

Expected: desktop and mobile projects pass.

- [ ] **Step 6: Commit the Navigation manager**

```sh
rtk git add src/components/admin/NavigationManager.tsx src/pages/admin/navigation.astro src/styles/global.css tests/e2e/navigation.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(navigation): add admin menu manager"
```

## Task 8: Render public Pages, Header/Footer menus, SEO, and sitemap

**Files:**

- Create: `src/components/blog/Footer.astro`
- Create: `src/pages/[locale]/[slug].astro`
- Create: `tests/e2e/public-pages-navigation.spec.ts`
- Modify: `src/components/blog/Header.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/blog/SEOHead.astro`
- Modify: `src/pages/sitemap.xml.ts`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write the failing zero-JavaScript public contract**

Create `tests/e2e/public-pages-navigation.spec.ts`. With JavaScript disabled, prove:

- exact-locale Published Page returns `200`, correct `<html lang>`, title/content, canonical, social metadata, `WebPage` JSON-LD, and sanitized HTML;
- Draft/missing/unsupported locale returns real `404` plus `noindex` and never falls back to a sibling;
- only Published sibling alternates appear; `x-default` exists only when the published default-locale sibling exists;
- sitemap contains each Published Page edition and excludes Draft Pages;
- Header and Footer have independent order/labels for TH and EN;
- Home and custom links render; Draft Page item stays absent and returns after republish; deleting the Page removes its menu link;
- desktop MenuBar and native mobile `<details>` are usable without JavaScript;
- HTML contains no `astro-island`, page-transition marker, or non-JSON-LD application script after removing Astro dev-only injections using the existing public-blog helper pattern.

- [ ] **Step 2: Run the test and confirm the public route/menu is missing**

```sh
rtk npm run test:e2e -- tests/e2e/public-pages-navigation.spec.ts --project=desktop
```

Expected: FAIL because `/:locale/:slug` and public menu markup do not exist.

- [ ] **Step 3: Add Page-aware metadata without changing article metadata**

Extend `BaseLayout`'s `type` to `'article' | 'page' | 'website'`. Keep Open Graph type `article` only for Posts; map Page and WebSite views to Open Graph `website`. Add the Page JSON-LD branch:

```ts
{
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  description,
  inLanguage: locale,
  isPartOf: { '@type': 'WebSite', name: siteName, url: homeUrl },
  name: headline ?? title,
  publisher,
  url: canonical,
}
```

Do not emit article author or article timestamps for Pages. Keep the existing BlogPosting and WebSite branches byte-for-byte equivalent in meaning.

- [ ] **Step 4: Implement the exact-locale public Page route**

Create `src/pages/[locale]/[slug].astro`. Validate locale with `isPostLocale`; reject `blog`; query with the service-role server client by exact `locale`, `slug`, installed `author_id`, and `status='published'`. Then query same-group Published siblings for alternates.

Render `PageArticle` through `BaseLayout` with `type="page"`, `pageDescription`, canonical `pagePath(page)`, and `x-default` only when the default-locale Published sibling exists. Return status `404` for invalid locale, missing slug, Draft, or missing Page; return `500` only for query failure. Never query another locale as fallback.

- [ ] **Step 5: Render public navigation in Astro only**

In `BaseLayout.astro`, call `getPublicNavigation(locale)` and pass `navigation.header` to `Header` and `navigation.footer` to a new `Footer` component.

`Header.astro` must retain the site-name link and LanguageSwitcher, add a desktop `<nav aria-label="Primary">`, and add a narrow-screen native `<details>` disclosure containing the same flat items. `Footer.astro` renders `<nav aria-label="Footer">` only when items exist plus the existing copyright. Both use plain `<a>` tags and no client directive.

Add responsive styles in `global.css`; keep clickable labels on one line, allow the overall layout to wrap/reflow, and remove transitions under reduced motion.

- [ ] **Step 6: Add Published Pages to the sitemap**

Query `pages` in parallel with Posts, selecting only `locale, slug, updated_at`, filtering `published`, ordering newest first, and limiting each content type to 1,000 rows. Append `pagePath(page)` entries beside existing home and Post URLs. A failure in either query returns the existing `503` response rather than a partial sitemap.

- [ ] **Step 7: Run public Page and Blog regressions**

```sh
rtk npm run test:e2e -- tests/e2e/public-pages-navigation.spec.ts tests/e2e/public-blog.spec.ts --project=desktop
rtk npm run check
rtk npm run build
```

Expected: both public contracts pass and the production build succeeds.

- [ ] **Step 8: Commit public rendering**

```sh
rtk git add src/components/blog/Footer.astro src/components/blog/Header.astro src/layouts/BaseLayout.astro src/components/blog/SEOHead.astro 'src/pages/[locale]/[slug].astro' src/pages/sitemap.xml.ts src/styles/global.css tests/e2e/public-pages-navigation.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(site): render pages and managed navigation"
```

## Task 9: Integrate readiness, reset, commands, and operator documentation

**Files:**

- Modify: `src/lib/installation.ts`
- Modify: `scripts/reset-installation.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Verify: `tests/e2e/pages-navigation-rls.spec.ts`

- [ ] **Step 1: Add failing readiness and reset assertions**

Extend the database contract test with a positive `getInstallationReadiness` assertion after both `pages` and `navigation_items` are queryable. The pre-migration failure recorded in Task 1 remains the negative evidence. Extend the reset script's `--self-test` around its table-summary metadata so it includes Navigation and Pages in deletion order.

Do not modify the currently dirty `tests/e2e/installer.spec.ts`.

- [ ] **Step 2: Update fresh-install readiness**

In `getInstallationReadiness`, add head-only queries for `pages` and `navigation_items`. Set `readiness.migration` only when Posts, site settings, media tables, Pages, and Navigation all succeed. Log non-missing errors with the table name, preserving current graceful behavior.

- [ ] **Step 3: Update destructive reset ordering and preview copy**

Use this order in `scripts/reset-installation.mjs`:

```js
const RESET_TABLES = [
  { label: 'Navigation items', name: 'navigation_items' },
  { label: 'Pages', name: 'pages' },
  { label: 'Posts', name: 'posts' },
  { label: 'Media records', name: 'media_items' },
  { label: 'Media folders', name: 'media_folders' },
];
```

Update count, deletion, and remaining-row loops to use `.name`, and print every `.label`. Keep dry-run default, exact confirmation phrase, storage deletion, settings restoration, and owner deletion safeguards unchanged.

- [ ] **Step 4: Add a focused test command**

Add `test:e2e:pages` to `package.json` using the existing `node --env-file=.env.local` Playwright invocation and these files:

```text
pages-navigation-rls.spec.ts
pages-api.spec.ts
pages-editor.spec.ts
admin-pages.spec.ts
navigation.spec.ts
public-pages-navigation.spec.ts
public-blog.spec.ts
admin-shell.spec.ts
```

- [ ] **Step 5: Update README operator guidance**

Document:

- public Page URLs `/<locale>/<slug>` and reserved `blog` slug;
- Pages vs Posts and independent Thai/English editions;
- Header/Footer fixed menu locations, Home/Page/custom targets, no nested menus;
- Draft Page menu items remain saved but hidden;
- `/admin/pages`, Page editor/preview routes, `/admin/navigation`, `/api/pages`, and `/api/navigation`;
- applying the new migration for existing Cloud and Self-hosted deployments before deploying code;
- reset now permanently deletes Pages and Navigation as well as Posts/Media;
- `npm run test:e2e:pages` prerequisites and command;
- public Pages/Header/Footer remain server-rendered without application JavaScript.

Do not claim Page templates, nested menus, homepage assignment, Post targets, scheduling, revisions, trash, analytics, or new-window link settings.

- [ ] **Step 6: Run readiness/reset/documentation checks**

```sh
rtk node scripts/reset-installation.mjs --self-test
rtk npm run test:e2e -- tests/e2e/pages-navigation-rls.spec.ts --project=desktop
rtk npm run check
rtk git diff --check
```

Expected: all pass and no whitespace errors.

- [ ] **Step 7: Commit operational integration**

```sh
rtk git add src/lib/installation.ts scripts/reset-installation.mjs package.json README.md tests/e2e/pages-navigation-rls.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(cms): integrate pages into setup and reset"
```

## Task 10: Full verification and release audit

**Files:**

- Verify all files above
- Do not modify unrelated or pre-existing dirty files

- [ ] **Step 1: Reapply pending local migrations idempotently**

```sh
rtk npx supabase migration up --local
```

Expected: migration applies once or reports the local database is already up to date.

- [ ] **Step 2: Run focused Pages/Navigation coverage**

```sh
rtk npm run test:e2e:pages
```

Expected: all desktop/mobile projects in the focused suite pass.

- [ ] **Step 3: Run existing feature regressions**

```sh
rtk npm run test:e2e:publishing
rtk npm run test:e2e:media
```

Expected: all pass. Investigate failures rather than weakening assertions.

- [ ] **Step 4: Run type, script, and production-build verification**

```sh
rtk npm run check
rtk npm run build
```

Expected: zero TypeScript/Astro errors, helper self-tests pass, and the standalone Node build completes.

- [ ] **Step 5: Audit the release boundary**

Run:

```sh
rtk rg -n "client:|astro-island|<script" 'src/pages/[locale]/[slug].astro' src/components/blog/Header.astro src/components/blog/Footer.astro src/layouts/BaseLayout.astro
rtk rg -n "SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY" src/components src/pages/admin
rtk rg -n "TODO|TBD|FIXME|placeholder" src supabase tests README.md
rtk git status --short
rtk git log -10 --oneline
```

Expected:

- no client directive in public Page/Header/Footer paths;
- no server key reference in client/admin UI code;
- no implementation placeholders introduced;
- only the three known pre-existing installer files remain uncommitted, unless their owner has committed them separately;
- every task commit is present and Conventional Commit formatted.

- [ ] **Step 6: Manually smoke the owner workflow**

With local Supabase and TomeCMS running:

1. Create a Thai Page draft, preview, publish, and add its English edition.
2. Add Home, that Page, and one HTTPS custom link to Thai MenuBar; add Page to both locations.
3. Give Footer a different label/order and save it independently.
4. Visit `/th/<slug>` and `/en/<slug>` with JavaScript disabled.
5. Unpublish one edition and verify only that locale's menu link disappears.
6. Republish it and verify the link returns within the five-second cache bound.
7. Delete one edition and verify only its navigation references disappear while its sibling remains.
8. Confirm `/th`, `/en`, and localized Blog articles still render normally.

- [ ] **Step 7: Record final evidence without pushing automatically**

Capture the exact local commit SHA and test results. Do not push, merge, tag, or alter `main` unless the user explicitly requests that separate delivery action.
