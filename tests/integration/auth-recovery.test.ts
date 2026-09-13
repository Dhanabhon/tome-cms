import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { makeSignature } from 'better-auth/crypto';
import { getCurrentAdapter } from 'better-auth';
import { runWithEndpointContext, runWithTransaction } from '@better-auth/core/context';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';

test('recovery is one-time, revokes sessions, replaces credentials, and preserves a final Passkey', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest, migrations } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  const migrator = new Migrator({
    db,
    provider: { async getMigrations() { return migrations; } },
  });
  const beforeSessionCredentialMigration = await migrator.migrateTo('003_security_recovery');
  assert.ifError(beforeSessionCredentialMigration.error);

  await db.insertInto('user').values({
    id: 'owner', name: 'Owner', email: 'owner@example.invalid', emailVerified: false, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner', site_name: 'Recovery Test', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  await db.insertInto('passkey').values([
    { id: 'primary', name: 'Primary', publicKey: 'primary-key', userId: 'owner', credentialID: 'primary-credential', counter: 0, deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null },
    { id: 'spare', name: 'Spare', publicKey: 'spare-key', userId: 'owner', credentialID: 'spare-credential', counter: 0, deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null },
  ]).execute();
  await sql`
    insert into session (id, token, "userId", "expiresAt", "updatedAt") values
      ('legacy-session-1', 'legacy-token-1', 'owner', now() + interval '1 minute', now()),
      ('legacy-session-2', 'legacy-token-2', 'owner', now() + interval '1 minute', now())
  `.execute(db);
  await migrateToLatest();
  assert.equal(
    Number((await db.selectFrom('session').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count),
    0,
    'migration revokes sessions that cannot be bound to a credential',
  );
  await db.insertInto('recovery_codes').values({ id: randomUUID(), user_id: 'owner', code_hash: '0'.repeat(64) }).execute();

  const {
    consumeRecoveryCode,
    consumeRecoveryEnrollmentReference,
    hashRecoveryCode,
    regenerateRecoveryCodes,
  } = await import('../../src/server/auth/recovery');
  const { assertInstalledOwnerCredential, createEnrollment } = await import('../../src/server/auth/enrollment');
  const { auth } = await import('../../src/server/auth/config');
  const authContext = await auth.$context;
  const endpointAuthContext = authContext as unknown as Parameters<typeof runWithEndpointContext>[0]['context'];
  const createPasskeySession = (credentialId: string, path = '/passkey/verify-authentication') => runWithEndpointContext({
    context: endpointAuthContext,
    path,
    body: { response: { id: credentialId } },
  }, () => authContext.internalAdapter.createSession('owner'));

  const sessionBeforeRecovery = await createPasskeySession('primary-credential');
  assert.equal(
    (await db.selectFrom('session').select('credential_id').where('id', '=', sessionBeforeRecovery.id).executeTakeFirstOrThrow()).credential_id,
    'primary-credential',
  );
  await assertInstalledOwnerCredential({ credentialId: 'primary-credential', fallbackAdapter: authContext.adapter });

  const oldEnrollment = await createEnrollment({
    email: 'owner@example.invalid', pendingUserId: 'owner', purpose: 'recovery',
  });
  const codes = await regenerateRecoveryCodes('owner');
  assert.equal(codes.length, 10);
  assert.equal((await db.selectFrom('recovery_codes').select('consumed_at').where('code_hash', '=', '0'.repeat(64)).executeTakeFirstOrThrow()).consumed_at instanceof Date, true);
  const stored = await db.selectFrom('recovery_codes').select('code_hash').where('consumed_at', 'is', null).execute();
  assert.equal(stored.length, 10);
  assert.ok(stored.every(({ code_hash }) => !codes.includes(code_hash)));
  assert.ok(codes.every((code) => stored.some(({ code_hash }) => code_hash === hashRecoveryCode(code))));

  const recovery = await consumeRecoveryCode(codes[0]!);
  assert.equal(await db.selectFrom('session').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow().then(({ count }) => Number(count)), 0);
  await assert.rejects(consumeRecoveryCode(codes[0]!), /invalid or expired/i);
  const { hashEnrollmentContext, verifyEnrollmentContext } = await import('../../src/server/auth/context');
  assert.ok((await db.selectFrom('installation_enrollments').select('consumed_at').where('context_hash', '=', hashEnrollmentContext(oldEnrollment.context)).executeTakeFirstOrThrow()).consumed_at instanceof Date);
  const claims = verifyEnrollmentContext(recovery.context, 'recovery', process.env.TOME_CMS_CONTEXT_SECRET!);
  await assert.rejects(assertInstalledOwnerCredential({
    credentialId: 'primary-credential', fallbackAdapter: authContext.adapter,
  }), /authorization failed/i);
  await assert.rejects(createPasskeySession('primary-credential'), { code: '23514' });

  const replacementSession = await runWithEndpointContext({
    context: endpointAuthContext,
    path: '/passkey/verify-registration',
    body: { response: { id: 'replacement-credential' } },
  }, () => runWithTransaction(authContext.adapter, async () => {
    await consumeRecoveryEnrollmentReference({ reference: claims.id, ownerId: 'owner', fallbackAdapter: authContext.adapter });
    const adapter = await getCurrentAdapter(authContext.adapter);
    await adapter.create({
      model: 'passkey',
      forceAllowId: true,
      data: { id: 'replacement', name: 'Recovery passkey', publicKey: 'replacement-key', userId: 'owner', credentialID: 'replacement-credential', counter: 0, deviceType: 'singleDevice', backedUp: false, transports: '', createdAt: new Date(), aaguid: null },
    });
    return authContext.internalAdapter.createSession('owner');
  }));
  assert.deepEqual((await db.selectFrom('passkey').select('id').where('userId', '=', 'owner').execute()).map(({ id }) => id), ['replacement']);
  assert.deepEqual(
    await db.selectFrom('session').select(['id', 'credential_id']).where('userId', '=', 'owner').execute(),
    [{ id: replacementSession.id, credential_id: 'replacement-credential' }],
  );
  await assert.rejects(db.insertInto('session').values({
    id: 'stale-race-session', token: 'stale-race-token', userId: 'owner', credential_id: 'primary-credential',
    expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date(), ipAddress: null, userAgent: null,
  }).execute(), { code: '23503' });
  await assert.rejects(runWithTransaction(authContext.adapter, () => consumeRecoveryEnrollmentReference({
    reference: claims.id, ownerId: 'owner', fallbackAdapter: authContext.adapter,
  })), /invalid or expired/i);

  await db.updateTable('passkey').set({ counter: 1 }).where('id', '=', 'replacement').execute();
  assert.ok((await db.selectFrom('passkey').select('last_used_at').where('id', '=', 'replacement').executeTakeFirstOrThrow()).last_used_at instanceof Date);

  const sessionToken = replacementSession.token;
  const signed = `${sessionToken}.${await makeSignature(sessionToken, authContext.secret)}`;
  const headers = new Headers({
    Cookie: `${authContext.authCookies.sessionToken.name}=${signed}`,
    Origin: 'http://localhost:4321',
    'Content-Type': 'application/json',
  });
  const { DELETE } = await import('../../src/pages/api/admin/security/passkeys');
  const callDelete = (id: string) => DELETE({
    request: new Request('http://localhost:4321/api/admin/security/passkeys', { method: 'DELETE', headers, body: JSON.stringify({ id }) }),
    clientAddress: '127.0.0.10',
  } as Parameters<typeof DELETE>[0]);
  assert.equal((await callDelete('replacement')).status, 409);
  await (await getCurrentAdapter(authContext.adapter)).create({
    model: 'passkey',
    forceAllowId: true,
    data: { id: 'second', name: 'Second', publicKey: 'second-key', userId: 'owner', credentialID: 'second-credential', counter: 0, deviceType: 'singleDevice', backedUp: false, transports: '', createdAt: new Date(), aaguid: null },
  });
  assert.equal((await callDelete('replacement')).status, 200);
  assert.deepEqual((await db.selectFrom('passkey').select('id').where('userId', '=', 'owner').execute()).map(({ id }) => id), ['second']);
  assert.deepEqual(await db.selectFrom('session').select('id').where('userId', '=', 'owner').execute(), [], 'deleting a Passkey cascades its bound sessions');

  const { ALL } = await import('../../src/pages/api/auth/[...all]');
  const publicDelete = await ALL({
    request: new Request('http://localhost:4321/api/auth/passkey/delete-passkey', {
      method: 'POST', headers, body: JSON.stringify({ id: 'second' }),
    }),
    clientAddress: '127.0.0.10',
  } as Parameters<typeof ALL>[0]);
  assert.equal(publicDelete.status, 404, 'the vendor delete route cannot bypass the final-Passkey invariant');
  assert.ok(await db.selectFrom('passkey').select('id').where('id', '=', 'second').executeTakeFirst());
});
