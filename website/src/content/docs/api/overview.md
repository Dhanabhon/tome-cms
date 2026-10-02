---
title: Using the headless API
description: Read a site's published posts, pages and settings over HTTP from another site or an app.
sidebar:
  order: 1
---

TomeCMS answers anonymous HTTP requests for what it has published. A site built with another framework, or a mobile app, can read the same posts and pages the bundled theme draws. The API is read-only and has no sign-in. It returns published content and nothing else: a draft, or a post scheduled for later, is not there until it goes live.

The API works in both frontend modes. In headless mode (`TOME_CMS_FRONTEND_MODE=headless`) TomeCMS stops drawing its own public pages, and the API becomes the way your content reaches readers.

The routes carry a version in their path. From 1.0.0, `/api/v1` changes only in ways that keep existing clients working, such as a new route or a new field. A change that would break a client gets a new path, such as `/api/v2`. The 0.x releases before it made no such promise.

## The routes

Every route answers `GET`, and `OPTIONS` for a browser's preflight.

| Route | Returns |
| --- | --- |
| `/api/v1/content/site` | The site's name, tagline, description, languages, time zone, author and brand images |
| `/api/v1/content/posts?locale=th` | Published posts in one language, newest first, a page at a time |
| `/api/v1/content/posts/{slug}?locale=th` | One published post |
| `/api/v1/content/pages?locale=th` | Published pages in one language, newest first, a page at a time |
| `/api/v1/content/pages/{slug}?locale=th` | One published page |
| `/api/v1/content/categories?locale=th` | The categories that published posts use |
| `/api/v1/content/navigation?locale=th` | The header and footer menus |
| `/api/v1/content/slides?locale=th` | The home page slides that are live now, in order, at most five |
| `/api/v1/content/openapi.json` | The OpenAPI 3.1 document that describes all of the above |

Each content route puts what it returns under `data`. The two lists add `meta` and `links`, and categories, navigation and slides add a `meta` with the language. A post or page has its HTML in `contentHtml` and the editor's own document in `contentJson`. The [reference](/tome-cms/api/reference/) lists every field.

A slug can be in Thai, because a Thai title gets a Thai address. Encode it when you build the path:

```js
const url = `https://cms.example.com/api/v1/content/posts/${encodeURIComponent(slug)}?locale=th`;
const { data: post } = await (await fetch(url)).json();
```

## A video in a post or page

The OpenAPI document does not describe the nodes inside `contentJson`, so here is the one for a video. It is a `video` node with five attributes:

| Attribute | What it holds |
| --- | --- |
| `provider` | `youtube` or `vimeo` |
| `videoId` | The clip's id: 11 letters, digits, `-` or `_` on YouTube, digits on Vimeo |
| `start` | The second of the clip to start at, or `null` |
| `title` | The clip's title from YouTube or Vimeo, up to 200 characters, or an empty string |
| `mediaId` | The id of the poster in the site's File Manager, or `null` when there is none |

The node holds no address. Build any you need from `provider` and `videoId`.

In `contentHtml` a writer's text colour is a `span` with one of six classes: `tome-color-red`, `tome-color-orange`, `tome-color-green`, `tome-color-blue`, `tome-color-purple` and `tome-color-grey`. The class names the colour and carries no value, so give each a colour of your own, ideally one for a light background and one for a dark one. Without that CSS the words keep the colour of the text around them.

In `contentHtml` a video is a `figure.tome-video`. Its link, `a.tome-video__play`, opens the clip on YouTube or Vimeo. The link holds the poster and a `span.tome-video__title` meant for screen readers, which the bundled site hides from sight, so hide it in your own styles too. The `figcaption` names the clip and its provider:

```html
<figure class="tome-video"><a class="tome-video__play" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=30" rel="noopener noreferrer"><img alt="" src="/media/66666666-6666-4666-8666-666666666666" decoding="async" loading="lazy" /><span class="tome-video__title">A clip</span></a><figcaption>A clip · YouTube</figcaption></figure>
```

The poster is in the item's `media`, with its address and size, as an image in the text is. Shown as it is, a video is an image that links to the clip. To play it in the page, add your own click handler, or build a player from `contentJson`. The bundled site loads its player only when the reader presses play, from `https://www.youtube-nocookie.com/embed/<videoId>?autoplay=1` or `https://player.vimeo.com/video/<videoId>?dnt=1&autoplay=1`. [What a reader's browser keeps](/tome-cms/running/privacy/) explains why.

## The navigation menus

`/api/v1/content/navigation` returns `header` and `footer`, each a list of items. An item has `href`, `kind`, `label`, `newTab` and `children`. `kind` is `home`, `page`, `custom` or `group`.

`children` is on every item, and is an empty list when there is nothing under it. Only the header has sub-items, one level deep, and a sub-item's own `children` is empty. A group is a label with no link, so its `kind` is `group` and its `href` is `null`. It is never in the footer, and it always has at least one child. A parent whose page is not published comes back as a group while any of its children is live, and a sub-item whose page is not published is left out.

```sh
curl -s 'https://cms.example.com/api/v1/content/navigation?locale=en' | jq '.data.header'
```

```json
[
  { "href": "/en", "kind": "home", "label": "Home", "newTab": false, "children": [] },
  {
    "href": null,
    "kind": "group",
    "label": "Company",
    "newTab": false,
    "children": [
      { "href": "/en/about", "kind": "page", "label": "About", "newTab": false, "children": [] },
      { "href": "/en/contact", "kind": "page", "label": "Contact", "newTab": false, "children": [] }
    ]
  }
]
```

`children` is new in 1.10.0, and so are `group` and a `null` `href`. A client written before then, if it ignores fields it does not know, keeps working until the owner adds a group or a sub-item to a header menu, since until then every `children` is empty (a client that checks responses strictly against the old schema will reject the new key at once) and every `href` is a string. After that, a client that ignores `children` sees only the top level, and a `null` `href` on each group. Read `children`, and treat a `null` `href` as a label, not a link.

## The locale parameter

`locale` is `th` or `en`. Every route whose content is in one language needs it: posts, pages, categories, navigation and slides. Without it the answer is `400`.

The Thai and English editions of a post or page are two separate items, each with its own slug. They share a `translationGroupId`, and each lists the live editions in `translations`.

The routes are strict about their parameters. A parameter a route does not know is a `400`, so a typo fails instead of being ignored. `/site` and `/openapi.json` take no parameters at all.

## Pages of results

The lists of posts and pages come a page at a time, newest first. `limit` sets how many, from 1 to 50, and is 20 when you leave it out. `category` narrows the posts to one category by its name, and case does not matter. `q` searches them, as [Searching the posts](#searching-the-posts) describes.

When there are more, `meta.hasMore` is `true` and `links.next` is the address of the next page. On the last page `links.next` is `null`.

```sh
curl -s 'https://cms.example.com/api/v1/content/posts?locale=th&limit=2' | jq '{meta, links}'
```

```json
{
  "meta": {
    "locale": "th",
    "limit": 2,
    "hasMore": true
  },
  "links": {
    "next": "https://cms.example.com/api/v1/content/posts?locale=th&limit=2&cursor=eyJ2IjoxLCJyZXNvdXJjZSI6InBvc3RzIi..."
  }
}
```

Follow `links.next` as it is. It keeps your `locale`, `limit`, `category` and `q` and adds a `cursor`. This loop prints the slug of every English post:

```sh
url='https://cms.example.com/api/v1/content/posts?locale=en&limit=50'
while [ "$url" != null ]; do
  body=$(curl -s "$url")
  echo "$body" | jq -r '.data[].slug'
  url=$(echo "$body" | jq -r '.links.next')
done
```

The server signs each cursor and ties it to the query it came from. Keep the cursor but change `limit`, `category` or `q`, or edit the cursor by hand, and the answer is `400` with `Invalid pagination cursor.` The signature uses `TOME_CMS_CONTEXT_SECRET`, so changing that secret makes every earlier cursor invalid.

## Searching the posts

`q` narrows the posts to those that contain every word of it, in the title, the excerpt or the text. Case does not matter. It takes up to 100 characters and only the first five words count, and a `q` with no word in it is a `400`. `category`, `limit` and `cursor` work with it, and `links.next` keeps it.

This prints the titles of the English posts that mention compost:

```sh
curl -s 'https://cms.example.com/api/v1/content/posts?locale=en&q=compost' | jq -r '.data[].title'
```

The search is a substring match, which is what makes it work in Thai, where words are not separated by spaces. Posts come newest first, as they always do, and are not ranked by how well they match.

A search reads every post of the language, so a sender may make 60 a minute, and no more than two searches run at once. Past either, the answer is a `429` with a `Retry-After` of 60 seconds. A list with no `q` is never held back. A sender is the address your server's proxy reports for the request, and searches from the home page count toward the same 60. A headless site that fetches from its own server is therefore one sender for all its visitors: have the visitor's browser call the API, or keep what your server fetches for a minute.

## Caching

Every successful answer carries an `ETag` and a `Last-Modified` header, with `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`. A browser or a CDN may keep an answer for a minute. `/openapi.json` may be kept for a day.

Send the `ETag` back in `If-None-Match`, or the `Last-Modified` time in `If-Modified-Since`. If nothing has changed, the answer is `304 Not Modified` with no body. When a request sends both, `If-None-Match` decides.

```sh
etag=$(curl -si 'https://cms.example.com/api/v1/content/site' | awk -F': ' 'tolower($1) == "etag" { print $2 }' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $etag" 'https://cms.example.com/api/v1/content/site'
# 304
```

The `ETag` is a hash of the body, so it changes whenever anything in the answer does. Errors are sent with `Cache-Control: no-store` and are never cached.

## Cross-origin requests

Every public answer, errors included, carries `Access-Control-Allow-Origin: *`. A page on any origin can call the API from the browser. The preflight allows `GET` and `OPTIONS` with the `If-None-Match` and `If-Modified-Since` headers, and a browser may remember it for a day.

There is nothing to sign in with, so send no credentials. A browser refuses a wildcard answer to a request made with `credentials: 'include'`.

## Errors

An error comes back as `application/problem+json`, with `type`, `title`, `status`, `detail`, `instance` (the path that was asked for) and `requestId`.

| Status | When |
| --- | --- |
| `400` | A parameter is missing, unknown or out of range, or the cursor is not valid |
| `404` | No published post or page has that slug in that language |
| `429` | A search was asked for too often, or two others are already running; wait for `Retry-After` |
| `500` | The request could not be completed |
| `503` | The site is not ready, or it is closed for maintenance |

Every answer has an `X-Request-ID` header, and the server's log records the same ID. Quote it when you report a problem.

All of this applies once TomeCMS is installed. Before that, every route answers `503` with a plain JSON body whose `setupUrl` is `/install`, and with no `X-Request-ID` or CORS header.

## When the site is closed for maintenance

While the owner has closed the site for maintenance, the content routes answer `503`, and the error carries one more field, `maintenance`, with what the owner wrote for visitors:

```json
{
  "detail": "The site is closed for maintenance.",
  "instance": "/api/v1/content/posts",
  "maintenance": {
    "backAt": "2026-10-01T09:00:00.000Z",
    "heading": "Back on Thursday",
    "locale": "en",
    "message": "We are moving to a new server."
  },
  "requestId": "0b7c6a52-3f1e-4d2a-9a55-2f4c1d8e9b10",
  "status": 503,
  "title": "Service Unavailable",
  "type": "about:blank"
}
```

The words are in the language the request's `locale` asks for, or the site's default language when it names none. If the owner wrote nothing, they are TomeCMS's own default words. `backAt` is `null` unless the owner set a return time. While that time is still ahead, the answer also has a `Retry-After` header. Show the heading and the message in place of your pages until the API answers again.

`/openapi.json` and draft previews stay open. The preflight is still answered as usual, which lets a browser on another origin read the `503`.

## Draft previews

The public routes never return a draft. For the owner to see a draft on the headless site before publishing it, TomeCMS issues preview tokens.

`POST /api/admin/previews` with a JSON body such as `{"contentType": "post", "contentId": "<the post's id>"}` issues one. The request needs the owner's session and has to come from the CMS's own origin. The admin has no button that calls it. The answer is `201` with `{"url": "/api/v1/content/preview/<token>"}`. A `GET` on that address returns the draft under `data.content`, shaped like a published post or page, with `data.contentType` beside it.

A token lasts 30 minutes. Issuing a new one for the same post or page revokes the one before it. An unknown, expired or revoked token is a `404`.

Previews are private. The answer has `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`, and no CORS header, so a browser on another origin cannot read it. Fetch a preview from your site's server, not from a reader's browser. The preview routes are left out of the OpenAPI document, which describes only the public contract.

## The contract

`/api/v1/content/openapi.json` is the API's contract: an OpenAPI 3.1 document of every public route, its parameters and its answers. It comes from the same code that answers the requests, so it describes the installation that serves it. Generate a typed client from it, or read it to see what your version supports.

The [API reference](/tome-cms/api/reference/) on this site is generated from the same document in the repository.

The one route that writes has a page of its own: [Counting readers from a headless site](/tome-cms/api/counting-readers/).
