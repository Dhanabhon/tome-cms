import assert from 'node:assert/strict';
import test from 'node:test';

test('a spare Passkey is taken only from an owner session verified in the last five minutes', async (t) => {
  const environment = {
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
    TOME_CMS_PUBLIC_URL: 'http://localhost:4321', TOME_CMS_INSTALL_TOKEN: 'i'.repeat(32),
    BETTER_AUTH_SECRET: 'a'.repeat(32), TOME_CMS_CONTEXT_SECRET: 'c'.repeat(32),
    TOME_CMS_RECOVERY_PEPPER: 'r'.repeat(32), S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 's'.repeat(24), S3_BUCKET: 'test-media',
    MEDIA_PUBLIC_URL: 'http://localhost:9000/test-media/',
  };
  for (const [key, value] of Object.entries(environment)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const { closeDatabase } = await import('../../src/server/db/client');
  t.after(closeDatabase);
  const { auth } = await import('../../src/server/auth/config');
  const { FRESH_SESSION_SECONDS } = await import('../../src/server/auth/fresh-session');
  const plugin = auth.options.plugins.find((candidate) => candidate.id === 'passkey') as unknown as {
    options: { registration: { afterVerification: (input: unknown) => Promise<unknown> } };
  };
  const register = (createdAt: Date) => plugin.options.registration.afterVerification({
    context: null,
    ctx: {
      body: { response: { id: 'spare-credential' } },
      context: {
        session: { user: { id: 'owner' }, session: { id: 'session', token: 'token', createdAt } },
        adapter: { findOne: async () => ({ ownerId: 'owner' }) },
      },
    },
    user: { id: 'owner', name: 'owner' },
    verification: { registrationInfo: { credential: { id: 'spare-credential' } } },
  });

  await assert.rejects(register(new Date(Date.now() - (FRESH_SESSION_SECONDS + 60) * 1000)), /Fresh owner verification required/);
  await assert.rejects(register(new Date(Number.NaN)), /Fresh owner verification required/);
  await register(new Date());
});
