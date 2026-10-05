import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Migrator } from 'kysely/migration';

test('a device enrollment is stored and read only for the installed owner', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest, migrations } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  const migrator = new Migrator({ db, provider: { async getMigrations() { return migrations; } } });
  assert.ifError((await migrator.migrateTo('029_navigation_parent')).error);

  const addUser = (id: string) => db.insertInto('user').values({
    id, name: id, email: `${id}@example.invalid`, emailVerified: false, image: null, role: 'owner',
  }).execute();
  await addUser('owner');
  await addUser('other');
  const insertDevice = (userId: string) => db.insertInto('installation_enrollments').values({
    id: randomUUID(), context_hash: randomUUID(), purpose: 'device',
    pending_user_id: userId, email: `${userId}@example.invalid`, expires_at: new Date(Date.now() + 60_000),
  }).execute();
  await assert.rejects(insertDevice('owner'), { code: '23514' });

  await migrateToLatest();
  await insertDevice('owner');
  await db.deleteFrom('installation_enrollments').execute();

  const { createEnrollment, authorizeEnrollmentContext, resolveEnrollmentUserByReference, assertEnrollmentReference } =
    await import('../../src/server/auth/enrollment');
  const { verifyEnrollmentContext } = await import('../../src/server/auth/context');
  const { auth } = await import('../../src/server/auth/config');
  const { adapter } = await auth.$context;
  const issue = (userId: string) => createEnrollment({
    email: `${userId}@example.invalid`, purpose: 'device', pendingUserId: userId,
  });
  const readers = (userId: string, issued: { context: string }) => {
    const claims = verifyEnrollmentContext(issued.context, 'device', process.env.TOME_CMS_CONTEXT_SECRET!);
    return {
      authorize: () => authorizeEnrollmentContext(issued.context),
      byReference: () => resolveEnrollmentUserByReference({ reference: claims.id }),
      assertReference: () => assertEnrollmentReference({ reference: claims.id, pendingUserId: userId, fallbackAdapter: adapter }),
    };
  };

  // Before the site is installed there is no owner, so no device link is valid.
  const early = readers('owner', await issue('owner'));
  for (const read of Object.values(early)) await assert.rejects(read(), /invalid or expired/i);

  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner', site_name: 'Device Test', default_locale: 'en', timezone: 'UTC',
    admin_path: '/admin', author_avatar_media_id: null,
  }).execute();

  const owned = readers('owner', await issue('owner'));
  const authorized = await owned.authorize();
  assert.equal(authorized.purpose, 'device');
  assert.equal(authorized.user.id, 'owner');
  assert.equal((await owned.byReference()).id, 'owner');
  assert.equal(await owned.assertReference(), 'device');

  // A link for anyone but the installed owner is refused by every reader.
  const stranger = readers('other', await issue('other'));
  for (const read of Object.values(stranger)) await assert.rejects(read(), /invalid or expired/i);
});
