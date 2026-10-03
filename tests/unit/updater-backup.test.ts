import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { OFFICIAL_IMAGE_REPOSITORY } from '../../src/update/contracts.js';
import { isUpdateWriteBlocked } from '../../src/server/update/maintenance.js';
import { parseUpdaterStatus } from '../../src/server/update/updater-client.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import { createUpdaterServer } from '../../src/updater/server.js';
import { createUpdaterStateStore, type InstalledState, type UpdateJob } from '../../src/updater/state.js';
import { reconcileBackup, runBackup, runPrune, type UpdateDependencies } from '../../src/updater/transaction.js';
import { assertBackupSpace, type VerifyDependencies } from '../../src/updater/verify.js';
import { UPDATER_VERSION } from '../../src/updater/version.js';
import { releasedStatusSchemas } from '../helpers/released-updater-status.js';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const installedState = (version: string): InstalledState => ({
  version, imageDigest: digest('a'), composeContract: 1, environmentContract: 1, updaterProtocol: 1,
  installedAt: '2026-10-01T10:00:00.000Z',
});
const previousDigest = digest('9');
const imageEnv = (value: string) => `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${value}'\n`;
const terminal = ['succeeded', 'failed'];

async function fixture(t: TestContext, version = '1.10.0') {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-backup-'));
  const config = {
    configVersion: 1, projectName: 'tomecms',
    stateDirectory: join(root, 'state'), statusPath: join(root, 'status.json'),
    imageEnvironmentFile: join(root, 'image.env'), backupDirectory: join(root, 'backups'),
    composeFile: join(root, 'compose.yaml'), environmentFile: join(root, 'app.env'),
    socketPath: join(root, 'u.sock'), appHealthUrl: 'http://127.0.0.1:4321/health/ready', minimumFreeBytes: 1,
  } as UpdaterConfig;
  // A test may leave the state directory read-only, as a full disk would.
  t.after(async () => { await chmod(config.stateDirectory, 0o700).catch(() => undefined); await rm(root, { recursive: true, force: true }); });
  const installed = installedState(version);
  await mkdir(config.backupDirectory);
  await writeFile(config.composeFile, 'services: {}');
  await writeFile(config.environmentFile, '');
  await writeFile(config.imageEnvironmentFile, imageEnv(installed.imageDigest));
  const state = createUpdaterStateStore(config);
  await state.writeInstalled(installed);

  // What the backup one-shot leaves behind: database alone from 1.3.0, everything before.
  const backup = join(config.backupDirectory, 'backup-1');
  await mkdir(backup);
  const databaseBytes = Buffer.from('postgres custom-format backup fixture');
  await writeFile(join(backup, 'database.dump'), databaseBytes);
  const databaseOnly = version !== '1.2.0';
  const manifestBytes = JSON.stringify({
    format: 'tomecms-backup', version: 1, applicationVersion: version, createdAt: '2026-10-02T10:01:00.000Z',
    config: { publicUrl: 'https://example.com', database: 'tomecms', s3Endpoint: 'http://seaweedfs:8333', bucket: 'blog-media' },
    database: { file: 'database.dump', sha256: createHash('sha256').update(databaseBytes).digest('hex') },
    records: { siteSettings: 1, posts: 2, pages: 3, mediaItems: 0 },
    objects: [], ...databaseOnly ? { scope: 'database' } : {},
  });
  await writeFile(join(backup, 'manifest.json'), manifestBytes);
  const receipt = JSON.stringify({
    backupDirectory: '/backups/backup-1', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  });

  let failure = '';
  let ready = true;
  let appRunning = true;
  let freeBytes = 10 * 1024 ** 3;
  let runningDigest = installed.imageDigest;
  let listing = '';
  let gate: Promise<void> = Promise.resolve();
  let duringBackup: () => Promise<void> = async () => undefined;
  const events: string[] = [];
  const backupArgs: string[][] = [];
  // Each step with the backup's phase and the phase in the public marker the app reads.
  const observed: string[] = [];
  const observe = async (event: string) => {
    const record = await state.readBackup();
    const marker = JSON.parse(await readFile(config.statusPath, 'utf8')) as { job: { phase: string } | null };
    observed.push(`${event}:${record?.phase ?? 'none'}:${marker.job?.phase ?? 'none'}`);
  };
  const dependencies: UpdateDependencies = {
    runPreflight: async () => { throw new Error('a backup verifies no release'); },
    verifyTargetRelease: async () => { throw new Error('a backup verifies no release'); },
    runCommand: async (executable, args) => {
      assert.equal(executable, 'docker');
      if (args[0] === 'image') {
        events.push(args[1] === 'ls' ? 'image-ls' : `image-rm:${args.at(-1)}`);
        return { code: 0, stdout: args[1] === 'ls' ? listing : '', stderr: '' };
      }
      if (args[0] === 'ps') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'rm') { events.push(`rm:${args.at(-1)}`); return { code: 0, stdout: '', stderr: '' }; }
      if (args[0] === 'inspect') {
        return { code: 0, stdout: JSON.stringify([{ Config: { Image: `${OFFICIAL_IMAGE_REPOSITORY}@${runningDigest}` }, State: { Running: appRunning } }]), stderr: '' };
      }
      if (args.includes('ps')) return { code: 0, stdout: appRunning ? `${'c'.repeat(64)}\n` : '', stderr: '' };
      const event = args.includes('stop') ? 'stop' : args.includes('backup') ? 'backup' : args.includes('up') ? 'up' : '';
      if (!event) throw new Error(`Unexpected command ${args.join(' ')}`);
      events.push(event);
      await observe(event);
      if (event === 'stop') await gate;
      if (event === 'backup') { backupArgs.push([...args]); await duringBackup(); }
      if (failure === event) return { code: 1, stdout: '', stderr: 'private failure' };
      if (event === 'stop') appRunning = false;
      if (event === 'up') appRunning = true;
      return { code: 0, stdout: event === 'backup' ? receipt : '', stderr: '' };
    },
    fetcher: async () => {
      events.push('health');
      await observe('health');
      return new Response('', { status: ready ? 200 : 503 });
    },
    sleep: async (ms) => { if (ms === 2000) { events.push('drain'); await observe('drain'); } },
    now: () => new Date('2026-10-02T10:02:00.000Z'),
  };
  const server = createUpdaterServer({
    state,
    apply: ({ version: target, requestId }) => state.createJob({ targetVersion: target, requestId }),
    backup: {
      check: () => assertBackupSpace(config, (async () => ({ bsize: 1, bavail: freeBytes })) as unknown as VerifyDependencies['statfs']),
      run: (job) => runBackup({ backup: job, config, state, dependencies }),
    },
    prune: ({ dryRun }) => runPrune({ dryRun, config, state, dependencies }),
  });
  server.listen(config.socketPath);
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return {
    config, state, events, observed, backupArgs, dependencies, installed,
    backupDirectory: backup, socketPath: config.socketPath,
    fail: (event: string) => { failure = event; },
    unready: () => { ready = false; },
    running: (value: string) => { runningDigest = value; },
    appDown: () => { appRunning = false; },
    isAppRunning: () => appRunning,
    diskFree: (value: number) => { freeBytes = value; },
    listing: (value: string) => { listing = value; },
    hold: () => { let release!: () => void; gate = new Promise((resolve) => { release = resolve; }); return release; },
    duringBackup: (hook: () => Promise<void>) => { duringBackup = hook; },
  };
}

/** A finished update to 1.10.0 from the image before it, as job.json holds it. */
async function lastUpdate(f: Awaited<ReturnType<typeof fixture>>): Promise<UpdateJob> {
  const job: UpdateJob = {
    id: randomUUID(), requestId: randomUUID(), targetVersion: f.installed.version, previousVersion: '1.9.1',
    previousImageDigest: previousDigest, targetImageDigest: f.installed.imageDigest, phase: 'succeeded',
    completedSteps: 8, totalSteps: 8, message: 'Update installed successfully.',
    startedAt: '2026-10-01T09:00:00.000Z', finishedAt: '2026-10-01T09:05:00.000Z', errorCode: null,
    backupDirectory: join(f.config.backupDirectory, 'update-backup'), backupCreatedAt: '2026-10-01T09:01:00.000Z',
    timeline: [], backupKind: 'database',
  };
  await writeFile(join(f.config.stateDirectory, 'job.json'), JSON.stringify(job));
  await f.state.refreshStatus();
  return job;
}

/** Follows GET /v1/backup to its end, then waits for the marker, which is cleared just after the record ends. */
async function follow(socketPath: string, statusPath: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const answer = await unixRequest(socketPath, 'GET', '/v1/backup');
    const record = answer.json as Record<string, unknown>;
    if (answer.status === 200 && terminal.includes(record.phase as string)) {
      for (let wait = 0; wait < 400 && await isUpdateWriteBlocked(statusPath); wait++) await pause();
      return record;
    }
    await pause();
  }
  throw new Error('The backup did not finish');
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

/** The server lets go of its lock just after a job's last write, as after an update; a request then is retried. */
async function onceUnlocked(send: () => Promise<{ status: number; json: unknown }>): Promise<{ status: number; json: unknown }> {
  let answer = await send();
  for (let attempt = 0; attempt < 400 && answer.status === 409; attempt++) {
    await pause();
    answer = await send();
  }
  return answer;
}

const backupBody = (kind = 'database') => ({ requestId: randomUUID(), kind });
const readStatusFile = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;

/** Every app that may be installed beside this updater reads it: today's client, 1.10.1 and 1.9.1. */
function assertOldAppsRead(value: unknown, label: string): void {
  assert.doesNotThrow(() => parseUpdaterStatus(value), `${label}: today's app`);
  assert.doesNotThrow(() => releasedStatusSchemas['1.10.1'].parse(value), `${label}: an app at 1.10.1`);
  assert.doesNotThrow(() => releasedStatusSchemas['1.9.1'].parse(value), `${label}: an app at 1.9.1`);
}

test('the updater is 1.6.0', () => {
  assert.equal(UPDATER_VERSION, '1.6.0');
});

test('a backup on request answers 202, then goes through quiescing, backing up and restarting to succeeded', async (t) => {
  const f = await fixture(t);
  let during: unknown;
  f.duringBackup(async () => { during = (await unixRequest(f.socketPath, 'GET', '/v1/backup')).json; });
  const body = backupBody();
  const accepted = await unixRequest(f.socketPath, 'POST', '/v1/backup', body);
  assert.equal(accepted.status, 202);
  assert.deepEqual(accepted.json, { id: body.requestId, phase: 'quiescing' });

  const record = await follow(f.socketPath, f.config.statusPath);
  assert.deepEqual(Object.keys(record).sort(),
    ['backupDirectory', 'errorCode', 'finishedAt', 'id', 'kind', 'phase', 'sizeBytes', 'startedAt']);
  const dumpSize = Buffer.byteLength('postgres custom-format backup fixture');
  const manifestSize = (await readFile(join(f.backupDirectory, 'manifest.json'))).byteLength;
  assert.deepEqual({ ...record, startedAt: typeof record.startedAt, finishedAt: typeof record.finishedAt }, {
    id: body.requestId, kind: 'database', phase: 'succeeded', startedAt: 'string', finishedAt: 'string',
    backupDirectory: f.backupDirectory, sizeBytes: dumpSize + manifestSize, errorCode: null,
  });
  assert.equal((during as { phase: string }).phase, 'backing_up', 'GET /v1/backup follows the running backup');
  // The marker the app reads is written before the drain, held while the app is down, and gone at the end.
  assert.deepEqual(f.observed, [
    'drain:quiescing:quiescing', 'stop:quiescing:quiescing', 'backup:backing_up:backing_up',
    'stop:restarting:restarting', 'up:restarting:restarting', 'health:restarting:restarting',
  ]);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
  assert.deepEqual(f.backupArgs[0]!.slice(-3), ['--output-root', '/backups', '--database-only']);
  assert.ok(f.backupArgs[0]!.includes(`tomecms-update-${body.requestId}-backup`));
  assert.deepEqual(await f.state.readBackup(), record);
});

test('/v1/status and the marker stay readable by older apps during and after a backup', async (t) => {
  const f = await fixture(t);
  await lastUpdate(f);
  const before = (await unixRequest(f.socketPath, 'GET', '/v1/status')).json;
  let statusDuring: unknown;
  let markerDuring: unknown;
  let blockedDuring = false;
  f.duringBackup(async () => {
    statusDuring = (await unixRequest(f.socketPath, 'GET', '/v1/status')).json;
    markerDuring = await readStatusFile(f.config.statusPath);
    blockedDuring = await isUpdateWriteBlocked(f.config.statusPath);
  });
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  assert.equal((await follow(f.socketPath, f.config.statusPath)).phase, 'succeeded');
  const statusAfter = (await unixRequest(f.socketPath, 'GET', '/v1/status')).json;
  const markerAfter = await readStatusFile(f.config.statusPath);

  for (const [label, value] of Object.entries({ statusDuring, markerDuring, statusAfter, markerAfter })) assertOldAppsRead(value, label);
  // /v1/status is the update's, untouched by a backup; the admin's System screen shows no backup.
  assert.deepEqual(statusDuring, before);
  assert.deepEqual(statusAfter, before);
  // The marker is an update's: the app refuses writes while it is up, then reads the last update again.
  assert.equal(blockedDuring, true);
  assert.equal((markerDuring as { job: { phase: string } }).job.phase, 'backing_up');
  assert.deepEqual(markerAfter, before);
});

test('a failed backup still starts the app, clears the marker and ends failed with backup_failed', async (t) => {
  const f = await fixture(t);
  const before = await readStatusFile(f.config.statusPath);
  f.fail('backup');
  t.mock.method(console, 'error', () => undefined);
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  const record = await follow(f.socketPath, f.config.statusPath);
  assert.equal(record.phase, 'failed');
  assert.equal(record.errorCode, 'backup_failed');
  assert.equal(record.backupDirectory, null);
  assert.equal(record.sizeBytes, null);
  assert.deepEqual(f.observed.slice(-3), ['stop:restarting:restarting', 'up:restarting:restarting', 'health:restarting:restarting']);
  assert.deepEqual(await readStatusFile(f.config.statusPath), before);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('an app that does not come back ends the backup failed with health_failed, and the marker cleared', async (t) => {
  const f = await fixture(t);
  f.unready();
  const record = await (async () => {
    assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
    return follow(f.socketPath, f.config.statusPath);
  })();
  assert.equal(record.phase, 'failed');
  assert.equal(record.errorCode, 'health_failed');
  assert.equal(record.backupDirectory, f.backupDirectory, 'the backup itself was taken');
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('a backup that fails its checks stops nothing and starts nothing', async (t) => {
  const f = await fixture(t);
  f.running(digest('d'));
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  const record = await follow(f.socketPath, f.config.statusPath);
  assert.equal(record.phase, 'failed');
  assert.equal(record.errorCode, 'preflight_failed');
  assert.deepEqual(f.events, []);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('a backup refuses a stopped app, as before: only a restore goes ahead without one', async (t) => {
  const f = await fixture(t);
  f.appDown();
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  const record = await follow(f.socketPath, f.config.statusPath);
  assert.equal(record.errorCode, 'preflight_failed');
  assert.deepEqual(f.events, []);
  assert.equal(f.isAppRunning(), false);
});

test('an app before 1.3.0 cannot back up its database alone, so it backs up everything', async (t) => {
  const f = await fixture(t, '1.2.0');
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody('database'))).status, 202);
  const record = await follow(f.socketPath, f.config.statusPath);
  assert.equal(record.phase, 'succeeded');
  assert.equal(record.kind, 'full');
  assert.equal(f.backupArgs[0]!.includes('--database-only'), false);
});

test('one job at a time: a backup is refused during an update, and an update, a prune or a backup during a backup', async (t) => {
  const f = await fixture(t);
  const release = f.hold();
  t.after(release);
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  for (let attempt = 0; !f.events.includes('stop'); attempt++) {
    assert.ok(attempt < 400, 'the backup reaches its stop');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  for (const [path, body] of [
    ['/v1/apply', { version: '1.11.0', requestId: randomUUID() }],
    ['/v1/backup', backupBody('full')],
    ['/v1/prune', { dryRun: true }],
  ] as const) {
    assert.deepEqual(await unixRequest(f.socketPath, 'POST', path, body), { status: 409, json: { error: 'update_in_progress' } }, path);
  }
  // The lock holds on disk too, not only in the server: an update job cannot be created beside it.
  await assert.rejects(f.state.createJob({ targetVersion: '1.11.0', requestId: randomUUID() }), /already active/);
  release();
  assert.equal((await follow(f.socketPath, f.config.statusPath)).phase, 'succeeded');
  assert.equal(f.events.filter((event) => event === 'backup').length, 1);

  // The server lets go of the lock just after the backup's last write, as it does after an update.
  const applied = await onceUnlocked(() => unixRequest(f.socketPath, 'POST', '/v1/apply', { version: '1.11.0', requestId: randomUUID() }));
  // An update that has started, here one that has not moved past its first step, refuses a backup and a prune.
  assert.equal(applied.status, 202);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody()), { status: 409, json: { error: 'update_in_progress' } });
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: true }), { status: 409, json: { error: 'update_in_progress' } });
});

test('a backup or prune is refused while an update waits for manual recovery', async (t) => {
  const f = await fixture(t);
  const job = await lastUpdate(f);
  await writeFile(join(f.config.stateDirectory, 'job.json'), JSON.stringify({
    ...job, phase: 'failed_manual_recovery', message: 'Manual recovery is required.', errorCode: 'manual_recovery_required',
  }));
  for (const [path, body] of [['/v1/backup', backupBody()], ['/v1/prune', { dryRun: true }]] as const) {
    assert.deepEqual(await unixRequest(f.socketPath, 'POST', path, body), { status: 409, json: { error: 'manual_recovery_required' } }, path);
  }
  assert.deepEqual(f.events, []);
});

test('backup and prune requests are exact, and there is nothing to follow before the first backup', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await unixRequest(f.socketPath, 'GET', '/v1/backup'), { status: 404, json: { error: 'not_found' } });
  for (const invalid of [
    { requestId: randomUUID(), kind: 'everything' },
    { requestId: 'not-a-uuid', kind: 'database' },
    { requestId: randomUUID() },
    { requestId: randomUUID(), kind: 'full', command: 'docker' },
  ]) assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', invalid)).status, 400);
  for (const invalid of [{}, { dryRun: 'yes' }, { dryRun: true, all: true }]) {
    assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/prune', invalid)).status, 400);
  }
  assert.equal((await unixRequest(f.socketPath, 'DELETE', '/v1/backup')).status, 405);
  assert.equal((await unixRequest(f.socketPath, 'GET', '/v1/prune')).status, 405);
  assert.deepEqual(f.events, []);
});

const listingRow = (id: string, createdAt: string, tag = '<none>', size = '763MB') => JSON.stringify({
  Containers: 'N/A', CreatedAt: createdAt, Digest: id, ID: id, Repository: OFFICIAL_IMAGE_REPOSITORY, Size: size, Tag: tag,
});

test('a prune dry run lists the old images with their sizes and removes nothing; a real one removes them', async (t) => {
  const f = await fixture(t);
  await lastUpdate(f);
  t.mock.method(console, 'info', () => undefined);
  f.listing([
    listingRow(digest('a'), '2026-10-02 05:59:08 +0000 UTC'),
    listingRow(previousDigest, '2026-10-01 22:55:05 +0000 UTC'),
    listingRow(digest('1'), '2026-10-01 20:14:43 +0000 UTC', '<none>', '1.2GB'),
    listingRow(digest('2'), '2026-10-01 18:44:41 +0000 UTC', '<none>', '753MB'),
    listingRow(digest('3'), '2026-09-01 18:44:41 +0000 UTC', 'dev'),
  ].join('\n'));
  const candidates = [{ id: digest('1'), size: 1_200_000_000 }, { id: digest('2'), size: 753_000_000 }];

  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: true }),
    { status: 200, json: { candidates, removed: [] } });
  assert.deepEqual(f.events, ['image-ls']);

  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: false }),
    { status: 200, json: { candidates, removed: [digest('1'), digest('2')] } });
  assert.deepEqual(f.events, ['image-ls', 'image-ls', `image-rm:${digest('1')}`, `image-rm:${digest('2')}`]);
});

test('with no update to say which image came before, a prune keeps the newest older one and anything newer', async (t) => {
  const f = await fixture(t);
  t.mock.method(console, 'info', () => undefined);
  f.listing([
    listingRow(digest('5'), '2026-10-03 08:00:00 +0000 UTC'),
    listingRow(digest('a'), '2026-10-02 05:59:08 +0000 UTC'),
    listingRow(digest('1'), '2026-10-01 22:55:05 +0000 UTC'),
    listingRow(digest('2'), '2026-10-01 20:14:43 +0000 UTC', '<none>', '0B'),
    listingRow(digest('3'), '2026-09-30 20:14:43 +0000 UTC', '<none>', 'unknown'),
  ].join('\n'));
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: false }), {
    status: 200, json: { candidates: [{ id: digest('2'), size: 0 }, { id: digest('3'), size: null }], removed: [digest('2'), digest('3')] },
  });
});

test('a rolled-back update says nothing of the image before the installed one, so the same keep-more rule applies', async (t) => {
  const f = await fixture(t);
  const job = await lastUpdate(f);
  // A rolled-back job's previous image is the installed one; its target was pulled and never used.
  await writeFile(join(f.config.stateDirectory, 'job.json'), JSON.stringify({
    ...job, previousImageDigest: f.installed.imageDigest, targetImageDigest: digest('5'), phase: 'rolled_back',
    message: 'The previous application version was restored.', completedSteps: 8, errorCode: 'health_failed',
  }));
  f.listing([
    listingRow(digest('5'), '2026-10-03 08:00:00 +0000 UTC'),
    listingRow(digest('a'), '2026-10-02 05:59:08 +0000 UTC'),
    listingRow(digest('1'), '2026-10-01 22:55:05 +0000 UTC'),
    listingRow(digest('2'), '2026-10-01 20:14:43 +0000 UTC'),
  ].join('\n'));
  const answer = await unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: true });
  assert.deepEqual(answer, { status: 200, json: { candidates: [{ id: digest('2'), size: 763_000_000 }], removed: [] } });
});

test('a listing that cannot be read in full, or dates that cannot be placed, remove nothing and say so', async (t) => {
  const f = await fixture(t);
  t.mock.method(console, 'error', () => undefined);
  for (const listing of [
    `${listingRow(digest('1'), '2026-10-01 22:55:05 +0000 UTC')}\n{"Repository": truncated`,
    [listingRow(digest('a'), 'yesterday'), listingRow(digest('1'), '2026-10-01 22:55:05 +0000 UTC')].join('\n'),
    listingRow(digest('1'), '2026-10-01 22:55:05 +0000 UTC'),
  ]) {
    f.listing(listing);
    assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: false }),
      { status: 503, json: { error: 'image_listing_unreadable' } });
  }
  assert.equal(f.events.some((event) => event.startsWith('image-rm')), false);
});

/** A backup cut short in `phase`, as an updater that died there leaves it. */
async function cutShort(f: Awaited<ReturnType<typeof fixture>>, phase: 'quiescing' | 'backing_up' | 'restarting'): Promise<string> {
  const id = randomUUID();
  await f.state.createBackup({ id, kind: 'database' });
  if (phase !== 'quiescing') await f.state.transitionBackup(id, 'backing_up');
  if (phase === 'restarting') await f.state.transitionBackup(id, 'restarting');
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
  return id;
}

/**
 * A state directory that takes no new file once a backup reaches one of `phases`, as on a full
 * disk: backup-job.json cannot be written, while status.json, elsewhere, still can. `once` gives
 * the directory back after that one write.
 */
function failEndingWrites(f: Awaited<ReturnType<typeof fixture>>, phases = ['succeeded', 'failed'], once = false): void {
  const transition = f.state.transitionBackup.bind(f.state);
  f.state.transitionBackup = async (id, phase, patch) => {
    if (!phases.includes(phase)) return transition(id, phase, patch);
    await chmod(f.config.stateDirectory, 0o500);
    try {
      return await transition(id, phase, patch);
    } finally {
      if (once) await chmod(f.config.stateDirectory, 0o700);
    }
  };
}

for (const phase of ['backing_up', 'restarting'] as const) {
  test(`on boot, a backup cut short in ${phase} with the app down starts it again and ends failed`, async (t) => {
    const f = await fixture(t);
    const before = await readStatusFile(f.config.statusPath);
    const id = await cutShort(f, phase);
    f.appDown();

    const record = await reconcileBackup({ config: f.config, state: f.state, dependencies: f.dependencies });
    assert.equal(record?.phase, 'failed');
    assert.equal(record?.errorCode, 'backup_failed');
    assert.deepEqual(f.events, [`rm:tomecms-update-${id}-backup`, 'stop', 'up', 'health']);
    assert.equal(f.isAppRunning(), true);
    assert.deepEqual(await readStatusFile(f.config.statusPath), before);
    // Nothing to do on the next boot.
    assert.deepEqual(await reconcileBackup({ config: f.config, state: f.state, dependencies: f.dependencies }), record);
    assert.equal(f.events.length, 4);
  });
}

test('on boot, a backup cut short before its stop leaves the running, ready app alone', async (t) => {
  const f = await fixture(t);
  const before = await readStatusFile(f.config.statusPath);
  const id = await cutShort(f, 'quiescing');
  const record = await reconcileBackup({ config: f.config, state: f.state, dependencies: f.dependencies });
  assert.equal(record?.phase, 'failed');
  assert.deepEqual(f.events, [`rm:tomecms-update-${id}-backup`, 'health'], 'probed, never stopped or started');
  assert.deepEqual(await readStatusFile(f.config.statusPath), before);
});

test('on boot, an app running another image is not recreated, as a backup preflight would not', async (t) => {
  const f = await fixture(t);
  await cutShort(f, 'backing_up');
  f.running(digest('d'));
  const record = await reconcileBackup({ config: f.config, state: f.state, dependencies: f.dependencies });
  assert.equal(record?.phase, 'failed');
  assert.equal(f.events.some((event) => event === 'stop' || event === 'up'), false);
});

test('on boot, a backup record that cannot be ended is journalled, the updater comes up and the healthy app is left alone', async (t) => {
  const f = await fixture(t);
  await cutShort(f, 'backing_up');
  failEndingWrites(f);
  const errors: string[] = [];
  t.mock.method(console, 'error', (message: unknown) => { errors.push(String(message)); });

  assert.equal(await reconcileBackup({ config: f.config, state: f.state, dependencies: f.dependencies }), null);
  assert.equal(f.events.some((event) => event === 'stop' || event === 'up'), false);
  assert.deepEqual(errors.map((line) => JSON.parse(line).event), ['updater_backup_reconcile_failed']);
  // Still active on disk: the marker tells the truth, and other jobs stay refused.
  assert.equal((await f.state.readBackup())?.phase, 'backing_up');
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/apply', { version: '1.11.0', requestId: randomUUID() }),
    { status: 409, json: { error: 'update_in_progress' } });
  assert.equal((await unixRequest(f.socketPath, 'GET', '/v1/status')).status, 200);
});

test('a backup whose last record write fails starts the app once, keeps refusing jobs and lets go of the lock', async (t) => {
  const f = await fixture(t);
  failEndingWrites(f);
  const errors: string[] = [];
  t.mock.method(console, 'error', (message: unknown) => { errors.push(String(message)); });
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  for (let attempt = 0; !errors.includes('Updater backup state could not be persisted'); attempt++) {
    assert.ok(attempt < 400, 'the server journals the record it cannot write');
    await pause();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(f.events, ['drain', 'stop', 'backup', 'stop', 'up', 'health'], 'started once, never bounced again');
  assert.equal(f.isAppRunning(), true);
  assert.equal((await f.state.readBackup())?.phase, 'restarting');
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), true, 'the marker still tells the truth');
  // The server's lock is free; the record on disk is what refuses.
  for (const [path, body] of [['/v1/backup', backupBody()], ['/v1/apply', { version: '1.11.0', requestId: randomUUID() }]] as const) {
    assert.deepEqual(await unixRequest(f.socketPath, 'POST', path, body), { status: 409, json: { error: 'update_in_progress' } }, path);
  }
  assert.equal(f.events.length, 6);
});

test('a restarting write that fails still starts the app, and the server ends the backup failed', async (t) => {
  const f = await fixture(t);
  failEndingWrites(f, ['restarting'], true);
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  const record = await follow(f.socketPath, f.config.statusPath);
  // backing_up to succeeded is refused as a transition; the server's recovery ends it failed instead.
  assert.equal(record.phase, 'failed');
  assert.equal(record.errorCode, 'backup_failed');
  assert.deepEqual(f.events.slice(-3), ['stop', 'up', 'health']);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
  f.listing(listingRow(digest('a'), '2026-10-02 05:59:08 +0000 UTC'));
  assert.deepEqual(await onceUnlocked(() => unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: true })),
    { status: 200, json: { candidates: [], removed: [] } }, 'the lock is free');
});

test('a stop that fails still ends with the app started and the backup failed', async (t) => {
  const f = await fixture(t);
  f.fail('stop');
  t.mock.method(console, 'error', () => undefined);
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
  const record = await follow(f.socketPath, f.config.statusPath);
  assert.equal(record.phase, 'failed');
  assert.equal(record.errorCode, 'backup_failed');
  assert.deepEqual(f.events, ['drain', 'stop', 'stop', 'up', 'health']);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
});

test('a backup whose size cannot be read is kept, with its size unknown', async (t) => {
  const f = await fixture(t);
  const locked = join(f.backupDirectory, 'locked');
  await mkdir(locked);
  await chmod(locked, 0o000);
  try {
    assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody())).status, 202);
    const record = await follow(f.socketPath, f.config.statusPath);
    assert.equal(record.phase, 'succeeded');
    assert.equal(record.backupDirectory, f.backupDirectory);
    assert.equal(record.sizeBytes, null);
  } finally {
    await chmod(locked, 0o700);
  }
});

test('a backup is refused, with nothing stopped, when the backup disk is below the minimum', async (t) => {
  const f = await fixture(t);
  f.diskFree(0);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/backup', backupBody()),
    { status: 409, json: { error: 'insufficient_disk_space' } });
  assert.deepEqual(f.events, []);
  assert.equal((await unixRequest(f.socketPath, 'GET', '/v1/backup')).status, 404);
  assert.equal(await isUpdateWriteBlocked(f.config.statusPath), false);
  f.listing(listingRow(digest('a'), '2026-10-02 05:59:08 +0000 UTC'));
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/prune', { dryRun: true }),
    { status: 200, json: { candidates: [], removed: [] } }, 'the lock was let go');
});

test('a request sent again is answered from its backup and starts nothing', async (t) => {
  const f = await fixture(t);
  const release = f.hold();
  t.after(release);
  const body = backupBody();
  assert.equal((await unixRequest(f.socketPath, 'POST', '/v1/backup', body)).status, 202);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/backup', body),
    { status: 202, json: { id: body.requestId, phase: 'quiescing' } });
  release();
  const record = await follow(f.socketPath, f.config.statusPath);
  assert.deepEqual(await unixRequest(f.socketPath, 'POST', '/v1/backup', body), { status: 200, json: record });
  assert.equal(f.events.filter((event) => event === 'backup').length, 1);
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
