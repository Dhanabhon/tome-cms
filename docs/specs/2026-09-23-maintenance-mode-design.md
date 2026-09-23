# Maintenance Mode

Date: 2026-09-23
Status: Design, for the owner's review before planning

TomeCMS has no way to close a site while its owner works on it. The only thing called
maintenance in the code is the updater's: `src/server/update/maintenance.ts` refuses admin
writes while a managed update installs, and a reader never sees it. This design lets the owner
close the public site by hand and show readers a page of their choosing, built from one of four
templates with the owner's own words, picture and return time.

## What was decided before this was written

Each of these was put to the owner as a question and chosen.

- **A template plus the owner's content,** not an editor and not raw HTML. Four templates
  (Minimal, Logo, Picture, Countdown). The owner writes a heading and a message in each
  language, chooses a picture, and says roughly when the site is back.
- **Both the site and the public API close.** Every page a theme draws, the sitemap and the
  feed answer 503 with the maintenance page; `/api/v1/content/*` answers 503 in JSON. The
  admin, sign-in, `/health`, `/media` and the build's assets stay open.
- **The owner turns it on and off.** The return time is shown, counted down to and sent as
  `Retry-After`. It never reopens the site by itself: work runs late more often than it runs
  early, and a site that reopens half-fixed is worse than one that stays closed a little longer.
- **The page is the core's, not the theme's** (approach A). The four templates live in the
  core and use the site's brand, so no theme has to change, and a theme that breaks during the
  very work maintenance is for cannot take the maintenance page down with it.

## Data

Migration `024_site_maintenance` adds columns to the one `site_settings` row. The middleware
already reads that row on every request through an uncached `getSiteSettings()`, so the switch
costs no extra query and takes effect on the next request.

| Column | Type | Rule |
|---|---|---|
| `maintenance_enabled` | `boolean not null default false` | |
| `maintenance_template` | `text not null default 'minimal'` | one of `minimal`, `logo`, `picture`, `countdown` |
| `maintenance_copy` | `jsonb not null default '{}'` | an object; its shape is checked by zod |
| `maintenance_media_id` | `uuid null` | FK `(maintenance_media_id, owner_id)` → `media_items(id, owner_id)` `on delete restrict` |
| `maintenance_back_at` | `timestamptz null` | |

Table checks, written so that `NULL` cannot slip through (the home slides button check taught
that a Postgres `CHECK` passes on `NULL`):

- `maintenance_template <> 'picture' or maintenance_media_id is not null`
- `maintenance_template <> 'countdown' or maintenance_back_at is not null`
- `jsonb_typeof(maintenance_copy) = 'object'`

`maintenance_copy` is `{ th?: { heading, message }, en?: { heading, message } }`. zod trims
each string, allows a heading of at most 80 characters and a message of at most 280, and
treats an empty one as unwritten. An unwritten heading or message is filled at render time
with the product's own words in that language ("ปิดปรับปรุงชั่วคราว" / "Down for maintenance",
"เราจะกลับมาเร็ว ๆ นี้" / "We'll be back soon"), so a site closed in a hurry still says
something.

The picture must be a ready image from the owner's library, checked the way a slide's is. The
library refuses to delete it and names the maintenance page as the reason; `MediaReferences`
gains `maintenance: boolean`, and the library's panel lists it beside a picture's slides.

The server module is `src/server/content/site-maintenance.ts`, named so it cannot be mistaken
for the updater's `src/server/update/maintenance.ts`. The two stay separate.

## Saving and switching

Saving and switching are two actions.

- `PUT /api/admin/maintenance` stores the template, the copy, the picture and the return time.
  It never changes `maintenance_enabled`, so the owner can save and preview as often as they
  like with the site open.
- `PUT /api/admin/maintenance/state` with `{ enabled }` turns the site's maintenance on or off
  and nothing else.

Both are owner-only, return 400 for anything the schema refuses, and use the same
`HttpError`/Postgres-code mapping as navigation and slides (`23514` and `23503` become 400).

## Which requests close

The gate sits in `src/middleware.ts`, after the settings row is read and after the headless
mode's own 404, and does nothing while `maintenance_enabled` is false. A pure function sorts
each path into one of three groups; it is exported so a unit test can hold it to this list.

**Always open.** The configured admin path and `/api/admin/*`, `/api/auth/*`, `/install` and
its API, `/recovery` and its API, `/health/live`, `/health/ready`, `/_astro/*`, `/media/*`,
`/favicon.svg`, `/api/v1/content/openapi.json`, and `/api/v1/content/preview/*`, which already
requires the owner's preview token.

**Pages** are the paths `isBundledFrontendPath` recognises: `/`, `/sitemap.xml`, `/rss.xml`,
each language's home, posts and pages, and the legacy `/blog/<slug>`.

- A page is rewritten, not redirected, to the core's maintenance page, which answers **503**
  with `Cache-Control: no-store`. The reader's URL does not change, so reloading later brings
  them back where they were, and a crawler sees a 503 at the real address rather than a 302.
- The page's language comes from the path: `/th/...` is Thai, `/en/...` is English, and `/`
  and `/blog/...` use the site's default language.
- `/sitemap.xml` and `/rss.xml` answer 503 as short plain text instead of the page.

**API** is every other path under `/api/v1/content/`. It answers **503** as the problem
document the API already returns for its errors (`problem()` in
`src/server/http/problem.ts`), with one extension member so a headless site can draw its own
maintenance page from the refusal without a second request:

```json
{
  "type": "about:blank",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "The site is closed for maintenance.",
  "maintenance": { "locale": "th", "heading": "…", "message": "…", "backAt": "2026-09-24T02:00:00.000Z" },
  "instance": "/api/v1/content/posts",
  "requestId": "…"
}
```

The language is `?locale=` when it is `th` or `en`, and the site's default otherwise. `backAt`
is `null` when no time is set. The OpenAPI document gains this 503 response on every content
route.

**`Retry-After`.** Every 503 above carries `Retry-After` as an HTTP date when
`maintenance_back_at` is still ahead, and none when it is unset or has passed. A time equal to
now has passed, the same rule `slideStatus` uses.

**The owner.** Only while maintenance is on, and only for pages and API paths, the gate reads
the session. The signed-in owner passes through and sees the real site, with a thin bar at the
top of every page saying the site is closed to visitors and linking to the maintenance screen.
Every response the owner is given this way is `Cache-Control: private, no-store`, so no cache
keeps the barred page for someone else. While maintenance is off there is no session read and
no extra cost.

Known limit, accepted: a CDN may keep serving an API, feed or sitemap response it cached before
maintenance began for its `s-maxage` plus `stale-while-revalidate` -- up to about an hour for
the feeds (`s-maxage=300, stale-while-revalidate=3600`) -- and a browser may keep an API
response for its `max-age`. There is still no purge.

## The maintenance page

One Astro page in the core draws all four templates. It does not use the theme. Its colours,
type and spacing come from `src/styles/installer-tokens.css`, the single source of every token,
which the installer page already uses, and it follows the site's light, dark or system setting.
It sets `lang` to the language it draws, titles itself `<heading> · <site name>`, and carries
the site's icon. Only Countdown runs script.

- **Minimal.** Words alone, set flush left in an editorial measure, the site name small below.
- **Logo.** The site's logo, and its dark version in dark mode when one is set, centred above
  the heading. A site with no logo shows its name in its place.
- **Picture.** The owner's picture fills the screen with `object-fit: cover` under a scrim dark
  enough for the words to read. It is the page's largest paint, so it is fetched with
  `fetchpriority="high"`; its `alt` is empty because it is a backdrop.
- **Countdown.** Hours, minutes and seconds to the return time, in `tabular-nums` so the digits
  do not jitter, in about twenty lines of script. The countdown is not announced every second.
  Without script the return time is still written out. Once it passes, the page says it will be
  back soon rather than counting below zero, and it does not reload itself.

Every template writes the return time, when there is one, in the site's timezone. A template
with no return time set leaves that line out.

## The admin screen

A new entry in Configuration, after Settings: **Maintenance** / **ปิดปรับปรุง**, with the nav id
`maintenance`. It uses the admin's existing fields, buttons, tabs, picker and cover preview; it
adds no component of its own.

- **State.** A panel at the top says whether the site is open or closed, with one button. Turning
  maintenance on asks for confirmation ("Visitors will see the maintenance page at once");
  turning it off does not. The button is disabled, with the reason beside it, while the form has
  unsaved changes, so the site never closes on words other than the ones on screen.
- **Template.** Four radio cards, each with a small drawing of its layout.
- **Words.** A Thai and an English tab, each with a heading and a message. Their placeholders are
  the product's own words that an empty field falls back to.
- **Picture.** Shown only for Picture: the cover preview and a secondary "Choose picture"
  button. It warns about a picture under 1600 pixels wide or over 800 KB, with the constants the
  slides already use.
- **Back around.** A date and time. Required for Countdown, optional for the rest.
- **Save** and **Preview**. Preview opens a new tab at an admin-only route that draws the saved
  settings with the same page a visitor gets, answers 200 with `noindex`, and works whether
  maintenance is on or off. It has a language switch.

Every admin screen shows a notice under its head while maintenance is on, the way it shows an
unapplied migration, so the owner does not forget the site is closed. The Maintenance screen
itself does not draw that notice, because its own Status card already says the same thing and
updates as the owner switches. All copy is in `src/lib/admin-i18n.ts`, in Thai and English.

## Not in this design

| Left out | Worth adding when |
|---|---|
| Opening and closing on a schedule | an owner has a real, booked outage to run |
| A secret link that lets someone else see the real site | someone other than the owner has to check the work |
| A theme drawing its own maintenance page | a theme needs a look of its own; approach A leaves room for it |
| Hand-written HTML and CSS | ruled out by the first question |
| Purging a CDN when maintenance begins | the site is actually served through one |
| Collecting e-mail addresses to announce the reopening | TomeCMS can send mail |

## Verification

Every test is written before the code it covers, and every guard is checked by putting back the
bug it guards against.

**Unit** (`tests/unit/maintenance.test.ts`)

- The schema: lengths, trimming, Picture needs a picture, Countdown needs a time, an empty
  field falls back to the product's words in its language.
- The path sorter against every path named in "Which requests close", including
  `/api/v1/content/preview/*`, `openapi.json`, a configured admin path and `/admin` behind it.
- `Retry-After`: present for a time ahead, absent for one passed, absent for one equal to now.
- The page language from `/th/`, `/en/`, `/` and `/blog/...`.

**Integration**, each against a real PostgreSQL in a disposable stack

- The table's checks refuse Picture without a picture, Countdown without a time and an unknown
  template, including the `NULL` cases.
- A picture the maintenance page uses cannot be deleted, and the refusal names the page.
- Both admin routes are owner-only, refuse bad input with 400, and saving leaves
  `maintenance_enabled` as it was.

**Browser** (`tests/e2e/maintenance.spec.ts`, on its own compose stack)

1. The owner picks a template, writes both languages, saves, previews and turns maintenance on.
2. A visitor (a context with no session) opening `/th/` and a post gets 503 and the Thai heading;
   `/en/` gets the English one.
3. `/api/v1/content/posts` gets a 503 problem with `maintenance.heading`, while a `/media/...`
   request for a file id that does not exist still gets 404, not 503, and `/health/ready` still
   gets 200.
4. The owner sees the real site with the bar, and the admin shows its notice.
5. Turned off, the visitor gets 200 on the next request.
6. Countdown does not overflow at phone width.

Case 3 matters most: a maintenance mode that closed `/health/ready` would tell the deploy helper
and the updater that the application had failed, and they could roll back in the middle of the
owner's work. Case 5 holds the decision not to cache the switch: if `getSiteSettings()` ever
gains a cache, it fails.

Gates before each commit, run one after another and never beside the browser suite:
`npm run check`, `npm run test:unit`, and the browser spec.

## Risks

- **The gate runs on every public request.** While maintenance is off it adds one boolean read
  from a row already in hand. While it is on, a page or API request also reads the session. A
  public page did not read the session before; this is the cost of letting the owner through.
- **The owner may forget the site is closed.** The admin notice on every screen and the bar over
  every page are the answer; there is no automatic reopening by design.
- **A second thing called maintenance.** The updater's module keeps its name and purpose. The
  new code, its routes and its copy say "maintenance mode" or "site maintenance", never
  "update".
