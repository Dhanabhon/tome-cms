import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * A `var(--x)` with no fallback, naming a property nothing declares, is invalid at computed-value
 * time: the declaration falls back to inheriting. `--text-lg` was never a step on the scale, so
 * the theme count on the admin's page titles inherited the title's 40px and read as part of it.
 *
 * Declared means written as `--x:` anywhere under src -- a stylesheet, a component's style, an
 * inline style -- or set from a script with setProperty. A var() with a fallback is left alone:
 * it says what it wants when the property is missing. `--tw-*` is Tailwind's own, declared by
 * the CSS it generates (the prose colours, for one).
 */
const SRC = new URL('../../src/', import.meta.url);
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.(astro|css|mjs|ts|tsx)$/.test(file))
  .map((file) => ({ file, text: readFileSync(new URL(file, SRC), 'utf8') }));

const declared = new Set<string>();
for (const { text } of files) {
  for (const [, name] of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(name);
  for (const [, name] of text.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)/g)) declared.add(name);
}

test('every custom property a stylesheet reads without a fallback is declared somewhere', () => {
  const stylesheets = files.filter(({ file }) => /^(styles|themes)\/.*\.css$/.test(file));
  assert.ok(stylesheets.length > 5, 'the stylesheets were found');
  const missing = stylesheets.flatMap(({ file, text }) => [...text.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)]
    .map(([, name]) => name)
    .filter((name) => !declared.has(name) && !name.startsWith('--tw-'))
    .map((name) => `${file}: ${name}`));
  assert.deepEqual([...new Set(missing)], []);
});
