import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('Post and Page services own content, versions, translations, and Category writes', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { categoryIdsForPost } = await import('../../src/server/content/categories');
  const {
    createPost,
    createPostSchema,
    deletePost,
    duplicatePost,
    getPost,
    updatePost,
    updatePostStatus,
  } = await import('../../src/server/content/posts');
  const {
    createPage,
    createPageSchema,
    deletePage,
    duplicatePage,
    updatePage,
  } = await import('../../src/server/content/pages');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'owner-a', name: 'Owner A', email: 'owner@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'TomeCMS', default_locale: 'en', timezone: 'UTC', admin_path: '/studio', author_avatar_media_id: null,
  }).execute();
  const [fallback, category] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
    { owner_id: 'owner-a', name: 'Architecture', is_default: false },
  ]).returningAll().execute();

  const content: EditorDocument = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '<strong>Server owned</strong>' }] }],
  };
  const postInput = {
    categoryIds: [category.id],
    coverMediaId: null,
    excerpt: '',
    title: 'First Post',
    slug: 'first-post',
    contentJson: content,
    metaTitle: null,
    metaDescription: null,
    status: 'draft' as const,
  };
  for (const serverOwned of ['contentHtml', 'authorId', 'translationGroupId', 'publishedAt', 'unknown']) {
    assert.equal(createPostSchema.safeParse({ ...postInput, [serverOwned]: 'client-owned' }).success, false);
  }

  const createdPost = await createPost('owner-a', postInput);
  assert.match(createdPost.content_html, /&lt;strong&gt;Server owned&lt;\/strong&gt;/);
  assert.deepEqual(await categoryIdsForPost('owner-a', createdPost.id), [category.id]);
  const updatedPost = await updatePost('owner-a', {
    ...postInput,
    id: createdPost.id,
    title: 'Updated Post',
    updatedAt: createdPost.updated_at,
  });
  assert.ok(new Date(updatedPost.updated_at) > new Date(createdPost.updated_at));
  await assert.rejects(
    updatePost('owner-a', { ...postInput, id: createdPost.id, updatedAt: createdPost.updated_at }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
  const translation = await createPost('owner-a', {
    ...postInput,
    categoryIds: [category.id, fallback.id],
    locale: 'th',
    sourcePostId: createdPost.id,
    slug: 'first-post-th',
    title: 'บทความแรก',
  });
  assert.equal(translation.translation_group_id, createdPost.translation_group_id);
  assert.deepEqual(await categoryIdsForPost('owner-a', translation.id), [category.id]);
  const publishedPost = await updatePostStatus('owner-a', {
    id: translation.id,
    status: 'published',
    updatedAt: translation.updated_at,
  });
  assert.ok(publishedPost.published_at);

  // A duplicate is a second piece of writing, not a second copy on the site: it lands
  // as a draft even when the source is published, and it takes its own translation
  // group so it does not collide with the source on (translation_group_id, locale).
  const copy = await duplicatePost('owner-a', publishedPost.id);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.published_at, null);
  assert.notEqual(copy.id, publishedPost.id);
  assert.notEqual(copy.translation_group_id, publishedPost.translation_group_id);
  assert.equal(copy.locale, publishedPost.locale);
  assert.equal(copy.content_html, publishedPost.content_html);
  assert.equal(copy.title, `${publishedPost.title} (สำเนา)`, 'the marker follows the content language');
  assert.equal(copy.slug, `${publishedPost.slug}-copy`);
  // Categories hang off the group, so a new group has to carry the old set across.
  assert.deepEqual(await categoryIdsForPost('owner-a', copy.id), [category.id]);

  // The readable slug is gone the second time, so the copy falls back to one carrying
  // its own id rather than failing on the unique index.
  const second = await duplicatePost('owner-a', publishedPost.id);
  assert.notEqual(second.slug, copy.slug);
  assert.match(second.slug, new RegExp(`^${publishedPost.slug}-copy-[0-9a-f]{8}$`));
  await assert.rejects(
    duplicatePost('owner-a', createdPost.translation_group_id),
    (error: unknown) => error instanceof HttpError && error.status === 404,
    'a duplicate of something that is not a post of this owner is a 404, not a stray row',
  );

  const pageInput = {
    excerpt: '',
    title: 'About',
    slug: 'about',
    contentJson: content,
    metaTitle: null,
    metaDescription: null,
    status: 'draft' as const,
  };
  for (const serverOwned of ['contentHtml', 'authorId', 'translationGroupId', 'publishedAt', 'unknown']) {
    assert.equal(createPageSchema.safeParse({ ...pageInput, [serverOwned]: 'client-owned' }).success, false);
  }
  const createdPage = await createPage('owner-a', pageInput);
  const pageCopy = await duplicatePage('owner-a', createdPage.id);
  assert.equal(pageCopy.status, 'draft');
  assert.notEqual(pageCopy.translation_group_id, createdPage.translation_group_id);
  assert.equal(pageCopy.slug, `${createdPage.slug}-copy`);
  assert.equal(pageCopy.content_html, createdPage.content_html);

  const updatedPage = await updatePage('owner-a', {
    ...pageInput,
    id: createdPage.id,
    title: 'About TomeCMS',
    updatedAt: createdPage.updated_at,
  });
  assert.ok(new Date(updatedPage.updated_at) > new Date(createdPage.updated_at));
  await assert.rejects(
    createPage('owner-a', { ...pageInput, slug: 'blog' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    createPage('owner-a', { ...pageInput, contentJson: { type: 'doc', content: [] }, status: 'published' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );

  await deletePage('owner-a', updatedPage.id, updatedPage.updated_at);
  await deletePost('owner-a', publishedPost.id, publishedPost.updated_at);
  assert.ok(await getPost('owner-a', createdPost.id), 'deleting one edition keeps its sibling');
  await deletePost('owner-a', createdPost.id, updatedPost.updated_at);
  assert.equal(await getPost('owner-a', createdPost.id), null);
});
