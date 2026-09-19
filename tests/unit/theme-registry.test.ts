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

test('the two stylesheets keep to their own side', () => {
  const core = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
  const theme = read('paper/theme.css');
  // The admin draws itself from the core stylesheet alone, so a rule it needs cannot be in
  // here: the admin never loads this file, and the failure would be a screen without styling.
  assert.doesNotMatch(theme, /^\.(admin|installer|security-|navigation-|media-|skeleton)/m);
  // And the point of the split: shaping the site no longer means editing the admin's sheet.
  for (const owned of ['.post-card', '.home-hero', '.site-footer', '.post-page', '.post-filter']) {
    assert.ok(theme.includes(owned), `${owned} belongs to the theme`);
    assert.doesNotMatch(core, new RegExp(`^\\${owned}[\\s,{]`, 'm'), `${owned} was left in core`);
  }
  // What both sides draw stays in core rather than being copied into each: two copies of a
  // rule are two rules that drift.
  assert.match(core, /^\.article-title/m);
  assert.match(core, /^\.category-default,/m);
});

test('whatever enters the theme brings the theme stylesheet with it', () => {
  // A public page comes in through the shell; the admin's preview of a draft comes in
  // through a template on its own, and has to be drawn just the same.
  for (const template of ['Shell', 'Home', 'Post', 'Page']) {
    assert.match(read(`paper/${template}.astro`), /^import '\.\/theme\.css';$/m, `${template} loads the theme`);
  }
});
