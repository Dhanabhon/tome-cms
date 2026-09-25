---
title: Counting readers from a headless site
description: Send views and reads from your own frontend so they appear on the admin's Stats screen.
sidebar:
  order: 2
---

The bundled theme counts its own readers for **Content → Stats** in the admin. A headless site has to send those counts itself. It posts them to `/api/v1/stats/hit`, the one route in the API that writes anything.

This is the whole request, sent from the reader's browser when a post opens:

```js
fetch('https://cms.example.com/api/v1/stats/hit', {
  body: JSON.stringify({
    event: 'view', kind: 'post', id: post.id, locale: 'th',
    referrer: document.referrer ? new URL(document.referrer).origin : undefined,
    width: innerWidth,
  }),
  headers: { 'Content-Type': 'application/json' },
  keepalive: true,
  method: 'POST',
});
```

The rest of this page is what each part of it means.

## The body

| Field | Required | What it must be |
| --- | --- | --- |
| `event` | Yes | `view` or `read` |
| `kind` | Yes | `home`, `post` or `page` |
| `id` | For a post or page | The `id` the content API gave the post or page in the reader's language. Leave it out for the home page |
| `locale` | Yes | `th` or `en`, the language the reader is reading |
| `referrer` | No | Where the reader came from, at most 2,048 characters. Send only its origin |
| `width` | Yes | The window's width in CSS pixels, a whole number from 1 to 20,000 |

Two rules tie the fields together. A post or page has an `id` and the home page has none. The home page is only ever a `view`, because it has no end to read to.

The server also checks that `id` names a post or page that is live now, in the language given. A hit that names a draft, or the other language's edition, is dropped.

The whole body may be at most 1 KB (1,024 bytes). The server keeps only the referrer's host, so send `new URL(document.referrer).origin` rather than the full address: a long path from your own site could push the body past the limit by itself.

## The headers

Send `Content-Type: application/json`. A body without it is dropped. On a headless site that header makes the browser send a preflight first, and in headless mode the route answers it with `Access-Control-Allow-Origin: *` and allows `POST` and the `Content-Type` header.

`keepalive: true` lets the request finish after the reader has left the page, as a beacon would. Use it with `fetch` rather than `navigator.sendBeacon`: a beacon sends a string as `text/plain`, which the route drops.

## The answer is always 204

The route answers `204 No Content` whether it counted the hit or not. Someone trying to inflate the numbers cannot tell which of their requests counted, and neither can your code. Do not wait on the answer or retry.

When a hit is dropped, the server's log gets a `stats_hit_dropped` line with a `reason`. That log is the place to look when a headless site's numbers stay at zero.

| `reason` | Why the hit was dropped |
| --- | --- |
| `cross-origin` | The site is in bundled mode, and the request did not come from the site itself |
| `not-json` | The `Content-Type` is not `application/json`, or the body is not JSON |
| `too-large` | The body is over 1 KB |
| `invalid` | A field breaks the rules above |
| `not-installed` | TomeCMS is not installed yet |
| `not-live` | `id` does not name a live post or page in that language |
| `bot` | The `User-Agent` is empty or says the sender is a bot or crawler |
| `rate-limited` | Too many hits from one address |

## When to send a view, and when a read

Send a `view` once per page per browser tab. A reload in the same tab is not a new view. Send a `read` once per post or page, when the reader has reached the end of the article and the tab has been visible for 15 seconds in all. For the home page, send `kind: 'home'` with no `id`, and only a `view`.

This is how the bundled theme does it, cut down to the parts you need. `page` is `{ kind, id, locale }` for the page on screen.

```js
function send(event, page) {
  fetch('https://cms.example.com/api/v1/stats/hit', {
    body: JSON.stringify({
      event, kind: page.kind, id: page.id, locale: page.locale,
      referrer: document.referrer ? new URL(document.referrer).origin : undefined,
      width: innerWidth,
    }),
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    method: 'POST',
  }).catch(() => {});
}

// True the first time this tab asks about this page and event.
function firstTime(event) {
  const key = `stats:${event}:${location.pathname}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {
    // No storage: this load counts.
  }
  return true;
}

if (firstTime('view')) send('view', page);

const article = document.querySelector('article');
if (page.kind !== 'home' && article) {
  const end = document.createElement('span');
  end.style.cssText = 'display: block; block-size: 1px;';
  article.append(end);

  let reachedEnd = false;
  let visibleSeconds = 0;
  const clock = setInterval(() => {
    if (document.visibilityState === 'visible') visibleSeconds += 1;
    check();
  }, 1000);
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) reachedEnd = true;
    check();
  });
  observer.observe(end);

  function check() {
    if (!reachedEnd || visibleSeconds < 15) return;
    clearInterval(clock);
    observer.disconnect();
    if (firstTime('read')) send('read', page);
  }
}
```

## Who to leave out

Send nothing for a reader whose browser has Do Not Track (`navigator.doNotTrack === '1'`) or Global Privacy Control (`navigator.globalPrivacyControl === true`) turned on. The server does not check for either, so your page has to.

Leave out your own browser too. The bundled theme recognises the owner by a mark the admin leaves in `localStorage` under `tomecms:stats-owner`. That mark belongs to the CMS's origin, and a headless site on another origin cannot read it. Give yourself a switch of your own, such as a `localStorage` flag on your site that your script checks before it sends anything.

## The limit per address

The server counts at most 120 hits from one address in ten minutes and drops the rest. An IPv6 address counts by its /64, so every address in that block shares one limit. The count lives in the application's memory and starts again when it restarts.

This is why the hit has to come from the reader's browser. Sent from your site's server, every reader would share that server's address and its one limit, and the Stats screen would place every reader in the server's country.

## Bundled mode

In bundled mode, the default, the route takes hits only from the site itself: a request whose `Origin` is the site's own, or a same-origin request that sent no `Origin`. It answers without CORS headers, so a browser on another origin never gets past the preflight. Set `TOME_CMS_FRONTEND_MODE=headless` before counting from a site of your own.

## What the server keeps

A hit adds one to a daily total. No cookie is set, and nothing that identifies the reader is stored. From each hit the server keeps the page, its language, whether it was a view or a read, the device and the referrer's host. A `width` under 768 counts as mobile and anything wider as desktop. The host is kept in lower case without `www.`, and a referrer on your headless site's own host, which the server reads from the request's `Origin`, counts as internal. The country comes from a CDN's `CF-IPCountry` header or from the reader's address, which is used for that lookup and for the limit and then dropped.

The numbers are estimates. Someone determined can add to them, up to the limit per address.

For the full shape of the request, see `postStatsHit` in the [API reference](/tome-cms/api/reference/). The read routes are on [Using the headless API](/tome-cms/api/overview/).
