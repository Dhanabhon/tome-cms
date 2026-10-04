import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  invalidatePageCache, PAGE_CACHE_MAX_BYTES, PAGE_CACHE_MAX_ENTRY_BYTES, PAGE_CACHE_TTL_MS, pageCacheKey,
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
  for (const path of ['/rss.xml', '/sitemap.xml', '/robots.txt']) assert.equal(pageCacheKey(url(path)), path);
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
  const head = await serve('/en', async () => html('x'), { method: 'HEAD' });
  assert.equal(head.status, 200);
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

  const size = PAGE_CACHE_MAX_ENTRY_BYTES - 1024;
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
