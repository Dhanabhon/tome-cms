#!/usr/bin/env node
/**
 * Proves a stylesheet refactor removed exactly what it meant to and nothing else.
 *
 * Reading the patch is not enough. Removing a dead class from a selector list by
 * deleting its line takes the declaration block with it whenever that selector was
 * the last one in the group, and the live selectors above it silently inherit the
 * next rule's declarations. That is a rendering change no reviewer sees in the diff,
 * because every line removed was genuinely dead.
 *
 * So compare the built CSS instead: every selector paired with the declarations it
 * actually ends up with, before and after.
 *
 *   npm run build && node scripts/css-selector-diff.mjs --save /tmp/before.json
 *   # ...edit stylesheets...
 *   npm run build && node scripts/css-selector-diff.mjs --diff /tmp/before.json
 *
 * The diff exits non-zero if any selector's declarations changed. Removals and
 * additions are reported for review — an intentional removal is expected to show
 * up there, a changed declaration block almost never is.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = join(ROOT, 'dist/client/_astro');

/**
 * Splits a selector list on its top-level commas.
 *
 * The commas inside :is(), :not() and :where() separate arguments, not selectors.
 * Splitting on them turns `:is(button, .a, .b)` into fragments like `.b)`, which
 * then read as a selector appearing and disappearing whenever the list is edited.
 */
export function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((one) => one.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/**
 * Maps every selector to the declarations it receives, keyed by at-rule context so a
 * rule inside `@media (prefers-color-scheme: dark)` never merges with its light twin.
 */
export function readSelectors(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Map();
  const context = [];
  let buffer = '';

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '{') {
      const prelude = buffer.trim().replace(/\s+/g, ' ');
      buffer = '';
      if (prelude.startsWith('@')) {
        context.push(prelude);
        continue;
      }
      // A plain rule: take its declarations whole, then resume after the closing brace.
      const end = clean.indexOf('}', i);
      const body = clean.slice(i + 1, end === -1 ? undefined : end).trim();
      const scope = context.length ? `${context.join(' ')} ` : '';
      for (const selector of splitSelectors(prelude)) {
        const key = `${scope}${selector}`;
        found.set(key, [...(found.get(key) ?? []), body].join(' | '));
      }
      i = end === -1 ? clean.length : end;
      continue;
    }
    if (char === '}') {
      context.pop();
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return found;
}

function readBuild() {
  let css = '';
  for (const name of readdirSync(BUILD_DIR).filter((file) => file.endsWith('.css')).sort()) {
    css += readFileSync(join(BUILD_DIR, name), 'utf8');
  }
  if (!css) throw new Error(`No CSS in ${BUILD_DIR}. Run npm run build first.`);
  return readSelectors(css);
}

export function compare(before, after) {
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const added = [...after.keys()].filter((key) => !before.has(key));
  const changed = [...before.keys()]
    .filter((key) => after.has(key) && after.get(key) !== before.get(key));
  return { added, changed, removed };
}

function selfTest() {
  const nested = readSelectors('.a, .b { color: red } @media (x) { .a { color: blue } }');
  assert(nested.get('.a') === 'color: red', 'a selector list gives each selector the same block');
  assert(nested.get('.b') === 'color: red', 'every selector in the list is recorded');
  assert(nested.get('@media (x) .a') === 'color: blue', 'at-rule context keys separately from the top level');

  assert(splitSelectors('.a, .b').length === 2, 'top-level commas split');
  assert(splitSelectors(':is(button, .a, .b)').length === 1, 'commas inside :is() do not split');
  assert(splitSelectors('.x :is(a, b), .y')[1] === '.y', 'a list around an :is() still splits correctly');

  // The failure this tool exists to catch: dropping the last selector of a group
  // leaves the survivors bound to the following rule's declarations.
  const before = readSelectors('.keep, .drop { background: teal } .next { opacity: .7 }');
  const after = readSelectors('.keep, .next { opacity: .7 }');
  const { changed, removed } = compare(before, after);
  assert(removed.includes('.drop'), 'the intended removal is reported');
  assert(changed.includes('.keep'), 'a survivor losing its declarations is reported as changed');

  const identical = compare(before, readSelectors('.keep, .drop { background: teal } .next { opacity: .7 }'));
  assert(identical.added.length + identical.changed.length + identical.removed.length === 0, 'an unchanged build reports nothing');
  console.log('css-selector-diff self-test passed.');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Self-test failed: ${message}`);
}

const [mode, file] = process.argv.slice(2);
if (mode === '--self-test') {
  selfTest();
} else if (mode === '--save' && file) {
  const map = readBuild();
  writeFileSync(file, JSON.stringify([...map], null, 2));
  console.log(`Saved ${map.size} selectors to ${file}.`);
} else if (mode === '--diff' && file) {
  const before = new Map(JSON.parse(readFileSync(file, 'utf8')));
  const { added, changed, removed } = compare(before, readBuild());
  console.log(`removed ${removed.length} · added ${added.length} · declarations changed ${changed.length}`);
  for (const key of removed) console.log(`  - ${key}`);
  for (const key of added) console.log(`  + ${key}`);
  for (const key of changed) console.log(`  ~ ${key}`);
  if (changed.length) {
    console.error('\nA surviving selector\'s declarations changed. Removing a dead selector should never do that.');
    process.exit(1);
  }
} else {
  console.error('Usage: css-selector-diff.mjs --save <file> | --diff <file> | --self-test');
  process.exit(2);
}
