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
  const { createPage, deletePage, updatePageStatus } = await import('../../src/server/content/pages');
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
      { kind: 'custom', label: 'External', pageId: null, url: 'https://example.com', newTab: true },
    ],
  });
  await replaceNavigation('public-owner', menu);
  assert.deepEqual((await getPublicNavigation('th')).header, [
    { href: '/th', kind: 'home', label: 'Home', newTab: false, children: [] },
    { href: '/th/about', kind: 'page', label: 'About', newTab: false, children: [] },
    { href: 'https://example.com/', kind: 'custom', label: 'External', newTab: true, children: [] },
  ]);
  assert.equal((await listNavigation('public-owner')).items.find(({ kind }) => kind === 'custom')?.new_tab, true);

  // Only a link the owner typed may open in a new tab; the site's own pages open in place.
  assert.equal(navigationMenuSchema.safeParse({
    locale: 'th', location: 'footer', items: [{ kind: 'page', label: 'About', pageId: publishedPage.id, url: null, newTab: true }],
  }).success, false);
  await assert.rejects(db.insertInto('navigation_items').values({
    owner_id: 'public-owner', locale: 'th', location: 'footer', kind: 'home', label: 'Home', page_id: null, url: null, position: 0, new_tab: true,
  }).execute(), { code: '23514' });

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

  // A header item may hold sub-items: one running order, each sub-item pointing at its parent.
  const tree = await replaceNavigation('public-owner', navigationMenuSchema.parse({
    locale: 'en', location: 'header', items: [
      { kind: 'home', label: 'Home', pageId: null, url: null, children: [
        { kind: 'page', label: 'About', pageId: englishPage.id, url: null },
      ] },
      { kind: 'group', label: 'Elsewhere', pageId: null, url: null, children: [
        { kind: 'custom', label: 'Docs', pageId: null, url: 'https://example.com/docs', newTab: true },
        { kind: 'custom', label: 'Blog', pageId: null, url: '/en/blog' },
      ] },
    ],
  }));
  const englishHeader = async () => (await listNavigation('public-owner')).items
    .filter(({ locale, location }) => locale === 'en' && location === 'header');
  const saved = await englishHeader();
  assert.deepEqual(saved.map(({ label, position }) => [label, position]), [
    ['Home', 0], ['About', 1], ['Elsewhere', 2], ['Docs', 3], ['Blog', 4],
  ]);
  assert.deepEqual(saved.map(({ parent_id }) => parent_id), [null, saved[0]?.id, null, saved[2]?.id, saved[2]?.id]);
  assert.deepEqual(tree.map(({ id }) => id), saved.map(({ id }) => id), 'the save returns the rows it wrote, in order');
  assert.deepEqual((await getPublicNavigation('en')).header, [
    {
      href: '/en', kind: 'home', label: 'Home', newTab: false,
      children: [{ href: '/en/about-en', kind: 'page', label: 'About', newTab: false, children: [] }],
    },
    {
      href: null, kind: 'group', label: 'Elsewhere', newTab: false,
      children: [
        { href: 'https://example.com/docs', kind: 'custom', label: 'Docs', newTab: true, children: [] },
        { href: '/en/blog', kind: 'custom', label: 'Blog', newTab: false, children: [] },
      ],
    },
  ], 'the public menu nests each sub-item under its parent');

  await assert.rejects(
    replaceNavigation('public-owner', navigationMenuSchema.parse({
      locale: 'en', location: 'header', items: [
        { kind: 'group', label: 'Wrong', pageId: null, url: null, children: [
          { kind: 'page', label: 'Thai page', pageId: publishedPage.id, url: null },
        ] },
      ],
    })),
    (error: unknown) => error instanceof HttpError && error.status === 400,
    'a sub-item page is checked like any other',
  );
  assert.deepEqual(await englishHeader(), saved, 'a refused save keeps the tree');

  // Deleting a parent's page keeps its sub-items: the parent becomes a group. An item with none goes with the page.
  const thaiContact = await createPage('public-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null, slug: 'contact', status: 'published', title: 'Contact',
  });
  const contactPage = await createPage('public-owner', {
    contentJson: content, excerpt: '', locale: 'en', metaDescription: null, metaTitle: null, slug: 'contact-en',
    sourcePageId: thaiContact.id, status: 'published', title: 'Contact EN',
  });
  await replaceNavigation('public-owner', navigationMenuSchema.parse({
    locale: 'en', location: 'header', items: [
      { kind: 'page', label: 'Company', pageId: englishPage.id, url: null, children: [
        { kind: 'custom', label: 'Docs', pageId: null, url: 'https://example.com/docs' },
      ] },
      { kind: 'page', label: 'Contact', pageId: contactPage.id, url: null },
    ],
  }));
  await deletePage('public-owner', englishPage.id, englishPage.updated_at);
  await deletePage('public-owner', contactPage.id, contactPage.updated_at);
  const afterDelete = await englishHeader();
  assert.deepEqual(
    afterDelete.map(({ label, kind, page_id, parent_id, new_tab }) => [label, kind, page_id, parent_id === null ? null : 'child', new_tab]),
    [['Company', 'group', null, null, false], ['Docs', 'custom', null, 'child', false]],
    'the parent stays as a group with its sub-item; the item with none left with its page',
  );
  assert.equal(afterDelete[1]?.parent_id, afterDelete[0]?.id);
  assert.deepEqual((await getPublicNavigation('en')).header, [{
    href: null, kind: 'group', label: 'Company', newTab: false,
    children: [{ href: 'https://example.com/docs', kind: 'custom', label: 'Docs', newTab: false, children: [] }],
  }]);

  // A page that is a sub-item goes with its page, and a parent left with nothing under it is not shown.
  const thaiTeam = await createPage('public-owner', {
    contentJson: content, excerpt: '', metaDescription: null, metaTitle: null, slug: 'team', status: 'published', title: 'Team',
  });
  const teamPage = await createPage('public-owner', {
    contentJson: content, excerpt: '', locale: 'en', metaDescription: null, metaTitle: null, slug: 'team-en',
    sourcePageId: thaiTeam.id, status: 'published', title: 'Team EN',
  });
  await replaceNavigation('public-owner', navigationMenuSchema.parse({
    locale: 'en', location: 'header', items: [
      { kind: 'group', label: 'Company', pageId: null, url: null, children: [
        { kind: 'page', label: 'Team', pageId: teamPage.id, url: null },
      ] },
    ],
  }));
  assert.equal((await getPublicNavigation('en')).header[0]?.children.length, 1);
  await deletePage('public-owner', teamPage.id, teamPage.updated_at);
  assert.deepEqual((await englishHeader()).map(({ label, kind }) => [label, kind]), [['Company', 'group']],
    'the sub-item left with its page and the group stayed');
  assert.deepEqual((await getPublicNavigation('en')).header, [], 'a group with nothing under it is not shown');
});
