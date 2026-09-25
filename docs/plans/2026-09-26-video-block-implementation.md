# A video in an article: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A writer puts a YouTube or Vimeo clip in an article or page; a reader plays it on the site, and nothing on the page talks to YouTube or Vimeo until the reader presses play.

**Architecture:** One link parser with no dependencies (`src/lib/video-link.ts`) is shared by the editor, the server and the reader's page. A Tiptap node, `video` (`src/lib/editor-video.ts`), is shared by the editor and the server like `attachment`, and stores the provider, the clip's id, a start time, the title and the poster's `mediaId`. An admin route fetches the title and poster once through oEmbed and keeps the poster in the library. The stored HTML is a poster that links to the clip; a small script on the reader's page puts the player in its place on a click.

**Tech Stack:** Astro 7.3.3, Tiptap 3.31.3, sanitize-html 2.17.7, zod 4.5.4, sharp 0.35.4, Kysely/PostgreSQL 17, S3 (SeaweedFS in tests), `node --test` with `tsx`, Playwright.

**Spec:** `docs/specs/2026-09-26-video-block-design.md`

## Global Constraints

- YouTube and Vimeo only. No other provider, and no video file of the site's own.
- The server reaches exactly four hosts for a video, `https:` only: `www.youtube.com`, `vimeo.com`, `i.ytimg.com`, `i.vimeocdn.com`. Every request has `redirect: 'error'`, one 5 second deadline for the whole lookup, and reads at most 2 MB.
- 30 lookups a minute per owner, with `createRateLimit` from `src/server/stats/rules.ts`.
- The node stores no URL. Every address the site writes is built from `provider` and `videoId`.
- Stored HTML never contains `iframe` or `script`. The player exists only in a reader's browser, after a click.
- Before a click the reader's page makes no request to YouTube, Vimeo, `ytimg` or `vimeocdn`, sets no cookie and writes nothing to browser storage for a video.
- The player addresses are `https://www.youtube-nocookie.com/embed/<id>?autoplay=1[&start=<s>]` and `https://player.vimeo.com/video/<id>?dnt=1&autoplay=1[#t=<s>s]`.
- No new dependencies. Node 22.12 or later.
- Every admin string exists in `en` and `th` in `src/lib/admin-i18n.ts`, in the same order (`tests/unit/admin-i18n.test.ts` enforces it); every public string in both branches of `publicCopy` in `src/lib/i18n.ts`.
- Copy and documentation: no em dash (—) and no en dash (–), straight quotes, plain words.
- Repository rules: never `git stash`, `git reset --hard`, `git checkout --`, `git clean`, `git add -A` or `git add .`; stage by explicit path. Commit messages go in a file under the session scratchpad and are committed with `git commit -F <file>` in a Bash call of their own, conventional prefixes, and **no attribution lines of any kind**. A hook blocks one Bash command containing both "git commit" and a `-n` flag.
- Never touch port 4321 or the containers `tome-cms-postgres-1` and `tome-cms-seaweedfs-1`. Integration tests and e2e specs bring up their own Compose stacks on ports 55432/59000: one at a time, `uptime` first, and wait while the load is above 15.
- Gates run one at a time, in the foreground, with a 600000 ms timeout: `npm run check`, `npm run test:unit`, `npm run test:integration` (or one file: `node scripts/test-foundation.mjs <file>`), `npx playwright test <spec>`.

## Files

| File | What it is for | Task |
|---|---|---|
| `src/lib/video-link.ts` (new) | Parse a link into `{ provider, videoId, start }`; build the watch, player and oEmbed addresses. No imports. | 1 |
| `src/lib/editor-video.ts` (new) | The `video` node, `videoAttrs()`, `documentHasVideo()` | 1 |
| `src/lib/editor-content.ts` | Sanitizer lets the video's HTML through; `hasMeaningfulContent` counts a video | 2 |
| `src/server/content/editor.ts` | Registers the node, checks it on save, counts its poster in `editorMediaIds` | 2 |
| `src/server/video/lookup.ts` (new) | oEmbed and poster fetch, bounded and host-locked, with an injectable `fetch` | 3 |
| `src/server/media/service.ts` | `importImage()`: keep a server-fetched picture in the library | 3 |
| `src/server/video/resolve.ts` (new) | Parse, look up, keep the poster: what the route answers | 3 |
| `src/pages/api/admin/videos.ts` (new) | `POST /api/admin/videos` | 3 |
| `src/components/admin/editor/video-insert.ts` (new) | Insert a clip, fill in its title and poster, paste and menu handlers | 4 |
| `src/components/admin/DocumentCanvas.tsx`, `BlockInsertMenu.tsx`, `editor/slash-items.tsx` | The card, the paste path, the two menus | 4 |
| `src/lib/admin-i18n.ts` | The editor's words for a video | 4 |
| `src/styles/global.css` | `.tome-video` for every theme and the editor | 4, 5 |
| `src/components/VideoScript.astro` (new) | The reader's script: label, and player on click | 5 |
| `src/layouts/BaseLayout.astro`, the two public routes, the two preview pages | Include the script where a document has a video | 5 |
| `src/lib/i18n.ts` | "Play video" in both languages | 5 |
| `src/plugins/lightbox/client.ts` | Leave a poster to its video | 5 |
| `CHANGELOG.md`, `docs/releases/0.12.0.md`, `package.json`, `package-lock.json`, `README.md`, `docs/plans/2026-09-24-road-to-1.0.0.md` | Release 0.12.0 | 6 |

---

### Task 1: The link parser and the node

**Files:**
- Create: `src/lib/video-link.ts`
- Create: `src/lib/editor-video.ts`
- Test: `tests/unit/video-link.test.ts`, `tests/unit/editor-video.test.ts`

**Interfaces:**
- Produces, in `src/lib/video-link.ts`:
  - `type VideoProvider = 'youtube' | 'vimeo'`
  - `interface VideoLink { provider: VideoProvider; videoId: string; start: number | null }`
  - `const VIDEO_PROVIDER_NAMES: Record<VideoProvider, string>`
  - `const MAX_VIDEO_TITLE = 200`
  - `isVideoId(provider: VideoProvider, id: string): boolean`
  - `startSeconds(value: string | null | undefined): number | null`
  - `parseVideoLink(text: string): VideoLink | null`
  - `videoWatchUrl(clip: VideoLink): string`, `videoPlayerUrl(clip: VideoLink): string`, `videoOembedUrl(clip: VideoLink): string`
- Produces, in `src/lib/editor-video.ts`:
  - `interface VideoAttrs extends VideoLink { title: string; mediaId: string | null }`
  - `videoAttrs(value: unknown): VideoAttrs | null`
  - `documentHasVideo(node: VideoTree): boolean`, where `interface VideoTree { type?: string; content?: VideoTree[] }`
  - `const video` (a Tiptap `Node` named `video`)

- [ ] **Step 1: Write the parser's failing test**

Create `tests/unit/video-link.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVideoLink, startSeconds, videoOembedUrl, videoPlayerUrl, videoWatchUrl } from '../../src/lib/video-link';

const ID = 'dQw4w9WgXcQ';

test('every YouTube link form gives the same clip', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
  ]) assert.deepEqual(parseVideoLink(link), { provider: 'youtube', start: null, videoId: ID }, link);
});

test('every Vimeo link form gives the same clip', () => {
  for (const link of [
    'https://vimeo.com/76979871',
    'https://www.vimeo.com/76979871',
    'https://vimeo.com/channels/staffpicks/76979871',
    'https://player.vimeo.com/video/76979871',
  ]) assert.deepEqual(parseVideoLink(link), { provider: 'vimeo', start: null, videoId: '76979871' }, link);
});

test('a start time is read in seconds, minutes and hours', () => {
  assert.equal(parseVideoLink(`https://youtu.be/${ID}?t=90`)?.start, 90);
  assert.equal(parseVideoLink(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start, 90);
  assert.equal(parseVideoLink(`https://www.youtube.com/embed/${ID}?start=42`)?.start, 42);
  assert.equal(parseVideoLink('https://vimeo.com/76979871#t=1m5s')?.start, 65);
  assert.equal(startSeconds('1h2m3s'), 3723);
  assert.equal(startSeconds('0'), null);
  assert.equal(startSeconds('soon'), null);
  assert.equal(startSeconds(''), null);
});

test('anything else is not a video', () => {
  for (const link of [
    `https://youtube.com.example.net/watch?v=${ID}`,
    `https://example.com/watch?v=${ID}`,
    `javascript:alert(1)//https://youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?v=short',
    'https://vimeo.com/76979871/abcdef',
    'https://vimeo.com/channels/staffpicks',
    'not a link',
    '',
  ]) assert.equal(parseVideoLink(link), null, link);
});

test('the addresses the site writes are built from the provider and id alone', () => {
  const clip = { provider: 'youtube' as const, start: 30, videoId: ID };
  assert.equal(videoWatchUrl(clip), `https://www.youtube.com/watch?v=${ID}&t=30`);
  assert.equal(videoPlayerUrl(clip), `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&start=30`);
  assert.equal(videoOembedUrl(clip), `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}`);
  const vimeo = { provider: 'vimeo' as const, start: null, videoId: '76979871' };
  assert.equal(videoWatchUrl(vimeo), 'https://vimeo.com/76979871');
  assert.equal(videoPlayerUrl(vimeo), 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1');
  assert.equal(videoPlayerUrl({ ...vimeo, start: 5 }), 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1#t=5s');
  assert.equal(videoOembedUrl(vimeo), `https://vimeo.com/api/oembed.json?url=${encodeURIComponent('https://vimeo.com/76979871')}`);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test tests/unit/video-link.test.ts`
Expected: FAIL, `Cannot find module '../../src/lib/video-link'`.

- [ ] **Step 3: Write the parser**

Create `src/lib/video-link.ts`:

```ts
/**
 * A YouTube or Vimeo clip, read from a link a writer pastes, and every address the site writes for
 * it. Nothing here imports the editor, so a reader's page can use it without loading Tiptap.
 */
export type VideoProvider = 'youtube' | 'vimeo';

export interface VideoLink {
  provider: VideoProvider;
  videoId: string;
  /** Seconds into the clip to start at, or null. */
  start: number | null;
}

export const VIDEO_PROVIDER_NAMES: Record<VideoProvider, string> = { vimeo: 'Vimeo', youtube: 'YouTube' };
export const MAX_VIDEO_TITLE = 200;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const MAX_START = 24 * 60 * 60;

export function isVideoId(provider: VideoProvider, id: string): boolean {
  return provider === 'youtube' ? YOUTUBE_ID.test(id) : VIMEO_ID.test(id);
}

/** `90`, `90s`, `1m30s` or `1h2m3s` as whole seconds; anything else, or zero, is no start. */
export function startSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 && seconds <= MAX_START ? seconds : null;
}

/** The clip a link points at, or null for anything that is not one YouTube or Vimeo clip. */
export function parseVideoLink(text: string): VideoLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) return youtube(url, host);
  if (VIMEO_HOSTS.has(host)) return vimeo(url, host);
  return null;
}

function youtube(url: URL, host: string): VideoLink | null {
  const path = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'youtu.be') id = path.length === 1 ? path[0] : undefined;
  else if (path.length === 1 && path[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
  else if (path.length === 2 && (path[0] === 'shorts' || path[0] === 'embed')) id = path[1];
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { provider: 'youtube', start: startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start')), videoId: id };
}

function vimeo(url: URL, host: string): VideoLink | null {
  const path = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'player.vimeo.com') id = path.length === 2 && path[0] === 'video' ? path[1] : undefined;
  else if (path.length === 1) id = path[0];
  else if (path.length === 3 && path[0] === 'channels') id = path[2];
  if (!id || !VIMEO_ID.test(id)) return null;
  return { provider: 'vimeo', start: startSeconds(/^#t=(.+)$/.exec(url.hash)?.[1]), videoId: id };
}

/** The clip's own page: where the link goes when no script plays it in place. */
export function videoWatchUrl({ provider, start, videoId }: VideoLink): string {
  if (provider === 'youtube') return `https://www.youtube.com/watch?v=${videoId}${start ? `&t=${start}` : ''}`;
  return `https://vimeo.com/${videoId}${start ? `#t=${start}s` : ''}`;
}

/** The player, loaded only after a reader presses play: YouTube's no-cookie host, Vimeo's do-not-track mode. */
export function videoPlayerUrl({ provider, start, videoId }: VideoLink): string {
  if (provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1${start ? `&start=${start}` : ''}`;
  return `https://player.vimeo.com/video/${videoId}?dnt=1&autoplay=1${start ? `#t=${start}s` : ''}`;
}

/** Where the provider tells the server a clip's title and poster. */
export function videoOembedUrl({ provider, videoId }: VideoLink): string {
  const page = videoWatchUrl({ provider, start: null, videoId });
  return provider === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(page)}`;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `node --import tsx --test tests/unit/video-link.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the node's failing test**

Create `tests/unit/editor-video.test.ts`. It builds its own schema, as `tests/unit/editor-attachment.test.ts` does:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { DOMParser, DOMSerializer, Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createHTMLDocument, parseHTML } from 'zeed-dom';

import { documentHasVideo, video, videoAttrs } from '../../src/lib/editor-video';

const schema = getSchema([StarterKit, video]);
const POSTER = '55555555-5555-4555-8555-555555555555';
const ID = 'dQw4w9WgXcQ';

const parse = (html: string) => JSON.parse(JSON.stringify(DOMParser.fromSchema(schema).parse(parseHTML(html) as unknown as globalThis.Node).toJSON()));

function serialize(attrs: Record<string, unknown>): string {
  const document = Node.fromJSON(schema, { type: 'doc', content: [{ type: 'video', attrs }] });
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(document.content, { document: createHTMLDocument() as unknown as Document });
  return (fragment as unknown as { render(): string }).render();
}

test('a video that goes through the clipboard comes back the same video', () => {
  for (const attrs of [
    { mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip worth watching', videoId: ID },
    { mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '76979871' },
  ]) assert.deepEqual(parse(serialize(attrs)).content?.[0], { type: 'video', attrs });
});

test('the HTML is a poster that links to the clip, with no player and no words of the site', () => {
  const html = serialize({ mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip', videoId: ID });
  assert.match(html, /^<figure class="tome-video"><a class="tome-video__play" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&(amp;)?t=30">/);
  assert.match(html, new RegExp(`<img alt="" src="/media/${POSTER}">`));
  assert.match(html, /<span class="tome-video__title">A clip<\/span><\/a><figcaption>A clip · YouTube<\/figcaption><\/figure>$/);
  assert.doesNotMatch(html, /iframe|script|data-/);
  const untitled = serialize({ mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '76979871' });
  assert.match(untitled, /<span class="tome-video__title">Vimeo<\/span><\/a><figcaption>Vimeo<\/figcaption>/);
  assert.doesNotMatch(untitled, /<img/);
});

test('a figure that is not one of ours is not a video', () => {
  assert.notEqual(parse('<figure class="tome-video"><a class="tome-video__play" href="https://example.com/x">x</a></figure>').content?.[0]?.type, 'video');
});

test('only a clip of the right shape is a stored video', () => {
  const good = { mediaId: POSTER.toUpperCase(), provider: 'youtube', start: 30, title: '  A clip  ', videoId: ID };
  assert.deepEqual(videoAttrs(good), { mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip', videoId: ID });
  assert.deepEqual(videoAttrs({ provider: 'vimeo', title: '', videoId: '1' }), { mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '1' });
  for (const bad of [
    null,
    { ...good, provider: 'tiktok' },
    { ...good, videoId: 'short' },
    { ...good, provider: 'vimeo' },
    { ...good, start: 0 },
    { ...good, start: 1.5 },
    { ...good, start: 86_401 },
    { ...good, title: 'x'.repeat(201) },
    { ...good, title: 3 },
    { ...good, mediaId: '/media/x' },
    { ...good, src: 'https://evil.example/x' },
  ]) assert.equal(videoAttrs(bad), null, JSON.stringify(bad));
});

test('a document knows whether it holds a video', () => {
  assert.equal(documentHasVideo({ type: 'doc', content: [{ type: 'paragraph' }] }), false);
  assert.equal(documentHasVideo({ type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'video' }] }] }), true);
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `node --import tsx --test tests/unit/editor-video.test.ts`
Expected: FAIL, `Cannot find module '../../src/lib/editor-video'`.

- [ ] **Step 7: Write the node**

Create `src/lib/editor-video.ts`:

```ts
import { Node } from '@tiptap/core';

import { isVideoId, MAX_VIDEO_TITLE, parseVideoLink, VIDEO_PROVIDER_NAMES, videoWatchUrl, type VideoLink } from './video-link';

/** A stored video. `mediaId` is the poster, named as a picture's is so the library sees it in use. */
export interface VideoAttrs extends VideoLink {
  title: string;
  mediaId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_PATH = /^\/media\/([0-9a-f-]{36})$/i;
const MAX_START = 24 * 60 * 60;

/** The attributes a stored video may have, or null. Anything else on the node is dropped. */
export function videoAttrs(value: unknown): VideoAttrs | null {
  if (!value || typeof value !== 'object') return null;
  const { mediaId, provider, start, title, videoId } = value as Record<string, unknown>;
  if (provider !== 'youtube' && provider !== 'vimeo') return null;
  if (typeof videoId !== 'string' || !isVideoId(provider, videoId)) return null;
  if (start !== null && start !== undefined
    && !(typeof start === 'number' && Number.isInteger(start) && start > 0 && start <= MAX_START)) return null;
  if (typeof title !== 'string' || title.length > MAX_VIDEO_TITLE) return null;
  if (mediaId !== null && mediaId !== undefined && (typeof mediaId !== 'string' || !UUID.test(mediaId))) return null;
  return {
    mediaId: typeof mediaId === 'string' ? mediaId.toLowerCase() : null,
    provider,
    start: typeof start === 'number' ? start : null,
    title: title.trim(),
    videoId,
  };
}

export interface VideoTree {
  type?: string;
  content?: VideoTree[];
}

/** Whether a document holds a video: a page with one loads the small script that plays it. */
export function documentHasVideo(node: VideoTree): boolean {
  return node.type === 'video' || (node.content ?? []).some(documentHasVideo);
}

export const video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    // Read from the figure as a whole by the rule below, as the attachment card is.
    return {
      mediaId: { default: null, rendered: false, parseHTML: () => null },
      provider: { default: 'youtube', rendered: false, parseHTML: () => null },
      start: { default: null, rendered: false, parseHTML: () => null },
      title: { default: '', rendered: false, parseHTML: () => null },
      videoId: { default: '', rendered: false, parseHTML: () => null },
    };
  },

  parseHTML() {
    return [{
      tag: 'figure.tome-video',
      priority: 51,
      getAttrs: (element) => {
        const clip = parseVideoLink(element.querySelector('a.tome-video__play')?.getAttribute('href') ?? '');
        if (!clip) return false;
        const text = (element.querySelector('.tome-video__title')?.textContent ?? '').trim().slice(0, MAX_VIDEO_TITLE);
        return {
          ...clip,
          mediaId: MEDIA_PATH.exec(element.querySelector('img')?.getAttribute('src') ?? '')?.[1]?.toLowerCase() ?? null,
          // With no title the span holds the provider's name, which is not a title.
          title: text === VIDEO_PROVIDER_NAMES[clip.provider] ? '' : text,
        };
      },
    }];
  },

  renderHTML({ node }) {
    const attrs = node.attrs as VideoAttrs;
    const name = VIDEO_PROVIDER_NAMES[attrs.provider];
    const poster = attrs.mediaId ? [['img', { alt: '', src: `/media/${attrs.mediaId}` }]] : [];
    return ['figure', { class: 'tome-video' },
      ['a', { class: 'tome-video__play', href: videoWatchUrl(attrs) },
        ...poster,
        ['span', { class: 'tome-video__title' }, attrs.title || name]],
      ['figcaption', {}, attrs.title ? `${attrs.title} · ${name}` : name]];
  },
});
```

- [ ] **Step 8: Run both tests and see them pass**

Run: `node --import tsx --test tests/unit/video-link.test.ts tests/unit/editor-video.test.ts`
Expected: PASS, 10 tests. If the `<img>` assertion fails only on attribute order or on a self-closing `/>` (the serializer writes attributes in insertion order, and zeed-dom may close void elements), change the test's expectation to what the serializer produces, not the code.

- [ ] **Step 9: Commit**

```bash
git add src/lib/video-link.ts src/lib/editor-video.ts tests/unit/video-link.test.ts tests/unit/editor-video.test.ts
```

Message:

```text
feat(editor): a video node and the link parser it shares

YouTube and Vimeo links in every usual form become { provider, videoId,
start }, and every address the site writes is built from those alone.
The node stores the clip, its title and the poster's mediaId, and its
HTML is a poster that links to the clip.
```

---

### Task 2: Saving an article with a video

**Files:**
- Modify: `src/lib/editor-content.ts` (the `sanitizeOptions` at `:29-86`; `hasMeaningfulContent` at `:108-112`)
- Modify: `src/server/content/editor.ts` (the extension list at `:44-64`; `normalizeMediaNodes` at `:93-130`; `editorMediaIds` at `:132-142`)
- Test: `tests/unit/editor-rendering.test.ts` (add tests), `tests/integration/video-content.test.ts` (new)

**Interfaces:**
- Consumes: `video`, `videoAttrs` from Task 1.
- Produces: stored posts and pages may hold `video` nodes; `editorMediaIds(document)` returns their posters' `mediaId`s; the stored HTML keeps `figure.tome-video`, `a.tome-video__play`, `span.tome-video__title` and `figcaption`.

- [ ] **Step 1: Write the failing unit tests**

Add to `tests/unit/editor-rendering.test.ts` (it already imports `editorMediaIds`, `prepareEditorContent` and `ValidationError` from `../../src/server/content/editor`; add the `hasMeaningfulContent` import from `../../src/lib/editor-content` if it is not there):

```ts
const POSTER = '66666666-6666-4666-8666-666666666666';
const clip = (attrs: Record<string, unknown>) => ({
  type: 'doc',
  content: [{ type: 'video', attrs: { mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip', videoId: 'dQw4w9WgXcQ', ...attrs } }],
});

test('a video is stored as a poster that links to the clip', () => {
  const { contentHtml, contentJson } = prepareEditorContent({ contentJson: clip({}) });
  assert.equal(contentHtml, `<figure class="tome-video"><a class="tome-video__play" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=30" rel="noopener noreferrer"><img alt="" src="/media/${POSTER}" decoding="async" loading="lazy" /><span class="tome-video__title">A clip</span></a><figcaption>A clip · YouTube</figcaption></figure>`);
  assert.deepEqual(editorMediaIds(contentJson), [POSTER]);
  assert.equal(hasMeaningfulContent(contentJson), true);
});

test('a video that is not one clip of the right shape is refused', () => {
  for (const attrs of [{ provider: 'tiktok' }, { videoId: 'nope' }, { start: -1 }, { title: 'x'.repeat(201) }, { mediaId: 'poster' }]) {
    assert.throws(() => prepareEditorContent({ contentJson: clip(attrs) }), ValidationError, JSON.stringify(attrs));
  }
});

test('a video keeps nothing a writer added to it', () => {
  const { contentJson } = prepareEditorContent({ contentJson: clip({ href: 'https://evil.example/x', onclick: 'x' }) });
  assert.deepEqual(Object.keys(contentJson.content?.[0]?.attrs ?? {}).sort(), ['mediaId', 'provider', 'start', 'title', 'videoId']);
});

test('a player never reaches stored HTML, however it is written', () => {
  const { contentHtml } = prepareEditorContent({ contentJson: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>' }] }],
  } });
  assert.doesNotMatch(contentHtml, /<iframe/);
});
```

The exact `contentHtml` string in the first test is what sanitize-html writes after its `transformTags` (`rel` on `a`, `decoding` and `loading` on `img`). If the run shows the same elements with attributes in another order or a self-closing difference, change the expected string to the output and keep every attribute and class shown here.

- [ ] **Step 2: Run them and see them fail**

Run: `node --import tsx --test tests/unit/editor-rendering.test.ts`
Expected: FAIL, the first test with `Content contains unsupported editor structure.` (the server's schema has no `video` node yet).

- [ ] **Step 3: Let the video's HTML through the filter**

In `src/lib/editor-content.ts`, in `sanitizeOptions`:
- add `'figure'` and `'figcaption'` to `allowedTags`;
- extend `allowedClasses` to:

```ts
  allowedClasses: {
    a: ['tome-video__play'],
    div: ['tableWrapper'],
    figure: ['tome-video'],
    p: ['file-card'],
    span: ['file-card__name', 'file-card__meta', 'tome-video__title'],
  },
```

and in `hasMeaningfulContent`:

```ts
  if (node.type === 'image' || node.type === 'attachment' || node.type === 'video') return true;
```

- [ ] **Step 4: Register and check the node on the server**

In `src/server/content/editor.ts`:
- import `{ video, videoAttrs } from '../../lib/editor-video'`;
- add `video` after `attachment` in `extensions`;
- in `normalizeMediaNodes`, after the `attachment` branch:

```ts
    if (node.type === 'video') {
      const attrs = videoAttrs(node.attrs);
      if (!attrs) throw new ValidationError('Videos require one YouTube or Vimeo clip.');
      // Only what a video is: a writer's extra attributes never reach the page.
      node.attrs = { ...attrs };
    }
```

- in `editorMediaIds`, count a video's poster like a picture:

```ts
    if ((node.type === 'image' || node.type === 'video') && typeof node.attrs?.mediaId === 'string') ids.add(node.attrs.mediaId);
```

`assertContentMedia` (`src/server/content/content-media.ts:36-47`) already checks every id `editorMediaIds` returns as a ready picture of this site, so a poster from elsewhere is refused on save with no further change, and the library's `jsonb_path_exists(... '$.**.attrs.mediaId' ...)` finds a poster in use because the attribute is `mediaId`.

- [ ] **Step 5: Run the unit tests and see them pass**

Run: `node --import tsx --test tests/unit/editor-rendering.test.ts tests/unit/editor-video.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing integration test**

Create `tests/integration/video-content.test.ts`. It follows `tests/integration/attachment-content.test.ts` (read it first; the seeding below is its seeding):

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/lib/editor-content';

test('an article with a video lists its poster, and the library keeps the poster while it is used', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, updatePostStatus } = await import('../../src/server/content/posts');
  const { listPublishedPosts } = await import('../../src/server/content/published');
  const { HttpError } = await import('../../src/server/http/errors');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({ id: ownerId, name: 'Owner', email: 'video@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({ id: true, owner_id: ownerId, site_name: 'Videos', default_locale: 'en', timezone: 'UTC', admin_path: '/admin' }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true }).returning('id').executeTakeFirstOrThrow();
  const poster = await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, state: 'ready', delete_error_code: null,
    object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`, original_name: 'A clip', mime_type: 'image/jpeg', size_bytes: 100, width: 480, height: 360,
  }).returning('id').executeTakeFirstOrThrow();
  const withVideo = (mediaId: string): EditorDocument => ({
    type: 'doc',
    content: [{ type: 'video', attrs: { mediaId, provider: 'youtube', start: null, title: 'A clip', videoId: 'dQw4w9WgXcQ' } }],
  });
  const input = (contentJson: EditorDocument) => ({
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson, metaDescription: null, metaTitle: null,
    slug: `post-${randomUUID()}`, status: 'draft' as const, title: 'With a video',
  });

  await assert.rejects(createPost(ownerId, input(withVideo(randomUUID()))), (error: unknown) => error instanceof HttpError && error.status === 400);

  const post = await createPost(ownerId, input(withVideo(poster.id)));
  await updatePostStatus(ownerId, { id: post.id, status: 'published', updatedAt: post.updated_at });
  const published = await listPublishedPosts({ locale: 'en', limit: 5 });
  const item = published.items.find(({ id }) => id === post.id);
  assert.deepEqual(item?.media.map(({ id }) => id), [poster.id]);
  assert.match(item?.content_html ?? '', /<figure class="tome-video">/);

  await assert.rejects(deleteMedia(ownerId, poster.id), (error: unknown) => {
    const counts = (error as { details?: { references?: { counts?: Record<string, number> } } }).details?.references?.counts;
    return error instanceof HttpError && error.status === 409 && counts?.postContent === 1;
  });
});
```

Check the argument names of `updatePostStatus` and `listPublishedPosts`, and the property holding the stored HTML on a published item, against `tests/integration/attachment-content.test.ts` and `tests/integration/published-api-queries.test.ts:174-185`; use theirs where they differ from the above.

- [ ] **Step 7: Run it**

Run: `uptime`, then `node scripts/test-foundation.mjs tests/integration/video-content.test.ts`
Expected: PASS (the code from Steps 3 and 4 is already in place; the test proves the whole path: a poster from elsewhere is refused, the API lists the poster, the library refuses to delete it).

- [ ] **Step 8: Run the unit suite and the check**

Run: `npm run check`, then `npm run test:unit`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/editor-content.ts src/server/content/editor.ts tests/unit/editor-rendering.test.ts tests/integration/video-content.test.ts
```

Message:

```text
feat(content): an article can hold a video

The server knows the video node: it keeps only a clip's own attributes,
refuses one of the wrong shape, and counts its poster with the article's
pictures, so the API lists it and the library will not delete it while
it is used. The filter lets the poster and its link through and still
drops any player.
```

---

### Task 3: Finding the title and keeping the poster

**Files:**
- Create: `src/server/video/lookup.ts`
- Create: `src/server/video/resolve.ts`
- Create: `src/pages/api/admin/videos.ts`
- Modify: `src/server/media/service.ts` (add `importImage`; imports at `:1-44`)
- Modify: `scripts/test-foundation.mjs` (`STORAGE_TESTS` at `:15-21`)
- Test: `tests/unit/video-lookup.test.ts`, `tests/integration/video-poster.test.ts`

**Interfaces:**
- Consumes: `VideoLink`, `videoOembedUrl`, `parseVideoLink`, `VIDEO_PROVIDER_NAMES`, `MAX_VIDEO_TITLE` from Task 1.
- Produces:
  - `type VideoLookupReason = 'unavailable' | 'unreachable'`
  - `interface VideoLookup { title: string; poster: Buffer | null; reason: VideoLookupReason | null }`
  - `lookUpVideo(clip: VideoLink, fetcher?: typeof fetch, timeoutMs?: number): Promise<VideoLookup>`
  - `importImage(ownerId: string, body: Buffer, name: string): Promise<ReadyMedia>` in `src/server/media/service.ts`
  - `interface ResolvedVideo extends VideoLink { title: string; mediaId: string | null; reason: VideoLookupReason | null }`
  - `resolveVideo(ownerId: string, link: string, lookUp?: (clip: VideoLink) => Promise<VideoLookup>): Promise<ResolvedVideo>`
  - `POST /api/admin/videos` with `{ "link": string }`, answering a `ResolvedVideo` as JSON; `400` for a link that is not one clip, `429` past 30 lookups a minute.

`lookup.ts` imports nothing that reads the environment (`detectImageType` lives in `src/server/media/image.ts`, which imports only sharp), so its unit test needs no environment. `importImage` lives in `service.ts`, which imports `storage.ts`, which reads the environment on import; it is tested in the integration harness.

- [ ] **Step 1: Write the lookup's failing test**

Create `tests/unit/video-lookup.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { lookUpVideo } from '../../src/server/video/lookup';

const clip = { provider: 'youtube' as const, start: null, videoId: 'dQw4w9WgXcQ' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const POSTER = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';

type Call = { url: string; redirect?: RequestRedirect };

function fake(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ redirect: init?.redirect, url });
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!answer) throw new TypeError('fetch failed');
    return answer();
  }) as typeof fetch;
  return { calls, fetcher };
}

test('a public clip gives its title and its poster, from the two hosts and no others', async () => {
  const { calls, fetcher } = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: '  A clip worth watching  ' }),
    [POSTER]: () => new Response(JPEG),
  });
  const found = await lookUpVideo(clip, fetcher);
  assert.deepEqual({ ...found, poster: found.poster?.length }, { poster: JPEG.length, reason: null, title: 'A clip worth watching' });
  assert.deepEqual(calls.map(({ url }) => new URL(url).hostname), ['www.youtube.com', 'i.ytimg.com']);
  assert.ok(calls.every(({ redirect }) => redirect === 'error'), 'no request follows a redirect');
});

test('a poster on any other host is never fetched', async () => {
  const { calls, fetcher } = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: 'https://evil.example/x.jpg', title: 'A clip' }),
  });
  assert.deepEqual(await lookUpVideo(clip, fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
  assert.equal(calls.length, 1);
});

test('a private clip is unavailable, and a provider that does not answer is unreachable', async () => {
  const refused = fake({ 'https://www.youtube.com/oembed': () => new Response('Unauthorized', { status: 401 }) });
  assert.deepEqual(await lookUpVideo(clip, refused.fetcher), { poster: null, reason: 'unavailable', title: '' });
  const silent = fake({});
  assert.deepEqual(await lookUpVideo(clip, silent.fetcher), { poster: null, reason: 'unreachable', title: '' });
});

test('a lookup that runs past its deadline is unreachable', async () => {
  const { fetcher } = fake({
    'https://www.youtube.com/oembed': () => new Promise<Response>(() => undefined),
  });
  const slow = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const hanging = fetcher(input, init);
    return Promise.race([hanging, new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError'))))]);
  }) as typeof fetch;
  assert.deepEqual(await lookUpVideo(clip, slow, 50), { poster: null, reason: 'unreachable', title: '' });
});

test('an answer over 2 MB, said or streamed, is not read to its end', async () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 1);
  const said = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: 'A clip' }),
    [POSTER]: () => new Response(big, { headers: { 'content-length': String(big.length) } }),
  });
  assert.deepEqual(await lookUpVideo(clip, said.fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
  const streamed = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: 'A clip' }),
    [POSTER]: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(big); controller.close(); } })),
  });
  assert.deepEqual(await lookUpVideo(clip, streamed.fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
});

test('a poster that is not a picture is not kept', async () => {
  const { fetcher } = fake({
    'https://www.youtube.com/oembed': () => Response.json({ thumbnail_url: POSTER, title: 'A clip' }),
    [POSTER]: () => new Response('<html>not a picture</html>'),
  });
  assert.deepEqual(await lookUpVideo(clip, fetcher), { poster: null, reason: 'unavailable', title: 'A clip' });
});

test('Vimeo is asked at its own oEmbed address, and its posters come from its own host', async () => {
  const vimeoPoster = 'https://i.vimeocdn.com/video/452001751-640.jpg';
  const { calls, fetcher } = fake({
    'https://vimeo.com/api/oembed.json': () => Response.json({ thumbnail_url: vimeoPoster, title: 'Vimeo clip' }),
    [vimeoPoster]: () => new Response(JPEG),
  });
  const found = await lookUpVideo({ provider: 'vimeo', start: null, videoId: '76979871' }, fetcher);
  assert.equal(found.title, 'Vimeo clip');
  assert.equal(found.reason, null);
  assert.deepEqual(calls.map(({ url }) => new URL(url).hostname), ['vimeo.com', 'i.vimeocdn.com']);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test tests/unit/video-lookup.test.ts`
Expected: FAIL, `Cannot find module '../../src/server/video/lookup'`.

- [ ] **Step 3: Write the lookup**

Create `src/server/video/lookup.ts`. The bounded reader follows `boundedBytes` in `src/server/update/releases.ts:70-107`:

```ts
import { MAX_VIDEO_TITLE, videoOembedUrl, type VideoLink } from '../../lib/video-link';
import { detectImageType } from '../media/image';

/** The only hosts a lookup reaches: the two oEmbed endpoints and the two hosts their posters live on. */
const HOSTS = new Set(['www.youtube.com', 'vimeo.com', 'i.ytimg.com', 'i.vimeocdn.com']);
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 2 * 1024 * 1024;
const POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type VideoLookupReason = 'unavailable' | 'unreachable';

export interface VideoLookup {
  title: string;
  poster: Buffer | null;
  reason: VideoLookupReason | null;
}

/** The provider said no, or said something that is not a title and a poster. */
class Unavailable extends Error {}
/** No answer in time. */
class Unreachable extends Error {}

/**
 * Asks the provider for a clip's title and poster. It never throws: whatever falls short comes back
 * as a reason, and the clip is still usable without a title or a poster.
 */
export async function lookUpVideo(clip: VideoLink, fetcher: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): Promise<VideoLookup> {
  const signal = AbortSignal.timeout(timeoutMs);
  let title = '';
  try {
    let answer: unknown;
    try {
      answer = JSON.parse((await get(videoOembedUrl(clip), fetcher, signal)).toString('utf8'));
    } catch (error) {
      throw error instanceof SyntaxError ? new Unavailable('The oEmbed answer is not JSON.') : error;
    }
    const { thumbnail_url: thumbnail, title: found } = (answer ?? {}) as Record<string, unknown>;
    title = typeof found === 'string' ? found.trim().slice(0, MAX_VIDEO_TITLE) : '';
    if (typeof thumbnail !== 'string') return { poster: null, reason: 'unavailable', title };
    const poster = await get(thumbnail, fetcher, signal);
    const type = detectImageType(poster);
    if (!type || !POSTER_TYPES.has(type)) return { poster: null, reason: 'unavailable', title };
    return { poster, reason: null, title };
  } catch (error) {
    return { poster: null, reason: error instanceof Unreachable ? 'unreachable' : 'unavailable', title };
  }
}

async function get(address: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Unavailable('Not an address.');
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) throw new Unavailable(`Refused host ${url.hostname}.`);
  let response: Response;
  try {
    response = await fetcher(url, { redirect: 'error', signal });
  } catch {
    throw new Unreachable(`No answer from ${url.hostname}.`);
  }
  if (!response.ok) throw new Unavailable(`${url.hostname} answered ${response.status}.`);
  return boundedBytes(response);
}

async function boundedBytes(response: Response): Promise<Buffer> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Unavailable('Too large.');
  if (!response.body) throw new Unavailable('No body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch {
        throw new Unreachable('The answer stopped.');
      }
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Unavailable('Too large.');
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `node --import tsx --test tests/unit/video-lookup.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the integration test for keeping a poster**

Create `tests/integration/video-poster.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

test('a fetched poster becomes a ready picture in the library, and the route answers with it', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { importImage } = await import('../../src/server/media/service');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const { resolveVideo } = await import('../../src/server/video/resolve');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({ id: ownerId, name: 'Owner', email: 'poster@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  const jpeg = await sharp({ create: { background: '#336699', channels: 3, height: 360, width: 480 } }).jpeg().toBuffer();

  const kept = await importImage(ownerId, jpeg, 'A clip worth watching');
  assert.deepEqual({ height: kept.height, mime: kept.mime_type, name: kept.original_name, width: kept.width }, { height: 360, mime: 'image/jpeg', name: 'A clip worth watching', width: 480 });
  const row = await db.selectFrom('media_items').select(['object_key', 'state', 'size_bytes']).where('id', '=', kept.id).executeTakeFirstOrThrow();
  assert.equal(row.state, 'ready');
  assert.equal(row.size_bytes, jpeg.length);
  const head = await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: row.object_key }));
  assert.equal(head.ContentLength, jpeg.length);

  await assert.rejects(importImage(ownerId, Buffer.from('not a picture'), 'x'), (error: unknown) => error instanceof HttpError && error.status === 415);

  const answered = await resolveVideo(ownerId, 'https://youtu.be/dQw4w9WgXcQ?t=30', async () => ({ poster: jpeg, reason: null, title: 'A clip' }));
  assert.equal(answered.provider, 'youtube');
  assert.equal(answered.start, 30);
  assert.equal(answered.title, 'A clip');
  assert.equal(answered.reason, null);
  assert.ok(answered.mediaId, 'the poster is kept');

  const bare = await resolveVideo(ownerId, 'https://vimeo.com/76979871', async () => ({ poster: null, reason: 'unavailable', title: '' }));
  assert.deepEqual(bare, { mediaId: null, provider: 'vimeo', reason: 'unavailable', start: null, title: '', videoId: '76979871' });

  await assert.rejects(resolveVideo(ownerId, 'https://example.com/clip', async () => { throw new Error('never asked'); }),
    (error: unknown) => error instanceof HttpError && error.status === 400);
});
```

Add `'tests/integration/video-poster.test.ts'` to `STORAGE_TESTS` in `scripts/test-foundation.mjs`, so the harness starts SeaweedFS for it.

- [ ] **Step 6: Run it and see it fail**

Run: `uptime`, then `node scripts/test-foundation.mjs tests/integration/video-poster.test.ts`
Expected: FAIL, `importImage` is not exported (or `Cannot find module '../../src/server/video/resolve'`).

- [ ] **Step 7: Write `importImage`**

In `src/server/media/service.ts`, add `detectImageType` to the import from `./image`, `randomUUID` to the import from `node:crypto`, and after `finalizeUpload`:

```ts
/**
 * Keeps a picture the server fetched itself, a video's poster, as a ready picture in the library:
 * checked the way a finished upload is, and named for what it shows.
 */
export async function importImage(ownerId: string, body: Buffer, name: string): Promise<ReadyMedia> {
  const type = detectImageType(body);
  if (!type || body.length < 1 || body.length > MAX_IMAGE_BYTES) throw new HttpError(415, 'The picture is not a supported image.');
  let dimensions: { height: number; width: number };
  try {
    dimensions = await inspectImage(body, type);
  } catch {
    throw new HttpError(415, 'The picture is not a supported image.');
  }
  const objectKey = createObjectKey(ownerId, type);
  await s3.send(new PutObjectCommand({ Body: body, Bucket: s3Bucket, ContentType: type, Key: objectKey }));
  try {
    const item = await db.insertInto('media_items').values({
      id: randomUUID(),
      owner_id: ownerId,
      folder_id: null,
      object_key: objectKey,
      original_name: name.trim().slice(0, 255) || 'Video poster',
      mime_type: type,
      size_bytes: body.length,
      checksum_sha256: createHash('sha256').update(body).digest('base64'),
      width: dimensions.width,
      height: dimensions.height,
      alt_text: null,
      state: 'ready',
      delete_error_code: null,
    }).returningAll().executeTakeFirstOrThrow();
    return readyMedia(item);
  } catch (error) {
    // Best effort: an object nothing points at is harmless, as brand.ts says of its own.
    await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: objectKey })).catch(() => undefined);
    throw error;
  }
}
```

Check that `db`, `HttpError`, `DeleteObjectCommand`, `MAX_IMAGE_BYTES` and `readyMedia` are already in scope in `service.ts` (the facts say they are); import whatever is not.

- [ ] **Step 8: Write the resolver and the route**

Create `src/server/video/resolve.ts`:

```ts
import { parseVideoLink, VIDEO_PROVIDER_NAMES, type VideoLink } from '../../lib/video-link';
import { HttpError } from '../http/errors';
import { importImage } from '../media/service';
import { lookUpVideo, type VideoLookup, type VideoLookupReason } from './lookup';

export interface ResolvedVideo extends VideoLink {
  title: string;
  mediaId: string | null;
  reason: VideoLookupReason | null;
}

/** A pasted link, as the clip it names, with its title and its poster kept in the library. */
export async function resolveVideo(
  ownerId: string,
  link: string,
  lookUp: (clip: VideoLink) => Promise<VideoLookup> = lookUpVideo,
): Promise<ResolvedVideo> {
  const clip = parseVideoLink(link);
  if (!clip) throw new HttpError(400, 'Use a YouTube or Vimeo link to one clip.', { code: 'video_link' });
  const found = await lookUp(clip);
  let mediaId: string | null = null;
  let reason = found.reason;
  if (found.poster) {
    try {
      mediaId = (await importImage(ownerId, found.poster, found.title || `${VIDEO_PROVIDER_NAMES[clip.provider]} ${clip.videoId}`)).id;
    } catch (error) {
      console.error('A video poster could not be kept.', error instanceof Error ? error.message : error);
      reason = 'unavailable';
    }
  }
  return { ...clip, mediaId, reason, title: found.title };
}
```

Create `src/pages/api/admin/videos.ts`, shaped like `src/pages/api/admin/suggest-excerpt.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';
import { parseJson } from '../../../server/http/json';
import { createRateLimit } from '../../../server/stats/rules';
import { resolveVideo } from '../../../server/video/resolve';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const lookups = createRateLimit({ capacity: 1_000, limit: 30, windowMs: 60_000 });
const askSchema = z.object({ link: z.string().trim().min(1).max(2_048) }).strict();

export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    if (!lookups.allow(current.user.id)) throw new HttpError(429, 'Too many video lookups. Try again in a minute.');
    const { link } = await parseJson(request, askSchema);
    const video = await resolveVideo(current.user.id, link);
    return Response.json(video, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
```

- [ ] **Step 9: Run the integration test and see it pass**

Run: `node scripts/test-foundation.mjs tests/integration/video-poster.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the check and the unit suite**

Run: `npm run check`, then `npm run test:unit`
Expected: both pass.

- [ ] **Step 11: Commit**

```bash
git add src/server/video/lookup.ts src/server/video/resolve.ts src/pages/api/admin/videos.ts src/server/media/service.ts scripts/test-foundation.mjs tests/unit/video-lookup.test.ts tests/integration/video-poster.test.ts
```

Message:

```text
feat(media): a video's title and poster, fetched once and kept

POST /api/admin/videos turns a pasted link into its clip, asks YouTube
or Vimeo for the title and poster through oEmbed, and keeps the poster
in the library as a ready picture. Only four hosts can be reached, over
https, with no redirect, one 5 second deadline and at most 2 MB read; a
lookup that falls short still answers, with a reason. 30 lookups a
minute per owner.
```

---

### Task 4: The video in the editor

**Files:**
- Create: `src/components/admin/editor/video-insert.ts`
- Modify: `src/components/admin/DocumentCanvas.tsx` (the node view beside `editorAttachment` at `:50-72`; `buildExtensions` at `:74-99`; `useEditor` at `:187-204`)
- Modify: `src/components/admin/BlockInsertMenu.tsx` (the actions at `:139-168`)
- Modify: `src/components/admin/editor/slash-items.tsx` (beside the File item at `:70-80`)
- Modify: `src/lib/admin-i18n.ts` (`blocks` in `en` at `:713-758` and in `th` at `:1621`)
- Modify: `src/styles/global.css` (after the file card at `:455-492`, and the editor rules at `:517-532`)
- Test: `tests/e2e/editor-blocks.spec.ts` (a new test)

**Interfaces:**
- Consumes: `video`, `VideoAttrs` (Task 1); `parseVideoLink`, `VIDEO_PROVIDER_NAMES` (Task 1); `POST /api/admin/videos` answering a `ResolvedVideo` (Task 3).
- Produces:
  - `insertVideo(editor: Editor, at: number | Range, link: string, copy: AdminCopy): Promise<void>`
  - `askForVideo(editor: Editor, position: number, copy: AdminCopy): Promise<void>`
  - `handleVideoPaste(view: EditorView, event: ClipboardEvent, editor: Editor | null, copy: AdminCopy): boolean`
  - admin copy keys in `blocks`: `video`, `videoHint`, `videoInvalid`, `videoLink`, `videoLookupFailed`, `videoTitle`, `videoUnavailable`, `videoUnreachable`
  - CSS classes `tome-video`, `tome-video__play`, `tome-video__title`, and the editor's `tome-video--editor`

- [ ] **Step 1: Write the failing e2e test**

Add to `tests/e2e/editor-blocks.spec.ts`, after the file test (the whole file already skips the phone project, signs in with `signIn(context, page)`, and imports `Route`):

```ts
test('a pasted YouTube link on an empty line becomes a video, and a menu adds one too', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const asked: string[] = [];
  await page.route('**/api/admin/videos', async (route: Route) => {
    const { link } = route.request().postDataJSON() as { link: string };
    asked.push(link);
    const vimeo = link.includes('vimeo');
    await route.fulfill({ json: vimeo
      ? { mediaId: null, provider: 'vimeo', reason: 'unavailable', start: null, title: '', videoId: '76979871' }
      : { mediaId: null, provider: 'youtube', reason: null, start: 30, title: 'A clip worth watching', videoId: 'dQw4w9WgXcQ' } });
  });

  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('With a video');
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await page.keyboard.type('Before the video.');
  await page.keyboard.press('Enter');

  // Alone on an empty line: a video.
  await page.evaluate(() => navigator.clipboard.writeText('https://youtu.be/dQw4w9WgXcQ?t=30'));
  await page.keyboard.press('ControlOrMeta+v');
  const videos = canvas.locator('figure.tome-video');
  await expect(videos).toHaveCount(1);
  await expect(videos.first().locator('figcaption')).toHaveText('A clip worth watching · YouTube');

  // Inside a sentence: still a link.
  await canvas.getByText('Before the video.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' See ');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(videos).toHaveCount(1);
  await expect(canvas.locator('p a[href^="https://youtu.be/"]')).toHaveCount(1);

  // From /, with a clip whose lookup falls short: it goes in, and the editor says why.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.getByRole('option', { name: /^Video/ }).click();
  const prompt = page.getByRole('dialog', { name: 'Add a video' });
  await prompt.getByLabel('Link').fill('https://example.com/not-a-clip');
  await prompt.getByRole('button', { name: /^(Add|OK|Confirm)/ }).click();
  await expect(prompt.getByText('Use a YouTube or Vimeo link to one clip.')).toBeVisible();
  await prompt.getByLabel('Link').fill('https://vimeo.com/76979871');
  await prompt.getByRole('button', { name: /^(Add|OK|Confirm)/ }).click();
  await expect(videos).toHaveCount(2);
  await expect(page.getByRole('dialog', { name: 'The video is in, without its poster' })).toBeVisible();
  await page.getByRole('dialog', { name: 'The video is in, without its poster' }).getByRole('button').first().click();
  await expect(videos.nth(1).locator('figcaption')).toHaveText('76979871 · Vimeo');

  // From +.
  await page.getByRole('button', { name: /Add block/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Video', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  expect(asked).toEqual(['https://youtu.be/dQw4w9WgXcQ?t=30', 'https://vimeo.com/76979871']);

  const written = page.waitForResponse((response) => response.url().includes('/api/admin/posts')
    && ['POST', 'PUT'].includes(response.request().method()) && response.ok());
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await written;
  const { db } = await import('../../src/server/db/client');
  const { content_json: stored } = await db.selectFrom('posts').select('content_json').where('title', '=', 'With a video')
    .orderBy('created_at', 'desc').executeTakeFirstOrThrow();
  const kinds = (stored as { content?: Array<{ type: string; attrs?: Record<string, unknown> }> }).content?.filter(({ type }) => type === 'video');
  expect(kinds?.map(({ attrs }) => attrs)).toEqual([
    { mediaId: null, provider: 'youtube', start: 30, title: 'A clip worth watching', videoId: 'dQw4w9WgXcQ' },
    { mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '76979871' },
  ]);
});
```

The prompt's confirm button takes its name from `promptUi`'s `confirmLabel` or its default; open `src/lib/ui-dialog.ts` and use the exact default name in place of the `/^(Add|OK|Confirm)/` pattern. Do the same for the alert's button.

- [ ] **Step 2: Run it and see it fail**

Run: `uptime`, then `npx playwright test tests/e2e/editor-blocks.spec.ts -g "YouTube link"`
Expected: FAIL at `toHaveCount(1)` for `figure.tome-video` (a pasted link is only a link today).

- [ ] **Step 3: Add the editor's words**

In `src/lib/admin-i18n.ts`, append to `blocks` in `en`, after `text`:

```ts
    video: 'Video',
    videoHint: 'Paste a YouTube or Vimeo link.',
    videoInvalid: 'Use a YouTube or Vimeo link to one clip.',
    videoLink: 'Link',
    videoLookupFailed: 'The video is in, without its poster',
    videoTitle: 'Add a video',
    videoUnavailable: "YouTube or Vimeo did not give this clip's title and poster. The clip may be private. Readers who can see it can still play it.",
    videoUnreachable: 'The server could not reach YouTube or Vimeo in time. The clip is in, and readers can still play it.',
```

and to `blocks` in `th`, after `text`, in the same order:

```ts
    video: 'วิดีโอ',
    videoHint: 'วางลิงก์ YouTube หรือ Vimeo',
    videoInvalid: 'ใช้ลิงก์ YouTube หรือ Vimeo ที่ชี้ไปที่คลิปเดียว',
    videoLink: 'ลิงก์',
    videoLookupFailed: 'ใส่วิดีโอแล้ว แต่ไม่มีภาพปก',
    videoTitle: 'ใส่วิดีโอ',
    videoUnavailable: 'YouTube หรือ Vimeo ไม่ให้ชื่อและภาพปกของคลิปนี้ คลิปอาจเป็นแบบส่วนตัว ผู้อ่านที่มีสิทธิ์ดูยังกดเล่นได้',
    videoUnreachable: 'เซิร์ฟเวอร์ติดต่อ YouTube หรือ Vimeo ไม่ทันเวลา ใส่คลิปไว้แล้ว และผู้อ่านยังกดเล่นได้',
```

- [ ] **Step 4: Write the insert, paste and menu helpers**

Create `src/components/admin/editor/video-insert.ts`:

```ts
import type { Editor, Range } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

import type { AdminCopy } from '../../../lib/admin-i18n';
import type { VideoAttrs } from '../../../lib/editor-video';
import { alertUi, promptUi } from '../../../lib/ui-dialog';
import { parseVideoLink, type VideoLink } from '../../../lib/video-link';

type Reason = 'unavailable' | 'unreachable' | null;

/** Asks the server for the clip's title and poster. A failure leaves the clip as it is, with a reason. */
async function resolve(clip: VideoLink, link: string): Promise<{ attrs: VideoAttrs; reason: Reason }> {
  const bare = { attrs: { ...clip, mediaId: null, title: '' }, reason: 'unreachable' as const };
  try {
    const response = await fetch('/api/admin/videos', {
      body: JSON.stringify({ link }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) return bare;
    const found = await response.json() as VideoAttrs & { reason: Reason };
    return {
      attrs: { mediaId: found.mediaId, provider: found.provider, start: found.start, title: found.title, videoId: found.videoId },
      reason: found.reason,
    };
  } catch {
    return bare;
  }
}

/**
 * Puts a clip in at once, then fills in its title and poster when the server answers.
 *
 * ponytail: the clip is found again by provider and id, with no title and no poster yet, so two of
 * the same clip added within one lookup fill the first. Mapping the position through each
 * transaction would tell them apart.
 */
export async function insertVideo(editor: Editor, at: number | Range, link: string, copy: AdminCopy): Promise<void> {
  const clip = parseVideoLink(link);
  if (!clip) return;
  const node = { type: 'video', attrs: { ...clip, mediaId: null, title: '' } };
  const chain = editor.chain().focus();
  (typeof at === 'number' ? chain.setTextSelection(at).insertContent(node) : chain.insertContentAt(at, node)).run();

  const { attrs, reason } = await resolve(clip, link);
  if (editor.isDestroyed) return;
  editor.commands.command(({ tr }) => {
    let filled = false;
    tr.doc.descendants((current, position) => {
      if (filled) return false;
      if (current.type.name !== 'video' || current.attrs.provider !== clip.provider || current.attrs.videoId !== clip.videoId
        || current.attrs.title || current.attrs.mediaId) return true;
      tr.setNodeMarkup(position, undefined, attrs);
      filled = true;
      return false;
    });
    return filled;
  });
  if (reason) {
    void alertUi({
      message: reason === 'unavailable' ? copy.blocks.videoUnavailable : copy.blocks.videoUnreachable,
      title: copy.blocks.videoLookupFailed,
    });
  }
}

/** The + and / menus: ask for a link, then put the clip where the menu was opened. */
export async function askForVideo(editor: Editor, position: number, copy: AdminCopy): Promise<void> {
  const link = await promptUi({
    label: copy.blocks.videoLink,
    message: copy.blocks.videoHint,
    title: copy.blocks.videoTitle,
    validate: (value) => (parseVideoLink(value) ? null : copy.blocks.videoInvalid),
  });
  if (link) await insertVideo(editor, position, link, copy);
}

/** A YouTube or Vimeo link pasted alone on an empty line becomes a video; anywhere else it stays a link. */
export function handleVideoPaste(view: EditorView, event: ClipboardEvent, editor: Editor | null, copy: AdminCopy): boolean {
  const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
  if (!editor || !parseVideoLink(text)) return false;
  const { $from, empty } = view.state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false;
  event.preventDefault();
  void insertVideo(editor, { from: $from.before(), to: $from.after() }, text, copy);
  return true;
}
```

- [ ] **Step 5: Wire the card, the paste and the menus**

In `src/components/admin/DocumentCanvas.tsx`:
- import `{ video, type VideoAttrs } from '../../lib/editor-video'`, `{ VIDEO_PROVIDER_NAMES } from '../../lib/video-link'`, `{ handleVideoPaste } from './editor/video-insert'`, and `type Editor` from `@tiptap/core` if it is not imported;
- beside `editorAttachment`, add the card:

```ts
/**
 * The editor draws a video as its poster and caption, with no link in it: a click selects the
 * block, as a click on a card does. Until the server answers, the caption shows the clip's id.
 */
const editorVideo = video.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure');
      dom.className = 'tome-video tome-video--editor';
      const draw = (attrs: VideoAttrs) => {
        const box = document.createElement('span');
        box.className = 'tome-video__play';
        if (attrs.mediaId) {
          const poster = document.createElement('img');
          poster.alt = '';
          poster.src = `/media/${attrs.mediaId}`;
          box.append(poster);
        }
        const caption = document.createElement('figcaption');
        caption.textContent = `${attrs.title || attrs.videoId} · ${VIDEO_PROVIDER_NAMES[attrs.provider]}`;
        dom.replaceChildren(box, caption);
      };
      draw(node.attrs as VideoAttrs);
      return {
        dom,
        update: (next) => {
          if (next.type.name !== 'video') return false;
          draw(next.attrs as VideoAttrs);
          return true;
        },
      };
    };
  },
});
```

- add `editorVideo` after `editorAttachment` in `buildExtensions`;
- in `DocumentCanvas`, keep the editor in a ref for the paste handler (the handler is built before `useEditor` returns):

```ts
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    ...
    editorProps: {
      ...
      handlePaste: (view, event) => handleImagePaste(view, event, uploadFn) || handleVideoPaste(view, event, editorRef.current, copy),
    },
    ...
  }, [extensions, uploadFn]);
  editorRef.current = editor;
```

In `src/components/admin/BlockInsertMenu.tsx`, import `{ askForVideo } from './editor/video-insert'`, and add to `actions`, after the File action, outside a table only:

```ts
    ...(inTable ? [] : [{
      icon: 'play',
      label: copy.blocks.video,
      run: () => {
        const position = editor.state.selection.from;
        setMenuOpen(false);
        void askForVideo(editor, position, copy);
      },
    }] as const),
```

In `src/components/admin/editor/slash-items.tsx`, import `{ askForVideo } from './video-insert'`, and add after the File item, outside a table only (the list is built by `commandItems(copy, inTable)`):

```tsx
  ...(inTable ? [] : [{
    title: copy.blocks.video,
    description: copy.blocks.videoHint,
    icon: <Icon name="play" />,
    searchTerms: ['video', 'youtube', 'vimeo', 'clip', 'วิดีโอ'],
    command: ({ editor, range }: { editor: Editor; range: Range }) => {
      editor.chain().focus().deleteRange(range).run();
      void askForVideo(editor, editor.state.selection.from, copy);
    },
  }]),
```

If `commandItems` builds its list differently from a flat array, place the item the way the File item is placed and keep it out of tables the way the Table item is kept out.

- [ ] **Step 6: Style the video once, for the editor and every theme**

In `src/styles/global.css`, after the file card's rules:

```css
figure.tome-video { margin-block: var(--space-md); }

.tome-video__play {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-paper-3);
}

figure.tome-video .tome-video__play img {
  display: block;
  width: 100%;
  height: 100%;
  margin: 0;
  border-radius: 0;
  object-fit: cover;
}

.tome-video__play::before,
.tome-video__play::after {
  content: '';
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  translate: -50% -50%;
}

.tome-video__play::before {
  width: 4rem;
  height: 4rem;
  border-radius: var(--radius-pill);
  background: var(--color-hero);
  opacity: 0.85;
}

.tome-video__play::after {
  width: 1.5rem;
  height: 1.5rem;
  background: var(--color-on-dark);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M8 5v14l11-7z'/%3E%3C/svg%3E") center / contain no-repeat;
}

a.tome-video__play:hover::before { opacity: 1; }
a.tome-video__play:focus-visible { outline: 2px solid var(--color-focus); outline-offset: var(--space-3xs); }

.tome-video__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.tome-video figcaption {
  margin-block-start: var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}
```

and beside the editor's selection rules:

```css
.editor-content .ProseMirror-selectednode.tome-video { outline: none; }
.ProseMirror-selectednode.tome-video > .tome-video__play { outline: 2px solid var(--color-focus); outline-offset: var(--space-3xs); }
```

`npm run check` runs `check-design-tokens`; if it refuses a token above, use the nearest one the file card already uses.

- [ ] **Step 7: Run the e2e test and see it pass**

Run: `uptime`, then `npx playwright test tests/e2e/editor-blocks.spec.ts -g "YouTube link"`
Expected: PASS on the desktop project (the file skips the phone project).

- [ ] **Step 8: Run the gates**

Run, one at a time: `npm run check`, `npm run test:unit` (it includes `tests/unit/admin-i18n.test.ts`, which checks both languages carry the new keys in the same order), then `npx playwright test tests/e2e/editor-blocks.spec.ts`.
Expected: all pass. If an older test in `editor-blocks.spec.ts` that pastes a link now fails, read it before changing anything: a link pasted into text must still be a link; only a link alone on an empty line becomes a video.

- [ ] **Step 9: Commit**

```bash
git add src/components/admin/editor/video-insert.ts src/components/admin/DocumentCanvas.tsx src/components/admin/BlockInsertMenu.tsx src/components/admin/editor/slash-items.tsx src/lib/admin-i18n.ts src/styles/global.css tests/e2e/editor-blocks.spec.ts
```

Message:

```text
feat(editor): paste a YouTube or Vimeo link to add a video

A link alone on an empty line becomes a video block; inside a sentence
it stays a link. Video also sits in the + and / menus, which ask for a
link. The card goes in at once and fills in its title and poster when
the server answers; when the lookup falls short the editor says why and
the clip stays.
```

---

### Task 5: Playing a video on the reader's page

**Files:**
- Create: `src/components/VideoScript.astro`
- Modify: `src/layouts/BaseLayout.astro` (props at `:26-51`; the script beside `<StatsBeacon>` near the end)
- Modify: `src/pages/[locale]/blog/[slug].astro`, `src/pages/[locale]/[slug].astro` (the `<BaseLayout>` props)
- Modify: `src/pages/admin/preview/[id].astro`, `src/pages/admin/pages/preview/[id].astro` (the theme component they render)
- Modify: `src/lib/i18n.ts` (both branches of `publicCopy`, beside `openImage`)
- Modify: `src/plugins/lightbox/client.ts:20-21`
- Modify: `src/styles/global.css` (after the `.tome-video` rules from Task 4)
- Test: `tests/e2e/video.spec.ts` (new)

**Interfaces:**
- Consumes: `parseVideoLink`, `videoPlayerUrl` (Task 1); `documentHasVideo` (Task 1); the stored HTML from Tasks 1 and 2.
- Produces: `BaseLayout` takes `video?: boolean`; `<VideoScript locale={...} />`; `publicCopy(locale).playVideo`; the class `tome-video__player` on a playing video.

- [ ] **Step 1: Write the failing e2e spec**

Create `tests/e2e/video.spec.ts`. Take its stack from `tests/e2e/public-plugins.spec.ts`: read that file, and copy its imports, constants, `freePort`, `docker`/`psql` helpers, `test.use({ stack: ... })`, `beforeAll` (compose up, fresh schema, migrate, seed owner, settings and category, start `astro dev`) and `afterAll` verbatim, then change the Compose project to `tomecms-video-test`, the stack name to `video`, and its seeding to the posts below. It runs on both Playwright projects; do not skip the phone project. Seed with the server's own renderer so the stored HTML is exactly what a save writes:

```ts
const POSTER = '7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

// In beforeAll, after the owner, settings and category exist:
const { prepareEditorContent } = await import('../../src/server/content/editor');
psql(`insert into media_items (id, owner_id, folder_id, object_key, original_name, mime_type, size_bytes, checksum_sha256, width, height, alt_text, state, delete_error_code)
  values ('${POSTER}', '${OWNER}', null, 'owners/${OWNER}/2026/09/${POSTER}.jpg', 'A clip worth watching', 'image/jpeg', 100, '${'A'.repeat(43)}=', 480, 360, null, 'ready', null)`);
for (const [slug, attrs] of [
  ['with-a-video', { mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip worth watching', videoId: 'dQw4w9WgXcQ' }],
  ['with-a-vimeo', { mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '76979871' }],
] as const) {
  const { contentHtml, contentJson } = prepareEditorContent({ contentJson: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before the video.' }] },
    { type: 'video', attrs },
  ] } });
  psql(`with g as (insert into post_translation_groups (owner_id) values ('${OWNER}') returning id)
    insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
    select g.id, 'en', 'A post ${slug}', '${slug}', '${JSON.stringify(contentJson).replaceAll("'", "''")}'::jsonb,
      '${contentHtml.replaceAll("'", "''")}', 'published', now(), '${OWNER}' from g`);
}
```

Match the `post_translation_groups` and `posts` columns to the insert `public-plugins.spec.ts` uses (and its category assignment, if a published post needs one); if its `psql` helper takes other arguments, call it the way that file does.

```ts
const VIDEO_HOSTS = /^https:\/\/([^/]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|vimeo\.com|vimeocdn\.com)\//;

async function watchOutside(page: Page): Promise<string[]> {
  const outside: string[] = [];
  await page.route(VIDEO_HOSTS, async (route) => {
    outside.push(route.request().url());
    await route.abort();
  });
  return outside;
}

test('a video loads nothing from YouTube until the reader presses play, then plays in place', async ({ page }) => {
  const outside = await watchOutside(page);
  await page.goto(`${origin}/en/blog/with-a-video`);
  const link = page.locator('figure.tome-video a.tome-video__play');
  await expect(link).toHaveAttribute('aria-label', 'Play video: A clip worth watching');
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
  await link.scrollIntoViewIfNeeded();
  await expect(link.locator('img')).toHaveJSProperty('complete', true);
  expect(outside, 'nothing reaches a video host before a click').toEqual([]);

  await link.click();
  const player = page.locator('figure.tome-video iframe.tome-video__player');
  await expect(player).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=30');
  await expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await expect(player).toHaveAttribute('title', 'A clip worth watching');
  await expect(player).toBeFocused();
  await expect(page.locator('figure.tome-video a.tome-video__play')).toHaveCount(0);
  expect(await page.evaluate(() => ({ cookies: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ cookies: '', local: [], session: [] });
});

test('a Vimeo clip with no poster is a plain panel, and plays in do-not-track mode', async ({ page }) => {
  await watchOutside(page);
  await page.goto(`${origin}/en/blog/with-a-vimeo`);
  const link = page.locator('figure.tome-video a.tome-video__play');
  await expect(link.locator('img')).toHaveCount(0);
  await expect(page.locator('figure.tome-video figcaption')).toHaveText('Vimeo');
  await expect(link).toHaveAttribute('aria-label', 'Play video: Vimeo');
  await link.click();
  await expect(page.locator('iframe.tome-video__player')).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1');
});

test('without JavaScript a video is a link to the clip', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${origin}/en/blog/with-a-video`);
  const link = page.locator('figure.tome-video a.tome-video__play');
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
  await expect(link.locator('.tome-video__title')).toHaveText('A clip worth watching');
  await context.close();
});

test('the lightbox leaves a poster to its video', async ({ page }) => {
  await setPlugin('lightbox', true, {});
  await watchOutside(page);
  await page.goto(`${origin}/en/blog/with-a-video`);
  await page.locator('figure.tome-video img').click();
  await expect(page.locator('dialog.lightbox[open]')).toHaveCount(0);
  await expect(page.locator('iframe.tome-video__player')).toHaveCount(1);
  await setPlugin('lightbox', false, {});
});
```

`setPlugin` is the helper `public-plugins.spec.ts` uses to switch a plugin on; copy it with the rest of the setup.

- [ ] **Step 2: Run it and see it fail**

Run: `uptime`, then `npx playwright test tests/e2e/video.spec.ts`
Expected: FAIL: no `aria-label` on the link, and a click follows the link to YouTube (aborted) instead of adding a player.

- [ ] **Step 3: Add the public words**

In `src/lib/i18n.ts`, in `publicCopy`, beside `openImage`: `playVideo: 'เล่นวิดีโอ'` in the Thai branch and `playVideo: 'Play video'` in the English branch.

- [ ] **Step 4: Write the reader's script**

Create `src/components/VideoScript.astro`:

```astro
---
/**
 * On a page whose content holds a video: labels each poster in the page's language, and on a
 * click puts the player where the poster was. Until then nothing loads from YouTube or Vimeo.
 */
import { publicCopy } from '../lib/i18n';

interface Props {
  locale: Parameters<typeof publicCopy>[0];
}

const { locale } = Astro.props;
---
<template data-video-copy data-play={publicCopy(locale).playVideo}></template>

<script>
  import { parseVideoLink, videoPlayerUrl } from '../lib/video-link';

  const play = document.querySelector<HTMLElement>('[data-video-copy]')?.dataset.play ?? 'Play video';
  const titleOf = (link: Element) => link.querySelector('.tome-video__title')?.textContent?.trim() ?? '';

  for (const link of document.querySelectorAll<HTMLAnchorElement>('a.tome-video__play')) {
    link.setAttribute('aria-label', `${play}: ${titleOf(link)}`);
  }

  document.addEventListener('click', (event) => {
    // A click with a modifier opens the clip's own page, as any link does.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a.tome-video__play');
    if (!link) return;
    // The address is read back through the same parser the server uses, so only a player built
    // from a provider and an id is ever put on the page.
    const clip = parseVideoLink(link.href);
    if (!clip) return;
    event.preventDefault();
    const player = document.createElement('iframe');
    player.className = 'tome-video__player';
    player.src = videoPlayerUrl(clip);
    player.title = titleOf(link) || play;
    player.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    player.allowFullscreen = true;
    // YouTube refuses to play for a player that sends no referrer.
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    link.replaceWith(player);
    player.focus();
  });
</script>
```

- [ ] **Step 5: Include it only where a document has a video**

- `src/layouts/BaseLayout.astro`: add `video?: boolean` to the props interface, import `VideoScript from '../components/VideoScript.astro'`, and render `{Astro.props.video && <VideoScript locale={locale} />}` beside the `<StatsBeacon>` line.
- `src/pages/[locale]/blog/[slug].astro`: import `{ documentHasVideo } from '../../../lib/editor-video'` and pass `video={post ? documentHasVideo(post.content_json) : false}` to `<BaseLayout>`.
- `src/pages/[locale]/[slug].astro`: the same with `page`.
- The two preview pages render the theme inside `AdminLayout`, not `BaseLayout`: import `VideoScript` and `documentHasVideo` there and render `{documentHasVideo(<the post or page>.content_json) && <VideoScript locale={<its locale>} />}` after the theme component, using the names each file already has.

Fix each relative import path to the file's depth.

- [ ] **Step 6: Leave a poster to its video, and style the player**

In `src/plugins/lightbox/client.ts`:

```ts
  const images = [...document.querySelectorAll<HTMLImageElement>('article img')]
    .filter((image) => !image.closest('aside, footer, .tome-video'));
```

In `src/styles/global.css`, after the `.tome-video` rules:

```css
.tome-video__player {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  border-radius: var(--radius-card);
}
```

- [ ] **Step 7: Run the spec and see it pass**

Run: `uptime`, then `npx playwright test tests/e2e/video.spec.ts`
Expected: PASS, 8 tests (4 on each project).

- [ ] **Step 8: Run the gates and the neighbours**

Run, one at a time: `npm run check`, `npm run test:unit`, `npx playwright test tests/e2e/public-plugins.spec.ts`, `npx playwright test tests/e2e/stats.spec.ts`.
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/VideoScript.astro src/layouts/BaseLayout.astro "src/pages/[locale]/blog/[slug].astro" "src/pages/[locale]/[slug].astro" "src/pages/admin/preview/[id].astro" "src/pages/admin/pages/preview/[id].astro" src/lib/i18n.ts src/plugins/lightbox/client.ts src/styles/global.css tests/e2e/video.spec.ts
```

Message:

```text
feat(site): a video plays in place when the reader presses play

A page whose content holds a video loads a small script that labels
each poster in the page's language and, on a click, puts the player
where the poster was: YouTube's no-cookie host or Vimeo's do-not-track
mode. Until then nothing loads from either. Without JavaScript the
poster is a link to the clip. The lightbox leaves a poster alone.
```

---

### Task 6: Release 0.12.0

**Files:**
- Modify: `package.json`, `package-lock.json` (the version)
- Modify: `CHANGELOG.md` (the Unreleased section at `:5-10`)
- Create: `docs/releases/0.12.0.md`
- Modify: `docs/plans/2026-09-24-road-to-1.0.0.md` (the table at `:12-20`)
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above, as built.
- Produces: version `0.12.0`.

The documentation site lives on the `feat/docs-site` branch. Its privacy page and its Writing page are brought up to date there once this release is on `main`; they are not part of this plan.

- [ ] **Step 1: Set the version**

Run: `npm version 0.12.0 --no-git-tag-version`
Expected: `package.json` and `package-lock.json` say `0.12.0`, and nothing else changes (check with `git diff --stat`).

- [ ] **Step 2: Write the changelog entry**

In `CHANGELOG.md`, turn `## Unreleased` into `## 0.12.0 - <today, YYYY-MM-DD>`, and write, above the existing `### Changed`:

```md
The one exception to the freeze before 1.0.0, and where the freeze starts again: only fixes from here until then.

### Added

- **A video in an article or page.** Paste a YouTube or Vimeo link alone on an empty line, or choose Video in the `+` or `/` menu. TomeCMS fetches the clip's title and poster once and keeps the poster in the file library. A reader sees the poster, and the player loads from YouTube's no-cookie host or Vimeo's do-not-track mode only when they press play, so the public site still needs no consent banner. Without JavaScript the poster is a link to the clip.
```

After `### Changed`, add:

```md
### Upgrading

- No migration. To fetch a clip's title and poster, the server must reach `www.youtube.com`, `vimeo.com`, `i.ytimg.com` and `i.vimeocdn.com` over https; without that a video still goes in, with no poster.
- A Content Security Policy set at your proxy must allow `frame-src https://www.youtube-nocookie.com https://player.vimeo.com`.

### For theme, plugin and headless authors

- A document can hold a `video` node: `{ provider: 'youtube' | 'vimeo', videoId, start, title, mediaId }`. `contentHtml` renders it as `figure.tome-video` with a link to the clip, and the poster is in the item's `media`. Every theme gets the `.tome-video` styles from `global.css`.

Full notes: [docs/releases/0.12.0.md](docs/releases/0.12.0.md)
```

- [ ] **Step 3: Write the release notes**

Create `docs/releases/0.12.0.md`, in the shape of `docs/releases/0.11.0.md` (read it first):

```md
# TomeCMS 0.12.0

Date: <today, YYYY-MM-DD>
Status: Release candidate; not tagged for production

TomeCMS 0.12.0 is 0.11.0 plus a video in an article, and Stats that writes nothing to a reader's
browser. 0.11.0 began a feature freeze before 1.0.0; this release is the one exception to it, and
the freeze starts again here.

## Upgrading

<the two Upgrading points from the changelog, as sentences>

## Videos

<what a writer does (paste on an empty line, or the menus), what the server fetches and keeps,
what a reader sees and when the player loads, the no-JavaScript link, the lightbox, and what is
left out: other providers, a site's own video files, a portrait frame for Shorts, a caption the
writer writes, choosing another poster. Take each fact from the spec and the code as built.>

## Stats

<the Stats change from the changelog, as a paragraph>

## For theme authors, plugin authors and headless sites

<the video node, its HTML, its classes, the poster in `media`, and that `contentJson` has no schema in
the OpenAPI document, so the node's shape is described here>

## Validation boundary

<the gates run for this release and their results, from Step 6 below; and that 0.12.0 has not yet
been installed on the two real HTTPS servers the 1.0.0 plan names>
```

Write every `<…>` section out in full, in plain sentences, with no em or en dash.

- [ ] **Step 4: Add the release to the road**

In `docs/plans/2026-09-24-road-to-1.0.0.md`, add a row after the 0.11.0 row, leaving the 0.11.0 row as written:

```md
| — | **0.12.0** | A video in an article ([spec](../specs/2026-09-26-video-block-design.md)), the one exception to the freeze; the freeze starts again from it | the release |
```

- [ ] **Step 5: Say it in the README**

In `README.md`, find where the editor's blocks are described (search for "attachment" or "file card") and add one or two sentences on videos: how a writer adds one, and that the player loads only when a reader presses play. Where the README says the public site needs no consent banner or describes what Stats stores, add that a video loads nothing from YouTube or Vimeo before a click.

- [ ] **Step 6: Run every gate once**

Run, one at a time, `uptime` before each stack:
1. `npm run check`
2. `npm run test:unit`
3. `npm run test:integration`
4. `npm run test:e2e`

Expected: all pass. A failure in `editor-blocks.spec.ts`'s alignment test is a known flake on `main`: run that file alone; if it passes alone, note it in the release notes' Validation boundary and go on. Put the counts in the release notes.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md docs/releases/0.12.0.md docs/plans/2026-09-24-road-to-1.0.0.md README.md
```

Message:

```text
chore(release): 0.12.0

A video in an article, the one exception to the freeze before 1.0.0,
and Stats that writes nothing to a reader's browser. The freeze starts
again from here.
```
