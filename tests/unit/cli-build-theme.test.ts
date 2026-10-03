import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { copyTheme, coreNames, renameThemeFile } from '../../src/cli/build/theme.js';
import { themeNew } from '../../src/cli/commands/theme-new.js';
import { tome } from '../../src/cli/main.js';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const themes = join(repository, 'src', 'themes');
const SOURCES = ['plain', 'paper', 'almanac'] as const;

/** A real file of a real theme, renamed from `from` to zzdemo, keeping what the core selects by as copyTheme does. */
function renamed(from: string, path: string) {
  const text = readFileSync(join(themes, from, path), 'utf8');
  return { text, after: renameThemeFile(path, text, from, 'zzdemo', coreNames(repository, from)) };
}

test('the manifest takes the new id, as its id, name and description; its settings are kept', () => {
  for (const from of SOURCES) {
    const { text, after } = renamed(from, 'theme.ts');
    for (const field of ['description', 'id', 'name']) assert.match(after, new RegExp(`^  ${field}: 'zzdemo',$`, 'm'), `${from} ${field}`);
    const changed = text.split('\n').filter((line, index) => line !== after.split('\n')[index]);
    assert.equal(changed.length, 3, `${from}: only those three lines change`);
  }
  assert.match(renamed('almanac', 'theme.ts').after, /key: 'readingProgress'/);
  // The fonts it preloads are files under public/, which the copy loads too: they are kept as they are.
  for (const from of SOURCES) {
    const fonts = /^  preloadFonts: \[[^\]]*\],$/m;
    const { text, after } = renamed(from, 'theme.ts');
    assert.match(text, fonts, `${from} preloads its fonts`);
    assert.equal(fonts.exec(after)?.[0], fonts.exec(text)?.[0], `${from}'s preloadFonts is copied as it is`);
  }
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
  // The rules themselves, with no core names to keep.
  const bare = (from: string, path: string) => renameThemeFile(path, readFileSync(join(themes, from, path), 'utf8'), from, 'zzdemo');
  assert.match(bare('plain', 'Shell.astro'), /<body class="zzdemo">/);
  assert.match(bare('paper', 'Shell.astro'), /<body class="zzdemo flex min-h-svh flex-col">/);
  assert.match(bare('plain', 'theme.css'), /^\.zzdemo \{$/m);
  assert.ok(bare('paper', 'theme.css').includes(':root:has(> body.zzdemo, .post-page) {'));
  // As copied from the real tree. The bare id is the theme's own, whatever words core code uses
  // ('text/plain', a 'paper' default), so every copy's body carries the new id.
  assert.match(renamed('almanac', 'Shell.astro').after, /<body class="zzdemo">/);
  assert.ok(renamed('almanac', 'theme.css').after.includes(':root:has(> body.zzdemo, .zzdemo-article) {'));
  assert.match(renamed('plain', 'Shell.astro').after, /<body class="zzdemo">/);
  assert.match(renamed('plain', 'theme.css').after, /^\.zzdemo \{$/m);
  assert.match(renamed('paper', 'Shell.astro').after, /<body class="zzdemo flex min-h-svh flex-col">/);
  assert.ok(renamed('paper', 'theme.css').after.includes(':root:has(> body.zzdemo, .post-page) {'));
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
      // What is left of the source's names is in comments, or is a name the core selects by.
      const kept = [...coreNames(repository, from)];
      for (const line of after.split('\n').filter((each) => new RegExp(`(?<![\\w-])(--)?${from}-|\\.${from}\\b|"${from}"`)
        .test(kept.reduce((rest, name) => rest.replaceAll(name, ''), each)))) {
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

const io = (root: string, out: ReturnType<typeof output>) => ({ uid: 1000, load: async () => { throw new Error('never loaded'); }, print: out.print, warn: out.warn, cwd: root,
  // The checkout's own entry file, as `npm run tome` runs it.
  self: join(realpathSync(root), 'src', 'cli', 'main.ts') });

test('theme new copies the theme, registers it and says what to do next', async (t) => {
  const { root, lists } = await checkout(t);
  const out = output();
  assert.equal(await tome(['theme', 'new', 'zzdemo', '--from', 'almanac'], io(root, out)), 0);
  const [manifests, registry] = await lists();
  assert.match(manifests, /^import \{ manifest as zzdemo \} from '\.\/zzdemo\/theme';$/m);
  // The array as it was, read from the source tree, with the new id appended.
  const entries = (text: string) => /THEME_MANIFESTS\b[^=]*=\s*\[([^\]]*)\]/.exec(text)![1];
  assert.equal(entries(manifests), `${entries(readFileSync(join(themes, 'manifests.ts'), 'utf8'))}, zzdemo`);
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

test('a name the core selects a theme\'s markup by is kept, so a plain copy\'s bare <pre> is still drawn by code.css', () => {
  assert.ok(coreNames(repository, 'plain').has('plain-body'));
  assert.equal(coreNames(repository, 'plain').has('plain'), false, 'the bare id is never the core\'s');
  assert.equal(coreNames(repository, 'paper').has('paper'), false, 'the bare id is never the core\'s');
  // Nothing outside the theme and the CLI says "almanac", so a copy of Almanac is renamed whole.
  assert.deepEqual([...coreNames(repository, 'almanac')], []);
  const files = copyTheme(repository, 'plain', 'zzdemo');
  const text = (path: string) => files.find((file) => file.path === path)!.text;
  // code.css draws a post's bare <pre> by the body's class, and the copy's body keeps it.
  assert.match(readFileSync(join(repository, 'src', 'styles', 'code.css'), 'utf8'), /^\.plain-body pre,$/m);
  for (const path of ['Post.astro', 'Page.astro']) assert.match(text(path), /<div class="plain-body" set:html=/, path);
  assert.match(text('theme.css'), /^\.plain-body \{ line-height: 1\.7; \}$/m);
  // Everything else is the copy's own.
  assert.match(text('Post.astro'), /<article class="zzdemo-page zzdemo-article">/);
});

test('core names are any word of the theme\'s, in any file of src outside the themes and the CLI, however it is written', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tome-core-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // One shape per name, so a name missing from the set says which shape was missed.
  const core = {
    'src/styles/a.css': '.almanac-card:hover { color: red; }',
    'src/components/Style.astro': '<p>x</p>\n<style>\n  body.almanac main { margin: 0; }\n  div[data-k].almanac-b { color: red; }\n</style>',
    'src/components/List.astro': '<div class:list={["almanac-g", { open }]} />',
    'src/components/Quotes.tsx': "export const Q = () => <p className='almanac-d'>x</p>;",
    'src/components/Expression.tsx': "export const E = () => <p className={'almanac-e'}>x</p>;",
    'src/components/Template.tsx': 'export const T = ({ x }: { x: string }) => <p className={`${x} almanac-c`}>x</p>;',
    'src/components/Selector.tsx': 'export const css = "div[data-k].almanac-m > span { color: red; }";',
    'src/lib/dom.ts': "element.classList.add('almanac-h');\nother.className = 'almanac-i';",
    'src/pages/index.astro': "<main class={'almanac-j'} />",
    'src/plugins/zz/client.ts': "mount.closest('.almanac-k');",
    'src/server/page.ts': "export const wrap = 'almanac-l';",
    // Not core, and not names: the theme itself, the CLI, and words that only contain the id.
    'src/themes/elsewhere.css': '.almanac-grid {}',
    'src/cli/z.ts': "'almanac-cli'",
    'src/lib/words.ts': 'const almanacs = 1; const almanac_x = 2; const y = "--x-almanac-n";',
  };
  for (const [path, text] of Object.entries(core)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const keep = coreNames(root, 'almanac');
  // `body.almanac` is there too, but the bare id is the theme's identity and is never the core's.
  assert.deepEqual([...keep].sort(), [...'bcdeghijklm'.split('').map((letter) => `almanac-${letter}`), 'almanac-card'].sort());
  assert.equal(
    renameThemeFile('theme.css', '.almanac { x: 1; }\n.almanac-card, .almanac-grid { y: 2; }', 'almanac', 'zzdemo', keep),
    '.zzdemo { x: 1; }\n.almanac-card, .zzdemo-grid { y: 2; }',
  );
  assert.equal(
    renameThemeFile('Shell.astro', '<body class="almanac"><div class="almanac-j almanac-grid">', 'almanac', 'zzdemo', keep),
    '<body class="zzdemo"><div class="almanac-j zzdemo-grid">',
  );
});

test('a hidden file in the source, such as .DS_Store, is not copied', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tome-dotfiles-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src', 'themes', 'zz', 'parts'), { recursive: true });
  for (const path of ['theme.css', '.DS_Store', 'parts/Card.astro', 'parts/.DS_Store']) await writeFile(join(root, 'src', 'themes', 'zz', path), '');
  assert.deepEqual(copyTheme(root, 'zz', 'yy').map(({ path }) => path), ['parts/Card.astro', 'theme.css']);
});
