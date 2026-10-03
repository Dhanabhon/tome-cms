# The design release (1.14.0)

Date: 2026-10-04
Status: Design. The owner approved it section by section on 2026-10-04. It ships as 1.14.0.

## Why

A `hallmark audit` of the three public themes and the admin on 1.12.0 found 4 critical, 41 major and
43 minor issues. 1.12.1 fixed the bugs (group A) and the Thai type (group B). This release does the
rest:
- **Group C** is quality: measure, touch targets, states, hierarchy, and admin drift from DESIGN.md.
- **Group D** is taste. The owner ruled on each point.

**The reports** are kept locally, git-ignored, at
`.worktrees/develop/.superpowers/hallmark-audit/{paper,almanac,plain,admin}.md`, with file:line for
each finding. Where this spec names a finding as "paper #7", it means item 7 of `paper.md`. This spec
is the authority; the reports are evidence.

**Owner rulings (group D):**
- **D1:** keep Paper's and Almanac's home layout as it is: hero, category pills, then the card grid.
- **D2:** Paper moves to a cream page with hairline rules instead of rounded bordered cards, and uses
  **Google Sans only**, with no IBM Plex Sans Thai.
- **D3:** Almanac's coverless cards show a category tone band with the category's name, instead of a
  letter in a circle.
- **D4:** Plain uses **Google Sans in every language**, instead of the system font.

**Not in scope:**
- new features;
- a theme's structure: no new home layout;
- the theme contract beyond the font preload field;
- changes to `/api/v1`;
- a migration;
- the updater (it stays 1.6.0).

## Common rules

- **Tokens.** Every colour, size and font goes through a token. A new token goes into
  `src/styles/installer-tokens.css` (core) or the theme's own token block, and core tokens get a
  matching DESIGN.md line. No raw colours: `tome check` rule 7 and the token tests enforce this.
- **Hover** styles sit inside `@media (hover: hover)`, so a tap never leaves a stuck hover.
- **Pressed state.** Every pressed control has an `:active` state: one step darker, or
  `translate: 0 1px`.
- **Touch targets** are at least 44 × 44 CSS px under `@media (pointer: coarse)`, using the theme's
  existing field-height token where one exists.
- **Motion.** Animate only `transform` and `opacity`; never use bounce or overshoot easing on a state
  change; honour `prefers-reduced-motion`.
- **Thai.** No letter-spacing or uppercase on Thai text; heading leading at least 1.2; no italics as
  emphasis.
- **Widths:** nothing scrolls sideways at 320, 375, 768 or 1440 px, in light or dark.
- **Prose measure:** about 65–75 characters a line. Set it in `rem` or `em`, not `ch` (`ch` measures
  Thai badly), and check it by counting characters in a screenshot.

## 1. Paper

**Surface (D2):**
- **The page.** The page background is `--color-paper-2`, the cream every theme's `html` already
  has. Paper no longer repaints `html` and `body` white (theme.css about 29–30). Raised surfaces
  (inputs, the search field) may stay `--color-paper`.
- **Dark mode.** Text uses a Paper-scoped tinted ink token (about `oklch(96% 0.008 140)`), not pure
  white.
- **Fonts.** Display and body are both Google Sans, Latin and Thai, through Paper's own font tokens.
  `public/fonts.css` gains Google Sans 500 (Latin and Thai), added by `scripts/sync-fonts.mjs` the way
  the others are.
- **Cards** have no border and no radius. Each card carries one hairline above it
  (`--rule-hair` / `--color-rule`), and covers and body images are square-cornered.
- **Card hover** is one effect only: the title takes `--color-link`. The image zoom and the border
  change go.
- **The coverless card.** It no longer repeats a huge letter (paper #18). It shows a flat band in a
  Paper surface token, with the category name in Google Sans 500, at the same aspect ratio as a
  cover, so rows stay even.

**Home and category views:**
- **h1.** When the hero band is not the text band, there is an `sr-only` `<h1>` with the site name
  (paper #6).
- **Category and search.** A chosen category is treated like a search: no slider or slide band.
  A visible `h2` names the category, or the search phrase, above the grid (paper #6).
- **Slide words** reach 4.5:1 against their image wherever they sit. Either the scrim follows the
  words when they are centred, or the slide body uses `--color-on-dark` (paper #5). They also align
  with the site's content edge, the wordmark's x, not their own 48rem column (paper #11).
- **The hero's padding** is larger at the bottom than at the top: bottom at least 1.3× top
  (paper #17).
- **An empty category** offers an "All posts" link (paper #21).
- **At 768 px,** the search no longer sits alone at the right with an empty left half (paper #20).

**Posts:**
- **Measure.** The prose blocks (`p`, lists, blockquote, h2, h3) cap at about 38rem (paper #4).
  Covers and code blocks may stay wider.
- **Side stripes go** from the blockquote and the load-error notice (paper #16). The blockquote
  becomes a hairline or an indent, and the notice a hairline box, or an icon inline with the text.

**Phone and chrome:**
- **The language control** shows its code, "EN" or "TH", below 40rem, so the brand is no longer cut
  off. On desktop it uses the nav's type size (paper #7).
- **The Menu summary** has no native ▸ marker, and uses the submenu's chevron icon (paper #7).
- **Pills, the search submit, the slider steps, the slide button and footer links** meet the touch
  rule and get `:active` (paper #14, #15).
- **The footer's rule** spans the same edge as the header's: the rule moves to the full-width
  element, and an inner wrapper holds the max width (paper #12).

## 2. Almanac

**The coverless card (D3):**
- The letter circle is replaced by a band in the category's tone (the existing `tone.ts` hash and
  colour tokens), carrying the category's name in Trirong.
- The band is about 3:1, shorter than today's 16:9.
- Cards in a row stay the same height.
- A post with no real category shows the default category's name.

**Cards:**
- Hover is one effect only: the title takes `--color-link`.
- There is no shadow and no lift (almanac #6).

**Home and category views:**
- A chosen category hides the hero, as a search already does (almanac #17).
- With no headline set, the hero's `h1` is the tagline, not the site name repeated (almanac #18).
- The hero padding is larger at the bottom (almanac #19).
- An empty category offers "All posts", and a load error offers "Try again", which links to the same
  URL (almanac #16).

**Posts:**
- **Measure:** about 36em (almanac #3).
- **The title on a phone** is clearly larger than a body h2. Raise the article title's floor, or
  lower the prose h2 below 40rem (almanac #4).
- **`em`** in prose gets `font-weight: 500`, not an italic (almanac #15).
- **The meta separator** "·" travels with the following item, so it never ends a line (almanac #11).

**Phone and chrome:**
- **Hero buttons and "More in {category}"** never wrap to two lines. They stay on one line and end in
  an ellipsis when too long (almanac #7).
- **Footer links, the site-name and TomeCMS links, "Clear search" and the article category pill**
  meet the touch rule (almanac #8).
- **The Menu summary** has no native marker, and uses the submenu's chevron icon (almanac #10).
- **The footer's language control** inherits the footer's size and weight (almanac #12).
- **Every hover** sits in `(hover: hover)`, and **buttons, pills and the search submit** get `:active`
  (almanac #13).
- **The shell** uses `min-height: 100svh` (almanac #20).

## 3. Plain

**Font (D4):**
- Plain's font token is Google Sans, Latin and Thai, through a token rather than a `font-family`
  literal (plain #9).
- Plain stays white, but its overscroll shows white, not cream: set
  `html:has(> body.plain) { background: var(--color-paper) }` or an equivalent (plain #24).

**Category row:**
- Below 64rem, the category tabs are one row that scrolls sideways, with no visible scrollbar, and
  the active tab's 2px bar sits on the rule (plain #5).
- The rule runs under the tabs, not under the search.

**Home:**
- There is an `sr-only` `<h1>` with the site name (plain #8).
- **Pagination.** "More posts →" goes to the next page, using `copy.morePosts`, and "Newer" goes back
  when a cursor is set (plain #6).
- **Empty states** (plain #7):
  - no posts at all gives `copy.noPosts`;
  - an empty category gives `copy.noPostsInCategory`;
  - a load failure gives `copy.postsUnavailable`, shown above the grid.
  
  Each is styled like the existing no-results line.
- **During a search,** "All posts" is not marked `aria-current` (plain #21).

**Posts:**
- **Measure:** prose blocks cap at about 68 characters, set in rem (plain #3).
- **The cover image** has `margin-block-end` before the first paragraph (plain #4). Its `alt` is
  empty, or the stored cover alt, so it does not repeat the title (plain #22).
- **The code block** in Plain has hairlines above and below only, with no box, radius or side
  borders, and its language label uses the page font (plain #15). Also fix the stale "for both
  themes" comment in `code.css`.
- **`text-wrap: balance`** on the lead, the article h1 and the grid titles (plain #23).

**Touch and chrome:**
- **Nav links, footer links and the back link** meet the touch rule (plain #13).
- **Hover** sits in `(hover: hover)` (plain #20).
- **The theme toggle** in Plain's header is quiet: no border, sized to the field token, with the
  hover fill only (plain #17).
- **Type sizes** use the scale tokens; a lead size token is added if needed (plain #18).
- **The shell** uses `min-height: 100svh` (plain #19).

## 4. Shared

**The missing and unavailable page** (`src/pages/[locale]/[slug].astro`,
`src/pages/[locale]/blog/[slug].astro`, `src/pages/blog/[slug].astro`):
- The block is left-aligned on the theme's content edge, not centred.
- The "404" or "Unavailable" line is plain, muted text, with no uppercase and no tracking.
- The title uses the theme's display token and the article-title scale, not `.notice-title`'s fixed
  Google Sans 400 at 40px.
- The link back sits on its own line, under the title.
- It stays a core page, styled from theme tokens. The theme contract does not change for it, so a
  theme made by `tome theme new` gets it for free.

**Font preload, per theme:**
- The theme manifest gains an optional `preloadFonts: string[]`, a list of `/fonts/<file>.woff2`
  paths. `BaseLayout.astro` preloads exactly that list, and drops its own fixed list.
- **The values:**
  - Paper: Google Sans Latin and Thai, 400 and 700.
  - Plain: Google Sans Latin and Thai, 400.
  - Almanac: Trirong Latin and Thai, 600, plus IBM Plex Sans Thai Latin and Thai, 400.

  Use the files' real names under `public/fonts/` and `src/themes/almanac/fonts.css`.
- **`tome check`** gains a rule: every `preloadFonts` path exists under `public/`.
- **`tome theme new`** copies the field with the theme, unchanged.
- **The contract and the docs** say that a theme with no `preloadFonts` preloads nothing.

**The language switcher** (`src/components/LanguageSwitcher.astro`) inherits the font size and weight
of the place it sits in. The code-only label below 40rem is Paper's choice, made in Paper's CSS.

## 5. Admin (back to DESIGN.md)

**One primary action per screen** (admin #4):
- **An empty Posts or Pages list** hides the page head's "New post" / "New page", leaving the single
  primary in the empty block.
- **Navigation:** "Add item" becomes secondary.
- **Themes:** "Use this theme" becomes secondary.

**Selected state from ink and accent, never from a surface fill** (admin #6):
- The editor's current language tab uses ink, weight 600 and a 2px accent underline. Its paper-3
  fill is for hover only.
- The pressed media view switch, the in-use theme card's foot and the "on" plugin mark lose their
  fills.

**Side stripes** (admin #5): the Themes and Plugins notes, and the migrations banner, become muted
text under a hairline (`border-block-start`). On Themes, the note moves out of `.theme-grid`.

**Controls:**
- **UiSelect.** The menu gets `--shadow-float`, and the chosen option's check comes from
  `src/lib/icons.ts`, not a `✓` character (admin #8).
- **Field error slots** keep their reserved line: no `:empty { display: none }` on field-level slots.
  Form-level banners may still collapse (admin #9).
- **Hover rules** move into the existing `(hover: hover) and (pointer: fine)` block (admin #13).
- **Faint hover fills** use `--color-paper-3` plus ink text (admin #14).
- **Glyphs that stand in for icons** become icons from `src/lib/icons.ts`: the editor bar's `←` and
  `✓`, and Stats' native `▶` marker (admin #16).
- **Overlays:**
  - Movement uses `--ease-out`, not `--ease-spring` (admin #17).
  - The post settings drawer's first focus goes to the first field (admin #18).
  - Every overlay title follows one rule: display face, `--text-xl`, 700, line-height 1.2
    (admin #18).
  - Inside the admin, dialog inputs and buttons use `.admin-control` / `.admin-button`;
    `.ui-dialog__*` stays for the installer (admin #19).

**Stats** (admin #10, #11):
- **Language** becomes a `UiSelect` at the end of the filter row, as on Posts.
- **Period labels** read `7d`, `30d`, `90d` and `12m`, with the full names in `aria-label`, and never
  wrap.
- **A period with no counts** shows the masthead, the filters and one empty block. There are no
  repeated per-panel empties and no blank chart.

**Small:**
- **System:** "Checking for updates…" uses a real ellipsis, and appears once (admin #20).
- **Navigation:** with no change, the save row is hidden (or says "No changes"), instead of showing a
  disabled faded primary (admin #22).
- **Form pages:** the footer has the page column's max width and centring (admin #21).
- **Token bypasses** move to tokens (admin #15): the mono font, off-scale sizes, the primary
  button's radius, and literal `44px` minimums.
- **The media picker** uses `width: 100%`, not `100vw` (admin #23).

## 6. Verification

- **The theme-shots instrument.** Commit `tests/e2e/theme-shots.spec.ts`. It skips unless
  `THEME_SHOTS=<label>` is set, as `admin-shots.spec.ts` does.
  - **It stands up its own stack, and seeds:**
    - 10 posts across 4 categories (th and en), with and without covers;
    - a post with every block kind;
    - a Thai slug;
    - an empty category;
    - a page;
    - a header menu with a sub-menu;
    - Paper's slides.
  - **It shoots, per theme:** home, post, a post with a cover, page, category, search, 404 and an
    empty category, at 320 / 375 / 768 / 1440, light and dark.
  - **It writes** to `.superpowers/theme-shots/<label>/<theme>/`, never `test-results/`.
- **Before and after.** Take a `before` set (admin and themes) from develop, before any change, and an
  `after` set at the end. The owner sees a short visual summary of the changed screens before the
  release.
- **Regression tests:**
  - **Unit**, CSS-parsing like 1.12.1's:
    - the measure caps;
    - hover inside `(hover: hover)`;
    - no surface fill for a selected state in the admin;
    - Paper's page is `--color-paper-2`;
    - the fonts per theme;
    - `preloadFonts` exists and the `tome check` rule works.
  - **e2e:**
    - a category view hides the hero and names the category;
    - Stats has a language select;
    - one primary per admin screen, from the shots' measurements, or a DOM count;
    - the empty states in Plain.
- **A hallmark re-audit** of the three themes and the admin on the "after" set, compared with the
  first audit's counts. Any new Important finding is fixed before the release.

## Release

- 1.14.0, with no migration and the updater unchanged.
- The release notes have a "For theme authors" section: `preloadFonts` and what it replaces.
- The docs (en and th) cover `extending/themes.md` and the Themes screenshot, which today shows two
  themes.
