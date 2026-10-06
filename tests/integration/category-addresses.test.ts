import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { sql } from 'kysely';

/**
 * A category's address and descriptions: made from the name when it is created, kept when it is
 * renamed, changed only when the owner changes it, and unique per owner.
 */
test('Category addresses are made, kept, edited and refused as the owner expects', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const {
    categoriesByPostGroup, categoryBySlug, categoryUpdateSchema, createCategory, insertDefaultCategory, listCategories,
    listPublishedCategoriesForOwner, updateCategory,
  } = await import('../../src/server/content/categories');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);
  const refused = (status: number, code?: string) => (error: unknown) =>
    error instanceof HttpError && error.status === status && (code === undefined || error.details?.code === code);

  await migrateToLatest();
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: true, image: null, role: 'owner' },
  ]).execute();

  // The installer's default category has the address a migrated one has.
  await db.transaction().execute((trx) => insertDefaultCategory(trx, 'owner-a'));
  await db.transaction().execute((trx) => insertDefaultCategory(trx, 'owner-a'));
  const fallback = await db.selectFrom('categories').selectAll().where('owner_id', '=', 'owner-a').executeTakeFirstOrThrow();
  assert.equal(fallback.slug, 'uncategorized');
  assert.equal(fallback.is_default, true);

  // Made from the name, with the content rules: Thai stays Thai, a clash takes -2, nothing to slug falls back.
  const travel = await createCategory('owner-a', 'Travel Notes');
  assert.equal(travel.slug, 'travel-notes');
  assert.equal(travel.description_th, '');
  assert.equal(travel.description_en, '');
  const thai = await createCategory('owner-a', 'ขนมไทย');
  assert.equal(thai.slug, 'ขนม-ไทย');
  const clash = await createCategory('owner-a', 'Travel: notes');
  assert.equal(clash.slug, 'travel-notes-2');
  const third = await createCategory('owner-a', 'travel notes!');
  assert.equal(third.slug, 'travel-notes-3');
  const symbols = await createCategory('owner-a', '!!!');
  assert.equal(symbols.slug, `category-${symbols.id.replaceAll('-', '').slice(0, 8)}`);
  const foreign = await createCategory('owner-b', 'Travel Notes');
  assert.equal(foreign.slug, 'travel-notes', 'unique per owner, not per site');

  // A rename keeps the address: links to the category keep working.
  const renamed = await updateCategory('owner-a', travel.id, { name: 'Journeys' });
  assert.equal(renamed.name, 'Journeys');
  assert.equal(renamed.slug, 'travel-notes');

  // Changing it is explicit, and checked like a post's.
  const moved = await updateCategory('owner-a', travel.id, { name: 'Journeys', slug: ' journeys ' });
  assert.equal(moved.slug, 'journeys');
  const thaiSlug = await updateCategory('owner-a', thai.id, { name: 'ขนมไทย', slug: 'ขนม' });
  assert.equal(thaiSlug.slug, 'ขนม', 'Thai is allowed, as in a post address');
  await assert.rejects(updateCategory('owner-a', clash.id, { name: 'Travel: notes', slug: 'journeys' }), refused(409, 'slug_taken'));
  await assert.rejects(updateCategory('owner-a', clash.id, { name: 'Travel: notes', slug: 'uncategorized' }), refused(409, 'slug_taken'));
  await assert.rejects(updateCategory('owner-a', clash.id, { name: 'Travel: notes', slug: 'Not A Slug' }), refused(400, 'slug_invalid'));
  await assert.rejects(updateCategory('owner-a', clash.id, { name: 'Travel: notes', slug: 'a--b' }), refused(400, 'slug_invalid'));
  await assert.rejects(updateCategory('owner-a', clash.id, { name: 'Travel: notes', slug: 'a'.repeat(161) }), refused(400, 'slug_invalid'));
  assert.equal((await updateCategory('owner-a', clash.id, { name: 'Travel: notes', slug: 'travel-notes' })).slug, 'travel-notes',
    'an address another category gave up is free again');
  assert.equal((await updateCategory('owner-b', foreign.id, { name: 'Travel Notes', slug: 'journeys' })).slug, 'journeys',
    "another owner's address is no clash");

  // Left empty, it is made from the name again.
  const remade = await updateCategory('owner-a', third.id, { name: 'Food and drink', slug: '' });
  assert.equal(remade.slug, 'food-and-drink');
  assert.equal((await updateCategory('owner-a', third.id, { name: 'Food and drink', slug: '' })).slug, 'food-and-drink',
    'its own address is no clash');

  // An address saved before a stricter rule stays valid while it is not changed.
  await sql`update categories set slug = 'Old_Address' where id = ${symbols.id}`.execute(db);
  const kept = await updateCategory('owner-a', symbols.id, { name: 'Symbols', slug: 'Old_Address', descriptionEn: 'Marks.' });
  assert.equal(kept.slug, 'Old_Address');
  assert.equal(kept.name, 'Symbols');

  // Descriptions: optional, trimmed, up to 160 characters each, Thai counted letter by letter.
  const described = await updateCategory('owner-a', thai.id, { name: 'ขนมไทย', descriptionTh: '  ขนมหวานของไทย  ', descriptionEn: ' Thai sweets. ' });
  assert.equal(described.description_th, 'ขนมหวานของไทย');
  assert.equal(described.description_en, 'Thai sweets.');
  assert.equal(described.slug, 'ขนม', 'a description alone leaves the address');
  const untouched = await updateCategory('owner-a', thai.id, { name: 'ขนมไทย' });
  assert.equal(untouched.description_th, 'ขนมหวานของไทย', 'a field left out is left as it is');
  const input = { id: thai.id, name: 'ขนมไทย' };
  assert.equal(categoryUpdateSchema.safeParse({ ...input, descriptionTh: 'ก'.repeat(160) }).success, true);
  assert.equal(categoryUpdateSchema.safeParse({ ...input, descriptionTh: 'ก'.repeat(161) }).success, false);
  assert.equal(categoryUpdateSchema.safeParse({ ...input, descriptionEn: 'a'.repeat(161) }).success, false);
  assert.equal(categoryUpdateSchema.safeParse({ ...input, descriptionEn: `  ${'a'.repeat(160)}  ` }).success, true, 'trimmed before it is counted');
  assert.equal(categoryUpdateSchema.safeParse({ ...input, extra: true }).success, false);

  // Uncategorized stays as it is: it has no page to address or describe.
  await assert.rejects(updateCategory('owner-a', fallback.id, { name: 'Uncategorized', descriptionEn: 'Everything else.' }), refused(409));
  await assert.rejects(updateCategory('owner-a', randomUUID(), { name: 'Missing' }), refused(404));
  await assert.rejects(updateCategory('owner-b', thai.id, { name: 'Stolen' }), refused(404));

  // What the admin lists, and what a post's categories carry.
  const listed = await listCategories('owner-a');
  assert.deepEqual(listed.map(({ name, slug }) => [name, slug]), [
    ['Uncategorized', 'uncategorized'],
    ['Food and drink', 'food-and-drink'],
    ['Journeys', 'journeys'],
    ['Symbols', 'Old_Address'],
    ['Travel: notes', 'travel-notes'],
    ['ขนมไทย', 'ขนม'],
  ]);
  assert.equal(listed.find(({ id }) => id === thai.id)?.description_en, 'Thai sweets.');

  const group = randomUUID();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values({ id: group, owner_id: 'owner-a' }).execute();
    await trx.insertInto('posts').values({
      id: randomUUID(), translation_group_id: group, locale: 'th', title: 'หนึ่ง', slug: 'one', cover_media_id: null,
      content_json: { type: 'doc', content: [{ type: 'paragraph' }] }, content_html: '<p></p>', meta_title: null,
      meta_description: null, status: 'draft', published_at: null, owner_id: 'owner-a',
    }).execute();
    await trx.insertInto('post_category_assignments').values({ translation_group_id: group, category_id: thai.id, owner_id: 'owner-a' }).execute();
  });
  assert.deepEqual((await categoriesByPostGroup('owner-a', [group])).get(group), [{ id: thai.id, is_default: false, name: 'ขนมไทย', slug: 'ขนม' }]);

  // A category page finds its category by address, this owner's only, with what the page says of it.
  assert.deepEqual(await categoryBySlug('owner-a', 'ขนม'), {
    description_en: 'Thai sweets.', description_th: 'ขนมหวานของไทย', id: thai.id, is_default: false, name: 'ขนมไทย', slug: 'ขนม',
  });
  assert.equal((await categoryBySlug('owner-a', 'uncategorized'))?.is_default, true, 'found, and the page refuses it');
  assert.equal((await categoryBySlug('owner-a', 'journeys'))?.id, travel.id);
  assert.equal(await categoryBySlug('owner-b', 'ขนม'), null, "another owner's address is not this one's");
  assert.equal(await categoryBySlug('owner-a', 'nothing-here'), null);

  // The categories a language lists are those with a live post in it, each dated for the sitemap.
  assert.deepEqual((await listPublishedCategoriesForOwner('owner-a', 'th', new Date(0))).items, [], 'a draft makes no page');
  await db.updateTable('posts').set({ status: 'published', published_at: new Date(Date.now() - 60_000) })
    .where('translation_group_id', '=', group).execute();
  const thaiList = await listPublishedCategoriesForOwner('owner-a', 'th', new Date(0));
  assert.deepEqual(thaiList.items, [{ id: thai.id, is_default: false, name: 'ขนมไทย', slug: 'ขนม' }]);
  assert.ok(thaiList.modified.get(thai.id) instanceof Date);
  assert.equal(thaiList.modified.get(thai.id)?.getTime(), thaiList.lastModified.getTime());
  assert.deepEqual((await listPublishedCategoriesForOwner('owner-a', 'en', new Date(0))).items, [], 'none in English');
});
