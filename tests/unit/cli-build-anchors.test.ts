import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyEdits, planRegistration } from '../../src/cli/build/anchors.js';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const files = ['src/themes/manifests.ts', 'src/themes/registry.ts', 'src/plugins/manifests.ts', 'src/plugins/registry.ts'];

/** A checkout holding copies of the four real list files, as they are today. */
async function copies(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tome-anchors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const kind of ['themes', 'plugins']) await mkdir(join(root, 'src', kind), { recursive: true });
  for (const file of files) await copyFile(join(repository, file), join(root, file));
  const read = async () => Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(join(root, file), 'utf8')])));
  return { root, original: await read(), read };
}

/** `text` with its one occurrence of `from` replaced: a change in the real files' shape fails here, loudly. */
function swap(text: string, from: string, to: string): string {
  assert.equal(text.split(from).length, 2, `expected exactly one ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

test('a new theme is imported after the last manifest import, appended to THEME_MANIFESTS and registered in order', async (t) => {
  const { root, original, read } = await copies(t);
  const plan = planRegistration('theme', 'zzdemo', root);
  assert.ok(plan.ok);
  const manifests = swap(swap(original['src/themes/manifests.ts'],
    "import { manifest as plain } from './plain/theme';\n",
    "import { manifest as plain } from './plain/theme';\nimport { manifest as zzdemo } from './zzdemo/theme';\n"),
    '= [paper, plain, almanac];', '= [paper, plain, almanac, zzdemo];');
  const registry = swap(original['src/themes/registry.ts'],
    "  plain: () => import('./plain'),\n",
    "  plain: () => import('./plain'),\n  zzdemo: () => import('./zzdemo'),\n");
  assert.deepEqual(plan.edits.map((edit) => [edit.path, edit.after]), [
    [join(root, 'src/themes/manifests.ts'), manifests],
    [join(root, 'src/themes/registry.ts'), registry],
  ]);
  assert.deepEqual(plan.edits.map((edit) => edit.lines), [
    ["import { manifest as zzdemo } from './zzdemo/theme';", 'export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, almanac, zzdemo];'],
    ["  zzdemo: () => import('./zzdemo'),"],
  ]);
  assert.deepEqual(await read(), original, 'planning writes nothing');
  applyEdits(plan.edits);
  assert.deepEqual(await read(), { ...original, 'src/themes/manifests.ts': manifests, 'src/themes/registry.ts': registry });
});

test('a new plugin is imported, appended to PLUGIN_MANIFESTS and registered in order', async (t) => {
  const { root, original, read } = await copies(t);
  const plan = planRegistration('plugin', 'zzdemo', root);
  assert.ok(plan.ok);
  const manifests = swap(swap(original['src/plugins/manifests.ts'],
    "import { manifest as typesafe } from './typesafe/plugin';\n",
    "import { manifest as typesafe } from './typesafe/plugin';\nimport { manifest as zzdemo } from './zzdemo/plugin';\n"),
    '= [turnstile, notice, popup, lightbox, typesafe, mcp];', '= [turnstile, notice, popup, lightbox, typesafe, mcp, zzdemo];');
  const registry = swap(original['src/plugins/registry.ts'],
    "  typesafe: () => import('./typesafe'),\n",
    "  typesafe: () => import('./typesafe'),\n  zzdemo: () => import('./zzdemo'),\n");
  applyEdits(plan.edits);
  assert.deepEqual(await read(), { ...original, 'src/plugins/manifests.ts': manifests, 'src/plugins/registry.ts': registry });
});

test('the registry keeps its alphabetical order; one that is not in order gets the new id last', async (t) => {
  const { root, original } = await copies(t);
  const registryOf = (kind: 'theme' | 'plugin', id: string) => {
    const plan = planRegistration(kind, id, root);
    assert.ok(plan.ok);
    return plan.edits[1].after;
  };
  assert.equal(registryOf('theme', 'basic'), swap(original['src/themes/registry.ts'],
    "  paper: () => import('./paper'),\n", "  basic: () => import('./basic'),\n  paper: () => import('./paper'),\n"));
  assert.equal(registryOf('plugin', 'nimbus'), swap(original['src/plugins/registry.ts'],
    "  notice: () => import('./notice'),\n", "  nimbus: () => import('./nimbus'),\n  notice: () => import('./notice'),\n"));
  assert.equal(registryOf('plugin', 'aardvark'), swap(original['src/plugins/registry.ts'],
    "  lightbox: () => import('./lightbox'),\n", "  aardvark: () => import('./aardvark'),\n  lightbox: () => import('./lightbox'),\n"));

  const shuffled = swap(swap(original['src/themes/registry.ts'],
    "  almanac: () => import('./almanac'),\n", ''), "  plain: () => import('./plain'),\n", "  plain: () => import('./plain'),\n  almanac: () => import('./almanac'),\n");
  await writeFile(join(root, 'src/themes/registry.ts'), shuffled);
  assert.equal(registryOf('theme', 'basic'), swap(shuffled,
    "  almanac: () => import('./almanac'),\n", "  almanac: () => import('./almanac'),\n  basic: () => import('./basic'),\n"));
});

test('a missing or ambiguous anchor changes nothing and gives the lines to add by hand', async (t) => {
  const { root, original, read } = await copies(t);
  const themeManifests = original['src/themes/manifests.ts'];
  const themeRegistry = original['src/themes/registry.ts'];
  const arrayLine = 'export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, almanac];';
  const broken: Array<[string, string, string]> = [
    ['no manifest import', 'src/themes/manifests.ts', themeManifests.replace(/^import \{ manifest as .*\n/gm, '')],
    ['no THEME_MANIFESTS', 'src/themes/manifests.ts', swap(themeManifests, arrayLine, '')],
    ['THEME_MANIFESTS twice', 'src/themes/manifests.ts', swap(themeManifests, arrayLine, `${arrayLine}\n${arrayLine}`)],
    ['THEME_MANIFESTS over several lines', 'src/themes/manifests.ts', swap(themeManifests, '[paper, plain, almanac]', '[\n  paper,\n  plain,\n  almanac,\n]')],
    ['no THEMES', 'src/themes/registry.ts', swap(themeRegistry, 'const THEMES = {', 'const LOOKS = {')],
    ['THEMES twice', 'src/themes/registry.ts', `${themeRegistry}\nconst THEMES = {\n} as const;\n`],
    ['an unexpected line in THEMES', 'src/themes/registry.ts', swap(themeRegistry, "  paper: () => import('./paper'),\n", "  // the default\n  paper: () => import('./paper'),\n")],
    ['THEMES never closed', 'src/themes/registry.ts', swap(themeRegistry, '} as const;', '};')],
  ];
  for (const [what, file, text] of broken) {
    await writeFile(join(root, file), text);
    const plan = planRegistration('theme', 'zzdemo', root);
    assert.equal(plan.ok, false, what);
    if (plan.ok) continue;
    assert.match(plan.manualLines[0], new RegExp(`${file.replace(/[./]/g, '\\$&')}.*nothing was changed`), what);
    assert.ok(plan.manualLines.includes("  import { manifest as zzdemo } from './zzdemo/theme';"), what);
    assert.ok(plan.manualLines.includes("  zzdemo: () => import('./zzdemo'),"), what);
    assert.ok(plan.manualLines.some((line) => /THEME_MANIFESTS/.test(line)), what);
    assert.deepEqual(await read(), { ...original, [file]: text }, `${what}: nothing else was touched`);
    await writeFile(join(root, file), original[file]);
  }
});

test('applying stops at a file changed since the plan, and puts back what it already wrote', async (t) => {
  const { root, original, read } = await copies(t);
  const plan = planRegistration('plugin', 'zzdemo', root);
  assert.ok(plan.ok);
  const changed = `${original['src/plugins/registry.ts']}// edited meanwhile\n`;
  await writeFile(join(root, 'src/plugins/registry.ts'), changed);
  assert.throws(() => applyEdits(plan.edits), /src\/plugins\/registry\.ts changed/);
  assert.deepEqual(await read(), { ...original, 'src/plugins/registry.ts': changed });
});
