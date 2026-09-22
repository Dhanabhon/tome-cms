import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { SupportedMediaType } from '../../src/lib/media';

test('a document has no dimensions and no alternative text, and may be 25 MB', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const documents = await import('../../src/server/db/migrations/021_media_documents');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'documents@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const checksum = `${'A'.repeat(43)}=`;
  const item = {
    owner_id: ownerId, folder_id: null, original_name: 'guide.pdf', mime_type: 'application/pdf' as SupportedMediaType,
    size_bytes: 1024, checksum_sha256: checksum, width: null as number | null, height: null as number | null,
    alt_text: null as string | null, state: 'ready' as const, delete_error_code: null,
  };
  const key = () => `owners/${ownerId}/2026/09/${randomUUID()}.pdf`;
  const refused = { code: '23514' };

  const pdf = await db.insertInto('media_items').values({ ...item, object_key: key(), size_bytes: 26_214_400 })
    .returning('id').executeTakeFirstOrThrow();
  for (const [wrong, why] of [
    [{ size_bytes: 26_214_401 }, 'a document over 25 MB'],
    [{ width: 10, height: 10 }, 'a document with dimensions'],
    [{ alt_text: 'A guide' }, 'a document with alternative text'],
    [{ mime_type: 'application/msword' as SupportedMediaType }, 'a legacy Word file'],
    [{ mime_type: 'application/vnd.ms-word.document.macroEnabled.12' as SupportedMediaType }, 'a macro-enabled one'],
    [{ mime_type: 'image/png' as SupportedMediaType }, 'an image without dimensions'],
    [{ mime_type: 'image/png' as SupportedMediaType, width: 1, height: 1, size_bytes: 8_388_609 }, 'an image over 8 MB'],
  ] as const) {
    await assert.rejects(db.insertInto('media_items').values({ ...item, object_key: key(), ...wrong }).execute(), refused, why);
  }
  await db.insertInto('media_items').values({
    ...item, object_key: key(), mime_type: 'image/png', width: 1, height: 1, alt_text: 'Still an image', size_bytes: 8_388_608,
  }).execute();

  const reservation = {
    owner_id: ownerId, folder_id: null, original_name: 'guide.pdf', mime_type: 'application/pdf' as SupportedMediaType,
    expected_size_bytes: 26_214_400, expected_checksum_sha256: checksum, alt_text: null as string | null,
    state: 'pending' as const, expires_at: new Date(Date.now() + 300_000), finalized_at: null,
  };
  await db.insertInto('media_upload_reservations').values({ ...reservation, object_key: key() }).execute();
  await assert.rejects(db.insertInto('media_upload_reservations').values({ ...reservation, object_key: key(), alt_text: 'x' }).execute(), refused);
  await assert.rejects(db.insertInto('media_upload_reservations').values({ ...reservation, object_key: key(), expected_size_bytes: 26_214_401 }).execute(), refused);

  // Undoing it refuses while a document is in the library, and says why and what to do.
  await assert.rejects(documents.down(db), /cannot be undone while the library holds 1 document/);
  await db.deleteFrom('media_items').where('id', '=', pdf.id).execute();
  await documents.down(db);
  assert.equal(await db.selectFrom('media_upload_reservations').select('id').where('mime_type', '=', 'application/pdf').executeTakeFirst(),
    undefined, 'the reservations made for documents went with it');
  // Postgres checks NOT NULL before a check constraint, so each of the two restored rules is asked on its own.
  await assert.rejects(db.insertInto('media_items').values({ ...item, object_key: key() }).execute(), { code: '23502' }, 'dimensions are required again');
  await assert.rejects(db.insertInto('media_items').values({ ...item, object_key: key(), width: 1, height: 1 }).execute(), refused, 'and a document is refused again');
  await documents.up(db);
  await db.insertInto('media_items').values({ ...item, object_key: key() }).execute();
});
