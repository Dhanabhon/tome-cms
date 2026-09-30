import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a file a post links to cannot be deleted, and the post is named', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPage } = await import('../../src/server/content/pages');
  const { createPost } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'links@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Links', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const pdf = await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, state: 'ready', delete_error_code: null,
    object_key: `owners/${ownerId}/2026/09/${randomUUID()}.pdf`, original_name: 'guide.pdf', mime_type: 'application/pdf',
    size_bytes: 10, width: null, height: null,
  }).returning('id').executeTakeFirstOrThrow();

  const link = (attrs: Record<string, string | null>): EditorDocument => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the guide', marks: [{ type: 'link', attrs }] }] }],
  });
  const refusedFor = (kind: 'pageContent' | 'postContent') => (error: unknown) => {
    const references = (error as { details?: { references?: { counts?: Record<string, number>; posts?: Array<{ title: string }> } } }).details?.references;
    return error instanceof HttpError && error.status === 409 && references?.counts?.[kind] === 1
      && (kind === 'pageContent' || references?.posts?.[0]?.title === 'Links to a file');
  };

  // A link with no file is an ordinary link: it holds nothing.
  const ordinary = await createPost(ownerId, {
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson: link({ href: 'https://example.com/guide.pdf' }),
    metaDescription: null, metaTitle: null, slug: 'ordinary', status: 'draft', title: 'Ordinary link',
  });

  const post = await createPost(ownerId, {
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson: link({ href: `/media/${pdf.id}`, mediaId: pdf.id, target: '_blank' }),
    metaDescription: null, metaTitle: null, slug: 'links', status: 'draft', title: 'Links to a file',
  });
  assert.equal(post.content_json.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.mediaId, pdf.id);
  assert.match(post.content_html, new RegExp(`href="/media/${pdf.id}"`));
  await assert.rejects(deleteMedia(ownerId, pdf.id), refusedFor('postContent'));

  // A page that links to it holds it as well.
  await db.deleteFrom('posts').where('id', '=', post.id).execute();
  const page = await createPage(ownerId, {
    excerpt: '', contentJson: link({ href: `/media/${pdf.id}`, mediaId: pdf.id }), metaDescription: null, metaTitle: null,
    slug: 'links-page', status: 'draft', title: 'A page',
  });
  await assert.rejects(deleteMedia(ownerId, pdf.id), refusedFor('pageContent'));
  await db.deleteFrom('pages').where('id', '=', page.id).execute();
  assert.ok(ordinary.id);
});
