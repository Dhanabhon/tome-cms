import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { fetchClientMetadata, isPublicAddress } from '../../src/server/mcp/cimd';
import { hashSecret, newSecret, pkceMatches } from '../../src/server/mcp/oauth-crypto';
import { DEFAULT_REDIRECTS, isLoopback, parseExtraRedirects, redirectAllowed, redirectMatches } from '../../src/server/mcp/redirects';

test('secrets are 32 random bytes, stored as their SHA-256', () => {
  const secret = newSecret();
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newSecret(), secret);
  assert.match(hashSecret(secret), /^[0-9a-f]{64}$/);
});

test('PKCE is S256 and nothing else', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(pkceMatches(verifier, challenge), true);
  assert.equal(pkceMatches(verifier, verifier), false, 'plain is not accepted');
  assert.equal(pkceMatches('short', challenge), false);
});

test('Claude, ChatGPT and loopback are allowed; anything else only when the owner adds it', () => {
  assert.deepEqual([...DEFAULT_REDIRECTS], ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect']);
  assert.equal(redirectAllowed('https://claude.ai/api/mcp/auth_callback', []), true);
  assert.equal(redirectAllowed('https://chatgpt.com/connector_platform_oauth_redirect', []), true);
  assert.equal(redirectAllowed('http://localhost:53682/callback', []), true);
  assert.equal(redirectAllowed('http://127.0.0.1:9/any/path', []), true);
  assert.equal(redirectAllowed('https://claude.ai.evil.example/api/mcp/auth_callback', []), false);
  assert.equal(redirectAllowed('https://claude.ai/api/mcp/auth_callback/../x', []), false);
  assert.equal(redirectAllowed('http://example.com/cb', []), false);
  assert.equal(redirectAllowed('https://cursor.example/cb', []), false);
  assert.equal(redirectAllowed('https://cursor.example/cb', ['https://cursor.example/cb']), true);
});

test('a loopback redirect matches its registration on any port; everything else matches exactly', () => {
  assert.equal(redirectMatches(['http://localhost:3118/callback'], 'http://localhost:51000/callback'), true);
  assert.equal(redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:8080/callback'), true);
  assert.equal(redirectMatches(['http://localhost:3118/callback'], 'http://localhost:3118/other'), false);
  assert.equal(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback?x=1'), false);
  assert.equal(isLoopback('http://[::1]:1/cb'), true);
  assert.equal(isLoopback('https://localhost/cb'), false, 'loopback means http to this machine');
});

test('the owner\'s extra redirects are https or loopback, and nothing else survives', () => {
  assert.deepEqual(parseExtraRedirects(' https://a.example/cb , http://localhost:1/x, http://b.example/cb, javascript:alert(1), '), ['https://a.example/cb', 'http://localhost:1/x']);
});

test('a client metadata document is fetched only from a public https address, small and quick', async () => {
  const doc = (body: unknown) => async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const url = 'https://client.example/meta.json';
  assert.deepEqual(
    await fetchClientMetadata(url, { lookup: publicLookup, fetch: doc({ client_id: url, client_name: 'Example', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) }),
    { name: 'Example', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] },
  );
  await assert.rejects(fetchClientMetadata('http://client.example/m', { lookup: publicLookup, fetch: doc({}) }), /https/);
  await assert.rejects(fetchClientMetadata(url, { lookup: async () => [{ address: '10.0.0.5', family: 4 }], fetch: doc({}) }), /public/);
  await assert.rejects(fetchClientMetadata(url, { lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], fetch: doc({}) }), /public/);
  await assert.rejects(fetchClientMetadata(url, { lookup: publicLookup, fetch: doc({ client_id: 'https://other.example/m', client_name: 'x', redirect_uris: [] }) }), /client_id/);
  await assert.rejects(fetchClientMetadata(url, { lookup: publicLookup, fetch: async () => new Response('x'.repeat(70_000)) }), /large/);
  await assert.rejects(fetchClientMetadata(url, { lookup: publicLookup, fetch: async () => new Response(null, { status: 302, headers: { location: 'https://x' } }) }), /redirect|status/);
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('::ffff:101:101'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
