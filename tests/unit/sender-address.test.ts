import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { enforceRateLimit } from '../../src/server/auth/rate-limit';
import { rateLimitKey, senderAddress } from '../../src/server/http/sender-address';

const from = (forwarded?: string) => new Request('http://localhost/api/auth/passkey/verify-authentication', {
  headers: forwarded === undefined ? {} : { 'X-Forwarded-For': forwarded },
});

test('X-Forwarded-For is believed only from the proxy side of the app', () => {
  assert.equal(senderAddress(from('198.51.100.4'), '203.0.113.9'), '203.0.113.9', 'a sender who reached the app directly');
  assert.equal(senderAddress(from('198.51.100.4'), '2001:db8::9'), '2001:db8::9', 'nor does a public IPv6 address get believed');
  assert.equal(senderAddress(from('made-up, 198.51.100.4'), '127.0.0.1'), '198.51.100.4', 'the last entry is the proxy\'s own');
  assert.equal(senderAddress(from('198.51.100.4'), '::1'), '198.51.100.4');
  assert.equal(senderAddress(from('198.51.100.4'), '::ffff:127.0.0.1'), '198.51.100.4');
  assert.equal(senderAddress(from('198.51.100.4'), '172.18.0.1'), '198.51.100.4', 'Docker\'s bridge, which is how the managed install is reached');
  assert.equal(senderAddress(from('2001:db8::7'), '10.0.0.2'), '2001:db8::7');
  assert.equal(senderAddress(from(), '127.0.0.1'), '127.0.0.1', 'no header, nothing to believe');
  assert.equal(senderAddress(from('not an address'), '127.0.0.1'), '127.0.0.1');
});

// The limit takes the sender's address and nothing else. A route that hands it the peer's, which
// behind the proxy is the proxy's for everyone, does not compile, and `npm run check` says so. If
// the parameter is ever loosened to a plain string, the directive below is the line that breaks.
type LimitedAddress = Parameters<typeof enforceRateLimit>[1];
// @ts-expect-error a plain string may be the proxy's address
const proxyAddress: LimitedAddress = '172.18.0.1';
void proxyAddress;

test('the sign-in challenge is told the sender too, and the app never lists its domains', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const gate = read('src/pages/api/auth/[...all].ts');
  assert.match(gate, /remoteIp: senderAddress\(request, context\.clientAddress\)/);
  assert.equal(gate.replace(/senderAddress\([^)]*\)/g, '').includes('clientAddress'), false, 'a raw address is used somewhere in the route');
  // `senderAddress` believes X-Forwarded-For only because Astro hands over the socket's address.
  // Listing the domains makes Astro believe the header first, and the sender writes its first entry.
  assert.doesNotMatch(read('astro.config.mjs'), /allowedDomains/);
});

test('the rate limit key holds an IPv4 address, unwraps an IPv4-mapped one, and reduces any other IPv6 address to its /64', () => {
  assert.equal(rateLimitKey('203.0.113.9'), '203.0.113.9');
  assert.equal(rateLimitKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(
    rateLimitKey('2001:db8:0:0:1::7'), rateLimitKey('2001:0DB8::1:0:0:7'),
    'equivalent spellings of the same /64 give the same key',
  );
  assert.equal(rateLimitKey('2001:DB8::1'), rateLimitKey('2001:db8:0:0:0:0:0:1'), 'case and zero runs are only spelling');
  assert.equal(
    rateLimitKey('2001:db8::1'), rateLimitKey('2001:db8::ffff:1'),
    'addresses that differ only past the /64 share one key',
  );
  assert.notEqual(rateLimitKey('2001:db8:1::1'), rateLimitKey('2001:db8:2::1'), 'a different /64 is a different key');
  assert.equal(rateLimitKey('update-check-address'), 'update-check-address', 'what is not an address is left as it is');
});
