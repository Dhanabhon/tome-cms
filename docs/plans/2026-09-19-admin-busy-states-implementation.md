# Admin Busy States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every control in the admin say the same thing while it works: the control that was pressed shows a spinner and keeps its words, the words about what is happening go to the status line that screen readers already read, and a reader who asked for less motion gets a mark that does not spin.

**Architecture:** The spinner already exists -- `.admin-button[data-state="loading"]::before` with the `admin-spin` keyframes -- and four controls use it. This layer keys it to `aria-busy="true"` instead, which is the attribute that already marks a busy control (`.admin-control[aria-busy]`) and the one a screen reader understands, then applies it everywhere a control starts a request. No new token, no new component.

**Tech Stack:** Astro 5.18 with React islands, `node:test` via `tsx`, Playwright 1.63 (screenshots of the states side by side, including under `prefers-reduced-motion`).

**Decided with the owner, 2026-09-19:**

| Question | Answer |
|---|---|
| What the pressed control does | Sets `aria-busy="true"`, shows the spinner, keeps its label -- no text swap, so nothing moves while you wait |
| Where the words go | The live region the screen already has (`role="status"` in a save bar, `.admin-save-state` in the editors) |
| Reduced motion | The ring stays, the spin stops |
| Regions that are not buttons | `aria-busy` on the region and a light dim, the way the public feed already marks a filter change |
| Rows in a list | The row is marked busy; no spinner inside a row menu's items |
| What not to do | No full-screen overlay on submit -- the admin already has one for navigation, and two would be two languages for one event |

## Global Constraints

- No new colour token, no new radius, no new icon, no new copy key except where a label moves from a button into a status line and none exists.
- `data-state` keeps its other two values on buttons (`error`, `success`); only `loading` moves to `aria-busy`.
- A control that is merely unavailable while something else works -- a move-up button on a saving menu -- stays `disabled` and must NOT claim to be busy. Busy belongs to the control that was pressed.
- Nothing about the requests themselves changes: no new retries, no optimistic writes, no change to what any endpoint is called with.
- The installer shares `admin-spin`; its buttons move with the admin's so the two keep one spinner.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: One attribute, one spinner, and it stops spinning when asked

**Files:**
- Modify: `src/styles/global.css` (`.admin-button[data-state="loading"]`, a reduced-motion block)
- Modify: `src/components/admin/Editor.tsx`, `PageEditor.tsx`, `NavigationManager.tsx`, `InstallerWizard.tsx` (the four controls already on `data-state`)
- Test: `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/busy-selectors-before.json"
```
Expected: `792df80`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

```ts
test('a busy control says so in the attribute a screen reader reads', () => {
  // aria-busy, not data-state: one attribute for the spinner and for the announcement,
  // and the one .admin-control already uses.
  assert.doesNotMatch(CSS, /\.admin-button\[data-state="loading"\]/);
  assert.match(CSS, /\.admin-button\[aria-busy="true"\]::before \{/);
  // A reader who asked for less motion keeps the ring and loses the spin.
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\.admin-button\[aria-busy="true"\]::before \{ animation: none; \}\s*\}/);
  // The four controls that already reported loading move with it.
  for (const component of ['Editor', 'PageEditor', 'NavigationManager', 'InstallerWizard']) {
    assert.doesNotMatch(read(`src/components/admin/${component}.tsx`), /data-state=\{[^}]*'loading'/, `${component} still reports loading through data-state`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL on the first assertion.

- [ ] **Step 3: Move the spinner to aria-busy**

In `src/styles/global.css`:

```css
/* One attribute for "working": the spinner and the announcement come from the same
 * aria-busy the controls already use. The label stays put underneath it, so a button
 * never changes width while you wait for it. */
.admin-button[aria-busy="true"] { cursor: wait; }
.admin-button[aria-busy="true"]::before {
  width: var(--space-md);
  height: var(--space-md);
  border: var(--space-3xs) solid currentColor;
  border-block-start-color: transparent;
  border-radius: 50%;
  animation: admin-spin 900ms linear infinite;
  content: "";
}
@media (prefers-reduced-motion: reduce) {
  .admin-button[aria-busy="true"]::before { animation: none; }
}
```

- [ ] **Step 4: Move the four controls**

In each of `Editor.tsx` and `PageEditor.tsx`:

```tsx
            <button aria-busy={saveState === 'saving'} className="admin-button admin-button--primary" disabled={isActionPending} onClick={() => void saveBefore(() => undefined, 'published')} type="button">
```

In `NavigationManager.tsx`:

```tsx
              <button aria-busy={saving} className="admin-button admin-button--primary" disabled={saving || !dirty[key]} onClick={() => void save()} type="button">{saving ? copy.navigation.saving : copy.navigation.saveMenu}</button>
```

In `InstallerWizard.tsx`, both buttons take `aria-busy={busy}` in place of `data-state={busy ? 'loading' : undefined}`.

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-busy-attribute.txt" <<'EOF'
refactor(admin): a busy button says so in aria-busy, and stops spinning on request

The spinner was keyed to data-state="loading", which draws a ring and tells a
screen reader nothing, while the attribute that does tell it -- aria-busy --
was already in use on controls. One attribute now carries both, and the four
controls that reported loading move to it.

The ring also had no reduced-motion fallback, though every other animation in
the file has one. A reader who asked for less motion keeps the ring and loses
the spin.
EOF
git add -- src/styles/global.css src/components/admin/Editor.tsx src/components/admin/PageEditor.tsx src/components/admin/NavigationManager.tsx src/components/admin/InstallerWizard.tsx tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-busy-attribute.txt
```

---

### Task 2: Every control that starts a request reports it

**Files:**
- Modify: `src/components/admin/SettingsForm.tsx`, `ProfileForm.tsx`, `CategoryManager.tsx`, `SecurityManager.tsx`, `MediaLibrary.tsx`, `NavigationManager.tsx`, `PasskeySignIn.tsx`
- Test: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: the `aria-busy` contract from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
test('every control that starts a request reports it', () => {
  // Named rather than inferred: a button disabled while something else works is not busy,
  // and only the control that was pressed may say it is.
  const controls: ReadonlyArray<readonly [string, string]> = [
    ['SettingsForm', 'saving'],
    ['ProfileForm', 'saving'],
    ['CategoryManager', "pendingActionIds.has('create')"],
    ['SecurityManager', 'busy'],
    ['MediaLibrary', 'uploading'],
    ['PasskeySignIn', 'busy'],
  ];
  for (const [component, flag] of controls) {
    const source = read(`src/components/admin/${component}.tsx`);
    assert.ok(source.includes(`aria-busy={${flag}}`), `${component} has no control reporting ${flag}`);
  }
  // The words move to the status line, so a button keeps its width.
  assert.doesNotMatch(read('src/components/admin/SettingsForm.tsx'), /\{saving \? copy\.settings\.saving : copy\.settings\.save\}/);
  assert.match(read('src/components/admin/SettingsForm.tsx'), /role="status">\{saving \? copy\.settings\.saving/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `SettingsForm has no control reporting saving`.

- [ ] **Step 3: The two save bars**

In `src/components/admin/SettingsForm.tsx`:

```tsx
        <button aria-busy={saving} className="admin-button admin-button--primary" type="submit" disabled={saving || !dirty}>{copy.settings.save}</button>
        <p role="status">{saving ? copy.settings.saving : dirty ? copy.settings.unsaved : status}</p>
```

and the same shape in `src/components/admin/ProfileForm.tsx`, with `copy.settings.saving` and `copy.profile.unsaved` as that file already uses them:

```tsx
          <button aria-busy={saving} className="admin-button admin-button--primary" disabled={saving || !dirty} type="submit">{copy.settings.save}</button>
          <p role="status">{saving ? copy.settings.saving : dirty ? copy.profile.unsaved : status}</p>
```

- [ ] **Step 4: Categories**

The create button and the rename form's save both report the action they start:

```tsx
          <button aria-busy={pendingActionIds.has('create')} className="admin-button admin-button--primary" disabled={pendingActionIds.has('create')} type="submit">
```

```tsx
                      <button aria-busy={pendingActionIds.has(renameAction)} className="admin-button admin-button--primary" disabled={pendingActionIds.has(renameAction)} type="submit" aria-label={fill(copy.categories.saveLabelFor, { name: edit.name.trim() || copy.categories.fallbackName })}>{copy.categories.save}</button>
```

and the row's delete button, which is the control that starts that request:

```tsx
                            aria-busy={pendingActionIds.has(deleteAction)}
```

- [ ] **Step 5: Security, Media and the rest**

- `SecurityManager.tsx`: the controls that start work -- verify with passkey, save name, add spare, regenerate codes, copy codes, delete a passkey -- each take `aria-busy={busy}` beside their existing `disabled={busy...}`. The cancel-rename button does not: it starts nothing.
- `MediaLibrary.tsx`: the upload label takes `aria-busy={uploading}` and keeps its own word (`{uploading ? copy.media.uploading : copy.media.uploadImage}` becomes `{copy.media.uploadImage}`, with the progress line already announcing the upload); the load-more button takes `aria-busy={loading}` and keeps `{copy.media.loadMore}`.
- `NavigationManager.tsx`: the two retry buttons take `aria-busy={saving}` where they retry a save.
- `PasskeySignIn.tsx`: the submit button takes `aria-busy={busy}`; the form keeps its own.

- [ ] **Step 6: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-busy-controls.txt" <<'EOF'
feat(admin): every control that starts a request says it is working

Four controls showed a spinner; the rest swapped their label for "Saving..."
and went grey, which says the same thing in a second language and moves the
button while you wait for it. Save on Settings and Profile, create and rename
and delete on Categories, all six controls on Security, upload and load more
in the file library, the retries in the menu editor and the passkey button now
report aria-busy, keep their words, and let the status line beside them say
what is happening.
EOF
git add -- src/components/admin/SettingsForm.tsx src/components/admin/ProfileForm.tsx src/components/admin/CategoryManager.tsx src/components/admin/SecurityManager.tsx src/components/admin/MediaLibrary.tsx src/components/admin/NavigationManager.tsx src/components/admin/PasskeySignIn.tsx tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-busy-controls.txt
```

---

### Task 3: A row that is working says so

**Files:**
- Modify: `src/lib/admin-story-list.ts` (mark the row, not just the button)
- Modify: `src/styles/global.css` (`.admin-story-row[aria-busy]`)
- Test: `tests/unit/admin-story-list.test.ts`, `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/admin-surface-tokens.test.ts`:

```ts
test('a row that is working dims rather than spinning inside its menu', () => {
  // A spinner inside a menu item is noise in a 10rem box; the row it belongs to says it.
  assert.match(CSS, /\.admin-story-row\[aria-busy="true"\] \{[^}]*opacity: 0\.6/);
  assert.match(read('src/lib/admin-story-list.ts'), /setAttribute\('aria-busy', 'true'\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, no rule for the busy row.

- [ ] **Step 3: Mark the row**

In `src/lib/admin-story-list.ts`, where the action button is disabled and re-enabled, mark the card it belongs to. Around the `button.disabled = true` at the start of the action:

```ts
    const card = button.closest<HTMLElement>('.admin-story-row');
    button.disabled = true;
    card?.setAttribute('aria-busy', 'true');
```

and wherever the button is re-enabled, clear it:

```ts
      button.disabled = false;
      card?.removeAttribute('aria-busy');
```

- [ ] **Step 4: Give it a rule**

In `src/styles/global.css`, beside the story row rules:

```css
/* The row an action is working on: dimmed, the way the public feed marks a filter change,
 * and nothing spinning inside a menu that is 10rem wide. */
.admin-story-row[aria-busy="true"] { opacity: 0.6; transition: opacity var(--dur-short) var(--ease-out); }
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-busy-rows.txt" <<'EOF'
feat(admin): a row that is working says so

Publishing from a row menu greyed one item in a menu that closes as you click
it, so the list looked unchanged while the request was in flight. The card or
row the action belongs to is marked busy and dims, which is what the public
feed already does while a filter runs -- and nothing spins inside a menu that
is ten characters wide.
EOF
git add -- src/lib/admin-story-list.ts src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-busy-rows.txt
```

---

### Task 4: Verify and hand it over

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/busy-selectors-before.json"
```
Expected: `.admin-button[data-state=loading]` replaced by the `aria-busy` pair, the reduced-motion rule and the busy row added.

- [ ] **Step 2: Shoot the states**

Write `$S/busy/states.html`: a row of buttons -- primary at rest, primary busy, secondary busy, ghost icon busy, and a disabled one -- plus a busy story row. Shoot it at 900px in light and dark, then again with `reducedMotion: 'reduce'`, and measure that a button's width does not change between rest and busy.

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
mkdir -p "$S/busy/shots"
```

- [ ] **Step 3: Look at the shots**

Check: the spinner sits before the label at the label's colour; a busy button is the same width as its resting twin plus the spinner and its gap, and nothing else moved; under reduced motion the ring is there and still; the busy row reads as dimmed rather than broken.

- [ ] **Step 4: Hand it over**

Send the light and dark state shots with SendUserFile, report the policy as built in one short table, and ask the owner to try a save on Settings, a publish from a row menu and an upload -- the three shapes this layer covers.
