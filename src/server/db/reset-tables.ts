import type { Database } from './types';

/**
 * Whether an installation reset empties each table, decided once per table.
 *
 * Written as a complete Record over the schema so a migration that adds a table
 * cannot typecheck until somebody chooses a side for it. The reset script used to
 * carry this as a hand-written list inside a `truncate` statement, where nothing
 * noticed it drifting, and both ways of drifting are bad: a table missing from the
 * list survives a reset the operator was told was total, so the next /install runs
 * on top of the previous owner's rows, while a new table holding a foreign key into
 * a truncated one makes Postgres refuse the whole statement.
 */
const PLAN: Readonly<Record<keyof Database, 'preserve' | 'truncate'>> = {
  // The schema version Kysely's migrator reads. Emptying it would tell the next
  // boot that no migration has ever run, against a database that has all of them.
  app_metadata: 'preserve',

  user: 'truncate',
  session: 'truncate',
  account: 'truncate',
  verification: 'truncate',
  passkey: 'truncate',
  installation_enrollments: 'truncate',
  recovery_codes: 'truncate',
  plugin_settings: 'truncate',
  security_rate_limits: 'truncate',
  site_settings: 'truncate',
  post_translation_groups: 'truncate',
  page_translation_groups: 'truncate',
  posts: 'truncate',
  pages: 'truncate',
  categories: 'truncate',
  post_category_assignments: 'truncate',
  navigation_items: 'truncate',
  media_folders: 'truncate',
  media_items: 'truncate',
  media_upload_reservations: 'truncate',
  preview_tokens: 'truncate',
};

/** One order for both the lock and the truncate, so a reset cannot deadlock itself. */
export const RESET_TABLES: readonly (keyof Database)[] = (
  Object.entries(PLAN) as [keyof Database, 'preserve' | 'truncate'][]
)
  .filter(([, action]) => action === 'truncate')
  .map(([name]) => name);
