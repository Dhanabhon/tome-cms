# Admin Modern UI, Layer 4c (Navigation) Implementation Plan

> **Executed and shipped on 2026-09-19 as layer 4c, `d011c99..95bb9f2`.** The steps below were run
> inline rather than ticked off, so their boxes stay empty; the commits are the record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the menu editor read like the rest of the admin: tabs that look like the tabs on Posts and Pages, a row whose actions are the icon buttons the admin uses everywhere else, and an empty menu that says so the way every other empty list does.

**Architecture:** Navigation is a React island that already stands in `.admin-page`, lists its items in the same panel the Pages list uses, and got the shared dialog surface in layer 3. So this layer is small and specific: four icons, one shared tab rule, the row's three text buttons becoming icon buttons that keep their labels for anyone who cannot see them, and the shared empty state.

**Tech Stack:** Astro 5.18 with a React island, `node:test` via `tsx`, Playwright 1.63 (screenshots against a hand-built copy of the island's DOM).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` -- "Media, Navigation, Categories and the form screens are built from these pieces", rollout layer 4. Layers 1-3 are `af9f765`, `5f65f66..d26a4e1`, `3131cfa..234f3e0`; layer 4a is `4776b58..bed09a7`, layer 4b `61818ff..f526ba2`.

## Global Constraints

- No new colour token and no new radius.
- The tabs are real ARIA tabs -- `role="tablist"`, `role="tab"`, arrow-key switching, `aria-selected` -- and stay that way. Only their look is shared with the Posts tabs, which are links.
- A button that loses its words keeps them for a screen reader: every icon button carries the `aria-label` its text used to be, and a `title` so a pointer can read it too.
- The drag-and-drop reorder, the dirty tracking per location and language, and the save flow are not touched.
- Icon paths stay in `src/lib/admin-icons.ts`, adapted from Lucide under its ISC licence; the test there already refuses anything but `path`, `rect` and `circle`.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: Four icons for a list you reorder

**Files:**
- Modify: `src/lib/admin-icons.ts`
- Test: `tests/unit/admin-icons.test.ts`

**Interfaces:**
- Produces: `ADMIN_ICONS.grip`, `.up`, `.down`, `.trash`, used by Task 3.

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer4c-selectors-before.json"
```
Expected: `f526ba2`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-icons.test.ts`, extend the list screens' test with the four the menu editor needs:

```ts
test('the menu editor has the icons it draws', () => {
  for (const name of ['grip', 'up', 'down', 'trash'] as const) assert.ok(ADMIN_ICONS[name], `no icon for ${name}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-icons.test.ts 2>&1 | tail -20
```
Expected: FAIL, `no icon for grip`.

- [ ] **Step 3: Add the icons**

In `src/lib/admin-icons.ts`, after `more`:

```ts
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
```

- [ ] **Step 4: Run the tests**

```bash
npx tsx --test tests/unit/admin-icons.test.ts 2>&1 | tail -6
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4c-icons.txt" <<'EOF'
feat(admin): a grip, two chevrons and a bin for the menu editor

The menu is the one list you reorder by hand, and every control that does it
was a word or a typed character. Four icons for the next commit to use.
EOF
git add -- src/lib/admin-icons.ts tests/unit/admin-icons.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4c-icons.txt
```

---

### Task 2: The menu's tabs are the admin's tabs

**Files:**
- Modify: `src/styles/global.css` (the `.admin-post-tabs` rules, `.navigation-tabs`)
- Modify: `src/components/admin/NavigationManager.tsx` (drop `admin-button` from the two tablists' buttons)
- Test: `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('every set of tabs in the admin is drawn the same way', () => {
  // Posts and Pages tab with links; the menu editor tabs with real ARIA tabs. Different
  // elements, one look -- otherwise the same control is two controls on two screens.
  const tabs = ruleBody(CSS, '.admin-post-tabs,\n.navigation-tabs');
  assert.match(tabs, /border-block-end: var\(--rule-hair\) solid var\(--color-rule\)/);
  const item = ruleBody(CSS, '.admin-post-tabs a,\n.navigation-tabs [role="tab"]');
  assert.equal(declaration(item, 'min-height'), 'var(--control-height)');
  assert.match(read('src/components/admin/NavigationManager.tsx'), /className="navigation-tab"/, 'the tabs are still admin-buttons');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `no rule for .admin-post-tabs,\n.navigation-tabs`.

- [ ] **Step 3: Share the tab rules**

In `src/styles/global.css`, widen the two Posts tab rules to cover the menu editor's tablists, and give the selected tab the same underline:

```css
.admin-post-tabs,
.navigation-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
  margin-block-start: var(--space-xl);
  border-block-end: var(--rule-hair) solid var(--color-rule);
}
.admin-post-tabs a,
.navigation-tabs [role="tab"] {
  display: inline-flex;
  /* A flex container drops whitespace-only text nodes, so the space between the label
   * and its count has to be a gap or the two run together. */
  gap: var(--space-2xs);
  min-inline-size: 44px;
  min-height: var(--control-height);
  align-items: center;
  justify-content: center;
  padding-inline: var(--space-xs);
  border: 0;
  border-block-end: 2px solid transparent;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  text-decoration: none;
}
.admin-post-tabs a[aria-current="page"],
.navigation-tabs [aria-selected="true"] { border-color: var(--color-ink); color: var(--color-ink); font-weight: 600; }
.navigation-tabs [role="tab"]:disabled { cursor: not-allowed; opacity: 0.55; }
```

and delete the three rules this replaces -- the old `.admin-post-tabs { ... }`, `.admin-post-tabs a { ... }`, `.admin-post-tabs a[aria-current="page"] { ... }` and `.navigation-tabs [aria-selected="true"] { border-color: var(--color-accent); background: var(--color-paper-3); }`. Keep `.navigation-tabs { margin-block-end: var(--space-md); }` as a second declaration after the shared rule, and drop `.navigation-tabs` from the flex row it shared with `.navigation-save` and the two action rows.

- [ ] **Step 4: Take the button class off the tabs**

In `src/components/admin/NavigationManager.tsx`, both tablists render their tabs with `className="admin-button"`. Change both to `className="navigation-tab"`, and add the rule:

```css
.navigation-tab { min-width: 0; }
```

(the class is the test's handle and the place to put anything a tab needs that a link does not).

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4c-tabs.txt" <<'EOF'
feat(admin): the menu editor tabs the way the lists tab

Posts and Pages tab with an underline; the menu editor tabbed with a row of
buttons, one of them tinted. Same control, two drawings. The rules are shared
now -- links on one screen, real ARIA tabs on the other, one look -- and the
tabs stop being buttons that happen to have a role.
EOF
git add -- src/styles/global.css src/components/admin/NavigationManager.tsx tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4c-tabs.txt
```

---

### Task 3: A menu item's controls become icon buttons

**Files:**
- Modify: `src/components/admin/NavigationManager.tsx` (the grip, the three row buttons, the add button, the empty state)
- Modify: `src/styles/global.css` (`.navigation-grip`, `.navigation-item__actions`, `.navigation-empty`, `.navigation-remove`)
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `AdminIcon` (React) from layer 4b, and the four icons from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
test('a menu item is handled with icons that keep their words', () => {
  const manager = read('src/components/admin/NavigationManager.tsx');
  assert.doesNotMatch(manager, /⠿/, 'the grip is still a typed character');
  for (const name of ['grip', 'up', 'down', 'trash']) {
    assert.match(manager, new RegExp(`<AdminIcon name="${name}" />`), `no ${name} icon`);
  }
  // An icon button says what it does to anyone who cannot see it.
  for (const label of ['moveUp', 'moveDown', 'remove']) {
    assert.match(manager, new RegExp(`aria-label=\\{copy\\.navigation\\.${label}\\}`), `${label} lost its label`);
    assert.match(manager, new RegExp(`title=\\{copy\\.navigation\\.${label}\\}`), `${label} lost its title`);
  }
  assert.match(manager, /className="admin-empty navigation-empty"/, 'the empty menu is not the shared empty state');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `the grip is still a typed character`.

- [ ] **Step 3: Draw the grip**

In `src/components/admin/NavigationManager.tsx`:

```tsx
                  <span aria-hidden="true" className="navigation-grip"><AdminIcon name="grip" /></span>
```

and import the component beside `UiSelect`:

```tsx
import AdminIcon from './AdminIcon';
```

- [ ] **Step 4: Turn the row's three buttons into icon buttons**

```tsx
                    <button aria-label={copy.navigation.moveUp} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === 0} onClick={(event) => move(index, index - 1, event.currentTarget)} title={copy.navigation.moveUp} type="button"><AdminIcon name="up" /></button>
                    <button aria-label={copy.navigation.moveDown} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === items.length - 1} onClick={(event) => move(index, index + 1, event.currentTarget)} title={copy.navigation.moveDown} type="button"><AdminIcon name="down" /></button>
                    <button aria-label={copy.navigation.remove} className="admin-button admin-button--ghost admin-button--icon navigation-remove" disabled={saving} onClick={() => remove(index)} title={copy.navigation.remove} type="button"><AdminIcon name="trash" /></button>
```

- [ ] **Step 5: Make the add button the page's action, and the empty menu the shared one**

The head's button is the one thing this page is for, so it leads like "New post" does:

```tsx
        <button className="admin-button admin-button--primary" disabled={loading || !!loadError || saving} onClick={openAdd} ref={addButton} type="button">{copy.navigation.addItem}</button>
```

and the empty menu:

```tsx
            {!items.length && (
              <div className="admin-empty navigation-empty">
                <span className="admin-empty__mark" aria-hidden="true"><AdminIcon name="navigation" /></span>
                <div><p>{copy.navigation.empty}</p></div>
              </div>
            )}
```

- [ ] **Step 6: Give them their rules**

In `src/styles/global.css`, replace `.navigation-grip` and `.navigation-empty`, and add the bin's hover:

```css
/* The grip is a handle, so it takes the pointer that says so and nothing else. */
.navigation-grip { display: grid; align-self: start; place-items: center; min-height: var(--control-height); color: var(--color-muted); cursor: grab; }
.navigation-remove:hover:not(:disabled) { color: var(--color-error-ink); }
.navigation-empty { min-height: 0; padding-block: var(--space-lg); }
```

- [ ] **Step 7: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 8: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4c-items.txt" <<'EOF'
feat(admin): a menu item is handled with icons, not three labelled buttons

Every row carried three text buttons -- move up, move down, remove -- which is
more words than the item itself on a narrow screen, and a braille pattern
character for the drag handle. They are icon buttons now, ghost ones like the
top bar's, each keeping its words as a label and a title; the bin turns red
under the cursor. The empty menu uses the empty state the lists use, and the
button that adds an item leads the page the way New post leads Posts.
EOF
git add -- src/components/admin/NavigationManager.tsx src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4c-items.txt
```

---

### Task 4: Verify the layer and hand it to the owner

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/layer4c-selectors-before.json"
```
Expected: the old `.admin-post-tabs` rules replaced by the shared pair, `.navigation-tab`, `.navigation-remove:hover` added, `.navigation-tabs [aria-selected="true"]`'s tint gone. Any other removal is a mistake -- stop and find out why.

- [ ] **Step 2: Build the fixture**

Write `$S/layer4c/navigation-body.html`, mirroring the island's DOM: the `.admin-page navigation-manager` section, the page head with its primary button, the two tablists (locations, then languages) with the first tab selected, and a `.navigation-items` list of four items -- a home link, two pages (one of them a hidden draft), and a custom URL -- each with its grip, its label field, its target line, its visibility line and its three icon buttons. Add a second file, `$S/layer4c/navigation-empty.html`, with the shared empty state in place of the list. Then copy `$S/layer4b/render.mjs` to `$S/layer4c/render.mjs`, point it at the two bodies with `active: 'navigation'` and `title: 'เมนู'`, and run it with `node --env-file=.env.local`.

- [ ] **Step 3: Screenshot and measure**

Serve `$S/layer4c/site` on port 8759 and shoot both pages at 1440, 768 and 375, light and dark. Measure that the selected tab's underline sits on the tab row's bottom edge, that the three icon buttons are 40px wide and on one line with the label field, and that nothing overflows.

- [ ] **Step 4: Look at the shots**

Check: the tabs read as tabs, not buttons; the grip, chevrons and bin are drawn at one weight; a row's actions do not crowd its field on a phone; the empty state's icon is centred in its circle. Anything wrong is a bug -- fix it, rebuild, re-shoot.

- [ ] **Step 5: Hand it over**

```bash
for p in 8758 8759; do lsof -ti "tcp:$p" >/dev/null 2>&1 && lsof -ti "tcp:$p" | xargs kill; done
```

Send the 1440 light and dark shots and the 375 shot with SendUserFile, report what changed in one short table, and ask the owner to check Navigation on their own machine -- dragging an item, the arrow-key tab switching and the add dialog in particular, since none of those can be exercised in a static copy. Do not start Categories until the owner approves.
