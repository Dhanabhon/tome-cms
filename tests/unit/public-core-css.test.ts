import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cssRules, thaiDeclarations } from '../helpers/css';

/**
 * What the core draws on every public page, whatever the theme: the notice band, the popup, an
 * article's file and video, a code block, and the prose a theme borrows from the typography plugin.
 */
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PUBLIC = /\.site-notice|\.site-popup|\.file-card|\.tome-video|\.notice-|\.prose|\.article-title/;

test('every public hover in the core waits for a pointer that can hover, so a tap leaves nothing lit', () => {
  const rules = [
    ...cssRules(read('src/styles/global.css')).filter(({ selector }) => PUBLIC.test(selector)).map((rule) => ({ file: 'global.css', ...rule })),
    ...cssRules(read('src/styles/code.css')).map((rule) => ({ file: 'code.css', ...rule })),
  ];
  const stuck = rules
    .filter(({ selector, context }) => selector.includes(':hover') && !context.some((at) => /^@media[^{]*\(hover: hover\)/.test(at)))
    .map(({ file, selector }) => `${file}: ${selector}`);
  assert.deepEqual(stuck, []);
});

test('inline code in a prose theme is not wrapped in the backticks the typography plugin draws', () => {
  const config = read('tailwind.config.mjs');
  assert.match(config, /'code::before': \{ content: 'none' \}/);
  assert.match(config, /'code::after': \{ content: 'none' \}/);
});

test('a Thai heading in prose is not tracked in', () => {
  assert.match(thaiDeclarations(read('src/styles/global.css'), '.prose :is(h2, h3)'), /letter-spacing: 0/);
});
