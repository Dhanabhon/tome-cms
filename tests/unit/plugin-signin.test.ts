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

test('the form reads the answer out of itself', () => {
  const form = read('src/components/admin/PasskeySignIn.tsx');
  // Turnstile writes its answer into a hidden input in the form it is in, so the submit
  // handler takes it from its own FormData -- no global, and nothing here knows what it means.
  assert.match(form, /new FormData\(event\.currentTarget\)\.get\(widget\.tokenField\)/);
  assert.match(form, /'X-TomeCMS-Plugin-Token': token/);
  // Nothing is sent when there is no widget, so a form without one is the form it was.
  assert.match(form, /token \? \{ fetchOptions: \{ headers: \{ 'X-TomeCMS-Plugin-Token': token \} \} \} : undefined/);
  // The island is told what to draw. It does not import a plugin, so no plugin's code
  // reaches a browser signing in to an installation that is not using it.
  assert.doesNotMatch(form, /from '\.\.\/\.\.\/plugins\/(?!contract)/);
  assert.doesNotMatch(form, /turnstile|cloudflare/i);
});

test('the sign-in page resolves the widget on the server, and only one of them', () => {
  const page = read('src/pages/admin/index.astro');
  assert.match(page, /const signInWidget = settings && authRequired \? await activeSignInWidget\(settings\.owner_id\) : null;/);
  assert.match(page, /widget=\{signInWidget\?\.widget \?\? null\}/);
  // Two challenges on one form is two tokens, two verdicts, and a question about what
  // happens when they disagree that the owner did not mean to ask.
  const resolver = read('src/server/plugins/sign-in.ts');
  assert.match(resolver, /Promise<ActiveSignInWidget \| null>/);
  assert.match(resolver, /if \(widget\) return \{ pluginId, widget \};/);
});
