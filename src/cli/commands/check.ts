import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BuildOutput } from '../build/create.js';
import { kindDirectory, type Kind } from '../build/ids.js';
import {
  directoryMatchesId,
  hooksImplemented,
  listedInBoth,
  rawColours,
  requiredFiles,
  serverImports,
  settingKinds,
  wellFormedSettings,
  type Problem,
} from '../build/rules.js';

/**
 * `tome check`: every theme and plugin in the checkout at `root`, held to the rules in
 * build/rules.ts. It prints each problem as `path:line: message` and changes nothing. The only
 * code it runs is each manifest file, which declares data; a plugin's index.ts is read, not run.
 */
export async function check(root: string, output: BuildOutput): Promise<number> {
  const counts = { theme: 0, plugin: 0 };
  const problems: Problem[] = [];
  for (const kind of ['theme', 'plugin'] as const) {
    const found = await checkKind(root, kind);
    counts[kind] = found.count;
    problems.push(...found.problems);
  }
  for (const { path, line, message } of problems) output.warn(`${path}:${line}: ${message}`);
  if (problems.length > 0) {
    output.warn(`${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}.`);
    return 1;
  }
  output.print(`Checked ${counts.theme} themes and ${counts.plugin} plugins: no problems.`);
  return 0;
}

async function checkKind(root: string, kind: Kind): Promise<{ count: number; problems: Problem[] }> {
  const base = kindDirectory(kind);
  const missing = [base, `${base}/contract.ts`, `${base}/manifests.ts`, `${base}/registry.ts`].find((path) => !existsSync(join(root, path)));
  if (missing) return { count: 0, problems: [{ path: missing, line: 1, message: 'is missing' }] };
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const ids = readdirSync(join(root, base), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  const kinds = settingKinds(read(`${base}/contract.ts`), kind);
  const problems = listedInBoth(kind, ids, { manifests: read(`${base}/manifests.ts`), registry: read(`${base}/registry.ts`) });
  for (const id of ids) problems.push(...await checkOne(root, kind, `${base}/${id}`, id, kinds));
  return { count: ids.length, problems };
}

async function checkOne(root: string, kind: Kind, directory: string, id: string, kinds: readonly string[]): Promise<Problem[]> {
  const files = filesIn(join(root, directory));
  const read = (file: string) => readFileSync(join(root, directory, file), 'utf8');
  const index = files.includes('index.ts') ? read('index.ts') : '';
  const problems = requiredFiles(kind, directory, files, index);
  const manifestFile = kind === 'theme' ? 'theme.ts' : 'plugin.ts';
  if (files.includes(manifestFile)) {
    const path = `${directory}/${manifestFile}`;
    const text = read(manifestFile);
    const loaded = await loadManifest(join(root, path));
    if (!loaded.ok) {
      problems.push({ path, line: 1, message: loaded.error });
    } else {
      const { manifest } = loaded;
      problems.push(...directoryMatchesId(path, id, text, manifest), ...wellFormedSettings(kind, path, text, manifest.settings, kinds));
      if (kind === 'plugin' && files.includes('index.ts')) problems.push(...hooksImplemented(`${directory}/index.ts`, index, manifest.hooks));
    }
  }
  if (kind === 'theme') {
    for (const file of files) {
      if (/\.(astro|ts)$/.test(file)) problems.push(...serverImports(`${directory}/${file}`, read(file)));
      if (file.endsWith('.css')) problems.push(...rawColours(`${directory}/${file}`, read(file)));
    }
  }
  return problems;
}

/** The manifest a theme.ts or plugin.ts exports. It declares data and imports only types, so loading it runs nothing else. */
async function loadManifest(path: string): Promise<{ ok: true; manifest: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const { manifest } = await import(pathToFileURL(path).href) as { manifest?: unknown };
    if (typeof manifest === 'object' && manifest !== null) return { ok: true, manifest: manifest as Record<string, unknown> };
    return { ok: false, error: 'exports no manifest' };
  } catch (error) {
    return { ok: false, error: `its manifest could not be loaded: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
}

/** Every file under `directory`, as a sorted path inside it, leaving out hidden files and directories. */
function filesIn(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .filter((file) => !file.split('/').some((part) => part.startsWith('.')))
    .sort();
}
