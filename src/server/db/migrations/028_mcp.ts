import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * MCP: the OAuth clients, the owner's approvals of them ("connections"), their codes and tokens,
 * and one undo copy per draft an AI has changed. Every secret is stored as its SHA-256.
 * A snapshot names its post or page in one of two columns so each cascades with its row.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table mcp_clients (
      id text primary key,
      owner_id text not null references "user"(id) on delete cascade,
      kind text not null,
      name text not null,
      redirect_uris jsonb not null,
      approved boolean not null default false,
      fetched_at timestamptz,
      created_at timestamptz not null default current_timestamp,
      constraint mcp_clients_kind_check check (kind in ('dcr', 'cimd')),
      constraint mcp_clients_name_check check (char_length(name) between 1 and 200),
      constraint mcp_clients_redirects_check check (jsonb_typeof(redirect_uris) = 'array')
    );

    create table mcp_connections (
      id uuid primary key,
      owner_id text not null references "user"(id) on delete cascade,
      client_id text not null references mcp_clients(id) on delete cascade,
      client_name text not null,
      redirect_host text not null,
      scopes text[] not null,
      created_at timestamptz not null default current_timestamp,
      last_used_at timestamptz,
      revoked_at timestamptz,
      constraint mcp_connections_scopes_check check (
        scopes <@ array['content:read', 'drafts:write']::text[] and 'content:read' = any(scopes)
      )
    );

    create table mcp_codes (
      code_hash text primary key,
      connection_id uuid not null references mcp_connections(id) on delete cascade,
      redirect_uri text not null,
      code_challenge text not null,
      expires_at timestamptz not null,
      used_at timestamptz,
      constraint mcp_codes_hash_check check (code_hash ~ '^[0-9a-f]{64}$')
    );

    create table mcp_tokens (
      token_hash text primary key,
      connection_id uuid not null references mcp_connections(id) on delete cascade,
      kind text not null,
      expires_at timestamptz not null,
      rotated_at timestamptz,
      created_at timestamptz not null default current_timestamp,
      constraint mcp_tokens_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
      constraint mcp_tokens_kind_check check (kind in ('access', 'refresh'))
    );
    create index mcp_tokens_connection_idx on mcp_tokens (connection_id);

    create table content_ai_snapshots (
      id uuid primary key,
      owner_id text not null references "user"(id) on delete cascade,
      post_id uuid unique references posts(id) on delete cascade,
      page_id uuid unique references pages(id) on delete cascade,
      connection_id uuid references mcp_connections(id) on delete set null,
      client_name text not null,
      fields jsonb not null,
      ai_written_at timestamptz not null,
      constraint content_ai_snapshots_one_check check ((post_id is null) <> (page_id is null))
    );
  `.execute(db);
  await db.schema.alterTable('security_rate_limits').dropConstraint('security_rate_limits_action').execute();
  await db.schema.alterTable('security_rate_limits')
    .addCheckConstraint('security_rate_limits_action', sql`action in ('install', 'signin', 'recovery', 'update-check', 'update-apply', 'oauth-register', 'oauth-authorize', 'oauth-token')`)
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.deleteFrom('security_rate_limits').where('action', 'in', ['oauth-register', 'oauth-authorize', 'oauth-token']).execute();
  await db.schema.alterTable('security_rate_limits').dropConstraint('security_rate_limits_action').execute();
  await db.schema.alterTable('security_rate_limits')
    .addCheckConstraint('security_rate_limits_action', sql`action in ('install', 'signin', 'recovery', 'update-check', 'update-apply')`)
    .execute();
  for (const table of ['content_ai_snapshots', 'mcp_tokens', 'mcp_codes', 'mcp_connections', 'mcp_clients'] as const) {
    await db.schema.dropTable(table).execute();
  }
}
