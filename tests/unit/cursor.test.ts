import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  cursorQueryHash,
  decodeCursor,
  encodeCursor,
  type CursorClaims,
  type CursorQuery,
} from '../../src/server/http/cursor';

const secret = 'cursor-test-context-secret-at-least-32-bytes';
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://tome:tome@localhost:5432/tome',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'install-test-secret-at-least-32-bytes',
  BETTER_AUTH_SECRET: 'better-auth-test-secret-at-least-32-bytes',
  TOME_CMS_CONTEXT_SECRET: secret,
  TOME_CMS_RECOVERY_PEPPER: 'recovery-test-secret-at-least-32-bytes',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'tome-media',
  MEDIA_PUBLIC_URL: 'http://localhost:9000/tome-media',
});

const query: CursorQuery = { category: 'News', locale: 'th', limit: 20 };
const claims: CursorClaims = {
  v: 1,
  resource: 'posts',
  queryHash: cursorQueryHash(query),
  publishedAt: '2026-09-08T03:00:00.000Z',
  id: '2945700a-b92e-46d2-ab94-c845249f5a6d',
};

function signPayload(payload: string): string {
  const signature = createHmac('sha256', secret)
    .update('tomecms:content-cursor:v1:signature\0')
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function signUnchecked(value: unknown): string {
  return signPayload(Buffer.from(JSON.stringify(value)).toString('base64url'));
}

test('content cursors are deterministic and bound to their resource and query', () => {
  const cursor = encodeCursor(claims);
  assert.equal(cursor, encodeCursor(claims));
  assert.deepEqual(decodeCursor(cursor, { query, resource: 'posts' }), claims);
  assert.equal(cursorQueryHash({ limit: 20, locale: 'th', category: 'News' }), claims.queryHash);

  for (const expected of [
    { query, resource: 'pages' as const },
    { query: { ...query, locale: 'en' }, resource: 'posts' as const },
    { query: { ...query, category: 'Updates' }, resource: 'posts' as const },
  ]) {
    assert.throws(() => decodeCursor(cursor, expected), /Invalid pagination cursor/);
  }
});

test('content cursors reject tampering, malformed values, and invalid claims without expiring', () => {
  const cursor = encodeCursor(claims);
  const [payload, signature] = cursor.split('.');
  const invalid = [
    '',
    'payload-only',
    `${cursor}.extra`,
    '***.***',
    `${payload}.${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`,
    signPayload(Buffer.from('{').toString('base64url')),
    signUnchecked('not-an-object'),
    signUnchecked({ ...claims, v: 2 }),
    signUnchecked({ ...claims, publishedAt: 'not-a-date' }),
    signUnchecked({ ...claims, id: 'not-a-uuid' }),
    signUnchecked({ ...claims, extra: true }),
  ];
  for (const value of invalid) {
    assert.throws(() => decodeCursor(value, { query, resource: 'posts' }), /Invalid pagination cursor/);
  }

  assert.deepEqual(decodeCursor(cursor, { query, resource: 'posts' }), claims);
});
