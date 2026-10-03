import type { Kind } from './ids.js';

// The rules `tome check` holds every theme and plugin to. Each is a pure function over text it is
// handed, and returns its problems; it reads nothing and writes nothing. commands/check.ts reads
// the checkout and runs them. tests/unit/theme-registry.test.ts and almanac-tokens.test.ts call
// rules 6 and 7, and plugin-admin.test.ts reads HOOK_METHODS, so each is written once.

/** One thing wrong, printed as `path:line: message`. The path is from the checkout's root. */
export interface Problem {
  path: string;
  line: number;
  message: string;
}

const THEME_FILES = ['index.ts', 'theme.ts', 'Shell.astro', 'Home.astro', 'Post.astro', 'Page.astro', 'theme.css'];
const PLUGIN_FILES = ['plugin.ts', 'index.ts'];

/** What every plugin exports, whatever it declares: the core asks each one at sign-in. */
export const SIGN_IN_PAIR = ['signInWidget', 'verifySignIn'] as const;

/**
 * For each hook a manifest may declare, the methods of which a plugin implements at least one.
 * signIn is the pair every plugin has, and mcp is served by the core, so neither adds any.
 */
export const HOOK_METHODS: Readonly<Record<string, readonly string[]>> = {
  editorSuggestions: ['categoryLikelihoods', 'pickExcerpt', 'pickDescription'],
  mcp: [],
  publicPage: ['siteNotice', 'sitePopup', 'publicClient'],
  signIn: [],
};

/** The 1-based line `index` falls on. */
function lineAt(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

/** The line of the first match of `pattern`, or 1. */
function lineOf(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  return match ? lineAt(text, match.index) : 1;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const filled = (value: unknown) => typeof value === 'string' && value.trim() !== '';

/** Rule 1: the manifest's id is its directory's name. */
export function directoryMatchesId(path: string, directory: string, text: string, manifest: { id?: unknown }): Problem[] {
  if (manifest.id === directory) return [];
  return [{ path, line: lineOf(text, /^\s*id\s*:/m), message: `the manifest's id is ${JSON.stringify(manifest.id)}, but its directory is "${directory}"` }];
}

/**
 * Rule 2: every directory of a kind is an entry of its `*_MANIFESTS` array and a key of its
 * registry, and every entry and key has a directory. `ids` are the directories.
 */
export function listedInBoth(kind: Kind, ids: readonly string[], lists: { manifests: string; registry: string }): Problem[] {
  const base = `src/${kind}s`;
  const files = { manifests: `${base}/manifests.ts`, registry: `${base}/registry.ts` };
  const listed = {
    manifests: arrayEntries(lists.manifests),
    registry: [...lists.registry.matchAll(/^\s*['"]?([A-Za-z_$][\w$]*)['"]?\s*:\s*\(\)\s*=>\s*import\(/gm)]
      .map((match) => ({ id: match[1]!, line: lineAt(lists.registry, match.index) })),
  };
  const anchors = { manifests: lineOf(lists.manifests, /_MANIFESTS\b/), registry: lineOf(lists.registry, /^const [A-Z]+ = \{/m) };
  const problems: Problem[] = [];
  for (const id of ids) {
    for (const file of ['manifests', 'registry'] as const) {
      if (!listed[file].some((entry) => entry.id === id)) problems.push({ path: files[file], line: anchors[file], message: `${id} is not listed here` });
    }
  }
  for (const file of ['manifests', 'registry'] as const) {
    for (const entry of listed[file]) {
      if (!ids.includes(entry.id)) problems.push({ path: files[file], line: entry.line, message: `${entry.id} is listed, but ${base}/${entry.id} does not exist` });
    }
  }
  return problems;
}

/** The entries of a manifests.ts's `*_MANIFESTS = [...]` array, with the line each is on. */
function arrayEntries(text: string): Array<{ id: string; line: number }> {
  const array = /_MANIFESTS\b[^=]*=\s*\[([^\]]*)\]/.exec(text);
  if (!array) return [];
  const start = array.index + array[0].length - array[1]!.length - 1;
  return [...array[1]!.matchAll(/[A-Za-z_$][\w$]*/g)].map((entry) => ({ id: entry[0], line: lineAt(text, start + entry.index) }));
}

/** Rule 3: the files a theme or plugin needs. `files` are paths inside its directory; `index` is its index.ts. */
export function requiredFiles(kind: Kind, directory: string, files: readonly string[], index: string): Problem[] {
  const missing = (file: string, why: string): Problem[] => files.includes(file) ? [] : [{ path: `${directory}/${file}`, line: 1, message: `is missing, and ${why} needs it` }];
  const problems = (kind === 'theme' ? THEME_FILES : PLUGIN_FILES).flatMap((file) => missing(file, `every ${kind}`));
  if (kind === 'plugin' && exportedNames(index).has('publicClient')) problems.push(...missing('client.ts', 'a plugin with a publicClient'));
  return problems;
}

/** The setting kinds a contract allows, read from its ThemeSetting or PluginSetting interface. */
export function settingKinds(contract: string, kind: Kind): string[] {
  const name = kind === 'theme' ? 'ThemeSetting' : 'PluginSetting';
  const body = new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(contract)?.[1] ?? '';
  const union = /^\s*kind: ([^;]+);/m.exec(body);
  if (!union) throw new Error(`The contract has no ${name} with a kind.`);
  return [...union[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

/**
 * Rule 4: each setting of a manifest is well formed. `settings` is the loaded manifest's, so it is
 * checked as unknown data; `text` is the manifest's source, for the line of each setting's key.
 * A theme's text setting needs a max, which a plugin's contract does not have.
 */
export function wellFormedSettings(kind: Kind, path: string, text: string, settings: unknown, kinds: readonly string[]): Problem[] {
  if (settings === undefined) return [];
  if (!Array.isArray(settings)) return [{ path, line: lineOf(text, /\bsettings\s*:/), message: 'settings is not a list' }];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const setting of settings as Array<Record<string, unknown>>) {
    const key = String(setting?.key ?? '');
    const line = lineOf(text, new RegExp(`\\bkey\\s*:\\s*['"]${escape(key)}['"]`));
    const report = (message: string) => problems.push({ path, line, message: `setting "${key}" ${message}` });
    if (seen.has(key)) report('is declared twice');
    seen.add(key);
    if (!kinds.includes(String(setting?.kind))) report(`has kind ${JSON.stringify(setting?.kind)}, which the contract does not allow (${kinds.join(', ')})`);
    for (const missing of languagesMissing(setting?.label)) report(`has no ${missing} label`);
    if (setting?.hint !== undefined) for (const missing of languagesMissing(setting.hint)) report(`has no ${missing} hint`);
    const fallback = JSON.stringify(setting?.fallback) ?? 'nothing';
    if (setting?.kind === 'choice') {
      const options = Array.isArray(setting.options) ? setting.options as Array<Record<string, unknown>> : [];
      if (options.length === 0) {
        report('is a choice with no options');
      } else {
        if (!options.some((option) => option?.value === setting.fallback)) report(`falls back to ${fallback}, which is not one of its options`);
        for (const option of options) {
          for (const missing of languagesMissing(option?.label)) problems.push({ path, line, message: `an option of setting "${key}" has no ${missing} label` });
        }
      }
    }
    if (setting?.kind === 'text' && kind === 'theme' && !(Number.isInteger(setting.max) && (setting.max as number) > 0)) report('is text, so it needs a max length');
    if (setting?.kind === 'switch' && setting.fallback !== 'on' && setting.fallback !== 'off') report(`is a switch, so it falls back to on or off, not ${fallback}`);
  }
  return problems;
}

/** Which of English and Thai an `{ en, th }` pair leaves empty. */
function languagesMissing(pair: unknown): string[] {
  const words = (pair ?? {}) as Record<string, unknown>;
  return ([['en', 'English'], ['th', 'Thai']] as const).filter(([language]) => !filled(words[language])).map(([, name]) => name);
}

/**
 * The names a module exports, read from its source: `export function|const|let|class <name>` and
 * `export { a, b as c }`, with or without `from`. Not the default export: the core loads a plugin's
 * module namespace, so a method only on the default object is one the core never finds.
 */
export function exportedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const [, name] of text.matchAll(/^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s*([A-Za-z_$][\w$]*)/gm)) names.add(name!);
  for (const [, list] of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of list!.split(',').map((entry) => entry.trim())) {
      if (part === '' || part.startsWith('type ')) continue;
      names.add(part.split(/\s+as\s+/).pop()!);
    }
  }
  return names;
}

/** Rule 5: a plugin's index.ts exports the sign-in pair, and a method of each hook its manifest declares. */
export function hooksImplemented(path: string, index: string, hooks: unknown): Problem[] {
  const exported = exportedNames(index);
  const problems: Problem[] = SIGN_IN_PAIR.filter((name) => !exported.has(name))
    .map((name) => ({ path, line: 1, message: `exports no ${name}, which every plugin needs` }));
  for (const hook of Array.isArray(hooks) ? hooks : []) {
    const methods = HOOK_METHODS[String(hook)];
    if (!methods) {
      problems.push({ path, line: 1, message: `declares the hook ${JSON.stringify(hook)}, which the contract does not have` });
    } else if (methods.length > 0 && !methods.some((name) => exported.has(name))) {
      problems.push({ path, line: 1, message: `declares ${hook}, but exports none of ${methods.join(', ')}` });
    }
  }
  return problems;
}

/** Rule 6: a theme file imports nothing from src/server/ or src/pages/. A theme is handed what it needs. */
export function serverImports(path: string, source: string): Problem[] {
  return source.split('\n').flatMap((text, index) =>
    [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]*\/(?:server|pages)(?:\/[^'"]*)?)['"]/g)].map(([, specifier]) => ({
      path,
      line: index + 1,
      message: `imports ${specifier}, and a theme may not import from src/server/ or src/pages/`,
    })));
}

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)/gi;

/**
 * Rule 7: a theme's CSS draws with tokens. A raw colour -- a hex, or rgb(), hsl(), oklch(), oklab(),
 * lab() or lch() -- may appear only in a token block: a rule whose declarations are all custom
 * properties, such as `:root { --color-ink: oklch(…); }`. Comments are not read, and a `#name` in
 * a selector is not a colour.
 */
export function rawColours(path: string, css: string): Problem[] {
  // Comments blanked to spaces, so every index and line stays where it was.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const problems: Problem[] = [];
  for (const match of text.matchAll(COLOUR)) {
    const at = match.index;
    const next = text.slice(at).search(/[{};]/);
    if (next !== -1 && text[at + next] === '{') continue;
    const open = text.lastIndexOf('{', at);
    if (open > text.lastIndexOf('}', at)) {
      const close = text.indexOf('}', at);
      const declarations = text.slice(open + 1, close === -1 ? undefined : close).split(';').map((part) => part.trim()).filter(Boolean);
      if (declarations.every((declaration) => declaration.startsWith('--'))) continue;
    }
    problems.push({ path, line: lineAt(text, at), message: `${match[0]} is a raw colour outside a token block; use a token` });
  }
  return problems;
}
