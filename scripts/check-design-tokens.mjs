#!/usr/bin/env node
/**
 * Fails the build when DESIGN.md drifts from the token source of truth.
 *
 * The project previously carried three competing scales — DESIGN.md declared ten radii,
 * installer-tokens.css defined three, and tailwind.config.mjs hardcoded four more. Every
 * new screen had to guess which one to believe. installer-tokens.css now owns the values;
 * this check keeps the document honest about them.
 *
 * Usage: node scripts/check-design-tokens.mjs [--self-test]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GROUPS = [
  { cssPrefix: '--radius-', docKey: 'rounded' },
  { cssPrefix: '--space-', docKey: 'spacing' },
];

/** Reads one `key:` map out of the DESIGN.md YAML frontmatter. */
export function readDocTokens(markdown, key) {
  const frontmatter = markdown.split('---')[1] ?? '';
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) throw new Error(`DESIGN.md is missing the "${key}:" block.`);

  const tokens = new Map();
  for (const line of lines.slice(start + 1)) {
    const match = /^ {2}([a-z0-9-]+): "(.+)"$/.exec(line);
    if (!match) break;
    tokens.set(match[1], match[2]);
  }
  return tokens;
}

/** Reads `--prefix*` declarations out of a CSS file, resolving one level of var() aliasing. */
export function readCssTokens(css, prefix) {
  const declared = new Map();
  for (const [, name, value] of css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    declared.set(name, value.trim());
  }

  const tokens = new Map();
  for (const [name, value] of declared) {
    if (!name.startsWith(prefix)) continue;
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    tokens.set(name.slice(2), alias ? declared.get(alias[1]) ?? value : value);
  }
  return tokens;
}

export function compare(doc, css, label) {
  const problems = [];
  for (const [name, value] of doc) {
    if (!css.has(name)) problems.push(`${label}: DESIGN.md declares "${name}" but the CSS does not define it.`);
    else if (css.get(name) !== value) problems.push(`${label}: "${name}" is "${value}" in DESIGN.md but "${css.get(name)}" in the CSS.`);
  }
  for (const name of css.keys()) {
    if (!doc.has(name)) problems.push(`${label}: the CSS defines "${name}" but DESIGN.md does not document it.`);
  }
  return problems;
}

function selfTest() {
  const css = '  --radius-sm: 0.375rem;\n  --radius-card: var(--radius-sm);\n';
  const alias = readCssTokens(css, '--radius-');
  assert(alias.get('radius-card') === '0.375rem', 'var() aliases must resolve to their target value');

  const doc = readDocTokens('---\nrounded:\n  radius-sm: "0.375rem"\n  radius-card: "0.375rem"\n---\n', 'rounded');
  assert(compare(doc, alias, 'rounded').length === 0, 'matching sets must report no problems');

  assert(compare(new Map([['radius-sm', '1rem']]), alias, 'x').length === 2, 'a wrong value and a missing doc entry are both reported');
  assert(compare(new Map(), new Map([['radius-sm', '1rem']]), 'x').length === 1, 'an undocumented CSS token is reported');
  assert(compare(new Map([['radius-gone', '1rem']]), new Map(), 'x').length === 1, 'a documented token with no CSS is reported');

  let threw = false;
  try { readDocTokens('---\ncolors:\n---\n', 'rounded'); } catch { threw = true; }
  assert(threw, 'a missing frontmatter block must fail loudly, not silently pass');

  console.log('check-design-tokens self-test passed.');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Self-test failed: ${message}`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const markdown = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');
  const css = readFileSync(join(ROOT, 'src/styles/installer-tokens.css'), 'utf8');
  const problems = GROUPS.flatMap(({ cssPrefix, docKey }) =>
    compare(readDocTokens(markdown, docKey), readCssTokens(css, cssPrefix), docKey));

  if (problems.length) {
    console.error('DESIGN.md has drifted from src/styles/installer-tokens.css:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nUpdate DESIGN.md to match the CSS, which owns these values.');
    process.exit(1);
  }
  console.log('DESIGN.md matches the token source of truth.');
}
