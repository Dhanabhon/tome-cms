# Admin Modern UI, Layer 4d (Categories) Implementation Plan

> **Executed and shipped on 2026-09-19 as layer 4d, `1120622..8f1508b`.** The steps below were run
> inline rather than ticked off, so their boxes stay empty; the commits are the record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the categories screen with the two pieces it still writes its own way: a row's actions, which are text buttons where every other row in the admin now uses icons, and a category's post count, which is a sentence where every other count is a badge.

**Architecture:** Categories is a React island that already stands in the page frame the Astro route provides, lists its rows in one framed panel and uses the shared field, control and button. So this layer is two edits and one icon: a pencil, the row's two buttons becoming icon buttons that keep their labels, and the count becoming the badge the sidebar and the tabs use.

**Tech Stack:** Astro 5.18 with a React island, `node:test` via `tsx`, Playwright 1.63 (screenshots against a hand-built copy of the island's DOM).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` -- "Media, Navigation, Categories and the form screens are built from these pieces", rollout layer 4. Layer 4c is `d011c99..95bb9f2`.

## Global Constraints

- No new colour token and no new radius; the badge already exists as `.admin-nav-count` and `.admin-tab-count`.
- A button that loses its words keeps them: the two row buttons already carry `aria-label`s naming the category, and gain a `title` so a pointer can read them too.
- The count's wording stays whatever `postCountLabel` returns -- the badge shows the number and carries that sentence as its label, so nothing is lost to a screen reader.
- The rename form, the delete confirmation and the default category's protection are not touched.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: One badge for every count in the admin

**Files:**
- Modify: `src/styles/global.css` (`.admin-nav-count`, `.admin-tab-count`, a shared `.admin-count`)
- Modify: `src/components/admin/CategoryManager.tsx` (the row's count)
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Produces: `.admin-count`, the badge both the sidebar and the tabs already draw, now named once.

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer4d-selectors-before.json"
```
Expected: `95bb9f2`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

```ts
test('a count is one badge, wherever it is counted', () => {
  const badge = ruleBody(CSS, '.admin-count,\n.admin-nav-count,\n.admin-tab-count');
  assert.equal(declaration(badge, 'border-radius'), 'var(--radius-pill)');
  assert.equal(declaration(badge, 'background'), 'var(--color-paper-3)');
  // The number is shown; the sentence it came from stays as the label.
  const manager = read('src/components/admin/CategoryManager.tsx');
  assert.match(manager, /className="admin-count"/, 'the category count is not a badge');
  assert.match(manager, /aria-label=\{postCountLabel\(copy, category\.postCount\)\}/, 'the count lost its words');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `no rule for .admin-count,\n.admin-nav-count,\n.admin-tab-count`.

- [ ] **Step 3: Name the badge once**

In `src/styles/global.css`, replace the `.admin-nav-count` rule with the shared one (the tab count keeps its own second rule for the line height a tab needs):

```css
/* The same badge wherever the admin counts something: the sidebar, a tab, a category. */
.admin-count,
.admin-nav-count,
.admin-tab-count {
  flex: none;
  min-width: 1.5rem;
  padding-inline: var(--space-xs);
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.25rem;
  text-align: center;
}
```

and trim `.admin-tab-count` to what it adds:

```css
.admin-tab-count { padding-inline: var(--space-2xs); font-weight: 400; }
```

- [ ] **Step 4: Put the badge in the row**

In `src/components/admin/CategoryManager.tsx`:

```tsx
                      <span aria-label={postCountLabel(copy, category.postCount)} className="admin-count">{category.postCount}</span>
```

in place of `<p>{postCountLabel(copy, category.postCount)}</p>`.

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4d-count.txt" <<'EOF'
feat(admin): a count is one badge, wherever the admin counts something

The sidebar and the tabs draw the same badge from two rules, and a category
counted its posts in a sentence -- so the same fact was three shapes. One rule
now, and the category row shows the number with that sentence as its label.
EOF
git add -- src/styles/global.css src/components/admin/CategoryManager.tsx tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4d-count.txt
```

---

### Task 2: A category row is handled the way a menu item is

**Files:**
- Modify: `src/lib/admin-icons.ts` (a pencil)
- Modify: `src/components/admin/CategoryManager.tsx` (the two row buttons)
- Modify: `src/styles/global.css` (`.category-actions`, a delete hover)
- Test: `tests/unit/admin-icons.test.ts`, `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/admin-icons.test.ts`:

```ts
test('the category rows have the icon they draw', () => {
  assert.ok(ADMIN_ICONS.pencil, 'no icon for pencil');
});
```

In `tests/unit/admin-surface-tokens.test.ts`:

```ts
test('a category row is handled with icons that keep their words', () => {
  const manager = read('src/components/admin/CategoryManager.tsx');
  for (const name of ['pencil', 'trash']) {
    assert.match(manager, new RegExp(`<AdminIcon name="${name}" />`), `no ${name} icon`);
  }
  for (const label of ['renameLabelFor', 'deleteLabelFor']) {
    assert.match(manager, new RegExp(`title=\\{fill\\(copy\\.categories\\.${label}`), `${label} lost its title`);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx tsx --test tests/unit/admin-icons.test.ts tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `no icon for pencil`.

- [ ] **Step 3: Add the pencil**

In `src/lib/admin-icons.ts`, after `trash`:

```ts
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
```

- [ ] **Step 4: Draw the row's actions**

In `src/components/admin/CategoryManager.tsx`, the rename button:

```tsx
                          <button
                            aria-label={fill(copy.categories.renameLabelFor, { name: category.name })}
                            className="admin-button admin-button--ghost admin-button--icon"
                            onClick={() => { setEdit({ id: category.id, name: category.name }); setError(''); setLiveStatus(''); }}
                            ref={(button) => { if (button) renameButtons.current.set(category.id, button); }}
                            title={fill(copy.categories.renameLabelFor, { name: category.name })}
                            type="button"
                          >
                            <AdminIcon name="pencil" />
                          </button>
```

and the delete button:

```tsx
                          <button
                            aria-label={fill(copy.categories.deleteLabelFor, { name: category.name })}
                            className="admin-button admin-button--ghost admin-button--icon category-delete"
                            disabled={pendingActionIds.has(deleteAction)}
                            onClick={() => void deleteCategory(category)}
                            title={fill(copy.categories.deleteLabelFor, { name: category.name })}
                            type="button"
                          >
                            <AdminIcon name="trash" />
                          </button>
```

with the import beside the others:

```tsx
import AdminIcon from './AdminIcon';
```

- [ ] **Step 5: Give the bin its hover**

In `src/styles/global.css`, after `.category-actions { justify-content: end; }`:

```css
.category-delete:hover:not(:disabled) { color: var(--color-error-ink); }
```

- [ ] **Step 6: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4d-rows.txt" <<'EOF'
feat(admin): a category row is handled the way a menu item is

Rename and delete were text buttons on a row whose whole content is a name and
a number, so the actions outweighed the thing they acted on. They are the
ghost icon buttons the menu editor uses, each keeping the sentence naming its
category as a label and a title, and the bin turns red under the cursor.
EOF
git add -- src/lib/admin-icons.ts src/components/admin/CategoryManager.tsx src/styles/global.css tests/unit/admin-icons.test.ts tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4d-rows.txt
```

---

### Task 3: Verify the layer and hand it to the owner

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/layer4d-selectors-before.json"
```
Expected: `.admin-count` added to the badge rule, `.category-delete:hover` added, nothing removed. Any removal is a mistake -- stop and find out why.

- [ ] **Step 2: Build the fixture and shoot it**

Write `$S/layer4d/categories-body.html` mirroring the island's DOM inside the route's `.admin-page`: the head, the status line, the frame with its create form, and four rows -- the default category with its tag and no actions, two ordinary ones, and one in its rename form. Copy `$S/layer4c/render.mjs` to `$S/layer4d/render.mjs`, point it at the body with `active: 'posts'` (Categories lives under Posts) and `title: 'หมวดหมู่'`, run it with `node --env-file=.env.local`, serve `$S/layer4d/site` on port 8760 and shoot 1440, 768 and 375, light and dark.

- [ ] **Step 3: Look at the shots**

Check: the count badge sits beside the actions and reads as the sidebar's badge does; the two icon buttons are 40px and do not crowd the name; the row in its rename form still lines its save and cancel buttons up on the right; the default category's tag and the badge do not run together. Anything wrong is a bug -- fix it, rebuild, re-shoot.

- [ ] **Step 4: Hand it over**

```bash
for p in 8759 8760; do lsof -ti "tcp:$p" >/dev/null 2>&1 && lsof -ti "tcp:$p" | xargs kill; done
```

Send the 1440 light and dark shots and the 375 shot with SendUserFile, report what changed in one short table, and ask the owner to check Categories on their own machine -- renaming, deleting and the default category in particular. Do not start the form screens until the owner approves.
