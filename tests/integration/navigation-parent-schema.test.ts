import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('a header item holds one level of sub-items, and the database refuses any other shape', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'submenus@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  let position = 0;
  const item = (values: Record<string, unknown>) => ({
    owner_id: ownerId, locale: 'en', location: 'header', kind: 'custom', label: 'Item', page_id: null,
    url: `/item-${position}`, position: position++, ...values,
  });
  const insert = (values: Record<string, unknown>) => db.insertInto('navigation_items')
    .values(item(values) as never).returning('id').executeTakeFirstOrThrow();
  const refused = async (why: string, values: Record<string, unknown>, code = '23514') => {
    await assert.rejects(insert(values), (error: unknown) => (error as { code?: string }).code === code, why);
  };

  const group = await insert({ kind: 'group', label: 'Services', url: null });
  const child = await insert({ parent_id: group.id });
  await refused('a sub-item holding a sub-item', { parent_id: child.id });
  await refused('a group with a link', { kind: 'group', url: '/somewhere' });
  await refused('a group in the footer', { kind: 'group', url: null, location: 'footer' });
  const footer = await insert({ location: 'footer' });
  await refused('a sub-item in the footer', { location: 'footer', parent_id: footer.id });
  await refused('a sub-item under a parent in the other menu', { parent_id: footer.id }, '23503');
  await refused('a sub-item under a parent in the other language', { locale: 'th', parent_id: group.id }, '23503');
  const plain = await insert({});
  const moved = async (why: string, id: string, parentId: string) => {
    await assert.rejects(
      db.updateTable('navigation_items').set({ parent_id: parentId }).where('id', '=', id).execute(),
      (error: unknown) => (error as { code?: string }).code === '23514',
      why,
    );
  };
  await moved('moving an item under a sub-item', plain.id, child.id);
  await moved('moving a parent with sub-items under another item', group.id, plain.id);
  await moved('an item as its own parent', plain.id, plain.id);

  await db.deleteFrom('navigation_items').where('id', '=', group.id).execute();
  const left = await db.selectFrom('navigation_items').select('id').where('id', '=', child.id).executeTakeFirst();
  assert.equal(left, undefined, 'a sub-item goes with its parent');

  // Down and up again: the migration can be taken back, and put back.
  const back = await insert({ kind: 'group', label: 'Back', url: null });
  await insert({ parent_id: back.id });
  const { Migrator } = await import('kysely/migration');
  const { migrations } = await import('../../src/server/db/migrator');
  const { sql } = await import('kysely');
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  const has = async () => (await sql<{ found: boolean }>`select exists (
    select 1 from information_schema.columns where table_name = 'navigation_items' and column_name = 'parent_id'
  ) as found`.execute(db)).rows[0]!.found;
  assert.ifError((await migrator.migrateTo('028_mcp')).error);
  assert.equal(await has(), false, 'down drops the column');
  const kept = await db.selectFrom('navigation_items').select('kind').where('owner_id', '=', ownerId).execute();
  assert.deepEqual(kept.map(({ kind }) => kind), ['custom', 'custom'], 'down keeps only the top-level links the old menu can hold');
  assert.ifError((await migrator.migrateToLatest()).error);
  assert.equal(await has(), true, 'and up adds it again');

  await db.deleteFrom('user').where('id', '=', ownerId).execute();
});
