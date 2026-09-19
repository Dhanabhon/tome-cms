# Admin Modern UI, Layer 4e (Profile, Settings, Security, System) Implementation Plan

> **Executed and shipped on 2026-09-19 as layer 4e, `33368ba..24c781a`.** The steps below were run
> inline rather than ticked off, so their boxes stay empty; the commits are the record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last differences on the four form screens: a passkey handled like every other row in the admin, an avatar whose remove button matches, and the two inset panels on Security taking the corner every other panel takes.

**Architecture:** These four screens were already built from the shared pieces -- `.admin-page`, `.admin-card`, `.admin-field`, `.admin-control`, `.admin-button`, `.admin-save-bar` -- which is what the spec predicted when it said they would fall out of layer 3. So there is no restructuring here, only the three places where they still say something their own way.

**Tech Stack:** Astro 5.18 with React islands, `node:test` via `tsx`, Playwright 1.63 (screenshots against a hand-built copy of the island's DOM).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` -- "the form screens ... are built from these pieces rather than styled one by one", rollout layer 4. Layer 4d is `1120622..8f1508b`.

## What these screens already do right

Recorded so the next reader does not go looking for work that is not there:

- All four stand in `.admin-page` with `.admin-page__head`, and group their fields in `.admin-card` with `.admin-card__head`.
- Profile and Settings both end in the same sticky `.admin-save-bar`, with the primary button and the status line in the same order.
- Every field is an `.admin-field` with an `.admin-control` and an `.admin-field-error`; System's facts are a `.admin-facts` definition list; the update progress bar is already a token-coloured `<progress>`.
- Destructive actions already carry `--danger`: removing an author link, deleting a passkey.

## Global Constraints

- No new colour token, no new radius, no new icon: `pencil` and `trash` arrived in layer 4d.
- A button that loses its words keeps them: the passkey buttons already carry `aria-label`s naming the key, and gain a `title`.
- Deleting a passkey stays impossible when it is the last one (`passkeys.length < 2`), and the button stays disabled rather than hidden.
- Nothing about saving, validation, recovery codes or the update flow changes.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: A passkey is a row like any other

**Files:**
- Modify: `src/components/admin/SecurityManager.tsx` (the two buttons in `.security-key__actions`)
- Modify: `src/components/admin/ProfileForm.tsx` (the avatar's remove button)
- Modify: `src/styles/global.css` (`.security-key__actions`, the inset panels)
- Test: `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer4e-selectors-before.json"
```
Expected: `8f1508b`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing test**

```ts
test('a passkey and an avatar are handled with the same icons as every other row', () => {
  const security = read('src/components/admin/SecurityManager.tsx');
  for (const name of ['pencil', 'trash']) {
    assert.match(security, new RegExp(`<AdminIcon name="${name}" />`), `security has no ${name} icon`);
  }
  for (const label of ['renameLabelFor', 'deleteLabelFor']) {
    assert.match(security, new RegExp(`title=\\{fill\\(copy\\.security\\.${label}`), `${label} lost its title`);
  }
  // The avatar's remove is the same shape, and says what it removes.
  const profile = read('src/components/admin/ProfileForm.tsx');
  assert.match(profile, /<AdminIcon name="trash" \/>/, 'the avatar remove is not an icon button');
  assert.match(profile, /aria-label=\{copy\.profile\.removeAvatar\}/, 'the avatar remove has no label');
  // The panels inside a card take the card's corner, not a control's.
  for (const selector of ['.security-add', '.security-codes']) {
    assert.equal(declaration(ruleBody(CSS, selector), 'border-radius'), 'var(--radius-card)', selector);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts 2>&1 | tail -20
```
Expected: FAIL, `security has no pencil icon`.

- [ ] **Step 3: Draw the passkey's actions**

In `src/components/admin/SecurityManager.tsx`, in `.security-key__actions`:

```tsx
                    <button
                      aria-label={fill(copy.security.renameLabelFor, { name: passkey.name })}
                      className="admin-button admin-button--ghost admin-button--icon"
                      disabled={busy}
                      onClick={() => { setRenamingId(passkey.id); setMessage(''); }}
                      ref={(button) => { if (button) renameButtons.current.set(passkey.id, button); }}
                      title={fill(copy.security.renameLabelFor, { name: passkey.name })}
                      type="button"
                    ><AdminIcon name="pencil" /></button>
                    <button
                      aria-label={fill(copy.security.deleteLabelFor, { name: passkey.name })}
                      className="admin-button admin-button--ghost admin-button--icon security-key__delete"
                      disabled={busy || passkeys.length < 2}
                      onClick={() => void mutatePasskey('DELETE', { id: passkey.id }, copy.security.passkeyDeleted)}
                      title={fill(copy.security.deleteLabelFor, { name: passkey.name })}
                      type="button"
                    ><AdminIcon name="trash" /></button>
```

with the import after the other local imports:

```tsx
import AdminIcon from './AdminIcon';
```

- [ ] **Step 4: Match the avatar's remove**

`copy.profile.removeAvatar` does not exist yet; add it to both locales' `profile` blocks in `src/lib/admin-i18n.ts`, alphabetically:

```ts
    removeAvatar: 'Remove profile picture',
```

```ts
    removeAvatar: 'ลบรูปโปรไฟล์',
```

Then in `src/components/admin/ProfileForm.tsx`:

```tsx
                    {avatarUrl && <button aria-label={copy.profile.removeAvatar} className="admin-button admin-button--ghost admin-button--icon profile-avatar-remove" onClick={() => { setAuthorAvatarMediaId(null); setAvatarUrl(null); setStatus(''); }} title={copy.profile.removeAvatar} type="button"><AdminIcon name="trash" /></button>}
```

with the same import added to that file.

- [ ] **Step 5: Give them their rules**

In `src/styles/global.css`:

```css
.security-key__delete:hover:not(:disabled),
.profile-avatar-remove:hover:not(:disabled) { color: var(--color-error-ink); }
```

and change `--radius-input` to `--radius-card` in `.security-add` and `.security-codes`, which are panels inside a card rather than controls.

- [ ] **Step 6: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | tail -3
```
Expected: `fail 0`, and the check passes.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4e-rows.txt" <<'EOF'
feat(admin): a passkey is handled the way every other row is

Rename and delete were text buttons beside a key's name and its two dates, so
the row's actions were wider than the row's content -- the same thing the menu
editor and the categories list already fixed. They are ghost icon buttons now,
each keeping the sentence naming its key as a label and a title, and the bin
turns red under the cursor while staying disabled on a lone key.

The avatar's remove matches, with a label of its own rather than the bare word
"remove" beside the button that chooses a picture, and the two panels inside
Security's cards take the card corner instead of a control's.
EOF
git add -- src/components/admin/SecurityManager.tsx src/components/admin/ProfileForm.tsx src/lib/admin-i18n.ts src/styles/global.css tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4e-rows.txt
```

---

### Task 2: Verify the layer and hand it to the owner

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/layer4e-selectors-before.json"
```
Expected: the two hover rules added, declarations changed on `.security-add` and `.security-codes`, nothing removed.

- [ ] **Step 2: Build the fixture and shoot it**

Write `$S/layer4e/security-body.html` mirroring SecurityManager's DOM: the page head, a card holding two passkey rows -- one with both icon buttons, one being renamed -- the `.security-add` inset with its field and button, and a second card with the recovery codes inset. Copy `$S/layer4d/render.mjs` to `$S/layer4e/render.mjs`, point it at the body with `active: 'security'` and `title: 'ความปลอดภัย'`, run it with `node --env-file=.env.local`, serve `$S/layer4e/site` on port 8761 and shoot 1440, 768 and 375, light and dark.

- [ ] **Step 3: Look at the shots**

Check: the two icon buttons sit at the row's right edge and do not crowd the key's name; the disabled bin reads as disabled; the insets' corners match the card around them; the rename form still lines up its save and cancel. Anything wrong is a bug -- fix it, rebuild, re-shoot.

- [ ] **Step 4: Hand it over**

```bash
for p in 8760 8761; do lsof -ti "tcp:$p" >/dev/null 2>&1 && lsof -ti "tcp:$p" | xargs kill; done
```

Send the 1440 light and dark shots with SendUserFile, report what changed in one short table, say plainly that the other three form screens needed nothing, and ask the owner to check Security on their own machine -- renaming a passkey, and that the last key cannot be deleted. Then the only screens left are the editors and Sign-in.
