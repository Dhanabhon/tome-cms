import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('every response the middleware answers goes through it', () => {
  const middleware = readFileSync(new URL('../../src/middleware.ts', import.meta.url), 'utf8');
  assert.match(middleware, /withStrictTransport\(/);
  assert.match(middleware, /export const onRequest: MiddlewareHandler = async \(context, next\) => withStrictTransport\(/);
});
