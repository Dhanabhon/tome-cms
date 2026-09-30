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

/** A stored value made safe to use: a known id, `'auto'`, or `null` for anything else. */
export function normalizeCodeLanguage(value: unknown): CodeLanguage {
  return value === 'auto' || (typeof value === 'string' && IDS.has(value)) ? (value as CodeLanguage) : null;
}

export function codeLanguageLabel(id: string | null | undefined): string | null {
  return CODE_LANGUAGES.find((language) => language.id === id)?.label ?? null;
}
