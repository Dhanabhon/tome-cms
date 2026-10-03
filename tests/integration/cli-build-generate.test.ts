import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));

/** Runs node with `args` in `cwd`, as argv, and gives back its exit code and everything it said. */
function node(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  // Its own timeout: a blocked event loop would keep the test's from ever firing.
  const run = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 240_000 });
  return { code: run.status, output: `${run.stdout}${run.stderr}${run.error ? `\n${run.error.message}` : ''}` };
}

/** A copy of the checkout in a scratch directory, sharing node_modules by a link. */
async function copyCheckout(t: test.TestContext, paths: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'tome-generate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of paths) await cp(join(repository, path), join(root, path), { recursive: true });
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

/** The directories under src/<kind>s: the themes or plugins a checkout has. */
const directories = (root: string, kind: 'themes' | 'plugins') =>
  readdirSync(join(root, 'src', kind), { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).length;

/** The entries of THEME_MANIFESTS, as the file has them. */
const themeEntries = (text: string) => /THEME_MANIFESTS\b[^=]*=\s*\[([^\]]*)\]/.exec(text)![1]!;

// The proof that what tome writes builds: generate a theme from each kind of source and a plugin
// for each hook in a copy of the checkout, then type-check the whole site there and run tome check
// on it. The copy shares node_modules by a link, and is thrown away after.
test('a theme and plugins made by tome new pass astro check and tome check', { timeout: 300_000 }, async (t) => {
  // public/fonts too: tome check holds each font a theme preloads to a file there.
  const root = await copyCheckout(t, ['src', 'public/fonts', 'package.json', 'tsconfig.json', 'tsconfig.updater.json', 'astro.config.mjs']);
  // Astro's own cache would otherwise be node_modules/.astro, through the link and into the real tree.
  const config = await readFile(join(root, 'astro.config.mjs'), 'utf8');
  assert.equal(config.split('defineConfig({').length, 2, 'astro.config.mjs calls defineConfig({ once');
  await writeFile(join(root, 'astro.config.mjs'), config.replace('defineConfig({', "defineConfig({\n  cacheDir: './.astro-cache',"));
  const before = {
    entries: themeEntries(await readFile(join(root, 'src', 'themes', 'manifests.ts'), 'utf8')),
    themes: directories(root, 'themes'),
    plugins: directories(root, 'plugins'),
  };

  for (const command of [
    ['theme', 'new', 'zzdemo', '--from', 'almanac'],
    ['theme', 'new', 'zzplain'],
    ['theme', 'new', 'zzpaper', '--from', 'paper'],
    ['plugin', 'new', 'zzpub', '--hook', 'publicPage', '--client'],
    ['plugin', 'new', 'zzsign', '--hook', 'signIn'],
    ['plugin', 'new', 'zzedit', '--hook', 'editorSuggestions'],
  ]) {
    const run = node(root, ['--import', 'tsx', 'src/cli/main.ts', ...command]);
    assert.equal(run.code, 0, `${command.join(' ')}\n${run.output}`);
  }
  const manifests = await readFile(join(root, 'src', 'themes', 'manifests.ts'), 'utf8');
  assert.equal(themeEntries(manifests), `${before.entries}, zzdemo, zzplain, zzpaper`);
  // Each copy preloads what its source does: the same files, which tome check finds below.
  const preloads = async (id: string) => /^  preloadFonts: \[[^\]]*\],$/m.exec(await readFile(join(root, 'src', 'themes', id, 'theme.ts'), 'utf8'))?.[0];
  for (const [copy, source] of [['zzdemo', 'almanac'], ['zzplain', 'plain'], ['zzpaper', 'paper']] as const) {
    assert.ok(await preloads(source), source);
    assert.equal(await preloads(copy), await preloads(source), copy);
  }
  // And a theme that names none still checks and builds: it preloads nothing.
  const plain = join(root, 'src', 'themes', 'zzplain', 'theme.ts');
  await writeFile(plain, (await readFile(plain, 'utf8')).replace(/^  preloadFonts: \[[^\]]*\],\n/m, ''));
  assert.equal(await preloads('zzplain'), undefined);

  // Its own Vite cache too, so the shared node_modules is not written to.
  const check = node(root, [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'check'], {
    ASTRO_TELEMETRY_DISABLED: '1',
    TOME_CMS_VITE_CACHE_DIR: join(root, '.vite'),
  });
  assert.equal(check.code, 0, check.output);
  assert.match(check.output, /- 0 errors/);

  // And tome's own rules hold for everything it made.
  const rules = node(root, ['--import', 'tsx', 'src/cli/main.ts', 'check']);
  assert.equal(rules.code, 0, rules.output);
  assert.ok(rules.output.split('\n').includes(`Checked ${before.themes + 3} themes and ${before.plugins + 3} plugins: no problems.`), rules.output);
});

// A managed server keeps a release clone at /opt/tome-cms-src, which is a checkout, and its tome is
// this tree compiled by tsconfig.updater.json and run by plain node. Run from inside the clone, that
// tome still refuses every builder command, and writes nothing.
test('the compiled tome a server installs refuses the builder commands, even inside a checkout', { timeout: 120_000 }, async (t) => {
  const root = await copyCheckout(t, ['src', 'package.json', 'tsconfig.updater.json']);
  const build = node(root, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.updater.json']);
  assert.equal(build.code, 0, build.output);
  const lists = () => Promise.all(['themes', 'plugins'].flatMap((kind) => ['manifests.ts', 'registry.ts'].map((file) => readFile(join(root, 'src', kind, file), 'utf8'))));
  const before = { lists: await lists(), themes: directories(root, 'themes'), plugins: directories(root, 'plugins') };
  for (const command of [['theme', 'new', 'zzsrv'], ['plugin', 'new', 'zzsrv', '--hook', 'signIn'], ['check']]) {
    const run = node(root, [join(root, 'dist-updater', 'cli', 'main.js'), ...command]);
    assert.equal(run.code, 1, `${command.join(' ')}\n${run.output}`);
    assert.equal(run.output, 'Run this in a TomeCMS source checkout.\n', command.join(' '));
  }
  assert.deepEqual({ lists: await lists(), themes: directories(root, 'themes'), plugins: directories(root, 'plugins') }, before);
  // The same checkout's own source, as `npm run tome` runs it, is not refused.
  const own = node(root, ['--import', 'tsx', 'src/cli/main.ts', 'theme', 'new', 'zzsrv', '--dry-run']);
  assert.equal(own.code, 0, own.output);
});
