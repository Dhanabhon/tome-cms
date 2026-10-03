import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pluginFiles } from '../../src/cli/build/plugin.js';
import { pluginNew } from '../../src/cli/commands/plugin-new.js';
import { tome } from '../../src/cli/main.js';
import type { Plugin, PluginManifest } from '../../src/plugins/contract.js';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const HOOKS = ['publicPage', 'signIn', 'editorSuggestions'] as const;
const page = { kind: 'post', locale: 'en' } as const;
const article = { locale: 'en', text: 'Words.', title: 'A title' } as const;

/**
 * The skeleton written into a scratch src/plugins/<id> beside the real contract, then imported:
 * what the core would load. Each one gets its own directory, so no import is a cached one.
 */
async function load(t: test.TestContext, hook: (typeof HOOKS)[number], client: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'tome-plugin-skeleton-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = pluginFiles('zzpub', hook, client);
  await mkdir(join(root, 'zzpub'), { recursive: true });
  await copyFile(join(repository, 'src', 'plugins', 'contract.ts'), join(root, 'contract.ts'));
  for (const { path, text } of files) await writeFile(join(root, 'zzpub', path), text);
  const url = (path: string) => pathToFileURL(join(root, 'zzpub', path)).href;
  const module = await import(url('index.ts')) as Plugin & { default: Plugin; manifest: PluginManifest };
  return { files, module, url };
}

test('each hook gets a manifest that declares it, named for the id in both languages, with no settings', async (t) => {
  for (const hook of HOOKS) {
    const { module } = await load(t, hook, false);
    assert.deepEqual(module.manifest, {
      description: { en: 'zzpub', th: 'zzpub' }, hooks: [hook], icon: 'plugins', id: 'zzpub', name: 'zzpub', settings: [],
    });
  }
});

test('the skeleton fills its hook and the sign-in pair, and does nothing until it is written', async (t) => {
  const answers = async (plugin: Plugin) => {
    assert.equal(plugin.signInWidget({}), null);
    assert.deepEqual(await plugin.verifySignIn({ remoteIp: null, settings: {}, token: null }), { outcome: 'passed' });
  };
  const publicPage = await load(t, 'publicPage', false);
  for (const plugin of [publicPage.module, publicPage.module.default]) {
    await answers(plugin);
    assert.equal(plugin.siteNotice?.({}, page), null);
    assert.equal(plugin.publicClient, undefined);
  }
  const signIn = await load(t, 'signIn', false);
  for (const plugin of [signIn.module, signIn.module.default]) {
    await answers(plugin);
    assert.deepEqual(Object.keys(plugin).filter((key) => key !== 'manifest' && key !== 'default').sort(), ['signInWidget', 'verifySignIn']);
  }
  const editor = await load(t, 'editorSuggestions', false);
  for (const plugin of [editor.module, editor.module.default]) {
    await answers(plugin);
    assert.deepEqual(await plugin.categoryLikelihoods?.({}, { article, categories: [{ id: 'c1', name: 'News' }] }), {});
  }
  assert.deepEqual(publicPage.files.map(({ path }) => path), ['index.ts', 'plugin.ts']);
});

test('--client writes client.ts and a publicClient that runs it nowhere yet', async (t) => {
  const { files, module, url } = await load(t, 'publicPage', true);
  assert.deepEqual(files.map(({ path }) => path), ['client.ts', 'index.ts', 'plugin.ts']);
  assert.equal(module.publicClient?.({}, page), null);
  assert.equal(module.default.publicClient, module.publicClient);
  const client = await import(url('client.ts')) as { default: (mount: { remove: () => void }) => void };
  let removed = false;
  client.default({ remove: () => { removed = true; } });
  assert.ok(removed, 'the mount is taken away, so nothing is left on the page');
  // Browser code is a public page's: a sign-in plugin with it says so in its manifest.
  assert.deepEqual((await load(t, 'signIn', true)).module.manifest.hooks, ['signIn', 'publicPage']);
});

/** A checkout holding copies of the real plugin lists. */
async function checkout(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tome-plugin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'tome-cms' }));
  for (const kind of ['themes', 'plugins']) {
    await mkdir(join(root, 'src', kind), { recursive: true });
    for (const file of ['manifests.ts', 'registry.ts']) await copyFile(join(repository, 'src', kind, file), join(root, 'src', kind, file));
  }
  const state = async () => [
    (await readdir(join(root, 'src', 'plugins'), { recursive: true })).sort(),
    await Promise.all(['manifests.ts', 'registry.ts'].map((file) => readFile(join(root, 'src', 'plugins', file), 'utf8'))),
  ];
  return { root, state };
}

function output() {
  const lines: string[] = [];
  return { lines, print: (line: string) => { lines.push(line); }, warn: (line: string) => { lines.push(line); } };
}

const io = (root: string, out: ReturnType<typeof output>) => ({ uid: 1000, load: async () => { throw new Error('never loaded'); }, print: out.print, warn: out.warn, cwd: root,
  // The checkout's own entry file, as `npm run tome` runs it.
  self: join(realpathSync(root), 'src', 'cli', 'main.ts') });

test('plugin new writes the plugin, registers it and says what to do next', async (t) => {
  const { root } = await checkout(t);
  const out = output();
  assert.equal(await tome(['plugin', 'new', 'zzpub', '--hook', 'publicPage', '--client'], io(root, out)), 0);
  assert.deepEqual((await readdir(join(root, 'src', 'plugins', 'zzpub'))).sort(), ['client.ts', 'index.ts', 'plugin.ts']);
  assert.match(await readFile(join(root, 'src', 'plugins', 'manifests.ts'), 'utf8'), /^import \{ manifest as zzpub \} from '\.\/zzpub\/plugin';$/m);
  assert.match(await readFile(join(root, 'src', 'plugins', 'registry.ts'), 'utf8'), /^ {2}zzpub: \(\) => import\('\.\/zzpub'\),$/m);
  const said = out.lines.join('\n');
  assert.match(said, /npm run dev/);
  assert.match(said, /Plugins/);
  assert.match(said, /npm run tome -- check/);
});

test('plugin new --dry-run prints the files and lines, and writes nothing', async (t) => {
  const { root, state } = await checkout(t);
  const before = await state();
  const out = output();
  assert.equal(await tome(['plugin', 'new', 'zzpub', '--hook', 'signIn', '--dry-run'], io(root, out)), 0);
  assert.deepEqual(await state(), before);
  const said = out.lines.join('\n');
  assert.match(said, /src\/plugins\/zzpub\/index\.ts/);
  assert.match(said, /import \{ manifest as zzpub \} from '\.\/zzpub\/plugin';/);
});

test('plugin new refuses a taken id, before it writes anything', async (t) => {
  const { root, state } = await checkout(t);
  const before = await state();
  const out = output();
  assert.equal(await tome(['plugin', 'new', 'notice', '--hook', 'publicPage'], io(root, out)), 1);
  assert.match(out.lines.join('\n'), /already listed/);
  assert.deepEqual(await state(), before);
});

test('when registering fails, the new plugin\'s directory is removed', async (t) => {
  const { root, state } = await checkout(t);
  const before = await state();
  const out = output();
  const code = pluginNew(root, { id: 'zzpub', hook: 'publicPage', client: true, dryRun: false }, out, () => { throw new Error('the disk is full'); });
  assert.equal(code, 1);
  assert.match(out.lines.join('\n'), /the disk is full/);
  assert.deepEqual(await state(), before);
});
