import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { runWithEndpointContext, runWithTransaction } from '@better-auth/core/context';
import { makeSignature } from 'better-auth/crypto';
import { Migrator } from 'kysely/migration';

test('a device link is stored, issued, cancelled and consumed only for the installed owner', async (context) => {
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

  const authContext = await auth.$context;
  const endpointAuthContext = authContext as unknown as Parameters<typeof runWithEndpointContext>[0]['context'];
  await db.insertInto('passkey').values({
    id: 'primary', name: 'Primary', publicKey: 'primary-key', userId: 'owner', credentialID: 'primary-credential',
    counter: 0, deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null,
  }).execute();
  const ownerSession = await runWithEndpointContext({
    context: endpointAuthContext,
    path: '/passkey/verify-authentication',
    body: { response: { id: 'primary-credential' } },
  }, () => authContext.internalAdapter.createSession('owner'));
  const passkeysAndSessions = async () => ({
    passkeys: (await db.selectFrom('passkey').select('id').orderBy('id').execute()).map(({ id }) => id),
    sessions: (await db.selectFrom('session').select('id').orderBy('id').execute()).map(({ id }) => id),
  });

  // Registering from a device link: the passkey plugin's own hook, run inside a transaction as
  // better-auth runs it, against the real adapter.
  const passkeyPlugin = auth.options.plugins.find((candidate) => candidate.id === 'passkey') as unknown as {
    options: { registration: { afterVerification: (input: unknown) => Promise<unknown> } };
  };
  const register = (reference: string, createSession: boolean) => runWithTransaction(authContext.adapter, () =>
    passkeyPlugin.options.registration.afterVerification({
      context: reference,
      ctx: { body: { response: { id: 'device-credential' }, createSession }, context: { adapter: authContext.adapter } },
      user: { id: 'owner', name: 'owner' },
      verification: { registrationInfo: { credential: { id: 'device-credential' } } },
    }));
  const deviceReference = verifyEnrollmentContext(
    (await issue('owner')).context, 'device', process.env.TOME_CMS_CONTEXT_SECRET!,
  ).id;
  await assert.rejects(register(deviceReference, false), /Device registration must create a session/);
  const before = await passkeysAndSessions();
  await register(deviceReference, true);
  assert.ok(
    (await db.selectFrom('installation_enrollments').select('consumed_at').where('id', '=', deviceReference).executeTakeFirstOrThrow()).consumed_at instanceof Date,
    'a device registration spends its link',
  );
  assert.deepEqual(await passkeysAndSessions(), before, 'adding a device takes away no passkey and no session');
  await assert.rejects(register(deviceReference, true), /invalid or expired/i, 'a link registers one device only');
  const { cancelDeviceEnrollments, consumeDeviceEnrollmentReference, issueDeviceEnrollment } =
    await import('../../src/server/auth/device-link');
  await assert.rejects(runWithTransaction(authContext.adapter, () => consumeDeviceEnrollmentReference({
    reference: deviceReference, ownerId: 'owner', fallbackAdapter: authContext.adapter,
  })), /invalid or expired/i);

  // The registration options keep excludeCredentials for a device link: a browser that already
  // holds this site's passkey should refuse to make a second one.
  const { ALL } = await import('../../src/pages/api/auth/[...all]');
  const callAuth = (request: Request) => ALL({ request, clientAddress: '127.0.0.20' } as Parameters<typeof ALL>[0]);
  const optionsLink = await issue('owner');
  const options = await callAuth(new Request(
    `http://localhost:4321/api/auth/passkey/generate-register-options?context=${encodeURIComponent(optionsLink.context)}`,
  ));
  assert.equal(options.status, 200);
  const { excludeCredentials } = await options.json() as { excludeCredentials?: { id: string }[] };
  assert.deepEqual(excludeCredentials?.map(({ id }) => id), ['primary-credential']);

  // The registration header takes a device context as it takes a recovery one; any other is refused.
  const verifyWith = (enrollmentContext: string) => callAuth(new Request('http://localhost:4321/api/auth/passkey/verify-registration', {
    method: 'POST',
    headers: { Origin: 'http://localhost:4321', 'Content-Type': 'application/json', 'X-TomeCMS-Recovery-Context': enrollmentContext },
    body: JSON.stringify({ response: { id: 'device-credential' }, createSession: true }),
  }));
  const refused = 'Enrollment context is invalid or expired.';
  const viaDevice = await verifyWith(optionsLink.context);
  assert.notEqual(((await viaDevice.json()) as { error?: string }).error, refused);
  const installContext = (await createEnrollment({ email: 'owner@example.invalid', purpose: 'install', pendingUserId: 'owner' })).context;
  const viaInstall = await verifyWith(installContext);
  assert.equal(viaInstall.status, 400);
  assert.equal(((await viaInstall.json()) as { error?: string }).error, refused);

  // Issuing a link spends every earlier one; cancelling spends the current one.
  const first = await issueDeviceEnrollment('owner');
  const second = await issueDeviceEnrollment('owner');
  await assert.rejects(authorizeEnrollmentContext(optionsLink.context), /invalid or expired/i);
  await assert.rejects(authorizeEnrollmentContext(first.context), /invalid or expired/i);
  assert.equal((await authorizeEnrollmentContext(second.context)).purpose, 'device');
  assert.ok(second.expiresAt.getTime() > Date.now());
  await cancelDeviceEnrollments('owner');
  await assert.rejects(authorizeEnrollmentContext(second.context), /invalid or expired/i);
  await assert.rejects(issueDeviceEnrollment('other'), /invalid or expired/i, 'only the installed owner can be issued a link');

  // The admin API: a fresh owner session creates a link, a stale one cannot; cancelling needs no freshness.
  const signed = `${ownerSession.token}.${await makeSignature(ownerSession.token, authContext.secret)}`;
  const { POST, DELETE } = await import('../../src/pages/api/admin/security/device-link');
  const callLink = (method: 'POST' | 'DELETE', handler: typeof POST) => handler({
    request: new Request('http://localhost:4321/api/admin/security/device-link', {
      method,
      headers: { Cookie: `${authContext.authCookies.sessionToken.name}=${signed}`, Origin: 'http://localhost:4321' },
    }),
    clientAddress: '127.0.0.21',
  } as Parameters<typeof POST>[0]);
  const created = await callLink('POST', POST);
  assert.equal(created.status, 200);
  assert.equal(created.headers.get('Cache-Control'), 'no-store');
  const link = await created.json() as { url: string; expiresAt: string };
  const linkUrl = new URL(link.url);
  assert.equal(`${linkUrl.origin}${linkUrl.pathname}`, 'http://localhost:4321/add-device');
  const linkContext = linkUrl.searchParams.get('context')!;
  assert.equal((await authorizeEnrollmentContext(linkContext)).purpose, 'device');
  assert.equal(new Date(link.expiresAt).toISOString(), link.expiresAt);

  await db.updateTable('session').set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where('id', '=', ownerSession.id).execute();
  const stale = await callLink('POST', POST);
  assert.equal(stale.status, 403, 'a stale session creates no link');
  assert.equal(stale.headers.get('Content-Type'), 'application/problem+json');
  assert.equal((await authorizeEnrollmentContext(linkContext)).purpose, 'device', 'a refused request spends nothing');
  const cancelled = await callLink('DELETE', DELETE);
  assert.equal(cancelled.status, 200);
  assert.deepEqual(await cancelled.json(), { cancelled: true });
  await assert.rejects(authorizeEnrollmentContext(linkContext), /invalid or expired/i);

  const anonymous = await DELETE({
    request: new Request('http://localhost:4321/api/admin/security/device-link', { method: 'DELETE', headers: { Origin: 'http://localhost:4321' } }),
    clientAddress: '127.0.0.22',
  } as Parameters<typeof DELETE>[0]);
  assert.equal(anonymous.status, 401);

  // A recovery means the owner's credentials may be in someone else's hands, so it spends any
  // device link still waiting: one made with a stolen session must not outlive the recovery.
  const pending = await issueDeviceEnrollment('owner');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  await issueRecoveryEnrollment('owner');
  await assert.rejects(authorizeEnrollmentContext(pending.context), /invalid or expired/i);
});
