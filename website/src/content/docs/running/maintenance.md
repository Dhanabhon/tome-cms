---
title: Maintenance mode
description: Close the site to visitors while you work on it, choose the page they see instead, and open it again.
sidebar:
  order: 6
---

"Maintenance" in the admin, under "Settings", closes the public site while you work on it. Visitors get a maintenance page in place of every page they ask for. You still see the site as usual while you are signed in, and the admin works as always.

## What visitors see

While the site is closed, every public page answers `503` with the maintenance page, at the address the visitor asked for. That covers the home pages, posts, pages and older post addresses. The page speaks the language of the address, `/th/` or `/en/`, and the site's default language anywhere else.

TomeCMS draws this page itself rather than through the theme, so a theme broken by the work you are doing cannot break the maintenance page too. It carries a `noindex` tag, and the `503` status tells search engines that the closure is temporary.

The page shows a heading and a message, which you write for each language. Left empty, the heading is "Down for maintenance" in English and "ปิดปรับปรุงชั่วคราว" in Thai, with a short line saying you will be back soon. The admin shows these default words in grey in the empty fields. A heading takes up to 80 characters, and a message up to 280.

`/sitemap.xml` and `/rss.xml` answer `503` as well, with the plain text `The site is closed for maintenance.`

## The four templates

| Template | What the page shows |
| --- | --- |
| "Minimal" | The heading, the message and the site's name. |
| "Logo" | The site's logo above the words, or the site's name when there is no logo. |
| "Picture" | A picture from the File Manager behind the words. This template needs a picture. |
| "Countdown" | A clock counting down the days, hours, minutes and seconds to the return time. This template needs a return time. |

For "Picture", the admin warns about a picture over 800 KB, which keeps visitors waiting, and one under 1,600 pixels wide, which looks soft on a wide screen. While the page uses a picture, the File Manager refuses to delete it and names "The maintenance page" as what uses it.

## The return time

Under "Back around", "Date and time" sets when you expect to open the site again. It is optional, except for "Countdown". You enter it in your device's time, and the page shows it in the site's time zone, as "Back around" followed by the date and time.

While the time is still ahead, every `503` the closed site sends carries a `Retry-After` header with that time, and search engines are told when to come back. Once it has passed, the page says "Back any moment now" instead, and `Retry-After` is no longer sent.

The site never reopens by itself. The return time is only what visitors are told, and the site stays closed until you switch it back.

## Closing the site

1. Open "Settings", then "Maintenance".
2. Choose a template, write the words in each language tab, and set the picture and the return time if you want them. Press "Save". The page is saved apart from the switch, so saving does not close the site.
3. "Preview" opens the saved page in a new tab. It shows the last saved version, not unsaved changes.
4. Under "Status", turn on "Close the site for maintenance". The admin asks "Close the site to visitors?". Press "Close the site", and visitors see the maintenance page at once.

The switch stays off while there are unsaved changes, with the hint "Save your changes before turning maintenance on." You can still change the page and save it while the site is closed, and visitors see the new version on their next request.

To open the site, turn the same switch off. It asks nothing, and the page says "Maintenance is off. The site is open again."

## What stays open

Only readers' pages, the feeds and the content API close. Everything else answers as usual:

- The admin, at the path you chose, and sign-in, including [`/recovery`](/tome-cms/running/recovery/).
- `/health/live` and `/health/ready`.
- `/media/<id>` and the files in the bucket, so a picture on the maintenance page still loads.
- `/robots.txt`.
- `/api/v1/stats/hit`.
- `/api/v1/content/openapi.json` and draft previews.

## While you are signed in

The signed-in owner passes through and sees the site as it is. Every public page then opens with a bar that says "The site is closed for maintenance. Visitors see the maintenance page." with a "Maintenance settings" link. The pages you see this way are sent as private, so no cache keeps them and passes them on to a visitor.

In the admin, every screen but "Maintenance" opens with the notice "The site is closed for maintenance" and "Visitors see the maintenance page until you turn it off.", beside a "Maintenance settings" button.

## The content API

While the site is closed, the routes under `/api/v1/content/` answer `503` too. The answer carries your heading, message and return time in a `maintenance` field, in the language the request asks for or else the site's default, so a headless site can draw its own maintenance page. It has the same `Retry-After` header while the return time is ahead. [The headless API](/tome-cms/api/overview/) shows the whole answer.

In headless mode, TomeCMS's own public pages already answer `404`, so the API's `503` is the only sign of maintenance your site gets. [Bundled and headless](/tome-cms/running/modes/) explains the two modes.
