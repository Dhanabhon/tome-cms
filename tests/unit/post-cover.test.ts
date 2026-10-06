import assert from 'node:assert/strict';
import test from 'node:test';

import { articleCover } from '../../src/lib/post-cover';

const body = '<img src="/media/a">';
const SIZES = '100vw';
const library = (alt_text: string | null) => ({ alt_text, height: 900, id: 'c', variant_widths: [], width: 1600 });

test('a shown cover leads the article and the body is left alone', () => {
  assert.deepEqual(articleCover({ cover_image: '/media/c', show_cover: true, content_html: body }, SIZES), {
    cover: '/media/c', coverAlt: '', coverPicture: { height: 675, width: 1200 }, bodyHtml: body,
  });
});

test('a cover is described by its alt text from the library, and is decoration without one', () => {
  const post = { cover_image: '/media/c', show_cover: true, content_html: body };
  assert.equal(articleCover({ ...post, coverImage: library('A desk by a window') }, SIZES).coverAlt, 'A desk by a window');
  assert.equal(articleCover({ ...post, coverImage: library(null) }, SIZES).coverAlt, '');
  assert.equal(articleCover({ ...post, coverImage: null }, SIZES).coverAlt, '');
});

test('a cover from the library keeps its own size, and has no copies to offer until they are made', () => {
  const post = { cover_image: '/media/c', show_cover: true, content_html: body, coverImage: library(null) };
  assert.deepEqual(articleCover(post, SIZES).coverPicture, { height: 900, width: 1600 });
});

test('a hidden cover leaves the article, and the first body image takes the lead instead', () => {
  const { cover, bodyHtml } = articleCover({ cover_image: '/media/c', show_cover: false, content_html: body }, SIZES);
  assert.equal(cover, null);
  assert.match(bodyHtml, /<img fetchpriority="high" src="\/media\/a">/);
});

test('no cover behaves as it always did', () => {
  assert.equal(articleCover({ cover_image: null, show_cover: true, content_html: body }, SIZES).cover, null);
});
