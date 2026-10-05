import assert from 'node:assert/strict';
import test from 'node:test';

import { organizationSchema, personSchema } from '../../src/lib/seo';

const site = new URL('https://blog.example.com/');

test('an author is linked to the profiles the owner lists', () => {
  assert.deepEqual(personSchema('Tom', ['https://github.com/tom', 'https://x.com/tom']), {
    '@type': 'Person',
    name: 'Tom',
    sameAs: ['https://github.com/tom', 'https://x.com/tom'],
  });
  assert.deepEqual(personSchema('Tom', []), { '@type': 'Person', name: 'Tom' });
});

test('the publisher carries the site icon as its logo, made absolute, and goes without one it lacks', () => {
  const brand = { icon: { png180: '/media/brand/180.png', png32: '/media/brand/32.png', svg: null }, logo: null };
  assert.deepEqual(organizationSchema('Site', site, brand), {
    '@type': 'Organization',
    logo: 'https://blog.example.com/media/brand/180.png',
    name: 'Site',
    url: 'https://blog.example.com/',
  });
  const logoOnly = { icon: null, logo: { height: 60, mimeType: 'image/png' as const, url: 'https://cdn.example.com/logo.png', width: 240 } };
  assert.equal(organizationSchema('Site', site, logoOnly).logo, 'https://cdn.example.com/logo.png');
  assert.deepEqual(organizationSchema('Site', site, { icon: null, logo: null }), {
    '@type': 'Organization',
    name: 'Site',
    url: 'https://blog.example.com/',
  });
});
