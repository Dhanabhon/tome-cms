import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('a home slide is refused by the database whenever it breaks a rule', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'slides@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const image = await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: 'A lake at dawn',
    state: 'ready', delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`,
    original_name: 'lake.jpg', mime_type: 'image/jpeg', size_bytes: 400_000, width: 2400, height: 1350,
  }).returning('id').executeTakeFirstOrThrow();

  const slide = { owner_id: ownerId, locale: 'th' as const, position: 0, media_id: image.id };
  const refused = async (why: string, values: Record<string, unknown>) => {
    await assert.rejects(
      db.insertInto('home_slides').values({ ...slide, ...values } as never).execute(),
      (error: unknown) => (error as { code?: string }).code === '23514' || (error as { code?: string }).code === '23505',
      why,
    );
  };

  await db.insertInto('home_slides').values(slide).execute();
  await refused('two slides in one place', {});
  await refused('an eleventh slide', { position: 10 });
  await refused('a language the site does not have', { position: 1, locale: 'de' });
  await refused('a heading with spaces around it', { position: 1, heading: ' Hi ' });
  await refused('a heading over 80 characters', { position: 1, heading: 'ก'.repeat(81) });
  await refused('a body over 200 characters', { position: 1, body: 'ก'.repeat(201) });
  await refused('a button without a link', { position: 1, button_label: 'Read' });
  await refused('a link without a button', { position: 1, link_kind: 'home' });
  await refused('a page link with no page', { position: 1, button_label: 'Read', link_kind: 'page' });
  await refused('the home opening a new tab', { position: 1, button_label: 'Home', link_kind: 'home', new_tab: true });
  await refused('a script for an address', { position: 1, button_label: 'Go', link_kind: 'custom', url: 'javascript:alert(1)' });
  await refused('words on a bare picture', { position: 1, heading: 'Words', overlay: 'none' });
  await refused('an end before its start', {
    position: 1, starts_at: '2026-10-02T00:00:00Z', ends_at: '2026-10-01T00:00:00Z',
  });
  await refused('a focus point that is not one of the nine', { position: 1, focus: 'middle' });

  await db.insertInto('home_slides').values({
    ...slide, position: 1, button_label: 'Read', link_kind: 'custom', url: 'https://example.com/', new_tab: true,
    overlay: 'none',
  }).execute();

  await assert.rejects(
    db.deleteFrom('media_items').where('id', '=', image.id).execute(),
    (error: unknown) => (error as { code?: string }).code === '23503',
    'a picture a slide uses cannot be deleted under it',
  );

  await db.deleteFrom('user').where('id', '=', ownerId).execute();
  const left = await db.selectFrom('home_slides').select(({ fn }) => fn.countAll<number>().as('count'))
    .where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
  assert.equal(Number(left.count), 0, 'slides go with their owner');

  // Down and up again: the migration can be taken back, and put back.
  const { Migrator } = await import('kysely/migration');
  const { migrations } = await import('../../src/server/db/migrator');
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  const { sql } = await import('kysely');
  const exists = async () => (await sql<{ found: boolean }>`select to_regclass('public.home_slides') is not null as found`
    .execute(db)).rows[0]!.found;
  assert.ifError((await migrator.migrateTo('022_navigation_new_tab')).error);
  assert.equal(await exists(), false, 'down drops the table');
  assert.ifError((await migrator.migrateToLatest()).error);
  assert.equal(await exists(), true, 'and up makes it again');
});
