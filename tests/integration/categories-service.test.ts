import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('Category services preserve shared membership, ownership, and fallback', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const {
    categoryIdsForPost,
    createCategory,
    deleteCategory,
    listCategories,
    renameCategory,
    replacePostCategories,
  } = await import('../../src/server/content/categories');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: true, image: null, role: 'owner' },
  ]).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'TomeCMS', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [fallback, foreign] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
    { owner_id: 'owner-b', name: 'Foreign', is_default: false },
  ]).returningAll().execute();
  const alpha = await createCategory('owner-a', '  Alpha  ');
  const zeta = await createCategory('owner-a', 'Zeta');
  assert.equal(alpha.name, 'Alpha');
  await assert.rejects(
    createCategory('owner-a', 'aLPHa'),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );

  const content: EditorDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
  const firstGroup = randomUUID();
  const secondGroup = randomUUID();
  const firstTh = randomUUID();
  const firstEn = randomUUID();
  const secondEn = randomUUID();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values([
      { id: firstGroup, owner_id: 'owner-a' },
      { id: secondGroup, owner_id: 'owner-a' },
    ]).execute();
    await trx.insertInto('posts').values([
      { id: firstTh, translation_group_id: firstGroup, locale: 'th', title: 'หนึ่ง', slug: 'first-th', cover_media_id: null, content_json: content, content_html: '<p></p>', meta_title: null, meta_description: null, status: 'draft', published_at: null, owner_id: 'owner-a' },
      { id: firstEn, translation_group_id: firstGroup, locale: 'en', title: 'One', slug: 'first-en', cover_media_id: null, content_json: content, content_html: '<p></p>', meta_title: null, meta_description: null, status: 'draft', published_at: null, owner_id: 'owner-a' },
      { id: secondEn, translation_group_id: secondGroup, locale: 'en', title: 'Two', slug: 'second-en', cover_media_id: null, content_json: content, content_html: '<p></p>', meta_title: null, meta_description: null, status: 'draft', published_at: null, owner_id: 'owner-a' },
    ]).execute();
    await trx.insertInto('post_category_assignments').values([
      { translation_group_id: firstGroup, category_id: fallback.id, owner_id: 'owner-a' },
      { translation_group_id: secondGroup, category_id: fallback.id, owner_id: 'owner-a' },
    ]).execute();
  });

  assert.deepEqual(await replacePostCategories('owner-a', firstTh, [alpha.id]), [alpha.id]);
  assert.deepEqual(await categoryIdsForPost('owner-a', firstEn), [alpha.id], 'language editions share membership');
  assert.deepEqual(await replacePostCategories('owner-a', secondEn, [zeta.id, fallback.id, alpha.id]), [alpha.id, zeta.id].sort());
  assert.deepEqual(
    (await listCategories('owner-a')).map(({ name, postCount }) => ({ name, postCount })),
    [
      { name: 'Uncategorized', postCount: 0 },
      { name: 'Alpha', postCount: 2 },
      { name: 'Zeta', postCount: 1 },
    ],
  );

  await assert.rejects(
    replacePostCategories('owner-a', firstTh, [foreign.id]),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.deepEqual(await categoryIdsForPost('owner-a', firstTh), [alpha.id], 'failed replacement is atomic');
  await assert.rejects(
    deleteCategory('owner-a', fallback.id),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );

  const beta = await renameCategory('owner-a', zeta.id, '  Beta  ');
  assert.equal(beta.name, 'Beta');
  assert.deepEqual(await deleteCategory('owner-a', alpha.id), { affectedPostGroups: 2 });
  assert.deepEqual(await categoryIdsForPost('owner-a', firstTh), [fallback.id]);
  assert.deepEqual(await categoryIdsForPost('owner-a', secondEn), [beta.id]);

  await assert.rejects(
    categoryIdsForPost('owner-b', firstTh),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});
