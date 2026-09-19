import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { DEFAULT_THEME_ID, isThemeId, THEME_IDS } from '../../src/themes/registry';

const themesDir = new URL('../../src/themes/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, themesDir), 'utf8');
const directories = readdirSync(themesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test('every theme on disk is one the registry can reach, and the default is one of them', () => {
  assert.deepEqual([...THEME_IDS].sort(), [...directories].sort());
  assert.ok(THEME_IDS.includes(DEFAULT_THEME_ID));
  // An id can outlive the theme it named -- a theme dropped from a release, a database
  // restored onto a newer build -- and a blank page is a cosmetic setting become an outage.
  assert.equal(isThemeId('paper'), true);
  for (const unknown of ['plain-that-was-removed', '', 'Paper', null, undefined, 42, {}]) {
    assert.equal(isThemeId(unknown), false, `${String(unknown)} is not an id`);
  }
});

test('a theme is loaded only when it is the one chosen', () => {
  // Importing them directly would bundle every theme's stylesheet into every public page,
  // which is the cost this structure exists to avoid.
  const registry = read('registry.ts');
  assert.match(registry, /paper: \(\) => import\('\.\/paper'\)/);
  assert.doesNotMatch(registry, /^import .* from '\.\/[a-z]/m);
});

test('every theme exports the same four templates', () => {
  for (const id of directories) {
    const index = read(`${id}/index.ts`);
    assert.match(index, /export const manifest: ThemeManifest/, `${id} names itself`);
    assert.match(index, /export \{ Home, Page, Post, Shell \};/, `${id} exports the four templates`);
    for (const template of ['Home', 'Page', 'Post', 'Shell'] as const) {
      const source = read(`${id}/${template}.astro`);
      // The contract is enforced at the call site through this: a template that drifts stops
      // satisfying the union the registry returns, and the build says so.
      assert.match(source, new RegExp(`interface Props extends Theme${template === 'Shell' ? 'Shell' : template}Props`), `${id}/${template} declares the contract`);
    }
  }
});

test('a theme is given what it needs and cannot go looking for more', () => {
  for (const id of directories) {
    for (const file of readdirSync(new URL(`${id}/`, themesDir), { recursive: true, withFileTypes: true })) {
      if (!file.isFile() || !/\.(astro|ts)$/.test(file.name)) continue;
      const source = readFileSync(new URL(`${id}/${file.parentPath.split(`${id}/`)[1] ?? ''}/${file.name}`.replace('//', '/'), themesDir), 'utf8');
      assert.doesNotMatch(source, /from '[^']*\/server\//, `${id}/${file.name} reaches into the server`);
      assert.doesNotMatch(source, /from '[^']*\/pages\//, `${id}/${file.name} reaches into the routes`);
    }
  }
});
