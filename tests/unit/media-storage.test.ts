import assert from 'node:assert/strict';
import test from 'node:test';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'install-token-only-32-characters',
  BETTER_AUTH_SECRET: 'better-auth-test-secret-32-characters',
  TOME_CMS_CONTEXT_SECRET: 'context-test-secret-only-32-characters',
  TOME_CMS_RECOVERY_PEPPER: 'recovery-test-pepper-32-characters',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'unit-test-access',
  S3_SECRET_ACCESS_KEY: 'unit-test-secret',
  S3_BUCKET: 'unit-test-media',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_PUBLIC_URL: 'https://cdn.example.com/media/',
  TOME_CMS_FRONTEND_MODE: 'bundled',
} as const;
Object.assign(process.env, env);

test('media keys and URLs keep provider details out of stored identity', async () => {
  const { createObjectKey } = await import('../../src/server/media/keys');
  const { resolveMediaUrl, stableMediaPath } = await import('../../src/server/media/url');
  const ownerId = '123e4567-e89b-42d3-a456-426614174000';
  const key = createObjectKey(ownerId, 'image/jpeg', new Date('2026-09-08T23:59:59Z'));
  assert.match(key, /^owners\/123e4567-e89b-42d3-a456-426614174000\/2026\/09\/[0-9a-f-]{36}\.jpg$/);
  assert.doesNotMatch(key, /\.\.|résumé|secret/i);
  assert.throws(() => createObjectKey('../owner', 'image/png'));

  assert.equal(resolveMediaUrl('owners/example/some file.png'), 'https://cdn.example.com/media/owners/example/some%20file.png');
  process.env.MEDIA_PUBLIC_URL = 'https://assets.example.net/v2/';
  assert.equal(resolveMediaUrl(key), `https://assets.example.net/v2/${key}`);
  assert.doesNotMatch(resolveMediaUrl(key), /unit-test-access|unit-test-secret/);
  for (const invalid of ['', '/leading', 'double//slash', 'dot/../segment', 'back\\slash']) {
    assert.throws(() => resolveMediaUrl(invalid));
  }
  assert.equal(stableMediaPath(ownerId), `/media/${ownerId}`);
  assert.throws(() => stableMediaPath('not-a-uuid'));
});
