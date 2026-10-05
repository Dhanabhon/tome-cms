import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

// The menu's and the slides' five-second snapshots feed a render the page cache then keeps for five
// minutes. Whatever empties the page cache, and whatever moment expires it, must retire them too.
test('the menu and slides snapshots go stale with the page cache and at the next scheduled moment', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test', 'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPage } = await import('../../src/server/content/pages');
  const { getPublicNavigationSnapshot, navigationMenuSchema, replaceNavigation } = await import('../../src/server/content/navigation');
  const { getPublicSlidesSnapshot, replaceSlides } = await import('../../src/server/content/slides');
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
  const { invalidatePageCache } = await import('../../src/server/http/page-cache');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({ id: 'fresh-owner', name: 'Owner', email: 'fresh@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({ id: true, owner_id: 'fresh-owner', site_name: 'F', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null }).execute();
  const content: EditorDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
  const page = (slug: string) => createPage('fresh-owner', { contentJson: content, excerpt: '', metaDescription: null, metaTitle: null, slug, status: 'published', title: slug });
  const lake = (await db.insertInto('media_items').values({
    owner_id: 'fresh-owner', folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'Old words', state: 'ready',
    delete_error_code: null, object_key: 'owners/fresh-owner/2026/10/lake.jpg', original_name: 'lake.jpg',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow()).id;

  const about = await page('about');
  await replaceSlides('fresh-owner', homeSlidesSchema.parse({ locale: 'en', slides: [
    { mediaId: lake, button: { label: 'About', link: { kind: 'page', pageId: about.id } } },
  ] }));
  await replaceNavigation('fresh-owner', navigationMenuSchema.parse({
    locale: 'en', location: 'header', items: [{ kind: 'page', label: 'About', pageId: about.id, url: null }],
  }));
  const slide = async () => (await getPublicSlidesSnapshot('en')).slides[0];
  const menu = async () => (await getPublicNavigationSnapshot('en')).navigation.header.map(({ href }) => href);
  assert.equal((await slide())?.image.alt, 'Old words');
  assert.equal((await slide())?.button?.href, '/en/about');
  assert.deepEqual(await menu(), ['/en/about']);

  // Each change below is written straight to the table and followed by what an admin or MCP write
  // does afterwards -- empty the page cache -- and nothing else: no module is told on its own.
  // Each case is its own step, so one that fails does not hide the next.
  await context.test('a media description edit', async () => {
    await db.updateTable('media_items').set({ alt_text: 'New words' }).where('id', '=', lake).execute();
    invalidatePageCache();
    assert.equal((await slide())?.image.alt, 'New words', 'a picture\'s new description reaches a slide without a heading');
  });

  await context.test('a page moved to a new slug', async () => {
    await db.updateTable('pages').set({ slug: 'about-us' }).where('id', '=', about.id).execute();
    invalidatePageCache();
    assert.equal((await slide())?.button?.href, '/en/about-us', 'a slide button follows the page to its new address');
    assert.deepEqual(await menu(), ['/en/about-us'], 'and so does the menu');
  });

  await context.test('a page taken down', async () => {
    await db.updateTable('pages').set({ status: 'draft', published_at: null }).where('id', '=', about.id).execute();
    invalidatePageCache();
    assert.equal((await slide())?.button, null, 'a button to a page taken down is not drawn');
    assert.deepEqual(await menu(), [], 'nor is its menu item');
  });

  // A scheduled page goes live with no write: neither snapshot may outlive that moment.
  await context.test('a scheduled page going live', async () => {
    const soon = await page('soon');
    const moment = new Date(Date.now() + 2_500);
    await db.updateTable('pages').set({ published_at: moment }).where('id', '=', soon.id).execute();
    await replaceSlides('fresh-owner', homeSlidesSchema.parse({ locale: 'en', slides: [
      { mediaId: lake, button: { label: 'Soon', link: { kind: 'page', pageId: soon.id } } },
    ] }));
    await replaceNavigation('fresh-owner', navigationMenuSchema.parse({
      locale: 'en', location: 'header', items: [{ kind: 'page', label: 'Soon', pageId: soon.id, url: null }],
    }));
    assert.equal((await slide())?.button, null, 'not a link before its moment');
    assert.deepEqual(await menu(), [], 'not in the menu before its moment');
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, moment.getTime() - Date.now()) + 200));
    assert.equal((await slide())?.button?.href, '/en/soon', 'a slide links to it once its moment has come');
    assert.deepEqual(await menu(), ['/en/soon'], 'and the menu shows it');
  });
});
