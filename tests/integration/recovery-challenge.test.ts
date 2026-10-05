import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The sign-in plugin guards the recovery-code form, and not the passkey sign-in.
 *
 * A passkey cannot be guessed or phished; a recovery code is the one secret a person types. On
 * 2026-10-06 the challenge on the passkey sign-in refused the owner on a second PC whose passkey
 * worked, so the check moved to where a guess could be made.
 */
test('the challenge stands in front of a recovery code, and not in front of a passkey', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  await migrateToLatest();
  await db.insertInto('user').values({
    id: 'owner-r', name: 'Owner', email: 'recovery@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const { sql } = await import('kysely');
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'owner-r', 'Recovery Test', 'en', 'UTC', '/admin')`.execute(db);
  const { writePluginSettings } = await import('../../src/server/plugins/store');
  await writePluginSettings('owner-r', { enabled: true, id: 'turnstile', values: { secretKey: 'recovery-test-secret', siteKey: 'recovery-test-site' } });

  // Cloudflare, as far as this test needs it: one spent token and one wrong secret.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith('https://challenges.cloudflare.com/')) return realFetch(input, init);
    const token = (init?.body as FormData).get('response');
    const codes = token === 'spent-token' ? ['timeout-or-duplicate'] : ['invalid-input-secret'];
    return Response.json({ success: false, 'error-codes': codes });
  };
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  context.after(() => { globalThis.fetch = realFetch; console.warn = realWarn; });

  const { POST } = await import('../../src/pages/api/recovery/start');
  const start = (token: string | null, code = 'not-a-recovery-code') => POST({
    clientAddress: '203.0.113.20',
    request: new Request('http://localhost:4321/api/recovery/start', {
      body: JSON.stringify({ code }),
      headers: {
        'content-type': 'application/json',
        Origin: 'http://localhost:4321',
        ...(token ? { 'X-TomeCMS-Plugin-Token': token } : {}),
      },
      method: 'POST',
    }),
  } as Parameters<typeof POST>[0]);

  const missing = await start(null);
  assert.equal(missing.status, 403, 'a recovery code sent without the check');
  assert.equal(missing.headers.get('content-type'), 'application/problem+json');
  assert.equal((await missing.json() as { code?: string }).code, 'challenge_refused');

  const spent = await start('spent-token');
  assert.equal(spent.status, 403, 'a token Cloudflare has already seen');
  assert.equal((await spent.json() as { code?: string }).code, 'challenge_refused');
  // The next refusal can be read from the log: Cloudflare's reason, never the token itself.
  assert.ok(warnings.some((line) => /Recovery challenge refused \[turnstile\]: timeout-or-duplicate/.test(line)), warnings.join('\n'));
  assert.equal(warnings.some((line) => line.includes('spent-token')), false, 'the token is never logged');

  // A wrong secret is this installation's fault, not the visitor's: said out loud, and let through to the code.
  const unavailable = await start('any-token');
  assert.equal(unavailable.status, 400, 'the code itself was checked');
  assert.ok(warnings.some((line) => /Recovery challenge unavailable \[turnstile\]: invalid-input-secret/.test(line)), warnings.join('\n'));

  // The passkey sign-in asks the plugin nothing: without a token it is better-auth's refusal, not the challenge's.
  const { ALL } = await import('../../src/pages/api/auth/[...all]');
  const signIn = await ALL({
    clientAddress: '203.0.113.21',
    request: new Request('http://localhost:4321/api/auth/passkey/verify-authentication', {
      body: JSON.stringify({ response: { id: 'nobody' } }),
      headers: { 'content-type': 'application/json', Origin: 'http://localhost:4321' },
      method: 'POST',
    }),
  } as Parameters<typeof ALL>[0]);
  assert.notEqual(signIn.status, 403);
  assert.doesNotMatch(await signIn.text(), /challenge_refused/);
});
