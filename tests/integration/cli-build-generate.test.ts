import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// The proof that what tome writes builds: generate a theme from each kind of source and a plugin
// for each hook in a copy of the checkout, then type-check the whole site there. The copy shares
// node_modules by a link, and is thrown away after.
test('a theme and plugins made by tome new pass astro check', { timeout: 300_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tome-generate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['src', 'package.json', 'tsconfig.json', 'tsconfig.updater.json', 'astro.config.mjs']) {
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  // Astro's own cache would otherwise be node_modules/.astro, through the link and into the real tree.
  const config = await readFile(join(root, 'astro.config.mjs'), 'utf8');
  assert.equal(config.split('defineConfig({').length, 2, 'astro.config.mjs calls defineConfig({ once');
  await writeFile(join(root, 'astro.config.mjs'), config.replace('defineConfig({', "defineConfig({\n  cacheDir: './.astro-cache',"));

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
  assert.match(manifests, /\[paper, plain, almanac, zzdemo, zzplain, zzpaper\]/);

  // Its own Vite cache too, so the shared node_modules is not written to.
  const check = node(root, [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'check'], {
    ASTRO_TELEMETRY_DISABLED: '1',
    TOME_CMS_VITE_CACHE_DIR: join(root, '.vite'),
  });
  assert.equal(check.code, 0, check.output);
  assert.match(check.output, /- 0 errors/);
});
