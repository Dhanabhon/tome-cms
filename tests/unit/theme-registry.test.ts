import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { THEME_MANIFESTS } from '../../src/themes/manifests';
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
    assert.match(index, /export \{ manifest \} from '\.\/theme';/, `${id} names itself`);
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

test('a theme stylesheet is linked by the page, not imported by the template', () => {
  // It was imported once, and the build put every theme's stylesheet in the admin's settings
  // bundle and none on the public pages: nothing statically links a page to a theme, so Vite
  // attributed the CSS to the one place that names the registry -- the settings form. The
  // dev server was fine and the selector diff was clean, because both look at the whole build.
  for (const id of directories) {
    for (const template of ['Shell', 'Home', 'Post', 'Page']) {
      assert.doesNotMatch(read(`${id}/${template}.astro`), /import '\.\/theme\.css'/, `${id}/${template} imports its stylesheet`);
    }
  }
  assert.match(read('styles.ts'), /import\.meta\.glob<string>\('\.\/\*\/theme\.css', \{ eager: true, import: 'default', query: '\?url' \}\)/);
  const layout = readFileSync(new URL('../../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
  assert.match(layout, /const themeCss = themeStylesheet\(settings\?\.theme_id\);/);
  assert.match(layout, /<link rel="stylesheet" href=\{themeCss\} \/>/);
  // The admin's preview draws a draft with the theme, so it asks for the sheet as well.
  for (const preview of ['src/pages/admin/preview/[id].astro', 'src/pages/admin/pages/preview/[id].astro']) {
    const source = readFileSync(new URL(`../../${preview}`, import.meta.url), 'utf8');
    assert.match(source, /<AdminLayout stylesheet=\{themeStylesheet\(/, `${preview} links the theme`);
  }
});

test('the admin can name a theme without loading it', () => {
  // The settings screen offers the choice, and must not drag every theme's templates and
  // stylesheet into the admin bundle to do it -- so the manifests live apart from them.
  const manifests = read('manifests.ts');
  assert.doesNotMatch(manifests, /\.astro/);
  assert.deepEqual(THEME_MANIFESTS.map(({ id }) => id).sort(), [...THEME_IDS].sort());
  for (const { description, id, name } of THEME_MANIFESTS) {
    assert.ok(name.trim() && description.trim(), `${id} says what it is`);
    assert.match(read(`${id}/theme.ts`), new RegExp(`id: '${id}'`), `${id}'s manifest names its own directory`);
  }
});

test('the themes screen offers what is installed, and falls back to what is not', () => {
  const source = (name: string) => readFileSync(new URL(`../../src/components/admin/${name}.tsx`, import.meta.url), 'utf8');
  const form = source('ThemeForm');
  assert.match(form, /THEME_MANIFESTS\.map\(\(\{ id, name \}\) => \(\{ label: name, value: id \}\)\)/);
  // A theme can leave in a release while its id stays in the database, so what the control
  // shows is what a save would store, rather than a value the server would refuse.
  const fallback = /isThemeId\(initialSettings\.theme_id\) \? initialSettings\.theme_id : DEFAULT_THEME_ID/;
  assert.match(form, fallback);
  // Settings no longer shows a theme, but the record is written whole, so it sends one --
  // and a stored id whose theme has left the build would have the server refuse a save
  // this screen has no control for. It falls back to the same id the renderer does.
  assert.match(source('SettingsForm'), fallback);
  assert.equal(isThemeId(DEFAULT_THEME_ID), true);
});
