export {};

try {
  const { closeDatabase } = await import('../src/server/db/client');
  let output: string;
  try {
    const { migrateToLatest, pendingMigrationNames } = await import('../src/server/db/migrator');
    const pending = await pendingMigrationNames();
    await migrateToLatest();
    output = pending.length ? pending.map((name) => `${name}: Success`).join('\n') : 'Up to date';
  } finally {
    await closeDatabase();
  }
  console.log(output);
} catch {
  console.error('Migration failed');
  process.exitCode = 1;
}
