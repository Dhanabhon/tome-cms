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
  await assert.rejects(oauth.registerClient(config, { redirect_uris: [CLAUDE], token_endpoint_auth_method: 'private_key_jwt' }), /public/);
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

test('Gemini connects: asked as a confidential client it registers as public, offline_access is ignored, the code goes to the relay', async () => {
  const relay = 'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-abc123-localhost';
  const { POST } = await import('../../src/pages/oauth/register');
  const registered = await POST({
    request: new Request(`${ORIGIN}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Gemini', redirect_uris: [relay], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code', 'refresh_token'],
      }),
    }),
    clientAddress: '203.0.113.40',
  } as unknown as Parameters<typeof POST>[0]);
  assert.equal(registered.status, 201);
  const gemini = await registered.json() as Record<string, unknown>;
  assert.equal(gemini.token_endpoint_auth_method, 'none', 'told it is public, as RFC 7591 3.2.1 allows');
  assert.equal('client_secret' in gemini, false, 'no secret is issued');
  const geminiId = gemini.client_id as string;
  const post = await oauth.registerClient(config, { redirect_uris: [relay], token_endpoint_auth_method: 'client_secret_post' });
  assert.equal(post.token_endpoint_auth_method, 'none');

  const { verifier, challenge } = pkce();
  const { requestId } = await oauth.startAuthorization(config, authorizeParams({
    client_id: geminiId, redirect_uri: relay, scope: 'content:read drafts:write offline_access',
  }, challenge));
  assert.equal(oauth.describeRequest(config, requestId)?.brand, 'gemini');
  const { redirect } = await oauth.decide(config, OWNER, requestId, { allow: true, write: true });
  const answer = new URL(redirect);
  assert.equal(`${answer.origin}${answer.pathname}`, relay);
  assert.equal(answer.searchParams.get('iss'), ORIGIN);
  assert.equal(answer.searchParams.get('state'), 'xyz');

  // A public client: no client_secret, and none needed.
  const tokens = await oauth.exchange(config, new URLSearchParams({
    grant_type: 'authorization_code', code: answer.searchParams.get('code')!, redirect_uri: relay, client_id: geminiId, code_verifier: verifier,
  }));
  assert.equal(tokens.scope, 'content:read drafts:write', 'offline_access grants nothing more');
  assert.ok(tokens.refresh_token);
  assert.equal((await oauth.verifyAccessToken(config, tokens.access_token))?.brand, 'gemini');

  await assert.rejects(
    oauth.startAuthorization(config, authorizeParams({ client_id: geminiId, redirect_uri: relay, scope: 'content:read bogus' })),
    OAuthPageError,
  );
});

test('a client that asked for client_secret_basic may send its client_id in HTTP Basic; the secret part is ignored', async () => {
  const relay = 'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-basic-localhost';
  const { client_id: id } = await oauth.registerClient(config, { redirect_uris: [relay], token_endpoint_auth_method: 'client_secret_basic' });
  const { POST } = await import('../../src/pages/oauth/token');
  const post = (form: Record<string, string>, authorization?: string) => POST({
    request: new Request(`${ORIGIN}/oauth/token`, {
      method: 'POST', body: new URLSearchParams(form).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(authorization ? { authorization } : {}) },
    }),
    clientAddress: '203.0.113.41',
  } as unknown as Parameters<typeof POST>[0]);
  const basic = (user: string, secret = '') => `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  const codeGrant = async () => {
    const { verifier, challenge } = pkce();
    const { requestId } = await oauth.startAuthorization(config, authorizeParams({ client_id: id, redirect_uri: relay }, challenge));
    const { redirect } = await oauth.decide(config, OWNER, requestId, { allow: true, write: false });
    return { grant_type: 'authorization_code', code: new URL(redirect).searchParams.get('code')!, redirect_uri: relay, code_verifier: verifier };
  };
  const tokens = async (response: Response) => {
    assert.equal(response.status, 200);
    return await response.json() as { refresh_token: string };
  };

  // Header only, the id form-encoded as RFC 6749 2.3.1 says, with whatever secret it made up.
  const first = await tokens(await post(await codeGrant(), basic(encodeURIComponent(id), 'made-up')));
  // Header only, the id not encoded: the last colon still splits it right.
  const second = await tokens(await post(await codeGrant(), basic(id)));
  // Body only, as before.
  await tokens(await post({ ...(await codeGrant()), client_id: id }));
  // Both, matching; and the refresh grant takes the header the same way.
  await tokens(await post({ ...(await codeGrant()), client_id: id }, basic(encodeURIComponent(id))));
  await tokens(await post({ grant_type: 'refresh_token', refresh_token: first.refresh_token }, basic(encodeURIComponent(id))));
  await tokens(await post({ grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: id }, basic(id)));

  const refused = async (response: Response) => {
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  };
  // Both, differing.
  await refused(await post({ ...(await codeGrant()), client_id: id }, basic(encodeURIComponent('dcr:someone-else'))));
  // Malformed: not base64, no colon, an empty id, a broken escape, and nothing at all.
  for (const header of ['Basic !!!', `Basic ${Buffer.from('no-colon').toString('base64')}`, basic(''), basic('dcr%ZZ'), 'Basic ']) {
    await refused(await post(await codeGrant(), header));
  }
  await refused(await post(await codeGrant()));
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

test('registering sweeps codes and tokens a day expired and approved clients left with no connection; the cap names the cause', async () => {
  const hash = () => randomBytes(32).toString('hex');
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
  async function client(id: string, approved: boolean, createdHoursAgo: number) {
    await db.insertInto('mcp_clients').values({
      id, owner_id: OWNER, kind: 'dcr', name: id, redirect_uris: sql<string[]>`'[]'::jsonb`, approved,
    }).execute();
    await sql`update mcp_clients set created_at = now() - make_interval(hours => ${createdHoursAgo}) where id = ${id}`.execute(db);
  }
  async function connection(client: string, revoked: boolean, createdHoursAgo = 0): Promise<string> {
    const id = crypto.randomUUID();
    await db.insertInto('mcp_connections').values({
      id, owner_id: OWNER, client_id: client, client_name: client, redirect_host: 'claude.ai', scopes: ['content:read'], revoked_at: revoked ? new Date() : null,
    }).execute();
    await sql`update mcp_connections set created_at = now() - make_interval(hours => ${createdHoursAgo}) where id = ${id}`.execute(db);
    return id;
  }
  const token = async (connectionId: string, expiresHoursAgo: number) => {
    const tokenHash = hash();
    await db.insertInto('mcp_tokens').values({ token_hash: tokenHash, connection_id: connectionId, kind: 'refresh', expires_at: hoursAgo(expiresHoursAgo) }).execute();
    return tokenHash;
  };
  const code = async (connectionId: string, expiresHoursAgo: number) => {
    const codeHash = hash();
    await db.insertInto('mcp_codes').values({ code_hash: codeHash, connection_id: connectionId, redirect_uri: CLAUDE, code_challenge: 'x', expires_at: hoursAgo(expiresHoursAgo) }).execute();
    return codeHash;
  };

  await client('dcr:live', true, 48);
  const live = await connection('dcr:live', false);
  const [oldToken, recentToken, freshToken] = [await token(live, 25), await token(live, 1), await token(live, -24)];
  const [oldCode, recentCode] = [await code(live, 25), await code(live, 1)];
  await client('dcr:orphan', true, 25);
  await connection('dcr:orphan', true);
  await client('dcr:young', true, 1);
  // Unused for 40 days: its last refresh token expired 10 days ago, so pruning leaves it no token.
  const DAYS_40 = 40 * 24;
  const dead = await connection('dcr:live', false, DAYS_40);
  await token(dead, 10 * 24);
  await client('dcr:stale', true, DAYS_40);
  await token(await connection('dcr:stale', false, DAYS_40), 10 * 24);
  // A consent being redeemed right now has no token yet, and is still live.
  await client('dcr:redeeming', true, DAYS_40);
  const redeeming = await connection('dcr:redeeming', false);

  await oauth.registerClient(config, { client_name: 'Sweeper', redirect_uris: [CLAUDE] });
  const revokedAt = async (id: string) => (await db.selectFrom('mcp_connections').select('revoked_at').where('id', '=', id).executeTakeFirstOrThrow()).revoked_at;
  assert.notEqual(await revokedAt(dead), null, 'a connection a day old with no token left is revoked');
  assert.equal(await revokedAt(live), null);
  assert.equal(await revokedAt(redeeming), null);
  const tokens = (await db.selectFrom('mcp_tokens').select('token_hash').where('connection_id', '=', live).execute()).map(({ token_hash }) => token_hash);
  assert.deepEqual(tokens.sort(), [recentToken, freshToken].sort(), 'a token expired over a day ago goes');
  const codes = (await db.selectFrom('mcp_codes').select('code_hash').where('connection_id', '=', live).execute()).map(({ code_hash }) => code_hash);
  assert.deepEqual(codes, [recentCode], 'a code expired over a day ago goes');
  assert.ok(!tokens.includes(oldToken) && !codes.includes(oldCode));
  const clients = (await db.selectFrom('mcp_clients').select('id').where('id', 'in', ['dcr:live', 'dcr:orphan', 'dcr:young', 'dcr:stale', 'dcr:redeeming']).execute()).map(({ id }) => id);
  assert.deepEqual(clients.sort(), ['dcr:live', 'dcr:redeeming', 'dcr:young'], 'an approved client a day old with no live connection goes');

  // Full: the refusal says what to do about it.
  const { count } = await db.selectFrom('mcp_clients').select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirstOrThrow();
  const filler = Array.from({ length: 100 - Number(count) }, (_, index) => `dcr:filler-${index}`);
  await db.insertInto('mcp_clients').values(filler.map((id) => ({
    id, owner_id: OWNER, kind: 'dcr', name: id, redirect_uris: sql<string[]>`'[]'::jsonb`,
  }))).execute();
  await assert.rejects(
    oauth.registerClient(config, { client_name: 'One too many', redirect_uris: [CLAUDE] }),
    /Too many apps are registered\. Revoke ones you no longer use on the Plugins screen\./,
  );
  // A client document allowed while full says the same.
  oauth.setClientMetadataFetcherForTest(async () => ({ name: 'Full', redirectUris: ['http://127.0.0.1/callback'] }));
  const full = await oauth.startAuthorization(config, authorizeParams({ client_id: 'https://full.example/client.json', redirect_uri: 'http://127.0.0.1:53100/callback' }));
  await assert.rejects(
    oauth.decide(config, OWNER, full.requestId, { allow: true, write: false }),
    (error) => error instanceof OAuthPageError && error.message === 'Too many apps are registered. Revoke ones you no longer use on the Plugins screen.',
  );
  await db.deleteFrom('mcp_clients').where('id', 'in', filler).execute();
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
