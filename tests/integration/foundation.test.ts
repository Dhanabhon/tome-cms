import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { sql } from 'kysely';
import { Client } from 'pg';

test('foundation cleanup runs for the exact disposable project after startup fails', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'tomecms-foundation-wrapper-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, 'docker.log');
  await writeFile(join(directory, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FOUNDATION_COMMAND_LOG"\ncase "$*" in *" up "*) exit 7;; esac\n', { mode: 0o700 });
  const result = spawnSync(process.execPath, ['scripts/test-foundation.mjs'], {
    env: { ...process.env, PATH: directory, FOUNDATION_COMMAND_LOG: log }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [
    'compose -p tomecms-foundation-test -f compose.test.yaml up -d --wait --wait-timeout 90 postgres',
    'compose -p tomecms-foundation-test -f compose.test.yaml down --volumes --remove-orphans',
  ]);
});

test('disposable PostgreSQL migrations and bounded readiness', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test', 'run through test:integration:foundation; never use a real application database');
  const { db, pool, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest, pendingMigrationNames } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  assert.deepEqual((await sql<{ value: number }>`select 1 as value`.execute(db)).rows, [{ value: 1 }]);
  assert.deepEqual(await pendingMigrationNames(), ['001_system']);
  assert.equal((await sql<{ name: string | null }>`select to_regclass('public.kysely_migration') as name`.execute(db)).rows[0].name, null);
  await migrateToLatest();
  await migrateToLatest();
  assert.deepEqual(await pendingMigrationNames(), []);

  const { checkReadiness } = await import('../../src/server/health');
  assert.deepEqual(await checkReadiness(), {
    status: 'ready', checks: { database: 'ready', migrations: 'ready', storage: 'deferred' },
  });

  await context.test('saturated pool has bounded responses and one coalesced probe, then recovers', async () => {
    const held = await pool.connect();
    let released = false;
    const release = () => { if (!released) { released = true; held.release(); } };
    const fallback = setTimeout(release, 500);
    try {
      const started = performance.now();
      const requests = Array.from({ length: 20 }, () => checkReadiness(AbortSignal.timeout(40)));
      await delay(20);
      assert.equal(pool.waitingCount, 1);
      const results = await Promise.all(requests);
      assert.ok(performance.now() - started < 300, 'readiness must return before the occupied connection is released');
      for (const result of results) assert.deepEqual(result, {
        status: 'not-ready', checks: { database: 'unavailable', migrations: 'unavailable', storage: 'deferred' },
      });
    } finally {
      clearTimeout(fallback);
      // The fallback release also makes a broken timeout implementation finish its red test.
      release();
    }
    assert.equal((await checkReadiness()).status, 'ready');
  });

  await context.test('HTTP health routes bypass installation and return secret-free JSON', async (routeContext) => {
    const { dev } = await import('astro');
    const server = await dev({
      server: { host: '127.0.0.1', port: 0 },
      vite: { cacheDir: 'node_modules/.vite-foundation-test' },
      logLevel: 'silent',
    });
    routeContext.after(() => server.stop());
    const origin = `http://127.0.0.1:${server.address.port}`;
    const request = (path: string) => fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const live = await request('/health/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'live' });
    const ready = await request('/health/ready');
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ready.json(), {
      status: 'ready', checks: { database: 'ready', migrations: 'ready', storage: 'deferred' },
    });
    for (const path of ['/admin', '/health/live/extra', '/health/ready/extra']) {
      const response = await request(path);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/install');
    }

    await routeContext.test('unapplied migrations return 503 without applying migrations during readiness', async () => {
      const removed = await sql<{ name: string; timestamp: string }>`delete from kysely_migration returning name, timestamp`.execute(db);
      try {
        const pending = await request('/health/ready');
        assert.equal(pending.status, 503);
        assert.equal(pending.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await pending.json(), {
          status: 'not-ready', checks: { database: 'ready', migrations: 'pending', storage: 'deferred' },
        });
        assert.deepEqual(await pendingMigrationNames(), ['001_system']);
      } finally {
        for (const row of removed.rows) {
          await sql`insert into kysely_migration (name, timestamp) values (${row.name}, ${row.timestamp})`.execute(db);
        }
      }
    });

    await routeContext.test('a locked migration table times out at the HTTP boundary and recovers', async () => {
      const locker = new Client({ connectionString: process.env.DATABASE_URL });
      await locker.connect();
      try {
        await locker.query('begin');
        await locker.query('lock table kysely_migration in access exclusive mode');
        const snapshot = await checkReadiness(AbortSignal.timeout(50));
        const expected = { status: 'not-ready', checks: { database: 'ready', migrations: 'unavailable', storage: 'deferred' } };
        assert.deepEqual(snapshot, expected);
        const started = performance.now();
        const timedOut = await request('/health/ready');
        assert.ok(performance.now() - started < 3_000, 'HTTP readiness is bounded by the two-second deadline');
        assert.equal(timedOut.status, 503);
        assert.equal(timedOut.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await timedOut.json(), expected);
        assert.equal((await request('/health/live')).status, 200);
        await locker.query('rollback');
        assert.equal((await checkReadiness()).status, 'ready');
        assert.equal((await request('/health/ready')).status, 200);
        assert.deepEqual(snapshot, expected, 'previously returned timeout snapshots never mutate');
      } finally {
        await locker.end();
      }
    });
  });

  await context.test('aborted and unavailable database checks expose no secrets', async () => {
    const unavailable = { status: 'not-ready', checks: { database: 'unavailable', migrations: 'unavailable', storage: 'deferred' } };
    assert.deepEqual(await checkReadiness(AbortSignal.abort(new Error('PRIVATE_SENTINEL'))), unavailable);
    await closeDatabase();
    assert.deepEqual(await checkReadiness(), unavailable);
  });
});

test('liveness is independent of configuration and readiness hides validation failures', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    const { GET: live } = await import('./src/pages/health/live.ts');
    const { GET: ready } = await import('./src/pages/health/ready.ts');
    const responses = [];
    for (const handler of [live, ready]) {
      const response = await handler();
      responses.push({ status: response.status, body: await response.json() });
    }
    process.stdout.write(JSON.stringify(responses));
  `], { env: { ...process.env, DATABASE_URL: 'PRIVATE_VALIDATION_SENTINEL' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), [
    { status: 200, body: { status: 'live' } },
    { status: 503, body: { status: 'not-ready', checks: { database: 'unavailable', migrations: 'unavailable', storage: 'deferred' } } },
  ]);
});
