import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';

import { runWithEndpointContext } from '@better-auth/core/context';
import { makeSignature } from 'better-auth/crypto';
import { sql } from 'kysely';

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
const { OAuthPageError, OAuthTokenError } = oauth;

const OWNER = 'owner-a';
const ORIGIN = 'http://localhost:4321';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
let config: McpConfig;
let clientId: string;

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeParams(overrides: Record<string, string> = {}, challenge = pkce().challenge) {
  return new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: CLAUDE, code_challenge: challenge,
    code_challenge_method: 'S256', scope: 'content:read drafts:write', state: 'xyz', resource: `${ORIGIN}/mcp`,
    ...overrides,
  });
}

/** A code the owner just approved, and the verifier that goes with it. */
async function approvedCode(write = true) {
  const { verifier, challenge } = pkce();
  const { requestId } = await oauth.startAuthorization(config, authorizeParams({}, challenge));
  const { redirect } = await oauth.decide(config, OWNER, requestId, { allow: true, write });
  return { code: new URL(redirect).searchParams.get('code')!, verifier };
}

function codeForm(code: string, verifier: string) {
  return new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE, client_id: clientId, code_verifier: verifier });
}

async function refuses(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error) => error instanceof OAuthTokenError && error.code === code);
}

async function setWrite(value: 'on' | 'off') {
  await writePluginSettings(OWNER, { enabled: true, id: 'mcp', values: { allowWrite: value } });
  config = (await mcpConfig())!;
}

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

before(async () => {
  await migrateToLatest();
  await db.insertInto('user').values({ id: OWNER, name: OWNER, email: `${OWNER}@example.invalid`, emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: OWNER, site_name: 'MCP', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  assert.equal(await mcpConfig(), null, 'off until the owner switches it on');
  await writePluginSettings(OWNER, { enabled: true, id: 'mcp', values: {} });
  config = (await mcpConfig())!;
  assert.deepEqual(config, {
    ownerId: OWNER, adminPath: '/admin', resource: `${ORIGIN}/mcp`, issuer: ORIGIN, allowWrite: true, extraRedirects: [],
  });
});
after(closeDatabase);

test('DCR registers a public client only for an allowed redirect', async () => {
  const client = await oauth.registerClient(config, { client_name: 'Claude', redirect_uris: [CLAUDE] });
  assert.match(client.client_id, /^dcr:/);
  assert.equal(client.client_name, 'Claude');
  assert.deepEqual(client.redirect_uris, [CLAUDE]);
  const row = await db.selectFrom('mcp_clients').selectAll().where('id', '=', client.client_id).executeTakeFirstOrThrow();
  assert.equal(row.approved, false);
  assert.equal(row.kind, 'dcr');
  clientId = client.client_id;

  await db.insertInto('mcp_clients').values({
    id: 'dcr:stale', owner_id: OWNER, kind: 'dcr', name: 'Stale', redirect_uris: sql<string[]>`'[]'::jsonb`,
  }).execute();
  await sql`update mcp_clients set created_at = now() - interval '25 hours' where id = 'dcr:stale'`.execute(db);
  await oauth.registerClient(config, { client_name: 'Another', redirect_uris: ['http://localhost/callback'] });
  assert.equal(await db.selectFrom('mcp_clients').select('id').where('id', '=', 'dcr:stale').executeTakeFirst(), undefined, 'a day unapproved and it is gone');

  await assert.rejects(oauth.registerClient(config, { client_name: 'Evil', redirect_uris: ['https://evil.example/cb'] }), /redirect/);
  await assert.rejects(oauth.registerClient(config, { client_name: 'None', redirect_uris: [] }), /redirect/);
  await assert.rejects(oauth.registerClient(config, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'client_secret_basic' }));
  await assert.rejects(oauth.registerClient(config, 'not an object'));
});

test('an authorization request is checked before anything is shown', async () => {
  const { requestId } = await oauth.startAuthorization(config, authorizeParams());
  assert.deepEqual(oauth.describeRequest(config, requestId), {
    clientName: 'Claude', redirectHost: 'claude.ai', loopbackOnly: false, wantsWrite: true, writeAllowed: true,
    brand: 'claude', redirectIsLoopback: false,
  });
  assert.equal(oauth.describeRequest(config, 'no-such-request'), null);

  const bad: Record<string, string>[] = [
    { code_challenge_method: 'plain' },
    { resource: 'https://elsewhere.example/mcp' },
    { redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect' },
    { client_id: 'dcr:00000000-0000-4000-8000-000000000000' },
    { response_type: 'token' },
    { scope: 'content:read admin' },
    { code_challenge: 'short' },
  ];
  for (const overrides of bad) {
    await assert.rejects(oauth.startAuthorization(config, authorizeParams(overrides)), OAuthPageError, JSON.stringify(overrides));
  }
  const twice = authorizeParams();
  twice.append('redirect_uri', 'http://127.0.0.1:9999/cb');
  await assert.rejects(oauth.startAuthorization(config, twice), OAuthPageError, 'a parameter given twice');
});

test('allowing issues a code to the redirect, approves the client and makes one connection', async () => {
  const { requestId } = await oauth.startAuthorization(config, authorizeParams());
  const { redirect } = await oauth.decide(config, OWNER, requestId, { allow: true, write: true });
  const url = new URL(redirect);
  assert.equal(`${url.origin}${url.pathname}`, CLAUDE);
  assert.match(url.searchParams.get('code')!, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.searchParams.get('state'), 'xyz');
  assert.equal(url.searchParams.get('iss'), ORIGIN);

  const client = await db.selectFrom('mcp_clients').select('approved').where('id', '=', clientId).executeTakeFirstOrThrow();
  assert.equal(client.approved, true);
  const connections = await db.selectFrom('mcp_connections').selectAll().execute();
  assert.equal(connections.length, 1);
  assert.deepEqual(connections[0]!.scopes, ['content:read', 'drafts:write']);
  assert.equal(connections[0]!.redirect_host, 'claude.ai');
  const stored = await db.selectFrom('mcp_codes').select('code_hash').execute();
  assert.ok(stored.every(({ code_hash }) => code_hash !== url.searchParams.get('code')), 'only the hash is stored');

  await assert.rejects(oauth.decide(config, OWNER, requestId, { allow: true, write: true }), OAuthPageError, 'single use');
  assert.equal(oauth.describeRequest(config, requestId), null);
});

test('with writing switched off, allowing grants reading only', async () => {
  await setWrite('off');
  try {
    const { requestId } = await oauth.startAuthorization(config, authorizeParams());
    assert.equal(oauth.describeRequest(config, requestId)?.writeAllowed, false);
    const before = await db.selectFrom('mcp_connections').select('id').execute();
    await oauth.decide(config, OWNER, requestId, { allow: true, write: true });
    const made = await db.selectFrom('mcp_connections').selectAll().where('id', 'not in', before.map(({ id }) => id)).executeTakeFirstOrThrow();
    assert.deepEqual(made.scopes, ['content:read']);
  } finally {
    await setWrite('on');
  }
  // Not ticked: reading only, though the client asked and writing is on.
  const { requestId } = await oauth.startAuthorization(config, authorizeParams());
  const { redirect } = await oauth.decide(config, OWNER, requestId, { allow: true, write: false });
  const { code } = Object.fromEntries(new URL(redirect).searchParams) as { code: string };
  const row = await db.selectFrom('mcp_codes').innerJoin('mcp_connections', 'mcp_connections.id', 'mcp_codes.connection_id')
    .select('scopes').where('code_hash', '=', createHash('sha256').update(code).digest('hex')).executeTakeFirstOrThrow();
  assert.deepEqual(row.scopes, ['content:read']);
});

test("the owner's tick grants writing even when the client asked only to read, and only while writing is on", async () => {
  const readOnly = authorizeParams({ scope: 'content:read' });
  const scopesOf = async (redirect: string) => {
    const hash = createHash('sha256').update(new URL(redirect).searchParams.get('code')!).digest('hex');
    const row = await db.selectFrom('mcp_codes').innerJoin('mcp_connections', 'mcp_connections.id', 'mcp_codes.connection_id')
      .select('scopes').where('code_hash', '=', hash).executeTakeFirstOrThrow();
    return row.scopes;
  };
  const asked = await oauth.startAuthorization(config, readOnly);
  assert.equal(oauth.describeRequest(config, asked.requestId)?.wantsWrite, false, 'the box is drawn, not ticked');
  assert.deepEqual(await scopesOf((await oauth.decide(config, OWNER, asked.requestId, { allow: true, write: true })).redirect), ['content:read', 'drafts:write']);
  await setWrite('off');
  try {
    const off = await oauth.startAuthorization(config, readOnly);
    assert.deepEqual(await scopesOf((await oauth.decide(config, OWNER, off.requestId, { allow: true, write: true })).redirect), ['content:read']);
  } finally {
    await setWrite('on');
  }
});

test('denying redirects with access_denied and connects nothing', async () => {
  const before = (await db.selectFrom('mcp_connections').select('id').execute()).length;
  const { requestId } = await oauth.startAuthorization(config, authorizeParams());
  const { redirect } = await oauth.decide(config, OWNER, requestId, { allow: false, write: false });
  const url = new URL(redirect);
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('state'), 'xyz');
  assert.equal(url.searchParams.get('code'), null);
  assert.equal((await db.selectFrom('mcp_connections').select('id').execute()).length, before);
});

test('a code is exchanged once, with its verifier, within 60 seconds', async () => {
  const { code, verifier } = await approvedCode();
  const tokens = await oauth.exchange(config, codeForm(code, verifier));
  assert.deepEqual(Object.keys(tokens).sort(), ['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type']);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, 'content:read drafts:write');
  assert.match(tokens.access_token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tokens.access_token, tokens.refresh_token);

  assert.ok(await oauth.verifyAccessToken(config, tokens.access_token));
  await refuses(oauth.exchange(config, codeForm(code, verifier)), 'invalid_grant');
  assert.equal(await oauth.verifyAccessToken(config, tokens.access_token), null, 'a code used twice revokes what it issued');

  const wrong = await approvedCode();
  await refuses(oauth.exchange(config, codeForm(wrong.code, pkce().verifier)), 'invalid_grant');
  await refuses(oauth.exchange(config, codeForm(wrong.code, wrong.verifier)), 'invalid_grant');

  const late = await approvedCode();
  await db.updateTable('mcp_codes').set({ expires_at: new Date(Date.now() - 1_000) })
    .where('code_hash', '=', createHash('sha256').update(late.code).digest('hex')).execute();
  await refuses(oauth.exchange(config, codeForm(late.code, late.verifier)), 'invalid_grant');

  const elsewhere = await approvedCode();
  await refuses(oauth.exchange(config, new URLSearchParams({ ...Object.fromEntries(codeForm(elsewhere.code, elsewhere.verifier)), redirect_uri: 'http://127.0.0.1:1/cb' })), 'invalid_grant');
  const other = await approvedCode();
  await refuses(oauth.exchange(config, new URLSearchParams({ ...Object.fromEntries(codeForm(other.code, other.verifier)), client_id: 'dcr:someone-else' })), 'invalid_grant');

  await refuses(oauth.exchange(config, new URLSearchParams({ grant_type: 'password' })), 'unsupported_grant_type');
  await refuses(oauth.exchange(config, new URLSearchParams({ grant_type: 'authorization_code' })), 'invalid_request');
  await refuses(oauth.exchange(config, new URLSearchParams()), 'invalid_request');
});

test('an access token verifies until its connection is revoked', async () => {
  const issued = await approvedCode();
  const tokens = await oauth.exchange(config, codeForm(issued.code, issued.verifier));
  const verified = await oauth.verifyAccessToken(config, tokens.access_token);
  assert.ok(verified);
  assert.deepEqual(verified.scopes, ['content:read', 'drafts:write']);
  assert.equal(verified.clientName, 'Claude');
  assert.ok(verified.expiresAt > Date.now() + 3_500_000);
  const used = await db.selectFrom('mcp_connections').select('last_used_at').where('id', '=', verified.connectionId).executeTakeFirstOrThrow();
  assert.ok(used.last_used_at, 'last used is touched');

  assert.equal(await oauth.verifyAccessToken(config, randomBytes(32).toString('base64url')), null);
  assert.equal(await oauth.verifyAccessToken(config, tokens.refresh_token), null, 'a refresh token is not an access token');
  assert.equal(await oauth.verifyAccessToken(config, ''), null);

  const { code, verifier } = await approvedCode();
  const doomed = await oauth.exchange(config, codeForm(code, verifier));
  const connection = (await oauth.verifyAccessToken(config, doomed.access_token))!.connectionId;
  await db.updateTable('mcp_connections').set({ revoked_at: new Date() }).where('id', '=', connection).execute();
  assert.equal(await oauth.verifyAccessToken(config, doomed.access_token), null);
  await refuses(oauth.exchange(config, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: doomed.refresh_token, client_id: clientId })), 'invalid_grant');
});

test('a refresh token rotates, and one used again after a 30-second grace revokes the connection', async () => {
  const { code, verifier } = await approvedCode();
  const first = await oauth.exchange(config, codeForm(code, verifier));
  const refresh = (token: string, client = clientId) => oauth.exchange(config, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: client }));

  await refuses(refresh(first.refresh_token, 'dcr:someone-else'), 'invalid_grant');
  const second = await refresh(first.refresh_token);
  assert.notEqual(second.access_token, first.access_token);
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.equal(second.scope, 'content:read drafts:write');
  assert.ok(await oauth.verifyAccessToken(config, second.access_token));

  // Within 30 seconds of its rotation, a used token is refused and nothing else happens.
  await refuses(refresh(first.refresh_token), 'invalid_grant');
  assert.ok(await oauth.verifyAccessToken(config, second.access_token), 'reuse inside the grace leaves the connection');
  // After that, reuse is theft: the whole connection goes.
  await db.updateTable('mcp_tokens').set({ rotated_at: sql<Date>`rotated_at - interval '31 seconds'` })
    .where('token_hash', '=', createHash('sha256').update(first.refresh_token).digest('hex')).execute();
  await refuses(refresh(first.refresh_token), 'invalid_grant');
  assert.equal(await oauth.verifyAccessToken(config, second.access_token), null, 'reuse after the grace revokes the connection');
  await refuses(refresh(second.refresh_token), 'invalid_grant');

  // Two at once, as a connector does when the hour runs out: one rotates, the other is refused,
  // and the winner's pair still works.
  const fresh = await approvedCode();
  const pair = await oauth.exchange(config, codeForm(fresh.code, fresh.verifier));
  const raced = await Promise.allSettled([refresh(pair.refresh_token), refresh(pair.refresh_token)]);
  const won = raced.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof refresh>>> => result.status === 'fulfilled');
  assert.equal(won.length, 1);
  assert.ok(await oauth.verifyAccessToken(config, won[0]!.value.access_token), 'the race left the connection alive');
  const parallel = await approvedCode();
  const both = await Promise.allSettled([1, 2].map(() => oauth.exchange(config, codeForm(parallel.code, parallel.verifier))));
  assert.equal(both.filter(({ status }) => status === 'fulfilled').length, 1, 'a code is spent once');
});

test('the token endpoint over HTTP: no Origin, a form body, no cookie read', async () => {
  const { crossSiteRefusal } = await import('../../src/server/http/origin-guard');
  const { POST } = await import('../../src/pages/oauth/token');
  const post = (body: string, headers: Record<string, string> = {}) => {
    const request = new Request('http://127.0.0.1:4321/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body,
    });
    assert.equal(crossSiteRefusal(request, ORIGIN), null, 'the origin guard lets a server call through');
    return POST({ request, clientAddress: '127.0.0.1' } as unknown as Parameters<typeof POST>[0]);
  };

  const { code, verifier } = await approvedCode();
  const ok = await post(codeForm(code, verifier).toString());
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('pragma'), 'no-cache');
  assert.equal((await ok.json() as { token_type: string }).token_type, 'Bearer');

  const unread = new ReadableStream({ pull() { throw new Error('the body was read'); } });
  const oversized = await POST({
    request: new Request('http://127.0.0.1:4321/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '999999' }, body: unread, duplex: 'half',
    } as RequestInit),
    clientAddress: '127.0.0.1',
  } as unknown as Parameters<typeof POST>[0]);
  assert.equal(oversized.status, 400, 'refused on its declared length, unread');
  assert.equal((await post('a='.padEnd(17 * 1024, 'x'))).status, 400, 'and on its real length');

  const json = await post(JSON.stringify({ grant_type: 'authorization_code' }), { 'content-type': 'application/json' });
  assert.equal(json.status, 400);
  assert.deepEqual(await json.json(), { error: 'invalid_request' });

  // The owner's own browser session is no credential here.
  const cookie = await ownerCookie();
  const withCookie = await post(new URLSearchParams({ grant_type: 'authorization_code', code: 'nothing', redirect_uri: CLAUDE, client_id: clientId, code_verifier: pkce().verifier }).toString(), { cookie });
  assert.equal(withCookie.status, 400);
  assert.deepEqual(await withCookie.json(), { error: 'invalid_grant' });
  assert.equal(withCookie.headers.get('cache-control'), 'no-store');
});

test('a CIMD client is fetched once a day, stored only when allowed, and only with allowed redirects', async () => {
  const url = 'https://app.example/client.json';
  const fetched: string[] = [];
  oauth.setClientMetadataFetcherForTest(async (id) => {
    fetched.push(id);
    if (id.startsWith('https://flood.example/')) return { name: 'Flood', redirectUris: ['http://127.0.0.1/callback'] };
    return id === url
      ? { name: 'Example app', redirectUris: ['http://127.0.0.1/callback'] }
      : { name: 'Sneaky', redirectUris: [CLAUDE, 'https://evil.example/cb'] };
  });
  const stored = () => db.selectFrom('mcp_clients').selectAll().where('id', '=', url).executeTakeFirst();
  const { requestId } = await oauth.startAuthorization(config, authorizeParams({ client_id: url, redirect_uri: 'http://127.0.0.1:53100/callback' }));
  assert.deepEqual(oauth.describeRequest(config, requestId), {
    clientName: 'Example app', redirectHost: '127.0.0.1:53100', loopbackOnly: true, wantsWrite: true, writeAllowed: true,
    brand: null, redirectIsLoopback: true,
  });
  assert.equal(await stored(), undefined, 'nothing is stored before the owner allows it');
  await oauth.startAuthorization(config, authorizeParams({ client_id: url, redirect_uri: 'http://127.0.0.1:53101/callback' }));
  assert.deepEqual(fetched, [url], 'cached for a day');

  await oauth.decide(config, OWNER, requestId, { allow: true, write: false });
  const row = await stored();
  assert.ok(row, 'stored once allowed');
  assert.equal(row.kind, 'cimd');
  assert.equal(row.approved, true);
  assert.deepEqual(row.redirect_uris, ['http://127.0.0.1/callback']);
  assert.ok(row.fetched_at);
  await oauth.startAuthorization(config, authorizeParams({ client_id: url, redirect_uri: 'http://127.0.0.1:53102/callback' }));
  assert.equal(fetched.length, 1, 'the stored row is used while it is fresh');

  await db.updateTable('mcp_clients').set({ fetched_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where('id', '=', url).execute();
  await oauth.startAuthorization(config, authorizeParams({ client_id: url, redirect_uri: 'http://127.0.0.1:53103/callback' }));
  assert.equal(fetched.length, 2, 'fetched again after a day');

  const sneaky = 'https://sneaky.example/client.json';
  await assert.rejects(oauth.startAuthorization(config, authorizeParams({ client_id: sneaky })), OAuthPageError);
  assert.equal(await db.selectFrom('mcp_clients').select('id').where('id', '=', sneaky).executeTakeFirst(), undefined, 'not stored');
  await assert.rejects(oauth.startAuthorization(config, authorizeParams({ client_id: 'http://insecure.example/c.json' })), OAuthPageError);

  // Never allowed, never stored: unknown clients cannot fill the table.
  const before = (await db.selectFrom('mcp_clients').select('id').execute()).length;
  for (let index = 0; index < 5; index += 1) {
    await oauth.startAuthorization(config, authorizeParams({ client_id: `https://flood.example/${index}.json`, redirect_uri: 'http://127.0.0.1:1/callback' }));
  }
  assert.equal((await db.selectFrom('mcp_clients').select('id').execute()).length, before);
});

test('a mark follows the client document host, so a loopback Codex is OpenAI and a loopback stranger is nobody', async () => {
  const codex = 'https://chatgpt.com/oauth/codex/client.json';
  oauth.setClientMetadataFetcherForTest(async () => ({ name: 'Codex', redirectUris: ['http://127.0.0.1/callback'] }));
  const { requestId } = await oauth.startAuthorization(config, authorizeParams({ client_id: codex, redirect_uri: 'http://127.0.0.1:49205/callback' }));
  const summary = oauth.describeRequest(config, requestId);
  assert.equal(summary?.brand, 'openai');
  assert.equal(summary?.redirectIsLoopback, true);

  // It only calls itself Claude: registered by DCR, approved on loopback, it earns nothing.
  const lookalike = await oauth.registerClient(config, { client_name: 'Claude', redirect_uris: ['http://127.0.0.1:3118/callback'] });
  const asked = await oauth.startAuthorization(config, authorizeParams({ client_id: lookalike.client_id, redirect_uri: 'http://127.0.0.1:3118/callback' }));
  assert.equal(oauth.describeRequest(config, asked.requestId)?.brand, null);
});

test('the authorize endpoint is rate-limited per sender, with the same plain page', async () => {
  const { GET } = await import('../../src/pages/oauth/authorize');
  const call = () => GET({
    request: new Request(`${ORIGIN}/oauth/authorize?response_type=code`),
    url: new URL(`${ORIGIN}/oauth/authorize?response_type=code`),
    clientAddress: '203.0.113.9',
  } as unknown as Parameters<typeof GET>[0]);
  for (let index = 0; index < 30; index += 1) assert.equal((await call()).status, 400);
  const limited = await call();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.match(limited.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await limited.text(), /This connection request is not valid/);
});

test('the consent route: the owner, same origin, and a fresh passkey to allow', async () => {
  const { POST } = await import('../../src/pages/api/admin/mcp/consent');
  const owner = await ownerCookie();
  const answer = (body: unknown, headers: Record<string, string> = {}) => POST({
    request: new Request(`${ORIGIN}/api/admin/mcp/consent`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie: owner, origin: ORIGIN, ...headers },
    }),
  } as unknown as Parameters<typeof POST>[0]);

  const first = await oauth.startAuthorization(config, authorizeParams());
  assert.equal((await answer({ request: first.requestId, allow: false, write: false }, { cookie: '' })).status, 401);
  assert.equal((await answer({ request: first.requestId, allow: false, write: false }, { origin: 'https://evil.example' })).status, 403);
  assert.ok(oauth.describeRequest(config, first.requestId), 'a refused answer leaves the request waiting');

  const denied = await answer({ request: first.requestId, allow: false, write: false });
  assert.equal(denied.status, 200);
  assert.equal(new URL((await denied.json() as { redirect: string }).redirect).searchParams.get('error'), 'access_denied');
  const again = await answer({ request: first.requestId, allow: false, write: false });
  assert.equal(again.status, 400);
  assert.equal((await again.json() as { code: string }).code, 'mcp_request_invalid');

  const second = await oauth.startAuthorization(config, authorizeParams());
  const allowed = await answer({ request: second.requestId, allow: true, write: true });
  assert.equal(allowed.status, 200);
  assert.ok(new URL((await allowed.json() as { redirect: string }).redirect).searchParams.get('code'));

  // A session from before the last five minutes is not a passkey just now.
  await db.updateTable('session').set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }).where('userId', '=', OWNER).execute();
  const third = await oauth.startAuthorization(config, authorizeParams());
  assert.equal((await answer({ request: third.requestId, allow: true, write: true })).status, 403);
  assert.ok(oauth.describeRequest(config, third.requestId), 'still waiting for the passkey');
  assert.equal((await answer({ request: third.requestId, allow: false, write: false })).status, 200, 'denying needs no passkey');
});

test('every OAuth path is a 404 while the plugin is off', async () => {
  const { POST } = await import('../../src/pages/oauth/token');
  await writePluginSettings(OWNER, { enabled: false, id: 'mcp', values: {} });
  assert.equal(await mcpConfig(), null);
  const response = await POST({
    request: new Request('http://127.0.0.1:4321/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token' }),
    clientAddress: '127.0.0.1',
  } as unknown as Parameters<typeof POST>[0]);
  assert.equal(response.status, 404);
});
