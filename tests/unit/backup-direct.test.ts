import assert from 'node:assert/strict';
import test from 'node:test';

import { directPgDumpInvocation, parseBackupOptions } from '../../scripts/backup';

test('direct backups require the offline flag', () => {
  assert.deepEqual(parseBackupOptions([
    '--offline', '--direct', '--json', '--output-root', '/var/backups/tome-cms',
  ]), { offline: true, direct: true, json: true, outputRoot: '/var/backups/tome-cms' });
  assert.throws(() => parseBackupOptions(['--direct', '--output-root', '/var/backups/tome-cms']), /offline/);
});

test('direct pg_dump keeps the database password out of argv', () => {
  const invocation = directPgDumpInvocation('postgresql://tomecms:secret@postgres:5432/tomecms');

  assert.equal(invocation.executable, 'pg_dump');
  assert.doesNotMatch(invocation.args.join(' '), /secret/);
  assert.equal(invocation.env.PGPASSWORD, 'secret');
  assert.equal(invocation.env.DATABASE_URL, undefined);
  assert.deepEqual(invocation.args.slice(1), ['--format=custom', '--no-owner', '--no-privileges']);
});
