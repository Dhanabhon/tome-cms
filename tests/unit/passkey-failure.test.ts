import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import { describePasskeyException, describePasskeyFailure, readPasskeyStatus } from '../../src/lib/passkey-failure';

const copy = adminCopy('en');
const FALLBACK = 'fallback sentence';

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
    [401, copy.auth.sessionExpired],
    [500, copy.auth.serverError],
    [503, copy.auth.serverError],
  ];
  for (const [status, expected] of named) {
    assert.equal(describePasskeyFailure({ error: { status } }, copy, FALLBACK), expected, `status ${status}`);
  }
});

test('the caller supplies what "something else" says, because the flows differ', () => {
  // 400 is the authenticator itself, where WebAuthn will not say whether a
  // credential was missing or the prompt was dismissed. Signing in, adding a spare
  // and enrolling a recovery key each need their own sentence for that case.
  assert.equal(describePasskeyFailure({ error: { status: 400 } }, copy, FALLBACK), FALLBACK);
  assert.equal(describePasskeyFailure({ error: { code: 'AUTH_CANCELLED' } }, copy, FALLBACK), FALLBACK);
  assert.equal(describePasskeyFailure(undefined, copy, FALLBACK), FALLBACK);
  assert.equal(describePasskeyFailure({ error: { status: 418 } }, copy, FALLBACK), FALLBACK);
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
    const messages = [403, 429, 401, 500].map((status) => describePasskeyFailure({ error: { status } }, text, text.auth.noPasskey));
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
