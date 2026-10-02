# Almanac: a warm, literary theme

Date: 2026-10-02
Status: Design. The owner approved it in parts on 2026-10-02. It ships in 1.11.0, beside Tome CLI
part A, which gets its own spec.

## What it is

A third bundled theme, beside Paper and Plain:
- **Warm paper.** The page is warm paper, with serif headings and soft tinted panels.
- **The home page.** A hero band, a row of category pills, and a 3-column grid of post cards.
- **The reference.** It follows the *structure* of a reference page the owner shared: a soft hero,
  card grids with a top panel, and a slim footer.
- **No borrowing.** Nothing of the reference's brand is used: not its name, logo, colours,
  illustrations or wording.

The owner chose these:
- the warm direction (A) over a crisp one;
- category pills like Paper's, not one section per category;
- the name Almanac.

**No database or contract change.** Almanac uses exactly the props Paper and Plain get today
(`ThemeHomeProps`, `ThemePostProps`, `ThemePageProps`, `ThemeShellProps`). There is no migration.

## Files

`src/themes/almanac/`, shaped like `src/themes/plain/`:
- `index.ts`, which exports `{ Home, Page, Post, Shell }` and `manifest`;
- `theme.ts`, the manifest and settings;
- `theme.css`;
- `Shell.astro`, `Home.astro`, `Post.astro`, `Page.astro`;
- `parts/` for the pieces they share, such as the card, the header and the footer.

Registering it:
- `src/themes/manifests.ts` gains `almanac`;
- the registry and `styles.ts` pick it up the way they pick up the other two;
- the theme picker in the admin lists it with its sentence.

Reuse rather than copy:
- `SiteSubmenu`, `SiteNavLink` and `SubmenuScript` for the header menu;
- `LanguageSwitcher`, `ThemeToggle` and `SiteBrand`;
- the post-feed helpers that Paper's home already uses: the category links, the cursor link, the
  empty and search states;
- `readingMinutes` and the date formatting.

## Fonts and colours

**Fonts.**
- **Headings: Trirong.** It is a serif with Thai and Latin. Use weights 400 and 600, self-hosted
  through `scripts/sync-fonts.mjs` like the existing families, from the `@fontsource/trirong`
  dev dependency.
- **Body: IBM Plex Sans Thai,** which is already bundled.
- **Loading.** The Trirong `@font-face` is loaded only on Almanac pages. `font-display: swap`. Only
  the latin and thai subsets, with `unicode-range`.

**Colours.** Defined as tokens in `theme.css`, light and dark:

| Token | Light | Dark |
|---|---|---|
| paper (page) | warm off-white | warm brown-black |
| surface (cards) | lighter paper | a step above the page |
| ink (text) | near-black, warm | warm off-white |
| muted | warm grey | warm grey |
| accent | deep moss green | lighter moss |
| rule | warm hairline | warm hairline |

- **No orange.** The accent is not orange, because orange is the reference's signature.
- **Contrast.**
  - body text and ink: at least 4.5:1;
  - the accent on paper: at least 4.5:1 for links, 3:1 for graphics;
  - both checked in light and dark.

**Panel tones.** Six calm tones for posts with no cover: sand, sage, mist blue, clay pink, wheat,
grey-lilac.
- Each tone has a text colour from the same family.
- A category always gets the same tone, from a stable hash of its id, modulo 6.
- In dark mode, each tone is a dimmed version of itself.
- Everything is a design token; there are no raw colours in components.

## Shell (header and footer)

**Header.**
- The site brand (logo or name) on the left.
- On the right: the header menu with sub-menus, through the shared components, then the language
  switch and the theme toggle.
- On phones, the menu collapses into a Menu `<details>`, as Paper does, with sub-items indented.

**Footer** (slim).
- On the left: © year and the site name.
- On the right: the footer menu, the language switch and the theme toggle.
- "Powered by TomeCMS" follows the same site setting the other themes honour.

## Home

From top to bottom:

1. **Hero band** (a setting can switch it off).
   - A soft paper band, slightly darker than the page, full width.
   - A large serif headline and a lead line in sans.
   - Two buttons: the primary is filled with the accent, the secondary is outlined.
   - **The settings, with their defaults:**

     | Setting | Default |
     |---|---|
     | headline | the site name |
     | lead | the tagline |
     | primary button | "Start reading", linking to the newest post |
     | secondary button | "All posts", linking to the post list |

   - A button whose label is empty is not drawn.
   - **Links accept:** a path on this site (`/…`), or `https://`. Any other link is refused at
     save, in the same way the menu refuses it (`normalizeNavigationUrl`).
   - The hero is hidden on later pages (when a cursor is set) and while searching, the same way
     Paper hides it.
2. **Category row.** "All" plus each category as a pill, with the current one marked
   (`aria-current`), and a quiet search field at the end of the row. This is the same behaviour and
   markup role as Paper's, including the existing script that swaps the feed when a pill is picked,
   if it can be shared. Otherwise the pills are plain links.
3. **Card grid.** 3 columns at 1024 px and wider, 2 at 640 px, 1 below that, with the latest posts.
4. **"More posts"** via the cursor, as in Paper.

**Searching or a category** shows the grid with a heading naming the search or the category, and
the existing empty states. A reader's words are printed as text, never as HTML.

## Card

- **The whole card is one link** to the post, keyboard-focusable, with a visible focus ring.
- **Top panel**, 16:9:
  - the post's cover image, with `alt` from the media, lazy-loaded below the fold, with explicit
    width and height;
  - with no cover, the category's tone, with the category's first letter in Trirong inside a
    circle in that tone's text colour. The letter comes from the first category, or the site
    name's first letter when the post has none.
- **Body:**
  - a serif title of up to 3 lines;
  - the excerpt, clamped to 3 lines;
  - the meta line: "5 min read · 28 Sep" (th: "อ่าน 5 นาที · 28 ก.ย."), in the site's timezone.
- **Hover** (only under `@media (hover: hover)`): the card rises 2 px with `transform` and its
  shadow deepens. The image fades in once it has loaded. Under `prefers-reduced-motion` neither
  happens.

## Post

- **A reading column** about 68ch wide, centred.
- **Header, top to bottom:**
  - the first category as a pill linking to the home page filtered to it;
  - a large serif title;
  - the excerpt as a lead;
  - the meta: author, date, reading time;
  - the cover image across the column, rounded, eager and high priority (it is the page's LCP).
- **Body** at 18 px sans, line-height ~1.75, with serif headings. The rest follows the content
  styles the other themes already handle: tables, code, quotes, pictures, file cards, embeds.
- **End:** "More in {category} →" to the filtered home page.
- **Reading progress.** A thin bar at the top, which a setting can switch off.
  - It is driven by scroll in CSS, `animation-timeline: scroll()`. It is absent where that is
    unsupported.
  - It is hidden under reduced motion.
  - Its longhands must survive the production minifier, which once folded `animation-timeline`
    into a shorthand that Chrome drops. A built-CSS unit test checks this, as
    `tests/unit/scroll-timeline-css.test.ts` does.
- **The rest of the page** is the same as the other themes: alternates, SEO and structured data
  come from the shared layout.

## Page

Like a post, without the category pill, meta, reading progress and "More in".

## Settings (the manifest)

| Key | Kind | Default |
|---|---|---|
| `hero` | switch | on |
| `heroHeadline` | text, 120 | '' (the site name) |
| `heroLead` | text, 240 | '' (the tagline) |
| `primaryLabel` | text, 40 | '' ("Start reading" / "เริ่มอ่าน") |
| `primaryLink` | text, 2048 | '' (the newest post) |
| `secondaryLabel` | text, 40 | '' ("All posts" / "บทความทั้งหมด") |
| `secondaryLink` | text, 2048 | '' (the post list) |
| `readingProgress` | switch | on |

- **Defaults.** An empty text falls back to the default shown, in the page's language.
- **Labels and hints** are in en and th.
- **Link validation.** Validate the link settings at save (see Home). If the theme setting writer
  cannot validate per setting, it validates in the theme at render: a bad link is dropped, and its
  button is not drawn.

## Accessibility

- Semantic landmarks: header, nav, main, footer.
- One `h1` per page.
- Visible focus everywhere.
- The pills are a nav with `aria-current`.
- The card is a link with an accessible name, which is the title.
- Contrast is checked in both modes.
- Reduced motion is honoured.
- Keyboard-only use of the header menu, the pills, the search, the cards and "More posts".

## Performance

- No new JavaScript, apart from the existing shared scripts: the menu, the theme toggle, and the
  feed swap if shared.
- Images have explicit dimensions. Only the post's cover is eager.
- The theme's CSS stays well under the 30 kB budget, gzipped.

## Docs

- `admin/themes.md`, en and th: Almanac, its settings, and the reading-progress note.
- `extending/themes.md`, en and th: name Almanac as the third reference theme.
- The README key features list, if it names themes.

## Tests

- **Unit:**
  - the manifest: settings, fallbacks, labels in both languages;
  - the category tone, which is stable per id;
  - the card's fallback letter;
  - the link-setting validation;
  - the built CSS keeping the progress bar and motion longhands.
- **E2E** (own stack, at most 5 `/recovery` sign-ins, seeded data):
  - switch to Almanac;
  - the home page with and without the hero, the pills filtering, search, "More posts";
  - a post with and without a cover, and a page;
  - the header with a sub-menu, desktop and phone;
  - the empty states;
  - keyboard paths;
  - reduced motion;
  - screenshots at 390, 768 and 1440, light and dark, gated by an env var.
- **Theme switching:** Paper and Plain are unchanged. Their existing e2e specs pass.

## Release

1.11.0, beside Tome CLI part A.
- Almanac adds no migration.
- If CLI part A adds none either, the updater backs up the database alone.
