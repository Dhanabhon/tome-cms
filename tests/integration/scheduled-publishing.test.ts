import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a post published for later is nobody else\'s until then', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, updatePostStatus } = await import('../../src/server/content/posts');
  const { createPage, updatePageStatus } = await import('../../src/server/content/pages');
  const { getPublicNavigation, navigationMenuSchema, replaceNavigation } = await import('../../src/server/content/navigation');
  const {
    getPublishedPage,
    getPublishedPost,
    listPublishedCategories,
    listPublishedPageAlternates,
    listPublishedPostAlternates,
    listPublishedPages,
    listPublishedPosts,
  } = await import('../../src/server/content/published');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'later-owner', name: 'Later Owner', email: 'later@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'later-owner', site_name: 'TomeCMS', default_locale: 'th', timezone: 'UTC', admin_path: '/studio', author_avatar_media_id: null,
  }).execute();
  const [category] = await db.insertInto('categories').values([
    { owner_id: 'later-owner', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();
  assert.ok(category);

  const content: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  };
  const base = {
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson: content,
    metaDescription: null, metaTitle: null, status: 'published' as const,
  };
  const friday = new Date(Date.now() + 86_400_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();

  const now = await createPost('later-owner', { ...base, slug: 'out-now', title: 'Out now' });
  const later = await createPost('later-owner', { ...base, slug: 'out-later', title: 'Out later' });
  const alternate = await createPost('later-owner', {
    ...base, locale: 'en', slug: 'out-later-en', sourcePostId: later.id, title: 'Out later EN',
  });

  // Publishing without a date behaves as it always did.
  assert.ok(now.published_at, 'publishing stamps the moment');
  const scheduled = await updatePostStatus('later-owner', {
    id: later.id, publishedAt: friday, status: 'published', updatedAt: later.updated_at,
  });
  assert.equal(new Date(scheduled.published_at ?? 0).toISOString(), friday, 'and a named date is kept');
  await updatePostStatus('later-owner', {
    id: alternate.id, publishedAt: friday, status: 'published', updatedAt: alternate.updated_at,
  });

  // Every way a reader could reach it, which is the point of asking all of them: a post
  // that is not on the homepage must not be in a category count or an hreflang link either.
  assert.deepEqual(
    (await listPublishedPosts({ locale: 'th' })).items.map(({ slug }) => slug),
    ['out-now'],
    'the feed holds only what is out',
  );
  assert.equal(await getPublishedPost('th', 'out-later'), null, 'and its own address is not found');
  assert.deepEqual(await listPublishedPostAlternates(later.translation_group_id), [], 'no hreflang to it');
  assert.equal(
    (await listPublishedCategories('th')).items.some(({ id }) => id === category.id),
    true,
    'a category with something out is still a category',
  );

  // A category whose only post is still to come is a category with nothing behind it.
  await updatePostStatus('later-owner', {
    id: now.id, status: 'draft', updatedAt: now.updated_at,
  });
  assert.deepEqual((await listPublishedCategories('th')).items, [], 'and one with nothing is not');

  // The moment arrives.
  const arrived = await updatePostStatus('later-owner', {
    id: later.id, publishedAt: yesterday, status: 'published', updatedAt: scheduled.updated_at,
  });
  assert.deepEqual(
    (await listPublishedPosts({ locale: 'th' })).items.map(({ slug }) => slug),
    ['out-later'],
    'a date that has come is a post that is out',
  );
  assert.ok(await getPublishedPost('th', 'out-later'), 'and its address answers');

  // A draft has no date at all, whatever it was given: it has not been published.
  const draftAgain = await updatePostStatus('later-owner', {
    id: later.id, publishedAt: friday, status: 'draft', updatedAt: arrived.updated_at,
  });
  assert.equal(draftAgain.published_at, null, 'a draft keeps no date it is not using');

  // Pages the same way, including the menu, which is a link a reader can follow.
  const page = await createPage('later-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null,
    slug: 'coming', status: 'published', title: 'Coming',
  });
  await updatePageStatus('later-owner', {
    id: page.id, publishedAt: friday, status: 'published', updatedAt: page.updated_at,
  });
  assert.equal((await listPublishedPages({ locale: 'th' })).items.length, 0, 'not among the pages');
  assert.equal(await getPublishedPage('th', 'coming'), null, 'not at its address');
  assert.deepEqual(await listPublishedPageAlternates(page.translation_group_id), [], 'not an alternate');

  await replaceNavigation('later-owner', navigationMenuSchema.parse({
    locale: 'th', location: 'header', items: [{ kind: 'page', label: 'Coming', pageId: page.id, url: null }],
  }));
  assert.deepEqual(
    (await getPublicNavigation('th')).header,
    [],
    'and not a menu item either -- a link to a page that answers 404 is worse than no link',
  );
});
