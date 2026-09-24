import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('the core draws the popup it can check, and only that', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { publicAdditions } = await import('../../src/server/plugins/public');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'popup-public@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const media = async (values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready', delete_error_code: null,
    object_key: `owners/${ownerId}/2026/09/${randomUUID()}`, original_name: 'file', mime_type: 'image/jpeg',
    size_bytes: 400_000, width: 1600, height: 900, alt_text: null, ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const picture = await media({});
  const guide = await media({ mime_type: 'application/pdf', width: null, height: null });
  // Dimensions and being a non-document image are the same fact to media_items' own
  // media_items_dimensions_check: width/height are required exactly when mime_type is one of
  // the five ACCEPTED_IMAGE_TYPES, and forbidden otherwise. So a row that fails the mime_type
  // filter can never carry real dimensions -- the table itself already denies it a picture,
  // before popupImage's own mime_type check gets a say. `drawing` is the nearest row the
  // table accepts: a document, dimensionless like `guide`, distinct only in its mime type.
  const leaving = await media({ state: 'deleting' });
  const drawing = await media({ mime_type: 'text/csv', width: null, height: null });

  // Written as the row, not through the store: this is about what the page does with a row,
  // including one edited by hand that the store would have refused.
  const popup = async (settings: Record<string, string>) => {
    await db.insertInto('plugin_settings').values({ enabled: true, id: 'popup', owner_id: ownerId, settings: JSON.stringify(settings) })
      .onConflict((conflict) => conflict.column('id').doUpdateSet({ enabled: true, settings: JSON.stringify(settings) })).execute();
  };
  const origin = 'https://example.com';
  const home = { kind: 'home', locale: 'en' } as const;
  const base = { actionEn: 'Claim my savings', actionHref: '/en/deals', headingEn: 'Hottest deals' };

  await popup({ ...base, image: picture });
  const drawn = (await publicAdditions(ownerId, home, origin)).popup;
  assert.equal(drawn?.heading, 'Hottest deals');
  assert.deepEqual(drawn?.action, { href: '/en/deals', label: 'Claim my savings' });
  assert.deepEqual(drawn?.image, { height: 900, src: `/media/${picture}`, width: 1600 });
  assert.equal(drawn?.pluginId, 'popup');
  assert.equal(drawn?.trigger, 'delay');
  assert.equal(drawn?.delaySeconds, 10);
  assert.deepEqual((await publicAdditions(ownerId, home, origin)).clients.map(({ id }) => id), ['popup'], 'and its browser code is asked for');

  await popup({ ...base, actionHref: 'https://example.com/deals?x=1' });
  assert.equal((await publicAdditions(ownerId, home, origin)).popup?.action.href, '/deals?x=1', 'a same-origin link is a path');
  await popup({ ...base, actionHref: 'https://partner.example/deals' });
  assert.equal((await publicAdditions(ownerId, home, origin)).popup?.action.href, 'https://partner.example/deals');
  for (const href of ['javascript:alert(1)', 'http://partner.example/deals', 'data:text/html,hi']) {
    await popup({ ...base, actionHref: href });
    assert.equal((await publicAdditions(ownerId, home, origin)).popup, null, `${href} draws no popup`);
  }

  for (const image of [guide, leaving, drawing, randomUUID(), 'lake.jpg']) {
    await popup({ ...base, image });
    const kept = (await publicAdditions(ownerId, home, origin)).popup;
    assert.equal(kept?.heading, 'Hottest deals', 'a picture that cannot be drawn does not take the popup with it');
    assert.equal(kept?.image, null);
  }

  await popup({ ...base, pages: 'home' });
  assert.equal((await publicAdditions(ownerId, { kind: 'post', locale: 'en' }, origin)).popup, null);

  await db.updateTable('plugin_settings').set({ enabled: false }).where('id', '=', 'popup').execute();
  assert.equal((await publicAdditions(ownerId, home, origin)).popup, null, 'off is off');
});
