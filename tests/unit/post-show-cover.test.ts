import assert from 'node:assert/strict';
import test from 'node:test';

// The schemas live beside the queries, so importing them reads the server environment.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://tome:tome@localhost:5432/tome',
  TOME_CMS_PUBLIC_URL: 'http://localhost:4321',
  TOME_CMS_INSTALL_TOKEN: 'install-test-secret-at-least-32-bytes',
  BETTER_AUTH_SECRET: 'better-auth-test-secret-at-least-32-bytes',
  TOME_CMS_CONTEXT_SECRET: 'cursor-test-context-secret-at-least-32-bytes',
  TOME_CMS_RECOVERY_PEPPER: 'recovery-test-secret-at-least-32-bytes',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'tome-media',
  MEDIA_PUBLIC_URL: 'http://localhost:9000/tome-media',
});
const { createPostSchema, updatePostSchema } = await import('../../src/server/content/posts');

const base = {
  title: 'T', slug: 't', contentJson: { type: 'doc', content: [] }, excerpt: '', metaTitle: null,
  metaDescription: null, status: 'draft', categoryIds: [], coverMediaId: null,
};

test('a new post shows its cover unless told otherwise', () => {
  assert.equal(createPostSchema.parse(base).showCover, true);
  assert.equal(createPostSchema.parse({ ...base, showCover: false }).showCover, false);
});

test('an update that does not mention the cover leaves it as it was', () => {
  const parsed = updatePostSchema.parse({ ...base, id: '0b3a8f4e-6a55-4d1b-9e8e-2f0f0b0f0b0f', updatedAt: '2026-09-30T00:00:00.000Z' });
  assert.equal(parsed.showCover, undefined);
});
