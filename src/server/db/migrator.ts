import { Migrator, type MigrationProvider } from 'kysely/migration';

import * as system from './migrations/001_system';
import * as authInstaller from './migrations/002_auth_installer';
import * as securityRecovery from './migrations/003_security_recovery';
import * as sessionCredentialRecovery from './migrations/004_session_credential_recovery';
import * as content from './migrations/005_content';
import * as media from './migrations/006_media';
import * as previewTokens from './migrations/007_preview_tokens';

export const migrations = {
  '001_system': system,
  '002_auth_installer': authInstaller,
  '003_security_recovery': securityRecovery,
  '004_session_credential_recovery': sessionCredentialRecovery,
  '005_content': content,
  '006_media': media,
  '007_preview_tokens': previewTokens,
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
