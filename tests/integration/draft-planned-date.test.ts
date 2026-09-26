import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a draft keeps the date it is planned for, and publishing spends it', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, getPost, updatePost, updatePostStatus } = await import('../../src/server/content/posts');
  const { createPage, updatePageStatus } = await import('../../src/server/content/pages');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'planning-owner', name: 'Planning Owner', email: 'planning@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'planning-owner', site_name: 'TomeCMS', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [category] = await db.insertInto('categories').values([
    { owner_id: 'planning-owner', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();
  assert.ok(category);

  const content: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  };
  const base = {
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson: content, metaDescription: null, metaTitle: null,
  };
  const friday = new Date(Date.now() + 86_400_000).toISOString();
  const monday = new Date(Date.now() + 4 * 86_400_000).toISOString();

  // Filed with a date: the draft is not out, and it keeps the date for when it will be.
  const created = await createPost('planning-owner', { ...base, publishedAt: friday, slug: 'planned', status: 'draft', title: 'Planned' });
  assert.equal(created.published_at, null, 'a draft is still not published');
  assert.equal(created.planned_at, friday, 'but it keeps the date it was given');
  assert.equal((await getPost('planning-owner', created.id))?.planned_at, friday, 'and the next visit reads it back');

  // A save that says nothing about the date keeps it; a new date replaces it; an emptied field empties it.
  const kept = await updatePost('planning-owner', {
    ...base, id: created.id, slug: 'planned', status: 'draft', title: 'Planned, edited', updatedAt: created.updated_at,
  });
  assert.equal(kept.planned_at, friday, 'a save with no date keeps the one it had');
  const moved = await updatePost('planning-owner', {
    ...base, id: created.id, publishedAt: monday, slug: 'planned', status: 'draft', title: 'Planned', updatedAt: kept.updated_at,
  });
  assert.equal(moved.planned_at, monday, 'a new date replaces it');
  const cleared = await updatePost('planning-owner', {
    ...base, id: created.id, publishedAt: null, slug: 'planned', status: 'draft', title: 'Planned', updatedAt: moved.updated_at,
  });
  assert.equal(cleared.planned_at, null, 'an emptied field empties it');

  // Published on its date: the date becomes the publication date, and nothing is left planned.
  const replanned = await updatePostStatus('planning-owner', {
    id: created.id, publishedAt: friday, status: 'draft', updatedAt: cleared.updated_at,
  });
  assert.equal(replanned.planned_at, friday, 'a status save keeps a draft’s date too');
  const published = await updatePostStatus('planning-owner', {
    id: created.id, publishedAt: friday, status: 'published', updatedAt: replanned.updated_at,
  });
  assert.equal(published.published_at, friday);
  assert.equal(published.planned_at, null, 'a published post has its date, and no plan');

  // The database holds the rule as well as the code: a published row with a plan is refused.
  await assert.rejects(
    db.updateTable('posts').set({ planned_at: new Date(friday) }).where('id', '=', created.id).execute(),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );

  // Pages the same way; publishing from the list names no date and spends the plan.
  const page = await createPage('planning-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null,
    publishedAt: friday, slug: 'planned-page', status: 'draft', title: 'Planned page',
  });
  assert.equal(page.published_at, null);
  assert.equal(page.planned_at, friday);
  const pagePublished = await updatePageStatus('planning-owner', { id: page.id, status: 'published', updatedAt: page.updated_at });
  assert.ok(pagePublished.published_at, 'published now, as the list always did');
  assert.equal(pagePublished.planned_at, null);
});
