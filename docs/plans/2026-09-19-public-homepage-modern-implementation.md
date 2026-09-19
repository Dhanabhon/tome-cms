# Public Homepage in the Admin's Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the homepage the admin's surfaces -- a page head instead of a green band, framed post cards, quiet chips and a clock before the date -- and free the icon set from the admin so a public page may draw one.

**Architecture:** Two layers. The first is a rename with no visual change: the icon module, its two renderers and their CSS class stop calling themselves "admin". The second is CSS on rules that already exist, plus two small markup changes in the homepage route. Nothing about fetching, filtering or paging posts is touched.

**Tech Stack:** Astro 5.18 (the homepage is an SSR route, no island), Tailwind v3 (two utility classes are being removed, none added), `node:test` via `tsx`, Playwright 1.63 (screenshots).

**Spec:** `docs/specs/2026-09-19-public-homepage-modern-design.md`

## One correction to the spec

The spec says the rename leaves the components' markup unchanged. It has to go one step
further: both renderers emit `class="admin-icon"`, and a public page rendering that class is
the same lie the rename exists to remove. The class becomes `icon`, and the six rules that
size it follow. Everything else about the spec stands.

## Global Constraints

- No new colour token, no new radius, no new icon. The card's corner is `--radius-lg` (16px),
  the token that already exists; the admin's 14px is an override on `.admin-body` and cannot
  be reached from a public route.
- **The card must not clip its overflow.** The title's stretched link draws its focus ring with
  `outline-offset: var(--space-xs)`, outside the card's box; `overflow: hidden` or `clip` on the
  card would cut it. The cover rounds its own top corners instead -- the same reason the admin's
  story card carries a comment refusing to clip.
- The homepage only. The article page, the Page template, the header and the footer are not
  touched, and neither is the hero's hard-coded English headline.
- Both locales already have every copy string this work needs; no copy key is added.
- Never stage, edit or revert files the owner is working in; stage by explicit path.
- Never `git stash`. Never bypass the commit hooks. Commit messages go to a scratchpad file,
  then `git commit -F <file>` in a separate command. No attribution lines.
- Scratchpad `S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad`.
- The owner's dev server runs on `http://localhost:4321`; do not stop it.

---

### Task 1: One icon set for the product

**Files:**
- Rename: `src/lib/admin-icons.ts` → `src/lib/icons.ts`; `src/components/admin/AdminIcon.astro` → `src/components/Icon.astro`; `src/components/admin/AdminIcon.tsx` → `src/components/Icon.tsx`
- Modify: `src/lib/admin.ts` (gains `ADMIN_NAV_IDS`), `src/styles/global.css` (six `.admin-icon` rules), and the ten call sites
- Test: `tests/unit/admin-icons.test.ts` → `tests/unit/icons.test.ts`

**Interfaces:**
- Produces: `ICONS` (`Record<IconName, string>`) and `type IconName` from `src/lib/icons.ts`; `Icon` from `src/components/Icon.astro` and `src/components/Icon.tsx`, both taking `{ name: IconName }`; `ADMIN_NAV_IDS` from `src/lib/admin.ts`.

- [ ] **Step 0: Save the selector baseline**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
node scripts/css-selector-diff.mjs --save "$S/home-selectors-before.json"
```
Expected: `Saved ... selectors`.

- [ ] **Step 1: Move the files with git, so history follows**

```bash
git mv src/lib/admin-icons.ts src/lib/icons.ts
git mv src/components/admin/AdminIcon.astro src/components/Icon.astro
git mv src/components/admin/AdminIcon.tsx src/components/Icon.tsx
git mv tests/unit/admin-icons.test.ts tests/unit/icons.test.ts
```

- [ ] **Step 2: Rename what the files export**

In `src/lib/icons.ts`: `ADMIN_ICONS` becomes `ICONS`, `AdminIconName` becomes `IconName`, and
`ADMIN_NAV_IDS` is cut from the file. The ISC notice and every path stay exactly as they are.

In `src/lib/admin.ts`, add the nav ids where the other admin helpers live:

```ts
/** The sidebar's links, in order. Each one's id is also the name of its icon. */
export const ADMIN_NAV_IDS = ['posts', 'pages', 'media', 'navigation', 'profile', 'security', 'settings', 'system'] as const;
```

In `src/components/Icon.astro` and `src/components/Icon.tsx`: the component is `Icon`, its prop
type is `IconName`, it imports from `../lib/icons`, and its class is `icon` rather than
`admin-icon`.

- [ ] **Step 3: Update the call sites**

```bash
grep -rl "AdminIcon\|admin-icons\|ADMIN_ICONS\|AdminIconName" src tests | sort
```

Every hit is one of three shapes: an import path, the component's name in JSX or Astro, or the
`ADMIN_NAV_IDS` import (which now comes from `../../lib/admin`). `AdminShell.astro` imports
both `ADMIN_NAV_IDS` and the component.

- [ ] **Step 4: Rename the class in the stylesheet**

In `src/styles/global.css`, `.admin-icon` becomes `.icon` in all six rules that mention it:
the base size, the top bar's search, the story foot, the story cover, the empty mark and the
shared search field.

- [ ] **Step 5: Point the tests at the new names**

In `tests/unit/icons.test.ts`, the imports become `ICONS` from `../../src/lib/icons` and
`ADMIN_NAV_IDS` from `../../src/lib/admin`; the two renderer paths become
`src/components/Icon.astro` and `src/components/Icon.tsx`. In
`tests/unit/admin-surface-tokens.test.ts`, every `<AdminIcon name="x" />` in an assertion
becomes `<Icon name="x" />`.

- [ ] **Step 6: Prove nothing moved**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error" && npm run build 2>&1 | tail -1
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
node scripts/css-selector-diff.mjs --diff "$S/home-selectors-before.json"
```
Expected: `fail 0`, `- 0 errors`, and a diff whose only entries are `.admin-icon` selectors
removed and the same selectors added as `.icon` -- no declaration changed, nothing else moved.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-icons-rename.txt" <<'EOF'
refactor: the icon set belongs to the product, not to the admin

The homepage is about to draw a clock beside a date, and everything that
draws an icon today is called admin: the module, both renderers, and the class
they emit. A public page importing "admin-icons" to render class="admin-icon"
is how one icon set becomes two.

The map is src/lib/icons.ts, the renderers are components/Icon.astro and .tsx,
the class is icon, and the sidebar's nav ids move to lib/admin.ts where the
other admin helpers live. Nothing else changes: the paths, the attributes and
the test that pins both renderers to each other are as they were.
EOF
git add -A src tests
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-icons-rename.txt
```

---

### Task 2: The hero becomes a page head

**Files:**
- Modify: `src/pages/[locale]/index.astro:119-130`
- Modify: `src/styles/global.css` (a new `.home-hero` block beside the other homepage rules)
- Test: `tests/unit/home-surface.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/home-surface.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/styles/global.css');
const HOME = read('src/pages/[locale]/index.astro');

/** The declarations of the first unindented rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('the homepage opens with a page head, not a painted band', () => {
  // The band was the last block of utility classes on the page, and it was dark in both
  // themes -- which is why it carried a literal white that no token could reach.
  assert.doesNotMatch(HOME, /bg-hero/);
  assert.doesNotMatch(HOME, /text-white/);
  assert.match(HOME, /class="home-hero"/);
  const hero = ruleBody('.home-hero');
  assert.match(hero, /background: var\(--color-paper-2\)/);
  assert.match(hero, /border-block-end: var\(--rule-hair\) solid var\(--color-rule\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsx --test tests/unit/home-surface.test.ts 2>&1 | tail -20
```
Expected: FAIL, `The input was expected to not match /bg-hero/`.

- [ ] **Step 3: Change the markup**

In `src/pages/[locale]/index.astro`, replace the band and its comment:

```astro
  <section class="home-hero">
    <div class="mx-auto max-w-7xl px-5 py-12 sm:px-7 sm:py-16">
      <h1 class="hero-title max-w-xl">
        Ideas, carefully published.
      </h1>
      {tagline && (
        <p class="lead mt-6 max-w-md">
          {tagline}
        </p>
      )}
    </div>
  </section>
```

- [ ] **Step 4: Give it a rule**

In `src/styles/global.css`, immediately before `.post-grid`:

```css
/* The homepage opens the way every admin screen does: the title on paper with a hairline
 * under it, rather than a painted band. In dark mode the head and the page are one colour
 * and the hairline carries the separation. */
.home-hero {
  background: var(--color-paper-2);
  border-block-end: var(--rule-hair) solid var(--color-rule);
}
.home-hero .lead { color: var(--color-muted); }
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 6: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-home-hero.txt" <<'EOF'
feat(home): the homepage opens with a page head, not a painted band

A dark green band ran the width of the page above the posts, written in
utility classes and dark in both themes -- which is why it carried a literal
white that no token could reach. It becomes what every admin screen opens
with: the title on paper, the tagline under it in muted ink, a hairline across
the bottom.

--color-hero keeps its other uses, the code block and the sign-in panel, so no
token is left without a home.
EOF
git add -- "src/pages/[locale]/index.astro" src/styles/global.css tests/unit/home-surface.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-home-hero.txt
```

---

### Task 3: A post is a card

**Files:**
- Modify: `src/styles/global.css:293-330` (`.post-card`, `.post-card__cover`, `.post-card__title`, `.post-card__excerpt`, `.post-card__meta`, `.post-grid`)
- Test: `tests/unit/home-surface.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/home-surface.test.ts`:

```ts
test('a post card is a surface that does not clip its focus ring', () => {
  const card = ruleBody('.post-card');
  assert.match(card, /background: var\(--color-paper\)/);
  assert.match(card, /border: var\(--rule-hair\) solid var\(--color-rule\)/);
  assert.match(card, /border-radius: var\(--radius-lg\)/);
  // The title's link stretches over the card and rings itself 8px outside its own box.
  // A card that clips would cut that ring off, which is why the cover rounds its own corners.
  assert.doesNotMatch(card, /overflow\s*:\s*(hidden|clip)/);
  assert.match(ruleBody('.post-card__cover'), /border-start-start-radius/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsx --test tests/unit/home-surface.test.ts 2>&1 | tail -20
```
Expected: FAIL, the card has no background.

- [ ] **Step 3: Give the card its surface**

In `src/styles/global.css`:

```css
/* One link, the title's, stretched over the whole card: the cover, the title and the byline
 * are one target and one tab stop, and the focus ring goes round the card. The card does not
 * clip: that ring is drawn outside its box, and the cover rounds its own top corners instead. */
.post-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-lg);
  background: var(--color-paper);
  transition: border-color var(--dur-short) var(--ease-out);
}
.post-card:hover { border-color: var(--color-rule-strong); }
```

The cover sits flush inside the frame and rounds the two corners it paints into:

```css
.post-card__cover {
  container-type: inline-size;
  display: grid;
  place-items: center;
  aspect-ratio: 2 / 1;
  overflow: hidden;
  border-start-start-radius: calc(var(--radius-lg) - var(--rule-hair));
  border-start-end-radius: calc(var(--radius-lg) - var(--rule-hair));
  background: var(--color-paper-3);
}
```

The body takes the frame's padding, and the meta is pushed to the bottom so cards in a row end
level:

```css
.post-card__title { padding: var(--space-md) var(--space-md) 0; overflow-wrap: anywhere; }
.post-card__title a::after { content: ''; position: absolute; inset: 0; border-radius: var(--radius-lg); }
```

```css
.post-card__excerpt {
  display: -webkit-box;
  margin: var(--space-xs) 0 0;
  padding-inline: var(--space-md);
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--color-ink-2);
}
```

In `.post-card__meta`, `margin: var(--space-md) 0 0` becomes `margin-block-start: auto` and the
rule gains `padding: var(--space-sm) var(--space-md) var(--space-md)`.

Finally the grid closes up, since each card now draws its own edge:

```css
  gap: var(--space-lg);
```

- [ ] **Step 4: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 5: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-home-card.txt" <<'EOF'
feat(home): a post is a card, on the surface the admin's posts use

The homepage listed posts as bare text on the page, held apart by 64px of
space; the admin lists the same posts as cards. The public card takes the same
surface -- paper, a quiet hairline, a rounded corner -- its cover sits flush
inside the frame, and its byline is pushed to the bottom so cards in a row end
level.

It does not clip: the title's link stretches over the whole card and rings
itself outside its own box, so a clipping card would cut the focus ring. The
cover rounds its own two corners instead, which is what the admin's story card
does for the same kind of reason.
EOF
git add -- src/styles/global.css tests/unit/home-surface.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-home-card.txt
```

---

### Task 4: Quiet chips, and a clock before the date

**Files:**
- Modify: `src/pages/[locale]/index.astro` (the meta line)
- Modify: `src/styles/global.css` (`.post-filter a`, its selected state, a new `.post-card__date`)
- Test: `tests/unit/home-surface.test.ts`

**Interfaces:**
- Consumes: `Icon` from `src/components/Icon.astro` and `ICONS.clock`, both from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
test('a chip is a ring when chosen, and the date wears a clock', () => {
  const chosen = ruleBody('.post-filter a[aria-current="page"]');
  assert.match(chosen, /border-color: var\(--color-accent\)/);
  assert.match(chosen, /color: var\(--color-link\)/);
  // The filled ink box is gone; both of these pairs are pinned in theme-contrast.test.ts.
  assert.doesNotMatch(chosen, /background: var\(--color-ink\)/);
  assert.match(HOME, /<Icon name="clock" \/>/);
  assert.match(HOME, /class="post-card__date"/);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsx --test tests/unit/home-surface.test.ts 2>&1 | tail -20
```
Expected: FAIL, the chosen chip still fills with ink.

- [ ] **Step 3: Quiet the chips**

In `src/styles/global.css`, the shared chip rule keeps its shape and takes the quiet surface:

```css
.post-filter a,
.post-more button {
  display: block;
  max-width: 100%;
  overflow: hidden;
  padding: var(--space-xs) var(--space-md);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-paper);
  color: var(--color-ink);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1.25rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background-color var(--dur-short) var(--ease-out), border-color var(--dur-short) var(--ease-out), color var(--dur-short) var(--ease-out);
}
.post-filter a:hover,
.post-more button:hover { border-color: var(--color-rule-strong); }
/* Chosen is a ring, not a fill: the same way the file library marks the folder you are in. */
.post-filter a[aria-current="page"] {
  border-color: var(--color-accent);
  color: var(--color-link);
  font-weight: 600;
}
```

- [ ] **Step 4: Put the clock in the meta line**

In `src/pages/[locale]/index.astro`, import the component beside the other imports:

```astro
import Icon from '../../components/Icon.astro';
```

and group the clock with the date so the bullet separator still falls between the two groups:

```astro
                  <span class="post-card__when">
                    <span class="post-card__date"><Icon name="clock" /><time datetime={post.published_at ?? post.created_at}>{postDate(post)}</time></span>
                    <span>{readTime(post)}</span>
                  </span>
```

- [ ] **Step 5: Size the clock**

In `src/styles/global.css`, after `.post-card__when`:

```css
/* The clock reads as punctuation before the date: the date's size, the date's colour, on
 * the date's line. Grouped with it so the separator still falls between date and read time. */
.post-card__date { display: inline-flex; align-items: center; gap: var(--space-2xs); }
.post-card__date .icon { flex: none; width: 0.875rem; height: 0.875rem; }
```

- [ ] **Step 6: Run the tests and the type check**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (pass|fail)" && npm run check 2>&1 | grep -E "^- [0-9]+ error"
```
Expected: `fail 0`, `- 0 errors`.

- [ ] **Step 7: Commit**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
cat > "$S/msg-home-chips.txt" <<'EOF'
feat(home): chips ring rather than fill, and the date wears a clock

The chosen category was a filled ink box, the heaviest mark on a page whose
job is to show pictures and titles. It becomes the ring the file library uses
for the folder you are in, and the unchosen chips take the quiet paper surface
beside it.

The date gains the clock the admin's cards use, grouped with the date so the
bullet still separates when from how long.
EOF
git add -- "src/pages/[locale]/index.astro" src/styles/global.css tests/unit/home-surface.test.ts
```

Then, separately:

```bash
git commit -F /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad/msg-home-chips.txt
```

---

### Task 5: Verify and hand it over

- [ ] **Step 1: Build and diff the selectors**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
npm run build 2>&1 | tail -2 && node scripts/css-selector-diff.mjs --diff "$S/home-selectors-before.json"
```
Expected: `.admin-icon` selectors replaced by `.icon`, `.home-hero`, `.post-card:hover` and
`.post-card__date` added, and the utility classes the band used (`bg-hero`, `text-white`)
removed if nothing else uses them. Any other removal is a mistake -- stop and find out why.

- [ ] **Step 2: Shoot the real page if it has posts, the fixture if it does not**

```bash
export S=/private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/07307682-1a1e-43ec-b38c-287854024eb9/scratchpad
node --input-type=module -e "
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const response = await page.goto('http://localhost:4321/th', { waitUntil: 'networkidle' });
console.log(response.status(), await page.locator('.post-card').count(), 'cards');
await browser.close();
"
```

With cards, shoot `http://localhost:4321/th` at 1440, 768 and 375 in light and dark into
`$S/home/shots/final-*`. With none, copy the built stylesheet over `$S/home/app.css`, drop
`$S/home/variant-a.css` (its rules now live in the real sheet) and shoot
`$S/home/variant-a.html` instead, saying so in the report.

- [ ] **Step 3: Look at the shots**

Check: the head reads as a head in both themes; a card's cover meets the frame with no seam;
the meta sits on the card's bottom edge with cards in a row ending level; the chosen chip reads
as chosen without shouting; the clock sits on the date's line. Tab to a card and confirm the
focus ring is whole -- that is the one thing the tests cannot see.

- [ ] **Step 4: Hand it over**

Send the 1440 light and dark shots and the 375 light shot with SendUserFile, report what
changed in one short table, and say plainly that the article page still has its older
treatment. Do not start the article page unless the owner asks.
