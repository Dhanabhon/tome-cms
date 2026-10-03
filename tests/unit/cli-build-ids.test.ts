import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateId } from '../../src/cli/build/ids.js';

const repository = fileURLToPath(new URL('../..', import.meta.url));

/** A checkout with copies of the real list files and no theme or plugin directories. */
async function listsOnly() {
  const root = await mkdtemp(join(tmpdir(), 'tome-ids-'));
  for (const kind of ['themes', 'plugins']) {
    await mkdir(join(root, 'src', kind), { recursive: true });
    for (const file of ['manifests.ts', 'registry.ts']) await copyFile(join(repository, 'src', kind, file), join(root, 'src', kind, file));
  }
  return root;
}

test('an id is 2 to 31 lowercase letters and digits, starting with a letter', async (t) => {
  const root = await listsOnly();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const id of ['zz', 'zzdemo', 'ledger2', 'a'.repeat(31)]) {
    assert.deepEqual(validateId('theme', id, root), { ok: true }, id);
    assert.deepEqual(validateId('plugin', id, root), { ok: true }, id);
  }
  for (const id of ['', 'z', 'Ledger', 'my-theme', 'my_theme', '2col', 'a'.repeat(32), 'zz demo']) {
    const result = validateId('theme', id, root);
    assert.equal(result.ok, false, id);
    assert.match(result.ok ? '' : result.reason, /lowercase letters and digits/, id);
  }
});

test('a word JavaScript reserves cannot be an id, since the id is an import name', async (t) => {
  const root = await listsOnly();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const id of ['import', 'class', 'default', 'new', 'await']) {
    const result = validateId('plugin', id, root);
    assert.equal(result.ok, false, id);
    assert.match(result.ok ? '' : result.reason, /reserved/, id);
  }
});

test('an id is refused when its directory, or a file of that name, already exists', async (t) => {
  const root = await listsOnly();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src', 'themes', 'ledger'));
  await writeFile(join(root, 'src', 'themes', 'styles.ts'), '');
  const taken = validateId('theme', 'ledger', root);
  assert.deepEqual(taken, { ok: false, reason: 'src/themes/ledger already exists.' });
  const file = validateId('theme', 'styles', root);
  assert.equal(file.ok, false);
  assert.match(file.ok ? '' : file.reason, /src\/themes\/styles\.ts already exists/);
  assert.deepEqual(validateId('plugin', 'ledger', root), { ok: true }, 'the plugins are a separate list');
});

test('an id is refused when either list already names it, even with no directory', async (t) => {
  const root = await listsOnly();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const id of ['almanac', 'paper', 'plain']) {
    const result = validateId('theme', id, root);
    assert.equal(result.ok, false, id);
    assert.match(result.ok ? '' : result.reason, /already listed in src\/themes\/manifests\.ts/, id);
  }
  for (const id of ['lightbox', 'mcp', 'typesafe']) {
    const result = validateId('plugin', id, root);
    assert.match(result.ok ? '' : result.reason, /already listed in src\/plugins\/manifests\.ts/, id);
  }
  // A word that merely appears in the files' code or comments is not a listing.
  for (const id of ['theme', 'manifest', 'value', 'themes']) assert.deepEqual(validateId('theme', id, root), { ok: true }, id);
  // Listed in the registry alone, or in the array alone: still taken.
  const registry = join(root, 'src', 'themes', 'registry.ts');
  await writeFile(registry, 'const THEMES = {\n  ledger: () => import(\'./ledger\'),\n} as const;\n');
  assert.deepEqual(validateId('theme', 'ledger', root), { ok: false, reason: 'ledger is already listed in src/themes/registry.ts.' });
  const manifests = join(root, 'src', 'plugins', 'manifests.ts');
  await writeFile(manifests, 'export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [turnstile, orphan];\n');
  assert.deepEqual(validateId('plugin', 'orphan', root), { ok: false, reason: 'orphan is already listed in src/plugins/manifests.ts.' });
});
