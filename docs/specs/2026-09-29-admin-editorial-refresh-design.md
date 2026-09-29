# Admin Editorial Refresh

Date: 2026-09-29
Status: Design, for the owner's review before planning
Branch: work is based on `develop` (1.2.1 at the time of writing), as every feature is.

The admin was restyled on 2026-09-17 after a SaaS dashboard reference: white rounded cards
with hairline borders on a cream page, a white sidebar column, a top bar with the page name and
a search field, no shadows, everything the same weight. It is clean and calm, and it is flat:
nothing on a screen is larger or quieter than anything else, so a screen reads as a set of
equal boxes rather than as a page. This design keeps the palette, the fonts, the tokens, the
i18n and every product decision from that pass, and changes the *shape* of the admin so that
it reads the way the public themes and the editor already do — as an editorial surface, with
hierarchy from scale, rhythm from spacing, and rules and white space where there were boxes.

The editor canvas is out of scope. It is already the most editorial screen in the product.

## What was decided before this was written

Each of these was put to the owner as a question, most with a mockup, and chosen.

- **A visual refresh, not a restructure.** The screens, their routes, the sidebar's groups,
  the grouped language editions and Posts as the admin home all stay as they are.
- **Direction: stronger editorial.** Scale contrast from the display face, rules instead of
  boxes, numbers set as figures. Not denser, not more app-like, no new texture.
- **Every screen except the editor.** Shell, Posts, Pages, Categories, File Manager,
  Navigation, Home slides, Redirects, Stats, Profile, Security, Settings, Maintenance,
  Themes, Plugins, System — through the classes they already share.
- **Shell A: no top bar on a desktop.** The page head is the masthead. The sidebar sits on
  the page's own surface rather than in a white column. Phones keep a thin bar for the menu.
- **The admin search is removed**, from the shell and from the Posts page. It was a title
  filter over one list, placed in a bar that appeared on every screen, so it read as a search
  over everything and turned up on Settings with nothing to search. The `q` parameter and
  `filterAdminPosts` stay as they are on the server; only the field goes. If the list ever
  grows past what two screens of cards can hold, a quiet underlined filter returns to the tab
  row of the Posts page and nowhere else.
- **Form pages become two-column sheets** (section name left, fields right, sections
  separated by rules), collapsing to one column under 56rem. The save bar loses its box.
- **Empty states become one system with three tiers**, by situation rather than by screen.
  The first-run tier is a left-aligned editorial block with no icon.
- **Stats leads with a row of figures**, not tiles; charts, share lists and tables lose
  their boxes. Every number in the admin is set with tabular figures.
- **The public themes' search moves** onto the row the category pills already occupy, at the
  right, as a quiet field with the magnifier as its submit button. It is the last task and is
  kept separate from the admin work.
- **The 8px rule is applied to the admin's spacing**, by adding the missing 32px step and
  clearing the hand-written values, with the touch-target size recorded as the one exception.

## Visual language

Everything here is an override on `.admin-body`, which already restates the radii, the
control height and the title size for the admin. The public site and the installer share the
root tokens and do not move. `src/styles/installer-tokens.css` remains the only place a token
is declared; `DESIGN.md` gains rows under "Admin Surface" for each override and never states a
competing value; `scripts/check-design-tokens.mjs` keeps checking the root tables.

### Type

| Role | Face | Size | Weight | Notes |
|---|---|---|---|---|
| Page title (`.admin-page__head h1`) | display | `--text-2xl` (40px) | 700 | tracking -0.03em, line-height 1; was 28px/600 in the body face |
| Eyebrow (new `.admin-eyebrow`) | body | `--text-xs` minus one step (11px) | 600 | uppercase, tracking 0.12em, `--color-muted`. Above the title (the nav group's name), above a figure, and as a table's column heads |
| Sheet section title (`.admin-card__head h2`) | display | `--text-xl` (22px) | 700 | tracking -0.02em |
| Figure (`.stats-summary__value`) | display | `--text-3xl` (54px) | 700 | tracking -0.03em, `font-variant-numeric: tabular-nums`; a unit (`%`) at `--text-xl` beside it |
| Card and row title (`.admin-story-card` title, `.theme-card__name`, table title cell) | display | 17px | 700 | tracking -0.01em |
| Everything else | body | unchanged | | |

Thai is covered: Google Sans Thai 700 is self-hosted and already preloaded by `AdminLayout`,
so a Thai page title and a Thai figure set in the display face without a swap.

`font-variant-numeric: tabular-nums` is set once on `.admin-body` for counts, dates, sizes,
table cells and figures, and switched off (`normal`) inside `.editor-content` and the
`.admin-story-card` title, where running text should keep proportional figures.

### Spacing: the 8px rule

The root scale is 2 / 4 / 8 / 12 / 16 / 24 / 40 / 64 / 80. It has no 32, and `global.css`
writes `2rem` by hand fifteen times to get it. The admin gets the step by override:

| Token | Root | Admin | Used for |
|---|---|---|---|
| `--space-xl` | 2.5rem (40px) | **2rem (32px)** | page gutter, gap between sheet sections, gap under the page head on a desktop |

With it the admin's rhythm is 8 / 16 / 24 / 32 / 64 / 80, and 12 (`--space-sm`) is the one
half-step, reserved for small horizontal gaps (icon to label, chip to chip). Vertical
measures lock to the grid:

- line-heights 16 / 20 / 24 (`--text-xs`, `--text-sm`, `--text-base`)
- control height 40 (`--control-height`); a table or list row 48; a nav link 40
- page head to content 24; between sheet sections 32; sidebar group heading above its links 24
- the phone bar 56 (was 64: it holds only a 40px button and a title)

The hand-written `2rem` values become `var(--space-xl)`; `1.75rem` (×4), `3.25rem` (×3),
`1.125rem` and `0.15rem` are each replaced with the nearest token or a documented reason.

Recorded exceptions, in `DESIGN.md`: **44px** for `--control-height` under `pointer: coarse`
(the touch target, not a spacing step); **2px** for outlines and the active bar; **1px**
hairlines.

### Surfaces and shape

- The page is `--color-paper-2`, as now. Panels that hold a form keep `--color-paper`
  *behind their fields only where a field needs it* — the sheet itself has no fill and no
  border. What separates one thing from the next is a hairline rule or 32px of space.
- Cards remain where the content is a card: a post with its cover, a file, a theme's preview,
  a plugin. Their corners go from 14px to **8px** (`--radius-card` becomes `--radius-input`
  on the admin body), and their border stays a hairline.
- Buttons and inputs keep 10px corners (`--radius-input`), except the primary button, which
  takes 8px so that it sits square with the card corner it usually stands beside.
- No shadows are added. `--shadow-float` stays for menus and dialogs, which float.
- Selected and active states come from ink and the accent, never from a surface fill:
  the palette's surfaces sit 1.07–1.34 apart and cannot carry state
  (`tests/unit/theme-contrast.test.ts` pins the pairs that work).

## Shell

`src/components/admin/AdminShell.astro`, and the rules from `.admin-shell` to
`.admin-shell-account` and `.admin-topbar` in `global.css`.

### Sidebar, 64rem and wider

- Same width (`--admin-sidebar-width`, 16rem), on the page surface: no `--color-paper` fill,
  no right border. The left gutter is 24px, the right 16px.
- From the top: the logo (unchanged); then the **site line** — the site name at `--text-sm`
  600 with the view-site link's icon at its right end, closed underneath by a hairline rule.
  The rounded `.admin-shell-site` pill goes.
- Group headings (`.admin-nav-group`) become eyebrows: uppercase, tracked, muted, 24px above
  their first link, 32px below the previous group.
- A link is its icon, its label and its count, 40px tall, 8px corners, muted text. **The
  active link** is ink text, its icon at full strength, and a **2px accent bar** on the left
  edge of the sidebar gutter, running the link's height minus 8px top and bottom. No fill.
  The count stays a plain tabular number, not a pill, in the muted colour; on the active link
  it takes the ink.
- The `<details>` sections (Settings, Appearance) keep their behaviour and take the same look;
  their children indent to the icon column's centre as now.
- The account block at the foot loses its bordered card: a rule above, then the theme row,
  then the avatar, email and sign-out button in one row. The avatar keeps its circle.

### No desktop top bar

`.admin-topbar` is not rendered from 64rem up. What it held goes where it belongs: the page
name is the `h1`; the view-site link is on the site line; the search is gone. The main column
starts with `.admin-page` at a 32px top gutter.

### Phones and tablets, under 64rem

The bar stays, 56px tall, on the page surface with a hairline below: the menu button, the
screen's name in the body face at `--text-base` 600, and nothing else. The mobile navigation
dialog takes the same sidebar rules as the desktop one (it already renders from the same
markup). The search toggle and its script go.

### Migration and maintenance notices

Unchanged in behaviour. They lose their rounded box and take a left accent bar (migrations:
`--color-error`; maintenance: `--color-accent`) with a hairline below, at the top of the main
column above the page head.

### Footer

One line, `--text-xs`, muted, a hairline above, 32px of space above that: thanks on the left
and the maker and version on the right, as now.

### Skeleton

`src/components/admin/AdminSkeleton.astro` builds each kind from the same layout classes, so
most of this carries over on its own. Its `form` kind is re-drawn as a two-column sheet
(a short block left, three field bars right), and its head takes the eyebrow line. A page
that skeletons in the old shape and then snaps to the new one is a regression this design
counts as a bug.

## Page head

`.admin-page__head` on every screen, drawn by each page's Astro file.

```
CONTENT                                   [Manage categories] [New post +]
Posts
Draft, publish, and keep your writing in one place.
────────────────────────────────────────────────────────────────────────
```

- The eyebrow is the nav group's label (`copy.nav.groupContent` or `groupConfig`), passed to
  the head by the page, so no new copy is needed. A screen under a section (Categories under
  Posts, General under Settings) shows the section's name instead.
- The title is the display face at 40px. The subtitle keeps its 55ch measure and muted colour,
  12px below.
- Actions align to the title's baseline on the right. The secondary action is the ghost
  button; the primary keeps its fill.
- A hairline closes the head, 24px below the subtitle, with 24px to whatever follows. On a
  screen that begins with tabs, the tab row sits on that rule (the rule is the tabs' own).
- Under 48rem the actions drop below the subtitle and fill the row, as now.

### Tabs and filters

One rule set for the admin's tabs (Posts, Pages, Settings' General/Maintenance, the media
library's types). A tab is body text at `--text-sm` 500, muted; the active tab is ink with a
**2px accent underline** on the row's rule. Counts stay in the tab, tabular, as text, not
pills. The Posts page's language filter moves onto the tab row's right end as an underlined
select that submits on change; the separate "Apply filters" button and its "Language" label
above go (the select keeps a visually hidden label). The form remains a GET to the same URL.

## Sheets: the form pages

Settings, Maintenance, Profile, Security, System and the plugin and theme settings drawers all
draw with `.admin-card-stack` and `.admin-card`, so this is one change.

```
Site identity                          Site name
The name and description a reader      [Quiet Notes                ]
meets first, and search engines quote.
                                       Tagline
                                       [A short line about your site]
────────────────────────────────────────────────────────────────────────
Logo and icon                          Logo
What a reader sees before anything     SVG, or PNG at least 80 pixels tall.
else.                                  [Choose a file]
```

- `.admin-card` becomes a two-column grid from 56rem: a 16rem column for `.admin-card__head`
  (title in the display face, description below in muted `--text-sm`) and a fields column
  capped at 34rem. Columns are 48px apart. Below 56rem the head sits above the fields.
- No fill, no border, no radius. 32px of padding above and below, and a hairline rule between
  consecutive sheets (the stack draws it with `.admin-card + .admin-card`), none after the last.
- Fields inside keep their current controls, labels, hints and errors. The field-to-field gap
  is 20px (`--text-sm` line plus 4), field groups 32px.
- `.admin-card--note` (the dashed "note among cards") becomes a paragraph in the muted colour
  with an accent bar on its left, no dashes.
- **The save bar** (`.admin-save-bar`) loses its box. It is a row at the page's bottom edge,
  sticky as now, on `--color-paper-2` at 94% with a 12px blur so the page shows through when
  it floats, a hairline above, right-aligned: the save state (`copy.settings.saved` /
  `copy.settings.unsaved`, which already exist) in muted `--text-sm`, then the primary button.
  Its bottom inset is 0; the padding is 16px.
- Settings gains a tab row under its head — **General** and **Maintenance** — linking to the
  two screens the sidebar section already lists. The sidebar keeps the section; the tabs are
  the same two links a second way, so a reader on one screen can see the other exists. No new
  copy: the labels are `copy.nav.general` and `copy.nav.maintenance`.

Security's sign-in form (shown by the same shell to a signed-out owner) is not a sheet: it
keeps its own `.admin-auth` rules and is out of scope.

## Buttons, chips and status

- `.admin-button` unchanged in size (40 / 44). Primary takes 8px corners. Ghost is the default
  secondary action in a page head; the bordered `--secondary` stays for actions inside content.
- The status pill (`.admin-status`) keeps its dot and label. Its background goes: it is the
  dot in the state's colour and the label in `--color-ink-2`, which is what makes it legible
  on a card and on a table row alike. Scheduled and Draft keep their outline dot.
- Category chips keep the pill shape they share with the public feed.
- The count badge (`.admin-nav-count`, `.admin-tab-count`) is text, tabular, no pill.

## Empty states

Three tiers, by situation. Every present variant maps to one of them and the classes that do
not survive are removed: `.admin-empty-inline`, `.redirect-empty`, `.navigation-empty`,
`.media-empty`, `.stats-empty`, and the dashed border on `.admin-card--note`.

### Tier 1 — nothing exists yet (`.admin-empty`)

For a screen whose list is empty because nothing has been made: Posts, Pages, File Manager,
Navigation (a menu with no items), Home slides (a language with no slides), Stats (nobody
counted yet).

```
────────────────────────────────────────
NOTHING HERE YET
Your first post starts here
Create a draft now and publish whenever it is ready.
[Create your first post]
────────────────────────────────────────
```

Left-aligned in the content column, 48px above and 56px below, a hairline above and below,
capped at 36rem. An eyebrow (new copy, `empty.eyebrow`), the title in the display face at
28px, one sentence in the muted colour, and one primary button. **No icon**: `.admin-empty__mark`
goes. Stats' tier 1 has no button (there is nothing to press; its body explains why the
owner's own browser is not counted) and keeps its existing heading and body copy.

### Tier 2 — something exists, the filter finds nothing (`.admin-empty--filtered`)

For a tab or filter that yields nothing while the list has items: an empty Drafts tab, a
language with no editions. One line, 24px above and below, muted, with the way back beside it:

```
No drafts right now.  Show all posts
```

Posts and Pages already choose different copy for this case (`noMatchTitle` / `noMatchBody`);
they now also choose this shape. The link goes to the list with the filter cleared. New copy:
`posts.noMatchLink`, `pages.noMatchLink` ("Show all posts", "Show all pages").

### Tier 3 — a section of a form is empty (`.admin-empty--inline`)

For Profile's author links, Redirects' list and Navigation's items inside the manager. One
muted line inside the sheet's field column
with an inline link or button that adds the first item: `No links yet. Add a link`. No box, no
dashes, 12px of padding. Where the screen already has an add control beside the list, the line
names it rather than duplicating it ("No old addresses yet …" keeps its explanatory sentence).

## Stats and tables

### Figures (`.stats-summary`)

The three tiles become a row of figures: a grid of three, a hairline above and below the row,
a vertical hairline between figures, 24px of padding. Each figure is an eyebrow (Views, Reads,
Read ratio), the value at 54px display with tabular figures, and the change line below at
`--text-sm` with the change itself in `--color-link` 600 and the comparison in muted text.
Under 40rem the three stack, with the rule between them horizontal.

### Chart, shares, articles

`.stats-panel` loses its border, radius and fill. A panel is a title in the display face at
20px, its legend or note under it, and the content, with 40px between panels. The share
lists (`.stats-shares`) keep their proportional bar but draw it as a 2px accent line under
the label at 50% opacity instead of a filled paper-3 background behind it, with the count
right-aligned and tabular. The articles table follows the table rules below.

### Tables (`.stats-table`, `.admin-page-list`)

- Column heads are eyebrows, on a hairline, 12px of padding.
- Rows are 48px minimum, separated by hairlines, no zebra, no outer box.
- The title cell is the display face at 17px; a page's path under it stays monospace at
  `--text-xs`.
- Numeric columns are right-aligned with tabular figures; a date column is left-aligned.
- The row menu (`…`) stays at the row's right end.

## Lists that stay cards

Posts (`.admin-story-card`), File Manager (`.media-card`), Themes (`.theme-card`) and
Plugins (`.plugin-card`) keep their cards: each has a picture or a preview that a card
frames well. What changes: 8px corners; the title in the display face; the meta line in
tabular figures with the date written once (`Sep 24, 2026 · 18:36`, the timezone shown once
in the page head's subtitle rather than on every card — the copy key `row.timezoneNote`
carries it); the status without its pill background. The in-use theme keeps its accent ring.

The media library's toolbar (search field, upload button, type chips, folder chips) stays as
built on 2026-09-28, with the type chips taking the tab rule set and the folder chips staying
pills.

## Per-screen notes

| Screen | Beyond the shared rules |
|---|---|
| Posts | tab row with the language select at its right; tier 1 and tier 2 empties; no filter form below the tabs |
| Pages | table rules; tier 2 empty for an empty tab |
| Categories | eyebrow "Posts"; the manager's list takes table rules |
| File Manager | tier 1 empty; file cards 8px |
| Navigation | tier 1 for an empty menu; the item rows take table rules with their drag handles |
| Home slides | tier 1 per language; slide cards 8px |
| Redirects | table rules; tier 3 empty with its explanatory sentence |
| Stats | figures, panels and table as above |
| Profile | sheets; tier 3 for author links; the avatar field keeps its round preview |
| Security | sheets; the passkey list takes table rules; the sign-in form is untouched |
| Settings | sheets; General / Maintenance tabs; logo previews keep their sample surfaces |
| Maintenance | sheets; the same tabs, Maintenance active; the status card becomes the first sheet |
| Themes | 8px cards; the in-use ring; the "source" note becomes a tier-3 style paragraph |
| Plugins | 8px cards; the settings drawer's form takes the sheet rules in one column |
| System | sheets; the release row and the step list keep their structure |

## The public themes' search

Separate from the admin, done last, in `src/themes/paper/Home.astro`, `paper/theme.css`,
`plain/Home.astro` and `plain/theme.css`.

- The form moves into the row with the category pills: pills on the left, the field on the
  right, `justify-content: space-between`, wrapping under 40rem so that the field takes the
  full width above the pills. With no categories the field stands alone on the right.
- The field is a pill outline 40px tall and 15rem wide, growing to 20rem on focus, with the
  magnifier as a **round submit button inside its right end** (`<button type="submit">` with
  the accessible name "Search", so `tests/e2e/home-search.spec.ts`'s click on the button
  named Search still finds it). The filled green "Search" button goes.
- The results line, the empty state, `noindex` on a results page, the hidden hero on Paper and
  the cursor links carry the query exactly as now. The spec's assertion that "the box is above
  the list, in the page" still holds: the row is above the feed.
- Plain does the same on its own filter row, in its own plainer style.

## Copy

New keys in `src/lib/admin-i18n.ts`, in both locales, checked by `tests/unit/admin-i18n.test.ts`:

| Key | English | Thai |
|---|---|---|
| `empty.eyebrow` | Nothing here yet | ยังไม่มีอะไรตรงนี้ |
| `posts.noMatchLink` | Show all posts | ดูบทความทั้งหมด |
| `pages.noMatchLink` | Show all pages | ดูเพจทั้งหมด |
| `profile.linksAdd` | Add a link | เพิ่มลิงก์ |
| `row.timezoneNote` | Times are shown in {timezone}. | เวลาแสดงตามเขตเวลา {timezone} |

Removed: `shell.searchLabel`, `shell.searchPlaceholder` and `filters.apply`. `filters.language`
stays as the language select's visually hidden label. The public copy for the theme search is
unchanged.

## Testing

- **Contrast.** `tests/unit/theme-contrast.test.ts` gains the pairs this design leans on:
  `color-accent` on `color-paper-2` at 3:1 (the active bar and tab underline, a mark), the
  eyebrow's `color-muted` on `color-paper-2` at 4.5 (already there), `color-link` on
  `color-paper-2` at 4.5 (the change figure), and `color-ink-2` on `color-paper` and
  `color-paper-2` at 4.5 (the status label without its pill). Both themes.
- **Tokens.** `node scripts/check-design-tokens.mjs` passes; the admin overrides are
  documented in `DESIGN.md` under "Admin Surface", as the 2026-09-17 ones are.
- **Selectors.** `npm run css:snapshot` before the first layer and `npm run css:diff` after
  each, so a rule that vanishes is seen; the classes this design removes are listed above and
  are the only expected removals.
- **Screens.** A scratch Playwright spec (the pattern in `tests/e2e/select-in-dialog.spec.ts`:
  own stack, seeded owner, real sign-in) shoots the fifteen screens at 1440, 768 and 375, light
  and dark, before the work and after every layer. The owner reviews the pairs; a layer is done
  when they say so. Reduced motion is emulated once for the sheet's sticky save bar.
- **Existing tests.** `npm run test:unit`, `npm run check`, and the full e2e suite pass at the
  end of every layer; `home-search.spec.ts` after the theme task; `editor-blocks.spec.ts` and
  `overlay-motion.spec.ts` are the ones most likely to notice a shell change.
- **Measured, not eyeballed.** Where a state or a rhythm is claimed (the active bar's inset,
  the 48px row, the sheet's 34rem cap), the scratch spec reads `getBoundingClientRect` and
  asserts it, so a screenshot cannot hide a 1px drift.

## Order of work

Each layer ends with screenshots, the owner's review and a commit on a branch from `develop`.

1. **Tokens and rhythm** — the `.admin-body` overrides, tabular figures, the `2rem` sweep,
   `DESIGN.md` rows.
2. **Shell** — sidebar, no desktop top bar, phone bar, notices, footer, skeleton, search
   removal.
3. **Page head, tabs, sheets, buttons, save bar** — the shared rules every screen draws.
4. **Empty states** — the three tiers and the copy.
5. **Stats and tables** — figures, panels, shares, the table rules.
6. **Per-screen sweep** — the fifteen screens against the table above, one commit each where
   a screen needs its own change.
7. **Theme search** — Paper and Plain.

## Out of scope

The editor (canvas, bars, drawers, block menu), the installer, the sign-in form, the public
site beyond the search field's position, a dashboard, a command palette, a collapsible
sidebar, relative dates, and any change to what a screen does.

## Risks

- **The desktop top bar was sticky**, which kept the search a reach away on a long list. With
  the search gone nothing in it needed to stick. If a long list turns out to want a way back
  up, the answer is the browser's, not a bar.
- **Removing fills makes the dark theme carry more on rules.** `--color-rule` in dark is ink
  at 14%; the screenshots at each layer are what will show whether a sheet boundary still
  reads. If it does not, the rule steps to `--color-rule-strong` for sheets only.
- **Two-column sheets change how a form reads on a tablet.** The 56rem collapse is chosen so
  that a 768px tablet gets one column; the 1024px one gets two with a 34rem field column.
- **The theme search's e2e spec** names the box by its accessible name and the button by
  "Search"; both survive the move, and the spec runs before the task is called done.
