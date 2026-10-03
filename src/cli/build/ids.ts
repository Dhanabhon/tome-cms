import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Kind = 'theme' | 'plugin';

/** Where a kind lives in a checkout: src/themes, src/plugins. */
export function kindDirectory(kind: Kind): string {
  return `src/${kind}s`;
}

// As every theme and plugin id is: no hyphen, since the id is also its import name in manifests.ts.
const ID = /^[a-z][a-z0-9]{1,30}$/;

// The words JavaScript will not take as an import name, which an id would otherwise become.
const RESERVED = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

/**
 * Whether `id` can name a new theme or plugin in the checkout at `root`: the right form, and not
 * taken by a directory, a file, or an entry in that kind's manifests.ts or registry.ts.
 */
export function validateId(kind: Kind, id: string, root: string): { ok: true } | { ok: false; reason: string } {
  if (!ID.test(id)) {
    return { ok: false, reason: `An id is 2 to 31 lowercase letters and digits, starting with a letter; "${id}" is not.` };
  }
  if (RESERVED.has(id)) return { ok: false, reason: `"${id}" is a reserved word in JavaScript, so it cannot name a ${kind}.` };
  const directory = kindDirectory(kind);
  // A file counts too: a theme directory "styles" would lose its import to styles.ts beside it.
  for (const taken of [`${directory}/${id}`, `${directory}/${id}.ts`]) {
    if (existsSync(join(root, taken))) return { ok: false, reason: `${taken} already exists.` };
  }
  for (const list of ['manifests.ts', 'registry.ts']) {
    const file = `${directory}/${list}`;
    if (isListed(readFileSync(join(root, file), 'utf8'), id)) return { ok: false, reason: `${id} is already listed in ${file}.` };
  }
  return { ok: true };
}

/** Whether a list file names `id`: as an import name or path, a registry key, or an entry of a MANIFESTS array. */
export function isListed(text: string, id: string): boolean {
  const named = [
    new RegExp(`\\bmanifest\\s+as\\s+${id}\\b`),
    new RegExp(`['"]\\./${id}['"/]`),
    new RegExp(`^\\s*['"]?${id}['"]?\\s*:\\s*\\(`, 'm'),
  ];
  if (named.some((pattern) => pattern.test(text))) return true;
  return [...text.matchAll(/_MANIFESTS\b[^=]*=\s*\[([^\]]*)\]/g)].some(([, entries]) => entries.split(',').some((entry) => entry.trim() === id));
}
