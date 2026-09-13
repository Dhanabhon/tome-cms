import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    create table preview_tokens (
      id uuid primary key,
      owner_id text not null references "user"(id) on delete cascade,
      token_hash text not null unique,
      content_type text not null,
      content_id uuid not null,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default current_timestamp,
      constraint preview_tokens_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
      constraint preview_tokens_type_check check (content_type in ('post', 'page')),
      constraint preview_tokens_expiry_check check (expires_at > created_at),
      constraint preview_tokens_revocation_check check (revoked_at is null or revoked_at >= created_at)
    );

    create index preview_tokens_owner_content_idx
      on preview_tokens (owner_id, content_type, content_id, created_at desc);
    create index preview_tokens_owner_expiry_idx
      on preview_tokens (owner_id, expires_at, id);
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable('preview_tokens').execute();
}
