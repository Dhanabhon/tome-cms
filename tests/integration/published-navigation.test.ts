import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('published content and Navigation stay locale-safe and draft-safe', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost } = await import('../../src/server/content/posts');
  const { createPage, updatePageStatus } = await import('../../src/server/content/pages');
  const {
    getPublicNavigation,
    listNavigation,
    navigationMenuSchema,
    replaceNavigation,
  } = await import('../../src/server/content/navigation');
  const {
    getPublishedPage,
    getPublishedPost,
    listPublishedPageAlternates,
    listPublishedPages,
    listPublishedPostAlternates,
    listPublishedPostCategories,
    listPublishedPosts,
  } = await import('../../src/server/content/published');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'public-owner', name: 'Public Owner', email: 'public@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'public-owner', site_name: 'TomeCMS', default_locale: 'th', timezone: 'UTC', admin_path: '/studio', author_avatar_media_id: null,
  }).execute();
  const [fallback, architecture] = await db.insertInto('categories').values([
    { owner_id: 'public-owner', name: 'Uncategorized', is_default: true },
    { owner_id: 'public-owner', name: 'Architecture', is_default: false },
  ]).returningAll().execute();
  assert.ok(fallback);

  const content: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Published body' }] }],
  };
  const postInput = {
    excerpt: '',
    categoryIds: [architecture.id], coverMediaId: null, contentJson: content,
    metaDescription: null, metaTitle: null, slug: 'published-post', status: 'published' as const, title: 'Published Post',
  };
  const thaiPost = await createPost('public-owner', postInput);
  const englishPost = await createPost('public-owner', {
    ...postInput, locale: 'en', sourcePostId: thaiPost.id, slug: 'published-post-en', title: 'Published Post EN',
  });
  await createPost('public-owner', {
    ...postInput, slug: 'draft-post', status: 'draft', title: 'Draft Post',
  });

  assert.deepEqual((await listPublishedPosts({ locale: 'th' })).items.map(({ id }) => id), [thaiPost.id]);
  assert.equal(await getPublishedPost('en', thaiPost.slug), null);
  assert.deepEqual(await listPublishedPostAlternates(thaiPost.translation_group_id), [
    { href: `/en/blog/${englishPost.slug}`, locale: 'en' },
    { href: `/th/blog/${thaiPost.slug}`, locale: 'th' },
  ]);
  assert.deepEqual(await listPublishedPostCategories(thaiPost.translation_group_id), [
    { id: architecture.id, name: architecture.name },
  ]);

  const publishedPage = await createPage('public-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null, slug: 'about', status: 'published', title: 'About',
  });
  const englishPage = await createPage('public-owner', {
    contentJson: content, excerpt: '', locale: 'en', metaDescription: null, metaTitle: null, slug: 'about-en',
    sourcePageId: publishedPage.id, status: 'published', title: 'About EN',
  });
  const draftPage = await createPage('public-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null, slug: 'draft-page', status: 'draft', title: 'Draft Page',
  });
  assert.deepEqual(await listPublishedPageAlternates(publishedPage.translation_group_id), [
    { href: `/en/${englishPage.slug}`, locale: 'en' },
    { href: `/th/${publishedPage.slug}`, locale: 'th' },
  ]);
  assert.equal(await getPublishedPage('th', draftPage.slug), null);
  assert.equal((await listPublishedPages({ locale: 'th' })).items.some(({ id }) => id === draftPage.id), false);

  assert.equal(navigationMenuSchema.safeParse({
    locale: 'th', location: 'header', items: [{ kind: 'custom', label: 'Bad', pageId: null, url: 'javascript:alert(1)' }],
  }).success, false);
  const menu = navigationMenuSchema.parse({
    locale: 'th', location: 'header', items: [
      { kind: 'home', label: 'Home', pageId: null, url: null },
      { kind: 'page', label: 'Draft', pageId: draftPage.id, url: null },
      { kind: 'page', label: 'About', pageId: publishedPage.id, url: null },
      { kind: 'custom', label: 'External', pageId: null, url: 'https://example.com' },
    ],
  });
  await replaceNavigation('public-owner', menu);
  assert.deepEqual((await getPublicNavigation('th')).header, [
    { href: '/th', kind: 'home', label: 'Home' },
    { href: '/th/about', kind: 'page', label: 'About' },
    { href: 'https://example.com/', kind: 'custom', label: 'External' },
  ]);

  await assert.rejects(
    replaceNavigation('public-owner', navigationMenuSchema.parse({
      locale: 'th', location: 'header', items: [{ kind: 'page', label: 'Wrong locale', pageId: englishPage.id, url: null }],
    })),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.equal((await listNavigation('public-owner')).items.length, 4, 'a rejected replacement keeps the prior menu');

  await updatePageStatus('public-owner', {
    id: publishedPage.id, status: 'draft', updatedAt: publishedPage.updated_at,
  });
  assert.equal((await getPublicNavigation('th')).header.some(({ kind }) => kind === 'page'), false);
});
