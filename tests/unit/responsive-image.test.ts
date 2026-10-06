import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { withLeadImage, withLibraryAlts, withoutImageTitles, withResponsiveImages } from '../../src/lib/editor-content';
import { articleCover } from '../../src/lib/post-cover';
import { ALMANAC_SIZES, imageSrcset, PAPER_SIZES, PLAIN_SIZES, responsiveAttrs } from '../../src/lib/responsive-image';

const ID = '3f11698c-db7e-4724-a236-66808f9b26fe';
const OTHER = '00000000-0000-4000-8000-000000000000';
const SIZES = '(min-width: 48rem) 44.5rem, 100vw';
const photo = { height: 1500, id: ID, variant_widths: [480, 960, 1600], width: 2000 };
const SRCSET = `/media/${ID}?w=480 480w, /media/${ID}?w=960 960w, /media/${ID}?w=1600 1600w, /media/${ID} 2000w`;

test('a picture with copies offers each of them and its original, by width', () => {
  assert.equal(imageSrcset(photo), SRCSET);
  assert.equal(imageSrcset({ ...photo, variant_widths: [480], width: 700 }), `/media/${ID}?w=480 480w, /media/${ID} 700w`);
});

test('a picture with no copies yet offers nothing, and keeps the markup it had', () => {
  assert.equal(imageSrcset({ ...photo, variant_widths: [] }), undefined);
  assert.deepEqual(responsiveAttrs({ ...photo, variant_widths: [] }, SIZES), {});
  assert.deepEqual(responsiveAttrs(null, SIZES), {});
  assert.deepEqual(responsiveAttrs(photo, SIZES), { sizes: SIZES, srcset: SRCSET });
});

const stored = (attributes = '', id = ID) => `<p><img src="/media/${id}" alt="A loaf" decoding="async" loading="lazy"${attributes} /></p>`;

test('a body picture is given its copies, the column it fills, and its own size', () => {
  assert.equal(
    withResponsiveImages(stored(), [photo], SIZES),
    `<p><img srcset="${SRCSET}" sizes="${SIZES}" width="2000" height="1500" src="/media/${ID}" alt="A loaf" decoding="async" loading="lazy" /></p>`,
  );
});

test('a size the body already gives is kept', () => {
  const sized = withResponsiveImages(stored(' width="640" height="480"'), [photo], SIZES);
  assert.match(sized, / width="640" height="480" \/>/);
  assert.equal(sized.match(/ width="/g)?.length, 1);
  assert.match(sized, new RegExp(`srcset="${SRCSET.replaceAll('?', '\\?')}"`));
});

test('the rewrite is idempotent, and a picture that has a srcset is left alone', () => {
  const once = withResponsiveImages(stored(), [photo], SIZES);
  assert.equal(withResponsiveImages(once, [photo], SIZES), once);
  const own = stored(' srcset="/elsewhere.webp 1x"');
  assert.equal(withResponsiveImages(own, [photo], SIZES), own);
});

test('only a library picture by its own address is touched', () => {
  const pictures = [
    stored('', OTHER),
    `<img src="/media/${ID}?w=960" alt="" />`,
    `<img src="https://example.com/media/${ID}" alt="" />`,
    `<img src="/media/${ID}/x" alt="" />`,
    '<img src="https://example.com/a.webp" alt="" />',
  ].join('');
  assert.equal(withResponsiveImages(pictures, [photo], SIZES), pictures);
  // One with no copies yet, as an animated GIF, an SVG or one not yet backfilled always is.
  assert.equal(withResponsiveImages(stored(), [{ ...photo, variant_widths: [] }], SIZES), stored());
  assert.equal(withResponsiveImages(stored(), [], SIZES), stored());
});

test('a linked picture keeps its link, and the words around it', () => {
  const linked = `<p>Before <a href="https://example.com" rel="noopener noreferrer"><img src="/media/${ID}" alt="A loaf" /></a> after</p>`;
  const after = withResponsiveImages(linked, [photo], SIZES);
  assert.match(after, /^<p>Before <a href="https:\/\/example.com" rel="noopener noreferrer"><img srcset="[^"]+" sizes="[^"]+" width="2000" height="1500" src="\/media\/[^"]+" alt="A loaf" \/><\/a> after<\/p>$/);
});

test('alt text, a stripped title and the lead picture all come out as they did, with the copies added', () => {
  const old = `<p><img src="/media/${ID}" alt="loaf.webp" title="loaf.webp" decoding="async" loading="lazy" /></p>`;
  const described = withoutImageTitles(withLibraryAlts(old, [{ alt_text: 'A loaf', id: ID, original_name: 'loaf.webp' }]));
  const html = withResponsiveImages(described, [photo], SIZES);
  assert.ok(html.includes(' alt="A loaf"') && !html.includes('title='), html);
  const lead = withLeadImage(html.slice('<p>'.length));
  assert.match(lead, /^<img fetchpriority="high" srcset="[^"]+" sizes="[^"]+" width="2000" height="1500" src="\/media\/[^"]+" alt="A loaf" decoding="async" \/><\/p>$/);
  assert.equal(withResponsiveImages(lead, [photo], SIZES), lead, 'and the rewrite again changes nothing');
});

test('an article\'s cover and body are drawn from their copies, with the cover\'s real size', () => {
  const post = {
    content_html: `<img src="/media/${ID}" alt="" loading="lazy" />`,
    cover_image: `/media/${OTHER}`,
    coverImage: { alt_text: 'The oven', height: 900, id: OTHER, variant_widths: [480, 960], width: 1600 },
    media: [photo],
    show_cover: true,
  };
  const { bodyHtml, coverPicture } = articleCover(post, SIZES);
  assert.deepEqual(coverPicture, {
    height: 900, sizes: SIZES, srcset: `/media/${OTHER}?w=480 480w, /media/${OTHER}?w=960 960w, /media/${OTHER} 1600w`, width: 1600,
  });
  assert.match(bodyHtml, /srcset=/);
  assert.match(bodyHtml, / loading="lazy"/, 'a shown cover leads, so the body picture stays lazy');
  // A cover the library does not describe keeps the box the themes always drew.
  assert.deepEqual(articleCover({ ...post, coverImage: null }, SIZES).coverPicture, { height: 675, width: 1200 });
});

/**
 * The sizes mirror each theme's CSS. Each number a sizes string is worked out from is checked
 * against the rule it comes from, so a change to the column fails here until the sizes follow it.
 */
test('the sizes follow the columns the themes\' CSS draws', () => {
  const css = (theme: string) => readFileSync(new URL(`../../src/themes/${theme}/theme.css`, import.meta.url), 'utf8');
  const paper = css('paper');
  assert.match(paper, /\.post-page \{\n {2}width: min\(100%, 48rem\);\n {2}margin-inline: auto;\n {2}padding: var\(--space-xl\) 1\.25rem var\(--space-3xl\);/);
  assert.match(paper, /@media \(min-width: 37\.5rem\) \{\n {2}\.post-page \{ padding-inline: 1\.75rem; \}/);
  assert.ok(paper.includes(`.post-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(
    min(100%, max(
      var(--post-grid-min, 19rem),
      calc((100% - (var(--post-grid-columns, 3) - 1) * var(--space-lg)) / var(--post-grid-columns, 3))
    )),
    1fr
  ));
  gap: var(--space-xl) var(--space-lg);`), 'the card grid the cards sizes are solved from');
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const home = read('src/themes/paper/Home.astro');
  assert.ok(home.includes("--post-grid-min: ${columns === '4' ? '16rem' : '19rem'};"), 'the cards\' least widths');
  assert.ok(home.includes('<section class="mx-auto w-full max-w-7xl px-5 py-12 sm:px-7 sm:py-16">'), 'the feed\'s frame and gutters');
  assert.match(read('tailwind.config.mjs'), /sm: '600px',/, 'sm: is 37.5rem');
  assert.match(read('src/styles/installer-tokens.css'), /--space-lg: 1\.5rem;/, 'the gap between cards');
  assert.match(paper, /\.hero-slide \{\n {2}display: grid;[\s\S]*?flex: 0 0 100%;/);
  assert.equal(PAPER_SIZES.article, '(min-width: 48rem) 44.5rem, (min-width: 37.5rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)');
  assert.equal(PAPER_SIZES.cards['3'], '(min-width: 80rem) 24.5rem, (min-width: 63.5rem) calc((100vw - 6.5rem) / 3), (min-width: 43rem) calc((100vw - 5rem) / 2), (min-width: 37.5rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)');

  const plain = css('plain');
  assert.match(plain, /--plain-gutter: 1\.25rem;/);
  assert.match(plain, /@media \(min-width: 40rem\) \{\n {2}\.plain \{ --plain-gutter: 1\.75rem; \}/);
  assert.match(plain, /\.plain-article \{ width: min\(var\(--plain-frame\), 44rem\); \}/);
  assert.match(plain, /\.plain-body img \{ width: 100%; height: auto; \}/);
  assert.equal(PLAIN_SIZES.article, '(min-width: 47.5rem) 44rem, (min-width: 40rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)');

  const almanac = css('almanac');
  assert.match(almanac, /\.almanac-frame \{ width: min\(100% - 2 \* var\(--almanac-gutter\), 76rem\);/);
  assert.match(almanac, /inline-size: min\(100% - 2 \* var\(--almanac-gutter, 1\.25rem\), 44em\);\n {2}margin-inline: auto;\n {2}padding-block: var\(--space-xl\) var\(--space-2xl\);\n {2}color: var\(--color-ink\);\n {2}font-size: 1\.125rem;/);
  assert.match(almanac, /--almanac-gutter: 1\.25rem;/);
  assert.match(almanac, /@media \(min-width: 40rem\) \{\n {2}\.almanac \{ --almanac-gutter: 1\.75rem; \}/);
  assert.match(almanac, /\.almanac-grid \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: var\(--space-lg\); \}/);
  assert.match(almanac, /@media \(min-width: 40rem\) \{\n {2}\.almanac-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(almanac, /@media \(min-width: 64rem\) \{\n {2}\.almanac-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.equal(ALMANAC_SIZES.article, '(min-width: 53rem) 49.5rem, (min-width: 40rem) calc(100vw - 3.5rem), calc(100vw - 2.5rem)');
  assert.equal(ALMANAC_SIZES.card, '(min-width: 79.5rem) 24.34rem, (min-width: 64rem) calc((100vw - 6.5rem) / 3), (min-width: 40rem) calc((100vw - 5rem) / 2), calc(100vw - 2.5rem)');
});
