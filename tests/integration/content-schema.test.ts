import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Migrator } from 'kysely/migration';

import type { EditorDocument } from '../../src/types/cms';

test('content schema keeps ownership, translation, category, and navigation invariants', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrations } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);

  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  const foundation = await migrator.migrateTo('004_session_credential_recovery');
  assert.ifError(foundation.error);
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: false, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: false, image: null, role: 'owner' },
  ]).execute();
  await db.insertInto('site_settings').values({
    id: true,
    owner_id: 'owner-a',
    site_name: 'Content Test',
    default_locale: 'en',
    timezone: 'UTC',
    admin_path: '/admin',
    author_avatar_media_id: null,
  }).execute();
  const migrated = await migrator.migrateToLatest();
  assert.ifError(migrated.error);

  const defaultCategory = await db.selectFrom('categories').selectAll()
    .where('owner_id', '=', 'owner-a').where('is_default', '=', true).executeTakeFirstOrThrow();
  assert.equal(defaultCategory.name, 'Uncategorized', 'migration backfills the finalized owner');
  const ownerBDefault = await db.insertInto('categories')
    .values({ owner_id: 'owner-b', name: 'Uncategorized', is_default: true })
    .returningAll().executeTakeFirstOrThrow();

  const contentJson: EditorDocument = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Content' }] }],
  };
  const postGroupId = randomUUID();
  const postId = randomUUID();
  const pageGroupId = randomUUID();
  const pageId = randomUUID();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values({ id: postGroupId, owner_id: 'owner-a' }).execute();
    await trx.insertInto('posts').values({
      id: postId,
      translation_group_id: postGroupId,
      locale: 'en',
      title: 'First post',
      slug: 'first-post',
      cover_media_id: null,
      content_json: contentJson,
      content_html: '<p>Content</p>',
      meta_title: null,
      meta_description: null,
      status: 'published',
      published_at: new Date('2000-01-01T00:00:00Z'),
      owner_id: 'owner-a',
    }).execute();
    await trx.insertInto('post_category_assignments').values({
      translation_group_id: postGroupId,
      category_id: defaultCategory.id,
      owner_id: 'owner-a',
    }).execute();
    await trx.insertInto('page_translation_groups').values({ id: pageGroupId, owner_id: 'owner-a' }).execute();
    await trx.insertInto('pages').values({
      id: pageId,
      translation_group_id: pageGroupId,
      locale: 'en',
      title: 'About',
      slug: 'about',
      content_json: contentJson,
      content_html: '<p>Content</p>',
      meta_title: null,
      meta_description: null,
      status: 'draft',
      published_at: null,
      owner_id: 'owner-a',
    }).execute();
  });

  const published = await db.selectFrom('posts').select('published_at').where('id', '=', postId).executeTakeFirstOrThrow();
  assert.ok(published.published_at instanceof Date);
  // The database supplies a publication time; it no longer overrules one. A write that
  // names a date is an owner scheduling a post or dating an old one, and the row keeps what
  // it was given -- see tests/integration/scheduled-publishing.test.ts for what that buys.
  assert.equal(published.published_at.toISOString(), '2000-01-01T00:00:00.000Z', 'a named date is kept');
  await db.updateTable('posts').set({ status: 'draft' }).where('id', '=', postId).execute();
  assert.equal((await db.selectFrom('posts').select('published_at').where('id', '=', postId).executeTakeFirstOrThrow()).published_at, null);
  await db.insertInto('posts').values({
    translation_group_id: postGroupId,
    locale: 'th',
    title: 'บทความแรก',
    slug: 'first-post-th',
    cover_media_id: null,
    content_json: contentJson,
    content_html: '<p>Content</p>',
    meta_title: null,
    meta_description: null,
    status: 'draft',
    published_at: null,
    owner_id: 'owner-a',
  }).execute();
  assert.equal(
    Number((await db.selectFrom('posts').select(({ fn }) => fn.countAll<number>().as('count'))
      .where('translation_group_id', '=', postGroupId).executeTakeFirstOrThrow()).count),
    2,
    'language editions share one translation group',
  );

  await assert.rejects(
    db.insertInto('posts').values({
      translation_group_id: postGroupId,
      locale: 'en',
      title: 'Duplicate edition',
      slug: 'another-slug',
      cover_media_id: null,
      content_json: contentJson,
      content_html: '<p>Content</p>',
      meta_title: null,
      meta_description: null,
      status: 'draft',
      published_at: null,
      owner_id: 'owner-a',
    }).execute(),
    { code: '23505' },
  );
  await assert.rejects(
    db.updateTable('posts').set({ owner_id: 'owner-b' }).where('id', '=', postId).execute(),
    { code: '23503' },
  );
  await assert.rejects(
    db.insertInto('post_translation_groups').values({ owner_id: 'owner-b' }).execute(),
    { code: '23514' },
  );
  await assert.rejects(
    db.updateTable('posts').set({ content_html: 'x'.repeat(1_000_001) }).where('id', '=', postId).execute(),
    { code: '23514' },
  );
  await assert.rejects(
    db.updateTable('posts').set({
      content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(1_000_001) }] }] },
    }).where('id', '=', postId).execute(),
    { code: '23514' },
  );

  const customCategory = await db.insertInto('categories')
    .values({ owner_id: 'owner-a', name: 'News', is_default: false }).returningAll().executeTakeFirstOrThrow();
  await assert.rejects(
    db.insertInto('categories').values({ owner_id: 'owner-a', name: 'news', is_default: false }).execute(),
    { code: '23505' },
  );
  await assert.rejects(
    db.deleteFrom('categories').where('id', '=', defaultCategory.id).execute(),
    { code: '23514' },
  );
  await assert.rejects(
    db.updateTable('categories').set({ name: 'Renamed' }).where('id', '=', defaultCategory.id).execute(),
    { code: '23514' },
  );
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_category_assignments').values({
      translation_group_id: postGroupId,
      category_id: customCategory.id,
      owner_id: 'owner-a',
    }).execute();
    await trx.deleteFrom('post_category_assignments')
      .where('translation_group_id', '=', postGroupId)
      .where('category_id', '=', defaultCategory.id)
      .execute();
  });
  await assert.rejects(
    db.deleteFrom('categories').where('id', '=', customCategory.id).execute(),
    { code: '23514' },
  );
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_category_assignments').values({
      translation_group_id: postGroupId,
      category_id: defaultCategory.id,
      owner_id: 'owner-a',
    }).execute();
    await trx.deleteFrom('categories').where('id', '=', customCategory.id).execute();
  });
  assert.deepEqual(
    await db.selectFrom('post_category_assignments').select('category_id')
      .where('translation_group_id', '=', postGroupId).execute(),
    [{ category_id: defaultCategory.id }],
  );
  await assert.rejects(
    db.insertInto('post_category_assignments').values({
      translation_group_id: postGroupId,
      category_id: ownerBDefault.id,
      owner_id: 'owner-a',
    }).execute(),
    { code: '23503' },
  );

  await db.insertInto('navigation_items').values([
    { owner_id: 'owner-a', locale: 'en', location: 'header', kind: 'home', label: 'Home', page_id: null, url: null, position: 0 },
    { owner_id: 'owner-a', locale: 'en', location: 'header', kind: 'page', label: 'About', page_id: pageId, url: null, position: 1 },
    { owner_id: 'owner-a', locale: 'en', location: 'header', kind: 'custom', label: 'Docs', page_id: null, url: 'https://example.com/docs', position: 2 },
  ]).execute();
  await assert.rejects(
    db.transaction().execute(async (trx) => {
      await trx.deleteFrom('navigation_items')
        .where('owner_id', '=', 'owner-a').where('locale', '=', 'en').where('location', '=', 'header').execute();
      await trx.insertInto('navigation_items').values({
        owner_id: 'owner-a', locale: 'en', location: 'header', kind: 'home', label: 'Broken', page_id: null, url: '/invalid', position: 0,
      }).execute();
    }),
    { code: '23514' },
  );
  assert.equal(
    Number((await db.selectFrom('navigation_items').select(({ fn }) => fn.countAll<number>().as('count'))
      .where('owner_id', '=', 'owner-a').executeTakeFirstOrThrow()).count),
    3,
    'a failed complete replacement leaves the old menu intact',
  );

  await db.deleteFrom('user').where('id', '=', 'owner-a').execute();
  for (const table of ['site_settings', 'post_translation_groups', 'page_translation_groups', 'posts', 'pages', 'categories', 'post_category_assignments', 'navigation_items'] as const) {
    assert.equal(
      Number((await db.selectFrom(table).select(({ fn }) => fn.countAll<number>().as('count'))
        .where('owner_id', '=', 'owner-a').executeTakeFirstOrThrow()).count),
      0,
      `${table} cascades with its owner`,
    );
  }
});
