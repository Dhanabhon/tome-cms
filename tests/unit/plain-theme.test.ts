import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { leadsWith } from '../../src/themes/plain/lead';

const read = (path: string) => readFileSync(new URL(`../../src/themes/plain/${path}`, import.meta.url), 'utf8');
const css = read('theme.css');

test('the newest post leads only on the first page of an unsearched list', () => {
  assert.equal(leadsWith({ cursor: undefined, posts: 3, query: undefined }), true);
  assert.equal(leadsWith({ cursor: undefined, posts: 1, query: undefined }), true);
  assert.equal(leadsWith({ cursor: 'abc', posts: 3, query: undefined }), false, 'a later page has no lead');
  assert.equal(leadsWith({ cursor: undefined, posts: 3, query: 'compost' }), false, 'results are not a front page');
  assert.equal(leadsWith({ cursor: undefined, posts: 0, query: undefined }), false, 'nothing to lead with');
});

test('the home page draws the lead, and a category filter does not stop it', () => {
  const home = read('Home.astro');
  assert.match(home, /leadsWith\(\{ cursor, posts: posts\.length, query \}\)/);
  assert.match(home, /<article class="plain-lead">/);
  assert.match(home, /<ol class="plain-grid">/);
  assert.doesNotMatch(home, /activeCategory[^\n]*leadsWith|leadsWith[^\n]*activeCategory/);
});

test('search is one field with the magnifier inside it as the submit, and no text button', () => {
  const home = read('Home.astro');
  assert.match(home, /<button class="plain-search__submit" type="submit" aria-label=\{copy\.search\} title=\{copy\.search\}><Icon name="search" \/><\/button>/);
  assert.doesNotMatch(home, /\{copy\.search\}<\/button>/);
  assert.doesNotMatch(css, /wrap-reverse/);
});

test('the header, the page and the footer share one frame of 80rem with the gutter Paper uses', () => {
  assert.match(css, /--plain-frame: min\(100% - 2 \* var\(--plain-gutter\), 80rem - 2 \* var\(--plain-gutter\)\)/);
  assert.match(css, /--plain-gutter: 1\.25rem/);
  assert.match(css, /@media \(min-width: 40rem\) \{[^}]*--plain-gutter: 1\.75rem/);
  assert.match(css, /\.plain-head,\s*\.plain-foot,\s*\.plain-page \{[^}]*width: var\(--plain-frame\)/);
});

test('an article keeps its 44rem column inside the frame', () => {
  assert.match(css, /\.plain-article \{[^}]*width: min\(var\(--plain-frame\), 44rem\)/);
});

test("an article's and a page's title is as bold as the home page's lead", () => {
  const weight = (selector: string) => css.match(new RegExp(`${selector} \\{[^}]*font-weight: (\\d+)`))?.[1];
  assert.equal(weight('\\.plain-lead h2'), '700');
  assert.equal(weight('\\.plain-article h1'), weight('\\.plain-lead h2'));
});

test('the grid is one column, two from 40rem and three from 64rem, each item under a hairline', () => {
  assert.match(css, /\.plain-grid \{[^}]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(min-width: 40rem\) \{[^}]*\.plain-grid \{ grid-template-columns: repeat\(2, 1fr\)/);
  assert.match(css, /@media \(min-width: 64rem\) \{[^}]*\.plain-grid \{ grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(css, /\.plain-grid > li \{[^}]*border-block-start: var\(--rule-hair\) solid var\(--color-rule\)/);
  assert.match(css, /-webkit-line-clamp: 3;\s*line-clamp: 3;/);
});

test('the active tab is ink with a 2px link bar', () => {
  assert.match(css, /\.plain-filter a\[aria-current="page"\] \{[^}]*font-weight: 600[^}]*border-block-end-color: var\(--color-link\)/);
  assert.match(css, /border-block-end: 2px solid transparent/);
});

test('search is first on a phone in sight and in tab order: it comes before the tabs in the page, and goes to the row\'s end on a wide screen', () => {
  const home = read('Home.astro');
  assert.ok(home.indexOf('<form class="plain-search"') < home.indexOf('<nav class="plain-filter"'), 'the form is before the tabs in the source');
  assert.doesNotMatch(css, /order: -1/, 'nothing is drawn out of its source order');
  assert.match(css, /\.plain-search \{[^}]*order: 1/, 'wide: the field sits after the tabs');
  assert.match(css, /@media \(max-width: 39\.999rem\) \{[^}]*\.plain-search \{[^}]*order: 0; flex-basis: 100%/, 'phone: back in source order, on its own row');
});

test("the footer's credit is its own paragraph at the right, and wraps under the copyright on a phone", () => {
  const shell = read('Shell.astro');
  // Plain says it in plain text: the word Paper links is just the name here.
  assert.match(shell, /<p class="plain-foot__credit">\{poweredByText\(copy\)\}<\/p>/);
  assert.doesNotMatch(shell, /\$\{copy\.poweredBy\}|` \$\{copy/);
  assert.match(css, /\.plain-foot__credit \{ margin-inline-start: auto; \}/);
  assert.match(css, /@media \(max-width: 39\.999rem\) \{[^}]*\.plain-foot__credit \{ flex-basis: 100%; margin-inline-start: 0; \}/);
});

test('the file headers no longer say one column', () => {
  for (const file of ['Shell.astro', 'theme.css', 'index.ts', 'theme.ts']) {
    assert.doesNotMatch(read(file), /one column/i, `${file} describes the old shape`);
  }
});

test("Plain's search field shows one focus line, as Paper's does, and its button keeps its ring", () => {
  const rule = /\.plain-search input:focus-visible \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /outline: 2px solid transparent;/, 'no visible outer ring, but one forced-colors can paint');
  assert.match(rule, /border-color: var\(--color-accent\);/);
  assert.match(rule, /box-shadow: inset 0 0 0 var\(--rule-hair\) var\(--color-accent\);/);
  assert.match(css, /\.plain-search__submit:focus-visible \{ outline: 2px solid var\(--color-focus\);/);
});
