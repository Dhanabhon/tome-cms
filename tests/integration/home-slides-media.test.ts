import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { MediaReferences } from '../../src/types/cms';

test('a picture a slide uses is refused deletion, and the refusal names the slide', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { homeSlidesSchema } = await import('../../src/lib/home-slides');
  const { replaceSlides } = await import('../../src/server/content/slides');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'slide-media@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Slides', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const lake = (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'A lake at dawn', state: 'ready',
    delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`, original_name: 'lake.jpg',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow()).id;

  await replaceSlides(ownerId, homeSlidesSchema.parse({ locale: 'en', slides: [{ mediaId: lake }, { mediaId: lake, heading: 'Second' }] }));

  await assert.rejects(deleteMedia(ownerId, lake), (error: unknown) => {
    assert.ok(error instanceof HttpError && error.status === 409, 'refused as a conflict');
    const references = (error as { details?: { references?: MediaReferences } }).details?.references;
    assert.equal(references?.counts.slides, 2, 'both slides are counted');
    assert.deepEqual(
      references?.slides.map(({ heading, locale, position }) => ({ heading, locale, position })),
      [{ heading: null, locale: 'en', position: 0 }, { heading: 'Second', locale: 'en', position: 1 }],
      'and each is named by its heading, or by its place and language',
    );
    return true;
  });
});
