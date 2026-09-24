import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { MediaReferences } from '../../src/types/cms';

test('a picture a plugin holds is refused deletion, on or off, and the refusal names the plugin', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { writePluginSettings } = await import('../../src/server/plugins/store');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'popup-media@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const picture = (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: '', state: 'ready',
    delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`, original_name: 'deal.jpg',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 1600, height: 900,
  }).returning('id').executeTakeFirstOrThrow()).id;

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { image: picture } });

  await assert.rejects(deleteMedia(ownerId, picture), (error: unknown) => {
    assert.ok(error instanceof HttpError && error.status === 409, 'refused as a conflict, though the plugin is off');
    const references = (error as { details?: { references?: MediaReferences } }).details?.references;
    assert.deepEqual(references?.plugins, [{ id: 'popup', name: 'Popup' }]);
    assert.equal(references?.counts.plugins, 1);
    return true;
  });

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { image: '' } });
  // The disposable stack runs storage, and deleting an object that was never uploaded succeeds.
  await deleteMedia(ownerId, picture);
  const left = await db.selectFrom('media_items').select('id').where('id', '=', picture).execute();
  assert.equal(left.length, 0, 'once let go, the plugin no longer holds it');
});
