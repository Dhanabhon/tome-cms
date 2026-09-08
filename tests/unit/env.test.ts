import assert from 'node:assert/strict';
import test from 'node:test';

import { parseServerEnv } from '../../src/server/env';

const valid = {
  DATABASE_URL: 'postgresql://tomecms:password@127.0.0.1:5432/tomecms',
  TOME_CMS_PUBLIC_URL: 'https://cms.example.com',
  TOME_CMS_INSTALL_TOKEN: 'i'.repeat(32),
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  TOME_CMS_CONTEXT_SECRET: 'c'.repeat(32),
  TOME_CMS_RECOVERY_PEPPER: 'r'.repeat(32),
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'tomecms',
  S3_SECRET_ACCESS_KEY: 's'.repeat(24),
  S3_BUCKET: 'tomecms-media',
  MEDIA_PUBLIC_URL: 'http://127.0.0.1:9000/tomecms-media/',
};

test('accepts the canonical self-hosted environment', () => {
  assert.equal(parseServerEnv(valid).DATABASE_POOL_MAX, 10);
  assert.equal(parseServerEnv(valid).TOME_CMS_FRONTEND_MODE, 'bundled');
});

test('rejects missing secrets, malformed URLs, and production HTTP', () => {
  assert.throws(() => parseServerEnv({ ...valid, DATABASE_URL: '' }));
  assert.throws(() => parseServerEnv({ ...valid, NODE_ENV: 'production', TOME_CMS_PUBLIC_URL: 'http://cms.example.com' }));
  assert.throws(() => parseServerEnv({ ...valid, NODE_ENV: 'production', S3_ENDPOINT: 'http://minio:9000' }));
  assert.throws(() => parseServerEnv({ ...valid, S3_BUCKET: '../media' }));
});
