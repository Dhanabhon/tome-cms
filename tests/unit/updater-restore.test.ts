import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';

import { clearFailedJob } from '../../scripts/updater-clear-failed-job.js';
import type { Database } from '../../src/server/db/types.js';
import { countRecords } from '../../src/server/transfer/record-counts.js';
import { OFFICIAL_IMAGE_REPOSITORY } from '../../src/update/contracts.js';
import { isUpdateWriteBlocked } from '../../src/server/update/maintenance.js';
import { parseUpdaterStatus } from '../../src/server/update/updater-client.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import { reconcileRestore, runRestore } from '../../src/updater/restore.js';
import { createUpdaterServer } from '../../src/updater/server.js';
import { createUpdaterStateStore, type InstalledState, type RestorePhase } from '../../src/updater/state.js';
import { runBackup, type UpdateDependencies } from '../../src/updater/transaction.js';
import { assertBackupSpace, type VerifyDependencies } from '../../src/updater/verify.js';
import { releasedStatusSchemas } from '../helpers/released-updater-status.js';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const imageEnv = (value: string) => `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${value}'\n`;
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const objectKey = `owners/${randomUUID()}/2026/10/${randomUUID()}.png`;
const records = { siteSettings: 1, posts: 2, pages: 3, mediaItems: 1 };
const report = { records, sealedSecrets: 1, unopenedSecrets: [{ plugin: 'newsletter', setting: 'apiKey' }] };

/** A database a failed rollback dropped: every table is missing, as PostgreSQL says it (42P01). */
const emptiedDatabase = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createDriver: () => ({
      init: async () => undefined,
      acquireConnection: async () => ({
        executeQuery: async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); },
        streamQuery: () => { throw new Error('not streamed'); },
      }),
      beginTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      releaseConnection: async () => undefined,
      destroy: async () => undefined,
    }),
  },
});

/** A backup as `tome backup` or the updater writes it, with its checksums right. */
async function writeBackup(directory: string, options: { version: string; databaseOnly?: boolean; publicUrl?: string }) {
  await mkdir(directory, { recursive: true });
  const dump = Buffer.from(`dump of ${directory}`);
  await writeFile(join(directory, 'database.dump'), dump);
  const objectBytes = Buffer.from('png bytes');
  if (!options.databaseOnly) {
    await mkdir(join(directory, 'objects', ...objectKey.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(directory, 'objects', ...objectKey.split('/')), objectBytes);
  }
  const manifest = JSON.stringify({
    format: 'tomecms-backup', version: 1, applicationVersion: options.version, createdAt: '2026-10-02T10:01:00.000Z',
    config: { publicUrl: options.publicUrl ?? 'https://example.com', database: 'tomecms', s3Endpoint: 'http://seaweedfs:8333', bucket: 'blog-media' },
    database: { file: 'database.dump', sha256: sha256(dump) },
    records,
    objects: options.databaseOnly ? [] : [{ key: objectKey, contentType: 'image/png', sizeBytes: objectBytes.byteLength, sha256: sha256(objectBytes) }],
    ...options.databaseOnly ? { scope: 'database' } : {},
  });
  await writeFile(join(directory, 'manifest.json'), manifest);
  return manifest;
}

async function fixture(t: TestContext, options: { installed?: string; backup?: string; databaseOnly?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tomecms-restore-')));
  const config = {
    configVersion: 1, projectName: 'tomecms',
    stateDirectory: join(root, 'state'), statusPath: join(root, 'status.json'),
    imageEnvironmentFile: join(root, 'image.env'), backupDirectory: join(root, 'backups'),
    composeFile: join(root, 'compose.yaml'), environmentFile: join(root, 'app.env'),
    socketPath: join(root, 'u.sock'), appHealthUrl: 'http://127.0.0.1:4321/health/ready', minimumFreeBytes: 1,
  } as UpdaterConfig;
  t.after(async () => { await chmod(config.stateDirectory, 0o700).catch(() => undefined); await rm(root, { recursive: true, force: true }); });
  const installed: InstalledState = {
    version: options.installed ?? '1.13.0', imageDigest: digest('a'), composeContract: 1, environmentContract: 1,
    updaterProtocol: 1, installedAt: '2026-10-01T10:00:00.000Z',
  };
  await mkdir(config.backupDirectory);
  await writeFile(config.composeFile, 'services: {}');
  await writeFile(config.environmentFile, "TOME_CMS_PUBLIC_URL='https://example.com/'\n");
  await writeFile(config.imageEnvironmentFile, imageEnv(installed.imageDigest));
  const state = createUpdaterStateStore(config);
  await state.writeInstalled(installed);

  // The backup to restore, and the safety backup the backup one-shot writes before anything is replaced.
  const backupDirectory = join(config.backupDirectory, 'tomecms-old');
  await writeBackup(backupDirectory, { version: options.backup ?? '1.12.1', databaseOnly: options.databaseOnly });
  const safetyDirectory = join(config.backupDirectory, 'tomecms-safety');
  const safetyManifest = await writeBackup(safetyDirectory, { version: installed.version });
  const safetyReceipt = JSON.stringify({ backupDirectory: '/backups/tomecms-safety', manifestSha256: sha256(safetyManifest) });

  // How many more times each step fails.
  const failing = new Map<string, number>();
  let afterRestore: unknown = { ok: true, ...report };
  let appRunning = true;
  let databaseEmptied = false;
  // The app's own container (which may have been removed), and any other container of the app
  // service: a second one, or a one-off that `compose run` left behind.
  let appExists = true;
  let extra: Array<{ id: string; running: boolean; oneoff: boolean }> = [];
  let runningDigest = installed.imageDigest;
  const containers = () => [
    ...appExists ? [{ id: 'c'.repeat(64), running: appRunning, oneoff: false, image: runningDigest }] : [],
    ...extra.map((container) => ({ ...container, image: installed.imageDigest })),
  ];
  let ready = true;
  let gate: Promise<void> = Promise.resolve();
  const events: string[] = [];
  const commands: string[][] = [];
  const observed: string[] = [];
  const dependencies: UpdateDependencies = {
    runPreflight: async () => { throw new Error('a restore verifies no release'); },
    verifyTargetRelease: async () => { throw new Error('a restore verifies no release'); },
    runCommand: async (executable, args) => {
      assert.equal(executable, 'docker');
      if (args[0] === 'ps') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'rm') { events.push(`rm:${args.at(-1)}`); return { code: 0, stdout: '', stderr: '' }; }
      if (args[0] === 'inspect') {
        const inspected = args.slice(3).map((id) => containers().find((container) => container.id === id)!).map((container) => ({
          Config: { Image: `${OFFICIAL_IMAGE_REPOSITORY}@${container.image}`, Labels: container.oneoff ? { 'com.docker.compose.oneoff': 'True' } : {} },
          State: { Running: container.running, Status: container.running ? 'running' : 'exited' },
        }));
        return { code: 0, stdout: JSON.stringify(inspected), stderr: '' };
      }
      // Compose lists one-offs only with --all, and only running containers without it.
      if (args.includes('ps') && args.includes('--all')) {
        return { code: 0, stdout: containers().map(({ id }) => `${id}\n`).join(''), stderr: '' };
      }
      if (args.includes('ps')) {
        return { code: 0, stdout: containers().filter((container) => container.running && !container.oneoff).map(({ id }) => `${id}\n`).join(''), stderr: '' };
      }
      const event = args.includes('content') ? args[args.lastIndexOf('--') + 1]!
        : args.includes('db:migrate') ? 'migrate' : args.includes('stop') ? 'stop' : args.includes('up') ? 'up'
          : args.includes('backup') ? 'backup' : '';
      if (!event) throw new Error(`Unexpected command ${args.join(' ')}`);
      events.push(event);
      commands.push([...args]);
      if (event === 'stop') await gate;
      if (event === 'backup' && databaseEmptied) {
        // The backup one-shot counts the records as scripts/backup.ts does, on what the rollback left.
        try {
          await countRecords(emptiedDatabase);
        } catch {
          return { code: 1, stdout: '', stderr: 'relation "site_settings" does not exist' };
        }
      }
      if ((failing.get(event) ?? 0) > 0) {
        failing.set(event, failing.get(event)! - 1);
        return { code: 1, stdout: '{"ok":false,"code":"injected"}\n', stderr: 'private failure' };
      }
      if (event === 'stop') appRunning = false;
      if (event === 'up') { appRunning = true; appExists = true; }
      const stdout = event === 'backup' ? safetyReceipt
        : event === 'restore-database' ? '{"ok":true}\n'
          : event === 'restore-objects' ? '{"ok":true,"uploaded":1,"deleted":2,"foreign":1}\n'
            : event === 'after-restore' ? `${JSON.stringify(afterRestore)}\n` : '';
      return { code: 0, stdout, stderr: '' };
    },
    fetcher: async () => { events.push('health'); return new Response('', { status: ready ? 200 : 503 }); },
    sleep: async (ms) => { if (ms === 2000) events.push('drain'); },
    now: () => new Date('2026-10-02T10:02:00.000Z'),
  };
  // Each phase the record moves to, with the phase in the public marker the app reads just after.
  const transition = state.transitionRestore.bind(state);
  state.transitionRestore = async (id, phase, patch) => {
    const record = await transition(id, phase, patch);
    const marker = JSON.parse(await readFile(config.statusPath, 'utf8')) as { job: { phase: string } | null };
    assertOldAppsRead(marker, phase);
    observed.push(`${phase}:${marker.job?.phase ?? 'none'}`);
    return record;
  };
  let freeBytes = 10;
  const server = createUpdaterServer({
    state,
    apply: ({ version: target, requestId }) => state.createJob({ targetVersion: target, requestId }),
    backup: {
      check: () => assertBackupSpace(config, (async () => ({ bsize: 1, bavail: 10 })) as unknown as VerifyDependencies['statfs']),
      run: (job) => runBackup({ backup: job, config, state, dependencies }),
    },
    restore: {
      check: () => assertBackupSpace(config, (async () => ({ bsize: 1, bavail: freeBytes })) as unknown as VerifyDependencies['statfs']),
      run: (job) => runRestore({ restore: job, config, state, dependencies }),
    },
  });
  server.listen(config.socketPath);
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return {
    config, state, events, commands, observed, dependencies, installed, backupDirectory, safetyDirectory,
    socketPath: config.socketPath,
    fail: (name: string, times = Infinity) => { failing.set(name, times); },
    afterRestore: (value: unknown) => { afterRestore = value; },
    unready: () => { ready = false; },
    appDown: () => { appRunning = false; },
    emptyDatabase: () => { databaseEmptied = true; },
    noAppContainer: () => { appExists = false; appRunning = false; },
    extraContainer: (container: { running: boolean; oneoff: boolean }) => { extra = [...extra, { id: `${extra.length + 1}`.repeat(64).slice(0, 64), ...container }]; },
    running: (value: string) => { runningDigest = value; },
    isAppRunning: () => appRunning,
    diskFree: (value: number) => { freeBytes = value; },
    hold: () => { let release!: () => void; gate = new Promise((resolve) => { release = resolve; }); return release; },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Every app that may be installed beside this updater reads it: today's client, 1.10.1 and 1.9.1. */
function assertOldAppsRead(value: unknown, label: string): void {
  assert.doesNotThrow(() => parseUpdaterStatus(value), `${label}: today's app`);
  assert.doesNotThrow(() => releasedStatusSchemas['1.10.1'].parse(value), `${label}: an app at 1.10.1`);
  assert.doesNotThrow(() => releasedStatusSchemas['1.9.1'].parse(value), `${label}: an app at 1.9.1`);
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
const restoreBody = (f: Fixture, backupDirectory = f.backupDirectory) => ({ requestId: randomUUID(), backupDirectory });

/** Follows GET /v1/restore to its end. */
async function follow(f: Fixture): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const answer = await unixRequest(f.socketPath, 'GET', '/v1/restore');
    const record = answer.json as Record<string, unknown>;
    if (answer.status === 200 && (record.phase === 'succeeded' || record.phase === 'failed')) {
      await unlocked(f);
      return record;
    }
    await pause();
  }
  throw new Error('The restore did not finish');
}

/** The server lets go of its lock just after a job's last write. */
async function unlocked(f: Fixture): Promise<void> {
  for (let attempt = 0; ((await unixRequest(f.socketPath, 'GET', '/v1/busy')).json as { busy: boolean }).busy; attempt++) {
    assert.ok(attempt < 400, 'the lock is let go');
    await pause();
  }
}

async function restoreThrough(f: Fixture, body = restoreBody(f)): Promise<Record<string, unknown>> {
  const accepted = await unixRequest(f.socketPath, 'POST', '/v1/restore', body);
  assert.deepEqual(accepted, { status: 202, json: { id: body.requestId, phase: 'verifying' } });
  return follow(f);
}

/** The argv of a content step, exactly as the Global Constraints give it. */
function contentArgs(f: Fixture, id: string, name: string, step: string, ...args: string[]): string[] {
  return ['compose', '-p', 'tomecms', '-f', f.config.composeFile, '--env-file', f.config.environmentFile,
    '--env-file', f.config.imageEnvironmentFile, 'run', '--rm', '--name', `tomecms-update-${id}-${name}`, '--no-deps',
    '--user', `${process.getuid!()}:${process.getgid!()}`, '--env', 'DATABASE_QUERY_TIMEOUT_MS=3600000',
    '--volume', `${f.config.backupDirectory}:/work`, 'app', 'npm', 'run', '--silent', 'content', '--', step, ...args];
}

const restoreSteps = ['restore-database', 'restore-objects', 'migrate', 'after-restore'];
const only = (events: string[], wanted: string[]) => events.filter((event) => wanted.includes(event));

test('a restore verifies, takes a safety backup, puts the backup back, migrates, starts and checks, in that order', async (t) => {
  const f = await fixture(t);
  const before = JSON.parse(await readFile(f.config.statusPath, 'utf8'));
  const body = restoreBody(f);
  const record = await restoreThrough(f, body);

  assert.deepEqual({ ...record, startedAt: typeof record.startedAt, finishedAt: typeof record.finishedAt }, {
    id: body.requestId, phase: 'succeeded', startedAt: 'string', finishedAt: 'string',
    backupDirectory: f.backupDirectory, safetyBackupDirectory: f.safetyDirectory, migrated: true, errorCode: null, report,
    maintenanceKept: false,
  });
  assert.deepEqual(f.events, [
    'drain', 'stop', 'backup', 'restore-database', 'restore-objects', 'migrate', 'after-restore', 'stop', 'up', 'health',
  ]);
  // Each step blocks the app's writes the way an update does, and the marker is gone at the end.
  assert.deepEqual(f.observed, [
    'quiescing:quiescing', 'safety_backup:backing_up', 'restoring:migrating', 'migrating:migrating',
    'restarting:restarting', 'checking:health_check', 'succeeded:none',
  ]);
  assert.deepEqual(JSON.parse(await readFile(f.config.statusPath, 'utf8')), before);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);

  const id = body.requestId;
  const [, backup, database, objects, migrate, after] = f.commands;
  assert.ok(backup!.includes('--offline') && !backup!.includes('--database-only'), 'the safety backup is a full one');
  assert.deepEqual(database, contentArgs(f, id, 'restore-database', 'restore-database', '--dump', '/work/tomecms-old/database.dump'));
  assert.deepEqual(objects, contentArgs(f, id, 'restore-objects', 'restore-objects', '--backup', '/work/tomecms-old'));
  assert.deepEqual(migrate, ['compose', '-p', 'tomecms', '-f', f.config.composeFile, '--env-file', f.config.environmentFile,
    '--env-file', f.config.imageEnvironmentFile, 'run', '--rm', '--name', `tomecms-update-${id}-migration`, '--no-deps',
    'app', 'npm', 'run', 'db:migrate']);
  assert.deepEqual(after, contentArgs(f, id, 'after-restore', 'after-restore'));
});

test('a backup of the same version needs no migration, and a database-only backup leaves the bucket alone', async (t) => {
  const f = await fixture(t, { backup: '1.13.0', databaseOnly: true });
  const record = await restoreThrough(f);
  assert.equal(record.phase, 'succeeded');
  assert.equal(record.migrated, false);
  assert.deepEqual(only(f.events, restoreSteps), ['restore-database', 'after-restore']);
  assert.deepEqual(f.observed, [
    'quiescing:quiescing', 'safety_backup:backing_up', 'restoring:migrating',
    'restarting:restarting', 'checking:health_check', 'succeeded:none',
  ]);
});

// Each arranges the refusal, and gives the directory to restore when it is not the fixture's backup.
const refusals: Array<[string, string, (f: Fixture) => Promise<string | void>]> = [
  ['a dump that does not match its checksum', 'backup_invalid', (f) => writeFile(join(f.backupDirectory, 'database.dump'), 'changed')],
  ['an object that does not match its checksum', 'backup_invalid',
    (f) => writeFile(join(f.backupDirectory, 'objects', ...objectKey.split('/')), 'changed!!')],
  ['an object that is missing', 'backup_invalid', (f) => rm(join(f.backupDirectory, 'objects'), { recursive: true })],
  ['a manifest that is a link', 'backup_invalid', async (f) => {
    await rm(join(f.backupDirectory, 'manifest.json'));
    await symlink(join(f.safetyDirectory, 'manifest.json'), join(f.backupDirectory, 'manifest.json'));
  }],
  ['no manifest', 'backup_invalid', (f) => rm(join(f.backupDirectory, 'manifest.json'))],
  ['a directory outside the backup root', 'backup_invalid', async (f) => {
    const outside = join(f.config.stateDirectory, '..', 'outside');
    await writeBackup(outside, { version: '1.12.1' });
    return outside;
  }],
  ['a link to a backup', 'backup_invalid', async (f) => {
    const link = join(f.config.backupDirectory, 'link');
    await symlink(f.backupDirectory, link);
    return link;
  }],
  ['the backup root itself', 'backup_invalid', async (f) => f.config.backupDirectory],
  ['a backup of another site', 'backup_other_site', async (f) => {
    await writeBackup(f.backupDirectory, { version: '1.12.1', publicUrl: 'https://other.example' });
  }],
  ['a backup from a newer version', 'backup_too_new', async (f) => { await writeBackup(f.backupDirectory, { version: '1.14.0' }); }],
];

for (const [label, code, arrange] of refusals) {
  test(`${label} is refused with ${code} while verifying, and nothing stops`, async (t) => {
    const f = await fixture(t);
    const record = await restoreThrough(f, restoreBody(f, await arrange(f) ?? f.backupDirectory));
    assert.equal(record.phase, 'failed');
    assert.equal(record.errorCode, code);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.observed, ['failed:none']);
  });
}

test('a site older than 1.13.0 is refused with app_too_old: its image has no restore steps', async (t) => {
  const f = await fixture(t, { installed: '1.12.1', backup: '1.12.1' });
  const record = await restoreThrough(f);
  assert.equal(record.errorCode, 'app_too_old');
  assert.deepEqual(f.events, []);
});

const preflightRefusals: Array<[string, (f: Fixture) => Promise<void> | void]> = [
  ['an app running another image', (f) => f.running(digest('d'))],
  ['two stopped app containers', (f) => { f.appDown(); f.extraContainer({ running: false, oneoff: false }); }],
  ['a one-off still running beside a stopped app', (f) => { f.appDown(); f.extraContainer({ running: true, oneoff: true }); }],
  ['a stopped app whose configured image is not the installed one', async (f) => {
    f.appDown();
    await writeFile(f.config.imageEnvironmentFile, imageEnv(digest('b')));
  }],
];

for (const [label, arrange] of preflightRefusals) {
  test(`a restore with ${label} stops nothing, with preflight_failed`, async (t) => {
    const f = await fixture(t);
    await arrange(f);
    const record = await restoreThrough(f);
    assert.equal(record.errorCode, 'preflight_failed');
    assert.deepEqual(f.events, []);
  });
}

const stoppedApps: Array<[string, (f: Fixture) => void]> = [
  ['one exited container', (f) => f.appDown()],
  ['no container', (f) => f.noAppContainer()],
  ['an exited one-off left beside it', (f) => { f.appDown(); f.extraContainer({ running: false, oneoff: true }); }],
];

for (const [label, arrange] of stoppedApps) {
  test(`a restore into a stopped app (${label}) goes ahead and starts it at the end`, async (t) => {
    const f = await fixture(t);
    arrange(f);
    const record = await restoreThrough(f);
    assert.equal(record.phase, 'succeeded');
    assert.deepEqual(f.events.slice(-3), ['stop', 'up', 'health']);
    assert.equal(f.isAppRunning(), true);
  });
}

test('a restore that found the app stopped and cannot take its safety backup leaves it stopped, in maintenance', async (t) => {
  const f = await fixture(t);
  f.appDown();
  f.fail('backup');
  t.mock.method(console, 'error', () => undefined);
  const record = await restoreThrough(f);
  assert.equal(record.errorCode, 'safety_backup_failed');
  assert.equal(record.maintenanceKept, true);
  assert.equal(f.events.includes('up'), false);
  assert.equal(f.isAppRunning(), false);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
  // It holds the other jobs up as a failed rollback does, and clear-failed sets it aside the same way.
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/backup', { requestId: randomUUID(), kind: 'full' }),
    { status: 409, json: { error: 'manual_recovery_required' } });
  const message = (await clearFailedJob(f.state)).split('\n');
  assert.equal(message.at(-1), `Next: sudo tome restore ${f.backupDirectory}, to run the restore again.`);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('a restore that found the app stopped puts its safety backup back on a failure, and leaves the app stopped, in maintenance', async (t) => {
  const f = await fixture(t);
  f.appDown();
  f.fail('restore-objects', 1);
  t.mock.method(console, 'error', () => undefined);
  const record = await restoreThrough(f);
  assert.equal(record.errorCode, 'restore_failed');
  assert.equal(record.maintenanceKept, true);
  assert.deepEqual(only(f.events, restoreSteps), ['restore-database', 'restore-objects', 'restore-database', 'restore-objects', 'after-restore']);
  assert.equal(f.events.includes('up'), false);
  assert.equal(f.isAppRunning(), false);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
});

test('a restore that found the app running and fails ends with the site out of maintenance, as before', async (t) => {
  const f = await fixture(t);
  f.fail('restore-objects', 1);
  t.mock.method(console, 'error', () => undefined);
  const record = await restoreThrough(f);
  assert.equal(record.maintenanceKept, false);
  assert.equal(f.isAppRunning(), true);
});

test('after rollback_failed and updater:clear-failed, the safety backup is restored into the stopped app, which runs again', async (t) => {
  const f = await fixture(t);
  f.fail('restore-objects');
  t.mock.method(console, 'error', () => undefined);
  assert.equal((await restoreThrough(f)).errorCode, 'rollback_failed');
  assert.equal(f.isAppRunning(), false);

  const message = await clearFailedJob(f.state);
  assert.match(message, new RegExp(`Next: sudo tome restore ${f.safetyDirectory},`));
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
  f.fail('restore-objects', 0);
  f.events.length = 0;
  const record = await restoreThrough(f, restoreBody(f, f.safetyDirectory));
  assert.equal(record.phase, 'succeeded');
  assert.deepEqual(f.events.filter((event) => !event.startsWith('rm:')), [
    'drain', 'stop', 'backup', 'restore-database', 'restore-objects', 'after-restore', 'stop', 'up', 'health',
  ]);
  assert.equal(f.isAppRunning(), true);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('after a rollback that failed inside pg_restore and left the database empty, the safety backup still goes back', async (t) => {
  const f = await fixture(t);
  // The restore fails putting its database in, and so does the rollback, after the drop.
  f.fail('restore-database', 2);
  t.mock.method(console, 'error', () => undefined);
  assert.equal((await restoreThrough(f)).errorCode, 'rollback_failed');
  f.emptyDatabase();
  assert.match(await clearFailedJob(f.state), new RegExp(`Next: sudo tome restore ${f.safetyDirectory},`));

  f.events.length = 0;
  const record = await restoreThrough(f, restoreBody(f, f.safetyDirectory));
  assert.equal(record.phase, 'succeeded', 'its own safety backup is taken of the empty database');
  assert.deepEqual(f.events.filter((event) => !event.startsWith('rm:')), [
    'drain', 'stop', 'backup', 'restore-database', 'restore-objects', 'after-restore', 'stop', 'up', 'health',
  ]);
  assert.equal(f.isAppRunning(), true);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('a failed restore step puts the safety backup back, starts the app and ends failed with restore_failed', async (t) => {
  const f = await fixture(t);
  f.fail('restore-objects', 1);
  t.mock.method(console, 'error', () => undefined);
  const before = JSON.parse(await readFile(f.config.statusPath, 'utf8'));
  const record = await restoreThrough(f);
  assert.equal(record.phase, 'failed');
  assert.equal(record.errorCode, 'restore_failed');
  assert.equal(record.safetyBackupDirectory, f.safetyDirectory);
  // Before it puts anything back, every one-shot of this restore is gone.
  const firstRemoval = f.events.findIndex((event) => event.startsWith('rm:'));
  assert.equal(f.events[firstRemoval - 1], 'restore-objects');
  assert.ok(f.events.includes(`rm:tomecms-update-${record.id}-restore-database`));
  assert.deepEqual(f.events.filter((event) => !event.startsWith('rm:')), [
    'drain', 'stop', 'backup', 'restore-database', 'restore-objects',
    'stop', 'restore-database', 'restore-objects', 'after-restore', 'stop', 'up', 'health',
  ]);
  // The rollback reads the safety backup.
  assert.ok(f.commands[5]!.includes('/work/tomecms-safety/database.dump'));
  assert.ok(f.commands[6]!.includes('/work/tomecms-safety'));
  assert.deepEqual(f.observed.slice(-2), ['rolling_back:migrating', 'failed:none']);
  assert.deepEqual(JSON.parse(await readFile(f.config.statusPath, 'utf8')), before);
  assert.equal(f.isAppRunning(), true);
});

test('when the safety backup cannot be put back either, the site stays in maintenance with the app stopped', async (t) => {
  const f = await fixture(t);
  f.fail('restore-objects');
  t.mock.method(console, 'error', () => undefined);
  const record = await restoreThrough(f);
  assert.equal(record.phase, 'failed');
  assert.equal(record.errorCode, 'rollback_failed');
  assert.equal(record.backupDirectory, f.backupDirectory);
  assert.equal(record.safetyBackupDirectory, f.safetyDirectory);
  assert.equal(f.events.includes('up'), false);
  assert.equal(f.isAppRunning(), false);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true, 'writes stay blocked');
  assertOldAppsRead(JSON.parse(await readFile(f.config.statusPath, 'utf8')), 'rollback_failed');
  // Nothing else may run on a database in an unknown state.
  for (const [path, body] of [
    ['/v1/apply', { version: '1.14.0', requestId: randomUUID() }],
    ['/v1/backup', { requestId: randomUUID(), kind: 'full' }],
    ['/v1/restore', restoreBody(f)],
  ] as const) {
    assert.deepEqual(await unixRequest(f.socketPath, 'POST', path, body), { status: 409, json: { error: 'manual_recovery_required' } }, path);
  }
});

test('a safety backup that fails restores nothing, starts the app again and ends with safety_backup_failed', async (t) => {
  const f = await fixture(t);
  f.fail('backup');
  t.mock.method(console, 'error', () => undefined);
  const record = await restoreThrough(f);
  assert.equal(record.errorCode, 'safety_backup_failed');
  assert.equal(record.safetyBackupDirectory, null);
  assert.deepEqual(only(f.events, restoreSteps), []);
  assert.deepEqual(f.events.slice(-3), ['stop', 'up', 'health']);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('restored counts that differ from the manifest roll back with restore_failed', async (t) => {
  const f = await fixture(t);
  f.afterRestore({ ok: true, ...report, records: { ...records, posts: 1 } });
  const record = await restoreThrough(f);
  assert.equal(record.errorCode, 'restore_failed');
  assert.deepEqual(only(f.events, restoreSteps), [...restoreSteps, 'restore-database', 'restore-objects', 'after-restore']);
  // Known before the start, so the app never runs on a database about to be put back.
  assert.equal(f.events.filter((event) => event === 'up').length, 1, 'started once, on the safety backup');
  assert.equal(f.observed.some((step) => step.startsWith('restarting')), false);
});

test('site settings are not compared, and a receipt that is not one is a failed step', async (t) => {
  const f = await fixture(t);
  f.afterRestore({ ok: true, ...report, records: { ...records, siteSettings: 7 } });
  assert.equal((await restoreThrough(f)).phase, 'succeeded');

  const g = await fixture(t);
  g.afterRestore({ ok: true, records });
  assert.equal((await restoreThrough(g)).errorCode, 'restore_failed');
});

test('an app that does not come back after the restore is rolled back', async (t) => {
  const f = await fixture(t);
  f.unready();
  const record = await restoreThrough(f);
  // It does not come back on the safety backup either, and is left stopped.
  assert.equal(record.errorCode, 'rollback_failed');
  assert.equal(f.isAppRunning(), false);
  assert.deepEqual(only(f.events, restoreSteps), [...restoreSteps, 'restore-database', 'restore-objects', 'after-restore']);
});

/** A restore cut short in `phase`, as an updater that died there leaves it. */
async function cutShort(f: Fixture, phase: RestorePhase): Promise<string> {
  const id = randomUUID();
  await f.state.createRestore({ id, backupDirectory: f.backupDirectory });
  const path: RestorePhase[] = ['quiescing', 'safety_backup', 'restoring', 'migrating', 'restarting', 'checking', 'rolling_back'];
  for (const next of path.slice(0, path.indexOf(phase) + 1)) {
    await f.state.transitionRestore(id, next, next === 'restoring' ? { safetyBackupDirectory: f.safetyDirectory } : {});
  }
  f.observed.length = 0;
  return id;
}

/** A state directory that takes no new file once a restore reaches one of `phases`, as on a full disk. */
function failEndingWrites(f: Fixture, phases = ['succeeded', 'failed']): void {
  const transition = f.state.transitionRestore.bind(f.state);
  f.state.transitionRestore = async (id, phase, patch) => {
    if (!phases.includes(phase)) return transition(id, phase, patch);
    await chmod(f.config.stateDirectory, 0o500);
    return transition(id, phase, patch);
  };
}

test('on boot, a restore cut short while verifying ends interrupted, and nothing runs', async (t) => {
  const f = await fixture(t);
  await cutShort(f, 'verifying');
  const record = await reconcileRestore({ config: f.config, state: f.state, dependencies: f.dependencies });
  assert.equal(record?.phase, 'failed');
  assert.equal(record?.errorCode, 'interrupted');
  assert.deepEqual(f.events, []);
});

for (const phase of ['quiescing', 'safety_backup'] as const) {
  test(`on boot, a restore cut short in ${phase} starts the app again and ends interrupted`, async (t) => {
    const f = await fixture(t);
    const id = await cutShort(f, phase);
    f.appDown();
    assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
    const record = await reconcileRestore({ config: f.config, state: f.state, dependencies: f.dependencies });
    assert.equal(record?.phase, 'failed');
    assert.equal(record?.errorCode, 'interrupted');
    assert.ok(f.events.includes(`rm:tomecms-update-${id}-backup`), 'a backup still writing is removed');
    assert.deepEqual(f.events.filter((event) => !event.startsWith('rm:')), ['stop', 'up', 'health']);
    assert.equal(f.isAppRunning(), true);
    assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
  });
}

for (const phase of ['restoring', 'migrating', 'restarting', 'checking', 'rolling_back'] as const) {
  test(`on boot, a restore cut short in ${phase} puts the safety backup back and ends interrupted`, async (t) => {
    const f = await fixture(t);
    const id = await cutShort(f, phase);
    const record = await reconcileRestore({ config: f.config, state: f.state, dependencies: f.dependencies });
    assert.equal(record?.phase, 'failed');
    assert.equal(record?.errorCode, 'interrupted');
    assert.equal(record?.safetyBackupDirectory, f.safetyDirectory);
    for (const name of ['restore-database', 'restore-objects', 'after-restore']) {
      assert.ok(f.events.includes(`rm:tomecms-update-${id}-${name}`), `${name} one-shot removed first`);
    }
    assert.deepEqual(f.events.filter((event) => !event.startsWith('rm:')),
      ['stop', 'restore-database', 'restore-objects', 'after-restore', 'stop', 'up', 'health']);
    assert.ok(f.commands[1]!.includes('/work/tomecms-safety/database.dump'));
    assert.deepEqual(f.observed, phase === 'rolling_back' ? ['failed:none'] : ['rolling_back:migrating', 'failed:none']);
    assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
    // Nothing to do on the next boot.
    const count = f.events.length;
    assert.deepEqual(await reconcileRestore({ config: f.config, state: f.state, dependencies: f.dependencies }), record);
    assert.equal(f.events.length, count);
  });
}

test('on boot, a restore that cannot be put back leaves the site in maintenance with rollback_failed', async (t) => {
  const f = await fixture(t);
  await cutShort(f, 'restoring');
  f.fail('restore-database');
  t.mock.method(console, 'error', () => undefined);
  const record = await reconcileRestore({ config: f.config, state: f.state, dependencies: f.dependencies });
  assert.equal(record?.errorCode, 'rollback_failed');
  assert.equal(f.events.includes('up'), false);
  assert.equal(f.isAppRunning(), false);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
});

test('a safety backup damaged since it was taken is never restored: the rollback stops before the drop', async (t) => {
  const f = await fixture(t);
  await cutShort(f, 'restarting');
  await writeFile(join(f.safetyDirectory, 'database.dump'), 'damaged');
  const record = await reconcileRestore({ config: f.config, state: f.state, dependencies: f.dependencies });
  assert.equal(record?.errorCode, 'rollback_failed');
  assert.deepEqual(only(f.events, restoreSteps), []);
  assert.equal(f.isAppRunning(), false, 'a running app is stopped all the same');
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
});

test('on boot, a restore record that cannot be ended is journalled, and stays active', async (t) => {
  const f = await fixture(t);
  await cutShort(f, 'restoring');
  failEndingWrites(f);
  const errors: string[] = [];
  t.mock.method(console, 'error', (message: unknown) => { errors.push(String(message)); });
  assert.equal(await reconcileRestore({ config: f.config, state: f.state, dependencies: f.dependencies }), null);
  assert.deepEqual(errors.map((line) => JSON.parse(line).event), ['updater_restore_reconcile_failed']);
  assert.equal((await f.state.readRestore())?.phase, 'rolling_back');
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/apply', { version: '1.14.0', requestId: randomUUID() }),
    { status: 409, json: { error: 'update_in_progress' } });
});

test('a restore whose last record write fails keeps refusing jobs and lets go of the lock', async (t) => {
  const f = await fixture(t);
  failEndingWrites(f);
  const errors: string[] = [];
  t.mock.method(console, 'error', (message: unknown) => { errors.push(String(message)); });
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/restore', restoreBody(f))).status, 202);
  for (let attempt = 0; !errors.includes('Updater restore state could not be persisted'); attempt++) {
    assert.ok(attempt < 400, 'the server journals the record it cannot write');
    await pause();
  }
  assert.equal((await f.state.readRestore())?.phase, 'checking');
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true, 'the marker still tells the truth');
  await unlocked(f);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/backup', { requestId: randomUUID(), kind: 'full' }),
    { status: 409, json: { error: 'update_in_progress' } });
});

test('one job at a time: a restore during a backup, and a backup, an update or a restore during a restore, are refused', async (t) => {
  const f = await fixture(t);
  const release = f.hold();
  t.after(release);
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', { requestId: randomUUID(), kind: 'full' })).status, 202);
  while (!f.events.includes('stop')) await pause();
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/restore', restoreBody(f)), { status: 409, json: { error: 'update_in_progress' } });
  release();
  while ((await f.state.readBackup())?.phase !== 'succeeded') await pause();
  await unlocked(f);

  const holdRestore = f.hold();
  t.after(holdRestore);
  const body = restoreBody(f);
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/restore', body)).status, 202);
  while (f.events.filter((event) => event === 'stop').length < 3) await pause();
  assert.deepEqual(await unixRequest(f.socketPath, 'GET', '/v1/busy'), { status: 200, json: { busy: true } });
  for (const [path, request] of [
    ['/v1/apply', { version: '1.14.0', requestId: randomUUID() }],
    ['/v1/backup', { requestId: randomUUID(), kind: 'full' }],
    ['/v1/restore', restoreBody(f)],
  ] as const) {
    assert.deepEqual(await unixRequest(f.socketPath, 'POST', path, request), { status: 409, json: { error: 'update_in_progress' } }, path);
  }
  // The lock holds on disk too.
  await assert.rejects(f.state.createJob({ targetVersion: '1.14.0', requestId: randomUUID() }), /already active/);
  // A request sent again is answered from its record and starts nothing.
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/restore', body),
    { status: 202, json: { id: body.requestId, phase: 'quiescing' } });
  holdRestore();
  const record = await follow(f);
  assert.equal(record.phase, 'succeeded');
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/restore', body), { status: 200, json: record });
  assert.equal(f.events.filter((event) => event === 'restore-database').length, 1);
});

test('restore requests are exact, there is nothing to follow before the first, and a full disk refuses one', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await unixRequest(f.socketPath, 'GET', '/v1/restore'), { status: 404, json: { error: 'not_found' } });
  for (const invalid of [
    { requestId: 'not-a-uuid', backupDirectory: f.backupDirectory },
    { requestId: randomUUID() },
    { requestId: randomUUID(), backupDirectory: 'relative/path' },
    { requestId: randomUUID(), backupDirectory: `${f.config.backupDirectory}/../escape` },
    { requestId: randomUUID(), backupDirectory: f.backupDirectory, yes: true },
  ]) assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/restore', invalid), { status: 400, json: { error: 'invalid_request' } });
  assert.equal((await unixRequest(f.socketPath, 'DELETE', '/v1/restore')).status, 405);
  f.diskFree(0);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/restore', restoreBody(f)),
    { status: 409, json: { error: 'insufficient_disk_space' } });
  assert.equal((await unixRequest(f.socketPath, 'GET', '/v1/restore')).status, 404);
  assert.deepEqual(f.events, []);
});

async function unixRequest(socketPath: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = request({
      socketPath, method, path,
      headers: payload === undefined ? undefined : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, json: text ? JSON.parse(text) : null });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}
