import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { publicCopy } from '../../src/lib/i18n';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CSS = read('src/styles/global.css');
const POST = read('src/components/blog/PostArticle.astro');
const PAGE = read('src/components/blog/PageArticle.astro');
const AUTHOR = read('src/components/blog/AuthorBlock.astro');

/** The declarations of the first unindented rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('an article stands in a named frame, not a row of utilities', () => {
  // The article was the last page written in utility classes; the measure is unchanged.
  assert.doesNotMatch(POST, /mx-auto max-w-3xl/);
  assert.doesNotMatch(PAGE, /mx-auto max-w-3xl/);
  assert.match(POST, /class="post-page"/);
  assert.match(ruleBody('.post-page'), /width: min\(100%, 48rem\)/);
  // The head ends where the body begins, the way every other head in the product does.
  assert.match(ruleBody('.post-head'), /border-block-end: var\(--rule-hair\) solid var\(--color-rule\)/);
  assert.equal(ruleBody('.post-cover').match(/border-radius: var\(--radius-lg\)/)?.length, 1);
});

test('the article draws its marks and shares the chip', () => {
  assert.match(POST, /<Icon name="arrowLeft" \/>/);
  assert.match(POST, /<Icon name="clock" \/>/);
  assert.doesNotMatch(POST, /aria-hidden="true">←/);
  // One rule draws a category chip, wherever it appears.
  assert.match(CSS, /\.category-default,\n\.post-categories > li,\n\.admin-story-categories > li \{/);
});

test('the article speaks the reader\'s language', () => {
  for (const [source, name] of [[POST, 'PostArticle'], [PAGE, 'PageArticle'], [AUTHOR, 'AuthorBlock']] as const) {
    assert.match(source, /publicCopy/, `${name} does not read the public copy`);
  }
  // No English left hard-coded in the markup these three render.
  for (const phrase of ['All posts', 'Draft preview', 'About the author', 'Author links', '>By ', '>Published ', '>Updated ']) {
    for (const [source, name] of [[POST, 'PostArticle'], [PAGE, 'PageArticle'], [AUTHOR, 'AuthorBlock']] as const) {
      assert.ok(!source.includes(phrase), `${name} still hard-codes "${phrase}"`);
    }
  }
  // Both locales answer with the same keys, or a Thai page falls back to nothing.
  assert.deepEqual(Object.keys(publicCopy('th')).sort(), Object.keys(publicCopy('en')).sort());
  for (const [key, value] of Object.entries(publicCopy('th'))) {
    assert.ok(value.trim().length > 0, `th.${key} is empty`);
    assert.notEqual(value, publicCopy('en')[key as keyof ReturnType<typeof publicCopy>], `th.${key} was never translated`);
  }
});
