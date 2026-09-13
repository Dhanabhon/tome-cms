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

test('direct pg_dump removes query passwords and keeps non-secret options', () => {
  const parentPassword = process.env.PGPASSWORD;
  process.env.PGPASSWORD = 'parent-secret';
  try {
    for (const { databaseUrl, password, secrets, retained } of [
      {
        databaseUrl: 'postgresql://tomecms@postgres:5432/tomecms?sslmode=require&options=-c%20statement_timeout%3D1000&%70assword=query%2Dsecret&application_name=backup',
        password: 'query-secret',
        secrets: ['query-secret', 'parent-secret'],
        retained: ['sslmode=require', 'options=-c%20statement_timeout%3D1000', 'application_name=backup'],
      },
      {
        databaseUrl: 'postgresql://tomecms:userinfo-secret@postgres:5432/tomecms?password=query-secret',
        password: 'query-secret',
        secrets: ['userinfo-secret', 'query-secret', 'parent-secret'],
        retained: [],
      },
      {
        databaseUrl: 'postgresql://tomecms@postgres:5432/tomecms?password=first-secret&password=last-secret&sslmode=require',
        password: 'last-secret',
        secrets: ['first-secret', 'last-secret', 'parent-secret'],
        retained: ['sslmode=require'],
      },
      {
        databaseUrl: 'postgresql://tomecms:userinfo-secret@postgres:5432/tomecms?password=',
        password: 'userinfo-secret',
        secrets: ['userinfo-secret', 'parent-secret'],
        retained: [],
      },
      {
        databaseUrl: 'postgresql://tomecms:userinfo-secret@postgres:5432/tomecms?password=first-secret&password=&sslmode=require',
        password: 'userinfo-secret',
        secrets: ['userinfo-secret', 'first-secret', 'parent-secret'],
        retained: ['sslmode=require'],
      },
    ]) {
      const invocation = directPgDumpInvocation(databaseUrl);
      const args = invocation.args.join(' ');

      assert.equal(invocation.env.PGPASSWORD, password);
      for (const secret of secrets) assert.ok(!args.includes(secret));
      for (const option of retained) assert.ok(args.includes(option));
    }
  } finally {
    if (parentPassword === undefined) delete process.env.PGPASSWORD;
    else process.env.PGPASSWORD = parentPassword;
  }
});
