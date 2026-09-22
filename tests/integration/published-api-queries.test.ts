import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import type { EditorDocument, SupportedImageType } from '../../src/types/cms';

test('Published query services paginate, enrich, and isolate the installed site', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const {
    getPublishedPage,
    getPublishedPost,
    getPublishedSite,
    listPublishedCategories,
    listPublishedPages,
    listPublishedPosts,
  } = await import('../../src/server/content/published');
  const {
    getPublicNavigationSnapshot,
    invalidatePublicNavigationCache,
  } = await import('../../src/server/content/navigation');
  const { HttpError } = await import('../../src/server/http/errors');
  const { serializePublicPost, serializePublicSite } = await import('../../src/server/http/serialize');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: true, image: null, role: 'owner' },
  ]).execute();

  const mediaId = 'c0000000-0000-4000-8000-000000000001';
  const foreignMediaId = 'c0000000-0000-4000-8000-000000000002';
  const checksum = `${'A'.repeat(43)}=`;
  const mediaBase = {
    folder_id: null,
    original_name: 'cover.webp',
    mime_type: 'image/webp' as SupportedImageType,
    size_bytes: 1_024,
    checksum_sha256: checksum,
    width: 1600,
    height: 900,
    alt_text: 'Green cover',
    state: 'ready' as const,
    delete_error_code: null,
  };
  await db.insertInto('media_items').values([
    { ...mediaBase, id: mediaId, owner_id: 'owner-a', object_key: 'owners/a/2026/09/cover.webp' },
    { ...mediaBase, id: foreignMediaId, owner_id: 'owner-b', object_key: 'owners/b/2026/09/private.webp' },
  ]).execute();
  await db.insertInto('site_settings').values({
    id: true,
    owner_id: 'owner-a',
    site_name: 'Published Test',
    tagline: 'Headless and bundled',
    site_description: 'Public content only',
    default_locale: 'th',
    timezone: 'UTC',
    admin_path: '/private-admin',
    author_name: 'Tome Author',
    author_avatar_media_id: mediaId,
    author_bio_th: 'Thai bio',
    author_bio_en: 'English bio',
  }).execute();

  const [uncategorized, news, draftOnly, foreignCategory] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
    { owner_id: 'owner-a', name: 'News', is_default: false },
    { owner_id: 'owner-a', name: 'Draft only', is_default: false },
    { owner_id: 'owner-b', name: 'Foreign', is_default: false },
  ]).returningAll().execute();

  const groups = {
    one: 'a0000000-0000-4000-8000-000000000001',
    two: 'a0000000-0000-4000-8000-000000000002',
    three: 'a0000000-0000-4000-8000-000000000003',
    draft: 'a0000000-0000-4000-8000-000000000004',
    foreign: 'a0000000-0000-4000-8000-000000000005',
  };
  const imageContent: EditorDocument = {
    type: 'doc',
    content: [{ type: 'image', attrs: { mediaId, src: `/media/${mediaId}`, alt: 'Green cover' } }],
  };
  const textContent: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Published body' }] }],
  };
  const postIds = {
    one: '10000000-0000-4000-8000-000000000001',
    two: '10000000-0000-4000-8000-000000000002',
    three: '10000000-0000-4000-8000-000000000003',
    draft: '10000000-0000-4000-8000-000000000004',
    threeEn: '10000000-0000-4000-8000-000000000103',
    twoEnDraft: '10000000-0000-4000-8000-000000000102',
    foreign: '10000000-0000-4000-8000-000000000999',
  };
  const postBase = {
    cover_media_id: null,
    content_json: textContent,
    content_html: '<p>Published body</p>',
    meta_title: null,
    meta_description: null,
    published_at: null,
  };
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values([
      { id: groups.one, owner_id: 'owner-a' },
      { id: groups.two, owner_id: 'owner-a' },
      { id: groups.three, owner_id: 'owner-a' },
      { id: groups.draft, owner_id: 'owner-a' },
      { id: groups.foreign, owner_id: 'owner-b' },
    ]).execute();
    await trx.insertInto('posts').values([
      { ...postBase, id: postIds.one, translation_group_id: groups.one, locale: 'th', title: 'One', slug: 'one', status: 'published', owner_id: 'owner-a' },
      { ...postBase, id: postIds.two, translation_group_id: groups.two, locale: 'th', title: 'Two', slug: 'two', status: 'published', owner_id: 'owner-a' },
      { ...postBase, id: postIds.three, translation_group_id: groups.three, locale: 'th', title: 'Three', slug: 'three', status: 'published', owner_id: 'owner-a', cover_media_id: mediaId, content_json: imageContent, content_html: `<img src="/media/${mediaId}" alt="Green cover">` },
      { ...postBase, id: postIds.threeEn, translation_group_id: groups.three, locale: 'en', title: 'Three EN', slug: 'three-en', status: 'published', owner_id: 'owner-a' },
      { ...postBase, id: postIds.twoEnDraft, translation_group_id: groups.two, locale: 'en', title: 'Two EN draft', slug: 'two-en-draft', status: 'draft', owner_id: 'owner-a' },
      { ...postBase, id: postIds.draft, translation_group_id: groups.draft, locale: 'th', title: 'Draft', slug: 'draft', status: 'draft', owner_id: 'owner-a' },
      { ...postBase, id: postIds.foreign, translation_group_id: groups.foreign, locale: 'th', title: 'Foreign', slug: 'foreign', status: 'published', owner_id: 'owner-b', cover_media_id: foreignMediaId },
    ]).execute();
    await trx.insertInto('post_category_assignments').values([
      { translation_group_id: groups.one, category_id: uncategorized.id, owner_id: 'owner-a' },
      { translation_group_id: groups.two, category_id: news.id, owner_id: 'owner-a' },
      { translation_group_id: groups.three, category_id: news.id, owner_id: 'owner-a' },
      { translation_group_id: groups.draft, category_id: draftOnly.id, owner_id: 'owner-a' },
      { translation_group_id: groups.foreign, category_id: foreignCategory.id, owner_id: 'owner-b' },
    ]).execute();
  });

  const pageGroups = {
    one: 'b0000000-0000-4000-8000-000000000001',
    two: 'b0000000-0000-4000-8000-000000000002',
    draft: 'b0000000-0000-4000-8000-000000000003',
    foreign: 'b0000000-0000-4000-8000-000000000004',
  };
  await db.insertInto('page_translation_groups').values([
    { id: pageGroups.one, owner_id: 'owner-a' },
    { id: pageGroups.two, owner_id: 'owner-a' },
    { id: pageGroups.draft, owner_id: 'owner-a' },
    { id: pageGroups.foreign, owner_id: 'owner-b' },
  ]).execute();
  const pageIds = {
    one: '20000000-0000-4000-8000-000000000001',
    two: '20000000-0000-4000-8000-000000000002',
    draft: '20000000-0000-4000-8000-000000000003',
    foreign: '20000000-0000-4000-8000-000000000004',
  };
  const pageBase = {
    content_json: textContent,
    content_html: '<p>Published body</p>',
    meta_title: null,
    meta_description: null,
    published_at: null,
  };
  await db.insertInto('pages').values([
    { ...pageBase, id: pageIds.one, translation_group_id: pageGroups.one, locale: 'th', title: 'About', slug: 'about', status: 'published', owner_id: 'owner-a' },
    { ...pageBase, id: pageIds.two, translation_group_id: pageGroups.two, locale: 'th', title: 'Contact', slug: 'contact', status: 'published', owner_id: 'owner-a', content_json: imageContent, content_html: `<img src="/media/${mediaId}" alt="Green cover">` },
    { ...pageBase, id: pageIds.draft, translation_group_id: pageGroups.draft, locale: 'th', title: 'Secret', slug: 'secret', status: 'draft', owner_id: 'owner-a' },
    { ...pageBase, id: pageIds.foreign, translation_group_id: pageGroups.foreign, locale: 'th', title: 'Foreign', slug: 'foreign-page', status: 'published', owner_id: 'owner-b' },
  ]).execute();
  await db.insertInto('navigation_items').values([
    { owner_id: 'owner-a', locale: 'th', location: 'header', kind: 'home', label: 'Home', page_id: null, url: null, position: 0 },
    { owner_id: 'owner-a', locale: 'th', location: 'header', kind: 'page', label: 'About', page_id: pageIds.one, url: null, position: 1 },
    { owner_id: 'owner-a', locale: 'th', location: 'header', kind: 'page', label: 'Secret', page_id: pageIds.draft, url: null, position: 2 },
    { owner_id: 'owner-a', locale: 'th', location: 'footer', kind: 'custom', label: 'External', page_id: null, url: 'https://example.com/', position: 0 },
  ]).execute();

  const first = await listPublishedPosts({ locale: 'th', limit: 1 });
  const second = await listPublishedPosts({ locale: 'th', limit: 1, cursor: first.nextCursor! });
  const third = await listPublishedPosts({ locale: 'th', limit: 1, cursor: second.nextCursor! });
  assert.deepEqual(
    [...first.items, ...second.items, ...third.items].map(({ id }) => id),
    [postIds.three, postIds.two, postIds.one],
  );
  assert.deepEqual([first.hasMore, second.hasMore, third.hasMore], [true, true, false]);
  assert.equal(third.nextCursor, null);
  assert.deepEqual(first.items[0]?.categories, [{ id: news.id, name: 'News' }]);
  assert.equal(first.items[0]?.coverImage?.id, mediaId);
  assert.deepEqual(first.items[0]?.media.map(({ id }) => id), [mediaId]);
  assert.deepEqual(first.items[0]?.translations, [
    { href: '/en/blog/three-en', locale: 'en' },
    { href: '/th/blog/three', locale: 'th' },
  ]);
  assert.deepEqual(second.items[0]?.translations, [{ href: '/th/blog/two', locale: 'th' }]);

  const filtered = await listPublishedPosts({ locale: 'th', limit: 10, category: 'news' });
  assert.deepEqual(filtered.items.map(({ id }) => id), [postIds.three, postIds.two]);
  await assert.rejects(
    listPublishedPosts({ locale: 'th', limit: 1, category: 'News', cursor: first.nextCursor! }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.equal(await getPublishedPost('th', 'draft'), null);
  assert.equal((await getPublishedPost('th', 'three'))?.id, postIds.three);

  const firstPages = await listPublishedPages({ locale: 'th', limit: 1 });
  const secondPages = await listPublishedPages({ locale: 'th', limit: 1, cursor: firstPages.nextCursor! });
  assert.deepEqual([...firstPages.items, ...secondPages.items].map(({ id }) => id), [pageIds.two, pageIds.one]);
  assert.deepEqual(firstPages.items[0]?.media.map(({ id }) => id), [mediaId]);
  assert.equal(await getPublishedPage('th', 'secret'), null);

  const categorySnapshot = await listPublishedCategories('th');
  assert.deepEqual(categorySnapshot.items, [
    { id: uncategorized.id, name: 'Uncategorized' },
    { id: news.id, name: 'News' },
  ]);
  const navigation = await getPublicNavigationSnapshot('th');
  assert.deepEqual(navigation.navigation, {
    footer: [{ href: 'https://example.com/', kind: 'custom', label: 'External', newTab: false }],
    header: [
      { href: '/th', kind: 'home', label: 'Home', newTab: false },
      { href: '/th/about', kind: 'page', label: 'About', newTab: false },
    ],
  });
  const site = await getPublishedSite();
  assert.equal(site?.avatar?.id, mediaId);
  const publicSite = serializePublicSite(site!.settings, site!.avatar, site!.brand);
  const publicPost = serializePublicPost(first.items[0]!);
  const json = JSON.stringify({ publicPost, publicSite });
  for (const internal of ['owner-a', '/private-admin', 'owners/a/2026/09/cover.webp', checksum]) {
    assert.equal(json.includes(internal), false);
  }

  await delay(5);
  await db.updateTable('categories').set({ name: 'Updates' }).where('id', '=', news.id).execute();
  const changedCategories = await listPublishedCategories('th');
  assert.ok(changedCategories.lastModified > categorySnapshot.lastModified);
  assert.equal(changedCategories.items.some(({ name }) => name === 'Updates'), true);
  const changedPosts = await listPublishedPosts({ locale: 'th', limit: 10 });
  assert.ok(changedPosts.lastModified > filtered.lastModified);

  await delay(5);
  await db.updateTable('media_items').set({ alt_text: 'Updated cover' }).where('id', '=', mediaId).execute();
  const changedSite = await getPublishedSite();
  assert.ok(changedSite!.lastModified > site!.lastModified);

  await delay(5);
  await db.updateTable('navigation_items').set({ label: 'Start' })
    .where('owner_id', '=', 'owner-a').where('kind', '=', 'home').execute();
  invalidatePublicNavigationCache();
  const changedNavigation = await getPublicNavigationSnapshot('th');
  assert.ok(changedNavigation.lastModified > navigation.lastModified);
  assert.equal(changedNavigation.navigation.header[0]?.label, 'Start');

  const { dev } = await import('astro');
  const server = await dev({
    server: { host: '127.0.0.1', port: 0 },
    vite: { cacheDir: 'node_modules/.vite-content-api-test' },
    logLevel: 'silent',
  });
  try {
    const origin = `http://127.0.0.1:${server.address.port}`;
    const request = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });

    const siteResponse = await request('/api/v1/content/site');
    assert.equal(siteResponse.status, 200);
    assert.equal(siteResponse.headers.get('access-control-allow-origin'), '*');
    assert.equal(siteResponse.headers.has('set-cookie'), false);
    const siteBody = await siteResponse.json() as { data: { name: string; author: { avatar: { altText: string } } } };
    assert.equal(siteBody.data.name, 'Published Test');
    assert.equal(siteBody.data.author.avatar.altText, 'Updated cover');

    const postsResponse = await request('/api/v1/content/posts?locale=th&limit=1', {
      headers: { Cookie: 'session=must-not-be-used' },
    });
    assert.equal(postsResponse.status, 200);
    assert.equal(postsResponse.headers.has('set-cookie'), false);
    const postsBody = await postsResponse.json() as {
      data: Array<{ id: string }>;
      links: { next: string | null };
      meta: { hasMore: boolean; limit: number; locale: string };
    };
    assert.deepEqual(postsBody.data.map(({ id }) => id), [postIds.three]);
    assert.deepEqual(postsBody.meta, { hasMore: true, limit: 1, locale: 'th' });
    assert.ok(postsBody.links.next?.startsWith(`${origin}/api/v1/content/posts?`));
    assert.equal((await request(new URL(postsBody.links.next!).pathname + new URL(postsBody.links.next!).search)).status, 200);

    const etag = postsResponse.headers.get('etag');
    assert.ok(etag);
    const unchanged = await request('/api/v1/content/posts?locale=th&limit=1', { headers: { 'If-None-Match': etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');

    const detail = await request('/api/v1/content/posts/three?locale=th');
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as { data: { coverImage: { id: string } } }).data.coverImage.id, mediaId);
    assert.equal((await request('/api/v1/content/posts/draft?locale=th')).status, 404);
    assert.equal((await request('/api/v1/content/pages/secret?locale=th')).status, 404);
    assert.equal((await request('/api/v1/content/pages/contact?locale=th')).status, 200);

    const categories = await request('/api/v1/content/categories?locale=th');
    assert.deepEqual(
      (await categories.json() as { data: Array<{ name: string }> }).data.map(({ name }) => name),
      ['Uncategorized', 'Updates'],
    );
    const menu = await request('/api/v1/content/navigation?locale=th');
    assert.equal((await menu.json() as { data: { header: Array<{ label: string }> } }).data.header[0]?.label, 'Start');

    for (const path of [
      '/api/v1/content/posts?locale=th&locale=en',
      '/api/v1/content/posts?locale=th&limit=51',
      '/api/v1/content/site?unknown=1',
    ]) {
      const invalid = await request(path);
      assert.equal(invalid.status, 400);
      assert.match(invalid.headers.get('content-type') ?? '', /^application\/problem\+json/);
      assert.equal(invalid.headers.get('access-control-allow-origin'), '*');
    }

    const options = await request('/api/v1/content/posts', {
      method: 'OPTIONS',
      headers: { Origin: 'https://client.example', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(options.status, 204);
    assert.match(options.headers.get('access-control-allow-methods') ?? '', /GET/);
  } finally {
    await server.stop();
  }
});
