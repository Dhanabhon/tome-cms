import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { describePasskeyFailure } from '../../src/lib/passkey-failure';
import { verifySignIn } from '../../src/plugins/turnstile';
import { verifyTurnstileToken } from '../../src/plugins/turnstile/verify';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const answering = (body: unknown, status = 200) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
  return () => { globalThis.fetch = real; };
};

test('only the visitor\'s own faults refuse the visitor', async () => {
  // A secret key that is wrong, a malformed request, a fault at Cloudflare: the person
  // signing in can do nothing about any of them, and refusing would mean a mistyped key
  // locks the owner out of their own site until they reach a shell.
  for (const code of ['invalid-input-response', 'missing-input-response', 'timeout-or-duplicate']) {
    const restore = answering({ success: false, 'error-codes': [code] });
    assert.equal((await verifyTurnstileToken({ remoteIp: null, secret: 's', token: 't' })).outcome, 'refused', code);
    restore();
  }
  for (const code of ['invalid-input-secret', 'missing-input-secret', 'bad-request', 'internal-error']) {
    const restore = answering({ success: false, 'error-codes': [code] });
    assert.equal((await verifyTurnstileToken({ remoteIp: null, secret: 's', token: 't' })).outcome, 'unavailable', code);
    restore();
  }
  const passed = answering({ success: true });
  assert.equal((await verifyTurnstileToken({ remoteIp: null, secret: 's', token: 't' })).outcome, 'passed');
  passed();
});

test('a Cloudflare that cannot be reached is not a failed challenge', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await verifyTurnstileToken({ remoteIp: null, secret: 's', token: 't' })).outcome, 'unavailable');
  for (const status of [400, 500, 502, 503]) {
    globalThis.fetch = async () => new Response('nope', { status });
    assert.equal((await verifyTurnstileToken({ remoteIp: null, secret: 's', token: 't' })).outcome, 'unavailable', `${status}`);
  }
  globalThis.fetch = async () => new Response('not json', { status: 200 });
  assert.equal((await verifyTurnstileToken({ remoteIp: null, secret: 's', token: 't' })).outcome, 'unavailable');
  globalThis.fetch = real;
});

test('a missing token is refused, and a missing secret is not the visitor\'s problem', async () => {
  // Letting a missing token through would let anything that omits the header past the
  // challenge, which is the whole of what the challenge does.
  assert.equal((await verifySignIn({ remoteIp: null, settings: { secretKey: 's' }, token: null })).outcome, 'refused');
  assert.equal((await verifySignIn({ remoteIp: null, settings: {}, token: 't' })).outcome, 'unavailable');
  assert.equal((await verifySignIn({ remoteIp: null, settings: { secretKey: '  ' }, token: 't' })).outcome, 'unavailable');
});

test('the guard stands on the recovery code, after the rate limit and before the code is read', () => {
  const start = read('src/pages/api/recovery/start.ts');
  const limit = start.indexOf("enforceRateLimit('recovery'");
  const guard = start.indexOf('guardSignIn(');
  const code = start.indexOf('request.json()');
  assert.ok(limit > 0 && limit < guard && guard < code, 'rate limit, then the challenge, then the code');
  assert.match(start, /token: request\.headers\.get\('X-TomeCMS-Plugin-Token'\)/);
  assert.match(start, /verdict\?\.outcome === 'refused'/);
  assert.match(start, /return problem\(request, 403, [^\n]*requestId, 'challenge_refused'\);/);
  // The reason is Cloudflare's codes; the token is never written down.
  assert.match(start, /console\.warn\(`Recovery challenge refused \[\$\{verdict\.pluginId\}\]: \$\{verdict\.detail/);
  assert.match(start, /console\.warn\(`Recovery challenge unavailable/);
  // Registration is how a recovery ends. A challenge across it would be a second wall across the exit.
  const gate = read('src/pages/api/auth/[...all].ts');
  assert.doesNotMatch(gate, /guardSignIn|challenge_refused/);
});

test('a refused challenge says so, and says where the way out is', () => {
  // 403 has meant the origin guard here since before there were plugins. The code tells
  // the two apart, so neither refusal is described as the other.
  const refusal = { error: { code: 'challenge_refused', status: 403 } };
  for (const locale of ['en', 'th'] as const) {
    const copy = adminCopy(locale);
    assert.equal(describePasskeyFailure(refusal, copy, 'fallback', 'unauthorized'), copy.auth.challengeRefused);
    assert.notEqual(copy.auth.challengeRefused, copy.auth.originRejected);
    assert.match(copy.auth.challengeRefused, /npm run plugin:disable/);
    // A check that never loads would leave only "wait" on the screen: that line names the way out too.
    assert.match(copy.security.waitForCheck, /npm run plugin:disable turnstile/);
    // The switch dialog says where the check now stands.
    assert.doesNotMatch(`${copy.plugins.turnstileOn} ${copy.plugins.turnstileOff}`, /sign-in|เข้าสู่ระบบ/);
  }
  assert.equal(
    describePasskeyFailure({ error: { status: 403 } }, adminCopy('en'), 'fallback', 'unauthorized'),
    adminCopy('en').auth.originRejected,
  );
});
