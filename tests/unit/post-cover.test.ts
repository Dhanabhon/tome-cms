import assert from 'node:assert/strict';
import test from 'node:test';

import { articleCover } from '../../src/lib/post-cover';

const body = '<img src="/media/a">';

test('a shown cover leads the article and the body is left alone', () => {
  assert.deepEqual(articleCover({ cover_image: '/media/c', show_cover: true, content_html: body }), { cover: '/media/c', coverAlt: '', bodyHtml: body });
});

test('a cover is described by its alt text from the library, and is decoration without one', () => {
  const post = { cover_image: '/media/c', show_cover: true, content_html: body };
  assert.equal(articleCover({ ...post, coverImage: { alt_text: 'A desk by a window' } }).coverAlt, 'A desk by a window');
  assert.equal(articleCover({ ...post, coverImage: { alt_text: null } }).coverAlt, '');
  assert.equal(articleCover({ ...post, coverImage: null }).coverAlt, '');
});

test('a hidden cover leaves the article, and the first body image takes the lead instead', () => {
  const { cover, bodyHtml } = articleCover({ cover_image: '/media/c', show_cover: false, content_html: body });
  assert.equal(cover, null);
  assert.match(bodyHtml, /<img fetchpriority="high" src="\/media\/a">/);
});

test('no cover behaves as it always did', () => {
  assert.equal(articleCover({ cover_image: null, show_cover: true, content_html: body }).cover, null);
});
