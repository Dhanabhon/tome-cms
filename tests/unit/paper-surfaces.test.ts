import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
