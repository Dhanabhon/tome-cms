import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVideoLink, startSeconds, videoOembedUrl, videoPlayerUrl, videoWatchUrl } from '../../src/lib/video-link';

const ID = 'dQw4w9WgXcQ';

test('every YouTube link form gives the same clip', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
  ]) assert.deepEqual(parseVideoLink(link), { provider: 'youtube', start: null, videoId: ID }, link);
});

test('every Vimeo link form gives the same clip', () => {
  for (const link of [
    'https://vimeo.com/76979871',
    'https://www.vimeo.com/76979871',
    'https://vimeo.com/channels/staffpicks/76979871',
    'https://player.vimeo.com/video/76979871',
  ]) assert.deepEqual(parseVideoLink(link), { provider: 'vimeo', start: null, videoId: '76979871' }, link);
});

test('a start time is read in seconds, minutes and hours', () => {
  assert.equal(parseVideoLink(`https://youtu.be/${ID}?t=90`)?.start, 90);
  assert.equal(parseVideoLink(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start, 90);
  assert.equal(parseVideoLink(`https://www.youtube.com/embed/${ID}?start=42`)?.start, 42);
  assert.equal(parseVideoLink('https://vimeo.com/76979871#t=1m5s')?.start, 65);
  assert.equal(startSeconds('1h2m3s'), 3723);
  assert.equal(startSeconds('0'), null);
  assert.equal(startSeconds('soon'), null);
  assert.equal(startSeconds(''), null);
});

test('anything else is not a video', () => {
  for (const link of [
    `https://youtube.com.example.net/watch?v=${ID}`,
    `https://example.com/watch?v=${ID}`,
    `javascript:alert(1)//https://youtu.be/${ID}`,
    `ftp://youtu.be/${ID}`,
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?v=short',
    'https://vimeo.com/76979871/abcdef',
    'https://vimeo.com/channels/staffpicks',
    'not a link',
    '',
  ]) assert.equal(parseVideoLink(link), null, link);
});

test('the addresses the site writes are built from the provider and id alone', () => {
  const clip = { provider: 'youtube' as const, start: 30, videoId: ID };
  assert.equal(videoWatchUrl(clip), `https://www.youtube.com/watch?v=${ID}&t=30`);
  assert.equal(videoPlayerUrl(clip), `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&start=30`);
  assert.equal(videoOembedUrl(clip), `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}`);
  const vimeo = { provider: 'vimeo' as const, start: null, videoId: '76979871' };
  assert.equal(videoWatchUrl(vimeo), 'https://vimeo.com/76979871');
  assert.equal(videoPlayerUrl(vimeo), 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1');
  assert.equal(videoPlayerUrl({ ...vimeo, start: 5 }), 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1#t=5s');
  assert.equal(videoOembedUrl(vimeo), `https://vimeo.com/api/oembed.json?url=${encodeURIComponent('https://vimeo.com/76979871')}`);
});
