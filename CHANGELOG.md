# Changelog

Every release of TomeCMS, newest first. Each version links to its full release notes in [`docs/releases/`](docs/releases/), which also say what to migrate and what changed for theme and plugin authors. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every `0.x` version is a candidate on the pre-1.0 clean-install line, and none is tagged for production. What stands between them and `1.0.0` is in the [planned 1.0.0 boundary](docs/releases/1.0.0.md).

## Unreleased

## 0.9.0 - 2026-09-23

### Changed

- The editor runs on Tiptap 3, and `novel`, the package it used to reach Tiptap through, is gone with the eight libraries it brought and never used. What a writer stores is unchanged: a post saved before this release opens, renders and saves exactly as it did. The `/` menu, both bars and the picture dropped or pasted into a page are about three hundred lines in `src/components/admin/editor/` now.
- On a phone, the library's type and folder selects are captioned.

### Fixed

- A quick image upload could answer before the picture had been read from disk, which threw the picture away and left a placeholder in the article for good.
- A failed image upload used to leave a writer's chosen words deleted with nothing in their place.
- Leaving the editor while an image was uploading threw.
- A link to a library folder that no longer exists opens All, instead of an empty view that read as files gone.
- Alternative text sent with a document is refused as a bad request, where it failed as a server error.
- A card whose file has left the library says to choose a file from this site, not that the content is invalid.
- A document is checked from one object: both of its reads carry `If-Match`, so a file replaced while it is checked is refused.

### Upgrading

- No migration.
- A site that forked anything under `src/components/admin/` has more to merge than usual, and `SlashCommands.tsx` moved to `src/components/admin/editor/slash-items.tsx`.

### For theme authors and headless sites

- Nothing changed. `contentHtml`, `contentJson`, the public API and every theme hook are what 0.8.0 left them.

Full notes: [docs/releases/0.9.0.md](docs/releases/0.9.0.md)

## 0.8.0 - 2026-09-22

### Added

- The media library keeps documents beside images: PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), CSV, text and ZIP, up to 25 MB each. Each is judged by its bytes as it arrives, a legacy or macro-enabled Office file is refused, and the library filters by type.
- A file goes into a post or a page from **+** or **/** as a card with its name, type and size. A reader downloads it under its own name, and a PDF opens in the browser.
- A menu item with a custom URL can open in a new tab. Home and the site's own pages always open in place.
- The README shows the system's architecture, and [`docs/tome-cms-overview.en.html`](docs/tome-cms-overview.en.html) is an English edition of the interactive overview. The Thai one names Jev (TypeSafe AI) too.

### Changed

- The TypeSafe plugin is called **Jev (TypeSafe AI)**. Its id is still `typesafe`, so a site's switch and sealed API key carry over.
- An upload's time limits grow with the file: two minutes, or 50 KB a second when that is longer.

### Fixed

- A backup failed for any document, for any object over 8 MB and, already in 0.7.0, for an SVG site logo. A managed update runs a backup first, so it would have been blocked as well.
- `npm run restore:check` puts back how each document is handed out, which the backup does not carry, and checks it.
- The **+** menu in the editor opened across its own button.
- An article's images kept neither `loading="lazy"` nor `decoding="async"`: the sanitizer removed what it had added.
- A file the library's chosen type hid seemed not to have landed when it was uploaded. The view now switches to All, where it is.
- A failed upload, and an image dropped or pasted into the editor, said why in English whatever the admin's language.

### Upgrading

- Two migrations: `021_media_documents` and `022_navigation_new_tab`. Run `npm run db:migrate`.
- An external S3 store whose CORS rule lists headers must also allow `content-disposition` for the site's origin, or document uploads fail at the preflight while images keep working.
- `021_media_documents` cannot be undone while the library holds a document.
- Posts and pages keep the HTML they were saved with; their images gain the two lazy-loading attributes when each is next saved.

### For theme authors and headless sites

- `contentHtml` can hold a `p.file-card` paragraph, and `contentJson` an `attachment` node with `href`, `mediaId`, `mimeType`, `name` and `size`. A client that switches on node types has to render it or skip it.
- `/media/<id>` can now redirect to a document: a PDF opens in the browser, and anything else downloads. The public `media` list stays images only.
- Every navigation item carries `newTab`. A theme that honours it adds `target="_blank"` and `rel="noopener noreferrer"`.
- An article's images carry `decoding="async"` and `loading="lazy"`. A site that sanitizes `contentHtml` again has to allow them, the card's classes and `type` on a link.
- A file in the library is public at its address whether an article uses it or not, as images already were.

Full notes: [docs/releases/0.8.0.md](docs/releases/0.8.0.md)

## 0.7.0 - 2026-09-22

- Tables and text alignment in the editor.
- A link opens a new tab only when its writer asks. Before, every link did.
- The theme choice floats from one button.
- The editor can always be left: Back saves first, and the formatting bar is never cut off.

Full notes: [docs/releases/0.7.0.md](docs/releases/0.7.0.md)

## 0.6.0 - 2026-09-21

- The site's own logo (SVG included), a logo for the dark theme, its name and its icon, set under Settings.
- Every admin control that starts a request says it is working, the same way everywhere and for long enough to be seen.
- One migration: `020_site_brand`.

Full notes: [docs/releases/0.6.0.md](docs/releases/0.6.0.md)

## 0.5.0 - 2026-09-21

- A meta description suggested from the article's own sentences, through the suggestions plugin.
- A button no longer claims work it is not doing.
- The CI workflows run on Node 24.

Full notes: [docs/releases/0.5.0.md](docs/releases/0.5.0.md)

## 0.4.0 - 2026-09-21

- Plugins reach the page a reader sees: a Sticky Banner and an image lightbox.
- A theme is told more about how to draw a page, and `paper` gains a reading progress bar among its settings.
- A post can wait for a date, a Thai title gets a Thai address, and an old address still reaches the article that moved from it.
- Suggestions while writing, through a plugin an installation chooses and never by default.
- Three migrations: `017_scheduled_publishing`, `018_thai_slugs` and `019_content_redirects`.

Full notes: [docs/releases/0.4.0.md](docs/releases/0.4.0.md)

## 0.3.0 - 2026-09-20

- The public site is a theme: `paper` is the look TomeCMS ships with, and `plain` a deliberately spare second one. A theme declares its own settings.
- Plugins fill hooks the core declares. The first is Cloudflare Turnstile on the sign-in form, and a plugin's secret settings are encrypted at rest.
- The admin is redrawn on one set of surfaces, and both the site and the admin read in the language they are read in.
- Breaking: the public templates moved to `src/themes/paper/parts/`, and the public half of `global.css` to `src/themes/paper/theme.css`.
- Nine migrations, `008` to `016`.

Full notes: [docs/releases/0.3.0.md](docs/releases/0.3.0.md)

## 0.2.0 - 2026-09-13

- A headless-capable core on PostgreSQL, Better Auth and S3-compatible storage replaces the Supabase backend. A clean installation is required: nothing is imported from Supabase.
- Passkey-first sign-in. Production needs an HTTPS origin; loopback HTTP still works for local development.
- A read-only `/api/v1/content` REST API publishes the site's settings, posts, pages, categories and navigation.

Full notes: [docs/releases/0.2.0.md](docs/releases/0.2.0.md)
