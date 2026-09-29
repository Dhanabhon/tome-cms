import assert from 'node:assert/strict';
import test from 'node:test';

test('a rate limit counts each sender behind the proxy, and believes the proxy only from the proxy side', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  await migrateToLatest();
  const { db } = await import('../../src/server/db/client');
  const { ALL } = await import('../../src/pages/api/auth/[...all]');
  // A row from a window that ended long ago: nothing is left in it to count.
  const stale = 'e'.repeat(64);
  await db.insertInto('security_rate_limits')
    .values({ action: 'signin', attempts: 3, key_hash: stale, window_started_at: new Date(Date.now() - 2 * 60 * 60_000) })
    .execute();

  // A passkey check with nothing to check: it is refused, but only once the limit has counted it.
  const attempt = (peer: string, forwarded: string) => ALL({
    request: new Request('http://localhost:4321/api/auth/passkey/verify-authentication', {
      body: '{}',
      headers: { 'content-type': 'application/json', Origin: 'http://localhost:4321', 'X-Forwarded-For': forwarded },
      method: 'POST',
    }),
    clientAddress: peer,
  } as Parameters<typeof ALL>[0]);

  // Docker's bridge is where the owner's proxy connects from, so the managed install sees every
  // sender as it. The proxy writes the address it saw as the last entry of X-Forwarded-For.
  const BRIDGE = '172.18.0.1';
  for (let count = 1; count <= 10; count += 1) {
    assert.notEqual((await attempt(BRIDGE, '198.51.100.4')).status, 429, `attempt ${count}`);
  }
  assert.equal((await attempt(BRIDGE, '198.51.100.4')).status, 429, 'the 11th from one sender');
  assert.notEqual((await attempt(BRIDGE, '198.51.100.5')).status, 429, 'another sender behind the same proxy is not locked out with it');

  // From anywhere else the header is the sender's own words, and a made-up address buys no fresh count.
  const DIRECT = '203.0.113.9';
  for (let count = 1; count <= 10; count += 1) {
    assert.notEqual((await attempt(DIRECT, `192.0.2.${count}`)).status, 429, `direct attempt ${count}`);
  }
  assert.equal((await attempt(DIRECT, '192.0.2.99')).status, 429, 'someone who reached the app directly cannot pick their own address');

  // One /64 is one sender, however its addresses are spelled: rotating through a block buys nothing.
  for (let count = 1; count <= 10; count += 1) {
    assert.notEqual((await attempt(BRIDGE, `2001:db8::${count}`)).status, 429, `IPv6 attempt ${count}`);
  }
  assert.equal((await attempt(BRIDGE, '2001:0DB8:0:0:ffff::1')).status, 429, 'a new spelling from the same /64');
  assert.notEqual((await attempt(BRIDGE, '2001:db8:0:1::1')).status, 429, 'the next /64 is another sender');

  // What the table holds is who has been here lately, not everyone who ever was.
  const left = await db.selectFrom('security_rate_limits').select('key_hash').where('key_hash', '=', stale).execute();
  assert.deepEqual(left, [], 'a row from two hours ago is swept');
});
