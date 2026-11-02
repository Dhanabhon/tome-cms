import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a post refuses a post list and a page keeps one', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test', 'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { ValidationError } = await import('../../src/server/content/editor');
  const { createPage, updatePage, updatePageStatus } = await import('../../src/server/content/pages');
  const { createPost, updatePost, updatePostStatus } = await import('../../src/server/content/posts');
  const { POST_LIST_PLACEHOLDER } = await import('../../src/lib/editor-post-list');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'post-list@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Post list', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();

  const words: EditorDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words' }] }] };
  const block: EditorDocument = {
    type: 'doc',
    content: [{ type: 'postList', attrs: { source: 'category', postGroupIds: [], categoryId: category.id, limit: 6, layout: 'grid-3' } }],
  };
  const common = { excerpt: '', metaDescription: null, metaTitle: null, status: 'draft' as const };
  const postFields = { ...common, categoryIds: [category.id], coverMediaId: null };

  await assert.rejects(createPost(ownerId, { ...postFields, contentJson: block, slug: 'refused', title: 'Refused' }), ValidationError);

  const post = await createPost(ownerId, { ...postFields, contentJson: words, slug: 'a-post', title: 'A post' });
  await assert.rejects(updatePost(ownerId, {
    ...postFields, contentJson: block, id: post.id, slug: post.slug, title: post.title, updatedAt: post.updated_at,
  }), ValidationError);

  // Publishing reads the stored document, so a block written around the service is refused there too.
  await db.updateTable('posts').set({ content_json: block }).where('id', '=', post.id).execute();
  const held = await db.selectFrom('posts').select('updated_at').where('id', '=', post.id).executeTakeFirstOrThrow();
  await assert.rejects(updatePostStatus(ownerId, { id: post.id, status: 'published', updatedAt: held.updated_at.toISOString() }), ValidationError);

  // A page holding only a block has content: it can be published.
  const page = await createPage(ownerId, { ...common, contentJson: block, slug: 'a-page', title: 'A page' });
  assert.equal(page.content_html, POST_LIST_PLACEHOLDER);
  assert.deepEqual(page.content_json, block);
  const edited = await updatePage(ownerId, { ...common, contentJson: block, id: page.id, slug: page.slug, title: 'Still a page', updatedAt: page.updated_at });
  assert.equal(edited.content_html, POST_LIST_PLACEHOLDER);
  const published = await updatePageStatus(ownerId, { id: page.id, status: 'published', updatedAt: edited.updated_at });
  assert.equal(published.status, 'published');
  assert.equal(published.content_html, POST_LIST_PLACEHOLDER);
});
