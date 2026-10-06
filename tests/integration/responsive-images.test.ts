import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a published post and the slides bring each picture\'s copies with them, and the API says nothing of them', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { getPublishedPost } = await import('../../src/server/content/published');
  const { getPublicSlidesSnapshot, replaceSlides } = await import('../../src/server/content/slides');
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
  const { serializePublicPost, serializePublicSlides } = await import('../../src/server/http/serialize');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  const owner = 'owner-srcset';
  await db.insertInto('user').values({
    id: owner, name: 'Owner', email: 'srcset@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: owner, site_name: 'Copies', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();

  const cover = randomUUID();
  const body = randomUUID();
  const plain = randomUUID();
  const media = {
    folder_id: null, mime_type: 'image/jpeg' as const, size_bytes: 1_024, checksum_sha256: `${'A'.repeat(43)}=`,
    state: 'ready' as const, delete_error_code: null, owner_id: owner, alt_text: 'A loaf',
  };
  await db.insertInto('media_items').values([
    { ...media, id: cover, original_name: 'cover.jpg', object_key: `owners/${owner}/cover.jpg`, width: 2000, height: 1125 },
    { ...media, id: body, original_name: 'body.jpg', object_key: `owners/${owner}/body.jpg`, width: 1200, height: 800 },
    { ...media, id: plain, original_name: 'small.jpg', object_key: `owners/${owner}/small.jpg`, width: 400, height: 300 },
  ]).execute();
  // Stored out of order: they come back narrowest first.
  await db.insertInto('media_variants').values([
    { media_id: cover, width: 1600, object_key: `owners/${owner}/cover-1600.webp`, size_bytes: 10 },
    { media_id: cover, width: 480, object_key: `owners/${owner}/cover-480.webp`, size_bytes: 10 },
    { media_id: cover, width: 960, object_key: `owners/${owner}/cover-960.webp`, size_bytes: 10 },
    { media_id: body, width: 960, object_key: `owners/${owner}/body-960.webp`, size_bytes: 10 },
    { media_id: body, width: 480, object_key: `owners/${owner}/body-480.webp`, size_bytes: 10 },
  ]).execute();

  const image = (id: string) => ({ type: 'image', attrs: { mediaId: id, src: `/media/${id}`, alt: 'A loaf' } });
  const content: EditorDocument = { type: 'doc', content: [image(body), image(plain)] };
  const html = `<p><img src="/media/${body}" alt="A loaf" /></p><p><img src="/media/${plain}" alt="A loaf" /></p>`;
  const group = randomUUID();
  const [category] = await db.insertInto('categories').values({ owner_id: owner, name: 'Uncategorized', is_default: true })
    .returningAll().execute();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values({ id: group, owner_id: owner }).execute();
    await trx.insertInto('posts').values({
      id: randomUUID(), translation_group_id: group, title: 'Copies', slug: 'copies', cover_media_id: cover,
      content_json: content, content_html: html, meta_title: null, meta_description: null,
      published_at: new Date(Date.now() - 60_000), status: 'published', locale: 'en', owner_id: owner,
    }).execute();
    await trx.insertInto('post_category_assignments').values({ translation_group_id: group, category_id: category.id, owner_id: owner }).execute();
  });

  const post = await getPublishedPost('en', 'copies');
  assert.ok(post);
  assert.deepEqual(post.coverImage?.variant_widths, [480, 960, 1600]);
  assert.deepEqual(Object.fromEntries(post.media.map(({ id, variant_widths }) => [id, variant_widths])), { [body]: [480, 960], [plain]: [] });
  assert.equal(post.content_html, html, 'the stored body is not rewritten here: the theme does it, with its own column');
  const served = serializePublicPost(post);
  assert.ok(!JSON.stringify(served).includes('variant'), 'the API keeps its shape');
  assert.ok(!served.contentHtml.includes('srcset'));

  await replaceSlides(owner, homeSlidesSchema.parse({ locale: 'en', slides: [{ mediaId: cover }, { mediaId: plain }] }));
  const { slides } = await getPublicSlidesSnapshot('en');
  assert.deepEqual(slides.map(({ image: { srcset } }) => srcset), [
    `/media/${cover}?w=480 480w, /media/${cover}?w=960 960w, /media/${cover}?w=1600 1600w, /media/${cover} 2000w`,
    undefined,
  ]);
  assert.ok(!JSON.stringify(serializePublicSlides(slides)).includes('srcset'), 'nor do the slides the API serves');
});
