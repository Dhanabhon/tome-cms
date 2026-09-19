# Admin Modern UI, Layer 4a (Posts and Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the two story lists out of layer 3's parts: a post card that names its date with a clock and draws its own icons, and a page panel that reads as a table -- Page, Status, Date -- from 48rem up.

**Architecture:** Both screens keep the markup layer 2 and 3 left them with; what changes is two glyphs becoming icons, and the page row gaining a column grid at 48rem and above. The columns live inside a media query, so the phone layout is exactly today's. Each edition is placed on its own grid row by an index the page already has, rather than by auto-placement, and the story's date stays one element on the first row -- which is what `admin-story-list.ts` reconciles after a publish.

**Tech Stack:** Astro 5.18 (components, `astro/container` for verification), `node:test` via `tsx`, Playwright 1.63 (screenshots).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` (sections "Shared Components" -- Posts cards and Pages list -- and rollout layer 4). Layers 1-3 are `af9f765`, `5f65f66..d26a4e1` and `3131cfa..234f3e0`.

## Owner's decision, and what it removes from the spec

Asked on 2026-09-19, the owner chose to **keep every language edition as its own row** -- title, status and that edition's menu -- rather than collapsing the card to one title and a line of locale chips. Two spec sentences follow from the collapsed card and are therefore dropped:

- *"with the primary edition's status pill in its top-right corner"* -- the status already reads on each edition's row; a third copy on the cover would say the same thing twice.
- *"and the row menu"* in the card's footer -- the menus stay on the editions they act on, which is the only place per-edition publish and delete can live.

What remains of those two bullets is built here: the clock before the date, the icons, and the page list's header row.

## Global Constraints

- The palette does not change, and no token is added. Every colour is already pinned in `tests/unit/theme-contrast.test.ts`.
- Icon paths are adapted from Lucide under its ISC licence; the notice at the top of `src/lib/admin-icons.ts` covers them. No dependency is added.
- The phone layout of both lists stays exactly as it is today: the page columns are written inside `@media (min-width: 48rem)`, and nothing outside that block changes how a row stacks.
- The story's date stays a single element per card or row (`[data-story-when]`), because `src/lib/admin-story-list.ts` finds it by climbing to `.admin-story-row` after a publish or unpublish. Do not move it per edition.
- Both admin locales carry every copy key; `tests/unit/admin-i18n.test.ts` fails if one is missing.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks -- the flag that skips them is blocked, and the block is correct. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`; every command block below exports it first and runs from the repository root.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: A clock and a row-menu dot

**Files:**
- Modify: `src/lib/admin-icons.ts`
- Test: `tests/unit/admin-icons.test.ts`

**Interfaces:**
- Produces: `ADMIN_ICONS.clock` and `ADMIN_ICONS.more`, drawn by `AdminIcon.astro` like every other icon, used by Tasks 2 and 3.

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer4a-selectors-before.json"
```
Expected: `234f3e0`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-icons.test.ts`, add:

```ts
test('the list screens have the icons they draw', () => {
  // A date and a row menu were a "⋯" and a "✎" typed into the markup: two glyphs whose
  // weight and size come from whatever font renders them, beside 13 drawn icons.
  for (const name of ['clock', 'more'] as const) assert.ok(ADMIN_ICONS[name], `no icon for ${name}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-icons.test.ts 2>&1 | tail -20
```
Expected: FAIL, `no icon for clock`.

- [ ] **Step 3: Add the two icons**

In `src/lib/admin-icons.ts`, inside `ADMIN_ICONS`, after `close`:

```ts
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
```

- [ ] **Step 4: Run the tests**

```bash
npx tsx --test tests/unit/admin-icons.test.ts 2>&1 | tail -6
```
Expected: PASS, including `an icon is nothing but stroked shapes`.

- [ ] **Step 5: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4a-icons.txt" <<'EOF'
feat(admin): a clock and a row-menu dot join the icon set

The date on a card and the button that opens a row menu were typed characters
-- a pencil and three dots -- sitting beside thirteen drawn icons, at whatever
weight the font felt like. Both are drawn now, on the same 24px grid.
EOF
git add -- src/lib/admin-icons.ts tests/unit/admin-icons.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4a-icons.txt
```

---

### Task 2: The post card draws its icons

**Files:**
- Modify: `src/pages/admin/index.astro` (cover placeholder line 168, menu summary line 189, footer line ~209)
- Modify: `src/pages/admin/pages/index.astro` (menu summary line ~132)
- Modify: `src/styles/global.css` (`.admin-story-foot`, `.admin-story-cover`, `.admin-story-menu summary`)
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `ADMIN_ICONS.clock` and `ADMIN_ICONS.more` from Task 1, and `AdminIcon.astro`, already imported by both pages for their empty states.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add:

```ts
test('the list screens draw their marks instead of typing them', () => {
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(page);
    assert.doesNotMatch(source, /[⋯✎]/, `${page} still types a glyph as an icon`);
    assert.match(source, /<AdminIcon name="more" \/>/, `${page} has no row-menu icon`);
  }
  assert.match(read('src/pages/admin/index.astro'), /<AdminIcon name="clock" \/>/, 'the card has no clock');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `src/pages/admin/index.astro still types a glyph as an icon`.

- [ ] **Step 3: Draw the cover's placeholder**

In `src/pages/admin/index.astro` line 168:

```astro
                  {cover ? <img src={cover} alt="" loading="lazy" /> : <AdminIcon name="posts" />}
```

- [ ] **Step 4: Draw both row-menu buttons**

In `src/pages/admin/index.astro` and `src/pages/admin/pages/index.astro`, in each `<summary>`:

```astro
<summary aria-label={`${copy.posts.actionsFor} ${label}`}><AdminIcon name="more" /></summary>
```

(`copy.pages.actionsFor` in the pages file. `AdminIcon` already renders `aria-hidden`, so the `<span aria-hidden="true">` around the glyph goes away with it.)

- [ ] **Step 5: Put a clock before the date**

In `src/pages/admin/index.astro`, in `.admin-story-foot`:

```astro
                <div class="admin-story-foot">
                  <span data-story-when><AdminIcon name="clock" /><span data-story-verb>{newest.status === 'published' ? copy.status.publishedAt : copy.status.updatedAt}</span> <time datetime={timestamp}>{dateFormatter.format(new Date(timestamp))}</time> ({settings?.timezone ?? 'UTC'})</span>
                </div>
```

- [ ] **Step 6: Size the marks**

In `src/styles/global.css`, add after the `.admin-story-foot` rule:

```css
/* The clock reads as punctuation before the date, not as a control: it takes the date's
 * own size and colour, and sits on its line rather than above it. */
.admin-story-foot [data-story-when] { display: inline-flex; align-items: center; gap: var(--space-2xs); }
.admin-story-foot .admin-icon { width: 0.875rem; height: 0.875rem; }
```

and, after `.admin-story-cover img`:

```css
/* A card with no picture shows what kind of thing it is, at a size that fills the frame
 * without pretending to be one. */
.admin-story-cover .admin-icon { width: var(--space-lg); height: var(--space-lg); }
```

- [ ] **Step 7: Run the tests, the type check and the full suite**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 8: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4a-cards.txt" <<'EOF'
feat(admin): post cards draw their marks and date their work with a clock

The cover of a post with no picture showed a pencil character, the row menu
showed three typed dots, and the date started with a word. All three are drawn
now: the posts icon in the cover, the menu dot on both lists, and a clock
before the date, at the date's own size and colour.
EOF
git add -- src/pages/admin/index.astro "src/pages/admin/pages/index.astro" src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4a-cards.txt
```

---

### Task 3: The page list reads as a table from 48rem up

**Files:**
- Modify: `src/lib/admin-i18n.ts` (three copy keys in each locale's `pages` block)
- Modify: `src/pages/admin/pages/index.astro` (the header row, the edition row index, the status out of the link)
- Modify: `src/styles/global.css` (a `@media (min-width: 48rem)` block for `.admin-page-list`)
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `.admin-story-panel` and `.admin-status` from layer 3.
- Produces: `.admin-page-list` on the panel and `.admin-page-head` for the header row; `--page-columns`, the one template the header and every edition share.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add:

```ts
test('the page list keeps its phone layout and takes columns on a wide screen', () => {
  const source = read('src/pages/admin/pages/index.astro');
  assert.match(source, /class="admin-page-head"/, 'the panel has no column header');
  // The stacked layout is what a phone gets, so the columns may only exist inside the query.
  const wide = /@media \(min-width: 48rem\) \{\s*\.admin-page-list[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
  assert.match(wide, /--page-columns:/, 'the columns are not defined in the 48rem block');
  assert.match(wide, /\.admin-page-head \{[^}]*grid-template-columns: var\(--page-columns\)/);
  assert.doesNotMatch(CSS.replace(wide, ''), /\.admin-page-head \{[^}]*grid-template-columns/, 'a phone must not get the columns');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `the panel has no column header`.

- [ ] **Step 3: Name the columns in both locales**

In `src/lib/admin-i18n.ts`, in the English `pages` block (alphabetical, after `actionsFor`):

```ts
    columnDate: 'Date',
    columnPage: 'Page',
    columnStatus: 'Status',
```

and in the Thai one:

```ts
    columnDate: 'วันที่',
    columnPage: 'หน้า',
    columnStatus: 'สถานะ',
```

- [ ] **Step 4: Add the header row and place every edition**

In `src/pages/admin/pages/index.astro`, put the panel class and the header in:

```astro
          <div class:list={['admin-story-list', stories.length && 'admin-story-panel admin-page-list']}>
            {stories.length > 0 && (
              <div class="admin-page-head" aria-hidden="true">
                <span>{copy.pages.columnPage}</span>
                <span>{copy.pages.columnStatus}</span>
                <span>{copy.pages.columnDate}</span>
                <span></span>
              </div>
            )}
```

Give each edition its row, and lift the status out of the link so it can take a column:

```astro
                        <div class:list={['admin-story-edition', index === 0 && 'admin-story-edition--lead']} style={`--edition-row: ${index + 1}`}>
                          <a class="admin-story-edition__link" href={adminHref(adminSettings, `/pages/edit/${edition.id}`)}>
                            <span class="admin-locale">{edition.locale.toUpperCase()}</span>
                            {index === 0
                              ? <h2 class="admin-story-edition__title">{title}</h2>
                              : <span class="admin-story-edition__title">{title}</span>}
                            <span class="admin-page-path">/{edition.locale}/{edition.slug}</span>
                          </a>
                          <span class="admin-status" data-status={edition.status}>{statusLabel(copy, edition.status)}</span>
```

and the rows that offer a missing edition continue the count:

```astro
                    {missing.map((candidate, offset) => (
                      <a class="admin-story-start" href={adminHref(adminSettings, `/pages/new?${new URLSearchParams({ sourcePageId: story.primary.id, locale: candidate })}`)} style={`--edition-row: ${story.editions.length + offset + 1}`}>
```

- [ ] **Step 5: Give the panel its columns**

In `src/styles/global.css`, after the `.admin-page-row .admin-page-path` rule, add:

```css
/* The page list is a table from 48rem up: one template, named once on the panel, that the
 * header and every edition read. Below that width nothing here applies and a row stacks,
 * which is the only shape that fits a phone. */
.admin-page-head { display: none; }
@media (min-width: 48rem) {
  .admin-page-list {
    --page-columns: minmax(0, 1fr) auto minmax(9rem, 14rem) 44px;
  }
  .admin-page-head {
    display: grid;
    grid-template-columns: var(--page-columns);
    gap: var(--space-sm);
    align-items: center;
    min-height: 2.75rem;
    border-block-end: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  /* The row is the grid; its editions hand their children straight to it, and each
   * edition keeps to the row the page numbered it. */
  .admin-page-list .admin-page-row { grid-template-columns: var(--page-columns); gap: var(--space-sm); align-items: baseline; }
  .admin-page-list .admin-page-row > .admin-story-content { display: contents; }
  .admin-page-list .admin-story-edition,
  .admin-page-list .admin-story-start { display: contents; }
  .admin-page-list .admin-story-edition > *,
  .admin-page-list .admin-story-start { grid-row: var(--edition-row); }
  .admin-page-list .admin-story-edition__link { grid-column: 1; grid-template-columns: auto minmax(0, 1fr); }
  .admin-page-list .admin-story-start { grid-column: 1; }
  .admin-page-list .admin-story-edition .admin-status { grid-column: 2; justify-self: start; align-self: center; }
  .admin-page-list .admin-story-menu { grid-column: 4; }
  /* The date belongs to the story, so it sits on the story's first line. */
  .admin-page-list .admin-story-foot { grid-column: 3; grid-row: 1; padding: 0; justify-content: start; }
  .admin-page-list .admin-page-row .admin-page-path { grid-column: 1; grid-row: auto; padding-block-end: 0; }
}
```

- [ ] **Step 6: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4a-pages.txt" <<'EOF'
feat(admin): the page list reads as a table on a wide screen

Pages answer a different question from posts -- which page is this, is it
published, when did it change -- and the panel now answers it in columns, with
a header that names them. Every language edition keeps its own line, its own
status and its own menu; the story's date stays one element on the first line,
which is the element the list reconciles after a publish.

Below 48rem none of this applies: the header is hidden and a row stacks
exactly as it does today, because columns do not fit a phone.
EOF
git add -- src/lib/admin-i18n.ts "src/pages/admin/pages/index.astro" src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4a-pages.txt
```

---

### Task 4: The skeleton follows, and the owner sees it

**Files:**
- Modify: `src/components/admin/AdminSkeleton.astro` (the `pages` kind)
- Create: `$S/layer4a/shots/*.png`

- [ ] **Step 1: Give the pages skeleton its header row**

In `src/components/admin/AdminSkeleton.astro`, in the branch that draws `admin-story-panel` for `pages` and `list`, draw a header line only for `pages`:

```astro
        {(kind === 'pages' || kind === 'list') && (
          <div class:list={['admin-story-panel', 'admin-skeleton__panel', kind === 'pages' && 'admin-page-list']}>
            {kind === 'pages' && (
              <div class="admin-page-head">
                {[3, 4, 3].map((width) => <span class="skeleton-line" style={`--skeleton-width: ${width}rem`}></span>)}
                <span></span>
              </div>
            )}
```

- [ ] **Step 2: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/layer4a-selectors-before.json"
```
Expected: added `.admin-page-head`, `.admin-page-list` and the rules inside the 48rem block, plus the two icon-sizing rules; nothing removed. A removal is a mistake -- stop and find out why.

- [ ] **Step 3: Render the real screens and serve them**

The Posts screen renders through `$S/layer2/render.mjs`: `astro/container` draws the compiled `AdminShell` and `AdminLayout` around a body saved from the real page. A page route cannot be rendered that way -- its frontmatter signs the owner in and reads the database -- so the Pages body is a fixture, `$S/layer4a/pages-body.html`, copied from the markup in `src/pages/admin/pages/index.astro` with its expressions resolved by hand. Keep it to what the layout has to prove:

- one story with two editions: TH "เกี่ยวกับเรา" published at `/th/about`, EN "About" draft at `/en/about`, `--edition-row: 1` and `2`;
- one story with a single TH edition "ติดต่อ" draft at `/th/contact`, `--edition-row: 1`, and a `.admin-story-start` for EN at `--edition-row: 2`;
- each edition's `.admin-story-menu` with the five items the page renders, and one `.admin-story-foot` per story.

Then render the shell around it by running the layer 2 script with the fixture as its body -- copy `$S/layer2/render.mjs` to `$S/layer4a/render.mjs` and change the `body` constant to read `pages-body.html` and the shell props to `active: 'pages'`, `title: 'หน้า'`.

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
mkdir -p "$S/layer4a/shots" && node --env-file=.env.local "$S/layer2/render.mjs" && cp dist/client/_astro/categories.*.css "$S/layer2/site/app.css" && (cd "$S/layer2/site" && python3 -m http.server 8756 >/dev/null 2>&1 &) ; sleep 1; curl -sI http://localhost:8756/signed-in.html | head -1
```
Expected: `HTTP/1.0 200 OK`.

- [ ] **Step 4: Screenshot both lists at three widths, both themes**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
node --input-type=module -e "
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  for (const [width, height] of [[1440, 900], [768, 1024], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
    await page.goto('http://localhost:8756/signed-in.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: process.env.S + '/layer4a/shots/posts-' + width + '-' + scheme + '.png' });
    await page.close();
  }
}
await browser.close();
"
```

- [ ] **Step 5: Look at the shots**

Read them. Check: the clock sits on the date's line at the date's size; the cover placeholder is centred and muted; the menu dot is the drawn one; on the page list at 1440 the header lines up with every row's columns and nothing overlaps; at 375 the page rows stack exactly as before. Anything wrong is a bug -- fix it, rebuild, re-shoot.

- [ ] **Step 6: Hand it over**

```bash
for p in 8755 8756; do lsof -ti "tcp:$p" >/dev/null 2>&1 && lsof -ti "tcp:$p" | xargs kill; done
```

Send the 1440 light and dark shots and the 375 light shot with SendUserFile, say what changed in one short table, name the two spec sentences the owner's decision dropped, and ask the owner to check both lists on their own machine. Do not start the next screen -- Media -- until the owner approves.

- [ ] **Step 7: Commit the skeleton and any fixes**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4a-skeleton.txt" <<'EOF'
feat(admin): the pages skeleton grows the header the panel now has

The skeleton is built from the layout classes the real screen uses, so the
column header had to reach it too -- otherwise the wait drew a panel that was
one row shorter than the page that replaced it.
EOF
git add -- src/components/admin/AdminSkeleton.astro src/styles/global.css
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4a-skeleton.txt
```
