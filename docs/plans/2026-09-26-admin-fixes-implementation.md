# Admin fixes before 1.0.0: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin speaks the site's language wherever it still speaks English or Thai by default, a draft keeps the date it is planned for, the core closes a notice band as its contract says, and two small public-site and setup faults are gone.

**Architecture:** Every fix goes where all its callers pass through: the words come from `src/lib/admin-i18n.ts` (and `publicCopy` for the reader's page), the server sends codes and references rather than sentences, and the client words them in the owner's language. A draft's planned date gets a column of its own (`planned_at`, migration 026), so `published_at` keeps meaning "out, and since when" for every query that already relies on it. The notice band's close code moves from the notice plugin into the core's `NoticeScript.astro`.

**Tech Stack:** Astro 7.3.3 SSR with React 18 admin islands, Kysely 0.29 on PostgreSQL 17, zod 4.5.4, `node --test` with `tsx`, Playwright 1.63 (desktop and mobile Chromium).

**Spec:** none; the owner approved the item list in the session on 2026-09-26.

## What this fixes

Admin text that ignores the admin's language:

1. The bilingual tabs in MaintenanceForm, NavigationManager and SlidesManager open on Thai; they open on the site's default language now.
2. The System screen tells "no official release yet" (GitHub's 404, true until 1.0.0) apart from "GitHub could not be reached" and "the answer could not be used", and every message on it, the check-only line included, is admin copy in both languages. The server sends a code.
3. The suggested name of a spare Passkey is admin copy.
4. `/recovery` shows its own words for a refused code, not the server's English.
5. The library's "still used" refusal is built in the admin's language from the references the server already sends.
6. A new menu item's label starts as "Home" in the menu's own language, not in English.
7. Every dialog button is named by its caller in the admin's language (the link prompt and the upload alert, and five other callers that relied on the same English defaults).

Behaviour:

8. A draft keeps its "Publish at" date across saves and visits.
9. The editor's language chips say Scheduled for a date still to come, as the lists do.
10. The popup's default decline words and close label follow the popup's language.
11. The core closes a closable notice band, for any plugin; the notice plugin ships no browser code.
12. `scripts/bootstrap-core.mjs` runs on Windows: npm through `npm.cmd` and a shell, no Unix mode check on `.env.local`.
16. An article that opens with a video fetches the video's poster first.

## Global Constraints

- No new dependencies. Node 22.12 or later.
- Every admin string exists in `en` and `th` in `src/lib/admin-i18n.ts`, in the same order (`tests/unit/admin-i18n.test.ts` enforces it); every public string in both branches of `publicCopy` in `src/lib/i18n.ts`.
- Every Thai value that has words carries Thai characters (`tests/unit/admin-i18n.test.ts` enforces it). Thai copy is written for a Thai reader, not translated word for word.
- The admin's language is the site's `default_locale`, which every admin page passes to its island as `ownerLocale`. A component never assumes Thai or English.
- The server keeps every field its APIs return today. New information is added as a new field (a code), never by changing what an existing field means.
- Copy and documentation: no em dash (—) and no en dash (–), straight quotes, plain words.
- Repository rules: never `git stash`, `git reset --hard`, `git checkout --`, `git clean`, `git add -A` or `git add .`; stage by explicit path. Commit messages go in a file under the session scratchpad and are committed with `git commit -F <file>` in a Bash call of their own, conventional prefixes, and **no attribution lines of any kind**. A hook blocks one Bash command containing both "git commit" and a `-n` flag.
- Never touch port 4321 or the containers `tome-cms-postgres-1` and `tome-cms-seaweedfs-1`. Integration tests and e2e specs bring up their own Compose stacks on ports 55432/59000: one at a time, `uptime` first, and wait while the load is above 15.
- Gates run one at a time, in the foreground, with a 600000 ms timeout: `npm run check`, `npm run test:unit`, `npm run test:integration` (or one file: `node scripts/test-foundation.mjs <file>`), `npx playwright test <spec>`.
- The release freeze before 1.0.0 allows fixes only. Every task here is a fix; Task 5's migration exists only to keep data the product already asks the owner for.

## Files

| File | What it is for | Task |
|---|---|---|
| `src/components/admin/MaintenanceForm.tsx`, `NavigationManager.tsx`, `SlidesManager.tsx` | The first tab; the new item's label | 1 |
| `tests/e2e/maintenance.spec.ts`, `home-slides.spec.ts`, `select-in-dialog.spec.ts` | Say which tab opens; click the Thai tab where Thai is written | 1 |
| `src/server/update/releases.ts`, `src/server/update/service.ts` | Tell the three failures apart; send `reason` | 2 |
| `src/components/admin/UpdateManager.tsx` | `updateCheckMessage`, `installabilityReason` | 2 |
| `src/lib/admin-i18n.ts` | New copy | 2, 3 |
| `tests/unit/update-releases.test.ts`, `tests/unit/update-admin.test.ts` | The three failures; the words | 2 |
| `src/components/admin/SecurityManager.tsx`, `RecoveryPasskey.tsx`, `MediaLibrary.tsx`, `src/lib/media-client.ts` | Passkey name, recovery refusal, library refusal | 3 |
| `tests/unit/passkey-failure.test.ts`, `tests/unit/media-client.test.ts` | Their tests | 3 |
| `src/lib/ui-dialog.ts` and its seven unlabelled callers | Labels are required | 4 |
| `src/server/db/migrations/026_planned_dates.ts` (new), `src/server/db/migrator.ts`, `src/server/db/types.ts`, `src/types/cms.ts` | `planned_at` | 5 |
| `src/server/content/mutations.ts`, `posts.ts`, `pages.ts` | `plannedAtWrite`; the writes | 5 |
| `src/components/admin/Editor.tsx`, `PageEditor.tsx` | Seed from `planned_at`; always send the date | 5, 6 |
| `tests/integration/draft-planned-date.test.ts` (new), `tests/unit/db-migrator.test.ts`, `tests/unit/public-serialization.test.ts`, `tests/e2e/editor-blocks.spec.ts` | Its tests | 5, 6 |
| `src/server/content/posts.ts`, `pages.ts`, `src/types/cms.ts` | `published_at` on translation summaries | 6 |
| `src/layouts/BaseLayout.astro` | The popup's own words; the loader's condition | 6, 7 |
| `tests/unit/editor-rendering.test.ts`, `tests/e2e/public-plugins.spec.ts` | Chip and popup | 6, 7 |
| `src/components/NoticeScript.astro`, `src/plugins/notice/index.ts`, `src/plugins/notice/client.ts` (deleted), `website/src/content/docs/extending/plugins.md`, `website/src/content/docs/th/extending/plugins.md` | The core closes the band | 7 |
| `scripts/bootstrap-core.mjs`, `tests/unit/bootstrap-core.test.ts` | Windows | 8 |
| `src/lib/editor-content.ts`, `tests/unit/editor-rendering.test.ts` | The video's poster first | 8 |

---

### Task 1: The tabs open on the site's language, and a new item is named in its menu's

Items 1 and 6.

**Files:**
- Modify: `src/components/admin/MaintenanceForm.tsx:52`
- Modify: `src/components/admin/SlidesManager.tsx:103`
- Modify: `src/components/admin/NavigationManager.tsx:36`, `:56-57`, `:107`, `:119`
- Test: `tests/e2e/maintenance.spec.ts:240-251`, `tests/e2e/home-slides.spec.ts:146-149` and `:209-210`, `tests/e2e/select-in-dialog.spec.ts:300-302`

**Interfaces:**
- Consumes: `ownerLocale?: PostLocale | null`, already a prop of all three components; `adminCopy(locale)` and `copy.navigation.home` (`'Home'` / `'หน้าแรก'`).
- Produces: nothing new for other tasks.

Every seeded e2e site here has `default_locale` `'en'`, so the English tab is the one that must open. The label decision for item 6: a menu item's label is read by the readers of that menu, and the menu has a language of its own (the tab). So the label starts as `adminCopy(locale).navigation.home`, the menu's language, not `copy.navigation.home`, the admin's. In a Thai admin editing the Thai menu, which is now the tab that opens, both give "หน้าแรก".

- [ ] **Step 1: Write the failing e2e assertions**

In `tests/e2e/maintenance.spec.ts`, replace:

```ts
  await page.getByRole('radio', { name: /^Countdown/ }).check();
  await page.getByLabel('Heading', { exact: true }).fill('ปิดปรับปรุงระบบ');
```

with:

```ts
  await expect(page.getByRole('tab', { name: 'English' }), 'the words open on the site’s own language')
    .toHaveAttribute('aria-selected', 'true');
  await page.getByRole('radio', { name: /^Countdown/ }).check();
  await page.getByRole('tab', { name: 'ไทย' }).click();
  await page.getByLabel('Heading', { exact: true }).fill('ปิดปรับปรุงระบบ');
```

In `tests/e2e/home-slides.spec.ts`, replace:

```ts
  await expect(page.getByText('once the theme’s hero is set to Your slides'), 'the hero shows slides, so nothing warns').toHaveCount(0);
  await page.getByRole('tab', { name: 'ไทย' }).click();
```

with:

```ts
  await expect(page.getByText('once the theme’s hero is set to Your slides'), 'the hero shows slides, so nothing warns').toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'English' }), 'the slides open on the site’s own language')
    .toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'ไทย' }).click();
```

and replace:

```ts
  // Reordered by keyboard alone, and the home page follows once it is saved.
  await page.goto(`${origin}/admin/slides`);
```

with:

```ts
  // Reordered by keyboard alone, and the home page follows once it is saved.
  await page.goto(`${origin}/admin/slides`);
  await page.getByRole('tab', { name: 'ไทย' }).click();
```

In `tests/e2e/select-in-dialog.spec.ts`, in the test "a menu link opens in a new tab only when its owner asked it to", replace:

```ts
  await page.goto(`${origin}/admin/navigation`);
  const dialog = page.locator('dialog.navigation-dialog');
```

with:

```ts
  await page.goto(`${origin}/admin/navigation`);
  const dialog = page.locator('dialog.navigation-dialog');
  const label = dialog.getByRole('textbox', { name: 'Label' });

  // The menu opens on the site's own language, and a new item is named in the menu's.
  await expect(page.getByRole('tab', { name: 'English' }), 'the site is English, so its menu comes first')
    .toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /Add item/i }).first().click();
  await expect(label).toHaveValue('Home');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden' });
  // The rest of this test reads the Thai home page, so it builds the Thai menu.
  await page.getByRole('tab', { name: 'ไทย' }).click();
  await page.getByRole('button', { name: /Add item/i }).first().click();
  await expect(label, 'a Thai menu names its home in Thai').toHaveValue('หน้าแรก');
  await dialog.getByRole('radio', { name: 'Page' }).check();
  await dialog.getByRole('radio', { name: 'Home' }).check();
  await expect(label, 'and again after Home is chosen back').toHaveValue('หน้าแรก');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden' });
```

- [ ] **Step 2: Run them and see them fail**

Run, one at a time, `uptime` before each:
`npx playwright test tests/e2e/maintenance.spec.ts -g "writes the page"`
`npx playwright test tests/e2e/home-slides.spec.ts`
`npx playwright test tests/e2e/select-in-dialog.spec.ts -g "new tab only"`

Expected: each FAILS on its new `aria-selected` assertion ("the words open on the site’s own language", "the slides open on the site’s own language", "the site is English, so its menu comes first"): the tab that opens is still ไทย.

- [ ] **Step 3: Open each on the site's language**

In `src/components/admin/MaintenanceForm.tsx:52`, `src/components/admin/SlidesManager.tsx:103` and `src/components/admin/NavigationManager.tsx:36`, replace:

```tsx
  const [locale, setLocale] = useState<PageLocale>('th');
```

with:

```tsx
  // The site's own language first; English when it is not known, as the admin's words are.
  const [locale, setLocale] = useState<PageLocale>(ownerLocale ?? 'en');
```

- [ ] **Step 4: Name a new item in its menu's language**

In `src/components/admin/NavigationManager.tsx`, replace:

```tsx
  const key: MenuKey = `${location}:${locale}`;
  const items = menus[key];
```

with:

```tsx
  const key: MenuKey = `${location}:${locale}`;
  const items = menus[key];
  // An item's label is read by that menu's readers, so it starts in the menu's language.
  const homeLabel = adminCopy(locale).navigation.home;
```

In `openAdd`, replace `    setLabel('Home');` with `    setLabel(homeLabel);`.

In `selectKind`, replace:

```tsx
    setLabel(next === 'home' ? 'Home' : next === 'page' ? availablePages.find((page) => page.id === pageId)?.title ?? '' : '');
```

with:

```tsx
    setLabel(next === 'home' ? homeLabel : next === 'page' ? availablePages.find((page) => page.id === pageId)?.title ?? '' : '');
```

- [ ] **Step 5: Run the three specs and see them pass**

Run the three commands from Step 2 again, one at a time, `uptime` first.
Expected: PASS. `select-in-dialog.spec.ts` skips the mobile project; the other two run where they ran before.

- [ ] **Step 6: Run the gates**

Run, one at a time: `npm run check`, `npm run test:unit`, then `npx playwright test tests/e2e/overlay-motion.spec.ts -g "menu dialog"` (it opens the navigation and slides screens; the tab they open on must not matter to it).
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/MaintenanceForm.tsx src/components/admin/SlidesManager.tsx src/components/admin/NavigationManager.tsx tests/e2e/maintenance.spec.ts tests/e2e/home-slides.spec.ts tests/e2e/select-in-dialog.spec.ts
```

Message:

```text
fix(admin): the language tabs open on the site's own language

Maintenance, Navigation and Home slides opened on Thai whatever the
site's language was. They open on the site's default language now. A
new menu item's label starts as Home in the menu's own language, where
it used to reset to English.
```

---

### Task 2: The System screen says why a check found nothing, in the owner's language

Item 2.

**Files:**
- Modify: `src/server/update/releases.ts` (two error classes; `fetchBytes` at `:72-85`)
- Modify: `src/server/update/service.ts` (`UpdateCheck` at `:9-15`; the failure branch at `:57-63`)
- Modify: `src/components/admin/UpdateManager.tsx` (the `UpdateCheck` type at `:12-21`; two exported helpers; `:202-204` and `:246`)
- Modify: `src/lib/admin-i18n.ts` (`updates`, both catalogues)
- Test: `tests/unit/update-releases.test.ts`, `tests/unit/update-admin.test.ts`

**Interfaces:**
- Produces, in `src/server/update/releases.ts`: `class NoOfficialReleaseError extends Error`, `class ReleaseUnreachableError extends Error` (`constructor(detail: string)`).
- Produces, in `src/server/update/service.ts`: `type UpdateUnavailableReason = 'no-release' | 'unreachable' | 'unusable'`; `UpdateCheck.reason?: UpdateUnavailableReason`, present only when `availability` is `'unavailable'` and nothing was cached.
- Produces, in `src/components/admin/UpdateManager.tsx`: `updateCheckMessage(copy: AdminCopy, check: Pick<UpdateCheck, 'availability' | 'latest' | 'reason'>): string` and `installabilityReason(copy: AdminCopy, check: Pick<UpdateCheck, 'installability' | 'updateMode'> | null): string`.
- Produces, in `src/lib/admin-i18n.ts` `updates`: `manualTransitionRequired`, `noRelease`, `noReleaseLabel`, `releaseUnreachable`, `releaseUnusable`, `upToDate`, `versionAvailable` (`{version}`).

The API keeps every field. `message` stays English API text for any other caller (today only `UpdateManager` reads it, and stops); `installability.reason` stays as the server writes it (`tests/unit/update-admin.test.ts` and `tests/operations/managed-update.test.ts:108` read it). The screen words both from codes it already has (`availability`, `updateMode`) and the new `reason`. The managed updater's own reasons (`src/server/update/updater-client.ts:62-83`) stay English: managed installs start at 1.0.0 and are outside this list.

How a failure is classed: a 404 from `releases/latest` is `no-release`; a fetch that throws (no network, the 5 second timeout) or any other error status is `unreachable`; everything else that fails after GitHub answered (an invalid release, a digest mismatch, a manifest that does not parse or does not match its tag, a response over 512 KB) is `unusable`.

- [ ] **Step 1: Write the server's failing test**

Add to `tests/unit/update-releases.test.ts`:

```ts
test('a check that finds nothing says why: no release yet, GitHub out of reach, or an answer it could not use', async () => {
  const check = (fetcher: typeof fetch) => refreshUpdateStatus({
    cache: { value: null, etag: null, expiresAt: 0 },
    fetcher,
    now: () => new Date('2026-09-20T10:00:00.000Z'),
  });

  const none = await check(async () => Response.json({ message: 'Not Found' }, { status: 404 }));
  assert.equal(none.availability, 'unavailable');
  assert.equal(none.reason, 'no-release', 'a 404 from releases/latest is a repository with no release yet');

  const offline = await check(async () => { throw new TypeError('fetch failed'); });
  assert.equal(offline.reason, 'unreachable', 'no network');
  const late = await check(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  assert.equal(late.reason, 'unreachable', 'the deadline passed');
  const refused = await check(async () => new Response(null, { status: 503 }));
  assert.equal(refused.reason, 'unreachable', 'GitHub answering with an error is GitHub not answering');

  const forged = await check(releaseFetch({
    ...validRelease,
    assets: [{ ...validRelease.assets[0], digest: `sha256:${'f'.repeat(64)}` }],
  }));
  assert.equal(forged.reason, 'unusable', 'a digest that does not match');
  const mismatched = await check(releaseFetch(validRelease, { ...validManifest, version: '1.0.2' }));
  assert.equal(mismatched.reason, 'unusable', 'a manifest that is not the tag’s');

  const found = await check(releaseFetch(validRelease));
  assert.equal(found.reason, undefined, 'an answer needs no reason');
  assert.equal(none.message, 'Update check unavailable.', 'the API’s own text is unchanged for any other caller');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test tests/unit/update-releases.test.ts`
Expected: FAIL on `none.reason`: `undefined !== 'no-release'`.

- [ ] **Step 3: Tell the failures apart where the requests are made**

In `src/server/update/releases.ts`, after `class ReleaseNotModifiedError`, add:

```ts
/** GitHub answers 404 for releases/latest until a first release exists: there is nothing to check yet. */
export class NoOfficialReleaseError extends Error {
  constructor() {
    super('No official release has been published');
    this.name = 'NoOfficialReleaseError';
  }
}

/** No answer worth reading: no network, the deadline, or GitHub answering with an error. */
export class ReleaseUnreachableError extends Error {
  constructor(detail: string) {
    super(`Official release request failed (${detail})`);
    this.name = 'ReleaseUnreachableError';
  }
}
```

Replace `fetchBytes` with:

```ts
async function fetchBytes(fetcher: typeof fetch, url: string, etag?: string, allowNotModified = false): Promise<{ bytes: Uint8Array; etag: string | null }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (etag) headers['If-None-Match'] = etag;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new ReleaseUnreachableError(error instanceof Error ? error.name : 'network');
  }
  if (allowNotModified && response.status === 304) throw new ReleaseNotModifiedError();
  if (url === LATEST_RELEASE_URL && response.status === 404) throw new NoOfficialReleaseError();
  if (!response.ok) throw new ReleaseUnreachableError(String(response.status));
  return { bytes: await boundedBytes(response), etag: response.headers.get('etag') };
}
```

- [ ] **Step 4: Send the reason with an unavailable check**

In `src/server/update/service.ts`, change the import to:

```ts
import {
  fetchLatestRelease,
  NoOfficialReleaseError,
  ReleaseNotModifiedError,
  ReleaseUnreachableError,
  type LatestRelease,
} from './releases.js';
```

Replace the `UpdateAvailability` line and the `UpdateCheck` interface with:

```ts
export type UpdateAvailability = 'current' | 'available' | 'manual-transition' | 'unavailable';

/** Why a check has no answer. A code, so the admin says it in the owner's language. */
export type UpdateUnavailableReason = 'no-release' | 'unreachable' | 'unusable';

export interface UpdateCheck {
  checkedAt: string;
  currentVersion: string;
  availability: UpdateAvailability;
  latest: LatestRelease | null;
  /** English, for API callers. The admin words the check from `availability` and `reason`. */
  message: string;
  /** Only on an unavailable check that had nothing cached to fall back on. */
  reason?: UpdateUnavailableReason;
}
```

In `refreshUpdateStatus`, replace:

```ts
    return activeCache.value ?? {
      checkedAt,
      currentVersion,
      availability: 'unavailable',
      latest: null,
      message: 'Update check unavailable.',
    };
```

with:

```ts
    return activeCache.value ?? {
      checkedAt,
      currentVersion,
      availability: 'unavailable',
      latest: null,
      message: 'Update check unavailable.',
      reason: unavailableReason(error),
    };
```

and add, after `refreshUpdateStatus`:

```ts
function unavailableReason(error: unknown): UpdateUnavailableReason {
  if (error instanceof NoOfficialReleaseError) return 'no-release';
  if (error instanceof ReleaseUnreachableError) return 'unreachable';
  // GitHub answered, and the answer failed a check: the release, its digest or its manifest.
  return 'unusable';
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `node --import tsx --test tests/unit/update-releases.test.ts`
Expected: PASS, every test in the file, the cache test included (its 503 still falls back to the cached value).

- [ ] **Step 6: Write the screen's failing test**

In `tests/unit/update-admin.test.ts`, change the first two imports to:

```ts
import { formatPublishedAt, installabilityReason, updateCheckMessage } from '../../src/components/admin/UpdateManager.tsx';
import { adminCopy, fill } from '../../src/lib/admin-i18n.js';
```

and add:

```ts
test('every outcome of a check is said in the owner’s language, from the code the server sends', () => {
  const latest = { publishedAt: '2026-09-20T10:00:00Z', manifest: { version: '1.0.1', releaseNotesUrl: '' } };
  for (const locale of ['en', 'th'] as const) {
    const copy = adminCopy(locale);
    assert.equal(updateCheckMessage(copy, { availability: 'current', latest }), copy.updates.upToDate);
    assert.equal(updateCheckMessage(copy, { availability: 'available', latest }), fill(copy.updates.versionAvailable, { version: '1.0.1' }));
    assert.equal(updateCheckMessage(copy, { availability: 'manual-transition', latest }), copy.updates.manualTransitionRequired);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null, reason: 'no-release' }), copy.updates.noRelease);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null, reason: 'unreachable' }), copy.updates.releaseUnreachable);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null, reason: 'unusable' }), copy.updates.releaseUnusable);
    assert.equal(updateCheckMessage(copy, { availability: 'unavailable', latest: null }), copy.updates.updateCheckUnavailable,
      'a server that sends no reason still gets a sentence');

    const checkOnly = { installability: getUpdateInstallability('check-only'), updateMode: 'check-only' as const };
    assert.equal(installabilityReason(copy, checkOnly), copy.updates.checkOnly, 'the server’s English line is not shown');
    assert.equal(installabilityReason(copy, null), copy.updates.checkOnly, 'nor before the first answer');
  }
  const th = adminCopy('th').updates;
  assert.equal(new Set([th.noRelease, th.releaseUnreachable, th.releaseUnusable]).size, 3, 'three causes, three sentences');
});
```

- [ ] **Step 7: Run it and see it fail**

Run: `node --import tsx --test tests/unit/update-admin.test.ts`
Expected: FAIL with `TypeError: updateCheckMessage is not a function`.

- [ ] **Step 8: Add the words**

In `src/lib/admin-i18n.ts`, in `en.updates`:

After `    manualTransition: 'Manual updater upgrade required',` add:

```ts
    manualTransitionRequired: 'A manual transition to TomeCMS 1.0.0 is required.',
```

After `    noPasskey: 'No Passkey was accepted. Verify a Passkey and try again.',` add:

```ts
    noRelease: 'No official release has been published yet, so there is nothing to compare with.',
    noReleaseLabel: 'No release yet',
```

After `    releaseAvailability: 'Release availability:',` add:

```ts
    releaseUnreachable: 'GitHub could not be reached, or did not answer. Try again later.',
    releaseUnusable: 'The latest release could not be verified, so it is not offered.',
```

After `    updateRequestUnavailable: 'Update request unavailable.',` add:

```ts
    upToDate: 'TomeCMS is up to date.',
```

After `    verifying: 'Verifying…',` add:

```ts
    versionAvailable: 'TomeCMS {version} is available.',
```

In `th.updates`, at the same five places:

After `    manualTransition: 'ต้องอัปเกรดตัวอัปเดตด้วยตนเองก่อน',` add:

```ts
    manualTransitionRequired: 'ต้องย้ายไปใช้ TomeCMS 1.0.0 ด้วยตนเอง',
```

After `    noPasskey: 'ไม่มี Passkey ที่ผ่านการตรวจสอบ กรุณายืนยันด้วย Passkey แล้วลองอีกครั้ง',` add:

```ts
    noRelease: 'ยังไม่มีการเผยแพร่เวอร์ชันทางการ จึงยังไม่มีเวอร์ชันให้เทียบ',
    noReleaseLabel: 'ยังไม่มีเวอร์ชันทางการ',
```

After `    releaseAvailability: 'สถานะเวอร์ชัน:',` add:

```ts
    releaseUnreachable: 'ติดต่อ GitHub ไม่ได้ หรือ GitHub ไม่ตอบกลับ กรุณาลองใหม่ภายหลัง',
    releaseUnusable: 'ตรวจสอบความถูกต้องของเวอร์ชันล่าสุดไม่ผ่าน จึงไม่เสนอให้อัปเดต',
```

After `    updateRequestUnavailable: 'ส่งคำขออัปเดตไม่ได้',` add:

```ts
    upToDate: 'TomeCMS เป็นเวอร์ชันล่าสุดแล้ว',
```

After `    verifying: 'กำลังตรวจสอบความถูกต้อง…',` add:

```ts
    versionAvailable: 'มี TomeCMS เวอร์ชัน {version} ให้อัปเดตแล้ว',
```

- [ ] **Step 9: Word the check on the screen**

In `src/components/admin/UpdateManager.tsx`, after `import type { UpdaterStatus } from '../../server/update/updater-client';` add:

```tsx
import type { UpdateUnavailableReason } from '../../server/update/service';
```

In `type UpdateCheck`, after `  message: string;` add:

```tsx
  reason?: UpdateUnavailableReason;
```

After `availabilityLabels`, add:

```tsx
/** What the check found, in the owner's language. The server names the case; the words are the admin's. */
export function updateCheckMessage(copy: AdminCopy, check: Pick<UpdateCheck, 'availability' | 'latest' | 'reason'>): string {
  if (check.availability === 'current') return copy.updates.upToDate;
  if (check.availability === 'available') return fill(copy.updates.versionAvailable, { version: check.latest?.manifest.version ?? '' });
  if (check.availability === 'manual-transition') return copy.updates.manualTransitionRequired;
  if (check.reason === 'no-release') return copy.updates.noRelease;
  if (check.reason === 'unreachable') return copy.updates.releaseUnreachable;
  if (check.reason === 'unusable') return copy.updates.releaseUnusable;
  return copy.updates.updateCheckUnavailable;
}

/**
 * Why nothing installs here. Check-only is this installation's own setting, so it is said in
 * the owner's words; a managed installation's reasons are the updater's own.
 */
export function installabilityReason(copy: AdminCopy, check: Pick<UpdateCheck, 'installability' | 'updateMode'> | null): string {
  return check?.updateMode === 'managed' ? check.installability.reason : copy.updates.checkOnly;
}
```

Replace:

```tsx
  const message = busy ? copy.updates.checkingForUpdates : error || check?.message || copy.updates.updateCheckUnavailable;
  const availabilityLabel = busy ? copy.updates.checkingForUpdates : availabilityLabels(copy)[availability === 'checking' ? 'unavailable' : availability];
```

with:

```tsx
  const message = busy ? copy.updates.checkingForUpdates
    : error || (check ? updateCheckMessage(copy, check) : copy.updates.updateCheckUnavailable);
  // No release yet is not a failed check, and the label says so.
  const availabilityLabel = busy ? copy.updates.checkingForUpdates
    : !error && check?.reason === 'no-release' ? copy.updates.noReleaseLabel
    : availabilityLabels(copy)[availability === 'checking' ? 'unavailable' : availability];
```

Replace `          <p>{installability.reason}</p>` with:

```tsx
          <p>{installabilityReason(copy, check)}</p>
```

- [ ] **Step 10: Run both tests and see them pass**

Run: `node --import tsx --test tests/unit/update-releases.test.ts tests/unit/update-admin.test.ts tests/unit/admin-i18n.test.ts`
Expected: PASS. `admin-i18n.test.ts` checks the seven keys sit in the same order in both catalogues and the Thai ones carry Thai.

- [ ] **Step 11: Run the gates**

Run, one at a time: `npm run check`, `npm run test:unit`.
Expected: both pass. No e2e spec opens the System screen.

- [ ] **Step 12: Commit**

```bash
git add src/server/update/releases.ts src/server/update/service.ts src/components/admin/UpdateManager.tsx src/lib/admin-i18n.ts tests/unit/update-releases.test.ts tests/unit/update-admin.test.ts
```

Message:

```text
fix(updates): the System screen says why a check found nothing

GitHub answers 404 for the latest release until one is published, and
that read as "Update check unavailable." like any failure. A check now
sends a reason code: no release yet, GitHub out of reach, or an answer
that could not be verified. The screen words every outcome, and the
check-only line, from admin copy in the owner's language. The API keeps
its English message for any other caller.
```

---

### Task 3: Three server messages, said in the admin's language

Items 3, 4 and 5.

**Files:**
- Modify: `src/components/admin/SecurityManager.tsx:56`
- Modify: `src/components/admin/RecoveryPasskey.tsx:94-97`
- Modify: `src/lib/media-client.ts` (import at `:1`; new export after `uploadFailureText`)
- Modify: `src/components/admin/MediaLibrary.tsx` (import at `:3-15`; `:374`)
- Modify: `src/lib/admin-i18n.ts` (`security.spareName`, `media.stillUsedMany`, `media.stillUsedOne`)
- Test: `tests/unit/passkey-failure.test.ts`, `tests/unit/media-client.test.ts`

**Interfaces:**
- Consumes: `describePasskeyFailure(value, copy, fallback, unauthorized)` from `src/lib/passkey-failure.ts`, which already maps 403, 429 and 5xx to admin copy; `MediaReferences.counts` from `src/types/cms.ts:326-334`.
- Produces: `stillUsedText(references: MediaReferences, copy: AdminCopy): string` in `src/lib/media-client.ts`; admin copy keys `security.spareName`, `media.stillUsedMany` (`{count}`), `media.stillUsedOne`.

`/recovery` already knows its language (`src/pages/recovery.astro` passes `ownerLocale` to `RecoveryPasskey`). `/api/recovery/start` answers 400 for a wrong or malformed code, 403 for a foreign origin, 429 for too many tries and 500 otherwise, so the status alone says which sentence to show; the English `detail` stays in the problem body for API callers. The library's 409 body already carries `references`; the English `error` stays in it for API callers, and the e2e specs that read "still used" on English sites keep passing on the new English copy.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/passkey-failure.test.ts`:

```ts
test('a spare Passkey is named in the owner’s language until the owner names it', () => {
  const security = readFileSync(new URL('../../src/components/admin/SecurityManager.tsx', import.meta.url), 'utf8');
  assert.match(security, /useState\(copy\.security\.spareName\)/);
  assert.doesNotMatch(security, /'Spare Passkey'/);
  assert.equal(adminCopy('en').security.spareName, 'Spare Passkey');
  assert.equal(adminCopy('th').security.spareName, 'Passkey สำรอง');
});

test('a recovery code that starts nothing is refused in the owner’s words, not the server’s', () => {
  const recovery = readFileSync(new URL('../../src/components/admin/RecoveryPasskey.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(recovery, /payload\.detail/, 'the server’s English detail is not shown');
  assert.match(recovery, /describePasskeyFailure\(\{ status: response\.status \}, copy, copy\.security\.recoveryNotStarted, copy\.security\.recoveryNotStarted\)/);
  const th = adminCopy('th');
  const refused = (status: number) => describePasskeyFailure({ status }, th, th.security.recoveryNotStarted, th.security.recoveryNotStarted);
  assert.equal(refused(400), th.security.recoveryNotStarted, 'a wrong code');
  assert.equal(refused(429), th.auth.tooManyAttempts, 'too many tries');
  assert.equal(refused(500), th.auth.serverError, 'the server');
});
```

In `tests/unit/media-client.test.ts`, add `import { readFileSync } from 'node:fs';` after the `node:assert/strict` import, add `stillUsedText` to the `media-client` import, and add:

```ts
test('a file the library keeps is explained in the owner’s language, from the places the server named', () => {
  const references = {
    counts: { maintenance: 0, pageContent: 1, plugins: 0, postContent: 1, postCovers: 0, profile: 0, slides: 0 },
    maintenance: false, pages: [], plugins: [], posts: [], profile: false, slides: [],
  };
  const once = { ...references, counts: { ...references.counts, pageContent: 0 } };
  assert.equal(stillUsedText(references, adminCopy('en')), 'This file is still used in 2 locations.');
  assert.equal(stillUsedText(once, adminCopy('en')), 'This file is still used in 1 location.');
  assert.equal(stillUsedText(references, adminCopy('th')), 'ไฟล์นี้ยังถูกใช้อยู่ 2 แห่ง');
  assert.equal(stillUsedText(once, adminCopy('th')), 'ไฟล์นี้ยังถูกใช้อยู่ 1 แห่ง');
  const library = readFileSync(new URL('../../src/components/admin/MediaLibrary.tsx', import.meta.url), 'utf8');
  assert.match(library, /stillUsedText\(deleteFailure\.references, copy\)/, 'the library shows it, not the server’s sentence');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --import tsx --test tests/unit/passkey-failure.test.ts tests/unit/media-client.test.ts`
Expected: FAIL: the SecurityManager source does not match `useState\(copy\.security\.spareName\)`; the RecoveryPasskey source still matches `payload\.detail`; `stillUsedText is not a function`.

- [ ] **Step 3: Add the words**

In `src/lib/admin-i18n.ts`:

After `    spareAdded: 'Spare Passkey added.',` (in `en.security`) add:

```ts
    spareName: 'Spare Passkey',
```

After `    spareAdded: 'เพิ่ม Passkey สำรองแล้ว',` (in `th.security`) add:

```ts
    spareName: 'Passkey สำรอง',
```

After `    spreadsheets: 'Spreadsheets',` (in `en.media`) add:

```ts
    stillUsedMany: 'This file is still used in {count} locations.',
    stillUsedOne: 'This file is still used in 1 location.',
```

After `    spreadsheets: 'ตารางคำนวณ',` (in `th.media`) add:

```ts
    stillUsedMany: 'ไฟล์นี้ยังถูกใช้อยู่ {count} แห่ง',
    stillUsedOne: 'ไฟล์นี้ยังถูกใช้อยู่ 1 แห่ง',
```

- [ ] **Step 4: Name the spare in the owner's language**

In `src/components/admin/SecurityManager.tsx:56`, replace:

```tsx
  const [newName, setNewName] = useState('Spare Passkey');
```

with:

```tsx
  const [newName, setNewName] = useState(copy.security.spareName);
```

- [ ] **Step 5: Word the recovery refusal on the page**

In `src/components/admin/RecoveryPasskey.tsx`, replace:

```tsx
      if (!response.ok || !nextContext) {
        setError(typeof payload.detail === 'string' ? payload.detail : copy.security.recoveryNotStarted);
        return;
      }
```

with:

```tsx
      if (!response.ok || !nextContext) {
        // The status says which failure it was; the server's detail is English for API callers.
        setError(describePasskeyFailure({ status: response.status }, copy, copy.security.recoveryNotStarted, copy.security.recoveryNotStarted));
        return;
      }
```

- [ ] **Step 6: Build the library's refusal from its references**

In `src/lib/media-client.ts`, replace `import type { AdminCopy } from './admin-i18n';` with:

```ts
import { fill, type AdminCopy } from './admin-i18n';
```

After `uploadFailureText`, add:

```ts
/** Why the library kept a file, in the owner's language, counted from the places the server named. */
export function stillUsedText(references: MediaReferences, copy: AdminCopy): string {
  const count = Object.values(references.counts).reduce((total, places) => total + places, 0);
  return count === 1 ? copy.media.stillUsedOne : fill(copy.media.stillUsedMany, { count });
}
```

In `src/components/admin/MediaLibrary.tsx`, add `stillUsedText,` to the `../../lib/media-client` import (after `saveMediaDraft,`), and replace:

```tsx
        setDeleteError(errorMessage(deleteFailure, copy));
```

with:

```tsx
        setDeleteError(deleteFailure instanceof MediaRequestError && deleteFailure.references
          ? stillUsedText(deleteFailure.references, copy)
          : errorMessage(deleteFailure, copy));
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `node --import tsx --test tests/unit/passkey-failure.test.ts tests/unit/media-client.test.ts tests/unit/admin-i18n.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the gates**

Run, one at a time, `uptime` before each spec: `npm run check`, `npm run test:unit`, `npx playwright test tests/e2e/home-slides.spec.ts`, `npx playwright test tests/e2e/editor-blocks.spec.ts -g "a file goes into an article"`.
Expected: all pass; both specs still find "still used" in the refusal on their English sites.

- [ ] **Step 9: Commit**

```bash
git add src/lib/admin-i18n.ts src/components/admin/SecurityManager.tsx src/components/admin/RecoveryPasskey.tsx src/lib/media-client.ts src/components/admin/MediaLibrary.tsx tests/unit/passkey-failure.test.ts tests/unit/media-client.test.ts
```

Message:

```text
fix(admin): three server sentences said in the owner's language

A spare Passkey's suggested name is admin copy. The recovery page words
a refused code from the response's status instead of showing the
server's English detail. The library says a file is still used, and how
many times, from the references the server already sends. The server's
own text stays in each response for API callers.
```

---

### Task 4: Every dialog button is named by its caller

Item 7.

**Files:**
- Modify: `src/lib/ui-dialog.ts:164-179` (the four exported signatures)
- Modify: `src/components/admin/DocumentCanvas.tsx:182-189`, `src/components/admin/ImageUploader.ts:14-17`
- Modify: `src/components/admin/MediaLibrary.tsx:280-285`, `:349-354`; `src/components/admin/CategoryManager.tsx:107-113`; `src/components/admin/UpdateManager.tsx:149-152`
- Modify: `src/pages/admin/index.astro:136`, `:243-248`; `src/pages/admin/pages/index.astro:80`, `:190-195`

**Interfaces:**
- Consumes: `copy.shell.cancel` (`'Cancel'` / `'ยกเลิก'`) and `copy.shell.close` (`'Close'` / `'ปิด'`), both in `src/lib/admin-i18n.ts` `shell`; the pattern already in `src/components/admin/editor/video-insert.ts:63-80`.
- Produces: `alertUi(options: DialogOptions & { confirmLabel: string })`, `confirmUi(options: Labelled<DialogOptions>)`, `promptUi(options: Labelled<PromptOptions>)`, `promptWithToggleUi(options: Labelled<ToggledPromptOptions>)`, where `Labelled<T> = T & { cancelLabel: string; confirmLabel: string }`.

The owner listed two callers. Reading every caller found five more that fall into the same English defaults: the two delete confirmations in the library, the category delete, the post and page list deletes (their Cancel), and the update install confirmation. Making the labels required in the types fixes all seven and stops the next one at `astro check`. The install confirmation's title and message stay English: that flow is the managed updater's, which starts at 1.0.0.

- [ ] **Step 1: Make the labels required**

In `src/lib/ui-dialog.ts`, replace the four exported functions with:

```ts
/** Every button is named by its caller, in the admin's language: there is no English to fall back on. */
type Labelled<T> = T & { cancelLabel: string; confirmLabel: string };

export async function alertUi(options: DialogOptions & { confirmLabel: string }) {
  await openDialog('alert', options);
}

export async function confirmUi(options: Labelled<DialogOptions>) {
  return (await openDialog('confirm', options)) !== null;
}

export async function promptUi(options: Labelled<PromptOptions>) {
  return (await openDialog('prompt', options))?.value ?? null;
}

/** A prompt with one checkbox under its field: what was typed, and whether the box was ticked. */
export function promptWithToggleUi(options: Labelled<ToggledPromptOptions>) {
  return openDialog('prompt', options);
}
```

- [ ] **Step 2: Run the type check and see it fail**

Run: `npx astro check`
Expected: FAIL with errors that `cancelLabel` or `confirmLabel` is missing, in `DocumentCanvas.tsx`, `ImageUploader.ts`, `MediaLibrary.tsx` (twice), `CategoryManager.tsx` and `UpdateManager.tsx`. It may also report the scripts of `src/pages/admin/index.astro` and `src/pages/admin/pages/index.astro`; fix those in Step 3 either way.

- [ ] **Step 3: Name every button**

`src/components/admin/DocumentCanvas.tsx`, in the `promptWithToggleUi` call, after `          confirmLabel: copy.blocks.applyLink,` add:

```tsx
          cancelLabel: copy.shell.cancel,
```

`src/components/admin/ImageUploader.ts`, replace:

```ts
  const failed = (error: unknown) => void alertUi({
    title: copy.media.imageUploadFailed,
```

with:

```ts
  const failed = (error: unknown) => void alertUi({
    confirmLabel: copy.shell.close,
    title: copy.media.imageUploadFailed,
```

`src/components/admin/MediaLibrary.tsx`, after `      confirmLabel: copy.media.deleteFolder,` add `      cancelLabel: copy.shell.cancel,`, and after `        confirmLabel: copy.media.deleteFile,` add `        cancelLabel: copy.shell.cancel,`.

`src/components/admin/CategoryManager.tsx`, after `      confirmLabel: copy.categories.delete,` add:

```tsx
      cancelLabel: copy.shell.cancel,
```

`src/components/admin/UpdateManager.tsx`, replace:

```tsx
        title: `Install TomeCMS ${version}?`, confirmLabel: `Install ${version}`,
```

with:

```tsx
        title: `Install TomeCMS ${version}?`, confirmLabel: `Install ${version}`, cancelLabel: copy.shell.cancel,
```

`src/pages/admin/index.astro:136` and `src/pages/admin/pages/index.astro:80`: in the `data-admin-posts` and `data-admin-pages` elements, insert ` data-copy-cancel={copy.shell.cancel}` immediately before ` data-copy-delete={copy.row.delete}`. In each file's `confirmUi` call, after `      confirmLabel: copy.copyDelete ?? 'Delete',` add:

```ts
      cancelLabel: copy.copyCancel ?? 'Cancel',
```

(The fallback matches `AdminShell.astro:305`: a dataset value is typed as possibly absent, and the attribute is always rendered.)

- [ ] **Step 4: Run the type check and see it pass**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 5: Run the gates**

Run, one at a time: `npm run check`, `npm run test:unit`.
Expected: both pass. No e2e spec asserts these buttons' words; `overlay-motion.spec.ts` opens only the sign-out confirmation, which already passed its labels.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui-dialog.ts src/components/admin/DocumentCanvas.tsx src/components/admin/ImageUploader.ts src/components/admin/MediaLibrary.tsx src/components/admin/CategoryManager.tsx src/components/admin/UpdateManager.tsx src/pages/admin/index.astro src/pages/admin/pages/index.astro
```

Message:

```text
fix(admin): every dialog button is named in the owner's language

The link prompt, the upload alert and five delete or install
confirmations fell back to the dialog's English Cancel and OK. The
dialog functions now require their labels, so astro check refuses a
caller that names none, and every caller passes admin copy.
```

---

### Task 5: A draft keeps its "Publish at" date

Item 8.

**Files:**
- Create: `src/server/db/migrations/026_planned_dates.ts`
- Modify: `src/server/db/migrator.ts` (imports at `:1-27`; the map ending `:54`)
- Modify: `src/server/db/types.ts:192-207` (`ContentEditionColumns`)
- Modify: `src/types/cms.ts:69-88` (`Post`), `:113-130` (`Page`)
- Modify: `src/server/content/mutations.ts` (new export after `statusMutationSchema`)
- Modify: `src/server/content/posts.ts` (`postFromRow` `:57-76`, `createPost` `:150`, `updatePost` `:248`, `updatePostStatus` `:275`)
- Modify: `src/server/content/pages.ts` (`pageFromRow` `:44-62`, `createPage` `:132`, `updatePage` `:206`, `updatePageStatus` `:232`)
- Modify: `src/components/admin/Editor.tsx:67-71`, `:120`, `:133-136`; `src/components/admin/PageEditor.tsx:75-78`, `:124`, `:139-142`
- Test: `tests/integration/draft-planned-date.test.ts` (new), `tests/unit/db-migrator.test.ts:11`, `tests/unit/public-serialization.test.ts:36-56`, `tests/e2e/editor-blocks.spec.ts:519-525`

**Interfaces:**
- Produces: columns `posts.planned_at` and `pages.planned_at` (`timestamptz`, null unless the row is a draft, enforced by a check constraint); `ContentEditionColumns.planned_at: Timestamp | null`; `Post.planned_at: string | null`, `Page.planned_at: string | null`.
- Produces, in `src/server/content/mutations.ts`: `plannedAtWrite(input: { publishedAt?: string | null; status: 'draft' | 'published' }): { planned_at?: Date | null }`.
- Task 6 relies on `publishedAt` in both editors holding a draft's planned date.

Why a column, not a change to the trigger. 017's trigger empties `published_at` on every draft, and that emptiness is load-bearing: 019's redirect trigger reads `old.published_at is not null` as "was ever public", `isScheduled` and every list and public query read a null `published_at` as "not out", and `tests/integration/scheduled-publishing.test.ts:101-105` pins it. Letting drafts keep `published_at` would make all of them lie. The editor already keeps the date in a ref for one sitting, so the smallest correct fix is a place to keep it between sittings: `planned_at`, written only for drafts and spent on publishing.

What each write does with it (`plannedAtWrite`): publishing clears it (the date is then the publication date); a draft save that names a date keeps that date; a draft save that sends `null` clears it; a save that sends nothing leaves it. The editor now always sends its date, `null` included, so an emptied field empties it. Publishing from the posts or pages list sends no date and still means now, as today; only the editor, which shows the date, publishes on it.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/draft-planned-date.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a draft keeps the date it is planned for, and publishing spends it', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, getPost, updatePost, updatePostStatus } = await import('../../src/server/content/posts');
  const { createPage, updatePageStatus } = await import('../../src/server/content/pages');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'planning-owner', name: 'Planning Owner', email: 'planning@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'planning-owner', site_name: 'TomeCMS', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [category] = await db.insertInto('categories').values([
    { owner_id: 'planning-owner', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();
  assert.ok(category);

  const content: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  };
  const base = {
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson: content, metaDescription: null, metaTitle: null,
  };
  const friday = new Date(Date.now() + 86_400_000).toISOString();
  const monday = new Date(Date.now() + 4 * 86_400_000).toISOString();

  // Filed with a date: the draft is not out, and it keeps the date for when it will be.
  const created = await createPost('planning-owner', { ...base, publishedAt: friday, slug: 'planned', status: 'draft', title: 'Planned' });
  assert.equal(created.published_at, null, 'a draft is still not published');
  assert.equal(created.planned_at, friday, 'but it keeps the date it was given');
  assert.equal((await getPost('planning-owner', created.id))?.planned_at, friday, 'and the next visit reads it back');

  // A save that says nothing about the date keeps it; a new date replaces it; an emptied field empties it.
  const kept = await updatePost('planning-owner', {
    ...base, id: created.id, slug: 'planned', status: 'draft', title: 'Planned, edited', updatedAt: created.updated_at,
  });
  assert.equal(kept.planned_at, friday, 'a save with no date keeps the one it had');
  const moved = await updatePost('planning-owner', {
    ...base, id: created.id, publishedAt: monday, slug: 'planned', status: 'draft', title: 'Planned', updatedAt: kept.updated_at,
  });
  assert.equal(moved.planned_at, monday, 'a new date replaces it');
  const cleared = await updatePost('planning-owner', {
    ...base, id: created.id, publishedAt: null, slug: 'planned', status: 'draft', title: 'Planned', updatedAt: moved.updated_at,
  });
  assert.equal(cleared.planned_at, null, 'an emptied field empties it');

  // Published on its date: the date becomes the publication date, and nothing is left planned.
  const replanned = await updatePostStatus('planning-owner', {
    id: created.id, publishedAt: friday, status: 'draft', updatedAt: cleared.updated_at,
  });
  assert.equal(replanned.planned_at, friday, 'a status save keeps a draft’s date too');
  const published = await updatePostStatus('planning-owner', {
    id: created.id, publishedAt: friday, status: 'published', updatedAt: replanned.updated_at,
  });
  assert.equal(published.published_at, friday);
  assert.equal(published.planned_at, null, 'a published post has its date, and no plan');

  // The database holds the rule as well as the code: a published row with a plan is refused.
  await assert.rejects(
    db.updateTable('posts').set({ planned_at: new Date(friday) }).where('id', '=', created.id).execute(),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );

  // Pages the same way; publishing from the list names no date and spends the plan.
  const page = await createPage('planning-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null,
    publishedAt: friday, slug: 'planned-page', status: 'draft', title: 'Planned page',
  });
  assert.equal(page.published_at, null);
  assert.equal(page.planned_at, friday);
  const pagePublished = await updatePageStatus('planning-owner', { id: page.id, status: 'published', updatedAt: page.updated_at });
  assert.ok(pagePublished.published_at, 'published now, as the list always did');
  assert.equal(pagePublished.planned_at, null);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `uptime`, then `node scripts/test-foundation.mjs tests/integration/draft-planned-date.test.ts`
Expected: FAIL on `created.planned_at`: `undefined !== '<friday>'`.

- [ ] **Step 3: Write the migration**

Create `src/server/db/migrations/026_planned_dates.ts`:

```ts
import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The date a draft is planned to go out on.
 *
 * 017 keeps `published_at` empty on a draft, and that is still right: a draft is not out,
 * and every query that asks "is it out, and since when" reads that column, as 019's
 * redirects do. But it meant the "Publish at" an owner chose on a draft was dropped by the
 * save that filed it, and was gone the next time the editor opened. The plan gets a column
 * of its own. Only a draft carries one; publishing spends it.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table posts
      add column planned_at timestamptz,
      add constraint posts_planned_at_draft_check check (status = 'draft' or planned_at is null)
  `.execute(db);
  await sql`
    alter table pages
      add column planned_at timestamptz,
      add constraint pages_planned_at_draft_check check (status = 'draft' or planned_at is null)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`alter table posts drop constraint posts_planned_at_draft_check, drop column planned_at`.execute(db);
  await sql`alter table pages drop constraint pages_planned_at_draft_check, drop column planned_at`.execute(db);
}
```

In `src/server/db/migrator.ts`, after `import * as contentStats from './migrations/025_content_stats';` add:

```ts
import * as plannedDates from './migrations/026_planned_dates';
```

and after `  '025_content_stats': contentStats,` add:

```ts
  '026_planned_dates': plannedDates,
```

In `tests/unit/db-migrator.test.ts:11`, replace `'025_content_stats'` with `'026_planned_dates'`.

- [ ] **Step 4: Carry the column through the types**

In `src/server/db/types.ts`, in `ContentEditionColumns`, after `  published_at: Timestamp | null;` add:

```ts
  /** A draft's planned date (026). Null on every published row, which a constraint holds. */
  planned_at: Timestamp | null;
```

In `src/types/cms.ts`, in both `Post` and `Page`, after `  published_at: string | null;` add:

```ts
  /** The date a draft is planned to go out on. Null once published, or when none was chosen. */
  planned_at: string | null;
```

In `tests/unit/public-serialization.test.ts`, in the `post` fixture, after `  published_at: '2026-09-08T03:00:00.000Z',` add:

```ts
  planned_at: null,
```

- [ ] **Step 5: Write the rule once, and use it in every write**

In `src/server/content/mutations.ts`, after `statusMutationSchema`, add:

```ts
/**
 * What a write does to a draft's planned date. Publishing spends it: the date is then the
 * publication date. A draft save that names a date keeps it, one that sends null empties it,
 * and one that says nothing leaves it as it is.
 */
export function plannedAtWrite(input: { publishedAt?: string | null; status: 'draft' | 'published' }): { planned_at?: Date | null } {
  if (input.status === 'published') return { planned_at: null };
  if (input.publishedAt === undefined) return {};
  return { planned_at: input.publishedAt ? new Date(input.publishedAt) : null };
}
```

In `src/server/content/posts.ts` and `src/server/content/pages.ts`, add `plannedAtWrite,` to the `./mutations` import (after `normalizedContentSlug,`).

In `postFromRow` and `pageFromRow`, after `    published_at: row.published_at?.toISOString() ?? null,` add:

```ts
    planned_at: row.planned_at?.toISOString() ?? null,
```

In `createPost` and `createPage`, after `        published_at: input.publishedAt ? new Date(input.publishedAt) : null,` add:

```ts
        ...plannedAtWrite(input),
```

In `updatePost` and `updatePage`, after `        ...(input.publishedAt ? { published_at: new Date(input.publishedAt) } : {}),` add:

```ts
        ...plannedAtWrite(input),
```

In `updatePostStatus` and `updatePageStatus`, after `      ...(input.publishedAt ? { published_at: new Date(input.publishedAt) } : {}),` add:

```ts
      ...plannedAtWrite(input),
```

- [ ] **Step 6: Run the integration test and see it pass**

Run: `uptime`, then `node scripts/test-foundation.mjs tests/integration/draft-planned-date.test.ts`
Expected: PASS.

Then the neighbour that pins `published_at` on drafts: `node scripts/test-foundation.mjs tests/integration/scheduled-publishing.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 7: Write the editor's failing e2e step**

In `tests/e2e/editor-blocks.spec.ts`, in "a post can be published for later, and is nobody else's until then", replace:

```ts
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  const when = page.locator('dialog.admin-editor-settings input[type="datetime-local"]');
  await when.waitFor({ state: 'visible' });
  await when.fill(friday);
  await page.getByRole('button', { name: /Close settings/i }).click();
```

with:

```ts
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  const when = page.locator('dialog.admin-editor-settings input[type="datetime-local"]');
  await when.waitFor({ state: 'visible' });
  // The draft is filed with the date on it, and keeps it: a reload is the owner's next visit.
  const filed = page.waitForResponse((response) => response.url().endsWith('/api/admin/posts')
    && ['POST', 'PUT'].includes(response.request().method()) && response.ok()
    && Boolean(response.request().postDataJSON()?.publishedAt));
  await when.fill(friday);
  await page.getByRole('button', { name: /Close settings/i }).click();
  await filed;
  await page.reload();
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  await when.waitFor({ state: 'visible' });
  await expect(when, 'a draft keeps the date it was given').toHaveValue(friday);
  await page.getByRole('button', { name: /Close settings/i }).click();
```

- [ ] **Step 8: Run it and see it fail**

Run: `uptime`, then `npx playwright test tests/e2e/editor-blocks.spec.ts -g "published for later"`
Expected: FAIL on "a draft keeps the date it was given": the field is empty after the reload, because the editor still seeds only from `published_at`.

- [ ] **Step 9: Seed the editors from the plan, and always send the date**

In `src/components/admin/Editor.tsx`, replace:

```tsx
  // The owner's answer to "when", carried in a ref for the same reason the status is:
  // an autosave fires from a callback that must not be rebuilt every keystroke.
  const publishedAtRef = useRef<string | null>(initialPost?.published_at ?? null);
  const [publishedAt, setPublishedAt] = useState<string | null>(initialPost?.published_at ?? null);
```

with:

```tsx
  // The owner's answer to "when", carried in a ref for the same reason the status is:
  // an autosave fires from a callback that must not be rebuilt every keystroke. A draft's
  // answer is kept as planned_at, since a draft has no published_at.
  const publishedAtRef = useRef<string | null>(initialPost?.published_at ?? initialPost?.planned_at ?? null);
  const [publishedAt, setPublishedAt] = useState<string | null>(initialPost?.published_at ?? initialPost?.planned_at ?? null);
```

Replace:

```tsx
        ...(publishedAtRef.current ? { publishedAt: publishedAtRef.current } : {}),
```

with:

```tsx
        // Always sent, empty included: an emptied field is how a draft's date is dropped.
        publishedAt: publishedAtRef.current,
```

Replace:

```tsx
    // Only when there is one. A draft has no date at all -- the database drops it -- and a
    // date the owner picked before publishing must survive the autosave that files the
    // draft, or pressing Publish sends nothing and the article goes out now.
```

with:

```tsx
    // Only when there is one. A draft comes back with its date as planned_at, which is the
    // value the ref already holds; taking the draft's empty published_at instead would make
    // pressing Publish send nothing, and the article would go out now.
```

In `src/components/admin/PageEditor.tsx`, make the same three replacements with `initialPage` in place of `initialPost`:

```tsx
  // The owner's answer to "when", carried in a ref for the same reason the status is:
  // an autosave fires from a callback that must not be rebuilt every keystroke. A draft's
  // answer is kept as planned_at, since a draft has no published_at.
  const publishedAtRef = useRef<string | null>(initialPage?.published_at ?? initialPage?.planned_at ?? null);
  const [publishedAt, setPublishedAt] = useState<string | null>(initialPage?.published_at ?? initialPage?.planned_at ?? null);
```

```tsx
        // Always sent, empty included: an emptied field is how a draft's date is dropped.
        publishedAt: publishedAtRef.current,
```

```tsx
    // Only when there is one. A draft comes back with its date as planned_at, which is the
    // value the ref already holds; taking the draft's empty published_at instead would make
    // pressing Publish send nothing, and the article would go out now.
```

- [ ] **Step 10: Run the e2e test and see it pass**

Run: `uptime`, then `npx playwright test tests/e2e/editor-blocks.spec.ts -g "published for later"`
Expected: PASS on the desktop project (the file skips the phone project): the date survives the reload, and the rest of the test publishes the post for Friday as before.

- [ ] **Step 11: Run the gates**

Run, one at a time, `uptime` before each stack: `npm run check`, `npm run test:unit`, `npm run test:integration`.
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add src/server/db/migrations/026_planned_dates.ts src/server/db/migrator.ts src/server/db/types.ts src/types/cms.ts src/server/content/mutations.ts src/server/content/posts.ts src/server/content/pages.ts src/components/admin/Editor.tsx src/components/admin/PageEditor.tsx tests/integration/draft-planned-date.test.ts tests/unit/db-migrator.test.ts tests/unit/public-serialization.test.ts tests/e2e/editor-blocks.spec.ts
```

Message:

```text
fix(content): a draft keeps its Publish at date

The date an owner chose on a draft was dropped by the save that filed
it, because a draft has no published_at, and it was gone when the
editor opened again. Migration 026 adds planned_at to posts and pages,
kept only on a draft and spent on publishing, so published_at still
means what every query and the redirect trigger read it as. The editor
reads a draft's date back and always sends its field, so emptying it
empties the plan.
```

---

### Task 6: The editor's chips say Scheduled, and the popup's buttons speak its language

Items 9 and 10.

**Files:**
- Modify: `src/types/cms.ts:12-17` (`PostTranslationSummary`), `:132-137` (`PageTranslationSummary`)
- Modify: `src/server/content/posts.ts:100-104` (`listPostTranslations`), `src/server/content/pages.ts:86-90` (`listPageTranslations`)
- Modify: `src/components/admin/Editor.tsx:149-152`, `:360-363`; `src/components/admin/PageEditor.tsx:149-152`, `:360-363`
- Modify: `src/layouts/BaseLayout.astro:101-103`, `:247`, `:265`
- Test: `tests/unit/editor-rendering.test.ts`, `tests/e2e/editor-blocks.spec.ts:530`, `tests/e2e/public-plugins.spec.ts:501-511`

**Interfaces:**
- Consumes: `statusLabel(copy, status, publishedAt)` from `src/lib/admin-i18n.ts`; the editors' `publishedAt` state from Task 5; `PublicPopup.locale` from `src/server/plugins/public.ts`; `publicCopy(locale).popupDecline` and `.closePopup` from `src/lib/i18n.ts`.
- Produces: `PostTranslationSummary.published_at: string | null`, `PageTranslationSummary.published_at: string | null`.

The popup's own locale (`plugins.popup.locale`) is the language of the words it shows, which is the other language's when the page's had none (`src/plugins/popup/index.ts:31-50`). The layout drew its default decline and its close label in the page's language. The plugin's manifest hints already promise the per-language default ("Left empty: “ไม่ล่ะ ขอบคุณ”" and "Left empty: “No thanks”").

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/editor-rendering.test.ts`:

```ts
test('the language chips say Scheduled for a date still to come, as the lists do', () => {
  for (const [name, status] of [['Editor', 'postStatus'], ['PageEditor', 'pageStatus']] as const) {
    const source = readFileSync(new URL(`../../src/components/admin/${name}.tsx`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`statusLabel\\(copy, ${status}, publishedAt\\)`), `${name}: the chip of the edition open`);
    assert.match(source, /statusLabel\(copy, translation\.status, translation\.published_at\)/, `${name}: the other language's chip`);
  }
});
```

In `tests/e2e/editor-blocks.spec.ts`, in "a post can be published for later, and is nobody else's until then", replace:

```ts
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await written;
```

with:

```ts
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await written;
  await expect(page.getByRole('navigation', { name: 'Post languages' }).locator('[aria-current="page"]'),
    'the editor says Scheduled, as the list does').toHaveText('EN Scheduled');
```

In `tests/e2e/public-plugins.spec.ts`, in "a popup where it was asked for, and none where it is off", replace:

```ts
  setPlugin('popup', true, { ...POPUP, pages: 'home' });
```

with:

```ts
  // No decline words of its own, so the core's are drawn: in the popup's language.
  setPlugin('popup', true, { ...POPUP, declineEn: '', pages: 'home' });
```

and replace:

```ts
  await expect(page.locator('dialog.site-popup'), 'English words on a Thai page are read as English')
    .toHaveAttribute('lang', 'en');
```

with:

```ts
  await expect(page.locator('dialog.site-popup'), 'English words on a Thai page are read as English')
    .toHaveAttribute('lang', 'en');
  await expect(page.locator('.site-popup__decline'), 'and its buttons are English with them, not the page’s Thai')
    .toHaveText('No thanks');
  await expect(page.locator('.site-popup__close button')).toHaveAttribute('aria-label', 'Close this window');
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --import tsx --test tests/unit/editor-rendering.test.ts`
Expected: FAIL: "Editor: the chip of the edition open".

Run, `uptime` first: `npx playwright test tests/e2e/editor-blocks.spec.ts -g "published for later"`
Expected: FAIL on "the editor says Scheduled, as the list does": the chip reads `EN Published`.

Run, `uptime` first: `npx playwright test tests/e2e/public-plugins.spec.ts -g "where it was asked for"`
Expected: FAIL on the decline button: it reads `ไม่ล่ะ ขอบคุณ`.

- [ ] **Step 3: Give the translation summaries their date**

In `src/types/cms.ts`, in both `PostTranslationSummary` and `PageTranslationSummary`, after the `status` line add:

```ts
  /** For the chip: a published edition whose date is still to come is Scheduled. */
  published_at: string | null;
```

In `src/server/content/posts.ts`, replace `listPostTranslations` with:

```ts
export async function listPostTranslations(ownerId: string, translationGroupId: string): Promise<PostTranslationSummary[]> {
  const rows = await db.selectFrom('posts').select(['id', 'locale', 'published_at', 'status', 'title'])
    .where('owner_id', '=', ownerId).where('translation_group_id', '=', translationGroupId)
    .orderBy('locale').execute();
  return rows.map((row) => ({ ...row, published_at: row.published_at?.toISOString() ?? null }));
}
```

In `src/server/content/pages.ts`, replace `listPageTranslations` with:

```ts
export async function listPageTranslations(ownerId: string, translationGroupId: string): Promise<PageTranslationSummary[]> {
  const rows = await db.selectFrom('pages').select(['id', 'locale', 'published_at', 'status', 'title'])
    .where('owner_id', '=', ownerId).where('translation_group_id', '=', translationGroupId)
    .orderBy('locale').execute();
  return rows.map((row) => ({ ...row, published_at: row.published_at?.toISOString() ?? null }));
}
```

- [ ] **Step 4: Label both chips as the lists do**

In `src/components/admin/Editor.tsx`, replace:

```tsx
      { id: savedPost.id, locale: savedPost.locale, status: savedPost.status, title: savedPost.title },
```

with:

```tsx
      { id: savedPost.id, locale: savedPost.locale, published_at: savedPost.published_at, status: savedPost.status, title: savedPost.title },
```

and replace:

```tsx
                  ? `${language.toUpperCase()} ${statusLabel(copy, postStatus)}`
                  : translation
                    ? `${language.toUpperCase()} ${statusLabel(copy, translation.status)}`
```

with:

```tsx
                  ? `${language.toUpperCase()} ${statusLabel(copy, postStatus, publishedAt)}`
                  : translation
                    ? `${language.toUpperCase()} ${statusLabel(copy, translation.status, translation.published_at)}`
```

In `src/components/admin/PageEditor.tsx`, replace:

```tsx
      { id: savedPage.id, locale: savedPage.locale, status: savedPage.status, title: savedPage.title },
```

with:

```tsx
      { id: savedPage.id, locale: savedPage.locale, published_at: savedPage.published_at, status: savedPage.status, title: savedPage.title },
```

and replace:

```tsx
                  ? `${language.toUpperCase()} ${statusLabel(copy, pageStatus)}`
                  : translation
                    ? `${language.toUpperCase()} ${statusLabel(copy, translation.status)}`
```

with:

```tsx
                  ? `${language.toUpperCase()} ${statusLabel(copy, pageStatus, publishedAt)}`
                  : translation
                    ? `${language.toUpperCase()} ${statusLabel(copy, translation.status, translation.published_at)}`
```

`statusLabel` answers Scheduled only for a published status with a date still to come (`isScheduled`), so a draft's planned date in `publishedAt` still reads Draft.

- [ ] **Step 5: Draw the popup's buttons in its own language**

In `src/layouts/BaseLayout.astro`, after:

```astro
const plugins = Astro.props.themeId && additions.popup
  ? { ...additions, clients: additions.clients.filter(({ id }) => id !== additions.popup?.pluginId), popup: null }
  : additions;
```

add:

```astro
// The popup's buttons are read with its words, and its words may be the other language's.
const popupText = plugins.popup ? publicCopy(plugins.popup.locale) : publicText;
```

Replace `<button aria-label={publicText.closePopup} type="submit" value="close">` with `<button aria-label={popupText.closePopup} type="submit" value="close">`, and replace `{plugins.popup.decline ?? publicText.popupDecline}` with `{plugins.popup.decline ?? popupText.popupDecline}`.

- [ ] **Step 6: Run the tests and see them pass**

Run: `node --import tsx --test tests/unit/editor-rendering.test.ts`
Expected: PASS.

Run, one at a time, `uptime` first: `npx playwright test tests/e2e/editor-blocks.spec.ts -g "published for later"`, then `npx playwright test tests/e2e/public-plugins.spec.ts -g "popup"`.
Expected: PASS (every popup test, on both projects where each runs).

- [ ] **Step 7: Run the gates**

Run, one at a time: `npm run check`, `npm run test:unit`.
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/types/cms.ts src/server/content/posts.ts src/server/content/pages.ts src/components/admin/Editor.tsx src/components/admin/PageEditor.tsx src/layouts/BaseLayout.astro tests/unit/editor-rendering.test.ts tests/e2e/editor-blocks.spec.ts tests/e2e/public-plugins.spec.ts
```

Message:

```text
fix(editor): the language chips say Scheduled, and the popup speaks its own language

Both editors labelled a published edition with a date still to come as
Published; they read the date as the posts and pages lists do, for the
edition open and for the other language's. The popup drew its default
decline words and its close label in the page's language when its own
words were the other language's; both follow the popup now.
```

---

### Task 7: The core closes a notice band

Item 11.

**Files:**
- Modify: `src/components/NoticeScript.astro` (whole file)
- Delete: `src/plugins/notice/client.ts`
- Modify: `src/plugins/notice/index.ts:39-44`
- Modify: `src/layouts/BaseLayout.astro:283`
- Modify: `website/src/content/docs/extending/plugins.md:44`, `website/src/content/docs/th/extending/plugins.md:44`
- Test: `tests/e2e/public-plugins.spec.ts:160`, `:183`, `:252`, `:270`

**Interfaces:**
- Consumes: the band's markup from `BaseLayout.astro:216-235` (`[data-site-notice]`, `data-dismiss-key`, `[data-notice-close]`), unchanged; the `data-closing` rule and `notice-out` animation in `src/styles/global.css:2542-2547`, unchanged; `html[data-notice-closed] .site-notice { display: none; }` at `global.css:105`, unchanged.
- Produces: nothing new. `NoticeScript` keeps its one prop, `dismissKey: string`, and is still rendered only for a band with a key (`BaseLayout.astro:196`).

`src/plugins/contract.ts:110-125` says the core owns the band's dismissal, but the close code was the notice plugin's `client.ts`, loaded only through its `publicClient`: a band from any other plugin drew a close button that did nothing. The code moves, as it is, into `NoticeScript.astro`, beside the inline check that already hides a band closed before. The storage key is the band's `data-dismiss-key`, as before, and the stored value is still `'1'`. The e2e checks that measured "the band brings its script" by looking for `notice` in script URLs now check that the plugin brings no code (`/plugins/notice/` in the dev server's module URL), while the existing assertions prove the close still animates, removes the band, and keeps it gone after a reload with no flash.

- [ ] **Step 1: Change the e2e expectations**

In `tests/e2e/public-plugins.spec.ts`:

In the `visit` helper of "a public page carries only the plugins that asked to be on it", replace:

```ts
      notice: asked.some((url) => url.includes('notice')),
```

with:

```ts
      notice: asked.some((url) => url.includes('/plugins/notice/')),
```

Replace:

```ts
  expect(refused.notice, 'a band a reader can close brings its code').toBe(true);
```

with:

```ts
  expect(refused.notice, 'the core closes the band, so the plugin ships no code for it').toBe(false);
  await expect(band.locator('[data-notice-close]'), 'and it can still be closed').toHaveCount(1);
```

In "the banner is the owner's colours, and stays or goes as they said", replace:

```ts
  expect(kept.some((url) => url.includes('notice')), 'and no script for a band that stays').toBe(false);
```

with:

```ts
  expect(kept.some((url) => url.includes('/plugins/notice/')), 'and no plugin code for a band that stays').toBe(false);
```

and replace:

```ts
  // Closable: the default, and the one that ships a script.
  setPlugin('notice', true, { textEn: 'We are adding features.', background: '#000000', text: '#ffffff' });
  const closable = await scripts('/en');
  expect(closable.some((url) => url.includes('notice')), 'a band that can be closed brings its script').toBe(true);
```

with:

```ts
  // Closable, the default. Closing is the core's, so no plugin code comes with it.
  setPlugin('notice', true, { textEn: 'We are adding features.', background: '#000000', text: '#ffffff' });
  const closable = await scripts('/en');
  expect(closable.some((url) => url.includes('/plugins/notice/')), 'closing is the core’s: the plugin ships no code').toBe(false);
```

- [ ] **Step 2: Run the spec and see it fail**

Run: `uptime`, then `npx playwright test tests/e2e/public-plugins.spec.ts -g "plugins that asked|owner's colours"`
Expected: FAIL on "the core closes the band, so the plugin ships no code for it": the page still loads `/src/plugins/notice/client.ts`.

- [ ] **Step 3: Close the band from the core**

Replace `src/components/NoticeScript.astro` with:

```astro
---
interface Props {
  /** What the band's closing is remembered under -- the same key its own script writes. */
  dismissKey: string;
}

const { dismissKey } = Astro.props;

/**
 * Keeps a banner the reader already closed from being drawn at all, and closes it.
 *
 * The check used to live in the banner's own script, which is a module: deferred, and
 * fetched on top of that. So every load painted the band and then took it away, and a
 * reader refreshing quickly saw it flash each time. It is the same failure the theme
 * toggle has and ThemeScript prevents, and the same answer -- inline, blocking, and in the
 * head, so the page's first frame already knows.
 *
 * All it does is mark the document; the stylesheet does the hiding. A private window or
 * blocked storage throws, and a band that cannot remember being closed is a band that is
 * shown, which is the safe way round.
 *
 * The second script closes the band and remembers it. It is the core's, as the plugin
 * contract says the band's dismissal is: any plugin's band with a key closes the same way,
 * and no plugin ships code for it.
 *
 * Only rendered for a band that can be closed. One the owner keeps up has nothing to
 * remember, and the page carries no script for it.
 */
---
<script is:inline define:vars={{ key: dismissKey }}>
  try {
    if (localStorage.getItem(key)) document.documentElement.dataset.noticeClosed = '';
  } catch (error) {
    // Nothing remembered means nothing closed.
  }
</script>
<script>
  const band = document.querySelector<HTMLElement>('[data-site-notice]');
  const close = band?.querySelector<HTMLButtonElement>('[data-notice-close]');
  const key = band?.dataset.dismissKey;
  if (band && close && key) {
    let closedBefore = false;
    try {
      closedBefore = Boolean(window.localStorage.getItem(key));
    } catch {
      // Nothing remembered means nothing closed.
    }
    if (closedBefore) band.remove();
    else {
      close.addEventListener('click', () => {
        try {
          window.localStorage.setItem(key, '1');
        } catch {
          // It closes either way; it just comes back next time.
        }
        // The height the page has to close up by, measured now rather than guessed in CSS.
        band.style.setProperty('--notice-height', `${band.getBoundingClientRect().height}px`);
        band.dataset.closing = '';
        // A frame, so the attribute has reached style before the running animations are
        // counted. None running -- a reader who asked for less motion -- means gone at once.
        requestAnimationFrame(() => {
          const leaving = band.getAnimations();
          if (!leaving.length) {
            band.remove();
            return;
          }
          void Promise.all(leaving.map((animation) => animation.finished.catch(() => undefined)))
            .then(() => band.remove());
        });
      }, { once: true });
    }
  }
</script>
```

Delete the plugin's copy: `git rm src/plugins/notice/client.ts`.

In `src/plugins/notice/index.ts`, delete:

```ts
/** Only where there is something to close: a band that stays needs no script at all. */
export function publicClient(settings: PluginSettings, page: PublicPage) {
  return siteNotice(settings, page)?.dismissKey ? {} : null;
}

```

and replace `const plugin: Plugin = { publicClient, signInWidget, siteNotice, verifySignIn };` with:

```ts
const plugin: Plugin = { signInWidget, siteNotice, verifySignIn };
```

In `src/layouts/BaseLayout.astro`, replace:

```astro
  {plugins.clients.length + (plugins.notice ? 1 : 0) > 0 && <PluginClients />}
```

with:

```astro
  {plugins.clients.length > 0 && <PluginClients />}
```

- [ ] **Step 4: Say it in the plugin guide**

In `website/src/content/docs/extending/plugins.md`, replace the paragraph that begins "The core draws the band and the popup, but the browser code" with:

```md
The core draws the band and the popup. It also closes a band that has a key, and remembers that it was closed, so a plugin's `siteNotice` needs no browser code of its own. The code that opens a popup is not in the core: it is in `src/plugins/popup/client.ts`, and it loads only through the popup plugin's `publicClient`. A plugin of yours that returns `sitePopup` also returns `publicClient` for the same pages and ships a `client.ts` that opens it. Without one, the popup is drawn and never opens.
```

In `website/src/content/docs/th/extending/plugins.md`, replace the paragraph that begins "แกนระบบวาดแถบและป๊อปอัปก็จริง" with:

```md
แกนระบบเป็นผู้วาดแถบและป๊อปอัป และยังเป็นผู้ปิดแถบที่มี key พร้อมจำไว้ว่าผู้อ่านปิดไปแล้ว ปลั๊กอินที่คืน `siteNotice` จึงไม่ต้องมีโค้ดฝั่งเบราว์เซอร์ของตัวเอง ส่วนโค้ดที่เปิดป๊อปอัปไม่ได้อยู่ในแกนระบบ โค้ดนี้อยู่ใน `src/plugins/popup/client.ts` และโหลดผ่าน `publicClient` ของปลั๊กอินป๊อปอัปเท่านั้น ปลั๊กอินที่คุณเขียนเองซึ่งคืน `sitePopup` จึงต้องคืน `publicClient` สำหรับหน้าเดียวกันด้วย และมี `client.ts` ที่เปิดป๊อปอัป ถ้าไม่มี ป๊อปอัปจะถูกวาดไว้แต่ไม่เคยเปิดขึ้นมา
```

- [ ] **Step 5: Run the spec and see it pass**

Run: `uptime`, then `npx playwright test tests/e2e/public-plugins.spec.ts`
Expected: PASS, the whole file on both projects. In particular "it slides away rather than vanishing" (`notice-out`), "and is gone once it has", "and stays gone for the reader who closed it" and "without being drawn first and taken away after" all hold with the core's script.

- [ ] **Step 6: Run the gates**

Run, one at a time: `npm run check`, `npm run test:unit`.
Expected: both pass. `tests/unit/plugin-admin.test.ts` still finds a public hook on the notice plugin (`siteNotice`).

- [ ] **Step 7: Commit**

```bash
git add src/components/NoticeScript.astro src/plugins/notice/index.ts src/layouts/BaseLayout.astro website/src/content/docs/extending/plugins.md website/src/content/docs/th/extending/plugins.md tests/e2e/public-plugins.spec.ts
```

(`git rm` in Step 3 already staged the deletion of `src/plugins/notice/client.ts`.)

Message:

```text
fix(plugins): the core closes a notice band, as the contract says

The plugin contract gives the band's dismissal to the core, but the close
code lived in the notice plugin's client and loaded only through it, so
a closable band from any other plugin could not be closed. The same code
now ships with the core's NoticeScript for any band with a key. The
notice plugin keeps its key and its behaviour and ships no browser code.
```

---

### Task 8: Bootstrap on Windows, and a video's poster first

Items 12 and 16.

**Files:**
- Modify: `scripts/bootstrap-core.mjs:134-139` (`run`), `:166` (the mode check), `:194-196` (the migration); two new exports after `writeEnvironment`
- Modify: `src/lib/editor-content.ts:97-108` (`withLeadImage`)
- Test: `tests/unit/bootstrap-core.test.ts:8`, `tests/unit/editor-rendering.test.ts`

**Interfaces:**
- Produces, in `scripts/bootstrap-core.mjs`: `migrateCommand(platform = process.platform): { args: string[]; command: string; shell: boolean }` and `isPrivateMode(mode: number, platform = process.platform): boolean`.
- Produces: `withLeadImage(html: string): string`, same signature, now also raising a poster that opens the article.

On Windows `npm` is `npm.cmd`, which Node starts only through a shell (`spawnSync('npm')` is ENOENT, and a `.cmd` without `shell` is EINVAL). The whole command goes as one fixed string, so nothing is interpolated into the shell and Node's warning about arguments with `shell: true` does not apply. Windows reports a regular file's mode as `0o100666` whatever its ACL says, so the `0600` check refuses every rerun there; it is skipped on `win32`. `docker` is `docker.exe` and needs neither. The platform is a parameter so both branches are tested on any machine, and `main()` is not restructured.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/bootstrap-core.test.ts`, replace the `bootstrap-core.mjs` import with:

```ts
import { isPrivateMode, makeEnvironment, migrateCommand, parseOptions, renderEnvironment, writeEnvironment } from '../../scripts/bootstrap-core.mjs';
```

and add:

```ts
test('on Windows npm starts through its .cmd shim, and a file mode is not read as a privacy promise', () => {
  assert.deepEqual(migrateCommand('win32'), { args: [], command: 'npm.cmd run db:migrate', shell: true });
  for (const platform of ['darwin', 'linux'] as const) {
    assert.deepEqual(migrateCommand(platform), { args: ['run', 'db:migrate'], command: 'npm', shell: false }, platform);
  }
  // Windows reports 0o666 for any file it can write, whatever its ACL says.
  assert.equal(isPrivateMode(0o100666, 'win32'), true);
  assert.equal(isPrivateMode(0o100666, 'linux'), false);
  assert.equal(isPrivateMode(0o100640, 'darwin'), false);
  assert.equal(isPrivateMode(0o100600, 'linux'), true);
});
```

In `tests/unit/editor-rendering.test.ts`, after the test "a video carrying anything beyond its own attributes is refused" (the `clip` helper and `POSTER` are defined above it), add:

```ts
test('an article that opens with a video fetches its poster first', () => {
  const { contentHtml } = prepareEditorContent({ contentJson: clip({}) });
  assert.equal(
    withLeadImage(`${contentHtml}<p>Words</p>`),
    `<figure class="tome-video"><a class="tome-video__play" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=30" rel="noopener noreferrer"><img fetchpriority="high" alt="" src="/media/${POSTER}" decoding="async" /><span class="tome-video__title">A clip</span></a><figcaption>A clip · YouTube</figcaption></figure><p>Words</p>`,
    'the poster is what the screen waits on, so it is fetched first and not lazily',
  );
  const bare = prepareEditorContent({ contentJson: clip({ mediaId: null }) }).contentHtml;
  assert.equal(withLeadImage(bare), bare, 'a video with no poster has no picture to raise');
  const later = `<p>Words</p>${contentHtml}`;
  assert.equal(withLeadImage(later), later, 'a video after the words is not what the screen waits on');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --import tsx --test tests/unit/bootstrap-core.test.ts tests/unit/editor-rendering.test.ts`
Expected: FAIL with `TypeError: migrateCommand is not a function`, and the video test's first `assert.equal` showing the poster still carrying `loading="lazy"` and no `fetchpriority`.

- [ ] **Step 3: Start npm and read the mode the Windows way**

In `scripts/bootstrap-core.mjs`, after `writeEnvironment`, add:

```js
/** npm is a .cmd shim on Windows, which Node starts only through a shell. The command is fixed, so nothing is interpolated into it. */
export function migrateCommand(platform = process.platform) {
  return platform === 'win32'
    ? { args: [], command: 'npm.cmd run db:migrate', shell: true }
    : { args: ['run', 'db:migrate'], command: 'npm', shell: false };
}

/** Whether a file's mode keeps it to its owner. Windows has no such bits and reports 0o666 for any writable file, so there the mode says nothing. */
export function isPrivateMode(mode, platform = process.platform) {
  return platform === 'win32' || (mode & 0o077) === 0;
}
```

Replace `run` with:

```js
function run(command, args, env = process.env, shell = false) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'] });
  // Child errors can include resolved Compose secrets or database URLs.
  if (result.error || result.status !== 0) throw new Error(`${[command, ...args.slice(0, 1)].join(' ')} failed; inspect the service privately.`);
  return result.stdout;
}
```

Replace:

```js
    if ((details.mode & 0o077) !== 0 && !options.force) throw new Error('Set .env.local permissions to 0600 before continuing.');
```

with:

```js
    if (!isPrivateMode(details.mode) && !options.force) throw new Error('Set .env.local permissions to 0600 before continuing.');
```

Replace:

```js
  } else {
    run('npm', ['run', 'db:migrate'], env);
  }
```

with:

```js
  } else {
    const migrate = migrateCommand();
    run(migrate.command, migrate.args, env, migrate.shell);
  }
```

- [ ] **Step 4: Raise a poster that opens the article**

In `src/lib/editor-content.ts`, replace `withLeadImage` and its comment with:

```ts
/**
 * An article that opens with a picture, with no cover drawn above it: that picture is what the
 * reader's screen is waiting on, so it is fetched first rather than lazily. Only an opening
 * picture qualifies, and a video's poster is one when the video opens the article. One further
 * down loads as the reader nears it, and raising a guess would take bandwidth from what the
 * screen actually needs. Themes call this, never the API: a headless site knows its own layout.
 */
export function withLeadImage(html: string): string {
  return html.replace(
    /^((?:<figure class="tome-video"><a class="tome-video__play"[^>]*>)?)(<img\b[^>]*>)/,
    (_match, opening: string, tag: string) => opening + tag
      .replace(/\sloading="[^"]*"/, '')
      .replace(/^<img\b/, '<img fetchpriority="high"'),
  );
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --import tsx --test tests/unit/bootstrap-core.test.ts tests/unit/editor-rendering.test.ts`
Expected: PASS, the older `withLeadImage` test and the bootstrap CLI tests included.

- [ ] **Step 6: Run the gates**

Run, one at a time, `uptime` before the spec: `npm run check`, `npm run test:unit`, `npx playwright test tests/e2e/video.spec.ts`.
Expected: all pass; the reader's page still swaps the poster for the player on a click.

- [ ] **Step 7: Commit**

```bash
git add scripts/bootstrap-core.mjs src/lib/editor-content.ts tests/unit/bootstrap-core.test.ts tests/unit/editor-rendering.test.ts
```

Message:

```text
fix: bootstrap runs on Windows, and a video's poster is fetched first

The bootstrap started npm by name, which Windows cannot do without
npm.cmd and a shell, and refused every rerun there because Windows
reports any writable file as 0666. It starts npm.cmd through a shell on
win32 and skips the Unix mode check there. An article that opens with a
video now fetches the video's poster first, as one that opens with a
picture already did.
```

---

## Self-review

**Coverage of the owner's list:**

| Item | Task |
|---|---|
| 1. Tabs open on `ownerLocale` | 1 (Step 3; e2e in maintenance, home-slides, select-in-dialog) |
| 2. System screen: no release, unreachable, unusable; every message and the check-only line from admin copy | 2 |
| 3. Spare Passkey name | 3 (Step 4) |
| 4. `/recovery` refusal in Thai | 3 (Step 5) |
| 5. Library refusal from references | 3 (Step 6) |
| 6. New item label | 1 (Step 4) |
| 7. Link prompt `cancelLabel`, upload alert `confirmLabel` | 4 (with five more callers of the same defaults) |
| 8. Draft keeps "Publish at" | 5 (migration 026, types, writes, editors, integration and e2e tests) |
| 9. Chip says Scheduled | 6 (Steps 3-4) |
| 10. Popup decline from the popup's locale | 6 (Step 5; also the close label) |
| 11. Notice close in the core | 7 |
| 12. Bootstrap on Windows | 8 (Step 3) |
| 16. `withLeadImage` and a video | 8 (Step 4) |

**Placeholder scan:** every code step carries its code; every run step names its command and the failure it expects. No step defers to another task's code.

**Name consistency:** `UpdateUnavailableReason` and `reason` (Task 2) are used only in `service.ts` and `UpdateManager.tsx`. `updateCheckMessage` and `installabilityReason` match between the component and `update-admin.test.ts`. `stillUsedText`, `stillUsedOne`, `stillUsedMany` match across `media-client.ts`, `MediaLibrary.tsx`, `admin-i18n.ts` and the test. `plannedAtWrite` and `planned_at` match across the migration, `types.ts`, `cms.ts`, `mutations.ts`, `posts.ts`, `pages.ts`, both editors and the integration test. `published_at` on the translation summaries (Task 6) is set in `listPostTranslations`, `listPageTranslations` and both editors' `setLanguageEditions`. `migrateCommand` and `isPrivateMode` match between `bootstrap-core.mjs` and its test.

**Ordering:** Task 6 edits lines of `Editor.tsx`, `PageEditor.tsx` and the same e2e test that Task 5 edits; run Task 5 first. Every other task stands alone.

**Left as they are, on purpose:** the managed updater's English reasons and the install confirmation's English title and message (managed installs start at 1.0.0); the stored English names `'Recovery passkey'` (`RecoveryPasskey.tsx:50`) and `'Primary passkey'` (`InstallerWizard.tsx:325`); the em dash already in `th.drawer.publishAtHint`. None is on the approved list.
