import assert from 'node:assert/strict';
import test from 'node:test';

import { documentTitle, getPublicSiteUrl } from '../../src/lib/seo';

test('public URLs prefer the configured canonical origin', () => {
  const previous = process.env.TOME_CMS_PUBLIC_URL;
  process.env.TOME_CMS_PUBLIC_URL = 'https://cms.example.com';
  try {
    assert.equal(getPublicSiteUrl(new Request('http://127.0.0.1:4321')).toString(), 'https://cms.example.com/');
  } finally {
    if (previous === undefined) delete process.env.TOME_CMS_PUBLIC_URL;
    else process.env.TOME_CMS_PUBLIC_URL = previous;
  }
});

test('a page title is followed by the site name, but a written meta title stands alone', () => {
  assert.equal(documentTitle({ siteName: 'Site', title: 'Site' }), 'Site');
  assert.equal(documentTitle({ siteName: 'Site', title: 'A post' }), 'A post | Site');
  assert.equal(documentTitle({ metaTitle: 'Written for search', siteName: 'Site', title: 'A post' }), 'Written for search');
  assert.equal(documentTitle({ metaTitle: '  ', siteName: 'Site', title: 'A post' }), 'A post | Site');
});
