import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseServerEnv } from '../../src/server/env';

const valid = {
  DATABASE_URL: 'postgresql://tomecms:password@127.0.0.1:5432/tomecms',
  TOME_CMS_PUBLIC_URL: 'https://cms.example.com',
  TOME_CMS_INSTALL_TOKEN: 'i'.repeat(32),
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  TOME_CMS_CONTEXT_SECRET: 'c'.repeat(32),
  TOME_CMS_RECOVERY_PEPPER: 'r'.repeat(32),
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'tomecms',
  S3_SECRET_ACCESS_KEY: 's'.repeat(24),
  S3_BUCKET: 'tomecms-media',
  MEDIA_PUBLIC_URL: 'http://127.0.0.1:9000/tomecms-media/',
};

test('accepts the canonical self-hosted environment', () => {
  assert.equal(parseServerEnv(valid).DATABASE_POOL_MAX, 10);
  assert.equal(parseServerEnv(valid).TOME_CMS_FRONTEND_MODE, 'bundled');
  assert.equal(parseServerEnv({ ...valid, TOME_CMS_PUBLIC_URL: 'https://cms.example.com/' }).TOME_CMS_PUBLIC_URL, 'https://cms.example.com');
});

test('rejects missing secrets, malformed URLs, and production HTTP', () => {
  assert.throws(() => parseServerEnv({ ...valid, DATABASE_URL: '' }));
  assert.throws(() => parseServerEnv({ ...valid, NODE_ENV: 'production', TOME_CMS_PUBLIC_URL: 'http://cms.example.com' }));
  assert.throws(() => parseServerEnv({ ...valid, NODE_ENV: 'production', S3_ENDPOINT: 'http://seaweedfs:8333' }));
  assert.throws(() => parseServerEnv({
    ...valid,
    NODE_ENV: 'production',
    S3_ENDPOINT: 'https://s3.example.com',
    MEDIA_PUBLIC_URL: 'http://media.example.com/tomecms-media/',
  }));
  assert.throws(() => parseServerEnv({ ...valid, S3_BUCKET: '../media' }));
  assert.throws(() => parseServerEnv({ ...valid, TOME_CMS_PUBLIC_URL: 'http://localhost:4321/install' }));
  for (const host of ['seaweedfs', '127.0.0.1', '10.0.0.1', 'host.docker.internal']) {
    assert.throws(() => parseServerEnv({
      ...valid,
      NODE_ENV: 'production',
      TOME_CMS_PUBLIC_URL: 'https://cms.example.com',
      S3_ENDPOINT: `https://${host}`,
      MEDIA_PUBLIC_URL: 'https://media.example.com/tomecms-media/',
    }), /browser-reachable/);
  }
});

test('database timeouts default to finite bounds and accept only bounded decimal integers', () => {
  const defaults = parseServerEnv(valid);
  assert.equal(defaults.DATABASE_CONNECTION_TIMEOUT_MS, 5000);
  assert.equal(defaults.DATABASE_QUERY_TIMEOUT_MS, 30000);
  for (const [key, maximum] of [['DATABASE_CONNECTION_TIMEOUT_MS', 60000], ['DATABASE_QUERY_TIMEOUT_MS', 3600000]] as const) {
    for (const value of ['', '0', '99', '-1', '1.5', '1e3', ' 5000 ', 'Infinity', String(maximum + 1)]) {
      assert.throws(() => parseServerEnv({ ...valid, [key]: value }));
    }
    for (const value of ['100', String(maximum)]) assert.equal(parseServerEnv({ ...valid, [key]: value })[key], Number(value));
  }
});

test('malformed production URLs produce validation errors without invoking an unsafe URL refinement', () => {
  for (const key of ['TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT']) {
    assert.throws(() => parseServerEnv({ ...valid, NODE_ENV: 'production', S3_ENDPOINT: 'https://s3.example.com', [key]: 'malformed' }), { name: 'ZodError' });
  }
});

test('migration CLI contains configuration failures without leaking supplied values', async (context) => {
  for (const key of ['DATABASE_URL', 'TOME_CMS_PUBLIC_URL', 'S3_ENDPOINT', 'MEDIA_PUBLIC_URL']) {
    await context.test(key, () => {
      const sentinel = randomBytes(24).toString('hex');
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/db-migrate.ts'], {
        env: { ...process.env, ...valid, NODE_ENV: 'production', S3_ENDPOINT: 'https://s3.example.com', [key]: sentinel }, encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, 1);
      assert.ok(!(result.stdout + result.stderr).includes(sentinel), 'configuration values remain private');
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Migration failed\n');
    });
  }
});

test('migration CLI also contains database close failures without reporting success or private values', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-migrate-close-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'src/server/db'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  const script = join(directory, 'scripts/db-migrate.ts');
  await copyFile(new URL('../../scripts/db-migrate.ts', import.meta.url), script);
  await writeFile(join(directory, 'src/server/db/client.ts'), 'export async function closeDatabase() { throw new Error(process.env.CLOSE_TEST_VALUE); }');
  await writeFile(join(directory, 'src/server/db/migrator.ts'), 'export async function pendingMigrationNames() { return []; } export async function migrateToLatest() {}');
  const sentinel = randomBytes(24).toString('hex');
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], { env: { ...process.env, CLOSE_TEST_VALUE: sentinel }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.ok(!(result.stdout + result.stderr).includes(sentinel), 'close errors remain private');
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Migration failed\n');
});
