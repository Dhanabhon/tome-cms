import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { HIDDEN_FROM_SEARCH, robotsTxt } from '../../src/lib/search-visibility';
import { sitemapXml } from '../../src/lib/xml';
import { afterWrite, cacheablePublicAnswer, withSearchVisibility } from '../../src/middleware';
import { resetPageCacheForTest } from '../../src/server/http/page-cache';

beforeEach(() => resetPageCacheForTest());

const SITEMAP = 'https://example.com/sitemap.xml';

test('a listed site points crawlers at its sitemap, exactly as before the switch existed', () => {
  assert.equal(robotsTxt({ headless: false, hidden: false, sitemap: SITEMAP }), [
    'User-agent: *', 'Allow: /', 'Disallow: /api/', '',
    'User-agent: OAI-SearchBot', 'Allow: /', 'Disallow: /api/', '',
    `Sitemap: ${SITEMAP}`, '',
  ].join('\n'));
});

test('a hidden site still lets crawlers in, to read the noindex, but offers no sitemap', () => {
  const body = robotsTxt({ headless: false, hidden: true, sitemap: SITEMAP });
  assert.doesNotMatch(body, /Sitemap:/);
  assert.match(body, /^User-agent: \*\nAllow: \/\n/);
  assert.match(body, /User-agent: OAI-SearchBot\nAllow: \/\n/);
  assert.doesNotMatch(body, /Disallow: \/\n/);
});

test('a headless site keeps its Disallow answer, switch or no switch', () => {
  const headless = 'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n';
  assert.equal(robotsTxt({ headless: true, hidden: false, sitemap: SITEMAP }), headless);
  assert.equal(robotsTxt({ headless: true, hidden: true, sitemap: SITEMAP }), headless);
});

test('a sitemap with nothing in it is still a valid urlset', () => {
  assert.equal(sitemapXml([]), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n</urlset>\n');
  assert.match(sitemapXml([{ location: 'https://example.com/en' }]), /<url>\n {4}<loc>https:\/\/example\.com\/en<\/loc>\n {2}<\/url>/);
});

const ok = () => new Response('page', { headers: { 'Content-Type': 'text/html' } });

test('every public answer says noindex while the site is hidden', () => {
  for (const path of ['/', '/en', '/th/blog/a-post', '/en/about', '/blog/legacy', '/rss.xml', '/sitemap.xml', '/api/v1/content/posts', '/api/v1/content/site']) {
    assert.equal(withSearchVisibility(ok(), path, true).headers.get('X-Robots-Tag'), HIDDEN_FROM_SEARCH, path);
  }
  assert.equal(HIDDEN_FROM_SEARCH, 'noindex, nofollow');
});

test('nothing changes while the site is listed, and the admin never carries it', () => {
  for (const path of ['/', '/en', '/rss.xml', '/api/v1/content/posts']) {
    assert.equal(withSearchVisibility(ok(), path, false).headers.get('X-Robots-Tag'), null, path);
  }
  for (const path of ['/admin', '/admin/settings', '/api/admin/settings', '/studio', '/install', '/recovery', '/health/ready', '/robots.txt']) {
    assert.equal(withSearchVisibility(ok(), path, true).headers.get('X-Robots-Tag'), null, path);
  }
});

test('a redirect, whose headers are immutable, still takes it', () => {
  const redirect = Response.redirect('http://localhost/en/blog/a-post', 301);
  assert.equal(withSearchVisibility(redirect, '/blog/a-post', true).headers.get('X-Robots-Tag'), HIDDEN_FROM_SEARCH);
});

test('a page kept before the switch is not served after it', async () => {
  let hidden = false;
  const render = async () => withSearchVisibility(ok(), '/en', hidden);
  const ask = () => {
    const url = new URL('http://localhost:4321/en');
    return cacheablePublicAnswer({ request: new Request(url), url }, render, { bundled: true, nextScheduled: async () => null });
  };
  assert.equal((await ask()).headers.get('X-Robots-Tag'), null);
  // Saving Settings is an admin write: it clears the cache before the next reader arrives.
  hidden = true;
  afterWrite('/api/admin/settings', new Response(null, { status: 200 }));
  const after = await ask();
  assert.equal(after.headers.get('X-Tome-Cache'), 'miss');
  assert.equal(after.headers.get('X-Robots-Tag'), HIDDEN_FROM_SEARCH);
  const hit = await ask();
  assert.equal(hit.headers.get('X-Tome-Cache'), 'hit');
  assert.equal(hit.headers.get('X-Robots-Tag'), HIDDEN_FROM_SEARCH, 'a hit answers with what the render said');
});
