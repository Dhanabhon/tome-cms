import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  ENTRY_OVERHEAD_BYTES, invalidatePageCache, PAGE_CACHE_MAX_BYTES, PAGE_CACHE_MAX_ENTRY_BYTES, PAGE_CACHE_TTL_MS, pageCacheKey,
  resetPageCacheForTest, servePublicPage,
} from '../../src/server/http/page-cache';

const ORIGIN = 'https://cms.example.com';
const url = (path: string) => new URL(path, ORIGIN);
const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Request(url(path), { method, headers });
const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' }, ...init });
const never = async () => null;

async function serve(path: string, render: () => Promise<Response>, options: { headers?: Record<string, string>; method?: string; nextScheduled?: () => Promise<Date | null>; now?: () => number; bundled?: boolean } = {}) {
  return servePublicPage({
    request: get(path, options.headers, options.method), url: url(path), bundled: options.bundled ?? true,
    render, nextScheduled: options.nextScheduled ?? never, now: options.now,
  });
}

beforeEach(() => resetPageCacheForTest());

test('the key is the path and the two known parameters, sorted; anything else is dropped', () => {
  assert.equal(pageCacheKey(url('/th')), '/th');
  assert.equal(pageCacheKey(url('/th/')), '/th/');
  assert.equal(pageCacheKey(url('/en?cursor=abc&category=Recipes')), pageCacheKey(url('/en?category=Recipes&cursor=abc')));
  assert.equal(pageCacheKey(url('/en?utm_source=x&category=Recipes')), pageCacheKey(url('/en?category=Recipes')));
  assert.equal(pageCacheKey(url('/en?category=')), '/en', 'an empty value is absent');
  assert.equal(pageCacheKey(url('/en/blog/bread')), '/en/blog/bread');
  assert.equal(pageCacheKey(url('/th/about')), '/th/about');
  assert.equal(pageCacheKey(url('/th?cursor=a')), '/th?cursor=a');
  assert.equal(pageCacheKey(url('/th/?category=B')), '/th/?category=B');
  for (const path of ['/rss.xml', '/sitemap.xml', '/robots.txt']) assert.equal(pageCacheKey(url(path)), path);
});

test('only the home page keeps the parameters; posts, pages and feeds key to the bare path', () => {
  assert.equal(pageCacheKey(url('/robots.txt?category=x')), '/robots.txt');
  assert.equal(pageCacheKey(url('/sitemap.xml?cursor=x&category=y')), '/sitemap.xml');
  assert.equal(pageCacheKey(url('/en/blog/a?cursor=y')), '/en/blog/a');
  assert.equal(pageCacheKey(url('/th/about?category=z')), '/th/about');
});

test('search, and every path outside the public list, has no key', () => {
  for (const path of ['/en?q=bread', '/en?q=', '/', '/admin', '/api/v1/content/posts', '/media/x.webp', '/mcp', '/install', '/recovery',
    '/maintenance', '/health/live', '/oauth/token', '/fr', '/th/blog', '/th/blog/a/b', '/_astro/x.css']) {
    assert.equal(pageCacheKey(url(path)), null, path);
  }
});

test('a percent-encoded Thai slug is its own key and does not throw', () => {
  const a = pageCacheKey(url('/th/blog/%E0%B8%82%E0%B8%99%E0%B8%A1'));
  const b = pageCacheKey(url('/th/blog/%E0%B8%82%E0%B8%99%E0%B8%A1%E0%B8%9B%E0%B8%B1%E0%B8%87'));
  assert.ok(a && b && a !== b);
});

test('a miss renders and stores; the next request is a hit that does not render', async () => {
  let renders = 0;
  const render = async () => { renders += 1; return html('<p>one</p>'); };
  const first = await serve('/en', render);
  assert.equal(first.headers.get('x-tome-cache'), 'miss');
  assert.equal(await first.text(), '<p>one</p>');
  const second = await serve('/en', render);
  assert.equal(second.headers.get('x-tome-cache'), 'hit');
  assert.equal(second.headers.get('content-type'), 'text/html');
  assert.equal(second.headers.get('cache-control'), 'no-cache');
  assert.match(second.headers.get('etag') ?? '', /^"[0-9a-f]{64}"$/);
  assert.equal(await second.text(), '<p>one</p>');
  assert.equal(renders, 1);
});

test('a streamed body is read once, stored, and still reaches the reader', async () => {
  const render = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('<p>a</p>')); controller.enqueue(new TextEncoder().encode('<p>b</p>')); controller.close(); },
  }), { status: 200, headers: { 'Content-Type': 'text/html' } });
  assert.equal(await (await serve('/th', render)).text(), '<p>a</p><p>b</p>');
  assert.equal(await (await serve('/th', render)).text(), '<p>a</p><p>b</p>');
});

test('a matching If-None-Match gets 304 with no body; HEAD gets no body', async () => {
  const first = await serve('/en', async () => html('x'));
  const etag = first.headers.get('etag')!;
  const notModified = await serve('/en', async () => html('x'), { headers: { 'If-None-Match': etag } });
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), '');
  const head = await serve('/en', async () => html('unused'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('x-tome-cache'), 'hit', 'a HEAD after a GET is answered from the cache');
  assert.equal(await head.text(), '');
});

test('what may not be stored passes through untouched, with no ETag', async () => {
  const cases: Array<[string, Response]> = [
    ['404', new Response('gone', { status: 404 })],
    ['500', new Response('broken', { status: 500 })],
    ['302', new Response(null, { status: 302, headers: { Location: '/th' } })],
    ['cookie', html('x', { headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'a=b' } })],
    ['no-store', html('x', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } })],
    ['private', html('x', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store' } })],
  ];
  for (const [name, response] of cases) {
    resetPageCacheForTest();
    let renders = 0;
    const render = async () => { renders += 1; return response.clone(); };
    const first = await serve('/en', render);
    assert.equal(first.status, response.status, name);
    assert.equal(first.headers.get('etag'), null, name);
    assert.equal(first.headers.get('x-tome-cache'), null, name);
    await serve('/en', render);
    assert.equal(renders, 2, `${name} was stored`);
  }
});

test('a headless site, a search and a POST are never served from or stored in the cache', async () => {
  let renders = 0;
  const render = async () => { renders += 1; return html('x'); };
  await serve('/en', render, { bundled: false });
  await serve('/en', render, { bundled: false });
  await serve('/en?q=bread', render);
  await serve('/en?q=bread', render);
  await serve('/en', render, { method: 'POST' });
  assert.equal(renders, 5);
});

test('an invalidation clears every entry', async () => {
  let renders = 0;
  const render = async () => { renders += 1; return html(`v${renders}`); };
  await serve('/en', render);
  invalidatePageCache();
  assert.equal(await (await serve('/en', render)).text(), 'v2');
});

test('an invalidation during a render means that render is not stored', async () => {
  let renders = 0;
  const render = async () => { renders += 1; if (renders === 1) invalidatePageCache(); return html(`v${renders}`); };
  await serve('/en', render);
  const second = await serve('/en', render);
  assert.equal(second.headers.get('x-tome-cache'), 'miss');
  assert.equal(await second.text(), 'v2');
});

test('an entry expires after five minutes, or at the next scheduled post if that is sooner', async () => {
  let clock = 1_000_000;
  const now = () => clock;
  let renders = 0;
  const render = async () => { renders += 1; return html('x'); };
  await serve('/en', render, { now });
  clock += PAGE_CACHE_TTL_MS - 1;
  await serve('/en', render, { now });
  assert.equal(renders, 1, 'still fresh just before five minutes');
  clock += 2;
  await serve('/en', render, { now });
  assert.equal(renders, 2, 'expired at five minutes');

  resetPageCacheForTest();
  renders = 0;
  clock = 1_000_000;
  const soon = async () => new Date(clock + 10_000);
  await serve('/th', render, { now, nextScheduled: soon });
  clock += 10_001;
  await serve('/th', render, { now, nextScheduled: soon });
  assert.equal(renders, 2, 'expired when the scheduled post went public');
});

test('the cache keeps to its cap, dropping the least recently used, and refuses one huge entry', async () => {
  const big = 'x'.repeat(PAGE_CACHE_MAX_ENTRY_BYTES + 1);
  let renders = 0;
  await serve('/en/blog/huge', async () => { renders += 1; return html(big); });
  await serve('/en/blog/huge', async () => { renders += 1; return html(big); });
  assert.equal(renders, 2, 'an entry over the per-entry cap is not stored');

  // Leave room under the per-entry cap for the key, headers, ETag and overhead the entry is charged.
  const size = PAGE_CACHE_MAX_ENTRY_BYTES - 2048;
  const count = Math.floor(PAGE_CACHE_MAX_BYTES / size) + 2;
  const body = 'y'.repeat(size);
  for (let index = 0; index < count; index += 1) await serve(`/en/blog/p${index}`, async () => html(body));
  // The first ones were pushed out; the last one is still there.
  const oldest = await serve('/en/blog/p0', async () => html(body));
  assert.equal(oldest.headers.get('x-tome-cache'), 'miss');
  const newest = await serve(`/en/blog/p${count - 1}`, async () => html(body));
  assert.equal(newest.headers.get('x-tome-cache'), 'hit');
});

test('stored headers keep what the page set, minus set-cookie, date and content-length', async () => {
  await serve('/en', async () => html('x', { headers: { 'Content-Type': 'text/html', Link: '</fonts/a.woff2>; rel=preload', Date: 'Mon, 01 Jan 2026 00:00:00 GMT', 'Content-Length': '1' } }));
  const hit = await serve('/en', async () => html('unused'));
  assert.equal(hit.headers.get('link'), '</fonts/a.woff2>; rel=preload');
  assert.equal(hit.headers.get('date'), null);
  assert.notEqual(hit.headers.get('content-length'), '1');
});

test('many tiny entries are charged their overhead, so they reach the cap and evict', async () => {
  const count = Math.floor(PAGE_CACHE_MAX_BYTES / ENTRY_OVERHEAD_BYTES) + 2;
  const body = 'z'.repeat(100);
  for (let index = 0; index < count; index += 1) await serve(`/en?category=c${index}`, async () => html(body));
  // By body bytes alone these would be about 3 MB; with their overhead the first ones are out.
  assert.equal((await serve('/en?category=c0', async () => html(body))).headers.get('x-tome-cache'), 'miss');
  assert.equal((await serve(`/en?category=c${count - 1}`, async () => html(body))).headers.get('x-tome-cache'), 'hit');
});

test('a hit refreshes recency, so the entry that keeps being read outlives older ones', async () => {
  const size = PAGE_CACHE_MAX_ENTRY_BYTES - 2048;
  const body = 'y'.repeat(size);
  const count = Math.floor(PAGE_CACHE_MAX_BYTES / size) + 2;
  // A miss would store p0 afresh and hide an eviction, so count how often it is drawn: only once.
  let firstRenders = 0;
  const first = async () => { firstRenders += 1; return html(body); };
  await serve('/en/blog/p0', first);
  for (let index = 1; index < count; index += 1) {
    await serve(`/en/blog/p${index}`, async () => html(body));
    await serve('/en/blog/p0', first);
  }
  assert.equal(firstRenders, 1, 'p0 was never evicted while it kept being read');
  assert.equal((await serve('/en/blog/p1', async () => html(body))).headers.get('x-tome-cache'), 'miss');
});

test('If-None-Match compares weakly, takes a list, and accepts *', async () => {
  const etag = (await serve('/en', async () => html('x'))).headers.get('etag')!;
  const status = async (value: string) => (await serve('/en', async () => html('x'), { headers: { 'If-None-Match': value } })).status;
  assert.equal(await status(`W/${etag}`), 304, 'weak form');
  assert.equal(await status(`"nope", ${etag}`), 304, 'a list holding ours');
  assert.equal(await status(`"nope",W/${etag}`), 304, 'a list holding the weak form');
  assert.equal(await status('*'), 304, 'star');
  assert.equal(await status('"nope"'), 200, 'another tag');
  assert.equal(await status(`${etag.slice(0, -2)}"`), 200, 'a near miss');
});

test('a HEAD miss never fills the cache, so the GET after it still gets the full page', async () => {
  // How Astro answers a HEAD for an endpoint: the headers, and no body.
  const endpointHead = async () => new Response(null, { status: 200, headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=300' } });
  const endpointGet = async () => new Response('<urlset/>', { status: 200, headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=300' } });
  const head = await serve('/sitemap.xml', endpointHead, { method: 'HEAD' });
  assert.equal(head.headers.get('x-tome-cache'), null, 'a HEAD miss is passed through untouched');
  assert.equal(head.headers.get('etag'), null);
  const first = await serve('/sitemap.xml', endpointGet);
  assert.equal(first.headers.get('x-tome-cache'), 'miss');
  assert.equal(await first.text(), '<urlset/>');
  const second = await serve('/sitemap.xml', endpointGet);
  assert.equal(second.headers.get('x-tome-cache'), 'hit');
  assert.equal(await second.text(), '<urlset/>');
});

test('a scheduled post that went public during the render means the page is not served again', async () => {
  let clock = 1_000_000;
  const now = () => clock;
  let renders = 0;
  const render = async () => { renders += 1; clock += 5_000; return html('x'); };
  // The next post is due at clock+1s, and the render takes 5s: what it drew may lack that post.
  const due = new Date(clock + 1_000);
  // Like the real query, it names the next moment still ahead: once the render is over, that one has passed.
  const nextScheduled = async () => (clock < due.getTime() ? due : null);
  const first = await serve('/en', render, { now, nextScheduled });
  assert.equal(await first.text(), 'x');
  await serve('/en', render, { now, nextScheduled });
  assert.equal(renders, 2);
});

test('a failing or nonsensical nextScheduled still answers the page, but does not keep it', async () => {
  for (const nextScheduled of [async () => { throw new Error('db down'); }, async () => new Date('nope')]) {
    resetPageCacheForTest();
    let renders = 0;
    const render = async () => { renders += 1; return html('ok'); };
    const first = await serve('/en', render, { nextScheduled });
    assert.equal(first.status, 200);
    assert.equal(await first.text(), 'ok');
    await serve('/en', render, { nextScheduled });
    assert.equal(renders, 2);
  }
});

test('an invalidation during the schedule lookup means the page is not stored', async () => {
  let renders = 0;
  const render = async () => { renders += 1; return html('x'); };
  const nextScheduled = async () => { invalidatePageCache(); return null; };
  await serve('/en', render, { nextScheduled });
  const second = await serve('/en', render, { nextScheduled });
  assert.equal(second.headers.get('x-tome-cache'), 'miss');
  assert.equal(renders, 2);
});
