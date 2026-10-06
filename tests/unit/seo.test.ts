import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { breadcrumbList, DEFAULT_SITE_DESCRIPTION, documentTitle, getPublicSiteUrl, openGraphImage, siteDescriptionFor } from '../../src/lib/seo';

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
  // The cover comes with the rest of what the public page is given: enrichPosts looks it up.
  assert.match(preview, /draftPreviewPost\(current\.user\.id, draft\)/);
  assert.match(route('src/server/content/previews.ts'), /enrichPosts\(ownerId, \[post\]\)/);
});

test('the layout hands the owner\'s logo and profile links to the structured data, and a post passes the links', () => {
  const layout = route('src/layouts/BaseLayout.astro');
  assert.match(layout, /organizationSchema\(siteName, siteUrl, brand\)/);
  assert.match(layout, /personSchema\(authorName, authorLinks\)/);
  assert.match(route('src/pages/[locale]/blog/[slug].astro'), /authorLinks=\{profile\?\.links\.map\(\(\{ url \}\) => url\)\}/);
});

test('structured data cannot close its script tag', () => {
  assert.match(route('src/components/blog/SEOHead.astro'), /JSON\.stringify\(item\)\.replaceAll\('<', '\\\\u003c'\)/);
});

test('a post and a page carry the way back to their language\'s home page', () => {
  const crumbs = (type: 'article' | 'page' | 'website', robots = 'index, follow') => breadcrumbList({
    homeName: 'Site', homeUrl: 'https://example.com/th', name: 'บทความ', robots, type, url: 'https://example.com/th/blog/a-post',
  });
  const expected = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', item: 'https://example.com/th', name: 'Site', position: 1 },
      { '@type': 'ListItem', item: 'https://example.com/th/blog/a-post', name: 'บทความ', position: 2 },
    ],
  };
  assert.deepEqual(crumbs('article'), expected);
  assert.deepEqual(crumbs('page'), expected);
  assert.equal(crumbs('website'), undefined, 'the home page is where the trail starts, and a missing page has none');
  assert.equal(crumbs('article', 'noindex, nofollow'), undefined, 'a site kept out of search results gives no structured data');
});

test('the layout hands the breadcrumbs to the head beside the page\'s own structured data', () => {
  const layout = route('src/layouts/BaseLayout.astro');
  assert.match(layout, /breadcrumbList\(\{/);
  assert.match(layout, /homeUrl: new URL\(localePath\(locale\), siteUrl\)\.toString\(\)/);
});

test('a shared page shows its own cover, then the site\'s share image, then nothing', () => {
  const siteUrl = new URL('https://example.com/');
  const share = { height: 630, mimeType: 'image/jpeg' as const, url: 'https://media.example.com/owners/o/share.jpg', width: 1200 };
  assert.deepEqual(
    openGraphImage({ cover: '/media/cover-id', coverAlt: 'A post', share, siteName: 'Site', siteUrl }),
    { alt: 'A post', url: 'https://example.com/media/cover-id' },
    'a cover wins, and its size is not claimed when it is not known',
  );
  assert.deepEqual(
    openGraphImage({ cover: null, coverAlt: 'A page', share, siteName: 'Site', siteUrl }),
    { alt: 'Site', height: 630, url: share.url, width: 1200 },
    'without a cover the share image stands in, named for the site',
  );
  assert.equal(openGraphImage({ cover: undefined, coverAlt: 'Home', share: null, siteName: 'Site', siteUrl }), null);
});

test('each language has its own site description, and borrows the other\'s before the built-in line', () => {
  const both = { site_description_en: 'Notes on work.', site_description_th: 'บันทึกเรื่องงาน' };
  assert.equal(siteDescriptionFor(both, 'th'), 'บันทึกเรื่องงาน');
  assert.equal(siteDescriptionFor(both, 'en'), 'Notes on work.');
  assert.equal(siteDescriptionFor({ ...both, site_description_en: '  ' }, 'en'), 'บันทึกเรื่องงาน', 'an empty one uses the other language\'s');
  assert.equal(siteDescriptionFor({ site_description_en: '', site_description_th: '' }, 'th'), DEFAULT_SITE_DESCRIPTION);
  assert.equal(siteDescriptionFor(null, 'en'), DEFAULT_SITE_DESCRIPTION, 'a site whose settings could not be read');
  assert.equal(siteDescriptionFor(null, 'en', 'Read the latest.'), 'Read the latest.', 'a caller may name its own last resort');
  assert.equal(DEFAULT_SITE_DESCRIPTION, 'A quiet place for thoughtful notes on design, software, and the work between.');
});

test('the home page, a post, a page, the layout and the feed read the description of their own language', () => {
  assert.match(route('src/pages/[locale]/index.astro'), /siteDescriptionFor\(settings, locale\)/);
  assert.match(route('src/pages/[locale]/blog/[slug].astro'), /siteDescriptionFor\(settings, locale, /);
  assert.match(route('src/pages/[locale]/[slug].astro'), /siteDescriptionFor\(settings, locale, /);
  assert.match(route('src/layouts/BaseLayout.astro'), /siteDescriptionFor\(settings, locale\)/);
  assert.match(route('src/pages/rss.xml.ts'), /siteDescriptionFor\(settings, settings\.default_locale, /);
  for (const path of ['src/pages/[locale]/index.astro', 'src/layouts/BaseLayout.astro', 'src/pages/rss.xml.ts']) {
    assert.doesNotMatch(route(path), /settings\??\.site_description\b/, `${path} still reads the single description`);
  }
});
