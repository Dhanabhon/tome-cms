# Admin Modern UI, Layer 2 (Shell) Implementation Plan

> **Executed and shipped on 2026-09-19 as layer 2, `5f65f66..d26a4e1`.** The steps below were run
> inline rather than ticked off, so their boxes stay empty; the commits are the record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every admin screen the new shell: a 16rem sidebar with line icons and story counts, a theme row and an account card, and a sticky top bar with the screen's name, a post search and a view-site button -- with the navigation overlay following the new chrome.

**Architecture:** `AdminShell.astro` keeps rendering the sidebar twice (desktop aside, phone drawer) and gains a top bar inside the main column, replacing the phone bar. Icons are inline SVG from a typed map (`src/lib/admin-icons.ts`) rendered by `AdminIcon.astro`. Counts come from one server function (`countAdminStories`) called by the shell only for a signed-in owner. The post search is a plain `GET` form to the Posts list; a pure helper decides which filters it carries. The overlay starts below the top bar, retitles it from the sidebar link the navigation follows, and draws a top bar and rail only when leaving a page that has none.

**Tech Stack:** Astro 5.18 (components, `astro/container` for verification), Kysely on PostgreSQL, `node:test` via `tsx`, the Foundation integration harness (`scripts/test-foundation.mjs`, Docker), Playwright 1.63 (screenshots).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` (section "Shell", rollout layer 2). Layer 1 (`af9f765`) set the admin tokens on `.admin-body`.

## Global Constraints

- The palette does not change, in either theme; no new colour pairs are introduced (nav text `ink-2` on paper, counts `muted` on `paper-3`, email `ink-2` on `paper-2` are already pinned in `tests/unit/theme-contrast.test.ts`).
- No new dependencies. Icon paths are adapted from Lucide under its ISC licence, whose notice travels with them.
- Sidebar width `16rem` (`--admin-sidebar-width`), top bar height `4rem` (`--admin-topbar-height`), both set on `.admin-body`.
- Sidebar groups keep their names (`copy.nav.groupContent`, `copy.nav.groupConfig`).
- Story counts count `distinct translation_group_id`, and render only when the shell has a `userEmail`.
- The top bar search submits `GET` to `adminHref(settings)` with `q`; on the Posts list it carries the current `status` and `locale`. Pages keeps its own search field.
- The editors keep no shell.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`, never `git commit --no-verify`. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`; every command block below exports it first and runs from the repository root.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: Story counts for the sidebar

**Files:**
- Create: `src/server/content/admin-counts.ts`
- Create: `tests/integration/admin-counts.test.ts`

**Interfaces:**
- Produces: `countAdminStories(ownerId: string): Promise<AdminStoryCounts>` and `interface AdminStoryCounts { pages: number; posts: number }`, used by Task 4.

- [ ] **Step 0: Save the selector baseline**

`dist/` holds the build of layer 1 (`af9f765`), made for layer 1's verification, and nothing has changed CSS since. Save its selectors before any layer 2 edit:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer2-selectors-before.json"
```
Expected: `af9f765`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/admin-counts.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('the sidebar counts a post or page once, however many languages it is written in', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { countAdminStories } = await import('../../src/server/content/admin-counts');
  const { createPost } = await import('../../src/server/content/posts');
  const { createPage } = await import('../../src/server/content/pages');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'owner-a', name: 'Owner A', email: 'owner@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'TomeCMS', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [fallback] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();

  const contentJson: EditorDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] };
  const shared = { contentJson, metaTitle: null, metaDescription: null, status: 'draft' as const };
  const postInput = { ...shared, categoryIds: [fallback.id], coverMediaId: null };

  assert.deepEqual(await countAdminStories('owner-a'), { pages: 0, posts: 0 });

  const first = await createPost('owner-a', { ...postInput, title: 'First', slug: 'first' });
  await createPost('owner-a', { ...postInput, title: 'แรก', slug: 'first-th', locale: 'th', sourcePostId: first.id });
  await createPost('owner-a', { ...postInput, title: 'Second', slug: 'second' });
  const about = await createPage('owner-a', { ...shared, title: 'About', slug: 'about' });
  await createPage('owner-a', { ...shared, title: 'เกี่ยวกับ', slug: 'about-th', locale: 'th', sourcePageId: about.id });

  // Two posts -- one of them in two languages -- and one page in two languages.
  assert.deepEqual(await countAdminStories('owner-a'), { pages: 1, posts: 2 });
  assert.deepEqual(await countAdminStories('someone-else'), { pages: 0, posts: 0 });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node scripts/test-foundation.mjs tests/integration/admin-counts.test.ts
```
Expected: FAIL -- `Cannot find module '.../src/server/content/admin-counts'`.

- [ ] **Step 3: Implement the query**

Create `src/server/content/admin-counts.ts`:

```ts
import { db } from '../db/client';

export interface AdminStoryCounts {
  pages: number;
  posts: number;
}

/**
 * How many posts and pages the owner has, for the admin sidebar. A story written in two
 * languages is one card or one row on its list, so it counts once here, and the numbers
 * match each list's "All" tab.
 */
export async function countAdminStories(ownerId: string): Promise<AdminStoryCounts> {
  const [posts, pages] = await Promise.all([
    db.selectFrom('posts')
      .select((eb) => eb.fn.count<string>('translation_group_id').distinct().as('count'))
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow(),
    db.selectFrom('pages')
      .select((eb) => eb.fn.count<string>('translation_group_id').distinct().as('count'))
      .where('owner_id', '=', ownerId)
      .executeTakeFirstOrThrow(),
  ]);
  return { pages: Number(pages.count), posts: Number(posts.count) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node scripts/test-foundation.mjs tests/integration/admin-counts.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/commit-layer2-counts.txt" <<'EOF'
feat(admin): count posts and pages the way their lists do

The admin sidebar is getting count badges. A story written in two
languages is one card or one row on its list, so countAdminStories
counts distinct translation groups, and the numbers match each list's
All tab. An integration test seeds two posts, one of them translated,
and one translated page.
EOF
git add src/server/content/admin-counts.ts tests/integration/admin-counts.test.ts
git commit -F "$S/commit-layer2-counts.txt"
```

### Task 2: The icon set

**Files:**
- Create: `src/lib/admin-icons.ts`
- Create: `src/components/admin/AdminIcon.astro`
- Create: `tests/unit/admin-icons.test.ts`

**Interfaces:**
- Produces: `ADMIN_ICONS` (map of name to SVG child markup), `type AdminIconName`, `ADMIN_NAV_IDS` (the sidebar's link ids, in order), `type AdminNavId`; `<AdminIcon name={AdminIconName} />` rendering `<svg class="admin-icon">`. Tasks 4 and 5 use all of them.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/admin-icons.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ADMIN_ICONS, ADMIN_NAV_IDS } from '../../src/lib/admin-icons';

test('every sidebar link has an icon', () => {
  for (const id of ADMIN_NAV_IDS) assert.ok(ADMIN_ICONS[id], `no icon for ${id}`);
});

test('an icon is nothing but stroked shapes', () => {
  // The markup is set as HTML, so the map holds only the elements a line icon is made of.
  for (const [name, markup] of Object.entries(ADMIN_ICONS)) {
    const elements = [...markup.matchAll(/<([a-z]+)\b/g)].map(([, element]) => element);
    assert.ok(elements.length > 0, `${name} is empty`);
    for (const element of elements) assert.match(element, /^(path|rect|circle)$/, `${name} uses <${element}>`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/admin-icons.test.ts`
Expected: FAIL -- `Cannot find module '.../src/lib/admin-icons'`.

- [ ] **Step 3: Write the icon map**

Create `src/lib/admin-icons.ts`:

```ts
/*
 * Line icons for the admin shell, on a 24px grid, stroked in currentColor.
 *
 * Path data adapted from Lucide (https://lucide.dev).
 * ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
 * of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or
 * without fee is hereby granted, provided that the above copyright notice and this permission
 * notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
 * WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
 * CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
 * WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/** The sidebar's links, in the order the shell lists them. */
export const ADMIN_NAV_IDS = ['posts', 'pages', 'media', 'navigation', 'profile', 'security', 'settings', 'system'] as const;
export type AdminNavId = (typeof ADMIN_NAV_IDS)[number];

export const ADMIN_ICONS = {
  posts: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  pages: '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/>',
  media: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  navigation: '<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>',
  profile: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  security: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  system: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  external: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  signOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
} satisfies Record<string, string>;

export type AdminIconName = keyof typeof ADMIN_ICONS;
```

- [ ] **Step 4: Write the component**

Create `src/components/admin/AdminIcon.astro`:

```astro
---
import { ADMIN_ICONS, type AdminIconName } from '../../lib/admin-icons';

interface Props {
  name: AdminIconName;
}

const { name } = Astro.props;
---

<svg
  class="admin-icon"
  aria-hidden="true"
  fill="none"
  stroke="currentColor"
  stroke-linecap="round"
  stroke-linejoin="round"
  stroke-width="1.5"
  viewBox="0 0 24 24"
  set:html={ADMIN_ICONS[name]}
></svg>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/admin-icons.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/commit-layer2-icons.txt" <<'EOF'
feat(admin): a line icon set for the shell, with no dependency

Thirteen icons adapted from Lucide under its ISC licence, kept as a
typed map of SVG shapes and drawn by AdminIcon in currentColor on a 24px
grid. A test checks that every sidebar link has one and that the markup,
which is set as HTML, holds nothing but paths, rects and circles.
EOF
git add src/lib/admin-icons.ts src/components/admin/AdminIcon.astro tests/unit/admin-icons.test.ts
git commit -F "$S/commit-layer2-icons.txt"
```

### Task 3: What the top bar's post search carries

**Files:**
- Modify: `src/lib/admin.ts` -- add `postSearchState`
- Modify: `tests/unit/admin-path.test.ts` -- add its tests
- Modify: `src/pages/admin/index.astro` -- the filter form loses its search field and keeps `q`
- Modify: `src/styles/global.css` -- `.admin-post-filters--compact`

**Interfaces:**
- Produces: `postSearchState(url: URL, postsPath: string): { hidden: Array<[string, string]>; query: string }`, used by Task 4.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/admin-path.test.ts` (it already imports from `../../src/lib/admin`; add `postSearchState` to that import):

```ts
test('a post search from the Posts list keeps the filters in force', () => {
  assert.deepEqual(
    postSearchState(new URL('https://cms.test/admin?status=draft&locale=th&q=slow'), '/admin'),
    { hidden: [['status', 'draft'], ['locale', 'th']], query: 'slow' },
  );
  assert.deepEqual(postSearchState(new URL('https://cms.test/admin/'), '/admin'), { hidden: [], query: '' });
  assert.deepEqual(
    postSearchState(new URL('https://cms.test/studio?q=notes'), '/studio'),
    { hidden: [], query: 'notes' },
  );
});

test('a post search from any other screen starts from all posts', () => {
  assert.deepEqual(
    postSearchState(new URL('https://cms.test/admin/pages?status=draft&q=about'), '/admin'),
    { hidden: [], query: '' },
  );
  assert.deepEqual(postSearchState(new URL('https://cms.test/admin/categories'), '/admin'), { hidden: [], query: '' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/admin-path.test.ts`
Expected: FAIL -- `postSearchState is not a function` (or a TypeScript import error).

- [ ] **Step 3: Implement the helper**

Append to `src/lib/admin.ts`:

```ts
/**
 * What the admin top bar's post search sends besides the words typed. On the Posts list it
 * keeps the status and language filters in force and shows the current query; from any other
 * screen it starts from all posts.
 */
export function postSearchState(url: URL, postsPath: string): { hidden: Array<[string, string]>; query: string } {
  const trim = (path: string) => path.replace(/\/+$/, '') || '/';
  if (trim(url.pathname) !== trim(postsPath)) return { hidden: [], query: '' };
  const hidden = (['status', 'locale'] as const).flatMap((name): Array<[string, string]> => {
    const value = url.searchParams.get(name);
    return value ? [[name, value]] : [];
  });
  return { hidden, query: url.searchParams.get('q') ?? '' };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import tsx --test tests/unit/admin-path.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Move the Posts search out of the filter form**

In `src/pages/admin/index.astro`, replace the whole `<form class="admin-post-filters" ...>` element with:

```astro
        <form class="admin-post-filters admin-post-filters--compact" action={adminHref(adminSettings)} method="get" novalidate>
          <input type="hidden" name="status" value={status} />
          {query && <input type="hidden" name="q" value={query} />}
          <div class="admin-field">
            <label for="post-locale">{copy.filters.language}</label>
            <UiSelect
              client:load
              className="admin-control"
              defaultValue={locale}
              id="post-locale"
              name="locale"
              options={[
                { label: copy.filters.allLanguages, value: 'all' },
                { label: copy.filters.thai, value: 'th' },
                { label: copy.filters.english, value: 'en' },
              ]}
            />
          </div>
          <button class="admin-button" type="submit">{copy.filters.apply}</button>
        </form>
```

Then confirm nothing else read the removed field:
```bash
grep -rn "post-search" src
```
Expected: no output.

- [ ] **Step 6: Give the compact form its columns**

In `src/styles/global.css`, directly after the `.admin-post-filters > button { justify-self: start; }` rule, add:

```css
/* On Posts the search lives in the admin top bar, so the row is the language and its button. */
.admin-post-filters--compact { grid-template-columns: minmax(9rem, auto) auto; }
```

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/commit-layer2-search.txt" <<'EOF'
feat(admin): the Posts search is ready to move into the top bar

postSearchState decides what a post search sends besides its words: on
the Posts list the status and language in force, anywhere else nothing.
The Posts filter form drops its own search field and carries the query
as a hidden field, so choosing a language keeps the search.
EOF
git add src/lib/admin.ts tests/unit/admin-path.test.ts src/pages/admin/index.astro src/styles/global.css
git commit -F "$S/commit-layer2-search.txt"
```

Note: between this commit and Task 4's, the Posts screen has no search field. Tasks 3 and 4 ship together in one push.

### Task 4: The shell -- sidebar, top bar, drawer

**Files:**
- Modify: `src/components/admin/AdminShell.astro` (full rewrite below)
- Modify: `src/lib/admin-i18n.ts` -- two keys in `shell`, both languages
- Modify: `src/pages/admin/categories.astro` -- pass `title`
- Modify: `src/styles/global.css` -- shell rules
- Modify: `DESIGN.md` -- the Admin Surface table

**Interfaces:**
- Consumes: `countAdminStories` (Task 1), `AdminIcon`, `ADMIN_NAV_IDS`/`AdminNavId` (Task 2), `postSearchState` (Task 3).
- Produces (for Task 5): the top bar `header.admin-topbar` containing `.admin-topbar__title` (an `.admin-icon` and a `span`); sidebar links `.admin-sidebar nav a[href]` each containing `.admin-icon` and `.admin-nav-label`; the custom properties `--admin-sidebar-width` and `--admin-topbar-height` on `.admin-body`.

- [ ] **Step 1: Add the copy**

In `src/lib/admin-i18n.ts`, in the `en` object's `shell` block, after `openNavigation: 'Open navigation',` add:

```ts
    searchLabel: 'Search posts',
    searchPlaceholder: 'Search posts…',
```

and in the `th` object's `shell` block, after `openNavigation: 'เปิดเมนูนำทาง',` add:

```ts
    searchLabel: 'ค้นหาบทความ',
    searchPlaceholder: 'ค้นหาบทความ…',
```

- [ ] **Step 2: Rewrite the shell component**

Replace the frontmatter and markup of `src/components/admin/AdminShell.astro` (everything above `<script>`) with:

```astro
---
import ThemeToggle from '../ThemeToggle.astro';
import AdminIcon from './AdminIcon.astro';
import { adminHref, normalizeAdminPath, postSearchState } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import type { AdminNavId } from '../../lib/admin-icons';
import { countAdminStories, type AdminStoryCounts } from '../../server/content/admin-counts';
import { getSiteSettings } from '../../server/content/settings';
import type { PostLocale } from '../../types/cms';

interface Props {
  active: AdminNavId;
  adminPath?: string;
  locale?: PostLocale | null;
  siteName: string;
  /** The screen's own name where it sits under another link: Categories lives under Posts. */
  title?: string;
  userEmail?: string | null;
}

const { active, adminPath: requestedAdminPath = '/admin', locale, siteName, title, userEmail } = Astro.props;
const adminPath = normalizeAdminPath(requestedAdminPath);
const adminSettings = { admin_path: adminPath };
const ownerInitial = userEmail?.trim().charAt(0).toUpperCase() ?? '';
const copy = adminCopy(locale);

// Counted only for a signed-in owner -- the Security screen renders this shell around its sign-in
// form too. A count that fails leaves the badges out; it never takes the shell down with it.
let counts: AdminStoryCounts | null = null;
if (userEmail) {
  try {
    const settings = await getSiteSettings();
    if (settings) counts = await countAdminStories(settings.owner_id);
  } catch (error) {
    console.error('Admin story counts could not be read:', error);
  }
}

interface NavLink {
  count?: number;
  href: string;
  id: AdminNavId;
  label: string;
}

/**
 * Seven flat destinations is where a sidebar starts costing a scan. They split
 * cleanly in two: what the site publishes, and how the installation is set up. The
 * group names deliberately avoid "Settings", which is already one of the links.
 */
const groups: Array<{ id: string; label: string; links: NavLink[] }> = [
  {
    id: 'content',
    label: copy.nav.groupContent,
    links: [
      { count: counts?.posts, href: adminHref(adminSettings), id: 'posts', label: copy.nav.posts },
      { count: counts?.pages, href: adminHref(adminSettings, '/pages'), id: 'pages', label: copy.nav.pages },
      { href: adminHref(adminSettings, '/media'), id: 'media', label: copy.nav.media },
      { href: adminHref(adminSettings, '/navigation'), id: 'navigation', label: copy.nav.navigation },
    ],
  },
  {
    id: 'config',
    label: copy.nav.groupConfig,
    links: [
      { href: adminHref(adminSettings, '/profile'), id: 'profile', label: copy.nav.profile },
      { href: adminHref(adminSettings, '/security'), id: 'security', label: copy.nav.security },
      { href: adminHref(adminSettings, '/settings'), id: 'settings', label: copy.nav.settings },
      { href: adminHref(adminSettings, '/system'), id: 'system', label: copy.nav.system },
    ],
  },
];
const currentLabel = groups.flatMap(({ links }) => links).find(({ id }) => id === active)?.label ?? '';
const search = postSearchState(Astro.url, adminHref(adminSettings));
---

<div
  class="admin-shell"
  data-admin-path={adminPath}
  data-copy-cancel={copy.shell.cancel}
  data-copy-sign-out={copy.shell.signOut}
  data-copy-sign-out-confirm={copy.shell.signOutConfirm}
  data-copy-sign-out-failed={copy.shell.signOutFailed}
  data-copy-sign-out-title={copy.shell.signOutTitle}
>
  {[false, true].map((mobile) => {
    const Container = mobile ? 'dialog' : 'aside';
    return (
      <Container class={mobile ? 'admin-mobile-nav' : 'admin-sidebar'} id={mobile ? 'admin-mobile-navigation' : undefined} aria-label={copy.shell.navigationLabel}>
        {mobile && (
          <button class="admin-button admin-button--ghost admin-button--icon admin-shell-close" type="button" data-nav-close autofocus aria-label={copy.shell.closeNavigation}>
            <AdminIcon name="close" />
          </button>
        )}
        <a class="admin-shell-brand" href={adminHref(adminSettings)}>
          <img class="admin-logo" src="/brand/tomecms-logo-color.png" alt="TomeCMS" width="2172" height="724" />
        </a>
        <div class="admin-shell-site">
          <span class="admin-shell-site__name" title={siteName}>{siteName}</span>
          <a class="admin-shell-site__view" href="/" target="_blank" rel="noopener noreferrer" aria-label={copy.shell.viewSiteLabel}><AdminIcon name="external" /></a>
        </div>
        <nav aria-label={copy.nav.label}>
          {groups.map((group) => {
            // The shell renders twice -- sidebar and mobile drawer -- so the heading
            // ids have to differ or the labelledby references collide.
            const headingId = `admin-nav-${group.id}${mobile ? '-mobile' : ''}`;
            return (
              <section aria-labelledby={headingId}>
                <h2 class="admin-nav-group" id={headingId}>{group.label}</h2>
                {group.links.map((link) => (
                  <a href={link.href} aria-current={active === link.id ? 'page' : undefined}>
                    <AdminIcon name={link.id} />
                    <span class="admin-nav-label">{link.label}</span>
                    {link.count !== undefined && <span class="admin-nav-count">{link.count}</span>}
                  </a>
                ))}
              </section>
            );
          })}
        </nav>
        <div class="admin-shell-account">
          <div class="admin-shell-theme">
            <span>{copy.theme.adminLabel}</span>
            <ThemeToggle
              labels={{ group: copy.theme.adminLabel, system: copy.theme.system, light: copy.theme.light, dark: copy.theme.dark }}
              name={mobile ? 'tome-theme-mobile' : 'tome-theme-sidebar'}
            />
          </div>
          <div class="admin-shell-user">
            {userEmail && <span class="admin-shell-avatar" aria-hidden="true">{ownerInitial}</span>}
            {userEmail && <span class="admin-shell-email" title={userEmail}>{userEmail}</span>}
            <button class="admin-button admin-button--ghost admin-button--icon admin-shell-signout" type="button" data-sign-out aria-label={copy.shell.signOut} title={copy.shell.signOut}>
              <AdminIcon name="signOut" />
            </button>
          </div>
          <p class="admin-form-error" data-sign-out-error role="alert"></p>
        </div>
      </Container>
    );
  })}
  <div class="admin-shell-main">
    <header class="admin-topbar" data-search-open={search.query ? '' : undefined}>
      <button class="admin-button admin-button--ghost admin-button--icon admin-topbar__menu" type="button" data-nav-open aria-label={copy.shell.openNavigation} aria-controls="admin-mobile-navigation" aria-expanded="false">
        <AdminIcon name="menu" />
      </button>
      <p class="admin-topbar__title"><AdminIcon name={active} /><span>{title ?? currentLabel}</span></p>
      <form class="admin-topbar__search" action={adminHref(adminSettings)} method="get" role="search">
        {search.hidden.map(([name, value]) => <input type="hidden" name={name} value={value} />)}
        <label class="sr-only" for="admin-topbar-search">{copy.shell.searchLabel}</label>
        <AdminIcon name="search" />
        <input class="admin-control" id="admin-topbar-search" maxlength="100" name="q" placeholder={copy.shell.searchPlaceholder} type="search" value={search.query} />
      </form>
      <button class="admin-button admin-button--ghost admin-button--icon admin-topbar__search-toggle" type="button" data-search-toggle aria-controls="admin-topbar-search" aria-expanded={search.query ? 'true' : 'false'} aria-label={copy.shell.searchLabel}>
        <AdminIcon name="search" />
      </button>
      <a class="admin-button admin-button--secondary admin-topbar__site" href="/" target="_blank" rel="noopener noreferrer" aria-label={copy.shell.viewSiteLabel}>
        <AdminIcon name="external" /><span>{copy.shell.viewSite}</span>
      </a>
    </header>
    <main class="admin-shell-content"><slot /></main>
  </div>
</div>
```

- [ ] **Step 3: Wire the phone search toggle and fix the sign-out error lookup**

In the same file's `<script>`, directly after the `window.matchMedia('(min-width: 64rem)')...` listener, add:

```ts
  // On a phone the post search folds behind an icon; open, it takes a row under the bar.
  const topbar = document.querySelector<HTMLElement>('.admin-topbar');
  const searchToggle = topbar?.querySelector<HTMLButtonElement>('[data-search-toggle]');
  searchToggle?.addEventListener('click', () => {
    const open = !topbar?.hasAttribute('data-search-open');
    topbar?.toggleAttribute('data-search-open', open);
    searchToggle.setAttribute('aria-expanded', String(open));
    if (open) topbar?.querySelector<HTMLInputElement>('#admin-topbar-search')?.focus();
  });
```

and in the sign-out handler replace

```ts
      const message = button.parentElement?.querySelector('[data-sign-out-error]');
```

with

```ts
      // The error line is the account block's, a sibling of the row the button sits in.
      const message = button.closest('.admin-shell-account')?.querySelector('[data-sign-out-error]');
```

- [ ] **Step 4: Name Categories in the top bar**

In `src/pages/admin/categories.astro`, change

```astro
    <AdminShell active="posts" adminPath={settings?.admin_path} locale={settings?.default_locale} siteName={settings?.site_name ?? 'TomeCMS'} userEmail={userEmail}>
```

to

```astro
    <AdminShell active="posts" adminPath={settings?.admin_path} locale={settings?.default_locale} siteName={settings?.site_name ?? 'TomeCMS'} title={copy.categories.heading} userEmail={userEmail}>
```

- [ ] **Step 5: Style the shell**

In `src/styles/global.css`:

1. In the `.admin-body` rule (layer 1), after `--text-title: 1.75rem;` add:
```css
  --admin-sidebar-width: 16rem;
  --admin-topbar-height: 4rem;
```

2. Delete these two rules (the phone bar is now the top bar):
```css
.admin-mobile-bar { display: flex; gap: var(--space-md); align-items: center; justify-content: space-between; padding: var(--space-md); border-bottom: var(--rule-hair) solid var(--color-rule); background: var(--color-paper); }
.admin-mobile-bar > span { min-width: 0; overflow-wrap: anywhere; font-weight: 600; }
```

3. Directly after `.admin-mobile-nav::backdrop { background: var(--color-scrim); }` add:
```css
.admin-shell-close { align-self: flex-end; }
```

4. Replace the `.admin-nav-group { ... }` rule and the three `.admin-sidebar nav a, .admin-mobile-nav nav a` rules that follow it with:
```css
.admin-nav-group {
  margin: 0 0 var(--space-2xs);
  padding-inline: var(--space-sm);
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 500;
}
/* A link is its icon, its name and, on the two lists, how many there are. The count is a
 * quiet pill, so it reads as a figure and not as a second label. */
.admin-sidebar nav a, .admin-mobile-nav nav a { display: flex; gap: var(--space-sm); min-height: var(--control-height); align-items: center; padding-inline: var(--space-sm); border-radius: var(--radius-sm); color: var(--color-ink-2); font-size: var(--text-sm); font-weight: 500; text-decoration: none; }
.admin-sidebar nav a:hover, .admin-mobile-nav nav a:hover, .admin-sidebar nav a[aria-current='page'], .admin-mobile-nav nav a[aria-current='page'] { background: var(--color-paper-2); color: var(--color-ink); }
.admin-sidebar nav a[aria-current='page'], .admin-mobile-nav nav a[aria-current='page'] { color: var(--color-focus); }
.admin-nav-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-nav-count { flex: none; min-width: 1.5rem; padding-inline: var(--space-xs); border-radius: var(--radius-pill); background: var(--color-paper-3); color: var(--color-muted); font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.25rem; text-align: center; }
.admin-icon { flex: none; width: 1.25rem; height: 1.25rem; }
```

5. Replace the `.admin-shell-account`, `.admin-shell-user`, `.admin-shell-email`, `.admin-shell-signout` and `.admin-shell-signout:hover` rules (keep `.admin-shell-avatar` and `.admin-shell-account .admin-form-error:empty` as they are) with:
```css
.admin-shell-account { display: grid; gap: var(--space-sm); margin-top: var(--space-xl); }
.admin-shell-theme { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); padding-inline: var(--space-sm); color: var(--color-muted); font-size: var(--text-sm); }
/* The owner as a card at the foot of the column: who is signed in, and the way out. */
.admin-shell-user { display: flex; align-items: center; gap: var(--space-xs); min-width: 0; padding: var(--space-xs); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-card); background: var(--color-paper-2); }
.admin-shell-email { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--color-ink-2); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
.admin-shell-signout { margin-inline-start: auto; }
```

6. Replace the `@media (min-width: 64rem)` block that styles `.admin-sidebar`, `.admin-sidebar .admin-shell-account`, `.admin-shell-main` and `.admin-mobile-bar` with:
```css
@media (min-width: 64rem) {
  .admin-sidebar { display: flex; flex-direction: column; position: fixed; inset: 0 auto 0 0; width: var(--admin-sidebar-width); overflow-y: auto; padding: var(--space-md); border-right: var(--rule-hair) solid var(--color-rule); background: var(--color-paper); }
  .admin-sidebar .admin-shell-account { margin-top: auto; }
  .admin-shell-main { margin-inline-start: var(--admin-sidebar-width); }
}

/* The bar over every admin screen: which screen this is, a search over posts, and the way out
 * to the site. It sticks, so the search is a reach away at the bottom of a long list. On a
 * phone it also holds the menu, and the search folds behind an icon. */
.admin-topbar { position: sticky; inset-block-start: 0; z-index: var(--z-sticky-nav); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs) var(--space-sm); min-height: var(--admin-topbar-height); padding: var(--space-sm) clamp(var(--space-md), 4vw, var(--space-xl)); border-block-end: var(--rule-hair) solid var(--color-rule); background: var(--color-paper); }
.admin-topbar__title { display: flex; flex: 1 1 auto; align-items: center; gap: var(--space-xs); min-width: 0; margin: 0; font-weight: 600; }
.admin-topbar__title > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-topbar__search { position: relative; display: none; flex: 1 1 100%; order: 1; }
.admin-topbar[data-search-open] .admin-topbar__search { display: block; }
.admin-topbar__search > .admin-icon { position: absolute; inset-inline-start: var(--space-sm); inset-block-start: 50%; color: var(--color-muted); transform: translateY(-50%); pointer-events: none; }
.admin-topbar__search .admin-control { padding-inline-start: 2.5rem; }
.admin-topbar__site > span { display: none; }
@media (min-width: 64rem) {
  .admin-topbar { flex-wrap: nowrap; padding-block: 0; }
  .admin-topbar__menu, .admin-topbar__search-toggle { display: none; }
  .admin-topbar__search { display: block; flex: 0 1 22rem; order: 0; }
  .admin-topbar__site > span { display: inline; }
}
```

7. Directly after the `.admin-button--secondary { background: var(--color-paper); }` rule, add:
```css
/* For actions that sit in chrome rather than in content: no fill and no edge until hovered. */
.admin-button--ghost { --admin-button-hover: var(--color-paper-3); border-color: transparent; background: transparent; color: var(--color-muted); }
.admin-button--ghost:hover { color: var(--color-ink); }
.admin-button--icon { width: var(--control-height); padding-inline: 0; }
```

Then confirm no rule still names the removed phone bar outside the overlay (Task 5 removes those):
```bash
grep -n "admin-mobile-bar" src/styles/global.css src/components/admin/AdminShell.astro
```
Expected: no output.

- [ ] **Step 6: Record the shell in DESIGN.md**

In the `## Admin Surface` table, add these rows after the `text-title` row:

```markdown
| admin-sidebar-width | -- | 16rem (256px) | Sidebar column; the main column and the navigation overlay start at its edge |
| admin-topbar-height | -- | 4rem (64px) | Sticky top bar: screen name, post search, view site |
```

and replace the sentence `The sidebar width and the icon set join it with the admin shell.` with:

```markdown
Icons are line drawings on a 24px grid with a 1.5px stroke, drawn at 20px in `currentColor`
from `src/lib/admin-icons.ts` (paths adapted from Lucide, ISC licence).
```

- [ ] **Step 7: Run the checks**

Run: `npm run check`
Expected: `0 errors`; every self-test passes.

Run: `npm run test:unit`
Expected: every test passes.

- [ ] **Step 8: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/commit-layer2-shell.txt" <<'EOF'
feat(admin): a sidebar with icons and counts, and a top bar with post search

Layer 2 of docs/specs/2026-09-17-admin-modern-ui-design.md. The sidebar
is 16rem: every link has a line icon, Posts and Pages carry their story
counts (for a signed-in owner only), and the foot of the column is a
theme row and an account card. Over every screen sits a sticky top bar
with the screen's name, a post search that keeps the Posts filters in
force, and a view-site button; on a phone it takes the menu, and the
search folds behind an icon. Categories names itself in the bar.

The sign-out error line was looked up inside the button's own row, where
it never was; it is found in the account block now.
EOF
git add src/components/admin/AdminShell.astro src/lib/admin-i18n.ts src/pages/admin/categories.astro src/styles/global.css DESIGN.md
git commit -F "$S/commit-layer2-shell.txt"
```

### Task 5: The navigation overlay follows the new chrome

**Files:**
- Modify: `src/components/PageTransitionSkeleton.astro`
- Modify: `src/components/admin/AdminSkeleton.astro` -- the `posts` filters
- Modify: `src/styles/global.css` -- overlay rules

**Interfaces:**
- Consumes: `.admin-topbar`, `.admin-topbar__title`, `.admin-sidebar nav a[href]` with `.admin-icon` and `.admin-nav-label`, `--admin-sidebar-width` (Task 4); `transitionKind` (unchanged).

- [ ] **Step 1: Replace the phone bar template with a top bar template**

In `src/components/PageTransitionSkeleton.astro`, replace the whole `<template data-skeleton-bar>...</template>` element with:

```astro
  <template data-skeleton-topbar>
    <div class="admin-topbar" aria-hidden="true">
      <span class="admin-topbar__title"><span class="skeleton-line" style="--skeleton-width: 8rem"></span></span>
      <span class="admin-topbar__search"><span class="skeleton skeleton--control"></span></span>
      <span class="skeleton skeleton--button" style="--skeleton-width: 7rem"></span>
    </div>
  </template>
```

and in the comment above the overlay, replace `a sidebar already on screen stays uncovered, and the mobile bar is copied rather than drawn` with `a sidebar and a top bar already on screen stay uncovered, and the top bar names the screen on the way`.

- [ ] **Step 2: Rewrite `build`, and restore the title on hide**

In the same file's `<script>`, replace the whole `const build = (url: URL) => { ... };` function with:

```ts
  let restoreTitle: (() => void) | null = null;

  /** Names the destination in the top bar, from the sidebar link the navigation follows. */
  const retitle = (topbar: HTMLElement, url: URL) => {
    const title = topbar.querySelector<HTMLElement>('.admin-topbar__title');
    const link = [...document.querySelectorAll<HTMLAnchorElement>('.admin-sidebar nav a[href]')]
      .find((candidate) => new URL(candidate.href).pathname === url.pathname);
    if (!title || !link) return;
    const before = [...title.childNodes];
    const label = document.createElement('span');
    label.textContent = link.querySelector('.admin-nav-label')?.textContent ?? '';
    const icon = link.querySelector('.admin-icon')?.cloneNode(true);
    title.replaceChildren(...(icon ? [icon] : []), label);
    restoreTitle = () => title.replaceChildren(...before);
  };

  const build = (url: URL) => {
    const kind = transitionKind(url, adminPath, window.location.origin);
    const skeleton = kind && template(`template[data-skeleton="${kind}"]`);
    if (!transition || !frame || !kind || !skeleton) return false;
    const column = document.createElement('div');
    column.className = 'admin-transition__column';
    const parts: Node[] = [];
    transition.style.removeProperty('inset-block-start');
    if (kind === 'editor') {
      transition.dataset.sidebar = 'none';
    } else {
      // The sidebar and the top bar are the same on every screen: ones already on the page stay
      // uncovered, and only a page without them -- an editor -- gets them drawn.
      const sidebar = document.querySelector('.admin-sidebar');
      const topbar = document.querySelector<HTMLElement>('.admin-topbar');
      transition.dataset.sidebar = sidebar ? 'page' : 'skeleton';
      const rail = sidebar ? null : template('template[data-skeleton-rail]');
      if (rail) parts.push(rail);
      if (topbar) {
        transition.style.setProperty('inset-block-start', `${Math.round(topbar.getBoundingClientRect().bottom)}px`);
        retitle(topbar, url);
      } else {
        const drawn = template('template[data-skeleton-topbar]');
        if (drawn) column.append(drawn);
      }
    }
    column.append(skeleton);
    parts.push(column);
    frame.replaceChildren(...parts);
    transition.dataset.kind = kind;
    return true;
  };
```

Then in `hideTransition`, directly after `frame?.replaceChildren();` add:

```ts
    transition.style.removeProperty('inset-block-start');
    restoreTitle?.();
    restoreTitle = null;
```

- [ ] **Step 3: Match the Posts skeleton to the compact filters**

In `src/components/admin/AdminSkeleton.astro`, replace:

```astro
            <div class="admin-post-filters">
              {[4, 3].map((width) => (
```

with:

```astro
            <div class:list={['admin-post-filters', kind === 'posts' && 'admin-post-filters--compact']}>
              {(kind === 'posts' ? [3] : [4, 3]).map((width) => (
```

- [ ] **Step 4: Point the overlay rules at the new width**

In `src/styles/global.css`, replace:

```css
  .admin-transition[data-sidebar="page"] { inset-inline-start: 15rem; }
  .admin-transition[data-sidebar="skeleton"] .admin-transition__frame { display: grid; grid-template-columns: 15rem minmax(0, 1fr); align-items: start; }
```

with:

```css
  .admin-transition[data-sidebar="page"] { inset-inline-start: var(--admin-sidebar-width); }
  .admin-transition[data-sidebar="skeleton"] .admin-transition__frame { display: grid; grid-template-columns: var(--admin-sidebar-width) minmax(0, 1fr); align-items: start; }
```

and directly after `.admin-transition__rail { display: none; }` add:

```css
.admin-transition__column { min-width: 0; }
```

Then confirm the overlay no longer mentions the phone bar or the old width:
```bash
grep -n "admin-mobile-bar\|skeleton-bar\|15rem" src/components/PageTransitionSkeleton.astro src/styles/global.css
```
Expected: no output from `PageTransitionSkeleton.astro`; in `global.css` only rules unrelated to the shell (review each line).

- [ ] **Step 5: Run the checks**

Run: `npm run check && npm run test:unit`
Expected: `0 errors`; every test passes (`tests/unit/admin-transition.test.ts` unchanged).

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/commit-layer2-overlay.txt" <<'EOF'
fix(admin): the loading overlay keeps the new top bar and names the next screen

The overlay started at the top of the viewport and copied the phone bar,
which the top bar has replaced. It now starts below the top bar and
beside the 16rem sidebar, both of which persist, and the bar takes the
destination's icon and name from the sidebar link being followed,
restored if the navigation is cancelled. A page without the shell -- an
editor -- gets a drawn top bar and rail instead. The Posts skeleton
drops the search field that moved into the bar.
EOF
git add src/components/PageTransitionSkeleton.astro src/components/admin/AdminSkeleton.astro src/styles/global.css
git commit -F "$S/commit-layer2-overlay.txt"
```

### Task 6: Verify the layer and hand it to the owner

**Files:** none in the repository; renders and screenshots go to `$S/layer2/`.

- [ ] **Step 1: Selector diff against layer 1**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build && node scripts/css-selector-diff.mjs --diff "$S/layer2-selectors-before.json"
```
Expected: removed selectors are exactly `.admin-mobile-bar`, `.admin-mobile-bar>span` and `.admin-shell-signout:hover`; added selectors are the new shell, top bar, icon, count, ghost and icon button, compact filter and overlay-column rules.

- [ ] **Step 2: Render the real shell**

Render the compiled `AdminShell` with sample props through Astro's container API, and assemble a page with the built CSS and the built client scripts:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
mkdir -p "$S/layer2/site/brand" "$S/layer2/shots"
cp "$(grep -l '\.admin-topbar' dist/client/_astro/*.css | head -1)" "$S/layer2/site/app.css"
cp public/fonts.css "$S/layer2/site/" && cp -R public/fonts "$S/layer2/site/" && cp public/brand/tomecms-logo-color.png "$S/layer2/site/brand/"
for marker in data-search-toggle data-transition-frame; do cp "$(grep -l "$marker" dist/client/_astro/*.js | head -1)" "$S/layer2/site/$marker.js"; done
node --env-file=.env.local --input-type=module -e "
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const chunks = new URL('./dist/server/chunks/', 'file://' + process.cwd() + '/');
const find = (prefix) => new URL(readdirSync(chunks).find((name) => name.startsWith(prefix)), chunks).href;
const { $: AdminShell } = await import(find('AdminShell_'));
const { $: Overlay } = await import(find('PageTransitionSkeleton_'));
const container = await AstroContainer.create();
const compactForm = '<form class=\"admin-post-filters admin-post-filters--compact\"><div class=\"admin-field\"><label for=\"l\">ภาษา</label><select class=\"admin-control\" id=\"l\"><option>ทุกภาษา</option></select></div><button class=\"admin-button\" type=\"submit\">ใช้ตัวกรอง</button></form>';
const body = readFileSync(process.env.S + '/layer1/after/index.html', 'utf8').match(/<section class=\"admin-page\">[\s\S]*?<\/section><\/main>/)[0].replace('</main>', '').replace(/<form class=\"admin-post-filters\">[\s\S]*?<\/form>/, compactForm);
for (const [name, url, email] of [['signed-in', 'http://localhost:4321/admin?status=all&locale=all&q=', 'owner@example.com'], ['search', 'http://localhost:4321/admin?status=draft&locale=th&q=slow', 'owner@example.com']]) {
  const shell = await container.renderToString(AdminShell, { props: { active: 'posts', adminPath: '/admin', locale: 'th', siteName: 'DHANABHON.COM', userEmail: email }, request: new Request(url), slots: { default: body } });
  const overlay = await container.renderToString(Overlay, { props: { label: 'กำลังโหลด…' } });
  writeFileSync(process.env.S + '/layer2/site/' + name + '.html', '<!doctype html><html lang=\"th\" data-js><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><link rel=\"stylesheet\" href=\"fonts.css\"><link rel=\"stylesheet\" href=\"app.css\"></head><body class=\"admin-body\" data-admin-path=\"/admin\">' + shell + overlay + '<script type=\"module\" src=\"data-search-toggle.js\"></script><script type=\"module\" src=\"data-transition-frame.js\"></script></body></html>');
}
"
ls "$S/layer2/site"/*.html
```
Expected: `signed-in.html` and `search.html` exist. If the container import fails on a missing environment variable, add it from `.env.example` to the command's environment and rerun; if the counts query cannot reach the database, the shell still renders without badges -- note it and verify badges from the dev server screenshot in step 5 instead.

- [ ] **Step 3: Measure the shell**

Serve `$S/layer2/site` on port 8755 and run, with Playwright at 1440x900 on `signed-in.html`:

```js
const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
({
  sidebar: box('.admin-sidebar'),
  topbar: box('.admin-topbar'),
  title: document.querySelector('.admin-topbar__title')?.textContent?.trim(),
  navLink: box('.admin-sidebar nav a'),
  counts: [...document.querySelectorAll('.admin-sidebar .admin-nav-count')].map((el) => el.textContent),
  search: box('.admin-topbar__search'),
  pageTitle: box('.admin-page__head h1'),
  overflowX: document.documentElement.scrollWidth - innerWidth,
})
```
Expected: sidebar `[0, 0, 256, 900]`; top bar at x 256, height 64; title `บทความ`; nav link height 40; two counts when the database was reachable; search about 352px wide; the page title below the top bar; `overflowX` 0.

On `search.html`: the search field holds `slow`, and the form holds hidden `status=draft` and `locale=th`.

At 375x812 on `signed-in.html`: the menu and search-toggle buttons are visible, the search field is hidden; after clicking `[data-search-toggle]` the field is visible on its own row and focused; `overflowX` 0.

Overlay: on `signed-in.html` at 1440x900, hold a navigation open with the Navigation API, so the page stays while the overlay does its work:

```js
navigation.addEventListener('navigate', (event) => event.intercept({ handler: () => new Promise((resolve) => setTimeout(resolve, 10000)) }), { once: true });
navigation.navigate('/admin/media');
await new Promise((resolve) => setTimeout(resolve, 1000));
const overlay = document.querySelector('[data-page-transition]');
const rect = overlay.getBoundingClientRect();
({ open: overlay.matches(':popover-open'), top: Math.round(rect.top), left: Math.round(rect.left), kind: overlay.dataset.kind, title: document.querySelector('.admin-topbar__title').textContent.trim() })
```
Expected: `open` true, `top` 64, `left` 256, `kind` `media`, `title` `คลังไฟล์`. After the ten seconds, the overlay is closed and the title reads `บทความ` again.

- [ ] **Step 4: Screenshots, light and dark**

Shoot `signed-in.html` at 1440x900, 768x1024 and 375x812 in light and dark, and `search.html` at 375x812 after opening the search, into `$S/layer2/shots/`.

- [ ] **Step 5: Push and stop for review**

```bash
git push
```
Send the 1440 light and dark shots and the 375 light shot with SendUserFile, report the measurements, and ask the owner to check the admin on their own machine -- the sidebar counts and the Posts search in particular. Do not start layer 3 until the owner approves.

- [ ] **Step 6: Clean up**

Run: `pid=$(lsof -ti tcp:8755); [ -n "$pid" ] && kill $pid`
Expected: port 8755 is free.
