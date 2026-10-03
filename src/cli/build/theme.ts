import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// How `tome theme new` turns a copy of one theme into another. Not a blind replace of the word:
// each rule below names the one place the source theme's id is used as a value, and the rules
// run on code only, so a comment that mentions the source theme still says what it said.
//
//   1. theme.ts: the manifest's `id`, and its `name` and `description`, which become the new id
//      for the author to rewrite.
//   2. Every file: a name the theme owns, which starts `<from>-` -- a class (`.almanac-card`), an
//      element id (`almanac-search`), a custom property (`--almanac-tone-0`), a keyframes name.
//      `--color-paper-2` is the core's, and is left alone: the id must start the name.
//   3. Every .astro file: a `class` or `data-*` attribute whose value lists the id as a word, as
//      Shell's `<body class="almanac">` does.
//   4. Every .css file: the id as a class selector, as in `body.almanac` and `.plain {`.
//   5. fonts.css is the source's face, written by scripts/sync-fonts.mjs. It is not copied: the
//      new stylesheet imports the source's, so it loads the same files under public/fonts.

/** A file of the new theme: its path inside the theme's directory, and its text. */
export interface ThemeFile {
  path: string;
  text: string;
}

const FONTS = 'fonts.css';

/** The new theme `id`'s files, from the theme `from` in the checkout at `root`. Reads, and writes nothing. */
export function copyTheme(root: string, from: string, id: string): ThemeFile[] {
  const directory = join(root, 'src', 'themes', from);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !(entry.name === FONTS && entry.parentPath === directory))
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
    .sort()
    .map((path) => ({ path, text: renameThemeFile(path, readFileSync(join(directory, path), 'utf8'), from, id) }));
}

/** One file of the theme `from`, at `path` inside its directory, as it reads in the theme `id`. */
export function renameThemeFile(path: string, text: string, from: string, id: string): string {
  const rules: Array<(code: string) => string> = [
    (code) => code.replace(new RegExp(`(?<![\\w-])(--)?${from}-`, 'g'), `$1${id}-`),
  ];
  if (path === 'theme.ts') {
    rules.push((code) => code.replace(/^( {2}(?:description|id|name): )'[^'\n]*',$/gm, `$1'${id}',`));
  }
  if (path.endsWith('.astro')) {
    rules.push((code) => code.replace(/(\s(?:class|data-[\w-]+)=")([^"]*)"/g, (_, attribute: string, value: string) =>
      `${attribute}${value.split(' ').map((word) => word === from ? id : word).join(' ')}"`));
  }
  if (path.endsWith('.css')) {
    rules.push((code) => code.replace(new RegExp(`\\.${from}(?![\\w-])`, 'g'), `.${id}`));
    rules.push((code) => code.replaceAll(`@import './${FONTS}';`, `@import '../${from}/${FONTS}';`));
  }
  return outsideComments(text, (code) => rules.reduce((result, rule) => rule(result), code));
}

// A block comment (CSS, TypeScript, an Astro expression), an HTML comment, or a line comment after
// whitespace -- never the `//` of an address, which follows a colon.
const COMMENT = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<=^|\s)\/\/[^\n]*/g;

/** `text` with `change` applied to everything but its comments, which are kept as they are. */
function outsideComments(text: string, change: (code: string) => string): string {
  let result = '';
  let from = 0;
  for (const comment of text.matchAll(COMMENT)) {
    result += change(text.slice(from, comment.index)) + comment[0];
    from = comment.index + comment[0].length;
  }
  return result + change(text.slice(from));
}
