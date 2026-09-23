import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { MediaReferences } from '../../src/types/cms';

test('the page is saved apart from the switch, points only at this site’s pictures, and is named by the library', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { maintenanceSchema } = await import('../../src/lib/site-maintenance');
  const { readMaintenance, saveMaintenance, setMaintenanceState } = await import('../../src/server/content/site-maintenance');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const owner = async (email: string) => {
    const id = randomUUID();
    await db.insertInto('user').values({ id, name: 'Owner', email, emailVerified: true, image: null, role: 'owner' }).execute();
    return id;
  };
  const ownerId = await owner('closed@example.invalid');
  const strangerId = await owner('stranger@example.invalid');
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Closed', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const before = (await db.selectFrom('site_settings').select('updated_at').executeTakeFirstOrThrow()).updated_at;
  const media = async (values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready', delete_error_code: null,
    object_key: `owners/${ownerId}/2026/09/${randomUUID()}`, original_name: 'file', mime_type: 'image/jpeg',
    size_bytes: 400_000, width: 2400, height: 1350, alt_text: null, ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const street = await media({});
  const guide = await media({ mime_type: 'application/pdf', width: null, height: null });
  const theirs = await media({ owner_id: strangerId, object_key: `owners/${strangerId}/2026/09/${randomUUID()}` });

  const empty = await readMaintenance(ownerId);
  assert.deepEqual(empty, {
    maintenance: { backAt: null, copy: {}, enabled: false, mediaId: null, template: 'minimal' },
    media: null,
  }, 'an open site on the plainest page');

  await setMaintenanceState(ownerId, true);
  const saved = await saveMaintenance(ownerId, maintenanceSchema.parse({
    backAt: '2030-01-01T02:00:00.000Z',
    copy: { th: { heading: 'ปิดซ่อม', message: '' } },
    mediaId: street,
    template: 'picture',
  }));
  assert.deepEqual(saved, {
    backAt: '2030-01-01T02:00:00.000Z',
    copy: { th: { heading: 'ปิดซ่อม', message: '' } },
    enabled: true,
    mediaId: street,
    template: 'picture',
  }, 'saving keeps the switch where it was');
  const read = await readMaintenance(ownerId);
  assert.equal(read.media?.id, street);
  assert.equal(read.media?.publicUrl, `/media/${street}`);
  assert.equal((await setMaintenanceState(ownerId, false)).enabled, false);
  assert.equal(
    (await db.selectFrom('site_settings').select('updated_at').executeTakeFirstOrThrow()).updated_at.getTime(),
    before.getTime(),
    'neither moves the settings row’s version',
  );

  for (const [why, mediaId] of [['a document', guide], ['another owner’s picture', theirs], ['a picture that is not there', randomUUID()]] as const) {
    await assert.rejects(
      saveMaintenance(ownerId, maintenanceSchema.parse({ template: 'picture', mediaId })),
      (error: unknown) => error instanceof HttpError && error.status === 400,
      why,
    );
  }

  await assert.rejects(deleteMedia(ownerId, street), (error: unknown) => {
    assert.ok(error instanceof HttpError && error.status === 409, 'refused as a conflict');
    const references = (error as { details?: { references?: MediaReferences } }).details?.references;
    assert.equal(references?.maintenance, true, 'and the maintenance page is named');
    assert.equal(references?.counts.maintenance, 1);
    return true;
  });
});
