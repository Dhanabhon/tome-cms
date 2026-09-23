# Home Slides

Date: 2026-09-23
Status: Design, for the owner's review before planning

The home page's hero can show the covers of the newest posts, and nothing else: the owner
cannot choose a picture, write a line over it, or send a reader anywhere but the post. This
design gives the hero its own slides, kept in the admin under their own menu, in the spirit of
WordPress's Smart Slider and at a small fraction of its size.

## What was decided before this was written

These three were put to the owner as questions and answered "go" without a choice, so each is
the recommendation made at the time. Any of them can still change here, before a plan exists.

- **Each language has its own slides**, the way each has its own menus. A Thai slide and an
  English slide are two slides. A slide with one set of words for two languages would show one
  of them the wrong language.
- **One hero, on the home page.** A slider as a block inside an article is a later design.
- **No resized copies of images yet.** The library keeps the file it was given, so a slide
  serves the original. This design warns about a heavy or narrow picture; making smaller
  copies with `srcset` is its own piece of work, recorded under "Not in this design".

## Why a menu of its own, and not a theme setting or a plugin

- **Not a theme setting.** A theme declares `choice`, `switch` and `text` settings. A list of
  slides, each with a picture, words and a link, is none of those, and it would belong to one
  theme: switching themes would throw every slide away.
- **Not a plugin.** The `publicPage` hook lets a plugin add a script and data attributes to a
  page, not HTML in a place the theme keeps for it. A slider built by a script after the page
  loads makes the page's largest paint wait for that script, and a plugin may not put an image
  on the screen by design. Making room for one would be a larger change than this feature.
- **A menu of its own, the way Navigation is one.** Navigation is already the pattern this
  needs: the core keeps the rows, per locale, behind its own admin screen; themes are handed
  them through the contract and decide how to draw them; the public API offers them to a
  headless site. Slides are content, not appearance, so the menu sits in the **Content** group
  after Navigation: **Home slides** / **สไลด์หน้าแรก**.

What they look like stays the theme's business. The words and pictures are the core's; how
fast they turn, and whether they slide or fade, are settings in the theme's Customize.

## A slide

A row in a new table, `home_slides`, created by migration `023_home_slides`:

| Field | Rule |
| --- | --- |
| `locale` | `th` or `en` |
| `position` | 0 to 9: at most ten slides per language, so next month's can wait beside this month's |
| `media_id` | An image from the library. Required. A document cannot be chosen. |
| `heading` | Optional, up to 80 characters |
| `body` | Optional, up to 200 characters |
| `button_label` | Optional, up to 30 characters. With a label there must be a link, and without one there must not. |
| `link_kind`, `page_id`, `url`, `new_tab` | The link a menu item has, with the same three kinds and the same checks: home, one of the site's pages, or a URL. Only a URL may open a new tab. |
| `align` | `start`, `center` or `end`: where the words sit |
| `overlay` | `none`, `soft` or `strong`: how much the picture is darkened under the words. `none` is refused when the slide has any words, so words never stand on a picture unaided. |
| `focus` | One of nine points, `top-start` to `bottom-end`: which part of the picture survives when a narrow screen crops it |
| `enabled` | On or off |
| `starts_at`, `ends_at` | Optional. When both are set, the end is after the start. |

The whole slide is not a link, only its button, so the words can be selected and a reader is
never sent somewhere by clicking a picture they meant to look at.

A button that leads to a post uses a URL, the post's address, as a menu item does. A post
that later changes its address still arrives, because the old address forwards to the new
one. A fourth link kind for posts would be the first place this design grows.

**Its text alternative.** A slide with a heading lets the heading speak for it, and the picture
is drawn with `alt=""`. A slide with no heading uses the library's alternative text, and cannot
be saved with a picture that has none. A slide with no heading whose picture later loses its
description in the library is not shown until the picture has one again, and the admin says why.

**Live** means enabled, started (or no start) and not ended (or no end), read at the moment the
page is drawn. The home page shows the first five live slides of its language, in order.

## The admin screen

- A tab for each language, as Navigation has.
- The list shows each slide's picture, its heading, and whether it is live, waiting for its
  start, ended, or off, in words and not only in colour.
- Order changes by dragging or with Move up and Move down, as the menu editor does, and the
  change is said aloud to a screen reader.
- A slide is added and edited in a drawer: the picture comes from the library's picker in its
  image mode, and the link from the same control the menu dialog uses.
- **Weight and width, said plainly.** Under the chosen picture the drawer gives its width and
  its size, and says so when it is heavier than 800 KB or narrower than 1600 pixels: heavy
  slows the home page, narrow looks soft on a wide screen. A warning, not a refusal.
- **View the saved slides on the site** opens the home page of the tab's language in a new tab. The theme preview draws only the owner's default language, and slides are per language.

A picture a slide uses cannot be deleted from the library. `findMediaReferences` gains a count
for slides, and the refusal names them, as it names the posts and pages a file is used in.

## What a theme is given

`ThemeHomeProps` gains `slides`: the live slides of the page's language, in order, at most
five, each already resolved for drawing:

```ts
type HomeSlideFocus =
  | 'top-start' | 'top' | 'top-end'
  | 'start' | 'center' | 'end'
  | 'bottom-start' | 'bottom' | 'bottom-end';

interface PublicHomeSlide {
  align: 'start' | 'center' | 'end';
  body: string | null;
  button: { href: string; label: string; newTab: boolean } | null;
  focus: HomeSlideFocus;
  heading: string | null;
  image: { alt: string; height: number; src: string; width: number };
  overlay: 'none' | 'soft' | 'strong';
}
```

The route loads them beside the posts; the theme preview does the same. A theme that draws no
hero ignores them, and `plain`, which draws none, does exactly that.

## How `paper` draws them

- The `hero` setting gains a fifth choice, **Your slides** / **สไลด์ที่จัดเอง**, beside text,
  moving text, covers and hidden. Covers stays: it is the hero that asks nothing of the owner.
- Three settings join it in Customize, all read only when the hero is slides: **Turn by
  itself** (a switch, on), **Every** (4, 6 or 8 seconds, 6), and **Move by** (slide or fade,
  slide).
- No live slide for the page's language: the hero falls back to text, as covers does when no
  post has one. One live slide: a still banner with no controls. Two or more: the slider.
- The slider is the one that exists, in `hero-slider.ts`: the carousel's ARIA roles and its
  "slide 2 of 4" labels, previous, next, and the pause button motion that turns by itself must
  have. A reader who asks for reduced motion gets no turning and no animation between slides.
- Every slide keeps the shapes the covers slider already has, 16:7 on a phone and 21:9 from
  48rem, and its picture is cropped with `object-fit: cover` around its focus point, so nothing
  moves when it loads. A slide with words may grow taller than that shape when its words need
  the room: at 16:7 a phone's band is about 160 pixels, and a heading, a line and a button do
  not fit in it.
- **Move by: fade** fades each slide in and out as the track moves, with a scroll-driven
  animation in CSS. Swiping still works, nothing blocks a click while it runs, and a browser
  without scroll-driven animations (Firefox, as this is written) simply slides.

**What loads first.** The first slide's picture is fetched at once and with high priority. The
others are hidden until they turn, so each is asked for lazily and with low priority, which the
current covers slider does not yet do: it gets the same fix.

## The public API

`GET /api/v1/content/slides?locale=th` returns the same `PublicHomeSlide` list the theme is
given, and its schema joins the OpenAPI document, generated from the zod schema as the
navigation's is. A headless site draws its own hero from it.

## What else the new table touches

- `src/server/db/reset-tables.ts`: `home_slides` is `truncate`. The file does not typecheck
  until the table is placed, which is its purpose.
- The backup: `pg_dump` takes the whole database with no table list, so the table's rows travel
  without a change, and the pictures travel as the library's objects already do. The restore
  check compares the four record counts a v1 manifest holds and cannot gain a fifth, so it does
  not count slides.
- Deleting a page a slide links to: the slide keeps its words and loses its button, and the
  admin list says the button's page is gone. A slide is never deleted because a page was.

## Not in this design

- Resized copies and `srcset`. A slide serves the file that was uploaded until the library
  makes smaller copies, which is its own design, because uploads go straight from the browser
  to the store and the server never holds the bytes to resize.
- Dots under the slider. Previous, next and pause stay the controls, as today.
- Layers, free placement of words, and animating each part of a slide.
- Video, parallax and slow zoom.
- More than one slider, or a slider inside an article.
- Different pictures for a phone and a wide screen: the focus point is the answer here.
- Templates, and slides built from posts automatically: covers already does that.

## Verification

- Unit: the slide schema (every rule in the table above, each with a slide that breaks it), the
  "live" rule at its edges (a slide that starts or ends this very second), the resolution of a
  link to an `href`, and the text alternative rule.
- Integration, on the disposable stack: the migration up and down, a picture that refuses to be
  deleted while a slide uses it, and the API's answer for each language.
- Browser: an owner adds a slide with a picture, words and a button, sees it on the home page in
  its language and not in the other, reorders two slides by keyboard, and is refused the delete
  of the picture. The home page's first slide picture carries `fetchpriority="high"` and the
  others `fetchpriority="low"` and `loading="lazy"`.
- Every guard added is checked by putting back the bug it guards against, and the existing
  covers slider's tests keep passing unchanged.

## Risks

- **A carousel is mostly its first slide.** Most readers do not wait for the second. The admin
  should make one slide feel like the normal case rather than a lesser one, which is why one
  live slide is drawn as a still banner.
- **Heavy pictures.** Until the library makes smaller copies, a 6 MB photograph is a 6 MB home
  page. The warning is the only guard, and it is advice.
- **Words over pictures.** The overlay rule stops words standing on a bare picture, but a pale
  picture under a soft overlay can still be hard to read. The drawer shows the picture alone, so
  an owner judges the words on it on the site, after saving; nothing measures the contrast
  automatically.
