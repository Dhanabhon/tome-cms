# Admin Modern UI, Layer 1 (Tokens) Implementation Plan

> **Executed and shipped on 2026-09-19 as layer 1, `af9f765`.** The steps below were run
> inline rather than ticked off, so their boxes stay empty; the commits are the record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin its own rounder corners, 40px controls (44px on touch) and a 28px semibold page title, without moving the public site or the installer.

**Architecture:** The admin's values are custom-property overrides on `.admin-body` -- the class on every admin page's `<body>` (`src/layouts/AdminLayout.astro`) and on no other layout. Every admin rule, the Tailwind `rounded-*` utilities (mapped to the radius variables in `tailwind.config.mjs`) and the navigation skeletons read those variables, so they follow without further edits. `DESIGN.md` records the overrides in a new "Admin Surface" section.

**Tech Stack:** Astro 5, Tailwind CSS 3 (`var()`-mapped radii), plain CSS custom properties, `node:test` via `tsx`, Playwright 1.63 (screenshots only).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` (section "Visual Language", rollout layer 1).

## Global Constraints

- The palette does not change, in either theme.
- The overrides live on `.admin-body` only; the root tokens in `src/styles/installer-tokens.css` keep `--radius-sm: 0.375rem`, `--radius-input: 0.5rem`, `--radius-card: var(--radius-input)`, `--control-height: 3rem`, `--text-title: clamp(1.75rem, 6vw, 2.5rem)`.
- Admin values: `--radius-sm: 0.5rem`, `--radius-input: 0.625rem`, `--radius-card: 0.875rem`, `--control-height: 2.5rem` (`2.75rem` under `@media (pointer: coarse)`), `--text-title: 1.75rem`; admin page titles weight `600`.
- No new dependencies.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage files by explicit path.
- Never use `git stash`, and never `git commit --no-verify`. Write the commit message to a file in the scratchpad, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad: `/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`. Every command below starts with `export S=<that path>` in the same shell, and runs from the repository root.
- The owner's dev server is running on `http://localhost:4321`; do not stop it.

---

### Task 1: Admin token overrides, recorded in DESIGN.md

**Files:**
- Create: `tests/unit/admin-surface-tokens.test.ts`
- Modify: `src/styles/global.css` -- the `.admin-body` rule (currently `min-width: 0; min-height: 100svh; background; color`) and the `.admin-page__head h1, .media-toolbar h1` rule (currently `font-weight: 700`)
- Modify: `DESIGN.md` -- insert a `## Admin Surface` section between the end of `## Shapes` and `## Components`

**Interfaces:**
- Consumes: the root tokens in `src/styles/installer-tokens.css` (unchanged).
- Produces: `.admin-body` overrides `--radius-sm`, `--radius-input`, `--radius-card`, `--control-height`, `--text-title`, which layers 2-4 build on.

- [ ] **Step 1: Save the selector baseline before touching CSS**

Run:
```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build && node scripts/css-selector-diff.mjs --save "$S/layer1-selectors-before.json"
```
Expected: the build completes and the baseline file is written.

- [ ] **Step 2: Capture "before" screenshots for the owner**

Make a static copy of the Posts screen (real admin markup, built CSS), write the screenshot script, and shoot the copy together with the real sign-in page:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
mkdir -p "$S/layer1/before" "$S/layer1/after" "$S/layer1/shots"
cp "$(grep -l '\.admin-transition' dist/client/_astro/*.css | head -1)" "$S/layer1/before/app.css"
cp "$S/skeleton/index.html" "$S/skeleton/fonts.css" "$S/layer1/before/"
cp -R public/fonts "$S/layer1/before/fonts" && mkdir -p "$S/layer1/before/brand" && cp public/brand/tomecms-logo-color.png "$S/layer1/before/brand/"
cat > "$S/layer1/shoot.mjs" <<'EOF'
import { createRequire } from 'node:module';

const require = createRequire('/Users/tom/Projects/GitHub/tome-cms/package.json');
const { chromium } = require('@playwright/test');
const state = process.env.STATE;
if (state !== 'before' && state !== 'after') throw new Error('Set STATE to before or after.');
const out = `${process.env.S}/layer1/shots`;
const pages = [['posts', `http://localhost:8754/${state}/index.html`], ['signin', 'http://localhost:4321/admin?signin=1']];
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  for (const [width, height] of [[1440, 900], [768, 1024], [375, 812]]) {
    for (const [name, url] of pages) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${out}/${state}-${name}-${width}-${scheme}.png` });
      await page.close();
    }
  }
}
await browser.close();
EOF
(cd "$S/layer1" && python3 -m http.server 8754 >/dev/null 2>&1 &)
STATE=before node "$S/layer1/shoot.mjs"
ls "$S/layer1/shots" | wc -l
```
Expected: `12` -- PNGs named `before-{posts,signin}-{1440,768,375}-{light,dark}.png`.

- [ ] **Step 3: Write the failing test**

Create `tests/unit/admin-surface-tokens.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/styles/global.css');
const TOKENS = read('src/styles/installer-tokens.css');

/** The declarations of the first unindented rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

function declaration(body: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[;{\\s])${escaped}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();
}

test('the admin takes rounder corners, shorter controls and a smaller title than the site', () => {
  const admin = ruleBody(CSS, '.admin-body');
  assert.equal(declaration(admin, '--radius-sm'), '0.5rem');
  assert.equal(declaration(admin, '--radius-input'), '0.625rem');
  // Restated, not inherited: on :root it is an alias resolved there, so overriding
  // --radius-input alone would leave cards at 8px.
  assert.equal(declaration(admin, '--radius-card'), '0.875rem');
  assert.equal(declaration(admin, '--control-height'), '2.5rem');
  assert.equal(declaration(admin, '--text-title'), '1.75rem');
});

test('a touch screen keeps a 44px control in the admin', () => {
  assert.match(CSS, /@media \(pointer: coarse\) \{\s*\.admin-body \{\s*--control-height: 2\.75rem;\s*\}\s*\}/);
});

test('the public site and the installer keep the root tokens', () => {
  const root = ruleBody(TOKENS, ':root');
  assert.equal(declaration(root, '--radius-sm'), '0.375rem');
  assert.equal(declaration(root, '--radius-input'), '0.5rem');
  assert.equal(declaration(root, '--radius-card'), 'var(--radius-input)');
  assert.equal(declaration(root, '--control-height'), '3rem');
  assert.equal(declaration(root, '--text-title'), 'clamp(1.75rem, 6vw, 2.5rem)');
});

test('an admin page title is semibold', () => {
  assert.equal(declaration(ruleBody(CSS, '.admin-page__head h1,\n.media-toolbar h1'), 'font-weight'), '600');
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/admin-surface-tokens.test.ts`
Expected: 4 tests, 1 pass and 3 fail. The root-token test passes; the override test fails on `--radius-sm` (`undefined`), the coarse-pointer test finds no `@media (pointer: coarse)` rule, and the title test reads `700`.

- [ ] **Step 5: Add the overrides to `.admin-body`**

In `src/styles/global.css`, replace:

```css
.admin-body {
  min-width: 0;
  min-height: 100svh;
  background: var(--color-paper-2);
  color: var(--color-ink);
}
```

with:

```css
/* The admin's own shape and density (docs/specs/2026-09-17-admin-modern-ui-design.md):
 * rounder corners, 40px controls where a mouse points and 44px where a finger does, and a
 * 28px page title. Set on the admin's body rather than on :root, so the public site and the
 * installer, which share the root tokens, keep theirs. --radius-card is restated because on
 * :root it is an alias resolved there -- overriding --radius-input alone would not reach it. */
.admin-body {
  --radius-sm: 0.5rem;
  --radius-input: 0.625rem;
  --radius-card: 0.875rem;
  --control-height: 2.5rem;
  --text-title: 1.75rem;
  min-width: 0;
  min-height: 100svh;
  background: var(--color-paper-2);
  color: var(--color-ink);
}
@media (pointer: coarse) {
  .admin-body { --control-height: 2.75rem; }
}
```

- [ ] **Step 6: Make the page title semibold**

In the same file, in the rule

```css
.admin-page__head h1,
.media-toolbar h1 {
```

change `font-weight: 700;` to `font-weight: 600;`, and replace the comment above the rule with:

```css
/* --text-display is the hero token; this is a working surface that gets scanned, not a page
 * that gets read, and the sidebar already says which screen you are on. The admin sets
 * --text-title to 28px and the weight to semibold, so the title labels the screen without
 * taking the height the first rows of the list need. */
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/admin-surface-tokens.test.ts`
Expected: 4 tests, 4 pass.

- [ ] **Step 8: Record the overrides in DESIGN.md**

Insert this section immediately before the line `## Components`:

```markdown
## Admin Surface

The admin is a working surface -- scanned, not read -- and takes its own shape and density on
top of the tokens above. The values are set on `.admin-body` in `src/styles/global.css`, not
on `:root`, so the public site and the installer keep the root values.
`scripts/check-design-tokens.mjs` checks the root tables only; this table is the record for
the admin. The sidebar width and the icon set join it with the admin shell.

| Token | Root | Admin | Role in the admin |
|------|------|-------|-------------------|
| radius-sm | 0.375rem (6px) | 0.5rem (8px) | Nav items, menu items, chips |
| radius-input | 0.5rem (8px) | 0.625rem (10px) | Buttons, inputs, selects |
| radius-card | 0.5rem (8px) | 0.875rem (14px) | Cards, panels, story cards, empty states |
| control-height | 3rem (48px) | 2.5rem (40px); 2.75rem (44px) on a coarse pointer | Every control |
| text-title | clamp(1.75rem, 6vw, 2.5rem) | 1.75rem (28px), weight 600 | Page titles |

Design: `docs/specs/2026-09-17-admin-modern-ui-design.md`.

```

- [ ] **Step 9: Run the full checks**

Run: `npm run check`
Expected: `0 errors`, `DESIGN.md matches the token source of truth.`, every self-test passed.

Run: `npm run test:unit`
Expected: every test passes (304 before this task, 308 after).

- [ ] **Step 10: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/commit-layer1.txt" <<'EOF'
feat(admin): rounder corners, 40px controls and a 28px title, in the admin only

Layer 1 of docs/specs/2026-09-17-admin-modern-ui-design.md. The admin
sets its own radii, control height and page title on .admin-body, so
the public site and the installer keep the root tokens. Cards restate
--radius-card, because on :root it is an alias resolved there. A touch
screen keeps a 44px control. DESIGN.md records the values in a new
Admin Surface section, and a test pins both the overrides and the
untouched root tokens.
EOF
git add tests/unit/admin-surface-tokens.test.ts src/styles/global.css DESIGN.md
git commit -F "$S/commit-layer1.txt"
```

### Task 2: Verify the layer and hand it to the owner

**Files:** none in the repository; screenshots and copies go to `$S/layer1/`.

**Interfaces:**
- Consumes: the Task 1 commit and the baseline from Task 1 steps 1-2.
- Produces: `after-*.png` screenshots and a selector diff for the owner's review. Layer 2 starts only after the owner approves.

- [ ] **Step 1: Confirm no selector was lost**

Run:
```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build && node scripts/css-selector-diff.mjs --diff "$S/layer1-selectors-before.json"
```
Expected: no removed selectors; the only additions are `.admin-body` inside `@media (pointer: coarse)`.

- [ ] **Step 2: Capture "after" screenshots**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cp "$(grep -l '\.admin-transition' dist/client/_astro/*.css | head -1)" "$S/layer1/after/app.css"
cp "$S/layer1/before/index.html" "$S/layer1/before/fonts.css" "$S/layer1/after/"
cp -R "$S/layer1/before/fonts" "$S/layer1/before/brand" "$S/layer1/after/"
STATE=after node "$S/layer1/shoot.mjs"
ls "$S/layer1/shots" | grep -c '^after-'
```
Expected: `12` -- PNGs named `after-{posts,signin}-{1440,768,375}-{light,dark}.png`.

- [ ] **Step 3: Measure what moved**

In the Browser pane, at 1440x900, open `http://localhost:8754/after/index.html` and run:

```js
const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.height), getComputedStyle(el).borderTopLeftRadius]; };
({
  h1: box(document.querySelector('.admin-page__head h1')),
  button: box(document.querySelector('.admin-page__actions .admin-button')),
  control: box(document.querySelector('.admin-post-filters .admin-control')),
  card: box(document.querySelector('.admin-story-row')),
  tab: box(document.querySelector('.admin-post-tabs a')),
})
```
Expected: `h1` 28px tall; button and control 40px with `10px` corners; card corners `14px`; tab 40px.

Then, on the same page, run `window.__show('/admin')` (the copy exposes the overlay), wait one second, and read `document.querySelector('[data-page-transition] .skeleton--title').getBoundingClientRect().height`.
Expected: `28` -- the skeleton title follows `--text-title`.

- [ ] **Step 4: Confirm the public site did not move**

Run:
```bash
node --input-type=module -e "
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4321/th', { waitUntil: 'networkidle' });
console.log(await page.evaluate(() => [getComputedStyle(document.querySelector('.post-card__cover')).borderTopLeftRadius, getComputedStyle(document.querySelector('.post-filter a')).borderTopLeftRadius]));
await browser.close();
"
```
Expected: `[ '8px', '9999px' ]` -- unchanged.

- [ ] **Step 5: Send the before/after screenshots and stop for review**

Send `before-posts-1440-light.png`, `after-posts-1440-light.png`, `after-posts-375-dark.png` and `after-signin-1440-light.png` with SendUserFile, report the measurements from step 3, and ask the owner to check the admin on their own machine. Do not start layer 2 until the owner approves.

- [ ] **Step 6: Clean up**

Run: `pid=$(lsof -ti tcp:8754); [ -n "$pid" ] && kill $pid`
Expected: port 8754 is free.
