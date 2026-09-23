import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('the maintenance columns refuse a page that breaks a rule', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { sql } = await import('kysely');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'maintenance@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Closed', default_locale: 'th', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const image = await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'A quiet street',
    state: 'ready', delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`,
    original_name: 'street.jpg', mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow();

  const columns = ['maintenance_enabled', 'maintenance_template', 'maintenance_copy', 'maintenance_media_id', 'maintenance_back_at'] as const;
  assert.deepEqual(await db.selectFrom('site_settings').select(columns).executeTakeFirstOrThrow(), {
    maintenance_enabled: false, maintenance_template: 'minimal', maintenance_copy: {}, maintenance_media_id: null, maintenance_back_at: null,
  }, 'a site starts open, on the plainest page');

  const set = (values: Record<string, unknown>) => db.updateTable('site_settings').set(values as never).where('id', '=', true).execute();
  const refused = async (why: string, values: Record<string, unknown>, code = '23514') => {
    await assert.rejects(set(values), (error: unknown) => (error as { code?: string }).code === code, why);
  };

  await refused('a template the core does not draw', { maintenance_template: 'video' });
  await refused('no template at all', { maintenance_template: null }, '23502');
  await refused('Picture without a picture', { maintenance_template: 'picture' });
  await refused('Picture with its picture set to null', { maintenance_template: 'picture', maintenance_media_id: null });
  await refused('Countdown without a time', { maintenance_template: 'countdown', maintenance_back_at: null });
  await refused('words that are not an object', { maintenance_copy: sql`'[]'::jsonb` });
  await refused('a picture that is not in the library', { maintenance_media_id: randomUUID() }, '23503');

  await set({ maintenance_template: 'picture', maintenance_media_id: image.id });
  await assert.rejects(
    db.deleteFrom('media_items').where('id', '=', image.id).execute(),
    (error: unknown) => (error as { code?: string }).code === '23503',
    'the picture the page uses cannot be deleted under it',
  );

  // Down and up again: the migration can be taken back, and put back.
  await set({ maintenance_template: 'minimal', maintenance_media_id: null });
  const { Migrator } = await import('kysely/migration');
  const { migrations } = await import('../../src/server/db/migrator');
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  const has = async () => (await sql<{ found: boolean }>`select exists (
    select 1 from information_schema.columns where table_name = 'site_settings' and column_name = 'maintenance_enabled'
  ) as found`.execute(db)).rows[0]!.found;
  assert.ifError((await migrator.migrateTo('023_home_slides')).error);
  assert.equal(await has(), false, 'down drops the columns');
  assert.ifError((await migrator.migrateToLatest()).error);
  assert.equal(await has(), true, 'and up adds them again');
});
