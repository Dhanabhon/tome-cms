# TomeCMS Admin Modern UI Design

Date: 2026-09-17
Status: Awaiting owner review
Reference: the FlowAI dashboard screenshot the owner shared -- a light app background, white
rounded cards with hairline borders, a sidebar with line icons and count badges, a top bar with
the page name and a search field, tables with a soft header row, and tinted status pills.

## Context

The admin went through the Night Desk layout pass on 2026-09-16. Today it has:

- A 15rem sidebar of text-only links in two groups, with the site name and a view-site link at
  the top and the theme control and account at the bottom. No icons, no counts.
- No top bar on desktop. On phones, a bar with the site name and a menu button.
- Page heads with a 28-40px bold display title, a muted subtitle, and actions on the right.
- 48px controls (`--control-height: 3rem`) and 8px corners on inputs, buttons and cards.
- Status as a dot and a label, underline tabs with plain counts, Posts as cover cards, Pages as
  rows inside one panel, and both language editions grouped into one card or row.
- Navigation skeletons (`components/admin/AdminSkeleton.astro`) built from the same layout
  classes, so most geometry changes carry into them on their own.

`DESIGN.md` ("TomeCMS Paper 2026") is the locked design system. `scripts/check-design-tokens.mjs`
keeps its radius and spacing tables in sync with `src/styles/installer-tokens.css`, and
`tests/unit/theme-contrast.test.ts` pins every colour pair by the way it is used.

## Product Decisions

Settled with the owner, one question at a time:

- Every admin screen is restyled. There is no Dashboard page; Posts stays the admin home.
- The palette stays: warm paper, ink, and TomeCMS green, in both themes. What changes is shape,
  spacing, iconography and structure.
- The top bar searches posts by title. It submits to the Posts list's existing `q` filter, and
  the search field on the Posts page moves up into it.
- The work ships in layers -- tokens, shell, shared components, then each screen -- with
  screenshots, owner review and a commit after every layer.
- Language editions stay grouped: one card or one row per post or page, as today.

Out of scope: a Dashboard or stat cards, a command palette or search across pages and media,
a collapsible sidebar, relative dates ("2 hours ago"), the public site, and the installer.

## Visual Language

The changes apply inside the admin only. They are set as overrides on `.admin-body`, so the
public site and the installer, which share the root tokens, do not move.

| Token | Now | Admin value | Used for |
|---|---|---|---|
| `--radius-sm` | 6px | 8px | nav items, menu items, chips |
| `--radius-input` | 8px | 10px | buttons, inputs, selects |
| `--radius-card` | 8px | 14px | cards, panels, story cards, empty states |
| `--radius-lg` | 16px | 16px | dialogs (unchanged) |
| `--control-height` | 48px | 40px with a fine pointer, 44px with a coarse one | every admin control |
| Page title | 28-40px, 700 | 28px, 600 | `.admin-page__head h1`, `.media-toolbar h1` |

No shadows are added: surfaces stay flat, separated by hairline borders, as in the reference.
`DESIGN.md` gains an "Admin surface" subsection recording these overrides, the sidebar width and
the icon set. `check-design-tokens` does not cover the overrides, so they are documented rather
than machine-checked.

## Shell

### Sidebar (64rem and wider)

- Width 16rem, held in one custom property, `--admin-sidebar-width`, that the sidebar, the
  main column's offset and the navigation overlay's inset all read.
- From the top: the logo; the site row (site name and a view-site link); the "Content" group --
  Posts, Pages, Media, Navigation; the "Configuration" group -- Profile, Security, Settings,
  System (group names unchanged; they avoid repeating the Settings link); then, at the bottom,
  a theme row (label and the existing three-state toggle) and an account card (initial, email,
  sign out).
- Every link carries a line icon. Icons come from `components/admin/AdminIcon.astro`, which
  renders inline SVG (24px grid, 1.5px stroke, `currentColor`, `aria-hidden`). The paths are
  adapted from Lucide, whose ISC notice goes in the component. No dependency is added.
- The active link keeps today's colours (paper-2 background, focus-green text).
- Posts and Pages carry count badges: small pills in `--color-paper-3` with muted text. A count
  is the number of stories -- translation groups -- so it matches the "All" tab on each list.
  One query in the shell reads both counts: `count(distinct translation_group_id)` over posts and
  over pages for the owner. If it fails, the badges are left out and the error is logged; the
  shell always renders.

### Top bar

- A sticky bar at the top of the main column: 64px, paper background, hairline bottom border.
- On the left, the current page's icon and name, taken from the shell's `active` prop. A screen
  that lives under another link passes its own name in a new optional `title` prop --
  Categories is under Posts (`active="posts"`) and reads "Categories".
- On the right, a search form (`role="search"`, `GET`) to the Posts list with a `q` field
  ("Search posts…", magnifier icon). On the Posts page it shows the current query and carries
  the current status and language filters in hidden inputs.
- Then a "View site" button that opens the public site in a new tab.
- Below 64rem the phone bar becomes this top bar: menu button, page name, and a search icon that
  reveals the search field in a row beneath it.

### Navigation overlay

- The overlay starts below the top bar and beside the sidebar, both of which persist. When a
  navigation starts, the top bar's title switches to the destination's, read from the sidebar
  link with that URL; a destination with no sidebar link keeps the current title.
- The rail skeleton, drawn when leaving a page with no sidebar, takes the new width.
- The `posts` skeleton drops its search field, which has moved to the top bar.

## Shared Components

- **Buttons** (`.admin-button`): 40px, 10px corners. Primary stays green; secondary is paper with
  a hairline border; a new `--ghost` variant for low-emphasis actions. An icon can lead the label.
- **Inputs and selects** (`.admin-control`, `UiSelect`): 40px, 10px corners, a leading magnifier
  on search fields and a chevron on selects. Borders keep `--color-rule-strong` so a control's
  outline keeps its 3:1 contrast. Focus ring unchanged.
- **Cards and panels** (`.admin-card`, `.admin-story-panel`, story cards): paper surface,
  `--color-rule` hairline, 14px corners.
- **Status** (`.admin-status`): a pill with a dot. Published is a green tint (`--color-green`
  mixed into paper) with ink text; draft is `--color-paper-3` with muted text. The tint and both
  text pairs are added to the contrast test for both themes.
- **Tabs** (`.admin-post-tabs`): the underline stays; `.admin-tab-count` becomes a small pill.
- **Posts cards**: the cover leads, with the primary edition's status pill in its top-right
  corner; then the title, a line of edition chips with their status dots, and a footer with the
  date after a clock icon and the row menu.
- **Pages list**: the panel gains a header row from 48rem up -- Page, Status, Updated, and an
  actions column -- and each row keeps its grouped editions, now laid out on those columns.
  Below 48rem the header hides and rows stack as today.
- **Menus, dialogs, empty states**: the new corners; empty states gain an icon in a soft circle.

Media, Navigation, Categories and the form screens (Profile, Settings, Security, System) are
built from these pieces rather than styled one by one.

## Rollout

Each layer ends with screenshots, the owner's review and a commit before the next begins.

1. **Tokens.** The `.admin-body` overrides above, the page title, and `DESIGN.md`.
2. **Shell.** `AdminShell.astro`, `AdminIcon.astro`, the counts query, the top bar with post
   search, the phone bar, and the overlay and skeleton changes.
3. **Shared components.** Buttons, controls, cards and panels, status pills, tabs, menus,
   dialogs, empty states.
4. **Screens**, in order: Posts, Pages, Media, Navigation, Categories, Profile, Settings,
   Security, System, the editors and their drawer, Sign-in.

## Verification

At every layer:

- `npm run test:unit` and `npm run check`.
- `scripts/css-selector-diff.mjs` against the previous commit's build, so no rule disappears by
  accident.
- Screenshots at 1440, 768 and 375 wide, light and dark. Signed-in screens cannot be opened
  here -- sign-in needs the owner's passkey -- so they are checked on static copies built from
  the real markup and the built CSS, and the owner confirms them on their own machine.
- The navigation skeletons re-measured against the real layouts after layers 2 and 4.

New tests:

- Contrast pairs for the status tints and the count badge, in both themes.
- An integration test that the counts query counts stories, not editions.

## Risks

- `--control-height` feeds every admin form. Scoping it to `.admin-body` keeps the installer at
  48px; each form screen is checked in layer 4.
- A sticky top bar could collide with other sticky elements. The editors have no shell, so their
  own sticky bar is unaffected; Posts and Pages have no other sticky elements today.
- Moving the Posts search changes where the owner types a query. The query parameter and its
  results are unchanged, and the field stays visible on phones behind the search icon.
