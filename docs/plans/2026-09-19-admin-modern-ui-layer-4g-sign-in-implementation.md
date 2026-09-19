# Admin Modern UI, Layer 4g (Sign-in) Implementation Plan

> **Executed and shipped on 2026-09-19 as layer 4g, `64b0b41..792df80`.** The steps below were run
> inline rather than ticked off, so their boxes stay empty; the commits are the record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the last screen: give the sign-in panel the waiting state every other island in the admin has, and quiet the stage's edge to the hairline the cards use.

**Architecture:** The sign-in page is a designed screen -- a dark context panel beside a light sign-in panel -- and that design stays. It renders inside `AdminLayout`, so it already carries the admin tokens. Two things are missing: `PasskeySignIn` is the only `client:only` island in the admin that ships no `slot="fallback"`, so the panel is empty until React hydrates, and the stage is outlined in the strong rule that layer 3 took off every other card.

**Tech Stack:** Astro 5.18 with a React island, `node:test` via `tsx`, Playwright 1.63 (screenshots -- the signed-out page needs no session, so this one can be shot from the real dev server).

**Spec:** `docs/specs/2026-09-17-admin-modern-ui-design.md` -- rollout layer 4, Sign-in last. Layer 4f is `bc01e83..7707eec`.

## What the sign-in already does right

- It stands in `AdminLayout`, so the admin's radii, control height and title scale apply.
- The stage is `--radius-card`, the panel's button is `--primary`, and the error line is the shared `.admin-form-error`.
- Its two headings are a deliberate hero pair at `--text-2xl`/700 rather than the working screens' 28px/600, and they stay that way: this is the one screen that greets rather than works.

## Global Constraints

- No new colour token, no new radius, no new icon.
- The sign-in flow -- the passkey call, the return-to handling, the error copy -- is not touched.
- Both places that render `PasskeySignIn` get the same fallback: the sign-in page and the Security screen's gate.
- The new skeleton kind is for a fallback only. `PageTransitionSkeleton` lists the kinds the navigation overlay can draw, and sign-in is not one of them -- a navigation never lands there from inside the admin.
- Never stage, edit or revert the owner's uncommitted files: `DESIGN-TOKENS.json`, `docs/specs/2026-09-14-theme-system-design.md`, `src/components/LanguageSwitcher.astro`. Stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file, then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it. Reading the signed-out page from it is fine.

---

### Task 1: The sign-in waits the way the rest of the admin waits

**Files:**
- Modify: `src/lib/admin-transition.ts` (the kind union)
- Modify: `src/components/admin/AdminSkeleton.astro` (the `auth` kind)
- Modify: `src/pages/admin/index.astro`, `src/pages/admin/security.astro` (the fallbacks)
- Modify: `src/styles/global.css` (`.admin-auth-stage`)
- Test: `tests/unit/admin-transition.test.ts`, `tests/unit/admin-surface-tokens.test.ts`

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
git log -1 --format=%h -- src/styles && node scripts/css-selector-diff.mjs --save "$S/layer4g-selectors-before.json"
```
Expected: `7707eec`, then `Saved ... selectors`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/admin-surface-tokens.test.ts`:

```ts
test('every island in the admin shows something while it loads', () => {
  // PasskeySignIn was the only client:only island with no fallback, so the panel that
  // asks for a passkey was blank until React arrived.
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/security.astro']) {
    const source = read(page);
    for (const [, island] of source.matchAll(/<(\w+)[^>]*client:only/g)) {
      assert.match(source, new RegExp(`<${island}[\\s\\S]{0,600}?slot="fallback"`), `${page}: ${island} has no fallback`);
    }
  }
  // The stage is a card, so it takes a card's hairline.
  assert.match(declaration(ruleBody(CSS, '.admin-auth-stage'), 'border') ?? '', /var\(--color-rule\)$/);
});
```

In `tests/unit/admin-transition.test.ts`:

```ts
test('the sign-in kind is a fallback, never a destination', async () => {
  // The overlay draws the screen a navigation is heading for; nothing inside the admin
  // navigates to the sign-in, so no URL may resolve to it.
  const { transitionKind } = await import('../../src/lib/admin-transition');
  for (const path of ['/admin', '/admin/media', '/admin/security', '/admin/pages', '/admin/new']) {
    assert.notEqual(transitionKind(new URL(`http://localhost${path}`), '/admin', 'http://localhost'), 'auth');
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx tsx --test tests/unit/admin-surface-tokens.test.ts tests/unit/admin-transition.test.ts 2>&1 | tail -20
```
Expected: FAIL, `src/pages/admin/index.astro: PasskeySignIn has no fallback`.

- [ ] **Step 3: Add the kind**

In `src/lib/admin-transition.ts`, extend the union:

```ts
export type AdminSkeletonKind = 'posts' | 'pages' | 'list' | 'media' | 'form' | 'editor' | 'auth';
```

with a line above it saying what `auth` is for: a fallback for the sign-in island, never returned by `transitionKind`.

- [ ] **Step 4: Draw it**

In `src/components/admin/AdminSkeleton.astro`, add a branch before the final `else` -- the sign-in panel is a line of text and one button:

```astro
    ) : kind === 'auth' ? (
      <div class="admin-skeleton__auth">
        <span class="skeleton-line" style="--skeleton-width: 14rem"></span>
        <span class="skeleton skeleton--button" style="--skeleton-width: 12rem"></span>
      </div>
    ) : (
```

and in `src/styles/global.css`, beside the other skeleton rules:

```css
.admin-skeleton__auth { display: grid; gap: var(--space-md); justify-items: start; }
```

- [ ] **Step 5: Give both sign-ins the fallback**

In `src/pages/admin/index.astro`:

```astro
          <PasskeySignIn adminPath={adminPath} ownerLocale={ownerLocale} client:only="react" returnTo={Astro.url.searchParams.get('returnTo')}>
            <AdminSkeleton kind="auth" head={false} label={copy.auth.welcome} slot="fallback" />
          </PasskeySignIn>
```

and in `src/pages/admin/security.astro`:

```astro
          <PasskeySignIn client:only="react" ownerLocale={ownerLocale} returnTo={adminHref({ admin_path: adminPath }, '/security')}>
            <AdminSkeleton kind="auth" head={false} label={copy.auth.welcome} slot="fallback" />
          </PasskeySignIn>
```

`src/pages/admin/index.astro` already imports `AdminSkeleton`; add the import to `security.astro` if it is missing.

- [ ] **Step 6: Quiet the stage**

In `src/styles/global.css`, in `.admin-auth-stage`, change `var(--color-rule-strong)` to `var(--color-rule)`.

- [ ] **Step 7: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 8: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-layer4g-signin.txt" <<'EOF'
feat(admin): the sign-in waits the way the rest of the admin waits

Every screen that renders in the browser shows its shape while it loads --
except the one that asks for a passkey, which was blank until React arrived.
Both places that render it, the sign-in page and the Security gate, now show
a line and a button in the shimmer the other screens use.

The stage around them takes the quiet hairline layer 3 gave every other card.
EOF
git add -- src/lib/admin-transition.ts src/components/admin/AdminSkeleton.astro src/pages/admin/index.astro src/pages/admin/security.astro src/styles/global.css tests/unit/admin-transition.test.ts tests/unit/admin-surface-tokens.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-layer4g-signin.txt
```

---

### Task 2: Verify the layer and close out the rollout

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/layer4g-selectors-before.json"
```
Expected: `.admin-skeleton__auth` added, declarations changed on `.admin-auth-stage`, nothing removed.

- [ ] **Step 2: Shoot the real page**

The sign-in needs no session, so it can be read from the owner's dev server rather than a copy:

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
mkdir -p "$S/layer4g/shots" && node --input-type=module -e "
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  for (const [width, height] of [[1440, 900], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
    await page.goto('http://localhost:4321/admin', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: \`\${process.env.S}/layer4g/shots/signin-\${width}-\${scheme}.png\` });
    await page.close();
  }
}
await browser.close();
"
```

If the dev server is not running or redirects to an installed admin, fall back to a static copy the way the other layers did, and say so in the report.

- [ ] **Step 3: Look at the shots**

Check: the stage's edge reads as a card's, not a control's; the dark context panel and the light sign-in panel still meet cleanly; the button is the primary one; at 375 the two panels stack. Anything wrong is a bug -- fix it, rebuild, re-shoot.

- [ ] **Step 4: Update the spec's rollout**

In `docs/specs/2026-09-17-admin-modern-ui-design.md`, mark the rollout done: the four layers are `af9f765`, `5f65f66..d26a4e1`, `3131cfa..234f3e0` and the layer 4 range, with the two spec sentences the owner's decision dropped recorded under layer 4.

- [ ] **Step 5: Hand it over**

Send the 1440 light and dark shots with SendUserFile, report what changed, and give the owner a short closing summary of the whole rollout: what each layer did, what the tests now pin, and what is deliberately left (a Dashboard, a command palette, a collapsible sidebar, relative dates -- all out of scope by the spec).
