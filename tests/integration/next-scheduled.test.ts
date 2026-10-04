import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('the next scheduled moment is the earliest of a post or page going public and an enabled home slide starting or ending', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test', 'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost } = await import('../../src/server/content/posts');
  const { createPage } = await import('../../src/server/content/pages');
  const { nextScheduledPublish } = await import('../../src/server/content/live');
  const { replaceSlides } = await import('../../src/server/content/slides');
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
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

  // A home slide starts and ends with no write, so its edges expire a cached home page too.
  const lake = (await db.insertInto('media_items').values({
    owner_id: 'sched-owner', folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'A lake at dawn', state: 'ready',
    delete_error_code: null, object_key: 'owners/sched-owner/2026/09/lake.jpg', original_name: 'lake.jpg',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow()).id;
  const saveSlide = (slide: Record<string, unknown>) => replaceSlides('sched-owner', homeSlidesSchema.parse({ locale: 'en', slides: [{ mediaId: lake, ...slide }] }));

  const inHalfAnHour = new Date(Date.now() + 1_800_000);
  await saveSlide({ startsAt: inHalfAnHour.toISOString() });
  assert.equal((await nextScheduledPublish())?.getTime(), inHalfAnHour.getTime(), 'a slide starting in 30 minutes comes before the page');

  const inTwentyMinutes = new Date(Date.now() + 1_200_000);
  await saveSlide({ endsAt: inTwentyMinutes.toISOString() });
  assert.equal((await nextScheduledPublish())?.getTime(), inTwentyMinutes.getTime(), 'a live slide that ends in 20 minutes');

  await saveSlide({ enabled: false, startsAt: new Date(Date.now() + 600_000).toISOString() });
  assert.equal((await nextScheduledPublish())?.getTime(), inAnHour.getTime(), 'a disabled slide never goes live, so its start is not a moment');
});
