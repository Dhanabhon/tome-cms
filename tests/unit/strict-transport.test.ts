import assert from 'node:assert/strict';
import test from 'node:test';

import type { APIContext, MiddlewareNext } from 'astro';

import { STRICT_TRANSPORT, withStrictTransport } from '../../src/server/http/strict-transport';

const HTTPS = 'https://cms.example.com';

test('an https site tells the browser to use HTTPS for a year, and nothing more', () => {
  const response = withStrictTransport(new Response('ok'), HTTPS);
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(STRICT_TRANSPORT, 'max-age=31536000');
  assert.doesNotMatch(STRICT_TRANSPORT, /includeSubDomains|preload/i);
});

test('a plain-http site (dev, test) gets no header', () => {
  const response = withStrictTransport(new Response('ok'), 'http://localhost:4321');
  assert.equal(response.headers.get('strict-transport-security'), null);
});

test('a missing or unparsable public URL gets no header and does not throw', () => {
  assert.equal(withStrictTransport(new Response('ok'), undefined).headers.get('strict-transport-security'), null);
  assert.equal(withStrictTransport(new Response('ok'), 'not a url').headers.get('strict-transport-security'), null);
});

test('a redirect, whose headers are immutable, is copied rather than thrown on', async () => {
  const redirect = Response.redirect('https://cms.example.com/install', 302);
  assert.throws(() => redirect.headers.set('x', 'y'), 'the premise: its headers are immutable');
  const response = withStrictTransport(redirect, HTTPS);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://cms.example.com/install');
  assert.equal(response.headers.get('strict-transport-security'), STRICT_TRANSPORT);
});

test('a header a route already set is left as it is', () => {
  const response = withStrictTransport(new Response('ok', { headers: { 'Strict-Transport-Security': 'max-age=60' } }), HTTPS);
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=60');
});

test('the body and status survive', async () => {
  const response = withStrictTransport(new Response('body', { status: 404 }), HTTPS);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'body');
});

// The wiring, checked on a real answer: /health/live is answered by the middleware itself.
async function middlewareHeader(publicUrl: string): Promise<{ header: string | null; body: string }> {
  const keys = [
    'DATABASE_URL',
    'TOME_CMS_PUBLIC_URL',
    'TOME_CMS_AUTH_SECRET',
    'TOME_CMS_CONTEXT_SECRET',
    'TOME_CMS_RECOVERY_PEPPER',
  ] as const;
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.TOME_CMS_PUBLIC_URL = publicUrl;

  try {
    const { onRequest } = await import('../../src/middleware');
    const next: MiddlewareNext = async () => new Response('next');
    const response = await onRequest({
      locals: {},
      request: new Request('http://localhost:4321/health/live'),
      url: new URL('http://localhost:4321/health/live'),
    } as APIContext, next);
    return { header: response?.headers.get('strict-transport-security') ?? null, body: (await response?.text()) ?? '' };
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('the middleware answers an https site with the header', async () => {
  assert.deepEqual(await middlewareHeader(HTTPS), { header: 'max-age=31536000', body: 'next' });
});

test('the middleware answers a plain-http site without it', async () => {
  assert.deepEqual(await middlewareHeader('http://localhost:4321'), { header: null, body: 'next' });
});
