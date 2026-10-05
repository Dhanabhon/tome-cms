import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizedContentHtmlSchema, withoutImageTitles } from '../../src/lib/editor-content';
import { articleCover } from '../../src/lib/post-cover';

test('a picture keeps its file name as a title in the editor, but the HTML a reader gets loses it, and a link keeps its own', () => {
  const html = sanitizedContentHtmlSchema.parse('<p><img src="/media/a1" alt="A lake" title="IMG_2041-th.webp"><a href="https://example.com" title="Example">x</a></p>');
  assert.doesNotMatch(html, /<img[^>]*title=/);
  assert.match(html, /<a [^>]*title="Example"/);
});

test('a post saved before has the file names taken off its pictures when it is read', () => {
  const stored = '<p><img src="/media/a1" alt="A lake" title="IMG_2041-th.webp" decoding="async" loading="lazy" /></p><p title="kept">t</p>';
  assert.equal(withoutImageTitles(stored), '<p><img src="/media/a1" alt="A lake" decoding="async" loading="lazy" /></p><p title="kept">t</p>');
  const { bodyHtml } = articleCover({ cover_image: '/media/c', show_cover: true, content_html: stored });
  assert.doesNotMatch(bodyHtml, /IMG_2041/);
});

test('an alt that ends in the word title= is left whole', () => {
  const tag = '<img src="/media/a1" alt="P title=" decoding="async" />';
  assert.equal(withoutImageTitles(tag), tag);
  assert.equal(withoutImageTitles('<img src="/media/a1" alt="P title=" title="x.jpg" />'), '<img src="/media/a1" alt="P title=" />');
});
