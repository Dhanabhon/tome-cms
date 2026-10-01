import assert from 'node:assert/strict';
import test from 'node:test';

import { crossSiteRefusal } from '../../src/server/http/origin-guard';

const PUBLIC = 'https://cms.example.com';
const at = (path: string, init: RequestInit & { origin?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set('origin', init.origin);
  // Behind Caddy the app sees http://, as production does.
  return new Request(`http://127.0.0.1:4321${path}`, { method: 'POST', ...init, headers });
};

test('a same-site form post passes behind the proxy, where the app sees http', () => {
  const request = at('/admin/x', { origin: PUBLIC, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(crossSiteRefusal(request, PUBLIC), null);
});

test('a cross-site form post, and a cross-site post with no type, are refused as Astro refused them', () => {
  for (const headers of <Record<string, string>[]>[{ 'content-type': 'application/x-www-form-urlencoded' }, { 'content-type': 'multipart/form-data; boundary=x' }, { 'content-type': 'text/plain' }, {}]) {
    const refused = crossSiteRefusal(at('/api/admin/media', { origin: 'https://evil.example', headers }), PUBLIC);
    assert.equal(refused?.status, 403, JSON.stringify(headers));
  }
  // No Origin header at all is not the site either.
  assert.equal(crossSiteRefusal(at('/x', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }), PUBLIC)?.status, 403);
});

test('JSON is left to the routes, which check origin themselves, and reads are never refused', () => {
  assert.equal(crossSiteRefusal(at('/api/admin/posts', { origin: 'https://evil.example', headers: { 'content-type': 'application/json' } }), PUBLIC), null);
  assert.equal(crossSiteRefusal(new Request('http://127.0.0.1:4321/x', { method: 'GET', headers: { origin: 'https://evil.example' } }), PUBLIC), null);
});

test('the OAuth token endpoint and /mcp are called by other servers, with no Origin, and pass', () => {
  for (const path of ['/oauth/token', '/oauth/register', '/mcp']) {
    assert.equal(crossSiteRefusal(at(path, { headers: { 'content-type': 'application/x-www-form-urlencoded' } }), PUBLIC), null, path);
  }
});

test('local development, where the app is its own public origin, still passes', () => {
  const request = new Request('http://localhost:4321/admin/x', { method: 'POST', headers: { origin: 'http://localhost:4321', 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(crossSiteRefusal(request, 'http://localhost:4321'), null);
});
