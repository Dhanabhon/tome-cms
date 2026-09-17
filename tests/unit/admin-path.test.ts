import assert from 'node:assert/strict';
import test from 'node:test';

import type { APIContext, MiddlewareNext } from 'astro';

import {
  adminHref,
  adminLoginPath,
  adminPreviewHref,
  adminSignInPath,
  matchAdminPath,
  normalizeAdminPath,
  postSearchState,
  safeAdminReturnTo,
} from '../../src/lib/admin';

test('Admin path helpers normalize, match, and keep redirects on the configured route', () => {
  assert.equal(normalizeAdminPath(' Studio/ '), '/studio');
  for (const invalid of ['/api', '/install', '/recovery', '/a', '//evil.example', '/studio/path', '']) {
    assert.equal(normalizeAdminPath(invalid), '/admin');
  }

  assert.equal(adminHref({ admin_path: '/studio' }), '/studio');
  assert.equal(adminHref({ admin_path: '/recovery' }), '/admin');
  assert.equal(adminHref({ admin_path: '/studio' }, '/pages?status=draft'), '/studio/pages?status=draft');
  assert.equal(adminHref({ admin_path: '/studio' }, '/../outside'), '/studio');

  assert.equal(matchAdminPath('/studio', '/studio'), '');
  assert.equal(matchAdminPath('/studio/pages/edit/1', '/studio'), '/pages/edit/1');
  assert.equal(matchAdminPath('/studio-tools', '/studio'), null);
  assert.equal(matchAdminPath('/admin', '/studio'), null);
  assert.equal(`/admin${matchAdminPath('/studio/pages', '/studio')}`, '/admin/pages');

  assert.equal(safeAdminReturnTo('/studio/profile?tab=links#avatar', '/studio'), '/studio/profile?tab=links');
  for (const unsafe of [
    null,
    '',
    '/admin',
    '/administrator',
    '/studio/../../outside',
    '//evil.example/studio',
    'https://evil.example/studio',
    '/\\evil.example/studio',
  ]) {
    assert.equal(safeAdminReturnTo(unsafe, '/studio'), '/studio');
  }
  assert.equal(adminLoginPath('/studio', '/studio'), '/studio?signin=1');
  assert.equal(
    adminLoginPath('/studio/settings?tab=site', '/studio'),
    '/studio?signin=1&returnTo=%2Fstudio%2Fsettings%3Ftab%3Dsite',
  );

  assert.equal(adminLoginPath('/admin'), '/admin');
  assert.equal(adminLoginPath('/admin/settings?tab=site'), '/admin?returnTo=%2Fadmin%2Fsettings%3Ftab%3Dsite');
  assert.equal(adminSignInPath('/admin'), '/admin?signin=1');
  assert.equal(
    adminSignInPath('/admin/settings?tab=site'),
    '/admin?signin=1&returnTo=%2Fadmin%2Fsettings%3Ftab%3Dsite',
  );
});

test('a preview opens the rendered page, never the content API', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  // The editors once opened /api/v1/content/preview/<token> -- the headless JSON
  // endpoint -- so the writer's preview tab filled with raw JSON while the list's
  // Preview link, pointed at the admin page, kept working. One helper for both.
  assert.equal(adminPreviewHref({ admin_path: '/admin' }, 'post', id), `/admin/preview/${id}`);
  assert.equal(adminPreviewHref({ admin_path: '/admin' }, 'page', id), `/admin/pages/preview/${id}`);
  assert.equal(adminPreviewHref({ admin_path: '/studio' }, 'post', id), `/studio/preview/${id}`);
  for (const kind of ['post', 'page'] as const) {
    assert.ok(!adminPreviewHref({ admin_path: '/admin' }, kind, id).includes('/api/'), `${kind} preview must not be an API route`);
  }
});

test('legacy health and prepared recovery paths do not load headless runtime configuration', async () => {
  const keys = [
    'DATABASE_URL',
    'TOME_CMS_PUBLIC_URL',
    'TOME_CMS_AUTH_SECRET',
    'TOME_CMS_CONTEXT_SECRET',
    'TOME_CMS_RECOVERY_PEPPER',
  ] as const;
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    const { onRequest, preparedHeadlessRequest } = await import('../../src/middleware');
    const next: MiddlewareNext = async () => new Response('next');
    for (const [handler, pathname] of [
      [onRequest, '/health/live'],
      [preparedHeadlessRequest, '/recovery'],
      [preparedHeadlessRequest, '/api/recovery/start'],
    ] as const) {
      const response = await handler({
        locals: {},
        request: new Request(`http://localhost:4321${pathname}`),
        url: new URL(`http://localhost:4321${pathname}`),
      } as APIContext, next);
      assert.equal(await response?.text(), 'next');
    }
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a post search from the Posts list keeps the filters in force', () => {
  assert.deepEqual(
    postSearchState(new URL('https://cms.test/admin?status=draft&locale=th&q=slow'), '/admin'),
    { hidden: [['status', 'draft'], ['locale', 'th']], query: 'slow' },
  );
  assert.deepEqual(postSearchState(new URL('https://cms.test/admin/'), '/admin'), { hidden: [], query: '' });
  assert.deepEqual(
    postSearchState(new URL('https://cms.test/studio?q=notes'), '/studio'),
    { hidden: [], query: 'notes' },
  );
});

test('a post search from any other screen starts from all posts', () => {
  assert.deepEqual(
    postSearchState(new URL('https://cms.test/admin/pages?status=draft&q=about'), '/admin'),
    { hidden: [], query: '' },
  );
  assert.deepEqual(postSearchState(new URL('https://cms.test/admin/categories'), '/admin'), { hidden: [], query: '' });
});
