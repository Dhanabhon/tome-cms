import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRateLimit, deviceOf, hitSchema, isBot, readerAddress, referrerHost, statsDay,
} from '../../src/server/stats/rules';

const ARTICLE = '5d0c7a1e-8b2f-4c3d-9e4f-1a2b3c4d5e6f';

test('a hit names a known event, kind and language, an id exactly when it is an article, and a real width', () => {
  const view = { event: 'view', id: ARTICLE, kind: 'post', locale: 'th', width: 1280 };
  assert.equal(hitSchema.safeParse(view).success, true);
  assert.equal(hitSchema.safeParse({ ...view, event: 'read', kind: 'page' }).success, true);
  assert.equal(hitSchema.safeParse({ event: 'view', kind: 'home', locale: 'en', width: 390 }).success, true);
  assert.equal(hitSchema.safeParse({ ...view, referrer: 'https://news.example/a' }).success, true);

  for (const [why, hit] of [
    ['home has no id', { ...view, kind: 'home' }],
    ['an article has one', { event: 'view', kind: 'post', locale: 'en', width: 1280 }],
    ['home has no end to read to', { event: 'read', kind: 'home', locale: 'en', width: 1280 }],
    ['an unknown event', { ...view, event: 'click' }],
    ['an unknown kind', { ...view, kind: 'feed' }],
    ['a language the site does not have', { ...view, locale: 'fr' }],
    ['an id that is not a uuid', { ...view, id: '1 or 1=1' }],
    ['no width', { event: 'view', id: ARTICLE, kind: 'post', locale: 'th' }],
    ['a width of nothing', { ...view, width: 0 }],
    ['a width in pieces', { ...view, width: 1280.5 }],
    ['a width no screen has', { ...view, width: 20_001 }],
    ['a referrer longer than any address', { ...view, referrer: `https://a.example/${'x'.repeat(2_048)}` }],
  ] as const) {
    assert.equal(hitSchema.safeParse(hit).success, false, why);
  }
});

test('the referrer is a host: www. dropped, this site internal, nonsense direct', () => {
  assert.equal(referrerHost('https://www.News.Example/story?id=1#top', 'blog.example'), 'news.example');
  assert.equal(referrerHost('http://t.co/abc', 'blog.example'), 't.co');
  assert.equal(referrerHost('https://blog.example/en/', 'blog.example'), 'internal');
  assert.equal(referrerHost('https://www.blog.example/', 'www.blog.example'), 'internal');
  assert.equal(referrerHost(undefined, 'blog.example'), '');
  assert.equal(referrerHost('', 'blog.example'), '');
  assert.equal(referrerHost('not an address', 'blog.example'), '');
  assert.equal(referrerHost('javascript:alert(1)', 'blog.example'), '');
  assert.equal(referrerHost('android-app://com.google.android.gm/', 'blog.example'), '');
  assert.equal(referrerHost('http://[::1]:8080/', 'blog.example'), '');
  const long = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.example/`;
  assert.equal(referrerHost(long, 'blog.example'), '', 'a host longer than DNS allows');
});

test('a window under 768 pixels is a phone', () => {
  assert.equal(deviceOf(767), 'mobile');
  assert.equal(deviceOf(768), 'desktop');
  assert.equal(deviceOf(320), 'mobile');
  assert.equal(deviceOf(2560), 'desktop');
});

test('a fetcher that names itself a bot is not a reader, and a browser is', () => {
  for (const agent of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (compatible; YandexBot/3.0)',
    'Twitterbot/1.0',
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    'Mozilla/5.0 (compatible; Embedly/0.2)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
    'crawler4j',
    'Mozilla/5.0 (compatible; Baiduspider/2.0)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bitlybot/3.0; +http://bit.ly/)',
    'Mozilla/5.0 (Macintosh) LinkPreview/1.0',
  ]) assert.equal(isBot(agent), true, agent);
  assert.equal(isBot(null), true, 'no User-Agent at all');
  assert.equal(isBot(''), true);
  for (const agent of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
  ]) assert.equal(isBot(agent), false, agent);
});

test('the day is the site\'s, either side of its midnight', () => {
  assert.equal(statsDay(new Date('2026-09-24T16:59:59Z'), 'Asia/Bangkok'), '2026-09-24');
  assert.equal(statsDay(new Date('2026-09-24T17:00:00Z'), 'Asia/Bangkok'), '2026-09-25');
  assert.equal(statsDay(new Date('2026-09-24T23:59:59Z'), 'UTC'), '2026-09-24');
  assert.equal(statsDay(new Date('2026-09-25T00:00:00Z'), 'UTC'), '2026-09-25');
  assert.equal(statsDay(new Date('2026-12-31T17:30:00Z'), 'Asia/Bangkok'), '2027-01-01');
});

test('X-Forwarded-For is believed only from the proxy side of the app', () => {
  const from = (forwarded?: string) => new Request('http://localhost/api/v1/stats/hit', {
    headers: forwarded === undefined ? {} : { 'X-Forwarded-For': forwarded },
  });
  assert.equal(readerAddress(from('198.51.100.4'), '203.0.113.9'), '203.0.113.9', 'a reader who reached the app directly');
  assert.equal(readerAddress(from('made-up, 198.51.100.4'), '127.0.0.1'), '198.51.100.4', 'the last entry is the proxy\'s own');
  assert.equal(readerAddress(from('198.51.100.4'), '::1'), '198.51.100.4');
  assert.equal(readerAddress(from('198.51.100.4'), '::ffff:127.0.0.1'), '198.51.100.4');
  assert.equal(readerAddress(from('198.51.100.4'), '172.18.0.1'), '198.51.100.4', 'Docker\'s bridge, which is how the managed install is reached');
  assert.equal(readerAddress(from('2001:db8::7'), '10.0.0.2'), '2001:db8::7');
  assert.equal(readerAddress(from(), '127.0.0.1'), '127.0.0.1', 'no header, nothing to believe');
  assert.equal(readerAddress(from('not an address'), '127.0.0.1'), '127.0.0.1');
});

test('the limit drops past 120 in ten minutes, starts again after, and remembers no more than its cap', () => {
  const limit = createRateLimit({ capacity: 3, limit: 120, windowMs: 600_000 });
  for (let hit = 0; hit < 120; hit += 1) assert.equal(limit.allow('198.51.100.4', 1_000), true);
  assert.equal(limit.allow('198.51.100.4', 1_001), false, 'the 121st');
  assert.equal(limit.allow('198.51.100.4', 600_999), false, 'still inside the window');
  assert.equal(limit.allow('198.51.100.4', 601_000), true, 'a new window after ten minutes');

  for (const address of ['a', 'b', 'c', 'd', 'e']) limit.allow(address, 700_000);
  assert.equal(limit.size, 3, 'never more addresses than the cap');
});
