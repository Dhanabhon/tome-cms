import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isListed, kindDirectory, type Kind } from './ids.js';

// How tome registers a new theme or plugin: by inserting lines at known anchors in that kind's two
// list files, and only when each anchor is found exactly once, in exactly the shape below. A file in
// any other shape is never rewritten; the owner gets the lines to add by hand instead.
//
// manifests.ts (src/themes, src/plugins)
//   1. The last line of the form `import { manifest as <x> } from './<x>/theme';` (`/plugin';` for
//      plugins). The new import goes on the line after it.
//   2. The one line `export const THEME_MANIFESTS: readonly ThemeManifest[] = [a, b, c];` (or
//      PLUGIN_MANIFESTS / PluginManifest), on a single line and with at least one entry. The new
//      id goes last in the array, since the order there is the order the admin offers them in.
//
// registry.ts
//   3. The one object literal from `const THEMES = {` (or PLUGINS) to the next `} as const;`, every
//      line between them of the form `  <x>: () => import('./<x>'),`, and at least one of them. An
//      empty list is not one tome has seen, so it is not one it edits. The new entry goes in
//      alphabetical order when the keys already are in it, and last otherwise.

/** One list file's whole text before and after, and the lines the edit adds or rewrites. */
export interface FileEdit {
  path: string;
  before: string;
  after: string;
  lines: string[];
}

const names = {
  theme: { array: 'THEME_MANIFESTS', type: 'ThemeManifest', module: 'theme', object: 'THEMES' },
  plugin: { array: 'PLUGIN_MANIFESTS', type: 'PluginManifest', module: 'plugin', object: 'PLUGINS' },
} as const;

/**
 * The edits that register `id` in the checkout at `root`, or the lines to add by hand. Writes
 * nothing. An id either file already lists is refused here too, so no plan ever lists one twice.
 */
export function planRegistration(kind: Kind, id: string, root: string):
  { ok: true; edits: FileEdit[] } | { ok: false; manualLines: string[] } {
  const directory = kindDirectory(kind);
  const files = { manifests: `${directory}/manifests.ts`, registry: `${directory}/registry.ts` };
  const name = names[kind];
  const importLine = `import { manifest as ${id} } from './${id}/${name.module}';`;
  const entryLine = `  ${id}: () => import('./${id}'),`;

  const texts = { manifests: readFileSync(join(root, files.manifests), 'utf8'), registry: readFileSync(join(root, files.registry), 'utf8') };
  const listed = (['manifests', 'registry'] as const).find((file) => isListed(texts[file], id));
  if (listed) return { ok: false, manualLines: [`${id} is already listed in ${files[listed]}, so nothing was changed.`] };
  const manifests = editManifests(texts.manifests, kind, id, importLine);
  const registry = editRegistry(texts.registry, kind, entryLine);
  if (manifests && registry) {
    return { ok: true, edits: [{ path: join(root, files.manifests), ...manifests }, { path: join(root, files.registry), ...registry }] };
  }
  const unexpected = [manifests ? null : files.manifests, registry ? null : files.registry].filter(Boolean).join(' and ');
  return {
    ok: false,
    manualLines: [
      `${unexpected} ${unexpected.includes(' and ') ? 'are' : 'is'} not in the shape tome edits, so nothing was changed. Add these lines by hand:`,
      `In ${files.manifests}, after the last manifest import:`,
      `  ${importLine}`,
      `In ${files.manifests}, at the end of ${name.array}:`,
      `  ${id}`,
      `In ${files.registry}, in ${name.object}:`,
      entryLine,
    ],
  };
}

/** Anchors 1 and 2, or null when either is missing or ambiguous. */
function editManifests(before: string, kind: Kind, id: string, importLine: string): Omit<FileEdit, 'path'> | null {
  const name = names[kind];
  const lines = before.split('\n');
  const imports = new RegExp(`^import \\{ manifest as ([a-z][a-z0-9]*) \\} from '\\./\\1/${name.module}';$`);
  const array = new RegExp(`^export const ${name.array}: readonly ${name.type}\\[\\] = \\[[a-z][a-z0-9]*(?:, [a-z][a-z0-9]*)*\\];$`);
  const lastImport = lines.findLastIndex((line) => imports.test(line));
  const arrays = lines.flatMap((line, index) => array.test(line) ? [index] : []);
  // Any other mention of the array's declaration (one spread over lines, a second one) is a shape tome does not know.
  const declarations = lines.filter((line) => line.includes(`const ${name.array}`)).length;
  if (lastImport < 0 || arrays.length !== 1 || declarations !== 1) return null;
  const arrayLine = lines[arrays[0]].replace(/\];$/, `, ${id}];`);
  const after = lines.with(arrays[0], arrayLine).toSpliced(lastImport + 1, 0, importLine).join('\n');
  return { before, after, lines: [importLine, arrayLine] };
}

/** Anchor 3, or null when it is missing, ambiguous or holds a line of another shape. */
function editRegistry(before: string, kind: Kind, entryLine: string): Omit<FileEdit, 'path'> | null {
  const lines = before.split('\n');
  const opening = `const ${names[kind].object} = {`;
  const openings = lines.flatMap((line, index) => line === opening ? [index] : []);
  if (openings.length !== 1) return null;
  const start = openings[0] + 1;
  const end = lines.indexOf('} as const;', start);
  if (end < 0) return null;
  const entry = /^ {2}([a-z][a-z0-9]*): \(\) => import\('\.\/\1'\),$/;
  const keys = lines.slice(start, end).map((line) => entry.exec(line)?.[1]);
  if (keys.length === 0 || keys.some((key) => key === undefined)) return null;
  const key = entry.exec(entryLine)![1];
  const sorted = keys.every((each, index) => index === 0 || keys[index - 1]! < each!);
  const position = sorted ? keys.filter((each) => each! < key).length : keys.length;
  return { before, after: lines.toSpliced(start + position, 0, entryLine).join('\n'), lines: [entryLine] };
}

/**
 * Writes each edit. A file that changed since it was planned stops it, and every file already
 * written is put back as it was, so a theme or plugin is never left half registered.
 */
export function applyEdits(edits: readonly FileEdit[]): void {
  const written: FileEdit[] = [];
  try {
    for (const edit of edits) {
      if (readFileSync(edit.path, 'utf8') !== edit.before) throw new Error(`${edit.path} changed while tome was working; nothing was registered.`);
      writeFileSync(edit.path, edit.after);
      written.push(edit);
    }
  } catch (error) {
    for (const edit of written) writeFileSync(edit.path, edit.before);
    throw error;
  }
}
