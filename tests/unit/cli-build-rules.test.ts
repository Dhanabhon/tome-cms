import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  directoryMatchesId,
  HOOK_METHODS,
  hooksImplemented,
  listedInBoth,
  rawColours,
  requiredFiles,
  serverImports,
  settingKinds,
  wellFormedSettings,
} from '../../src/cli/build/rules.js';
import { check } from '../../src/cli/commands/check.js';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFile(join(repository, path), 'utf8');
const where = (problems: ReadonlyArray<{ path: string; line: number; message: string }>) =>
  problems.map(({ path, line, message }) => `${path}:${line}: ${message}`);

test('rule 1: a manifest whose id is not its directory name is reported at its id line', () => {
  const text = "export const manifest = {\n  description: 'x',\n  id: 'ledger',\n  name: 'x',\n};\n";
  assert.deepEqual(directoryMatchesId('src/themes/ledger/theme.ts', 'ledger', text, { id: 'ledger' }), []);
  assert.deepEqual(where(directoryMatchesId('src/themes/ledgr/theme.ts', 'ledgr', text, { id: 'ledger' })), [
    'src/themes/ledgr/theme.ts:3: the manifest\'s id is "ledger", but its directory is "ledgr"',
  ]);
});

test('rule 2: every directory is listed in both files, and nothing is listed without a directory', async () => {
  const lists = { manifests: await read('src/themes/manifests.ts'), registry: await read('src/themes/registry.ts') };
  assert.deepEqual(listedInBoth('theme', ['almanac', 'paper', 'plain'], lists), []);
  const plugins = { manifests: await read('src/plugins/manifests.ts'), registry: await read('src/plugins/registry.ts') };
  assert.deepEqual(listedInBoth('plugin', ['lightbox', 'mcp', 'notice', 'popup', 'turnstile', 'typesafe'], plugins), []);

  // A name in a comment is not a listing.
  const commented = {
    manifests: lists.manifests.replace('[paper, plain, almanac]', '[paper, plain /* , ledger */, almanac]'),
    registry: lists.registry.replace("  almanac: () => import('./almanac'),\n", "  almanac: () => import('./almanac'),\n  // ledger: () => import('./ledger'),\n"),
  };
  assert.deepEqual(listedInBoth('theme', ['almanac', 'paper', 'plain'], commented), []);

  // ledger has a directory and is in neither list; plain is in both and has no directory; and
  // almanac has been left out of the registry only.
  const registry = lists.registry.replace("  almanac: () => import('./almanac'),\n", '');
  assert.deepEqual(where(listedInBoth('theme', ['almanac', 'ledger', 'paper'], { manifests: lists.manifests, registry })), [
    'src/themes/registry.ts:13: almanac is not listed here',
    'src/themes/manifests.ts:10: ledger is not listed here',
    'src/themes/registry.ts:13: ledger is not listed here',
    'src/themes/manifests.ts:10: plain is listed, but src/themes/plain does not exist',
    'src/themes/registry.ts:15: plain is listed, but src/themes/plain does not exist',
  ]);
});

test('rule 3: the files a theme and a plugin need, and client.ts when the plugin has a publicClient', () => {
  const theme = ['index.ts', 'theme.ts', 'Shell.astro', 'Home.astro', 'Post.astro', 'Page.astro', 'theme.css', 'parts/Card.astro'];
  const none = new Set<string>();
  assert.deepEqual(requiredFiles('theme', 'src/themes/ledger', theme, none), []);
  assert.deepEqual(where(requiredFiles('theme', 'src/themes/ledger', theme.filter((file) => !/^(Post\.astro|theme\.css)$/.test(file)), none)), [
    'src/themes/ledger/Post.astro:1: is missing, and every theme needs it',
    'src/themes/ledger/theme.css:1: is missing, and every theme needs it',
  ]);

  const client = new Set(['publicClient']);
  assert.deepEqual(requiredFiles('plugin', 'src/plugins/nimbus', ['index.ts', 'plugin.ts'], none), []);
  assert.deepEqual(requiredFiles('plugin', 'src/plugins/nimbus', ['client.ts', 'index.ts', 'plugin.ts'], client), []);
  assert.deepEqual(where(requiredFiles('plugin', 'src/plugins/nimbus', ['index.ts'], client)), [
    'src/plugins/nimbus/plugin.ts:1: is missing, and every plugin needs it',
    'src/plugins/nimbus/client.ts:1: is missing, and a plugin with a publicClient needs it',
  ]);
});

test('rule 4: the setting kinds are read from each contract', async () => {
  assert.deepEqual(settingKinds(await read('src/themes/contract.ts'), 'theme'), ['choice', 'switch', 'text']);
  assert.deepEqual(settingKinds(await read('src/plugins/contract.ts'), 'plugin'), ['choice', 'color', 'image', 'secret', 'switch', 'text']);
  assert.throws(() => settingKinds('export interface ThemeSetting {}', 'theme'), /ThemeSetting/);
});

test('rule 4: well-formed settings pass, and each malformed one is reported at its key', () => {
  const en = (word: string) => ({ en: word, th: `ไทย ${word}` });
  const good = [
    { fallback: 'a', key: 'mood', kind: 'choice', label: en('Mood'), options: [{ label: en('A'), value: 'a' }, { label: en('B'), value: 'b' }] },
    { fallback: 'on', hint: en('Hint'), key: 'turn', kind: 'switch', label: en('Turn') },
    { fallback: '', key: 'headline', kind: 'text', label: en('Headline'), max: 60 },
  ];
  const kinds = ['choice', 'switch', 'text'];
  const text = good.map((setting) => `    {\n      key: '${setting.key}',\n    },`).join('\n');
  assert.deepEqual(wellFormedSettings('theme', 'src/themes/ledger/theme.ts', text, good, kinds), []);
  assert.deepEqual(wellFormedSettings('theme', 'src/themes/ledger/theme.ts', text, undefined, kinds), []);

  const bad = [
    { fallback: 'c', key: 'mood', kind: 'choice', label: { en: 'Mood', th: '' }, options: [{ label: { en: 'A' }, value: 'a' }] },
    { fallback: 'yes', hint: { en: 'Hint', th: ' ' }, key: 'turn', kind: 'switch', label: en('Turn') },
    { fallback: '', key: 'headline', kind: 'text', label: en('Headline') },
    { fallback: 'x', key: 'empty', kind: 'choice', label: en('Empty'), options: [] },
    { fallback: '', key: 'mood', kind: 'slider', label: en('Again') },
  ];
  const badText = "  settings: [\n    { key: 'mood' },\n    { key: 'turn' },\n    { key: 'headline' },\n    { key: 'empty' },\n    { key: 'mood' },\n  ],\n";
  assert.deepEqual(where(wellFormedSettings('theme', 'src/themes/ledger/theme.ts', badText, bad, kinds)), [
    'src/themes/ledger/theme.ts:2: setting "mood" has no Thai label',
    'src/themes/ledger/theme.ts:2: setting "mood" falls back to "c", which is not one of its options',
    'src/themes/ledger/theme.ts:2: an option of setting "mood" has no Thai label',
    'src/themes/ledger/theme.ts:3: setting "turn" has no Thai hint',
    'src/themes/ledger/theme.ts:3: setting "turn" is a switch, so it falls back to on or off, not "yes"',
    'src/themes/ledger/theme.ts:4: setting "headline" is text, so it needs a max length',
    'src/themes/ledger/theme.ts:5: setting "empty" is a choice with no options',
    'src/themes/ledger/theme.ts:6: setting "mood" is declared twice',
    'src/themes/ledger/theme.ts:6: setting "mood" has kind "slider", which the contract does not allow (choice, switch, text)',
  ]);

  // A plugin's text has no max in its contract, and its settings must be a list.
  const pluginText = [{ key: 'words', kind: 'text', label: en('Words'), required: false }];
  assert.deepEqual(wellFormedSettings('plugin', 'src/plugins/nimbus/plugin.ts', '', pluginText, ['text']), []);
  assert.deepEqual(where(wellFormedSettings('plugin', 'src/plugins/nimbus/plugin.ts', '', 'none', ['text'])), [
    'src/plugins/nimbus/plugin.ts:1: settings is not a list',
  ]);
});

test('rule 5: the hook table names exactly the hooks the contract declares', async () => {
  const union = /export type PluginHookId = ([^;]+);/.exec(await read('src/plugins/contract.ts'))?.[1] ?? '';
  assert.deepEqual(Object.keys(HOOK_METHODS).sort(), [...union.matchAll(/'([^']+)'/g)].map(([, hook]) => hook).sort());
});

test('rule 5: a plugin implements the sign-in pair and a method of each hook it declares', () => {
  const pair = ['manifest', 'signInWidget', 'verifySignIn'];
  const path = 'src/plugins/nimbus/index.ts';
  assert.deepEqual(hooksImplemented(path, new Set(pair), ['signIn']), []);
  assert.deepEqual(hooksImplemented(path, new Set([...pair, 'siteNotice']), ['publicPage']), []);
  assert.deepEqual(hooksImplemented(path, new Set([...pair, 'pickDescription']), ['editorSuggestions']), []);
  assert.deepEqual(hooksImplemented(path, new Set(pair), ['mcp']), []);

  // A module whose only export is its default object: the core uses the named exports, so this implements nothing.
  assert.deepEqual(where(hooksImplemented(path, new Set(['default']), ['publicPage', 'editorSuggestions', 'later'])), [
    'src/plugins/nimbus/index.ts:1: exports no signInWidget, which every plugin needs',
    'src/plugins/nimbus/index.ts:1: exports no verifySignIn, which every plugin needs',
    'src/plugins/nimbus/index.ts:1: declares publicPage, but exports none of siteNotice, sitePopup, publicClient',
    'src/plugins/nimbus/index.ts:1: declares editorSuggestions, but exports none of categoryLikelihoods, pickExcerpt, pickDescription',
    'src/plugins/nimbus/index.ts:1: declares the hook "later", which the contract does not have',
  ]);
});

test('rule 6: a theme imports nothing from the server or the routes', () => {
  // A theme's own folders may be called pages or server: only src/server/ and src/pages/ are out of bounds.
  const clean = "import type { ThemePostProps } from '../contract';\nimport { formatDate } from '../../lib/dates';\nimport Card from './pages/Card.astro';\nimport { tidy } from './server';\n";
  assert.deepEqual(serverImports('src/themes/ledger/Post.astro', clean), []);
  const reaching = `${clean}import { db } from '../../server/db';\nimport type { X } from "../../pages/api/x";\nexport * from '../../server';\nconst lazy = import('./../../pages/index.astro');\n`;
  assert.deepEqual(where(serverImports('src/themes/ledger/Post.astro', reaching)), [
    'src/themes/ledger/Post.astro:5: imports ../../server/db, and a theme may not import from src/server/ or src/pages/',
    'src/themes/ledger/Post.astro:6: imports ../../pages/api/x, and a theme may not import from src/server/ or src/pages/',
    'src/themes/ledger/Post.astro:7: imports ../../server, and a theme may not import from src/server/ or src/pages/',
    'src/themes/ledger/Post.astro:8: imports ./../../pages/index.astro, and a theme may not import from src/server/ or src/pages/',
  ]);
});

test('rule 7: a raw colour is allowed only in a token block, a rule that declares nothing but custom properties', () => {
  const tokens = [
    '/* Tokens. A comment may say oklch(50% 0 0) or #fff. */',
    ':root:has(> body.ledger) {',
    '  --color-ink: oklch(24% 0.012 70);',
    '  --ledger-tone: #a0b0c0;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    "  :root:not([data-theme='light']):has(> body.ledger) { --color-ink: rgb(240 240 240); }",
    '}',
    '#add, .card:hover { color: var(--color-ink); background: color-mix(in oklch, var(--color-ink) 10%, transparent); }',
    ':root { --good: #123; &.dark { --g2: #fff; } --after: #456; }',
    ':root { --a: #123; @media (min-width: 40rem) { --a: #fff; } }',
    '.ledger-icon { mask: url(sprite.svg#bad) no-repeat; }',
  ].join('\n');
  assert.deepEqual(rawColours('src/themes/ledger/theme.css', tokens), []);

  const raw = [
    tokens,
    '.ledger-card {',
    '  --ledger-gutter: 1rem;',
    '  --ledger-edge: #123456;',
    '  color: hsl(10 20% 30%);',
    '}',
    '.ledger-band { border: 1px solid #FFF; }',
    '.ledger-wash { background: hwb(10 20% 30%); color: color(display-p3 1 0 0); }',
    ':root { --fine: #000; .ledger-nested { color: #111; } }',
  ].join('\n');
  assert.deepEqual(where(rawColours('src/themes/ledger/theme.css', raw)), [
    'src/themes/ledger/theme.css:15: #123456 is a raw colour outside a token block; use a token',
    'src/themes/ledger/theme.css:16: hsl(10 20% 30%) is a raw colour outside a token block; use a token',
    'src/themes/ledger/theme.css:18: #FFF is a raw colour outside a token block; use a token',
    'src/themes/ledger/theme.css:19: hwb(10 20% 30%) is a raw colour outside a token block; use a token',
    'src/themes/ledger/theme.css:19: color(display-p3 1 0 0) is a raw colour outside a token block; use a token',
    'src/themes/ledger/theme.css:20: #111 is a raw colour outside a token block; use a token',
  ]);
});

/** A checkout holding a copy of the real themes and plugins, which tests may break. */
async function checkout(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tome-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'tome-cms' }));
  for (const kind of ['themes', 'plugins']) await cp(join(repository, 'src', kind), join(root, 'src', kind), { recursive: true });
  // Plugins import their dependencies (typesafe imports zod), so the copy resolves them as the checkout does.
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  const lines = { out: [] as string[], err: [] as string[] };
  const output = { print: (line: string) => { lines.out.push(line); }, warn: (line: string) => { lines.err.push(line); } };
  return { root, lines, output };
}

test('tome check passes on a copy of the real themes and plugins', async (t) => {
  const { root, lines, output } = await checkout(t);
  assert.equal(await check(root, output), 0, lines.err.join('\n'));
  assert.deepEqual(lines, { out: ['Checked 3 themes and 6 plugins: no problems.'], err: [] });
});

test('tome check reports each problem as path:line and exits 1', async (t) => {
  const { root, lines, output } = await checkout(t);
  const theme = join(root, 'src', 'themes', 'plain');
  await writeFile(join(theme, 'theme.css'), `${await readFile(join(theme, 'theme.css'), 'utf8')}\n.plain-alert { color: #c00; }\n`);
  await rm(join(theme, 'Page.astro'));
  const plugin = join(root, 'src', 'plugins', 'notice', 'plugin.ts');
  await writeFile(plugin, (await readFile(plugin, 'utf8')).replace("id: 'notice'", "id: 'notices'"));
  assert.equal(await check(root, output), 1);
  assert.deepEqual(lines.out, []);
  assert.deepEqual(lines.err, [
    'src/themes/plain/Page.astro:1: is missing, and every theme needs it',
    'src/themes/plain/theme.css:273: #c00 is a raw colour outside a token block; use a token',
    'src/plugins/notice/plugin.ts:11: the manifest\'s id is "notices", but its directory is "notice"',
    '3 problems.',
  ]);
});

test('tome check reports a manifest it cannot load, and a kind with no list files', async (t) => {
  const { root, lines, output } = await checkout(t);
  await writeFile(join(root, 'src', 'themes', 'paper', 'theme.ts'), 'export const manifest = {;\n');
  await rm(join(root, 'src', 'plugins'), { recursive: true });
  assert.equal(await check(root, output), 1);
  assert.match(lines.err[0] ?? '', /^src\/themes\/paper\/theme\.ts:1: its manifest could not be loaded: /);
  assert.deepEqual(lines.err.slice(1), ['src/plugins:1: is missing', '2 problems.']);
});

// What the core loads is the module's namespace, so check imports index.ts and reads its keys:
// every way of exporting a name counts, and a name in a comment does not.
const PAIR = "export const signInWidget = () => null;\nexport const verifySignIn = async () => ({ outcome: 'passed' });\n";
const SHAPES: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['export *', {
    'index.ts': "export { manifest } from './plugin';\nexport * from './hooks';\n",
    'hooks.ts': `${PAIR}export function siteNotice() { return null; }\n`,
  }],
  ['destructuring', {
    'index.ts': "export { manifest } from './plugin';\nconst impl = { siteNotice: () => null, signInWidget: () => null, verifySignIn: async () => ({ outcome: 'passed' }) };\nexport const { siteNotice, signInWidget, verifySignIn } = impl;\n",
  }],
  ['several declarators', {
    'index.ts': `export { manifest } from './plugin';\n${PAIR}export const a = 1, siteNotice = () => null;\n`,
  }],
];

for (const [shape, files] of SHAPES) {
  test(`rule 5: a hook exported by ${shape} counts`, async (t) => {
    const { root, lines, output } = await checkout(t);
    const notice = join(root, 'src', 'plugins', 'notice');
    await rm(join(notice, 'index.ts'));
    for (const [file, text] of Object.entries(files)) await writeFile(join(notice, file), text);
    assert.equal(await check(root, output), 0, lines.err.join('\n'));
  });
}

test('rule 5: a hook method that is only in a comment does not count', async (t) => {
  const { root, lines, output } = await checkout(t);
  const index = "export { manifest } from './plugin';\n" + PAIR + '// export function siteNotice() { return null; }\n/*\nexport const siteNotice = () => null;\n*/\n';
  await writeFile(join(root, 'src', 'plugins', 'notice', 'index.ts'), index);
  assert.equal(await check(root, output), 1);
  assert.deepEqual(lines.err, [
    'src/plugins/notice/index.ts:1: declares publicPage, but exports none of siteNotice, sitePopup, publicClient',
    '1 problem.',
  ]);
});

test('rule 5: a plugin index.ts that cannot be loaded is reported, not thrown', async (t) => {
  const { root, lines, output } = await checkout(t);
  await writeFile(join(root, 'src', 'plugins', 'notice', 'index.ts'), "export { manifest } from './plugin';\nexport const = ;\n");
  assert.equal(await check(root, output), 1);
  assert.equal(lines.err.length, 2, lines.err.join('\n'));
  assert.match(lines.err[0]!, /^src\/plugins\/notice\/index\.ts:1: it could not be loaded: /);
});
