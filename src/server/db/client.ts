import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import { getServerEnv, type ServerEnv } from '../env';
import type { Database } from './types';

interface DatabaseClient {
  pool: Pool;
  db: Kysely<Database>;
}

const globalForDatabase = globalThis as typeof globalThis & {
  tomeCmsDatabase?: DatabaseClient;
};

function createDatabaseClient(env: ServerEnv): DatabaseClient {
  const connectionString = new URL(env.DATABASE_URL);
  // pg URL options override Pool options; the validated timeout settings stay authoritative.
  for (const key of ['query_timeout', 'statement_timeout', 'connectionTimeoutMillis']) connectionString.searchParams.delete(key);
  const pool = new Pool({
    connectionString: connectionString.href,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
    query_timeout: env.DATABASE_QUERY_TIMEOUT_MS,
    statement_timeout: env.DATABASE_QUERY_TIMEOUT_MS,
  });
  pool.on('error', () => console.error('Database pool connection lost'));
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return { pool, db };
}

const env = getServerEnv();
const client = env.NODE_ENV === 'development'
  ? globalForDatabase.tomeCmsDatabase ?? createDatabaseClient(env)
  : createDatabaseClient(env);

if (env.NODE_ENV === 'development') {
  globalForDatabase.tomeCmsDatabase = client;
}

export const { pool, db } = client;

export async function closeDatabase(): Promise<void> {
  await db.destroy();
}
