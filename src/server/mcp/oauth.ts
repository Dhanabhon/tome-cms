import { randomUUID } from 'node:crypto';

import { sql, type Transaction } from 'kysely';

import { db } from '../db/client';
import type { Database } from '../db/types';
import { fetchClientMetadata } from './cimd';
import type { McpConfig } from './config';
import { hashSecret, newSecret, pkceMatches } from './oauth-crypto';
import { isLoopback, redirectAllowed, redirectMatches } from './redirects';

/**
 * The authorization server: clients, the owner's pending answers, codes and tokens.
 *
 * Everything an OAuth client sends is checked here before anything is stored or shown, and every
 * secret is kept only as its hash. The owner's own cookie session never reaches this module: the
 * consent route checks it, and the token endpoint is called by other servers and has none.
 */
export const SCOPES = ['content:read', 'drafts:write'] as const;
const CODE_SECONDS = 60;
const ACCESS_SECONDS = 60 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const REQUEST_MS = 10 * 60 * 1000;
const CIMD_CACHE_MS = 24 * 60 * 60 * 1000;
const UNAPPROVED_SECONDS = 24 * 60 * 60;
const MAX_CLIENTS = 100;
const MAX_PENDING = 100;
const MAX_REDIRECTS = 10;
const TOUCH_MS = 60 * 1000;
// Generous for anything real, and short enough that a parameter is never a way to fill memory.
const MAX_PARAM = 2048;

/** Shown as a page: the request is not one this site will redirect anywhere for. */
export class OAuthPageError extends Error {}
/** RFC 7591 section 3.2.2. */
export class OAuthRegistrationError extends Error {
  constructor(readonly code: 'invalid_redirect_uri' | 'invalid_client_metadata', message: string) { super(message); }
}
/** RFC 6749 section 5.2. */
export class OAuthTokenError extends Error {
  constructor(readonly code: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_scope', readonly status = 400) { super(code); }
}

interface ClientMetadata { name: string; redirectUris: string[]; fetchedAt: number }

// A client id document as last fetched, by URL, so a client nobody has allowed yet is fetched once a
// day without being written anywhere: only the owner's Allow stores a client. At most MAX_CACHED,
// the oldest dropped first; a restart forgets them and they are fetched again.
const cimdCache = new Map<string, ClientMetadata>();
const MAX_CACHED = 100;

let fetchMetadata = fetchClientMetadata;
/** Test seam: the CIMD fetch without the network. */
export function setClientMetadataFetcherForTest(fetcher: typeof fetchClientMetadata): void {
  fetchMetadata = fetcher;
  cimdCache.clear();
}

interface Client { id: string; name: string; redirectUris: string[]; /** A CIMD client not stored yet. */ unsaved?: ClientMetadata }

/** Clients nobody approved within a day go, and then there has to be room for one more. */
async function makeRoomForClient(ownerId: string): Promise<boolean> {
  await db.deleteFrom('mcp_clients').where('owner_id', '=', ownerId).where('approved', '=', false)
    .where(sql<boolean>`created_at < now() - (${UNAPPROVED_SECONDS} * interval '1 second')`).execute();
  const { count } = await db.selectFrom('mcp_clients').select((eb) => eb.fn.countAll<string>().as('count'))
    .where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
  // ponytail: two registrations at once can both see room for one; the cap is a bound, not an exact count.
  return Number(count) < MAX_CLIENTS;
}

const allAllowed = (config: McpConfig, uris: readonly string[]) =>
  uris.length > 0 && uris.length <= MAX_REDIRECTS && uris.every((uri) => redirectAllowed(uri, config.extraRedirects));

/**
 * DCR (RFC 7591). Public clients only. Every redirect must be allowed (redirects.ts). Clients never
 * approved for a day are deleted first; past MAX_CLIENTS it refuses. The id is `dcr:<uuid>`.
 */
export async function registerClient(config: McpConfig, body: unknown): Promise<{ client_id: string; client_name: string; redirect_uris: string[] }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new OAuthRegistrationError('invalid_client_metadata', 'Client metadata is a JSON object.');
  const metadata = body as Record<string, unknown>;
  const uris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : [];
  if (!uris.every((uri): uri is string => typeof uri === 'string') || !allAllowed(config, uris)) {
    throw new OAuthRegistrationError('invalid_redirect_uri', 'Every redirect URI must be one this site allows.');
  }
  if (metadata.token_endpoint_auth_method !== undefined && metadata.token_endpoint_auth_method !== 'none') {
    throw new OAuthRegistrationError('invalid_client_metadata', 'Only public clients can register.');
  }
  const named = typeof metadata.client_name === 'string' ? metadata.client_name.trim().slice(0, 200) : '';
  const name = named || new URL(uris[0]!).host;
  if (!(await makeRoomForClient(config.ownerId))) throw new OAuthRegistrationError('invalid_client_metadata', 'This site has too many clients waiting for approval.');
  const id = `dcr:${randomUUID()}`;
  await db.insertInto('mcp_clients').values({
    id, owner_id: config.ownerId, kind: 'dcr', name, redirect_uris: sql<string[]>`${JSON.stringify(uris)}::jsonb`,
  }).execute();
  return { client_id: id, client_name: name, redirect_uris: uris };
}

async function cimdMetadata(url: string): Promise<ClientMetadata> {
  const cached = cimdCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CIMD_CACHE_MS) return cached;
  let fetched: Awaited<ReturnType<typeof fetchClientMetadata>>;
  try {
    fetched = await fetchMetadata(url);
  } catch {
    throw new OAuthPageError('The client could not be identified.');
  }
  cimdCache.delete(url);
  while (cimdCache.size >= MAX_CACHED) cimdCache.delete(cimdCache.keys().next().value!);
  const entry = { name: fetched.name, redirectUris: fetched.redirectUris, fetchedAt: Date.now() };
  cimdCache.set(url, entry);
  return entry;
}

/**
 * The client of a request: a stored DCR client, or a CIMD client -- its stored row while that is
 * under a day old, otherwise its document (fetched at most once a day). A CIMD client nobody has
 * allowed is not stored here; `decide` stores it. Its redirect URIs must all be allowed.
 */
async function clientFor(config: McpConfig, clientId: string): Promise<Client> {
  const row = await db.selectFrom('mcp_clients').select(['id', 'kind', 'name', 'redirect_uris', 'fetched_at'])
    .where('id', '=', clientId).where('owner_id', '=', config.ownerId).executeTakeFirst();
  const fresh = row?.fetched_at && Date.now() - new Date(row.fetched_at).getTime() < CIMD_CACHE_MS;
  let client: Client | null = row ? { id: row.id, name: row.name, redirectUris: row.redirect_uris } : null;
  const refetch = clientId.startsWith('https://') && (!row || (row.kind === 'cimd' && !fresh));
  if (refetch) {
    // A stored client's row is the record of its last fetch; once that is a day old, so is any copy here.
    if (row) cimdCache.delete(clientId);
    const metadata = await cimdMetadata(clientId);
    client = { id: clientId, name: metadata.name, redirectUris: metadata.redirectUris, ...(row ? {} : { unsaved: metadata }) };
  }
  if (!client) throw new OAuthPageError('The client is not registered.');
  // Checked on every use: the owner may have taken an extra redirect away since.
  if (!allAllowed(config, client.redirectUris)) throw new OAuthPageError('The client asks for a redirect this site does not allow.');
  if (refetch && row) {
    // Already allowed once: its row follows its document.
    await db.updateTable('mcp_clients').set({
      name: client.name, redirect_uris: sql<string[]>`${JSON.stringify(client.redirectUris)}::jsonb`, fetched_at: new Date(),
    }).where('id', '=', clientId).execute();
  }
  return client;
}

interface Pending {
  clientId: string;
  /** A CIMD client to store if the owner allows it. */
  unsaved?: ClientMetadata;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  wantsWrite: boolean;
  loopbackOnly: boolean;
  createdAt: number;
}

// ponytail: in memory, so a restart forgets them and the owner presses Connect again. At most
// MAX_PENDING; past that the oldest goes, so a flood of requests can push out the owner's.
const pending = new Map<string, Pending>();

function livePending(requestId: string): Pending | null {
  const found = pending.get(requestId);
  if (!found) return null;
  if (Date.now() - found.createdAt < REQUEST_MS) return found;
  pending.delete(requestId);
  return null;
}

/** One value or none: a parameter given twice is a request to be refused (RFC 6749 3.1). */
function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1 || (values[0]?.length ?? 0) > MAX_PARAM) throw new OAuthPageError(`${key} is malformed.`);
  return values[0] ?? null;
}

/**
 * GET /oauth/authorize. Checks response_type=code, the client, redirect_uri (redirectMatches
 * against the client's), code_challenge with method S256, resource (when given) === config.resource,
 * and the scope (content:read implied; drafts:write only if asked). Stores the request and returns
 * its id. Any failure is an OAuthPageError: nothing is redirected for a request that is not right.
 */
export async function startAuthorization(config: McpConfig, params: URLSearchParams): Promise<{ requestId: string }> {
  const [responseType, clientId, redirectUri, challenge, method, resource, scope, state] =
    ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state'].map((key) => single(params, key));
  if (responseType !== 'code') throw new OAuthPageError('Only the code flow is supported.');
  if (!clientId) throw new OAuthPageError('client_id is missing.');
  // S256 is 43 base64url characters; OAuth 2.1 has no plain, and no PKCE is no request.
  if (method !== 'S256' || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new OAuthPageError('PKCE with S256 is required.');
  if (resource !== null && resource !== config.resource) throw new OAuthPageError('The resource is not this site\'s MCP server.');
  const scopes = (scope ?? '').split(' ').filter(Boolean);
  if (!scopes.every((entry) => (SCOPES as readonly string[]).includes(entry))) throw new OAuthPageError('An unknown scope was asked for.');
  const client = await clientFor(config, clientId);
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri) || !redirectAllowed(redirectUri, config.extraRedirects)) {
    throw new OAuthPageError('The redirect URI is not one registered for this client.');
  }

  for (const [id, entry] of pending) if (Date.now() - entry.createdAt >= REQUEST_MS) pending.delete(id);
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  const requestId = newSecret();
  pending.set(requestId, {
    clientId: client.id, unsaved: client.unsaved, clientName: client.name, redirectUri, codeChallenge: challenge, state,
    wantsWrite: scopes.includes('drafts:write'), loopbackOnly: client.redirectUris.every(isLoopback), createdAt: Date.now(),
  });
  return { requestId };
}

export interface PendingSummary { clientName: string; redirectHost: string; loopbackOnly: boolean; wantsWrite: boolean; writeAllowed: boolean }
export function describeRequest(config: McpConfig, requestId: string): PendingSummary | null {
  const found = livePending(requestId);
  if (!found) return null;
  return {
    clientName: found.clientName, redirectHost: new URL(found.redirectUri).host, loopbackOnly: found.loopbackOnly,
    wantsWrite: found.wantsWrite, writeAllowed: config.allowWrite,
  };
}

function redirectWith(uri: string, values: Record<string, string | null>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(values)) if (value !== null) url.searchParams.set(key, value);
  return url.href;
}

/**
 * The owner's answer. The request is consumed either way. Deny: redirect with
 * error=access_denied and state. Allow: mark the client approved; make a connection whose scopes
 * are content:read, plus drafts:write when asked, ticked and config.allowWrite; issue a code
 * (hash stored, 60 s, bound to redirect_uri and challenge); redirect with code, state and iss.
 */
export async function decide(config: McpConfig, ownerId: string, requestId: string, decision: { allow: boolean; write: boolean }): Promise<{ redirect: string }> {
  if (ownerId !== config.ownerId) throw new OAuthPageError('Only the owner can answer.');
  // Taken before anything is awaited, so two answers to one request cannot both proceed.
  const request = livePending(requestId);
  pending.delete(requestId);
  if (!request) throw new OAuthPageError('This request has expired.');
  if (!decision.allow) {
    return { redirect: redirectWith(request.redirectUri, { error: 'access_denied', state: request.state, iss: config.issuer }) };
  }
  const scopes = ['content:read', ...(request.wantsWrite && decision.write && config.allowWrite ? ['drafts:write'] : [])];
  if (request.unsaved && !(await makeRoomForClient(config.ownerId))) throw new OAuthPageError('This site has too many clients.');
  const code = newSecret();
  await db.transaction().execute(async (trx) => {
    if (request.unsaved) {
      const { name, redirectUris, fetchedAt } = request.unsaved;
      const redirects = sql<string[]>`${JSON.stringify(redirectUris)}::jsonb`;
      await trx.insertInto('mcp_clients').values({
        id: request.clientId, owner_id: ownerId, kind: 'cimd', name, redirect_uris: redirects, approved: true, fetched_at: new Date(fetchedAt),
      }).onConflict((conflict) => conflict.column('id').doUpdateSet({ name, redirect_uris: redirects, fetched_at: new Date(fetchedAt) })).execute();
    }
    await trx.updateTable('mcp_clients').set({ approved: true }).where('id', '=', request.clientId).execute();
    const connectionId = randomUUID();
    await trx.insertInto('mcp_connections').values({
      id: connectionId, owner_id: ownerId, client_id: request.clientId, client_name: request.clientName,
      redirect_host: new URL(request.redirectUri).host, scopes,
    }).execute();
    await trx.insertInto('mcp_codes').values({
      code_hash: hashSecret(code), connection_id: connectionId, redirect_uri: request.redirectUri,
      code_challenge: request.codeChallenge, expires_at: new Date(Date.now() + CODE_SECONDS * 1000),
    }).execute();
  });
  return { redirect: redirectWith(request.redirectUri, { code, state: request.state, iss: config.issuer }) };
}

export interface TokenResponse { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }

async function issuePair(trx: Transaction<Database>, connection: { id: string; scopes: string[] }): Promise<TokenResponse> {
  const access = newSecret();
  const refresh = newSecret();
  await trx.insertInto('mcp_tokens').values([
    { token_hash: hashSecret(access), connection_id: connection.id, kind: 'access', expires_at: new Date(Date.now() + ACCESS_SECONDS * 1000) },
    { token_hash: hashSecret(refresh), connection_id: connection.id, kind: 'refresh', expires_at: new Date(Date.now() + REFRESH_SECONDS * 1000) },
  ]).execute();
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: connection.scopes.join(' ') };
}

function required(form: URLSearchParams, ...keys: string[]): string[] {
  return keys.map((key) => {
    const values = form.getAll(key);
    if (values.length !== 1 || !values[0] || values[0].length > MAX_PARAM) throw new OAuthTokenError('invalid_request');
    return values[0];
  });
}

/**
 * A pair for a code, or null. The code is spent even when what follows refuses it, so it is never
 * tried twice; and a code presented after it was spent revokes whatever it issued (OAuth 2.1 4.1.3).
 */
async function redeemCode(trx: Transaction<Database>, ownerId: string, code: string, clientId: string, redirectUri: string, verifier: string) {
  const hash = hashSecret(code);
  const spent = await trx.updateTable('mcp_codes').set({ used_at: new Date() })
    .where('code_hash', '=', hash).where('used_at', 'is', null).where('expires_at', '>', new Date())
    .returning(['connection_id', 'redirect_uri', 'code_challenge']).executeTakeFirst();
  if (!spent) {
    const reused = await trx.selectFrom('mcp_codes').select('connection_id').where('code_hash', '=', hash).where('used_at', 'is not', null).executeTakeFirst();
    if (reused) await trx.updateTable('mcp_connections').set({ revoked_at: new Date() }).where('id', '=', reused.connection_id).where('owner_id', '=', ownerId).execute();
    return null;
  }
  if ( spent.redirect_uri !== redirectUri || !pkceMatches(verifier, spent.code_challenge)) return null;
  const connection = await trx.selectFrom('mcp_connections').select(['id', 'scopes'])
    .where('id', '=', spent.connection_id).where('owner_id', '=', ownerId).where('client_id', '=', clientId).where('revoked_at', 'is', null).executeTakeFirst();
  return connection ? issuePair(trx, connection) : null;
}

async function rotateRefresh(trx: Transaction<Database>, ownerId: string, token: string, clientId: string) {
  const hash = hashSecret(token);
  const found = await trx.selectFrom('mcp_tokens').innerJoin('mcp_connections', 'mcp_connections.id', 'mcp_tokens.connection_id')
    .select(['mcp_connections.id', 'mcp_connections.scopes'])
    .where('token_hash', '=', hash).where('kind', '=', 'refresh').where('expires_at', '>', new Date())
    .where('owner_id', '=', ownerId).where('client_id', '=', clientId).where('revoked_at', 'is', null).executeTakeFirst();
  if (!found) return null;
  const rotated = await trx.updateTable('mcp_tokens').set({ rotated_at: new Date() })
    .where('token_hash', '=', hash).where('rotated_at', 'is', null).returning('token_hash').executeTakeFirst();
  if (rotated) return issuePair(trx, found);
  // Used before: whoever holds it now is not who it was given to, or not only them.
  await trx.updateTable('mcp_connections').set({ revoked_at: new Date() }).where('id', '=', found.id).execute();
  return null;
}

/**
 * POST /oauth/token.
 * authorization_code: the code exists, is unused and unexpired; its connection's client is
 * client_id; redirect_uri is the one it was issued for; pkceMatches(code_verifier,
 * code_challenge). Mark it used, then issue a pair.
 * refresh_token: the token exists, is a refresh token and unexpired, and its connection is not
 * revoked. If it was already rotated, revoke the connection (reuse means theft) and refuse.
 * Otherwise set rotated_at and issue a new pair. Anything else: OAuthTokenError.
 */
export async function exchange(config: McpConfig, form: URLSearchParams): Promise<TokenResponse> {
  const [grantType] = required(form, 'grant_type');
  let issue: (trx: Transaction<Database>) => Promise<TokenResponse | null>;
  if (grantType === 'authorization_code') {
    const [code, redirectUri, clientId, verifier] = required(form, 'code', 'redirect_uri', 'client_id', 'code_verifier');
    issue = (trx) => redeemCode(trx, config.ownerId, code!, clientId!, redirectUri!, verifier!);
  } else if (grantType === 'refresh_token') {
    const [token, clientId] = required(form, 'refresh_token', 'client_id');
    issue = (trx) => rotateRefresh(trx, config.ownerId, token!, clientId!);
  } else {
    throw new OAuthTokenError('unsupported_grant_type');
  }
  // A refusal returns null rather than throwing, so what it spent or revoked is committed with it.
  const pair = await db.transaction().execute(issue);
  if (!pair) throw new OAuthTokenError('invalid_grant');
  return pair;
}

export interface VerifiedToken { connectionId: string; clientName: string; scopes: string[]; expiresAt: number }
/**
 * An access token that is this site's: unexpired, and its connection not revoked. Touches
 * last_used_at at most once a minute.
 */
export async function verifyAccessToken(config: McpConfig, bearer: string): Promise<VerifiedToken | null> {
  if (!bearer || bearer.length > MAX_PARAM) return null;
  const found = await db.selectFrom('mcp_tokens').innerJoin('mcp_connections', 'mcp_connections.id', 'mcp_tokens.connection_id')
    .select(['mcp_connections.id', 'client_name', 'scopes', 'expires_at', 'last_used_at'])
    .where('token_hash', '=', hashSecret(bearer)).where('kind', '=', 'access').where('expires_at', '>', new Date())
    .where('owner_id', '=', config.ownerId).where('revoked_at', 'is', null).executeTakeFirst();
  if (!found) return null;
  if (!found.last_used_at || Date.now() - new Date(found.last_used_at).getTime() >= TOUCH_MS) {
    await db.updateTable('mcp_connections').set({ last_used_at: new Date() }).where('id', '=', found.id).execute();
  }
  return { connectionId: found.id, clientName: found.client_name, scopes: found.scopes, expiresAt: new Date(found.expires_at).getTime() };
}
