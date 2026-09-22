import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { sql } from 'kysely';

import type { SupportedMediaType } from '../../src/lib/media';

test('RESTORED_DOCUMENTS_QUERY answers with exactly the ready documents, and documentDispositions gives each its header', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { documentDispositions, RESTORED_DOCUMENTS_QUERY } = await import('../../scripts/restore-check');
  const { contentDisposition } = await import('../../src/server/media/disposition');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'restore-documents@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  const checksum = `${'A'.repeat(43)}=`;
  const item = { owner_id: ownerId, folder_id: null, checksum_sha256: checksum, alt_text: null as string | null, delete_error_code: null };
  const key = (extension: string) => `owners/${ownerId}/2026/09/${randomUUID()}.${extension}`;

  const documentKey = key('pdf');
  await db.insertInto('media_items').values({
    ...item, object_key: documentKey, original_name: 'guide.pdf', mime_type: 'application/pdf' as SupportedMediaType,
    size_bytes: 1024, width: null, height: null, state: 'ready',
  }).execute();
  // A ready image: the query's `mime_type not like 'image/%'` leaves it out.
  await db.insertInto('media_items').values({
    ...item, object_key: key('png'), original_name: 'photo.png', mime_type: 'image/png' as SupportedMediaType,
    size_bytes: 1024, width: 10, height: 10, state: 'ready',
  }).execute();
  // A non-ready document -- an unfinished upload's leftover row: the query's `state = 'ready'` leaves it out.
  await db.insertInto('media_items').values({
    ...item, object_key: key('docx'), original_name: 'draft.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as SupportedMediaType,
    size_bytes: 1024, width: null, height: null, state: 'deleting',
  }).execute();

  const result = await sql.raw(RESTORED_DOCUMENTS_QUERY).execute(db);
  const [row] = result.rows as Array<Record<string, unknown>>;
  const dispositions = documentDispositions(JSON.parse(String(Object.values(row ?? {})[0])));
  assert.deepEqual([...dispositions.keys()], [documentKey]);
  assert.equal(dispositions.get(documentKey), contentDisposition('guide.pdf', 'application/pdf'));
});
