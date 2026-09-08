import assert from 'node:assert/strict';
import test from 'node:test';

import type { APIContext, MiddlewareNext } from 'astro';

import {
  adminHref,
  adminLoginPath,
  adminSignInPath,
  matchAdminPath,
  normalizeAdminPath,
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
