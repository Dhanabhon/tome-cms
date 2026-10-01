import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';

import { runWithEndpointContext } from '@better-auth/core/context';
import { makeSignature } from 'better-auth/crypto';

import type { McpConfig } from '../../src/server/mcp/config';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(
  process.env.DATABASE_URL,
  'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
  'use only the disposable Foundation database',
);
const { db, closeDatabase } = await import('../../src/server/db/client');
const { migrateToLatest } = await import('../../src/server/db/migrator');
const { writePluginSettings } = await import('../../src/server/plugins/store');
const { mcpConfig } = await import('../../src/server/mcp/config');
const oauth = await import('../../src/server/mcp/oauth');
const { listConnections, revokeConnection } = await import('../../src/server/mcp/connections');

const OWNER = 'owner-a';
const OTHER = 'owner-b';
const ORIGIN = 'http://localhost:4321';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
let config: McpConfig;
let clientId: string;
const access: string[] = [];

/** A whole connection, as an AI app makes one: consent, then the code redeemed for tokens. */
async function connect(redeem = true): Promise<{ access: string }> {
  const verifier = randomBytes(32).toString('base64url');
  const { requestId } = await oauth.startAuthorization(config, new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: CLAUDE, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', scope: 'content:read drafts:write', state: 'xyz', resource: config.resource,
  }));
  const { redirect } = await oauth.decide(config, OWNER, requestId, { allow: true, write: true });
  if (!redeem) return { access: '' };
  const tokens = await oauth.exchange(config, new URLSearchParams({
    grant_type: 'authorization_code', code: new URL(redirect).searchParams.get('code')!, redirect_uri: CLAUDE, client_id: clientId, code_verifier: verifier,
  }));
  return { access: tokens.access_token };
}

before(async () => {
  await migrateToLatest();
  await db.insertInto('user').values({ id: OWNER, name: OWNER, email: `${OWNER}@example.invalid`, emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: OWNER, site_name: 'MCP', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  await writePluginSettings(OWNER, { enabled: true, id: 'mcp', values: {} });
  config = (await mcpConfig())!;
  clientId = (await oauth.registerClient(config, { client_name: 'Claude', redirect_uris: [CLAUDE] })).client_id;
});
after(closeDatabase);

test('connections are listed without any secret, and an abandoned consent is not one', async () => {
  const first = await connect();
  const second = await connect();
  await connect(false);
  const listed = await listConnections(OWNER);
  assert.equal(listed.length, 2);
  for (const connection of listed) {
    assert.equal(connection.clientName, 'Claude');
    assert.equal(connection.redirectHost, 'claude.ai');
    assert.deepEqual(connection.scopes, ['content:read', 'drafts:write']);
    assert.ok(connection.createdAt);
    assert.ok(!JSON.stringify(connection).match(/"[0-9a-f]{64}"/), 'no hash comes back');
  }
  access.push(first.access, second.access);
  const seen = await Promise.all(access.map((token) => oauth.verifyAccessToken(config, token)));
  assert.ok(seen.every(Boolean));
  // Using a token is what makes a connection list; that touch is what lastUsedAt reports.
  assert.ok((await listConnections(OWNER)).every((connection) => connection.lastUsedAt));
});

test('revoking one connection stops it and leaves the other, and drops it from the list', async () => {
  const listed = await listConnections(OWNER);
  const [one, other] = listed;
  const stopped = (await Promise.all(access.map(async (token) => ({ token, ok: await oauth.verifyAccessToken(config, token) }))));
  const victim = stopped.find(({ ok }) => ok?.connectionId === one!.id)!;
  await revokeConnection(OWNER, one!.id);
  assert.equal(await oauth.verifyAccessToken(config, victim.token), null);
  const survivor = stopped.find(({ ok }) => ok?.connectionId === other!.id)!;
  assert.ok(await oauth.verifyAccessToken(config, survivor.token));
  assert.deepEqual((await listConnections(OWNER)).map(({ id }) => id), [other!.id]);
});

test('another owner can neither see nor revoke a connection', async () => {
  await db.insertInto('user').values({ id: OTHER, name: OTHER, email: `${OTHER}@example.invalid`, emailVerified: true, image: null, role: 'owner' }).execute();
  const [mine] = await listConnections(OWNER);
  assert.deepEqual(await listConnections(OTHER), []);
  await revokeConnection(OTHER, mine!.id);
  assert.deepEqual((await listConnections(OWNER)).map(({ id }) => id), [mine!.id], 'still live');
});

test('switching MCP off and on again starts clean; saving while it stays on does not', async () => {
  await writePluginSettings(OWNER, { enabled: true, id: 'mcp', values: { allowWrite: 'off' } });
  assert.equal((await listConnections(OWNER)).length, 1, 'a save while on clears nothing');
  assert.ok((await db.selectFrom('mcp_clients').select('id').execute()).length > 0);

  await writePluginSettings(OWNER, { enabled: false, id: 'mcp', values: {} });
  assert.ok((await db.selectFrom('mcp_connections').select('id').execute()).length > 0, 'switching off alone clears nothing');
  await writePluginSettings(OWNER, { enabled: true, id: 'mcp', values: {} });
  assert.equal((await db.selectFrom('mcp_clients').select('id').execute()).length, 0);
  assert.equal((await db.selectFrom('mcp_connections').select('id').execute()).length, 0);
  assert.equal((await db.selectFrom('mcp_tokens').select('token_hash').execute()).length, 0);
});

let cookie: string | undefined;
/** A signed-in owner's session cookie, as a browser would hold it after a passkey. */
async function ownerCookie(): Promise<string> {
  if (cookie) return cookie;
  await db.insertInto('passkey').values({
    id: 'mcp-passkey', name: 'MCP', publicKey: 'mcp-key', userId: OWNER, credentialID: 'mcp-credential', counter: 0,
    deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null,
  }).execute();
  const { auth } = await import('../../src/server/auth/config');
  const authContext = await auth.$context;
  const session = await runWithEndpointContext({
    context: authContext as unknown as Parameters<typeof runWithEndpointContext>[0]['context'],
    path: '/passkey/verify-authentication',
    body: { response: { id: 'mcp-credential' } },
  }, () => authContext.internalAdapter.createSession(OWNER));
  cookie = `${authContext.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, authContext.secret)}`;
  return cookie;
}

test('the connections route: a 404 while off, and DELETE only from this origin', async () => {
  const { GET, DELETE } = await import('../../src/pages/api/admin/mcp/connections');
  const owner = await ownerCookie();
  const call = (handler: typeof GET, method: string, headers: Record<string, string> = {}) => handler({
    request: new Request(`${ORIGIN}/api/admin/mcp/connections`, {
      method, headers: { 'content-type': 'application/json', cookie: owner, origin: ORIGIN, ...headers },
      ...(method === 'DELETE' ? { body: JSON.stringify({ id: crypto.randomUUID() }) } : {}),
    }),
  } as unknown as Parameters<typeof GET>[0]);

  assert.equal((await call(GET, 'GET')).status, 200);
  assert.equal((await call(DELETE, 'DELETE', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(DELETE, 'DELETE')).status, 200);

  await writePluginSettings(OWNER, { enabled: false, id: 'mcp', values: {} });
  assert.equal((await call(GET, 'GET')).status, 404);
  assert.equal((await call(DELETE, 'DELETE')).status, 404);
});
