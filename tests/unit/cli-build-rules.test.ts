import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  directoryMatchesId,
  exportedNames,
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
  assert.deepEqual(requiredFiles('theme', 'src/themes/ledger', theme, ''), []);
  assert.deepEqual(where(requiredFiles('theme', 'src/themes/ledger', theme.filter((file) => !/^(Post\.astro|theme\.css)$/.test(file)), '')), [
    'src/themes/ledger/Post.astro:1: is missing, and every theme needs it',
    'src/themes/ledger/theme.css:1: is missing, and every theme needs it',
  ]);

  const client = 'export function publicClient() { return null; }\n';
  assert.deepEqual(requiredFiles('plugin', 'src/plugins/nimbus', ['index.ts', 'plugin.ts'], ''), []);
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
  const badText = "  settings: [\n    { key: 'mood' },\n    { key: 'turn' },\n    { key: 'headline' },\n    { key: 'empty' },\n  ],\n";
  assert.deepEqual(where(wellFormedSettings('theme', 'src/themes/ledger/theme.ts', badText, bad, kinds)), [
    'src/themes/ledger/theme.ts:2: setting "mood" has no Thai label',
    'src/themes/ledger/theme.ts:2: setting "mood" falls back to "c", which is not one of its options',
    'src/themes/ledger/theme.ts:2: an option of setting "mood" has no Thai label',
    'src/themes/ledger/theme.ts:3: setting "turn" has no Thai hint',
    'src/themes/ledger/theme.ts:3: setting "turn" is a switch, so it falls back to on or off, not "yes"',
    'src/themes/ledger/theme.ts:4: setting "headline" is text, so it needs a max length',
    'src/themes/ledger/theme.ts:5: setting "empty" is a choice with no options',
    'src/themes/ledger/theme.ts:2: setting "mood" is declared twice',
    'src/themes/ledger/theme.ts:2: setting "mood" has kind "slider", which the contract does not allow (choice, switch, text)',
  ]);

  // A plugin's text has no max in its contract, and its settings must be a list.
  const pluginText = [{ key: 'words', kind: 'text', label: en('Words'), required: false }];
  assert.deepEqual(wellFormedSettings('plugin', 'src/plugins/nimbus/plugin.ts', '', pluginText, ['text']), []);
  assert.deepEqual(where(wellFormedSettings('plugin', 'src/plugins/nimbus/plugin.ts', '', 'none', ['text'])), [
    'src/plugins/nimbus/plugin.ts:1: settings is not a list',
  ]);
});

test('rule 5: what a plugin exports, read from its source', () => {
  const source = [
    "import type { Plugin } from '../contract';",
    "export { manifest } from './plugin';",
    'export function signInWidget() { return null; }',
    'export async function verifySignIn() { return { outcome: \'passed\' }; }',
    'export const pickExcerpt = picker();',
    'const local = () => null;',
    'export { local as siteNotice, type Plugin as Shape };',
    'const plugin = { signInWidget, verifySignIn, publicClient: local };',
    'export default plugin;',
  ].join('\n');
  assert.deepEqual([...exportedNames(source)].sort(), ['manifest', 'pickExcerpt', 'signInWidget', 'siteNotice', 'verifySignIn']);
});

test('rule 5: a plugin implements the sign-in pair and a method of each hook it declares', () => {
  const pair = 'export function signInWidget() {}\nexport async function verifySignIn() {}\n';
  const path = 'src/plugins/nimbus/index.ts';
  assert.deepEqual(hooksImplemented(path, pair, ['signIn']), []);
  assert.deepEqual(hooksImplemented(path, `${pair}export const siteNotice = () => null;\n`, ['publicPage']), []);
  assert.deepEqual(hooksImplemented(path, `${pair}export function pickDescription() {}\n`, ['editorSuggestions']), []);
  assert.deepEqual(hooksImplemented(path, pair, ['mcp']), []);

  // Only on the default object: the core loads the module's named exports, so this is not implemented.
  const onlyDefault = 'const plugin = { signInWidget() {}, async verifySignIn() {}, siteNotice() {} };\nexport default plugin;\n';
  assert.deepEqual(where(hooksImplemented(path, onlyDefault, ['publicPage', 'editorSuggestions', 'later'])), [
    'src/plugins/nimbus/index.ts:1: exports no signInWidget, which every plugin needs',
    'src/plugins/nimbus/index.ts:1: exports no verifySignIn, which every plugin needs',
    'src/plugins/nimbus/index.ts:1: declares publicPage, but exports none of siteNotice, sitePopup, publicClient',
    'src/plugins/nimbus/index.ts:1: declares editorSuggestions, but exports none of categoryLikelihoods, pickExcerpt, pickDescription',
    'src/plugins/nimbus/index.ts:1: declares the hook "later", which the contract does not have',
  ]);
});

test('rule 6: a theme imports nothing from the server or the routes', () => {
  const clean = "import type { ThemePostProps } from '../contract';\nimport { formatDate } from '../../lib/dates';\n";
  assert.deepEqual(serverImports('src/themes/ledger/Post.astro', clean), []);
  const reaching = `${clean}import { db } from '../../server/db';\nimport type { X } from "../../pages/api/x";\n`;
  assert.deepEqual(where(serverImports('src/themes/ledger/Post.astro', reaching)), [
    'src/themes/ledger/Post.astro:3: imports ../../server/db, and a theme may not import from src/server/ or src/pages/',
    'src/themes/ledger/Post.astro:4: imports ../../pages/api/x, and a theme may not import from src/server/ or src/pages/',
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
  ].join('\n');
  assert.deepEqual(where(rawColours('src/themes/ledger/theme.css', raw)), [
    'src/themes/ledger/theme.css:12: #123456 is a raw colour outside a token block; use a token',
    'src/themes/ledger/theme.css:13: hsl(10 20% 30%) is a raw colour outside a token block; use a token',
    'src/themes/ledger/theme.css:15: #FFF is a raw colour outside a token block; use a token',
  ]);
});

/** A checkout holding a copy of the real themes and plugins, which tests may break. */
async function checkout(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tome-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'tome-cms' }));
  for (const kind of ['themes', 'plugins']) await cp(join(repository, 'src', kind), join(root, 'src', kind), { recursive: true });
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
