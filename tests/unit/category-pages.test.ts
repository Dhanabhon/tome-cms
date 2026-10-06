import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { categoryHref, categoryPath, categoryRedirect, slugFromParam } from '../../src/lib/i18n';
import { listOf } from '../../src/lib/post-feed';
import { breadcrumbList, categoryDescription } from '../../src/lib/seo';
import { categorySitemapEntries } from '../../src/lib/xml';
import { isBundledFrontendPath, maintenanceRoute } from '../../src/middleware';
import { pageCacheKey } from '../../src/server/http/page-cache';
import { listHref } from '../../src/themes/list-href';
import type { PostCategoryBadge } from '../../src/types/cms';

const THAI = 'ขนมปัง';
const ENCODED_THAI = encodeURIComponent(THAI);
const badge = (name: string, slug: string, is_default = false): PostCategoryBadge => ({ id: `id-${slug}`, is_default, name, slug });

test('a category page lives at /<locale>/category/<slug>, the slug encoded once', () => {
  assert.equal(categoryPath('en', 'field-notes'), '/en/category/field-notes');
  assert.equal(categoryPath('th', THAI), `/th/category/${ENCODED_THAI}`);
  assert.equal(categoryPath('th', `${THAI}-2`), `/th/category/${ENCODED_THAI}-2`);
  assert.doesNotMatch(categoryPath('th', THAI), /%25/, 'never encoded twice');
});

test('a chip goes to its category\'s page; the default category has none, so its chip keeps the filtered home', () => {
  assert.equal(categoryHref('en', badge('Field Notes', 'field-notes')), '/en/category/field-notes');
  assert.equal(categoryHref('th', badge(THAI, THAI)), `/th/category/${ENCODED_THAI}`);
  assert.equal(categoryHref('en', badge('Uncategorized', 'uncategorized', true)), '/en?category=Uncategorized');
});

test('the slug in a page\'s address is read decoded and in NFC, and one that cannot be read is none', () => {
  assert.equal(slugFromParam('field-notes'), 'field-notes');
  assert.equal(slugFromParam(THAI), THAI, 'already decoded');
  assert.equal(slugFromParam(ENCODED_THAI), THAI, 'still encoded');
  // An é typed as e and its combining accent is the one character the database holds.
  assert.equal(slugFromParam('café'), 'café');
  assert.equal(slugFromParam(encodeURIComponent('café')), 'café');
  assert.equal(slugFromParam('%E0%B8'), null, 'a broken escape');
  assert.equal(slugFromParam(''), null);
  assert.equal(slugFromParam(undefined), null);
});

test('an old ?category= address moves to the page only when that page has posts in the language', () => {
  const live = [badge('Uncategorized', 'uncategorized', true), badge('Field Notes', 'field-notes'), badge(THAI, THAI)];
  assert.equal(categoryRedirect('en', 'Field Notes', live), '/en/category/field-notes');
  assert.equal(categoryRedirect('en', '  field NOTES ', live), '/en/category/field-notes', 'case-blind and trimmed, as the list matches');
  assert.equal(categoryRedirect('th', THAI, live), `/th/category/${ENCODED_THAI}`);
  assert.equal(categoryRedirect('en', 'Uncategorized', live), null, 'the default category has no page');
  assert.equal(categoryRedirect('en', 'Recipes', live), null, 'not live in this language, or unknown: the home as before');
  assert.equal(categoryRedirect('en', undefined, live), null);
  assert.equal(categoryRedirect('en', '', live), null);
});

test('a category\'s description is its own language\'s, then the other\'s, then a line made from its name', () => {
  const both = { description_en: 'Notes from the field.', description_th: 'บันทึกภาคสนาม', name: 'Field Notes' };
  assert.equal(categoryDescription({ category: both, locale: 'en', siteName: 'Site' }), 'Notes from the field.');
  assert.equal(categoryDescription({ category: both, locale: 'th', siteName: 'Site' }), 'บันทึกภาคสนาม');
  assert.equal(categoryDescription({ category: { ...both, description_en: '  ' }, locale: 'en', siteName: 'Site' }), 'บันทึกภาคสนาม');
  const none = { description_en: '', description_th: '', name: 'Field Notes' };
  assert.equal(categoryDescription({ category: none, locale: 'en', siteName: 'Site' }), 'Posts in Field Notes from Site.');
  assert.equal(categoryDescription({ category: none, locale: 'th', siteName: 'Site' }), 'บทความในหมวด Field Notes จาก Site');
  assert.equal(categoryDescription({ category: { ...none, name: '$& $\'' }, locale: 'en', siteName: '$1' }), 'Posts in $& $\' from $1.', 'names are text');
});

test('breadcrumbs: a category page is Home › Category; a post goes through its category; a page is unchanged', () => {
  const home = { '@type': 'ListItem', item: 'https://example.com/th', name: 'Site', position: 1 };
  const category = { name: 'Field Notes', url: 'https://example.com/th/category/field-notes' };
  const base = { homeName: 'Site', homeUrl: 'https://example.com/th', robots: 'index, follow' };
  const items = (value: Record<string, unknown> | undefined) => value?.itemListElement;

  assert.deepEqual(items(breadcrumbList({ ...base, category, name: 'Field Notes', type: 'website', url: category.url })), [
    home,
    { '@type': 'ListItem', item: category.url, name: 'Field Notes', position: 2 },
  ]);
  const post = { name: 'A post', url: 'https://example.com/th/blog/a-post' };
  assert.deepEqual(items(breadcrumbList({ ...base, category, ...post, type: 'article' })), [
    home,
    { '@type': 'ListItem', item: category.url, name: 'Field Notes', position: 2 },
    { '@type': 'ListItem', item: post.url, name: 'A post', position: 3 },
  ]);
  assert.deepEqual(items(breadcrumbList({ ...base, ...post, type: 'article' })), [
    home,
    { '@type': 'ListItem', item: post.url, name: 'A post', position: 2 },
  ], 'a post with no category of its own goes straight home');
  assert.deepEqual(items(breadcrumbList({ ...base, category, name: 'About', type: 'page', url: 'https://example.com/th/about' })), [
    home,
    { '@type': 'ListItem', item: 'https://example.com/th/about', name: 'About', position: 2 },
  ], 'a page has no category');
  assert.equal(breadcrumbList({ ...base, name: 'Site', type: 'website', url: 'https://example.com/th' }), undefined, 'the home page');
  assert.equal(breadcrumbList({ ...base, category, name: 'Field Notes', robots: 'noindex, nofollow', type: 'website', url: category.url }), undefined,
    'a site kept out of search results gives none');
});

test('the sitemap lists each category page with live posts, per language, never the default', () => {
  const siteUrl = new URL('https://example.com/');
  const at = new Date('2026-10-01T00:00:00.000Z');
  const entries = categorySitemapEntries(siteUrl, [
    { locale: 'th', items: [badge('Uncategorized', 'uncategorized', true), badge(THAI, THAI)], modified: new Map([[`id-${THAI}`, at]]) },
    { locale: 'en', items: [badge('Field Notes', 'field-notes')], modified: new Map() },
  ]);
  assert.deepEqual(entries, [
    { lastModified: '2026-10-01T00:00:00.000Z', location: `https://example.com/th/category/${ENCODED_THAI}` },
    { location: 'https://example.com/en/category/field-notes' },
  ]);
});

test('a category page is a public page: cached by its path and cursor, closed for maintenance, marked when hidden', () => {
  const url = (path: string) => new URL(path, 'https://cms.example.com');
  assert.equal(pageCacheKey(url('/th/category/field-notes')), '/th/category/field-notes');
  assert.equal(pageCacheKey(url(`/th/category/${ENCODED_THAI}`)), `/th/category/${ENCODED_THAI}`);
  assert.equal(pageCacheKey(url('/en/category/a?cursor=x&category=y&utm=z')), '/en/category/a?cursor=x', 'only the cursor is read there');
  assert.equal(pageCacheKey(url('/en/category/a?q=x')), null);
  assert.equal(pageCacheKey(url('/en/category')), '/en/category', 'one segment is a page address, as before');
  assert.equal(pageCacheKey(url('/en/category/a/b')), null);
  for (const path of ['/th/category/field-notes', `/th/category/${ENCODED_THAI}`]) {
    assert.equal(isBundledFrontendPath(path), true, path);
    assert.equal(maintenanceRoute(path), 'page', path);
  }
  assert.equal(isBundledFrontendPath('/th/category/a/b'), false);
});

test('a pill and an address name the same list, by path and by the old filter', () => {
  const at = (path: string) => listOf(new URL(path, 'https://blog.test'));
  assert.equal(at('/th'), at('/th/'));
  assert.equal(at('/th'), at('/th?q=x'), 'a search is the home list');
  assert.equal(at('/th?category=Design'), at('/th?category=+DESIGN+&cursor=abc'));
  assert.notEqual(at('/th?category=Design'), at('/th'));
  assert.equal(at(`/th/category/${ENCODED_THAI}`), at(`/th/category/${ENCODED_THAI.toLowerCase()}`), 'however the escapes are written');
  assert.equal(at(`/th/category/${ENCODED_THAI}?cursor=abc`), at(`/th/category/${ENCODED_THAI}`));
  assert.notEqual(at('/th/category/a'), at('/th/category/b'));
});

test('the routes hand a category to the layout, and chips link with categoryHref', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  assert.match(read('src/layouts/BaseLayout.astro'), /breadcrumbList\(\{[^}]*category/);
  assert.match(read('src/pages/[locale]/blog/[slug].astro'), /is_default/);
  for (const path of ['src/themes/paper/Home.astro', 'src/themes/plain/Home.astro', 'src/themes/almanac/parts/CategoryRow.astro',
    'src/themes/almanac/Post.astro', 'src/themes/paper/parts/PostArticle.astro', 'src/themes/plain/Post.astro']) {
    const source = read(path);
    assert.match(source, /categoryHref\(/, path);
    assert.doesNotMatch(source, /new URLSearchParams\(\{ category: /, `${path} still builds the old ?category= link`);
  }
});

test('a list\'s later pages hang off its own address: the home keeps its filter and search, a category\'s page needs neither', () => {
  const page = { description: '', name: THAI, path: `/th/category/${ENCODED_THAI}` };
  assert.equal(listHref('/th', { activeCategory: undefined, query: undefined }), '/th');
  assert.equal(listHref('/th', { activeCategory: undefined, query: undefined }, 'c1'), '/th?cursor=c1');
  assert.equal(listHref('/th', { activeCategory: 'Uncategorized', query: 'x y' }, 'c1'), '/th?category=Uncategorized&q=x+y&cursor=c1');
  assert.equal(listHref('/th', { activeCategory: THAI, category: page, query: undefined }), `/th/category/${ENCODED_THAI}`);
  assert.equal(listHref('/th', { activeCategory: THAI, category: page, query: undefined }, 'c1'), `/th/category/${ENCODED_THAI}?cursor=c1`);
});
