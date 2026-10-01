import type { BrandName } from '../../lib/brand-marks';
import { db } from '../db/client';
import { clientBrand, isLoopbackHost } from './brand';

/** What the owner sees of a connection. No token, code or hash is ever part of it. */
export interface McpConnectionSummary {
  id: string;
  clientName: string;
  redirectHost: string;
  /** The mark the app has earned, never one it only asked for by name. */
  brand: BrandName | null;
  /** It sends the owner to this computer. */
  loopback: boolean;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The connections that are live: one that had a token issued (a consent nobody redeemed never
 * shows) and has not been revoked.
 */
export async function listConnections(ownerId: string): Promise<McpConnectionSummary[]> {
  const rows = await db.selectFrom('mcp_connections')
    .select(['id', 'client_id', 'client_name', 'redirect_host', 'scopes', 'created_at', 'last_used_at'])
    .where('owner_id', '=', ownerId).where('revoked_at', 'is', null)
    .where((eb) => eb.exists(eb.selectFrom('mcp_tokens').select('token_hash').whereRef('mcp_tokens.connection_id', '=', 'mcp_connections.id')))
    .orderBy('created_at', 'desc').execute();
  return rows.map((row) => ({
    id: row.id,
    clientName: row.client_name,
    redirectHost: row.redirect_host,
    brand: clientBrand(row.client_id, row.redirect_host),
    loopback: isLoopbackHost(row.redirect_host),
    scopes: row.scopes,
    // Cast: kysely types a Generated<Timestamp> select as the column wrapper, not the Date pg returns.
    createdAt: (row.created_at as unknown as Date).toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  }));
}

/** Stops the connection at once: its tokens stop verifying and a refresh is refused. */
export async function revokeConnection(ownerId: string, id: string): Promise<void> {
  await db.updateTable('mcp_connections').set({ revoked_at: new Date() })
    .where('id', '=', id).where('owner_id', '=', ownerId).where('revoked_at', 'is', null).execute();
}

/** Forgets every client and connection; codes and tokens cascade, snapshots keep their copy. */
export async function clearMcpData(ownerId: string): Promise<void> {
  await db.deleteFrom('mcp_clients').where('owner_id', '=', ownerId).execute();
}
