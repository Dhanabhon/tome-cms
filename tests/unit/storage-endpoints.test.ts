import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'install-token-only-32-characters',
  BETTER_AUTH_SECRET: 'better-auth-test-secret-32-characters',
  TOME_CMS_CONTEXT_SECRET: 'context-test-secret-only-32-characters',
  TOME_CMS_RECOVERY_PEPPER: 'recovery-test-pepper-32-characters',
  S3_ENDPOINT: 'https://media.example.com',
  S3_INTERNAL_ENDPOINT: 'http://storage.internal:8333',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'unit-test-access',
  S3_SECRET_ACCESS_KEY: 'unit-test-secret',
  S3_BUCKET: 'unit-test-media',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_PUBLIC_URL: 'https://media.example.com/unit-test-media/',
} as const;
Object.assign(process.env, env);

test('the server endpoint is the internal one when set, the bundled store on a managed install, else the public one', async () => {
  const { storageEndpoints } = await import('../../src/server/media/storage');
  const publicOnly = { S3_ENDPOINT: 'https://media.example.com', S3_INTERNAL_ENDPOINT: undefined, TOME_CMS_UPDATE_MODE: 'check-only' } as const;
  assert.deepEqual(storageEndpoints({ ...publicOnly, S3_INTERNAL_ENDPOINT: 'http://10.0.0.5:8333' }),
    { presign: 'https://media.example.com', server: 'http://10.0.0.5:8333' });
  assert.deepEqual(storageEndpoints({ ...publicOnly, TOME_CMS_UPDATE_MODE: 'managed' }),
    { presign: 'https://media.example.com', server: 'http://seaweedfs:8333' });
  assert.deepEqual(storageEndpoints(publicOnly), { presign: 'https://media.example.com', server: 'https://media.example.com' });
  // An explicit address beats the managed default.
  assert.equal(storageEndpoints({ ...publicOnly, S3_INTERNAL_ENDPOINT: 'https://s3.lan', TOME_CMS_UPDATE_MODE: 'managed' }).server, 'https://s3.lan');
});

test('a presigned URL carries the public host and the app calls the internal one', async () => {
  const { s3, s3Presign } = await import('../../src/server/media/storage');
  const url = new URL(await getSignedUrl(s3Presign, new PutObjectCommand({ Bucket: 'unit-test-media', Key: 'a.pdf' }), { expiresIn: 60 }));
  assert.equal(url.origin, 'https://media.example.com');
  const server = await s3.config.endpoint?.();
  assert.equal(`${server?.protocol}//${server?.hostname}:${server?.port}`, 'http://storage.internal:8333');
  assert.equal(await s3.config.forcePathStyle, await s3Presign.config.forcePathStyle);
  assert.equal(await s3.config.region(), await s3Presign.config.region());
});

test('the managed compose file gives the app the same internal address the code defaults to', async () => {
  const { storageEndpoints } = await import('../../src/server/media/storage');
  const { server } = storageEndpoints({ S3_ENDPOINT: 'https://m.example.com', S3_INTERNAL_ENDPOINT: undefined, TOME_CMS_UPDATE_MODE: 'managed' });
  assert.match(readFileSync('compose.managed.yaml', 'utf8'), new RegExp(`^ {6}S3_INTERNAL_ENDPOINT: ${server}$`, 'm'));
});
