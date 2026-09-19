# Admin Modern UI, Layer 4b (Media) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the file library out of the admin's own parts -- the same page frame, the same search field, the same card surface, the same empty state and the same controls in its dialog -- so it stops being the one screen with a design of its own.

**Architecture:** Media is a React island (`MediaLibrary.tsx`, `client:only`), so its markup is edited in TSX and its styling in the same `global.css` block as every other admin screen. The utility chains it inherited (`@apply rounded-lg border-line bg-surface ...`) are replaced by the tokens those utilities were standing in for. The icon map gains a React twin of `AdminIcon.astro` so an island can draw the same icons a page can.

**Tech Stack:** Astro 5.18 with a React island, Tailwind v3 (`@apply` is being removed, not added), `node:test` via `tsx`, Playwright 1.63 (screenshots against a hand-built copy of the island's DOM).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` -- "Media, Navigation, Categories and the form screens are built from these pieces rather than styled one by one", rollout layer 4. Layers 1-3 are `af9f765`, `5f65f66..d26a4e1`, `3131cfa..234f3e0`; layer 4a is `4776b58..bed09a7`.

## Global Constraints

- No new colour token, and no new radius. Everything here already exists on `.admin-body`.
- The island keeps its behaviour: upload, folders, search, paging, the details dialog and the picker mode are not touched beyond the classes and elements named below.
- `MediaLibrary` renders in two modes -- `manage` (the Media screen) and `select` (the picker inside the editors). Every change must hold in both; the picker has no page head.
- The media skeleton (`AdminSkeleton.astro`, kind `media`) is built from the real classes, so whatever the frame becomes, it becomes there too.
- Icon paths stay in `src/lib/admin-icons.ts`. The React component sets them as HTML because they are module constants, never user input -- the same thing `AdminIcon.astro` does with `set:html`.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: An icon component an island can use

**Files:**
- Create: `src/components/admin/AdminIcon.tsx`
- Test: `tests/unit/admin-icons.test.ts`

**Interfaces:**
- Produces: `AdminIcon` (React), same props as the Astro one -- `{ name: AdminIconName }` -- used by Tasks 2 and 4.

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer4b-selectors-before.json"
```
Expected: `bed09a7`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-icons.test.ts`, add:

```ts
test('both icon components draw the same svg', () => {
  // One icon set, two renderers: a page uses the Astro component, an island the React one.
  // If their attributes drift, the same icon looks different depending on who drew it.
  const astro = read('src/components/admin/AdminIcon.astro');
  const react = read('src/components/admin/AdminIcon.tsx');
  for (const attribute of ['aria-hidden', 'fill="none"', 'stroke="currentColor"', 'viewBox="0 0 24 24"']) {
    assert.match(astro, new RegExp(attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `astro: ${attribute}`);
    assert.match(react, new RegExp(attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `react: ${attribute}`);
  }
  for (const [name, pattern] of [['stroke width', /strokeWidth=\{1\.5\}/], ['line cap', /strokeLinecap="round"/]] as const) {
    assert.match(react, pattern, `react: ${name}`);
  }
});
```

and, at the top of the file beside the existing imports:

```ts
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-icons.test.ts 2>&1 | tail -20
```
Expected: FAIL, `ENOENT ... AdminIcon.tsx`.

- [ ] **Step 3: Write the component**

Create `src/components/admin/AdminIcon.tsx`:

```tsx
import { ADMIN_ICONS, type AdminIconName } from '../../lib/admin-icons';

interface AdminIconProps {
  name: AdminIconName;
}

/**
 * The twin of AdminIcon.astro, for the screens that render in the browser.
 *
 * The paths come from a module constant and never from anything a visitor or the owner
 * typed, which is what makes setting them as HTML safe here -- the same reason the Astro
 * component can use `set:html`.
 */
export default function AdminIcon({ name }: AdminIconProps) {
  return (
    <svg
      aria-hidden="true"
      className="admin-icon"
      dangerouslySetInnerHTML={{ __html: ADMIN_ICONS[name] }}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    />
  );
}
```

- [ ] **Step 4: Run the tests and the type check**

```bash
npx tsx --test tests/unit/admin-icons.test.ts 2>&1 | tail -6 && npm run check 2>&1 | tail -3
```
Expected: PASS, and the check passes.

- [ ] **Step 5: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4b-icon.txt" <<'EOF'
feat(admin): the icon set gets a React renderer

Every icon so far has been drawn by an Astro component, which a screen that
renders in the browser cannot call. The file library is one of those, so the
same map gets a second renderer with the same attributes -- pinned by a test,
because two renderers are two chances for an icon to drift.
EOF
git add -- src/components/admin/AdminIcon.tsx tests/unit/admin-icons.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4b-icon.txt
```

---

### Task 2: Media takes the admin's page frame and search field

**Files:**
- Modify: `src/components/admin/MediaLibrary.tsx` (the `media-shell` section and its toolbar)
- Modify: `src/components/admin/AdminSkeleton.astro` (kind `media`)
- Modify: `src/styles/global.css` (`.media-shell`, `.media-toolbar`, `.media-toolbar__actions`)
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `AdminIcon` (React) from Task 1, `.admin-page`, `.admin-page__head`, `.admin-search` from layers 1-3.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add:

```ts
test('the file library stands in the same frame as every other screen', () => {
  const library = read('src/components/admin/MediaLibrary.tsx');
  assert.match(library, /className="admin-page-{0,2}__head"|className="admin-page__head"/, 'media has no admin page head');
  assert.match(library, /className="admin-search/, 'the media search is not the shared field');
  assert.match(library, /<AdminIcon name="search" \/>/, 'the media search has no magnifier');
  // The page frame belongs to the manage mode; the picker is a dialog and has no page.
  assert.match(library, /props\.mode === 'manage'/, 'the frame is not conditional on the mode');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `media has no admin page head`.

- [ ] **Step 3: Put the screen in the frame**

In `src/components/admin/MediaLibrary.tsx`, replace the toolbar block:

```tsx
    <section className="media-shell" data-mode={props.mode}>
      <div className="media-toolbar">
        <div>
          <h1 ref={mediaHeading} tabIndex={-1}>{copy.media.heading}</h1>
          <p>{copy.media.subheading}</p>
        </div>
        <div className="media-toolbar__actions">
          <label className="min-w-0"><span className="sr-only">{copy.media.searchFiles}</span><input className="admin-control" onChange={(event) => setSearch(event.target.value)} placeholder={copy.media.searchFiles} type="search" value={search} /></label>
          <label className="admin-button admin-button--primary media-upload"><span>{uploading ? copy.media.uploading : copy.media.uploadImage}</span><input accept={ACCEPTED_IMAGE_TYPES.join(',')} className="sr-only" disabled={uploading} onChange={handleUpload} type="file" /></label>
        </div>
      </div>
```

with the frame the other screens use, kept out of the picker:

```tsx
    <section className="media-shell" data-mode={props.mode}>
      {props.mode === 'manage' && (
        <div className="admin-page__head">
          <div>
            <h1 ref={mediaHeading} tabIndex={-1}>{copy.media.heading}</h1>
            <p>{copy.media.subheading}</p>
          </div>
        </div>
      )}
      <div className="media-toolbar">
        <label className="admin-search media-search">
          <span className="sr-only">{copy.media.searchFiles}</span>
          <AdminIcon name="search" />
          <input className="admin-control" onChange={(event) => setSearch(event.target.value)} placeholder={copy.media.searchFiles} type="search" value={search} />
        </label>
        <label className="admin-button admin-button--primary media-upload"><span>{uploading ? copy.media.uploading : copy.media.uploadImage}</span><input accept={ACCEPTED_IMAGE_TYPES.join(',')} className="sr-only" disabled={uploading} onChange={handleUpload} type="file" /></label>
      </div>
```

and import the component beside the others at the top of the file:

```tsx
import AdminIcon from './AdminIcon';
```

- [ ] **Step 4: Give the frame its rules**

In `src/styles/global.css`, replace `.media-shell`, `.media-toolbar` and `.media-toolbar__actions`:

```css
/* The same frame as Posts and Pages, rather than a page width of its own. In the picker
 * the section is inside a dialog, which brings its own padding. */
.media-shell[data-mode="manage"] { width: min(100%, 80rem); margin-inline: auto; padding: var(--space-xl) clamp(var(--space-md), 4vw, var(--space-xl)); }
.media-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 22rem) auto;
  justify-content: space-between;
  gap: var(--space-sm);
  align-items: center;
  min-width: 0;
  padding-block-end: var(--space-lg);
  border-block-end: var(--rule-hair) solid var(--color-rule);
}
/* A label is inline by default, and the magnifier is positioned against this box. */
.media-search { display: block; }
```

(`.admin-search` deliberately declares no `display`, which is why the media label sets its own.)

- [ ] **Step 5: Make the skeleton match**

In `src/components/admin/AdminSkeleton.astro`, the `media` branch draws the old toolbar. Replace its head with the page head the screen now renders:

```astro
      <div class="media-shell" data-mode="manage">
        <div class="admin-page__head">
          <div>
            <span class="skeleton skeleton--title"></span>
            <span class="skeleton-line admin-skeleton__lede"></span>
          </div>
        </div>
        <div class="media-toolbar">
          <span class="skeleton skeleton--control"></span>
          <span class="skeleton skeleton--button" style="--skeleton-width: 8rem"></span>
        </div>
```

- [ ] **Step 6: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4b-frame.txt" <<'EOF'
feat(admin): the file library stands in the same frame as every other screen

Media had a page width, a heading and a search field of its own, so moving
between it and Posts moved the title, changed its size and moved the field you
type a query into. It now uses the admin page head and the shared search
field, magnifier and all, and the skeleton that stands in for it follows.

The picker -- the same component inside an editor's dialog -- keeps no page
head, because a dialog is not a page.
EOF
git add -- src/components/admin/MediaLibrary.tsx src/components/admin/AdminSkeleton.astro src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4b-frame.txt
```

---

### Task 3: Cards, folders, empty and status on the shared surfaces

**Files:**
- Modify: `src/styles/global.css` (`.media-card`, `.media-card img`, `.media-card-select`, `.media-empty`, `.media-status`, `.media-category`, `.media-grid`, `.media-library-layout`, `.media-category-form`, `.media-category-row`)
- Modify: `src/components/admin/MediaLibrary.tsx` (the empty state's markup and the two inline utility-class buttons)
- Test: `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`, add:

```ts
test('the media surfaces are tokens, not utility chains', () => {
  for (const selector of ['.media-card', '.media-empty', '.media-status', '.media-grid']) {
    assert.doesNotMatch(ruleBody(CSS, selector), /@apply/, `${selector} still borrows its look from utilities`);
  }
  assert.equal(declaration(ruleBody(CSS, '.media-card'), 'border-radius'), 'var(--radius-card)');
  // The empty state is the one the lists use, icon and all.
  assert.match(read('src/components/admin/MediaLibrary.tsx'), /className="admin-empty"/);
  assert.match(read('src/components/admin/MediaLibrary.tsx'), /<AdminIcon name="media" \/>/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `.media-card still borrows its look from utilities`.

- [ ] **Step 3: Rewrite the surfaces**

In `src/styles/global.css`:

```css
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(11rem, 100%), 1fr));
  gap: var(--space-md);
  margin-block-start: var(--space-lg);
}
/* A file is a card, on the same surface a post card uses: paper, a quiet hairline and the
 * card corner. Only the picture paints into a corner, so it rounds its own. */
.media-card {
  display: grid;
  min-width: 0;
  align-content: start;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-paper);
  color: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color var(--dur-short) var(--ease-out);
}
.media-card:hover { border-color: var(--color-rule-strong); }
.media-card:focus-visible { outline: 2px solid var(--color-focus); outline-offset: var(--space-3xs); }
.media-card img {
  width: 100%;
  margin-block-end: var(--space-xs);
  border-radius: calc(var(--radius-card) - var(--rule-hair)) calc(var(--radius-card) - var(--rule-hair)) 0 0;
  background: var(--color-paper-3);
}
.media-card strong { padding-inline: var(--space-sm); font-size: var(--text-sm); }
.media-card > span:not(.media-card-select) { padding: 0 var(--space-sm) var(--space-sm); }
.media-card-select {
  margin-block-start: var(--space-xs);
  padding-block: var(--space-xs);
  border-block-start: var(--rule-hair) solid var(--color-rule);
  color: var(--color-link);
  font-size: var(--text-sm);
  font-weight: 500;
  text-align: center;
}
.media-empty { margin-block-start: var(--space-lg); }
.media-status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
  justify-content: center;
  margin-block-start: var(--space-lg);
  color: var(--color-muted);
  font-size: var(--text-sm);
  text-align: center;
}
```

and give the folder chip the same shape a nav item has:

```css
.media-category {
  min-height: var(--control-height);
  padding-inline: var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-paper);
  color: var(--color-ink);
  font-size: var(--text-sm);
  text-align: start;
  cursor: pointer;
}
.media-category:hover { background: var(--color-paper-3); }
.media-category[aria-pressed='true'] { border-color: var(--color-accent); color: var(--color-link); font-weight: 500; }
```

Leave `.media-library-layout`, `.media-category-form` and `.media-category-row` as they are unless the test above names them; their `@apply` is layout, not surface.

- [ ] **Step 4: Put the shared empty state in**

In `src/components/admin/MediaLibrary.tsx`, replace the empty block:

```tsx
{!loading && !error && !items.length && <div className="media-empty"><h2 className="font-display text-[22px] font-bold leading-7 tracking-[-0.25px]">{copy.media.emptyTitle}</h2><p className="mt-2 text-sm text-muted">{copy.media.emptyBody}</p></div>}
```

with the one the lists use:

```tsx
{!loading && !error && !items.length && (
  <div className="admin-empty media-empty">
    <span className="admin-empty__mark" aria-hidden="true"><AdminIcon name="media" /></span>
    <div><h2>{copy.media.emptyTitle}</h2><p>{copy.media.emptyBody}</p></div>
  </div>
)}
```

and turn the two retry links -- `className="font-medium text-accent underline"` on the folder error and the load error -- into `className="admin-button admin-button--ghost"`.

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4b-surfaces.txt" <<'EOF'
feat(admin): files sit on the card surface the rest of the admin uses

A file card was a rounded-lg box with an accent border on hover, an empty
library was a centred panel with a 22px display heading, and both were written
as utility chains -- so the one screen that is mostly surfaces was the one
screen whose surfaces came from somewhere else. All of it is tokens now: the
card corner, the quiet hairline, paper, and the empty state the lists use,
with the media icon in its circle.
EOF
git add -- src/styles/global.css src/components/admin/MediaLibrary.tsx tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4b-surfaces.txt
```

---

### Task 4: The details dialog uses the admin's controls

**Files:**
- Modify: `src/components/admin/MediaLibrary.tsx` (the `media-details` dialog)
- Modify: `src/styles/global.css` (`.media-details textarea, .media-details input`, `.media-details-actions button`, `.media-details-close`)
- Test: `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('the details dialog uses the admin controls', () => {
  const library = read('src/components/admin/MediaLibrary.tsx');
  const dialog = library.slice(library.indexOf('className="media-details"'));
  for (const control of ['<textarea', '<input']) {
    const at = dialog.indexOf(control);
    assert.ok(at > -1, `the dialog has no ${control}`);
    assert.match(dialog.slice(at, at + 400), /className="admin-control/, `${control} is not an admin control`);
  }
  assert.match(dialog, /className="admin-button admin-button--primary"/, 'save is not the primary button');
  assert.match(dialog, /className="admin-button admin-button--danger"/, 'delete is not the danger button');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `<textarea is not an admin control`.

- [ ] **Step 3: Dress the dialog**

In the `media-details` dialog in `src/components/admin/MediaLibrary.tsx`:

- the alt-text `<textarea>` gains `className="admin-control admin-control--textarea"`;
- the read-only URL `<input>` gains `className="admin-control"`;
- the close button becomes `className="admin-button admin-button--ghost admin-button--icon media-details-close"` with `<AdminIcon name="close" />` in place of the word, keeping its `aria-label`;
- the three action buttons become `admin-button admin-button--primary` (save), `admin-button` (copy URL) and `admin-button admin-button--danger` (delete);
- the retry button inside the delete error becomes `admin-button`.

- [ ] **Step 4: Drop the rules those classes replace**

In `src/styles/global.css`, delete `.media-details textarea, .media-details input { @apply ... }` and `.media-details-actions button { @apply ... }`, and keep `.media-details-close` only for where it sits:

```css
.media-details-close { position: sticky; inset-block-start: 0; float: inline-end; }
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4b-dialog.txt" <<'EOF'
feat(admin): the file details dialog uses the admin's own controls

The dialog had its own inputs and its own buttons -- 6px corners, a hover that
tinted the border, three actions of equal weight including delete. It uses the
admin controls now, so save reads as the primary action, delete as the
destructive one, and the close button is the ghost icon button the top bar
uses.
EOF
git add -- src/components/admin/MediaLibrary.tsx src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4b-dialog.txt
```

---

### Task 5: Verify the layer and hand it to the owner

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/layer4b-selectors-before.json"
```
Expected: `.media-toolbar__actions` and the two dialog-control rules removed (their classes are gone), `.media-search`, `.media-card:hover`, `.media-card:focus-visible` and `.media-shell[data-mode="manage"]` added, declarations changed on the media surfaces. Any other removal is a mistake -- stop and find out why.

- [ ] **Step 2: Build the fixture**

The library renders in the browser, so a static copy of the route shows only its skeleton. Write `$S/layer4b/media-body.html` by hand, mirroring the island's DOM: the `.media-shell[data-mode="manage"]` section, the `.admin-page__head`, the `.media-toolbar` with the search label and the upload button, the folder chips, and a `.media-grid` of six `.media-card` buttons whose `<img>` is an inline SVG data URI. Add a second file, `$S/layer4b/media-empty.html`, identical but with the `.admin-empty` block in place of the grid. Render both through the shell:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
mkdir -p "$S/layer4b/site" "$S/layer4b/shots" && cp "$S/layer4a/render.mjs" "$S/layer4b/render.mjs"
```

Then edit `$S/layer4b/render.mjs` to render the two media bodies with `active: 'media'`, `title: 'คลังไฟล์'`, and run it with `node --env-file=.env.local`.

- [ ] **Step 3: Screenshot both, both themes, three widths**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cd "$S/layer4b/site" && (python3 -m http.server 8758 >/dev/null 2>&1 &) ; sleep 1; curl -sI http://localhost:8758/media.html | head -1
```

Then shoot `media.html` and `media-empty.html` at 1440, 768 and 375, light and dark, into `$S/layer4b/shots`.

- [ ] **Step 4: Look at the shots**

Check: the title sits where Posts' title sits and is the same size; the search field carries its magnifier and the text clears it; the cards are paper with the card corner and the picture's top corners follow it; the empty state's icon is centred in its circle; the folder chips read as one row of pills. Anything wrong is a bug -- fix it, rebuild, re-shoot.

- [ ] **Step 5: Hand it over**

```bash
for p in 8757 8758; do lsof -ti "tcp:$p" >/dev/null 2>&1 && lsof -ti "tcp:$p" | xargs kill; done
```

Send the 1440 light and dark shots and the empty-state shot with SendUserFile, report what changed in one short table, and ask the owner to check Media on their own machine -- the upload button, the folder chips and the details dialog in particular, since none of those can be exercised in a static copy. Do not start Navigation until the owner approves.
