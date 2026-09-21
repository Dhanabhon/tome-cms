import assert from 'node:assert/strict';
import test from 'node:test';

const OWNER = '5b0e1f3c-2d4a-4e6b-8c9d-0a1b2c3d4e5f';
const HOSTILE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><script>alert(1)</script><rect width="120" height="40" fill="#2e7d5b"/></svg>');

/**
 * A logo and an icon, stored, replaced and removed against the real bucket.
 *
 * The order is the whole point -- check, store, record, then delete what was replaced -- and
 * only a bucket that is really there can say whether anything was left behind.
 */
test('a logo and an icon are stored, replaced and removed, and nothing is left behind', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { getSiteSettings } = await import('../../src/server/content/settings');
  const { brandOf, removeBrandImage, storeBrandImage } = await import('../../src/server/content/brand');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const { knownObjects } = await import('../../scripts/reset-installation.mjs');
  const sharp = (await import('sharp')).default;
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({ id: OWNER, name: 'Owner', email: 'brand@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({ id: true, owner_id: OWNER, site_name: 'Brand', default_locale: 'en', timezone: 'UTC', admin_path: '/admin' }).execute();

  const head = async (key: string) => {
    try {
      return await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
    } catch {
      return null;
    }
  };
  const bucket = async () => ((await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket }))).Contents ?? []).map(({ Key }) => Key).sort();
  const row = async () => db.selectFrom('site_settings').select(['brand_icon', 'brand_logo']).executeTakeFirstOrThrow();

  // An SVG is stored as made safe, under a key backup and reset accept.
  const first = await storeBrandImage(OWNER, 'logo', HOSTILE);
  const logo = (await row()).brand_logo as { key: string } | null;
  assert.ok(logo);
  assert.match(logo.key, new RegExp(`^owners/${OWNER}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.svg$`));
  assert.equal((await head(logo.key))?.ContentType, 'image/svg+xml');
  const stored = await (await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: logo.key }))).Body!.transformToString();
  assert.ok(!stored.includes('script'), 'stored as made safe');
  assert.ok(first.brand.logo?.url.endsWith(logo.key));
  assert.ok((await knownObjects(db)).some(({ key }: { key: string }) => key === logo.key), 'a reset accounts for the logo');

  // A replacement deletes what it replaced, and moves the version the public API reads.
  const png = await sharp({ create: { background: '#123456', channels: 4, height: 100, width: 400 } }).png().toBuffer();
  const second = await storeBrandImage(OWNER, 'logo', png);
  assert.equal(await head(logo.key), null, 'the replaced logo is gone');
  assert.ok(Date.parse(second.updatedAt) > Date.parse(first.updatedAt));

  // An icon is three objects; a removal clears the setting and all three.
  await storeBrandImage(OWNER, 'icon', HOSTILE);
  const icon = (await row()).brand_icon as { png180Key: string; png32Key: string; svgKey: string };
  for (const key of [icon.svgKey, icon.png32Key, icon.png180Key]) assert.ok(await head(key), `${key} was not stored`);
  assert.equal((await head(icon.png180Key))?.ContentType, 'image/png');
  await removeBrandImage(OWNER, 'icon');
  for (const key of [icon.svgKey, icon.png32Key, icon.png180Key]) assert.equal(await head(key), null, `${key} was left behind`);
  assert.equal((await row()).brand_icon, null);

  // A refused file leaves nothing in the bucket.
  const before = await bucket();
  const small = await sharp({ create: { background: '#fff', channels: 4, height: 64, width: 64 } }).png().toBuffer();
  await assert.rejects(storeBrandImage(OWNER, 'icon', small), (error: unknown) =>
    (error as { details?: { code?: string } }).details?.code === 'brand_icon_small');
  assert.deepEqual(await bucket(), before);

  // A record that fails after the files were stored takes them back out: an owner with no
  // settings row gets as far as the bucket, and no further.
  await assert.rejects(storeBrandImage('6c1f2a4d-3e5b-4f7c-9d0e-1a2b3c4d5e6f', 'logo', png), (error: unknown) =>
    (error as { status?: number }).status === 404);
  assert.deepEqual(await bucket(), before, 'nothing is left for a setting that was never written');

  // Hiding the name holds while there is a logo, and removing the logo brings it back.
  await db.updateTable('site_settings').set({ hide_site_name: true }).execute();
  assert.equal(brandOf((await getSiteSettings())!).showSiteName, false);
  await removeBrandImage(OWNER, 'logo');
  assert.equal(brandOf((await getSiteSettings())!).showSiteName, true);
});
