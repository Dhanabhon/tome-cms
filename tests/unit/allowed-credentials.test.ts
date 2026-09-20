import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { withOwnerAllowedCredentials, withoutExcludedCredentials } from '../../src/server/auth/allowed-credentials';

const owner = async () => [{ id: 'dtNf-v2JIxE7heny6kcsWQ', transports: ['hybrid', 'internal'], type: 'public-key' as const }];
const options = (extra: Record<string, unknown> = {}) => Response.json(
  { rpId: 'localhost', challenge: 'a-challenge', timeout: 60_000, userVerification: 'preferred', ...extra },
  { headers: { 'Set-Cookie': 'better-auth.better-auth-passkey=token; Path=/; HttpOnly' } },
);

test('a sign-in challenge names the Passkeys this installation knows', async () => {
  const narrowed = await withOwnerAllowedCredentials(options(), owner);
  const body = await narrowed.json() as { allowCredentials: unknown; challenge: string };
  // type is a required member of a WebAuthn descriptor, and the one thing this list does not
  // get for free: better-auth's own list is normalised by simplewebauthn on the way out, and
  // this one is appended after that. Without it navigator.credentials.get() throws a
  // TypeError before the ceremony starts, and the client reports it as though no Passkey had
  // been offered -- which is how it locked the owner out for a day before anyone saw it.
  assert.deepEqual(body.allowCredentials, [{ id: 'dtNf-v2JIxE7heny6kcsWQ', transports: ['hybrid', 'internal'], type: 'public-key' }]);
  // The challenge the server just recorded has to survive, and so does the cookie that
  // carries the token it was recorded under -- without it every sign-in is CHALLENGE_NOT_FOUND.
  assert.equal(body.challenge, 'a-challenge');
  assert.match(narrowed.headers.getSetCookie().join(), /better-auth-passkey=token/);
  assert.equal(narrowed.status, 200);
});

test('a response that is already narrowed, or is not one of these, is passed through', async () => {
  // better-auth fills the list itself for a caller who has a session.
  const already = options({ allowCredentials: [] });
  assert.equal(await withOwnerAllowedCredentials(already, owner), already);
  const failed = Response.json({ message: 'nope' }, { status: 400 });
  assert.equal(await withOwnerAllowedCredentials(failed, owner), failed);
  const text = new Response('nope', { headers: { 'Content-Type': 'text/plain' } });
  assert.equal(await withOwnerAllowedCredentials(text, owner), text);
  // An installation with no Passkey must not send an empty list: that means "no credential
  // is acceptable", and the browser would refuse to offer anything at all.
  const none = options();
  assert.equal(await withOwnerAllowedCredentials(none, async () => []), none);
});

test('the challenge is narrowed before the request is waved through', () => {
  // The path bypasses the install gate, so the branch has to come before that check.
  const middleware = readFileSync(new URL('../../src/middleware.ts', import.meta.url), 'utf8');
  const narrowing = middleware.indexOf('withOwnerAllowedCredentials');
  const bypass = middleware.indexOf('isSetupBypass(context.url.pathname)', middleware.indexOf('preparedHeadlessRequest'));
  assert.ok(narrowing > 0 && narrowing < bypass, 'the narrowing runs after the bypass returns');
  assert.match(middleware, /const AUTHENTICATE_OPTIONS_PATH = '\/api\/auth\/passkey\/generate-authenticate-options';/);
});

test('a recovery may register over the Passkey it is recovering from', () => {
  // better-auth excludes the owner's existing credentials, which is right for adding a spare
  // and fatal during a recovery: the authenticator answers the exclusion with "already
  // registered", and the owner whose Passkey is gone has no way left to make a new one.
  const route = readFileSync(new URL('../../src/pages/api/auth/[...all].ts', import.meta.url), 'utf8');
  assert.match(route, /const enrolling = request\.method === 'GET' && url\.pathname === registrationOptionsPath && url\.searchParams\.has\('context'\)/);
  assert.match(route, /if \(!enrolling\) return response;/);
  // Adding a spare has no enrollment context, so it keeps the exclusion it needs.
  assert.doesNotMatch(route, /withoutExcludedCredentials\(response\)[\s\S]*?\n  return response;/);
});

test('only the exclusion is dropped, and only where there is one', async () => {
  const withExclusion = Response.json({ challenge: 'a-challenge', user: { id: 'owner' }, excludeCredentials: [{ id: 'gone' }] });
  const opened = await withoutExcludedCredentials(withExclusion);
  const body = await opened.json() as Record<string, unknown>;
  assert.equal('excludeCredentials' in body, false);
  assert.equal(body.challenge, 'a-challenge');
  assert.deepEqual(body.user, { id: 'owner' });
  const plain = Response.json({ challenge: 'a-challenge' });
  assert.equal(await withoutExcludedCredentials(plain), plain, 'nothing to drop, nothing rebuilt');
  const failed = Response.json({ message: 'nope' }, { status: 400 });
  assert.equal(await withoutExcludedCredentials(failed), failed);
});
