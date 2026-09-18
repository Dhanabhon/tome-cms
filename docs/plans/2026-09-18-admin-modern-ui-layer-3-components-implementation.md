# Admin Modern UI, Layer 3 (Shared Components) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the pieces every admin screen is built from -- status pills, tab counts, search fields, cards, menus, dialogs and empty states -- so layer 4 can rebuild each screen out of parts that already look right.

**Architecture:** Almost all of this is CSS in `src/styles/global.css`, where the admin rules already live, plus one new colour token in `src/styles/installer-tokens.css` for the published tint. Two markup touches: the top bar's search form moves onto a shared `.admin-search` wrapper, and the two empty states swap a typographic "+" for a line icon. Nothing new is invented -- the pill, the count badge and the icon circle reuse `--radius-pill`, `--color-paper-3` and `AdminIcon` from layer 2.

**Tech Stack:** Astro 5.18 (components, `astro/container` for verification), Tailwind v3 (`@apply` is being removed from two dialog rules, not added), `node:test` via `tsx`, Playwright 1.63 (screenshots).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` (section "Shared Components", rollout layer 3). Layer 1 (`af9f765`) set the admin tokens; layer 2 (`5f65f66..d26a4e1`) built the shell.

## Global Constraints

- The palette does not change except for one addition: `--color-status-ok`, the published pill's surface, which is `--color-green` mixed into `--color-paper` and frozen as a literal `oklch()` so `tests/unit/theme-contrast.test.ts` can read it. Light `oklch(94.38% 0.0114 161.86)`, dark `oklch(34.73% 0.0273 152.43)`.
- Every admin surface stays flat. No shadows, no new elevation -- surfaces are separated by hairlines, as in the reference.
- Controls keep `--color-rule-strong` on their border, because that pair is pinned at 3:1; quiet surfaces (cards, panels, story cards) take `--color-rule`.
- Dialogs keep `--radius-lg` (16px). Only their hairline changes, so they match the cards behind them.
- The dark palette is declared twice -- the `@media (prefers-color-scheme: dark)` block and the `:root[data-theme='dark']` block -- and `tests/unit/theme-contrast.test.ts` asserts the two agree. A new token goes in all three blocks.
- Screens are not touched. Posts cards, the Pages list, Media, Navigation and the form screens are layer 4; layer 3 only changes what they are built from.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks -- the flag that skips them is blocked, and the block is correct. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`; every command block below exports it first and runs from the repository root.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

## Already in place

Three of the spec's shared-component bullets need no work, and no task below touches them:

- **Buttons.** 40px and 10px corners came from layer 1's tokens; `--ghost` and `--icon` were added in layer 2 (`9ba93c2`), and `.admin-button`'s `gap` already leads a label with an icon.
- **Selects.** `.ui-select__trigger` has drawn its own chevron since the control set was written (`src/styles/ui-controls.css:28`).
- **Cards and panels.** `.admin-story-panel` and the story cards already carry the quiet hairline and `--radius-card`; only `.admin-card`, in Task 4, was left on the strong rule.

---

### Task 1: The status pill

**Files:**
- Modify: `src/styles/installer-tokens.css` (three token blocks)
- Modify: `src/styles/global.css:1257-1277` (`.admin-status`)
- Test: `tests/unit/theme-contrast.test.ts`

**Interfaces:**
- Produces: `--color-status-ok`, the published pill's surface, used by Task 6's gallery and by layer 4's post cards.

- [ ] **Step 0: Save the selector baseline**

`dist/` holds the layer 2 build. Save its selectors before any layer 3 edit:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer3-selectors-before.json"
```
Expected: `d26a4e1`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/theme-contrast.test.ts`, add to the end of the `PAIRS` list, after the `color-green` group:

```ts
  // The published pill: a green tint carrying ink text and the green dot that
  // precedes it. Draft's pair -- muted on paper-3 -- is already above.
  ['color-ink', 'color-status-ok', 4.5],
  ['color-green', 'color-status-ok', 3],
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/theme-contrast.test.ts 2>&1 | tail -20
```
Expected: FAIL, `light: --color-status-ok is not a literal oklch token`.

- [ ] **Step 3: Add the token to all three blocks**

In `src/styles/installer-tokens.css`, after each `--color-green:` declaration, add the matching line. The light block (`:root`, near line 40):

```css
  /* --color-green at 12% over paper, written out so the contrast test can read it. */
  --color-status-ok: oklch(94.38% 0.0114 161.86);
```

Both dark blocks -- the `@media (prefers-color-scheme: dark)` one (near line 140) and `:root[data-theme='dark']` (near line 181) -- take the same value as each other, at 18%, because the dark green needs more of itself to separate from the dark paper:

```css
    --color-status-ok: oklch(34.73% 0.0273 152.43);
```

(the `:root[data-theme='dark']` copy is indented two spaces, not four, like its neighbours.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx --test tests/unit/theme-contrast.test.ts 2>&1 | tail -20
```
Expected: PASS, including `both dark blocks declare the same palette`.

- [ ] **Step 5: Make the status a pill**

In `src/styles/global.css`, replace the `.admin-status` rule and its `published` overrides (the comment above it stays):

```css
.admin-status {
  display: inline-flex;
  min-height: 1.5rem;
  padding-inline: var(--space-xs);
  align-items: center;
  gap: var(--space-2xs);
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.4;
  text-transform: capitalize;
  white-space: nowrap;
}
.admin-status::before {
  content: '';
  flex: none;
  width: var(--space-xs);
  height: var(--space-xs);
  border: var(--rule-hair) solid currentColor;
  border-radius: 50%;
}
/* Published is the only state that earns colour: a tint of the master green, with the
 * dot filled. Draft stays the quiet grey pill, so the two read apart at a glance. */
.admin-status[data-status="published"] { background: var(--color-status-ok); color: var(--color-ink); }
.admin-status[data-status="published"]::before { border-color: var(--color-green); background: var(--color-green); }
```

- [ ] **Step 6: Run the unit tests and the type check**

```bash
npm run test:unit 2>&1 | tail -5 && npm run check 2>&1 | tail -5
```
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer3-status.txt" <<'EOF'
feat(admin): status reads as a pill, and published carries a green tint

A dot and a word were the whole of a status, which made "published" and
"draft" the same shape in a list of cards. Both become pills: draft the quiet
grey one, published a tint of the master green with ink text and a filled dot.

The tint is written out as a literal oklch token rather than a color-mix, so
the contrast test can read it: ink on it is 15.9 in light and 11.3 in dark, and
the dot clears 3 against it in both.
EOF
git add -- src/styles/installer-tokens.css src/styles/global.css tests/unit/theme-contrast.test.ts
```

Then, in a separate command:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer3-status.txt
```

---

### Task 2: Tab counts as pills

**Files:**
- Modify: `src/styles/global.css:1088-1093` (`.admin-tab-count`)
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing later tasks read; the badge recipe is the one `.admin-nav-count` already uses.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add at the end:

```ts
test('a tab count is the same badge as a sidebar count', () => {
  const tab = ruleBody(CSS, '.admin-tab-count');
  assert.equal(declaration(tab, 'border-radius'), 'var(--radius-pill)');
  assert.equal(declaration(tab, 'background'), 'var(--color-paper-3)');
  // Both badges count the same kind of thing, so they read the same size.
  assert.equal(declaration(tab, 'font-size'), declaration(ruleBody(CSS, '.admin-nav-count'), 'font-size'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `expected undefined to equal 'var(--radius-pill)'`.

- [ ] **Step 3: Make the count a badge**

In `src/styles/global.css`, replace the `.admin-tab-count` rule and the line under it:

```css
.admin-tab-count {
  min-width: 1.5rem;
  padding-inline: var(--space-2xs);
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1.25rem;
  text-align: center;
}
.admin-post-tabs a[aria-current='page'] .admin-tab-count { color: var(--color-ink); }
```

- [ ] **Step 4: Run the tests**

```bash
npm run test:unit 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer3-tabcount.txt" <<'EOF'
feat(admin): a tab count is the same badge as a sidebar count

The number beside a tab was bare text, so the same fact -- how many stories
are in this bucket -- was drawn two ways on one screen. It now uses the badge
the sidebar counts use, and the selected tab's count inks up with its label.
EOF
git add -- src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer3-tabcount.txt
```

---

### Task 3: A search field any screen can use

**Files:**
- Modify: `src/styles/global.css:186-189` (the top bar search rules)
- Modify: `src/components/admin/AdminShell.astro:147`
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Produces: `.admin-search`, a wrapper that positions a leading `AdminIcon` over an `.admin-control`. Layer 4's Media search adopts it.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add:

```ts
test('the search field is a shared wrapper, not a top bar detail', () => {
  const search = ruleBody(CSS, '.admin-search');
  assert.equal(declaration(search, 'position'), 'relative');
  // No display here: the top bar hides its own form on a phone, and a display
  // declared on the shared class would outrank that rule from further up the file.
  assert.equal(declaration(search, 'display'), undefined);
  assert.match(CSS, /\.admin-search \.admin-control \{[^}]*padding-inline-start: 2\.5rem;/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `no rule for .admin-search`.

- [ ] **Step 3: Lift the pattern out of the top bar**

In `src/styles/global.css`, delete the two rules that draw the field:

```css
.admin-topbar__search > .admin-icon { ... }
.admin-topbar__search .admin-control { padding-inline-start: 2.5rem; }
```

leaving the top bar with only the rules about where its form sits:

```css
.admin-topbar__search { display: none; flex: 1 1 100%; order: 1; }
.admin-topbar[data-search-open] .admin-topbar__search { display: block; }
```

and add the shared rules immediately above the `.admin-topbar` block, where the admin component rules start:

```css
/* A search field carries its magnifier inside the box, on the side the text starts.
 * No display is declared: the top bar folds its own form away on a phone, and a
 * display here would win that contest by sitting further down the file. */
.admin-search { position: relative; min-width: 0; }
.admin-search > .admin-icon { position: absolute; inset-inline-start: var(--space-sm); inset-block-start: 50%; color: var(--color-muted); transform: translateY(-50%); pointer-events: none; }
.admin-search .admin-control { width: 100%; padding-inline-start: 2.5rem; }
```

- [ ] **Step 4: Put the top bar's form on the wrapper**

In `src/components/admin/AdminShell.astro`, line 147, add the class:

```astro
      <form class="admin-search admin-topbar__search" action={adminHref(adminSettings)} method="get" role="search">
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | tail -5 && npm run check 2>&1 | tail -5
```
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer3-search.txt" <<'EOF'
feat(admin): the search field becomes a shape any screen can use

The magnifier inside the box was written into the top bar, so the Media search
-- the other field you type a query into -- could not have one without copying
three rules. The pattern moves to .admin-search and the top bar keeps only the
part that is about the top bar: where the form sits and when it folds away.
EOF
git add -- src/styles/global.css src/components/admin/AdminShell.astro tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer3-search.txt
```

---

### Task 4: Quiet surfaces, rounder menus, one dialog recipe

**Files:**
- Modify: `src/styles/global.css` -- `.admin-card` (line 1523), `.admin-story-menu > div` and its items (1217-1241), `.media-details` (663), `.media-picker` (672), `.navigation-dialog` (1919)
- Modify: `src/styles/global.css` -- new `.admin-body .ui-select__menu` / `__option` rules beside the story menu
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: the radius tokens layer 1 set on `.admin-body` (`--radius-sm` 8px, `--radius-card` 14px, `--radius-lg` 16px).

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add:

```ts
test('a card is a quiet surface and a control is not', () => {
  assert.match(declaration(ruleBody(CSS, '.admin-card'), 'border') ?? '', /var\(--color-rule\)$/);
  // Controls keep the strong rule: that pair is the one pinned at 3:1.
  assert.match(declaration(ruleBody(CSS, '.admin-control'), 'border') ?? '', /var\(--color-rule-strong\)$/);
});

test('menus take the card corner and their items the small one', () => {
  assert.equal(declaration(ruleBody(CSS, '.admin-story-menu > div'), 'border-radius'), 'var(--radius-card)');
  assert.equal(declaration(ruleBody(CSS, '.admin-story-menu a,\n.admin-story-menu button'), 'border-radius'), 'var(--radius-sm)');
  assert.equal(declaration(ruleBody(CSS, '.admin-body .ui-select__menu'), 'border-radius'), 'var(--radius-card)');
  assert.equal(declaration(ruleBody(CSS, '.admin-body .ui-select__option'), 'border-radius'), 'var(--radius-sm)');
});

test('every admin dialog is the same surface', () => {
  for (const selector of ['.media-details', '.media-picker', '.navigation-dialog']) {
    const body = ruleBody(CSS, selector);
    assert.equal(declaration(body, 'border-radius'), 'var(--radius-lg)', selector);
    assert.match(declaration(body, 'border') ?? '', /var\(--color-rule\)$/, selector);
    assert.equal(declaration(body, 'background'), 'var(--color-paper)', selector);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -30
```
Expected: three failures -- the card's strong border, the menu's `var(--radius-input)`, and `.media-details` having no `border-radius` declaration of its own.

- [ ] **Step 3: Quiet the card**

In `src/styles/global.css` line 1523, change the border only:

```css
.admin-card { display: grid; gap: var(--space-lg); padding: var(--space-lg); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-card); background: var(--color-paper); }
```

- [ ] **Step 4: Round the menus**

In `.admin-story-menu > div`, change `border-radius: var(--radius-input);` to `border-radius: var(--radius-card);`, and add the item radius to the `.admin-story-menu a, .admin-story-menu button` rule (after `align-items: center;`):

```css
  border-radius: var(--radius-sm);
```

Then, directly after the story menu's focus rule, add the same two corners for the select's menu, scoped to the admin so the installer keeps its own:

```css
/* The select drops the same kind of menu, and shares its stylesheet with the
 * installer -- so the admin's corners are set here rather than in ui-controls.css. */
.admin-body .ui-select__menu { border-radius: var(--radius-card); }
.admin-body .ui-select__option { border-radius: var(--radius-sm); }
```

- [ ] **Step 5: Put the three dialogs on one recipe**

In `.navigation-dialog` (line 1919), change `var(--color-rule-strong)` to `var(--color-rule)`.

In `.media-details` and `.media-picker`, take the surface out of the utility chain and write it in tokens, leaving the size utilities alone:

```css
.media-details {
  max-height: calc(100% - 2rem);
  @apply w-full max-w-lg overflow-y-auto p-5;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-lg);
  background: var(--color-paper);
}
```

```css
.media-picker {
  max-height: calc(100% - 2rem);
  @apply w-[calc(100%-2rem)] max-w-7xl overflow-y-auto p-0;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-lg);
  background: var(--color-paper);
}
```

(`rounded-xl` already meant `--radius-lg`, `border-line` meant `--color-rule`, and `bg-surface` resolves to the same colour as `--color-paper` in both themes -- so this is the same picture said plainly, and now readable by the test.)

- [ ] **Step 6: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | tail -5 && npm run check 2>&1 | tail -5
```
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer3-surfaces.txt" <<'EOF'
feat(admin): quieter cards, rounder menus, one dialog surface

A card was outlined in the same rule a control uses, which made a page of
cards look like a page of fields; it takes the quiet hairline, and controls
keep the strong one, because that is the pair measured at 3:1.

Menus take the card's corner and their items the small one, in the row menu
and in the select's menu alike -- the select's is scoped to the admin, since
the installer shares that stylesheet. The three dialogs now say their surface
in tokens instead of two of them borrowing it from utility classes.
EOF
git add -- src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer3-surfaces.txt
```

---

### Task 5: An empty state with an icon

**Files:**
- Modify: `src/styles/global.css:1296-1306` (`.admin-empty__mark`)
- Modify: `src/pages/admin/index.astro:215`
- Modify: `src/pages/admin/pages/index.astro:158`
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `AdminIcon.astro` and the `posts` / `pages` icons from layer 2.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add (the file already has the `read` helper it needs):

```ts
test("an empty state shows its screen's icon in a soft circle", () => {
  const mark = ruleBody(CSS, '.admin-empty__mark');
  assert.equal(declaration(mark, 'background'), 'var(--color-paper-3)');
  assert.equal(declaration(mark, 'border'), undefined, 'a filled circle needs no outline');
  assert.equal(declaration(mark, 'color'), 'var(--color-muted)');
  for (const [page, icon] of [['src/pages/admin/index.astro', 'posts'], ['src/pages/admin/pages/index.astro', 'pages']] as const) {
    assert.match(read(page), new RegExp(`admin-empty__mark[^>]*>\\s*<AdminIcon name="${icon}" />`), page);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL on the border assertion -- the mark is an outlined circle today.

- [ ] **Step 3: Fill the circle**

In `src/styles/global.css`, replace the `.admin-empty__mark` rule:

```css
.admin-empty__mark {
  display: grid;
  width: var(--space-2xl);
  height: var(--space-2xl);
  place-items: center;
  border-radius: 50%;
  background: var(--color-paper-3);
  color: var(--color-muted);
}
```

- [ ] **Step 4: Put the icon in it**

In `src/pages/admin/index.astro` line 215:

```astro
              <span class="admin-empty__mark" aria-hidden="true"><AdminIcon name="posts" /></span>
```

and in `src/pages/admin/pages/index.astro` line 158:

```astro
                <span class="admin-empty__mark" aria-hidden="true"><AdminIcon name="pages" /></span>
```

Both files need the import beside their other component imports:

```astro
import AdminIcon from '../../components/admin/AdminIcon.astro';
```

(three `../` in `src/pages/admin/pages/index.astro`.)

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | tail -5 && npm run check 2>&1 | tail -5
```
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer3-empty.txt" <<'EOF'
feat(admin): an empty list shows its own icon, not a plus sign

The mark on an empty state was a "+" in an outlined circle, which promised a
button and was not one -- the actual action was already beside it. It becomes
the screen's own icon in a soft filled circle: Posts shows the posts icon,
Pages the pages icon.
EOF
git add -- src/styles/global.css src/pages/admin/index.astro "src/pages/admin/pages/index.astro" tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer3-empty.txt
```

---

### Task 6: Verify the layer and hand it to the owner

**Files:**
- Create: `$S/layer3/gallery.html` (scratchpad only -- a page holding one of each part)
- Create: `$S/layer3/shots/*.png`

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -3 && node scripts/css-selector-diff.mjs --diff "$S/layer3-selectors-before.json"
```
Expected: added `.admin-search`, `.admin-search > .admin-icon`, `.admin-search .admin-control`, `.admin-body .ui-select__menu`, `.admin-body .ui-select__option`; removed `.admin-topbar__search > .admin-icon`, `.admin-topbar__search .admin-control`. Anything else removed is a mistake -- stop and find out why.

- [ ] **Step 2: Build the gallery page**

Write `$S/layer3/gallery.html` by hand: a `<body class="admin-body">` holding, in one column, each part this layer changed -- two status pills (`data-status="published"` and `="draft"`), a tab strip with three counts, an `.admin-search` form with its magnifier, an `.admin-card`, an open `.admin-story-menu` (`<details open>`), a `.navigation-dialog` rendered as a plain `<div>` so it needs no JavaScript, and an `.admin-empty` with an icon. Link the built stylesheet and copy the `posts` icon markup out of `src/lib/admin-icons.ts`. Serve it:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cp dist/client/_astro/*.css "$S/layer3/app.css" && (cd "$S/layer3" && python3 -m http.server 8755 >/dev/null 2>&1 &) && sleep 1 && curl -sI http://localhost:8755/gallery.html | head -1
```
Expected: `HTTP/1.0 200 OK`.

- [ ] **Step 3: Screenshot both themes**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
node --input-type=module -e "
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, colorScheme: scheme });
  await page.goto('http://localhost:8755/gallery.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: process.env.S + '/layer3/shots/gallery-' + scheme + '.png', fullPage: true });
  await page.close();
}
await browser.close();
"
```

- [ ] **Step 4: Look at the shots**

Read both PNGs. Check: the published pill is a green tint with a filled dot and the draft pill is grey; the tab counts are badges; the magnifier sits inside the field and the text clears it; the card's edge is quieter than the control's; the menu's corners are rounder than its items'; the empty state's icon is centred in a filled circle. Any of these wrong is a CSS bug -- fix it, rebuild, re-shoot.

- [ ] **Step 5: Re-measure the navigation skeleton**

The `posts` skeleton draws tabs and filters. Confirm the tab strip still lines up after the count became a badge:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
node "$S/layer2/render.mjs" && node --input-type=module -e "
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:8755/signed-in.html', { waitUntil: 'networkidle' });
console.log(JSON.stringify(await page.evaluate(() => {
  const tabs = document.querySelector('.admin-post-tabs');
  const count = document.querySelector('.admin-tab-count');
  return { tabsHeight: Math.round(tabs.getBoundingClientRect().height), countWidth: Math.round(count.getBoundingClientRect().width) };
})));
await browser.close();
"
```
Expected: the tab strip's height is unchanged from layer 2 -- 40px rows plus the rule -- and the count is at least 24px wide.

- [ ] **Step 6: Send the shots and stop the server**

```bash
lsof -ti tcp:8755 | xargs -r kill
```

Send `gallery-light.png` and `gallery-dark.png` with SendUserFile, report what changed in one short table, and ask the owner to check the admin on their own machine -- the status pills on the Posts list and the row menu in particular. Do not start layer 4 until the owner approves.

- [ ] **Step 7: Commit any fixes from step 4**

Only if step 4 found something. Same rules: message to a scratchpad file, `git add` by explicit path, `git commit -F` in a separate command.
