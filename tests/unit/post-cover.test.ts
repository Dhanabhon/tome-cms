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

test('a theme forked before 1.20.0 passes no sizes: its pictures are drawn the screen wide, never a failed page', () => {
  const id = '0f8c2a9e-6b1d-4c3e-9a7f-2d5e8b1c4a60';
  const media = [{ id, height: 900, variant_widths: [480, 960], width: 1600 }];
  const post = { cover_image: null, show_cover: true, content_html: `<p>Hi</p><img src="/media/${id}">`, media };
  const { bodyHtml } = articleCover(post);
  assert.match(bodyHtml, new RegExp(`<img srcset="/media/${id}\\?w=480 480w, /media/${id}\\?w=960 960w, /media/${id} 1600w" sizes="100vw"`));
  assert.match(articleCover(post, '').bodyHtml, /sizes="100vw"/, 'nor an empty one');
  assert.deepEqual(articleCover({ ...post, cover_image: `/media/${id}`, coverImage: { ...media[0]!, alt_text: null } }, '').coverPicture.sizes, '100vw');
});
