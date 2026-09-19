import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { withOwnerAllowedCredentials } from '../../src/server/auth/allowed-credentials';

const owner = async () => [{ id: 'dtNf-v2JIxE7heny6kcsWQ', transports: ['hybrid', 'internal'] }];
const options = (extra: Record<string, unknown> = {}) => Response.json(
  { rpId: 'localhost', challenge: 'a-challenge', timeout: 60_000, userVerification: 'preferred', ...extra },
  { headers: { 'Set-Cookie': 'better-auth.better-auth-passkey=token; Path=/; HttpOnly' } },
);

test('a sign-in challenge names the Passkeys this installation knows', async () => {
  const narrowed = await withOwnerAllowedCredentials(options(), owner);
  const body = await narrowed.json() as { allowCredentials: unknown; challenge: string };
  assert.deepEqual(body.allowCredentials, [{ id: 'dtNf-v2JIxE7heny6kcsWQ', transports: ['hybrid', 'internal'] }]);
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
