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
  const { bodyHtml } = articleCover({ cover_image: '/media/c', show_cover: true, content_html: stored }, '100vw');
  assert.doesNotMatch(bodyHtml, /IMG_2041/);
});

test('only a real title attribute is taken off a picture, whatever the alt says', () => {
  const cases: Array<[string, string]> = [
    ['<img src="/m/a" alt="big dog title=" decoding="async" />', '<img src="/m/a" alt="big dog title=" decoding="async" />'],
    ['<img src="/m/a" alt="sing title=" decoding="async" />', '<img src="/m/a" alt="sing title=" decoding="async" />'],
    ['<img src="/m/a" alt="eg title=" loading="lazy" />', '<img src="/m/a" alt="eg title=" loading="lazy" />'],
    ['<img src="/m/a" alt="big title=" title="x.jpg" />', '<img src="/m/a" alt="big title=" />'],
    ['<img src="/m/a" alt="P title=" decoding="async" />', '<img src="/m/a" alt="P title=" decoding="async" />'],
    ['<img src="/m/a" alt=" title=" decoding="async" />', '<img src="/m/a" alt=" title=" decoding="async" />'],
    ['<img title="x.jpg" src="/m/a" alt="c" />', '<img src="/m/a" alt="c" />'],
    ['<img src="a" title="b" alt="c">', '<img src="a" alt="c">'],
  ];
  for (const [stored, expected] of cases) assert.equal(withoutImageTitles(stored), expected, stored);
});
