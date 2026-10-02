# Sub-menus in the Header: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a header menu item can hold one level of sub-items, and a label-only group can be a
parent. The admin edits this, both themes draw it, and the public API carries it. Ships as 1.10.0.

**Architecture:** the data stays in `navigation_items`. A new `parent_id` and a new `group` kind
carry the tree; the menu is still replaced whole in one transaction. A small pure module
(`src/lib/navigation-tree.ts`) holds the tree operations the admin needs, so they are
unit-tested away from React. Themes draw sub-menus with `<details name>`, which works without a
script. One shared script adds Escape, closing on a click outside, and the edge flip.

**Tech Stack:** Astro 7, React islands, Kysely/Postgres, zod 4, `node:test`, Playwright. No new
dependency.

**Spec:** `docs/specs/2026-10-02-navigation-submenus-design.md`.

## Global Constraints

- **Git:**
  - never stash;
  - stage by explicit path;
  - commit with `git commit -F <file> -- <paths>`, as its own command;
  - no attribution lines;
  - never push or merge.
- **Migration:** `029_navigation_parent`, registered where `028_mcp` is (`src/server/db/migrator.ts`
  and the inventory test). It has a working `down`.
- **One level only.** A sub-item cannot have sub-items.
- **Sub-items and groups are header only.**
- **A group has no target** (`page_id` and `url` both null, `new_tab` false), and must have at least
  one sub-item when saved.
- **The 50-item limit counts sub-items.** Each target (Home, a page, a custom URL) appears once
  across the whole menu.
- **Public item shape:**
  `{ href: string | null, kind: 'home' | 'page' | 'custom' | 'group', label, newTab, children: PublicNavigationItem[] }`.
  - `href` is null only for a group;
  - `children` is always present, and is empty for a sub-item and in the footer.
- **Ruling: the current section is worked out by the theme from the request path,** not stored in
  the cached public snapshot. The snapshot is cached per locale, not per page.
- **Desktop sub-menus:**
  - `<details name="site-submenu">` with a `<summary>`;
  - the ▾ button for a link parent is labelled "Show the {label} menu" (th: "แสดงเมนู {label}");
  - click to open, never hover;
  - animated with opacity and transform only, and instant under `prefers-reduced-motion`.
- **Mobile:** sub-items are always shown, indented under their parent, inside the existing Menu
  `<details>`.
- **Copy:** every new admin string is in `en` and `th` in `src/lib/admin-i18n.ts`; public strings go
  in `publicCopy` (`src/lib/i18n`). The Thai must read naturally.
- **Styling:** design tokens only, and the token checker (`npm run check`) must pass.
- **Tests:**
  - unit: `node --import tsx --test tests/unit/<f>.test.ts`;
  - integration: `node scripts/test-foundation.mjs tests/integration/<f>.test.ts`;
  - e2e: `npm run test:e2e -- tests/e2e/<f>.spec.ts`, one file at a time, at most 5 `/recovery`
    sign-ins per file;
  - no test may depend on machine paths or the time zone.

## Review Focus

1. **A saved menu where a sub-item's page is later unpublished, or a parent page is deleted, must
   still draw.**
   - The sub-item disappears.
   - A parent whose page is gone but which still has live sub-items shows as a group.
   - A deleted parent page takes its sub-items with it (cascade).
   - Covered in Task 2 (unit) and Task 1 (integration).
2. **The admin must never be able to send a tree the server refuses:**
   - indenting an item that has sub-items;
   - indenting the first item;
   - indenting on the Footer tab;
   - a group left empty after its last sub-item is moved out.

   Covered in Task 3, by unit tests on `navigation-tree.ts` and an e2e test.
3. **Keyboard-only use of the desktop sub-menu:**
   - Tab to the ▾ button, Enter opens it, Tab goes through its items, and Escape closes it and
     returns focus to the button;
   - focus leaving the panel closes it.

   Covered in Task 4 (e2e).
4. **A sub-menu on the last header item must stay inside a 1024 px window.** Covered in Task 4
   (e2e, measured with `getBoundingClientRect`).
5. **A headless reader of `/api/v1/content/navigation`:**
   - a menu with no sub-items returns exactly the old fields plus `children: []`;
   - a group returns `href: null`.

   Covered in Task 2.

---

### Task 1: Data and saving

**Files:**
- Create: `src/server/db/migrations/029_navigation_parent.ts`.
- Modify:
  - `src/server/db/migrator.ts`: register it next to `028_mcp`;
  - `tests/unit/db-migrator.test.ts`, with the inventory count and its last name;
  - `src/server/db/types.ts`: `NavigationItemTable` gets `parent_id` and the kind gets `group`;
  - `src/server/db/reset-tables.ts`, if it lists columns;
  - `src/types/cms.ts`:
    - `NavigationKind` adds `'group'`;
    - `NavigationItem` gets `parent_id: string | null`;
    - `NavigationMutationItem` gets `children?: NavigationMutationItem[]`;
  - `src/server/content/navigation.ts`: the save schema, `replaceNavigation` and `listNavigation`.
- Test:
  - `tests/unit/navigation-schema.test.ts`, new, or extend the existing navigation unit test (grep
    `navigationMenuSchema` in tests/);
  - `tests/integration/navigation.test.ts`: extend the existing one (grep `replaceNavigation` in
    tests/integration).

**Interfaces:**
- **Produces:**
  - `navigationMenuSchema` accepts
    `items: Array<Item & { children?: Item[] }>`, where `Item` is one of `home | page | custom | group`;
  - `replaceNavigation(ownerId, input)` returns `NavigationItem[]` (flat rows with `parent_id`);
  - `listNavigation(ownerId)` returns `{ items: NavigationItem[] (with parent_id); pages }`.

- [ ] **Step 1: Migration.**

```ts
import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * A header item may hold one level of sub-items, and a group is a label with no link that only
 * opens them. Every item there before stays at the top level.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table navigation_items
      add constraint navigation_items_tree_key unique (id, owner_id, locale, location),
      add column parent_id uuid,
      drop constraint navigation_items_kind_check,
      add constraint navigation_items_kind_check check (kind in ('home', 'page', 'custom', 'group')),
      drop constraint navigation_items_target_check,
      add constraint navigation_items_target_check check (
        (kind = 'home' and page_id is null and url is null)
        or (kind = 'page' and page_id is not null and url is null)
        or (kind = 'custom' and page_id is null and url is not null)
        or (kind = 'group' and page_id is null and url is null)
      ),
      add constraint navigation_items_parent_header_check check (parent_id is null or location = 'header'),
      add constraint navigation_items_group_header_check check (kind <> 'group' or location = 'header'),
      add constraint navigation_items_parent_fkey foreign key (parent_id, owner_id, locale, location)
        references navigation_items (id, owner_id, locale, location) on delete cascade
  `.execute(db);
  await sql`
    create function tomecms_navigation_one_level() returns trigger language plpgsql as $$
    begin
      if new.parent_id is not null and exists (
        select 1 from navigation_items where id = new.parent_id and parent_id is not null
      ) then
        raise exception 'A sub-item cannot hold sub-items.' using errcode = '23514';
      end if;
      return new;
    end $$
  `.execute(db);
  await sql`
    create trigger navigation_items_one_level before insert or update of parent_id on navigation_items
      for each row execute function tomecms_navigation_one_level()
  `.execute(db);
  await sql`create index navigation_items_parent_idx on navigation_items (parent_id) where parent_id is not null`.execute(db);
}
```

  The `down` reverses this in order:
  1. delete the group rows and the sub-item rows (`where parent_id is not null or kind = 'group'`),
     since the old schema cannot hold them;
  2. drop the trigger, the function, the index and the constraints;
  3. restore the old kind and target checks;
  4. drop `parent_id` and `navigation_items_tree_key`.

  Check the real constraint names in `005_content.ts` and `022_navigation_new_tab.ts` before writing
  this.

  A failing integration test comes first:
  - the migration applies;
  - a grandchild insert fails with 23514;
  - a footer sub-item fails;
  - a footer group fails;
  - deleting a parent row deletes its children;
  - `down` then `up` round-trips.

- [ ] **Step 2: The save schema** (unit tests first). Build on the existing
  `navigationMutationItemSchema`:
  - add the `group` variant `{ kind: 'group', label, pageId: null, url: null, newTab: inPlace }`;
  - a top-level item may carry `children` (a `.max(50)` array of non-group items without
    `children`).

  In `superRefine` on the whole menu:
  - the count of all items, children included, is ≤ 50;
  - no `children` and no group when `location === 'footer'`;
  - a group needs `children.length >= 1`;
  - duplicate targets are checked over the flattened list (parent then children), where a group is
    not a target.

  Each issue gets a message the admin can show and a `path`.

  Unit cases:
  - a valid tree;
  - a grandchild refused;
  - a footer child refused;
  - a footer group refused;
  - an empty group refused;
  - a group as a child refused;
  - a duplicate across levels refused;
  - 51 items with children refused;
  - the old flat body still accepted, so `children` is optional.
- [ ] **Step 3: `replaceNavigation`.**
  - Keep the lock, the page check (collect page ids from parents and children) and the delete.
  - Insert in document order with positions 0..n-1: each parent first with `returning id`, then its
    children with `parent_id` set to that id.
  - Map 23514 or 23503 from the trigger or checks to `HttpError(400, 'Invalid navigation menu.')`,
    as today.
  - `listNavigation` already selects all columns, so `parent_id` arrives. Make sure it maps through
    `navigationItem()`.
  - Integration test: save a header tree, list it, and check the order and the `parent_id`s. A
    refused save leaves the previous menu untouched.
- [ ] **Step 4: Run** `npm run check`, the unit tests and the navigation integration file.
  Commit: `feat: a header menu item can hold sub-items, and a group needs no link`.

---

### Task 2: The public tree and the API

**Files:**
- Modify:
  - `src/types/cms.ts`: `PublicNavigationItem` becomes
    `{ href: string | null; kind: NavigationKind; label: string; newTab: boolean; children: PublicNavigationItem[] }`;
  - `src/server/content/navigation.ts`: `queryPublicNavigation` builds the tree;
  - `src/server/http/public-schemas.ts`: `publicNavigationItemSchema` gets a nullable `href` (only
    for a group) and `children`;
  - `src/server/http/serialize.ts`: `serializePublicNavigation` names each field, recursively;
  - `src/server/http/openapi.ts`, if the component needs a description of the change;
  - the theme callers that type-check against `href: string` (Paper `Header.astro`, `Footer.astro`
    and Plain `Shell.astro`). Footer items never have children or groups, so a narrow
    `href ?? ''` guard is not wanted. Assert instead (the footer filter keeps non-group items only),
    and keep the theme rendering itself for Task 4.
- Create: `src/lib/navigation-current.ts`, holding
  `isCurrentSection(item: PublicNavigationItem, pathname: string): boolean`. It is true when a
  child's `href === pathname`.
- Test:
  - `tests/unit/public-navigation-tree.test.ts`: extract the tree building into a pure function
    `buildPublicNavigation(rows, pageUrls, locale)` so it can be tested without a database;
  - `tests/unit/navigation-current.test.ts`;
  - extend the public API test for navigation (grep `content/navigation` in tests/).

**Interfaces:**
- **Consumes:** Task 1's rows with `parent_id` and `kind: 'group'`.
- **Produces:**
  - `buildPublicNavigation(rows, pageUrls, locale): PublicNavigation`;
  - `isCurrentSection(item, pathname)`;
  - the API shape in the Global Constraints.

- [ ] **Step 1: Unit tests for `buildPublicNavigation`:**
  - a flat menu gives the same items as before, each with `children: []`;
  - a child whose page is not live is dropped;
  - a page parent whose page is gone, with live children, becomes `{ kind: 'group', href: null }`;
  - a group with no live children is dropped;
  - a page parent that is gone with no children left is dropped;
  - the footer stays flat;
  - the 50 cap holds.
- [ ] **Step 2: Implement.**
  - `queryPublicNavigation` keeps its queries and `lastModified`, and calls the pure builder.
  - Children are ordered by position under their parent.
- [ ] **Step 3: The API.** Test that `GET /api/v1/content/navigation?locale=en` returns
  `children: []` on every item of a flat menu, and `href: null` for a group. The schema must refuse
  a null href on a non-group, which is a server bug guard.
- [ ] **Step 4: Run** the checks and tests.
  Commit: `feat: the public menu and the API carry sub-items`.

---

### Task 3: The admin Navigation screen

**Files:**
- Create: `src/lib/navigation-tree.ts`, pure, with no React. It works on the admin's flat draft list
  `{ id, kind, label, pageId, url, newTab, parentId: string | null }[]` in display order:
  - `canIndent(items, index, location): boolean`. False for the first item, on the footer, for an
    item that has children, and for a group.
  - `indent(items, index)`. The item becomes the last child of the nearest top-level item above it.
  - `canOutdent(items, index): boolean`, which is true for a child.
  - `outdent(items, index)`. The child becomes top-level right after its parent's last child; the
    children after it in the same parent stay with that parent.
  - `moveBlock(items, from, to)`:
    - moving a top-level item moves it with its children, landing before or after another
      top-level block;
    - moving a child moves it among its siblings only;
    - this replaces the current flat `move` for up, down and drop.
  - `emptyGroups(items): number[]`, the indexes of groups with no children.
  - `toMutation(items)` gives the nested `items` body for `PUT`. `fromRows(rows)` turns the list
    response, with `parent_id`, into the flat draft list.
- Modify:
  - `src/components/admin/NavigationManager.tsx`:
    - **Drawing:** a child is indented with a thin inline-start rule, and the `li` gets
      `data-depth="1"`.
    - **Buttons:** "Move under the item above" (indent icon) and "Move out" (outdent icon) sit next to
      up and down. They show only on the Header tab, and are disabled by `canIndent` and
      `canOutdent`. Use existing icons only, closest match (grep `src/lib/icons.ts`); do not add
      icons.
    - **Moving:** up, down and drag use `moveBlock`.
    - **The add dialog:** offers "Group (no link)" on the Header tab, with a label field only.
    - **Empty groups:** each one shows an inline error ("A group needs at least one item under it")
      and disables Save.
    - **Sending and loading:** Save sends `toMutation`, and loading uses `fromRows`.
  - `src/lib/admin-i18n.ts`:
    - `navigation.indent`, `navigation.outdent`, `navigation.group`, `navigation.groupHint`,
      `navigation.emptyGroup`, `navigation.subItemOf` (for the screen-reader text "under {label}");
    - in `en` and natural `th`, e.g. "ย้ายเข้าไปใต้รายการด้านบน", "ย้ายออกมา", "กลุ่ม (ไม่มีลิงก์)",
      "กลุ่มต้องมีรายการอยู่ข้างในอย่างน้อยหนึ่งรายการ".
  - `src/styles/global.css`: the child indent, using existing navigation classes and tokens only.
- Test:
  - `tests/unit/navigation-tree.test.ts`;
  - e2e: extend the existing navigation e2e (grep `admin/navigation` in tests/e2e), or add
    `tests/e2e/navigation-submenus.spec.ts` with its own stack, copying the head of
    `select-in-dialog.spec.ts`. It needs one sign-in.

**Interfaces:**
- **Consumes:** Task 1's save body and the `parent_id` on listed rows.
- **Produces:** the functions above.

- [ ] **Step 1: Unit tests for `navigation-tree.ts`.** Cover every function's edges:
  - indent the first item is refused;
  - indent under a child joins that child's parent;
  - indent of an item with children is refused;
  - indent on the footer is refused;
  - outdent keeps later siblings with their parent;
  - `moveBlock` of a parent carries its children, and a child stays within its parent;
  - `emptyGroups`;
  - `toMutation` and `fromRows` round-trip.
- [ ] **Step 2: Implement `navigation-tree.ts`.**
- [ ] **Step 3: Wire up `NavigationManager.tsx`.** It is about 314 lines; keep the new parts small,
  and put tree logic only in the lib.
- [ ] **Step 4: E2E test:**
  1. On the Header tab, add Home, a page, a group and a custom link.
  2. Indent the custom link under the group, and check that Save is disabled while the group was
     empty.
  3. Move the group up with its child.
  4. Save and reload: the tree holds.
  5. Outdent the child: the group is empty again and Save is blocked.
  6. On the Footer tab, no indent buttons and no Group option are shown.
- [ ] **Step 5: Run and commit.**
  Commit: `feat: sub-items and groups on the Navigation screen`.

---

### Task 4: Sub-menus on the site (Paper and Plain)

**Files:**
- Create:
  - `src/components/SubmenuScript.astro`: one `<script>` (bundled by Astro, not inline) that runs
    on pages with `[data-site-submenu]`:
    - Escape inside an open `details[name="site-submenu"]` closes it and focuses its summary;
    - a `pointerdown` outside any open one closes it;
    - `focusout` that leaves the `details` closes it;
    - on `toggle` open, if the panel's `getBoundingClientRect().right` is greater than
      `innerWidth - 8` (or its left is less than 8 under RTL), set `data-align="end"` on the panel.

    Target about 20–30 lines, with no dependency.
  - `src/components/SiteSubmenu.astro`: the desktop markup for one parent, shared by both themes.
    - Props: `item`, `currentPath`, `copy`.
    - Link parent:
      ```html
      <li class="site-submenu-item">
        <a ...>{label}</a>
        <details name="site-submenu" data-site-submenu>
          <summary aria-label="{showMenu}">▾</summary>
          <ul class="site-submenu">…</ul>
        </details>
      </li>
      ```
      `showMenu` is "Show the {label} menu".
    - Group parent:
      ```html
      <li class="site-submenu-item">
        <details name="site-submenu" data-site-submenu>
          <summary>{label}</summary>
          <ul …>
        </details>
      </li>
      ```
    - `aria-current="true"` on the parent link, or on the summary for a group, when
      `isCurrentSection(item, currentPath)`. `aria-current="page"` stays on the exact link.
    - The panel links keep `newTab` handling exactly as the flat items do today: `rel`, `target`
      and the sr-only "opens in a new tab".
- Modify:
  - `src/themes/paper/parts/Header.astro`:
    - **Desktop:** an item with children renders `<SiteSubmenu>`; the others render as now.
    - **Mobile `<details class="site-header__mobile">`:** a parent renders its link (or, for a
      group, a `<span class="public-navigation__group">`) followed by a nested `<ul>` of its
      children, always shown.
    - Include `<SubmenuScript />` once when any item has children.
  - `src/themes/paper/theme.css`. The panel:
    - `position: absolute`, under its parent, `min-inline-size: 100%`, with the theme surface,
      border and shadow tokens;
    - `[data-align="end"]` anchors it to the inline end;
    - it opens with `@starting-style` or `opacity`/`transform` transitions on `details[open]`, and
      is instant under reduced motion;
    - the summary's ▾ rotates when open, by transform.

    The mobile nested list is indented. Check the production minifier keeps the transition
    longhands, using the same built-CSS unit-test approach as `tests/unit/scroll-timeline-css.test.ts`.
  - `src/themes/plain/Shell.astro` and `src/themes/plain/theme.css`: the same `<SiteSubmenu>`, styled
    plainly with Plain's tokens. Plain has no separate mobile menu, so the panel must still fit at
    390 px; on narrow screens it may become an in-flow list under its parent.
  - `src/lib/i18n` (`publicCopy`): `showMenu` in en and th, e.g. "Show the {label} menu" and
    "แสดงเมนู {label}".
- Test: `tests/e2e/navigation-submenus-site.spec.ts`. Seed the menu with psql or the save function,
  as `public-plugins.spec.ts` explains, so it needs no sign-in. Run it for Paper, then switch the
  site theme to Plain the way the theme specs do (grep `theme_id` or `active_theme` in tests/e2e).
  - **Desktop 1440:**
    - clicking ▾ opens the panel and a second click closes it;
    - opening another closes the first;
    - Escape closes and focus returns to the summary;
    - a click outside closes;
    - keyboard only: Tab to the summary, Enter, then Tab through the items;
    - a group opens by its label;
    - `aria-current="true"` on the parent when viewing a child page.
  - **1024:** the last item's panel stays within the window (`getBoundingClientRect().right <= innerWidth`).
  - **Mobile 390:** inside the Menu, children are visible and indented; `scrollWidth <= innerWidth`.
  - **Reduced motion:** the panel has no transition.
  - **Screenshots** at 390 and 1440 px, light and dark, saved to the SDD workspace and gated by an
    env var so CI writes none.

**Interfaces:**
- **Consumes:** `PublicNavigationItem.children`, `kind: 'group'` and `isCurrentSection` (Task 2).

- [ ] **Step 1: Write the failing e2e test for Paper desktop and mobile.**
- [ ] **Step 2: Build `SiteSubmenu.astro` and `SubmenuScript.astro`, then the Paper header and its
  CSS.**
- [ ] **Step 3: Plain.**
- [ ] **Step 4: The CSS built test,** for the transitions surviving the minifier.
- [ ] **Step 5: Run and commit.**
  Commit: `feat: themes draw header sub-menus, by click on desktop and as a list on phones`.

---

### Task 5: Docs

**Files:**
- Modify:
  - `website/src/content/docs/admin/pages-and-menus.md` and `th/admin/pages-and-menus.md`. Cover:
    - sub-items, header only, one level;
    - groups;
    - Move under the item above and Move out;
    - a parent moving with its items;
    - an empty group blocking Save;
    - how it looks on desktop (click ▾) and on phones;
    - what happens when a parent page is unpublished.
  - `website/src/content/docs/extending/themes.md` and its th twin: the new `PublicNavigationItem`
    fields, a short example of drawing `children`, and `SiteSubmenu` and `SubmenuScript` for reuse.
  - The API reference page for content/navigation, if hand-written (grep `content/navigation` in
    website). Document `children` and `href: null` for a group, and the compatibility note.

- [ ] **Step 1: Write both languages.** Thai must use the existing pages' terms ("เมนู", "หน้า",
  "แอดมิน").
- [ ] **Step 2: Build.** Run `npm run docs:openapi`, then `cd website && npx astro check && npx astro build`.
- [ ] **Step 3: Commit:** `docs: sub-menus and groups in the header`.

---

### Task 6: The updater, disk space and old images

Spec: "Also in 1.10.0: the updater and disk space".

**Files:**
- Modify:
  - `src/updater/verify.ts`: the disk check, around lines 172–175, throws a typed error that the
    transaction maps to `insufficient_disk_space`;
  - `src/updater/transaction.ts`, where `errorCode` is set: the disk check's own code wins over
    `release_unavailable`. Read how other typed errors are mapped, if any; otherwise add the
    smallest typed error class;
  - `src/server/update/updater-client.ts`: add `insufficient_disk_space` to the known codes;
  - the System screen's error copy, in `src/lib/admin-i18n.ts` (find how `release_unavailable`
    is shown, with `grep -rn "release_unavailable\|releaseUnavailable" src`), in en and th, with a
    link to the troubleshooting entry;
  - `src/updater/version.ts`: `UPDATER_VERSION = '1.4.0'`;
  - after the job reaches `succeeded`, a best-effort pruning step:
    1. `docker image ls --no-trunc --format '{{json .}}' ghcr.io/dhanabhon/tome-cms`;
    2. remove (`docker image rm <ID>`) every image whose digest is neither the installed one nor
       the previous one (`job.previousImageDigest`);
    3. log each result through the existing command diagnostics;
    4. never throw.

    Put it where the success path ends in `transaction.ts`, or in a small `src/updater/prune.ts`
    that `transaction.ts` calls. Never touch postgres or seaweedfs images.
  - the docs, in en and th:
    - `website/src/content/docs/running/troubleshooting.md` and its th twin get the
      `insufficient_disk_space` entry, with `sudo docker image prune -a --filter "until=24h"`, what
      it removes, and why the running image is safe;
    - `running/updating.md` and its th twin get one line saying the updater removes old images from
      updater 1.4.0 on, and that `sudo npm run updater:upgrade` brings it.
- Test:
  - unit tests in the existing updater test files (`grep -ln "verifyTargetRelease\|transaction" tests/unit`):
    - too little disk gives `insufficient_disk_space`;
    - the prune keeps the current and previous digests, removes the others, ignores non-official
      images, and swallows a failed removal;
  - `npm run test:operations:update` must pass. It is the managed-update harness, required for
    updater changes.

- [ ] **Step 1: Write the failing unit tests.**
- [ ] **Step 2: Implement the error code and the prune.**
- [ ] **Step 3: Add the System copy and docs.**
- [ ] **Step 4: Run** `npm run check`, the unit tests and `npm run test:operations:update`.
  Commit: `fix: the updater says when the disk is too full, and removes old images after an update`.

---

## After the plan

Release 1.10.0. It has a migration, so the updater takes a full backup:
- the release notes;
- CHANGELOG;
- the version bumps and cloud-init;
- README and the docs version refs;
- `running/updating.md` (en and th):
  - a new top row: `| 1.10.0 | 0 | None |`;
  - the 0-migration row becomes `1 | 029_navigation_parent`, and every older row gains it;
- the road plan row;
- run `npm run test:operations:update` locally, since a new migration goes through the managed
  update;
- push develop, wait for CI and Docs, push main, watch release.yml, then verify the attestations and
  `check:inventory` (29 migrations, ending at `029_navigation_parent`).
