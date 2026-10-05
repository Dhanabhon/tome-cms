import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { documentTitle, getPublicSiteUrl } from '../../src/lib/seo';

test('public URLs prefer the configured canonical origin', () => {
  const previous = process.env.TOME_CMS_PUBLIC_URL;
  process.env.TOME_CMS_PUBLIC_URL = 'https://cms.example.com';
  try {
    assert.equal(getPublicSiteUrl(new Request('http://127.0.0.1:4321')).toString(), 'https://cms.example.com/');
  } finally {
    if (previous === undefined) delete process.env.TOME_CMS_PUBLIC_URL;
    else process.env.TOME_CMS_PUBLIC_URL = previous;
  }
});

test('a page title is followed by the site name, but a written meta title stands alone', () => {
  assert.equal(documentTitle({ siteName: 'Site', title: 'Site' }), 'Site');
  assert.equal(documentTitle({ siteName: 'Site', title: 'A post' }), 'A post | Site');
  assert.equal(documentTitle({ metaTitle: 'Written for search', siteName: 'Site', title: 'A post' }), 'Written for search');
  assert.equal(documentTitle({ metaTitle: '  ', siteName: 'Site', title: 'A post' }), 'A post | Site');
});

const route = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('a post and a page hand their meta title to the layout apart from their title', () => {
  for (const path of ['src/pages/[locale]/blog/[slug].astro', 'src/pages/[locale]/[slug].astro']) {
    const source = route(path);
    assert.match(source, /metaTitle=\{(post|page)\?\.meta_title\}/, path);
    assert.doesNotMatch(source, /title=\{(post|page)\?\.meta_title/, `${path} folded the meta title into the title, which the site name is then added after`);
  }
});

test("the home page names the default language's home as x-default", () => {
  assert.match(route('src/pages/[locale]/index.astro'), /xDefaultHref=\{settings \? localePath\(settings\.default_locale\) : undefined\}/);
});

test("a draft preview describes the cover as the live page does", () => {
  const preview = route('src/pages/admin/preview/[id].astro');
  assert.match(preview, /listReadyImagesByIds\(current\.user\.id, \[draft\.cover_media_id\]\)/);
  assert.match(preview, /coverImage: coverImage \?\? null/);
});

test('the layout hands the owner\'s logo and profile links to the structured data, and a post passes the links', () => {
  const layout = route('src/layouts/BaseLayout.astro');
  assert.match(layout, /organizationSchema\(siteName, siteUrl, brand\)/);
  assert.match(layout, /personSchema\(authorName, authorLinks\)/);
  assert.match(route('src/pages/[locale]/blog/[slug].astro'), /authorLinks=\{profile\?\.links\.map\(\(\{ url \}\) => url\)\}/);
});

test('structured data cannot close its script tag', () => {
  assert.match(route('src/components/blog/SEOHead.astro'), /JSON\.stringify\(structuredData\)\.replaceAll\('<', '\\\\u003c'\)/);
});
