---
title: Bundled and headless
description: What TomeCMS serves and refuses in bundled and in headless mode, and how to switch between them.
sidebar:
  order: 2
---

`TOME_CMS_FRONTEND_MODE` decides who draws the public site. In bundled mode, the default, TomeCMS draws it with its theme. In headless mode TomeCMS stops drawing those pages, and a site or an app of your own reads the content from the [headless API](/tome-cms/api/overview/) and shows it to readers. The admin works the same way in both modes.

## What headless mode turns off

In headless mode these addresses answer `404` with the plain text `Not found.`:

| Address | What bundled mode serves there |
| --- | --- |
| `/` | A redirect to the home page in the site's default language. |
| `/th` and `/en` | The home page in each language. |
| `/th/blog/<slug>` and `/en/blog/<slug>` | A post. |
| `/th/<slug>` and `/en/<slug>` | A page. |
| `/blog/<slug>` | An older post address, which sends the reader on to the post. |
| `/sitemap.xml` | The sitemap. |
| `/rss.xml` | The RSS feed. |

What you set under "Redirects" in the admin works in bundled mode only, because the post and page addresses above are what follow those redirects. In headless mode an old address answers `404` like the rest, and the API does not report the move, so your own site has to send readers on from its old addresses.

## What stays in both modes

Everything else answers the same way in either mode:

- The admin, at the path you chose in the first-run wizard, and sign-in.
- `/install` and [`/recovery`](/tome-cms/running/recovery/).
- `/health/live` and `/health/ready`.
- `/media/<id>`, which sends the browser on to the file in the bucket.
- The headless API under `/api/v1/content/`, draft previews included.
- `/api/v1/stats/hit`, which counts readers.
- `/robots.txt`, with different rules in each mode.

The counting route is the one API route that behaves differently. In bundled mode it takes counts only from the site itself. In headless mode it takes them from any origin, so your own site can send them. [Counting readers from a headless site](/tome-cms/api/counting-readers/) explains how.

## What robots.txt says

In bundled mode `/robots.txt` lets crawlers in, keeps them out of `/api/`, and names the sitemap:

```text
User-agent: *
Allow: /
Disallow: /api/

User-agent: OAI-SearchBot
Allow: /
Disallow: /api/

Sitemap: https://cms.example.com/sitemap.xml
```

The sitemap's address comes from `TOME_CMS_PUBLIC_URL`.

In headless mode it asks every crawler to stay out of the whole CMS origin, because readers find your content on your own site:

```text
User-agent: *
Disallow: /

User-agent: OAI-SearchBot
Disallow: /
```

TomeCMS has no sitemap or feed to offer in this mode, so publish those from your own site.

## Switching modes

Set the mode in `.env.local` in the checkout. Add the line if the file does not have it yet:

```text
TOME_CMS_FRONTEND_MODE='headless'
```

Then run the deploy helper again:

```sh
./scripts/deploy-vps.sh
```

The application container takes its settings from `.env.local` when Compose creates it, so a new value applies only once the container is created again. The helper does that on every run, and keeps every other value in the file as it is. It reads `TOME_CMS_FRONTEND_MODE` from the file only, so exporting it in your shell changes nothing. [Configuration](/tome-cms/running/configuration/) has the rest of the settings and how the helper treats them.

To go back, set the value to `bundled` and run the helper again.

Switching changes only what the origin answers. Posts, pages, media and settings stay as they are. The admin's "View site" link still opens `/`, which answers `404` in headless mode.
