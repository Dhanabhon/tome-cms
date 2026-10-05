import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { signInWidget } from '../../src/plugins/turnstile';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const KEYS = { secretKey: '1x0000000000000000000000000000000AA', siteKey: '1x00000000000000000000AA' };

test('a challenge is offered only when the check behind it can be made', () => {
  // A site key with no secret key puts a box on the sign-in form that nobody can verify,
  // which looks like security and is decoration.
  assert.equal(signInWidget({}), null);
  assert.equal(signInWidget({ siteKey: KEYS.siteKey }), null);
  assert.equal(signInWidget({ secretKey: KEYS.secretKey }), null);
  assert.equal(signInWidget({ secretKey: '   ', siteKey: KEYS.siteKey }), null);

  const widget = signInWidget(KEYS);
  assert.deepEqual(widget, {
    container: { className: 'cf-turnstile', dataset: { sitekey: KEYS.siteKey, theme: 'auto' } },
    script: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
    tokenField: 'cf-turnstile-response',
  });
});

test('the recovery-code form reads the answer out of itself, waits for it, and never sends it twice', () => {
  const form = read('src/components/admin/RecoveryPasskey.tsx');
  // Turnstile writes its answer into a hidden input in the form it is in, so the submit
  // handler takes it from its own FormData -- no global, and nothing here knows what it means.
  assert.match(form, /new FormData\(event\.currentTarget\)\.get\(widget\.tokenField\)/);
  // Pressed before the check has answered: say so, and send nothing.
  assert.match(form, /if \(widget && !token\) \{\s+setError\(copy\.security\.waitForCheck\);\s+return;/);
  assert.match(form, /\.\.\.\(token \? \{ 'X-TomeCMS-Plugin-Token': token \} : \{\}\)/);
  // A token is spent once it is sent, so every attempt that did not end in a passkey asks for a fresh one.
  assert.match(form, /window\.turnstile\?\.reset\?\.\(\)/);
  // A refusal is told apart from the origin guard's 403 by its code.
  assert.match(form, /describePasskeyFailure\(\{ code: payload\.code, status: response\.status \}/);
  // The island is told what to draw. It does not import a plugin, so no plugin's code
  // reaches a browser on an installation that is not using it.
  assert.doesNotMatch(form, /from '\.\.\/\.\.\/plugins\/(?!contract)/);
  assert.doesNotMatch(form, /cloudflare/i);
});

test('the sign-in form carries no challenge, and the recovery page resolves one on the server', () => {
  // A passkey cannot be guessed or phished; the sign-in asks the plugin nothing.
  const signIn = read('src/components/admin/PasskeySignIn.tsx');
  assert.doesNotMatch(signIn, /widget|Plugin-Token/i);
  assert.doesNotMatch(read('src/pages/admin/index.astro'), /activeSignInWidget|signInWidget/);
  assert.doesNotMatch(read('src/pages/api/auth/[...all].ts'), /guardSignIn|Plugin-Token/);

  const page = read('src/pages/recovery.astro');
  assert.match(page, /await activeSignInWidget\(ownerSettings\.owner_id\)/);
  assert.match(page, /widget=\{widget\}/);
  // Two challenges on one form is two tokens, two verdicts, and a question about what
  // happens when they disagree that the owner did not mean to ask.
  const resolver = read('src/server/plugins/sign-in.ts');
  assert.match(resolver, /async function activePlugin\(ownerId: string\): Promise<ActivePlugin \| null>/);
  assert.match(resolver, /if \(plugin && widget\) return \{ plugin, pluginId, settings, widget \};/);
  // And it is resolved once, so the plugin that drew the widget is the plugin asked about
  // the answer -- they cannot come apart.
  assert.match(resolver, /export async function activeSignInWidget[\s\S]*?await activePlugin\(ownerId\)/);
  assert.match(resolver, /export async function guardSignIn[\s\S]*?await activePlugin\(input\.ownerId\)/);
});
