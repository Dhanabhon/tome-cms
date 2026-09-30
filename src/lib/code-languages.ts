/**
 * The languages a code block can be set to: what the picker lists, what the server stores and
 * what the sanitizer lets through. The grammars behind them live in code-highlight.ts, so a
 * module that only needs the names does not bundle them.
 *
 * Sorted by label, which is the order the picker lists them in after None and Auto.
 */
export const CODE_LANGUAGES = [
  { id: 'bash', label: 'Bash' },
  { id: 'c', label: 'C' },
  { id: 'csharp', label: 'C#' },
  { id: 'cpp', label: 'C++' },
  { id: 'css', label: 'CSS' },
  { id: 'dart', label: 'Dart' },
  { id: 'diff', label: 'Diff' },
  { id: 'go', label: 'Go' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'xml', label: 'HTML, XML' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'php', label: 'PHP' },
  { id: 'python', label: 'Python' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'ini', label: 'TOML, INI' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'yaml', label: 'YAML' },
] as const;

export type CodeLanguageId = (typeof CODE_LANGUAGES)[number]['id'];
/** What a code block stores: `null` is None (plain), `'auto'` is Auto, anything else is a grammar. */
export type CodeLanguage = CodeLanguageId | 'auto' | null;

const IDS: ReadonlySet<string> = new Set(CODE_LANGUAGES.map((language) => language.id));

/** The short names fenced code usually carries, for the id each stands for. */
const ALIASES: ReadonlyMap<string, CodeLanguageId> = new Map(Object.entries({
  javascript: 'js jsx mjs cjs', typescript: 'ts tsx', bash: 'sh shell zsh console', python: 'py', ruby: 'rb', yaml: 'yml',
  xml: 'html htm svg xhtml', cpp: 'c++ cc hpp cxx', csharp: 'cs c#', kotlin: 'kt kts', markdown: 'md', rust: 'rs', ini: 'toml',
  go: 'golang', graphql: 'gql', diff: 'patch', c: 'h', json: 'jsonc',
}).flatMap(([id, names]) => names.split(' ').map((name) => [name, id as CodeLanguageId] as const)));

/**
 * A stored value made safe to use: a known id, `'auto'`, or `null` for anything else. An id or a
 * usual short name ("ts", "yml", "c++") in any case is taken for the id it stands for.
 */
export function normalizeCodeLanguage(value: unknown): CodeLanguage {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  if (name === 'auto') return 'auto';
  return IDS.has(name) ? (name as CodeLanguageId) : ALIASES.get(name) ?? null;
}

export function codeLanguageLabel(id: string | null | undefined): string | null {
  return CODE_LANGUAGES.find((language) => language.id === id)?.label ?? null;
}
