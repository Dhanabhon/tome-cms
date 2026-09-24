# Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TomeCMS counts views and reads of its own public pages into daily totals, with no cookie and no record of any reader, and shows them on a server-drawn Stats screen in the admin.

**Architecture:** A small module in `BaseLayout` posts `{ event, kind, id, locale, referrer, width }` to `POST /api/v1/stats/hit`, which always answers 204. The server checks the hit (schema, live id, referrer host, bot, per-address limit), finds the country (CDN header, else DB-IP Lite through `mmdb-lib`) and adds one to a row of `content_stats_daily` with an upsert. `/admin/stats` and `/admin/stats/<id>` read that table with `sum … group by` queries and draw an SVG chart, breakdowns and a table on the server, every choice in the address.

**Tech Stack:** Astro 7 SSR, Kysely + PostgreSQL 17, zod 4, `mmdb-lib` (new, MIT), `node --test`, Playwright (desktop + mobile Chromium).

**Spec:** `docs/specs/2026-09-24-stats-dashboard-design.md`

## Global Constraints

- Migration `025_content_stats`; table `content_stats_daily` with exactly the spec's columns: `owner_id`, `day` (`date`, site timezone), `kind` (`home`|`post`|`page`), `content_id` (null exactly for `home`), `locale` (`th`|`en`), `referrer` (host, no `www.`, `''` none, `internal` this site, ≤ 253 chars), `device` (`mobile` under 768px wide, else `desktop`), `country` (`''` or two upper-case letters), `views`, `reads` (`integer not null default 0`, never negative). No foreign key to posts or pages; the owner's deletion cascades.
- `POST /api/v1/stats/hit` answers **204 whatever happens**; the reason a hit was dropped goes to the server log, never the response. Body JSON, at most 1 KB (1,024 bytes). It stays outside `/api/v1/content/*`.
- A **view**: once per page per tab (`sessionStorage`). A **read**: posts and pages only, the end of the article in view **and** at least **15** visible seconds, once per page per tab. Read ratio = reads ÷ views.
- Not counted: a browser that has opened the signed-in admin (`localStorage` flag), Do Not Track `'1'`, Global Privacy Control `true`, a self-announcing bot User-Agent, pages that do not pass BaseLayout a `stats` prop, and BaseLayout rendered with a `themeId` (theme previews). The server never reads a session to count.
- Drop order on the server: schema → live id (`live()`, 5-minute process cache) → referrer reduced to a host → bot → **120 hits per address per 10 minutes**, kept in memory with a cap of **10,000** addresses and a `ponytail:` comment naming it one process's limit.
- Bundled mode accepts only this site (`Origin` equal to the site's origin, or no `Origin` and `Sec-Fetch-Site: same-origin`). Headless mode accepts any origin and answers CORS for `POST` with `Content-Type`.
- Country: the header named by `TOME_CMS_COUNTRY_HEADER` (default `cf-ipcountry`) when it is a two-letter code other than `XX`/`T1`; else DB-IP Lite at `TOME_CMS_GEOIP_PATH` (default `data/geoip/dbip-country-lite.mmdb`); else `''`. The reader's address is never written anywhere.
- The Stats screen: server-drawn, **no React island, no chart library**. State in the address: `range` = `7d` | `30d` (default) | `90d` | `12m`; `lang` = none | `th` | `en`; `sort` = `views` (default) | `reads` | `ratio`; `page` (50 rows a page). Views and reads change as a percentage; the read ratio as **points** (`↓ 2 points`); no previous data shows no change. Top 10 referrers and countries (`Intl.DisplayNames` in the owner's language), all devices and languages. DB-IP attribution under the country breakdown. A deleted article is listed as deleted.
- All admin copy in `src/lib/admin-i18n.ts`, English and Thai (`const th: typeof en`). Colours only through the tokens in `src/styles/installer-tokens.css` (`var(--color-*)`, `var(--space-*)`, `var(--radius-*)`).
- One new dependency only: `mmdb-lib` (MIT).
- Browser tests run on **both** Playwright projects (`desktop`, `mobile`).
- Every test is written before its code and seen to fail first; every guard is checked by putting back the bug it guards against.

**Standing rules for this repository:**

- Never `git stash`, `git reset --hard`, `git checkout --`, `git clean`. Stage by explicit path only (never `git add -A` or `git add .`).
- Commit messages are written to a file under the session scratchpad and committed with `git commit -F <file>` in a Bash call of its own. Conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). **No attribution lines of any kind** (no Co-Authored-By, no "Generated with", no mention of Claude or AI).
- `--no-verify` is blocked by a hook, and so is any single Bash command containing both the words "git commit" and a `-n` flag (for example `sed -n`). Write files with the Write tool.
- Never touch the containers `tome-cms-postgres-1`, `tome-cms-seaweedfs-1` or the dev server on port 4321. Integration tests run only through `node scripts/test-foundation.mjs <file>`; e2e specs bring up their own compose stack.
- Gates run one after another, never side by side: `npm run check`, `npm run test:unit`, the integration files touched, the e2e spec. Never run the unit suite while an e2e run is going. Use a Bash timeout of 600000 for these. If `tests/unit/managed-installer.test.ts` fails, check `uptime`, wait until the 1-minute load is under 15, and re-run that file alone before believing it.
- zsh: quote globs.

## Rulings on the spec

The spec is binding; these are the places the plan departs from its letter, and why.

1. **`readerAddress` trusts `X-Forwarded-For` from loopback *and private* addresses**, not loopback alone. The managed install publishes the app as `127.0.0.1:4321` from a Docker container, so the proxy's connection reaches the app from the Docker bridge gateway (for example `172.18.0.1`), never from loopback. Trusting loopback alone would put every reader of a real site behind one address and one limit of 120. Only the host and its containers can reach the app from a private address, because the port is bound to `127.0.0.1`. *Cost if wrong:* someone on a private network who can reach the port directly can choose the address the limit and the country see.
2. **The beacon sends with `fetch(…, { keepalive: true })` and `Content-Type: application/json`**, not `navigator.sendBeacon`. `sendBeacon` with a string sends `text/plain`, and Astro's built-in origin check answers 403 to a `text/plain` POST whose `Origin` differs from `url.origin`. Behind a TLS proxy `url.origin` can be `http://…` while the browser says `https://…`, so the site's own hits would be refused. JSON is outside that check, and `keepalive` finishes after the tab closes the way a beacon does. This is also the mechanism the spec already gives headless sites.
3. **The row key is a `unique nulls not distinct` constraint** instead of a unique index over `coalesce(content_id, …)`. It is the equivalent the spec allows, it lets the upsert name the constraint, and it begins with `(owner_id, day)`, so it is the index every read uses. There is no second index.
4. **Visible time is a one-second tick that counts only while `document.visibilityState` is `visible`**, not a sum of `visibilitychange` intervals. It measures the same thing, and Playwright's clock can drive it.
5. **The owner flag is set by `AdminShell`**, which draws every signed-in admin page, not by `AdminLayout`, which also draws the sign-in screen. A curious reader who opens `/admin` is not flagged.
6. **"The previous period of the same length"** is the same number of days immediately before the range. For `12m` the range runs from the first day of the month eleven months ago to today, so the comparison stays like with like.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/server/stats/rules.ts` | 1 | Pure hit rules: schema, referrer host, device, bot, day in a timezone, reader address, in-memory limit |
| `tests/unit/stats-rules.test.ts` | 1 | Their unit tests |
| `src/server/db/migrations/025_content_stats.ts` | 2 | The table |
| `src/server/db/types.ts`, `migrator.ts`, `reset-tables.ts`, `tests/unit/db-migrator.test.ts` | 2 | Register it |
| `tests/integration/stats-schema.test.ts` | 2 | Its checks |
| `src/server/stats/country.ts` | 3 | CDN header, then DB-IP Lite |
| `src/server/stats/hits.ts` | 3 | Receive, check and count one hit |
| `src/pages/api/v1/stats/hit.ts` | 3 | The endpoint |
| `src/server/http/openapi.ts`, `tests/unit/openapi.test.ts` | 3 | Describe it |
| `tests/unit/stats-country.test.ts`, `tests/integration/stats-hits.test.ts` | 3 | Tests |
| `src/lib/stats.ts` | 4 | What the browser and server agree on (no imports) |
| `src/components/StatsBeacon.astro` | 4 | The reader's script |
| `src/layouts/BaseLayout.astro`, three public routes, `src/components/admin/AdminShell.astro` | 4 | Wire it; flag the owner |
| `tests/e2e/stats.spec.ts` | 4, 6 | Browser tests |
| `src/server/stats/report.ts`, `tests/unit/stats-report.test.ts` | 5 | Pure period and change arithmetic, query parsing |
| `src/server/stats/dashboard.ts`, `tests/integration/stats-dashboard.test.ts` | 5 | The screen's queries |
| `src/pages/admin/stats.astro`, `src/pages/admin/stats/[id].astro` | 6 | The screens |
| `src/components/admin/stats/{StatsFilters,StatsReport,StatsChart,StatsShares}.astro`, `src/styles/stats.css` | 6 | Their parts |
| `src/lib/admin.ts`, `src/lib/icons.ts`, `src/lib/admin-i18n.ts` | 6 | Nav entry, icon, copy |
| `.github/workflows/release.yml`, `Dockerfile`, `.gitignore`, `.env.example`, `README.md`, `CHANGELOG.md` | 7 | Ship the GeoIP file; document |

---

### Task 1: The rules a hit is checked by

**Files:**
- Create: `src/server/stats/rules.ts`
- Test: `tests/unit/stats-rules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3 and 6):
  - `hitSchema` (zod) and `type Hit = { event: 'view' | 'read'; kind: 'home' | 'post' | 'page'; id?: string; locale: 'th' | 'en'; referrer?: string; width: number }`
  - `referrerHost(referrer: string | undefined, siteHost: string): string`
  - `deviceOf(width: number): 'desktop' | 'mobile'`, `MOBILE_BELOW = 768`
  - `isBot(userAgent: string | null): boolean`
  - `statsDay(now: Date, timeZone: string): string` (`YYYY-MM-DD`)
  - `readerAddress(request: Request, clientAddress: string): string`
  - `createRateLimit(options: { capacity: number; limit: number; windowMs: number }): RateLimit` with `allow(address: string, now?: number): boolean` and `readonly size: number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/stats-rules.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRateLimit, deviceOf, hitSchema, isBot, readerAddress, referrerHost, statsDay,
} from '../../src/server/stats/rules';

const ARTICLE = '5d0c7a1e-8b2f-4c3d-9e4f-1a2b3c4d5e6f';

test('a hit names a known event, kind and language, an id exactly when it is an article, and a real width', () => {
  const view = { event: 'view', id: ARTICLE, kind: 'post', locale: 'th', width: 1280 };
  assert.equal(hitSchema.safeParse(view).success, true);
  assert.equal(hitSchema.safeParse({ ...view, event: 'read', kind: 'page' }).success, true);
  assert.equal(hitSchema.safeParse({ event: 'view', kind: 'home', locale: 'en', width: 390 }).success, true);
  assert.equal(hitSchema.safeParse({ ...view, referrer: 'https://news.example/a' }).success, true);

  for (const [why, hit] of [
    ['home has no id', { ...view, kind: 'home' }],
    ['an article has one', { event: 'view', kind: 'post', locale: 'en', width: 1280 }],
    ['home has no end to read to', { event: 'read', kind: 'home', locale: 'en', width: 1280 }],
    ['an unknown event', { ...view, event: 'click' }],
    ['an unknown kind', { ...view, kind: 'feed' }],
    ['a language the site does not have', { ...view, locale: 'fr' }],
    ['an id that is not a uuid', { ...view, id: '1 or 1=1' }],
    ['no width', { event: 'view', id: ARTICLE, kind: 'post', locale: 'th' }],
    ['a width of nothing', { ...view, width: 0 }],
    ['a width in pieces', { ...view, width: 1280.5 }],
    ['a width no screen has', { ...view, width: 20_001 }],
    ['a referrer longer than any address', { ...view, referrer: `https://a.example/${'x'.repeat(2_048)}` }],
  ] as const) {
    assert.equal(hitSchema.safeParse(hit).success, false, why);
  }
});

test('the referrer is a host: www. dropped, this site internal, nonsense direct', () => {
  assert.equal(referrerHost('https://www.News.Example/story?id=1#top', 'blog.example'), 'news.example');
  assert.equal(referrerHost('http://t.co/abc', 'blog.example'), 't.co');
  assert.equal(referrerHost('https://blog.example/en/', 'blog.example'), 'internal');
  assert.equal(referrerHost('https://www.blog.example/', 'www.blog.example'), 'internal');
  assert.equal(referrerHost(undefined, 'blog.example'), '');
  assert.equal(referrerHost('', 'blog.example'), '');
  assert.equal(referrerHost('not an address', 'blog.example'), '');
  assert.equal(referrerHost('javascript:alert(1)', 'blog.example'), '');
  assert.equal(referrerHost('android-app://com.google.android.gm/', 'blog.example'), '');
  assert.equal(referrerHost('http://[::1]:8080/', 'blog.example'), '');
  const long = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.example/`;
  assert.equal(referrerHost(long, 'blog.example'), '', 'a host longer than DNS allows');
});

test('a window under 768 pixels is a phone', () => {
  assert.equal(deviceOf(767), 'mobile');
  assert.equal(deviceOf(768), 'desktop');
  assert.equal(deviceOf(320), 'mobile');
  assert.equal(deviceOf(2560), 'desktop');
});

test('a fetcher that names itself a bot is not a reader, and a browser is', () => {
  for (const agent of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (compatible; YandexBot/3.0)',
    'Twitterbot/1.0',
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'Mozilla/5.0 (compatible; Embedly/0.2)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
    'crawler4j',
    'Mozilla/5.0 (compatible; Baiduspider/2.0)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bitlybot/3.0; +http://bit.ly/)',
    'Mozilla/5.0 (Macintosh) LinkPreview/1.0',
  ]) assert.equal(isBot(agent), true, agent);
  assert.equal(isBot(null), true, 'no User-Agent at all');
  assert.equal(isBot(''), true);
  for (const agent of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
  ]) assert.equal(isBot(agent), false, agent);
});

test('the day is the site’s, either side of its midnight', () => {
  assert.equal(statsDay(new Date('2026-09-24T16:59:59Z'), 'Asia/Bangkok'), '2026-09-24');
  assert.equal(statsDay(new Date('2026-09-24T17:00:00Z'), 'Asia/Bangkok'), '2026-09-25');
  assert.equal(statsDay(new Date('2026-09-24T23:59:59Z'), 'UTC'), '2026-09-24');
  assert.equal(statsDay(new Date('2026-09-25T00:00:00Z'), 'UTC'), '2026-09-25');
  assert.equal(statsDay(new Date('2026-12-31T17:30:00Z'), 'Asia/Bangkok'), '2027-01-01');
});

test('X-Forwarded-For is believed only from the proxy side of the app', () => {
  const from = (forwarded?: string) => new Request('http://localhost/api/v1/stats/hit', {
    headers: forwarded === undefined ? {} : { 'X-Forwarded-For': forwarded },
  });
  assert.equal(readerAddress(from('198.51.100.4'), '203.0.113.9'), '203.0.113.9', 'a reader who reached the app directly');
  assert.equal(readerAddress(from('made-up, 198.51.100.4'), '127.0.0.1'), '198.51.100.4', 'the last entry is the proxy’s own');
  assert.equal(readerAddress(from('198.51.100.4'), '::1'), '198.51.100.4');
  assert.equal(readerAddress(from('198.51.100.4'), '::ffff:127.0.0.1'), '198.51.100.4');
  assert.equal(readerAddress(from('198.51.100.4'), '172.18.0.1'), '198.51.100.4', 'Docker’s bridge, which is how the managed install is reached');
  assert.equal(readerAddress(from('2001:db8::7'), '10.0.0.2'), '2001:db8::7');
  assert.equal(readerAddress(from(), '127.0.0.1'), '127.0.0.1', 'no header, nothing to believe');
  assert.equal(readerAddress(from('not an address'), '127.0.0.1'), '127.0.0.1');
});

test('the limit drops past 120 in ten minutes, starts again after, and remembers no more than its cap', () => {
  const limit = createRateLimit({ capacity: 3, limit: 120, windowMs: 600_000 });
  for (let hit = 0; hit < 120; hit += 1) assert.equal(limit.allow('198.51.100.4', 1_000), true);
  assert.equal(limit.allow('198.51.100.4', 1_001), false, 'the 121st');
  assert.equal(limit.allow('198.51.100.4', 600_999), false, 'still inside the window');
  assert.equal(limit.allow('198.51.100.4', 601_000), true, 'a new window after ten minutes');

  for (const address of ['a', 'b', 'c', 'd', 'e']) limit.allow(address, 700_000);
  assert.equal(limit.size, 3, 'never more addresses than the cap');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/unit/stats-rules.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/stats/rules'`.

- [ ] **Step 3: Write the rules**

Create `src/server/stats/rules.ts`:

```ts
import { BlockList, isIP } from 'node:net';

import { z } from 'zod';

/**
 * What a reader's page may say about itself, and nothing more.
 *
 * An article is counted by its edition's id, and the home page has none. The home page has no
 * end, so it is never read. Anything else is a request no page of this site makes.
 */
export const hitSchema = z.object({
  event: z.enum(['view', 'read']),
  id: z.uuid().optional(),
  kind: z.enum(['home', 'post', 'page']),
  locale: z.enum(['th', 'en']),
  referrer: z.string().max(2_048).optional(),
  width: z.int().min(1).max(20_000),
})
  .refine((hit) => (hit.kind === 'home') === (hit.id === undefined))
  .refine((hit) => hit.kind !== 'home' || hit.event === 'view');

export type Hit = z.infer<typeof hitSchema>;

const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Where a reader came from, as the one thing kept of it: the host, lower case and without
 * `www.`. This site is `internal`, and no referrer -- or one that is not a web address -- is ''.
 */
export function referrerHost(referrer: string | undefined, siteHost: string): string {
  if (!referrer || !URL.canParse(referrer)) return '';
  const url = new URL(referrer);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const host = url.hostname.replace(/^www\./, '');
  if (host.length > 253 || !HOST.test(host)) return '';
  return host === siteHost.toLowerCase().replace(/^www\./, '') ? 'internal' : host;
}

export const MOBILE_BELOW = 768;

export function deviceOf(width: number): 'desktop' | 'mobile' {
  return width < MOBILE_BELOW ? 'mobile' : 'desktop';
}

// ponytail: the fetchers that say what they are. One that pretends to be a browser is counted,
// which is why the numbers are called estimates.
const BOT = /bot\b|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent?.trim() || BOT.test(userAgent);
}

/** The calendar day it is at the site, as YYYY-MM-DD. */
export function statsDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: '2-digit', timeZone, year: 'numeric' })
    .formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Where the owner's reverse proxy connects from. The app is published on 127.0.0.1 only, so on
// a bare install that is loopback, and in the managed install it is Docker's bridge gateway.
const PROXY_SIDE = new BlockList();
PROXY_SIDE.addSubnet('127.0.0.0', 8, 'ipv4');
PROXY_SIDE.addSubnet('10.0.0.0', 8, 'ipv4');
PROXY_SIDE.addSubnet('172.16.0.0', 12, 'ipv4');
PROXY_SIDE.addSubnet('192.168.0.0', 16, 'ipv4');
PROXY_SIDE.addAddress('::1', 'ipv6');
PROXY_SIDE.addSubnet('fc00::', 7, 'ipv6');

function fromProxySide(address: string): boolean {
  const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
  const family = isIP(plain);
  return family !== 0 && PROXY_SIDE.check(plain, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Who sent a request, as far as the app can know.
 *
 * Only the owner's proxy can reach the app from its side, and it adds the address it saw as the
 * last entry of X-Forwarded-For. Anything earlier in the header is whatever the sender wrote.
 * From anywhere else the header is the sender's own words and is ignored.
 */
export function readerAddress(request: Request, clientAddress: string): string {
  if (!fromProxySide(clientAddress)) return clientAddress;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
  return isIP(forwarded) ? forwarded : clientAddress;
}

export interface RateLimit {
  allow(address: string, now?: number): boolean;
  readonly size: number;
}

/**
 * At most `limit` hits from one address in `windowMs`.
 *
 * ponytail: one process's memory. TomeCMS runs one application process; a second would keep a
 * limit of its own. When the cap is reached the oldest address is forgotten, which lets it start
 * again early -- the price of never growing past the cap however many addresses write.
 */
export function createRateLimit({ capacity, limit, windowMs }: { capacity: number; limit: number; windowMs: number }): RateLimit {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    allow(address, now = Date.now()) {
      const current = windows.get(address);
      if (current && current.resetAt > now) {
        windows.set(address, { ...current, count: current.count + 1 });
        return current.count < limit;
      }
      if (!current && windows.size >= capacity) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
      windows.set(address, { count: 1, resetAt: now + windowMs });
      return true;
    },
    get size() {
      return windows.size;
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import tsx --test tests/unit/stats-rules.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Check the guards by putting the bugs back**

One at a time, make each change, run the file, see the named test fail, and undo it:
- In `readerAddress`, drop the `fromProxySide` check (always read the header) → "X-Forwarded-For is believed only…" fails.
- In `readerAddress`, use `.at(0)` instead of `.at(-1)` → the same test fails on `'made-up, 198.51.100.4'`.
- In `deviceOf`, use `<=` → "a window under 768 pixels" fails.
- In `createRateLimit`, remove the eviction block → the cap assertion fails.
- Remove the second `.refine` → "home has no end to read to" fails.

- [ ] **Step 6: Gates and commit**

Run: `npm run check`, then `npm run test:unit`. Both pass.

```bash
git add src/server/stats/rules.ts tests/unit/stats-rules.test.ts
```

Message file:

```text
feat(stats): the rules a reader's hit is checked by

The schema a hit must fit, the referrer reduced to a host, a window under 768 pixels as a
phone, a short list of fetchers that call themselves bots, the day at the site, the reader's
address believed from the proxy's side only, and a per-address limit that never remembers
more than its cap.
```

---

### Task 2: The table the counts go in

**Files:**
- Create: `src/server/db/migrations/025_content_stats.ts`
- Modify: `src/server/db/types.ts` (the `Database` interface and a new table type), `src/server/db/migrator.ts:26,52`, `src/server/db/reset-tables.ts` (the `PLAN`), `tests/unit/db-migrator.test.ts:11`
- Test: `tests/integration/stats-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `content_stats_daily`; constraint names `content_stats_daily_key` (the unique key the upsert names), `content_stats_daily_{kind,content,locale,device,country,referrer,counts}_check`; Kysely type `ContentStatsDailyTable` registered as `Database['content_stats_daily']`. `day` is `ColumnType<Date, string, never>`: insert it as `YYYY-MM-DD` and always read it through `to_char`, because node-postgres turns a `date` into a local midnight.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/stats-schema.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const violates = (code: string, constraint: string) => (error: unknown) => typeof error === 'object'
  && error !== null && 'code' in error && error.code === code
  && 'constraint' in error && error.constraint === constraint;

test('content_stats_daily holds counters, and nothing a counter could not be', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  await migrateToLatest();

  const owner = randomUUID();
  await db.insertInto('user').values({
    id: owner, name: 'Owner', email: 'stats-schema@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const row = {
    content_id: randomUUID(), country: 'TH', day: '2026-09-24', device: 'desktop' as const, kind: 'post' as const,
    locale: 'en' as const, owner_id: owner, reads: 0, referrer: '', views: 1,
  };
  // An id no post has: counts are history, and outlive what they counted.
  await db.insertInto('content_stats_daily').values(row).execute();

  const refused = (values: Record<string, unknown>, constraint: string) => assert.rejects(
    db.insertInto('content_stats_daily').values({ ...row, content_id: randomUUID(), ...values } as never).execute(),
    violates('23514', constraint),
    constraint,
  );
  await refused({ kind: 'feed' }, 'content_stats_daily_kind_check');
  await refused({ content_id: null }, 'content_stats_daily_content_check');
  await refused({ kind: 'home' }, 'content_stats_daily_content_check');
  await refused({ locale: 'fr' }, 'content_stats_daily_locale_check');
  await refused({ device: 'tablet' }, 'content_stats_daily_device_check');
  await refused({ country: 'th' }, 'content_stats_daily_country_check');
  await refused({ country: 'THA' }, 'content_stats_daily_country_check');
  await refused({ referrer: 'a'.repeat(254) }, 'content_stats_daily_referrer_check');
  await refused({ views: -1 }, 'content_stats_daily_counts_check');
  await refused({ reads: -1 }, 'content_stats_daily_counts_check');

  // The home page has no id, and null is not a way around the key: the same home row twice is
  // one row, or the upsert would add a new one on every hit.
  const home = { ...row, content_id: null, kind: 'home' as const };
  await db.insertInto('content_stats_daily').values(home).execute();
  await assert.rejects(db.insertInto('content_stats_daily').values(home).execute(), violates('23505', 'content_stats_daily_key'));

  await db.deleteFrom('user').where('id', '=', owner).execute();
  const left = await db.selectFrom('content_stats_daily').select('owner_id').where('owner_id', '=', owner).execute();
  assert.equal(left.length, 0, 'the owner’s deletion takes the counts with it');
});
```

In `tests/unit/db-migrator.test.ts`, change line 11 to:

```ts
  assert.equal(names.at(-1), '025_content_stats');
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/db-migrator.test.ts`
Expected: FAIL — `'024_site_maintenance' !== '025_content_stats'`.

Run: `node scripts/test-foundation.mjs tests/integration/stats-schema.test.ts`
Expected: FAIL — `relation "content_stats_daily" does not exist` (and a type error on the table name).

- [ ] **Step 3: Write the migration and register it**

Create `src/server/db/migrations/025_content_stats.ts`:

```ts
import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The Stats screen's counters: one row a day for each combination of what a hit is broken down
 * by, and two numbers on it.
 *
 * Nothing here says who read anything. A hit adds one to its row with an upsert on the key, which
 * is atomic however many arrive at once. The key treats null as a value (`nulls not distinct`),
 * so the home page, which has no id, is one row a day like any article; it begins with
 * (owner_id, day), which makes it the index every read of the screen uses.
 *
 * `content_id` is not a foreign key. A deleted article keeps its history, and the screen lists
 * it as deleted.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table content_stats_daily (
      owner_id text not null references "user"(id) on delete cascade,
      day date not null,
      kind text not null,
      content_id uuid,
      locale text not null,
      referrer text not null default '',
      device text not null,
      country text not null default '',
      views integer not null default 0,
      reads integer not null default 0,
      constraint content_stats_daily_key
        unique nulls not distinct (owner_id, day, kind, content_id, locale, referrer, device, country),
      constraint content_stats_daily_kind_check check (kind in ('home', 'post', 'page')),
      constraint content_stats_daily_content_check check ((kind = 'home') = (content_id is null)),
      constraint content_stats_daily_locale_check check (locale in ('th', 'en')),
      constraint content_stats_daily_device_check check (device in ('mobile', 'desktop')),
      constraint content_stats_daily_country_check check (country = '' or country ~ '^[A-Z]{2}$'),
      constraint content_stats_daily_referrer_check check (char_length(referrer) <= 253),
      constraint content_stats_daily_counts_check check (views >= 0 and reads >= 0)
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop table content_stats_daily`.execute(db);
}
```

In `src/server/db/types.ts`, add to the `Database` interface after `content_redirects: ContentRedirectTable;`:

```ts
  content_stats_daily: ContentStatsDailyTable;
```

and add, after `HomeSlideTable`'s closing brace:

```ts
export interface ContentStatsDailyTable {
  owner_id: string;
  /** A day at the site, written as YYYY-MM-DD. Read it through to_char: node-postgres turns a date into a local midnight. */
  day: ColumnType<Date, string, never>;
  kind: 'home' | 'page' | 'post';
  content_id: string | null;
  locale: 'en' | 'th';
  referrer: Generated<string>;
  device: 'desktop' | 'mobile';
  country: Generated<string>;
  views: Generated<number>;
  reads: Generated<number>;
}
```

In `src/server/db/migrator.ts`, add after line 26:

```ts
import * as contentStats from './migrations/025_content_stats';
```

and after `'024_site_maintenance': siteMaintenance,`:

```ts
  '025_content_stats': contentStats,
```

In `src/server/db/reset-tables.ts`, add to `PLAN` after `content_redirects: 'truncate',`:

```ts
  content_stats_daily: 'truncate',
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --import tsx --test tests/unit/db-migrator.test.ts` — PASS.
Run: `node scripts/test-foundation.mjs tests/integration/stats-schema.test.ts` — PASS.

- [ ] **Step 5: Check a guard**

Change `unique nulls not distinct` to `unique` and re-run the integration file: the "same home row twice" assertion fails. Put it back.

- [ ] **Step 6: Gates and commit**

Run: `npm run check`, then `npm run test:unit`.

```bash
git add src/server/db/migrations/025_content_stats.ts src/server/db/types.ts src/server/db/migrator.ts src/server/db/reset-tables.ts tests/unit/db-migrator.test.ts tests/integration/stats-schema.test.ts
```

Message file:

```text
feat(stats): a table of daily counters

content_stats_daily keeps two numbers a row, for each day and each combination of kind,
edition, language, referring host, device and country. Its key treats the home page's missing
id as a value, so the home page is one row a day, and it begins with (owner_id, day) so every
read of the screen can use it. Deleted articles keep their rows; the owner's deletion does not.
```

---

### Task 3: Receiving a hit

**Files:**
- Modify: `package.json`, `package-lock.json` (add `mmdb-lib`)
- Create: `src/server/stats/country.ts`, `src/server/stats/hits.ts`, `src/pages/api/v1/stats/hit.ts`
- Modify: `src/server/http/openapi.ts`, `tests/unit/openapi.test.ts`
- Test: `tests/unit/stats-country.test.ts`, `tests/integration/stats-hits.test.ts`

**Interfaces:**
- Consumes: Task 1's `hitSchema`, `referrerHost`, `deviceOf`, `isBot`, `readerAddress`, `statsDay`, `createRateLimit`; Task 2's table and `content_stats_daily_key`; `live(alias)` from `src/server/content/live.ts`; `getSiteSettings()` from `src/server/content/settings.ts`; `getPublicSiteUrl(request)` from `src/lib/seo.ts`; `getServerEnv().TOME_CMS_FRONTEND_MODE`.
- Produces:
  - `readerCountry(headers: Headers, address: string, lookup?: (address: string) => string): string` and `lookupCountry(address: string): string`
  - `receiveHit(request: Request, clientAddress: string, options: { headless: boolean; now?: Date }): Promise<string | null>` — the reason a hit was dropped, or `null` when it was counted
  - `countHit(row: StatsRow, event: 'read' | 'view'): Promise<void>` with `StatsRow = { contentId: string | null; country: string; day: string; device: 'desktop' | 'mobile'; kind: 'home' | 'page' | 'post'; locale: 'en' | 'th'; ownerId: string; referrer: string }`
  - `POST` and `OPTIONS /api/v1/stats/hit`, always 204

- [ ] **Step 1: Add the dependency**

Run: `npm install mmdb-lib@^3.0.3`
Expected: `package.json` gains `"mmdb-lib": "^3.0.3"` under `dependencies` and the lock file updates.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/stats-country.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

// A file that is not there: a site without the GeoIP database is allowed, and knows no countries.
process.env.TOME_CMS_GEOIP_PATH = '/nonexistent/dbip-country-lite.mmdb';

const { lookupCountry, readerCountry } = await import('../../src/server/stats/country');

test('the CDN’s country wins, the GeoIP file answers without it, and neither is unknown', () => {
  const somewhere = () => 'AU';
  const nowhere = () => '';
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'TH' }), '1.1.1.1', somewhere), 'TH');
  assert.equal(readerCountry(new Headers({ 'cf-ipcountry': ' th ' }), '1.1.1.1', somewhere), 'TH');
  assert.equal(readerCountry(new Headers(), '1.1.1.1', somewhere), 'AU');
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'XX' }), '1.1.1.1', somewhere), 'AU', 'Cloudflare’s unknown');
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'T1' }), '1.1.1.1', somewhere), 'AU', 'Tor');
  assert.equal(readerCountry(new Headers({ 'CF-IPCountry': 'Thailand' }), '1.1.1.1', somewhere), 'AU');
  assert.equal(readerCountry(new Headers(), '1.1.1.1', nowhere), '');
});

test('a configured header is read instead of Cloudflare’s', () => {
  process.env.TOME_CMS_COUNTRY_HEADER = 'X-Country-Code';
  try {
    assert.equal(readerCountry(new Headers({ 'X-Country-Code': 'JP', 'CF-IPCountry': 'TH' }), '1.1.1.1', () => ''), 'JP');
  } finally {
    delete process.env.TOME_CMS_COUNTRY_HEADER;
  }
});

test('without the database file every address is unknown, and nothing throws', () => {
  assert.equal(lookupCountry('8.8.8.8'), '');
  assert.equal(lookupCountry('not an address'), '');
});
```

Create `tests/integration/stats-hits.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

// Ten connections instead of the harness's one. With one, "200 at once" would queue in the pool
// and prove nothing about two writers meeting on the same row.
process.env.DATABASE_POOL_MAX = '10';

/** TOME_CMS_PUBLIC_URL in scripts/test-foundation.mjs. */
const SITE = 'http://localhost:4321';
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function hitRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}/api/v1/stats/hit`, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: SITE, 'User-Agent': BROWSER, ...headers },
    method: 'POST',
  });
}

test('a hit is counted once into the right row, and anything else is dropped with its reason', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { sql } = await import('kysely');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { countHit, receiveHit } = await import('../../src/server/stats/hits');
  context.after(closeDatabase);
  await migrateToLatest();

  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'stats-hits@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Stats', default_locale: 'en', timezone: 'Asia/Bangkok', admin_path: '/admin',
    author_avatar_media_id: null,
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const post = (values: { locale?: 'en' | 'th'; published_at?: Date | null; status?: 'draft' | 'published' } = {}) =>
    db.transaction().execute(async (trx) => {
      const group = await trx.insertInto('post_translation_groups').values({ owner_id: ownerId }).returning('id').executeTakeFirstOrThrow();
      const { id } = await trx.insertInto('posts').values({
        content_html: '<p>Words</p>', content_json: { content: [], type: 'doc' }, cover_media_id: null,
        locale: values.locale ?? 'en', meta_description: null, meta_title: null, owner_id: ownerId,
        published_at: values.published_at === undefined ? new Date('2026-01-01T00:00:00Z') : values.published_at,
        slug: `post-${randomUUID()}`, status: values.status ?? 'published', title: 'A post', translation_group_id: group.id,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('post_category_assignments').values({ category_id: category.id, owner_id: ownerId, translation_group_id: group.id }).execute();
      return id;
    });

  const article = await post();
  const draft = await post({ published_at: null, status: 'draft' });
  const due = await post({ published_at: new Date(Date.now() + 86_400_000) });
  const thai = await post({ locale: 'th' });

  const NOON = new Date('2026-09-24T05:00:00Z'); // 12:00 in Bangkok
  let next = 0;
  // A new address for every hit, so the limit is only in play where it is being tested.
  const send = (body: unknown, headers?: Record<string, string>, options: { headless?: boolean; now?: Date } = {}) =>
    receiveHit(hitRequest(body, headers), `203.0.113.${(next += 1) % 250}`, { headless: options.headless ?? false, now: options.now ?? NOON });
  const rows = () => db.selectFrom('content_stats_daily')
    .select([sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'), 'kind', 'content_id', 'locale', 'referrer', 'device', 'country', 'views', 'reads'])
    .where('owner_id', '=', ownerId).orderBy('day').orderBy('referrer').orderBy('device').orderBy('kind').execute();
  const view = { event: 'view', id: article, kind: 'post', locale: 'en', width: 1280 };

  assert.equal(await send(view, { 'CF-IPCountry': 'TH' }), null);
  assert.equal(await send({ ...view, event: 'read', referrer: 'https://www.news.example/story?x=1', width: 375 }), null);
  assert.equal(await send({ ...view, referrer: `${SITE}/en/` }), null);
  assert.equal(await send(view, {}, { now: new Date('2026-09-24T17:30:00Z') }), null, 'half past midnight in Bangkok');
  assert.equal(await send({ event: 'view', kind: 'home', locale: 'en', width: 800 }), null);
  assert.deepEqual(await rows(), [
    { content_id: null, country: '', day: '2026-09-24', device: 'desktop', kind: 'home', locale: 'en', reads: 0, referrer: '', views: 1 },
    { content_id: article, country: 'TH', day: '2026-09-24', device: 'desktop', kind: 'post', locale: 'en', reads: 0, referrer: '', views: 1 },
    { content_id: article, country: '', day: '2026-09-24', device: 'desktop', kind: 'post', locale: 'en', reads: 0, referrer: 'internal', views: 1 },
    { content_id: article, country: '', day: '2026-09-24', device: 'mobile', kind: 'post', locale: 'en', reads: 1, referrer: 'news.example', views: 0 },
    { content_id: article, country: '', day: '2026-09-25', device: 'desktop', kind: 'post', locale: 'en', reads: 0, referrer: '', views: 1 },
  ]);

  const before = await rows();
  for (const [reason, dropped] of [
    ['not-live', send({ ...view, id: draft })],
    ['not-live', send({ ...view, id: due })],
    ['not-live', send({ ...view, id: thai })],
    ['not-live', send({ ...view, id: randomUUID() })],
    ['invalid', send({ ...view, kind: 'home' })],
    ['invalid', send({ event: 'read', kind: 'home', locale: 'en', width: 800 })],
    ['invalid', send({ ...view, width: 0 })],
    ['not-json', send('{"event":')],
    ['not-json', send(view, { 'Content-Type': 'text/plain' })],
    ['too-large', send({ ...view, referrer: `https://a.example/${'x'.repeat(1_100)}` })],
    ['bot', send(view, { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })],
    ['cross-origin', send(view, { Origin: 'https://elsewhere.example' })],
    ['cross-origin', receiveHit(new Request(`${SITE}/api/v1/stats/hit`, {
      body: JSON.stringify(view), headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER }, method: 'POST',
    }), '203.0.113.200', { headless: false, now: NOON })],
  ] as const) {
    assert.equal(await dropped, reason);
  }
  assert.deepEqual(await rows(), before, 'nothing dropped reached a row');

  assert.equal(await send(view, { Origin: '', 'Sec-Fetch-Site': 'same-origin' }), null, 'a same-origin request that sent no Origin');
  assert.equal(await send(view, { Origin: 'https://reader.example' }, { headless: true }), null, 'any origin, when the site is headless');

  // The limit, from one address.
  const outcomes = [];
  for (let hit = 0; hit < 125; hit += 1) {
    outcomes.push(await receiveHit(hitRequest(view), '198.51.100.7', { headless: false, now: NOON }));
  }
  assert.equal(outcomes.filter((outcome) => outcome === null).length, 120);
  assert.deepEqual(outcomes.slice(120), Array(5).fill('rate-limited'));

  // Two hundred writers on one row.
  const row = {
    contentId: article, country: '', day: '2026-01-01', device: 'desktop' as const, kind: 'post' as const,
    locale: 'en' as const, ownerId, referrer: 'concurrency.example',
  };
  await Promise.all(Array.from({ length: 200 }, () => countHit(row, 'view')));
  const counted = await db.selectFrom('content_stats_daily').select(['views', 'reads'])
    .where('owner_id', '=', ownerId).where('referrer', '=', 'concurrency.example').execute();
  assert.deepEqual(counted, [{ reads: 0, views: 200 }]);

  const everything = JSON.stringify(await db.selectFrom('content_stats_daily').selectAll().execute());
  assert.equal(/203\.0\.113\.|198\.51\.100\./.test(everything), false, 'no address in any row');
});
```

In `tests/unit/openapi.test.ts`:
- Change the `DocumentShape['paths']` value type to:

```ts
  readonly paths: Readonly<Record<string, {
    readonly get?: OperationShape;
    readonly options: OperationShape;
    readonly post?: OperationShape & { readonly requestBody?: { readonly content: Readonly<Record<string, unknown>> } };
  }>>;
```

- Replace `assert.deepEqual(Object.keys(document.paths), expectedPaths);` with:

```ts
  assert.deepEqual(Object.keys(document.paths), [...expectedPaths, '/api/v1/stats/hit']);
```

- In the `for (const path of expectedPaths)` loop, change the `item.get.…` lines to use a local `const get = item.get!;` and `get.operationId`, `get.responses[...]`.
- Change the two later uses `document.paths['/api/v1/content/posts'].get.parameters` and `document.paths['/api/v1/content/pages/{slug}'].get.parameters` to `.get?.parameters`, and `.get.responses['404']` / `.get.responses['503']` to `.get?.responses['404']` / `.get?.responses['503']`.
- Add after the loop:

```ts
  const stats = document.paths['/api/v1/stats/hit'];
  assert.deepEqual(Object.keys(stats).sort(), ['options', 'post'], 'the one write: a count, and its preflight');
  assert.deepEqual(Object.keys(stats.post?.responses ?? {}), ['204'], 'it answers nothing but 204');
  assert.deepEqual(Object.keys(stats.post?.requestBody?.content ?? {}), ['application/json']);
  assert.ok(document.components.schemas.StatsHit, 'StatsHit is described');
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --import tsx --test tests/unit/stats-country.test.ts tests/unit/openapi.test.ts`
Expected: FAIL — the country module is missing; the OpenAPI paths lack `/api/v1/stats/hit`.

Run: `node scripts/test-foundation.mjs tests/integration/stats-hits.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/stats/hits'`.

- [ ] **Step 4: Write the country lookup**

Create `src/server/stats/country.ts`:

```ts
import { readFileSync } from 'node:fs';

import { Reader, type CountryResponse } from 'mmdb-lib';

const CODE = /^[A-Z]{2}$/;
// Cloudflare's words for "no country": unknown, and Tor.
const NOT_A_COUNTRY = new Set(['T1', 'XX']);

let reader: Reader<CountryResponse> | null | undefined;

function openReader(): Reader<CountryResponse> | null {
  try {
    return new Reader<CountryResponse>(readFileSync(process.env.TOME_CMS_GEOIP_PATH || 'data/geoip/dbip-country-lite.mmdb'));
  } catch {
    // No file is a site without GeoIP, which is allowed: its readers' countries are unknown.
    return null;
  }
}

/** The country DB-IP Lite places an address in, or '' when it cannot say. */
export function lookupCountry(address: string): string {
  reader ??= openReader();
  try {
    const code = reader?.get(address)?.country?.iso_code ?? '';
    return CODE.test(code) ? code : '';
  } catch {
    // mmdb-lib throws on an address it cannot parse.
    return '';
  }
}

/**
 * The reader's country: the CDN's header when it names one, else the GeoIP file, else ''.
 * The address is looked up and let go; nothing here keeps it.
 */
export function readerCountry(headers: Headers, address: string, lookup: (address: string) => string = lookupCountry): string {
  const header = headers.get(process.env.TOME_CMS_COUNTRY_HEADER || 'cf-ipcountry')?.trim().toUpperCase() ?? '';
  return CODE.test(header) && !NOT_A_COUNTRY.has(header) ? header : lookup(address);
}
```

- [ ] **Step 5: Write the hit service**

Create `src/server/stats/hits.ts`:

```ts
import { getPublicSiteUrl } from '../../lib/seo';
import { live } from '../content/live';
import { getSiteSettings } from '../content/settings';
import { db } from '../db/client';
import { readerCountry } from './country';
import { createRateLimit, deviceOf, hitSchema, isBot, readerAddress, referrerHost, statsDay, type Hit } from './rules';

const MAX_BODY_BYTES = 1_024;
const LIVE_FOR_MS = 5 * 60_000;
const LIVE_CAPACITY = 10_000;

const limit = createRateLimit({ capacity: 10_000, limit: 120, windowMs: 10 * 60_000 });
// ponytail: one process's memory, like the limit. Cleared whole when full, so made-up ids cost a
// query each and never grow it past its cap.
const liveIds = new Map<string, { expiresAt: number; live: boolean }>();

export interface StatsRow {
  contentId: string | null;
  country: string;
  day: string;
  device: 'desktop' | 'mobile';
  kind: 'home' | 'page' | 'post';
  locale: 'en' | 'th';
  ownerId: string;
  referrer: string;
}

/** Adds one to a day's counter. Atomic however many arrive at once: the row is the lock. */
export async function countHit(row: StatsRow, event: 'read' | 'view'): Promise<void> {
  await db.insertInto('content_stats_daily').values({
    content_id: row.contentId,
    country: row.country,
    day: row.day,
    device: row.device,
    kind: row.kind,
    locale: row.locale,
    owner_id: row.ownerId,
    reads: event === 'read' ? 1 : 0,
    referrer: row.referrer,
    views: event === 'view' ? 1 : 0,
  }).onConflict((conflict) => conflict.constraint('content_stats_daily_key').doUpdateSet((eb) => ({
    reads: eb('content_stats_daily.reads', '+', eb.ref('excluded.reads')),
    views: eb('content_stats_daily.views', '+', eb.ref('excluded.views')),
  }))).execute();
}

/** Whether a hit names something a reader could be reading: live, this owner's, in that language. */
async function isLive(ownerId: string, hit: Hit): Promise<boolean> {
  if (hit.kind === 'home') return true;
  if (!hit.id) return false;
  const key = `${hit.kind}:${hit.id}:${hit.locale}`;
  const cached = liveIds.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.live;
  const table = hit.kind === 'post' ? 'posts' : 'pages';
  const row = await db.selectFrom(table).select('id')
    .where('owner_id', '=', ownerId).where('id', '=', hit.id).where('locale', '=', hit.locale).where(live(table))
    .executeTakeFirst();
  if (liveIds.size >= LIVE_CAPACITY) liveIds.clear();
  liveIds.set(key, { expiresAt: Date.now() + LIVE_FOR_MS, live: row !== undefined });
  return row !== undefined;
}

/** Bundled mode takes hits from this site only: its Origin, or a same-origin request that sent none. */
function fromThisSite(request: Request, origin: string): boolean {
  const from = request.headers.get('origin');
  return from ? from === origin : request.headers.get('sec-fetch-site') === 'same-origin';
}

/** The body, or null past the limit -- read as a stream, so a large one is never held whole. */
async function smallBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Counts one hit, or says why it did not.
 *
 * The reason is for the server's log and nothing else: the endpoint answers 204 either way, so
 * someone inflating the numbers learns nothing about which of their requests counted.
 */
export async function receiveHit(
  request: Request,
  clientAddress: string,
  options: { headless: boolean; now?: Date },
): Promise<string | null> {
  const site = getPublicSiteUrl(request);
  if (!options.headless && !fromThisSite(request, site.origin)) return 'cross-origin';
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return 'not-json';
  const text = await smallBody(request);
  if (text === null) return 'too-large';
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'not-json';
  }
  const parsed = hitSchema.safeParse(body);
  if (!parsed.success) return 'invalid';
  const hit = parsed.data;

  const settings = await getSiteSettings();
  if (!settings) return 'not-installed';
  if (!await isLive(settings.owner_id, hit)) return 'not-live';
  // A headless site's own pages are its own origin, not the CMS's.
  const origin = request.headers.get('origin');
  const home = origin && URL.canParse(origin) ? new URL(origin).hostname : site.hostname;
  const referrer = referrerHost(hit.referrer, home);
  if (isBot(request.headers.get('user-agent'))) return 'bot';
  const address = readerAddress(request, clientAddress);
  if (!limit.allow(address)) return 'rate-limited';

  await countHit({
    contentId: hit.id ?? null,
    country: readerCountry(request.headers, address),
    day: statsDay(options.now ?? new Date(), settings.timezone),
    device: deviceOf(hit.width),
    kind: hit.kind,
    locale: hit.locale,
    ownerId: settings.owner_id,
    referrer,
  }, hit.event);
  return null;
}
```

If Kysely does not accept `db.selectFrom(table)` with the union `'posts' | 'pages'`, write the two queries as an `if`/`else`, each with its own literal table name; the behaviour is the same.

- [ ] **Step 6: Write the endpoint**

Create `src/pages/api/v1/stats/hit.ts`:

```ts
import type { APIRoute } from 'astro';

import { getServerEnv } from '../../../../server/env';
import { receiveHit } from '../../../../server/stats/hits';

const CORS = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Max-Age': '86400',
};

/** 204, and in headless mode the CORS a headless site's browser needs to send at all. */
function answer(headless: boolean): Response {
  return new Response(null, { headers: { 'Cache-Control': 'no-store', ...(headless ? CORS : {}) }, status: 204 });
}

/**
 * One count from a reader's browser. The answer is 204 whatever happened, and why a hit was
 * dropped goes to the log: nothing a sender sees tells them which of their requests counted.
 */
export const POST: APIRoute = async ({ clientAddress, request }) => {
  const headless = getServerEnv().TOME_CMS_FRONTEND_MODE === 'headless';
  try {
    const dropped = await receiveHit(request, clientAddress, { headless });
    if (dropped) console.info(JSON.stringify({ event: 'stats_hit_dropped', reason: dropped }));
  } catch (error) {
    console.error('Stats hit failed:', error instanceof Error ? error.message : 'unknown error');
  }
  return answer(headless);
};

export const OPTIONS: APIRoute = () => answer(getServerEnv().TOME_CMS_FRONTEND_MODE === 'headless');
```

- [ ] **Step 7: Describe it in OpenAPI**

In `src/server/http/openapi.ts`:
- Add `import { hitSchema } from '../stats/rules';` after the `./public-schemas` import.
- Change `info.description` to `'Published content for websites, applications, and other headless clients, and the one thing they may write: a count of a reader.'`.
- Add to `tags`: `{ name: 'Stats', description: 'Counting readers' },`.
- Add to `paths`, after the `'/api/v1/content/openapi.json'` entry:

```ts
    '/api/v1/stats/hit': {
      post: {
        operationId: 'postStatsHit',
        summary: 'Count a view or a read',
        description: 'Answers 204 whether or not the hit was counted. In bundled mode only this site may send; in headless mode any origin may, with Content-Type: application/json.',
        tags: ['Stats'],
        requestBody: { required: true, content: { 'application/json': { schema: schemaRef('StatsHit') } } },
        responses: { '204': responseRef('NoContent') },
      },
      options: optionsOperation('optionsStatsHit'),
    },
```

- Add to `components.schemas`, beside the other `componentSchema(...)` entries: `StatsHit: componentSchema(hitSchema),`.

- [ ] **Step 8: Run the tests to see them pass**

Run: `node --import tsx --test tests/unit/stats-country.test.ts tests/unit/openapi.test.ts` — PASS.
Run: `node scripts/test-foundation.mjs tests/integration/stats-hits.test.ts` — PASS.

- [ ] **Step 9: Check the guards**

One at a time, each followed by the integration file, then undone:
- In `receiveHit`, skip the `fromThisSite` check → the `cross-origin` expectations fail.
- In `countHit`, change `doUpdateSet` to set `views: eb.ref('excluded.views')` (overwrite instead of add) → "Two hundred writers" fails.
- In `isLive`, drop `.where(live(table))` → the draft and the not-yet-due post are counted.
- In `isLive`, drop `.where('locale', '=', hit.locale)` → the Thai id is counted.
- In `smallBody`, remove the size check → `too-large` fails.

- [ ] **Step 10: Gates and commit**

Run: `npm run check`, then `npm run test:unit`.

```bash
git add package.json package-lock.json src/server/stats/country.ts src/server/stats/hits.ts src/pages/api/v1/stats/hit.ts src/server/http/openapi.ts tests/unit/openapi.test.ts tests/unit/stats-country.test.ts tests/integration/stats-hits.test.ts
```

Message file:

```text
feat(stats): POST /api/v1/stats/hit counts a view or a read

Always 204; why a hit was dropped goes to the log. A hit is counted only when it fits the
schema, names a live edition in its own language, comes from this site (any origin when
headless), is not from a self-declared bot, and its address has sent fewer than 120 in ten
minutes. The country is the CDN's header, else DB-IP Lite through mmdb-lib, else unknown;
the address is used and let go. The count is one upsert, atomic under any number of writers.
```

---

### Task 4: The reader's script

**Files:**
- Create: `src/lib/stats.ts`, `src/components/StatsBeacon.astro`
- Modify: `src/layouts/BaseLayout.astro`, `src/pages/[locale]/index.astro:67-73`, `src/pages/[locale]/blog/[slug].astro:71-85`, `src/pages/[locale]/[slug].astro:46-56`, `src/components/admin/AdminShell.astro`
- Test: `tests/e2e/stats.spec.ts`

**Interfaces:**
- Consumes: Task 3's endpoint.
- Produces:
  - `src/lib/stats.ts`: `STATS_ENDPOINT = '/api/v1/stats/hit'`, `STATS_OWNER_KEY = 'tomecms:stats-owner'`, `READ_AFTER_SECONDS = 15`, `type CountedPage = { kind: 'home' } | { id: string; kind: 'page' | 'post' }`
  - BaseLayout prop `stats?: CountedPage`
  - The DOM marker `[data-stats-end]` at the end of the page's `<article>` (Task 6's browser test relies on it too)
  - `tests/e2e/stats.spec.ts` with its helpers (Task 6 adds one test to it)

- [ ] **Step 1: Write the failing browser test**

Create `tests/e2e/stats.spec.ts`:

```ts
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Counting readers, measured in their browser and read back from the table.
 *
 * Counts are read with psql, not through the app's pool: a second pool in the Playwright worker
 * beside the dev server's own hung another suite (see public-plugins.spec.ts). The pool is opened
 * only to issue the owner's sign-in, as maintenance.spec.ts does.
 */

test.use({ stack: 'stats' });

const PROJECT = 'tomecms-stats';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'stats-secret-at-least-32-characters!';
const OWNER = '3a9c2e1f-7b4d-4e6a-8c5f-0d1e2f3a4b5c';
const ARTICLE = '5d0c7a1e-8b2f-4c3d-9e4f-1a2b3c4d5e6f';
const THAI = '6e1d8b2f-9c3a-4d4e-8f5a-2b3c4d5e6f70';
const GONE = '7f2e9c3a-ad4b-4e5f-9a6b-3c4d5e6f7081';
const ARTICLE_GROUP = '8a3f0d4b-be5c-4f6a-8b7c-4d5e6f708192';
const THAI_GROUP = '9b4a1e5c-cf6d-4a7b-9c8d-5e6f708192a3';
// Long enough that the end of the article is below the fold on both projects.
const BODY = Array.from({ length: 40 }, () => `<p>${'A sentence worth reading slowly. '.repeat(30)}</p>`).join('');

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function query(statement: string): string {
  return docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-t', '-A',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', statement], 60_000).stdout.trim();
}

function counts(id: string): { reads: number; views: number } {
  const [views, reads] = query(`select coalesce(sum(views), 0) || '|' || coalesce(sum(reads), 0)
    from content_stats_daily where content_id = '${id}'`).split('|').map(Number);
  return { reads, views };
}

/** The events a page posts to the counter, in order, as the browser sends them. */
function watchHits(page: Page): string[] {
  const events: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/stats/hit') {
      events.push(String(JSON.parse(request.postData() ?? '{}').event));
    }
  });
  return events;
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

async function signIn(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const enrollment = await issueRecoveryEnrollment(OWNER);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
}

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  process.env.TOME_CMS_TEST_ORIGIN = origin;
  const serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    // Astro 7 backgrounds the dev server when it detects an agent, and a detached server is
    // one this test cannot wait on or stop.
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-stats',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  query('drop schema public cascade; create schema public;');

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner with an English and a Thai article, without walking the wizard.
  query(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
      values (true, '${OWNER}', 'Stats Test', 'en', 'UTC', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);
    insert into post_translation_groups (id, owner_id) values ('${ARTICLE_GROUP}', '${OWNER}'), ('${THAI_GROUP}', '${OWNER}');
    insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select g.id, c.id, '${OWNER}' from post_translation_groups g, categories c;
    insert into posts (id, translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
      values ('${ARTICLE}', '${ARTICLE_GROUP}', 'en', 'Worth reading', 'worth-reading', '{"type":"doc","content":[]}'::jsonb,
          '${BODY}', 'published', now() - interval '1 day', '${OWNER}'),
        ('${THAI}', '${THAI_GROUP}', 'th', 'บทความภาษาไทย', 'thai-article', '{"type":"doc","content":[]}'::jsonb,
          '<p>สั้น ๆ</p>', 'published', now() - interval '1 day', '${OWNER}');`);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Stats test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Stats test server never became ready.\n${output}`);
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

test('a view counts once a tab, and a read takes the end and fifteen visible seconds', async ({ context, page }) => {
  test.setTimeout(90_000);
  await context.clock.install();
  const first = watchHits(page);
  await page.goto(`${origin}/en/blog/worth-reading`);
  await expect.poll(() => counts(ARTICLE)).toEqual({ reads: 0, views: 1 });

  await page.reload();
  await context.clock.runFor(20_000);
  expect(first, 'a reload sends nothing, and twenty seconds above the end are not a read').toEqual(['view']);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => first).toEqual(['view', 'read']);
  await expect.poll(() => counts(ARTICLE)).toEqual({ reads: 1, views: 1 });

  // A new tab is a new reader as far as a tab can tell: a view, and a read of its own once earned.
  const second = await context.newPage();
  const more = watchHits(second);
  await second.bringToFront();
  await second.goto(`${origin}/en/blog/worth-reading`);
  await second.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await context.clock.runFor(10_000);
  expect(more, 'the end reached, but ten seconds are not fifteen').toEqual(['view']);
  await context.clock.runFor(5_000);
  await expect.poll(() => more).toEqual(['view', 'read']);
  await expect.poll(() => counts(ARTICLE)).toEqual({ reads: 2, views: 2 });
});

test('a reader who asked not to be followed, and a hit from another site, count nothing', async ({ browser, request }) => {
  for (const [why, script] of [
    ['Do Not Track', 'Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1" })'],
    ['Global Privacy Control', 'Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true })'],
  ] as const) {
    const context = await browser.newContext();
    await context.addInitScript(script);
    const page = await context.newPage();
    const hits = watchHits(page);
    await page.goto(`${origin}/en/blog/worth-reading`);
    expect(hits, why).toEqual([]);
    await context.close();
  }

  const before = counts(ARTICLE);
  const hit = { event: 'view', id: ARTICLE, kind: 'post', locale: 'en', width: 1280 };
  const refused = await request.post(`${origin}/api/v1/stats/hit`, { data: hit, headers: { Origin: 'https://elsewhere.example' } });
  expect(refused.status(), 'the same answer as a hit that counted').toBe(204);
  // The same request from the site itself does count, so the one above was refused, not lost.
  const own = await request.post(`${origin}/api/v1/stats/hit`, { data: hit, headers: { Origin: origin } });
  expect(own.status()).toBe(204);
  await expect.poll(() => counts(ARTICLE)).toEqual({ ...before, views: before.views + 1 });
});

test('the owner’s own browser counts nothing, and neither does a theme preview', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);

  const tab = await context.newPage();
  const hits = watchHits(tab);
  await tab.goto(`${origin}/en/blog/worth-reading`);
  expect(hits, 'a browser that has opened the admin').toEqual([]);
  await tab.close();

  await page.goto(`${origin}/admin/themes/preview/paper`);
  await expect(page.locator('[data-stats]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:e2e -- tests/e2e/stats.spec.ts`
Expected: FAIL on both projects — the first test's `expect.poll` times out at `{ reads: 0, views: 0 }` because no page sends a hit.

- [ ] **Step 3: Write what the browser and server agree on**

Create `src/lib/stats.ts`:

```ts
/**
 * What a reader's page and the server agree on about counting.
 *
 * No imports: the script that reads this ships on every public page, and anything this file
 * pulled in would ship with it.
 */

export const STATS_ENDPOINT = '/api/v1/stats/hit';

/** Set by every signed-in admin page in that browser; the reader's script sends nothing while it is there. */
export const STATS_OWNER_KEY = 'tomecms:stats-owner';

/** Seconds the tab must have been visible, in all, before reaching the end counts as a read. */
export const READ_AFTER_SECONDS = 15;

/** What a public page is, for counting: the home page, or one edition by its id. */
export type CountedPage = { kind: 'home' } | { id: string; kind: 'page' | 'post' };
```

- [ ] **Step 4: Write the script**

Create `src/components/StatsBeacon.astro`:

```astro
---
import type { CountedPage } from '../lib/stats';
import type { PostLocale } from '../types/cms';

interface Props {
  locale: PostLocale;
  stats: CountedPage;
}

/*
 * Counts this page for the owner's Stats screen: a view once per tab, and for an article, a read
 * once the end has come into view and the tab has been visible for fifteen seconds in all.
 *
 * Nothing is sent from the owner's own browser, or for a reader who set Do Not Track or Global
 * Privacy Control. What is sent names the page, never the reader: no cookie, no identifier.
 */
const { locale, stats } = Astro.props;
---

<template data-id={'id' in stats ? stats.id : undefined} data-kind={stats.kind} data-locale={locale} data-stats></template>

<script>
  import { READ_AFTER_SECONDS, STATS_ENDPOINT, STATS_OWNER_KEY } from '../lib/stats';

  type StatsEvent = 'read' | 'view';

  function silent(): boolean {
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (navigator.doNotTrack === '1' || privacy.globalPrivacyControl === true) return true;
    try {
      return localStorage.getItem(STATS_OWNER_KEY) !== null;
    } catch {
      return false; // storage blocked: a reader like any other
    }
  }

  /** True the first time this tab asks about this page and event; a reload asks again and is told no. */
  function firstTime(event: StatsEvent): boolean {
    const key = `tomecms:stats:${event}:${location.pathname}`;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch {
      // Nowhere to remember it: this load counts, and so will the next.
    }
    return true;
  }

  function send(event: StatsEvent, page: DOMStringMap): void {
    const body = JSON.stringify({
      event,
      id: page.id,
      kind: page.kind,
      locale: page.locale,
      referrer: document.referrer || undefined,
      width: window.innerWidth,
    });
    // keepalive lets it finish after the reader has gone, as a beacon would; JSON keeps it clear
    // of the framework's check on cross-site form posts, which sendBeacon's text would meet.
    fetch(STATS_ENDPOINT, { body, headers: { 'Content-Type': 'application/json' }, keepalive: true, method: 'POST' })
      .catch(() => {
        // A count lost is a count lost; the reader is never told.
      });
  }

  const mount = document.querySelector<HTMLElement>('[data-stats]');
  const article = document.querySelector('article');
  if (mount && !silent()) {
    const page = mount.dataset;
    if (firstTime('view')) send('view', page);

    if (page.kind !== 'home' && article) {
      const end = document.createElement('span');
      end.setAttribute('aria-hidden', 'true');
      end.dataset.statsEnd = '';
      end.style.cssText = 'display: block; block-size: 1px;';
      article.append(end);

      let reachedEnd = false;
      let visibleSeconds = 0;
      const clock = window.setInterval(() => {
        if (document.visibilityState === 'visible') visibleSeconds += 1;
        check();
      }, 1_000);
      const observer = new IntersectionObserver((entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) reachedEnd = true;
        check();
      });
      observer.observe(end);

      function check(): void {
        if (!reachedEnd || visibleSeconds < READ_AFTER_SECONDS) return;
        window.clearInterval(clock);
        observer.disconnect();
        if (firstTime('read')) send('read', page);
      }
    }
  }
</script>
```

- [ ] **Step 5: Put it in the layout, and give it to the three public routes**

In `src/layouts/BaseLayout.astro`:
- Add imports: `import StatsBeacon from '../components/StatsBeacon.astro';` beside the other component imports, and `import type { CountedPage } from '../lib/stats';` beside the other `lib` imports.
- Add to `Props`, after `robots?: string;`:

```ts
  /**
   * What this page is, for the owner's Stats screen. Only the home page, a post and a page pass
   * it; everything else -- a 404, an error, a preview -- carries no counting script.
   */
  stats?: CountedPage;
```

- Add `stats,` to the destructuring of `Astro.props` (after `robots = …,`).
- Replace the last line before `</html>`:

```astro
  {plugins.clients.length + (plugins.notice ? 1 : 0) > 0 && <PluginClients />}
```

with:

```astro
  {plugins.clients.length + (plugins.notice ? 1 : 0) > 0 && <PluginClients />}
  {/* A theme preview is the admin's own picture of a theme, not a reader. */}
  {stats && !Astro.props.themeId && <StatsBeacon locale={locale} stats={stats} />}
```

In `src/pages/[locale]/index.astro`, add to the `<BaseLayout …>` attributes:

```astro
  stats={loadError ? undefined : { kind: 'home' }}
```

In `src/pages/[locale]/blog/[slug].astro`, add:

```astro
  stats={post ? { id: post.id, kind: 'post' } : undefined}
```

In `src/pages/[locale]/[slug].astro`, add:

```astro
  stats={page ? { id: page.id, kind: 'page' } : undefined}
```

- [ ] **Step 6: Mark the owner's browser**

In `src/components/admin/AdminShell.astro`, add to the frontmatter imports:

```ts
import { STATS_OWNER_KEY } from '../../lib/stats';
```

and immediately before the existing `<script>` tag near the end of the file:

```astro
<script is:inline define:vars={{ key: STATS_OWNER_KEY }}>
  // This browser is the owner's: the site's own counter leaves it out from now on.
  try {
    localStorage.setItem(key, '1');
  } catch (error) {
    // Storage blocked: this browser will be counted like a reader's.
  }
</script>
```

- [ ] **Step 7: Run it to see it pass**

Run: `npm run test:e2e -- tests/e2e/stats.spec.ts`
Expected: PASS, 3 tests on each of `desktop` and `mobile`.

If the first test's read never arrives after the scroll, check that the IntersectionObserver fires while the clock is installed by logging `reachedEnd` from `page.evaluate`; do not replace the clock with real waiting.

- [ ] **Step 8: Check the guards**

One at a time, each followed by the spec on the `desktop` project (`npm run test:e2e -- tests/e2e/stats.spec.ts --project=desktop`), then undone:
- Replace `firstTime('view')` with `true` → "a reload sends nothing" fails.
- In `check`, drop `!reachedEnd ||` → "twenty seconds above the end are not a read" fails.
- Change `READ_AFTER_SECONDS` to `10` → "ten seconds are not fifteen" fails.
- Remove the `doNotTrack` condition → the Do Not Track case fails.
- Remove the AdminShell script → "a browser that has opened the admin" fails.
- Remove `!Astro.props.themeId &&` and pass `stats={{ kind: 'home' }}` from `src/pages/admin/themes/preview/[id].astro` temporarily → the theme preview assertion fails. Undo both.

- [ ] **Step 9: Gates and commit**

Run: `npm run check`, then `npm run test:unit`, then the spec on both projects once more.

```bash
git add src/lib/stats.ts src/components/StatsBeacon.astro src/layouts/BaseLayout.astro "src/pages/[locale]/index.astro" "src/pages/[locale]/blog/[slug].astro" "src/pages/[locale]/[slug].astro" src/components/admin/AdminShell.astro tests/e2e/stats.spec.ts
```

Message file:

```text
feat(stats): public pages count a view, and a read that was earned

The home page, posts and pages carry a small script: a view once per tab, and for an
article, a read once its end has come into view and the tab has been visible for fifteen
seconds. It sends nothing from a browser that has opened the admin, for Do Not Track or
Global Privacy Control, or from a theme preview.
```

---

### Task 5: What the Stats screen reads

**Files:**
- Create: `src/server/stats/report.ts`, `src/server/stats/dashboard.ts`
- Test: `tests/unit/stats-report.test.ts`, `tests/integration/stats-dashboard.test.ts`

**Interfaces:**
- Consumes: Task 2's table.
- Produces (used by Task 6):
  - `report.ts`: `STATS_RANGES`, `type StatsRange`, `STATS_SORTS`, `type StatsSort`, `interface StatsQuery { lang: 'en' | 'th' | null; page: number; range: StatsRange; sort: StatsSort }`, `interface StatsPeriod { from: string; to: string }`, `interface StatsPeriods { current; previous; unit: 'day' | 'month' }`, `interface SeriesPoint { key: string; reads: number; views: number }`, `statsPeriods(range, today)`, `fillSeries(rows, period, unit)`, `percentChange(current, previous): number | null`, `pointsChange(current: Totals, previous: Totals): number | null`, `readRatio({ reads, views }): number`, `parseStatsQuery(params: URLSearchParams): StatsQuery`, `statsHref(base: string, query: StatsQuery, change: Partial<StatsQuery>): string`
  - `dashboard.ts`: `interface StatsFilter { contentId?: string; lang: 'en' | 'th' | null; ownerId: string }`, `interface Totals { reads: number; views: number }`, `interface Share { key: string; views: number }`, `interface StatsReport { countries; devices; locales; previous: Totals; referrers; series: SeriesPoint[]; totals: Totals }`, `interface StatsArticle { id; kind: 'page' | 'post'; locale; reads; title: string | null; views }`, `interface StatsEdition { id; kind: 'page' | 'post'; locale; slug: string | null; title: string | null }`, `STATS_PAGE_SIZE = 50`, `readStats(filter, periods): Promise<StatsReport>`, `readStatsArticles(filter, period, sort, page): Promise<{ articles: StatsArticle[]; hasMore: boolean }>`, `readStatsEdition(ownerId, id): Promise<StatsEdition | null>`, `hasStats(ownerId): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/stats-report.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fillSeries, parseStatsQuery, percentChange, pointsChange, readRatio, statsHref, statsPeriods,
} from '../../src/server/stats/report';

const TODAY = '2026-09-24';

test('each range and the period of the same length just before it', () => {
  assert.deepEqual(statsPeriods('7d', TODAY), {
    current: { from: '2026-09-18', to: TODAY }, previous: { from: '2026-09-11', to: '2026-09-17' }, unit: 'day',
  });
  assert.deepEqual(statsPeriods('30d', TODAY), {
    current: { from: '2026-08-26', to: TODAY }, previous: { from: '2026-07-27', to: '2026-08-25' }, unit: 'day',
  });
  assert.deepEqual(statsPeriods('90d', TODAY), {
    current: { from: '2026-06-27', to: TODAY }, previous: { from: '2026-03-29', to: '2026-06-26' }, unit: 'day',
  });
  // Twelve calendar months, this one included; before it, the same 359 days.
  assert.deepEqual(statsPeriods('12m', TODAY), {
    current: { from: '2025-10-01', to: TODAY }, previous: { from: '2024-10-07', to: '2025-09-30' }, unit: 'month',
  });
});

test('every day or month of a period, in order, with the empty ones as zeros', () => {
  const days = fillSeries([{ key: '2026-09-20', reads: 1, views: 3 }], { from: '2026-09-18', to: '2026-09-24' }, 'day');
  assert.deepEqual(days.map(({ key }) => key), ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
  assert.deepEqual(days[2], { key: '2026-09-20', reads: 1, views: 3 });
  assert.deepEqual(days[0], { key: '2026-09-18', reads: 0, views: 0 });

  const months = fillSeries([{ key: '2026-01', reads: 2, views: 9 }], { from: '2025-10-01', to: TODAY }, 'month');
  assert.equal(months.length, 12);
  assert.equal(months[0].key, '2025-10');
  assert.equal(months[11].key, '2026-09');
  assert.deepEqual(months[3], { key: '2026-01', reads: 2, views: 9 });
});

test('counts change by a percentage, the read ratio by points, and nothing before is no change', () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(100, 100), 0);
  assert.equal(percentChange(7, 3), 133);
  assert.equal(percentChange(10, 0), null, 'a previous period of zero');
  assert.equal(pointsChange({ reads: 40, views: 100 }, { reads: 42, views: 100 }), -2, '40% from 42% is two points, not five percent');
  assert.equal(pointsChange({ reads: 14, views: 32 }, { reads: 5, views: 20 }), 19, '44% from 25%, each rounded as the screen shows it');
  assert.equal(pointsChange({ reads: 1, views: 2 }, { reads: 0, views: 0 }), null);
  assert.equal(readRatio({ reads: 1, views: 4 }), 0.25);
  assert.equal(readRatio({ reads: 0, views: 0 }), 0);
  assert.equal(readRatio({ reads: 3, views: 2 }), 1, 'a read whose view was dropped never makes more than all');
});

test('the address holds the choices, and anything else falls back to the defaults', () => {
  assert.deepEqual(parseStatsQuery(new URLSearchParams('')), { lang: null, page: 1, range: '30d', sort: 'views' });
  assert.deepEqual(parseStatsQuery(new URLSearchParams('range=12m&lang=th&sort=ratio&page=3')), { lang: 'th', page: 3, range: '12m', sort: 'ratio' });
  assert.deepEqual(parseStatsQuery(new URLSearchParams('range=1y&lang=fr&sort=title&page=-2')), { lang: null, page: 1, range: '30d', sort: 'views' });
  assert.equal(parseStatsQuery(new URLSearchParams('page=2.5')).page, 1);
  assert.equal(parseStatsQuery(new URLSearchParams('page=99999')).page, 1_000, 'a page far past the last is capped');

  const query = parseStatsQuery(new URLSearchParams('range=7d&lang=en&sort=reads&page=2'));
  assert.equal(statsHref('/admin/stats', query, {}), '/admin/stats?range=7d&lang=en&sort=reads&page=2');
  assert.equal(statsHref('/admin/stats', query, { page: 1, range: '30d' }), '/admin/stats?lang=en&sort=reads', 'defaults are left out');
  assert.equal(statsHref('/admin/stats', query, { lang: null, page: 1, sort: 'views' }), '/admin/stats?range=7d');
  assert.equal(statsHref('/studio/stats', parseStatsQuery(new URLSearchParams('')), {}), '/studio/stats');
});
```

Create `tests/integration/stats-dashboard.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

type Row = [day: string, kind: 'home' | 'page' | 'post', id: string | null, locale: 'en' | 'th',
  referrer: string, device: 'desktop' | 'mobile', country: string, views: number, reads: number];

test('the Stats screen reads the right totals, periods, filters, top tens and pages', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { hasStats, readStats, readStatsArticles, readStatsEdition, STATS_PAGE_SIZE } = await import('../../src/server/stats/dashboard');
  const { statsPeriods } = await import('../../src/server/stats/report');
  context.after(closeDatabase);
  await migrateToLatest();

  const TODAY = '2026-09-24';
  const [owner, other, paged] = [randomUUID(), randomUUID(), randomUUID()];
  await db.insertInto('user').values([owner, other, paged].map((id, index) => ({
    id, name: 'Owner', email: `stats-dashboard-${index}@example.invalid`, emailVerified: true, image: null, role: 'owner',
  }))).execute();
  const category = await db.insertInto('categories').values({ owner_id: owner, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const edition = (kind: 'page' | 'post', locale: 'en' | 'th', title: string) => db.transaction().execute(async (trx) => {
    const fields = {
      content_html: '<p>Words</p>', content_json: { content: [], type: 'doc' as const }, locale, meta_description: null,
      meta_title: null, owner_id: owner, published_at: new Date('2026-01-01T00:00:00Z'), slug: `s-${randomUUID()}`,
      status: 'published' as const, title,
    };
    if (kind === 'page') {
      const group = await trx.insertInto('page_translation_groups').values({ owner_id: owner }).returning('id').executeTakeFirstOrThrow();
      return (await trx.insertInto('pages').values({ ...fields, translation_group_id: group.id }).returning('id').executeTakeFirstOrThrow()).id;
    }
    const group = await trx.insertInto('post_translation_groups').values({ owner_id: owner }).returning('id').executeTakeFirstOrThrow();
    const { id } = await trx.insertInto('posts').values({ ...fields, cover_media_id: null, translation_group_id: group.id })
      .returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('post_category_assignments').values({ category_id: category.id, owner_id: owner, translation_group_id: group.id }).execute();
    return id;
  });
  const seed = (ownerId: string, rows: Row[]) => db.insertInto('content_stats_daily').values(rows.map(
    ([day, kind, id, locale, referrer, device, country, views, reads]) => ({
      content_id: id, country, day, device, kind, locale, owner_id: ownerId, reads, referrer, views,
    }),
  )).execute();

  const alpha = await edition('post', 'en', 'Alpha');
  const beta = await edition('post', 'th', 'บีตา');
  const about = await edition('page', 'en', 'About');
  const gone = randomUUID();
  await seed(owner, [
    ['2026-09-24', 'post', alpha, 'en', 'news.example', 'desktop', 'TH', 10, 4],
    ['2026-09-20', 'post', alpha, 'en', '', 'mobile', 'US', 6, 1],
    ['2026-09-10', 'post', beta, 'th', 'internal', 'mobile', 'TH', 8, 6],
    ['2026-09-01', 'page', about, 'en', '', 'desktop', '', 4, 0],
    ['2026-09-23', 'home', null, 'en', '', 'desktop', '', 5, 0],
    ['2026-09-05', 'post', gone, 'en', 'news.example', 'desktop', 'TH', 3, 3],
    ['2026-08-10', 'post', alpha, 'en', '', 'desktop', 'TH', 20, 5],
    ['2026-06-15', 'post', alpha, 'en', '', 'desktop', 'TH', 7, 2],
    ['2025-09-15', 'post', beta, 'th', '', 'mobile', 'TH', 9, 3],
  ]);
  const all = { lang: null, ownerId: owner };

  const month = await readStats(all, statsPeriods('30d', TODAY));
  assert.deepEqual(month.totals, { reads: 14, views: 36 });
  assert.deepEqual(month.previous, { reads: 5, views: 20 });
  assert.equal(month.series.length, 30);
  assert.deepEqual(month.series[0], { key: '2026-08-26', reads: 0, views: 0 });
  assert.deepEqual(month.series.at(-1), { key: TODAY, reads: 4, views: 10 });
  assert.deepEqual(month.series.at(-2), { key: '2026-09-23', reads: 0, views: 5 });
  assert.deepEqual(month.referrers, [{ key: '', views: 15 }, { key: 'news.example', views: 13 }, { key: 'internal', views: 8 }]);
  assert.deepEqual(month.devices, [{ key: 'desktop', views: 22 }, { key: 'mobile', views: 14 }]);
  assert.deepEqual(month.countries, [{ key: 'TH', views: 21 }, { key: '', views: 9 }, { key: 'US', views: 6 }]);
  assert.deepEqual(month.locales, [{ key: 'en', views: 28 }, { key: 'th', views: 8 }]);

  const week = await readStats(all, statsPeriods('7d', TODAY));
  assert.deepEqual([week.totals, week.previous], [{ reads: 5, views: 21 }, { reads: 0, views: 0 }]);
  const quarter = await readStats(all, statsPeriods('90d', TODAY));
  assert.deepEqual([quarter.totals, quarter.previous], [{ reads: 19, views: 56 }, { reads: 2, views: 7 }]);
  const year = await readStats(all, statsPeriods('12m', TODAY));
  assert.deepEqual([year.totals, year.previous], [{ reads: 21, views: 63 }, { reads: 3, views: 9 }]);
  assert.deepEqual(year.series.map(({ key }) => key), [
    '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
  ]);
  assert.deepEqual(year.series.at(-1), { key: '2026-09', reads: 14, views: 36 });
  assert.deepEqual(year.series.at(-2), { key: '2026-08', reads: 5, views: 20 });
  assert.deepEqual(year.series[8], { key: '2026-06', reads: 2, views: 7 });

  assert.deepEqual((await readStats({ ...all, lang: 'th' }, statsPeriods('30d', TODAY))).totals, { reads: 6, views: 8 });
  assert.deepEqual((await readStats({ ...all, lang: 'en' }, statsPeriods('30d', TODAY))).totals, { reads: 8, views: 28 });
  const one = await readStats({ ...all, contentId: alpha }, statsPeriods('30d', TODAY));
  assert.deepEqual([one.totals, one.previous], [{ reads: 5, views: 16 }, { reads: 5, views: 20 }]);

  const period = statsPeriods('30d', TODAY).current;
  const titles = async (sort: 'ratio' | 'reads' | 'views', lang: 'en' | 'th' | null = null) =>
    (await readStatsArticles({ lang, ownerId: owner }, period, sort, 1)).articles.map(({ title }) => title);
  assert.deepEqual(await titles('views'), ['Alpha', 'บีตา', 'About', null], 'no home page, and the deleted one without a title');
  assert.deepEqual(await titles('reads'), ['บีตา', 'Alpha', null, 'About']);
  assert.deepEqual(await titles('ratio'), [null, 'บีตา', 'Alpha', 'About']);
  assert.deepEqual(await titles('views', 'th'), ['บีตา']);
  const [first] = (await readStatsArticles(all, period, 'views', 1)).articles;
  assert.deepEqual(first, { id: alpha, kind: 'post', locale: 'en', reads: 5, title: 'Alpha', views: 16 });

  // Top tens, from an owner of their own: nothing of the first owner's reaches them.
  const codes = ['AR', 'AU', 'BR', 'CA', 'DE', 'ES', 'FR', 'GB', 'IN', 'JP', 'TH', 'US'];
  await seed(other, codes.map((code, index): Row => [TODAY, 'home', null, 'en', `r${String(index + 1).padStart(2, '0')}.example`, 'desktop', code, index + 1, 0]));
  const tops = await readStats({ lang: null, ownerId: other }, statsPeriods('30d', TODAY));
  assert.equal(tops.referrers.length, 10);
  assert.deepEqual([tops.referrers[0], tops.referrers[9]], [{ key: 'r12.example', views: 12 }, { key: 'r03.example', views: 3 }]);
  assert.equal(tops.countries.length, 10);
  assert.deepEqual([tops.countries[0], tops.countries[9]], [{ key: 'US', views: 12 }, { key: 'BR', views: 3 }]);
  assert.deepEqual(tops.totals, { reads: 0, views: 78 });

  // Fifty a page.
  await seed(paged, Array.from({ length: STATS_PAGE_SIZE + 1 }, (): Row => [TODAY, 'post', randomUUID(), 'en', '', 'desktop', '', 1, 0]));
  const pageOne = await readStatsArticles({ lang: null, ownerId: paged }, period, 'views', 1);
  const pageTwo = await readStatsArticles({ lang: null, ownerId: paged }, period, 'views', 2);
  assert.deepEqual([pageOne.articles.length, pageOne.hasMore, pageTwo.articles.length, pageTwo.hasMore], [50, true, 1, false]);
  assert.equal(new Set([...pageOne.articles, ...pageTwo.articles].map(({ id }) => id)).size, 51, 'no row on both pages');

  assert.equal((await readStatsEdition(owner, alpha))?.title, 'Alpha');
  assert.equal((await readStatsEdition(owner, about))?.kind, 'page');
  assert.deepEqual(await readStatsEdition(owner, gone), { id: gone, kind: 'post', locale: 'en', slug: null, title: null });
  assert.equal(await readStatsEdition(owner, randomUUID()), null);
  assert.equal(await readStatsEdition(other, alpha), null, 'another owner’s article');

  assert.equal(await hasStats(owner), true);
  assert.equal(await hasStats(randomUUID()), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/stats-report.test.ts` — FAIL, module missing.
Run: `node scripts/test-foundation.mjs tests/integration/stats-dashboard.test.ts` — FAIL, module missing.

- [ ] **Step 3: Write the arithmetic**

Create `src/server/stats/report.ts`:

```ts
/**
 * The Stats screen's arithmetic: which days a range covers, what they are compared with, how a
 * change is said, and how the choices sit in the address. Pure, so the screen and its tests
 * agree on every edge.
 */

export const STATS_RANGES = ['7d', '30d', '90d', '12m'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const STATS_SORTS = ['views', 'reads', 'ratio'] as const;
export type StatsSort = (typeof STATS_SORTS)[number];

export interface StatsQuery {
  lang: 'en' | 'th' | null;
  page: number;
  range: StatsRange;
  sort: StatsSort;
}

/** Both ends included, as YYYY-MM-DD. */
export interface StatsPeriod {
  from: string;
  to: string;
}

export interface StatsPeriods {
  current: StatsPeriod;
  previous: StatsPeriod;
  unit: 'day' | 'month';
}

/** One bar of the chart: a day (YYYY-MM-DD) or a month (YYYY-MM). */
export interface SeriesPoint {
  key: string;
  reads: number;
  views: number;
}

const DAY_MS = 86_400_000;
const LAST_PAGE = 1_000;

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayAt = (number: number) => new Date(number * DAY_MS).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => dayAt(dayNumber(day) + days);

/** The first day of the month `months` away from the one `day` is in. */
function monthStart(day: string, months: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

/** A range ending today, and the same number of days just before it. */
export function statsPeriods(range: StatsRange, today: string): StatsPeriods {
  const from = range === '12m' ? monthStart(today, -11) : addDays(today, 1 - Number.parseInt(range, 10));
  const length = dayNumber(today) - dayNumber(from) + 1;
  return {
    current: { from, to: today },
    previous: { from: addDays(from, -length), to: addDays(from, -1) },
    unit: range === '12m' ? 'month' : 'day',
  };
}

/** Every day (or month) of the period, in order, with the ones nobody came as zeros. */
export function fillSeries(rows: readonly SeriesPoint[], period: StatsPeriod, unit: 'day' | 'month'): SeriesPoint[] {
  const found = new Map(rows.map((row) => [row.key, row]));
  const keys: string[] = [];
  if (unit === 'day') {
    for (let day = period.from; day <= period.to; day = addDays(day, 1)) keys.push(day);
  } else {
    for (let month = monthStart(period.from, 0); month <= period.to; month = monthStart(month, 1)) keys.push(month.slice(0, 7));
  }
  return keys.map((key) => found.get(key) ?? { key, reads: 0, views: 0 });
}

/** A whole-number percentage change, or null when there was nothing before to compare with. */
export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}

/** Reads over views, never more than all of them. */
export function readRatio({ reads, views }: { reads: number; views: number }): number {
  return views > 0 ? Math.min(1, reads / views) : 0;
}

/**
 * The read ratio's change in points: 40% from 42% is -2, never -5%. Each ratio is rounded as the
 * screen shows it first, so the change agrees with the two numbers beside it.
 */
export function pointsChange(current: { reads: number; views: number }, previous: { reads: number; views: number }): number | null {
  if (previous.views === 0) return null;
  return Math.round(readRatio(current) * 100) - Math.round(readRatio(previous) * 100);
}

export function parseStatsQuery(params: URLSearchParams): StatsQuery {
  const range = STATS_RANGES.find((value) => value === params.get('range')) ?? '30d';
  const sort = STATS_SORTS.find((value) => value === params.get('sort')) ?? 'views';
  const lang = params.get('lang');
  const page = Number(params.get('page'));
  return {
    lang: lang === 'th' || lang === 'en' ? lang : null,
    page: Number.isSafeInteger(page) && page > 1 ? Math.min(page, LAST_PAGE) : 1,
    range,
    sort,
  };
}

/** The screen's address with some choices changed; the defaults are left out. */
export function statsHref(base: string, query: StatsQuery, change: Partial<StatsQuery>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.range !== '30d') params.set('range', next.range);
  if (next.lang) params.set('lang', next.lang);
  if (next.sort !== 'views') params.set('sort', next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}
```

- [ ] **Step 4: Write the queries**

Create `src/server/stats/dashboard.ts`:

```ts
import { sql, type RawBuilder } from 'kysely';

import { db } from '../db/client';
import { fillSeries, type SeriesPoint, type StatsPeriod, type StatsPeriods, type StatsSort } from './report';

export interface StatsFilter {
  /** One edition, for its own screen. */
  contentId?: string;
  lang: 'en' | 'th' | null;
  ownerId: string;
}

export interface Totals {
  reads: number;
  views: number;
}

export interface Share {
  key: string;
  views: number;
}

export interface StatsReport {
  countries: Share[];
  devices: Share[];
  locales: Share[];
  previous: Totals;
  referrers: Share[];
  series: SeriesPoint[];
  totals: Totals;
}

export interface StatsArticle {
  id: string;
  kind: 'page' | 'post';
  locale: 'en' | 'th';
  reads: number;
  /** Null when the edition has been deleted since it was read. */
  title: string | null;
  views: number;
}

export interface StatsEdition {
  id: string;
  kind: 'page' | 'post';
  locale: 'en' | 'th';
  slug: string | null;
  title: string | null;
}

export const STATS_PAGE_SIZE = 50;
const TOP = 10;

/** PostgreSQL sums integers into bigint, which node-postgres hands over as a string. */
const count = (value: unknown): number => Number(value ?? 0);

function scope(filter: StatsFilter, period: StatsPeriod): RawBuilder<unknown> {
  return sql`owner_id = ${filter.ownerId}
    and day between ${period.from}::date and ${period.to}::date
    ${filter.lang ? sql`and locale = ${filter.lang}` : sql``}
    ${filter.contentId ? sql`and content_id = ${filter.contentId}::uuid` : sql``}`;
}

async function totals(filter: StatsFilter, period: StatsPeriod): Promise<Totals> {
  const { rows } = await sql<{ reads: string | null; views: string | null }>`
    select sum(views) as views, sum(reads) as reads from content_stats_daily where ${scope(filter, period)}
  `.execute(db);
  return { reads: count(rows[0]?.reads), views: count(rows[0]?.views) };
}

async function series(filter: StatsFilter, periods: StatsPeriods): Promise<SeriesPoint[]> {
  const format = periods.unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const { rows } = await sql<{ key: string; reads: string; views: string }>`
    select to_char(day, ${format}) as key, sum(views) as views, sum(reads) as reads
    from content_stats_daily where ${scope(filter, periods.current)}
    group by 1
  `.execute(db);
  return fillSeries(rows.map((row) => ({ key: row.key, reads: count(row.reads), views: count(row.views) })), periods.current, periods.unit);
}

async function shares(filter: StatsFilter, period: StatsPeriod, column: 'country' | 'device' | 'locale' | 'referrer', top?: number): Promise<Share[]> {
  const { rows } = await sql<{ key: string; views: string }>`
    select ${sql.ref(column)} as key, sum(views) as views
    from content_stats_daily where ${scope(filter, period)}
    group by 1 having sum(views) > 0
    order by 2 desc, 1
    ${top ? sql`limit ${top}` : sql``}
  `.execute(db);
  return rows.map((row) => ({ key: row.key, views: count(row.views) }));
}

export async function readStats(filter: StatsFilter, periods: StatsPeriods): Promise<StatsReport> {
  const [now, before, points, referrers, devices, countries, locales] = await Promise.all([
    totals(filter, periods.current),
    totals(filter, periods.previous),
    series(filter, periods),
    shares(filter, periods.current, 'referrer', TOP),
    shares(filter, periods.current, 'device'),
    shares(filter, periods.current, 'country', TOP),
    shares(filter, periods.current, 'locale'),
  ]);
  return { countries, devices, locales, previous: before, referrers, series: points, totals: now };
}

/** Whether anything has been counted for this owner at all, which is what the empty screen is about. */
export async function hasStats(ownerId: string): Promise<boolean> {
  const row = await db.selectFrom('content_stats_daily').select('owner_id').where('owner_id', '=', ownerId).limit(1).executeTakeFirst();
  return row !== undefined;
}

const ORDER: Record<StatsSort, RawBuilder<unknown>> = {
  ratio: sql`sum(s.reads)::float / nullif(sum(s.views), 0) desc nulls last`,
  reads: sql`sum(s.reads) desc`,
  views: sql`sum(s.views) desc`,
};

/** Articles and pages with their numbers, fifty a page. The home page is in the totals, not here. */
export async function readStatsArticles(
  filter: StatsFilter,
  period: StatsPeriod,
  sort: StatsSort,
  page: number,
): Promise<{ articles: StatsArticle[]; hasMore: boolean }> {
  const { rows } = await sql<{ content_id: string; kind: 'page' | 'post'; locale: 'en' | 'th'; reads: string; title: string | null; views: string }>`
    select s.content_id, s.kind, s.locale, sum(s.views) as views, sum(s.reads) as reads, coalesce(p.title, g.title) as title
    from content_stats_daily s
    left join posts p on s.kind = 'post' and p.id = s.content_id and p.owner_id = s.owner_id
    left join pages g on s.kind = 'page' and g.id = s.content_id and g.owner_id = s.owner_id
    where s.owner_id = ${filter.ownerId} and s.kind <> 'home'
      and s.day between ${period.from}::date and ${period.to}::date
      ${filter.lang ? sql`and s.locale = ${filter.lang}` : sql``}
    group by s.content_id, s.kind, s.locale, p.title, g.title
    order by ${ORDER[sort]}, s.content_id
    limit ${STATS_PAGE_SIZE + 1} offset ${(page - 1) * STATS_PAGE_SIZE}
  `.execute(db);
  return {
    articles: rows.slice(0, STATS_PAGE_SIZE).map((row) => ({
      id: row.content_id, kind: row.kind, locale: row.locale, reads: count(row.reads), title: row.title, views: count(row.views),
    })),
    hasMore: rows.length > STATS_PAGE_SIZE,
  };
}

/** What one edition is, for its screen's heading and links; a deleted one is known by its counts. */
export async function readStatsEdition(ownerId: string, id: string): Promise<StatsEdition | null> {
  const post = await db.selectFrom('posts').select(['id', 'locale', 'slug', 'title'])
    .where('owner_id', '=', ownerId).where('id', '=', id).executeTakeFirst();
  if (post) return { ...post, kind: 'post' };
  const page = await db.selectFrom('pages').select(['id', 'locale', 'slug', 'title'])
    .where('owner_id', '=', ownerId).where('id', '=', id).executeTakeFirst();
  if (page) return { ...page, kind: 'page' };
  const counted = await db.selectFrom('content_stats_daily').select(['kind', 'locale'])
    .where('owner_id', '=', ownerId).where('content_id', '=', id).limit(1).executeTakeFirst();
  return counted && counted.kind !== 'home' ? { id, kind: counted.kind, locale: counted.locale, slug: null, title: null } : null;
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `node --import tsx --test tests/unit/stats-report.test.ts` — PASS.
Run: `node scripts/test-foundation.mjs tests/integration/stats-dashboard.test.ts` — PASS.

- [ ] **Step 6: Check the guards**

One at a time, then undone:
- In `pointsChange`, return `percentChange(...)` of the two ratios instead → the "two points, not five percent" assertion fails.
- In `statsPeriods`, make `previous.to` equal `from` → the period tests fail (the ranges overlap by a day).
- In `readStatsArticles`, drop `and s.kind <> 'home'` → the titles list gains a home row.
- In `shares`, drop `${top ? … : …}` → the top-ten lengths fail.
- In `scope`, drop the `lang` clause → the Thai-only totals fail.

- [ ] **Step 7: Gates and commit**

Run: `npm run check`, then `npm run test:unit`.

```bash
git add src/server/stats/report.ts src/server/stats/dashboard.ts tests/unit/stats-report.test.ts tests/integration/stats-dashboard.test.ts
```

Message file:

```text
feat(stats): the queries and arithmetic behind the Stats screen

Totals for a range and the same number of days just before it, a series by day or by month
with the empty ones as zeros, the top ten referrers and countries, devices and languages,
articles and pages fifty at a time sorted by views, reads or read ratio, and what one edition
is, deleted ones included. A count changes by a percentage and the read ratio by points.
```

---

### Task 6: The Stats screen

**Files:**
- Create: `src/pages/admin/stats.astro`, `src/pages/admin/stats/[id].astro`, `src/components/admin/stats/StatsFilters.astro`, `src/components/admin/stats/StatsReport.astro`, `src/components/admin/stats/StatsChart.astro`, `src/components/admin/stats/StatsShares.astro`, `src/styles/stats.css`
- Modify: `src/lib/admin.ts:109`, `src/lib/icons.ts`, `src/lib/admin-i18n.ts`, `src/components/admin/AdminShell.astro:87`
- Test: `tests/e2e/stats.spec.ts` (one more test)

**Interfaces:**
- Consumes: Task 5's `report.ts` and `dashboard.ts` exports; Task 1's `statsDay`; `requireOwner`, `getOwnerSettings`, `adminHref`, `adminLoginPath`, `adminCopy`, `fill`, `postPath`, `pagePath`, `isUuid`.
- Produces: `/admin/stats` and `/admin/stats/<id>`; nav id `'stats'`.

- [ ] **Step 1: Write the failing browser test**

Append to `tests/e2e/stats.spec.ts`:

```ts
test('Stats shows what was counted, by range, language and sort, and one article alone', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  const shoot = (name: string) => page.screenshot({ fullPage: true, path: test.info().outputPath(`stats-${name}.png`) });

  query('delete from content_stats_daily');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/admin/stats`);
  await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No readers counted yet' })).toBeVisible();
  await expect(page.getByText('Your own visits are not counted.')).toBeVisible();
  await expect(page.locator('a[href="/admin/stats"]').first()).toBeAttached();
  await shoot('empty-1280-light');

  query(`insert into content_stats_daily (owner_id, day, kind, content_id, locale, referrer, device, country, views, reads) values
    ('${OWNER}', current_date, 'post', '${ARTICLE}', 'en', 'news.example', 'desktop', 'TH', 10, 4),
    ('${OWNER}', current_date - 4, 'post', '${ARTICLE}', 'en', '', 'mobile', 'US', 6, 1),
    ('${OWNER}', current_date - 14, 'post', '${THAI}', 'th', 'internal', 'mobile', 'TH', 8, 6),
    ('${OWNER}', current_date - 1, 'home', null, 'en', '', 'desktop', '', 5, 0),
    ('${OWNER}', current_date - 19, 'post', '${GONE}', 'en', 'news.example', 'desktop', 'TH', 3, 3),
    ('${OWNER}', current_date - 45, 'post', '${ARTICLE}', 'en', '', 'desktop', 'TH', 20, 5)`);
  await page.reload();
  const summary = page.locator('.stats-summary > div');
  await expect(summary.nth(0)).toHaveText(/Views\s*32\s*↑ 60%/);
  await expect(summary.nth(1)).toHaveText(/Reads\s*14\s*↑ 180%/);
  await expect(summary.nth(2)).toHaveText(/Read ratio\s*44%\s*↑ 19 points/);
  await expect(page.getByRole('heading', { name: 'Views and reads per day' })).toBeVisible();
  await expect(page.locator('.stats-share').filter({ hasText: 'Where readers came from' })).toContainText('news.example');
  await expect(page.locator('.stats-share').filter({ hasText: 'Where readers came from' })).toContainText('This site');
  await expect(page.locator('.stats-share').filter({ hasText: 'Countries' })).toContainText('Thailand');
  await expect(page.getByRole('link', { name: 'IP Geolocation by DB-IP' })).toHaveAttribute('href', 'https://db-ip.com');
  const rows = page.locator('.stats-articles tbody tr');
  await expect(rows.first().locator('th')).toHaveText('Worth reading');
  await expect(rows.last().locator('th')).toHaveText('Deleted');
  await shoot('data-1280-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shoot('data-1280-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.getByRole('link', { name: 'Last 7 days' }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(summary.nth(0)).toHaveText(/Views\s*21\s*Nothing to compare with yet/);

  await page.getByRole('link', { name: 'Last 30 days' }).click();
  await page.getByRole('link', { name: 'Thai', exact: true }).click();
  await expect(page).toHaveURL(/lang=th/);
  await expect(summary.nth(0)).toHaveText(/Views\s*8/);
  await page.getByRole('link', { name: 'All languages' }).click();

  await page.locator('.stats-articles thead').getByRole('link', { name: 'Reads' }).click();
  await expect(page).toHaveURL(/sort=reads/);
  await expect(rows.first().locator('th')).toHaveText('บทความภาษาไทย');

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'nothing wider than a small phone').toBeLessThanOrEqual(375);
  await shoot('data-375-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shoot('data-375-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole('link', { name: 'Worth reading' }).click();
  await expect(page.getByRole('heading', { name: 'Worth reading', level: 1 })).toBeVisible();
  await expect(summary.nth(0)).toHaveText(/Views\s*16/);
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', `/admin/edit/${ARTICLE}`);
  await expect(page.getByRole('link', { name: 'View on site' })).toHaveAttribute('href', '/en/blog/worth-reading');
  await page.getByRole('link', { name: 'All stats' }).click();
  await expect(page).toHaveURL(/\/admin\/stats\?sort=reads$/);

  await page.goto(`${origin}/admin/stats/${GONE}`);
  await expect(page.getByRole('heading', { name: 'Deleted', level: 1 })).toBeVisible();
  const missing = await page.goto(`${origin}/admin/stats/00000000-0000-4000-8000-000000000000`);
  expect(missing?.status()).toBe(404);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:e2e -- tests/e2e/stats.spec.ts`
Expected: the new test FAILS on both projects — `/admin/stats` is not found. The earlier three still pass.

- [ ] **Step 3: The nav entry, its icon and the copy**

In `src/lib/admin.ts:109`, put `'stats'` first:

```ts
export const ADMIN_NAV_IDS = ['stats', 'posts', 'pages', 'media', 'navigation', 'slides', 'redirects', 'profile', 'security', 'siteSettings', 'settings', 'maintenance', 'appearance', 'themes', 'plugins', 'system'] as const;
```

In `src/lib/icons.ts`, add as the first entry after the comment `/** The sidebar's links, in the order the shell lists them. */`:

```ts
  stats: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
```

In `src/components/admin/AdminShell.astro`, make this the first entry of the `content` group's `links`:

```ts
      { href: adminHref(adminSettings, '/stats'), id: 'stats', label: copy.nav.stats },
```

In `src/lib/admin-i18n.ts`:
- `en.nav`: add `stats: 'Stats',` (after `slides`, keeping the object's existing order style). `th.nav`: add `stats: 'สถิติ',`.
- `en.errors`: add `statsUnavailable: 'Stats are temporarily unavailable.',`. `th.errors`: add `statsUnavailable: 'สถิติไม่พร้อมใช้งานชั่วคราว',`.
- Add a `stats` block to `en`, immediately before `errors: {`:

```ts
  stats: {
    allLanguages: 'All languages',
    articles: 'Articles and pages',
    attribution: 'IP Geolocation by DB-IP',
    back: 'All stats',
    barTitle: '{date}: {views} views, {reads} reads',
    chartDaily: 'Views and reads per day',
    chartMonthly: 'Views and reads per month',
    chartTable: 'Show the numbers',
    countries: 'Countries',
    date: 'Date',
    deleted: 'Deleted',
    desktop: 'Computer',
    devices: 'Devices',
    direct: 'Direct',
    edit: 'Edit',
    emptyBody: 'Counting started with this version and cannot reach back. Your own visits are not counted.',
    emptyHeading: 'No readers counted yet',
    heading: 'Stats',
    kind: 'Type',
    language: 'Language',
    languages: { en: 'English', th: 'Thai' },
    locales: 'Languages',
    mobile: 'Phone',
    nextPage: 'Next 50',
    noChange: 'No change',
    noPrevious: 'Nothing to compare with yet',
    notFound: 'There are no stats for this article.',
    noViews: 'Nothing was read in this period.',
    page: 'Page',
    point: '{value} point',
    points: '{value} points',
    post: 'Article',
    previousPage: 'Previous 50',
    previousPeriod: 'Changes are against the period of the same length just before.',
    rangeLabel: 'Period',
    ranges: { '12m': 'Last 12 months', '30d': 'Last 30 days', '7d': 'Last 7 days', '90d': 'Last 90 days' },
    readRatio: 'Read ratio',
    reads: 'Reads',
    referrers: 'Where readers came from',
    subheading: 'Views and reads, counted by your site without cookies. The numbers are estimates.',
    thisSite: 'This site',
    title: 'Title',
    unknownCountry: 'Unknown',
    viewOnSite: 'View on site',
    views: 'Views',
  },
```

- And to `th`, immediately before its `errors: {`:

```ts
  stats: {
    allLanguages: 'ทุกภาษา',
    articles: 'บทความและหน้า',
    attribution: 'ข้อมูลตำแหน่งจาก IP โดย DB-IP',
    back: 'สถิติทั้งหมด',
    barTitle: '{date}: เข้าชม {views} อ่าน {reads}',
    chartDaily: 'ยอดเข้าชมและยอดอ่านรายวัน',
    chartMonthly: 'ยอดเข้าชมและยอดอ่านรายเดือน',
    chartTable: 'ดูเป็นตัวเลข',
    countries: 'ประเทศ',
    date: 'วันที่',
    deleted: 'ถูกลบแล้ว',
    desktop: 'คอมพิวเตอร์',
    devices: 'อุปกรณ์',
    direct: 'เข้าโดยตรง',
    edit: 'แก้ไข',
    emptyBody: 'การนับเริ่มตั้งแต่เวอร์ชันนี้และย้อนหลังไม่ได้ การเข้าชมของคุณเองไม่ถูกนับ',
    emptyHeading: 'ยังไม่มีผู้อ่านที่ถูกนับ',
    heading: 'สถิติ',
    kind: 'ประเภท',
    language: 'ภาษา',
    languages: { en: 'อังกฤษ', th: 'ไทย' },
    locales: 'ภาษา',
    mobile: 'มือถือ',
    nextPage: '50 รายการถัดไป',
    noChange: 'เท่าเดิม',
    noPrevious: 'ยังไม่มีช่วงก่อนหน้าให้เทียบ',
    notFound: 'ไม่มีสถิติของบทความนี้',
    noViews: 'ช่วงนี้ยังไม่มีการเข้าชม',
    page: 'หน้า',
    point: '{value} จุด',
    points: '{value} จุด',
    post: 'บทความ',
    previousPage: '50 รายการก่อนหน้า',
    previousPeriod: 'เทียบกับช่วงเวลายาวเท่ากันก่อนหน้านี้',
    rangeLabel: 'ช่วงเวลา',
    ranges: { '12m': '12 เดือนล่าสุด', '30d': '30 วันล่าสุด', '7d': '7 วันล่าสุด', '90d': '90 วันล่าสุด' },
    readRatio: 'อัตราการอ่าน',
    reads: 'ยอดอ่าน',
    referrers: 'ผู้อ่านมาจากไหน',
    subheading: 'ยอดเข้าชมและยอดอ่านที่เว็บไซต์นับเองโดยไม่ใช้คุกกี้ ตัวเลขเป็นค่าประมาณ',
    thisSite: 'เว็บไซต์นี้',
    title: 'ชื่อเรื่อง',
    unknownCountry: 'ไม่ทราบ',
    viewOnSite: 'ดูบนเว็บไซต์',
    views: 'ยอดเข้าชม',
  },
```

- [ ] **Step 4: The screen's parts**

Create `src/components/admin/stats/StatsFilters.astro`:

```astro
---
import type { AdminCopy } from '../../../lib/admin-i18n';
import { STATS_RANGES, statsHref, type StatsQuery } from '../../../server/stats/report';

interface Props {
  base: string;
  copy: AdminCopy;
  /** One article is in one language, so its own screen has none to choose. */
  languages?: boolean;
  query: StatsQuery;
}

const { base, copy, languages = true, query } = Astro.props;
const LANGUAGES = [null, 'th', 'en'] as const;
---

<div class="stats-filters">
  <nav aria-label={copy.stats.rangeLabel} class="stats-segments">
    {STATS_RANGES.map((range) => (
      <a aria-current={query.range === range ? 'true' : undefined} href={statsHref(base, query, { page: 1, range })}>
        {copy.stats.ranges[range]}
      </a>
    ))}
  </nav>
  {languages && (
    <nav aria-label={copy.stats.language} class="stats-segments">
      {LANGUAGES.map((lang) => (
        <a aria-current={query.lang === lang ? 'true' : undefined} href={statsHref(base, query, { lang, page: 1 })}>
          {lang ? copy.stats.languages[lang] : copy.stats.allLanguages}
        </a>
      ))}
    </nav>
  )}
</div>
```

Create `src/components/admin/stats/StatsChart.astro`:

```astro
---
import type { SeriesPoint } from '../../../server/stats/report';

interface Props {
  /** A bar's title: its date and both numbers. */
  describe: (point: SeriesPoint) => string;
  label: string;
  points: SeriesPoint[];
  tick: (key: string) => string;
}

/*
 * Views as bars with reads inside them, drawn on the server. The table under the chart carries
 * the same numbers for anyone the picture does not reach.
 */
const { describe, label, points, tick } = Astro.props;
const WIDTH = 720;
const HEIGHT = 180;
const highest = Math.max(1, ...points.map(({ reads, views }) => Math.max(reads, views)));
const slot = WIDTH / Math.max(1, points.length);
const barWidth = Math.max(1, slot * 0.72);
const heightOf = (value: number) => (value / highest) * HEIGHT;
---

<svg aria-label={label} class="stats-chart" preserveAspectRatio="none" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
  {points.map((point, index) => {
    const x = index * slot + (slot - barWidth) / 2;
    return (
      <g class="stats-chart__day">
        <title>{describe(point)}</title>
        <rect class="stats-chart__hit" height={HEIGHT} width={slot} x={index * slot} y="0" />
        <rect class="stats-chart__views" height={heightOf(point.views)} width={barWidth} x={x} y={HEIGHT - heightOf(point.views)} />
        <rect class="stats-chart__reads" height={heightOf(point.reads)} width={barWidth} x={x} y={HEIGHT - heightOf(point.reads)} />
      </g>
    );
  })}
</svg>
{points.length > 0 && (
  <p aria-hidden="true" class="stats-chart__axis">
    <span>{tick(points[0].key)}</span>
    <span>{tick(points[points.length - 1].key)}</span>
  </p>
)}
```

Create `src/components/admin/stats/StatsShares.astro`:

```astro
---
interface Props {
  format: Intl.NumberFormat;
  heading: string;
  rows: Array<{ label: string; views: number }>;
}

const { format, heading, rows } = Astro.props;
const most = Math.max(1, ...rows.map(({ views }) => views));
---

<section class="stats-panel stats-share">
  <h2>{heading}</h2>
  {rows.length === 0 ? (
    <p class="stats-share__none">—</p>
  ) : (
    <ol>
      {rows.map(({ label, views }) => (
        <li style={`--share: ${Math.round((views / most) * 100)}%`}>
          <span class="stats-share__label">{label}</span>
          <span class="stats-share__value">{format.format(views)}</span>
        </li>
      ))}
    </ol>
  )}
  <slot />
</section>
```

Create `src/components/admin/stats/StatsReport.astro`:

```astro
---
import { fill, type AdminCopy } from '../../../lib/admin-i18n';
import type { StatsReport } from '../../../server/stats/dashboard';
import { percentChange, pointsChange, readRatio, type SeriesPoint } from '../../../server/stats/report';
import StatsChart from './StatsChart.astro';
import StatsShares from './StatsShares.astro';

interface Props {
  copy: AdminCopy;
  locale: 'en' | 'th';
  report: StatsReport;
  unit: 'day' | 'month';
}

const { copy, locale, report, unit } = Astro.props;
const tag = locale === 'th' ? 'th-TH' : 'en';
const number = new Intl.NumberFormat(tag);
const percent = new Intl.NumberFormat(tag, { maximumFractionDigits: 0, style: 'percent' });
const regions = new Intl.DisplayNames([tag], { type: 'region' });
const calendar = new Intl.DateTimeFormat(tag, unit === 'day'
  ? { day: 'numeric', month: 'short', timeZone: 'UTC' }
  : { month: 'short', timeZone: 'UTC', year: 'numeric' });
const dateOf = (key: string) => calendar.format(new Date(`${unit === 'day' ? key : `${key}-01`}T00:00:00Z`));
const chartTitle = unit === 'day' ? copy.stats.chartDaily : copy.stats.chartMonthly;

/** ↑ 12% or ↓ 3%: how a count changed. */
function countChange(current: number, previous: number): string {
  const value = percentChange(current, previous);
  if (value === null) return copy.stats.noPrevious;
  if (value === 0) return copy.stats.noChange;
  return `${value > 0 ? '↑' : '↓'} ${number.format(Math.abs(value))}%`;
}

/** ↓ 2 points: how the read ratio changed, never a percentage of a percentage. */
function ratioChange(): string {
  const value = pointsChange(report.totals, report.previous);
  if (value === null) return copy.stats.noPrevious;
  if (value === 0) return copy.stats.noChange;
  const size = Math.abs(value);
  return `${value > 0 ? '↑' : '↓'} ${fill(size === 1 ? copy.stats.point : copy.stats.points, { value: number.format(size) })}`;
}

const describe = (point: SeriesPoint) => fill(copy.stats.barTitle, {
  date: dateOf(point.key), reads: number.format(point.reads), views: number.format(point.views),
});
const referrerName = (key: string) => (key === '' ? copy.stats.direct : key === 'internal' ? copy.stats.thisSite : key);
const countryName = (key: string) => (key === '' ? copy.stats.unknownCountry : regions.of(key) ?? key);
---

<dl class="stats-summary">
  <div>
    <dt>{copy.stats.views}</dt>
    <dd class="stats-summary__value">{number.format(report.totals.views)}</dd>
    <dd class="stats-summary__change">{countChange(report.totals.views, report.previous.views)}</dd>
  </div>
  <div>
    <dt>{copy.stats.reads}</dt>
    <dd class="stats-summary__value">{number.format(report.totals.reads)}</dd>
    <dd class="stats-summary__change">{countChange(report.totals.reads, report.previous.reads)}</dd>
  </div>
  <div>
    <dt>{copy.stats.readRatio}</dt>
    <dd class="stats-summary__value">{percent.format(readRatio(report.totals))}</dd>
    <dd class="stats-summary__change">{ratioChange()}</dd>
  </div>
</dl>
<p class="stats-note">{copy.stats.previousPeriod}</p>

<section aria-labelledby="stats-chart-heading" class="stats-panel">
  <h2 id="stats-chart-heading">{chartTitle}</h2>
  <p class="stats-legend">
    <span class="stats-legend__views">{copy.stats.views}</span>
    <span class="stats-legend__reads">{copy.stats.reads}</span>
  </p>
  <StatsChart describe={describe} label={chartTitle} points={report.series} tick={dateOf} />
  <details class="stats-numbers">
    <summary>{copy.stats.chartTable}</summary>
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th scope="col">{copy.stats.date}</th>
            <th class="stats-table__number" scope="col">{copy.stats.views}</th>
            <th class="stats-table__number" scope="col">{copy.stats.reads}</th>
          </tr>
        </thead>
        <tbody>
          {report.series.map((point) => (
            <tr>
              <th scope="row">{dateOf(point.key)}</th>
              <td class="stats-table__number">{number.format(point.views)}</td>
              <td class="stats-table__number">{number.format(point.reads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </details>
</section>

<div class="stats-shares">
  <StatsShares format={number} heading={copy.stats.referrers} rows={report.referrers.map(({ key, views }) => ({ label: referrerName(key), views }))} />
  <StatsShares format={number} heading={copy.stats.devices} rows={report.devices.map(({ key, views }) => ({ label: key === 'mobile' ? copy.stats.mobile : copy.stats.desktop, views }))} />
  <StatsShares format={number} heading={copy.stats.countries} rows={report.countries.map(({ key, views }) => ({ label: countryName(key), views }))}>
    <p class="stats-attribution"><a href="https://db-ip.com">{copy.stats.attribution}</a></p>
  </StatsShares>
  <StatsShares format={number} heading={copy.stats.locales} rows={report.locales.map(({ key, views }) => ({ label: key === 'th' ? copy.stats.languages.th : copy.stats.languages.en, views }))} />
</div>
```

Create `src/styles/stats.css`:

```css
/* The Stats screen. Drawn on the server; coloured only with the admin's tokens, so dark mode is the tokens' own. */

.stats-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-block-end: var(--space-lg);
}

.stats-segments {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-3xs);
  padding: var(--space-3xs);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-paper-2);
}

.stats-segments a {
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-pill);
  color: var(--color-muted);
  font-size: 0.875rem;
  text-decoration: none;
  transition: color 150ms ease, background-color 150ms ease;
}

.stats-segments a:hover { color: var(--color-ink); }
.stats-segments a:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }

.stats-segments a[aria-current='true'] {
  background: var(--color-surface);
  box-shadow: 0 0 0 1px var(--color-rule-strong);
  color: var(--color-ink);
}

.stats-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--space-md);
  margin: 0 0 var(--space-xs);
}

.stats-summary > div,
.stats-panel {
  min-inline-size: 0;
  padding: var(--space-md);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.stats-summary dt { color: var(--color-muted); font-size: 0.875rem; }
.stats-summary dd { margin: 0; }

.stats-summary__value {
  color: var(--color-ink);
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.2;
}

.stats-summary__change { color: var(--color-muted); font-size: 0.875rem; }
.stats-note { margin: 0 0 var(--space-lg); color: var(--color-muted); font-size: 0.8125rem; }
.stats-panel h2 { margin: 0 0 var(--space-sm); font-size: 1rem; }

.stats-legend {
  display: flex;
  gap: var(--space-md);
  margin: 0 0 var(--space-xs);
  color: var(--color-muted);
  font-size: 0.8125rem;
}

.stats-legend span::before {
  content: '';
  display: inline-block;
  inline-size: 0.625rem;
  block-size: 0.625rem;
  margin-inline-end: var(--space-2xs);
  border-radius: var(--radius-sm);
}

.stats-legend__views::before,
.stats-chart__views { background: var(--color-rule-strong); fill: var(--color-rule-strong); }

.stats-legend__reads::before,
.stats-chart__reads { background: var(--color-accent); fill: var(--color-accent); }

.stats-chart { display: block; inline-size: 100%; block-size: 12rem; }
.stats-chart__hit { fill: transparent; }
.stats-chart__day:hover .stats-chart__views { fill: var(--color-ink-2); }

.stats-chart__axis {
  display: flex;
  justify-content: space-between;
  margin: var(--space-2xs) 0 0;
  color: var(--color-muted);
  font-size: 0.75rem;
}

.stats-numbers { margin-block-start: var(--space-sm); }
.stats-numbers summary { color: var(--color-link); cursor: pointer; font-size: 0.875rem; }

.stats-shares {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: var(--space-md);
  margin-block: var(--space-lg);
}

.stats-share ol { display: grid; gap: var(--space-2xs); margin: 0; padding: 0; list-style: none; }

.stats-share li {
  position: relative;
  isolation: isolate;
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-xs);
}

.stats-share li::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: -1;
  inline-size: var(--share);
  border-radius: var(--radius-sm);
  background: var(--color-paper-3);
}

.stats-share__label { overflow-wrap: anywhere; }
.stats-share__value { color: var(--color-muted); font-variant-numeric: tabular-nums; }
.stats-share__none { color: var(--color-muted); }
.stats-attribution { margin: var(--space-sm) 0 0; color: var(--color-muted); font-size: 0.75rem; }

.stats-table-wrap { overflow-x: auto; }
.stats-table { inline-size: 100%; border-collapse: collapse; font-size: 0.875rem; }

.stats-table th,
.stats-table td {
  padding: var(--space-xs);
  border-block-end: 1px solid var(--color-rule);
  text-align: start;
}

.stats-table .stats-table__number { font-variant-numeric: tabular-nums; text-align: end; }
.stats-table thead a { color: var(--color-muted); text-decoration: none; }
.stats-table thead [aria-sort] a { color: var(--color-ink); font-weight: 600; }
.stats-table thead a:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }

.stats-empty {
  padding: var(--space-xl) var(--space-lg);
  border: 1px dashed var(--color-rule-strong);
  border-radius: var(--radius-card);
  text-align: center;
}

.stats-empty h2 { margin: 0 0 var(--space-xs); }
.stats-empty p { margin: 0; color: var(--color-muted); }
.stats-pages { display: flex; justify-content: space-between; margin-block-start: var(--space-sm); }
.stats-links { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; }
.stats-back { margin: 0 0 var(--space-sm); }
.stats-articles { margin-block-start: var(--space-lg); }

@media (prefers-reduced-motion: reduce) {
  .stats-segments a { transition: none; }
}
```

- [ ] **Step 5: The two pages**

Create `src/pages/admin/stats.astro`:

```astro
---
import AdminShell from '../../components/admin/AdminShell.astro';
import StatsFilters from '../../components/admin/stats/StatsFilters.astro';
import StatsReport from '../../components/admin/stats/StatsReport.astro';
import AdminLayout from '../../layouts/AdminLayout.astro';
import { adminHref, adminLoginPath } from '../../lib/admin';
import { adminCopy } from '../../lib/admin-i18n';
import { requireOwner } from '../../server/auth/session';
import { getOwnerSettings, type SiteSettings } from '../../server/content/settings';
import { HttpError } from '../../server/http/errors';
import { hasStats, readStats, readStatsArticles, type StatsArticle, type StatsReport as Report } from '../../server/stats/dashboard';
import { parseStatsQuery, readRatio, statsHref, statsPeriods, type StatsSort } from '../../server/stats/report';
import { statsDay } from '../../server/stats/rules';
import '../../styles/stats.css';

const query = parseStatsQuery(Astro.url.searchParams);
let settings: SiteSettings | null = null;
let userEmail: string | null = null;
let counted = false;
let report: Report | null = null;
let articles: StatsArticle[] = [];
let hasMore = false;
let unit: 'day' | 'month' = 'day';
let failed = false;
let authRequired = false;

try {
  const current = await requireOwner(Astro.request.headers);
  userEmail = current.user.email;
  settings = await getOwnerSettings(current.user.id);
  counted = settings ? await hasStats(current.user.id) : false;
  if (settings && counted) {
    const periods = statsPeriods(query.range, statsDay(new Date(), settings.timezone));
    const filter = { lang: query.lang, ownerId: current.user.id };
    unit = periods.unit;
    const [loaded, table] = await Promise.all([
      readStats(filter, periods),
      readStatsArticles(filter, periods.current, query.sort, query.page),
    ]);
    report = loaded;
    articles = table.articles;
    hasMore = table.hasMore;
  }
} catch (error) {
  if (error instanceof HttpError && error.status === 401) {
    authRequired = true;
    Astro.response.status = 302;
    Astro.response.headers.set('Location', adminLoginPath(Astro.url.pathname + Astro.url.search));
  } else {
    console.error('Stats loading failed.');
    Astro.response.status = 500;
    failed = true;
  }
}

const ownerLocale = settings?.default_locale ?? null;
const copy = adminCopy(ownerLocale);
const base = settings ? adminHref(settings, '/stats') : '/admin/stats';
const tag = ownerLocale === 'th' ? 'th-TH' : 'en';
const number = new Intl.NumberFormat(tag);
const percent = new Intl.NumberFormat(tag, { maximumFractionDigits: 0, style: 'percent' });
const COLUMNS: Array<[StatsSort, string]> = [['views', copy.stats.views], ['reads', copy.stats.reads], ['ratio', copy.stats.readRatio]];
---

<AdminLayout lang={ownerLocale ?? 'en'} title={copy.stats.heading}>
  {authRequired || failed || !settings ? (
    <main><p class="admin-alert admin-alert--page" role="alert">{failed ? copy.errors.statsUnavailable : null}</p></main>
  ) : (
    <AdminShell active="stats" adminPath={settings.admin_path} locale={settings.default_locale} siteName={settings.site_name} title={copy.stats.heading} userEmail={userEmail}>
      <section class="admin-page stats-page">
        <header class="admin-page__head">
          <div>
            <h1>{copy.stats.heading}</h1>
            <p>{copy.stats.subheading}</p>
          </div>
        </header>
        {!counted || !report ? (
          <div class="stats-empty">
            <h2>{copy.stats.emptyHeading}</h2>
            <p>{copy.stats.emptyBody}</p>
          </div>
        ) : (
          <>
            <StatsFilters base={base} copy={copy} query={query} />
            <StatsReport copy={copy} locale={settings.default_locale} report={report} unit={unit} />
            <section aria-labelledby="stats-articles-heading" class="stats-panel stats-articles">
              <h2 id="stats-articles-heading">{copy.stats.articles}</h2>
              {articles.length === 0 ? (
                <p>{copy.stats.noViews}</p>
              ) : (
                <div class="stats-table-wrap">
                  <table class="stats-table">
                    <thead>
                      <tr>
                        <th scope="col">{copy.stats.title}</th>
                        <th scope="col">{copy.stats.kind}</th>
                        <th scope="col">{copy.stats.language}</th>
                        {COLUMNS.map(([sort, label]) => (
                          <th aria-sort={query.sort === sort ? 'descending' : undefined} class="stats-table__number" scope="col">
                            <a href={statsHref(base, query, { page: 1, sort })}>{label}</a>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {articles.map((article) => (
                        <tr>
                          <th scope="row">
                            <a href={statsHref(`${base}/${article.id}`, query, { page: 1 })}>{article.title ?? copy.stats.deleted}</a>
                          </th>
                          <td>{article.kind === 'post' ? copy.stats.post : copy.stats.page}</td>
                          <td>{copy.stats.languages[article.locale]}</td>
                          <td class="stats-table__number">{number.format(article.views)}</td>
                          <td class="stats-table__number">{number.format(article.reads)}</td>
                          <td class="stats-table__number">{percent.format(readRatio(article))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(query.page > 1 || hasMore) && (
                <nav aria-label={copy.stats.articles} class="stats-pages">
                  {query.page > 1 ? <a href={statsHref(base, query, { page: query.page - 1 })}>{copy.stats.previousPage}</a> : <span />}
                  {hasMore && <a href={statsHref(base, query, { page: query.page + 1 })}>{copy.stats.nextPage}</a>}
                </nav>
              )}
            </section>
          </>
        )}
      </section>
    </AdminShell>
  )}
</AdminLayout>
```

Create `src/pages/admin/stats/[id].astro`:

```astro
---
import AdminShell from '../../../components/admin/AdminShell.astro';
import StatsFilters from '../../../components/admin/stats/StatsFilters.astro';
import StatsReport from '../../../components/admin/stats/StatsReport.astro';
import AdminLayout from '../../../layouts/AdminLayout.astro';
import { adminHref, adminLoginPath } from '../../../lib/admin';
import { adminCopy } from '../../../lib/admin-i18n';
import { pagePath, postPath } from '../../../lib/i18n';
import { requireOwner } from '../../../server/auth/session';
import { getOwnerSettings, type SiteSettings } from '../../../server/content/settings';
import { HttpError } from '../../../server/http/errors';
import { isUuid } from '../../../server/media/keys';
import { readStats, readStatsEdition, type StatsEdition, type StatsReport as Report } from '../../../server/stats/dashboard';
import { parseStatsQuery, statsHref, statsPeriods } from '../../../server/stats/report';
import { statsDay } from '../../../server/stats/rules';
import '../../../styles/stats.css';

const query = parseStatsQuery(Astro.url.searchParams);
const id = Astro.params.id?.toLowerCase() ?? '';
let settings: SiteSettings | null = null;
let userEmail: string | null = null;
let edition: StatsEdition | null = null;
let report: Report | null = null;
let unit: 'day' | 'month' = 'day';
let failed = false;
let authRequired = false;

try {
  const current = await requireOwner(Astro.request.headers);
  userEmail = current.user.email;
  settings = await getOwnerSettings(current.user.id);
  edition = settings && isUuid(id) ? await readStatsEdition(current.user.id, id) : null;
  if (settings && edition) {
    const periods = statsPeriods(query.range, statsDay(new Date(), settings.timezone));
    unit = periods.unit;
    report = await readStats({ contentId: edition.id, lang: null, ownerId: current.user.id }, periods);
  } else if (settings) {
    Astro.response.status = 404;
  }
} catch (error) {
  if (error instanceof HttpError && error.status === 401) {
    authRequired = true;
    Astro.response.status = 302;
    Astro.response.headers.set('Location', adminLoginPath(Astro.url.pathname + Astro.url.search));
  } else {
    console.error('Stats loading failed.');
    Astro.response.status = 500;
    failed = true;
  }
}

const ownerLocale = settings?.default_locale ?? null;
const copy = adminCopy(ownerLocale);
const base = settings ? adminHref(settings, '/stats') : '/admin/stats';
// A deleted edition has neither: nothing to edit, and nowhere on the site to see it.
const editHref = settings && edition && edition.title !== null
  ? adminHref(settings, edition.kind === 'post' ? `/edit/${edition.id}` : `/pages/edit/${edition.id}`)
  : null;
const siteHref = edition?.slug
  ? (edition.kind === 'post' ? postPath({ locale: edition.locale, slug: edition.slug }) : pagePath({ locale: edition.locale, slug: edition.slug }))
  : null;
---

<AdminLayout lang={ownerLocale ?? 'en'} title={edition?.title ?? copy.stats.heading}>
  {authRequired || failed || !settings ? (
    <main><p class="admin-alert admin-alert--page" role="alert">{failed ? copy.errors.statsUnavailable : null}</p></main>
  ) : (
    <AdminShell active="stats" adminPath={settings.admin_path} locale={settings.default_locale} siteName={settings.site_name} title={copy.stats.heading} userEmail={userEmail}>
      <section class="admin-page stats-page">
        <p class="stats-back"><a href={statsHref(base, query, { page: 1 })}>← {copy.stats.back}</a></p>
        {!edition || !report ? (
          <div class="stats-empty">
            <h1>{copy.stats.heading}</h1>
            <p>{copy.stats.notFound}</p>
          </div>
        ) : (
          <>
            <header class="admin-page__head">
              <div>
                <h1>{edition.title ?? copy.stats.deleted}</h1>
                <p>{edition.kind === 'post' ? copy.stats.post : copy.stats.page} · {copy.stats.languages[edition.locale]}</p>
              </div>
              <div class="stats-links">
                {editHref && <a href={editHref}>{copy.stats.edit}</a>}
                {siteHref && <a href={siteHref}>{copy.stats.viewOnSite}</a>}
              </div>
            </header>
            <StatsFilters base={`${base}/${edition.id}`} copy={copy} languages={false} query={query} />
            <StatsReport copy={copy} locale={settings.default_locale} report={report} unit={unit} />
          </>
        )}
      </section>
    </AdminShell>
  )}
</AdminLayout>
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --import tsx --test tests/unit/icons.test.ts` — PASS (the new nav id has its icon).
Run: `npm run test:e2e -- tests/e2e/stats.spec.ts` — PASS, 4 tests on each project.

- [ ] **Step 7: Look at it**

Open the eight screenshots the spec wrote under `test-results/` (`stats-empty-1280-light`, `stats-data-1280-light`, `stats-data-1280-dark`, `stats-data-375-light`, `stats-data-375-dark`, on each project) with the Read tool. Check: nothing overlaps or clips, the chart bars are visible in both themes (reads distinguishable from views), the summary numbers are the largest text, the filters wrap cleanly at 375, the table scrolls within its own box at 375 rather than widening the page. Fix what is wrong in `src/styles/stats.css` and re-run the spec.

- [ ] **Step 8: Check the guards**

One at a time, then undone, each followed by the spec on `desktop`:
- In `StatsReport.astro`'s `ratioChange`, use `countChange(readRatio(…) * 100, …)` style percentages → the `↑ 19 points` assertion fails.
- Remove `.stats-table-wrap { overflow-x: auto; }` → the 375 overflow check fails.
- In `stats.astro`, drop `statsHref`'s `{ page: 1, sort }` and link with `?sort=` alone → the language filter is lost and the "All stats" URL assertion fails.

- [ ] **Step 9: Gates and commit**

Run: `npm run check`, then `npm run test:unit`, then `node scripts/test-foundation.mjs tests/integration/stats-dashboard.test.ts`, then the spec on both projects.

```bash
git add src/pages/admin/stats.astro "src/pages/admin/stats/[id].astro" src/components/admin/stats/StatsFilters.astro src/components/admin/stats/StatsReport.astro src/components/admin/stats/StatsChart.astro src/components/admin/stats/StatsShares.astro src/styles/stats.css src/lib/admin.ts src/lib/icons.ts src/lib/admin-i18n.ts src/components/admin/AdminShell.astro tests/e2e/stats.spec.ts
```

Message file:

```text
feat(stats): the Stats screen, first under Content

Views, reads and the read ratio against the period of the same length just before, a chart
by day or month with its numbers in a table beneath, where readers came from, their devices,
countries and languages, and every article and page with its numbers, sortable and fifty at
a time. One article has a screen of its own with links to edit it and see it. Drawn on the
server, every choice in the address, in Thai and English.
```

---

### Task 7: The GeoIP file ships, and the feature is written down

**Files:**
- Modify: `.github/workflows/release.yml` (a step before "Build and push immutable multi-architecture image"), `Dockerfile`, `.gitignore`, `.env.example`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 3's `TOME_CMS_GEOIP_PATH` default (`data/geoip/dbip-country-lite.mmdb`) and `TOME_CMS_COUNTRY_HEADER`.
- Produces: release images that contain `/app/data/geoip/dbip-country-lite.mmdb`.

- [ ] **Step 1: Download it in the release workflow**

In `.github/workflows/release.yml`, add a step immediately before the step named "Build and push immutable multi-architecture image" (same indentation as its siblings):

```yaml
      - name: Fetch the DB-IP Lite country database
        # CC BY 4.0: the Stats screen and the README carry DB-IP's attribution. The month's file
        # appears some days into the month, so the previous month's stands in until then.
        run: |
          mkdir -p data/geoip
          for month in "$(date -u +%Y-%m)" "$(date -u -d '-1 month' +%Y-%m)"; do
            if curl -fsSL --retry 3 "https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz" -o dbip.mmdb.gz; then
              gunzip -c dbip.mmdb.gz > data/geoip/dbip-country-lite.mmdb
              rm dbip.mmdb.gz
              break
            fi
          done
          test -s data/geoip/dbip-country-lite.mmdb
          node --input-type=module -e "
            import { readFileSync } from 'node:fs';
            import { Reader } from 'mmdb-lib';
            const code = new Reader(readFileSync('data/geoip/dbip-country-lite.mmdb')).get('8.8.8.8')?.country?.iso_code ?? '';
            if (!/^[A-Z]{2}$/.test(code)) { console.error('The GeoIP file does not answer.'); process.exit(1); }
          "
```

- [ ] **Step 2: Carry it into the image**

In `Dockerfile`, in the builder stage, change `RUN npm run build` to:

```dockerfile
# The release workflow puts DB-IP Lite here; a build without it ships an empty folder, and Stats
# shows countries as unknown.
RUN mkdir -p data/geoip && npm run build
```

and in the runtime stage, after the line `COPY --from=builder --chown=node:node /app/dist ./dist`, add:

```dockerfile
COPY --from=builder --chown=node:node /app/data/geoip ./data/geoip
```

In `.gitignore`, add:

```text
# DB-IP Lite, downloaded by the release workflow (or by hand for local Stats countries).
/data/geoip/
```

In `.env.example`, add after `TOME_CMS_FRONTEND_MODE=bundled`:

```dotenv
# Stats: the header a CDN puts the reader's country in, and where the DB-IP Lite file is.
# TOME_CMS_COUNTRY_HEADER=cf-ipcountry
# TOME_CMS_GEOIP_PATH=data/geoip/dbip-country-lite.mmdb
```

- [ ] **Step 3: Check the image build takes it**

Run: `mkdir -p data/geoip && docker build --target runtime -t tomecms-stats-check .` — succeeds without a GeoIP file.
Run: `docker run --rm --entrypoint ls tomecms-stats-check -la data/geoip` — the folder exists (empty).
Run: `docker image rm tomecms-stats-check`.

If the machine's load makes a full image build impractical (`uptime` over 15), skip this step and say so in the report; CI's release run is the check.

- [ ] **Step 4: Write it down**

In `README.md`, add a section at the end of "## Running the site from the admin" (after "### Publishing, addresses and redirects"):

```markdown
### Stats

**Content → Stats** shows how often each article and page was opened (views) and read to its end (reads), the share of views that became reads, a chart by day or by month, where readers came from, their devices, countries and languages, each against the period of the same length before. Pick 7, 30 or 90 days or 12 months, a language, and a column to sort by; every choice is in the address. An article's own screen links to editing it and to seeing it on the site.

TomeCMS counts these itself, into daily totals: no cookie, no outside service, and no record of any one reader. A view counts once per page per browser tab. A read needs the end of the article on screen and 15 seconds, in all, with the tab visible. Your own browser is left out once it has opened the admin, as are readers who set Do Not Track or Global Privacy Control, and fetchers that call themselves bots. The numbers are estimates: someone determined can add to them, up to 120 hits from one address in ten minutes. Counting starts with the version that brought it and cannot reach back.

Countries come from the `CF-IPCountry` header when a CDN such as Cloudflare sends one (set `TOME_CMS_COUNTRY_HEADER` to read another), and otherwise from the DB-IP Lite country database in the release image: [IP Geolocation by DB-IP](https://db-ip.com), CC BY 4.0. An image built on your own server has no database until you put `dbip-country-lite.mmdb` in `data/geoip/` (or point `TOME_CMS_GEOIP_PATH` at it); without one, countries show as unknown. The reader's address is used for that lookup and for the limit, in memory, and never stored.

Behind a reverse proxy the reader's address is the last `X-Forwarded-For` entry, believed only from a loopback or private address, which is where your proxy connects from. With a CDN in front of the proxy, have the proxy put the reader's own address there (with Caddy, `trusted_proxies` for the CDN's ranges and `header_up X-Forwarded-For {client_ip}`), or every reader behind one CDN address shares one limit.
```

In `README.md`'s "## Headless content API", after the `GET /api/v1/content/openapi.json` code block and its following paragraph, add:

````markdown
A headless site counts its readers for the Stats screen by posting to the one route that writes. It answers `204` whether or not the hit counted, and in headless mode it accepts any origin:

```js
fetch('https://cms.example.com/api/v1/stats/hit', {
  body: JSON.stringify({ event: 'view', kind: 'post', id: post.id, locale: 'th', referrer: document.referrer, width: innerWidth }),
  headers: { 'Content-Type': 'application/json' },
  keepalive: true,
  method: 'POST',
});
```

Send it once per page per tab, `event: 'read'` once the reader reaches the end after 15 visible seconds, and `kind: 'home'` without an `id` for the home page. Leave out a browser that set Do Not Track or Global Privacy Control, and your own.
````

In `CHANGELOG.md`, add as the first bullet under `## Unreleased` → `### Added`:

```markdown
- **Stats**, first under Content: views, reads and the read ratio of every article and page, against the period before, with a chart by day or month and where readers came from, their devices, countries and languages. TomeCMS counts these itself into daily totals, with no cookie and no record of any reader, and leaves out your own browser, readers who ask not to be tracked, and self-declared bots. Countries come from a CDN's header or from DB-IP Lite, which the release image now carries. A headless site counts through `POST /api/v1/stats/hit`.
```

- [ ] **Step 5: Gates and commit**

Run: `npm run check`, then `npm run test:unit`.

```bash
git add .github/workflows/release.yml Dockerfile .gitignore .env.example README.md CHANGELOG.md
```

Message file:

```text
chore(stats): ship DB-IP Lite in the release image, and document Stats

The release workflow downloads the month's DB-IP Lite country file, checks that it answers,
and the image carries it at data/geoip. The README says what Stats counts and leaves out,
where countries come from and DB-IP's attribution, how a proxy passes the reader's address,
and how a headless site counts.
```

---

## Verification against the spec

| Spec | Where |
|---|---|
| Table, key, checks, cascade, no FK to content | Task 2 migration + `stats-schema.test.ts` |
| View once per tab, read = end + 15 s, once per tab | Task 4 `StatsBeacon.astro` + e2e test 1 |
| Owner, DNT, GPC, bots, non-BaseLayout pages, theme previews not counted | Task 4 (owner, DNT, GPC, preview: e2e 2–3); Task 1 `isBot`; Task 3 `bot` drop |
| Country: header, then DB-IP via `mmdb-lib`, address never written | Task 3 `country.ts`, `stats-country.test.ts`, "no address in any row" |
| `readerAddress` | Task 1 (+ Ruling 1) |
| Endpoint: 204 always, ≤ 1 KB, steps 1–5, bundled vs headless, OpenAPI | Task 3 |
| 200 concurrent hits make 200 | Task 3 integration |
| Screen: ranges, language, summary with % and points, chart + table, four breakdowns, 50-row sortable table, deleted listed, one article, empty state, attribution, URL state | Tasks 5–6 |
| Both Playwright projects, 375 wide, screenshots light/dark at 1280 and 375 | Tasks 4, 6 |
| Release downloads DB-IP; attribution on screen and in docs | Tasks 6, 7 |
