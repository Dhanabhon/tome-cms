import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('an address an article moved away from still reaches it', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost, deletePost, updatePost, updatePostStatus } = await import('../../src/server/content/posts');
  const { createPage, updatePage } = await import('../../src/server/content/pages');
  const { addRedirect, deleteRedirect, listRedirects, movedPage, movedPost } = await import('../../src/server/content/redirects');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'moving-owner', name: 'Owner', email: 'moving@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'moving-owner', site_name: 'TomeCMS', default_locale: 'th', timezone: 'UTC', admin_path: '/studio', author_avatar_media_id: null,
  }).execute();
  const [category] = await db.insertInto('categories').values([
    { owner_id: 'moving-owner', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();

  const content: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  };
  const base = {
    excerpt: '', categoryIds: [category!.id], coverMediaId: null, contentJson: content,
    metaDescription: null, metaTitle: null, status: 'published' as const, title: 'Moving',
  };
  const rename = async (post: { id: string; updated_at: string }, slug: string) =>
    updatePost('moving-owner', { ...base, id: post.id, slug, updatedAt: post.updated_at });

  const first = await createPost('moving-owner', { ...base, slug: 'first' });
  const second = await rename(first, 'second');
  assert.equal(await movedPost('th', 'first'), '/th/blog/second', 'the old address reaches the article');

  // Renamed again: both old addresses go straight to where it is now, not along a chain.
  const third = await rename(second, 'third');
  assert.equal(await movedPost('th', 'first'), '/th/blog/third', 'no hop through the middle one');
  assert.equal(await movedPost('th', 'second'), '/th/blog/third');

  // Moved back to an address it once had: that address is the article again, so it is not
  // also a redirect -- a forwarding address cannot be the place it forwards to.
  const back = await rename(third, 'first');
  const rows = await db.selectFrom('content_redirects').select('slug').where('post_id', '=', first.id).execute();
  assert.deepEqual(rows.map(({ slug }) => slug).sort(), ['second', 'third'], 'first is live, not forwarded');

  // Something new takes an old address: whatever lives there is what the address means.
  await createPost('moving-owner', { ...base, slug: 'second', title: 'A newcomer' });
  assert.equal(
    (await db.selectFrom('content_redirects').select('slug').where('slug', '=', 'second').execute()).length,
    0,
    'the stale forwarding address is gone the moment something lives there',
  );

  // A draft's slug was never public, so renaming one leaves nothing behind.
  const draft = await createPost('moving-owner', { ...base, slug: 'draft-a', status: 'draft' });
  await updatePost('moving-owner', { ...base, id: draft.id, slug: 'draft-b', status: 'draft', updatedAt: draft.updated_at });
  // Asked of the table, not of movedPost: a draft is not live, so movedPost would answer
  // null whether or not a row had been written, and the rule would go untested.
  assert.equal(
    (await db.selectFrom('content_redirects').select('slug').where('slug', '=', 'draft-a').execute()).length,
    0,
    'nothing a reader could have had',
  );

  // A forwarding address to something a reader may not see is a 404 by another name.
  const hidden = await updatePostStatus('moving-owner', { id: back.id, status: 'draft', updatedAt: back.updated_at });
  assert.equal(await movedPost('th', 'third'), null, 'an unpublished article is not forwarded to');
  await updatePostStatus('moving-owner', { id: back.id, status: 'published', updatedAt: hidden.updated_at });
  assert.equal(await movedPost('th', 'third'), '/th/blog/first', 'and is again once it is back');

  // Deleted, its old addresses go with it, and answer the way its own address does.
  const current = await db.selectFrom('posts').select('updated_at').where('id', '=', first.id).executeTakeFirstOrThrow();
  await deletePost('moving-owner', first.id, current.updated_at.toISOString());
  assert.equal(await movedPost('th', 'third'), null, 'a deleted article leaves no forwarding address');

  // Pages keep their own addresses: /th/x and /th/blog/x are not the same place.
  const page = await createPage('moving-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null,
    slug: 'about', status: 'published', title: 'About',
  });
  await updatePage('moving-owner', {
    contentJson: content, excerpt: '', id: page.id, metaDescription: null, metaTitle: null,
    slug: 'about-us', status: 'published', title: 'About', updatedAt: page.updated_at,
  });
  assert.equal(await movedPage('th', 'about'), '/th/about-us', 'a page is forwarded too');
  assert.equal(await movedPost('th', 'about'), null, 'and only as a page');

  // By hand: an address that changed before any of this was recorded.
  const kept = await createPost('moving-owner', { ...base, slug: 'kept', title: 'Kept' });
  const refused = (status: number) => (error: unknown) => (error as { status?: number }).status === status;
  await assert.rejects(() => addRedirect('moving-owner', { kind: 'post', slug: 'Not An Address', targetId: kept.id }),
    refused(400), 'an address is checked against the address rule');
  await assert.rejects(() => addRedirect('moving-owner', { kind: 'post', slug: 'kept', targetId: kept.id }),
    refused(409), 'and cannot be one something already lives at -- it would never be followed');
  await assert.rejects(() => addRedirect('someone-else', { kind: 'post', slug: 'older', targetId: kept.id }),
    refused(404), 'nor point at an article that is not the owner\'s');

  await addRedirect('moving-owner', { kind: 'post', slug: 'kept-before-2026', targetId: kept.id });
  assert.equal(await movedPost('th', 'kept-before-2026'), '/th/blog/kept', 'a hand-made address forwards like any other');

  const listed = await listRedirects('moving-owner');
  const mine = listed.find(({ slug }) => slug === 'kept-before-2026');
  assert.deepEqual(
    mine && { from: mine.from, kind: mine.kind, live: mine.live, targetTitle: mine.targetTitle, to: mine.to },
    { from: '/th/blog/kept-before-2026', kind: 'post', live: true, targetTitle: 'Kept', to: '/th/blog/kept' },
    'listed with where it goes and whether a reader arrives',
  );
  assert.ok(listed.some(({ from, kind }) => kind === 'page' && from === '/th/about'), 'pages are listed with posts');

  await deleteRedirect('moving-owner', { kind: 'post', locale: 'th', slug: 'kept-before-2026' });
  assert.equal(await movedPost('th', 'kept-before-2026'), null, 'and stops when it is removed');
  await assert.rejects(() => deleteRedirect('moving-owner', { kind: 'post', locale: 'th', slug: 'kept-before-2026' }),
    refused(404), 'removing one that is not there says so');
});
