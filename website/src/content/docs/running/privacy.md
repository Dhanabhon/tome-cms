---
title: What a reader's browser keeps
description: What TomeCMS writes to a reader's browser, what the server keeps when it counts a reader, and what reaches anyone else.
sidebar:
  order: 7
---

With its defaults, the public site sets no cookie for readers and writes nothing to a reader's browser until the reader makes a choice. Counting readers for "Stats" stores nothing on the reader's device. Take your site's privacy notice from this page.

## Counting readers

Every public page carries a short script that counts it for "Stats". It sets no cookie and writes nothing to `localStorage` or `sessionStorage`.

The script sends a `view` when a reader arrives at a page. A reload sends nothing, and neither does a step Back or Forward to the page: the browser keeps its own record of how each page was opened, and the script reads that instead of writing a mark of its own. For a post or page, it sends a `read` once the end of the article has come into view and the tab has been visible for 15 seconds in all. That happens at most once each time the page loads.

Nothing is sent from a browser with Do Not Track or Global Privacy Control turned on, or from your own browser.

Each count is a small request to `/api/v1/stats/hit`. It names the page, its language, whether it is a view or a read, the window's width and the origin the reader came from. It never names the reader. [Counting readers from a headless site](/tome-cms/api/counting-readers/) shows the request in full.

## What the server keeps

A count adds one to a total for the day. The server keeps one row a day for each combination of these, with a number of views and a number of reads on it:

- the post or page, or the home page
- its language
- the host the reader came from, in lower case and without `www.`, or `internal` for your own site
- the device: `mobile` for a window under 768 pixels wide, `desktop` otherwise
- the country, as a two-letter code

No row says who read anything. There is no address in it, no identifier, and no time finer than the day.

The country comes from your CDN's country header when there is one: `CF-IPCountry`, or the header `TOME_CMS_COUNTRY_HEADER` names. Otherwise the server looks the reader's address up in the DB-IP Lite country database, and without that file the country stays unknown. [Configuration](/tome-cms/running/configuration/) describes `TOME_CMS_COUNTRY_HEADER` and `TOME_CMS_GEOIP_PATH`.

The reader's address is used in memory and never stored. The server looks it up for the country when the CDN gave none, and counts the hits from it, so that one address adds at most 120 in ten minutes. That count lives in the application's memory and is gone when the application restarts. The address is not written to the database, and a dropped hit logs only the reason. The server reads the `User-Agent` header to leave out bots, and does not keep it either.

Your reverse proxy, and your CDN if you use one, may keep access logs of their own with addresses in them. Those are set up outside TomeCMS, so check what yours keep.

## What is written to the reader's browser

Only a choice the reader makes. Each one is kept in `localStorage` on the reader's device, stays there until the reader clears the site's data, and is never sent to the server.

| When the reader | Name | Value |
| --- | --- | --- |
| Picks "Light", "Dark" or "System" in the "Theme" control | `tome-theme` | `light`, `dark` or `system` |
| Closes a "Popup" | `popup-` followed by a short code made from the popup's content | `1` |
| Closes a "Sticky Banner" | `notice-` followed by a number made from its message | `1` |

The "Theme" control is on the site while "Let visitors choose light or dark" is on under "Themes", which it is by default. "Popup" and "Sticky Banner" are plugins, off until you switch them on, and a banner with "Readers can close it" off writes nothing. A new popup or a new message gets a new name, so a reader who closed the old one sees the new one.

Each of these remembers something the reader chose. Consent rules commonly treat storage like that as part of the service the reader asked for.

## Your own browser

Every admin page you open writes `tomecms:stats-owner` to `localStorage` in that browser, and the counting script sends nothing while it is there. Your own visits are left out even after you sign out, until you clear the site's data in that browser. A headless site on another origin cannot read this flag, and [Counting readers from a headless site](/tome-cms/api/counting-readers/) shows the one to set there instead.

Signing in to the admin uses cookies: one that holds your session, and a short-lived one while your passkey is checked. The admin has one account, yours, so readers never get either.

## Other services

By default the public pages load nothing from anyone else. The fonts are served by the site itself, and the pictures you upload come from your own object storage.

- Cloudflare Turnstile, when you switch it on, loads Cloudflare's script on the admin's sign-in form and nowhere else. Readers never meet it.
- "Jev (TypeSafe AI)" sends an article's text to TypeSafe AI only when you press one of its buttons in the editor, such as "Suggest from the text". Nothing a reader does reaches it.

An article's HTML keeps no `iframe` and no `script`, so an article on the bundled site cannot bring in another service's player or post. A picture can still come from elsewhere. An image pasted in from another website can keep its address there, and then each reader's browser fetches it from that site, which sees the reader's address and can set cookies of its own. Upload the picture to the File Manager instead.

On a headless site, your own frontend decides what it loads. A video or a post embedded from another service brings that service's cookies with it. Where the service offers a privacy-enhanced embed, use it: for YouTube, that is `youtube-nocookie.com`.

## Whether the site needs a consent banner

With the defaults, the public site needs no consent banner for what TomeCMS itself does. Counting stores nothing on the reader's device, and the only things written there are choices the reader made. A plugin you switch on can change that, and so can content that comes from another service.

This page describes what the software does. It is not legal advice. The rules differ from place to place, so check the ones that apply where you and your readers are.
