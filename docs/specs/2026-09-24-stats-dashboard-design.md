# Stats

Date: 2026-09-24
Status: Design, for the owner's review before planning

TomeCMS counts nothing about its readers. The owner writes into silence: there is no way to see
which articles are read, which are opened and left, or where readers come from. This design
adds a Stats screen in the spirit of Medium's — views, reads, the read ratio, a daily chart and
a table of every article and page — counted by TomeCMS itself, with no cookie and no record of
any one reader. It is the last feature before 1.0.0.

## What was decided before this was written

Each of these was put to the owner as a question and chosen.

- **Counted by TomeCMS, not an outside service.** No Plausible, Umami or Google Analytics to run
  beside it, and reads can be measured, which a pageview counter cannot.
- **Beside the core numbers, four dimensions:** where readers came from, the page's language,
  phone or computer, and country.
- **Country from the CDN's header first, then a GeoIP database.** The address is used only to
  find the country and is never written anywhere.
- **A beacon from the browser, added to daily totals at once** (approach A). No row per reader,
  no scheduled job. Unique visitors are given up for it; Medium does not show them either.

## Counting

### What is kept

A new table, `content_stats_daily`, holds counters and nothing else. Migration
`025_content_stats`.

| Column | Meaning |
|---|---|
| `owner_id` | the site's owner |
| `day` | `date`, in the site's timezone (`Asia/Bangkok` or `UTC`, as its settings say) |
| `kind` | `home`, `post` or `page` |
| `content_id` | the post's or page's edition id; null for `home` |
| `locale` | `th` or `en`, from the page's address |
| `referrer` | the referring host, lower case, without `www.`; `''` for none; `internal` for this site |
| `device` | `mobile` (a window under 768px wide) or `desktop` |
| `country` | an ISO 3166-1 alpha-2 code, or `''` when unknown |
| `views` | `integer not null default 0` |
| `reads` | `integer not null default 0` |

The primary key is every column but the two counters, with `content_id` coalesced so `home`
takes part in it (a unique index over `coalesce(content_id, '00000000-0000-0000-0000-000000000000')`
or an equivalent). Checks: `kind` in its three values; `content_id` null exactly when `kind` is
`home`; `locale` in `th`, `en`; `device` in its two values; `country` is `''` or two upper-case
letters; `referrer` at most 253 characters; both counters non-negative. An index on
`(owner_id, day)` serves every read. A deleted post or page leaves its rows (they are history,
and the dashboard shows them as a deleted article); the owner's deletion cascades.

A count is `insert … on conflict (…) do update set views = content_stats_daily.views + 1`, atomic
without a lock however many arrive at once.

### What counts

- **A view** is the page's script running once for that page in that tab: `sessionStorage`
  remembers it, so a reload does not count again and a new tab does.
- **A read** — posts and pages only, never the home page — is the end of the article coming into
  view *and* the tab having been visible for at least 15 seconds in all. Once per page per tab.
- **The read ratio** of an article is its reads divided by its views.

### What does not count

- **The owner.** Every admin page sets a `localStorage` flag in that browser; the script sees it
  and sends nothing. The server never reads a session to count a hit. A browser the owner has
  never used for the admin is counted, which is accepted.
- **Readers who asked not to be tracked:** Do Not Track or Global Privacy Control set.
- **Bots:** most do not run the script, and the server drops a User-Agent that names itself a
  bot, crawler, spider or preview fetcher from a short list.
- **Pages outside `BaseLayout`** — the admin, the previews, the maintenance page — carry no script.
  The admin's theme previews do use `BaseLayout` and pass it a `themeId`; the script is left out
  there too.

### Country

`CF-IPCountry` (or a configured equivalent header) is used when present and a valid code. When it
is absent, the reader's address is looked up in the DB-IP Lite country database (CC BY 4.0), read
with `mmdb-lib`. The address is read by a new `readerAddress(request, clientAddress)`: when the
request reached the app over loopback — which only the owner's own reverse proxy can do, the app
being bound to `127.0.0.1` — it is the last entry of `X-Forwarded-For`; otherwise it is
`clientAddress`. The address is used for the lookup and the rate limit, in memory, and is written
nowhere. Without the database file, the country is unknown and nothing fails.

The release workflow downloads the current DB-IP Lite country file when it builds the image. The
attribution DB-IP asks for appears on the Stats screen and in the documentation.

## Receiving a count

`POST /api/v1/stats/hit`, body JSON of at most 1 KB:
`{ event: 'view' | 'read', kind, id?, locale, referrer?, width }`.

It answers **204 whatever happens**, so someone inflating the numbers learns nothing about which
of their requests counted; the reason a request was dropped goes to the server log. It lives
outside `/api/v1/content/*`, so the maintenance gate leaves it alone; a closed site sends no hits.
The OpenAPI document describes it.

Before counting, the server:

1. parses the body with zod — known `event`, `kind` and `locale`; `read` of `home` dropped;
   `width` a whole number in a plausible range;
2. drops an `id` that is not a live post or page of that language (`live()` as the public site
   uses it), through a process-local cache of five minutes;
3. reduces `referrer` to a host, checks it is a host, and stores `internal` for this site's own;
4. drops a bot's User-Agent;
5. drops the hit once the reader's address has sent 120 in 10 minutes. The limit is kept in
   memory with a cap on the addresses it remembers, not in `security_rate_limits`, which would
   grow by a row for every reader. A `ponytail:` comment marks it as one process's limit.

**Who may send.** In bundled mode, only this site: the request's `Origin`, or
`Sec-Fetch-Site: same-origin`. In headless mode, any origin, with the CORS the content API
already answers; a headless site counts by calling the same endpoint with
`fetch(…, { keepalive: true })`, and the documentation shows how. The numbers are presented as
estimates: someone determined can still add to them, within the limit, and cannot take the site
down doing it.

**The script** is `src/components/StatsBeacon.astro`, a small module in `BaseLayout`. It sends
with `navigator.sendBeacon`, watches a marker the core places at the end of the `<article>` with
`IntersectionObserver`, and adds up visible time with `visibilitychange`. It works the same in
`paper` and `plain`.

## The Stats screen

A new first entry in the Content group, **Stats** / **สถิติ**, at `/admin/stats`. `/admin` stays
the posts list.

The screen is drawn on the server, with no React island and no chart library. Every choice is in
the address — `?range=30d&lang=th&sort=reads` — so it can be bookmarked and the back button
works.

- **Range:** 7 days, 30 days (default), 90 days, 12 months.
- **Language:** all, Thai, English.
- **Summary:** views, reads and the read ratio, each against the previous period of the same
  length — views and reads as a percentage change, the read ratio as a change in points
  (`↓ 2 points`, never a percentage of a percentage). No previous data shows no change.
- **Chart:** views per day as bars with reads inside them; per month for 12 months. An SVG the
  server draws, each bar titled with its numbers, coloured with the admin's tokens in light and
  dark. Under it, a `<details>` holds the same numbers as a table.
- **Four breakdowns:** the top 10 referrers ("Direct" for none, "This site" for `internal`),
  devices, the top 10 countries named with `Intl.DisplayNames` in the owner's language ("Unknown"
  for `''`), and languages.
- **Articles and pages:** title, kind and language, views, reads and read ratio, sortable by any
  of the three, 50 at a time with a link to the rest. A deleted one is listed as deleted.
- **One article:** `/admin/stats/<id>` shows the same chart and breakdowns for that edition, with
  links to edit it and to view it on the site.
- **Before any data:** it says counting starts from this version and cannot reach back, and that
  the owner's own visits are not counted.
- The DB-IP attribution sits under the country breakdown.

Every query is a `sum … group by` over `content_stats_daily` by `(owner_id, day)`; titles come
from posts and pages by id. All copy is in `src/lib/admin-i18n.ts`, in Thai and English.

## Not in this design

| Left out | Why, or when to add it |
|---|---|
| Unique visitors | they need an identifier per reader, which this design keeps none of |
| Real-time numbers | daily totals are enough for a blog |
| CSV export, emailed reports | nobody has asked; TomeCMS sends no mail |
| UTM campaigns, referrer paths | only the host is kept, for privacy |
| Claps, followers | TomeCMS has neither |
| History before this version | there is nothing to read it from |
| Numbers beside each post in the posts list | easy to add once this screen has settled |

## Verification

Every test is written before the code it covers, and every guard is checked by putting back the
bug it guards against.

**Unit** — the referrer's host (`www.` dropped, this site `internal`, nonsense direct); the device
at 767 and 768 pixels; the bot list; the day in the site's timezone either side of midnight;
`readerAddress` trusting `X-Forwarded-For` only over loopback; the rate limit dropping past 120,
resetting after 10 minutes, and holding no more addresses than its cap; the hit schema; the
percentage and points changes, including a previous period of zero.

**Integration**, against a real PostgreSQL — 200 hits at once make exactly 200; a draft, an
article not yet due and an id of the other language are dropped; the dashboard's queries for each
range, the language filter, the previous period, each top 10 and the monthly totals; the CDN
header winning over GeoIP, neither giving unknown, and no address in any row.

**Browser**, on both Playwright projects — a reader opening an article makes one view, and a
reload still one; the end reached and 15 visible seconds make one read, fewer seconds none (with
a paused `page.clock`); a browser that opened the admin, one with Do Not Track and one with GPC
count nothing; a cross-origin hit in bundled mode is answered 204 and not counted; the Stats
screen shows seeded numbers, changes range, language and sort, and opens one article; nothing
overflows at 375 wide.

**By eye:** the Stats screen with and without data, light and dark, at 1280 and 375.

Gates before each commit, one after another: `npm run check`, `npm run test:unit`, the
integration files touched, and the browser specs on both projects.

## Risks

- **Every public page gains a small script and a request.** The script is under a couple of
  kilobytes; the request is a beacon the browser sends when it can, and never delays the page.
- **The counts can be inflated** by someone determined, within the limit. They are labelled
  estimates.
- **The rate limit and the id cache are per process.** TomeCMS runs one application process;
  more would each keep their own.
- **The GeoIP file ages.** It is refreshed with every release; between releases a few addresses
  may resolve to an old country, or to none.
