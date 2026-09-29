import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const declared = (css: string) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, name]) => name));

test('a theme only reads custom properties that are declared somewhere', () => {
  // An undeclared one makes its declaration invalid, and the text silently falls back to the
  // inherited colour: Plain drew its muted lines in full ink for weeks that way.
  const shared = new Set([...declared(read('src/styles/installer-tokens.css')), ...declared(read('src/styles/global.css'))]);
  const themes = readdirSync(new URL('../../src/themes/', import.meta.url), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.ok(themes.length >= 2);
  for (const { name } of themes) {
    const css = read(`src/themes/${name}/theme.css`);
    const own = declared(css);
    for (const [, used, fallback] of css.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/g)) {
      // A fallback covers an absent one, and `--tw-` names are declared by Tailwind's plugins on
      // their own classes (`.prose` sets the typography ones), in CSS this test does not read.
      if (fallback || used.startsWith('--tw-')) continue;
      assert.ok(shared.has(used) || own.has(used), `${name}/theme.css reads ${used}, which nothing declares`);
    }
  }
});
