import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const SOURCE = readFileSync(new URL('../../src/components/admin/PluginManager.tsx', import.meta.url), 'utf8');

test('the switch switches, and sends no fields doing it', () => {
  // The server keeps a setting it was not given, which is what makes this safe -- see
  // tests/integration/plugin-settings.test.ts, where reintroducing the old behaviour makes
  // a switch erase the site key beside it. This is the caller that relies on it.
  assert.match(SOURCE, /\{ enabled: event\.target\.checked, values: \{\} \}/);
  // And a save carries the fields without deciding whether the plugin is on.
  assert.match(SOURCE, /enabled,\n\s+values: Object\.fromEntries/);
});

test('a plugin with nothing to switch on cannot be switched on', () => {
  // The server refuses it, with a 400 naming the field. The screen should not offer it
  // either: a control that fails whenever it is used is not a control.
  assert.match(SOURCE, /disabled=\{Boolean\(busyId\) \|\| \(!enabled && !configured\)\}/);
  assert.match(SOURCE, /\{!configured && <p className="plugin-row__needs">/);
});

test('a failure is reported on the plugin it belongs to', () => {
  // One shared error line put one plugin's failure under all of them.
  assert.match(SOURCE, /const mine = report\.id === manifest\.id;/);
  assert.match(SOURCE, /\{mine && report\.error && /);
});

test('the switch says which way it is thrown in words', () => {
  // No two surfaces in this palette are far enough apart for a background to carry state,
  // so the state is a word. Three of them: on, off, and not yet able to be on.
  assert.match(SOURCE, /enabled \? copy\.plugins\.on : configured \? copy\.plugins\.off : copy\.plugins\.notConfigured/);
  assert.match(SOURCE, /role="switch"/);
});
