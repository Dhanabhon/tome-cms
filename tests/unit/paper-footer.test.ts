import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test("Paper's credit is its own paragraph at the right, with no separator", () => {
  const footer = read('src/themes/paper/parts/Footer.astro');
  assert.match(footer, /<p class="site-footer__credit">\{copy\.poweredBy\}<\/p>/);
  assert.doesNotMatch(footer, /aria-hidden="true"> · </);
  const css = read('src/themes/paper/theme.css');
  assert.match(css, /\.site-footer__credit \{ margin-inline-start: auto; \}/);
  assert.match(css, /@media \(max-width: 39\.999rem\)/);
  assert.match(css, /\.site-footer__credit \{ margin-inline-start: 0; \}/);
});
