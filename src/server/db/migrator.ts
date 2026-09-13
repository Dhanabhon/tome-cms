import { Migrator, type MigrationProvider } from 'kysely/migration';

import * as system from './migrations/001_system';
import * as authInstaller from './migrations/002_auth_installer';
import * as securityRecovery from './migrations/003_security_recovery';
import * as sessionCredentialRecovery from './migrations/004_session_credential_recovery';

export const migrations = {
  '001_system': system,
  '002_auth_installer': authInstaller,
  '003_security_recovery': securityRecovery,
  '004_session_credential_recovery': sessionCredentialRecovery,
} as const;

const provider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

async function createMigrator(): Promise<Migrator> {
  const { db } = await import('./client');
  return new Migrator({ db, provider });
}

export async function migrateToLatest(): Promise<void> {
  const { error, results } = await (await createMigrator()).migrateToLatest();
  const failed = results?.find((result) => result.status === 'Error');

  if (failed) {
    throw new Error(`Migration ${failed.migrationName} (${failed.direction}) failed.`, { cause: error });
  }

  if (error) {
    throw error;
  }
}

export async function pendingMigrationNames(): Promise<string[]> {
  const migrationInfo = await (await createMigrator()).getMigrations();
  const applied = new Set(
    migrationInfo.filter(({ executedAt }) => executedAt).map(({ name }) => name),
  );
  return Object.keys(migrations).filter((name) => !applied.has(name));
}
