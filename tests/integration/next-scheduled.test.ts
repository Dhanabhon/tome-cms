import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('the next scheduled moment is the earliest future published_at of a published post or page', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test', 'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost } = await import('../../src/server/content/posts');
  const { createPage } = await import('../../src/server/content/pages');
  const { nextScheduledPublish } = await import('../../src/server/content/live');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({ id: 'sched-owner', name: 'Owner', email: 'sched@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({ id: true, owner_id: 'sched-owner', site_name: 'S', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null }).execute();
  const [category] = await db.insertInto('categories').values([{ owner_id: 'sched-owner', name: 'Uncategorized', is_default: true }]).returningAll().execute();
  const content: EditorDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
  const base = { excerpt: '', categoryIds: [category!.id], coverMediaId: null, contentJson: content, metaDescription: null, metaTitle: null };

  assert.equal(await nextScheduledPublish(), null, 'nothing scheduled');

  const inAnHour = new Date(Date.now() + 3_600_000);
  const inTwoHours = new Date(Date.now() + 7_200_000);
  const post = await createPost('sched-owner', { ...base, slug: 'later', title: 'Later', status: 'published' });
  await db.updateTable('posts').set({ published_at: inTwoHours }).where('id', '=', post.id).execute();
  const page = await createPage('sched-owner', { contentJson: content, excerpt: '', metaDescription: null, metaTitle: null, slug: 'soon', status: 'published', title: 'Soon' });
  await db.updateTable('pages').set({ published_at: inAnHour }).where('id', '=', page.id).execute();
  // A draft with a future date is not scheduled to go public.
  const draft = await createPost('sched-owner', { ...base, slug: 'draft', title: 'Draft', status: 'draft' });
  await db.updateTable('posts').set({ published_at: new Date(Date.now() + 60_000) }).where('id', '=', draft.id).execute();

  const next = await nextScheduledPublish();
  assert.ok(next);
  assert.equal(next.getTime(), inAnHour.getTime(), 'the page, an hour away, comes first; the draft does not count');
});
