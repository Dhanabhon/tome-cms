import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

/**
 * The excerpt survives a write, and the column refuses what the field would not accept.
 *
 * The bound is in two places on purpose. The editor stops at 120 because that is what the
 * card can show; the column stops at 120 because a write that did not come from the editor
 * is still a write, and a row longer than the card can draw is a row that gets cut
 * somewhere a reader sees rather than somewhere a writer does.
 */
test('a post or a page keeps the excerpt it was given, and the column holds the bound', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, createPostSchema, getPost, updatePost } = await import('../../src/server/content/posts');
  const { createPage, createPageSchema, getPage } = await import('../../src/server/content/pages');
  const { sql } = await import('kysely');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'owner-e', name: 'Owner', email: 'excerpt@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-e', site_name: 'TomeCMS', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [category] = await db.insertInto('categories')
    .values({ owner_id: 'owner-e', name: 'Uncategorized', is_default: true }).returningAll().execute();

  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }] } as EditorDocument;
  const input = {
    categoryIds: [category.id],
    contentJson: content,
    coverMediaId: null,
    excerpt: 'A reader decides on this one.',
    metaDescription: null,
    metaTitle: null,
    slug: 'excerpt-post',
    status: 'draft' as const,
    title: 'Excerpt post',
  };

  const created = await createPost('owner-e', input);
  assert.equal(created.excerpt, 'A reader decides on this one.');
  assert.equal((await getPost('owner-e', created.id))?.excerpt, 'A reader decides on this one.');

  // Clearing it is an edit, and puts the card back on the fallbacks.
  const cleared = await updatePost('owner-e', { ...input, excerpt: '', id: created.id, updatedAt: created.updated_at });
  assert.equal(cleared.excerpt, '');

  // 120 exactly is allowed; 121 is not, and the schema says so before the database has to.
  assert.equal(createPostSchema.safeParse({ ...input, excerpt: 'a'.repeat(120) }).success, true);
  assert.equal(createPostSchema.safeParse({ ...input, excerpt: 'a'.repeat(121) }).success, false);

  // And the column refuses it too, for a write that never met the schema.
  await assert.rejects(
    () => sql`update posts set excerpt = ${'a'.repeat(121)} where id = ${created.id}::uuid`.execute(db),
    /posts_excerpt_check/,
    'the column holds the bound on its own',
  );
  await assert.rejects(
    () => sql`update posts set excerpt = ${'  padded  '} where id = ${created.id}::uuid`.execute(db),
    /posts_excerpt_check/,
    'the column refuses what the schema would have trimmed',
  );

  // A page carries the same field on the same terms, and the same two bounds.
  const page = await createPage('owner-e', {
    contentJson: content, excerpt: 'What a link to this page can say.',
    metaDescription: null, metaTitle: null, slug: 'about', status: 'draft', title: 'About',
  });
  assert.equal(page.excerpt, 'What a link to this page can say.');
  assert.equal((await getPage('owner-e', page.id))?.excerpt, 'What a link to this page can say.');
  assert.equal(createPageSchema.safeParse({
    contentJson: content, excerpt: 'a'.repeat(121), metaDescription: null, metaTitle: null,
    slug: 'about-2', status: 'draft', title: 'About',
  }).success, false);
  await assert.rejects(
    () => sql`update pages set excerpt = ${'a'.repeat(121)} where id = ${page.id}::uuid`.execute(db),
    /pages_excerpt_check/,
    'the page column holds the bound on its own',
  );
});
