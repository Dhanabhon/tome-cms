import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { describePasskeyException, describePasskeyFailure, readPasskeyCode, readPasskeyStatus } from '../../src/lib/passkey-failure';

const copy = adminCopy('en');
const FALLBACK = 'fallback sentence';
const REFUSED = 'unauthorized sentence';

test('the status is read from either shape the client returns', () => {
  // signInPasskey hands back its own { data, error } on a WebAuthn failure and the
  // raw response when the options request was refused; only the first is nested.
  assert.equal(readPasskeyStatus({ data: null, error: { code: 'AUTH_CANCELLED', status: 400 } }), 400);
  assert.equal(readPasskeyStatus({ status: 403 }), 403);
  assert.equal(readPasskeyStatus({ data: {}, error: null }), undefined);
  for (const junk of [null, undefined, 'error', 42, [], { error: { status: '403' } }]) {
    assert.equal(readPasskeyStatus(junk), undefined, `${JSON.stringify(junk)} carries no usable status`);
  }
});

test('each server refusal names its own cause', () => {
  const named: ReadonlyArray<readonly [number, string]> = [
    [403, copy.auth.originRejected],
    [429, copy.auth.tooManyAttempts],
    [500, copy.auth.serverError],
    [503, copy.auth.serverError],
  ];
  for (const [status, expected] of named) {
    assert.equal(describePasskeyFailure({ error: { status } }, copy, FALLBACK, REFUSED), expected, `status ${status}`);
  }
});

test('401 says what the flow was refused, not what the flow assumed', () => {
  // Signing in has no session to expire: there, better-auth's 401 means it does not know
  // the credential the browser offered. Saying "your session expired" on a sign-in page
  // sends the owner to reload a page that was never the problem.
  assert.equal(describePasskeyFailure({ error: { status: 401 } }, copy, FALLBACK, REFUSED), REFUSED);
  const signIn = readFileSync(new URL('../../src/components/admin/PasskeySignIn.tsx', import.meta.url), 'utf8');
  assert.match(signIn, /describePasskeyFailure\(result, copy, copy\.auth\.noPasskey, copy\.auth\.passkeyNotRegistered\)/);
  // Adding a spare is the one flow that does need a session, so it keeps the old sentence.
  const security = readFileSync(new URL('../../src/components/admin/SecurityManager.tsx', import.meta.url), 'utf8');
  assert.match(security, /copy\.security\.spareNotAdded, copy\.auth\.sessionExpired\)/);
  assert.equal(security.match(/copy\.auth\.passkeyNotRegistered/g)?.length, 2, 'both sign-in paths name the credential');
  for (const locale of ['en', 'th'] as const) {
    const text = adminCopy(locale);
    assert.ok(text.auth.passkeyNotRegistered.trim());
    assert.notEqual(text.auth.passkeyNotRegistered, text.auth.sessionExpired);
  }
});

test('the caller supplies what "something else" says, because the flows differ', () => {
  // 400 is the authenticator itself, where WebAuthn will not say whether a
  // credential was missing or the prompt was dismissed. Signing in, adding a spare
  // and enrolling a recovery key each need their own sentence for that case.
  assert.equal(describePasskeyFailure({ error: { status: 400 } }, copy, FALLBACK, REFUSED), FALLBACK);
  assert.equal(describePasskeyFailure({ error: { code: 'AUTH_CANCELLED' } }, copy, FALLBACK, REFUSED), FALLBACK);
  assert.equal(describePasskeyFailure(undefined, copy, FALLBACK, REFUSED), FALLBACK);
  assert.equal(describePasskeyFailure({ error: { status: 418 } }, copy, FALLBACK, REFUSED), FALLBACK);
});

test('a request that never landed is not reported as a missing Passkey', () => {
  assert.equal(describePasskeyException(new TypeError('Failed to fetch'), copy, FALLBACK), copy.auth.networkError);
  assert.equal(describePasskeyException(new Error('anything else'), copy, FALLBACK), FALLBACK);
  assert.equal(describePasskeyException('not an error', copy, FALLBACK), FALLBACK);
});

test('the five causes stay five distinct sentences', () => {
  // The bug this replaces: every one of these printed the same line, so the owner
  // could not tell a misconfigured address from a rate limit from a dismissed prompt.
  for (const locale of ['en', 'th'] as const) {
    const text = adminCopy(locale);
    const messages = [403, 429, 401, 500].map((status) => describePasskeyFailure({ error: { status } }, text, text.auth.noPasskey, text.auth.passkeyNotRegistered));
    messages.push(text.auth.noPasskey, describePasskeyException(new TypeError('x'), text, text.auth.noPasskey));
    assert.equal(new Set(messages).size, messages.length, `${locale}: two causes share a message`);
    for (const message of messages) assert.ok(message.trim().length > 0, `${locale}: a cause has no message`);
  }
});

test('the sign-in fallback admits it cannot tell the two WebAuthn cases apart', () => {
  // NotAllowedError covers both "no credential for this site" and "you dismissed it".
  // Claiming only one of them sends the owner looking for the wrong problem.
  assert.match(adminCopy('en').auth.noPasskey, / or /);
  assert.match(adminCopy('th').auth.noPasskey, /หรือ/);
});

test('an authenticator that already holds a Passkey is not a fault to retry past', () => {
  // A spare Passkey exists so that losing one device does not lose the site. The authenticator
  // that already holds one refuses to make a second for the same account -- correctly -- and
  // the owner needs to hear which of their devices to reach for, not "it did not work".
  const refused = { data: null, error: { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', status: 400 } };
  assert.equal(readPasskeyCode(refused), 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED');
  for (const locale of ['en', 'th'] as const) {
    const text = adminCopy(locale);
    assert.equal(describePasskeyFailure(refused, text, text.security.spareNotAdded, text.auth.sessionExpired), text.auth.passkeyAlreadyOnDevice);
    assert.match(text.auth.passkeyAlreadyOnDevice, locale === 'th' ? /โทรศัพท์/ : /phone/);
  }
  // A dismissed prompt and a missing credential are the same code, so neither is guessed at.
  const aborted = { data: null, error: { code: 'ERROR_CEREMONY_ABORTED', status: 400 } };
  assert.equal(describePasskeyFailure(aborted, copy, FALLBACK, REFUSED), FALLBACK);
  for (const junk of [null, 'code', 42, { error: { code: 42 } }]) assert.equal(readPasskeyCode(junk), undefined);
});
