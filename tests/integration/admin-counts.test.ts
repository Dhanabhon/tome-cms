import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('the sidebar counts a post or page once, however many languages it is written in', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { countAdminStories } = await import('../../src/server/content/admin-counts');
  const { createPost } = await import('../../src/server/content/posts');
  const { createPage } = await import('../../src/server/content/pages');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'owner-a', name: 'Owner A', email: 'owner@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'TomeCMS', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [fallback] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();

  const contentJson: EditorDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] };
  const shared = { contentJson, metaTitle: null, metaDescription: null, status: 'draft' as const };
  const postInput = { ...shared, categoryIds: [fallback.id], coverMediaId: null, excerpt: '' };

  assert.deepEqual(await countAdminStories('owner-a'), { pages: 0, posts: 0 });

  const first = await createPost('owner-a', { ...postInput, title: 'First', slug: 'first' });
  await createPost('owner-a', { ...postInput, title: 'แรก', slug: 'first-th', locale: 'th', sourcePostId: first.id });
  await createPost('owner-a', { ...postInput, title: 'Second', slug: 'second' });
  const about = await createPage('owner-a', { ...shared, title: 'About', slug: 'about' });
  await createPage('owner-a', { ...shared, title: 'เกี่ยวกับ', slug: 'about-th', locale: 'th', sourcePageId: about.id });

  // Two posts -- one of them in two languages -- and one page in two languages.
  assert.deepEqual(await countAdminStories('owner-a'), { pages: 1, posts: 2 });
  assert.deepEqual(await countAdminStories('someone-else'), { pages: 0, posts: 0 });
});
