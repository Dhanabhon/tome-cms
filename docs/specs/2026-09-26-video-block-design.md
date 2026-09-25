# A video in an article

Date: 2026-09-26
Status: Design, approved section by section by the owner; for review before planning

A writer can put a YouTube or Vimeo clip in an article or page, and a reader can play it on the site.
Until the reader presses play, nothing on the page talks to YouTube or Vimeo, so the public site still
needs no consent banner. This is the one feature of 0.12.0.

## What was decided before this was written

Each of these was put to the owner as a question and chosen.

- **It ships in 0.12.0, before 1.0.0.** 0.11.0 declared a feature freeze; the owner lifts it once for
  this feature. 0.12.0 becomes the release the freeze starts from, and the release candidate is tested
  again on real HTTPS servers, `amd64` and `arm64`, before 1.0.0.
- **YouTube and Vimeo.** Facebook and TikTok are left out: their embeds load the provider's own
  scripts and have no mode that stops tracking. A video file of the site's own is a different feature
  (storage, bandwidth, the 25 MB upload limit) and is left out too.
- **The server fetches the poster once and keeps it.** The reader's browser never loads a thumbnail
  from `i.ytimg.com` or `i.vimeocdn.com`.
- **A pasted link becomes a video, and the menus offer one too.** A YouTube or Vimeo link pasted on an
  empty line turns into a video block. Pasted inside a sentence, it stays a link. "Video" also appears
  in the `+` menu and the `/` menu, which ask for a link.

## The block

A new node, `video`, in `src/lib/editor-video.ts`, shared by the editor and the server the way
`attachment` is (`src/lib/editor-attachment.ts`), so the card a writer sees and the HTML a reader gets
come from one definition.

| Attribute | What it holds |
|---|---|
| `provider` | `youtube` or `vimeo` |
| `videoId` | YouTube: 11 characters of `[A-Za-z0-9_-]`. Vimeo: digits. |
| `start` | Seconds to start at, from the link's `t=` or `#t=`, or `null` |
| `title` | The clip's title, from the provider, at most 200 characters, or empty |
| `mediaId` | The poster, a picture in this site's library, or `null`. Named as a picture's is, because the library finds a picture in use by `attrs.mediaId`. |

The node keeps no URL. Every address the site writes, the link to the provider and the player's, is
built from `provider` and `videoId`, so nothing a writer pastes reaches the page as an address.

### Links it understands

One parser, `parseVideoLink(text)` in `src/lib/editor-video.ts`, used by paste, by the menus, and by the
server.

- YouTube: `youtube.com/watch?v=`, `m.youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`,
  `youtube.com/embed/`, `youtube-nocookie.com/embed/`, with `t=90`, `t=1m30s` or `start=90`.
- Vimeo: `vimeo.com/<digits>`, `vimeo.com/channels/<name>/<digits>`, `player.vimeo.com/video/<digits>`,
  with `#t=90s`.
- Only `https:` and `http:`, and only those exact hosts (and `www.` where it applies). A host that only
  looks like one, such as `youtube.com.example.net`, is refused. A playlist link with no clip in it is
  refused.

### In the editor

The card shows the poster, the title and the provider's name, and moves and deletes like any block.
Adding one puts the card in at once and calls the admin API below. Until the answer comes the card
shows the clip's id and its provider; then the title and poster fill in. If the lookup falls short the
card stays, with no poster, and the editor says why in the admin's language, the way it does when a
picture fails to upload. The writer can still publish it.

### When the article is saved

`src/server/content/editor.ts` checks a `video` node the way it checks `attachment`: the provider is
one of the two, the id has its provider's shape, `start` is a whole number of seconds or `null`, the
title is text within its limit, and `mediaId`, when set, is a ready picture in this site's library.
`editorMediaIds()` counts the poster, so the public API lists it with the article's media, the
article's last-modified time follows it, and the library treats it as in use, as it does a picture in
the text.

## Finding the title and the poster

`POST /api/admin/videos` with `{ "link": "…" }`, owner only, behind `requireInstalledOwner` and
`assertSameOrigin` like the other admin routes, and limited to 30 lookups a minute per owner with the
in-memory limiter the Stats counter uses (`createRateLimit` in `src/server/stats/rules.ts`). It answers
`{ provider, videoId, start, title, mediaId, reason }`, where `reason` is `null` unless the lookup fell
short.

1. Parse the link with `parseVideoLink`. A link it does not understand is a `400`.
2. Ask the provider's oEmbed endpoint: `https://www.youtube.com/oembed?url=…&format=json` or
   `https://vimeo.com/api/oembed.json?url=…`. It gives the title and the thumbnail's address.
3. Fetch the thumbnail, only from `i.ytimg.com` or `i.vimeocdn.com`.
4. Keep it in the library through a new `importImage(ownerId, bytes, name)` in
   `src/server/media/service.ts`, which puts the object in the bucket and inspects it the way a
   finished upload is inspected. Its name is the clip's title.

Every outside request is `https:` only, to those four hosts only, follows no redirect to another host,
times out after 5 seconds, and reads at most 2 MB. A private or deleted clip, a slow provider or a
server with no way out gives an answer with `title: ''`, `mediaId: null` and `reason` set to
`unavailable` (the provider said no) or `unreachable` (no answer in time). The editor shows the reason in
the admin's language. None of these is an error the writer has to clear. With no title, the caption
names only the provider and the button reads "Play video".

## What a reader gets

The node's HTML:

```html
<figure class="tome-video">
  <a class="tome-video__play" href="https://www.youtube.com/watch?v=…&amp;t=30">
    <img src="/media/…" alt="" loading="lazy" decoding="async">
    <span class="tome-video__title">…</span>
  </a>
  <figcaption>… · YouTube</figcaption>
</figure>
```

- The stored HTML holds no words of the site's own, only the clip's title and the provider's name,
  because a document is rendered before its language is settled. The title span is read by screen
  readers and hidden from sight; with no title it holds the provider's name.
- With no poster, the link is a plain panel with the play mark.
- Without JavaScript, the link opens the clip on the provider's site.
- With JavaScript, a small script, included only on a page whose content has a video, labels each
  link "Play video: <title>" from `src/lib/i18n.ts` in the page's language, and on a click reads the
  clip back from the link's own address with `parseVideoLink` and puts the player in its place:
  - YouTube: `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&start=<s>`
  - Vimeo: `https://player.vimeo.com/video/<id>?dnt=1&autoplay=1#t=<s>s`
  - with `title` set to the clip's title, `allow="autoplay; encrypted-media; fullscreen;
    picture-in-picture"`, `allowfullscreen`, and `referrerpolicy="strict-origin-when-cross-origin"`,
    since YouTube refuses to play without a referrer. Focus moves to the player.
- The content filter in `src/lib/editor-content.ts` lets `figure` and `figcaption` through, with the
  classes `tome-video`, `tome-video__play` and `tome-video__title` only. It still drops `iframe` and `script`:
  a player exists only in a reader's browser, after a click, and never in stored HTML.
- `.tome-video` is styled once in `src/styles/global.css`, which every theme and the editor share, as
  the file card is: a 16:9 box with the play mark centred on the poster and the shared focus ring. A
  Short plays inside the 16:9 box.
- The Image lightbox plugin (`src/plugins/lightbox/client.ts`) skips a picture inside `.tome-video`, so
  the poster plays the clip rather than opening the lightbox.

### Privacy

Before a click, the page loads nothing from YouTube or Vimeo: the poster is the site's own file and the
link is only a link. The player loads because the reader pressed play, under a caption that names the
provider. The site sets no cookie and writes nothing to the browser for a video. With the defaults, the
public site still needs no consent banner for what TomeCMS itself does.

TomeCMS sets no Content Security Policy. An owner who sets one at the proxy must allow `frame-src`
`https://www.youtube-nocookie.com` and `https://player.vimeo.com`. The documentation says so.

## The headless API

No new public endpoint. A post's or page's `contentJson` carries the `video` node with its attributes,
`contentHtml` carries the HTML above, and the poster is in the item's `media` with its address and
size. A headless site can show `contentHtml` as it is, where each video is a picture that links to the
clip, add its own click script, or build a player from `contentJson`. The documentation's API overview
describes the node, since `contentJson` has no schema in the OpenAPI document.

## Verification

- Unit:
  - `parseVideoLink` takes every link form above and refuses look-alike hosts, other schemes and
    playlist-only links.
  - The save check refuses a bad provider, a bad id, a bad `start` and a poster that is not this site's.
  - The filter keeps `figure.tome-video` and still drops `iframe`.
  - The lookup, with `fetch` replaced, refuses other hosts and redirects to other hosts, stops at 2 MB
    and at the timeout, and turns a private clip into an answer with no poster.
- Integration: a saved article with a video lists its poster in the API's `media`, and the library will
  not delete a poster in use.
- End to end, on both Playwright projects:
  - Pasting a link on an empty line makes a card, pasting it in a sentence keeps a link, and the menus
    add one.
  - The published page makes no request to YouTube, Vimeo, `ytimg` or `vimeocdn` before a click.
  - A click puts in a player whose address is the `nocookie` or `dnt=1` one, with focus in it.
  - The link works with JavaScript off. The lightbox does not open on a poster.
  - The browser holds no cookie and no storage afterwards.
  - The admin API is answered in the browser with `page.route`, so no test reaches YouTube and the
    production code carries no switch for tests. The real lookup is covered by the unit tests.

## Release

- `CHANGELOG.md`: the Unreleased section becomes 0.12.0, with this feature under Added and the Stats
  change already there under Changed. The 0.11.0 line about the freeze stays as it was written, and
  0.12.0 says the freeze starts from it.
- `docs/releases/0.12.0.md`, and the version in `package.json`.
- `docs/plans/2026-09-24-road-to-1.0.0.md` gains the 0.12.0 row.
- The documentation site: the privacy page stops saying a bundled article cannot embed a clip, and says
  how a video loads; the Writing page covers the block if it is written after this lands, or gains it
  afterwards.

## Not in this design

| Left out | Why, or when to add it |
|---|---|
| Facebook, TikTok, other providers | Their embeds load tracking scripts; add one only with the same click-to-load rule |
| A video file of the site's own | Storage and bandwidth on a small server; a feature of its own |
| A portrait frame for Shorts | Plays in 16:9 for now; add an `aspect` attribute if writers ask |
| A caption the writer writes | The title and provider are the caption; add one if writers ask |
| Choosing another poster from the library | The fetched poster, or none; add a picker if writers ask |
| A Content Security Policy | TomeCMS sets none today; a policy is a change of its own |
