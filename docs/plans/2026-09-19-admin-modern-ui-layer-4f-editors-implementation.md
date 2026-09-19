# Admin Modern UI, Layer 4f (The editors and their drawers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the writing screens: a drawer that closes and removes the way every other panel does, an insert menu that belongs to the same family as the admin's other menus, and the last utility chain in the editor written in tokens.

**Architecture:** The editors have no shell -- they are their own page with a sticky bar -- and that stays true. Their bar already leads with a primary publish button and keeps everything else secondary, so nothing there changes. What changes is three details: the drawer's close and remove buttons, the block insert menu's corner, padding and hover, and one `className` of Tailwind utilities left in `Editor.tsx`.

**Tech Stack:** Astro 5.18 with React islands (TipTap for the canvas), `node:test` via `tsx`, Playwright 1.63 (screenshots against a hand-built copy of the drawer's DOM).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` -- rollout layer 4, "the editors and their drawer". Layer 4e is `33368ba..24c781a`.

## What the editors already do right

- The bar leads with `--primary` for publish and keeps preview, settings and retry `--secondary`; every control in it clears 44px.
- The drawer is a `<dialog>` on the shared surface, with `.drawer-group` sections, `.admin-field` fields and `.admin-control` controls.
- The title input and the canvas use the display font and the token scale, and both editors share them.

## Global Constraints

- No new colour token, no new radius, no new icon.
- The drawer's close button keeps `autoFocus`, its `aria-label` and its ref -- it is the dialog's focus anchor, and moving focus is not what this layer is for.
- The insert menu's open animation (`block-menu-in`) and its positioning are not touched.
- Both drawers -- post and page -- change together, or the same panel is two panels again.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: The drawer closes the way every panel closes

**Files:**
- Modify: `src/components/admin/PostSettingsDrawer.tsx`, `src/components/admin/PageSettingsDrawer.tsx`
- Modify: `src/styles/global.css` (`.admin-cover-actions`, a remove hover)
- Test: `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer4f-selectors-before.json"
```
Expected: `24c781a`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

```ts
test('a settings drawer closes and removes the way every panel does', () => {
  for (const drawer of ['PostSettingsDrawer', 'PageSettingsDrawer']) {
    const source = read(`src/components/admin/${drawer}.tsx`);
    assert.match(source, /className="admin-button admin-button--ghost admin-button--icon"[\s\S]{0,200}<AdminIcon name="close" \/>/, `${drawer} does not close with the close icon`);
    assert.match(source, /aria-label=\{copy\.drawer\.closeSettings\}/, `${drawer} lost its close label`);
  }
  // The cover's remove is the bin the avatar and the passkey use.
  const post = read('src/components/admin/PostSettingsDrawer.tsx');
  assert.match(post, /<AdminIcon name="trash" \/>/, 'the cover remove is not an icon button');
  assert.match(post, /aria-label=\{copy\.drawer\.removeCover\}/, 'the cover remove has no label');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `PostSettingsDrawer does not close with the close icon`.

- [ ] **Step 3: Name what the cover's remove removes**

`copy.drawer.removeCover` does not exist; add it to both locales' `drawer` blocks in `src/lib/admin-i18n.ts`, alphabetically:

```ts
    removeCover: 'Remove cover image',
```

```ts
    removeCover: 'ลบภาพปก',
```

- [ ] **Step 4: Close with the close icon**

In both `src/components/admin/PostSettingsDrawer.tsx` and `src/components/admin/PageSettingsDrawer.tsx`:

```tsx
        <button autoFocus aria-label={copy.drawer.closeSettings} className="admin-button admin-button--ghost admin-button--icon" onClick={onClose} ref={closeButton} title={copy.drawer.closeSettings} type="button"><AdminIcon name="close" /></button>
```

with the import beside the other local ones:

```tsx
import AdminIcon from './AdminIcon';
```

- [ ] **Step 5: Remove the cover with the bin**

In `src/components/admin/PostSettingsDrawer.tsx`:

```tsx
            {coverImage && <button aria-label={copy.drawer.removeCover} className="admin-button admin-button--ghost admin-button--icon admin-cover-remove" onClick={() => onChangeCover(null)} title={copy.drawer.removeCover} type="button"><AdminIcon name="trash" /></button>}
```

- [ ] **Step 6: Give it the same hover**

In `src/styles/global.css`, extend the rule written in layer 4e:

```css
.security-key__delete:hover:not(:disabled),
.profile-avatar-remove:hover:not(:disabled),
.admin-cover-remove:hover:not(:disabled) { color: var(--color-error-ink); }
```

- [ ] **Step 7: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ errors"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 8: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4f-drawer.txt" <<'EOF'
feat(admin): the settings drawer closes and removes the way every panel does

The drawer closed with a bordered button reading "Close" -- the only panel in
the admin that still closes with a word, now that the file details dialog uses
the ghost icon button. Both drawers take that button, keeping the label that
tells a screen reader what it closes, and the cover's remove becomes the bin
the avatar and the passkey use, named for what it removes rather than "remove"
beside the button that chooses.
EOF
git add -- src/components/admin/PostSettingsDrawer.tsx src/components/admin/PageSettingsDrawer.tsx src/lib/admin-i18n.ts src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4f-drawer.txt
```

---

### Task 2: The insert menu joins the admin's menus

**Files:**
- Modify: `src/styles/global.css` (`.block-insert-menu`, `.block-insert-item`, `.block-insert-item:hover`)
- Modify: `src/components/admin/Editor.tsx` (the utility chain on the navigating notice)
- Test: `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('the insert menu is the same menu as the others', () => {
  assert.equal(declaration(ruleBody(CSS, '.block-insert-menu'), 'border-radius'), 'var(--radius-card)');
  assert.equal(declaration(ruleBody(CSS, '.block-insert-menu'), 'padding'), 'var(--space-2xs)');
  const item = ruleBody(CSS, '.block-insert-item');
  assert.equal(declaration(item, 'border-radius'), 'var(--radius-sm)');
  assert.equal(declaration(item, 'padding'), 'var(--space-xs) var(--space-sm)');
  assert.match(ruleBody(CSS, '.block-insert-item:hover,\n.block-insert-item:focus'), /var\(--color-paper-3\)/);
  // The editor's last utility chain.
  assert.doesNotMatch(read('src/components/admin/Editor.tsx'), /className="mb-6 flex/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, the menu's radius is `var(--radius-input)`.

- [ ] **Step 3: Give the menu the admin's corners and spacing**

In `src/styles/global.css`:

```css
.block-insert-menu {
  position: absolute;
  width: min(12rem, calc(100vw - 2rem));
  padding: var(--space-2xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-paper);
  animation: block-menu-in 120ms ease-out;
}

.block-insert-item {
  display: block;
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  color: var(--color-ink);
  font-size: var(--text-sm);
  text-align: left;
}

.block-insert-item:hover,
.block-insert-item:focus {
  background: var(--color-paper-3);
}
```

- [ ] **Step 4: Write the notice in tokens**

In `src/components/admin/Editor.tsx`, the navigating notice:

```tsx
        {isNavigating && <p className="admin-editor-notice" role="status">{copy.editor.opening} <button className="admin-button admin-button--secondary" onClick={cancelNavigation} type="button">{copy.editor.stayInEditor}</button></p>}
```

and in `src/styles/global.css`, beside the other editor rules:

```css
/* The line that appears while a link out of the editor is being followed, with the way
 * back beside it. */
.admin-editor-notice { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); margin-block-end: var(--space-lg); color: var(--color-muted); font-size: var(--text-sm); }
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ errors"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4f-menu.txt" <<'EOF'
feat(admin): the insert menu is the same menu as the others

The menu that adds a block had a control's corner, its own padding in
hardcoded rems and a hover a shade off the one every other menu uses. It takes
the card corner, the small corner on its items and the same hover, so the
three menus in the admin -- a row's, a select's and this one -- are one menu
drawn in three places.

The editor's last row of utility classes goes with it: the notice that appears
while a link out of the editor is being followed is a named rule now.
EOF
git add -- src/styles/global.css src/components/admin/Editor.tsx tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4f-menu.txt
```

---

### Task 3: Verify the layer and hand it to the owner

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/layer4f-selectors-before.json"
```
Expected: `.admin-editor-notice` and `.admin-cover-remove:hover` added, declarations changed on the three block-insert rules; the Tailwind utilities the chain used may disappear if nothing else uses them. Any other removal is a mistake -- stop and find out why.

- [ ] **Step 2: Build the fixture and shoot it**

The editor has no shell, so the copy is the editor itself. Write `$S/layer4f/editor-body.html` mirroring `Editor.tsx`: the `.admin-editor` with its sticky `.admin-editor-bar` (back link, the two language links, save state, preview, settings, publish), the `.admin-editor-canvas` with a title and three paragraphs, a `.block-insert` trigger with its menu open beside them, and the `.admin-editor-settings` drawer rendered as a plain `<div class="admin-editor-settings" open>` so it needs no script. Render it through `AdminLayout` only -- no shell -- by copying `$S/layer4e/render.mjs` and dropping the `AdminShell` call, then serve on 8762 and shoot 1440 and 375, light and dark.

- [ ] **Step 3: Look at the shots**

Check: the drawer's close is the icon button at the head's right; the cover's remove sits beside the picker without a word; the insert menu's corner matches a row menu's; the bar still fits on one line at 1440 and wraps at 375. Anything wrong is a bug -- fix it, rebuild, re-shoot.

- [ ] **Step 4: Hand it over**

```bash
for p in 8761 8762; do lsof -ti "tcp:$p" >/dev/null 2>&1 && lsof -ti "tcp:$p" | xargs kill; done
```

Send the 1440 light and dark shots with SendUserFile, report what changed in one short table, and ask the owner to check the editor on their own machine -- opening the settings drawer, removing a cover, and the slash and plus menus in the canvas, none of which a static copy exercises. Then only Sign-in is left.
