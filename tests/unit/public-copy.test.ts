import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { currentYear, poweredByText, publicCopy } from '../../src/lib/i18n';
import { OFFICIAL_REPOSITORY_URL } from '../../src/update/contracts';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Every public component that says a word of its own. */
const SURFACES = [
  'src/themes/paper/parts/PostArticle.astro',
  'src/themes/paper/parts/PageArticle.astro',
  'src/themes/paper/parts/AuthorBlock.astro',
  'src/themes/paper/parts/Header.astro',
  'src/themes/paper/parts/Footer.astro',
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

test('the year in the footer is the year in the article', () => {
  // A Thai page showed "© 2026" under a date reading "19 กันยายน 2569": one page, two
  // calendars. The era prefix Intl returns for a Thai year is dropped, because a date
  // elsewhere on the page renders its year bare.
  const now = new Date('2026-09-19T12:00:00Z');
  assert.equal(currentYear('en', now), '2026');
  assert.equal(currentYear('th', now), '2569');
  assert.doesNotMatch(read('src/themes/paper/parts/Footer.astro'), /getFullYear/);
});

test('the footer credits TomeCMS, and stops when the owner says so', () => {
  const footer = read('src/themes/paper/parts/Footer.astro');
  // Its own paragraph, shown only when the owner has not switched it off (paper-footer.test.ts covers where it sits).
  assert.match(footer, /\{showPoweredBy && <p class="site-footer__credit">\{creditBefore\}<a href=\{OFFICIAL_REPOSITORY_URL\} rel="noopener noreferrer" target="_blank">TomeCMS/);
  assert.equal(publicCopy('en').poweredBy, 'Powered by {tomecms}');
  assert.equal(publicCopy('th').poweredBy, 'ขับเคลื่อนด้วย {tomecms}');
  // The product's name is a name in both languages; only the verb is translated. It is the one word linked.
  assert.equal(poweredByText(publicCopy('en')), 'Powered by TomeCMS');
  assert.equal(poweredByText(publicCopy('th')), 'ขับเคลื่อนด้วย TomeCMS');
  assert.deepEqual(publicCopy('en').poweredBy.split('{tomecms}'), ['Powered by ', '']);
  assert.equal(OFFICIAL_REPOSITORY_URL, 'https://github.com/Dhanabhon/tome-cms');
  // The setting is read in core and travels through the theme's shell, which is what
  // renders the footer now: both hand-offs have to hold or the line is always shown.
  const layout = read('src/layouts/BaseLayout.astro');
  assert.match(layout, /const showPoweredBy = settings\?\.show_powered_by \?\? true;/);
  assert.match(layout, /<activeTheme\.Shell[\s\S]*?showPoweredBy=\{showPoweredBy\}/);
  assert.match(read('src/themes/paper/Shell.astro'), /<Footer[^>]*showPoweredBy=\{showPoweredBy\}/);
});

test('a site that has not written a tagline is given one', () => {
  // The line under the site name is the first thing a reader meets, and an installation
  // that skipped the field on the way in should not meet them with a gap.
  assert.equal(publicCopy('en').defaultTagline, 'Collected in TomeCMS. Ready for the world to see.');
  assert.equal(publicCopy('th').defaultTagline, 'รวมทุกความคิดไว้ใน TomeCMS พร้อมให้โลกได้อ่าน');
  // Applied in the route, so both themes are given a line rather than each deciding.
  const home = read('src/pages/[locale]/index.astro');
  assert.match(home, /tagline=\{settings\?\.tagline\?\.trim\(\) \|\| publicCopy\(locale\)\.defaultTagline\}/);
  assert.match(read('src/themes/contract.ts'), /tagline: string;/);
});

test('a missing or unavailable page or post says so in the reader\'s language', () => {
  const keys = ['pageNotFound', 'pageUnavailable', 'postNotFound', 'postUnavailable', 'returnToAllPosts', 'unavailable'] as const;
  for (const locale of ['en', 'th'] as const) {
    const copy = publicCopy(locale);
    for (const key of keys) assert.ok(copy[key]?.trim(), `${locale}.${key} is missing`);
  }
  const pages = ['src/pages/[locale]/[slug].astro', 'src/pages/[locale]/blog/[slug].astro', 'src/pages/blog/[slug].astro'];
  for (const path of pages) {
    const source = read(path);
    assert.match(source, /publicCopy\(/, `${path} does not read the public copy`);
    for (const phrase of [/'(Page|Post) not found/, /'Unavailable'/, /temporarily unavailable/, />Return to all posts</]) {
      assert.doesNotMatch(source, phrase, `${path} still hard-codes ${phrase}`);
    }
    // The figure is the same in every language, and stays.
    assert.match(source, />\{loadError \? copy\.unavailable : '404'\}</, `${path} lost its 404 figure`);
  }
});
