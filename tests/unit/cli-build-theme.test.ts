import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { copyTheme, renameThemeFile } from '../../src/cli/build/theme.js';
import { themeNew } from '../../src/cli/commands/theme-new.js';
import { tome } from '../../src/cli/main.js';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const themes = join(repository, 'src', 'themes');
const SOURCES = ['plain', 'paper', 'almanac'] as const;

/** A real file of a real theme, renamed from `from` to zzdemo. */
function renamed(from: string, path: string) {
  const text = readFileSync(join(themes, from, path), 'utf8');
  return { text, after: renameThemeFile(path, text, from, 'zzdemo') };
}

test('the manifest takes the new id, as its id, name and description; its settings are kept', () => {
  for (const from of SOURCES) {
    const { text, after } = renamed(from, 'theme.ts');
    for (const field of ['description', 'id', 'name']) assert.match(after, new RegExp(`^  ${field}: 'zzdemo',$`, 'm'), `${from} ${field}`);
    const changed = text.split('\n').filter((line, index) => line !== after.split('\n')[index]);
    assert.equal(changed.length, 3, `${from}: only those three lines change`);
  }
  assert.match(renamed('almanac', 'theme.ts').after, /key: 'readingProgress'/);
});

test('names the theme owns are renamed in its CSS and its templates; the core\'s are not', () => {
  const css = renamed('almanac', 'theme.css').after;
  for (const name of ['.zzdemo-card', '.zzdemo-header__inner', '--zzdemo-tone-0:', 'var(--zzdemo-gutter)', 'var(--zzdemo-field)']) {
    assert.ok(css.includes(name), name);
  }
  const header = renamed('almanac', 'parts/Header.astro').after;
  for (const name of ['class="zzdemo-header"', 'id="zzdemo-search"', 'aria-controls="zzdemo-search"', 'for="zzdemo-search-q"', "querySelector<HTMLButtonElement>('.zzdemo-search-toggle')"]) {
    assert.ok(header.includes(name), name);
  }
  assert.ok(renamed('almanac', 'Post.astro').after.includes('var(--zzdemo-tone-${categoryTone})'));
  assert.ok(renamed('almanac', 'parts/Hero.astro').after.includes('`zzdemo-button zzdemo-button--${kind}`'));
  assert.ok(renamed('plain', 'Home.astro').after.includes('<ol class="zzdemo-grid">'));
  assert.ok(renamed('plain', 'theme.css').after.includes('--zzdemo-frame: min(100% - 2 * var(--zzdemo-gutter)'));
  // Paper's own classes carry no prefix, and its tokens are the core's.
  const paper = renamed('paper', 'theme.css');
  assert.equal(paper.after.split('--color-paper-2').length, paper.text.split('--color-paper-2').length);
  assert.ok(paper.after.includes('var(--color-paper)'));
});

test('the body class carries the new id, and so does a data attribute that names the theme', () => {
  assert.match(renamed('plain', 'Shell.astro').after, /<body class="zzdemo">/);
  assert.match(renamed('paper', 'Shell.astro').after, /<body class="zzdemo flex min-h-screen flex-col">/);
  assert.match(renamed('almanac', 'Shell.astro').after, /<body class="zzdemo">/);
  assert.match(renamed('plain', 'theme.css').after, /^\.zzdemo \{$/m);
  assert.ok(renamed('paper', 'theme.css').after.includes('html:has(> body.zzdemo),\nbody.zzdemo {'));
  assert.ok(renamed('almanac', 'theme.css').after.includes(':root:has(> body.zzdemo, .zzdemo-article) {'));
  // No theme has one today; the rule is there for the first that does.
  assert.equal(renameThemeFile('Shell.astro', '<main data-look="paper" data-paper="paper">', 'paper', 'zzdemo'), '<main data-look="zzdemo" data-paper="zzdemo">');
});

test('only the id changes: comments and prose that mention the source theme are left as they were', () => {
  for (const from of SOURCES) {
    for (const path of readdirFiles(join(themes, from))) {
      if (path === 'theme.ts' || path === 'fonts.css') continue;
      const { text, after } = renamed(from, path);
      // The font's import is the one other change, and has its own test.
      const back = after.replaceAll('zzdemo', from).replace(`@import '../${from}/fonts.css';`, "@import './fonts.css';");
      assert.equal(back, text, `${from}/${path}: nothing but the id changed`);
      // What is left of the source's names is in comments.
      for (const line of after.split('\n').filter((each) => new RegExp(`(?<![\\w-])(--)?${from}-|\\.${from}\\b|"${from}"`).test(each))) {
        assert.match(line.trim(), /^(\*|\/\*|\/\/|<!--|\{\/\*)/, `${from}/${path}: ${line.trim()}`);
      }
    }
  }
  assert.ok(renamed('almanac', 'theme.css').after.includes(' * tests/unit/almanac-tokens.test.ts measures each pair'));
  assert.ok(renamed('almanac', 'tone.ts').after.includes('--almanac-tone-0 to --almanac-tone-5'));
  assert.ok(renamed('almanac', 'Shell.astro').after.includes("The class is what the stylesheet keys Almanac's palette"));
  assert.ok(renamed('plain', 'theme.css').after.includes("/* The Plain theme's own stylesheet."));
});

test('a theme\'s font is not copied: the new stylesheet imports the source\'s, which loads the same files', () => {
  const files = copyTheme(repository, 'almanac', 'zzdemo');
  assert.ok(!files.some(({ path }) => path === 'fonts.css'));
  assert.ok(files.some(({ path }) => path === 'parts/Header.astro'));
  const css = files.find(({ path }) => path === 'theme.css')!.text;
  const [, imported] = /@import '([^']+)';/.exec(css)!;
  assert.equal(imported, '../almanac/fonts.css');
  assert.equal(resolve(themes, 'zzdemo', imported), join(themes, 'almanac', 'fonts.css'));
  assert.ok(existsSync(join(themes, 'almanac', 'fonts.css')));
  assert.equal(existsSync(join(themes, 'zzdemo')), false, 'copying reads, and writes nothing');
});

/** Every file under a directory, by its path inside it. */
function readdirFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
}

/** A checkout holding a copy of the real src/themes, with the plugin lists beside it. */
async function checkout(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tome-theme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'tome-cms' }));
  await cp(themes, join(root, 'src', 'themes'), { recursive: true });
  const listing = async () => (await readdir(join(root, 'src', 'themes'), { recursive: true })).sort();
  const lists = async () => Promise.all(['manifests.ts', 'registry.ts'].map((file) => readFile(join(root, 'src', 'themes', file), 'utf8')));
  return { root, listing, lists };
}

function output() {
  const lines: string[] = [];
  return { lines, print: (line: string) => { lines.push(line); }, warn: (line: string) => { lines.push(line); } };
}

const io = (root: string, out: ReturnType<typeof output>) => ({ uid: 1000, load: async () => { throw new Error('never loaded'); }, print: out.print, warn: out.warn, cwd: root });

test('theme new copies the theme, registers it and says what to do next', async (t) => {
  const { root, lists } = await checkout(t);
  const out = output();
  assert.equal(await tome(['theme', 'new', 'zzdemo', '--from', 'almanac'], io(root, out)), 0);
  const [manifests, registry] = await lists();
  assert.match(manifests, /^import \{ manifest as zzdemo \} from '\.\/zzdemo\/theme';$/m);
  assert.match(manifests, /\[paper, plain, almanac, zzdemo\]/);
  assert.match(registry, /^ {2}zzdemo: \(\) => import\('\.\/zzdemo'\),$/m);
  assert.deepEqual(
    (await readdir(join(root, 'src', 'themes', 'zzdemo'), { recursive: true })).sort(),
    (await readdir(join(themes, 'almanac'), { recursive: true })).filter((path) => path !== 'fonts.css').sort(),
  );
  assert.match(await readFile(join(root, 'src', 'themes', 'zzdemo', 'theme.ts'), 'utf8'), /id: 'zzdemo'/);
  const said = out.lines.join('\n');
  assert.match(said, /npm run dev/);
  assert.match(said, /Appearance → Themes/);
  assert.match(said, /npm run tome -- check/);
});

test('theme new --dry-run prints the files and lines, and writes nothing', async (t) => {
  const { root, listing, lists } = await checkout(t);
  const before = [await listing(), await lists()];
  const out = output();
  assert.equal(await tome(['theme', 'new', 'zzdemo', '--dry-run'], io(root, out)), 0);
  assert.deepEqual([await listing(), await lists()], before);
  const said = out.lines.join('\n');
  assert.match(said, /src\/themes\/zzdemo\/Shell\.astro/);
  assert.match(said, /import \{ manifest as zzdemo \} from '\.\/zzdemo\/theme';/);
  assert.match(said, /zzdemo: \(\) => import\('\.\/zzdemo'\),/);
});

test('theme new refuses a taken id or a list it cannot edit, before it writes anything', async (t) => {
  const { root, listing, lists } = await checkout(t);
  const before = [await listing(), await lists()];
  const out = output();
  assert.equal(await tome(['theme', 'new', 'almanac'], io(root, out)), 1);
  assert.match(out.lines.join('\n'), /already exists/);
  await writeFile(join(root, 'src', 'themes', 'registry.ts'), (await lists())[1].replace('const THEMES = {', 'const LOOKS = {'));
  assert.equal(await tome(['theme', 'new', 'zzdemo'], io(root, out)), 1);
  assert.match(out.lines.join('\n'), /nothing was changed/);
  assert.deepEqual(await listing(), before[0]);
});

test('when registering fails, the new theme\'s directory is removed', async (t) => {
  const { root, listing, lists } = await checkout(t);
  const before = [await listing(), await lists()];
  const out = output();
  const code = themeNew(root, { id: 'zzdemo', from: 'plain', dryRun: false }, out, () => { throw new Error('the disk is full'); });
  assert.equal(code, 1);
  assert.match(out.lines.join('\n'), /the disk is full/);
  assert.deepEqual([await listing(), await lists()], before);
});
