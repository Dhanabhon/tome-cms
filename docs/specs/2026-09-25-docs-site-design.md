# The documentation site

Date: 2026-09-25
Status: Design, for the owner's review before planning

TomeCMS keeps everything a reader needs in one 570-line README, in English only. This design
moves that material into a documentation site in English and Thai, published on GitHub Pages
from this repository. The README goes back to being a short introduction that points to the site. This
is step 5 of [the road to 1.0.0](../plans/2026-09-24-road-to-1.0.0.md).

## What was decided before this was written

Each of these was put to the owner as a question and chosen.

- **The site is the one source.** The detailed material leaves the README for the site. The
  README keeps an introduction, the status, the architecture picture, links into the site and
  the license, so nothing is written twice.
- **English at the root, Thai at `/th/`.** Most people who find a GitHub repository read
  English first, and the README and the API are already English. Every page exists in both
  languages, with a switch on each.
- **In this repository, under `website/`.** Documentation changes in the same commit as the code
  it describes, and the API reference can be built from the app's own OpenAPI document.
- **At `https://dhanabhon.github.io/tome-cms/`.** No DNS to set up. A custom domain can come
  later with a `CNAME` file and a new `base`.
- **The API reference is generated from the OpenAPI document**, not written by hand, so it
  cannot drift from the code.
- **Admin screenshots are taken by a script**, in both languages, so they can be taken again
  whenever a screen changes.
- **All prose follows the `/humanizer` rules.** Plain human writing with no AI tells: no em or
  en dashes, no inflated vocabulary, and no rule-of-three padding. The Thai is written as Thai,
  not translated word for word from the English.

## The site

`website/` is an Astro site built with Starlight (`@astrojs/starlight` 0.42, which requires
Astro 7.2.10 or later, the same major version the app uses). It has its own `package.json` and
lockfile, so none of its dependencies reach the app's.

- `site: 'https://dhanabhon.github.io'`, `base: '/tome-cms'`.
- Locales: `root` is English (`lang: 'en'`), `th` is Thai (`lang: 'th'`). Pages live in
  `src/content/docs/` and `src/content/docs/th/` with the same file names.
- It looks like the app: IBM Plex Sans Thai through `@fontsource`, the green accent and ink
  colours of `src/styles/installer-tokens.css` mapped onto Starlight's custom properties, and
  the logo from `public/brand/`. Light and dark themes follow the reader's system.
- Search is Starlight's Pagefind. Thai has no spaces between words, so the build must be shown to
  find a Thai word; if the default indexing does not, the plan adjusts it.

### What is on it

Every page exists in English and in Thai.

| Section | Pages |
|---|---|
| Start here | What TomeCMS is, with the architecture picture · What the server needs · Installing on a VPS · The first-run wizard |
| Running a site | Configuration (every environment variable, with its default) · Bundled and headless modes · Updating and upgrading · Backups and restore · Getting back in · Maintenance mode |
| Using the admin | Writing (the editor, blocks, pictures) · Publishing (scheduling, addresses, redirects) · Pages and menus · Home slides · The file library · Stats · Site settings, profile and passkeys · Themes (`paper` and `plain`) · Plugins, one page each (Cloudflare Turnstile, Jev, Sticky Banner, Popup, Image lightbox) |
| Headless API | Overview (locales, cursors, caching, CORS) · Counting readers from a headless site · The generated reference |
| Extending | Writing a theme · Writing a plugin |
| Contributing | Setting up for development (macOS and Windows) · Project layout · Tests · How to contribute · Security policy · Links to the changelog and release notes, which stay in the repository |

That is about thirty pages in each language. Most of it comes from the README, rewritten for a
page of its own. Before 1.0.0 the site says plainly where things stand. For example, installing
today is a pre-1.0 preview that each 0.x release replaces with a clean install.

### The API reference

A script in `website/` imports the app's `src/server/http/openapi.ts` with `tsx` and writes
`website/src/generated/openapi.json`, which is not committed. `starlight-openapi` (0.26)
turns that file into reference pages under `/api/reference/`.

The schema text is English, so the Thai section has its own overview and examples in Thai, and
links to the English reference for the schema detail.

### Screenshots

`npm run docs:screenshots` (a script under `website/scripts/`, using the root's Playwright)
builds a demo site and photographs it:

- It brings up a disposable stack the way the e2e specs do, under a Compose project of its own
  and never on port 4321.
- It seeds a demo site with Thai and English posts, pages, pictures and a menu.
- It signs in with a virtual passkey.
- It photographs a fixed list of admin screens in both languages, in the light theme, at
  1280 by 800. The images are committed under `website/src/assets/screenshots/en/` and `th/`,
  and Astro converts them to WebP at build.

The script runs by hand when a screen changes, not in CI, because it needs Docker. Running it
is added to the release checklist.

### Publishing

A new workflow, `.github/workflows/docs.yml`, runs on a push to `main` that touches
`website/**` or `src/server/http/**`, and can also be started by hand. It:

1. installs the root's and `website/`'s locked dependencies,
2. generates `openapi.json`,
3. builds the site,
4. publishes it with `actions/upload-pages-artifact` and `actions/deploy-pages`.

A pull request that touches `website/**` builds the site but does not publish it. Every action
is pinned by SHA, as in the other workflows. The publish job has only `pages: write` and
`id-token: write`.

Two repository settings change once, with the owner's permission when the time comes: Pages
publishes from GitHub Actions, and the repository's Website field links to the site.

## Keeping it right

The build fails when:

- an internal link is broken (`starlight-links-validator` 0.26)
- an English page has no Thai twin, or the other way round (a small check script)
- any page contains an em or en dash, or a word from the humanizer skill's high-frequency
  AI-vocabulary list (a small check script)
- `astro check` reports an error in `website/`

## Order of work

Each step works and can be checked by itself.

1. **The shell.** Starlight in `website/` with both locales, the app's look, the link, pair and
   style checks, a build-only `docs.yml`, and one home page in each language.
2. **The API.** The `openapi.json` step, the generated reference, the API overview, and
   counting readers from a headless site, in both languages.
3. **Start here and Running a site**, from the README, in both languages.
4. **The screenshot script, and Using the admin**, with pictures on every page.
5. **Extending and Contributing.**
6. **Going live.** The shorter README, Pages set to GitHub Actions, the Website link, the first
   deploy, and a CHANGELOG entry.

## Verification

- Every build passes the checks above.
- Each step's pages are read by a reviewer against the humanizer list, in both languages, and
  checked against the code:
  - environment variable names and defaults
  - install steps
  - route names
  - what a screen really shows
- The site is looked at by eye in the light and dark themes, at 1280 and 375 wide, and a Thai
  word is searched for and found.
- After the first deploy, the live site is opened and every link, picture and font is checked
  under `/tome-cms/`.

## Risks

- **Thai search.** Pagefind may not split Thai words. The first step checks it, and the plan
  adjusts the indexing if it has to.
- **Stale screenshots.** A screen can change without the script being run again. The release
  checklist names the script.
- **Volume.** About sixty pages is a lot of writing. The steps can each be merged on their
  own, so the site can go live with fewer sections and grow.

## Not in this design

| Left out | Why, or when to add it |
|---|---|
| Documentation per version | Once there is more than one supported release, after 1.0.0 |
| A custom domain | `base` and a `CNAME` file are all it takes, whenever the owner has one |
| Analytics on the documentation site | TomeCMS counts no one it does not have to |
| Comments, a blog | Nobody has asked; issues and discussions exist for questions |
