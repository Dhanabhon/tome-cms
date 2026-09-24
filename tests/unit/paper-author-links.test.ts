import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTHOR_LINK_MARKS, linkMark } from '../../src/themes/paper/author-links';

test('a link to a known site is told by its host, subdomains included', () => {
  for (const [url, mark] of [
    ['https://github.com/dhanabhon', 'github'],
    ['https://www.github.com/dhanabhon', 'github'],
    ['https://gist.github.com/dhanabhon', 'github'],
    ['https://x.com/tome', 'x'],
    ['https://twitter.com/tome', 'x'],
    ['https://mobile.twitter.com/tome', 'x'],
    ['https://www.linkedin.com/in/tome', 'linkedin'],
    ['https://th.linkedin.com/in/tome', 'linkedin'],
    ['https://facebook.com/tome', 'facebook'],
    ['https://m.facebook.com/tome', 'facebook'],
    ['https://fb.com/tome', 'facebook'],
    ['https://www.instagram.com/tome', 'instagram'],
    ['https://www.youtube.com/@tome', 'youtube'],
    ['https://youtu.be/abc', 'youtube'],
    ['HTTPS://GITHUB.COM/Tome', 'github'],
  ] as const) assert.equal(linkMark(url), mark, url);
});

test('anything else is a plain link, however much it looks like a known one', () => {
  for (const url of [
    'https://example.com/',
    'https://github.com.evil.example/tome',
    'https://notgithub.com/tome',
    'https://example.com/github.com',
    'https://x.co/tome',
    'not a url',
    '',
  ]) assert.equal(linkMark(url), 'link', url);
});

test('every mark has an icon', () => {
  for (const mark of ['github', 'x', 'linkedin', 'facebook', 'instagram', 'youtube', 'link'] as const) {
    assert.ok(AUTHOR_LINK_MARKS[mark]?.startsWith('<'), mark);
  }
});
