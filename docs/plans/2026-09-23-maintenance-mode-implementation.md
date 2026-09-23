# Maintenance Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner close the public site and its content API by hand, and show visitors a
503 page built from one of four core templates with the owner's words, picture and return time.

**Architecture:** Five columns on the one `site_settings` row hold the switch and the page. The
rules (schema, fallback words, return time, language) live once in `src/lib/site-maintenance.ts`
and are read by the admin, the server and the middleware. The gate in `src/middleware.ts` sorts
each path: pages are rewritten to a core page that answers 503, feeds answer 503 as text, the
content API answers a 503 problem that carries the owner's words, and the signed-in owner passes
through with a bar over the site. The admin screen saves the page and switches the site in two
separate actions.

**Tech Stack:** Astro 7 SSR, React 18 islands, Kysely on PostgreSQL 17, zod 4, `node --test`,
Playwright.

**Spec:** [docs/specs/2026-09-23-maintenance-mode-design.md](../specs/2026-09-23-maintenance-mode-design.md)

## Global Constraints

- Four templates only: `minimal`, `logo`, `picture`, `countdown`. Picture needs a picture;
  Countdown needs a return time. Both are checked by zod and by a table check.
- A heading is at most **80** characters and a message at most **280**, trimmed. An empty one is
  filled at render time with the product's words: Thai "ปิดปรับปรุงชั่วคราว" / "เราจะกลับมาเร็ว ๆ นี้",
  English "Down for maintenance" / "We’ll be back soon."
- The return time is shown, counted down to and sent as `Retry-After`. It never reopens the site.
  A time equal to now has passed, the same edge rule as `slideStatus`.
- Always open, whatever the switch says: the configured admin path, `/api/admin/*`, `/api/auth/*`,
  `/install`, `/recovery` and their APIs, `/health/live`, `/health/ready`, `/_astro/*`, `/media/*`,
  `/favicon.svg`, `/api/v1/content/openapi.json`, `/api/v1/content/preview/*`, and every `OPTIONS`
  request to the content API.
- Saving the page never changes `maintenance_enabled`, and neither save nor switch moves
  `site_settings.updated_at` (the Settings form's version and the public `Last-Modified` read it).
- The maintenance page is the core's: it uses `src/styles/installer-tokens.css`, never a theme.
- The server module is `src/server/content/site-maintenance.ts`. `src/server/update/maintenance.ts`
  (the updater's) is not touched and not imported.
- Every user-visible string is the copy this plan gives, in English and Thai. `const th: typeof en`
  makes a missing Thai key a type error.
- Commits: write the message to a file under the scratchpad, then `git commit -F <file>` as its own
  command. Stage by explicit path, never `git add -A`. No attribution lines of any kind. Never
  `git stash`, `git checkout --`, `git reset --hard` or `git clean`. `--no-verify` is blocked.
- `npm run test:unit` and `npm run check` pass before every commit, run one after the other and
  never beside the browser suite (`tests/unit/managed-installer.test.ts` fails under load; if it
  does, re-run that file alone before believing it). Use a Bash timeout of 600000 for them.
- Integration tests run with `node scripts/test-foundation.mjs <file>`, which stands up and tears
  down its own stack. Browser specs run with
  `npm run test:e2e -- tests/e2e/maintenance.spec.ts --project=desktop`.
- Never touch the owner's `tome-cms-postgres-1`, `tome-cms-seaweedfs-1` or the dev server on 4321.
- Every guard a task adds is checked by putting back the bug it guards against, and the report
  says what the failure read.
- The shell is zsh: quote every glob and every path with brackets.

---

### Task 1: The rules

**Files:**
- Create: `src/lib/site-maintenance.ts`
- Modify: `src/types/cms.ts` (add `MaintenanceNotice`, beside `ProblemDetails`)
- Test: `tests/unit/maintenance.test.ts`

**Interfaces:**
- Produces, from `src/lib/site-maintenance.ts`:
  - `MAINTENANCE_TEMPLATES`, `type MaintenanceTemplate`
  - `interface MaintenanceWords { heading: string; message: string }`
  - `type MaintenanceCopy = Partial<Record<PostLocale, MaintenanceWords>>`
  - `interface MaintenanceSettings { backAt: string | null; copy: MaintenanceCopy; enabled: boolean; mediaId: string | null; template: MaintenanceTemplate }`
  - `DEFAULT_MAINTENANCE_WORDS: Readonly<Record<PostLocale, MaintenanceWords>>`
  - `maintenanceSchema`, `type MaintenanceMutation`, `maintenanceStateSchema`
  - `parseMaintenanceCopy(value: unknown): MaintenanceCopy`
  - `maintenanceWords(copy: MaintenanceCopy, locale: PostLocale): MaintenanceWords`
  - `isAhead(backAt: Date | string | null, now: Date): boolean`
  - `retryAfter(backAt: Date | string | null, now: Date): string | null`
  - `maintenanceLocale(url: URL, fallback: PostLocale): PostLocale`
  - `maintenanceNotice(settings: { maintenance_back_at: Date | null; maintenance_copy: MaintenanceCopy }, locale: PostLocale): MaintenanceNotice`
- Produces, from `src/types/cms.ts`:
  `interface MaintenanceNotice { backAt: string | null; heading: string; locale: PostLocale; message: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maintenance.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAINTENANCE_WORDS,
  isAhead,
  maintenanceLocale,
  maintenanceNotice,
  maintenanceSchema,
  maintenanceStateSchema,
  maintenanceWords,
  parseMaintenanceCopy,
  retryAfter,
} from '../../src/lib/site-maintenance';

const picture = '0F8FAD5B-D9CB-469F-A165-70867728950E';

test('a maintenance page is refused when its template lacks what it draws', () => {
  assert.equal(maintenanceSchema.safeParse({ template: 'picture' }).success, false, 'Picture needs a picture');
  assert.equal(maintenanceSchema.safeParse({ template: 'countdown' }).success, false, 'Countdown needs a time');
  assert.equal(maintenanceSchema.safeParse({ template: 'video' }).success, false, 'only the four templates');
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', extra: true }).success, false, 'nothing else rides along');

  const parsed = maintenanceSchema.parse({ template: 'picture', mediaId: picture });
  assert.equal(parsed.mediaId, picture.toLowerCase(), 'an id is kept in lower case');
  assert.deepEqual(parsed.copy, {}, 'no words is allowed');
  assert.equal(parsed.backAt, null);
  assert.ok(maintenanceSchema.parse({ template: 'countdown', backAt: '2030-01-01T02:00:00.000Z' }));
});

test('words are trimmed, bounded, and fall back to the product’s own in their language', () => {
  const parsed = maintenanceSchema.parse({ template: 'minimal', copy: { th: { heading: '  ปิดซ่อม  ', message: '' } } });
  assert.deepEqual(parsed.copy.th, { heading: 'ปิดซ่อม', message: '' });
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', copy: { en: { heading: 'x'.repeat(81) } } }).success, false, 'a heading over 80');
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', copy: { en: { message: 'x'.repeat(281) } } }).success, false, 'a message over 280');
  assert.equal(maintenanceSchema.safeParse({ template: 'minimal', copy: { de: { heading: 'Hallo' } } }).success, false, 'only the site’s languages');

  assert.deepEqual(maintenanceWords(parsed.copy, 'th'), { heading: 'ปิดซ่อม', message: 'เราจะกลับมาเร็ว ๆ นี้' });
  assert.deepEqual(maintenanceWords({}, 'en'), DEFAULT_MAINTENANCE_WORDS.en);
  assert.deepEqual(DEFAULT_MAINTENANCE_WORDS.th, { heading: 'ปิดปรับปรุงชั่วคราว', message: 'เราจะกลับมาเร็ว ๆ นี้' });
  assert.deepEqual(DEFAULT_MAINTENANCE_WORDS.en, { heading: 'Down for maintenance', message: 'We’ll be back soon.' });
});

test('stored words of the wrong shape read as none', () => {
  assert.deepEqual(parseMaintenanceCopy([]), {});
  assert.deepEqual(parseMaintenanceCopy(null), {});
  assert.deepEqual(parseMaintenanceCopy({ en: { heading: 'Back soon', message: '' } }), { en: { heading: 'Back soon', message: '' } });
});

test('a return time is ahead only while it has not come, and only then is it sent', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  assert.equal(isAhead(null, now), false);
  assert.equal(isAhead('2030-01-01T00:00:00.000Z', now), false, 'a time equal to now has passed');
  assert.equal(isAhead(new Date('2030-01-01T00:00:01.000Z'), now), true);
  assert.equal(retryAfter('2030-01-01T02:00:00.000Z', now), 'Tue, 01 Jan 2030 02:00:00 GMT');
  assert.equal(retryAfter('2029-12-31T23:00:00.000Z', now), null);
  assert.equal(retryAfter(null, now), null);
});

test('the page speaks the language of its path, then of the API’s query, then the site’s', () => {
  const at = (path: string) => maintenanceLocale(new URL(path, 'https://example.com'), 'en');
  assert.equal(at('/th/'), 'th');
  assert.equal(at('/th/blog/a-post'), 'th');
  assert.equal(at('/en'), 'en');
  assert.equal(at('/'), 'en');
  assert.equal(at('/blog/legacy'), 'en');
  assert.equal(at('/api/v1/content/posts?locale=th'), 'th');
  assert.equal(at('/api/v1/content/posts?locale=de'), 'en');
  assert.equal(maintenanceLocale(new URL('https://example.com/'), 'th'), 'th');
});

test('the notice a headless site is given says what the page would', () => {
  const backAt = new Date('2030-01-01T02:00:00.000Z');
  assert.deepEqual(maintenanceNotice({ maintenance_back_at: backAt, maintenance_copy: { th: { heading: 'ปิดซ่อม', message: '' } } }, 'th'), {
    backAt: '2030-01-01T02:00:00.000Z', heading: 'ปิดซ่อม', locale: 'th', message: 'เราจะกลับมาเร็ว ๆ นี้',
  });
  assert.equal(maintenanceNotice({ maintenance_back_at: null, maintenance_copy: {} }, 'en').backAt, null);
});

test('the switch takes a flag and nothing else', () => {
  assert.deepEqual(maintenanceStateSchema.parse({ enabled: true }), { enabled: true });
  assert.equal(maintenanceStateSchema.safeParse({ enabled: 'yes' }).success, false);
  assert.equal(maintenanceStateSchema.safeParse({ enabled: true, template: 'logo' }).success, false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/unit/maintenance.test.ts`
Expected: FAIL, `Cannot find module '../../src/lib/site-maintenance'`.

- [ ] **Step 3: Add the notice type**

In `src/types/cms.ts`, directly above `export interface ProblemDetails`, add:

```ts
/** What a closed site tells a headless client, in the language it asked for. */
export interface MaintenanceNotice {
  backAt: string | null;
  heading: string;
  locale: PostLocale;
  message: string;
}
```

- [ ] **Step 4: Write the rules**

Create `src/lib/site-maintenance.ts`:

```ts
import { z } from 'zod';

import type { MaintenanceNotice, PostLocale } from '../types/cms';

export const MAINTENANCE_TEMPLATES = ['minimal', 'logo', 'picture', 'countdown'] as const;
export type MaintenanceTemplate = (typeof MAINTENANCE_TEMPLATES)[number];

export interface MaintenanceWords { heading: string; message: string }
export type MaintenanceCopy = Partial<Record<PostLocale, MaintenanceWords>>;

/** The page as the admin edits it: the switch, and what a visitor would see. */
export interface MaintenanceSettings {
  backAt: string | null;
  copy: MaintenanceCopy;
  enabled: boolean;
  mediaId: string | null;
  template: MaintenanceTemplate;
}

/** What the page says where its owner wrote nothing: a site closed in a hurry still says something. */
export const DEFAULT_MAINTENANCE_WORDS: Readonly<Record<PostLocale, MaintenanceWords>> = {
  en: { heading: 'Down for maintenance', message: 'We’ll be back soon.' },
  th: { heading: 'ปิดปรับปรุงชั่วคราว', message: 'เราจะกลับมาเร็ว ๆ นี้' },
};

const wordsSchema = z.object({
  heading: z.string().trim().max(80).default(''),
  message: z.string().trim().max(280).default(''),
}).strict();

const copySchema = z.object({ en: wordsSchema.optional(), th: wordsSchema.optional() }).strict();

export const maintenanceSchema = z.object({
  backAt: z.iso.datetime({ offset: true }).nullable().default(null),
  copy: copySchema.default({}),
  mediaId: z.uuid().transform((id) => id.toLowerCase()).nullable().default(null),
  template: z.enum(MAINTENANCE_TEMPLATES),
}).strict().superRefine((page, context) => {
  if (page.template === 'picture' && !page.mediaId) {
    context.addIssue({ code: 'custom', message: 'Picture needs a picture.', path: ['mediaId'] });
  }
  if (page.template === 'countdown' && !page.backAt) {
    context.addIssue({ code: 'custom', message: 'Countdown needs a time to count down to.', path: ['backAt'] });
  }
});

export type MaintenanceMutation = z.infer<typeof maintenanceSchema>;

export const maintenanceStateSchema = z.object({ enabled: z.boolean() }).strict();

/** The stored words, or none: a value of any other shape reads as nothing written. */
export function parseMaintenanceCopy(value: unknown): MaintenanceCopy {
  const parsed = copySchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function maintenanceWords(copy: MaintenanceCopy, locale: PostLocale): MaintenanceWords {
  const written = copy[locale];
  const fallback = DEFAULT_MAINTENANCE_WORDS[locale];
  return { heading: written?.heading || fallback.heading, message: written?.message || fallback.message };
}

/** Whether the return time is still to come. A time equal to now has passed, as a slide's end has. */
export function isAhead(backAt: Date | string | null, now: Date): boolean {
  return backAt !== null && new Date(backAt).getTime() > now.getTime();
}

/** `Retry-After` as an HTTP date, or nothing once the time has come or when none was set. */
export function retryAfter(backAt: Date | string | null, now: Date): string | null {
  return backAt !== null && isAhead(backAt, now) ? new Date(backAt).toUTCString() : null;
}

/** The path's language first, then the API's `?locale=`, then the site's own. */
export function maintenanceLocale(url: URL, fallback: PostLocale): PostLocale {
  const first = url.pathname.split('/')[1];
  if (first === 'th' || first === 'en') return first;
  const asked = url.searchParams.get('locale');
  return asked === 'th' || asked === 'en' ? asked : fallback;
}

export function maintenanceNotice(
  settings: { maintenance_back_at: Date | null; maintenance_copy: MaintenanceCopy },
  locale: PostLocale,
): MaintenanceNotice {
  return {
    ...maintenanceWords(settings.maintenance_copy, locale),
    backAt: settings.maintenance_back_at?.toISOString() ?? null,
    locale,
  };
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `node --import tsx --test tests/unit/maintenance.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Check the guards**

Put back each bug and watch its test fail, then undo:
- `>` → `>=` in `isAhead` (the edge test fails).
- remove the `countdown` branch of `superRefine`.
- `written?.heading || fallback.heading` → `written?.heading ?? fallback.heading` (an empty heading
  is then drawn empty).

- [ ] **Step 7: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(maintenance): the rules a closed site keeps

Four templates, the owner's words with the product's own in their place
when none are written, a return time that counts only while it is ahead,
and the language a page or an API answer speaks.
```

```bash
git add src/lib/site-maintenance.ts src/types/cms.ts tests/unit/maintenance.test.ts
```

Then `git commit -F <message file>`.

---

### Task 2: The columns

**Files:**
- Create: `src/server/db/migrations/024_site_maintenance.ts`
- Modify: `src/server/db/migrator.ts` (import and register `024_site_maintenance`)
- Modify: `src/server/db/types.ts` (`SiteSettingsTable`)
- Modify: `src/server/content/settings.ts` (parse `maintenance_copy`)
- Modify: `tests/unit/db-migrator.test.ts:11`
- Modify: `tests/unit/public-serialization.test.ts` (the `serializePublicSite` fixture)
- Create: `tests/integration/maintenance-schema.test.ts`

**Interfaces:**
- Consumes: `parseMaintenanceCopy`, `MaintenanceCopy` (Task 1).
- Produces: `site_settings.maintenance_enabled | maintenance_template | maintenance_copy |
  maintenance_media_id | maintenance_back_at`; `SiteSettings` (from `src/server/content/settings.ts`)
  with `maintenance_copy: MaintenanceCopy`, `maintenance_back_at: Date | null`,
  `maintenance_enabled: boolean`, `maintenance_media_id: string | null`,
  `maintenance_template: MaintenanceTemplate`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/maintenance-schema.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('the maintenance columns refuse a page that breaks a rule', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { sql } = await import('kysely');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'maintenance@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Closed', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const image = await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'A quiet street',
    state: 'ready', delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`,
    original_name: 'street.jpg', mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow();

  const columns = ['maintenance_enabled', 'maintenance_template', 'maintenance_copy', 'maintenance_media_id', 'maintenance_back_at'] as const;
  assert.deepEqual(await db.selectFrom('site_settings').select(columns).executeTakeFirstOrThrow(), {
    maintenance_enabled: false, maintenance_template: 'minimal', maintenance_copy: {}, maintenance_media_id: null, maintenance_back_at: null,
  }, 'a site starts open, on the plainest page');

  const set = (values: Record<string, unknown>) => db.updateTable('site_settings').set(values as never).where('id', '=', true).execute();
  const refused = async (why: string, values: Record<string, unknown>, code = '23514') => {
    await assert.rejects(set(values), (error: unknown) => (error as { code?: string }).code === code, why);
  };

  await refused('a template the core does not draw', { maintenance_template: 'video' });
  await refused('no template at all', { maintenance_template: null }, '23502');
  await refused('Picture without a picture', { maintenance_template: 'picture' });
  await refused('Picture with its picture set to null', { maintenance_template: 'picture', maintenance_media_id: null });
  await refused('Countdown without a time', { maintenance_template: 'countdown', maintenance_back_at: null });
  await refused('words that are not an object', { maintenance_copy: sql`'[]'::jsonb` });
  await refused('a picture that is not in the library', { maintenance_media_id: randomUUID() }, '23503');

  await set({ maintenance_template: 'picture', maintenance_media_id: image.id });
  await assert.rejects(
    db.deleteFrom('media_items').where('id', '=', image.id).execute(),
    (error: unknown) => (error as { code?: string }).code === '23503',
    'the picture the page uses cannot be deleted under it',
  );

  // Down and up again: the migration can be taken back, and put back.
  await set({ maintenance_template: 'minimal', maintenance_media_id: null });
  const { Migrator } = await import('kysely/migration');
  const { migrations } = await import('../../src/server/db/migrator');
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  const has = async () => (await sql<{ found: boolean }>`select exists (
    select 1 from information_schema.columns where table_name = 'site_settings' and column_name = 'maintenance_enabled'
  ) as found`.execute(db)).rows[0]!.found;
  assert.ifError((await migrator.migrateTo('023_home_slides')).error);
  assert.equal(await has(), false, 'down drops the columns');
  assert.ifError((await migrator.migrateToLatest()).error);
  assert.equal(await has(), true, 'and up adds them again');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/test-foundation.mjs tests/integration/maintenance-schema.test.ts`
Expected: FAIL, `column "maintenance_enabled" does not exist`.

- [ ] **Step 3: Write the migration**

Create `src/server/db/migrations/024_site_maintenance.ts`:

```ts
import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The owner's switch for closing the site, and the page visitors see while it is closed.
 *
 * On the settings row, which the middleware already reads on every request, so the switch costs
 * no query and takes effect on the next one. A template is refused without what it draws, and
 * the library may not delete the picture from under the page. The words are an object whose
 * shape is checked where it is read (src/lib/site-maintenance.ts).
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table site_settings
      add column maintenance_enabled boolean not null default false,
      add column maintenance_template text not null default 'minimal',
      add column maintenance_copy jsonb not null default '{}'::jsonb,
      add column maintenance_media_id uuid,
      add column maintenance_back_at timestamptz,
      add constraint site_settings_maintenance_template_check
        check (maintenance_template in ('minimal', 'logo', 'picture', 'countdown')),
      add constraint site_settings_maintenance_copy_check check (jsonb_typeof(maintenance_copy) = 'object'),
      add constraint site_settings_maintenance_picture_check
        check (maintenance_template <> 'picture' or maintenance_media_id is not null),
      add constraint site_settings_maintenance_countdown_check
        check (maintenance_template <> 'countdown' or maintenance_back_at is not null),
      add constraint site_settings_maintenance_media_fkey
        foreign key (maintenance_media_id, owner_id) references media_items(id, owner_id) on delete restrict
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table site_settings
      drop constraint site_settings_maintenance_media_fkey,
      drop column maintenance_back_at,
      drop column maintenance_media_id,
      drop column maintenance_copy,
      drop column maintenance_template,
      drop column maintenance_enabled
  `.execute(db);
}
```

In `src/server/db/migrator.ts`, after the `023_home_slides` import add
`import * as siteMaintenance from './migrations/024_site_maintenance';` and after
`'023_home_slides': homeSlides,` add `'024_site_maintenance': siteMaintenance,`.

- [ ] **Step 4: Type the columns**

In `src/server/db/types.ts`, inside `SiteSettingsTable`, after `hide_site_name`, add:

```ts
  maintenance_enabled: Generated<boolean>;
  maintenance_template: Generated<'minimal' | 'logo' | 'picture' | 'countdown'>;
  /** { th?: { heading, message }, en?: { heading, message } } -- see migrations/024_site_maintenance. */
  maintenance_copy: Generated<unknown>;
  maintenance_media_id: string | null;
  maintenance_back_at: Timestamp | null;
```

In `src/server/content/settings.ts`:
- import `parseMaintenanceCopy` and `type MaintenanceCopy` from `'../../lib/site-maintenance'`;
- change `type ParsedColumns` to add `| 'maintenance_copy'`;
- add `maintenance_copy: MaintenanceCopy;` to the `SiteSettings` intersection;
- add `maintenance_copy: parseMaintenanceCopy(row.maintenance_copy),` to `normalizeSettings`.

In `tests/unit/db-migrator.test.ts:11` change `'023_home_slides'` to `'024_site_maintenance'`.

In `tests/unit/public-serialization.test.ts`, in the object passed to `serializePublicSite`, after
`hide_site_name: false,` add:

```ts
    maintenance_back_at: null,
    maintenance_copy: {},
    maintenance_enabled: false,
    maintenance_media_id: null,
    maintenance_template: 'minimal' as const,
```

- [ ] **Step 5: Run it to see it pass**

Run: `node scripts/test-foundation.mjs tests/integration/maintenance-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Check the guards**

Put back each and watch the test fail, then undo: drop `site_settings_maintenance_countdown_check`
from `up`; change the foreign key to `on delete set null`.

- [ ] **Step 7: Gates and commit**

Run `npm run test:unit`, then `npm run check` (0 errors, 0 warnings). Message file:

```
feat(maintenance): the switch and the page on the settings row

Five columns: whether the site is closed, which of four templates it
shows, the owner's words, the picture and the return time. A template is
refused without what it draws, and the library cannot delete the picture
the page uses.
```

```bash
git add src/server/db/migrations/024_site_maintenance.ts src/server/db/migrator.ts src/server/db/types.ts src/server/content/settings.ts tests/unit/db-migrator.test.ts tests/unit/public-serialization.test.ts tests/integration/maintenance-schema.test.ts
```

---

### Task 3: Saving and switching

**Files:**
- Create: `src/server/content/site-maintenance.ts`
- Create: `src/pages/api/admin/maintenance/index.ts`
- Create: `src/pages/api/admin/maintenance/state.ts`
- Modify: `src/types/cms.ts` (`MediaReferences`)
- Modify: `src/server/media/service.ts` (`findMediaReferences`)
- Test: `tests/integration/maintenance.test.ts`

**Interfaces:**
- Consumes: `maintenanceSchema`, `MaintenanceMutation`, `MaintenanceSettings`, `parseMaintenanceCopy`
  (Task 1); the columns (Task 2).
- Produces, from `src/server/content/site-maintenance.ts`:
  - `readMaintenance(ownerId: string): Promise<{ maintenance: MaintenanceSettings; media: HomeSlideMedia | null }>`
  - `saveMaintenance(ownerId: string, input: MaintenanceMutation): Promise<MaintenanceSettings>`
  - `setMaintenanceState(ownerId: string, enabled: boolean): Promise<MaintenanceSettings>`
- Produces routes: `GET` and `PUT /api/admin/maintenance` (`{ maintenance, media }` and
  `{ maintenance }`), `PUT /api/admin/maintenance/state` (`{ maintenance }`).
- Produces: `MediaReferences.maintenance: boolean` and `MediaReferences.counts.maintenance: number`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/maintenance.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { MediaReferences } from '../../src/types/cms';

test('the page is saved apart from the switch, points only at this site’s pictures, and is named by the library', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { maintenanceSchema } = await import('../../src/lib/site-maintenance');
  const { readMaintenance, saveMaintenance, setMaintenanceState } = await import('../../src/server/content/site-maintenance');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const owner = async (email: string) => {
    const id = randomUUID();
    await db.insertInto('user').values({ id, name: 'Owner', email, emailVerified: true, image: null, role: 'owner' }).execute();
    return id;
  };
  const ownerId = await owner('closed@example.invalid');
  const strangerId = await owner('stranger@example.invalid');
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Closed', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const before = (await db.selectFrom('site_settings').select('updated_at').executeTakeFirstOrThrow()).updated_at;
  const media = async (values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready', delete_error_code: null,
    object_key: `owners/${ownerId}/2026/09/${randomUUID()}`, original_name: 'file', mime_type: 'image/jpeg',
    size_bytes: 400_000, width: 2400, height: 1350, alt_text: null, ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const street = await media({});
  const guide = await media({ mime_type: 'application/pdf', width: null, height: null });
  const theirs = await media({ owner_id: strangerId, object_key: `owners/${strangerId}/2026/09/${randomUUID()}` });

  const empty = await readMaintenance(ownerId);
  assert.deepEqual(empty, {
    maintenance: { backAt: null, copy: {}, enabled: false, mediaId: null, template: 'minimal' },
    media: null,
  }, 'an open site on the plainest page');

  await setMaintenanceState(ownerId, true);
  const saved = await saveMaintenance(ownerId, maintenanceSchema.parse({
    backAt: '2030-01-01T02:00:00.000Z',
    copy: { th: { heading: 'ปิดซ่อม', message: '' } },
    mediaId: street,
    template: 'picture',
  }));
  assert.deepEqual(saved, {
    backAt: '2030-01-01T02:00:00.000Z',
    copy: { th: { heading: 'ปิดซ่อม', message: '' } },
    enabled: true,
    mediaId: street,
    template: 'picture',
  }, 'saving keeps the switch where it was');
  const read = await readMaintenance(ownerId);
  assert.equal(read.media?.id, street);
  assert.equal(read.media?.publicUrl, `/media/${street}`);
  assert.equal((await setMaintenanceState(ownerId, false)).enabled, false);
  assert.equal(
    (await db.selectFrom('site_settings').select('updated_at').executeTakeFirstOrThrow()).updated_at.getTime(),
    before.getTime(),
    'neither moves the settings row’s version',
  );

  for (const [why, mediaId] of [['a document', guide], ['another owner’s picture', theirs], ['a picture that is not there', randomUUID()]] as const) {
    await assert.rejects(
      saveMaintenance(ownerId, maintenanceSchema.parse({ template: 'picture', mediaId })),
      (error: unknown) => error instanceof HttpError && error.status === 400,
      why,
    );
  }

  await assert.rejects(deleteMedia(ownerId, street), (error: unknown) => {
    assert.ok(error instanceof HttpError && error.status === 409, 'refused as a conflict');
    const references = (error as { details?: { references?: MediaReferences } }).details?.references;
    assert.equal(references?.maintenance, true, 'and the maintenance page is named');
    assert.equal(references?.counts.maintenance, 1);
    return true;
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/test-foundation.mjs tests/integration/maintenance.test.ts`
Expected: FAIL, `Cannot find module '../../src/server/content/site-maintenance'`.

- [ ] **Step 3: Write the server module**

Create `src/server/content/site-maintenance.ts`:

```ts
import { sql, type Selectable } from 'kysely';

import { parseMaintenanceCopy, type MaintenanceMutation, type MaintenanceSettings } from '../../lib/site-maintenance';
import type { HomeSlideMedia, Json } from '../../types/cms';
import { db } from '../db/client';
import type { SiteSettingsTable } from '../db/types';
import { HttpError } from '../http/errors';
import { assertReadyMediaReferences } from '../media/service';
import { stableMediaPath } from '../media/url';

/**
 * The owner's maintenance page and switch. Named apart from src/server/update/maintenance.ts,
 * which is the updater's and has nothing to do with this.
 *
 * Neither write moves site_settings.updated_at. That column is the Settings form's version and
 * the public Last-Modified; closing the site changes neither the settings nor the content, and
 * moving it would refuse the next save of a Settings form open in another tab.
 */

const COLUMNS = ['maintenance_back_at', 'maintenance_copy', 'maintenance_enabled', 'maintenance_media_id', 'maintenance_template'] as const;
type MaintenanceColumns = Pick<Selectable<SiteSettingsTable>, (typeof COLUMNS)[number]>;

function settingsOf(row: MaintenanceColumns): MaintenanceSettings {
  return {
    backAt: row.maintenance_back_at?.toISOString() ?? null,
    copy: parseMaintenanceCopy(row.maintenance_copy),
    enabled: row.maintenance_enabled,
    mediaId: row.maintenance_media_id,
    template: row.maintenance_template,
  };
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

export async function readMaintenance(ownerId: string): Promise<{ maintenance: MaintenanceSettings; media: HomeSlideMedia | null }> {
  const row = await db.selectFrom('site_settings').select(COLUMNS)
    .where('id', '=', true).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!row) throw new HttpError(404, 'Site settings not found.');
  const picture = row.maintenance_media_id
    ? await db.selectFrom('media_items').select(['id', 'alt_text', 'width', 'height', 'size_bytes'])
      .where('id', '=', row.maintenance_media_id).where('owner_id', '=', ownerId).executeTakeFirst()
    : undefined;
  return {
    maintenance: settingsOf(row),
    media: picture?.width && picture.height
      ? { ...picture, height: picture.height, publicUrl: stableMediaPath(picture.id), width: picture.width }
      : null,
  };
}

export async function saveMaintenance(ownerId: string, input: MaintenanceMutation): Promise<MaintenanceSettings> {
  try {
    await assertReadyMediaReferences(db, ownerId, input.mediaId ? [input.mediaId] : []);
    const row = await db.updateTable('site_settings')
      .set({
        maintenance_back_at: input.backAt,
        maintenance_copy: sql<Json>`${JSON.stringify(input.copy)}::jsonb`,
        maintenance_media_id: input.mediaId,
        maintenance_template: input.template,
      })
      .where('id', '=', true).where('owner_id', '=', ownerId)
      .returning(COLUMNS)
      .executeTakeFirst();
    if (!row) throw new HttpError(404, 'Site settings not found.');
    return settingsOf(row);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (['22P02', '23503', '23514'].includes(postgresCode(error) ?? '')) throw new HttpError(400, 'Invalid maintenance page.');
    throw error;
  }
}

export async function setMaintenanceState(ownerId: string, enabled: boolean): Promise<MaintenanceSettings> {
  const row = await db.updateTable('site_settings').set({ maintenance_enabled: enabled })
    .where('id', '=', true).where('owner_id', '=', ownerId)
    .returning(COLUMNS)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'Site settings not found.');
  return settingsOf(row);
}
```

- [ ] **Step 4: Name the page in the library's refusal**

In `src/types/cms.ts`, `MediaReferences`: add `maintenance: number;` to `counts` (after `postCovers`)
and `maintenance: boolean;` as a member (after `counts`).

In `src/server/media/service.ts`, `findMediaReferences`: add a sixth query to the `Promise.all`
and name it `maintenance`:

```ts
    trx.selectFrom('site_settings').select('id').where('owner_id', '=', ownerId).where('maintenance_media_id', '=', id).executeTakeFirst(),
```

and return `maintenance: maintenance ? 1 : 0,` inside `counts` and `maintenance: Boolean(maintenance),`
beside `profile`.

- [ ] **Step 5: Write the routes**

Create `src/pages/api/admin/maintenance/index.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { maintenanceSchema } from '../../../../lib/site-maintenance';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { readMaintenance, saveMaintenance } from '../../../../server/content/site-maintenance';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

function guardOrigin(request: Request): void {
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

export const GET: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    return Response.json(await readMaintenance(current.user.id), {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

/** The page alone. The switch has a route of its own, so saving never closes the site. */
export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    const input = await parseJson(request, maintenanceSchema);
    const maintenance = await saveMaintenance(current.user.id, input);
    return Response.json({ maintenance }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
```

Create `src/pages/api/admin/maintenance/state.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { maintenanceStateSchema } from '../../../../lib/site-maintenance';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { setMaintenanceState } from '../../../../server/content/site-maintenance';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { parseJson } from '../../../../server/http/json';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;

/** Opens or closes the site, and nothing else. */
export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const { enabled } = await parseJson(request, maintenanceStateSchema);
    const maintenance = await setMaintenanceState(current.user.id, enabled);
    return Response.json({ maintenance }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
```

- [ ] **Step 6: Run it to see it pass**

Run: `node scripts/test-foundation.mjs tests/integration/maintenance.test.ts`
Expected: PASS. Then run the slides' library test to see the widened references still hold:
`node scripts/test-foundation.mjs tests/integration/home-slides-media.test.ts` — PASS.

- [ ] **Step 7: Check the guards**

Put back each and watch the test fail, then undo: `maintenance_enabled: input.template === 'picture'`
added to `saveMaintenance`'s `set` (the switch moves on save); drop the `assertReadyMediaReferences`
call (the document is accepted); drop the `site_settings` query from `findMediaReferences`.

- [ ] **Step 8: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(maintenance): the page is saved apart from the switch

The admin reads and saves the maintenance page on one route and opens
or closes the site on another, so saving never closes it. The picture
must be a ready image of this site's, and the library names the page
when it refuses to delete it.
```

```bash
git add src/server/content/site-maintenance.ts src/pages/api/admin/maintenance/index.ts src/pages/api/admin/maintenance/state.ts src/types/cms.ts src/server/media/service.ts tests/integration/maintenance.test.ts
```

---

### Task 4: The closed site

**Files:**
- Modify: `src/middleware.ts` (the gate and `maintenanceRoute`)
- Modify: `src/env.d.ts` (`Locals`)
- Create: `src/pages/maintenance.astro`
- Create: `src/components/maintenance/MaintenancePage.astro`
- Create: `src/styles/maintenance.css`
- Modify: `src/lib/i18n.ts` (`publicCopy`)
- Modify: `src/layouts/BaseLayout.astro` (the owner's bar)
- Modify: `src/styles/global.css` (`.site-maintenance-bar`)
- Modify: `src/types/cms.ts` (`ProblemDetails.maintenance`)
- Modify: `src/server/http/public-schemas.ts` (`problemDetailsSchema`)
- Modify: `src/server/http/problem.ts` (`problem` options)
- Modify: `src/server/http/openapi.ts` (the `ServiceUnavailable` description)
- Modify: `tests/unit/maintenance.test.ts` (append)
- Create: `tests/e2e/maintenance.spec.ts`

**Interfaces:**
- Consumes: Task 1's functions; `SiteSettings` with the maintenance columns (Task 2).
- Produces: `maintenanceRoute(pathname: string): 'api' | 'feed' | 'page' | null` exported from
  `src/middleware.ts`; `App.Locals.maintenance?: { locale: PostLocale; settings: SiteSettings }`
  and `App.Locals.maintenanceOwner?: boolean`; the component
  `src/components/maintenance/MaintenancePage.astro` with props
  `{ locale: PostLocale; settings: SiteSettings }`, which Task 5's preview route renders.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/maintenance.test.ts`:

```ts
import { maintenanceRoute } from '../../src/middleware';
import { problem } from '../../src/server/http/problem';

test('the gate closes pages, feeds and the content API, and leaves everything else open', () => {
  for (const path of ['/', '/th', '/en/', '/th/blog/a-post', '/en/about', '/blog/legacy-post']) {
    assert.equal(maintenanceRoute(path), 'page', path);
  }
  for (const path of ['/sitemap.xml', '/rss.xml']) assert.equal(maintenanceRoute(path), 'feed', path);
  for (const path of ['/api/v1/content/posts', '/api/v1/content/posts/a-post', '/api/v1/content/site', '/api/v1/content/slides']) {
    assert.equal(maintenanceRoute(path), 'api', path);
  }
  for (const path of [
    '/admin', '/admin/maintenance', '/backstage', '/api/admin/maintenance', '/api/auth/session', '/install',
    '/api/install/status', '/recovery', '/api/recovery/enroll', '/health/live', '/health/ready', '/_astro/page.js',
    '/media/0f8fad5b-d9cb-469f-a165-70867728950e', '/favicon.svg', '/api/v1/content/openapi.json',
    '/api/v1/content/preview/a-token', '/maintenance', '/robots.txt',
  ]) assert.equal(maintenanceRoute(path), null, path);
});

test('a problem can carry the maintenance notice, and the schema says so', async () => {
  const notice = { backAt: null, heading: 'ปิดซ่อม', locale: 'th' as const, message: 'เราจะกลับมาเร็ว ๆ นี้' };
  const response = problem(new Request('https://example.com/api/v1/content/posts'), 503, 'The site is closed for maintenance.', { maintenance: notice });
  assert.equal(response.status, 503);
  const body = await response.json() as { maintenance?: unknown; status: number };
  assert.deepEqual(body.maintenance, notice);
  const plain = await problem(new Request('https://example.com/api/v1/content/posts'), 503, 'Not ready.').json() as Record<string, unknown>;
  assert.equal('maintenance' in plain, false, 'an ordinary 503 carries none');
});
```

Move the two new `import` lines to the top of the file with the others.

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/maintenance.test.ts`
Expected: FAIL, `maintenanceRoute` is not exported and `problem` refuses the `maintenance` member.

- [ ] **Step 3: Let a problem carry the notice**

In `src/types/cms.ts`, add `maintenance?: MaintenanceNotice;` to `ProblemDetails`.

In `src/server/http/public-schemas.ts`, add to `problemDetailsSchema`'s object, before `requestId`:

```ts
  maintenance: z.object({
    backAt: z.iso.datetime().nullable(),
    heading: z.string().min(1),
    locale: z.enum(POST_LOCALES),
    message: z.string().min(1),
  }).strict().optional(),
```

In `src/server/http/problem.ts`, import `type MaintenanceNotice` from `'../../types/cms'`, widen the
options to `{ cors?: boolean; error?: unknown; maintenance?: MaintenanceNotice; startedAt?: number }`,
and add `...(options.maintenance ? { maintenance: options.maintenance } : {}),` to the object passed
to `problemDetailsSchema.parse`, after `requestId`.

In `src/server/http/openapi.ts`, change the `ServiceUnavailable` description to
`'The content service is not ready, or the site is closed for maintenance; then `maintenance` carries what the owner wrote for visitors.'`.

- [ ] **Step 4: Type the locals**

In `src/env.d.ts`, add the imports and the two members:

```ts
import type { BetterAuthSession, BetterAuthUser } from './server/auth/session';
import type { SiteSettings } from './server/content/settings';
import type { PostLocale } from './types/cms';

declare global {
  namespace App {
    interface Locals {
      session: BetterAuthSession | null;
      user: BetterAuthUser | null;
      /** Set by the gate on a page it closed: which language to draw the maintenance page in. */
      maintenance?: { locale: PostLocale; settings: SiteSettings };
      /** Set by the gate when the signed-in owner is let through a closed site. */
      maintenanceOwner?: boolean;
    }
  }
}
```

- [ ] **Step 5: Write the gate**

In `src/middleware.ts`, after `isBundledFrontendPath`, add:

```ts
/**
 * What a closed site does with a path: draw the maintenance page, refuse a feed, refuse the
 * content API with the owner's words -- or leave it alone. Everything that is not a reader's
 * page or the public content stays open: the admin, sign-in, health, media, the API's own
 * description and the owner's previews.
 */
export function maintenanceRoute(pathname: string): 'api' | 'feed' | 'page' | null {
  if (pathname === '/sitemap.xml' || pathname === '/rss.xml') return 'feed';
  if (isBundledFrontendPath(pathname)) return 'page';
  if (!pathname.startsWith('/api/v1/content/')) return null;
  if (pathname === '/api/v1/content/openapi.json') return null;
  if (pathname === '/api/v1/content/preview' || pathname.startsWith('/api/v1/content/preview/')) return null;
  return 'api';
}
```

After `routeConfiguredAdmin`, add:

```ts
const CLOSED = 'The site is closed for maintenance.';

/**
 * A site closed for maintenance. A visitor gets 503 -- the page rewritten in place, so the address
 * does not change and a crawler sees the 503 where the page lives. The signed-in owner passes
 * through, marked private so no cache keeps what they were shown. Only while the site is closed
 * does a public request read the session at all.
 */
async function closedForMaintenance(context: APIContext, next: MiddlewareNext, settings: SiteSettings): Promise<Response | null> {
  if (!settings.maintenance_enabled) return null;
  const { pathname } = context.url;
  const route = maintenanceRoute(pathname);
  // A preflight answered 503 would hide the 503 that follows it from a headless site's browser.
  if (!route || (route === 'api' && context.request.method === 'OPTIONS')) return null;
  if (matchAdminPath(pathname, normalizeAdminPath(settings.admin_path)) !== null) return null;

  if (await setBetterAuthLocals(context, settings.owner_id)) {
    context.locals.maintenanceOwner = true;
    const response = await next();
    const own = new Response(response.body, response);
    own.headers.set('Cache-Control', 'private, no-store');
    return own;
  }

  const { maintenanceLocale, maintenanceNotice, retryAfter } = await import('./lib/site-maintenance');
  const locale = maintenanceLocale(context.url, settings.default_locale);
  if (route === 'page') {
    context.locals.maintenance = { locale, settings };
    return next('/maintenance');
  }
  const response = route === 'feed'
    ? new Response(`${CLOSED}\n`, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }, status: 503 })
    : (await import('./server/http/problem')).problem(context.request, 503, CLOSED, { maintenance: maintenanceNotice(settings, locale) });
  const retry = retryAfter(settings.maintenance_back_at, new Date());
  if (retry) response.headers.set('Retry-After', retry);
  return response;
}
```

In `preparedHeadlessRequest`, replace the last line `return routeConfiguredAdmin(context, next, settings);` with:

```ts
  const closed = await closedForMaintenance(context, next, settings);
  if (closed) return closed;
  return routeConfiguredAdmin(context, next, settings);
```

Run: `node --import tsx --test tests/unit/maintenance.test.ts` — PASS.

- [ ] **Step 6: The words a visitor reads**

In `src/lib/i18n.ts`, `publicCopy`, add to the Thai object:

```ts
      maintenanceBack: 'กลับมาประมาณ {when}',
      maintenanceBar: 'เว็บปิดปรับปรุงอยู่ ผู้เยี่ยมชมจะเห็นหน้าปิดปรับปรุง',
      maintenanceDays: 'วัน',
      maintenanceHours: 'ชั่วโมง',
      maintenanceManage: 'ตั้งค่าปิดปรับปรุง',
      maintenanceMinutes: 'นาที',
      maintenanceSeconds: 'วินาที',
      maintenanceSoon: 'กลับมาในอีกไม่ช้า',
```

and to the English object:

```ts
      maintenanceBack: 'Back around {when}',
      maintenanceBar: 'The site is closed for maintenance. Visitors see the maintenance page.',
      maintenanceDays: 'days',
      maintenanceHours: 'hours',
      maintenanceManage: 'Maintenance settings',
      maintenanceMinutes: 'minutes',
      maintenanceSeconds: 'seconds',
      maintenanceSoon: 'Back any moment now',
```

- [ ] **Step 7: Write the page**

Create `src/components/maintenance/MaintenancePage.astro`:

```astro
---
/**
 * The page a visitor meets while the site is closed, in one of four templates.
 *
 * The core's, not the theme's: a theme broken by the very work maintenance is for must not take
 * this page down with it. Tokens from installer-tokens.css, the single source of every token.
 * Only Countdown runs script, and a reader without it still reads the return time in words.
 */
import { dateLocale, publicCopy } from '../../lib/i18n';
import { iconLinks, siteBrand } from '../../lib/site-brand';
import { isAhead, maintenanceWords } from '../../lib/site-maintenance';
import { normalizeTheme, themeAttribute } from '../../lib/theme';
import type { SiteSettings } from '../../server/content/settings';
import { resolveMediaUrl, stableMediaPath } from '../../server/media/url';
import type { PostLocale } from '../../types/cms';
import '../../styles/installer-tokens.css';
import '../../styles/maintenance.css';

interface Props {
  locale: PostLocale;
  settings: SiteSettings;
}

const { locale, settings } = Astro.props;
const now = new Date();
const text = publicCopy(locale);
const words = maintenanceWords(settings.maintenance_copy, locale);
const brand = siteBrand(settings, resolveMediaUrl);
const template = settings.maintenance_template;
const backAt = settings.maintenance_back_at;
const ahead = isAhead(backAt, now);
const when = backAt
  ? new Intl.DateTimeFormat(dateLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: settings.timezone }).format(backAt)
  : null;
const picture = template === 'picture' && settings.maintenance_media_id ? stableMediaPath(settings.maintenance_media_id) : null;
const clock = template === 'countdown' && ahead && backAt;
const units = [
  ['days', text.maintenanceDays], ['hours', text.maintenanceHours],
  ['minutes', text.maintenanceMinutes], ['seconds', text.maintenanceSeconds],
] as const;
---

<!doctype html>
<html data-theme={themeAttribute(normalizeTheme(settings.theme))} lang={locale}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>{words.heading} · {settings.site_name}</title>
    {iconLinks(brand.icon).map((link) => <link {...link} />)}
    <link rel="stylesheet" href="/fonts.css" />
  </head>
  <body class="maintenance" data-template={template}>
    {picture && <img alt="" class="maintenance__picture" decoding="async" fetchpriority="high" src={picture} />}
    <main class="maintenance__main">
      {template === 'logo' && (brand.logo ? (
        <span class:list={['maintenance__logos', { 'maintenance__logos--has-dark': brand.logoDark }]}>
          <img alt={settings.site_name} class="maintenance__logo maintenance__logo--light" height={brand.logo.height} src={brand.logo.url} width={brand.logo.width} />
          {brand.logoDark && <img alt={settings.site_name} class="maintenance__logo maintenance__logo--dark" height={brand.logoDark.height} src={brand.logoDark.url} width={brand.logoDark.width} />}
        </span>
      ) : <p class="maintenance__logo-name">{settings.site_name}</p>)}
      <h1>{words.heading}</h1>
      <p class="maintenance__message">{words.message}</p>
      {clock && (
        <div aria-hidden="true" class="maintenance__clock" data-countdown data-until={clock.toISOString()} hidden>
          {units.map(([unit, label]) => <span class="maintenance__unit"><strong data-unit={unit}>00</strong><span>{label}</span></span>)}
        </div>
      )}
      {when && ahead && <p class="maintenance__back" data-back-at>{text.maintenanceBack.replace('{when}', when)}</p>}
      <p class="maintenance__back" data-back-soon hidden={!(when && !ahead)}>{text.maintenanceSoon}</p>
      {template !== 'logo' && <p class="maintenance__name">{settings.site_name}</p>}
    </main>
    <script>
      // Ticks toward the owner's return time. The time is also written out in words above, so a
      // reader without script, or with a screen reader, loses only the ticking.
      const clock = document.querySelector<HTMLElement>('[data-countdown]');
      if (clock) {
        const until = Date.parse(clock.dataset.until ?? '');
        const digits = ['days', 'hours', 'minutes', 'seconds'].map((unit) => clock.querySelector<HTMLElement>(`[data-unit="${unit}"]`));
        const tick = () => {
          const left = Math.floor((until - Date.now()) / 1000);
          if (!(left > 0)) {
            clock.hidden = true;
            document.querySelector<HTMLElement>('[data-back-at]')?.setAttribute('hidden', '');
            document.querySelector<HTMLElement>('[data-back-soon]')?.removeAttribute('hidden');
            return;
          }
          const values = [Math.floor(left / 86_400), Math.floor(left / 3_600) % 24, Math.floor(left / 60) % 60, left % 60];
          values.forEach((value, index) => { digits[index]!.textContent = String(value).padStart(2, '0'); });
          clock.hidden = false;
          setTimeout(tick, 1_000 - (Date.now() % 1_000));
        };
        tick();
      }
    </script>
  </body>
</html>
```

Create `src/styles/maintenance.css`:

```css
/* The maintenance page (src/components/maintenance/MaintenancePage.astro). Every value is a
 * token from installer-tokens.css, which also answers light, dark and the reader's system. */

.maintenance {
  display: grid;
  min-height: 100dvh;
  margin: 0;
  place-items: center start;
  padding: var(--space-2xl) clamp(var(--space-md), 8vw, var(--space-3xl));
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-body);
}

.maintenance__main { display: grid; gap: var(--space-md); max-width: 36rem; }
.maintenance h1 { margin: 0; font-family: var(--font-display); font-size: var(--text-display); line-height: 1.1; text-wrap: balance; }
.maintenance__message { margin: 0; color: var(--color-muted); font-size: var(--text-md); line-height: 1.6; }
.maintenance__back { margin: 0; font-size: var(--text-sm); }
.maintenance__back[hidden] { display: none; }
.maintenance__name { margin: var(--space-xl) 0 0; color: var(--color-muted); font-size: var(--text-sm); }

/* Logo and Countdown sit in the middle; Minimal and Picture read from the left, like a page. */
.maintenance[data-template='logo'],
.maintenance[data-template='countdown'] { place-items: center; text-align: center; }
.maintenance[data-template='logo'] .maintenance__main,
.maintenance[data-template='countdown'] .maintenance__main { justify-items: center; }

.maintenance__logo { width: auto; max-width: min(12rem, 60vw); height: auto; max-height: 6rem; margin-block-end: var(--space-lg); }
.maintenance__logo-name { margin: 0 0 var(--space-lg); font-family: var(--font-display); font-size: var(--text-xl); }
.maintenance__logo--dark { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .maintenance__logos--has-dark .maintenance__logo--light { display: none; }
  :root:not([data-theme='light']) .maintenance__logos--has-dark .maintenance__logo--dark { display: block; }
}
:root[data-theme='dark'] .maintenance__logos--has-dark .maintenance__logo--light { display: none; }
:root[data-theme='dark'] .maintenance__logos--has-dark .maintenance__logo--dark { display: block; }

/* Picture: the owner's picture behind the words, darkened enough to read them on. */
.maintenance[data-template='picture'] { position: relative; isolation: isolate; background: var(--color-hero); color: var(--color-on-dark); }
.maintenance__picture { position: fixed; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; }
.maintenance[data-template='picture']::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background: linear-gradient(to top, color-mix(in oklch, var(--color-hero) 88%, transparent), color-mix(in oklch, var(--color-hero) 50%, transparent));
}
.maintenance[data-template='picture'] .maintenance__message,
.maintenance[data-template='picture'] .maintenance__name { color: var(--color-on-dark-muted); }

/* Countdown: digits that do not shift as they change. */
.maintenance__clock { display: flex; flex-wrap: wrap; gap: var(--space-lg); justify-content: center; font-variant-numeric: tabular-nums; }
.maintenance__clock[hidden] { display: none; }
.maintenance__unit { display: grid; gap: var(--space-3xs); min-width: 3.5rem; }
.maintenance__unit strong { font-family: var(--font-display); font-size: var(--text-4xl); line-height: 1; }
.maintenance__unit span { color: var(--color-muted); font-size: var(--text-xs); }
@media (max-width: 30rem) {
  .maintenance__clock { gap: var(--space-md); }
  .maintenance__unit strong { font-size: var(--text-3xl); }
}
```

Create `src/pages/maintenance.astro`:

```astro
---
/**
 * Where the gate sends a page it closed (src/middleware.ts). Reached any other way it does not
 * exist: only a rewrite sets the locals it reads.
 */
import MaintenancePage from '../components/maintenance/MaintenancePage.astro';
import { retryAfter } from '../lib/site-maintenance';

const closed = Astro.locals.maintenance;
if (!closed) {
  return new Response('Not found.\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 });
}
Astro.response.status = 503;
Astro.response.headers.set('Cache-Control', 'no-store');
const retry = retryAfter(closed.settings.maintenance_back_at, new Date());
if (retry) Astro.response.headers.set('Retry-After', retry);
---

<MaintenancePage locale={closed.locale} settings={closed.settings} />
```

- [ ] **Step 8: The owner's bar**

In `src/layouts/BaseLayout.astro`, import `adminHref` from `'../lib/admin'`, and in the
`<Fragment slot="above">`, before `{plugins.notice && (`, add:

```astro
      {Astro.locals.maintenanceOwner && settings && (
        <aside class="site-maintenance-bar">
          <p>{publicText.maintenanceBar} <a href={adminHref(settings, '/maintenance')}>{publicText.maintenanceManage}</a></p>
        </aside>
      )}
```

In `src/styles/global.css`, after the `.site-notice` rules, add:

```css
/* The owner's reminder, over their own site, that visitors are meeting the maintenance page.
 * Only the gate sets the local that draws it, and only for the signed-in owner. */
.site-maintenance-bar {
  padding: var(--space-xs) var(--space-md);
  background: var(--color-hero);
  color: var(--color-on-dark);
  font-size: var(--text-sm);
  text-align: center;
}
.site-maintenance-bar p { margin: 0; }
.site-maintenance-bar a { color: inherit; text-decoration: underline; text-underline-offset: 0.2em; }
```

- [ ] **Step 9: Write the browser test for a visitor**

Create `tests/e2e/maintenance.spec.ts`. The harness (imports, `docker`, `freePort`, `beforeAll`,
`afterAll`, `beforeEach` and `signIn`) is copied from `tests/e2e/home-slides.spec.ts` with these
changes only: the doc comment says what this file tests; `test.use({ stack: 'maintenance' })`;
`CREDENTIAL = 'maintenance-secret-at-least-32-chars'`; `TOME_CMS_VITE_CACHE_DIR:
'node_modules/.vite-maintenance'`; the settings row's `site_name` is `'Maintenance Test'`; and the
skip reason reads `'One stack per file; the phone width is checked by setting the viewport, and the
virtual authenticator needs Chromium.'`. Then add:

```ts
async function closeSite(values: { backAt: Date | null; copy: object; template: string }) {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`update site_settings set maintenance_enabled = true, maintenance_template = ${values.template},
    maintenance_copy = ${JSON.stringify(values.copy)}::jsonb, maintenance_media_id = null,
    maintenance_back_at = ${values.backAt?.toISOString() ?? null}::timestamptz`.execute(db);
}

async function openSite() {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`update site_settings set maintenance_enabled = false, maintenance_template = 'minimal',
    maintenance_copy = '{}'::jsonb, maintenance_back_at = null`.execute(db);
}

test('a closed site answers 503 in the reader’s language, and leaves health and media open', async ({ page }) => {
  test.setTimeout(120_000);
  // Whole seconds: Retry-After is an HTTP date, which has no milliseconds.
  const until = new Date(Math.ceil(Date.now() / 1000) * 1000 + 2 * 3_600_000);
  await closeSite({ backAt: until, copy: { th: { heading: 'ปิดซ่อมระบบ', message: '' } }, template: 'countdown' });

  const thai = await fetch(`${origin}/th/`);
  expect(thai.status).toBe(503);
  expect(thai.headers.get('cache-control')).toBe('no-store');
  expect(thai.headers.get('retry-after')).toBe(until.toUTCString());
  const thaiPage = await thai.text();
  expect(thaiPage, 'the owner’s heading').toContain('ปิดซ่อมระบบ');
  expect(thaiPage, 'and the product’s message where none was written').toContain('เราจะกลับมาเร็ว ๆ นี้');

  const english = await fetch(`${origin}/en/about`);
  expect(english.status).toBe(503);
  expect(await english.text(), 'English words where the owner wrote only Thai').toContain('Down for maintenance');
  expect((await fetch(`${origin}/`)).status, 'the root too').toBe(503);

  const feed = await fetch(`${origin}/rss.xml`);
  expect(feed.status).toBe(503);
  expect(await feed.text()).toBe('The site is closed for maintenance.\n');

  const api = await fetch(`${origin}/api/v1/content/posts?locale=th`);
  expect(api.status).toBe(503);
  expect(api.headers.get('content-type')).toContain('application/problem+json');
  expect(api.headers.get('retry-after')).toBe(until.toUTCString());
  expect((await api.json() as { maintenance: unknown }).maintenance).toEqual({
    backAt: until.toISOString(), heading: 'ปิดซ่อมระบบ', locale: 'th', message: 'เราจะกลับมาเร็ว ๆ นี้',
  });
  expect((await fetch(`${origin}/api/v1/content/posts`, { method: 'OPTIONS' })).status, 'a preflight still answers').toBe(204);
  expect((await fetch(`${origin}/api/v1/content/openapi.json`)).status).toBe(200);
  expect((await fetch(`${origin}/health/ready`)).status, 'health stays open, or the deploy helper would roll back').toBe(200);
  expect((await fetch(`${origin}/maintenance`)).status, 'the page is not an address of its own').toBe(404);

  // On a phone: the clock ticks and nothing runs off the side.
  await page.setViewportSize({ width: 375, height: 740 });
  expect((await page.goto(`${origin}/th/`))?.status()).toBe(503);
  await expect(page.getByRole('heading', { level: 1, name: 'ปิดซ่อมระบบ' })).toBeVisible();
  const seconds = page.locator('[data-unit="seconds"]');
  await expect(page.locator('[data-countdown]')).toBeVisible();
  const first = await seconds.textContent();
  await expect.poll(() => seconds.textContent(), { timeout: 5_000 }).not.toBe(first);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);

  // Once the time has come the page says so, and asks no one to retry at a time gone by.
  await closeSite({ backAt: new Date(Date.now() - 60_000), copy: {}, template: 'countdown' });
  expect((await page.goto(`${origin}/en/`))?.headers()['retry-after']).toBeUndefined();
  await expect(page.getByText('Back any moment now')).toBeVisible();
  await expect(page.locator('[data-countdown]')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  await openSite();
  expect((await fetch(`${origin}/th/`)).status, 'open again on the next request').toBe(200);
});
```

A `/media/<id>` request is not made here because the file has to exist first; Task 5's test
checks the library's side, and `maintenanceRoute`'s unit test holds `/media/*` open.

- [ ] **Step 10: Run it**

Run: `npm run test:e2e -- tests/e2e/maintenance.spec.ts --project=desktop`
Expected: 1 passed. Then `rm -rf test-results`.

- [ ] **Step 11: Check the guards**

Put back each and watch a test fail, then undo:
- remove the `OPTIONS` exception (the preflight test gets 503);
- make `maintenanceRoute` return `'api'` for `/api/v1/content/openapi.json`;
- in `src/pages/maintenance.astro`, drop `Astro.response.status = 503` (the visitor gets 200);
- in `closedForMaintenance`, return `context.redirect('/maintenance', 302)` for a page instead of
  the rewrite (the status and the address both change).

- [ ] **Step 12: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(maintenance): a closed site answers 503 and says why

A visitor meets the owner's maintenance page at the address they asked
for, in its language, with a 503 and the return time as Retry-After. The
feeds refuse as text and the content API as a problem that carries the
owner's words, so a headless site can draw its own page. The admin,
sign-in, health, media and previews stay open, and the signed-in owner
still sees the site, under a bar that says visitors do not.
```

```bash
git add src/middleware.ts src/env.d.ts src/pages/maintenance.astro src/components/maintenance/MaintenancePage.astro src/styles/maintenance.css src/lib/i18n.ts src/layouts/BaseLayout.astro src/styles/global.css src/types/cms.ts src/server/http/public-schemas.ts src/server/http/problem.ts src/server/http/openapi.ts tests/unit/maintenance.test.ts tests/e2e/maintenance.spec.ts
```

---

### Task 5: The admin screen

**Files:**
- Create: `src/lib/local-datetime.ts`
- Create: `src/components/admin/tabs.ts`
- Modify: `src/components/admin/SlidesManager.tsx` (use both helpers)
- Create: `src/components/admin/MaintenanceForm.tsx`
- Create: `src/pages/admin/maintenance.astro`
- Create: `src/pages/admin/maintenance/preview.astro`
- Modify: `src/lib/admin.ts` (`ADMIN_NAV_IDS`)
- Modify: `src/lib/icons.ts` (`maintenance`)
- Modify: `src/components/admin/AdminShell.astro` (the link and the notice)
- Modify: `src/lib/admin-i18n.ts`
- Modify: `src/components/admin/MediaLibrary.tsx` (name the page in a refusal)
- Modify: `src/lib/admin-transition.ts` and `tests/unit/admin-transition.test.ts:17`
- Modify: `src/styles/global.css`
- Modify: `CHANGELOG.md` (Unreleased)
- Modify: `tests/e2e/maintenance.spec.ts` (append)

**Interfaces:**
- Consumes: the routes of Task 3; `MaintenancePage.astro` of Task 4; Task 1's
  `DEFAULT_MAINTENANCE_WORDS`, `MAINTENANCE_TEMPLATES`, `MaintenanceSettings`, `MaintenanceTemplate`.
- Produces: `toLocalInput(iso: string): string`, `fromLocalInput(value: string): string` from
  `src/lib/local-datetime.ts`; `moveTabFocus(event: KeyboardEvent<HTMLButtonElement>): void` from
  `src/components/admin/tabs.ts`; the nav id `'maintenance'`.

- [ ] **Step 1: Write the failing browser test for the owner**

Append to `tests/e2e/maintenance.spec.ts`:

```ts
test('the owner writes the page, previews it, closes the site, still sees it, and opens it again', async ({ context, page }) => {
  test.setTimeout(180_000);
  await openSite();
  await signIn(context, page);
  const status = page.locator('.admin-save-bar [role="status"]');

  await page.goto(`${origin}/admin/maintenance`);
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible();
  await expect(page.getByText('The site is open to everyone.')).toBeVisible();

  await page.getByRole('radio', { name: /^Countdown/ }).check();
  await page.getByLabel('Heading', { exact: true }).fill('ปิดปรับปรุงระบบ');
  await page.getByLabel('Message', { exact: true }).fill('ขอบคุณที่รอ');
  await page.getByRole('tab', { name: 'English' }).click();
  await expect(page.getByLabel('Heading', { exact: true }), 'the product’s words shown as the placeholder').toHaveAttribute('placeholder', 'Down for maintenance');
  await page.getByLabel('Heading', { exact: true }).fill('Closed for upgrades');
  await page.getByLabel('Date and time', { exact: true }).fill('2030-01-01T09:00');

  const turnOn = page.getByRole('button', { name: 'Turn on maintenance' });
  await expect(turnOn, 'the site never closes on unsaved words').toBeDisabled();
  await expect(page.getByText('Save your changes before turning maintenance on.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status).toHaveText('Saved.');

  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /Preview/ }).click()]);
  await expect(preview.getByRole('heading', { level: 1 }), 'the preview follows the language tab').toHaveText('Closed for upgrades');
  await preview.close();

  await turnOn.click();
  await page.getByRole('button', { name: 'Close the site', exact: true }).click();
  await expect(status).toHaveText('Maintenance is on. Visitors see the maintenance page.');
  await page.reload();
  await expect(page.getByText('The site is closed for maintenance', { exact: true }), 'every admin screen says so').toBeVisible();

  const own = await page.goto(`${origin}/th`);
  expect(own?.status(), 'the owner still sees the site').toBe(200);
  expect(own?.headers()['cache-control']).toBe('private, no-store');
  await expect(page.getByText('เว็บปิดปรับปรุงอยู่ ผู้เยี่ยมชมจะเห็นหน้าปิดปรับปรุง')).toBeVisible();

  const visitor = await fetch(`${origin}/th`);
  expect(visitor.status).toBe(503);
  expect(await visitor.text()).toContain('ปิดปรับปรุงระบบ');
  const stranger = await fetch(`${origin}/api/admin/maintenance/state`, {
    body: JSON.stringify({ enabled: false }), headers: { 'content-type': 'application/json', origin }, method: 'PUT',
  });
  expect(stranger.status, 'only the owner switches it').toBe(401);
  expect((await fetch(`${origin}/api/admin/maintenance`, { headers: { origin } })).status, 'or reads it').toBe(401);

  await page.goto(`${origin}/admin/maintenance`);
  await page.getByRole('button', { name: 'Turn off maintenance' }).click();
  await expect(status).toHaveText('Maintenance is off. The site is open again.');
  expect((await fetch(`${origin}/th`)).status).toBe(200);
});
```

Run: `npm run test:e2e -- tests/e2e/maintenance.spec.ts --project=desktop`
Expected: the new test FAILS at the heading (`/admin/maintenance` does not exist); the first passes.

- [ ] **Step 2: Share the two helpers the slides screen already has**

Create `src/lib/local-datetime.ts`:

```ts
/** `datetime-local` speaks the device's own time and no zone; the server keeps UTC. */
export function toLocalInput(iso: string): string {
  if (!iso) return '';
  const moment = new Date(iso);
  return new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string {
  return value ? new Date(value).toISOString() : '';
}
```

Create `src/components/admin/tabs.ts`:

```ts
import type { KeyboardEvent } from 'react';

/** Arrow keys, Home and End move along a tablist, and the tab moved to is chosen. */
export function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index = tabs.indexOf(event.currentTarget);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]!.focus();
  tabs[next]!.click();
}
```

In `src/components/admin/SlidesManager.tsx`: delete the `toInput` and `fromInput` constants and
the `switchTab` function; import `{ fromLocalInput, toLocalInput }` from `'../../lib/local-datetime'`
and `{ moveTabFocus }` from `'./tabs'`; replace every `toInput(` with `toLocalInput(`, every
`fromInput(` with `fromLocalInput(`, and `onKeyDown={switchTab}` with `onKeyDown={moveTabFocus}`.
Drop `type KeyboardEvent` from its React import if nothing else uses it.

Run: `npm run test:e2e -- tests/e2e/home-slides.spec.ts --project=desktop` — 1 passed (the slides
screen is unchanged to a user). `rm -rf test-results`.

- [ ] **Step 3: The copy**

In `src/lib/admin-i18n.ts`, English object:
- `nav`: add `maintenance: 'Maintenance',`
- `shell`: add
  `maintenanceManage: 'Maintenance settings',`
  `maintenanceOn: 'The site is closed for maintenance',`
  `maintenanceOnBody: 'Visitors see the maintenance page until you turn it off.',`
- `media`: add `maintenanceReference: 'The maintenance page',`
- `errors`: add `maintenanceHidden: 'Maintenance settings not found.',` and
  `maintenanceUnavailable: 'Maintenance settings are temporarily unavailable.',`
- a new top-level key after `slides`:

```ts
  maintenance: {
    backAt: 'Date and time',
    backGroup: 'Back around',
    backHint: 'Shown on the page and told to search engines. The site does not reopen by itself.',
    cancel: 'Cancel',
    changePicture: 'Change picture',
    choosePicture: 'Choose picture',
    closed: 'The site is closed. Visitors see the maintenance page.',
    confirm: 'Close the site',
    confirmBody: 'Visitors will see the maintenance page at once. You will still see the site while you are signed in.',
    confirmTitle: 'Close the site to visitors?',
    heading: 'Maintenance',
    headingField: 'Heading',
    heavy: 'This picture is {size}. Pictures over 800 KB keep visitors waiting.',
    language: 'Language',
    loadFailed: 'The maintenance settings could not be loaded.',
    loading: 'Loading maintenance settings…',
    message: 'Message',
    narrow: 'This picture is {width} pixels wide. Under 1,600 it looks soft on a wide screen.',
    needBack: 'Countdown needs a time to count down to.',
    needPicture: 'Choose a picture for this template.',
    noChanges: 'No unsaved changes',
    open: 'The site is open to everyone.',
    pictureGroup: 'Picture',
    preview: 'Preview',
    previewLabel: 'Preview the saved page (opens in a new tab)',
    previewSaved: 'Preview shows the last saved version.',
    retry: 'Retry',
    save: 'Save',
    saveError: 'The maintenance page could not be saved. Try again.',
    saveFirst: 'Save your changes before turning maintenance on.',
    saved: 'Saved.',
    saving: 'Saving…',
    stateError: 'The site could not be switched. Try again.',
    stateGroup: 'Status',
    subheading: 'Close the site to visitors while you work on it, and choose what they see instead.',
    templateGroup: 'Template',
    templateHints: {
      countdown: 'A clock counting down to your return.',
      logo: 'Your logo above the words.',
      minimal: 'Words alone.',
      picture: 'Your picture behind the words.',
    },
    templates: { countdown: 'Countdown', logo: 'Logo', minimal: 'Minimal', picture: 'Picture' },
    turnOff: 'Turn off maintenance',
    turnOn: 'Turn on maintenance',
    turnedOff: 'Maintenance is off. The site is open again.',
    turnedOn: 'Maintenance is on. Visitors see the maintenance page.',
    unsaved: 'Unsaved changes',
    wordsGroup: 'Words',
    wordsHint: 'Left empty, the page says the words shown in grey.',
  },
```

Thai object, the same keys:
- `nav`: `maintenance: 'ปิดปรับปรุง',`
- `shell`: `maintenanceManage: 'ตั้งค่าปิดปรับปรุง',` `maintenanceOn: 'เว็บปิดปรับปรุงอยู่',`
  `maintenanceOnBody: 'ผู้เยี่ยมชมจะเห็นหน้าปิดปรับปรุงจนกว่าคุณจะปิดโหมดนี้',`
- `media`: `maintenanceReference: 'หน้าปิดปรับปรุง',`
- `errors`: `maintenanceHidden: 'ไม่พบการตั้งค่าปิดปรับปรุง',`
  `maintenanceUnavailable: 'การตั้งค่าปิดปรับปรุงไม่พร้อมใช้งานชั่วคราว',`
- after `slides`:

```ts
  maintenance: {
    backAt: 'วันและเวลา',
    backGroup: 'กลับมาประมาณ',
    backHint: 'แสดงบนหน้าและแจ้งเครื่องมือค้นหา เว็บจะไม่เปิดกลับเองเมื่อถึงเวลา',
    cancel: 'ยกเลิก',
    changePicture: 'เปลี่ยนรูป',
    choosePicture: 'เลือกรูป',
    closed: 'เว็บปิดอยู่ ผู้เยี่ยมชมจะเห็นหน้าปิดปรับปรุง',
    confirm: 'ปิดเว็บ',
    confirmBody: 'ผู้เยี่ยมชมจะเห็นหน้าปิดปรับปรุงทันที ส่วนคุณยังเห็นเว็บตามปกติตราบที่ยังเข้าสู่ระบบอยู่',
    confirmTitle: 'ปิดเว็บไม่ให้ผู้เยี่ยมชมเข้า?',
    heading: 'ปิดปรับปรุง',
    headingField: 'หัวข้อ',
    heavy: 'ภาพนี้ขนาด {size} ภาพที่ใหญ่กว่า 800 KB ทำให้ผู้เยี่ยมชมต้องรอ',
    language: 'ภาษา',
    loadFailed: 'โหลดการตั้งค่าปิดปรับปรุงไม่ได้',
    loading: 'กำลังโหลดการตั้งค่าปิดปรับปรุง…',
    message: 'รายละเอียด',
    narrow: 'ภาพนี้กว้าง {width} พิกเซล ถ้าต่ำกว่า 1,600 จะดูไม่คมบนจอกว้าง',
    needBack: 'แบบนับถอยหลังต้องมีเวลาให้นับถึง',
    needPicture: 'เลือกรูปสำหรับแบบนี้',
    noChanges: 'ไม่มีการแก้ไขที่ยังไม่บันทึก',
    open: 'เว็บเปิดให้ทุกคนเข้าชมตามปกติ',
    pictureGroup: 'รูปภาพ',
    preview: 'ดูตัวอย่าง',
    previewLabel: 'ดูตัวอย่างหน้าที่บันทึกไว้ (เปิดในแท็บใหม่)',
    previewSaved: 'ตัวอย่างแสดงฉบับที่บันทึกล่าสุด',
    retry: 'ลองใหม่',
    save: 'บันทึก',
    saveError: 'บันทึกหน้าปิดปรับปรุงไม่สำเร็จ ลองอีกครั้ง',
    saveFirst: 'บันทึกการแก้ไขก่อนเปิดโหมดปิดปรับปรุง',
    saved: 'บันทึกแล้ว',
    saving: 'กำลังบันทึก…',
    stateError: 'สลับสถานะเว็บไม่สำเร็จ ลองอีกครั้ง',
    stateGroup: 'สถานะ',
    subheading: 'ปิดเว็บไม่ให้ผู้เยี่ยมชมเข้าระหว่างที่คุณปรับปรุง และเลือกว่าพวกเขาจะเห็นอะไรแทน',
    templateGroup: 'แบบ',
    templateHints: {
      countdown: 'นาฬิกานับถอยหลังถึงเวลาที่กลับมา',
      logo: 'โลโก้ของเว็บอยู่เหนือข้อความ',
      minimal: 'ข้อความอย่างเดียว',
      picture: 'รูปของคุณเป็นฉากหลังข้อความ',
    },
    templates: { countdown: 'นับถอยหลัง', logo: 'โลโก้', minimal: 'เรียบง่าย', picture: 'รูปภาพ' },
    turnOff: 'ปิดโหมดปิดปรับปรุง',
    turnOn: 'เปิดโหมดปิดปรับปรุง',
    turnedOff: 'ปิดโหมดปิดปรับปรุงแล้ว เว็บกลับมาเปิดตามปกติ',
    turnedOn: 'เปิดโหมดปิดปรับปรุงแล้ว ผู้เยี่ยมชมจะเห็นหน้าปิดปรับปรุง',
    unsaved: 'มีการแก้ไขที่ยังไม่บันทึก',
    wordsGroup: 'ข้อความที่แสดง',
    wordsHint: 'ถ้าเว้นว่าง หน้าจะแสดงข้อความสีเทาที่เห็นอยู่',
  },
```

- [ ] **Step 4: The nav, its icon and the notice**

In `src/lib/admin.ts`, add `'maintenance'` to `ADMIN_NAV_IDS` after `'settings'`.

In `src/lib/icons.ts`, add after `settings`:

```ts
  maintenance: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
```

In `src/components/admin/AdminShell.astro`:
- declare `let maintenanceOn = false;` beside `counts`, and in the first `try` inside
  `if (userEmail)`, after `const settings = await getSiteSettings();`, add
  `maintenanceOn = settings?.maintenance_enabled ?? false;`;
- in the `config` group's `links`, after the `settings` link, add
  `{ href: adminHref(adminSettings, '/maintenance'), id: 'maintenance', label: copy.nav.maintenance },`;
- in `<main class="admin-shell-content">`, after the migrations notice, add:

```astro
      {maintenanceOn && (
        <div class="admin-maintenance-notice" role="status">
          <p><strong>{copy.shell.maintenanceOn}</strong> {copy.shell.maintenanceOnBody}</p>
          {active !== 'maintenance' && <a class="admin-button admin-button--secondary" href={adminHref(adminSettings, '/maintenance')}>{copy.shell.maintenanceManage}</a>}
        </div>
      )}
```

- [ ] **Step 5: The form**

Create `src/components/admin/MaintenanceForm.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { atLeast } from '../../lib/busy';
import { HEAVY_SLIDE_BYTES, NARROW_SLIDE_PIXELS } from '../../lib/home-slides';
import { fromLocalInput, toLocalInput } from '../../lib/local-datetime';
import { formatBytes } from '../../lib/media';
import {
  DEFAULT_MAINTENANCE_WORDS,
  MAINTENANCE_TEMPLATES,
  type MaintenanceSettings,
  type MaintenanceTemplate,
} from '../../lib/site-maintenance';
import { confirmUi } from '../../lib/ui-dialog';
import type { HomeSlideMedia, MediaAsset, PageLocale, PostLocale } from '../../types/cms';
import MediaPicker from './MediaPicker';
import { moveTabFocus } from './tabs';

/** The page as the form holds it: every field a string, converted only on save. */
interface Draft {
  backAt: string;
  copy: Record<PageLocale, { heading: string; message: string }>;
  mediaId: string;
  template: MaintenanceTemplate;
}

// Autonyms stay in their own language; the rest follows the owner's.
const languages = [{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }] as const;

const draftOf = (page: MaintenanceSettings): Draft => ({
  backAt: page.backAt ?? '',
  copy: {
    en: { heading: page.copy.en?.heading ?? '', message: page.copy.en?.message ?? '' },
    th: { heading: page.copy.th?.heading ?? '', message: page.copy.th?.message ?? '' },
  },
  mediaId: page.mediaId ?? '',
  template: page.template,
});

interface MaintenanceFormProps {
  ownerLocale?: PostLocale | null;
  previewHref: string;
}

export default function MaintenanceForm({ ownerLocale, previewHref }: MaintenanceFormProps) {
  const copy = adminCopy(ownerLocale);
  const text = copy.maintenance;
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [media, setMedia] = useState<HomeSlideMedia | null>(null);
  const [locale, setLocale] = useState<PageLocale>('th');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'save' | 'state' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const pictureButton = useRef<HTMLButtonElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/admin/maintenance');
      if (!response.ok) throw new Error(text.loadFailed);
      const result = await response.json() as { maintenance: MaintenanceSettings; media: HomeSlideMedia | null };
      const next = draftOf(result.maintenance);
      setEnabled(result.maintenance.enabled);
      setSaved(next);
      setDraft(next);
      setMedia(result.media);
    } catch {
      setLoadError(text.loadFailed);
    }
  }, [text]);

  useEffect(() => { void load(); }, [load]);

  const change = (patch: Partial<Draft>) => {
    setDraft((current) => current && { ...current, ...patch });
    setStatus('');
    setError('');
  };
  const changeWords = (patch: Partial<Draft['copy'][PageLocale]>) => setDraft((current) => current && {
    ...current, copy: { ...current.copy, [locale]: { ...current.copy[locale], ...patch } },
  });

  /** The same rules the server keeps, said here so the page is fixed before it is sent. */
  function problem(page: Draft): string {
    if (page.template === 'picture' && !page.mediaId) return text.needPicture;
    if (page.template === 'countdown' && !page.backAt) return text.needBack;
    return '';
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy || !dirty) return;
    const found = problem(draft);
    if (found) {
      setError(found);
      return;
    }
    setBusy('save');
    setError('');
    setStatus(text.saving);
    try {
      const response = await atLeast(fetch('/api/admin/maintenance', {
        // A picture chosen and then left for another template is not kept: it would stop the
        // library deleting a file the page no longer shows.
        body: JSON.stringify({
          backAt: draft.backAt || null,
          copy: draft.copy,
          mediaId: draft.template === 'picture' ? draft.mediaId || null : null,
          template: draft.template,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }));
      if (!response.ok) throw new Error(text.saveError);
      const next = draftOf((await response.json() as { maintenance: MaintenanceSettings }).maintenance);
      setSaved(next);
      setDraft(next);
      setStatus(text.saved);
    } catch {
      setError(text.saveError);
      setStatus('');
    } finally {
      setBusy(null);
    }
  }

  async function switchState() {
    if (busy) return;
    const next = !enabled;
    if (next && !(await confirmUi({ cancelLabel: text.cancel, confirmLabel: text.confirm, message: text.confirmBody, title: text.confirmTitle }))) return;
    setBusy('state');
    setError('');
    try {
      const response = await atLeast(fetch('/api/admin/maintenance/state', {
        body: JSON.stringify({ enabled: next }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }));
      if (!response.ok) throw new Error(text.stateError);
      setEnabled(next);
      setStatus(next ? text.turnedOn : text.turnedOff);
    } catch {
      setError(text.stateError);
    } finally {
      setBusy(null);
    }
  }

  function pick(asset: MediaAsset) {
    if (asset.width && asset.height) {
      setMedia({ alt_text: asset.alt_text, height: asset.height, id: asset.id, publicUrl: asset.publicUrl, size_bytes: asset.size_bytes, width: asset.width });
      change({ mediaId: asset.id });
    }
    setPicking(false);
  }

  if (!draft) {
    return loadError
      ? <div className="admin-alert" role="alert">{loadError} <button className="admin-button" onClick={() => void load()} type="button">{text.retry}</button></div>
      : <p role="status">{text.loading}</p>;
  }
  const picture = media && media.id === draft.mediaId ? media : null;

  return (<>
    <section className="admin-page admin-form-page maintenance-screen">
      <header className="admin-page__head"><div><h1>{text.heading}</h1><p>{text.subheading}</p></div></header>
      <div className="admin-card-stack">
        <section aria-labelledby="maintenance-state-heading" className="admin-card maintenance-state" data-enabled={enabled}>
          <header className="admin-card__head">
            <h2 id="maintenance-state-heading">{text.stateGroup}</h2>
            <p>{enabled ? text.closed : text.open}</p>
          </header>
          <div className="maintenance-state__actions">
            <button aria-busy={busy === 'state'} aria-describedby={!enabled && dirty ? 'maintenance-save-first' : undefined}
              className={`admin-button ${enabled ? 'admin-button--secondary' : 'admin-button--primary'}`}
              disabled={busy !== null || (!enabled && dirty)} onClick={() => void switchState()} type="button">
              {enabled ? text.turnOff : text.turnOn}
            </button>
            {!enabled && dirty && <small id="maintenance-save-first">{text.saveFirst}</small>}
          </div>
        </section>

        <form className="admin-card-stack" noValidate onSubmit={(event) => void save(event)}>
          <section aria-labelledby="maintenance-template-heading" className="admin-card">
            <header className="admin-card__head"><h2 id="maintenance-template-heading">{text.templateGroup}</h2></header>
            <fieldset aria-labelledby="maintenance-template-heading" className="maintenance-templates">
              {MAINTENANCE_TEMPLATES.map((value) => (
                <label className="maintenance-template" key={value}>
                  <input checked={draft.template === value} name="maintenance-template" onChange={() => change({ template: value })} type="radio" />
                  <span aria-hidden="true" className="maintenance-template__sketch" data-template={value}><span /><span /><span /></span>
                  <strong>{text.templates[value]}</strong>
                  <small>{text.templateHints[value]}</small>
                </label>
              ))}
            </fieldset>
          </section>

          <section aria-labelledby="maintenance-words-heading" className="admin-card">
            <header className="admin-card__head"><h2 id="maintenance-words-heading">{text.wordsGroup}</h2><p>{text.wordsHint}</p></header>
            <div aria-label={text.language} className="navigation-tabs" role="tablist">
              {languages.map((tab) => (
                <button aria-controls="maintenance-words-panel" aria-selected={locale === tab.value} className="navigation-tab" id={`maintenance-${tab.value}-tab`} key={tab.value}
                  onClick={() => setLocale(tab.value)} onKeyDown={moveTabFocus} role="tab" tabIndex={locale === tab.value ? 0 : -1} type="button">
                  {tab.label}
                </button>
              ))}
            </div>
            <div aria-labelledby={`maintenance-${locale}-tab`} className="maintenance-words" id="maintenance-words-panel" role="tabpanel">
              <label className="admin-field">{text.headingField}
                <input className="admin-control" maxLength={80} onChange={(event) => changeWords({ heading: event.target.value })}
                  placeholder={DEFAULT_MAINTENANCE_WORDS[locale].heading} value={draft.copy[locale].heading} />
              </label>
              <label className="admin-field">{text.message}
                <textarea className="admin-control admin-control--textarea" maxLength={280} onChange={(event) => changeWords({ message: event.target.value })}
                  placeholder={DEFAULT_MAINTENANCE_WORDS[locale].message} rows={3} value={draft.copy[locale].message} />
              </label>
            </div>
          </section>

          {draft.template === 'picture' && (
            <section aria-labelledby="maintenance-picture-heading" className="admin-card">
              <header className="admin-card__head"><h2 id="maintenance-picture-heading">{text.pictureGroup}</h2></header>
              <div className="admin-field">
                {picture && <img alt="" className="admin-cover-preview maintenance-preview" src={picture.publicUrl} />}
                <div className="admin-cover-actions">
                  <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setPicking(true)} ref={pictureButton} type="button">
                    {picture ? text.changePicture : text.choosePicture}
                  </button>
                </div>
                <div aria-live="polite" className="maintenance-facts">
                  {picture && <small>{picture.width} × {picture.height} · {formatBytes(picture.size_bytes)}</small>}
                  {picture && picture.size_bytes > HEAVY_SLIDE_BYTES && <small>{fill(text.heavy, { size: formatBytes(picture.size_bytes) })}</small>}
                  {picture && picture.width < NARROW_SLIDE_PIXELS && <small>{fill(text.narrow, { width: picture.width })}</small>}
                </div>
              </div>
            </section>
          )}

          <section aria-labelledby="maintenance-back-heading" className="admin-card">
            <header className="admin-card__head"><h2 id="maintenance-back-heading">{text.backGroup}</h2><p>{text.backHint}</p></header>
            <label className="admin-field">{text.backAt}
              <input className="admin-control" onChange={(event) => change({ backAt: fromLocalInput(event.target.value) })}
                required={draft.template === 'countdown'} type="datetime-local" value={toLocalInput(draft.backAt)} />
            </label>
          </section>

          {error && <p className="admin-form-error" role="alert">{error}</p>}
          <div className="admin-save-bar">
            <button aria-busy={busy === 'save'} className="admin-button admin-button--primary" disabled={busy !== null || !dirty} type="submit">{text.save}</button>
            <a aria-label={text.previewLabel} className="admin-button admin-button--secondary" href={`${previewHref}?lang=${locale}`} rel="noopener" target="_blank">{text.preview}</a>
            <p role="status">{busy === 'save' ? text.saving : status || (dirty ? `${text.unsaved} · ${text.previewSaved}` : text.noChanges)}</p>
          </div>
        </form>
      </div>
    </section>
    {picking && <MediaPicker kind="image" onCancel={() => setPicking(false)} onSelect={pick} ownerLocale={ownerLocale} returnFocus={pictureButton.current} />}
  </>);
}
```

The preview link's accessible name is `text.previewLabel`, which begins with "Preview", so the
test's `/Preview/` finds it. The fieldset takes its name from the card's heading rather than a
`<legend>`, because the codebase has no visually-hidden class and the heading already says it.

- [ ] **Step 6: The screen and the preview**

Create `src/pages/admin/maintenance.astro`:

```astro
---
import AdminSkeleton from '../../components/admin/AdminSkeleton.astro';
import AdminShell from '../../components/admin/AdminShell.astro';
import MaintenanceForm from '../../components/admin/MaintenanceForm';
import AdminLayout from '../../layouts/AdminLayout.astro';
import { adminHref, adminLoginPath } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { requireInstalledOwner } from '../../server/auth/session';
import { getSiteSettings, type SiteSettings } from '../../server/content/settings';
import { HttpError } from '../../server/http/errors';

let userEmail: string | null = null;
let errorKey: 'maintenanceHidden' | 'maintenanceUnavailable' | null = null;
let settings: SiteSettings | null = null;
let authRequired = false;

try {
  settings = await getSiteSettings();
  const current = await requireInstalledOwner(Astro.request.headers);
  if (!settings) {
    Astro.response.status = 404;
    errorKey = 'maintenanceHidden';
  } else {
    userEmail = current.user.email;
  }
} catch (error) {
  if (error instanceof HttpError && error.status === 401) {
    authRequired = true;
    Astro.response.status = 302;
    Astro.response.headers.set('Location', adminLoginPath(Astro.url.pathname + Astro.url.search, settings?.admin_path));
  } else if (error instanceof HttpError && error.status === 403) {
    Astro.response.status = 404;
    errorKey = 'maintenanceHidden';
  } else {
    console.error('Maintenance page failed to load.');
    Astro.response.status = 500;
    errorKey = 'maintenanceUnavailable';
  }
}

const ownerLocale = settings?.default_locale ?? null;
const copy = adminCopy(ownerLocale);
const errorMessage = errorKey ? copy.errors[errorKey] : null;
const previewHref = adminHref({ admin_path: settings?.admin_path ?? '/admin' }, '/maintenance/preview');
---

<AdminLayout lang={ownerLocale ?? 'en'} title={copy.maintenance.heading}>
  {authRequired || errorMessage ? (
    <main><p class="admin-alert admin-alert--page" role="alert">{errorMessage}</p></main>
  ) : (
    <AdminShell active="maintenance" adminPath={settings?.admin_path} locale={settings?.default_locale} siteName={settings?.site_name ?? 'TomeCMS'} userEmail={userEmail}>
      <MaintenanceForm client:only="react" ownerLocale={ownerLocale} previewHref={previewHref}>
        <AdminSkeleton kind="form" label={copy.maintenance.loading} slot="fallback" />
      </MaintenanceForm>
    </AdminShell>
  )}
</AdminLayout>
```

Create `src/pages/admin/maintenance/preview.astro`:

```astro
---
/**
 * The saved maintenance page, for its owner, with the same component a visitor gets -- so what
 * the preview shows is what closing the site would show. 200 and noindex, open or closed.
 */
import MaintenancePage from '../../../components/maintenance/MaintenancePage.astro';
import { adminLoginPath } from '../../../lib/admin';
import { requireOwner } from '../../../server/auth/session';
import { getOwnerSettings, type SiteSettings } from '../../../server/content/settings';
import { HttpError } from '../../../server/http/errors';

let settings: SiteSettings | null = null;
try {
  const current = await requireOwner(Astro.request.headers);
  settings = await getOwnerSettings(current.user.id);
} catch (error) {
  if (error instanceof HttpError && error.status === 401) {
    return Astro.redirect(adminLoginPath(Astro.url.pathname + Astro.url.search), 302);
  }
  return new Response('Not found.\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 });
}
if (!settings) {
  return new Response('Not found.\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 });
}
const asked = Astro.url.searchParams.get('lang');
const locale = asked === 'th' || asked === 'en' ? asked : settings.default_locale;
Astro.response.headers.set('Cache-Control', 'no-store');
---

<MaintenancePage locale={locale} settings={settings} />
```

The admin's navigation overlay draws the next screen's skeleton while it loads. In
`src/lib/admin-transition.ts`, add `'/maintenance'` to `FORMS`, and in
`tests/unit/admin-transition.test.ts:17` add `'/admin/maintenance'` to the list of forms.

- [ ] **Step 7: The library names the page**

In `src/components/admin/MediaLibrary.tsx`:
- add `const [maintenanceReference, setMaintenanceReference] = useState(false);` after
  `referencingSlides`;
- add `setMaintenanceReference(false);` beside every `setProfileReference(false);`;
- add `setMaintenanceReference(deleteFailure.references.maintenance ?? false);` after
  `setReferencingSlides(...)`;
- in the delete alert, after the slides list, add
  `{maintenanceReference && <p><a href="/admin/maintenance">{copy.media.maintenanceReference}</a></p>}`,
  and add `&& !maintenanceReference` to the condition that shows the retry button.

- [ ] **Step 8: The styles**

In `src/styles/global.css`:
- extend the existing rules by selector, so the two screens share them:
  `.home-slides-preview` → `.home-slides-preview, .maintenance-preview`;
  `.home-slides-facts` → `.home-slides-facts, .maintenance-facts`;
  `.home-slides-facts small` → `.home-slides-facts small, .maintenance-facts small`;
  `.home-slides-notice` → `.home-slides-notice, .admin-maintenance-notice`;
  `.home-slides-notice p` → `.home-slides-notice p, .admin-maintenance-notice p`;
- then add:

```css
/* Maintenance: the notice sits above the screen's head, not below it. */
.admin-maintenance-notice { margin-block: 0 var(--space-lg); }
.maintenance-state__actions { display: flex; flex-wrap: wrap; gap: var(--space-xs) var(--space-md); align-items: center; }
.maintenance-state__actions small { color: var(--color-muted); font-size: var(--text-xs); }
.maintenance-state[data-enabled='true'] { border-color: var(--color-rule-strong); }
.maintenance-words { display: grid; gap: var(--space-md); }

/* Four templates, each a card with a small drawing of its layout. */
.maintenance-templates { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-sm); margin: 0; padding: 0; border: 0; }
.maintenance-template { position: relative; display: grid; gap: var(--space-3xs); padding: var(--space-sm); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-card); cursor: pointer; }
.maintenance-template input { position: absolute; inset-block-start: var(--space-sm); inset-inline-end: var(--space-sm); }
.maintenance-template:has(input:checked) { border-color: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent); }
.maintenance-template:has(input:focus-visible) { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.maintenance-template small { color: var(--color-muted); font-size: var(--text-xs); line-height: 1.5; }
.maintenance-template__sketch { display: grid; gap: 4px; align-content: center; height: 4rem; margin-block-end: var(--space-2xs); padding: var(--space-xs); border-radius: var(--radius-sm); background: var(--color-surface); }
.maintenance-template__sketch span { display: block; height: 6px; border-radius: 3px; background: var(--color-rule-strong); }
.maintenance-template__sketch span:first-child { width: 70%; height: 9px; }
.maintenance-template__sketch span:nth-child(2) { width: 90%; }
.maintenance-template__sketch span:last-child { width: 40%; }
.maintenance-template__sketch[data-template='logo'],
.maintenance-template__sketch[data-template='countdown'] { justify-items: center; }
.maintenance-template__sketch[data-template='logo'] span:first-child { width: 18px; height: 18px; border-radius: 50%; }
.maintenance-template__sketch[data-template='countdown'] span:nth-child(2) { width: 60%; height: 12px; }
.maintenance-template__sketch[data-template='picture'] { background: var(--color-hero); }
.maintenance-template__sketch[data-template='picture'] span { background: var(--color-on-dark-muted); }
```

- [ ] **Step 9: The changelog**

In `CHANGELOG.md`, under `## Unreleased`, add:

```markdown
### Added

- **Maintenance**, under Configuration: close the site to visitors while you work on it. Visitors get a 503 page in their language, built from one of four templates (Minimal, Logo, Picture, Countdown) with your own heading, message, picture and return time. The feeds and `/api/v1/content/*` answer 503 too, and the API's answer carries your words so a headless site can draw its own page. The admin, sign-in, health checks and media stay open, and you still see the site while signed in, under a bar that says visitors do not. The site never reopens by itself.
- A picture the maintenance page uses cannot be deleted from the library, and the refusal names the page.
```

- [ ] **Step 10: Run the tests**

Run: `npm run test:unit` (the icons test now holds the new nav id), then `npm run check`, then
`npm run test:e2e -- tests/e2e/maintenance.spec.ts --project=desktop` — 2 passed.
`rm -rf test-results`.

- [ ] **Step 11: Look at it**

Temporarily append a test to `tests/e2e/maintenance.spec.ts` that signs in, opens
`/admin/maintenance`, picks each template in turn, and saves screenshots of the screen and of the
preview at 1280 and 375 wide into the scratchpad; do the same for the visitor's page of each
template, in light and dark (`page.emulateMedia({ colorScheme: 'dark' })`). Read every shot and
fix what overlaps, clips or scrolls sideways. Then restore the spec file to its committed state
plus this task's test, and `rm -rf test-results`.

- [ ] **Step 12: Check the guards**

Put back each and watch a test fail, then undo:
- drop `(!enabled && dirty)` from the switch's `disabled` (the "never closes on unsaved words"
  assertion fails);
- make `src/pages/api/admin/maintenance/state.ts` skip `requireInstalledOwner` and use a fixed
  owner id (the stranger's 401 fails);
- remove `own.headers.set('Cache-Control', 'private, no-store')` from the gate (the owner's
  cache-control assertion fails);
- drop `maintenanceOn = …` from `AdminShell.astro` (the admin notice assertion fails).

- [ ] **Step 13: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(maintenance): a screen to write the page and close the site

Under Configuration: four templates drawn as cards, the words in Thai
and English with the product's own as placeholders, a picture for
Picture, a return time for Countdown, and a preview of what was saved.
Closing the site asks first and waits for unsaved words to be saved;
every admin screen says while it is closed, and the library names the
page when it keeps a picture.
```

```bash
git add src/lib/local-datetime.ts src/components/admin/tabs.ts src/components/admin/SlidesManager.tsx src/components/admin/MaintenanceForm.tsx src/pages/admin/maintenance.astro src/pages/admin/maintenance/preview.astro src/lib/admin.ts src/lib/icons.ts src/components/admin/AdminShell.astro src/lib/admin-i18n.ts src/components/admin/MediaLibrary.tsx src/lib/admin-transition.ts tests/unit/admin-transition.test.ts src/styles/global.css CHANGELOG.md tests/e2e/maintenance.spec.ts
```

---

## After the last task

Run the whole browser suite once, alone:
`npm run test:e2e -- --project=desktop`. Two editor tests ("a link opens a new tab…", "a line
and a table cell can be aligned…") are known to fail now and then under load; re-run a failure of
either alone before believing it. Then run the unit suite and `npm run check` once more.
