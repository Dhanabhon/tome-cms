<h1 align="center">
  <img alt="TomeCMS" src="public/brand/tomecms-logo-color.png#gh-light-mode-only" width="360">
  <img alt="TomeCMS" src="public/brand/tomecms-logo-reverse.png#gh-dark-mode-only" width="360">
</h1>

TomeCMS is a lightweight CMS for sites in Thai and English, built with Astro. It ships a server-rendered blog and a React admin editor, and serves the same published content through a versioned headless REST API.

> **Status:** `1.16.1` is the current stable release. `1.0.0`, the first, could not finish a managed install, 1.0.1 could not finish an upload, and a server installed with 1.0.1 or 1.0.2 needs one manual step before it updates from the admin. A fresh VPS gets a managed install: the installer runs the release's official image, verified against its attestations, and the owner installs later releases from the admin. The production dependency audit reports no advisory at all, and CI runs the unit, integration, browser and managed-update gates on every change. The managed install's acceptance runs on real HTTPS servers, `amd64` and `arm64`, are recorded in the [1.0.0 notes](docs/releases/1.0.0.md#acceptance-on-real-servers) as they are done. [Releases and changes](https://dhanabhon.github.io/tome-cms/contributing/releases/) on the documentation site says where each version's notes are kept, and the [changelog](CHANGELOG.md) sums up every version in one place.

## Key features

**Writing**

- A block editor with:
  - headings, lists, quotes and tables;
  - text colour and alignment;
  - code blocks with a language, coloured on the server for 24 languages;
  - pictures, file attachments, and YouTube or Vimeo videos that load nothing from the provider until the reader presses play.
- Thai and English editions of one post, written separately and kept together.
- Drafts, scheduled publishing, a cover picture, an excerpt, and the search title and description.
- Importing a post from a Markdown file, with its pictures matched to files you choose.
- Suggestions while writing, through the Jev (TypeSafe AI) plugin: categories, a line for the excerpt and a summary for search. A suggestion is never applied until you press it.

**The site**

- Three themes, Paper, Plain and Almanac, with settings for Paper and Almanac, and a light and dark mode for readers.
- Search that works in Thai, categories, pages, menus, home slides, redirects, and an RSS feed and sitemap.
- Maintenance mode, which closes the site to readers while you keep working.
- Reading statistics kept on your own server.

**For developers**

- A versioned, read-only REST API (`/api/v1`) with an OpenAPI description, for using TomeCMS headless.
- Draft previews by short-lived link.
- Plugins compiled into the release, each off until switched on:
  - Cloudflare Turnstile;
  - a sticky banner and a popup;
  - an image lightbox;
  - Jev;
  - MCP.

**AI apps (MCP)**

- Connect Claude or ChatGPT (including Codex) to your own site over OAuth, after you allow it with your passkey.
- The app can:
  - read your posts and pages, drafts included;
  - search them;
  - create drafts and edit drafts.
- It cannot publish, schedule, delete or upload.
- One step of undo for anything an AI changed, and a list of connections you can revoke at any time.

**Security and running it**

- Sign-in with a passkey only, with recovery codes kept apart from it.
- Rate limits per visitor, even behind a proxy.
- A managed install on your own VPS:
  - the installer runs the release's official image, verified against its attestations;
  - later releases install from the admin, with a backup taken first. If the new version does not start, it rolls back to the previous image where the release says that is safe;
  - an update with no database change backs up the database alone, and the admin shows how long the site was offline.
- Content in PostgreSQL and files in S3-compatible storage.
- Images for `amd64` and `arm64`.
- A small personal site runs on a 1 GB server with swap.

## Architecture

<img alt="How TomeCMS fits together: a visitor reads public pages that the chosen theme draws and the Astro server renders on every request; the site owner writes in the React admin, which calls the same server; the server keeps content in PostgreSQL and files in S3-compatible storage; Better Auth signs the owner in with a passkey; plugins can check a sign-in with Cloudflare Turnstile and suggest while writing through Jev (TypeSafe AI)." src="docs/tome-cms-overview.en.light.png#gh-light-mode-only">
<img alt="How TomeCMS fits together: a visitor reads public pages that the chosen theme draws and the Astro server renders on every request; the site owner writes in the React admin, which calls the same server; the server keeps content in PostgreSQL and files in S3-compatible storage; Better Auth signs the owner in with a passkey; plugins can check a sign-in with Cloudflare Turnstile and suggest while writing through Jev (TypeSafe AI)." src="docs/tome-cms-overview.en.dark.png#gh-dark-mode-only">

One Node.js process serves the public pages, the admin and both APIs, and PostgreSQL and the object store hold everything that lasts. [docs/tome-cms-overview.en.html](docs/tome-cms-overview.en.html) is the same diagram to explore, with a guided view of each path through it: download it and open it in a browser. A Thai edition sits beside it.

## Documentation

Everything else about TomeCMS is on its documentation site, in English at [dhanabhon.github.io/tome-cms](https://dhanabhon.github.io/tome-cms/) and in Thai at [dhanabhon.github.io/tome-cms/th](https://dhanabhon.github.io/tome-cms/th/).

| English | Thai | What it covers |
| --- | --- | --- |
| [Start here](https://dhanabhon.github.io/tome-cms/start/what-is-tomecms/) | [เริ่มต้นที่นี่](https://dhanabhon.github.io/tome-cms/th/start/what-is-tomecms/) | What TomeCMS is, and how to install it on a server of your own |
| [Running a site](https://dhanabhon.github.io/tome-cms/running/configuration/) | [ดูแลเว็บไซต์](https://dhanabhon.github.io/tome-cms/th/running/configuration/) | Configuration, updates, backups, and getting back in when you are locked out |
| [Using the admin](https://dhanabhon.github.io/tome-cms/admin/writing/) | [ใช้งานหน้าผู้ดูแล](https://dhanabhon.github.io/tome-cms/th/admin/writing/) | Each screen of the admin with a picture of it, from writing a post to reading the stats |
| [Plugins](https://dhanabhon.github.io/tome-cms/plugins/turnstile/) | [ปลั๊กอิน](https://dhanabhon.github.io/tome-cms/th/plugins/turnstile/) | What each plugin that ships with TomeCMS does, and how to switch it on |
| [Headless API](https://dhanabhon.github.io/tome-cms/api/overview/) | [Headless API](https://dhanabhon.github.io/tome-cms/th/api/overview/) | Read published content over HTTP, with a reference generated from the app's OpenAPI document |
| [Extending](https://dhanabhon.github.io/tome-cms/extending/themes/) | [ต่อยอด](https://dhanabhon.github.io/tome-cms/th/extending/themes/) | Write a theme or a plugin for TomeCMS |
| [Contributing](https://dhanabhon.github.io/tome-cms/contributing/setup/) | [ร่วมพัฒนา](https://dhanabhon.github.io/tome-cms/th/contributing/setup/) | Set up the code on your own computer, and send a change back |

## Contributing and security

To send a change, read [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, read [SECURITY.md](SECURITY.md), and never open an issue for it.

## License

TomeCMS is released under the [MIT License](LICENSE). The release images carry the DB-IP Lite country database, [IP Geolocation by DB-IP](https://db-ip.com), under CC BY 4.0.
