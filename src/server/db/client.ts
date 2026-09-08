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
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
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
