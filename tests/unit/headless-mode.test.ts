import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeXml } from '../../src/lib/xml';
import { isBundledFrontendPath } from '../../src/middleware';

test('headless mode classifies only bundled frontend routes', () => {
  for (const path of [
    '/',
    '/th',
    '/en/',
    '/th/blog/a-post',
    '/en/about',
    '/blog/legacy-post',
    '/sitemap.xml',
    '/rss.xml',
  ]) assert.equal(isBundledFrontendPath(path), true, path);

  for (const path of [
    '/robots.txt',
    '/api/v1/content/pages',
    '/api/v1/content/posts/example',
    '/api/v1/content/preview/token',
    '/api/admin/posts',
    '/health/ready',
    '/media/example',
    '/recovery',
    '/install',
    '/admin',
    '/fr',
    '/th/blog',
    '/th/blog/post/extra',
  ]) assert.equal(isBundledFrontendPath(path), false, path);
});

test('XML escaping protects feed and sitemap text', () => {
  assert.equal(escapeXml(`Tome & <CMS> "notes" 'today'`), 'Tome &amp; &lt;CMS&gt; &quot;notes&quot; &apos;today&apos;');
});
