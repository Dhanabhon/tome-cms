import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema, type DBFieldAttribute } from 'better-auth/db';
import { sql } from 'kysely';

test('passkey and installer database contract', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test', 'use only the disposable Foundation database');
  const { db, pool, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest, pendingMigrationNames } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  assert.equal((await sql<{ name: string | null }>`select to_regclass('public."user"') as name`.execute(db)).rows[0].name, null);
  await migrateToLatest();
  assert.notEqual((await sql<{ name: string | null }>`select to_regclass('public."user"') as name`.execute(db)).rows[0].name, null, 'fresh migration creates the auth tables');
  await migrateToLatest();
  assert.deepEqual(await pendingMigrationNames(), []);

  await context.test('vendor columns, defaults, keys, indexes and foreign keys match pinned metadata', async () => {
    const { auth } = await import('../../src/server/auth/config');
    assert.equal(auth.options.database, pool);
    assert.equal(auth.options.baseURL, 'http://127.0.0.1:4321');
    assert.deepEqual(auth.options.trustedOrigins, ['http://127.0.0.1:4321']);
    assert.equal(auth.options.emailAndPassword?.enabled, false);
    const schema = getSchema(auth.options);
    assert.deepEqual(
      Object.entries(schema).filter(([, definition]) => !definition.disableMigrations).map(([name]) => name).sort(),
      ['account', 'passkey', 'session', 'user', 'verification'],
    );
    assert.deepEqual(
      Object.entries(schema).filter(([, definition]) => definition.disableMigrations).map(([name]) => name).sort(),
      ['installation_enrollments', 'site_settings'],
    );
    const columns = (await sql<{ table_name: string; column_name: string; udt_name: string; is_nullable: string; column_default: string | null }>`
      select table_name, column_name, udt_name, is_nullable, column_default
      from information_schema.columns where table_schema = 'public'
    `.execute(db)).rows;
    const indexes = (await sql<{ tablename: string; indexname: string; indexdef: string }>`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`.execute(db)).rows;
    const foreignKeys = (await sql<{ table_name: string; column_name: string; foreign_table: string; foreign_column: string; delete_rule: string }>`
      select tc.table_name, kcu.column_name, ccu.table_name as foreign_table, ccu.column_name as foreign_column, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu using (constraint_catalog, constraint_schema, constraint_name)
      join information_schema.constraint_column_usage ccu using (constraint_catalog, constraint_schema, constraint_name)
      join information_schema.referential_constraints rc using (constraint_catalog, constraint_schema, constraint_name)
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    `.execute(db)).rows;
    for (const [table, definition] of Object.entries(schema)) {
      if (definition.disableMigrations) continue;
      const actual = columns.filter(column => column.table_name === table);
      assert.deepEqual(actual.map(column => column.column_name).sort(), ['id', ...Object.keys(definition.fields)].sort());
      assert.ok(indexes.some(index => index.tablename === table && index.indexname === `${table}_pkey` && index.indexdef.includes('UNIQUE')));
      const fields: Record<string, DBFieldAttribute> = { id: { type: 'string', required: true }, ...definition.fields };
      for (const [name, field] of Object.entries(fields)) {
        const column = actual.find(column => column.column_name === name)!;
        assert.equal(column.udt_name, { string: 'text', number: 'int4', boolean: 'bool', date: 'timestamptz' }[String(field.type)]);
        assert.equal(column.is_nullable, field.required === false ? 'YES' : 'NO', `${table}.${name} nullability`);
        const hasTimestampDefault = field.type === 'date' && typeof field.defaultValue === 'function';
        assert.equal(column.column_default, hasTimestampDefault ? 'CURRENT_TIMESTAMP' : null, `${table}.${name} SQL default`);
        if (field.unique) {
          assert.ok(indexes.some(index => index.tablename === table && index.indexdef.includes('UNIQUE') && (index.indexdef.includes(`(${name})`) || index.indexdef.includes(`("${name}")`))), `${table}.${name} uniqueness`);
        }
        if (field.index) {
          assert.ok(indexes.some(index => index.indexname === `${table}_${name}_idx` && !index.indexdef.includes('UNIQUE') && (index.indexdef.includes(`(${name})`) || index.indexdef.includes(`("${name}")`))), `${table}.${name} index`);
        }
        if (field.references) {
          assert.deepEqual(foreignKeys.find(key => key.table_name === table && key.column_name === name), {
            table_name: table, column_name: name, foreign_table: field.references.model,
            foreign_column: field.references.field, delete_rule: (field.references.onDelete ?? 'cascade').toUpperCase(),
          });
        }
      }
    }
  });

  const addUser = (id: string, role = 'owner') => sql`insert into "user" (id, name, email, "emailVerified", role) values (${id}, 'Owner', ${`${id}@example.invalid`}, false, ${role})`.execute(db);
  await addUser('owner');
  await addUser('pending-owner');
  const { createEnrollment, consumeEnrollment, resolveEnrollmentUser } = await import('../../src/server/auth/enrollment');
  const { enforceRateLimit, RateLimitExceededError } = await import('../../src/server/auth/rate-limit');
  const pendingEmail = 'pending-owner@example.invalid';
  let installContextForInstalledCheck = '';

  await context.test('owner, enrollment, recovery and rate-limit constraints reject invalid state', async () => {
    await assert.rejects(addUser('non-owner', 'editor'), { code: '23514' });
    await sql`insert into installation_enrollments (id, context_hash, purpose, pending_user_id, email, expires_at) values ('enrollment', 'context-hash', 'install', 'owner', 'owner@example.invalid', now() + interval '10 minutes')`.execute(db);
    await assert.rejects(sql`insert into installation_enrollments (id, context_hash, purpose, pending_user_id, email, expires_at) values ('duplicate', 'context-hash', 'install', 'owner', 'owner@example.invalid', now())`.execute(db), { code: '23505' });
    await sql`update installation_enrollments set consumed_at = now() where id = 'enrollment'`.execute(db);
    await sql`insert into installation_enrollments (id, context_hash, purpose, pending_user_id, email, expires_at) values ('replacement', 'context-hash', 'recovery', 'owner', 'owner@example.invalid', now())`.execute(db);
    await assert.rejects(sql`update installation_enrollments set purpose = 'signin'`.execute(db), { code: '23514' });
    await sql`insert into recovery_codes (id, user_id, code_hash) values ('recovery', 'owner', 'code-hash')`.execute(db);
    await assert.rejects(sql`insert into recovery_codes (id, user_id, code_hash) values ('duplicate', 'owner', 'code-hash')`.execute(db), { code: '23505' });
    await sql`insert into security_rate_limits (key_hash, action, window_started_at, attempts) values ('rate-key-hash', 'install', now(), 1)`.execute(db);
    await assert.rejects(sql`update security_rate_limits set action = 'other'`.execute(db), { code: '23514' });
    await assert.rejects(sql`update security_rate_limits set attempts = -1`.execute(db), { code: '23514' });
  });

  await context.test('enrollment rows bind signed contexts to live pending users and consume once', async () => {
    const valid = await createEnrollment({ email: pendingEmail, purpose: 'recovery', pendingUserId: 'pending-owner' });
    assert.deepEqual(await resolveEnrollmentUser({ context: valid.context }), {
      id: 'pending-owner', name: 'Owner', email: pendingEmail,
    });
    const stored = await db.selectFrom('installation_enrollments')
      .select(['context_hash', 'expires_at']).where('pending_user_id', '=', 'pending-owner')
      .where('purpose', '=', 'recovery').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    assert.notEqual(stored.context_hash, valid.context, 'the raw signed context is never stored');
    assert.match(stored.context_hash, /^[a-f0-9]{64}$/);
    assert.equal(stored.expires_at.toISOString(), valid.expiresAt.toISOString());

    const expiredRow = await createEnrollment({ email: pendingEmail, purpose: 'recovery', pendingUserId: 'pending-owner' });
    const { hashEnrollmentContext } = await import('../../src/server/auth/context');
    await db.updateTable('installation_enrollments').set({ expires_at: new Date(Date.now() - 1_000) })
      .where('context_hash', '=', hashEnrollmentContext(expiredRow.context)).execute();
    await assert.rejects(resolveEnrollmentUser({ context: expiredRow.context }), /invalid or expired/i);

    const mismatched = await createEnrollment({ email: pendingEmail, purpose: 'recovery', pendingUserId: 'pending-owner' });
    await db.updateTable('installation_enrollments').set({ purpose: 'install' })
      .where('context_hash', '=', hashEnrollmentContext(mismatched.context)).execute();
    await assert.rejects(resolveEnrollmentUser({ context: mismatched.context }), /invalid or expired/i);

    const singleUse = await createEnrollment({ email: pendingEmail, purpose: 'recovery', pendingUserId: 'pending-owner' });
    const attempts = await Promise.allSettled([
      db.transaction().execute(trx => consumeEnrollment(singleUse.context, trx)),
      db.transaction().execute(trx => consumeEnrollment(singleUse.context, trx)),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
    assert.equal(attempts.find(result => result.status === 'fulfilled')?.value, 'pending-owner');
    await assert.rejects(resolveEnrollmentUser({ context: singleUse.context }), /invalid or expired/i);

    installContextForInstalledCheck = (await createEnrollment({
      email: pendingEmail, purpose: 'install', pendingUserId: 'pending-owner',
    })).context;
  });

  await context.test('auth challenge storage receives only a transaction-valid internal reference', async () => {
    const external = await createEnrollment({ email: pendingEmail, purpose: 'recovery', pendingUserId: 'pending-owner' });
    const { getServerEnv } = await import('../../src/server/env');
    const { verifyEnrollmentContext } = await import('../../src/server/auth/context');
    const claims = verifyEnrollmentContext(
      external.context, 'recovery', getServerEnv().TOME_CMS_CONTEXT_SECRET,
    );
    const { ALL } = await import('../../src/pages/api/auth/[...all]');
    const callAuth = (contextValue: string) => ALL({
      request: new Request(`http://127.0.0.1:4321/api/auth/passkey/generate-register-options?context=${encodeURIComponent(contextValue)}`),
      clientAddress: '127.0.0.1',
    } as Parameters<typeof ALL>[0]);

    assert.equal((await callAuth(claims.id)).status, 400, 'a public bare internal reference is rejected');
    assert.equal((await callAuth(external.context)).status, 200);
    const stored = await db.selectFrom('verification').select(['id', 'value'])
      .orderBy('createdAt', 'desc').executeTakeFirstOrThrow();
    assert.ok(!stored.value.includes(external.context), 'the signed bearer is absent from challenge storage');
    assert.equal((JSON.parse(stored.value) as { context?: unknown }).context, claims.id);

    const { assertEnrollmentReference } = await import('../../src/server/auth/enrollment');
    const { auth } = await import('../../src/server/auth/config');
    const { runWithTransaction } = await import('@better-auth/core/context');
    const authContext = await auth.$context;
    assert.equal(pool.options.max, 1);
    await runWithTransaction(authContext.adapter, () => assertEnrollmentReference({
      reference: claims.id, pendingUserId: 'pending-owner', fallbackAdapter: authContext.adapter,
    }));
    await db.deleteFrom('verification').where('id', '=', stored.id).execute();
  });

  await context.test('database rate limiter rolls windows without storing client addresses', async () => {
    const clientAddress = '203.0.113.42';
    for (let attempt = 0; attempt < 8; attempt += 1) await enforceRateLimit('install', clientAddress);
    await assert.rejects(
      enforceRateLimit('install', clientAddress),
      (error: unknown) => error instanceof RateLimitExceededError
        && error.status === 429 && error.retryAfter > 0 && error.retryAfter <= 900,
    );
    const row = await db.selectFrom('security_rate_limits').selectAll()
      .where('action', '=', 'install').orderBy('window_started_at', 'desc').executeTakeFirstOrThrow();
    assert.match(row.key_hash, /^[a-f0-9]{64}$/);
    assert.ok(!row.key_hash.includes(clientAddress));
    assert.equal(row.attempts, 9);

    await db.updateTable('security_rate_limits').set({ window_started_at: new Date(Date.now() - 16 * 60_000) })
      .where('key_hash', '=', row.key_hash).execute();
    await enforceRateLimit('install', clientAddress);
    assert.equal((await db.selectFrom('security_rate_limits').select('attempts')
      .where('key_hash', '=', row.key_hash).executeTakeFirstOrThrow()).attempts, 1);
  });

  await context.test('singleton site settings enforce locale, timezone and reserved admin paths', async () => {
    await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path) values (true, 'owner', 'Test Site', 'th', 'Asia/Bangkok', '/admin')`.execute(db);
    await assert.rejects(resolveEnrollmentUser({ context: installContextForInstalledCheck }), /invalid or expired/i);
    await assert.rejects(
      db.transaction().execute(trx => consumeEnrollment(installContextForInstalledCheck, trx)),
      /invalid or expired/i,
    );
    await db.deleteFrom('installation_enrollments').where('pending_user_id', '=', 'pending-owner').execute();
    await assert.rejects(sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path) values (true, 'pending-owner', 'Other Site', 'en', 'UTC', '/manage')`.execute(db), { code: '23505' });
    await assert.rejects(sql`update site_settings set id = false`.execute(db), { code: '23514' });
    for (const path of ['/api', '/install', '/health', '/_astro', '/blog', '/th', '/en', '/a', '/Admin', '/nested/path', '/admin/', '/-admin', `/${'a'.repeat(41)}`]) {
      await assert.rejects(sql`update site_settings set admin_path = ${path}`.execute(db), { code: '23514' });
    }
    await sql`update site_settings set admin_path = '/manage-site', default_locale = 'en', timezone = 'UTC'`.execute(db);
    await assert.rejects(sql`update site_settings set default_locale = 'fr'`.execute(db), { code: '23514' });
    await assert.rejects(sql`update site_settings set timezone = 'Europe/London'`.execute(db), { code: '23514' });
  });

  await context.test('deleting a user cascades vendor credentials, sessions and owned installer state', async () => {
    await sql`insert into session (id, "expiresAt", token, "updatedAt", "userId") values ('session', now() + interval '1 hour', 'session-fixture', now(), 'owner')`.execute(db);
    await sql`insert into account (id, "accountId", "providerId", "userId", "updatedAt") values ('account', 'account-fixture', 'test-only', 'owner', now())`.execute(db);
    await sql`insert into passkey (id, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp") values ('passkey', 'public-key-fixture', 'owner', 'credential-fixture', 0, 'singleDevice', false)`.execute(db);
    await sql`delete from "user" where id = 'owner'`.execute(db);
    for (const table of ['session', 'account', 'passkey', 'installation_enrollments', 'recovery_codes', 'site_settings']) {
      assert.equal((await sql<{ count: number }>`select count(*)::int as count from ${sql.table(table)}`.execute(db)).rows[0].count, 0, `${table} cascades`);
    }
    assert.equal((await sql<{ count: number }>`select count(*)::int as count from "user"`.execute(db)).rows[0].count, 1, 'the unrelated pending user remains');
  });
});
