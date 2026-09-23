# Home Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the home page's hero its own slides, kept per language under a new Content menu,
drawn by the `paper` theme and offered to headless sites through the public API.

**Architecture:** Slides follow Navigation end to end. A `home_slides` table holds them per
owner and locale; the admin replaces a language's whole list in one transaction; a five-second
process-local snapshot resolves the live ones for readers. The rule for "live" is written once
in `src/lib/home-slides.ts` and read by both the admin and the public side. Themes are handed
resolved slides through `ThemeHomeProps.slides`; `paper` draws them with the slider it already
has, and `plain` ignores them.

**Tech Stack:** Astro 7 SSR, React 18 islands, Kysely on PostgreSQL 17, zod 4, `node --test`,
Playwright.

**Spec:** [docs/specs/2026-09-23-home-slides-design.md](../specs/2026-09-23-home-slides-design.md)

## Global Constraints

- Each language has its own slides. At most **10** are kept per language and at most **5** are
  shown, the first five live ones in order.
- A slide's picture is an image from the owner's library, `ready`, with a width and a height.
- A slide with no heading uses the library's alternative text and cannot be saved with a picture
  that has none. A slide with a heading draws its picture with `alt=""`.
- `overlay = 'none'` is refused when a slide has a heading or a body.
- A button needs a link and a link needs a button. Only a `custom` link may open a new tab.
- "Live" is enabled, started (or no start), and not ended (or no end). A slide that starts this
  instant has started; one that ends this instant has ended. `slideStatus` in
  `src/lib/home-slides.ts` is the only place this is decided.
- No user-visible string is invented outside the copy this plan gives, and every string is given
  in English and Thai. `const th: typeof en` makes a missing Thai key a type error.
- The API's `contentHtml`, the post and page schemas, and the `plain` theme do not change.
- Commits: write the message to a file, then `git commit -F <file>` as its own command. Stage by
  explicit path, never `git add -A`. No attribution lines of any kind. Never `git stash`,
  `git checkout --`, `git reset --hard` or `git clean`.
- `npm run test:unit` and `npm run check` pass before every commit. Integration tests run with
  `node scripts/test-foundation.mjs <file>`, which stands up and tears down its own stack.
- Never touch the owner's `tome-cms-postgres-1`, `tome-cms-seaweedfs-1` or the dev server on
  port 4321.
- Every guard a task adds is checked by putting back the bug it guards against, and the report
  says what the failure read.
- The shell is zsh: quote every glob.

---

### Task 1: The table

**Files:**
- Create: `src/server/db/migrations/023_home_slides.ts`
- Modify: `src/server/db/migrator.ts` (import and register `023_home_slides`)
- Modify: `src/server/db/types.ts` (add `HomeSlideTable`, add `home_slides` to `Database`)
- Modify: `src/server/db/reset-tables.ts` (add `home_slides: 'truncate'`)
- Modify: `tests/unit/db-migrator.test.ts:11`
- Create: `tests/integration/home-slides-schema.test.ts`

**Interfaces:**
- Produces: the `home_slides` table and `HomeSlideTable`; `Database['home_slides']`.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/home-slides-schema.test.ts`. It writes rows straight into the table, so it
proves what the database refuses on its own, whatever the application above it does.

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('a home slide is refused by the database whenever it breaks a rule', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'slides@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const image = await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'A lake at dawn',
    state: 'ready', delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`,
    original_name: 'lake.jpg', mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow();

  const slide = { owner_id: ownerId, locale: 'th' as const, position: 0, media_id: image.id };
  const refused = async (why: string, values: Record<string, unknown>) => {
    await assert.rejects(
      db.insertInto('home_slides').values({ ...slide, ...values } as never).execute(),
      (error: unknown) => (error as { code?: string }).code === '23514' || (error as { code?: string }).code === '23505',
      why,
    );
  };

  await db.insertInto('home_slides').values(slide).execute();
  await refused('two slides in one place', {});
  await refused('an eleventh slide', { position: 10 });
  await refused('a language the site does not have', { position: 1, locale: 'de' });
  await refused('a heading with spaces around it', { position: 1, heading: ' Hi ' });
  await refused('a heading over 80 characters', { position: 1, heading: 'ก'.repeat(81) });
  await refused('a body over 200 characters', { position: 1, body: 'ก'.repeat(201) });
  await refused('a button without a link', { position: 1, button_label: 'Read' });
  await refused('a link without a button', { position: 1, link_kind: 'home' });
  await refused('a page link with no page', { position: 1, button_label: 'Read', link_kind: 'page' });
  await refused('the home opening a new tab', { position: 1, button_label: 'Home', link_kind: 'home', new_tab: true });
  await refused('a script for an address', { position: 1, button_label: 'Go', link_kind: 'custom', url: 'javascript:alert(1)' });
  await refused('words on a bare picture', { position: 1, heading: 'Words', overlay: 'none' });
  await refused('an end before its start', {
    position: 1, starts_at: '2026-10-02T00:00:00Z', ends_at: '2026-10-01T00:00:00Z',
  });
  await refused('a focus point that is not one of the nine', { position: 1, focus: 'middle' });

  await db.insertInto('home_slides').values({
    ...slide, position: 1, button_label: 'Read', link_kind: 'custom', url: 'https://example.com/', new_tab: true,
    overlay: 'none',
  }).execute();

  await assert.rejects(
    db.deleteFrom('media_items').where('id', '=', image.id).execute(),
    (error: unknown) => (error as { code?: string }).code === '23503',
    'a picture a slide uses cannot be deleted under it',
  );

  await db.deleteFrom('user').where('id', '=', ownerId).execute();
  const left = await db.selectFrom('home_slides').select(({ fn }) => fn.countAll<number>().as('count'))
    .where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
  assert.equal(Number(left.count), 0, 'slides go with their owner');

  // Down and up again: the migration can be taken back, and put back.
  const { Migrator } = await import('kysely/migration');
  const { migrations } = await import('../../src/server/db/migrator');
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  const { sql } = await import('kysely');
  const exists = async () => (await sql<{ found: boolean }>`select to_regclass('public.home_slides') is not null as found`
    .execute(db)).rows[0]!.found;
  assert.ifError((await migrator.migrateTo('022_navigation_new_tab')).error);
  assert.equal(await exists(), false, 'down drops the table');
  assert.ifError((await migrator.migrateToLatest()).error);
  assert.equal(await exists(), true, 'and up makes it again');
});
```

**Backups need nothing.** `scripts/backup.ts` runs `pg_dump` over the whole database with no
table list, so `home_slides` is in every backup from the moment it exists, and a slide's picture
is a `media_items` row with an object, both of which a backup already carries. The restore
check compares four record counts held in the backup manifest, whose v1 format is strict and
cannot gain a fifth, so it does not count slides; that is a known limit, not a gap this plan
can close without a new manifest version.

The owner's delete cascades to `media_items` as well as `home_slides`, in one statement, which is
why the last assertion can pass while the one before it refuses a lone delete of the picture.

- [ ] **Step 2: Run it and watch it fail**

```bash
node scripts/test-foundation.mjs tests/integration/home-slides-schema.test.ts
```

Expected: it fails at the first insert, because `home_slides` does not exist.

- [ ] **Step 3: Write the migration**

`src/server/db/migrations/023_home_slides.ts`:

```ts
import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The home page's own slides, per owner and language, at most ten a language. The picture is
 * the one thing a slide cannot be without, so the library may not delete it from under one.
 * A button and its link come together or not at all, with the same three kinds and the same
 * address check as a menu item, and words are never left standing on a bare picture.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table home_slides (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null references "user"(id) on delete cascade,
      locale text not null,
      position integer not null,
      media_id uuid not null,
      heading text,
      body text,
      button_label text,
      link_kind text,
      page_id uuid,
      url text,
      new_tab boolean not null default false,
      align text not null default 'start',
      overlay text not null default 'soft',
      focus text not null default 'center',
      enabled boolean not null default true,
      starts_at timestamptz,
      ends_at timestamptz,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      foreign key (media_id, owner_id) references media_items(id, owner_id) on delete restrict,
      constraint home_slides_place_unique unique (owner_id, locale, position),
      constraint home_slides_locale_check check (locale in ('th', 'en')),
      constraint home_slides_position_check check (position between 0 and 9),
      constraint home_slides_heading_check check (
        heading is null or (heading = btrim(heading) and char_length(heading) between 1 and 80)
      ),
      constraint home_slides_body_check check (
        body is null or (body = btrim(body) and char_length(body) between 1 and 200)
      ),
      constraint home_slides_button_label_check check (
        button_label is null or (button_label = btrim(button_label) and char_length(button_label) between 1 and 30)
      ),
      constraint home_slides_button_check check (
        (button_label is null and link_kind is null and page_id is null and url is null and not new_tab)
        or (button_label is not null and link_kind is not null and (
          (link_kind = 'home' and page_id is null and url is null and not new_tab)
          or (link_kind = 'page' and page_id is not null and url is null and not new_tab)
          or (link_kind = 'custom' and page_id is null and url is not null)
        ))
      ),
      constraint home_slides_url_check check (
        url is null or (
          url = btrim(url)
          and char_length(url) between 1 and 2048
          and url !~ '[[:space:][:cntrl:]]'
          and strpos(url, chr(92)) = 0
          and (url ~ '^/($|[^/])' or url ~* '^https?://[^/?#]+')
        )
      ),
      constraint home_slides_align_check check (align in ('start', 'center', 'end')),
      constraint home_slides_overlay_check check (overlay in ('none', 'soft', 'strong')),
      constraint home_slides_words_check check (overlay <> 'none' or (heading is null and body is null)),
      constraint home_slides_focus_check check (focus in (
        'top-start', 'top', 'top-end', 'start', 'center', 'end', 'bottom-start', 'bottom', 'bottom-end'
      )),
      constraint home_slides_window_check check (starts_at is null or ends_at is null or ends_at > starts_at)
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table home_slides`.execute(db);
}
```

- [ ] **Step 4: Register it, type it, and place it in a reset**

`src/server/db/migrator.ts`, beside the two lines for 022:

```ts
import * as homeSlides from './migrations/023_home_slides';
```

```ts
  '023_home_slides': homeSlides,
```

`src/server/db/types.ts`, after `NavigationItemTable`:

```ts
export interface HomeSlideTable {
  id: Generated<string>;
  owner_id: string;
  locale: 'th' | 'en';
  position: number;
  media_id: string;
  heading: string | null;
  body: string | null;
  button_label: string | null;
  link_kind: 'home' | 'page' | 'custom' | null;
  page_id: string | null;
  url: string | null;
  new_tab: Generated<boolean>;
  align: Generated<'start' | 'center' | 'end'>;
  overlay: Generated<'none' | 'soft' | 'strong'>;
  focus: Generated<'top-start' | 'top' | 'top-end' | 'start' | 'center' | 'end' | 'bottom-start' | 'bottom' | 'bottom-end'>;
  enabled: Generated<boolean>;
  starts_at: Timestamp | null;
  ends_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

and in `interface Database`, after `navigation_items`:

```ts
  home_slides: HomeSlideTable;
```

`src/server/db/reset-tables.ts`, after `navigation_items: 'truncate',`:

```ts
  // The owner's own slides, gone with the owner. It holds a key into media_items, which the
  // same statement truncates, so Postgres accepts the pair.
  home_slides: 'truncate',
```

`tests/unit/db-migrator.test.ts:11` names the newest migration:

```ts
  assert.equal(names.at(-1), '023_home_slides');
```

That is following the migration list, not editing a test to make code pass.

- [ ] **Step 5: Run it again, and check one guard**

```bash
node scripts/test-foundation.mjs tests/integration/home-slides-schema.test.ts
```

Expected: it passes. Then take `home_slides_words_check` out of the migration, run it, see
"words on a bare picture" fail, and put it back.

- [ ] **Step 6: The gates, and commit**

```bash
npm run test:unit
npm run check
git add src/server/db/migrations/023_home_slides.ts src/server/db/migrator.ts src/server/db/types.ts src/server/db/reset-tables.ts tests/unit/db-migrator.test.ts tests/integration/home-slides-schema.test.ts
```

```
feat(slides): a table for the home page's own slides

Per owner and language, at most ten a language. The picture is a key into
the library that the library may not delete from under a slide, a button
and its link come together or not at all, and words are never left on a
bare picture. A reset empties it with its owner.
```

---

### Task 2: The rules, and the slides on the server

**Files:**
- Modify: `src/types/cms.ts` (after `export interface PublicNavigation`)
- Create: `src/lib/home-slides.ts`
- Create: `src/server/content/slides.ts`
- Create: `tests/unit/home-slides.test.ts`
- Create: `tests/integration/home-slides.test.ts`

**Interfaces:**
- Consumes: `home_slides` and `HomeSlideTable` from Task 1; `normalizeNavigationUrl` from
  `src/lib/navigation-url.ts`; `stableMediaPath` from `src/server/media/url.ts`; `live` from
  `src/server/content/live.ts`; `localePath` and `pagePath` from `src/lib/i18n.ts`.
- Produces:
  - `src/types/cms.ts`: `HOME_SLIDE_FOCUS`, `HomeSlideFocus`, `HomeSlideAlign`,
    `HomeSlideOverlay`, `HomeSlide`, `HomeSlideMedia`, `PublicHomeSlide`
  - `src/lib/home-slides.ts`: `MAX_HOME_SLIDES = 10`, `SHOWN_HOME_SLIDES = 5`,
    `HEAVY_SLIDE_BYTES`, `NARROW_SLIDE_PIXELS`, `slideStatus(...)`, `FOCUS_POSITION`,
    `homeSlidesSchema`, `type HomeSlidesMutation`, `type HomeSlideMutation`
  - `src/server/content/slides.ts`: `listSlides(ownerId)`, `replaceSlides(ownerId, input)`,
    `getPublicSlidesSnapshot(locale)`, `getPublicSlides(locale)`,
    `invalidatePublicSlidesCache()`

- [ ] **Step 1: The types**

`src/types/cms.ts`, after `export interface PublicNavigation { ... }`:

```ts
export const HOME_SLIDE_FOCUS = [
  'top-start', 'top', 'top-end', 'start', 'center', 'end', 'bottom-start', 'bottom', 'bottom-end',
] as const;
export type HomeSlideFocus = (typeof HOME_SLIDE_FOCUS)[number];
export type HomeSlideAlign = 'start' | 'center' | 'end';
export type HomeSlideOverlay = 'none' | 'soft' | 'strong';

/** A slide as the admin keeps it. */
export interface HomeSlide {
  align: HomeSlideAlign;
  body: string | null;
  button_label: string | null;
  created_at: string;
  enabled: boolean;
  ends_at: string | null;
  focus: HomeSlideFocus;
  heading: string | null;
  id: string;
  link_kind: NavigationKind | null;
  locale: PostLocale;
  media_id: string;
  new_tab: boolean;
  overlay: HomeSlideOverlay;
  page_id: string | null;
  position: number;
  starts_at: string | null;
  updated_at: string;
  url: string | null;
}

/** What the admin needs to draw and judge a slide's picture. */
export interface HomeSlideMedia {
  alt_text: string | null;
  height: number;
  id: string;
  publicUrl: string;
  size_bytes: number;
  width: number;
}

/** A live slide, resolved for a theme or a headless site to draw. */
export interface PublicHomeSlide {
  align: HomeSlideAlign;
  body: string | null;
  button: { href: string; label: string; newTab: boolean } | null;
  focus: HomeSlideFocus;
  heading: string | null;
  image: { alt: string; height: number; src: string; width: number };
  overlay: HomeSlideOverlay;
}
```

- [ ] **Step 2: Write the failing unit test**

`tests/unit/home-slides.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { homeSlidesSchema, slideStatus } from '../../src/lib/home-slides';

const now = new Date('2026-10-01T12:00:00Z');
const at = (iso: string) => iso;

test('a slide is live, waiting, ended or off, and its edges belong to one side', () => {
  const on = { enabled: true, endsAt: null, startsAt: null };
  assert.equal(slideStatus(on, now), 'live');
  assert.equal(slideStatus({ ...on, enabled: false }, now), 'off');
  assert.equal(slideStatus({ ...on, startsAt: at('2026-10-01T12:00:01Z') }, now), 'waiting');
  assert.equal(slideStatus({ ...on, startsAt: at('2026-10-01T12:00:00Z') }, now), 'live', 'a slide that starts this instant has started');
  assert.equal(slideStatus({ ...on, endsAt: at('2026-10-01T12:00:00Z') }, now), 'ended', 'a slide that ends this instant has ended');
  assert.equal(slideStatus({ ...on, endsAt: at('2026-10-01T12:00:01Z') }, now), 'live');
  assert.equal(slideStatus({ enabled: false, endsAt: at('2020-01-01T00:00:00Z'), startsAt: null }, now), 'off', 'off says more than ended');
});

const mediaId = '5f0c2a9e-3b1d-4c6e-9a8f-7b2d1e0c4a55';
const pageId = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const parse = (slides: unknown[]) => homeSlidesSchema.safeParse({ locale: 'th', slides });

test('a slide is shaped the way the table will take it', () => {
  const result = parse([{ mediaId: mediaId.toUpperCase(), heading: '  Hello  ', body: '', button: null }]);
  assert.ok(result.success);
  const [slide] = result.data.slides;
  assert.equal(slide.mediaId, mediaId, 'an id is kept in lower case');
  assert.equal(slide.heading, 'Hello', 'words are trimmed');
  assert.equal(slide.body, null, 'an empty body is no body');
  assert.deepEqual(
    { align: slide.align, enabled: slide.enabled, focus: slide.focus, overlay: slide.overlay },
    { align: 'start', enabled: true, focus: 'center', overlay: 'soft' },
    'what a slide is when nothing is said',
  );
});

test('a slide that breaks a rule is refused before it reaches the table', () => {
  const refuses = (why: string, slide: Record<string, unknown>) => assert.equal(parse([{ mediaId, ...slide }]).success, false, why);
  refuses('a heading over 80 characters', { heading: 'ก'.repeat(81) });
  refuses('a body over 200 characters', { body: 'ก'.repeat(201) });
  refuses('words on a bare picture', { heading: 'Words', overlay: 'none' });
  refuses('a button with no words on it', { button: { label: ' ', link: { kind: 'home' } } });
  refuses('a button label over 30 characters', { button: { label: 'ก'.repeat(31), link: { kind: 'home' } } });
  refuses('a page link to something that is not an id', { button: { label: 'Read', link: { kind: 'page', pageId: 'about' } } });
  refuses('a script for an address', { button: { label: 'Go', link: { kind: 'custom', url: 'javascript:alert(1)' } } });
  refuses('an end before its start', { startsAt: '2026-10-02T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' });
  refuses('a focus point that is not one of the nine', { focus: 'middle' });
  refuses('a field the table does not have', { colour: 'red' });
  assert.equal(homeSlidesSchema.safeParse({ locale: 'th', slides: Array.from({ length: 11 }, () => ({ mediaId })) }).success, false, 'an eleventh slide');
  assert.equal(parse([{ mediaId, overlay: 'none' }]).success, true, 'a picture alone may be bare');
  assert.equal(parse([{ mediaId, button: { label: 'Read', link: { kind: 'page', pageId } } }]).success, true);
});
```

Run `node --import tsx --test tests/unit/home-slides.test.ts` and see it fail to resolve
`src/lib/home-slides`.

- [ ] **Step 3: The rules**

`src/lib/home-slides.ts`:

```ts
import { z } from 'zod';

import { HOME_SLIDE_FOCUS, POST_LOCALES, type HomeSlideFocus } from '../types/cms';
import { normalizeNavigationUrl } from './navigation-url';

/** At most this many a language keeps, so next month's can wait beside this month's. */
export const MAX_HOME_SLIDES = 10;
/** At most this many a home page shows: a carousel is mostly its first slide. */
export const SHOWN_HOME_SLIDES = 5;
/** Heavier than this, the admin says the home page will be slow to show it. */
export const HEAVY_SLIDE_BYTES = 800 * 1024;
/** Narrower than this, the admin says it will look soft on a wide screen. */
export const NARROW_SLIDE_PIXELS = 1600;

export type HomeSlideStatus = 'live' | 'waiting' | 'ended' | 'off';

/**
 * Whether a slide is on the home page now, and if not, why not. The public read and the admin's
 * list both ask this, so they cannot disagree about a slide at its edges: one that starts this
 * instant has started, and one that ends this instant has ended.
 */
export function slideStatus(
  slide: { enabled: boolean; endsAt: string | null; startsAt: string | null },
  now: Date,
): HomeSlideStatus {
  if (!slide.enabled) return 'off';
  const time = now.getTime();
  if (slide.startsAt && Date.parse(slide.startsAt) > time) return 'waiting';
  if (slide.endsAt && Date.parse(slide.endsAt) <= time) return 'ended';
  return 'live';
}

/** Which part of a picture survives when a narrow screen crops it, as CSS says it. */
export const FOCUS_POSITION: Readonly<Record<HomeSlideFocus, string>> = {
  'top-start': 'left top', top: 'center top', 'top-end': 'right top',
  start: 'left center', center: 'center', end: 'right center',
  'bottom-start': 'left bottom', bottom: 'center bottom', 'bottom-end': 'right bottom',
};

const lowerId = z.uuid().transform((id) => id.toLowerCase());
const words = (max: number) => z.string().trim().max(max).nullable().default(null)
  .transform((value) => value || null);
const moment = z.iso.datetime({ offset: true }).nullable().default(null);

const slideLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home') }).strict(),
  z.object({ kind: z.literal('page'), pageId: lowerId }).strict(),
  z.object({
    kind: z.literal('custom'),
    newTab: z.boolean().default(false),
    url: z.string().trim().transform(normalizeNavigationUrl).pipe(z.string().min(1).max(2_048)),
  }).strict(),
]);

const slideSchema = z.object({
  align: z.enum(['start', 'center', 'end']).default('start'),
  body: words(200),
  button: z.object({ label: z.string().trim().min(1).max(30), link: slideLinkSchema }).strict().nullable().default(null),
  enabled: z.boolean().default(true),
  endsAt: moment,
  focus: z.enum(HOME_SLIDE_FOCUS).default('center'),
  heading: words(80),
  mediaId: lowerId,
  overlay: z.enum(['none', 'soft', 'strong']).default('soft'),
  startsAt: moment,
}).strict().superRefine((slide, context) => {
  if (slide.overlay === 'none' && (slide.heading || slide.body)) {
    context.addIssue({ code: 'custom', message: 'Words need a darkened picture under them.', path: ['overlay'] });
  }
  if (slide.startsAt && slide.endsAt && Date.parse(slide.endsAt) <= Date.parse(slide.startsAt)) {
    context.addIssue({ code: 'custom', message: 'A slide has to end after it starts.', path: ['endsAt'] });
  }
});

export const homeSlidesSchema = z.object({
  locale: z.enum(POST_LOCALES),
  slides: z.array(slideSchema).max(MAX_HOME_SLIDES),
}).strict();

export type HomeSlidesMutation = z.infer<typeof homeSlidesSchema>;
export type HomeSlideMutation = HomeSlidesMutation['slides'][number];
```

`normalizeNavigationUrl` returns an empty string for an address it will not accept, which is
what makes `javascript:` fail the `min(1)` that follows it; the menu editor relies on the same.

Run the unit test again: expect 3 tests to pass. Then check the guard: change `> time` to
`>= time` in `slideStatus`, see "a slide that starts this instant has started" fail, and put it
back.

- [ ] **Step 4: Write the failing integration test**

`tests/integration/home-slides.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('slides are kept per language, refused when they point outside the site, and read live', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
  const { getPublicSlidesSnapshot, listSlides, replaceSlides } = await import('../../src/server/content/slides');
  const { pagePath } = await import('../../src/lib/i18n');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'slides@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Slides', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const stored = {
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready' as const, delete_error_code: null,
  };
  const media = async (values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    ...stored, object_key: `owners/${ownerId}/2026/09/${randomUUID()}`, original_name: 'file',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350, alt_text: 'A lake at dawn', ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const lake = await media({});
  const unnamed = await media({ alt_text: null });
  const guide = await media({ mime_type: 'application/pdf', width: null, height: null });
  const translation = await db.insertInto('page_translation_groups').values({ owner_id: ownerId }).returning('id').executeTakeFirstOrThrow();
  const page = async (status: 'draft' | 'published', locale: 'th' | 'en') => (await db.insertInto('pages').values({
    owner_id: ownerId, translation_group_id: translation.id, locale, title: `A ${status} page`, slug: `${status}-${locale}-${randomUUID()}`,
    content_json: { type: 'doc', content: [] }, content_html: '', excerpt: '',
    status, published_at: status === 'published' ? new Date('2026-01-01T00:00:00Z') : null,
  } as never).returning(['id', 'slug']).executeTakeFirstOrThrow());
  const about = await page('published', 'th');
  const draft = (await page('draft', 'th')).id;
  const english = (await page('published', 'en')).id;

  const save = (locale: 'th' | 'en', slides: unknown[]) => replaceSlides(ownerId, homeSlidesSchema.parse({ locale, slides }));
  const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

  await assert.rejects(save('th', [{ mediaId: guide, heading: 'A guide' }]), badRequest, 'a document is not a picture');
  await assert.rejects(save('th', [{ mediaId: unnamed }]), badRequest, 'a picture with no words of its own and no heading');
  await assert.rejects(save('th', [{ mediaId: lake, button: { label: 'Read', link: { kind: 'page', pageId: english } } }]), badRequest,
    'a page in the other language');
  await assert.rejects(save('th', [{ mediaId: randomUUID(), heading: 'Gone' }]), badRequest, 'a picture that is not in the library');

  const past = '2026-01-01T00:00:00Z';
  const future = '2999-01-01T00:00:00Z';
  await save('th', [
    { mediaId: lake, heading: 'First', button: { label: 'About us', link: { kind: 'page', pageId: about.id } } },
    { mediaId: unnamed, heading: 'No words of its own, but a heading', button: { label: 'Draft', link: { kind: 'page', pageId: draft } } },
    { mediaId: lake, enabled: false },
    { mediaId: lake, startsAt: future },
    { mediaId: lake, endsAt: past },
    { mediaId: lake, button: { label: 'Away', link: { kind: 'custom', url: 'https://example.com/', newTab: true } } },
    { mediaId: lake, heading: 'Five' },
    { mediaId: lake, heading: 'Six', button: { label: 'Home', link: { kind: 'home' } } },
    { mediaId: lake, heading: 'Seven, too many to show' },
  ]);
  await save('en', [{ mediaId: lake, heading: 'English' }]);

  const listed = await listSlides(ownerId);
  assert.equal(listed.slides.filter((slide) => slide.locale === 'th').length, 9, 'all nine are kept, live or not');
  assert.deepEqual(listed.media.map((item) => item.id).sort(), [lake, unnamed].sort(), 'the admin is told about each picture once');

  const { slides } = await getPublicSlidesSnapshot('th');
  assert.deepEqual(slides.map((slide) => slide.heading), ['First', 'No words of its own, but a heading', null, 'Five', 'Six'],
    'the first five live ones, in order: off, waiting and ended are passed over');
  assert.equal(slides[0]!.button?.href, pagePath({ locale: 'th', slug: about.slug }), 'a button to a published page leads to it');
  assert.equal(slides[0]!.image.alt, '', 'a slide with a heading lets the heading speak for it');
  assert.equal(slides[1]!.button, null, 'a button to a draft page is not drawn');
  assert.deepEqual(slides[2]!.image, { alt: 'A lake at dawn', height: 1350, src: `/media/${lake}`, width: 2400 },
    'a slide without a heading takes the library\'s words');
  assert.deepEqual(slides[2]!.button, { href: 'https://example.com/', label: 'Away', newTab: true });
  assert.deepEqual(slides[4]!.button, { href: '/th', label: 'Home', newTab: false });
  assert.deepEqual((await getPublicSlidesSnapshot('en')).slides.map((slide) => slide.heading), ['English'], 'each language its own');

  await save('th', []);
  assert.deepEqual((await getPublicSlidesSnapshot('th')).slides, [], 'saving an empty list empties it, and the cache is told');
});
```

The pages are written straight into the table with only the columns a page cannot be without;
if a later migration made another column required, add it here with an empty value rather than
going through `createPage`, which this test has no reason to exercise. Run it:

```bash
node scripts/test-foundation.mjs tests/integration/home-slides.test.ts
```

Expected: it fails to resolve `src/server/content/slides`.

- [ ] **Step 5: The server module**

`src/server/content/slides.ts`:

```ts
import type { Selectable, Transaction } from 'kysely';

import { SHOWN_HOME_SLIDES, slideStatus, type HomeSlidesMutation } from '../../lib/home-slides';
import { localePath, pagePath } from '../../lib/i18n';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import type { HomeSlide, HomeSlideMedia, PageLocale, PublicHomeSlide } from '../../types/cms';
import { db } from '../db/client';
import type { Database, HomeSlideTable } from '../db/types';
import { HttpError } from '../http/errors';
import { stableMediaPath } from '../media/url';
import { live } from './live';

function homeSlide(row: Selectable<HomeSlideTable>): HomeSlide {
  const { owner_id: _ownerId, ...slide } = row;
  return {
    ...slide,
    created_at: row.created_at.toISOString(),
    ends_at: row.ends_at?.toISOString() ?? null,
    starts_at: row.starts_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

async function lockOwner(trx: Transaction<Database>, ownerId: string): Promise<void> {
  const owner = await trx.selectFrom('user').select('id').where('id', '=', ownerId).forUpdate().executeTakeFirst();
  if (!owner) throw new HttpError(404, 'Owner not found.');
}

async function slideMedia(ownerId: string, ids: string[]): Promise<HomeSlideMedia[]> {
  if (!ids.length) return [];
  const rows = await db.selectFrom('media_items').select(['id', 'alt_text', 'width', 'height', 'size_bytes'])
    .where('owner_id', '=', ownerId).where('id', 'in', ids).execute();
  return rows.flatMap((row) => row.width && row.height ? [{
    alt_text: row.alt_text,
    height: row.height,
    id: row.id,
    publicUrl: stableMediaPath(row.id),
    size_bytes: Number(row.size_bytes),
    width: row.width,
  }] : []);
}

export async function listSlides(ownerId: string): Promise<{
  media: HomeSlideMedia[];
  pages: Array<{ id: string; locale: PageLocale; status: string; title: string }>;
  slides: HomeSlide[];
}> {
  const [slides, pages] = await Promise.all([
    db.selectFrom('home_slides').selectAll().where('owner_id', '=', ownerId)
      .orderBy('locale').orderBy('position').execute(),
    db.selectFrom('pages').select(['id', 'locale', 'status', 'title'])
      .where('owner_id', '=', ownerId).orderBy('title').orderBy('id').execute(),
  ]);
  const media = await slideMedia(ownerId, [...new Set(slides.map((slide) => slide.media_id))]);
  return { media, pages, slides: slides.map(homeSlide) };
}

export async function replaceSlides(ownerId: string, input: HomeSlidesMutation): Promise<HomeSlide[]> {
  try {
    const rows = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      const mediaIds = [...new Set(input.slides.map((slide) => slide.mediaId))];
      const pictures = new Map((mediaIds.length ? await trx.selectFrom('media_items')
        .select(['id', 'alt_text', 'mime_type', 'width', 'height'])
        .where('owner_id', '=', ownerId).where('state', '=', 'ready').where('id', 'in', mediaIds)
        .forKeyShare().execute() : [])
        .filter((row) => row.mime_type.startsWith('image/') && row.width && row.height)
        .map((row) => [row.id, row]));
      for (const slide of input.slides) {
        const picture = pictures.get(slide.mediaId);
        if (!picture) throw new HttpError(400, 'Choose a picture from this site.');
        if (!slide.heading && !picture.alt_text?.trim()) {
          throw new HttpError(400, 'A slide without a heading needs a picture that says what it shows.');
        }
      }

      const pageIds = [...new Set(input.slides.flatMap((slide) => slide.button?.link.kind === 'page' ? [slide.button.link.pageId] : []))];
      if (pageIds.length) {
        const pages = await trx.selectFrom('pages').select('id')
          .where('owner_id', '=', ownerId).where('locale', '=', input.locale).where('id', 'in', pageIds)
          .forKeyShare().execute();
        if (pages.length !== pageIds.length) throw new HttpError(400, 'Choose Pages from this site and language.');
      }

      await trx.deleteFrom('home_slides').where('owner_id', '=', ownerId).where('locale', '=', input.locale).execute();
      if (!input.slides.length) return [];
      return trx.insertInto('home_slides').values(input.slides.map((slide, position) => {
        const link = slide.button?.link ?? null;
        return {
          align: slide.align,
          body: slide.body,
          button_label: slide.button?.label ?? null,
          enabled: slide.enabled,
          ends_at: slide.endsAt,
          focus: slide.focus,
          heading: slide.heading,
          link_kind: link?.kind ?? null,
          locale: input.locale,
          media_id: slide.mediaId,
          new_tab: link?.kind === 'custom' && link.newTab,
          overlay: slide.overlay,
          owner_id: ownerId,
          page_id: link?.kind === 'page' ? link.pageId : null,
          position,
          starts_at: slide.startsAt,
          url: link?.kind === 'custom' ? link.url : null,
        };
      })).returningAll().execute();
    });
    invalidatePublicSlidesCache();
    return rows.map(homeSlide);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (['22023', '22P02', '23503', '23514'].includes(postgresCode(error) ?? '')) throw new HttpError(400, 'Invalid slides.');
    throw error;
  }
}

export interface PublicSlidesSnapshot {
  lastModified: Date;
  slides: PublicHomeSlide[];
}

// ponytail: process-local like the menu's; replace it only when TomeCMS runs more than one app process.
const cache = new Map<PageLocale, { expiresAt: number; snapshot: PublicSlidesSnapshot }>();
let cacheGeneration = 0;

export function invalidatePublicSlidesCache(): void {
  cache.clear();
  cacheGeneration++;
}

async function queryPublicSlides(locale: PageLocale, now: Date): Promise<PublicSlidesSnapshot> {
  const settings = await db.selectFrom('site_settings').select(['owner_id', 'updated_at'])
    .where('id', '=', true).executeTakeFirst();
  if (!settings) return { lastModified: new Date(0), slides: [] };
  const rows = await db.selectFrom('home_slides')
    .innerJoin('media_items', (join) => join
      .onRef('media_items.id', '=', 'home_slides.media_id')
      .onRef('media_items.owner_id', '=', 'home_slides.owner_id'))
    .selectAll('home_slides')
    .select(['media_items.alt_text as media_alt', 'media_items.width as media_width', 'media_items.height as media_height', 'media_items.state as media_state'])
    .where('home_slides.owner_id', '=', settings.owner_id).where('home_slides.locale', '=', locale)
    .orderBy('home_slides.position').execute();

  const shown = rows.filter((row) => row.media_state === 'ready' && row.media_width && row.media_height
    && slideStatus({ enabled: row.enabled, endsAt: row.ends_at?.toISOString() ?? null, startsAt: row.starts_at?.toISOString() ?? null }, now) === 'live')
    .slice(0, SHOWN_HOME_SLIDES);

  let modified = settings.updated_at.getTime();
  for (const row of rows) modified = Math.max(modified, row.updated_at.getTime());

  const pageIds = [...new Set(shown.flatMap((row) => row.link_kind === 'page' && row.page_id ? [row.page_id] : []))];
  const pageUrls = new Map<string, string>();
  if (pageIds.length) {
    const pages = await db.selectFrom('pages').select(['id', 'slug', 'updated_at'])
      .where('owner_id', '=', settings.owner_id).where('locale', '=', locale).where(live('pages'))
      .where('id', 'in', pageIds).execute();
    for (const page of pages) {
      pageUrls.set(page.id, pagePath({ locale, slug: page.slug }));
      modified = Math.max(modified, page.updated_at.getTime());
    }
  }

  const slides = shown.map((row): PublicHomeSlide => {
    const href = row.link_kind === 'home' ? localePath(locale)
      : row.link_kind === 'page' ? pageUrls.get(row.page_id ?? '')
        : row.link_kind === 'custom' ? normalizeNavigationUrl(row.url ?? '') || undefined : undefined;
    return {
      align: row.align,
      body: row.body,
      button: row.button_label && href ? { href, label: row.button_label, newTab: row.link_kind === 'custom' && row.new_tab } : null,
      focus: row.focus,
      heading: row.heading,
      image: { alt: row.heading ? '' : row.media_alt ?? '', height: row.media_height!, src: stableMediaPath(row.media_id), width: row.media_width! },
      overlay: row.overlay,
    };
  });
  return { lastModified: new Date(modified), slides };
}

export async function getPublicSlidesSnapshot(locale: PageLocale): Promise<PublicSlidesSnapshot> {
  const cached = cache.get(locale);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  const generation = cacheGeneration;
  const snapshot = await queryPublicSlides(locale, new Date());
  if (generation === cacheGeneration) cache.set(locale, { expiresAt: Date.now() + 5_000, snapshot });
  return snapshot;
}

/** Never the reason a home page fails: a read that goes wrong is a hero without slides. */
export async function getPublicSlides(locale: PageLocale): Promise<PublicHomeSlide[]> {
  try {
    return (await getPublicSlidesSnapshot(locale)).slides;
  } catch (error) {
    console.error('Public slides query failed:', error);
    return [];
  }
}
```

- [ ] **Step 6: Run both tests, check a guard, and the gates**

```bash
node --import tsx --test tests/unit/home-slides.test.ts
node scripts/test-foundation.mjs tests/integration/home-slides.test.ts
```

Expected: both pass. Guard: remove `.slice(0, SHOWN_HOME_SLIDES)` and see "the first five live
ones" fail; put it back.

```bash
npm run test:unit
npm run check
git add src/types/cms.ts src/lib/home-slides.ts src/server/content/slides.ts tests/unit/home-slides.test.ts tests/integration/home-slides.test.ts
```

```
feat(slides): the rules, and the slides on the server

A language's whole list is replaced in one transaction, as a menu is, and
refused when a slide points outside the site: a picture from another
library, a document, a page in the other language. The live rule is written
once, and the public read takes the first five live slides and resolves
each for drawing.
```

---

### Task 3: The admin API and the public API

**Files:**
- Create: `src/pages/api/admin/slides/index.ts`
- Create: `src/pages/api/v1/content/slides.ts`
- Modify: `src/server/http/public-schemas.ts` (add `publicHomeSlidesSchema`)
- Modify: `src/server/http/serialize.ts` (add `serializePublicSlides`)
- Modify: `src/server/http/openapi.ts` (the path, and two components)
- Modify: `tests/unit/openapi.test.ts` (the expected path list)
- Modify: `tests/unit/public-serialization.test.ts` (one test)

**Interfaces:**
- Consumes: `homeSlidesSchema` (Task 2), `listSlides`, `replaceSlides`,
  `getPublicSlidesSnapshot` (Task 2), `PublicHomeSlide` and `HOME_SLIDE_FOCUS` (Task 2).
- Produces: `GET` and `PUT /api/admin/slides`; `GET /api/v1/content/slides?locale=`;
  `publicHomeSlidesSchema`; `serializePublicSlides(slides)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/openapi.test.ts`, in `expectedPaths`, after `'/api/v1/content/navigation',`:

```ts
  '/api/v1/content/slides',
```

`tests/unit/public-serialization.test.ts`, a new test at the end, with
`serializePublicSlides` added to the file's import from `../../src/server/http/serialize`:

```ts
test('a public slide carries what a headless site needs to draw it, and nothing else', () => {
  const slide = {
    align: 'center' as const,
    body: 'Words under it',
    button: { href: '/th/about', label: 'About', newTab: false },
    focus: 'top' as const,
    heading: 'A heading',
    image: { alt: '', height: 1350, src: '/media/5f0c2a9e-3b1d-4c6e-9a8f-7b2d1e0c4a55', width: 2400 },
    overlay: 'soft' as const,
  };
  assert.deepEqual(serializePublicSlides([{ ...slide, ownerId: 'someone' } as typeof slide]), [slide], 'an extra field is dropped');
  assert.throws(() => serializePublicSlides([{ ...slide, button: { ...slide.button, href: 'javascript:alert(1)' } }]),
    'an address the schema would never publish');
  assert.throws(() => serializePublicSlides(Array.from({ length: 6 }, () => slide)), 'six slides are one more than a home page shows');
});
```

Run `node --import tsx --test tests/unit/openapi.test.ts tests/unit/public-serialization.test.ts`
and see both fail.

- [ ] **Step 2: The public schema and its serializer**

`src/server/http/public-schemas.ts`: add `PublicHomeSlide` to the `import type { ... } from
'../../types/cms'` list and `HOME_SLIDE_FOCUS` to the value import beside `POST_LOCALES`, then,
after `publicNavigationSchema`:

```ts
const publicHomeSlideSchema = z.object({
  align: z.enum(['start', 'center', 'end']),
  body: z.string().min(1).max(200).nullable(),
  button: z.object({ href: publicUrlSchema, label: z.string().min(1).max(30), newTab: z.boolean() }).strict().nullable(),
  focus: z.enum(HOME_SLIDE_FOCUS),
  heading: z.string().min(1).max(80).nullable(),
  image: z.object({
    alt: z.string().max(300),
    height: z.number().int().positive(),
    src: publicUrlSchema,
    width: z.number().int().positive(),
  }).strict(),
  overlay: z.enum(['none', 'soft', 'strong']),
}).strict();

/** The live slides of one language, in order: at most the five a home page shows. */
export const publicHomeSlidesSchema: z.ZodType<PublicHomeSlide[]> = z.array(publicHomeSlideSchema).max(5);
```

`src/server/http/serialize.ts`: add `PublicHomeSlide` to the type import and
`publicHomeSlidesSchema` to the schema import, then:

```ts
/** Each field named, so a field added to the row never reaches a reader by accident. */
export function serializePublicSlides(slides: PublicHomeSlide[]): PublicHomeSlide[] {
  return publicHomeSlidesSchema.parse(slides.map(({ align, body, button, focus, heading, image, overlay }) => ({
    align,
    body,
    button: button ? { href: button.href, label: button.label, newTab: button.newTab } : null,
    focus,
    heading,
    image: { alt: image.alt, height: image.height, src: image.src, width: image.width },
    overlay,
  })));
}
```

- [ ] **Step 3: The public route**

`src/pages/api/v1/content/slides.ts`:

```ts
import type { APIRoute } from 'astro';

import { getPublicSlidesSnapshot } from '../../../../server/content/slides';
import { publicError } from '../../../../server/http/problem';
import { publicJson, publicOptions } from '../../../../server/http/public-response';
import { detailQuerySchema, parsePublicQuery } from '../../../../server/http/public-schemas';
import { serializePublicSlides } from '../../../../server/http/serialize';

export const GET: APIRoute = async ({ request }) => {
  const startedAt = performance.now();
  try {
    const query = parsePublicQuery(new URL(request.url).searchParams, detailQuerySchema);
    const result = await getPublicSlidesSnapshot(query.locale);
    return publicJson(request, {
      data: serializePublicSlides(result.slides),
      meta: { locale: query.locale },
    }, { lastModified: result.lastModified, startedAt });
  } catch (error) {
    return publicError(request, error, startedAt);
  }
};

export const OPTIONS: APIRoute = ({ request }) => publicOptions(request);
```

- [ ] **Step 4: The OpenAPI document**

`src/server/http/openapi.ts`: import `publicHomeSlidesSchema` beside `publicNavigationSchema`.
After the `'/api/v1/content/navigation'` path:

```ts
    '/api/v1/content/slides': {
      get: {
        operationId: 'getPublicSlides',
        summary: 'Get the home page slides that are live now',
        tags: ['Content'],
        parameters: [parameterRef('Locale')],
        responses: {
          '200': jsonResponse('The live home page slides for one locale, in order, at most five.', 'PublicHomeSlidesResponse'),
          ...standardResponses,
        },
      },
      options: optionsOperation('optionsPublicSlides'),
    },
```

In `components.schemas`, after `PublicNavigation`:

```ts
      PublicHomeSlides: componentSchema(publicHomeSlidesSchema),
```

and after `PublicNavigationResponse`:

```ts
      PublicHomeSlidesResponse: {
        type: 'object',
        properties: {
          data: schemaRef('PublicHomeSlides'),
          meta: schemaRef('PublicLocaleMeta'),
        },
        required: ['data', 'meta'],
        additionalProperties: false,
      },
```

- [ ] **Step 5: The admin route**

`src/pages/api/admin/slides/index.ts`. It is the menu's route with the menu's guards; the only
difference is that a slide row already arrives without its `owner_id`.

```ts
import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { homeSlidesSchema } from '../../../../lib/home-slides';
import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { listSlides, replaceSlides } from '../../../../server/content/slides';
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
    return Response.json(await listSlides(current.user.id), {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    guardOrigin(request);
    const input = await parseJson(request, homeSlidesSchema);
    const slides = await replaceSlides(current.user.id, input);
    return Response.json({ slides }, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
```

- [ ] **Step 6: Run the tests, check a guard, and the gates**

```bash
node --import tsx --test tests/unit/openapi.test.ts tests/unit/public-serialization.test.ts
```

Expected: both pass. Guard: make `serializePublicSlides` spread the slide (`...slide`) instead of
naming its fields, see "an extra field is dropped" fail, and put it back.

```bash
npm run test:unit
npm run check
git add src/pages/api/admin/slides/index.ts src/pages/api/v1/content/slides.ts src/server/http/public-schemas.ts src/server/http/serialize.ts src/server/http/openapi.ts tests/unit/openapi.test.ts tests/unit/public-serialization.test.ts
```

```
feat(slides): the admin's route and the public one

The admin replaces a language's slides as it replaces a menu, behind the
same origin and owner guards. A headless site reads the live ones from
/api/v1/content/slides, described in the OpenAPI document and serialized
field by field, so nothing added to a row later reaches a reader unnamed.
```

---

### Task 4: A picture a slide uses cannot be deleted

**Files:**
- Modify: `src/types/cms.ts` (`MediaReferences`)
- Modify: `src/server/media/service.ts:497-531` (`MediaReferences` and `findMediaReferences`)
- Modify: `src/components/admin/MediaLibrary.tsx` (the delete refusal)
- Modify: `src/lib/admin-i18n.ts` (`media.slideReference`, both languages)
- Create: `tests/integration/home-slides-media.test.ts`

**Interfaces:**
- Consumes: `home_slides` (Task 1), `replaceSlides` and `homeSlidesSchema` (Task 2).
- Produces: `MediaReferences.counts.slides: number` and
  `MediaReferences.slides: Array<{ heading: string | null; id: string; locale: PostLocale; position: number }>`.

The table's foreign key already refuses the delete at the database. This task is what turns
that into a refusal the owner can read, naming the slide, the way a post or a page is named.

- [ ] **Step 1: Write the failing test**

`tests/integration/home-slides-media.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { MediaReferences } from '../../src/types/cms';

test('a picture a slide uses is refused deletion, and the refusal names the slide', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
  const { replaceSlides } = await import('../../src/server/content/slides');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'slide-media@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Slides', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const lake = (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'A lake at dawn', state: 'ready',
    delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`, original_name: 'lake.jpg',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow()).id;

  await replaceSlides(ownerId, homeSlidesSchema.parse({ locale: 'en', slides: [{ mediaId: lake }, { mediaId: lake, heading: 'Second' }] }));

  await assert.rejects(deleteMedia(ownerId, lake), (error: unknown) => {
    assert.ok(error instanceof HttpError && error.status === 409, 'refused as a conflict');
    const references = (error as { details?: { references?: MediaReferences } }).details?.references;
    assert.equal(references?.counts.slides, 2, 'both slides are counted');
    assert.deepEqual(
      references?.slides.map(({ heading, locale, position }) => ({ heading, locale, position })),
      [{ heading: null, locale: 'en', position: 0 }, { heading: 'Second', locale: 'en', position: 1 }],
      'and each is named by its heading, or by its place and language',
    );
    return true;
  });
});
```

Run it with
`node scripts/test-foundation.mjs tests/integration/home-slides-media.test.ts` and see it fail
(`counts.slides` is undefined).

- [ ] **Step 2: Count and name the slides**

`src/types/cms.ts`, `MediaReferences` becomes:

```ts
export interface MediaReferences {
  counts: { pageContent: number; postContent: number; postCovers: number; profile: number; slides: number };
  pages: Array<{ id: string; title: string }>;
  posts: Array<{ id: string; title: string }>;
  profile: boolean;
  slides: Array<{ heading: string | null; id: string; locale: PostLocale; position: number }>;
}
```

`src/server/media/service.ts`: its own `interface MediaReferences` (line 497) is replaced with
`import type { MediaReferences } from '../../types/cms';` added to the file's imports, so the
server and the admin cannot disagree about the shape again. Then `findMediaReferences` reads one
more thing:

```ts
  const [coverPosts, contentPosts, pages, profile, slides] = await Promise.all([
    trx.selectFrom('posts').select(['id', 'title']).where('owner_id', '=', ownerId).where('cover_media_id', '=', id).execute(),
    trx.selectFrom('posts').select(['id', 'title']).where('owner_id', '=', ownerId).where(contentReferencesMedia(id)).execute(),
    trx.selectFrom('pages').select(['id', 'title']).where('owner_id', '=', ownerId).where(contentReferencesMedia(id)).execute(),
    trx.selectFrom('site_settings').select('id').where('owner_id', '=', ownerId).where('author_avatar_media_id', '=', id).executeTakeFirst(),
    trx.selectFrom('home_slides').select(['id', 'heading', 'locale', 'position'])
      .where('owner_id', '=', ownerId).where('media_id', '=', id)
      .orderBy('locale').orderBy('position').execute(),
  ]);
  const posts = [...new Map([...coverPosts, ...contentPosts].map((post) => [post.id, post])).values()];
  return {
    counts: {
      pageContent: pages.length,
      postContent: contentPosts.length,
      postCovers: coverPosts.length,
      profile: profile ? 1 : 0,
      slides: slides.length,
    },
    pages,
    posts,
    profile: Boolean(profile),
    slides,
  };
```

`referenceCount` sums `counts`, so the refusal's "still used in N locations" now counts slides
without being touched.

- [ ] **Step 3: Say it in the library**

`src/lib/admin-i18n.ts`, in the `media` block of `en`:

```ts
    slideReference: 'Slide {position} on the {language} home page',
```

and of `th`:

```ts
    slideReference: 'สไลด์ที่ {position} ในหน้าแรกภาษา{language}',
```

`src/components/admin/MediaLibrary.tsx`:

- import `fill` beside `adminCopy` from `../../lib/admin-i18n`, and `type MediaReferences` from
  `../../types/cms`;
- beside `profileReference`'s state:
  `const [referencingSlides, setReferencingSlides] = useState<MediaReferences['slides']>([]);`
- where the three are reset before a delete, add `setReferencingSlides([]);`
- where they are set from `deleteFailure.references`, add
  `setReferencingSlides(deleteFailure.references.slides ?? []);`
- in the refusal's markup, after the `{profileReference && ...}` paragraph:

```tsx
{referencingSlides.length > 0 && <ul>{referencingSlides.map((slide) => <li key={slide.id}><a href="/admin/slides">{slide.heading ?? fill(copy.media.slideReference, { language: slide.locale === 'th' ? 'ไทย' : 'English', position: String(slide.position + 1) })}</a></li>)}</ul>}
```

- and the Retry button's condition gains `&& !referencingSlides.length`, since retrying a delete
  a slide still blocks cannot succeed.

The language is named in its own language, as the menu editor names its tabs. The link goes to
`/admin/slides` as the others go to `/admin/edit/...`: the library already assumes the default
admin path, and fixing that for every link is a different piece of work.

- [ ] **Step 4: Run it, check the guard, and the gates**

```bash
node scripts/test-foundation.mjs tests/integration/home-slides-media.test.ts
```

Expected: it passes. Guard: drop `slides: slides.length` from `counts`, see it fail, and put it
back.

```bash
npm run test:unit
npm run check
git add src/types/cms.ts src/server/media/service.ts src/components/admin/MediaLibrary.tsx src/lib/admin-i18n.ts tests/integration/home-slides-media.test.ts
```

```
feat(slides): the library names the slide a picture is kept for

The table already refused the delete; now the owner is told why, with
each slide named by its heading or by its place and language, as a post or
a page is named. The server and the admin share one MediaReferences type.
```

---

### Task 5: The admin screen

**Files:**
- Modify: `src/lib/admin.ts:109` (`ADMIN_NAV_IDS`)
- Modify: `src/lib/icons.ts` (a `slides` icon)
- Modify: `src/components/admin/AdminShell.astro` (the link)
- Modify: `src/lib/admin-i18n.ts` (`nav.slides`, `errors.slidesHidden`, `errors.slidesUnavailable`, a `slides` block; English and Thai)
- Create: `src/pages/admin/slides.astro`
- Create: `src/components/admin/SlidesManager.tsx`
- Modify: `src/styles/global.css` (four rules, after the `.navigation-dialog` rules)

**Interfaces:**
- Consumes: `GET`/`PUT /api/admin/slides` (Task 3) and their shapes: `{ media: HomeSlideMedia[];
  pages: Array<{ id; locale; status; title }>; slides: HomeSlide[] }` in, `{ slides: HomeSlide[] }`
  out. `slideStatus`, `SHOWN_HOME_SLIDES`, `MAX_HOME_SLIDES`, `HEAVY_SLIDE_BYTES`,
  `NARROW_SLIDE_PIXELS` (Task 2). `MediaPicker`, `UiSelect`, `useDrawer`, `atLeast`,
  `formatBytes`, `normalizeNavigationUrl`, `Icon`, all existing.
- Produces: the screen at `<admin path>/slides`, and `SlidesManagerProps { heroUsesSlides; ownerLocale; themesHref }`.

Decisions this task carries, already made:

- **The list reuses the menu editor's classes** (`navigation-tabs`, `navigation-items`,
  `navigation-item`, `navigation-item__content`, `navigation-item__actions`, `navigation-grip`,
  `navigation-visibility`, `navigation-target`, `navigation-status`, `navigation-save`). The two
  screens are the same shape, and a second copy of those rules would drift.
- **A slide is edited in the drawer the post settings use** (`useDrawer` and a `dialog` with
  `admin-editor-settings`), grouped with `drawer-group`: the form is a dozen fields long, which is
  a panel's worth, not a dialog's.
- **"View on the site" opens the live home page of the tab's language**, not the theme preview
  the spec named: the preview draws only the owner's default language, and slides are per
  language. It shows what was last saved, which the link says.
- **The screen says when slides will not be seen**: if the active theme's `hero` is not
  `slides`, a notice under the heading says where to change it.
- **Times are the device's.** `datetime-local` has no zone, so a start and an end are read and
  written in the browser's own time and stored as UTC.

- [ ] **Step 1: The link, its icon, and its words**

`src/lib/admin.ts:109`, `'slides'` after `'navigation'`:

```ts
export const ADMIN_NAV_IDS = ['posts', 'pages', 'media', 'navigation', 'slides', 'redirects', 'profile', 'security', 'settings', 'appearance', 'themes', 'plugins', 'system'] as const;
```

`src/lib/icons.ts`, after `navigation`, a gallery's outline in the set's own style:

```ts
  slides: '<path d="M2 3v18"/><rect width="12" height="18" x="6" y="3" rx="2"/><path d="M22 3v18"/>',
```

`src/components/admin/AdminShell.astro`, in the content group, after the navigation link:

```ts
      { href: adminHref(adminSettings, '/slides'), id: 'slides', label: copy.nav.slides },
```

`src/lib/admin-i18n.ts`. In `en.nav`, after `navigation`: `slides: 'Home slides',`. In
`th.nav`: `slides: 'สไลด์หน้าแรก',`. In `en.errors`, after the navigation pair:

```ts
    slidesHidden: 'Home slides not found.',
    slidesUnavailable: 'Home slides are temporarily unavailable.',
```

and in `th.errors`:

```ts
    slidesHidden: 'ไม่พบสไลด์หน้าแรก',
    slidesUnavailable: 'สไลด์หน้าแรกไม่พร้อมใช้งานชั่วคราว',
```

A block of its own in `en`, after `navigation`:

```ts
  slides: {
    actionsFor: 'Actions for slide {index}',
    add: 'Add slide',
    added: 'Added a slide. Save to publish it.',
    align: 'Words sit',
    alignCenter: 'Center',
    alignEnd: 'Right',
    alignStart: 'Left',
    badUrl: 'Enter an address that starts with / or http(s)://, up to 2,048 characters.',
    badWindow: 'A slide has to end after it starts.',
    beyondFive: 'Live, but not shown: the home page shows the first five.',
    body: 'Words under it',
    button: 'Button',
    buttonHint: 'Leave it empty for a slide without a button.',
    buttonTo: 'Button: {label}',
    cancel: 'Cancel',
    changePicture: 'Change picture',
    changed: 'Changed slide {index}. Save to publish it.',
    choosePicture: 'Choose picture',
    close: 'Close',
    done: 'Done',
    edit: 'Edit',
    editTitle: 'Slide {index}',
    empty: 'No slides in this language yet.',
    enabled: 'Show this slide',
    ends: 'Ends',
    focus: 'Keep in view on a phone',
    focusLabels: {
      'top-start': 'Top left', top: 'Top', 'top-end': 'Top right',
      start: 'Left', center: 'Center', end: 'Right',
      'bottom-start': 'Bottom left', bottom: 'Bottom', 'bottom-end': 'Bottom right',
    },
    heading: 'Home slides',
    headingField: 'Heading',
    heavy: 'This picture is {size}. Pictures over 800 KB make the home page slow to appear.',
    language: 'Slide language',
    linkCustom: 'An address',
    linkHome: 'Home',
    linkPage: 'A page',
    linkTarget: 'The button leads to',
    list: 'Slides',
    loadFailed: 'Slides could not be loaded. Please try again.',
    loading: 'Loading slides…',
    max: 'A language keeps up to ten slides.',
    moveDown: 'Move down',
    moveUp: 'Move up',
    moved: 'Moved slide {from} to position {to}.',
    narrow: 'This picture is {width} pixels wide. Under 1,600 it looks soft on a wide screen.',
    needAlt: 'Give this slide a heading, or describe the picture in the library.',
    needOverlay: 'Words need a darkened picture under them. Choose A little or A lot.',
    needPage: 'Choose the page the button leads to.',
    needPicture: 'Choose a picture.',
    newTab: 'Open in a new tab',
    newTitle: 'New slide',
    noPages: 'No pages in this language',
    noUnsaved: 'No unsaved changes in this language',
    notShown: 'These show on the home page once the theme’s hero is set to Your slides.',
    openThemes: 'Open Themes',
    overlay: 'Darken the picture',
    overlayNone: 'No',
    overlaySoft: 'A little',
    overlayStrong: 'A lot',
    page: 'Page',
    pageDraft: 'The button’s page is a draft, so the button is not shown yet.',
    pageGone: 'The button’s page is gone, so the button is not shown.',
    picture: 'Picture',
    pictureOnly: 'Picture only',
    remove: 'Remove',
    removed: 'Removed slide {index}.',
    retry: 'Retry',
    save: 'Save slides',
    saveError: 'Slides could not be saved. Your edits are still here. Please try again.',
    saved: 'Slides saved.',
    saving: 'Saving…',
    starts: 'Starts',
    status: { ended: 'Ended', live: 'On the home page', off: 'Hidden', waiting: 'Starts {when}' },
    subheading: 'A picture, a few words and a button for the top of each language’s home page. Changes stay here until you save.',
    timesHint: 'Leave empty to start now or never end. Times are this device’s.',
    unsaved: 'Unsaved changes in this language',
    url: 'Address',
    urlPlaceholder: '/contact or https://example.com',
    viewOnSite: 'View the saved slides on the site',
  },
```

and in `th`, the same keys:

```ts
  slides: {
    actionsFor: 'การทำงานของสไลด์ที่ {index}',
    add: 'เพิ่มสไลด์',
    added: 'เพิ่มสไลด์แล้ว บันทึกเพื่อเผยแพร่',
    align: 'ตำแหน่งข้อความ',
    alignCenter: 'กลาง',
    alignEnd: 'ขวา',
    alignStart: 'ซ้าย',
    badUrl: 'ใส่ที่อยู่ที่ขึ้นต้นด้วย / หรือ http(s):// ยาวไม่เกิน 2,048 ตัวอักษร',
    badWindow: 'สไลด์ต้องสิ้นสุดหลังเวลาเริ่ม',
    beyondFive: 'อยู่ในช่วงเวลา แต่ไม่แสดง เพราะหน้าแรกแสดงเฉพาะห้าสไลด์แรก',
    body: 'ข้อความใต้หัวข้อ',
    button: 'ปุ่ม',
    buttonHint: 'เว้นว่างถ้าไม่ต้องการปุ่ม',
    buttonTo: 'ปุ่ม: {label}',
    cancel: 'ยกเลิก',
    changePicture: 'เปลี่ยนภาพ',
    changed: 'แก้ไขสไลด์ที่ {index} แล้ว บันทึกเพื่อเผยแพร่',
    choosePicture: 'เลือกภาพ',
    close: 'ปิด',
    done: 'เสร็จ',
    edit: 'แก้ไข',
    editTitle: 'สไลด์ที่ {index}',
    empty: 'ยังไม่มีสไลด์ในภาษานี้',
    enabled: 'แสดงสไลด์นี้',
    ends: 'สิ้นสุด',
    focus: 'ส่วนที่ต้องเห็นบนมือถือ',
    focusLabels: {
      'top-start': 'บนซ้าย', top: 'บน', 'top-end': 'บนขวา',
      start: 'ซ้าย', center: 'กลาง', end: 'ขวา',
      'bottom-start': 'ล่างซ้าย', bottom: 'ล่าง', 'bottom-end': 'ล่างขวา',
    },
    heading: 'สไลด์หน้าแรก',
    headingField: 'หัวข้อ',
    heavy: 'ภาพนี้ขนาด {size} ภาพที่ใหญ่กว่า 800 KB ทำให้หน้าแรกแสดงช้า',
    language: 'ภาษาของสไลด์',
    linkCustom: 'ที่อยู่เว็บ',
    linkHome: 'หน้าแรก',
    linkPage: 'หน้าเพจ',
    linkTarget: 'ปุ่มพาไปที่',
    list: 'สไลด์',
    loadFailed: 'โหลดสไลด์ไม่สำเร็จ โปรดลองอีกครั้ง',
    loading: 'กำลังโหลดสไลด์…',
    max: 'แต่ละภาษาเก็บสไลด์ได้ไม่เกินสิบสไลด์',
    moveDown: 'เลื่อนลง',
    moveUp: 'เลื่อนขึ้น',
    moved: 'ย้ายสไลด์ที่ {from} ไปตำแหน่งที่ {to} แล้ว',
    narrow: 'ภาพนี้กว้าง {width} พิกเซล ถ้าต่ำกว่า 1,600 จะดูไม่คมบนจอกว้าง',
    needAlt: 'ใส่หัวข้อให้สไลด์นี้ หรือใส่คำอธิบายภาพในคลังสื่อ',
    needOverlay: 'ข้อความต้องอยู่บนภาพที่ทำให้เข้มลง เลือก "เล็กน้อย" หรือ "มาก"',
    needPage: 'เลือกหน้าที่ปุ่มจะพาไป',
    needPicture: 'เลือกภาพก่อน',
    newTab: 'เปิดในแท็บใหม่',
    newTitle: 'สไลด์ใหม่',
    noPages: 'ไม่มีหน้าในภาษานี้',
    noUnsaved: 'ไม่มีการแก้ไขที่ยังไม่บันทึกในภาษานี้',
    notShown: 'สไลด์จะขึ้นหน้าแรกเมื่อตั้งแถบหัวเรื่องของธีมเป็น "สไลด์ที่จัดเอง"',
    openThemes: 'ไปที่ธีม',
    overlay: 'ทำให้ภาพเข้มลง',
    overlayNone: 'ไม่',
    overlaySoft: 'เล็กน้อย',
    overlayStrong: 'มาก',
    page: 'หน้า',
    pageDraft: 'หน้าที่ปุ่มลิงก์ไปยังเป็นฉบับร่าง ปุ่มจึงยังไม่แสดง',
    pageGone: 'หน้าที่ปุ่มลิงก์ไปไม่มีแล้ว ปุ่มจึงไม่แสดง',
    picture: 'ภาพ',
    pictureOnly: 'ภาพอย่างเดียว',
    remove: 'ลบ',
    removed: 'ลบสไลด์ที่ {index} แล้ว',
    retry: 'ลองอีกครั้ง',
    save: 'บันทึกสไลด์',
    saveError: 'บันทึกสไลด์ไม่สำเร็จ การแก้ไขยังอยู่ครบ โปรดลองอีกครั้ง',
    saved: 'บันทึกสไลด์แล้ว',
    saving: 'กำลังบันทึก…',
    starts: 'เริ่ม',
    status: { ended: 'หมดเวลาแล้ว', live: 'อยู่บนหน้าแรก', off: 'ซ่อนอยู่', waiting: 'เริ่ม {when}' },
    subheading: 'ภาพ ข้อความสั้น ๆ และปุ่ม สำหรับด้านบนของหน้าแรกแต่ละภาษา การแก้ไขจะยังไม่เผยแพร่จนกว่าจะบันทึก',
    timesHint: 'เว้นว่างถ้าจะเริ่มทันทีหรือไม่มีวันสิ้นสุด เวลาเป็นเวลาของเครื่องนี้',
    unsaved: 'มีการแก้ไขที่ยังไม่บันทึกในภาษานี้',
    url: 'ที่อยู่',
    urlPlaceholder: '/contact หรือ https://example.com',
    viewOnSite: 'ดูสไลด์ที่บันทึกแล้วบนหน้าเว็บ',
  },
```

The curly apostrophe and the ellipsis are typed as characters, the way the rest of the file
has them; write them as `’` and `…`, not as escapes.

- [ ] **Step 2: The page**

`src/pages/admin/slides.astro`, the menu's page with three more lines of reading:

```astro
---
import AdminSkeleton from '../../components/admin/AdminSkeleton.astro';
import AdminShell from '../../components/admin/AdminShell.astro';
import SlidesManager from '../../components/admin/SlidesManager';
import AdminLayout from '../../layouts/AdminLayout.astro';
import { adminHref, adminLoginPath } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { requireInstalledOwner } from '../../server/auth/session';
import { getSiteSettings, type SiteSettings } from '../../server/content/settings';
import { HttpError } from '../../server/http/errors';
import { readThemeSettings } from '../../server/themes/store';
import { DEFAULT_THEME_ID, isThemeId } from '../../themes/registry';

let userEmail: string | null = null;
let errorKey: 'slidesHidden' | 'slidesUnavailable' | null = null;
let settings: SiteSettings | null = null;
let authRequired = false;
let heroUsesSlides = false;

try {
  settings = await getSiteSettings();
  const current = await requireInstalledOwner(Astro.request.headers);
  if (!settings) {
    Astro.response.status = 404;
    errorKey = 'slidesHidden';
  } else {
    userEmail = current.user.email;
    // Slides nobody will see are worth saying so about, on the screen that makes them.
    const themeId = isThemeId(settings.theme_id) ? settings.theme_id : DEFAULT_THEME_ID;
    heroUsesSlides = (await readThemeSettings(themeId)).hero === 'slides';
  }
} catch (error) {
  if (error instanceof HttpError && error.status === 401) {
    authRequired = true;
    Astro.response.status = 302;
    Astro.response.headers.set('Location', adminLoginPath(Astro.url.pathname + Astro.url.search, settings?.admin_path));
  } else if (error instanceof HttpError && error.status === 403) {
    Astro.response.status = 404;
    errorKey = 'slidesHidden';
  } else {
    console.error('Slides page failed to load.');
    Astro.response.status = 500;
    errorKey = 'slidesUnavailable';
  }
}

const ownerLocale = settings?.default_locale ?? null;
const copy = adminCopy(ownerLocale);
const errorMessage = errorKey ? copy.errors[errorKey] : null;
const themesHref = adminHref({ admin_path: settings?.admin_path ?? '/admin' }, '/themes');
---

<AdminLayout lang={ownerLocale ?? 'en'} title={copy.slides.heading}>
  {authRequired || errorMessage ? (
    <main><p class="admin-alert admin-alert--page" role="alert">{errorMessage}</p></main>
  ) : (
    <AdminShell active="slides" adminPath={settings?.admin_path} locale={settings?.default_locale} siteName={settings?.site_name ?? 'TomeCMS'} userEmail={userEmail}>
      <SlidesManager client:only="react" heroUsesSlides={heroUsesSlides} ownerLocale={ownerLocale} themesHref={themesHref}>
        <AdminSkeleton kind="list" label={copy.slides.loading} slot="fallback" />
      </SlidesManager>
    </AdminShell>
  )}
</AdminLayout>
```

- [ ] **Step 3: The manager**

`src/components/admin/SlidesManager.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { adminCopy, fill } from '../../lib/admin-i18n';
import { atLeast } from '../../lib/busy';
import {
  HEAVY_SLIDE_BYTES,
  MAX_HOME_SLIDES,
  NARROW_SLIDE_PIXELS,
  SHOWN_HOME_SLIDES,
  slideStatus,
} from '../../lib/home-slides';
import { formatBytes } from '../../lib/media';
import { normalizeNavigationUrl } from '../../lib/navigation-url';
import {
  HOME_SLIDE_FOCUS,
  type HomeSlide,
  type HomeSlideAlign,
  type HomeSlideFocus,
  type HomeSlideMedia,
  type HomeSlideOverlay,
  type MediaAsset,
  type NavigationKind,
  type PageLocale,
  type PostLocale,
} from '../../types/cms';
import Icon from '../Icon';
import MediaPicker from './MediaPicker';
import UiSelect from './UiSelect';
import { useDrawer } from './useDrawer';

interface SlidePage { id: string; locale: PageLocale; status: string; title: string }

/** A slide as the form holds it: every field a string or a flag, converted only on save. */
interface LocalSlide {
  align: HomeSlideAlign;
  body: string;
  buttonLabel: string;
  enabled: boolean;
  endsAt: string;
  focus: HomeSlideFocus;
  heading: string;
  id: string;
  linkKind: NavigationKind;
  mediaId: string;
  newTab: boolean;
  overlay: HomeSlideOverlay;
  pageId: string;
  startsAt: string;
  url: string;
}

// Autonyms stay in their own language; the rest follows the owner's.
const languages = [{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }] as const;
const none = (): Record<PageLocale, LocalSlide[]> => ({ en: [], th: [] });
const blank = (): LocalSlide => ({
  align: 'start', body: '', buttonLabel: '', enabled: true, endsAt: '', focus: 'center', heading: '',
  id: crypto.randomUUID(), linkKind: 'home', mediaId: '', newTab: false, overlay: 'soft', pageId: '', startsAt: '', url: '',
});
const local = (slide: HomeSlide): LocalSlide => ({
  align: slide.align, body: slide.body ?? '', buttonLabel: slide.button_label ?? '', enabled: slide.enabled,
  endsAt: slide.ends_at ?? '', focus: slide.focus, heading: slide.heading ?? '', id: slide.id,
  linkKind: slide.link_kind ?? 'home', mediaId: slide.media_id, newTab: slide.new_tab, overlay: slide.overlay,
  pageId: slide.page_id ?? '', startsAt: slide.starts_at ?? '', url: slide.url ?? '',
});
/** `datetime-local` speaks the device's own time and no zone; the server keeps UTC. */
const toInput = (iso: string) => {
  if (!iso) return '';
  const moment = new Date(iso);
  return new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromInput = (value: string) => value ? new Date(value).toISOString() : '';
const status = (slide: LocalSlide, now: Date) => slideStatus({ enabled: slide.enabled, endsAt: slide.endsAt || null, startsAt: slide.startsAt || null }, now);

function mutation(slide: LocalSlide) {
  const label = slide.buttonLabel.trim();
  return {
    align: slide.align,
    body: slide.body.trim() || null,
    button: label ? {
      label,
      link: slide.linkKind === 'page' ? { kind: 'page', pageId: slide.pageId }
        : slide.linkKind === 'custom' ? { kind: 'custom', newTab: slide.newTab, url: normalizeNavigationUrl(slide.url) }
          : { kind: 'home' },
    } : null,
    enabled: slide.enabled,
    endsAt: slide.endsAt || null,
    focus: slide.focus,
    heading: slide.heading.trim() || null,
    mediaId: slide.mediaId,
    overlay: slide.overlay,
    startsAt: slide.startsAt || null,
  };
}

interface SlidesManagerProps {
  heroUsesSlides: boolean;
  ownerLocale?: PostLocale | null;
  themesHref: string;
}

export default function SlidesManager({ heroUsesSlides, ownerLocale, themesHref }: SlidesManagerProps) {
  const copy = adminCopy(ownerLocale);
  const text = copy.slides;
  const [slides, setSlides] = useState(none);
  const [dirty, setDirty] = useState<Record<PageLocale, boolean>>({ en: false, th: false });
  const [media, setMedia] = useState<Record<string, HomeSlideMedia>>({});
  const [pages, setPages] = useState<SlidePage[]>([]);
  const [locale, setLocale] = useState<PageLocale>('th');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<{ index: number | null; slide: LocalSlide } | null>(null);
  const [draftError, setDraftError] = useState('');
  const [picking, setPicking] = useState(false);
  const savingRef = useRef(false);
  const dragged = useRef<number | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pictureButton = useRef<HTMLButtonElement>(null);
  const { close, dialog } = useDrawer({ focus: closeButton, onClose: () => setDraft(null), open: draft !== null });
  const items = slides[locale];
  const localePages = pages.filter((page) => page.locale === locale);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/admin/slides');
      if (!response.ok) throw new Error(text.loadFailed);
      const result = await response.json() as { media: HomeSlideMedia[]; pages: SlidePage[]; slides: HomeSlide[] };
      const next = none();
      for (const slide of result.slides) next[slide.locale].push(local(slide));
      setSlides(next);
      setPages(result.pages);
      setMedia(Object.fromEntries(result.media.map((item) => [item.id, item])));
      setDirty({ en: false, th: false });
    } catch {
      setLoadError(text.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => { void load(); }, [load]);

  function edit(next: LocalSlide[]) {
    if (savingRef.current) return;
    setSlides((current) => ({ ...current, [locale]: next }));
    setDirty((current) => ({ ...current, [locale]: true }));
    setSaveError('');
  }

  function switchTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = tabs.indexOf(event.currentTarget);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  }

  function move(from: number, to: number, button?: HTMLButtonElement) {
    if (savingRef.current || from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [slide] = next.splice(from, 1);
    next.splice(to, 0, slide!);
    edit(next);
    setMessage(fill(text.moved, { from: from + 1, to: to + 1 }));
    if (button) requestAnimationFrame(() => (button.disabled ? addButton.current : button)?.focus());
  }

  function remove(index: number) {
    edit(items.filter((_, position) => position !== index));
    setMessage(fill(text.removed, { index: index + 1 }));
    // The nearest slide left takes the focus, as a menu item does; an empty list gives it to Add.
    requestAnimationFrame(() => {
      const edits = list.current?.querySelectorAll<HTMLButtonElement>('.navigation-item__actions > button:first-child');
      if (edits?.length) edits[Math.min(index, edits.length - 1)]!.focus();
      else addButton.current?.focus();
    });
  }

  function open(index: number | null) {
    if (index === null && items.length >= MAX_HOME_SLIDES) {
      setMessage(text.max);
      return;
    }
    setDraftError('');
    setDraft({ index, slide: index === null ? blank() : { ...items[index]! } });
  }

  const change = (patch: Partial<LocalSlide>) => setDraft((current) => current && { ...current, slide: { ...current.slide, ...patch } });

  /** The same rules the server keeps, said here so a slide is fixed before it is sent. */
  function problem(slide: LocalSlide): string {
    const picture = media[slide.mediaId];
    if (!picture) return text.needPicture;
    if (slide.overlay === 'none' && (slide.heading.trim() || slide.body.trim())) return text.needOverlay;
    if (!slide.heading.trim() && !picture.alt_text?.trim()) return text.needAlt;
    if (slide.buttonLabel.trim() && slide.linkKind === 'page' && !localePages.some((page) => page.id === slide.pageId)) return text.needPage;
    if (slide.buttonLabel.trim() && slide.linkKind === 'custom') {
      const url = normalizeNavigationUrl(slide.url);
      if (!url || url.length > 2048) return text.badUrl;
    }
    if (slide.startsAt && slide.endsAt && Date.parse(slide.endsAt) <= Date.parse(slide.startsAt)) return text.badWindow;
    return '';
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const found = problem(draft.slide);
    if (found) {
      setDraftError(found);
      return;
    }
    const next = draft.index === null ? [...items, draft.slide] : items.map((slide, index) => index === draft.index ? draft.slide : slide);
    edit(next);
    setMessage(draft.index === null ? text.added : fill(text.changed, { index: draft.index + 1 }));
    close();
  }

  function pick(asset: MediaAsset) {
    if (asset.width && asset.height) {
      setMedia((current) => ({ ...current, [asset.id]: {
        alt_text: asset.alt_text, height: asset.height!, id: asset.id, publicUrl: asset.publicUrl, size_bytes: asset.size_bytes, width: asset.width!,
      } }));
      change({ mediaId: asset.id });
    }
    setPicking(false);
  }

  async function save(retry = false) {
    if (savingRef.current || !dirty[locale]) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setMessage(text.saving);
    try {
      const response = await atLeast(fetch('/api/admin/slides', {
        body: JSON.stringify({ locale, slides: items.map(mutation) }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }));
      if (!response.ok) throw new Error(text.saveError);
      const result = await response.json() as { slides: HomeSlide[] };
      setSlides((current) => ({ ...current, [locale]: result.slides.map(local) }));
      setDirty((current) => ({ ...current, [locale]: false }));
      setMessage(text.saved);
    } catch {
      setSaveError(text.saveError);
      setMessage('');
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (retry) requestAnimationFrame(() => addButton.current?.focus());
    }
  }

  const now = new Date();
  let liveSeen = 0;
  const describe = (slide: LocalSlide) => {
    const state = status(slide, now);
    if (state === 'live') return liveSeen++ < SHOWN_HOME_SLIDES ? text.status.live : text.beyondFive;
    if (state === 'waiting') return fill(text.status.waiting, { when: new Date(slide.startsAt).toLocaleString(ownerLocale ?? undefined) });
    return text.status[state];
  };
  const buttonNote = (slide: LocalSlide) => {
    const label = slide.buttonLabel.trim();
    if (!label) return '';
    if (slide.linkKind === 'page') {
      const page = pages.find((entry) => entry.id === slide.pageId);
      if (!page) return text.pageGone;
      if (page.status !== 'published') return text.pageDraft;
    }
    return fill(text.buttonTo, { label });
  };
  const draftPicture = draft ? media[draft.slide.mediaId] : undefined;

  return (<>
    <section className="admin-page navigation-manager home-slides">
      <header className="admin-page__head">
        <div><h1>{text.heading}</h1><p>{text.subheading}</p></div>
        <button className="admin-button admin-button--primary" disabled={loading || !!loadError || saving} onClick={() => open(null)} ref={addButton} type="button">{text.add}</button>
      </header>
      {!heroUsesSlides && <p className="admin-alert">{text.notShown} <a href={themesHref}>{text.openThemes}</a></p>}
      <p aria-atomic="true" aria-live="polite" className="navigation-status" role="status">{loading ? text.loading : message}</p>
      {loadError && <div className="admin-alert" role="alert">{loadError} <button className="admin-button" onClick={() => void load()} type="button">{text.retry}</button></div>}
      {!loading && !loadError && <>
        <div aria-label={text.language} className="navigation-tabs" role="tablist">
          {languages.map((tab) => (
            <button aria-controls="home-slides-panel" aria-selected={locale === tab.value} className="navigation-tab" id={`home-slides-${tab.value}-tab`} key={tab.value}
              onClick={() => setLocale(tab.value)} onKeyDown={switchTab} role="tab" tabIndex={locale === tab.value ? 0 : -1} type="button">
              {tab.label}{dirty[tab.value] ? ' •' : ''}
            </button>
          ))}
        </div>
        <div aria-busy={saving} aria-labelledby={`home-slides-${locale}-tab`} id="home-slides-panel" role="tabpanel" tabIndex={0}>
          {!items.length && (
            <div className="admin-empty navigation-empty">
              <span aria-hidden="true" className="admin-empty__mark"><Icon name="slides" /></span>
              <div><p>{text.empty}</p></div>
            </div>
          )}
          <ol aria-label={text.list} className="navigation-items" ref={list}>
            {items.map((slide, index) => {
              const picture = media[slide.mediaId];
              const note = buttonNote(slide);
              return (
                <li className="navigation-item" draggable={!saving} key={slide.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => { dragged.current = index; }}
                  onDrop={(event) => { event.preventDefault(); if (dragged.current !== null) move(dragged.current, index); dragged.current = null; }}>
                  <span aria-hidden="true" className="navigation-grip"><Icon name="grip" /></span>
                  <div className="navigation-item__content">
                    {picture ? <img alt="" className="home-slides-thumb" src={picture.publicUrl} /> : <span aria-hidden="true" className="home-slides-thumb" />}
                    <p>{slide.heading.trim() || text.pictureOnly}</p>
                    <p className="navigation-visibility">{describe(slide)}</p>
                    {note && <p className="navigation-target">{note}</p>}
                  </div>
                  <div aria-label={fill(text.actionsFor, { index: index + 1 })} className="navigation-item__actions" role="group">
                    <button aria-label={text.edit} className="admin-button admin-button--ghost admin-button--icon" disabled={saving} onClick={() => open(index)} title={text.edit} type="button"><Icon name="pencil" /></button>
                    <button aria-label={text.moveUp} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === 0} onClick={(event) => move(index, index - 1, event.currentTarget)} title={text.moveUp} type="button"><Icon name="up" /></button>
                    <button aria-label={text.moveDown} className="admin-button admin-button--ghost admin-button--icon" disabled={saving || index === items.length - 1} onClick={(event) => move(index, index + 1, event.currentTarget)} title={text.moveDown} type="button"><Icon name="down" /></button>
                    <button aria-label={text.remove} className="admin-button admin-button--ghost admin-button--icon navigation-remove" disabled={saving} onClick={() => remove(index)} title={text.remove} type="button"><Icon name="trash" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="navigation-save">
            <button aria-busy={saving} className="admin-button admin-button--primary" disabled={saving || !dirty[locale]} onClick={() => void save()} type="button">{text.save}</button>
            <span>{saving ? text.saving : dirty[locale] ? text.unsaved : text.noUnsaved}</span>
            <a href={`/${locale}`} rel="noopener noreferrer" target="_blank">{text.viewOnSite}</a>
          </div>
          {saveError && <div className="admin-alert" role="alert">{saveError} <button className="admin-button" disabled={saving} onClick={() => void save(true)} type="button">{text.retry}</button></div>}
        </div>
      </>}
    </section>
    {draft && (
      <dialog aria-label={draft.index === null ? text.newTitle : fill(text.editTitle, { index: draft.index + 1 })} className="admin-editor-settings"
        onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }} ref={dialog}>
        <form noValidate onSubmit={apply}>
          <div className="admin-editor-settings__head">
            <div><h2>{draft.index === null ? text.newTitle : fill(text.editTitle, { index: draft.index + 1 })}</h2></div>
            <button aria-label={text.close} className="admin-button admin-button--ghost admin-button--icon" onClick={() => close()} ref={closeButton} type="button"><Icon name="close" /></button>
          </div>
          <section className="drawer-group home-slides-picture">
            <h3>{text.picture}</h3>
            {draftPicture && <img alt="" src={draftPicture.publicUrl} />}
            <div aria-live="polite">
              {draftPicture && <p className="home-slides-note">{draftPicture.width} × {draftPicture.height} · {formatBytes(draftPicture.size_bytes)}</p>}
              {draftPicture && draftPicture.size_bytes > HEAVY_SLIDE_BYTES && <p className="home-slides-note">{fill(text.heavy, { size: formatBytes(draftPicture.size_bytes) })}</p>}
              {draftPicture && draftPicture.width < NARROW_SLIDE_PIXELS && <p className="home-slides-note">{fill(text.narrow, { width: draftPicture.width })}</p>}
            </div>
            <button className="admin-button" onClick={() => setPicking(true)} ref={pictureButton} type="button">{draftPicture ? text.changePicture : text.choosePicture}</button>
          </section>
          <section className="drawer-group">
            <label className="admin-field">{text.headingField}<input className="admin-control" maxLength={80} onChange={(event) => change({ heading: event.target.value })} value={draft.slide.heading} /></label>
            <label className="admin-field">{text.body}<textarea className="admin-control" maxLength={200} onChange={(event) => change({ body: event.target.value })} rows={3} value={draft.slide.body} /></label>
          </section>
          <section className="drawer-group">
            <label className="admin-field">{text.button}<input aria-describedby="home-slides-button-hint" className="admin-control" maxLength={30} onChange={(event) => change({ buttonLabel: event.target.value })} value={draft.slide.buttonLabel} /></label>
            <small id="home-slides-button-hint">{text.buttonHint}</small>
            {draft.slide.buttonLabel.trim() && <>
              <fieldset className="navigation-kinds">
                <legend>{text.linkTarget}</legend>
                {([['home', text.linkHome], ['page', text.linkPage], ['custom', text.linkCustom]] as const).map(([value, label]) => (
                  <label className="admin-check" key={value}><input checked={draft.slide.linkKind === value} name="home-slide-link" onChange={() => change({ linkKind: value })} type="radio" /><span>{label}</span></label>
                ))}
              </fieldset>
              {draft.slide.linkKind === 'page' && <div className="admin-field">
                <label htmlFor="home-slide-page">{text.page}</label>
                <UiSelect ariaLabel={text.page} className="admin-control" disabled={!localePages.length} id="home-slide-page"
                  onValueChange={(value) => change({ pageId: value })}
                  options={localePages.length ? localePages.map((page) => ({ label: page.title, value: page.id })) : [{ label: text.noPages, value: '' }]}
                  value={draft.slide.pageId} />
              </div>}
              {draft.slide.linkKind === 'custom' && <>
                <label className="admin-field">{text.url}<input className="admin-control" onChange={(event) => change({ url: event.target.value })} placeholder={text.urlPlaceholder} value={draft.slide.url} /></label>
                <label className="admin-check"><input checked={draft.slide.newTab} onChange={(event) => change({ newTab: event.target.checked })} type="checkbox" /><span>{text.newTab}</span></label>
              </>}
            </>}
          </section>
          <section className="drawer-group">
            <div className="admin-field"><label htmlFor="home-slide-align">{text.align}</label>
              <UiSelect ariaLabel={text.align} className="admin-control" id="home-slide-align" onValueChange={(value) => change({ align: value as HomeSlideAlign })}
                options={[{ label: text.alignStart, value: 'start' }, { label: text.alignCenter, value: 'center' }, { label: text.alignEnd, value: 'end' }]} value={draft.slide.align} /></div>
            <div className="admin-field"><label htmlFor="home-slide-overlay">{text.overlay}</label>
              <UiSelect ariaLabel={text.overlay} className="admin-control" id="home-slide-overlay" onValueChange={(value) => change({ overlay: value as HomeSlideOverlay })}
                options={[{ label: text.overlayNone, value: 'none' }, { label: text.overlaySoft, value: 'soft' }, { label: text.overlayStrong, value: 'strong' }]} value={draft.slide.overlay} /></div>
            <div className="admin-field"><label htmlFor="home-slide-focus">{text.focus}</label>
              <UiSelect ariaLabel={text.focus} className="admin-control" id="home-slide-focus" onValueChange={(value) => change({ focus: value as HomeSlideFocus })}
                options={HOME_SLIDE_FOCUS.map((value) => ({ label: text.focusLabels[value], value }))} value={draft.slide.focus} /></div>
          </section>
          <section className="drawer-group">
            <label className="admin-check"><input checked={draft.slide.enabled} onChange={(event) => change({ enabled: event.target.checked })} type="checkbox" /><span>{text.enabled}</span></label>
            <label className="admin-field">{text.starts}<input className="admin-control" onChange={(event) => change({ startsAt: fromInput(event.target.value) })} type="datetime-local" value={toInput(draft.slide.startsAt)} /></label>
            <label className="admin-field">{text.ends}<input className="admin-control" onChange={(event) => change({ endsAt: fromInput(event.target.value) })} type="datetime-local" value={toInput(draft.slide.endsAt)} /></label>
            <small>{text.timesHint}</small>
          </section>
          {draftError && <p className="admin-alert" role="alert">{draftError}</p>}
          <div className="navigation-dialog__actions">
            <button className="admin-button" onClick={() => close()} type="button">{text.cancel}</button>
            <button className="admin-button admin-button--primary" type="submit">{text.done}</button>
          </div>
        </form>
      </dialog>
    )}
    {picking && <MediaPicker kind="image" onCancel={() => setPicking(false)} onSelect={pick} ownerLocale={ownerLocale} returnFocus={pictureButton.current} />}
  </>);
}
```

- [ ] **Step 4: The four rules**

`src/styles/global.css`, after the `.navigation-dialog` rules:

```css
/* A slide in the list shows its picture at the band's own shape, above its words. */
.home-slides-thumb { display: block; width: min(100%, 10rem); aspect-ratio: 16 / 7; margin-block-end: var(--space-xs); border-radius: var(--radius-input); background: var(--color-paper-3); object-fit: cover; }
.home-slides-picture { display: grid; gap: var(--space-xs); }
.home-slides-picture img { width: 100%; aspect-ratio: 16 / 7; border-radius: var(--radius-card); object-fit: cover; }
.home-slides-note { margin: 0; color: var(--color-ink-2); font-size: var(--text-sm); }
```

- [ ] **Step 5: The gates, and commit**

```bash
npm run test:unit
npm run check
npm run build
git add src/lib/admin.ts src/lib/icons.ts src/components/admin/AdminShell.astro src/lib/admin-i18n.ts src/pages/admin/slides.astro src/components/admin/SlidesManager.tsx src/styles/global.css
```

`tests/unit/icons.test.ts` already asks that every sidebar id has an icon; it is the test that
fails if the `slides` icon is missing, so this task's guard is to delete the icon, see that test
fail, and put it back. Everything else on this screen is proved in the browser in Task 7.

```
feat(slides): a screen for the home page's slides

Under Content, beside the menu: a tab for each language, a list that
reorders by dragging or by button and says what each slide is doing, and a
drawer to make and change one, with the picture's size and width said
plainly. It warns when the theme's hero is not set to show slides at all.
```

---

### Task 6: What the home page is given, and how `paper` draws it

**Files:**
- Modify: `src/themes/contract.ts` (`ThemeHomeProps.slides`)
- Modify: `src/pages/[locale]/index.astro`
- Modify: `src/pages/admin/themes/preview/[id].astro`
- Modify: `src/themes/paper/theme.ts` (the `hero` choice, its hint, the headline's hint, three settings)
- Create: `src/themes/paper/parts/HeroControls.astro`
- Modify: `src/themes/paper/Home.astro`
- Modify: `src/themes/paper/hero-slider.ts`
- Modify: `src/themes/paper/theme.css`
- Modify: `tests/e2e/theme-settings.spec.ts:154,173`

**Interfaces:**
- Consumes: `getPublicSlides(locale)` (Task 2), `PublicHomeSlide` and `FOCUS_POSITION` (Task 2),
  `publicCopy(locale).opensInNewTab` (existing).
- Produces: `ThemeHomeProps.slides: PublicHomeSlide[]`; paper settings `hero = 'slides'`,
  `heroTurn` (`on`/`off`, default `on`), `heroEvery` (`4`/`6`/`8`, default `6`), `heroMove`
  (`slide`/`fade`, default `slide`).

Decisions this task carries, already made:

- A slide's heading is an `h2`. The home page's covers slider has no `h1` either, and a text
  hero keeps its own; nothing here changes the page's outline elsewhere.
- The slider's three buttons move into `parts/HeroControls.astro`, used by both sliders, so the
  covers slider and the slides slider cannot drift apart in how a reader stops them.
- `plain` is untouched: it reads nothing from `slides`, which is what a theme without a hero
  should do with them.

- [ ] **Step 1: The contract, and the two routes that fill it**

`src/themes/contract.ts`: add `PublicHomeSlide` to its type import from `../types/cms`, and to
`ThemeHomeProps`, after `profile`:

```ts
  /** The live home slides of this language, in order, at most five. A theme that draws no
   *  hero, or a hero of its own making, ignores them. */
  slides: PublicHomeSlide[];
```

`src/pages/[locale]/index.astro`: import `getPublicSlides` from `../../server/content/slides`;
after `const profile = ...`:

```ts
// Read whatever the theme will do with them: which hero it draws is its own setting, and the
// read is five seconds of cache away. It never throws: a failure is a hero without slides.
const slides = await getPublicSlides(locale);
```

and pass `slides={slides}` to `<activeTheme.Home ... />`, beside `profile`.

`src/pages/admin/themes/preview/[id].astro`: the same import (with `../../../../`), the same
line after its `locale` is known, and the same prop.

`npm run check` fails until both routes pass `slides`, because the prop is required. That is the
point of making it required.

- [ ] **Step 2: Paper's settings**

`src/themes/paper/theme.ts`. The `hero` setting's `options` gain, between covers and hidden:

```ts
        { label: { en: 'Your slides', th: 'สไลด์ที่จัดเอง' }, value: 'slides' },
```

and its hint becomes:

```ts
      hint: {
        en: 'The band above the grid. Moving reveals the headline once, on arrival. Covers shows the newest posts that have one, and Your slides the ones kept under Home slides; each falls back to text when it has nothing to show, and a reader who asked for less motion gets none.',
        th: 'แถบเหนือ grid แบบเคลื่อนไหวจะเผยหัวข้อครั้งเดียวตอนเปิดหน้า แบบปกจะแสดงบทความล่าสุดที่มีปก และแบบสไลด์ที่จัดเองจะแสดงสไลด์จากเมนูสไลด์หน้าแรก ทุกแบบจะกลับไปเป็นข้อความเมื่อไม่มีอะไรให้แสดง และจะไม่เคลื่อนไหวเลยกับผู้อ่านที่ขอการเคลื่อนไหวน้อยลง',
      },
```

The `heroHeadline` hint's last sentence changes, since slides carry their own headings:

```ts
      hint: {
        en: 'Left blank, the hero says what the theme says, in the language the page is being read in. Not shown when the hero is covers or your slides.',
        th: 'ถ้าเว้นว่าง จะใช้ข้อความของธีมตามภาษาที่หน้านั้นถูกอ่าน ไม่แสดงเมื่อเลือกแบบปกบทความหรือสไลด์ที่จัดเอง',
      },
```

Three settings, directly after `heroHeadline`:

```ts
    {
      fallback: 'on',
      hint: {
        en: 'Only for your slides. A reader can always stop them, and one who asked for less motion never sees them turn.',
        th: 'ใช้กับสไลด์ที่จัดเองเท่านั้น ผู้อ่านหยุดได้เสมอ และผู้อ่านที่ขอการเคลื่อนไหวน้อยลงจะไม่เห็นสไลด์เลื่อนเลย',
      },
      key: 'heroTurn',
      kind: 'switch',
      label: { en: 'Slides turn by themselves', th: 'สไลด์เลื่อนเอง' },
    },
    {
      fallback: '6',
      hint: {
        en: 'How long each of your slides stays before the next.',
        th: 'เวลาที่แต่ละสไลด์ค้างอยู่ก่อนเลื่อนไปสไลด์ถัดไป',
      },
      key: 'heroEvery',
      kind: 'choice',
      label: { en: 'Seconds per slide', th: 'วินาทีต่อสไลด์' },
      options: [
        { label: { en: '4', th: '4' }, value: '4' },
        { label: { en: '6', th: '6' }, value: '6' },
        { label: { en: '8', th: '8' }, value: '8' },
      ],
    },
    {
      fallback: 'slide',
      hint: {
        en: 'Fading needs a browser that animates as it scrolls; any other one slides instead.',
        th: 'แบบจางหายต้องใช้เบราว์เซอร์ที่ทำแอนิเมชันตามการเลื่อนได้ เบราว์เซอร์อื่นจะเลื่อนแทน',
      },
      key: 'heroMove',
      kind: 'choice',
      label: { en: 'Slides change by', th: 'การเปลี่ยนสไลด์' },
      options: [
        { label: { en: 'Sliding', th: 'เลื่อน' }, value: 'slide' },
        { label: { en: 'Fading', th: 'จางหาย' }, value: 'fade' },
      ],
    },
```

`tests/e2e/theme-settings.spec.ts:154` and `:173` assert paper's settings with every fallback
applied. Both objects gain the three new keys, and the change follows the manifest rather than
bending a test:

```ts
    .toEqual({ gridColumns: '3', hero: 'text', heroEvery: '6', heroHeadline: '', heroMove: 'slide', heroTurn: 'on', infiniteScroll: 'on', postsPerLoad: '6', readingProgress: 'off', stickyHeader: 'off' });
```

- [ ] **Step 3: The controls, in one place**

`src/themes/paper/parts/HeroControls.astro`, the markup `Home.astro` has today, moved:

```astro
---
import Icon from '../../../components/Icon.astro';

interface Props {
  next: string;
  previous: string;
  start: string;
  stop: string;
}

const { next, previous, start, stop } = Astro.props;
---

<div class="hero-slider__controls">
  <button aria-label={previous} class="hero-slider__step" data-hero-prev type="button"><Icon name="arrowLeft" /></button>
  <button class="hero-slider__step" data-hero-toggle data-start={start} data-stop={stop} type="button">
    <Icon name="pause" />
    <Icon name="play" />
  </button>
  <button aria-label={next} class="hero-slider__step" data-hero-next type="button"><Icon name="arrowRight" /></button>
</div>
```

In `Home.astro`, the covers slider's `<div class="hero-slider__controls">…</div>` becomes:

```astro
    <HeroControls next={copy.nextSlide} previous={copy.previousSlide} start={copy.startRotating} stop={copy.stopRotating} />
```

- [ ] **Step 4: Drawing the slides**

`src/themes/paper/Home.astro`, frontmatter:

```ts
import HeroControls from './parts/HeroControls.astro';
import { FOCUS_POSITION } from '../../lib/home-slides';
import { dateLocale, localePath, postPath, publicCopy } from '../../lib/i18n';
```

(`publicCopy` joins the existing `i18n` import.) The destructuring of `Astro.props` gains
`slides: ownSlides`. Both copy objects gain one key:

```ts
    highlights: 'ไฮไลต์',
```

```ts
    highlights: 'Highlights',
```

After `const hero = ...`:

```ts
// The owner's slides turn, how often, and how: covers keep turning every six seconds, sliding.
const turn = themeSettings.heroTurn === 'off' ? 'off' : 'on';
const every = themeSettings.heroEvery === '4' || themeSettings.heroEvery === '8' ? themeSettings.heroEvery : '6';
const moveBy = themeSettings.heroMove === 'fade' ? 'fade' : 'slide';
```

The band is decided with the owner's slides first:

```ts
const slides = hero === 'slider' ? posts.filter(({ cover_image }) => cover_image).slice(0, 5) : [];
// The owner's own slides: a still banner for one, the slider for more, and the text hero when
// none is live, as covers falls back when no post has a cover.
const band = hero === 'slides'
  ? ownSlides.length > 1 ? 'slides' : ownSlides.length === 1 ? 'banner' : 'text'
  : slides.length > 1 ? 'slider' : hero === 'slider' ? 'text' : hero;
```

In the covers slider, the images the reader has not reached are fetched last as well as late:

```astro
              fetchpriority={index === 0 ? 'high' : 'low'}
```

The text hero's condition, which today is `band !== 'slider' && band !== 'off'`, becomes
`(band === 'text' || band === 'animated')`, so neither a banner nor the slides slider draws it.

The owner's slides, directly after the covers slider's section:

```astro
{(band === 'slides' || band === 'banner') && (
  <section
    aria-label={copy.highlights}
    aria-roledescription={band === 'slides' ? 'carousel' : undefined}
    class="home-hero home-hero--slider home-hero--slides"
    data-every={every}
    data-hero-slider={band === 'slides' ? '' : undefined}
    data-turn={turn}
  >
    <ul class="hero-slider" data-hero-track data-move={moveBy}>
      {ownSlides.map((slide, index) => (
        <li
          aria-label={band === 'slides' ? copy.slideOf.replace('{index}', String(index + 1)).replace('{count}', String(ownSlides.length)) : undefined}
          aria-roledescription={band === 'slides' ? 'slide' : undefined}
          class="hero-slide"
          data-align={slide.align}
          data-hero-slide
          data-overlay={slide.overlay}
        >
          {/* The first is the page's largest paint: asked for at once and first. The others are
              behind it until they turn, so they are asked for last, and only as they near. */}
          <img
            alt={slide.image.alt}
            decoding="async"
            fetchpriority={index === 0 ? 'high' : 'low'}
            height={slide.image.height}
            loading={index === 0 ? 'eager' : 'lazy'}
            src={slide.image.src}
            style={`object-position: ${FOCUS_POSITION[slide.focus]};`}
            width={slide.image.width}
          />
          {(slide.heading || slide.body || slide.button) && (
            <div class="hero-slide__words">
              {slide.heading && <h2 class="hero-slide__heading">{slide.heading}</h2>}
              {slide.body && <p class="hero-slide__body">{slide.body}</p>}
              {slide.button && (
                <a
                  class="hero-slide__button"
                  href={slide.button.href}
                  rel={slide.button.newTab ? 'noopener noreferrer' : undefined}
                  target={slide.button.newTab ? '_blank' : undefined}
                >
                  {slide.button.label}{slide.button.newTab && <span class="sr-only"> {publicCopy(locale).opensInNewTab}</span>}
                </a>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
    {band === 'slides' && <HeroControls next={copy.nextSlide} previous={copy.previousSlide} start={copy.startRotating} stop={copy.stopRotating} />}
  </section>
)}
```

The script at the foot of the page already wires any `[data-hero-slider]`; the banner carries
none, so a single slide never loads the slider's code.

- [ ] **Step 5: The slider reads the owner's timing**

`src/themes/paper/hero-slider.ts`, inside `wireHeroSlider`, after the early return:

```ts
  // An owner's slides say how long each stays and whether they turn at all. Covers say
  // neither, and keep six seconds and turning.
  const every = Number(root.dataset.every) * 1_000 || EVERY;
```

`let wanted = true;` becomes `let wanted = root.dataset.turn !== 'off';`, and the
`setInterval(..., EVERY)` becomes `setInterval(..., every)`. `say()` already labels the toggle
from `wanted`, so slides that do not turn by themselves offer "start" rather than "stop".

- [ ] **Step 6: How a slide looks**

`src/themes/paper/theme.css`, after the rule for `.hero-slider__step[data-state='still']
.icon:nth-of-type(2)` and before the `@media (min-width: 48rem)` block that follows it:

```css
/* The owner's own slides: the picture fills the slide and the words sit over it where the owner
 * asked. A slide is at least the band's shape, and taller when its words need the room: at 16:7
 * a phone's band is too short for a heading, a line and a button. */
.hero-slide {
  display: grid;
  position: relative;
  flex: 0 0 100%;
  align-content: end;
  min-width: 0;
  overflow: hidden;
  aspect-ratio: 16 / 7;
  scroll-snap-align: start;
}

.hero-slide > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-slide::after { content: ''; position: absolute; inset: 0; pointer-events: none; }
.hero-slide[data-overlay='none']::after { content: none; }
.hero-slide[data-overlay='soft']::after { background: linear-gradient(to top, color-mix(in oklch, var(--color-hero) 85%, transparent), transparent 75%); }
.hero-slide[data-overlay='strong']::after { background: color-mix(in oklch, var(--color-hero) 62%, transparent); }

.hero-slide__words {
  display: grid;
  position: relative;
  z-index: 1;
  justify-items: start;
  gap: var(--space-xs);
  width: min(100%, 48rem);
  margin-inline: auto;
  padding: var(--space-2xl) var(--space-lg) var(--space-lg);
  color: var(--color-on-dark);
}

.hero-slide[data-align='center'] .hero-slide__words { justify-items: center; text-align: center; }
.hero-slide[data-align='end'] .hero-slide__words { justify-items: end; text-align: end; }

/* The three buttons sit at the bottom end of a slider, so its words stop above them. */
.home-hero--slides[data-hero-slider] .hero-slide__words { padding-block-end: calc(2.75rem + var(--space-lg) * 2); }

.hero-slide__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 700;
  line-height: 1.25;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.hero-slide__body { max-width: 36rem; margin: 0; color: var(--color-on-dark-muted); overflow-wrap: anywhere; }

.hero-slide__button {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  margin-block-start: var(--space-2xs);
  padding-inline: var(--space-md);
  border-radius: var(--radius-pill);
  background: var(--color-paper);
  color: var(--color-ink);
  font-weight: 600;
  text-decoration: none;
}

.hero-slide__button:hover { background: var(--color-paper-2); }
.hero-slide__button:focus-visible { outline: 2px solid var(--color-on-dark); outline-offset: var(--space-3xs); }

/* Fading: each slide fades as the track carries it in and out, drawn from the scroll itself,
 * so a swipe still works and nothing waits on a script. A browser without scroll-driven
 * animations slides instead, and a reader who asked for less motion gets neither. */
@supports ((animation-timeline: view()) and (animation-range: entry)) {
  @media (prefers-reduced-motion: no-preference) {
    .hero-slider[data-move='fade'] > .hero-slide {
      animation: hero-slide-fade linear both;
      animation-timeline: view(inline);
    }
  }
}

@keyframes hero-slide-fade {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
```

and inside the existing `@media (min-width: 48rem)` block:

```css
  .hero-slide { align-content: center; aspect-ratio: 21 / 9; }
  .hero-slide__heading { font-size: var(--text-2xl); letter-spacing: -0.5px; }
```

The shorthand comes before `animation-timeline`, which is what keeps the shorthand from
resetting it.

- [ ] **Step 7: Render it, and look at what came out**

```bash
npm run build
```

Then a scratch script, kept in the session's scratchpad and not in the repository, renders the
built `paper` `Home` with the Astro container, as `lcp-render.mjs` did for the article
templates: the chunk is `dist/server/chunks/paper_*.mjs`, which exports `Home`; the container
comes from `node_modules/astro/dist/container/index.js` by absolute path; run it with
`node --env-file=.env.local`. Render five cases and check each:

| Case | Props | Expected in the HTML |
| --- | --- | --- |
| No live slide | `hero: 'slides'`, `slides: []` | the text hero's `h1.hero-title`, no `.hero-slide` |
| One slide | `hero: 'slides'`, one slide | one `li.hero-slide`, no `data-hero-slider`, no `.hero-slider__controls` |
| Three slides | `hero: 'slides'`, three slides, `heroTurn: 'off'`, `heroEvery: '4'`, `heroMove: 'fade'` | `data-hero-slider`, `data-turn="off"`, `data-every="4"`, `data-move="fade"`, the controls, the first `img` with `fetchpriority="high"` and `loading="eager"`, the others `fetchpriority="low"` and `loading="lazy"` |
| A new-tab button | one slide whose button has `newTab: true` | `target="_blank"`, `rel="noopener noreferrer"`, and the screen-reader words |
| Covers | `hero: 'slider'`, three posts with covers | the second and third cover `img` carry `fetchpriority="low"` |

Write what each case printed in the report.

- [ ] **Step 8: The gates, and commit**

```bash
npm run test:unit
npm run check
git add src/themes/contract.ts 'src/pages/[locale]/index.astro' 'src/pages/admin/themes/preview/[id].astro' src/themes/paper/theme.ts src/themes/paper/parts/HeroControls.astro src/themes/paper/Home.astro src/themes/paper/hero-slider.ts src/themes/paper/theme.css tests/e2e/theme-settings.spec.ts
```

The two bracketed paths are quoted because zsh would read them as globs.

```
feat(slides): paper draws the owner's slides

A fifth hero, Your slides: a still banner for one, the slider for more, and
the text hero when none is live. The owner says whether they turn, how
often, and whether by sliding or fading, and fading comes from the scroll
itself. A slide's words sit where the owner put them and the band grows to
hold them on a phone. The pictures a reader has not reached are fetched
last, in the covers slider too.
```

---

### Task 7: Proved in a browser, and written down

**Files:**
- Create: `tests/e2e/home-slides.spec.ts`
- Modify: `CHANGELOG.md` (under `## Unreleased`)
- Modify: `README.md` (one line under "Look")

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: The spec's harness**

`tests/e2e/home-slides.spec.ts` starts as a copy of the harness in
`tests/e2e/editor-blocks.spec.ts`: lines 1 to 140 (the imports, `PROJECT`, `COMPOSE`,
`CREDENTIAL`, `OWNER`, `docker`, `freePort`, the `server`/`origin`/`serverEnv` variables,
`beforeAll`, `afterAll`, the rate-limit `beforeEach`, and the mobile `test.skip`) and its
`signIn` function at the end of the file, copied verbatim with four changes:

- the doc comment at the top says what this file is about: an owner's home slides, made in the
  admin, drawn on the home page of their language alone;
- `test.use({ stack: 'editor-blocks' })` becomes `test.use({ stack: 'home-slides' })`;
- `CREDENTIAL` becomes `'home-slides-secret-at-least-32-chars'`;
- `TOME_CMS_VITE_CACHE_DIR` becomes `'node_modules/.vite-home-slides'`, and the site name in the
  `site_settings` insert becomes `'Slides Test'`.

`PROJECT` stays `'tomecms-select-test'`: `compose.test.yaml` binds fixed ports, so every spec
that stands up the stack shares the project, one at a time, as the other specs already do.

- [ ] **Step 2: The test**

After the harness, before `signIn`:

```ts
test('an owner makes slides for one language, orders them by keyboard, and sees them on that home page alone', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'slides' } });
  const sharp = (await import('sharp')).default;
  const lake = await sharp({ create: { width: 1800, height: 800, channels: 3, background: '#264653' } }).jpeg().toBuffer();
  const status = page.locator('.navigation-status');

  await page.goto(`${origin}/admin/slides`);
  await expect(page.getByRole('heading', { name: 'Home slides', level: 1 })).toBeVisible();
  await expect(page.getByText('once the theme’s hero is set to Your slides'), 'the hero shows slides, so nothing warns').toHaveCount(0);
  await page.getByRole('tab', { name: 'ไทย' }).click();

  // The first: a picture uploaded from the drawer, a heading, and a button that leaves the site.
  await page.getByRole('button', { name: 'Add slide' }).click();
  const drawer = page.getByRole('dialog', { name: 'New slide' });
  await drawer.getByRole('button', { name: 'Choose picture' }).click();
  const picker = page.locator('dialog.media-picker');
  await picker.locator('input[type="file"]').setInputFiles({ name: 'Lake.jpg', mimeType: 'image/jpeg', buffer: lake });
  await expect(drawer.getByText('1800 × 800'), 'the picture is chosen and its size said').toBeVisible();
  await expect(drawer.getByText(/Under 1,600/), 'wide enough, so no warning').toHaveCount(0);
  await drawer.getByLabel('Heading', { exact: true }).fill('ทะเลสาบยามเช้า');
  await drawer.getByLabel('Button', { exact: true }).fill('อ่านต่อ');
  await drawer.getByRole('radio', { name: 'An address' }).check();
  await drawer.getByLabel('Address', { exact: true }).fill('https://example.com/');
  await drawer.getByRole('checkbox', { name: 'Open in a new tab' }).check();
  await drawer.getByRole('button', { name: 'Done' }).click();
  await expect(status).toHaveText('Added a slide. Save to publish it.');

  // The second: the same picture, chosen from the library this time, other words, no button.
  await page.getByRole('button', { name: 'Add slide' }).click();
  await drawer.getByRole('button', { name: 'Choose picture' }).click();
  await picker.getByRole('button', { name: /^Select Lake\.jpg,/ }).click();
  await drawer.getByLabel('Heading', { exact: true }).fill('Second');
  await drawer.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Save slides' }).click();
  await expect(status).toHaveText('Slides saved.');

  const home = async (locale: 'th' | 'en') => {
    await page.goto(`${origin}/${locale}`);
    return page.evaluate(() => [...document.querySelectorAll('.hero-slide')].map((slide) => {
      const image = slide.querySelector('img')!;
      return {
        fetchpriority: image.getAttribute('fetchpriority'),
        heading: slide.querySelector('h2')?.textContent ?? null,
        loading: image.getAttribute('loading'),
        target: slide.querySelector('a')?.getAttribute('target') ?? null,
      };
    }));
  };
  expect(await home('th'), 'both slides, the first fetched first, the button opening a new tab').toEqual([
    { fetchpriority: 'high', heading: 'ทะเลสาบยามเช้า', loading: 'eager', target: '_blank' },
    { fetchpriority: 'low', heading: 'Second', loading: 'lazy', target: null },
  ]);
  expect(await home('en'), 'the English home page has slides of its own, and none yet').toEqual([]);

  // Reordered by keyboard alone, and the home page follows once it is saved.
  await page.goto(`${origin}/admin/slides`);
  await page.getByRole('group', { name: 'Actions for slide 1' }).getByRole('button', { name: 'Move down' }).focus();
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('Moved slide 1 to position 2.');
  await page.getByRole('button', { name: 'Save slides' }).click();
  await expect(status).toHaveText('Slides saved.');
  expect((await home('th')).map((slide) => slide.heading)).toEqual(['Second', 'ทะเลสาบยามเช้า']);

  // The library will not delete the picture from under them, and names each slide.
  await page.goto(`${origin}/admin/media`);
  await page.getByRole('button', { name: /^Lake\.jpg,/ }).click();
  const details = page.getByRole('dialog', { name: 'File details' });
  await details.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('still used');
  await expect(details.getByRole('link', { name: 'Second' })).toBeVisible();
  await expect(details.getByRole('link', { name: 'ทะเลสาบยามเช้า' })).toBeVisible();
});
```

The admin reads English because the harness's site is `en`; the slides are Thai because the
tab is. Both are the point: the screen's language and the slides' language are separate.

- [ ] **Step 3: Run it alone, then everything**

```bash
npm run test:e2e -- tests/e2e/home-slides.spec.ts --project=desktop
```

Expected: 1 passed. Check the guard that matters most to a reader: in `Home.astro`, make every
slide `fetchpriority="high"`, run the spec, see the first `toEqual` fail, and put it back.

```bash
npm run test:unit
npm run check
npm run build
npm run test:e2e
```

Expected: unit and check clean, the build succeeds, and the whole browser suite passes with the
phone project's Chromium-only tests skipped as by design. Do not run the unit suite while the
browser suite is running: `tests/unit/managed-installer.test.ts` spawns real processes on
timers and fails under that load, which is not a regression.

- [ ] **Step 4: Written down**

`CHANGELOG.md`, under `## Unreleased`, a section before `### Changed`:

```markdown
### Added

- **Home slides**, under Content: a picture, a heading, a line and a button for the top of each language's home page, up to ten a language and five shown, each with its own start and end if it wants them. `paper` draws them when its hero is set to Your slides, as a still banner for one and a slider for more, turning by itself or not, sliding or fading. A headless site reads the live ones from `/api/v1/content/slides`.
- A picture a slide uses cannot be deleted from the library, and the refusal names the slide.
```

and under `### Fixed`:

```markdown
- The covers slider fetched the pictures a reader had not reached at the same priority as the one on screen. They come last now.
```

`README.md`, under "### Look", after the themes line:

```markdown
- Home slides for each language, kept under Content: a picture, a few words and a button, drawn as a still banner or a slider by the theme
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/home-slides.spec.ts CHANGELOG.md README.md
```

```
test(slides): an owner's slides, made in the admin and seen on the site

The browser suite makes two slides in Thai from an admin in English, reads
them on the Thai home page and not the English one, reorders them by
keyboard, and is refused the delete of their picture. The changelog and the
README say what the owner now has.
```
