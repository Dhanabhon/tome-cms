import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { publicCopy } from '../../src/lib/i18n';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Every public component that says a word of its own. */
const SURFACES = [
  'src/components/blog/PostArticle.astro',
  'src/components/blog/PageArticle.astro',
  'src/components/blog/AuthorBlock.astro',
  'src/components/blog/Header.astro',
  'src/components/blog/Footer.astro',
] as const;

test('every public surface speaks the reader\'s language', () => {
  for (const path of SURFACES) {
    assert.match(read(path), /publicCopy/, `${path} does not read the public copy`);
  }
  // Nothing the visitor can read or hear is left in English in the markup.
  const phrases = ['All posts', 'Draft preview', 'About the author', 'Author links',
    'aria-label="Primary"', 'aria-label="Footer"', 'All rights reserved', ">By ", '>Published ', '>Updated '];
  for (const path of SURFACES) {
    const source = read(path);
    for (const phrase of phrases) {
      assert.ok(!source.includes(phrase), `${path} still hard-codes "${phrase}"`);
    }
  }
  // And no component decides between two languages on its own.
  for (const path of SURFACES) {
    assert.doesNotMatch(read(path), /locale === 'th' \?/, `${path} branches on the locale itself`);
  }
});

test('both locales answer with the same keys, and none was left untranslated', () => {
  const th = publicCopy('th');
  const en = publicCopy('en');
  assert.deepEqual(Object.keys(th).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries(th)) {
    assert.ok(value.trim().length > 0, `th.${key} is empty`);
    assert.notEqual(value, en[key as keyof typeof en], `th.${key} was never translated`);
  }
});
