import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument, SupportedImageType } from '../../src/types/cms';

test('media schema owns identity, state, references, and tenant boundaries', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: true, image: null, role: 'owner' },
  ]).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'Media Test', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const defaultCategory = await db.insertInto('categories')
    .values({ owner_id: 'owner-a', name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const [folderA, folderB] = await db.insertInto('media_folders').values([
    { owner_id: 'owner-a', name: 'Covers' },
    { owner_id: 'owner-b', name: 'Private' },
  ]).returningAll().execute();
  await assert.rejects(
    db.insertInto('media_folders').values({ owner_id: 'owner-a', name: 'covers' }).execute(),
    { code: '23505' },
  );

  const checksum = `${'A'.repeat(43)}=`;
  const baseItem = {
    owner_id: 'owner-a', folder_id: folderA.id, original_name: 'cover.png', mime_type: 'image/png' as SupportedImageType,
    size_bytes: 128, checksum_sha256: checksum, width: 16, height: 9, alt_text: null, state: 'ready' as const, delete_error_code: null,
  };
  const itemA = await db.insertInto('media_items')
    .values({ ...baseItem, object_key: 'owners/a/2026/09/one.png' })
    .returningAll().executeTakeFirstOrThrow();
  await assert.rejects(
    db.insertInto('media_items').values({ ...baseItem, folder_id: folderB.id, object_key: 'owners/a/2026/09/wrong-owner.png' }).execute(),
    { code: '23503' },
  );
  await assert.rejects(
    db.insertInto('media_items').values({ ...baseItem, object_key: itemA.object_key }).execute(),
    { code: '23505' },
  );
  for (const invalid of [
    { mime_type: 'image/svg+xml' as SupportedImageType, object_key: 'invalid-mime' },
    { size_bytes: 0, object_key: 'invalid-size' },
    { width: 0, object_key: 'invalid-width' },
    { state: 'delete_failed' as const, delete_error_code: null, object_key: 'invalid-state' },
  ]) {
    await assert.rejects(db.insertInto('media_items').values({ ...baseItem, ...invalid }).execute(), { code: '23514' });
  }

  const reservation = await db.insertInto('media_upload_reservations').values({
    owner_id: 'owner-a', folder_id: folderA.id, object_key: 'owners/a/2026/09/reserved.png', original_name: 'reserved.png',
    mime_type: 'image/png', expected_size_bytes: 256, expected_checksum_sha256: checksum, alt_text: null,
    state: 'pending', expires_at: new Date(Date.now() + 300_000), finalized_at: null,
  }).returningAll().executeTakeFirstOrThrow();
  await assert.rejects(db.insertInto('media_upload_reservations').values({
    owner_id: 'owner-a', folder_id: null, object_key: 'expired-before-created', original_name: 'bad.png', mime_type: 'image/png',
    expected_size_bytes: 1, expected_checksum_sha256: checksum, alt_text: null, state: 'pending',
    expires_at: new Date(Date.now() - 1_000), finalized_at: null,
  }).execute(), { code: '23514' });
  await assert.rejects(
    db.updateTable('media_upload_reservations').set({ state: 'finalized' }).where('id', '=', reservation.id).execute(),
    { code: '23514' },
  );
  const finalizedAt = new Date();
  await db.updateTable('media_upload_reservations').set({ state: 'finalized', finalized_at: finalizedAt })
    .where('id', '=', reservation.id).execute();
  await assert.rejects(
    db.updateTable('media_upload_reservations').set({ state: 'pending', finalized_at: null }).where('id', '=', reservation.id).execute(),
    { code: '23514' },
  );

  const content: EditorDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
  const groupId = randomUUID();
  const postId = randomUUID();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values({ id: groupId, owner_id: 'owner-a' }).execute();
    await trx.insertInto('posts').values({
      id: postId, translation_group_id: groupId, locale: 'en', title: 'Media Post', slug: 'media-post',
      cover_media_id: itemA.id, content_json: content, content_html: '<p></p>', meta_title: null,
      meta_description: null, status: 'draft', published_at: null, owner_id: 'owner-a',
    }).execute();
    await trx.insertInto('post_category_assignments').values({
      translation_group_id: groupId, category_id: defaultCategory.id, owner_id: 'owner-a',
    }).execute();
  });
  await db.updateTable('site_settings').set({ author_avatar_media_id: itemA.id }).where('id', '=', true).execute();
  const itemB = await db.insertInto('media_items').values({
    ...baseItem, owner_id: 'owner-b', folder_id: folderB.id, object_key: 'owners/b/2026/09/private.png',
  }).returning('id').executeTakeFirstOrThrow();
  await assert.rejects(
    db.updateTable('posts').set({ cover_media_id: itemB.id }).where('id', '=', postId).execute(),
    { code: '23503' },
  );
  await assert.rejects(
    db.updateTable('site_settings').set({ author_avatar_media_id: itemB.id }).where('id', '=', true).execute(),
    { code: '23503' },
  );

  await db.deleteFrom('media_folders').where('id', '=', folderA.id).execute();
  assert.equal((await db.selectFrom('media_items').select('folder_id').where('id', '=', itemA.id).executeTakeFirstOrThrow()).folder_id, null);
  assert.equal((await db.selectFrom('media_upload_reservations').select('folder_id').where('id', '=', reservation.id).executeTakeFirstOrThrow()).folder_id, null);
  await db.deleteFrom('media_items').where('id', '=', itemA.id).execute();
  assert.equal((await db.selectFrom('posts').select('cover_media_id').where('id', '=', postId).executeTakeFirstOrThrow()).cover_media_id, null);
  assert.equal((await db.selectFrom('site_settings').select('author_avatar_media_id').where('id', '=', true).executeTakeFirstOrThrow()).author_avatar_media_id, null);
  await db.deleteFrom('user').where('id', '=', 'owner-b').execute();
  assert.equal(await db.selectFrom('media_items').select('id').where('id', '=', itemB.id).executeTakeFirst(), undefined);
});
