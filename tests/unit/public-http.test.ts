import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import { HttpError } from '../../src/server/http/errors';
import { problem, publicError } from '../../src/server/http/problem';
import { privatePreviewJson, publicJson } from '../../src/server/http/public-response';

function captureLogs<T>(operation: () => T): { logs: string[]; value: T } {
  const logs: string[] = [];
  const original = console.info;
  console.info = (...values: unknown[]) => { logs.push(values.map(String).join(' ')); };
  try {
    return { logs, value: operation() };
  } finally {
    console.info = original;
  }
}

test('public errors use Problem Details, wildcard CORS, and safe request logs', async () => {
  const cases: Array<[unknown, number]> = [
    [new z.ZodError([]), 400],
    [new HttpError(404, 'Post not found.'), 404],
    [new HttpError(503, 'Database unavailable.'), 503],
    [new Error('private error secret'), 500],
  ];
  for (const [error, status] of cases) {
    const request = new Request('https://cms.example/api/v1/content/posts?cursor=private-cursor');
    const { logs, value: response } = captureLogs(() => publicError(request, error, performance.now()));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal(body.status, status);
    assert.equal(body.instance, '/api/v1/content/posts');
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0]!).requestId, body.requestId);
    assert.equal(logs[0]!.includes('private-cursor'), false);
    assert.equal(logs[0]!.includes('private error secret'), false);
  }

  const direct = captureLogs(() => problem(
    new Request('https://cms.example/api/v1/content/posts'), 400, 'Invalid cursor.',
  )).value;
  assert.equal((await direct.json() as { title: string }).title, 'Bad Request');
});

test('public JSON supports validators while previews stay private and redact token paths', async () => {
  const lastModified = new Date('2026-09-08T04:00:00.555Z');
  const first = captureLogs(() => publicJson(
    new Request('https://cms.example/api/v1/content/posts?cursor=private-cursor'),
    { data: [{ id: 'one' }] },
    { lastModified, maxAge: 120 },
  ));
  assert.equal(first.value.status, 200);
  assert.equal(first.value.headers.get('access-control-allow-origin'), '*');
  assert.equal(first.value.headers.get('cache-control'), 'public, max-age=120, s-maxage=120, stale-while-revalidate=600');
  assert.equal(first.value.headers.get('last-modified'), lastModified.toUTCString());
  assert.equal(first.value.headers.has('set-cookie'), false);
  assert.deepEqual(await first.value.json(), { data: [{ id: 'one' }] });
  assert.equal(first.logs[0]!.includes('private-cursor'), false);

  const etag = first.value.headers.get('etag');
  assert.ok(etag);
  for (const headers of [
    new Headers({ 'If-None-Match': etag }),
    new Headers({ 'If-None-Match': `W/${etag}` }),
    new Headers({ 'If-Modified-Since': lastModified.toUTCString() }),
  ]) {
    const response = captureLogs(() => publicJson(
      new Request('https://cms.example/api/v1/content/posts', { headers }),
      { data: [{ id: 'one' }] },
      { lastModified },
    )).value;
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.has('content-type'), false);
  }

  const precedence = captureLogs(() => publicJson(
    new Request('https://cms.example/api/v1/content/posts', { headers: {
      'If-None-Match': '"different"',
      'If-Modified-Since': 'Tue, 09 Sep 2036 04:00:00 GMT',
    } }),
    { data: [] },
    { lastModified },
  )).value;
  assert.equal(precedence.status, 200);

  const preview = captureLogs(() => privatePreviewJson(
    new Request('https://cms.example/api/v1/content/preview/private-token?cursor=private-cursor'),
    { data: { status: 'draft' } },
  ));
  assert.equal(preview.value.headers.get('cache-control'), 'private, no-store');
  assert.equal(preview.value.headers.has('access-control-allow-origin'), false);
  assert.equal(preview.value.headers.has('etag'), false);
  assert.equal(preview.logs.length, 1);
  assert.match(preview.logs[0]!, /\/preview\/\[redacted\]/);
  assert.equal(preview.logs[0]!.includes('private-token'), false);
  assert.equal(preview.logs[0]!.includes('private-cursor'), false);
});
