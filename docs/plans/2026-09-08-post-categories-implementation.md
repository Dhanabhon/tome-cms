# Post Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-managed Post Categories with an immutable `Uncategorized` fallback, shared multi-category membership across Thai and English editions, Admin management and assignment UI, and zero-JavaScript public badges.

**Architecture:** Store Category membership against the existing `post_translation_groups` row so every edition shares one set by construction. Postgres owns the at-least-one-Category invariant through security-definer replacement and deletion functions; authenticated Astro APIs validate browser payloads and call those functions. Astro server helpers batch Category reads for Admin and public pages, while the React Post editor adds native checkboxes to its existing serialized save queue.

**Tech Stack:** Astro 5 SSR, React 18 islands, TypeScript strict mode, Supabase Postgres/Auth/RLS, Zod 4, Playwright, existing Tailwind/global design tokens.

**Spec:** [`docs/specs/2026-09-08-post-categories-design.md`](../specs/2026-09-08-post-categories-design.md)

## Global Constraints

- Run every shell command through `rtk`, per `/Users/tom/.codex/RTK.md`.
- Work only in `/Users/tom/Projects/GitHub/tome-cms/.worktrees/post-categories` on `codex/post-categories`; do not modify the clean `main` checkout.
- Do not add packages. Postgres constraints/functions, Zod, native checkboxes/dialogs, React, and existing helpers cover this release.
- Follow TDD for each behavior: add the smallest failing Playwright or self-test assertion, confirm the expected failure, implement the minimum change, then rerun it green.
- Preserve the existing Posts content API payload. Category membership has its own endpoint so a failed second request cannot create duplicate Posts.
- Derive `owner_id` and `translation_group_id` on the server/database. Browser payloads contain only `postId`, Category IDs, or a Category name.
- Keep `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` server-only. Never pass a Supabase client or owner ID to a React island.
- Keep `/<locale>` and `/<locale>/blog/<slug>` free of React islands, Astro client directives, and application JavaScript.
- `Uncategorized` is a database invariant, not a UI convention. Direct Data API calls must not rename/delete it or leave a Post group without a Category.
- Category names are one shared value for both languages; do not add locale, slug, description, hierarchy, ordering, archive routes, filters, or bulk assignment.
- Reuse `authenticate`, `AdminShell`, `PostSettingsDrawer`, `useEditorSaveQueue`, `confirmUi`, `admin-button`, `admin-field`, and existing API error patterns.
- Do not reset a non-disposable local Supabase stack. Apply the forward migration with `supabase migration up --local`; run a clean reset only against an explicitly disposable test stack.
- Before every commit, run `rtk git diff --cached --check`, inspect `rtk git diff --cached --stat`, and stage only the files named by that task.

---

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| Database | `supabase/migrations/20260908120000_create_post_categories.sql` | none |
| Domain/server | `src/lib/categories.ts` | `src/types/cms.ts` |
| API | `src/pages/api/categories/index.ts`, `src/pages/api/posts/categories.ts` | none |
| Category Admin | `src/components/admin/CategoryManager.tsx`, `src/pages/admin/categories.astro` | `src/pages/admin/index.astro`, `src/styles/global.css` |
| Post editor | none | `src/components/admin/Editor.tsx`, `src/components/admin/PostSettingsDrawer.tsx`, `src/pages/admin/new.astro`, `src/pages/admin/edit/[id].astro` |
| Admin/public badges | none | `src/pages/admin/index.astro`, `src/pages/admin/preview/[id].astro`, `src/pages/[locale]/index.astro`, `src/pages/[locale]/blog/[slug].astro`, `src/components/blog/PostArticle.astro`, `src/styles/global.css` |
| Install/reset/docs | none | `src/lib/installation.ts`, `scripts/reset-installation.mjs`, `README.md`, `package.json` |
| Tests | `tests/e2e/post-categories-rls.spec.ts`, `tests/e2e/categories-api.spec.ts`, `tests/e2e/category-manager.spec.ts`, `tests/e2e/post-categories-editor.spec.ts` | `tests/e2e/support.ts`, `tests/e2e/admin-posts.spec.ts`, `tests/e2e/public-blog.spec.ts`, `tests/e2e/installer.spec.ts` |

## Task 1: Lock the database and TypeScript contracts

**Files:**

- Create: `tests/e2e/post-categories-rls.spec.ts`
- Create: `supabase/migrations/20260908120000_create_post_categories.sql`
- Modify: `src/types/cms.ts`
- Modify: `tests/e2e/support.ts`

- [ ] **Step 1: Write the failing ownership, invariant, and translation-group tests**

Create `tests/e2e/post-categories-rls.spec.ts` as a serial desktop suite using `createOwner`, each owner's authenticated Supabase client, and the service-role `admin` client only for setup/cleanup. Cover these exact cases:

1. A newly created Post translation group gets exactly one `Uncategorized` assignment.
2. Adding the English edition to the same `translation_group_id` does not duplicate membership.
3. No owned translation group is left without an assignment; the migration also contains a final SQL assertion so an incomplete existing-data backfill aborts migration application.
4. An owner can select only their own Categories and assignments; a second owner cannot select or directly mutate them, and even the owner cannot directly delete a Category or mutate assignments outside the RPCs.
5. Anonymous reads expose only Categories and assignments attached to a Published Post edition, never draft-only membership.
6. `replace_post_categories` accepts several owned Categories, removes `Uncategorized`, and returns the same membership through both language editions' shared group.
7. Empty replacement restores `Uncategorized`.
8. Duplicate, null, malformed, foreign-owner, missing, and more-than-20 IDs fail without changing the previous set.
9. Direct authenticated insert/update/delete on `post_category_assignments` fails.
10. Direct authenticated rename/delete/default-flag mutation of `Uncategorized` fails.
11. `delete_post_category` preserves remaining custom Categories and restores the default only when deleting the last custom Category.
12. Category names reject blank/untrimmed/over-80 values and collide case-insensitively per owner, but the same custom name is allowed for another owner.

Use helpers local to the spec for the minimum Post row and membership read. In `finally`, delete assignments, Posts, custom Categories, and both owners in dependency order.

- [ ] **Step 2: Confirm the test fails because the Category schema is absent**

Run:

```sh
rtk npm run test:e2e -- tests/e2e/post-categories-rls.spec.ts --project=desktop
```

Expected: FAIL with `categories`, `post_category_assignments`, or the Category RPC missing. A Supabase connection/auth failure is not the intended red state.

- [ ] **Step 3: Add the forward-only Category migration**

Create `supabase/migrations/20260908120000_create_post_categories.sql` with these core tables and ownership keys:

```sql
alter table public.post_translation_groups
  add constraint post_translation_groups_id_author_key unique (id, author_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (
    (is_default and name = 'Uncategorized')
    or (not is_default and lower(name) <> 'uncategorized')
  )
);

create unique index categories_owner_name_key
  on public.categories (owner_id, lower(name));
create unique index categories_one_default_per_owner_key
  on public.categories (owner_id) where is_default;

create table public.post_category_assignments (
  translation_group_id uuid not null,
  category_id uuid not null,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (translation_group_id, category_id),
  foreign key (translation_group_id, owner_id)
    references public.post_translation_groups (id, author_id) on delete cascade,
  foreign key (category_id, owner_id)
    references public.categories (id, owner_id) on delete cascade
);
```

The same migration must also implement:

- Reuse the existing `public.set_media_updated_at()` trigger function for Category `updated_at`; do not add another identical timestamp function.
- `protect_default_category()` to make `owner_id` immutable and reject unprivileged update/delete of an existing default row. Trusted service-role reset and owner-account cascade deletion must remain possible. RLS separately prevents authenticated insertion of a default.
- `ensure_uncategorized(target_owner_id uuid) returns uuid`, `security definer`, `set search_path = ''`, idempotent under concurrent calls, returning the owner's exact default ID.
- A trigger on `site_settings` insert that calls `ensure_uncategorized(new.owner_id)`.
- A trigger on `post_translation_groups` insert that ensures the fallback and inserts its assignment in the same transaction.
- Backfill for distinct non-null owners from `site_settings` and `post_translation_groups`, followed by one fallback assignment for every owned existing group with no assignments. Finish with a `do` block that raises if any non-null-owned group still lacks membership, so a partial backfill cannot commit.
- `replace_post_categories(target_post_id uuid, requested_category_ids uuid[]) returns table(category_id uuid)` as a fixed-search-path security-definer function. Lock the owned Post group, reject null/more-than-20 IDs, validate every distinct requested ID belongs to `auth.uid()`, discard the default when any custom Category remains, restore it when none remain, then replace and return the set atomically.
- `delete_post_category(target_category_id uuid) returns integer` as a fixed-search-path security-definer function. Lock the owned custom Category and affected groups, delete it, restore `Uncategorized` only to affected groups now lacking membership, and return the affected group count.
- Owner-only authenticated select/insert/update policies on `categories`, with insert/update checks that require `owner_id = auth.uid()`, `is_default = false`, and a non-reserved name for browser-originated custom rows. Do not grant direct authenticated delete; Category deletion must use the RPC.
- Owner-only authenticated select policy on assignments; no authenticated insert/update/delete grants.
- Anonymous select policies on both tables guarded by an `exists` check for a Published Post in the assignment's translation group.
- Explicit grants: authenticated Category select/insert/update, assignment select, and execute only on the two public RPCs; anonymous select only; service role access needed by setup/reset/tests. Revoke direct Category/assignment delete from authenticated and revoke RPC execution from `public` and `anon`.

Do not add a `category_slug`, locale column, join row per language edition, or a trigger that copies assignments between Post rows.

- [ ] **Step 4: Add strict domain, table, relationship, and RPC types**

Extend `src/types/cms.ts` with the minimum contracts:

```ts
export interface PostCategory {
  id: string;
  owner_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PostCategorySummary extends PostCategory {
  postCount: number;
}

export interface PostCategoryAssignment {
  translation_group_id: string;
  category_id: string;
  owner_id: string;
  created_at: string;
}

export interface PostCategoryBadge {
  id: string;
  name: string;
}
```

Add `Insert`/`Update` types that do not make required ownership nullable. Add `categories` and `post_category_assignments` to `Database.public.Tables`, including both composite relationships so typed nested selects resolve. Add:

```ts
replace_post_categories: {
  Args: { requested_category_ids: string[]; target_post_id: string };
  Returns: { category_id: string }[];
};
delete_post_category: {
  Args: { target_category_id: string };
  Returns: number;
};
```

- [ ] **Step 5: Make shared E2E cleanup Category-safe**

Update `cleanupEditor` in `tests/e2e/support.ts` to delete `post_category_assignments` by owner, then Posts, then non-default Categories before deleting the owner. Keep direct `deleteOwner` behavior unchanged because database cascades remain the fallback.

- [ ] **Step 6: Apply the migration and rerun the focused database test**

Run:

```sh
rtk supabase migration up --local
rtk npm run test:e2e -- tests/e2e/post-categories-rls.spec.ts --project=desktop
rtk npm run check
```

Expected: all Category RLS/invariant cases PASS and Astro reports zero errors.

- [ ] **Step 7: Commit the database contract**

```sh
rtk git add supabase/migrations/20260908120000_create_post_categories.sql src/types/cms.ts tests/e2e/post-categories-rls.spec.ts tests/e2e/support.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(categories): add category data model"
```

## Task 2: Add authenticated Category and membership APIs

**Files:**

- Create: `src/lib/categories.ts`
- Create: `src/pages/api/categories/index.ts`
- Create: `src/pages/api/posts/categories.ts`
- Create: `tests/e2e/categories-api.spec.ts`

- [ ] **Step 1: Write failing API boundary tests**

Create `tests/e2e/categories-api.spec.ts`. Sign in through the Admin UI where cookie behavior matters, and use `page.request` for calls. Assert:

- GET/POST/PUT/DELETE on `/api/categories` and PUT on `/api/posts/categories` return `401` without a valid session.
- Malformed JSON, extra keys (`owner_id`, `ownerId`, `translation_group_id`, `is_default`), invalid UUIDs, duplicate IDs, more than 20 IDs, blank names, and names longer than 80 return `400`.
- GET returns `Uncategorized` first plus custom Categories alphabetically, each with a logical-group `postCount`.
- POST trims and creates a custom Category; a case-insensitive duplicate returns `409` without provider text.
- PUT renames an owned custom Category; rename/default/foreign/missing cases map to `409` or `404` as specified.
- DELETE names the Category by ID in the request, invokes atomic fallback behavior, returns the affected Post-group count, and maps default/foreign/missing cases correctly.
- PUT `/api/posts/categories` replaces membership for an owned Post, returns selected Category IDs, keeps the prior set on a forced RPC failure, and returns `404` for a foreign/missing Post.
- Unexpected mocked provider failures return generic `500` bodies and never include Supabase messages, relation names, keys, tokens, or SQL.

- [ ] **Step 2: Run the focused API test red**

```sh
rtk npm run test:e2e -- tests/e2e/categories-api.spec.ts --project=desktop
```

Expected: FAIL with `404` for the missing routes.

- [ ] **Step 3: Add one server helper for reads and error classification**

Create `src/lib/categories.ts` and keep it server-only by importing it only from Astro frontmatter/API files. Export:

```ts
export async function getOwnerCategories(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<PostCategorySummary[]>;

export async function getCategoryIdsForPost(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  postId: string,
): Promise<string[] | null>;

export async function getCategoryBadgesByGroup(
  supabase: SupabaseClient<Database>,
  groupIds: string[],
): Promise<Map<string, PostCategoryBadge[]>>;
```

`getOwnerCategories` performs two bounded owner-scoped reads and counts unique `translation_group_id` values per Category. `getCategoryIdsForPost` first resolves the owned Post to its group and returns `null` only when the Post is absent. `getCategoryBadgesByGroup` deduplicates group IDs, returns early for an empty array, makes one nested assignment/Category query, sorts labels by default-first then locale-aware name, and returns an empty array for a group with no rows. Do not add caching or a generic repository class.

- [ ] **Step 4: Implement `/api/categories` with strict Zod schemas**

Create `src/pages/api/categories/index.ts` with these accepted bodies only:

```ts
const createSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const updateSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80) }).strict();
const deleteSchema = z.object({ id: z.uuid() }).strict();
```

Implement:

- `GET`: authenticate, call `getOwnerCategories`, return `{ categories }`.
- `POST`: authenticate, insert `{ owner_id: auth.user.id, name, is_default: false }`, return `{ category: { ...row, postCount: 0 } }` with `201`.
- `PUT`: authenticate, update only an owned non-default row, distinguish missing/default using a safe owned read, return `{ category }`.
- `DELETE`: authenticate, call `delete_post_category`, return `{ affectedPosts }`.

Map unique violations to `409`, protected-default violations to `409`, not-found/foreign to `404`, auth to `401`, invalid input to `400`, and every other failure to generic `500`. Log provider details only on the server.

- [ ] **Step 5: Implement `/api/posts/categories` as a thin transactional adapter**

Create `src/pages/api/posts/categories.ts` with one strict schema:

```ts
const membershipSchema = z.object({
  postId: z.uuid(),
  categoryIds: z.array(z.uuid()).max(20),
}).strict().superRefine(({ categoryIds }, context) => {
  if (new Set(categoryIds).size !== categoryIds.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate Category IDs.' });
  }
});
```

Authenticate, verify the Post is owned so foreign and missing IDs both become `404`, call `replace_post_categories`, and return `{ categoryIds: data.map(({ category_id }) => category_id) }`. Map invariant/foreign Category errors to `400`, authentication to `401`, and unexpected failures to a generic `500`.

- [ ] **Step 6: Rerun API, database, and type checks**

```sh
rtk npm run test:e2e -- tests/e2e/categories-api.spec.ts tests/e2e/post-categories-rls.spec.ts --project=desktop
rtk npm run check
```

Expected: both focused suites PASS; strict TypeScript reports zero errors.

- [ ] **Step 7: Commit the API layer**

```sh
rtk git add src/lib/categories.ts src/pages/api/categories/index.ts src/pages/api/posts/categories.ts tests/e2e/categories-api.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(categories): add category APIs"
```

## Task 3: Build the focused Category manager

**Files:**

- Create: `src/components/admin/CategoryManager.tsx`
- Create: `src/pages/admin/categories.astro`
- Create: `tests/e2e/category-manager.spec.ts`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Write failing Category manager journeys**

Create `tests/e2e/category-manager.spec.ts` and cover:

- Unauthenticated `/admin/categories` redirects through the configured hidden Admin login path with a safe `returnTo`.
- `Manage categories` is visible next to `New post` on the Posts page; no new primary `AdminShell` navigation item appears.
- The manager shows `Uncategorized` first with `Default`, a logical Post count, and no Rename/Delete controls.
- Create trims the name, announces pending/success status, inserts alphabetically, clears only after success, and keeps input on duplicate/server failure for retry.
- Inline Rename supports Save and Cancel, retains text after recoverable failure, and restores the row label/focus after success or cancel.
- Delete opens the existing accessible confirmation UI with the Category name and affected Post count; cancellation is inert; success updates only after the response; failure keeps the row and offers retry.
- Keyboard focus returns to the initiating control after confirmation.
- A 320px viewport has no horizontal page overflow and long names wrap.

- [ ] **Step 2: Run the manager test red**

```sh
rtk npm run test:e2e -- tests/e2e/category-manager.spec.ts --project=desktop
```

Expected: FAIL because `/admin/categories` and `Manage categories` do not exist.

- [ ] **Step 3: Add the authenticated Astro route**

Create `src/pages/admin/categories.astro` following `src/pages/admin/navigation.astro`:

- authenticate with `authenticate`;
- redirect unauthenticated requests via `adminLoginPath(Astro.url.pathname + Astro.url.search)`;
- load `getSiteSettings` and `getOwnerCategories` server-side;
- log provider details and render a generic page alert on failure;
- render `AdminShell active="posts"` so Categories remains a Posts sub-area;
- pass only `initialCategories` to `<CategoryManager client:only="react">` with a useful fallback status.

- [ ] **Step 4: Implement the minimal React manager**

Create `src/components/admin/CategoryManager.tsx` with props:

```ts
interface CategoryManagerProps {
  initialCategories: PostCategorySummary[];
}
```

Use one list state, one create-name state, one optional `{ id, name }` edit state, one pending action ID, and one live status/error. Use native forms and the existing `confirmUi`; do not add a state library, table abstraction, optimistic deletes, or a second fetch layer. The manager calls `/api/categories` directly and parses only `{ error }`, `{ category }`, or `{ affectedPosts }`.

Render semantic list rows rather than a data grid. Disable only the action in flight, expose `aria-busy`, use `role="status" aria-live="polite"` and `role="alert"`, and preserve typed values until the server confirms success.

- [ ] **Step 5: Link Posts to the manager and add scoped styles**

Modify `src/pages/admin/index.astro` so the heading actions contain secondary `Manage categories` and primary `New post` links. Add scoped `.category-*` and reusable `.post-category-badges` rules to `src/styles/global.css` using the current mint/teal tokens. Ensure 44px interactive targets, visible focus, wrapping names/badges, and no fixed-width columns.

- [ ] **Step 6: Verify the manager behavior**

```sh
rtk npm run test:e2e -- tests/e2e/category-manager.spec.ts tests/e2e/categories-api.spec.ts --project=desktop
rtk npm run check
```

Expected: Category CRUD, feedback, focus, and 320px overflow checks PASS.

- [ ] **Step 7: Commit the manager**

```sh
rtk git add src/components/admin/CategoryManager.tsx src/pages/admin/categories.astro src/pages/admin/index.astro src/styles/global.css tests/e2e/category-manager.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(categories): add category manager"
```

## Task 4: Assign shared Categories in the Post editor

**Files:**

- Create: `tests/e2e/post-categories-editor.spec.ts`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/components/admin/PostSettingsDrawer.tsx`
- Modify: `src/pages/admin/new.astro`
- Modify: `src/pages/admin/edit/[id].astro`

- [ ] **Step 1: Write failing editor assignment and save-queue tests**

Create `tests/e2e/post-categories-editor.spec.ts` and assert:

- New Post settings show `Uncategorized` selected.
- Selecting the first custom Category clears the default; selecting several customs works; clearing the last custom restores the default immediately.
- `Uncategorized` cannot be selected alongside a custom Category and explains its fallback role.
- Autosave and Publish persist content first and membership second; a newly created Post ID is reused if the membership request fails, so Retry sends `PUT /api/posts` rather than another `POST`.
- Changing Categories during an in-flight save remains dirty and is serialized into the next save.
- A failed membership save reports `Save failed`, retains selections, and Retry succeeds.
- Editing either Thai or English edition shows the same selected IDs; changing one edition updates the other without copying assignment rows.
- Creating a missing translation immediately inherits the source group's membership.
- `Manage categories` from settings obeys the existing save/navigation lock: dirty content is saved before same-tab navigation; failed save leaves the editor open.

Intercept only `/api/posts/categories` for retry/serialization assertions; let `/api/posts` use the real server.

- [ ] **Step 2: Run the editor test red**

```sh
rtk npm run test:e2e -- tests/e2e/post-categories-editor.spec.ts --project=desktop
```

Expected: FAIL because the settings drawer has no Category fieldset.

- [ ] **Step 3: Load options and selected IDs server-side**

Modify `src/pages/admin/new.astro` and `src/pages/admin/edit/[id].astro`:

- use the already authenticated Supabase client;
- load owner Categories with `getOwnerCategories`;
- for an existing Post or `sourcePostId`, load membership with `getCategoryIdsForPost`;
- pass serializable `categories` and `initialCategoryIds` props to `<Editor client:only="react">`;
- treat a helper error like existing Post-load errors and keep provider details server-only.

For a brand-new Post, select the returned `is_default` ID. For a translation draft, use the source Post's current group membership. Do not perform an assignment copy.

- [ ] **Step 4: Put Category IDs in the existing editor draft snapshot**

Extend `EditorProps` and `EditorDraft`:

```ts
interface EditorProps {
  categories: PostCategory[];
  initialCategoryIds: string[];
  // existing props remain
}

interface EditorDraft {
  categoryIds: string[];
  // existing fields remain
}
```

Keep Category IDs in React state and `draftRef`; changes call the existing `markDirty`. Normalize selections in one local function:

```ts
function selectCategories(categories: PostCategory[], selected: string[]) {
  const allowed = new Set(categories.map(({ id }) => id));
  const custom = [...new Set(selected)].filter((id) => allowed.has(id) && !categories.find((item) => item.id === id)?.is_default);
  return custom.length ? custom : categories.filter(({ is_default }) => is_default).map(({ id }) => id);
}
```

Do not create a second autosave hook or separate dirty flag.

- [ ] **Step 5: Chain membership persistence after the existing Post save**

Inside `Editor.save`:

1. Keep the existing POST/PUT content request.
2. Validate the returned Post.
3. Set `postId.current = savedPost.id` immediately.
4. PUT `{ postId: savedPost.id, categoryIds: draft.categoryIds }` to `/api/posts/categories`.
5. Throw the API's generic error when membership fails so `useEditorSaveQueue` retains dirty state.
6. Only then clear the visible error and finish the saved-state updates.

This ordering is mandatory: if step 4 fails after first creation, Retry sees `postId.current` and updates the same draft instead of creating a duplicate.

- [ ] **Step 6: Add the accessible settings fieldset**

Extend `PostSettingsDrawer` props with `categories`, `selectedCategoryIds`, `onChangeCategories`, and `onManageCategories`. Render a labelled native `<fieldset>` after Slug and before SEO fields. Put `Uncategorized` first, alphabetize custom options, and render native checkboxes. Disable the default checkbox while any custom Category is selected. Add concise fallback help and a `Manage categories` button/link wired to the editor's existing `saveBefore(..., leavesEditor = true)` path.

- [ ] **Step 7: Verify serialized save and translation behavior**

```sh
rtk npm run test:e2e -- tests/e2e/post-categories-editor.spec.ts tests/e2e/editor-workflow.spec.ts tests/e2e/multilingual-posts.spec.ts --project=desktop
rtk npm run check
```

Expected: Category assignment cases PASS without regressing autosave, preview, publish, navigation locks, or translation creation.

- [ ] **Step 8: Commit the editor integration**

```sh
rtk git add src/components/admin/Editor.tsx src/components/admin/PostSettingsDrawer.tsx src/pages/admin/new.astro 'src/pages/admin/edit/[id].astro' tests/e2e/post-categories-editor.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(editor): assign post categories"
```

## Task 5: Render Admin and zero-JavaScript public badges

**Files:**

- Modify: `src/pages/admin/index.astro`
- Modify: `src/pages/admin/preview/[id].astro`
- Modify: `src/pages/[locale]/index.astro`
- Modify: `src/pages/[locale]/blog/[slug].astro`
- Modify: `src/components/blog/PostArticle.astro`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/admin-posts.spec.ts`
- Modify: `tests/e2e/public-blog.spec.ts`

- [ ] **Step 1: Add failing Admin/public badge assertions**

Extend `tests/e2e/admin-posts.spec.ts` to create a translation group with two editions and two Categories, then assert both edition rows show each label once. Keep existing search/status/locale/deletion assertions.

Extend `tests/e2e/public-blog.spec.ts` to assert:

- the homepage featured card and regular rows show their own Category badges;
- the article route and authenticated preview show the same badges;
- draft-only Categories do not leak on a public page;
- names containing `<`, `>`, `&`, quotes, or apostrophes render as text, never markup;
- badges are labels with no Category archive links;
- the existing production-shaped HTML check still finds no application module scripts.

- [ ] **Step 2: Run the badge tests red**

```sh
rtk npm run test:e2e -- tests/e2e/admin-posts.spec.ts tests/e2e/public-blog.spec.ts --project=desktop
```

Expected: FAIL because Category badge containers are absent.

- [ ] **Step 3: Batch-load badges in each server-rendered route**

Use `getCategoryBadgesByGroup` once per route/page, passing unique `translation_group_id` values already returned by the Post query:

- `src/pages/admin/index.astro`: use the authenticated client and map all loaded Posts.
- `src/pages/[locale]/index.astro`: use the route's existing server Supabase client and map all Published Posts.
- `src/pages/[locale]/blog/[slug].astro`: map the single found Post group.
- `src/pages/admin/preview/[id].astro`: map the single owned preview Post group.

If Category lookup fails, log the provider detail and follow that route's current generic server-error behavior. Do not silently show a known-wrong empty set and do not make one query per Post.

- [ ] **Step 4: Render one simple badge contract**

Extend `PostArticle.astro` with `categories: PostCategoryBadge[]` and render the list above title metadata. On homepage/admin rows, render the same semantic structure directly:

```astro
<ul class="post-category-badges" aria-label="Categories">
  {categories.map((category) => <li>{category.name}</li>)}
</ul>
```

Astro text interpolation performs escaping; do not use `set:html`. Keep labels unlinked and add no client directive.

- [ ] **Step 5: Add responsive mint/teal badge styling**

In `src/styles/global.css`, give `.post-category-badges` a wrapping flex layout and small high-contrast mint/teal pills. Avoid fixed heights so 80-character names wrap. Reuse the same class in Admin, public homepage, article, and preview.

- [ ] **Step 6: Verify Admin/public behavior and zero-JS**

```sh
rtk npm run test:e2e -- tests/e2e/admin-posts.spec.ts tests/e2e/public-blog.spec.ts --project=desktop
rtk npm run check
rtk npm run build
```

Expected: badges PASS across Admin/home/article/preview; public HTML still has no application module scripts; build completes with only already-known Vite warnings.

- [ ] **Step 7: Commit badge rendering**

```sh
rtk git add src/pages/admin/index.astro 'src/pages/admin/preview/[id].astro' 'src/pages/[locale]/index.astro' 'src/pages/[locale]/blog/[slug].astro' src/components/blog/PostArticle.astro src/styles/global.css tests/e2e/admin-posts.spec.ts tests/e2e/public-blog.spec.ts
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(categories): render category badges"
```

## Task 6: Integrate installer readiness, reset, scripts, and documentation

**Files:**

- Modify: `src/lib/installation.ts`
- Modify: `scripts/reset-installation.mjs`
- Modify: `tests/e2e/installer.spec.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add the failing reset assertion and installer migration-block regression**

Extend `tests/e2e/installer.spec.ts` with a second intercepted status response where `migration: false`; assert the Wizard identifies the migration as incomplete and prevents continuing to Site details. This preserves the existing Cloud/local/VPS token-copy case while testing the UI contract used when any required table, including Categories, is absent.

Extend `scripts/reset-installation.mjs`'s existing `selfTest()` expected table order to:

```js
[
  { label: 'Post category assignments', name: 'post_category_assignments' },
  { label: 'Navigation items', name: 'navigation_items' },
  { label: 'Pages', name: 'pages' },
  { label: 'Posts', name: 'posts' },
  { label: 'Post categories', name: 'categories' },
  { label: 'Media records', name: 'media_items' },
  { label: 'Media folders', name: 'media_folders' },
]
```

Run the self-test first and confirm it fails until `RESET_TABLES` changes:

```sh
rtk node scripts/reset-installation.mjs --self-test
```

Expected: the reset self-test FAILS with the old table order. The installer migration-block assertion may already pass because the UI contract exists; the new Category table checks themselves are the two trivial additions in Step 2 and do not need a mock Supabase implementation.

- [ ] **Step 2: Add both tables to installer readiness**

Modify `getInstallationReadiness` in `src/lib/installation.ts` to query `categories` and `post_category_assignments` in the existing `Promise.all`, include both in `tableResults`, and keep `readiness.migration` true only when every required table returns the accepted status.

- [ ] **Step 3: Make reset order and dry-run output Category-aware**

Modify `RESET_TABLES` exactly as tested. Assignments must be deleted before Posts/Categories; Categories must be deleted before the owner account. Existing settings restoration and confirmation behavior stays unchanged. Dry-run automatically reports both counts through the existing loop; add no new reset mode.

- [ ] **Step 4: Add one focused test script**

Add `test:e2e:categories` to `package.json` with the Category RLS/API/manager/editor suites plus the Admin/public/installer regression files:

```json
"test:e2e:categories": "node --env-file=.env.local ./node_modules/@playwright/test/cli.js test tests/e2e/post-categories-rls.spec.ts tests/e2e/categories-api.spec.ts tests/e2e/category-manager.spec.ts tests/e2e/post-categories-editor.spec.ts tests/e2e/admin-posts.spec.ts tests/e2e/public-blog.spec.ts tests/e2e/installer.spec.ts"
```

- [ ] **Step 5: Document only the shipped Category behavior**

Update `README.md` with:

- migration application for both local/self-hosted and Supabase Cloud;
- `/admin/categories` access through Posts/editor, not a top-level menu;
- many Categories per Post and shared Thai/English membership;
- immutable `Uncategorized` fallback and deletion behavior;
- public homepage/article labels with no archive links in this release;
- reset dry-run/execute impact, including Category/assignment deletion and fallback recreation during the next Wizard installation.

Do not document archive pages, filters, slugs, translated Category names, or features deferred by the approved spec.

- [ ] **Step 6: Verify setup/reset integration**

```sh
rtk node scripts/reset-installation.mjs --self-test
rtk npm run test:e2e -- tests/e2e/installer.spec.ts --project=desktop
rtk npm run check
```

Expected: reset order self-check PASS, installer readiness PASS, and all existing shell/self-tests inside `npm run check` PASS.

- [ ] **Step 7: Commit setup and docs integration**

```sh
rtk git add src/lib/installation.ts scripts/reset-installation.mjs tests/e2e/installer.spec.ts package.json README.md
rtk git diff --cached --check
rtk git diff --cached --stat
rtk git commit -m "feat(categories): integrate setup and reset"
```

## Task 7: Run release verification and review the branch

**Files:**

- Verify: all files changed in Tasks 1–6
- Modify only if a failing check identifies a Category regression

- [ ] **Step 1: Run the focused Category release suite**

```sh
rtk npm run test:e2e:categories
```

Expected: all Category RLS/API/manager/editor/Admin/public/installer tests PASS in configured Playwright projects.

- [ ] **Step 2: Run existing adjacent regression suites**

```sh
rtk npm run test:e2e:publishing
rtk npm run test:e2e:pages
rtk npm run test:e2e:media
```

Expected: existing Post translation/editor, Pages/navigation, and File Library behaviors PASS.

- [ ] **Step 3: Run static and production checks**

```sh
rtk npm run check
rtk npm run build
```

Expected: Astro/TypeScript and every script self-test PASS; production build completes. Record known pre-existing Vite warnings separately from failures.

- [ ] **Step 4: Run the full E2E suite**

```sh
rtk npm run test:e2e
```

Expected: the complete suite PASS. If runtime makes the full matrix impractical, do not claim it passed; report focused/adjacent results and the exact unresolved gate.

- [ ] **Step 5: Inspect scope, history, and secrets before handoff**

```sh
rtk git status --short --branch
rtk git diff main...HEAD --check
rtk git diff main...HEAD --stat
rtk git log --oneline main..HEAD
rtk git grep -n -E 'SUPABASE_(SECRET|SERVICE_ROLE)|TOME_CMS_INSTALL_TOKEN|eyJ[A-Za-z0-9_-]{20,}' -- ':!package-lock.json'
```

Expected: only approved Category/spec/plan files differ; no credentials or installation tokens are committed. Treat documentation variable names as expected only after inspecting their lines.

- [ ] **Step 6: Fix only evidence-backed regressions and commit atomically**

For each real failure, add or tighten the smallest reproducing test, fix the root cause in the shared path, rerun the focused failure plus its adjacent suite, and create a Conventional Commit naming that fix. Do not bundle unrelated cleanup.

- [ ] **Step 7: Prepare the completion handoff**

Report the exact branch and final SHA, migrations added, focused/adjacent/full verification outcomes, known warnings, and whether a clean disposable migration test was run. Do not merge or push unless the user explicitly requests it.
