import { closeDatabase } from '../src/server/db/client';
import { migrateToLatest, pendingMigrationNames } from '../src/server/db/migrator';

try {
  const pending = await pendingMigrationNames();
  await migrateToLatest();
  console.log(pending.length ? pending.map((name) => `${name}: Success`).join('\n') : 'Up to date');
} catch {
  console.error('Migration failed');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
