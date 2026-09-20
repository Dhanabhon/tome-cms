import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ICONS } from '../../src/lib/icons';
import { PLUGIN_MANIFESTS } from '../../src/plugins/manifests';
import { loadPlugin } from '../../src/plugins/registry';

const SOURCE = readFileSync(new URL('../../src/components/admin/PluginManager.tsx', import.meta.url), 'utf8');

test('a manifest names a hook the plugin actually fills', async () => {
  // The screen says where a plugin acts without loading it, which only works while the
  // manifest tells the truth. Nothing else checks that, so this does.
  for (const manifest of PLUGIN_MANIFESTS) {
    assert.ok(manifest.hooks.length > 0, `${manifest.id} names no hook`);
    const plugin = await loadPlugin(manifest.id);
    assert.ok(plugin, `${manifest.id} is not in the registry`);
    for (const hook of manifest.hooks) {
      if (hook === 'signIn') {
        assert.equal(typeof plugin.signInWidget, 'function', `${manifest.id} claims signIn without a widget`);
        assert.equal(typeof plugin.verifySignIn, 'function', `${manifest.id} claims signIn without a check`);
        continue;
      }
      assert.equal(hook, 'publicPage', `${manifest.id} names a hook the core does not declare`);
      // Either half of it: a band of words, browser code, or both.
      assert.ok(
        typeof plugin.siteNotice === 'function' || typeof plugin.publicClient === 'function',
        `${manifest.id} claims publicPage and adds nothing to a public page`,
      );
    }
  }
});

test('a plugin draws with the admin\'s own icons', () => {
  // A plugin has no way to put an image on this screen, which is the point: the grid keeps
  // one drawing style, and nothing a plugin ships is rendered.
  for (const manifest of PLUGIN_MANIFESTS) {
    assert.ok(manifest.icon in ICONS, `${manifest.id} names an icon that does not exist`);
  }
  assert.match(SOURCE, /<Icon name=\{manifest\.icon\} \/>/);
});

test('the switch switches, and sends no fields doing it', () => {
  // The server keeps a setting it was not given, which is what makes this safe -- see
  // tests/integration/plugin-settings.test.ts, where reintroducing the old behaviour makes
  // a switch erase the site key beside it. This is the caller that relies on it.
  assert.match(SOURCE, /\{ enabled: event\.target\.checked, values: \{\} \}/);
  // And a save carries the fields without deciding whether the plugin is on.
  assert.match(SOURCE, /enabled: state\?\.enabled \?\? false, values/);
});

test('a plugin with nothing to switch on cannot be switched on', () => {
  // The server refuses it, with a 400 naming the field. The screen should not offer it
  // either: a control that fails whenever it is used is not a control.
  assert.match(SOURCE, /disabled=\{Boolean\(busyId\) \|\| \(!enabled && !configured\)\}/);
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

test('the panel of fields is the one the admin already has', () => {
  // A dialog of its own would be a second way to show a panel of fields, and the two would
  // drift. This is the editors' drawer, opened the way they open it.
  assert.match(SOURCE, /className="admin-editor-settings"/);
  assert.match(SOURCE, /element\.showModal\(\);/);
  assert.match(SOURCE, /closeButton\.current\?\.focus\(\);/);
  // Escape closes it through onCancel rather than leaving the dialog closed and the screen
  // still believing it is open.
  assert.match(SOURCE, /onCancel=\{\(event\) => \{\n\s+event\.preventDefault\(\);\n\s+onClose\(\);/);
});
