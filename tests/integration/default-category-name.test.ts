import assert from 'node:assert/strict';
import test from 'node:test';

import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';

/**
 * The default category can be renamed (migration 034): its name only. Its address, its place as
 * the default, its owner and its descriptions stay as they are, it still cannot be deleted, and the
 * name "Uncategorized" stays its own. Down puts migration 005's rule back, and the name with it.
 */
test('the default category takes a new name and nothing else', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest, migrations } = await import('../../src/server/db/migrator');
  const { createCategory, deleteCategory, insertDefaultCategory, listCategories, updateCategory } = await import('../../src/server/content/categories');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  const refused = (status: number, code?: string, field?: string) => (error: unknown) =>
    error instanceof HttpError && error.status === status
    && (code === undefined || error.details?.code === code) && (field === undefined || error.details?.field === field);
  const body = async () => (await sql<{ body: string }>`
    select prosrc as body from pg_proc where proname = 'tomecms_protect_category'`.execute(db)).rows[0]?.body;
  const check = async () => (await sql<{ definition: string }>`
    select pg_get_constraintdef(oid) as definition from pg_constraint
    where conname = 'categories_default_name_check' and conrelid = 'categories'::regclass`.execute(db)).rows[0]?.definition;

  assert.ifError((await migrator.migrateTo('033_media_variants_and_category_pages')).error);
  const before = await body();
  const checkBefore = await check();
  assert.ok(checkBefore);
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: true, image: null, role: 'owner' },
  ]).execute();
  await db.transaction().execute((trx) => insertDefaultCategory(trx, 'owner-a'));
  await db.transaction().execute((trx) => insertDefaultCategory(trx, 'owner-b'));
  await assert.rejects(
    db.updateTable('categories').set({ name: 'General' }).where('owner_id', '=', 'owner-a').execute(),
    { code: '23514' }, 'before 034 the default cannot be renamed',
  );

  assert.ifError((await migrator.migrateToLatest()).error);
  const fallback = await db.selectFrom('categories').selectAll().where('owner_id', '=', 'owner-a').executeTakeFirstOrThrow();

  // At the database: a new name is allowed, and counts as an edit.
  const renamed = await db.updateTable('categories').set({ name: 'ไม่มีหมวดหมู่' }).where('id', '=', fallback.id)
    .returningAll().executeTakeFirstOrThrow();
  assert.equal(renamed.name, 'ไม่มีหมวดหมู่');
  assert.equal(renamed.slug, 'uncategorized');
  assert.equal(renamed.is_default, true);
  assert.ok(renamed.updated_at.getTime() >= fallback.updated_at.getTime());
  await db.updateTable('categories').set({ name: 'ไม่มีหมวดหมู่', updated_at: new Date(0) }).where('id', '=', fallback.id).execute();

  // Everything else about it stays, and it still cannot be deleted.
  for (const change of [
    { slug: 'general' }, { is_default: false }, { description_th: 'อื่น ๆ' }, { description_en: 'Everything else.' },
    { created_at: new Date(0) }, { name: 'Elsewhere', slug: 'elsewhere' },
  ] as const) {
    await assert.rejects(db.updateTable('categories').set(change).where('id', '=', fallback.id).execute(), { code: '23514' }, JSON.stringify(change));
  }
  await assert.rejects(db.updateTable('categories').set({ owner_id: 'owner-b' }).where('id', '=', fallback.id).execute(), { code: '23514' });
  await assert.rejects(db.deleteFrom('categories').where('id', '=', fallback.id).execute(), { code: '23514' });

  // Names: unique per owner ignoring case, and "Uncategorized" is the default's alone.
  const food = await createCategory('owner-a', 'Food');
  await assert.rejects(db.updateTable('categories').set({ name: 'FOOD' }).where('id', '=', fallback.id).execute(), { code: '23505' });
  await assert.rejects(db.updateTable('categories').set({ name: 'uncategorized' }).where('id', '=', food.id).execute(), { code: '23514' });
  await assert.rejects(db.insertInto('categories').values({ owner_id: 'owner-a', name: 'UNCATEGORIZED' }).execute(), { code: '23514' });
  await db.updateTable('categories').set({ name: 'Uncategorized' }).where('id', '=', fallback.id).execute();

  // The owner's own rule is unchanged, for any category, and a removed owner still takes theirs along.
  await assert.rejects(db.updateTable('categories').set({ owner_id: 'owner-b' }).where('id', '=', food.id).execute(), { code: '23514' });

  // The service: the default takes a name, and refuses an address or a description, naming the field.
  const general = await updateCategory('owner-a', fallback.id, { name: '  General  ' });
  assert.deepEqual([general.name, general.slug, general.is_default], ['General', 'uncategorized', true]);
  const same = await updateCategory('owner-a', fallback.id, { name: 'General', slug: 'uncategorized', descriptionTh: '', descriptionEn: ' ' });
  assert.equal(same.name, 'General', 'what it already has may be sent back unchanged');
  await assert.rejects(updateCategory('owner-a', fallback.id, { name: 'General', slug: 'general' }), refused(400, 'default_category_fixed', 'slug'));
  await assert.rejects(updateCategory('owner-a', fallback.id, { name: 'General', slug: '' }), refused(400, 'default_category_fixed', 'slug'));
  await assert.rejects(updateCategory('owner-a', fallback.id, { name: 'General', descriptionTh: 'อื่น ๆ' }), refused(400, 'default_category_fixed', 'descriptionTh'));
  await assert.rejects(updateCategory('owner-a', fallback.id, { name: 'General', descriptionEn: 'Else.' }), refused(400, 'default_category_fixed', 'descriptionEn'));
  await assert.rejects(updateCategory('owner-a', fallback.id, { name: 'food' }), refused(409, 'name_taken'));
  await assert.rejects(deleteCategory('owner-a', fallback.id), refused(409));
  // Another category may not take the default's old name, nor the default another's.
  await assert.rejects(createCategory('owner-a', 'Uncategorized'), refused(409, 'name_reserved'));
  await assert.rejects(updateCategory('owner-a', food.id, { name: 'uncategorized' }), refused(409, 'name_reserved'));
  await assert.rejects(createCategory('owner-a', 'general'), refused(409, 'name_taken'));
  assert.equal((await updateCategory('owner-a', fallback.id, { name: 'Uncategorized' })).name, 'Uncategorized', 'and it may take its old name back');
  await updateCategory('owner-a', fallback.id, { name: 'General' });
  assert.deepEqual((await listCategories('owner-a')).map(({ name, is_default }) => [name, is_default]), [['General', true], ['Food', false]]);

  // Down: migration 005's rule exactly, and the default's name back as that rule wants it.
  assert.ifError((await migrator.migrateTo('033_media_variants_and_category_pages')).error);
  assert.equal(await body(), before);
  assert.equal(await check(), checkBefore);
  assert.equal((await db.selectFrom('categories').select('name').where('id', '=', fallback.id).executeTakeFirstOrThrow()).name, 'Uncategorized');
  await assert.rejects(db.updateTable('categories').set({ name: 'General' }).where('id', '=', fallback.id).execute(), { code: '23514' });
  await assert.rejects(db.insertInto('categories').values({ owner_id: 'owner-a', name: 'uncategorized' }).execute(), { code: '23514' });

  // And up again, where a removed owner still takes their categories with them.
  await migrateToLatest();
  await db.deleteFrom('user').where('id', '=', 'owner-b').execute();
  assert.equal((await db.selectFrom('categories').select('id').where('owner_id', '=', 'owner-b').execute()).length, 0);
});
