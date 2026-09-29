# Admin Editorial Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape every admin screen except the editor so it reads as an editorial page — display titles under eyebrows, sheets and rules instead of boxes, figures instead of tiles, one empty-state system — without changing a palette, a route or what any screen does; then move the public themes' search onto the category row.

**Architecture:** Almost everything is CSS on the classes every screen already shares (`.admin-body` overrides, `.admin-page__head`, `.admin-card`, `.admin-empty`, `.admin-post-tabs`, `stats.css`), plus small markup edits: an eyebrow line in each page head, the desktop top bar and both list searches removed, the Posts/Pages language filter moved onto the tab row, three empty-state tiers, and two theme templates. Each layer is shot at three widths in both themes before it is committed, with `tests/unit/admin-surface-tokens.test.ts` pinning the new shapes the way it pins the old ones.

**Tech Stack:** Astro 7 pages and islands, React 19 components, plain CSS with OKLCH tokens, node:test unit tests, Playwright e2e with a per-spec Docker stack.

**Spec:** `docs/specs/2026-09-29-admin-editorial-refresh-design.md`

## Global Constraints

- Work on a branch from `develop` (1.2.1). Stage by explicit path, never `git add -A`; write each commit message to a file in the scratchpad and run `git commit -F <file>` in a separate call; no `Co-Authored-By` or "Generated with" lines (the repo's `commit-msg` hook rejects them). Never `git stash`. The owner has uncommitted `src/updater/*`, `src/update/backup.ts`, `scripts/backup.ts`, `scripts/restore-check.ts` and `tests/unit/backup-*.test.ts` in the tree: do not touch or stage them.
- `src/styles/installer-tokens.css` is the only place a token is declared. Admin values are overrides on `.admin-body` in `src/styles/global.css`, documented in the "Admin Surface" table of `DESIGN.md`. `node scripts/check-design-tokens.mjs` must keep passing.
- Every colour pair a new rule leans on is pinned in `tests/unit/theme-contrast.test.ts` and measured in both themes.
- New admin copy goes in both locales of `src/lib/admin-i18n.ts`; `tests/unit/admin-i18n.test.ts` fails on a missing key in either.
- Spacing in the admin: 8 / 16 / 24 / 32 / 64 / 80, with 12 (`--space-sm`) only for small horizontal gaps. Exceptions: 44px controls under `pointer: coarse`, 2px outlines and active bars, 1px hairlines.
- Out of scope: the editor (`.admin-editor*`, `.editor-content`, drawers, block menu), the installer, the sign-in form (`.admin-auth*`), the public site beyond the search field's position.
- The e2e suite signs in through `/recovery`, capped at 5 sign-ins per spec file. The new screenshot spec signs in once.
- After each task: `npm run test:unit`, and the task's own e2e where named. After tasks 3, 5, 7, 8, 10: the full `npm run test:e2e`.

## Review Focus

Inputs the spec implies but no existing test exercises, most likely to bite first. Each has a pinning test in the task named.

1. **A Thai page title in the display face** — `font-synthesis: none` is set globally, so a title in a weight the Thai subset does not ship would fall back silently. Google Sans Thai 700 is the one shipped weight; the title must use 700, never 600. Pinned in Task 4's unit test.
2. **A site name longer than the sidebar** — the site line truncates with an ellipsis and keeps its view-site icon visible; it must not wrap under the logo. Pinned by a `getBoundingClientRect` assertion in Task 3's screenshot spec run.
3. **A form page on a 768px tablet** — the sheet must be one column there and two at 1024px; a two-column sheet in a 640px main column would squeeze fields under 20rem. Pinned by the container query and Task 5's unit test on its threshold.
4. **The Posts language filter without JavaScript** — the select now submits on change from a page script; with scripts off it must still submit, so the form keeps a real submit button, visually hidden until `:focus-visible`. Pinned in Task 4's unit test.
5. **The stat figure at zero and at "—"** — `stats.spec.ts` reads `.stats-summary > div` and `.stats-summary__value`; the figures row keeps those class names and the `dl/div/dt/dd` structure. Pinned by leaving `stats.spec.ts` unchanged and green in Task 7.

---

### Task 1: Screenshot spec and CSS baseline

Nothing changes for a reader. This task builds the instrument every later task uses, and records the "before".

**Files:**
- Create: `tests/e2e/admin-shots.spec.ts`
- Modify: `tests/e2e/own-worker.ts` (no code change needed; the spec names its own stack)

**Interfaces:**
- Produces: `ADMIN_SHOTS=<label> npm run test:e2e -- tests/e2e/admin-shots.spec.ts --project=desktop` writes `test-results/admin-shots/<label>/<screen>-<width>-<theme>.png` for 15 screens × 1440/768/375 × light/dark, and `test-results/admin-shots/<label>/measure.json` with the rects later tasks assert on. Skipped (not failed) when `ADMIN_SHOTS` is unset, so the full suite ignores it.

- [ ] **Step 1: Write the spec**

`tests/e2e/admin-shots.spec.ts`:

```ts
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { expect, test } from './own-worker';

/**
 * Shoots every admin screen at three widths in both themes, and measures the few
 * boxes the editorial refresh makes claims about. Run by hand around a layer:
 *
 *   ADMIN_SHOTS=before npm run test:e2e -- tests/e2e/admin-shots.spec.ts --project=desktop
 *
 * Without ADMIN_SHOTS it skips, so the suite never pays for it. It signs in once:
 * /recovery allows five sign-ins per file, and one is all this needs.
 */

test.use({ stack: 'admin-shots' });
test.skip(!process.env.ADMIN_SHOTS, 'Set ADMIN_SHOTS=<label> to write screenshots.');
test.skip(({ isMobile }) => Boolean(isMobile), 'Widths are set by hand below.');

const LABEL = process.env.ADMIN_SHOTS ?? 'unlabelled';
const OUT = join('test-results', 'admin-shots', LABEL);
const PROJECT = 'tomecms-shots-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'admin-shots-secret-at-least-32-chars-x';
const WIDTHS = [1440, 768, 375] as const;
const SCREENS: ReadonlyArray<readonly [name: string, path: string]> = [
  ['posts', '/admin'], ['pages', '/admin/pages'], ['categories', '/admin/categories'],
  ['media', '/admin/media'], ['navigation', '/admin/navigation'], ['slides', '/admin/slides'],
  ['redirects', '/admin/redirects'], ['stats', '/admin/stats'], ['profile', '/admin/profile'],
  ['security', '/admin/security'], ['settings', '/admin/settings'], ['maintenance', '/admin/maintenance'],
  ['themes', '/admin/themes'], ['plugins', '/admin/plugins'], ['system', '/admin/system'],
];

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No port available.'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    ASTRO_DEV_BACKGROUND: '1',
    DATABASE_URL: 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    TOME_CMS_PUBLIC_URL: origin,
    TOME_CMS_INSTALL_TOKEN: CREDENTIAL,
    BETTER_AUTH_SECRET: CREDENTIAL,
    TOME_CMS_CONTEXT_SECRET: CREDENTIAL,
    TOME_CMS_RECOVERY_PEPPER: CREDENTIAL,
    S3_ENDPOINT: 'http://127.0.0.1:59000',
    S3_ACCESS_KEY_ID: 'tomecms_test',
    S3_SECRET_ACCESS_KEY: 'foundation-test-only',
    S3_BUCKET: 'tomecms-test-media',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: 'true',
    MEDIA_PUBLIC_URL: 'http://127.0.0.1:59000/tomecms-test-media/',
    TOME_CMS_FRONTEND_MODE: 'bundled',
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-admin-shots',
  };
  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);
  Object.assign(process.env, env);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values ('shots-owner', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'shots-owner', 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Shots server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Shots server never became ready.\n${output}`);
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  try {
    const { closeDatabase } = await import('../../src/server/db/client');
    await closeDatabase();
  } catch {
    // The pool may never have opened.
  }
  docker(['down', '--volumes', '--remove-orphans'], 90_000);
});

test('every admin screen, three widths, both themes', async ({ context, page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const settings = await getSiteSettings();
  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });

  // One draft post and one draft page, through the editors, so the lists have a card and a
  // row to show as well as their empty states (shot first, before these exist).
  const empties: Array<readonly [string, string]> = [['posts-empty', '/admin'], ['pages-empty', '/admin/pages']];
  const measure: Record<string, unknown> = {};
  const shoot = async (name: string, path: string) => {
    for (const width of WIDTHS) {
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`${origin}${path}`);
        await page.locator('.admin-page, .media-shell, .security-page').first().waitFor({ state: 'visible' });
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}.png`), fullPage: true });
      }
    }
    // Measured at 1440 light, where the claims are made.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}${path}`);
    measure[name] = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const { top, left, width, height } = element.getBoundingClientRect();
        return { top: Math.round(top), left: Math.round(left), width: Math.round(width), height: Math.round(height) };
      };
      return {
        title: box('.admin-page__head h1'),
        titleFont: getComputedStyle(document.querySelector('.admin-page__head h1') ?? document.body).font,
        sidebar: box('.admin-sidebar'),
        siteName: box('.admin-shell-site__name'),
        active: box('.admin-sidebar nav a[aria-current="page"]'),
        topbar: box('.admin-topbar'),
        firstCard: box('.admin-card'),
        saveBar: box('.admin-save-bar'),
        empty: box('.admin-empty'),
        figure: box('.stats-summary__value'),
      };
    });
  };
  for (const [name, path] of empties) await shoot(name, path);

  await page.goto(`${origin}/admin/new`);
  await page.locator('.admin-title-input').first().fill('Notes from a quiet workshop');
  await page.locator('.ProseMirror').first().fill('Six posts in, and the desk still fits in one corner of the room.');
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await page.goto(`${origin}/admin/pages/new`);
  await page.locator('.admin-title-input').first().fill('About');
  await page.locator('.ProseMirror').first().fill('A small studio, writing in two languages.');
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });

  for (const [name, path] of SCREENS) await shoot(name, path);
  writeFileSync(join(OUT, 'measure.json'), JSON.stringify(measure, null, 2));
  expect(Object.keys(measure).length).toBe(SCREENS.length + empties.length);
});
```

- [ ] **Step 2: Run it once to prove it skips without the flag**

Run: `npm run test:e2e -- tests/e2e/admin-shots.spec.ts --project=desktop`
Expected: `1 skipped`.

- [ ] **Step 3: Run it with the flag to write the baseline**

Run: `ADMIN_SHOTS=before npm run test:e2e -- tests/e2e/admin-shots.spec.ts --project=desktop`
Expected: PASS; `ls test-results/admin-shots/before | wc -l` prints `103` (17 screens × 6 plus `measure.json`). If the editor's title input or save-state selector does not match (`.admin-title-input`, `.admin-save-state[data-state="saved"]`), read `src/components/admin/Editor.tsx` for the current class names and correct the spec — do not remove the seeding.

- [ ] **Step 4: Save the selector baseline**

Run: `npm run build && node scripts/css-selector-diff.mjs --save /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/4fc75689-497d-45f6-a27f-88e083129187/scratchpad/css-before.json`
Expected: a JSON file is written; the command prints the selector count.

- [ ] **Step 5: Commit**

Message file, then: `git add tests/e2e/admin-shots.spec.ts && git commit -F <file>`
Message: `test: a spec that shoots and measures every admin screen on demand`

---

### Task 2: Tokens and rhythm

**Files:**
- Modify: `src/styles/global.css` (the `.admin-body` block at ~1030; `.admin-mobile-nav` at 33; `.editor-content`-adjacent `margin: 2rem auto` at ~609 is editor — leave; `.media-details`/`.media-picker` max-heights at ~964 and ~972; `.admin-check input` at ~351)
- Modify: `tests/unit/admin-surface-tokens.test.ts:22-31`
- Modify: `tests/unit/theme-contrast.test.ts:90-130`
- Modify: `DESIGN.md:295-315`

**Interfaces:**
- Produces: on `.admin-body`: `--space-xl: 2rem`, `--radius-card: 0.5rem`, `--text-title: var(--text-2xl)`, `--admin-topbar-height: 3.5rem`, `font-variant-numeric: tabular-nums`. Later tasks use `var(--space-xl)` for 32px and `var(--text-2xl)` for the title.

- [ ] **Step 1: Write the failing unit assertions**

In `tests/unit/admin-surface-tokens.test.ts`, replace the first test with:

```ts
test('the admin takes its own corners, controls, title and rhythm on top of the root tokens', () => {
  const admin = ruleBody(CSS, '.admin-body');
  assert.equal(declaration(admin, '--radius-sm'), '0.5rem');
  assert.equal(declaration(admin, '--radius-input'), '0.625rem');
  // 8px, not 14: a card frames a cover or a preview, and reads as a page element, not a widget.
  assert.equal(declaration(admin, '--radius-card'), '0.5rem');
  assert.equal(declaration(admin, '--control-height'), '2.5rem');
  // The display size: the title is the masthead now that there is no top bar.
  assert.equal(declaration(admin, '--text-title'), 'var(--text-2xl)');
  // The 32px step the root scale lacks; global.css used to write 2rem by hand for it.
  assert.equal(declaration(admin, '--space-xl'), '2rem');
  assert.equal(declaration(admin, '--admin-topbar-height'), '3.5rem');
  assert.equal(declaration(admin, 'font-variant-numeric'), 'tabular-nums');
});

test('running text keeps proportional figures', () => {
  assert.match(CSS, /\.editor-content,\n\.admin-story-content h2 \{ font-variant-numeric: normal; \}/);
});

test('the admin writes its 32px step as a token, not by hand', () => {
  // The two the sweep is certain of; the rest is `grep -n 2rem` in Step 4.
  assert.match(declaration(ruleBody(CSS, '.admin-mobile-nav'), 'width') ?? '', /calc\(100% - var\(--space-xl\)\)/);
  assert.equal(declaration(ruleBody(CSS, '.admin-check input'), 'margin-block-start'), 'var(--space-3xs)');
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --import tsx --test tests/unit/admin-surface-tokens.test.ts`
Expected: FAIL on `--radius-card` ('0.875rem' !== '0.5rem'), `--text-title`, `--space-xl` (undefined), `font-variant-numeric`; the 32px-step test FAILS on `.admin-mobile-nav`'s width.

- [ ] **Step 3: Change the `.admin-body` block**

Replace the block (its comment stays, extended) with:

```css
/* The admin's own shape and density (docs/specs/2026-09-29-admin-editorial-refresh-design.md):
 * 8px card corners, 10px control corners, 40px controls where a mouse points and 44px where a
 * finger does, the display size for the page title, and the 32px spacing step the root scale
 * lacks. Set on the admin's body rather than on :root, so the public site and the installer,
 * which share the root tokens, keep theirs. --radius-card is restated because on :root it is
 * an alias resolved there -- overriding --radius-input alone would not reach it. */
.admin-body {
  --radius-sm: 0.5rem;
  --radius-input: 0.625rem;
  --radius-card: 0.5rem;
  --control-height: 2.5rem;
  --text-title: var(--text-2xl);
  --space-xl: 2rem;
  --admin-sidebar-width: 16rem;
  --admin-topbar-height: 3.5rem;
  min-width: 0;
  min-height: 100svh;
  background: var(--color-paper-2);
  color: var(--color-ink);
  /* Counts, dates, sizes and figures line up down a column. */
  font-variant-numeric: tabular-nums;
}
.editor-content,
.admin-story-content h2 { font-variant-numeric: normal; }
@media (pointer: coarse) {
  .admin-body { --control-height: 2.75rem; }
}
```

- [ ] **Step 4: Sweep the hand-written values**

In `global.css`, below `.admin-body`:
- `.admin-mobile-nav`: `width: min(22rem, calc(100% - 2rem))` → `width: min(22rem, calc(100% - var(--space-xl)))`.
- `.media-details` and `.media-picker` (~964, ~972): `max-height: calc(100% - 2rem)` → `max-height: calc(100% - var(--space-xl))` (leave the `@apply w-[calc(100%-2rem)]` line: Tailwind, not ours).
- `.admin-check input` (~351): `margin-block-start: 0.15rem` → `margin-block-start: var(--space-3xs)`.
- Every `margin`, `padding` or `gap` that says `2rem` and sits below `.admin-body` and outside `.admin-editor*`/`.editor-content` rules → `var(--space-xl)`. Leave `width`/`height: 2rem` (avatar, logo, chips).

Run: `grep -n "2rem" src/styles/global.css` and confirm what remains is a size or the editor.

- [ ] **Step 5: Add the contrast pairs**

In `tests/unit/theme-contrast.test.ts`, after the `['color-green', 'color-paper-2', 3],` line add:

```ts
  // The editorial refresh: the sidebar's active bar and the tab underline are marks on the
  // page surface; the change figure and the "show all" link are text on it; a status label
  // with no pill behind it is ink-2 on both page surfaces.
  ['color-accent', 'color-paper-2', 3],
  ['color-link', 'color-paper-2', 4.5],
  ['color-ink-2', 'color-paper', 4.5],
  ['color-ink-2', 'color-paper-2', 4.5],
```

(Two of these already exist higher in the list; duplicates are harmless and the comment is the point. If the test rejects duplicates, keep only the comment beside the existing lines.)

- [ ] **Step 6: Update the DESIGN.md Admin Surface table**

Replace the table rows with:

```markdown
| Token | Root | Admin | Role in the admin |
|------|------|-------|-------------------|
| radius-sm | 0.375rem (6px) | 0.5rem (8px) | Nav items, menu items, chips |
| radius-input | 0.5rem (8px) | 0.625rem (10px) | Inputs, selects, secondary buttons |
| radius-card | 0.5rem (8px) | 0.5rem (8px) | Cards that frame a cover or a preview; the primary button |
| control-height | 3rem (48px) | 2.5rem (40px); 2.75rem (44px) on a coarse pointer | Every control. 44px is the touch target, the one value off the 8px grid on purpose |
| text-title | clamp(1.75rem, 6vw, 2.5rem) | var(--text-2xl) (40px), weight 700, display face | Page titles, under an eyebrow |
| space-xl | 2.5rem (40px) | 2rem (32px) | Page gutter, sheet-to-sheet gap; the 32px step the root scale lacks |
| admin-sidebar-width | -- | 16rem (256px) | Sidebar column; the main column starts at its edge |
| admin-topbar-height | -- | 3.5rem (56px) | The phone bar: menu button and screen name. Not rendered from 64rem up |

Rhythm: 8 / 16 / 24 / 32 / 64 / 80, with 12 for small horizontal gaps only. Line-heights 16 / 20 / 24.
Exceptions: 44px touch targets, 2px outlines and active bars, 1px hairlines.
Figures: `font-variant-numeric: tabular-nums` on the admin body; `normal` inside the editor and on card titles.

Design: `docs/specs/2026-09-29-admin-editorial-refresh-design.md` (shape), `docs/specs/2026-09-17-admin-modern-ui-design.md` (icons, groups, counts).
```

- [ ] **Step 7: Run the unit tests and the token check**

Run: `npm run test:unit && node scripts/check-design-tokens.mjs`
Expected: all pass. `admin-surface-tokens` may now fail on later tests that pin `--radius-card`-dependent values only by name (they use `var(--radius-card)`, so they still pass).

- [ ] **Step 8: Shoot and compare**

Run: `ADMIN_SHOTS=layer1 npm run test:e2e -- tests/e2e/admin-shots.spec.ts --project=desktop`
Show the owner `settings-1440-light.png` and `posts-1440-dark.png` beside `before/`. Expected visible change: larger titles, 8px cards, tighter page gutter. Wait for their word before committing.

- [ ] **Step 9: Commit**

`git add src/styles/global.css tests/unit/admin-surface-tokens.test.ts tests/unit/theme-contrast.test.ts DESIGN.md`
Message: `feat(admin): the display title, 8px cards, the 32px step and tabular figures`

---

### Task 3: Shell without a desktop top bar

**Files:**
- Modify: `src/components/admin/AdminShell.astro` (imports, `search`, the sidebar markup, the top bar, the script)
- Modify: `src/styles/global.css` (`.admin-shell*`, `.admin-sidebar`, `.admin-nav-*`, `.admin-topbar*`, `.admin-footer`, `.admin-migrations`, `.admin-maintenance-notice`, the `@media (min-width: 64rem)` sidebar block)
- Modify: `src/lib/admin.ts:98-106` (delete `postSearchState`)
- Modify: `tests/unit/admin-path.test.ts:13,108-128` (delete its two tests and the import)
- Modify: `src/lib/admin-i18n.ts` (delete `shell.searchLabel`, `shell.searchPlaceholder` in both locales)
- Modify: `tests/unit/admin-surface-tokens.test.ts` (new shell tests)

**Interfaces:**
- Consumes: `--admin-topbar-height: 3.5rem`, `--space-xl: 2rem` from Task 2.
- Produces: classes `.admin-shell-site` (a line, not a pill), `.admin-nav-group` (eyebrow), the active link's `::before` bar, `.admin-topbar` only under 64rem. `.admin-eyebrow` is defined here (shared by group headings and, in Task 4, page heads).

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/admin-surface-tokens.test.ts`:

```ts
test('the shell has no top bar on a desktop and no search anywhere', () => {
  const shell = read('src/components/admin/AdminShell.astro');
  assert.doesNotMatch(shell, /admin-topbar__search/, 'the search field is still in the shell');
  assert.doesNotMatch(shell, /postSearchState/, 'the shell still computes a search state');
  assert.doesNotMatch(read('src/lib/admin.ts'), /postSearchState/, 'the helper outlived its only caller');
  // The bar is the phone's: hidden from 64rem up, where the page head is the masthead.
  assert.match(CSS, /@media \(min-width: 64rem\) \{[\s\S]*?\.admin-topbar \{ display: none; \}/);
  assert.equal(declaration(ruleBody(CSS, '.admin-topbar'), 'background'), 'var(--color-paper-2)');
});

test('the sidebar sits on the page and marks the active link with a bar, not a fill', () => {
  const wide = /@media \(min-width: 64rem\) \{\s*\.admin-sidebar \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  assert.doesNotMatch(wide, /background/, 'the sidebar still paints its own column');
  assert.doesNotMatch(wide, /border-right/, 'the sidebar still draws a column edge');
  const active = ruleBody(CSS, '.admin-sidebar nav a[aria-current=\'page\']::before,\n.admin-mobile-nav nav a[aria-current=\'page\']::before');
  assert.equal(declaration(active, 'width'), '2px');
  assert.equal(declaration(active, 'background'), 'var(--color-accent)');
  assert.doesNotMatch(CSS, /\.admin-sidebar nav a\[aria-current='page'\][^:{]*\{[^}]*background: var\(--color-paper/, 'the active link still fills');
});

test('an eyebrow is one rule, shared by the nav groups and the page heads', () => {
  const eyebrow = ruleBody(CSS, '.admin-eyebrow,\n.admin-nav-group');
  assert.equal(declaration(eyebrow, 'text-transform'), 'uppercase');
  assert.equal(declaration(eyebrow, 'letter-spacing'), '0.12em');
  assert.equal(declaration(eyebrow, 'font-size'), '0.6875rem');
  assert.equal(declaration(eyebrow, 'color'), 'var(--color-muted)');
});

test('the site line is a line under the logo, not a pill', () => {
  const site = ruleBody(CSS, '.admin-shell-site');
  assert.equal(declaration(site, 'background'), undefined);
  assert.equal(declaration(site, 'border-radius'), undefined);
  assert.match(declaration(site, 'border-block-end') ?? '', /var\(--color-rule\)$/);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --import tsx --test tests/unit/admin-surface-tokens.test.ts`
Expected: the four new tests FAIL.

- [ ] **Step 3: Remove the search from the shell**

In `AdminShell.astro`:
- Import line 4 → `import { adminHref, normalizeAdminPath, type AdminNavId } from '../../lib/admin';`
- Delete line 132: `const search = postSearchState(...)`.
- In the `<header class="admin-topbar" ...>`: remove the `data-search-open` attribute, the whole `<form class="admin-search admin-topbar__search" ...>…</form>`, and the `<button ... data-search-toggle ...>` element. Also remove the `<a class="admin-button admin-button--secondary admin-topbar__site" ...>View site</a>` (the site line carries it). The header becomes:

```astro
    <header class="admin-topbar">
      <button class="admin-button admin-button--ghost admin-button--icon admin-topbar__menu" type="button" data-nav-open aria-label={copy.shell.openNavigation} aria-controls="admin-mobile-navigation" aria-expanded="false">
        <Icon name="menu" />
      </button>
      <p class="admin-topbar__title">{title ?? currentLabel}</p>
    </header>
```

- In the `<script>`: delete the block from `// On a phone the post search folds behind an icon` through the `searchToggle?.addEventListener(...)` closing `});`.
- The site line: replace the `<div class="admin-shell-site">…</div>` with

```astro
        <div class="admin-shell-site">
          <span class="admin-shell-site__name" title={siteName}>{siteName}</span>
          <a class="admin-shell-site__view" href="/" target="_blank" rel="noopener noreferrer" aria-label={copy.shell.viewSiteLabel} title={copy.shell.viewSite}><Icon name="external" /></a>
        </div>
```

(the markup is the same; the look changes in CSS. Keep `copy.shell.viewSite` — it is the title now.)

- [ ] **Step 4: Delete `postSearchState` and its tests and copy**

- `src/lib/admin.ts`: delete the function at 98–106 and its doc comment.
- `tests/unit/admin-path.test.ts`: remove `postSearchState,` from the import and delete the two tests `a post search from the Posts list keeps the filters in force` and `a post search from any other screen starts from all posts`.
- `src/lib/admin-i18n.ts`: delete `searchLabel` and `searchPlaceholder` from `shell` in both the English block (~130–131) and the Thai block (~1100–1101). Run `grep -n "shell.searchLabel\|shell.searchPlaceholder" -r src` and expect nothing.

- [ ] **Step 5: Restyle the shell in `global.css`**

Replace the rules named, keeping their neighbours:

```css
.admin-shell-brand { display: block; padding-block: var(--space-lg) var(--space-md); }
.admin-shell-brand .admin-logo { max-width: 100%; }
/* The site the admin belongs to, and the way out to it, on one line under the logo, closed
 * by a rule: the masthead's dateline. It used to be a pill, the one filled thing in the column. */
.admin-shell-site {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  min-width: 0;
  margin-block-end: var(--space-lg);
  padding-block-end: var(--space-sm);
  border-block-end: var(--rule-hair) solid var(--color-rule);
}
.admin-shell-site__name { min-width: 0; overflow: hidden; font-weight: 600; font-size: var(--text-sm); text-overflow: ellipsis; white-space: nowrap; }
.admin-shell-site__view { display: grid; flex: 0 0 auto; place-items: center; width: 2rem; height: 2rem; border-radius: var(--radius-sm); color: var(--color-muted); }
.admin-shell-site__view:hover { background: var(--color-paper-3); color: var(--color-ink); }
@media (pointer: coarse) {
  .admin-shell-site__view { width: var(--control-height); height: var(--control-height); }
}
.admin-sidebar nav, .admin-mobile-nav nav { display: grid; gap: var(--space-xl); }
.admin-sidebar nav section, .admin-mobile-nav nav section { display: grid; gap: var(--space-3xs); }
/* One eyebrow for the whole admin: the nav group's name, the line over a page title, the
 * label over a figure, a table's column head. Eleven pixels, tracked, and never ink. */
.admin-eyebrow,
.admin-nav-group {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 1rem;
  text-transform: uppercase;
}
.admin-nav-group { margin-block-end: var(--space-xs); padding-inline: var(--space-sm); }
.admin-sidebar nav :is(a, summary), .admin-mobile-nav nav :is(a, summary) { position: relative; display: flex; gap: var(--space-sm); min-height: var(--control-height); align-items: center; padding-inline: var(--space-sm); border-radius: var(--radius-sm); color: var(--color-muted); font-size: var(--text-sm); font-weight: 500; text-decoration: none; list-style: none; cursor: pointer; }
.admin-sidebar nav summary::-webkit-details-marker, .admin-mobile-nav nav summary::-webkit-details-marker { display: none; }
.admin-sidebar nav :is(a, summary):hover, .admin-mobile-nav nav :is(a, summary):hover { color: var(--color-ink); }
/* Where the reader is: ink, and a 2px accent bar in the gutter. No fill -- no two surfaces in
 * this palette are far enough apart to carry a state (surface-tokens-cannot-carry-state). */
.admin-sidebar nav a[aria-current='page'], .admin-mobile-nav nav a[aria-current='page'] { color: var(--color-ink); }
.admin-sidebar nav a[aria-current='page']::before,
.admin-mobile-nav nav a[aria-current='page']::before {
  content: '';
  position: absolute;
  inset-block: var(--space-xs);
  inset-inline-start: calc(var(--space-sm) * -1);
  width: 2px;
  border-radius: 1px;
  background: var(--color-accent);
}
.admin-mobile-nav nav a[aria-current='page']::before { inset-inline-start: calc(var(--space-xs) * -1); }
.admin-sidebar nav a[aria-current='page'] .admin-nav-count, .admin-mobile-nav nav a[aria-current='page'] .admin-nav-count { color: var(--color-ink); }
```

Then the count badge: replace the shared `.admin-count, .admin-nav-count, .admin-tab-count` rule with

```css
/* A count is a figure beside its word, not a pill: tabular, muted, and no heavier than the label. */
.admin-count,
.admin-nav-count,
.admin-tab-count {
  flex: none;
  min-width: 1.5rem;
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.25rem;
  text-align: center;
}
```

and delete the later `.admin-tab-count { padding-inline: var(--space-2xs); font-weight: 400; }` line. In `admin-surface-tokens.test.ts`, update `a tab count adds only what a tab needs` to `assert.doesNotMatch(CSS, /\n\.admin-tab-count \{/)` with the comment "a count is the shared figure and adds nothing of its own", and `a count is one badge, wherever it is counted` to assert `border-radius` and `background` are `undefined`.

Account block:

```css
.admin-shell-account { display: grid; gap: var(--space-sm); margin-top: var(--space-xl); padding-block-start: var(--space-md); border-block-start: var(--rule-hair) solid var(--color-rule); }
.admin-shell-user { display: flex; align-items: center; gap: var(--space-xs); min-width: 0; padding-inline: var(--space-sm); }
```

(delete `border`, `border-radius`, `background`, the block `padding` from `.admin-shell-user`.)

Top bar (replace the whole `.admin-topbar` group):

```css
/* The bar over a phone's screen: the menu, and which screen this is. From 64rem up there is no
 * bar -- the page head is the masthead, and the sidebar already says where the reader is. */
.admin-topbar { position: sticky; inset-block-start: 0; z-index: var(--z-sticky-nav); display: flex; align-items: center; gap: var(--space-xs); min-height: var(--admin-topbar-height); padding-inline: var(--space-md); border-block-end: var(--rule-hair) solid var(--color-rule); background: var(--color-paper-2); }
.admin-topbar__title { min-width: 0; overflow: hidden; margin: 0; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
@media (min-width: 64rem) {
  .admin-topbar { display: none; }
}
```

Sidebar column (in the `@media (min-width: 64rem)` block near line 410):

```css
@media (min-width: 64rem) {
  .admin-sidebar { display: flex; flex-direction: column; position: fixed; inset: 0 auto 0 0; width: var(--admin-sidebar-width); overflow-y: auto; padding: var(--space-md) var(--space-md) var(--space-md) var(--space-lg); }
  .admin-sidebar .admin-shell-account { margin-top: auto; }
  .admin-shell-main { margin-inline-start: var(--admin-sidebar-width); }
}
```

Notices and footer:

```css
.admin-migrations { display: grid; gap: var(--space-2xs); margin: 0; padding: var(--space-sm) clamp(var(--space-md), 4vw, var(--space-xl)); border: 0; border-inline-start: 3px solid var(--color-error); border-block-end: var(--rule-hair) solid var(--color-rule); border-radius: 0; background: none; }
.admin-maintenance-notice { margin: 0; padding: var(--space-sm) clamp(var(--space-md), 4vw, var(--space-xl)); border: 0; border-inline-start: 3px solid var(--color-accent); border-block-end: var(--rule-hair) solid var(--color-rule); border-radius: 0; background: none; }
.admin-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2xs) var(--space-md); margin-inline: clamp(var(--space-md), 4vw, var(--space-xl)); padding-block: var(--space-md) var(--space-lg); border-block-start: var(--rule-hair) solid var(--color-rule); color: var(--color-muted); font-size: var(--text-xs); }
```

(`.admin-maintenance-notice` is also in the shared rule with `.home-slides-notice, .stats-empty-notice`; the later dedicated rule above wins by order — move it below that shared rule if it is not already.)

Delete the now-unused rules: `.admin-topbar__search`, `.admin-topbar[data-search-open] .admin-topbar__search`, `.admin-topbar__site > span`, the `.admin-topbar .admin-topbar__menu, .admin-topbar .admin-topbar__search-toggle { display: none; }` line and the `.admin-topbar__search { display: block; flex: 0 1 22rem; order: 0; }` line inside the old 64rem block. Keep `.admin-search` (the media library uses it).

- [ ] **Step 6: Skeleton and mobile drawer**

`AdminSkeleton.astro` needs no change for the shell (it renders inside the shell). `.admin-mobile-nav` keeps `background: var(--color-paper)` — a dialog floats and needs a surface — but change its `padding` to `var(--space-lg) var(--space-md)` so the active bar's `-1rem` inset lands in the gutter.

- [ ] **Step 7: Run the unit tests**

Run: `npm run test:unit`
Expected: PASS, including `admin-footer.test.ts` (it reads the footer's markup, which did not change) and `admin-path.test.ts` without the two deleted tests.

- [ ] **Step 8: Run the e2e specs that touch the shell**

Run: `npm run test:e2e -- tests/e2e/theme-toggle.spec.ts tests/e2e/overlay-motion.spec.ts tests/e2e/admin-migration-warning.spec.ts`
Expected: PASS. `theme-toggle.spec.ts` finds the toggle in `.admin-sidebar` by its accessible name; the migration warning spec reads `.admin-migrations` text.

- [ ] **Step 9: Shoot, measure, review**

Run: `ADMIN_SHOTS=layer2 npm run test:e2e -- tests/e2e/admin-shots.spec.ts --project=desktop`
Check `measure.json`: `posts.topbar` is `null` (not rendered at 1440); `posts.active.height` is `40`; `posts.siteName.width` is under `200` and its `height` is `20` (one line). Show the owner `posts-1440-light.png`, `posts-1440-dark.png`, `posts-375-light.png`. Wait for their word.

- [ ] **Step 10: Commit**

`git add src/components/admin/AdminShell.astro src/styles/global.css src/lib/admin.ts src/lib/admin-i18n.ts tests/unit/admin-path.test.ts tests/unit/admin-surface-tokens.test.ts`
Message: `feat(admin): a masthead sidebar, no desktop top bar, and no admin search`

---

### Task 4: Page head, eyebrow, tabs and the list filters

**Files:**
- Modify: `src/styles/global.css` (`.admin-page`, `.admin-page__head*`, `.admin-post-tabs`, `.admin-post-filters`, `.admin-button--primary`, `.admin-button--secondary`)
- Modify: 15 heads — `src/pages/admin/index.astro`, `pages/index.astro`, `categories.astro`, `redirects.astro`, `stats.astro`, `profile.astro`, `security.astro`, `settings.astro`, `system.astro`, `plugins.astro`, `themes/index.astro`; `src/components/admin/MediaLibrary.tsx:475`, `NavigationManager.tsx:222`, `MaintenanceForm.tsx:176`, `SlidesManager.tsx:285`
- Modify: `src/pages/admin/index.astro:130-161` and `src/pages/admin/pages/index.astro:84-108` (filters)
- Modify: `src/lib/admin-i18n.ts` (delete `filters.apply`, `filters.searchByTitle`, `pages.search`, `posts.search` in both locales)
- Modify: `src/components/admin/AdminSkeleton.astro` (filters block)
- Modify: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `.admin-eyebrow` from Task 3.
- Produces: each head is `<header class="admin-page__head"><div><p class="admin-eyebrow">{group}</p><h1>…</h1><p>…</p></div>…</header>`; the tab row is `<div class="admin-list-bar"><nav class="admin-post-tabs">…</nav><form class="admin-list-filter">…</form></div>`. Tasks 6 and 8 rely on `.admin-list-bar` being the rule the list starts under.

- [ ] **Step 1: Write the failing unit tests**

Append to `admin-surface-tokens.test.ts`:

```ts
test('every page head carries an eyebrow, and the title is the display face at 700', () => {
  const heads = [
    'src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro', 'src/pages/admin/categories.astro',
    'src/pages/admin/redirects.astro', 'src/pages/admin/stats.astro', 'src/pages/admin/profile.astro',
    'src/pages/admin/security.astro', 'src/pages/admin/settings.astro', 'src/pages/admin/system.astro',
    'src/pages/admin/plugins.astro', 'src/pages/admin/themes/index.astro', 'src/components/admin/MediaLibrary.tsx',
    'src/components/admin/NavigationManager.tsx', 'src/components/admin/MaintenanceForm.tsx', 'src/components/admin/SlidesManager.tsx',
  ];
  for (const head of heads) {
    assert.match(read(head), /admin-page__head[\s\S]{0,120}?class(?:Name)?="admin-eyebrow"/, `${head} has no eyebrow`);
  }
  const title = ruleBody(CSS, '.admin-page__head h1');
  // 700, not 600: Google Sans Thai ships one bold weight and font-synthesis is off, so a 600
  // Thai title would fall back to the body face without a word of warning.
  assert.equal(declaration(title, 'font-weight'), '700');
  assert.equal(declaration(title, 'font-family'), 'var(--font-display)');
});

test('the list screens filter from the tab row and keep a submit for a page with no script', () => {
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(page);
    assert.match(source, /class="admin-list-bar"/, `${page} has no list bar`);
    assert.match(source, /<select class="admin-control admin-list-filter__select"[^>]*name="locale"/, `${page} does not filter with a select`);
    assert.match(source, /class="admin-button admin-list-filter__submit"[^>]*type="submit"/, `${page} lost its no-script submit`);
    assert.doesNotMatch(source, /name="q"/, `${page} still has a title search`);
    assert.doesNotMatch(source, /copy\.filters\.apply/, `${page} still has Apply filters`);
  }
  assert.match(CSS, /\.admin-list-filter__submit:not\(:focus-visible\) \{[^}]*position: absolute/);
});
```

Delete the old test `an admin page title is semibold`.

- [ ] **Step 2: Run to see them fail**

Run: `node --import tsx --test tests/unit/admin-surface-tokens.test.ts`
Expected: both new tests FAIL.

- [ ] **Step 3: The head and tab rules**

In `global.css` replace `.admin-page`, `.admin-page__head`, `.admin-page__head h1`, `.admin-page__head p`:

```css
.admin-page {
  width: min(100%, 80rem);
  min-width: 0;
  margin-inline: auto;
  padding: var(--space-xl) clamp(var(--space-md), 4vw, var(--space-xl)) var(--space-3xl);
}
/* The masthead: an eyebrow naming the group, the title in the display face, a line of lede,
 * the actions on the title's baseline, and a rule to close it. Where tabs follow, the tab
 * row supplies the rule instead (see .admin-page__head--tabs). */
.admin-page__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-lg);
  align-items: end;
  padding-block-end: var(--space-lg);
  border-block-end: var(--rule-hair) solid var(--color-rule);
}
.admin-page__head--tabs { padding-block-end: 0; border-block-end: 0; }
.admin-page__head .admin-eyebrow { margin-block-end: var(--space-xs); }
.admin-page__head h1 {
  min-width: 0;
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  overflow-wrap: anywhere;
}
.admin-page__head p:not(.admin-eyebrow) {
  max-width: 55ch;
  margin: var(--space-sm) 0 0;
  color: var(--color-muted);
}
.admin-page__head + * { margin-block-start: var(--space-lg); }
```

Tabs — replace the `.admin-post-tabs, .navigation-tabs` group and its `a` rule:

```css
/* One set of tab rules for the whole admin. Posts and Pages tab with links; the menu editor
 * and Maintenance tab with real ARIA tabs, which are buttons. The chosen one is ink with the
 * accent under it, on the row's own rule. */
.admin-post-tabs,
.navigation-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
  border-block-end: var(--rule-hair) solid var(--color-rule);
}
.admin-post-tabs a,
.navigation-tabs [role="tab"] {
  display: inline-flex;
  gap: var(--space-xs);
  min-inline-size: 44px;
  min-height: var(--control-height);
  margin-block-end: -1px;
  align-items: center;
  justify-content: center;
  padding-inline: var(--space-3xs);
  border: 0;
  border-block-end: 2px solid transparent;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
}
.admin-post-tabs a[aria-current="page"],
.navigation-tabs [aria-selected="true"] { border-color: var(--color-accent); color: var(--color-ink); font-weight: 600; }
/* The tab row and, at its right end, the one filter a list keeps: the language. */
.admin-list-bar { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: var(--space-xs) var(--space-lg); margin-block-start: var(--space-lg); border-block-end: var(--rule-hair) solid var(--color-rule); }
.admin-list-bar .admin-post-tabs { border-block-end: 0; }
.admin-list-filter { position: relative; display: flex; align-items: center; margin-block-end: -1px; }
.admin-list-filter__select {
  min-height: var(--control-height);
  padding-inline: 0 var(--space-lg);
  border: 0;
  border-block-end: 2px solid transparent;
  border-radius: 0;
  background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='currentColor' stroke-width='1.5'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E") no-repeat right center;
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  font-weight: 500;
  appearance: none;
}
.admin-list-filter__select:focus-visible { outline: 0; border-block-end-color: var(--color-focus); }
/* The submit is for a page with no script: unseen until a keyboard reaches it. */
.admin-list-filter__submit:not(:focus-visible) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
```

Delete `.admin-post-filters`, `.admin-post-filters .admin-field`, `.admin-post-filters > button`, `.admin-post-filters--compact`, and the `.admin-post-filters { grid-template-columns: minmax(0, 1fr); }` line in the `max-width: 39.999rem` block.

Buttons: `.admin-button--primary` gains `border-radius: 0.5rem;` (the card corner, restated because the primary sits beside cards); `.admin-page__actions .admin-button--secondary` is added as a ghost: `.admin-page__head .admin-button--secondary { border-color: transparent; background: transparent; color: var(--color-muted); } .admin-page__head .admin-button--secondary:hover { color: var(--color-ink); background: var(--color-paper-3); }`.

- [ ] **Step 4: Eyebrows in every head**

Add `<p class="admin-eyebrow">…</p>` as the first child of the head's first `<div>` in each file. The text:

| File | Eyebrow |
|---|---|
| `index.astro`, `pages/index.astro`, `stats.astro`, `redirects.astro`, `MediaLibrary.tsx`, `NavigationManager.tsx`, `SlidesManager.tsx` | `{copy.nav.groupContent}` |
| `categories.astro` | `{copy.nav.posts}` |
| `profile.astro`, `security.astro`, `system.astro`, `plugins.astro`, `themes/index.astro` | `{copy.nav.groupConfig}` |
| `settings.astro`, `MaintenanceForm.tsx` | `{copy.nav.settings}` (the section; in `MaintenanceForm.tsx` the copy object is `text` — it is `adminCopy(ownerLocale).maintenance`; import `adminCopy` and read `adminCopy(ownerLocale).nav.settings`, or pass `eyebrow` as a prop from `maintenance.astro`. Use the prop: `eyebrow: string` on `MaintenanceForm`, passed as `eyebrow={copy.nav.settings}`.) |

In `.tsx` files the attribute is `className="admin-eyebrow"`. `MediaLibrary.tsx` has the copy as `copy.nav.groupContent`? Check: it receives `copy = adminCopy(props.ownerLocale)` — if it receives only `copy.media`, pass `eyebrow` as a prop the same way. `SlidesManager.tsx` uses `text` for `copy.slides`; add an `eyebrow` prop from `slides.astro`. `NavigationManager.tsx` has `copy` whole.

- [ ] **Step 5: The Posts filter row**

In `src/pages/admin/index.astro` replace the `<nav class="admin-post-tabs">…</nav>` and the `<form class="admin-post-filters admin-post-filters--compact">…</form>` with:

```astro
        <div class="admin-list-bar">
          <nav class="admin-post-tabs" aria-label={copy.posts.statusLabel}>
            {tabs.map((tab) => (
              <a aria-current={status === tab.status ? "page" : undefined} href={adminHref(adminSettings, `?${new URLSearchParams({ status: tab.status, locale })}`)}>{tab.label} <span class="admin-tab-count">{tab.count}</span></a>
            ))}
          </nav>
          <form class="admin-list-filter" action={adminHref(adminSettings)} method="get" novalidate data-list-filter>
            <input type="hidden" name="status" value={status} />
            <label class="sr-only" for="post-locale">{copy.filters.language}</label>
            <select class="admin-control admin-list-filter__select" id="post-locale" name="locale">
              <option value="all" selected={locale === 'all'}>{copy.filters.allLanguages}</option>
              <option value="th" selected={locale === 'th'}>{copy.filters.thai}</option>
              <option value="en" selected={locale === 'en'}>{copy.filters.english}</option>
            </select>
            <button class="admin-button admin-list-filter__submit" type="submit">{copy.filters.language}</button>
          </form>
        </div>
```

Add `class="admin-page__head admin-page__head--tabs"` on this page's head. Remove `q` from the tabs' URL params (shown above) and from the page's `filters` — `const query = ''`? No: leave `filterAdminPosts` and `const query = (Astro.url.searchParams.get('q') ?? '')…` as they are (the URL still works; only the field is gone). Remove the `UiSelect` import if nothing else on the page uses it.

Add to the page's `<script>` (the one that imports `admin-story-list`; if the page has no client `<script>`, add one), at the end:

```ts
  // The language select filters as it changes; the submit beside it is for a page with no script.
  document.querySelector<HTMLFormElement>('[data-list-filter]')?.addEventListener('change', (event) => {
    (event.currentTarget as HTMLFormElement).requestSubmit();
  });
```

- [ ] **Step 6: The Pages filter row**

Same shape in `src/pages/admin/pages/index.astro`, replacing its tabs and its whole `<form class="admin-post-filters">` (the title field goes with it): `action={adminHref(adminSettings, '/pages')}`, ids `page-locale`, and the same `data-list-filter` form with the same script addition in the page's script. Tab hrefs drop `q`. Head gets `admin-page__head--tabs`.

- [ ] **Step 7: Copy and skeleton**

`src/lib/admin-i18n.ts`: delete `filters.apply`, `filters.searchByTitle`, `posts.search`, `pages.search` in both locales. Run `grep -rn "filters\.apply\|searchByTitle\|posts\.search\b\|pages\.search\b" src` → nothing.

`AdminSkeleton.astro`: replace the `{filters && (…)}` fragment with

```astro
        {filters && (
          <div class="admin-list-bar">
            <div class="admin-post-tabs">
              {count(3).map(() => <span class="skeleton-tab"></span>)}
            </div>
            <span class="skeleton-line" style="--skeleton-width: 7rem"></span>
          </div>
        )}
```

and make the skeleton's head carry an eyebrow line: inside `<div class="admin-page__head"><div>` add `<span class="skeleton-line" style="--skeleton-width: 4rem"></span>` before the title block, and add `admin-page__head--tabs` to the head's class when `filters` is true: `<div class:list={['admin-page__head', filters && 'admin-page__head--tabs']}>`.

- [ ] **Step 8: Run the unit tests and the list specs**

Run: `npm run test:unit`
Expected: PASS (`admin-i18n` parity holds because both locales lost the same keys).
Run: `npm run test:e2e -- tests/e2e/editor-blocks.spec.ts tests/e2e/select-in-dialog.spec.ts`
Expected: PASS (the profile-and-footer test in `select-in-dialog` walks the Posts page).

- [ ] **Step 9: Shoot, measure, review**

`ADMIN_SHOTS=layer3 …`. Check `measure.json`: `posts.title.height` is `40` at 1440 and `titleFont` contains `700` and `"Google Sans"`. Show the owner `posts-1440-light.png`, `pages-1440-light.png`, `settings-1440-light.png`, `posts-375-light.png`. Wait.

- [ ] **Step 10: Commit**

`git add src/styles/global.css src/pages/admin src/components/admin/MediaLibrary.tsx src/components/admin/NavigationManager.tsx src/components/admin/MaintenanceForm.tsx src/components/admin/SlidesManager.tsx src/components/admin/AdminSkeleton.astro src/lib/admin-i18n.ts tests/unit/admin-surface-tokens.test.ts`
Message: `feat(admin): eyebrows and a masthead head on every screen; the lists filter from the tab row`

---

### Task 5: Sheets and the save bar

**Files:**
- Modify: `src/styles/global.css` (`.admin-form-page`, `.admin-card-stack`, `.admin-card`, `.admin-card__head`, `.admin-card h2`, `.admin-card--note`, `.admin-save-bar`, `.update-card`, `.maintenance-screen > .admin-card-stack`, `.admin-settings-form`, `.admin-skeleton__stack`)
- Modify: `src/pages/admin/settings.astro:48`, `src/components/admin/MaintenanceForm.tsx:176` (sub-tabs)
- Modify: `src/components/admin/AdminSkeleton.astro` (form kind)
- Modify: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `.admin-page__head--tabs`, `.admin-post-tabs` from Task 4.
- Produces: `.admin-card` is a two-column sheet inside a `.admin-card-stack` container ≥ 53rem wide; `.admin-card__head` is its left column. Task 6's tier-3 empty line lives in the right column.

- [ ] **Step 1: Write the failing unit tests**

Append:

```ts
test('a form is a stack of sheets: no box, a rule between, two columns when the stack is wide', () => {
  const card = ruleBody(CSS, '.admin-card');
  assert.equal(declaration(card, 'border'), undefined, 'a sheet has no frame');
  assert.equal(declaration(card, 'background'), undefined, 'a sheet has no fill');
  assert.equal(declaration(card, 'border-radius'), undefined);
  assert.match(CSS, /\.admin-card \+ \.admin-card \{ border-block-start: var\(--rule-hair\) solid var\(--color-rule\); \}/);
  assert.equal(declaration(ruleBody(CSS, '.admin-card-stack'), 'container-type'), 'inline-size');
  // 53rem: a 16rem head column, 3rem between, a 34rem field column. Under it one column, so
  // a 768px tablet (a 640px main column) stacks and a 1024px one does not.
  assert.match(CSS, /@container \(min-width: 53rem\) \{\s*\.admin-card \{ grid-template-columns: 16rem minmax\(0, 34rem\); column-gap: var\(--space-xl\);/);
});

test('the save bar is a row on the page edge, with its state beside the button', () => {
  const bar = ruleBody(CSS, '.admin-save-bar');
  assert.equal(declaration(bar, 'border-radius'), undefined);
  assert.equal(declaration(bar, 'inset-block-end'), '0');
  assert.match(declaration(bar, 'border-block-start') ?? '', /var\(--color-rule\)$/);
  assert.match(declaration(bar, 'background') ?? '', /color-mix\(in oklch, var\(--color-paper-2\) 94%/);
  assert.equal(declaration(bar, 'justify-content'), 'flex-end');
});

test('Settings and Maintenance are two tabs of one section', () => {
  assert.match(read('src/pages/admin/settings.astro'), /admin-page__head admin-page__head--tabs[\s\S]*?admin-post-tabs admin-subtabs[\s\S]*?aria-current="page"[^>]*>\{copy\.nav\.general\}/);
  assert.match(read('src/components/admin/MaintenanceForm.tsx'), /admin-post-tabs admin-subtabs[\s\S]*?aria-current="page"[^>]*>\{[\w.]*maintenance\}/);
});
```

(The spec said 48px between the columns; the plan uses 32px, `var(--space-xl)`, which keeps the 8px grid and the 34rem field column inside a 53rem stack. Say so in the commit message.)

- [ ] **Step 2: Run to see them fail**

Run: `node --import tsx --test tests/unit/admin-surface-tokens.test.ts`
Expected: FAIL ×3.

- [ ] **Step 3: The sheet rules**

Replace `.admin-card-stack` and `.admin-card`, and the `.admin-card h2`, `.admin-card__head`, `.admin-card__head p` group, and `.admin-card--note`:

```css
/* One sheet language for the whole admin. A form is a stack of sheets: each is a section's
 * name and a line about it, then its fields, and a rule between one sheet and the next.
 * Nothing is boxed -- what separates one thing from the next is a rule or 32px of air. */
.admin-card-stack { display: grid; container-type: inline-size; }
.admin-card { display: grid; gap: var(--space-lg); padding-block: var(--space-xl); }
.admin-card + .admin-card { border-block-start: var(--rule-hair) solid var(--color-rule); }
.admin-card-stack > .admin-card:first-child { padding-block-start: 0; }
.admin-card h2 { margin: 0; color: var(--color-ink); font-family: var(--font-display); font-size: var(--text-xl); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
.admin-card__head { display: grid; gap: var(--space-2xs); align-content: start; }
.admin-card__head p { margin: 0; color: var(--color-muted); font-size: var(--text-sm); }
/* Two columns from 53rem of stack: the head in a 16rem column, the fields in one capped at
 * 34rem, which is as wide as anything here is typed. The head is the first child and spans
 * nothing; every sibling after it flows down the second column. */
@container (min-width: 53rem) {
  .admin-card { grid-template-columns: 16rem minmax(0, 34rem); column-gap: var(--space-xl); }
  .admin-card > .admin-card__head { grid-column: 1; grid-row: 1; }
  .admin-card > :not(.admin-card__head) { grid-column: 2; }
}
/* A note among sheets is a paragraph with an accent bar, not a dashed box. */
.admin-card--note { gap: var(--space-2xs); padding-inline-start: var(--space-md); border-inline-start: 3px solid var(--color-accent); }
.admin-card--note h2 { margin: 0; font-size: var(--text-base); }
.admin-card--note p { margin: 0; color: var(--color-ink-2); font-size: var(--text-sm); }
```

`.admin-form-page { max-width: 56rem; }` (was 52rem). `.admin-settings-form { display: grid; gap: 0; margin-top: 0; }` (the sheets space themselves). `.maintenance-screen > .admin-card-stack { margin-block-start: 0; }` (the head's `+ *` margin does it). Keep `.update-card { grid-template-columns: … }` at 48rem but change it to a container query on the same 53rem so System's release row obeys the sheet: replace the `@media (min-width: 48rem) { .update-card … }` block with `@container (min-width: 53rem) { .update-card > .update-summary { grid-column: 2; } .update-card > .update-actions { grid-column: 2; } }` — the sheet grid already places them in column 2, so this block can simply be deleted; delete it and the `.update-card { align-items: start; }` line.

Save bar:

```css
/* The primary action stays in reach at the foot of a long form. No box: a rule above, the page
 * showing through at 94%, the save state in words beside the button -- a colour cannot say it,
 * no two surfaces here are far enough apart. */
.admin-save-bar {
  position: sticky;
  inset-block-end: 0;
  display: flex;
  flex-direction: row-reverse;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-block-start: var(--space-xl);
  padding-block: var(--space-md);
  border-block-start: var(--rule-hair) solid var(--color-rule);
  background: color-mix(in oklch, var(--color-paper-2) 94%, transparent);
  backdrop-filter: blur(var(--space-sm));
}
.admin-save-bar p { margin: 0; color: var(--color-muted); font-size: var(--text-sm); }
```

(`row-reverse` puts the button, which is first in the markup on all three forms, at the right end with the status to its left — no component change.)

- [ ] **Step 4: Settings and Maintenance sub-tabs**

`settings.astro` line 48:

```astro
        <header class="admin-page__head admin-page__head--tabs"><div><p class="admin-eyebrow">{copy.nav.settings}</p><h1>{copy.settings.heading}</h1><p>{copy.settings.subheading}</p></div></header>
        <nav class="admin-post-tabs admin-subtabs" aria-label={copy.nav.settings}>
          <a aria-current="page" href={adminHref({ admin_path: settings.admin_path }, '/settings')}>{copy.nav.general}</a>
          <a href={adminHref({ admin_path: settings.admin_path }, '/maintenance')}>{copy.nav.maintenance}</a>
        </nav>
```

(import `adminHref` from `../../lib/admin` if the page does not already.) `MaintenanceForm.tsx` line 176, with new props `eyebrow: string`, `generalHref: string`, `maintenanceHref: string`, `tabs: { general: string; maintenance: string; label: string }` passed from `maintenance.astro` (`copy.nav.settings`, `adminHref(adminSettings, '/settings')`, `adminHref(adminSettings, '/maintenance')`, `{ general: copy.nav.general, maintenance: copy.nav.maintenance, label: copy.nav.settings }`):

```tsx
      <header className="admin-page__head admin-page__head--tabs"><div><p className="admin-eyebrow">{eyebrow}</p><h1>{text.heading}</h1><p>{text.subheading}</p></div></header>
      <nav className="admin-post-tabs admin-subtabs" aria-label={tabs.label}>
        <a href={generalHref}>{tabs.general}</a>
        <a aria-current="page" href={maintenanceHref}>{tabs.maintenance}</a>
      </nav>
```

Add `.admin-subtabs { margin-block-start: var(--space-lg); }` beside `.admin-list-bar`.

- [ ] **Step 5: The form skeleton**

In `AdminSkeleton.astro`, replace the `{kind === 'form' && (…)}` block:

```astro
        {kind === 'form' && (
          <div class="admin-card-stack admin-skeleton__stack">
            {[3, 2].map((fields) => (
              <div class="admin-card">
                <div class="admin-card__head">
                  <span class="skeleton-line" style="--skeleton-width: 8rem"></span>
                  <span class="skeleton-line" style="--skeleton-width: 12rem"></span>
                </div>
                {count(fields).map((index) => (
                  <div class="admin-field">
                    <span class="skeleton-line" style={`--skeleton-width: ${index ? 6 : 9}rem`}></span>
                    <span class="skeleton skeleton--control"></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
```

and `.admin-skeleton__stack { margin-block-start: var(--space-lg); }` (gap comes from the sheets).

- [ ] **Step 6: Run the unit tests and the form specs**

Run: `npm run test:unit`
Run: `npm run test:e2e -- tests/e2e/maintenance.spec.ts tests/e2e/site-brand.spec.ts tests/e2e/theme-settings.spec.ts`
Expected: PASS.

- [ ] **Step 7: Shoot, measure, review**

`ADMIN_SHOTS=layer4 …`. `measure.json`: `settings.firstCard.width` ≥ `800` at 1440 (two columns), `settings.saveBar.height` between `72` and `80`. Also shoot 768 and confirm by eye that Settings is one column there. Show the owner `settings-1440-light.png`, `settings-1440-dark.png`, `settings-768-light.png`, `system-1440-light.png`, `security-1440-light.png`. Wait.

- [ ] **Step 8: Commit**

`git add src/styles/global.css src/pages/admin/settings.astro src/pages/admin/maintenance.astro src/components/admin/MaintenanceForm.tsx src/components/admin/AdminSkeleton.astro tests/unit/admin-surface-tokens.test.ts`
Message: `feat(admin): form pages are two-column sheets with a rule between, and a save bar on the page edge`

---

### Task 6: Empty states in three tiers

**Files:**
- Modify: `src/styles/global.css` (`.admin-empty*`, `.admin-story-list > .admin-empty`, `.admin-empty-inline`, `.navigation-empty`, `.media-empty`, `.redirect-empty`, the `max-width: 39.999rem` `.admin-empty` lines)
- Modify: `src/pages/admin/index.astro:219-225`, `src/pages/admin/pages/index.astro` (its empty block), `src/components/admin/MediaLibrary.tsx:515-518`, `NavigationManager.tsx:240-245`, `SlidesManager.tsx:308-311`, `ProfileForm.tsx:192`, `RedirectManager.tsx:113-114`, `src/pages/admin/stats.astro:77-84`
- Modify: `src/lib/admin-i18n.ts` (new keys), `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Produces: `.admin-empty` (tier 1: eyebrow, `h2`, `p`, optional button), `.admin-empty--filtered` (tier 2: one `<p>` with a link), `.admin-empty--inline` (tier 3: one `<p>` with a link or button). Task 7 uses tier 1 on Stats.

- [ ] **Step 1: Copy first**

`src/lib/admin-i18n.ts`, English: under `empty` (new top-level block, alphabetical position after `editor` if the file is alphabetical; match the file's order): `eyebrow: 'Nothing here yet'`. `posts.noMatchLink: 'Show all posts'`, `pages.noMatchLink: 'Show all pages'`, `profile.linksAdd: 'Add a link'`. Thai: `empty.eyebrow: 'ยังไม่มีอะไรตรงนี้'`, `posts.noMatchLink: 'ดูบทความทั้งหมด'`, `pages.noMatchLink: 'ดูเพจทั้งหมด'`, `profile.linksAdd: 'เพิ่มลิงก์'`.

Run: `node --import tsx --test tests/unit/admin-i18n.test.ts` → PASS.

- [ ] **Step 2: Write the failing unit tests**

Replace `an empty state shows its screen's icon in a soft circle` with:

```ts
test('an empty state is one of three tiers, and none of them has an icon or a dashed box', () => {
  assert.doesNotMatch(CSS, /\.admin-empty__mark/, 'the icon circle is still drawn');
  for (const gone of ['.admin-empty-inline', '.redirect-empty', '.navigation-empty', '.media-empty', '.stats-empty {']) {
    assert.ok(!CSS.includes(`\n${gone}`) && !read('src/styles/stats.css').includes(`\n${gone}`), `${gone} still exists`);
  }
  const first = ruleBody(CSS, '.admin-empty');
  assert.equal(declaration(first, 'border-block-start'), 'var(--rule-hair) solid var(--color-rule)');
  assert.equal(declaration(first, 'max-width'), '36rem');
  assert.equal(declaration(ruleBody(CSS, '.admin-empty h2'), 'font-family'), 'var(--font-display)');
  assert.doesNotMatch(CSS, /\.admin-story-list > \.admin-empty \{[^}]*dashed/);
  // The screens: which tier each one draws.
  assert.match(read('src/pages/admin/index.astro'), /posts\.length \? \(\s*<p class="admin-empty admin-empty--filtered">/);
  assert.match(read('src/pages/admin/pages/index.astro'), /pages\.length \? \(\s*<p class="admin-empty admin-empty--filtered">/);
  assert.match(read('src/components/admin/ProfileForm.tsx'), /className="admin-empty admin-empty--inline"/);
  assert.match(read('src/components/admin/RedirectManager.tsx'), /className="admin-empty admin-empty--inline"/);
  for (const file of ['src/components/admin/MediaLibrary.tsx', 'src/components/admin/NavigationManager.tsx', 'src/components/admin/SlidesManager.tsx', 'src/pages/admin/stats.astro']) {
    assert.match(read(file), /class(?:Name)?="admin-empty"[\s\S]{0,80}?class(?:Name)?="admin-eyebrow"/, `${file} is not a tier-1 empty`);
  }
});
```

Update the media test `the media surfaces are tokens, not utility chains`: drop `.media-empty` from its selector list and replace its last two asserts with `assert.match(library, /className="admin-empty"/)`. Update `a menu item is handled with icons that keep their words`: the last assert becomes `assert.match(manager, /className="admin-empty"/)`.

- [ ] **Step 3: Run to see them fail**

Run: `node --import tsx --test tests/unit/admin-surface-tokens.test.ts` → FAIL.

- [ ] **Step 4: The CSS**

Replace the `.admin-empty` group (from its long comment through `.admin-empty p`) with:

```css
/* Empty, in three tiers by situation. Tier 1 is nothing-yet: a screen with no posts, files,
 * menu items, slides or counted readers. It is a short editorial block in the content column
 * -- eyebrow, a display heading, one sentence, one primary action -- ruled above and below,
 * and it reads as the first paragraph of the page, not a sign hung in the middle of it. */
.admin-empty {
  display: grid;
  gap: var(--space-sm);
  max-width: 36rem;
  margin: 0;
  padding-block: calc(var(--space-2xl) - var(--space-md)) calc(var(--space-2xl) - var(--space-xs));
  border-block-start: var(--rule-hair) solid var(--color-rule);
  border-block-end: var(--rule-hair) solid var(--color-rule);
}
.admin-empty h2 { margin: 0; font-family: var(--font-display); font-size: 1.75rem; font-weight: 700; letter-spacing: -0.025em; line-height: 1.15; }
.admin-empty p { margin: 0; color: var(--color-muted); }
.admin-empty .admin-button { justify-self: start; margin-block-start: var(--space-sm); }
/* Directly under a tab row or a head that already drew a rule, the block needs none of its own. */
.admin-list-bar + .admin-empty, .admin-page__head + .admin-empty, [data-admin-posts] > .admin-empty, .admin-story-list > .admin-empty { border-block-start: 0; }
.admin-story-list > .admin-empty { grid-column: 1 / -1; }
/* Tier 2: there are things, and the tab or filter finds none. One line, and the way back. */
.admin-empty--filtered { display: flex; flex-wrap: wrap; gap: var(--space-sm); max-width: none; padding-block: var(--space-lg); border-block-start: 0; color: var(--color-muted); }
.admin-empty--filtered a { color: var(--color-link); font-weight: 500; }
/* Tier 3: a section of a form with nothing in it yet. A muted line with the way to add the first. */
.admin-empty--inline { display: block; padding-block: var(--space-sm); border: 0; color: var(--color-muted); font-size: var(--text-sm); }
.admin-empty--inline a, .admin-empty--inline button { padding: 0; border: 0; background: none; color: var(--color-link); font: inherit; font-weight: 500; cursor: pointer; }
```

Delete: `.admin-empty__mark`, `.admin-empty__mark .icon`, `.admin-empty > div`, `.admin-empty-inline`, `.navigation-empty`, `.media-empty`, `.redirect-empty`, the two `.admin-empty` lines in the `max-width: 39.999rem` block, and in `stats.css` the `.stats-empty` rules (keep `.stats-empty-notice` until Task 7 removes it).

- [ ] **Step 5: The call sites**

`index.astro` (Posts):

```astro
          {!stories.length && (posts.length ? (
            <p class="admin-empty admin-empty--filtered"><span>{copy.posts.noMatchTitle}</span><a href={adminHref(adminSettings)}>{copy.posts.noMatchLink}</a></p>
          ) : (
            <div class="admin-empty">
              <p class="admin-eyebrow">{copy.empty.eyebrow}</p>
              <h2>{copy.posts.emptyTitle}</h2>
              <p>{copy.posts.emptyBody}</p>
              <a class="admin-button admin-button--primary" href={adminHref(adminSettings, '/new')}>{copy.posts.createFirst}</a>
            </div>
          ))}
```

`pages/index.astro`: the same with `pages`, `/pages` and `/pages/new`.

`MediaLibrary.tsx` 515–518:

```tsx
            <div className="admin-empty">
              <p className="admin-eyebrow">{copy.empty.eyebrow}</p>
              <h2>{copy.media.emptyTitle}</h2>
              <p>{copy.media.emptyBody}</p>
            </div>
```

(the upload button is in the toolbar above; the block carries none. If `copy` in this component is `copy.media` only, add `eyebrow` next to the `emptyEyebrow` — pass `copy.empty.eyebrow` as prop `emptyEyebrow` from `media.astro` and `MediaPicker`, or lift `copy` to the whole object. Prefer the whole object if the component already receives `ownerLocale`.)

`NavigationManager.tsx` 240–245:

```tsx
            {!items.length && (
              <div className="admin-empty">
                <p className="admin-eyebrow">{copy.empty.eyebrow}</p>
                <h2>{copy.navigation.empty}</h2>
              </div>
            )}
```

`SlidesManager.tsx` 308–311: the same shape with `text.empty` as the `h2` and the eyebrow from a new `eyebrow`-style prop or the whole copy object, as in Task 4.

`ProfileForm.tsx` 192:

```tsx
                {!authorLinks.length && <p className="admin-empty admin-empty--inline">{copy.profile.linksEmpty} <button type="button" onClick={() => { setAuthorLinks([{ label: copy.profile.linkWebsite, url: '' }]); setLinkChoices(['website']); setStatus(''); }}>{copy.profile.linksAdd}</button></p>}
```

`RedirectManager.tsx` 114: `<p className="admin-empty admin-empty--inline">{copy.redirects.empty}</p>` (its sentence already says what to do; the add form is directly above).

`stats.astro` 77–84:

```astro
        {!counted && (
          <div class="admin-empty" role="status">
            <p class="admin-eyebrow">{copy.empty.eyebrow}</p>
            <h2>{copy.stats.emptyHeading}</h2>
            <p>{copy.stats.emptyBody}</p>
          </div>
        )}
```

Delete `.stats-empty-notice` rules from `global.css` (the shared `.home-slides-notice, .admin-maintenance-notice, .stats-empty-notice` selector loses its third member) and from `stats.css`.

- [ ] **Step 6: Run the unit tests and the specs that meet an empty state**

Run: `npm run test:unit`
Run: `npm run test:e2e -- tests/e2e/stats.spec.ts tests/e2e/home-slides.spec.ts`
Expected: PASS. `stats.spec.ts` reads the empty heading by text ("Nobody counted yet"), which is unchanged.

- [ ] **Step 7: Shoot and review**

`ADMIN_SHOTS=layer5 …`. `measure.json`: `posts-empty.empty.width` ≤ `576` (36rem) and `> 0`. Show the owner `posts-empty-1440-light.png`, `media-1440-light.png`, `profile-1440-light.png`, `redirects-1440-light.png`. Wait.

- [ ] **Step 8: Commit**

`git add src/styles/global.css src/styles/stats.css src/pages/admin src/components/admin/MediaLibrary.tsx src/components/admin/NavigationManager.tsx src/components/admin/SlidesManager.tsx src/components/admin/ProfileForm.tsx src/components/admin/RedirectManager.tsx src/lib/admin-i18n.ts tests/unit/admin-surface-tokens.test.ts`
Message: `feat(admin): one empty-state system in three tiers, by situation rather than by screen`

---

### Task 7: Stats as figures, panels and a table without boxes

**Files:**
- Modify: `src/styles/stats.css` (most of it)
- Modify: `src/components/admin/stats/StatsReport.astro:50-75` (the `dt` becomes an eyebrow; the unit is split out)
- Modify: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: `.admin-eyebrow`, `--text-3xl`.
- Produces: nothing later tasks need. `stats.spec.ts` keeps working because `.stats-summary > div`, `.stats-summary__value`, `.stats-summary__change` and the `.sr-only` inside the value survive.

- [ ] **Step 1: Write the failing unit test**

```ts
test('the stats screen leads with figures, and boxes nothing', () => {
  const stats = read('src/styles/stats.css');
  const rule = (selector: string) => ruleBody(stats, selector);
  const value = rule('.stats-summary__value');
  assert.equal(declaration(value, 'font-family'), 'var(--font-display)');
  assert.equal(declaration(value, 'font-size'), 'var(--text-3xl)');
  assert.equal(declaration(value, 'font-variant-numeric'), 'tabular-nums');
  const figure = rule('.stats-summary > div');
  assert.equal(declaration(figure, 'border'), undefined);
  assert.equal(declaration(figure, 'background'), undefined);
  assert.equal(declaration(rule('.stats-panel'), 'border'), undefined);
  assert.equal(declaration(rule('.stats-panel'), 'background'), undefined);
  assert.equal(declaration(rule('.stats-panel h2'), 'font-family'), 'var(--font-display)');
  assert.equal(declaration(rule('.stats-table th'), 'text-transform'), 'uppercase');
  assert.match(read('src/components/admin/stats/StatsReport.astro'), /<dt class="admin-eyebrow">\{copy\.stats\.views\}<\/dt>/);
});
```

- [ ] **Step 2: Run to see it fail** — `node --import tsx --test tests/unit/admin-surface-tokens.test.ts` → FAIL.

- [ ] **Step 3: The report markup**

In `StatsReport.astro`, each `<dt>` becomes `<dt class="admin-eyebrow">…</dt>`. The ratio's value splits the unit: replace `percent.format(readRatio(report.totals))` with

```astro
        <>{number.format(Math.round(readRatio(report.totals) * 100))}<small class="stats-summary__unit">%</small></>
```

(`readRatio` returns a fraction; check its signature in `src/server/stats/report.ts` and keep the rounding the percent formatter did: `maximumFractionDigits: 0`.) `stats.spec.ts` asserts the third value `toContainText('—')` at zero and reads the first two by exact text; the `%` split only touches the non-zero ratio, which the spec checks with `toContainText`. Confirm by reading lines 170–210 and 320–340 of the spec before changing; if it asserts an exact `"32%"`, keep `percent.format` and drop the split.

- [ ] **Step 4: The stylesheet**

Replace these rules in `stats.css`:

```css
.stats-filters { display: flex; flex-wrap: wrap; gap: var(--space-xs) var(--space-xl); margin-block-end: 0; border-block-end: var(--rule-hair) solid var(--color-rule); }
/* Period and language are two rows of tabs on one rule, drawn like every other tab in the admin. */
.stats-segments { display: inline-flex; flex-wrap: wrap; gap: var(--space-lg); }
.stats-segments a { min-height: var(--control-height); margin-block-end: -1px; padding-inline: var(--space-3xs); border-block-end: 2px solid transparent; color: var(--color-muted); font-size: var(--text-sm); font-weight: 500; line-height: var(--control-height); text-decoration: none; }
.stats-segments a:hover { color: var(--color-ink); }
.stats-segments a:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.stats-segments a[aria-current='true'] { border-block-end-color: var(--color-accent); color: var(--color-ink); font-weight: 600; }

/* Three figures on one row, ruled above and below, a rule between: the page's lead. */
.stats-summary { display: grid; margin: var(--space-xl) 0 var(--space-xs); border-block: var(--rule-hair) solid var(--color-rule); }
.stats-summary > div { display: grid; gap: var(--space-2xs); min-inline-size: 0; padding: var(--space-lg) 0; }
.stats-summary > div + div { border-block-start: var(--rule-hair) solid var(--color-rule); }
.stats-summary dd { margin: 0; }
.stats-summary__value {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}
.stats-summary__unit { margin-inline-start: var(--space-3xs); font-size: var(--text-xl); letter-spacing: 0; }
.stats-summary__change { color: var(--color-ink-2); font-size: var(--text-sm); }
.stats-note { margin: 0 0 var(--space-xl); color: var(--color-muted); font-size: var(--text-xs); }

/* A panel is a heading in the display face and what it heads, 40px from the next. No box. */
.stats-panel { min-inline-size: 0; }
.stats-panel + .stats-panel, .stats-shares + .stats-panel, .stats-panel + .stats-shares { margin-block-start: var(--space-xl); }
.stats-panel h2 { margin: 0 0 var(--space-xs); font-family: var(--font-display); font-size: var(--text-md); font-weight: 700; letter-spacing: -0.015em; }

.stats-shares { display: grid; gap: var(--space-xl); margin-block: var(--space-xl); }
.stats-share ol { display: grid; margin: 0; padding: 0; list-style: none; }
.stats-share li { position: relative; display: flex; justify-content: space-between; gap: var(--space-sm); padding: var(--space-xs) 0; border-block-end: var(--rule-hair) solid var(--color-rule); }
/* The share as a 2px line under the label, not a tint behind the row. */
.stats-share li::before { content: ''; position: absolute; inset-block-end: -1px; inset-inline-start: 0; inline-size: var(--share); height: 2px; background: var(--color-accent); opacity: 0.6; }
.stats-share__value { color: var(--color-ink); font-variant-numeric: tabular-nums; }

.stats-table th, .stats-table td { padding: var(--space-sm) 0; border-block-end: var(--rule-hair) solid var(--color-rule); text-align: start; vertical-align: top; }
.stats-table td { padding-block: var(--space-md); }
.stats-table th { color: var(--color-muted); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
.stats-table th + th, .stats-table td + td { padding-inline-start: var(--space-md); }
.stats-articles tbody th { min-inline-size: 10rem; font-family: var(--font-display); font-size: 1.0625rem; font-weight: 700; letter-spacing: -0.01em; text-transform: none; color: var(--color-ink); }
.stats-table thead [aria-sort] a { color: var(--color-ink); }

@media (min-width: 40rem) {
  .stats-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .stats-summary > div { padding-inline: var(--space-lg); }
  .stats-summary > div:first-child { padding-inline-start: 0; }
  .stats-summary > div + div { border-block-start: 0; border-inline-start: var(--rule-hair) solid var(--color-rule); }
  .stats-shares { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

Delete the old `.stats-summary > div, .stats-panel { … border … background }` rule, the old `.stats-segments` box rules, `.stats-summary dt`, and `.stats-empty*` if any remain. Keep `.stats-chart*`, `.stats-legend*`, `.stats-numbers`, `.stats-pages`, `.stats-links`, `.stats-back`, `.stats-attribution` as they are.

- [ ] **Step 5: Run the unit tests and the stats spec**

`npm run test:unit` → PASS. `npm run test:e2e -- tests/e2e/stats.spec.ts` → PASS.

- [ ] **Step 6: Shoot and review**

`ADMIN_SHOTS=layer6 …`. `measure.json`: `stats.figure.height` between `52` and `56` at 1440. Show `stats-1440-light.png`, `stats-1440-dark.png`, `stats-375-light.png`. Wait.

- [ ] **Step 7: Commit**

`git add src/styles/stats.css src/components/admin/stats/StatsReport.astro tests/unit/admin-surface-tokens.test.ts`
Message: `feat(admin): Stats leads with a row of figures; its panels and table lose their boxes`

---

### Task 8: Cards, status, tables and the per-screen sweep

**Files:**
- Modify: `src/styles/global.css` (`.admin-status`, `.admin-story-grid .admin-story-content h2`, `.admin-story-content h2`, `.admin-page-head`, `.admin-story-panel`, `.theme-card__name`, `.plugin-card__name strong`, `.media-card` title, `.category-*` list, `.redirect-list`, `.navigation-item`, `.admin-locale`)
- Modify: `src/pages/admin/index.astro` (the card foot's timezone), `src/pages/admin/pages/index.astro` (the row foot's `admin-story-tz`)
- Modify: `src/lib/admin-i18n.ts` (`row.timezoneNote`)
- Modify: `tests/unit/admin-surface-tokens.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the final admin look; nothing downstream except Task 9's records.

- [ ] **Step 1: Copy**

`row.timezoneNote`: EN `'Times are shown in {timezone}.'`, TH `'เวลาแสดงตามเขตเวลา {timezone}'`. `admin-i18n` test → PASS.

- [ ] **Step 2: Write the failing unit tests**

```ts
test('a status is a dot and a word, with no pill behind it', () => {
  const status = ruleBody(CSS, '.admin-status');
  assert.equal(declaration(status, 'background'), undefined);
  assert.equal(declaration(status, 'border-radius'), undefined);
  assert.equal(declaration(status, 'color'), 'var(--color-ink-2)');
  assert.doesNotMatch(CSS, /\.admin-status\[data-status="published"\] \{[^}]*background/);
});

test('a card title is the display face, and the timezone is said once per list', () => {
  assert.equal(declaration(ruleBody(CSS, '.admin-story-content h2'), 'font-family'), 'var(--font-display)');
  for (const page of ['src/pages/admin/index.astro', 'src/pages/admin/pages/index.astro']) {
    const source = read(page);
    assert.match(source, /copy\.row\.timezoneNote/, `${page} does not say the timezone once`);
    assert.doesNotMatch(source, /\(\{settings\?\.timezone \?\? 'UTC'\}\)/, `${page} still says it on every card`);
  }
});

test('a table head is an eyebrow on a rule', () => {
  const wide = /@media \(min-width: 48rem\) \{\s*\.admin-page-list[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
  assert.match(wide, /\.admin-page-head \{[^}]*text-transform: uppercase/);
  assert.match(wide, /\.admin-page-head \{[^}]*letter-spacing: 0\.12em/);
  assert.equal(declaration(ruleBody(CSS, '.admin-story-panel'), 'border'), undefined, 'the page list is still boxed');
});
```

Update `a status spaces itself with margin, now that its box is painted` — the rule it checks stays, so it passes; rename the test's comment to say the margin is now for rhythm.

- [ ] **Step 3: Run to see them fail** → FAIL ×3.

- [ ] **Step 4: Status, titles, tables, timezone**

```css
.admin-status {
  display: inline-flex;
  min-height: 1.5rem;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.4;
  text-transform: capitalize;
  white-space: nowrap;
}
.admin-status::before { content: ''; flex: none; width: var(--space-xs); height: var(--space-xs); border: var(--rule-hair) solid var(--color-muted); border-radius: 50%; }
.admin-status[data-status="published"] { color: var(--color-ink); }
.admin-status[data-status="published"]::before { border-color: var(--color-green); background: var(--color-green); }
```

`.admin-story-content h2 { margin: 0 0 var(--space-xs); font-family: var(--font-display); font-size: 1.0625rem; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }` and delete `.admin-story-grid .admin-story-content h2 { font-size: var(--text-base); }`.

`.admin-story-panel { min-width: 0; }` (its `border`, `border-radius` and `background` declarations are deleted, not zeroed: the test asks for no declaration) and `.admin-story-panel > * { padding-inline: 0; }`. In the 48rem block, `.admin-page-head` gains `font-size: 0.6875rem; letter-spacing: 0.12em; text-transform: uppercase; min-height: 2.5rem;`. Rows: `.admin-story-row { padding-block: var(--space-md); }` (48px rows at one line of title).

Cards: `.theme-card__name`, `.plugin-card__name strong` and the media card's filename rule each get `font-family: var(--font-display); font-weight: 700; letter-spacing: -0.01em;`.

Timezone: in `index.astro` the card foot span loses ` ({settings?.timezone ?? 'UTC'})`; in `pages/index.astro` the `<span class="admin-story-tz">…</span>` is removed and its CSS line in the 48rem block deleted. Both pages add, as the last child of the head's first `<div>` after the subtitle: `<p class="admin-page__note">{fill(copy.row.timezoneNote, { timezone: settings?.timezone ?? 'UTC' })}</p>` (import `fill` from `admin-i18n` where missing) with `.admin-page__note { margin: var(--space-2xs) 0 0; color: var(--color-muted); font-size: var(--text-xs); }` placed after `.admin-page__head p:not(.admin-eyebrow)` so it wins on size.

- [ ] **Step 5: The per-screen sweep**

Open each of the 15 `layer6` screenshots at 1440 light and dark and fix what the shared rules missed, one commit per screen that needs its own change. Known items from reading the CSS:
- **Categories**: `.category-manager` list rows take `.admin-story-row`'s 48px rhythm and rules; the count is the plain figure from Task 3.
- **Navigation**: `.navigation-item` rows: rule between, 48px min, no panel box if one exists.
- **Redirects**: `.redirect-list` already rules its rows; `.redirect-add h2` → display face at `--text-xl` 700 like a sheet head.
- **Home slides**: `.home-slides-notice` (kept) becomes the accent-bar paragraph like `.admin-card--note`: `border: 0; border-inline-start: 3px solid var(--color-accent); border-radius: 0; background: none; padding-inline: var(--space-md) 0;`.
- **Themes / Plugins**: `.theme-card--source` and `.plugin-card--source` lose `border-style: dashed` and take the accent bar the same way.
- **Security**: `.security-add`, `.security-codes` (panels inside a card) become plain: `border: 0; padding-inline: 0;` — check the test `a passkey and an avatar…` pins their `border-radius: var(--radius-card)`; change that assertion to `undefined` with the reason.
- **System**: `.update-status` and `.admin-facts` are fine; the progress bar keeps its pill.
- **Profile**: `.profile-link` rows already rule; the avatar keeps its circle.
- **File Manager**: `.media-toolbar` keeps its row; the type chips take `.admin-post-tabs` styling only if they are links — they are buttons with `aria-pressed`; leave them pills (spec: the folder chips stay pills, and the type chips follow the tab rule set only where the markup allows).

After each fix: `npm run test:unit`.

- [ ] **Step 6: Full test run**

`npm run test:unit && npm run check && npm run test:e2e` → all PASS.

- [ ] **Step 7: Shoot and review the whole set**

`ADMIN_SHOTS=layer7 …`. Show the owner all fifteen at 1440 light, then dark, then the three phone shots they pick. Wait.

- [ ] **Step 8: Commit**

`git add src/styles/global.css src/pages/admin/index.astro src/pages/admin/pages/index.astro src/lib/admin-i18n.ts tests/unit/admin-surface-tokens.test.ts` (plus any per-screen files touched)
Message: `feat(admin): status without a pill, display titles on cards and rows, ruled tables, the timezone said once`

---

### Task 9: Records — selector diff, DESIGN.md, CHANGELOG

**Files:**
- Modify: `DESIGN.md` (Admin Surface prose; the "Do's and Don'ts" gains the three empty tiers and the no-fill-for-state rule if not there)
- Modify: `CHANGELOG.md` (Unreleased)

- [ ] **Step 1: Selector diff against the baseline**

`npm run build && node scripts/css-selector-diff.mjs --diff /private/tmp/claude-501/-Users-tom-Projects-GitHub-tome-cms/4fc75689-497d-45f6-a27f-88e083129187/scratchpad/css-before.json`

Expected removed selectors, and only these: `.admin-topbar__search`, `.admin-topbar[data-search-open] .admin-topbar__search`, `.admin-topbar__site > span`, `.admin-topbar__search-toggle` (via the compound rule), `.admin-post-filters*`, `.admin-empty__mark`, `.admin-empty__mark .icon`, `.admin-empty > div`, `.admin-empty-inline`, `.navigation-empty`, `.media-empty`, `.redirect-empty`, `.stats-empty`, `.stats-empty h2`, `.stats-empty p`, `.stats-empty-notice*`, `.admin-story-tz` (the 48rem line), `.stats-summary dt`, `.admin-tab-count` (the standalone line). Anything else removed is a regression: find its rule and restore it.

- [ ] **Step 2: DESIGN.md**

Under "Admin Surface", after the table from Task 2, add:

```markdown
**Shape.** No top bar from 64rem; the page head is the masthead (eyebrow, display title, lede,
actions on the baseline, a rule). The sidebar sits on the page surface; the active link is ink
with a 2px accent bar in the gutter. Form pages are two-column sheets separated by rules inside
a `.admin-card-stack` container 53rem or wider, one column under that. Cards remain only where
there is a picture to frame (posts, files, themes, plugins), at 8px. Empty states are three
tiers by situation: nothing yet (`.admin-empty`), nothing matches (`--filtered`), a section of a
form is empty (`--inline`). Stats leads with three figures at `--text-3xl`. A status is a dot
and a word. Selected and active states come from ink and the accent, never from a surface fill.
```

- [ ] **Step 3: CHANGELOG**

Under `## Unreleased` → `### Changed`: `- The admin reads as an editorial page: display titles under eyebrows, sheets and rules instead of boxed cards, Stats led by figures, one empty-state system, and no top bar on a desktop. The admin's post search is gone; the public themes' search sits on the category row.` (The last clause lands with Task 10; write it now, the release is one.)

- [ ] **Step 4: `node scripts/check-design-tokens.mjs` and `npm run test:unit`** → PASS.

- [ ] **Step 5: Commit**

`git add DESIGN.md CHANGELOG.md`
Message: `docs: the admin surface after the editorial refresh`

---

### Task 10: The public themes' search on the category row

**Files:**
- Modify: `src/themes/paper/Home.astro:214-236`, `src/themes/paper/theme.css:485-548`
- Modify: `src/themes/plain/Home.astro:25-40`, `src/themes/plain/theme.css:47-78`
- Test: `tests/e2e/home-search.spec.ts` (unchanged; must pass)

**Interfaces:**
- Produces: in Paper, `<div class="post-controls">` holding `<nav class="post-filter">` then `<form class="post-search">`; the submit is `<button class="post-search__submit" type="submit" aria-label={shared.search}>` with the magnifier. In Plain, `<div class="plain-controls">` with the same order.

- [ ] **Step 1: Confirm what the spec asserts, then run it red-free first**

Read `tests/e2e/home-search.spec.ts` lines 150–210 again: it finds the box by `getByRole('search').getByRole('searchbox', { name: 'Search posts' })`, the button by `getByRole('button', { name: 'Search' })`, the status by text, and asserts the box is visible on the list page. Run it now to confirm green before touching anything: `npm run test:e2e -- tests/e2e/home-search.spec.ts` → PASS.

- [ ] **Step 2: Paper markup**

Replace lines 214–236 of `paper/Home.astro` (the `<form class="post-search">` and the `{categories.length > 0 && (<nav class="post-filter">…)}`) with:

```astro
<section class="mx-auto w-full max-w-7xl px-5 py-12 sm:px-7 sm:py-16">
  <!-- What narrows the feed, on one row: the categories, and at the row's end a quiet search.
       Both are the same kind of thing, so they sit together; the search used to be a filled
       button above them, the one loud control on the page. -->
  <div class="post-controls">
    {categories.length > 0 && (
      <nav class="post-filter" aria-label={copy.categories} data-post-filter data-announce={copy.showing}>
        <ul>
          <li><a href={home} aria-current={activeCategory ? undefined : 'page'}>{copy.all}</a></li>
          {categories.map(({ name }) => (
            <li><a href={categoryHref(name)} aria-current={isCurrent(name) ? 'page' : undefined}>{name}</a></li>
          ))}
        </ul>
        <p class="sr-only" role="status" data-post-filter-status></p>
      </nav>
    )}
    <form class="post-search" role="search" method="get" action={home} data-post-search>
      <label class="sr-only" for="post-search-q">{shared.searchLabel}</label>
      <input id="post-search-q" name="q" type="search" value={query ?? ''} maxlength="100" placeholder={shared.searchLabel} autocomplete="off" enterkeyhint="search" />
      <button class="post-search__submit" type="submit" aria-label={shared.search} title={shared.search}><Icon name="search" /></button>
    </form>
  </div>
```

(the `<section>` opening tag stays where it is; only its first children change. Keep the `<!-- Everything a category changes … -->` comment and `.post-feed` below untouched.)

- [ ] **Step 3: Paper styles**

Replace the `.post-search*` rules (485–546) and the `.post-filter ul` margin:

```css
/* The controls row: categories on the left, the search at the right end. Under 40rem the
 * search takes the full width above the pills, where a thumb finds it first. */
.post-controls { display: flex; flex-wrap: wrap-reverse; align-items: center; justify-content: space-between; gap: var(--space-md) var(--space-lg); margin: 0 0 var(--space-xl); }
.post-filter { min-width: 0; }
.post-filter ul { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin: 0; padding: 0; list-style: none; }

/* The search is a pill like the categories are, with the magnifier as its button inside the
 * right end. It works with no script -- a plain GET form -- and a smaller field would make iOS
 * zoom in, so the size stays 1rem. */
.post-search { position: relative; flex: 1 1 15rem; max-width: 20rem; min-width: 0; }
@media (max-width: 39.999rem) { .post-search { flex-basis: 100%; max-width: none; } }
.post-search input {
  width: 100%;
  min-height: var(--control-height);
  padding-block: 0;
  padding-inline: var(--space-md) calc(var(--control-height) + var(--space-2xs));
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  appearance: none;
  background: var(--color-paper);
  color: var(--color-ink);
  font: inherit;
  font-size: 1rem;
  transition: border-color var(--dur-short) var(--ease-out);
}
.post-search input::placeholder { color: var(--color-placeholder); opacity: 1; }
.post-search input:hover { border-color: var(--color-rule-strong); }
.post-search input:focus-visible { border-color: var(--color-accent); outline: 0; }
.post-search__submit {
  position: absolute;
  inset-block: var(--space-2xs);
  inset-inline-end: var(--space-2xs);
  display: grid;
  aspect-ratio: 1;
  place-items: center;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: background-color var(--dur-short) var(--ease-out), color var(--dur-short) var(--ease-out);
}
.post-search__submit .icon { width: 1.125rem; height: 1.125rem; }
.post-search__submit:hover, .post-search__submit:focus-visible { background: var(--color-paper-3); color: var(--color-ink); }
.post-search__submit:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
```

Keep `.post-search__status*` as they are. Delete the old `.post-search__field*` rules. In the reduced-motion block, `.post-search input, .post-search__submit` still match — leave it.

- [ ] **Step 4: Plain**

`plain/Home.astro` 25–40 → the filter first, then the search, in one row:

```astro
  <div class="plain-controls">
    {categories.length > 0 && (
      <nav class="plain-filter" aria-label={copy.categories}>
        <a href={home} aria-current={activeCategory ? undefined : 'page'}>{copy.allPosts}</a>
        {categories.map(({ name }) => (
          <a href={`${home}?${new URLSearchParams({ category: name })}`} aria-current={activeCategory?.toLocaleLowerCase() === name.toLocaleLowerCase() ? 'page' : undefined}>{name}</a>
        ))}
      </nav>
    )}
    <form class="plain-search" role="search" method="get" action={home}>
      <label class="sr-only" for="plain-search-q">{copy.searchLabel}</label>
      <input id="plain-search-q" name="q" type="search" value={query ?? ''} maxlength="100" placeholder={copy.searchLabel} autocomplete="off" enterkeyhint="search" />
      <button type="submit">{copy.search}</button>
    </form>
  </div>
  {query && <p class="plain-search-status" role="status">{saying(copy.searchResults)} · <a href={home}>{copy.clearSearch}</a></p>}
```

`plain/theme.css`: `.plain-controls { display: flex; flex-wrap: wrap-reverse; align-items: baseline; justify-content: space-between; gap: var(--space-sm) var(--space-lg); margin-block-end: var(--space-xl); } .plain-filter { margin-block-end: 0; } .plain-search { flex: 1 1 14rem; max-width: 18rem; margin-block-end: 0; }` and keep Plain's visible text button (Plain is plain; its button is a bordered text button already).

- [ ] **Step 5: Run the spec**

`npm run test:e2e -- tests/e2e/home-search.spec.ts` → PASS on both projects. If the mobile project fails on "the box is above the list", the `wrap-reverse` order is the cause: the row wraps the search *above* the pills visually while it is after them in the DOM — the spec only checks visibility, but confirm by eye at 375.

- [ ] **Step 6: Shoot the home page**

Not covered by `admin-shots`. From the same running stack pattern, or by `npm run build && npm run preview` against a local database, screenshot `/en` at 1440 and 375 in both themes and show the owner.

- [ ] **Step 7: Commit**

`git add src/themes/paper/Home.astro src/themes/paper/theme.css src/themes/plain/Home.astro src/themes/plain/theme.css`
Message: `feat(themes): the search sits on the category row as a quiet field, not a filled button above it`

---

## Handoff

When Task 10 is committed: `npm run test:unit && npm run check && npm run test:e2e` once more on the branch, then use superpowers:finishing-a-development-branch. The branch merges into `develop`; the release (a version bump, `docs/releases/<version>.md`, cloud-init's `TOMECMS_VERSION`) is a separate step the owner starts.
