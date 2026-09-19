import assert from 'node:assert/strict';
import { test } from 'node:test';

import { transitionKind } from '../../src/lib/admin-transition';

const ORIGIN = 'https://cms.test';
const kind = (href: string, adminPath = '/admin') => transitionKind(new URL(href, ORIGIN), adminPath, ORIGIN);

test('each admin screen gets the skeleton of its own layout', () => {
  assert.equal(kind('/admin'), 'posts');
  assert.equal(kind('/admin/'), 'posts');
  assert.equal(kind('/admin?status=draft&q=slow'), 'posts');
  assert.equal(kind('/admin/pages'), 'pages');
  assert.equal(kind('/admin/media'), 'media');
  assert.equal(kind('/admin/navigation'), 'list');
  assert.equal(kind('/admin/categories'), 'list');
  for (const form of ['/admin/profile', '/admin/security', '/admin/settings', '/admin/system']) {
    assert.equal(kind(form), 'form', form);
  }
});

test('both editors, new and existing, get the editor skeleton', () => {
  assert.equal(kind('/admin/new'), 'editor');
  assert.equal(kind('/admin/new?locale=en'), 'editor');
  assert.equal(kind('/admin/edit/5b8a'), 'editor');
  assert.equal(kind('/admin/pages/new'), 'editor');
  assert.equal(kind('/admin/pages/edit/5b8a'), 'editor');
});

test('nothing is drawn where no admin layout fits', () => {
  // A preview renders the public post, and the admin path signed out is the sign-in screen.
  assert.equal(kind('/admin/preview/5b8a'), null);
  assert.equal(kind('/admin/pages/preview/5b8a'), null);
  assert.equal(kind('/admin?signin=1'), null);
  assert.equal(kind('/admin?returnTo=%2Fadmin%2Fmedia'), null);
  assert.equal(kind('/th'), null);
  assert.equal(kind('/administrator'), null);
  assert.equal(kind('https://elsewhere.test/admin'), null);
});

test('a renamed admin path is followed', () => {
  assert.equal(kind('/studio', '/studio'), 'posts');
  assert.equal(kind('/studio/pages/edit/5b8a', '/studio'), 'editor');
  assert.equal(kind('/admin/media', '/studio'), null);
});

test('the sign-in kind is a fallback, never a destination', () => {
  // The overlay draws the screen a navigation is heading for; nothing inside the admin
  // navigates to the sign-in, so no URL may resolve to it.
  for (const path of ['/admin', '/admin/media', '/admin/security', '/admin/pages', '/admin/new']) {
    assert.notEqual(transitionKind(new URL(`http://localhost${path}`), '/admin', 'http://localhost'), 'auth');
  }
});
