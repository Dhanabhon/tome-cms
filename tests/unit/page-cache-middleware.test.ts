import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { afterWrite, cacheablePublicAnswer } from '../../src/middleware';
import { pageCacheGeneration, resetPageCacheForTest } from '../../src/server/http/page-cache';
import { markRenderDegraded, withRequestMemo } from '../../src/server/request-memo';

beforeEach(() => resetPageCacheForTest());

test('a successful admin write clears the page cache; a failed one does not', () => {
  const before = pageCacheGeneration();
  afterWrite('/api/admin/posts/abc', new Response(null, { status: 200 }));
  assert.equal(pageCacheGeneration(), before + 1);
  afterWrite('/api/admin/posts/abc', new Response(null, { status: 204 }));
  assert.equal(pageCacheGeneration(), before + 2);
  afterWrite('/api/admin/posts/abc', new Response(null, { status: 409 }));
  afterWrite('/api/admin/posts/abc', new Response(null, { status: 500 }));
  assert.equal(pageCacheGeneration(), before + 2);
});

test('the stats beacon, sign-in and other public writes never clear it', () => {
  const before = pageCacheGeneration();
  for (const path of ['/api/v1/stats/hit', '/api/auth/sign-in/passkey', '/mcp', '/oauth/token', '/api/install/finalize', '/api/administrator']) {
    afterWrite(path, new Response(null, { status: 200 }));
  }
  assert.equal(pageCacheGeneration(), before);
});

function counting() {
  let renders = 0;
  const render = async () => new Response(`page ${(renders += 1)}`, { headers: { 'Content-Type': 'text/html' } });
  const ask = (path: string, bundled = true, method = 'GET') => {
    const url = new URL(`http://localhost:4321${path}`);
    return cacheablePublicAnswer({ request: new Request(url, { method }), url }, render, { bundled, nextScheduled: async () => null });
  };
  return { ask, renders: () => renders };
}

test('a public page is rendered once and then answered from the cache', async () => {
  const { ask, renders } = counting();
  assert.equal(await (await ask('/en')).text(), 'page 1');
  const second = await ask('/en');
  assert.equal(await second.text(), 'page 1');
  assert.equal(second.headers.get('X-Tome-Cache'), 'hit');
  assert.equal(renders(), 1);
});

test('the admin, the API and a headless site are rendered every time', async () => {
  const { ask, renders } = counting();
  await ask('/admin');
  await ask('/admin');
  await ask('/api/v1/content/posts');
  await ask('/api/v1/content/posts');
  assert.equal(renders(), 4);
  await ask('/th', false);
  await ask('/th', false);
  assert.equal(renders(), 6);
});

test('an admin write between two reads makes the second render again', async () => {
  const { ask, renders } = counting();
  await ask('/en');
  afterWrite('/api/admin/posts/abc', new Response(null, { status: 200 }));
  assert.equal(await (await ask('/en')).text(), 'page 2');
  assert.equal(renders(), 2);
});

test('a degraded render is not kept, and an interleaved whole render beside it is', async () => {
  let renders = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ask = (path: string, render: () => Promise<Response>) => {
    const url = new URL(`http://localhost:4321${path}`);
    return withRequestMemo(() => cacheablePublicAnswer({ request: new Request(url) , url }, async () => { renders += 1; return render(); }, { bundled: true, nextScheduled: async () => null }));
  };
  const failing = ask('/en', async () => { await gate; markRenderDegraded(); return new Response('no menu', { headers: { 'Content-Type': 'text/html' } }); });
  const whole = ask('/th', async () => { release(); await new Promise((resolve) => setTimeout(resolve, 0)); return new Response('whole', { headers: { 'Content-Type': 'text/html' } }); });
  await Promise.all([failing, whole]);
  const again = await ask('/en', async () => new Response('menu', { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(await again.text(), 'menu', 'the page without its menu was not kept');
  assert.equal((await ask('/th', async () => new Response('other', { headers: { 'Content-Type': 'text/html' } }))).headers.get('X-Tome-Cache'), 'hit');
  assert.equal(renders, 3);
});
