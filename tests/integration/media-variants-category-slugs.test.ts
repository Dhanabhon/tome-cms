import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';

test('category slugs are filled from names and media variants are stored per width', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest, migrations } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  assert.ifError((await migrator.migrateTo('032_share_image_and_descriptions')).error);

  for (const id of ['owner', 'other']) {
    await db.insertInto('user').values({
      id, name: id, email: `${id}@example.invalid`, emailVerified: false, image: null, role: 'owner',
    }).execute();
  }
  // Names that clash once slugged ("Café" and "cafe!"), a Thai name, a name with nothing to slug,
  // and the same name under another owner, which is not a clash.
  const names: Array<[string, string, boolean]> = [
    ['owner', 'Uncategorized', true], ['owner', 'Café', false], ['owner', 'cafe!', false], ['owner', 'Cafe', false],
    ['owner', 'ข่าวสาร', false], ['owner', '!!!', false], ['other', 'Café', false],
  ];
  for (const [owner_id, name, is_default] of names) {
    await db.insertInto('categories').values({ owner_id, name, is_default }).execute();
  }

  const before = await db.selectFrom('categories').select(['id', 'updated_at']).execute();
  await migrateToLatest();
  // Filling a slug is not an edit.
  const after = await db.selectFrom('categories').select(['id', 'updated_at']).execute();
  assert.deepEqual(after.map((row) => row.updated_at).sort(), before.map((row) => row.updated_at).sort());

  const rows = await db.selectFrom('categories').select(['owner_id', 'name', 'slug', 'description_th', 'description_en'])
    .orderBy('created_at').orderBy('id').execute();
  const slug = (owner: string, name: string) => rows.find((row) => row.owner_id === owner && row.name === name)?.slug;
  assert.equal(slug('owner', 'Uncategorized'), 'uncategorized');
  assert.deepEqual(['Café', 'cafe!', 'Cafe'].map((name) => slug('owner', name)).sort(), ['cafe', 'cafe-2', 'cafe-3']);
  assert.equal(slug('owner', 'ข่าวสาร'), 'ข่าวสาร');
  assert.match(slug('owner', '!!!') ?? '', /^category-[0-9a-f]{8}$/);
  assert.equal(slug('other', 'Café'), 'cafe');
  assert.ok(rows.every((row) => row.description_th === '' && row.description_en === ''));
  await assert.rejects(
    db.insertInto('categories').values({ owner_id: 'owner', name: 'Again', slug: 'cafe' }).execute(),
    { code: '23505' },
  );
  // An insert that names no slug still gets one, so no creator breaks before it names its own.
  const bare = await db.insertInto('categories').values({ owner_id: 'owner', name: 'Bare' }).returning(['id', 'slug']).executeTakeFirstOrThrow();
  assert.equal(bare.slug, `category-${bare.id.replaceAll('-', '').slice(0, 8)}`);

  const media = await db.insertInto('media_items').values({
    owner_id: 'owner', object_key: 'media/a.png', original_name: 'a.png', mime_type: 'image/png', size_bytes: 10,
    checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready', width: 2000, height: 1000, alt_text: null,
  }).returning('id').executeTakeFirstOrThrow();
  const variant = (width: 480 | 960 | 1600, object_key: string) => ({ media_id: media.id, width, object_key, size_bytes: 5 });
  await db.insertInto('media_variants').values([variant(480, 'media/a-480.webp'), variant(960, 'media/a-960.webp')]).execute();
  await assert.rejects(db.insertInto('media_variants').values(variant(480, 'media/other.webp')).execute(), { code: '23505' });
  await assert.rejects(db.insertInto('media_variants').values({ ...variant(480, 'media/a-1000.webp'), width: 1000 as never }).execute(), { code: '23514' });
  await assert.rejects(db.insertInto('media_variants').values(variant(1600, 'media/a-960.webp')).execute(), { code: '23505' });
  await assert.rejects(
    db.insertInto('media_variants').values({ ...variant(1600, 'media/x.webp'), media_id: randomUUID() }).execute(),
    { code: '23503' },
  );
  await db.deleteFrom('media_items').where('id', '=', media.id).execute();
  assert.equal((await db.selectFrom('media_variants').select('media_id').execute()).length, 0);

  // Making a device link has a rate-limit action of its own.
  const rateRow = (action: string) => ({
    key_hash: randomUUID(), action: action as never, window_started_at: new Date(), attempts: 1,
  });
  await db.insertInto('security_rate_limits').values(rateRow('device-link')).execute();
  await assert.rejects(db.insertInto('security_rate_limits').values(rateRow('no-such-action')).execute(), { code: '23514' });

  // The backfill keeps where its last walk began; down forgets it, so up walks the whole library again.
  await db.insertInto('app_metadata').values({ key: 'media_variants_backfill', value: new Date().toISOString() }).execute();

  // Down removes both, and up puts them back with the same slugs.
  assert.ifError((await migrator.migrateTo('032_share_image_and_descriptions')).error);
  assert.equal(await db.selectFrom('app_metadata').select('key').where('key', '=', 'media_variants_backfill').executeTakeFirst(), undefined);
  assert.equal((await sql<{ n: number }>`select count(*)::int as n from security_rate_limits where action = 'device-link'`.execute(db)).rows[0]?.n, 0);
  await assert.rejects(db.insertInto('security_rate_limits').values(rateRow('device-link')).execute(), { code: '23514' });
  assert.equal((await sql<{ n: number }>`select count(*)::int as n from information_schema.columns
    where table_name = 'categories' and column_name in ('slug', 'description_th', 'description_en')`.execute(db)).rows[0]?.n, 0);
  assert.equal((await sql<{ n: number }>`select count(*)::int as n from information_schema.tables
    where table_name = 'media_variants'`.execute(db)).rows[0]?.n, 0);
  await migrateToLatest();
  assert.equal((await db.selectFrom('categories').select('slug').where('owner_id', '=', 'owner').where('name', '=', 'ข่าวสาร')
    .executeTakeFirstOrThrow()).slug, 'ข่าวสาร');
});
