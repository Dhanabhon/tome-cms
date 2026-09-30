import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test("Paper's credit is its own paragraph at the right, with no separator", () => {
  const footer = read('src/themes/paper/parts/Footer.astro');
  assert.match(footer, /<p class="site-footer__credit">\{creditBefore\}<a /);
  assert.doesNotMatch(footer, /aria-hidden="true"> · </);
  const css = read('src/themes/paper/theme.css');
  assert.match(css, /\.site-footer__credit \{ margin-inline-start: auto; \}/);
  assert.match(css, /@media \(max-width: 39\.999rem\)/);
  assert.match(css, /\.site-footer__credit \{ margin-inline-start: 0; \}/);
});

test("Paper's footer links the site name home and the word TomeCMS to the repository", () => {
  const footer = read('src/themes/paper/parts/Footer.astro');
  // The site name goes home in the page's own language.
  assert.match(footer, /<a href=\{localePath\(locale\)\}>\{siteName\}<\/a>/);
  // Only the product's name goes out, in a new tab, named as one for a screen reader.
  assert.match(footer, /<a href=\{OFFICIAL_REPOSITORY_URL\} rel="noopener noreferrer" target="_blank">TomeCMS<span class="sr-only"> \{copy\.opensInNewTab\}<\/span><\/a>\{creditAfter\}/);
  assert.doesNotMatch(footer, /github\.com/, 'the address is one constant, not written here');
  const css = read('src/themes/paper/theme.css');
  assert.match(css, /\.site-footer p a \{ color: inherit; text-decoration: none; \}/, 'the footer text colour, plain');
  assert.match(css, /\.site-footer p a:hover \{ text-decoration: underline;/, 'underlined on hover');
});
