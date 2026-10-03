import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { thaiDeclarations } from '../helpers/css';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Paper paints its page white and its header cream, as the admin does', () => {
  const shell = read('src/themes/paper/Shell.astro');
  assert.match(shell, /<body class="paper flex min-h-screen flex-col">/);
  const css = read('src/themes/paper/theme.css');
  assert.match(css, /html:has\(> body\.paper\),\s*body\.paper \{ background: var\(--color-paper\); \}/);
  assert.match(css, /\.site-header \{ background: var\(--color-paper-2\); \}/);
  // The sticky variant keeps the header cream too, rather than painting it white.
  assert.doesNotMatch(css, /\.site-header\[data-sticky\] \{[^}]*background: var\(--color-paper\);/);
});

test("the shared html and body rule still paints the cream other themes rely on", () => {
  const css = read('src/styles/global.css');
  assert.match(css, /\nhtml \{\s*overflow-x: clip;\s*background: var\(--color-paper-2\);\s*\}/);
  assert.match(css, /\nbody \{\s*overflow-x: clip;\s*margin: 0;\s*background: var\(--color-paper-2\);/);
});

test("Paper's search field shows one focus line: its own border, not the site-wide outline as well", () => {
  const css = read('src/themes/paper/theme.css');
  const rule = /\.post-search input:focus-visible \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /outline: 2px solid transparent;/, 'no visible outer ring, but one forced-colors can paint');
  assert.match(rule, /border-color: var\(--color-accent\);/);
  // The border alone is one hairline; the inset line doubles it without moving the text.
  assert.match(rule, /box-shadow: inset 0 0 0 var\(--rule-hair\) var\(--color-accent\);/);
  // The button inside the field keeps the site-wide ring it has always had.
  assert.doesNotMatch(css, /\.post-search__submit:focus-visible \{[^}]*outline: (none|2px solid transparent)/);
  // It draws the site-wide ring, which is still there to draw.
  assert.match(read('src/styles/global.css'), /\n:focus-visible \{\s*outline: 2px solid var\(--color-focus\);/);
});

test("a card's meta line clips at its words, so the separator before a wrapped line stays hidden", () => {
  const css = read('src/themes/paper/theme.css');
  const meta = /\n\.post-card__meta \{([^}]*)\}/.exec(css)?.[1] ?? '';
  // overflow clips at the padding box: with the inset as padding, the dot hung into it and showed.
  assert.match(meta, /overflow-x: clip;/);
  assert.match(meta, /padding: var\(--space-sm\) 0 var\(--space-md\);/);
  assert.match(meta, /margin-inline: var\(--space-md\);/);
});

test('Thai display type in Paper is not tracked in, and a menu group is not set in capitals', () => {
  const css = read('src/themes/paper/theme.css');
  for (const target of ['.hero-title', '.card-title', '.site-wordmark']) {
    assert.match(thaiDeclarations(css, target), /letter-spacing: 0/, `${target} keeps its tracking in Thai`);
  }
  assert.match(thaiDeclarations(read('src/styles/global.css'), '.article-title'), /letter-spacing: 0/);
  assert.match(thaiDeclarations(css, '.public-navigation__group'), /letter-spacing: 0; text-transform: none/);
  // Latin keeps today's values.
  assert.match(css, /\.hero-title \{[^}]*letter-spacing: -1\.875px;/);
  assert.match(css, /\.public-navigation__group \{[^}]*letter-spacing: 0\.04em; text-transform: uppercase;/);
});
