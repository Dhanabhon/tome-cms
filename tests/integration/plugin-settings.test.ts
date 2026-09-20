import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * What a write to a plugin's settings keeps, and what it refuses.
 *
 * None of this was covered. The rules are the kind that fail silently -- a secret erased
 * by a save that never saw it, a site key erased by a switch being flipped -- and a screen
 * that reports "Saved." either way is the only witness.
 */
test('a plugin write keeps what it was not given, and refuses to switch on what is not ready', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { readPluginStates, writePluginSettings } = await import('../../src/server/plugins/store');
  const { openSecret } = await import('../../src/server/plugins/secrets');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('plugin_settings').execute();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'owner-p', name: 'Owner', email: 'plugins@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  const stored = async () => {
    const row = await db.selectFrom('plugin_settings').select('settings').where('id', '=', 'turnstile').executeTakeFirstOrThrow();
    return row.settings as Record<string, string>;
  };

  await writePluginSettings('owner-p', { enabled: false, id: 'turnstile', values: { secretKey: 'first-secret', siteKey: '0xSITE' } });
  assert.equal((await stored()).siteKey, '0xSITE');
  assert.equal(openSecret((await stored()).secretKey), 'first-secret', 'the secret is sealed and readable back');

  // The browser is never told a secret, so it cannot send one back. Blank means keep.
  await writePluginSettings('owner-p', { enabled: false, id: 'turnstile', values: { secretKey: '', siteKey: '0xSITE2' } });
  assert.equal((await stored()).siteKey, '0xSITE2');
  assert.equal(openSecret((await stored()).secretKey), 'first-secret', 'a blank secret field keeps the stored secret');

  // And a request that names no field at all is switching the plugin, not editing it.
  await writePluginSettings('owner-p', { enabled: true, id: 'turnstile', values: {} });
  assert.equal((await stored()).siteKey, '0xSITE2', 'a switch does not erase a setting it never mentioned');
  assert.equal(openSecret((await stored()).secretKey), 'first-secret');
  assert.equal((await readPluginStates('owner-p')).find((plugin) => plugin.id === 'turnstile')?.enabled, true);

  // An empty string is an edit, and says so.
  await writePluginSettings('owner-p', { enabled: false, id: 'turnstile', values: { siteKey: '' } });
  assert.equal((await stored()).siteKey, '', 'a field sent empty is cleared');

  // Which leaves it unable to be switched on, and the refusal says which field.
  await assert.rejects(
    () => writePluginSettings('owner-p', { enabled: true, id: 'turnstile', values: {} }),
    (error: unknown) => {
      const refusal = error as { status?: number; code?: string; message?: string };
      assert.equal(refusal.status, 400);
      assert.match(String(refusal.message), /Site key/);
      return true;
    },
    'an incomplete plugin cannot be switched on',
  );

  await assert.rejects(
    () => writePluginSettings('owner-p', { enabled: false, id: 'not-a-plugin', values: {} }),
    (error: unknown) => (error as { status?: number }).status === 404,
    'a plugin this build does not ship is not found',
  );
});
