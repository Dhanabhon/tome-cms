# Changelog

Every release of TomeCMS, newest first. Each version links to its full release notes in [`docs/releases/`](docs/releases/), which also say what to migrate and what changed for theme and plugin authors. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). From `1.0.0`, a managed install takes each release from the admin. Every `0.x` version before it was a pre-1.0 release candidate, not meant for production; from 0.12.1 on, each was also tagged and published as a GitHub release. A `0.x` site cannot become a managed `1.0.0` install in place and needs a fresh server, as the [1.0.0 notes](docs/releases/1.0.0.md#upgrading) explain.

## 1.8.0 - 2026-10-01

An AI app and the owner take turns on a draft, and Claude and ChatGPT show their marks.

### Added

- The editor shows when an AI app read or changed the draft in the last few minutes, and offers to load the latest version when the draft changed elsewhere.
- While you have a draft open, an AI app cannot change it. It is told to ask you to close it or to make a new draft. This includes a new draft, from its first save.
- Claude's and OpenAI's marks on the consent screen and in the connections list. They are chosen only from the approval's address or the app's client document, never from the name the app gives.

### Changed

- An approval going back to your own computer reads "A program on this computer".
- The connections list says when a connection reads only because writing is switched off.

### Fixed

- Put back keeps the current address if the old one was taken, and leaves out a deleted category or cover.
- Old OAuth codes, tokens and unused apps are tidied, and the "too many apps" message says what to do.
- App write and fault log lines carry a request id.

Full notes: [docs/releases/1.8.0.md](docs/releases/1.8.0.md)

## 1.7.0 - 2026-10-01

Claude or ChatGPT can read the site and write drafts, after the owner allows it with their passkey, and the owner can put back what the AI changed.

### Added

- MCP, an Official plugin, off by default. It covers:
  - an OAuth 2.1 sign-in for AI apps (CIMD or DCR, PKCE, redirects only to Claude, ChatGPT, this computer or addresses the owner adds), with a passkey consent screen;
  - ten tools that read posts, pages, categories and the media library and create or edit drafts, with no publishing, deleting or uploading;
  - a connections list with Revoke;
  - a switch that stops AI writing at once;
  - "Put back" in the editor, for a draft an AI changed.

### Changed

- The cross-site form check compares with the site's public address, so it works behind the proxy and lets the OAuth token endpoint's server calls through.
- One migration, `028_mcp`. A managed update takes a full backup.

Full notes: [docs/releases/1.7.0.md](docs/releases/1.7.0.md)

## 1.6.2 - 2026-10-01

A suggested excerpt or description can be swapped for another sentence.

### Added

- "Another one" beside a suggested line or description asks the suggester for a sentence not yet shown; when the post has no other, the drawer says so and the next press starts over. `POST /api/admin/suggest-excerpt` takes an optional `exclude`.

Full notes: [docs/releases/1.6.2.md](docs/releases/1.6.2.md)

## 1.6.1 - 2026-10-01

The language filter on Posts and Pages looks right under the pointer.

### Fixed

- The language filter on Posts and Pages darkens its words under the pointer and while its list is open, instead of filling a grey block over the tabs' rule; a press no longer draws a line under it like the current tab's.
- Two timing tests of the Markdown reader get the slow-runner bound, after failing the 1.6.0 release job once.

Full notes: [docs/releases/1.6.1.md](docs/releases/1.6.1.md)

## 1.6.0 - 2026-10-01

Code blocks have a language, coloured in the editor and on the page, and a Markdown file can become a draft post.

### Added

- A code block's language: None, Auto, or one of 24, chosen in the block's corner; the usual short names (js, py, sh…) are understood. The editor colours the code as it is written; the published page is coloured on the server, so readers load no script. A light block with its language in the corner, dark in dark mode, in both themes; syntax colours are tokens held to 4.5:1.
- "Import Markdown" on Posts: one `.md` file becomes one draft — title, frontmatter fields, existing categories, headings, lists, tables, code with its language and `---` breaks — with each picture matched by its file name or skipped, and a summary of what was left out. Files are bounded (900 KB, 500 pictures) and read in a worker with a time and memory limit, one at a time.

### Fixed

- A post or page too long to store is refused with that reason, measured as the database stores it, instead of a generic error.

Full notes: [docs/releases/1.6.0.md](docs/releases/1.6.0.md)

## 1.5.5 - 2026-10-01

Paper can show a rail of a post's headings beside it, the editor adds a new part, and a published post or page has "Copy link".

### Added

- Paper's "Reading position": Off, Bar at the top, or Rail at the side — a line for each heading of a post, the one being read darker, each naming its heading and going to it. Below 64rem the bar shows instead. Headings get their own addresses, Thai included.
- "New part" in the editor's + menu: a break between parts of a post, drawn as three dots in the editor and both themes.
- "Copy link" on the menu of a published post or page copies its full public address.

### Fixed

- A list opened from the admin's own select is wide enough for its choices, lines up with a button at the end of its row, and shades only the row being pointed at; the language filter no longer draws a tab's line under itself.
- The README's logo and architecture picture follow GitHub's theme, not the reader's system setting.

Full notes: [docs/releases/1.5.5.md](docs/releases/1.5.5.md)

## 1.5.4 - 2026-10-01

A link in the editor can point at a picture from the File Manager, as well as a document.

### Changed

- The link dialog's "Choose from the File Manager" opens on All, with pictures beside documents; a link to a picture keeps it from being deleted, as a link to a document does.

Full notes: [docs/releases/1.5.4.md](docs/releases/1.5.4.md)

## 1.5.3 - 2026-09-30

A PDF shows its first page in the File Manager, and a link in the editor can point at a file from it.

### Added

- The File Manager shows a PDF's first page on its card and in its details, drawn in the browser from a new owner-only route that reads the file in ranges.
- The editor's link dialog can choose a file from the File Manager; the link points at `/media/<id>` and counts as a use, so the file is not deleted while a post links to it.
- Paper's footer links the site's name to its home page and "TomeCMS" to the project's repository.

### Changed

- "Copy URL" copies a full address that works wherever it is pasted, and says "Copied" on the button itself.
- The search field on Paper and Plain shows one focus line instead of two.

Full notes: [docs/releases/1.5.3.md](docs/releases/1.5.3.md)

## 1.5.2 - 2026-09-30

Uploads no longer fail at "Storage verification is temporarily unavailable" when the media address sits behind a CDN.

### Added

- `S3_INTERNAL_ENDPOINT`: the address the application itself reaches storage on. A managed install needs none; the application uses the bundled SeaweedFS by itself.

### Fixed

- The application checks an upload through its own storage address rather than the public one, so a CDN such as Cloudflare in front of the media host can no longer refuse the check. Upload links and media URLs still use the public addresses.
- On Themes, the theme in use keeps "Customize" beside "View site".

Full notes: [docs/releases/1.5.2.md](docs/releases/1.5.2.md)

## 1.5.1 - 2026-09-30

Plain widens with the screen and leads with the newest post, Paper sets its header on cream over a white page, and a few admin fields and messages behave as they should.

### Changed

- Plain uses a wide frame: its categories are tabs with search at the end of their row, the newest post leads the first page across the width, and the rest sit three, two or one to a row. Articles keep their reading width, and their titles match the lead's weight.
- Paper's header sits on cream, and its page, hero and footer on white, as the admin's navigation and content do.
- A theme may say it leads its first page with the newest post (`leadsFirstPage`); that page then holds one more post, so the grid under the lead ends on a full row.

### Fixed

- An admin field turns red only when the admin says what is wrong, so a field that clears after a save no longer stays red.
- An empty folder name, new or renamed, is told why; Navigation and Categories mark and focus the field an empty submit is about.
- Security's name warning goes as soon as a name is typed.
- A failed upload says what the server said, and never the browser's raw text.

Full notes: [docs/releases/1.5.1.md](docs/releases/1.5.1.md)

## 1.5.0 - 2026-09-30

Nothing in the admin is drawn by the operating system any more, save buttons say what they are doing, the File Manager takes several files at once, and a post can keep its cover off the top of the article.

### Added

- A post can keep its cover off the top of the article ("Show the cover at the top of the post" in its settings, on by default). The home page card and shared links still use it. `/api/v1` posts carry `showCover`. Migration `027_post_show_cover`.
- The File Manager uploads several files at once, into a folder chosen for them, with progress and a retry for each file. Stop cancels the uploads still running.

### Changed

- No control in the admin opens a picker drawn by the operating system: lists, dates and times, and colours use the admin's own controls. Dates and times have a picker of their own, in the owner's calendar.
- Every radio and checkbox in the admin uses the accent colour instead of the browser's default blue.
- A save button spins while it saves, says "Saved" after, and asks again once something changes.
- The row menu (Posts, Pages and the File Manager's folder menu) closes on a press outside or Escape, and Escape works wherever focus is.
- The Posts and Pages language filters and the Redirects article list use the admin's own list.
- Plugin colour settings are typed as hex beside a swatch.
- The admin's main column is white, and the sidebar sits on the cream page behind it.
- Paper's footer sets the TomeCMS credit at the right.

### Fixed

- The Plugins screen's two notes no longer stretch into the plugin grid; their headings are the right size.
- The upload button no longer keeps a focus ring after a file is chosen.
- No admin form lets the browser show its own warning; an empty name or address is told in the admin's words.
- The Navigation screen no longer says "Saving menu…" after it has saved.
- Escape on a row's Delete prompt closes the prompt, not the menu behind it.

Full notes: [docs/releases/1.5.0.md](docs/releases/1.5.0.md)

## 1.4.0 - 2026-09-30

The admin reads as an editorial page instead of a set of equal boxes, and the public search moves onto the row of categories.

### Changed

- Every admin screen but the editor takes a new shape: a 40px display title under a small label naming its group, sheets separated by rules instead of boxed cards, a sidebar on the page's own surface that marks where you are with a green bar, and no top bar on a desktop. Colours, fonts, screens and what each one does are unchanged.
- Form screens (Settings, Maintenance, Profile, Security, System) are two columns wide enough: the section's name and a line about it on the left, its fields on the right. The save bar sits on the page's lower edge and says whether anything is waiting. Settings and Maintenance share a General / Maintenance tab row.
- Stats leads with its three numbers as large figures on one ruled row; its charts, lists and table lose their boxes. A change is set in green, a note is not.
- Empty screens follow one pattern by situation: nothing made yet, nothing matching the tab or filter (with a way back to all), or an empty part of a form.
- Status is a dot and a word without a pill, card titles use the display face, numbers line up in columns, and a list says its timezone once instead of on every card.
- On Paper and Plain the search box sits at the right end of the category row, with the magnifier as its button, instead of a filled button above it.

### Removed

- The post search in the admin's top bar and the title filter on Pages. Posts and Pages keep their tabs and a language filter on the tab row, which applies a choice made with the mouse at once; with the keyboard, Tab to "Show this language".
- The "Apply filters" button, which the language filter no longer needs.

Full notes: [docs/releases/1.4.0.md](docs/releases/1.4.0.md)

## 1.3.3 - 2026-09-29

Paper's reading progress bar and fading hero work on a real site, and every public page sends far fewer database queries.

### Fixed

- Paper's "Reading progress bar" and the "Fading" way of changing slides never moved on a production site. The build's CSS minifier folded their scroll timeline into the `animation` shorthand, which Chrome rejects whole. They are written as longhands now, and a test minifies every theme sheet to keep it so.
- A public page read the site's settings up to six times and each plugin's settings in a query of its own. They are read once per request now: the home page sends 6 queries instead of 16, and a post's page 5 instead of 14. Nothing is kept past the request, so an edit shows at once.

Full notes: [docs/releases/1.3.3.md](docs/releases/1.3.3.md)

## 1.3.2 - 2026-09-29

The Paper home page is about two and a half times as fast for a site written in Thai.

### Fixed

- The home page worked out every card's reading time on every request, which for Thai runs a dictionary word breaker over the whole post and was most of what the page cost. It now does it once per saved version of a post. With 60 Thai posts it answered 92 requests a second before and 246 after, on the same machine.

Full notes: [docs/releases/1.3.2.md](docs/releases/1.3.2.md)

## 1.3.1 - 2026-09-29

A documentation release, and the first update that 1.3.0's updater backs up with the database alone.

### Documentation

- Upgrading the updater says what a server installed before 1.0.2 does first: it has no `/opt/tome-cms-src`, so it clones the release there.
- The requirements say, with the measurements, that a managed install runs a personal site on 1 GB of memory with 2 GB of swap. The 2 GB minimum stays for anything busier and for a build from source.
- The 1.0.0 acceptance record has its first real-server row: the managed install on the test server, its updates to 1.3.0, the updater upgrade, and two backups verified with the restore check.

Full notes: [docs/releases/1.3.1.md](docs/releases/1.3.1.md)

## 1.3.0 - 2026-09-29

Updates that bring no migration keep the site offline for less time, the System screen says how long an update kept it offline, and the updater itself can be upgraded.

### Added

- `sudo npm run updater:upgrade`, run from a checkout of a release, replaces the managed updater with that release's, along with its systemd unit and `compose.managed.yaml`. It leaves the site running, refuses during an update, keeps the previous files, and puts them back if the new updater does not answer. Until now a server kept the updater it was installed with.
- The "Last update" card on "System" says how long the site was offline and what the backup held, with an updater of 1.3.0 or later.
- `npm run backup -- --database-only`, and the manifest's `"scope": "database"` for such a backup.

### Changed

- Before an update that brings no migration, an updater of 1.3.0 or later backs up the database alone instead of the database and the whole media library. It needs the application being updated from to be 1.3.0 or later too; otherwise, and whenever a migration is due or anything is uncertain, the backup is full as before.

Full notes: [docs/releases/1.3.0.md](docs/releases/1.3.0.md)

## 1.2.1 - 2026-09-29

Small fixes found while reviewing 1.1.1 and 1.2.0.

### Fixed

- With Turnstile on, a passkey check refused because the session had ended (on "System", "Security" or new recovery codes) told the owner to switch the plugin off. It now says the session expired and to reload and sign in, which is the way on.
- The sign-in challenge is skipped only for a session that belongs to the installed owner, not for any valid session.
- The Plain theme's secondary text (the tagline, dates, excerpts, filters, the footer) was drawn in full ink, because it read a colour token that does not exist. It is muted again, and a test fails on any theme that reads an undeclared token.

Full notes: [docs/releases/1.2.1.md](docs/releases/1.2.1.md)

## 1.2.0 - 2026-09-29

Readers can search the posts, from the homepage of both bundled themes and from the public API.

### Added

- A search box above the posts on the homepage of Paper and Plain. It finds the published posts, in the language of the page, that contain every word typed, in the title, the excerpt or the text. It matches inside words and ignores case, so it works in Thai, and bold or a link inside a word does not cut it while a paragraph, a list item or a table cell does. It is a plain form that works without JavaScript, a page of results is kept out of search engines, and Paper hides its hero while results are shown. Choosing a category leaves the search.
- `q` on `GET /api/v1/content/posts`, with the same rule. `links.next` and the signed cursor keep it, and a list without it answers as before. A sender may search 60 times a minute and two searches run at once; past either the answer is `429` with `Retry-After`.
- `query` in the props of a theme's `Home` template: the words a reader searched for.

Full notes: [docs/releases/1.2.0.md](docs/releases/1.2.0.md)

## 1.1.2 - 2026-09-29

The limits on signing in, recovery, installing and updating count each visitor, not the reverse proxy in front of the application.

### Fixed

- Behind a reverse proxy every visitor arrived from the proxy, so each of these limits was one count shared by everyone: ten failing sign-in requests from anywhere kept the owner out for up to fifteen minutes, and the Turnstile plugin was told the proxy's address. The limits now count the address the proxy wrote last in `X-Forwarded-For`, believed only from the proxy's side. An IPv6 visitor counts by their /64, and rows of the limit table older than an hour are swept.
- The proxy has to set that header, as Caddy does and nginx needs a line for. [The reverse proxy](https://dhanabhon.github.io/tome-cms/start/requirements/#the-reverse-proxy) says which.

Full notes: [docs/releases/1.1.2.md](docs/releases/1.1.2.md)

## 1.1.1 - 2026-09-29

Installing an update from "System" works with the Cloudflare Turnstile plugin switched on, and says why when the passkey check does not go through.

### Fixed

- With the Turnstile plugin on, "System" refused the passkey check that confirms an update, and "Verify and create new codes" under "Recovery codes" refused it too: the sign-in challenge was asked for again, and only the sign-in page can pass it. The challenge now guards signing in only, and an owner who is already signed in is not asked for it.
- A failed passkey check on "System" says what went wrong, as the other passkey screens do, and no longer turns "Release availability" red with "Check unavailable" when the release check itself worked.

Full notes: [docs/releases/1.1.1.md](docs/releases/1.1.1.md)

## 1.1.0 - 2026-09-29

The first feature release after 1.0: text colour, underline, strikethrough and numbered lists in the editor, and tidier folder menus in the file library.

### Added

- The formatting bar has "Underline", "Strikethrough" and "Text colour". A colour is one of six names (red, orange, green, blue, purple, grey), stored as `<span class="tome-color-…">` with a light and a dark shade each, at least 4.5:1 on both page surfaces. A headless site may add CSS for the six classes; without it the words keep the surrounding colour.
- "Numbered list" in the `+` and `/` menus.

### Fixed

- A button on the formatting bar kept the focus it took, so the words typed after it went nowhere. The bar now leaves the focus in the editor.
- The file library's folder menus: only one opens at a time, a press outside closes it, and the focus ring stays inside the pill.

Full notes: [docs/releases/1.1.0.md](docs/releases/1.1.0.md)

## 1.0.4 - 2026-09-28

Deleting a file, removing a logo and making new recovery codes work on a managed install, and a folder's rename and delete move into a menu on its chip.

### Fixed

- Three admin requests had no body and no content type, and Astro refused them behind the HTTPS proxy every managed install sits behind, which the admin showed as "The request could not be completed.": deleting a file, removing a site logo, and making new recovery codes. They now send `application/json`, and a unit test fails on any changing request from the admin that names no content type.
- The file library's folders: rename and delete sit in a "..." menu on each folder's chip instead of two buttons repeating its name, and on a phone beside the folder list.

### Changed

- Troubleshooting covers "The request could not be completed." for those three actions.

Full notes: [docs/releases/1.0.4.md](docs/releases/1.0.4.md)

## 1.0.3 - 2026-09-28

An update from the admin stops the application in time and goes back cleanly, a job that failed before its backup can be cleared, the System screen speaks the owner's language throughout, and a Code of Conduct.

### Fixed

- The managed application runs under an init, so it stops on `SIGTERM` in a second. The updater gives the stop its 30 s grace plus 30 s, and a rollback stops the application again before starting the previous version. The first update from the admin on a real server, 1.0.1 to 1.0.2, stopped at "Prepare maintenance" and left the site down. Servers installed with 1.0.1 or 1.0.2 add the init by hand before updating; the notes give the command.
- The System screen words the update's progress from its step, in English or Thai, shows the backup time in the admin's language, and replaces the finished step-by-step card with a "Last update" summary.

### Added

- `sudo npm run updater:clear-failed` sets aside an update that failed before its backup, so another can start. It refuses any job that recorded a backup.
- `CODE_OF_CONDUCT.md`, the Contributor Covenant 2.1.
- Troubleshooting covers an update that stops at "Prepare maintenance".

Full notes: [docs/releases/1.0.3.md](docs/releases/1.0.3.md)

## 1.0.2 - 2026-09-28

Uploads work on a managed install, the System screen speaks the owner's language, and preparing a server and installing share one clone. The first release a managed install takes from the admin.

### Fixed

- An upload finalizes when SeaweedFS refuses the first check that comes right after it: the check now tries up to four times, and the log names the storage error when it still fails. On 1.0.1 every upload ended with "Storage verification is temporarily unavailable."
- On a managed install, the "Updates from the admin" card says each reason in English or Thai, from a code the server now sends, instead of the updater's English sentence.

### Changed

- Preparing a new server clones the release's tag into `/opt/tome-cms-src`, and the install runs from the same folder. Run by root, `prepare-vps.sh` no longer asks for an account.
- A new Troubleshooting page, in English and Thai, lists the messages met while installing and running TomeCMS, with what to do about each.

Full notes: [docs/releases/1.0.2.md](docs/releases/1.0.2.md)

## 1.0.1 - 2026-09-28

The managed installer finishes on a real server. Install 1.0.1; 1.0.0 could not finish.

### Fixed

- The installer and the updater list the migrations inside the release's image in a read-only container, and `tsx` could not write its cache there, so the 1.0.0 installer stopped at that step on every server. The container now gets a small in-memory `/tmp`, and both take the command from `src/updater/inventory.ts`.
- The installer names `TOME_CMS_PUBLIC_URL` or `S3_ENDPOINT` when either is not set, instead of reporting "requires HTTPS".
- The installer checks that ports 5432, 9000 and 4321 are free before it changes anything, the dry run included.

### Changed

- CI builds the application image and runs the installer's migration check against it, `npm run check:inventory`.
- The docs install 1.0.1, and the update path from the admin starts at 1.0.1 to 1.0.2.

Full notes: [docs/releases/1.0.1.md](docs/releases/1.0.1.md)

## 1.0.0 - 2026-09-28

The first stable release. A fresh VPS gets a managed install, whose owner installs later releases from the admin, starting with 1.0.0 to 1.0.1.

### Changed

- The managed installer, `scripts/install-managed-vps.sh`, is the way to install on a VPS. It runs the release's official image, verified against its attestations, and sets up `tomecms-updater`, which installs a verified update from "System". `scripts/prepare-vps.sh` ends by printing its commands, and `deploy/cloud-init.yaml` now installs 1.0.0 through it.
- Versions follow Semantic Versioning from here: `/api/v1` changes only in ways that keep existing clients working, and the feature freeze that began at 0.11.0 ends.
- CI runs the managed update harness, `npm run test:operations:update`, on every push to `develop`.
- Run by root directly rather than through `sudo`, or with `--user root`, `prepare-vps.sh` now says which options fix it: `--create-user --user tomecms` for a new account, or `--user <name>` for one that exists.
- The docs cover preparing a server while logged in as root, pointing DNS at the server, and what to do without a domain yet. Installing, updating, configuration and recovery describe the managed install first, and a build from source second.

Full notes: [docs/releases/1.0.0.md](docs/releases/1.0.0.md)

## 0.14.1 - 2026-09-28

Fixes to the server preparation script, a link in the admin footer, and CI that tests each commit once.

### Changed

- "TOMERA Co., Ltd." in the admin footer links to [tomera.ai](https://tomera.ai).
- `prepare-vps.sh` checks each vendor's apt signing key against the fingerprint the vendor publishes, and stops if the downloaded key differs. The account `--create-user` makes keeps the options on root's SSH keys, such as `from=` and `restrict`, and drops only the "log in as ubuntu" command a cloud image adds. A failing step reports its error once, and no temporary file is left behind.
- CI runs on `develop` and on pull requests, and no longer on `main`. A merge into `main` is a fast-forward of a commit CI already ran on, so `tag-release.yml` now starts from the push to `main` and waits for CI to pass on that same commit before it tags it, instead of testing the same tree twice. A commit CI never ran on, such as a merge commit or a fix pushed straight to `main`, is not released.

Full notes: [docs/releases/0.14.1.md](docs/releases/0.14.1.md)

## 0.14.0 - 2026-09-27

A script that prepares a new Ubuntu 24.04 server for TomeCMS, and a cloud-init file that prepares one and installs TomeCMS on its first boot.

### Added

- `scripts/prepare-vps.sh` prepares a new Ubuntu 24.04 server for TomeCMS: Docker Engine with Compose, Node.js 22, the GitHub CLI, swap on a small server, `ufw` with only SSH, 80 and 443 open, and Caddy as the reverse proxy with certificates for both origins. `--no-firewall` and `--no-proxy` leave those two alone, and `--dry-run` shows what would change. Running it again is safe.
- `deploy/cloud-init.yaml` prepares a server and installs TomeCMS on its first boot, from the user data a provider takes when you create the server. It holds no secret. Neither it nor the script has been run on a real server yet.

Full notes: [docs/releases/0.14.0.md](docs/releases/0.14.0.md)

## 0.13.0 - 2026-09-27

Plainer words across the admin in both languages, two small additions the owner chose, and a release that makes itself from a merge into `main`.

### Changed

- Every admin page ends with a quiet line: "Thanks for writing with TomeCMS.", with TomeCMS linking to its documentation, and "Made by TOMERA Co., Ltd." with the version the server runs. It follows the admin's language.
- A profile link's name is chosen from a list: GitHub, X, LinkedIn, Facebook, Instagram, YouTube, "Website", or "Other…" with a name of your own. A link saved under any other name opens as "Other…" with that name, and what is stored is unchanged.
- Work happens on `develop`, and a merge into `main` that carries a new version releases itself. Once CI passes on the merge, `tag-release.yml` tags the commit and starts `release.yml` on the tag, so the attestations still come from `refs/tags/vX.Y.Z` as the installer and the updater require. CI and the documentation build also run on pushes to `develop`.
- The admin's words are plainer and consistent in both languages: passkey in lower case, File Manager and คลังไฟล์, post and เพจ, URL name, search title and search description in place of slug and meta, header menu, errors that say what to do next, empty screens that say how to start, no dashes in any sentence.

Full notes: [docs/releases/0.13.0.md](docs/releases/0.13.0.md)

## 0.12.1 - 2026-09-26

Fixes only, as the freeze asks, and the first version published as a GitHub release, so an install's "System" screen can check for a newer one.

### Fixed

- The language tabs on Maintenance, Home slides and Navigation open on the site owner's language instead of Thai. A new menu item's default label is Home in the language of the menu you are editing.
- The System screen tells three things apart when it checks for an update: no official release has been published yet, GitHub could not be reached, or GitHub's answer could not be used. Every message there, and the line for a site that can only check, is in the admin's language.
- A spare Passkey's suggested name and a refused recovery code are in the admin's language. The library's refusal to delete a file still in use, with its count of the places using it, is now in the admin's language too.
- The link prompt and six confirmations, for category delete, media folder delete, media file delete, posts list delete, pages list delete and update install, are in the admin's language. They used to fall back to an English "Cancel", and the upload alert to an English "OK". The install confirmation's own button, title and message stay English on purpose, since managed updates start at 1.0.0.
- A draft keeps the "Publish at" date you gave it. The date used to be dropped by the save that filed the draft, and the field was empty the next time you opened it.
- The language chips in the editor say Scheduled for an edition published with a date still to come, as the lists do.
- A popup whose words are the other language's shows its default decline button and its close label in that language too, not the page's.
- A closable notice band from any plugin can be closed. The code that closed it came only with the Notice plugin.
- The first-run bootstrap should now run on Windows: it starts npm through `npm.cmd`, because Windows cannot run npm by name without it and a shell, and it skips the check that only you can read `.env.local`, because Windows reports every writable file as readable by everyone.
- An article that opens with a video fetches the video's poster first, as one that opens with a picture already did.

### Changed

- The release workflow reads the update manifest's target migration from the migrations themselves instead of a fixed name, and a GitHub release carries the version's notes from `docs/releases/`.

### Upgrading

- Migration `026_planned_dates` adds a `planned_at` column to posts and pages. It runs with the others when the deploy helper runs.

### For theme, plugin and headless authors

- The core now closes a notice band that has a `dismissKey` and remembers that it was closed, so a plugin's `siteNotice` needs no browser code. The Notice plugin no longer has a `publicClient`.
- In the admin API, a post and a page carry `planned_at`, the date a draft is planned for, which is null once published. The public API is unchanged.

Full notes: [docs/releases/0.12.1.md](docs/releases/0.12.1.md)

## 0.12.0 - 2026-09-26

The one exception to the freeze before 1.0.0, and where the freeze starts again: only fixes from here until then.

### Added

- **A video in an article or page.** Paste a YouTube or Vimeo link alone on an empty line, or choose Video in the `+` or `/` menu. TomeCMS fetches the clip's title and poster once and keeps the poster in the file library. A reader sees the poster, and the player loads from YouTube's no-cookie host or Vimeo's do-not-track mode only when they press play, so the public site still needs no consent banner. Without JavaScript the poster is a link to the clip.
- **Documentation** at [dhanabhon.github.io/tome-cms](https://dhanabhon.github.io/tome-cms/), in English and Thai: installing and running a site, every screen of the admin with its picture, each plugin, the headless API with a reference generated from the app's OpenAPI document, extending TomeCMS, and contributing. The README is now an introduction that links there.

### Changed

- Stats no longer writes anything to a reader's browser, so counting needs no consent banner. A reload or a step Back is told apart by the browser's own record of how the page was opened, not by a mark in `sessionStorage`. Following a link back to a page already open in the tab now counts as a second view, and reading an article again after reloading it counts as a second read.
- A site that has counted nobody yet shows the Stats report at zero, under a notice headed "Nobody counted yet" that says why and how to see a first number: open the site on your phone or in another browser. The read ratio shows a dash until there is a view, and the lists say "Nothing was viewed in this period." instead of rows of zeros. It used to show one empty box in place of the report.
- Drawers, dialogs, menus and popovers, in the admin and on the site, arrive and leave with the same motion: drawers slide to and from their edge, dialogs rise, menus drop in. Each plays its exit before it closes, and anyone who asked for less motion gets a short fade with nothing moving.

### Upgrading

- No migration. To fetch a clip's title and poster, the server must reach `www.youtube.com`, `vimeo.com`, `i.ytimg.com` and `i.vimeocdn.com` over https; without that a video still goes in, with no poster.
- A Content Security Policy set at your proxy must allow `frame-src https://www.youtube-nocookie.com https://player.vimeo.com`.

### For theme, plugin and headless authors

- A document can hold a `video` node: `{ provider: 'youtube' | 'vimeo', videoId, start, title, mediaId }`. `contentHtml` renders it as `figure.tome-video` with a link to the clip, and the poster is in the item's `media`. Every theme gets the `.tome-video` styles from `global.css`.

Full notes: [docs/releases/0.12.0.md](docs/releases/0.12.0.md)

## 0.11.0 - 2026-09-24

The feature freeze before 1.0.0: only fixes from here until then.

### Added

- **Stats**, first under Content: views, reads and the read ratio of every article and page, against the period before, with a chart by day or month and where readers came from, their devices, countries and languages. TomeCMS counts these itself into daily totals, with no cookie and no record of any reader, and leaves out your own browser, readers who ask not to be tracked, and self-declared bots. Countries come from a CDN's header or from DB-IP Lite, which the release image now carries. A headless site counts through `POST /api/v1/stats/hit`.
- **Maintenance**, under Settings: close the site to visitors while you work on it. Visitors get a 503 page in their language, built from one of four templates (Minimal, Logo, Picture, Countdown) with your own heading, message, picture and return time. The feeds and `/api/v1/content/*` answer 503 too, and the API's answer carries your words so a headless site can draw its own page. The admin, sign-in, health checks and media stay open, and you still see the site while signed in, under a bar that says visitors do not. The site never reopens by itself.
- A picture the maintenance page uses cannot be deleted from the library, and the refusal names the page.
- **Popup**, a plugin: a box over the public site with a picture, a heading, a few words, a button that links to a page or an https address, a way to decline and small print, in Thai and English. It opens after 5, 10 or 20 seconds or as the reader leaves, on every page or the home page only, never over another dialog, and not again once closed until its content changes. Plugins gain a picture setting chosen from the library and a choice setting, and the library will not delete a picture a plugin holds.
- `paper` can show the author's links under an article as icons, or as icons and words. GitHub, X, LinkedIn, Facebook, Instagram and YouTube are drawn as their own marks, told by the link's address; any other link gets a plain one. Words stay the default.

### Changed

- Settings in the admin's menu folds out to General and Maintenance, the way Appearance holds Themes and Plugins.

### Upgrading

- Two migrations, `024_site_maintenance` and `025_content_stats`. Run `npm run db:migrate`; the deploy helper runs it for you.
- One new runtime dependency, `mmdb-lib`. The release image carries the DB-IP Lite country database; an image built on your own server shows countries as unknown until you add it.

### For theme, plugin and headless authors

- A read is measured from the end of the first `<article>` on a post or page. Keep the article's own `<article>` first there.
- Plugins gain `choice` and `image` settings, `previewHref`, and the `sitePopup` half of the `publicPage` hook.
- `POST /api/v1/stats/hit` is new. While the site is closed, `/api/v1/content/*` answers 503 with a `maintenance` object. The OpenAPI document describes both.

Full notes: [docs/releases/0.11.0.md](docs/releases/0.11.0.md)

## 0.10.0 - 2026-09-23

### Added

- **Home slides**, under Content: a picture, a heading, a line and a button for the top of each language's home page, up to ten a language and five shown, each with its own start and end if it wants them. `paper` draws them when its hero is set to Your slides, as a still banner for one and a slider for more, turning by itself or not, sliding or fading. A headless site reads the live ones from `/api/v1/content/slides`.
- A picture a slide uses cannot be deleted from the library, and the refusal names the slide.

### Changed

- In Thai, the site's appearance setting reads the same way as the admin's.

### Fixed

- In Thai, the label over the admin's light and dark switch was too long for the sidebar and broke inside a word.
- An article that opens with a picture and has no cover asked for that picture lazily, which held back the moment the page looked ready. Both themes now fetch it first. A picture further down still loads as the reader nears it, and `contentHtml` from the API is unchanged.
- The `plain` theme's cover image is fetched first, as `paper`'s already was.
- The covers slider fetched the pictures a reader had not reached at the same priority as the one on screen. They come last now.

### Upgrading

- One migration, `023_home_slides`. Run `npm run db:migrate`; the deploy helper runs it for you.
- A site whose `paper` hero is set to anything else sees no change until the owner picks Your slides.

### For theme authors and headless sites

- `ThemeHomeProps` gains `slides`, the live slides of the page's language, in order, at most five. A theme that draws no hero, or one of its own, can ignore it.
- `/api/v1/content/slides` is new, and the OpenAPI document describes it.

Full notes: [docs/releases/0.10.0.md](docs/releases/0.10.0.md)

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
