import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a draft preview describes an old picture the way the site does, never by its file name', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { getPost } = await import('../../src/server/content/posts');
  const { getPage } = await import('../../src/server/content/pages');
  const { draftPreviewPage, draftPreviewPost } = await import('../../src/server/content/previews');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'owner-alt', name: 'Owner', email: 'alt@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const described = randomUUID();
  const undescribed = randomUUID();
  const media = {
    folder_id: null, mime_type: 'image/webp' as const, size_bytes: 1_024, checksum_sha256: `${'A'.repeat(43)}=`,
    width: 800, height: 600, state: 'ready' as const, delete_error_code: null, owner_id: 'owner-alt',
  };
  await db.insertInto('media_items').values([
    { ...media, id: described, original_name: 'chart.webp', alt_text: 'A chart of visits', object_key: 'owners/alt/chart.webp' },
    { ...media, id: undescribed, original_name: 'photo.webp', alt_text: null, object_key: 'owners/alt/photo.webp' },
  ]).execute();

  const image = (id: string) => ({ type: 'image', attrs: { mediaId: id, src: `/media/${id}`, alt: null } });
  const content: EditorDocument = { type: 'doc', content: [image(described), image(undescribed)] };
  const html = `<p><img src="/media/${described}" alt="chart.webp" title="chart.webp" /></p>`
    + `<p><img src="/media/${undescribed}" alt="photo.webp" /></p>`;
  const group = randomUUID();
  const pageGroup = randomUUID();
  const postId = randomUUID();
  const pageId = randomUUID();
  const common = {
    content_json: content, content_html: html, meta_title: null, meta_description: null, published_at: null,
    status: 'draft' as const, locale: 'en' as const, owner_id: 'owner-alt',
  };
  const [category] = await db.insertInto('categories').values({ owner_id: 'owner-alt', name: 'Uncategorized', is_default: true })
    .returningAll().execute();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values({ id: group, owner_id: 'owner-alt' }).execute();
    await trx.insertInto('page_translation_groups').values({ id: pageGroup, owner_id: 'owner-alt' }).execute();
    await trx.insertInto('posts').values({
      ...common, id: postId, translation_group_id: group, title: 'Draft', slug: 'draft', cover_media_id: null,
    }).execute();
    await trx.insertInto('post_category_assignments').values({
      translation_group_id: group, category_id: category.id, owner_id: 'owner-alt',
    }).execute();
    await trx.insertInto('pages').values({
      ...common, id: pageId, translation_group_id: pageGroup, title: 'Draft page', slug: 'draft-page',
    }).execute();
  });

  const post = await getPost('owner-alt', postId);
  const page = await getPage('owner-alt', pageId);
  assert.ok(post && page);
  for (const { content_html } of [await draftPreviewPost('owner-alt', post), await draftPreviewPage('owner-alt', page)]) {
    assert.ok(content_html.includes(`src="/media/${described}" alt="A chart of visits"`), content_html);
    assert.ok(content_html.includes(`src="/media/${undescribed}" alt=""`), content_html);
    assert.ok(!content_html.includes('title="chart.webp"'), 'the old picture title is gone too');
    assert.ok(!content_html.includes('alt="photo.webp"') && !content_html.includes('alt="chart.webp"'));
  }
});
