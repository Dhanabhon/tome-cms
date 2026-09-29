import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHex } from '../../src/lib/hex-color';

// The store reads the server environment when it loads, so the same one the other unit tests stand up.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://tome:tome@localhost:5432/tome',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'install-test-secret-at-least-32-bytes',
  BETTER_AUTH_SECRET: 'better-auth-test-secret-at-least-32-bytes',
  TOME_CMS_CONTEXT_SECRET: 'hex-color-test-context-at-least-32-bytes',
  TOME_CMS_RECOVERY_PEPPER: 'recovery-test-secret-at-least-32-bytes',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'tome-media',
  MEDIA_PUBLIC_URL: 'http://localhost:9000/tome-media',
});

const { COLOR } = await import('../../src/server/plugins/store');

test('a colour is six hex digits, written lower case with its hash', () => {
  assert.equal(normalizeHex('#1A7F5A'), '#1a7f5a');
  assert.equal(normalizeHex('1a7f5a'), '#1a7f5a');
  assert.equal(normalizeHex('  #ABCDEF '), '#abcdef');
  for (const bad of ['', '#abc', '#12345g', '#1234567', 'green']) assert.equal(normalizeHex(bad), null, bad);
});

test('what the field accepts is what the server stores', () => {
  assert.match(normalizeHex('#1A7F5A')!, COLOR);
});
