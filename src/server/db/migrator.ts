import { Migrator, type MigrationProvider } from 'kysely/migration';

import * as system from './migrations/001_system';
import * as authInstaller from './migrations/002_auth_installer';
import * as securityRecovery from './migrations/003_security_recovery';
import * as sessionCredentialRecovery from './migrations/004_session_credential_recovery';
import * as content from './migrations/005_content';
import * as media from './migrations/006_media';
import * as previewTokens from './migrations/007_preview_tokens';
import * as updateRateLimitActions from './migrations/008_update_rate_limit_actions';
import * as siteTheme from './migrations/009_site_theme';
import * as visitorThemeChoice from './migrations/010_visitor_theme_choice';
import * as poweredBy from './migrations/011_powered_by';
import * as siteTheme2 from './migrations/012_site_theme';
import * as pluginSettings from './migrations/013_plugin_settings';
import * as postExcerpt from './migrations/014_post_excerpt';
import * as pageExcerpt from './migrations/015_page_excerpt';
import * as themeSettings from './migrations/016_theme_settings';
import * as scheduledPublishing from './migrations/017_scheduled_publishing';
import * as thaiSlugs from './migrations/018_thai_slugs';
import * as contentRedirects from './migrations/019_content_redirects';
import * as siteBrand from './migrations/020_site_brand';

export const migrations = {
  '001_system': system,
  '002_auth_installer': authInstaller,
  '003_security_recovery': securityRecovery,
  '004_session_credential_recovery': sessionCredentialRecovery,
  '005_content': content,
  '006_media': media,
  '007_preview_tokens': previewTokens,
  '008_update_rate_limit_actions': updateRateLimitActions,
  '009_site_theme': siteTheme,
  '010_visitor_theme_choice': visitorThemeChoice,
  '011_powered_by': poweredBy,
  '012_site_theme': siteTheme2,
  '013_plugin_settings': pluginSettings,
  '014_post_excerpt': postExcerpt,
  '015_page_excerpt': pageExcerpt,
  '016_theme_settings': themeSettings,
  '017_scheduled_publishing': scheduledPublishing,
  '018_thai_slugs': thaiSlugs,
  '019_content_redirects': contentRedirects,
  '020_site_brand': siteBrand,
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
