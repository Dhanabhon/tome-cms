import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { tome } from '../../src/cli/main.js';
import { UpdaterUnreachableError } from '../../src/cli/socket.js';
import type { CommandResult } from '../../src/updater/process.js';
import { backupRecord, fakeContext, statusAnswer, updateJob } from '../helpers/cli-context.js';

// Times are shown in the server's local time; the test fixes which one that is.
process.env.TZ = 'Asia/Bangkok';

const composePs = [
  { Service: 'app', State: 'running', Health: 'healthy' },
  { Service: 'postgres', State: 'running', Health: 'healthy' },
  { Service: 'seaweedfs', State: 'exited', Health: '' },
].map((row) => JSON.stringify(row)).join('\n');

function manifest(createdAt: string, databaseOnly: boolean) {
  return JSON.stringify({
    format: 'tomecms-backup', version: 1, createdAt, applicationVersion: '1.10.1',
    config: { publicUrl: 'https://cms.example.com', database: 'tomecms', s3Endpoint: 'https://media.example.com', bucket: 'media' },
    database: { file: 'database.dump', sha256: '0'.repeat(64) },
    records: { siteSettings: 1, posts: 2, pages: 1, mediaItems: 0 },
    objects: [], ...databaseOnly ? { scope: 'database' } : {},
  });
}

/** A backup directory with an older full backup, a newer database one, and a newest one still being written. */
async function backups(t: TestContext): Promise<{ root: string; newest: string }> {
  const root = await mkdtemp(join(tmpdir(), 'tome-cli-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries: Array<[string, string | null, number, Date]> = [
    ['tomecms-20261001T100000000Z', manifest('2026-10-01T10:00:00.000Z', false), 4096, new Date('2026-10-01T10:05:00.000Z')],
    ['tomecms-20261002T100000000Z', manifest('2026-10-02T10:00:00.000Z', true), 1.5 * 1024 ** 2, new Date('2026-10-02T10:01:00.000Z')],
    ['tomecms-20261002T115900000Z', null, 10, new Date('2026-10-02T11:59:00.000Z')],
  ];
  for (const [name, text, size, time] of entries) {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(join(directory, 'database.dump'), Buffer.alloc(size));
    if (text) await writeFile(join(directory, 'manifest.json'), text);
    await utimes(directory, time, time);
  }
  return { root, newest: join(root, 'tomecms-20261002T100000000Z') };
}

function healthy(root: string, routes: NonNullable<Parameters<typeof fakeContext>[0]>['routes'] = {}) {
  const commands: string[][] = [];
  const fetched: string[] = [];
  return {
    commands, fetched,
    ...fakeContext({
      config: { backupDirectory: root },
      routes: {
        'GET /v1/status': [statusAnswer(updateJob('succeeded'))],
        'GET /v1/backup': [{ status: 200, body: backupRecord('succeeded') }],
        ...routes,
      },
      overrides: {
        runCommand: async (executable, args): Promise<CommandResult> => {
          commands.push([executable, ...args]);
          return { code: 0, stdout: composePs, stderr: '' };
        },
        fetch: async (url) => {
          fetched.push(String(url));
          return Response.json({ status: 'ready', checks: { database: 'ready', migrations: 'ready', storage: 'ready' } });
        },
      },
    }),
  };
}

test('status shows the versions, the site, the containers, the disk, the last update and the newest backup', async (t) => {
  const { root, newest } = await backups(t);
  const f = healthy(root);
  assert.equal(await tome(['status'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  const out = f.out();
  assert.match(out, /^TomeCMS 1\.10\.1, updater 1\.5\.0$/m);
  assert.match(out, /^Site: ready \(migrations: ready\)$/m);
  assert.match(out, /^ {2}app +running, healthy$/m);
  assert.match(out, /^ {2}postgres +running, healthy$/m);
  assert.match(out, /^ {2}seaweedfs +exited$/m);
  assert.match(out, new RegExp(`^Free disk where backups go: 10\\.0 GiB \\(${root}\\)$`, 'm'));
  assert.match(out, /^Last update: 1\.11\.0 succeeded, finished 2026-10-02 18:05$/m);
  assert.match(out, new RegExp(`^Newest backup: database, 1\\.5 MiB, 2 hours ago \\(${newest}\\)$`, 'm'));
  assert.doesNotMatch(out + f.err(), /Warning/);
  assert.deepEqual(f.commands, [['docker', 'compose', '-p', 'tomecms', '-f', '/opt/tome-cms/compose.managed.yaml',
    '--env-file', '/etc/tome-cms/tome-cms.env', '--env-file', '/var/lib/tome-cms/updater/image.env', 'ps', '--all', '--format', 'json']]);
  assert.deepEqual(f.fetched, ['http://127.0.0.1:4321/health/ready']);
});

test('status --json prints the same as one object, for scripts', async (t) => {
  const { root, newest } = await backups(t);
  const f = healthy(root);
  assert.equal(await tome(['status', '--json'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  assert.equal(f.printed.length, 1);
  const report = JSON.parse(f.printed[0]!);
  assert.deepEqual(report, {
    versions: { app: '1.10.1', updater: '1.5.0' },
    updaterError: null,
    site: { ready: true, status: 'ready', migrations: 'ready' },
    containers: [
      { service: 'app', state: 'running', health: 'healthy' },
      { service: 'postgres', state: 'running', health: 'healthy' },
      { service: 'seaweedfs', state: 'exited', health: null },
    ],
    disk: { path: root, freeBytes: 10 * 1024 ** 3, minimumFreeBytes: 5 * 1024 ** 3, low: false },
    lastUpdate: { version: '1.11.0', phase: 'succeeded', errorCode: null, finishedAt: '2026-10-02T11:05:00.000Z' },
    newestBackup: { path: newest, kind: 'database', sizeBytes: 1.5 * 1024 ** 2 + Buffer.byteLength(manifest('2026-10-02T10:00:00.000Z', true)), createdAt: '2026-10-02T10:00:00.000Z' },
    runningBackup: null,
  });
});

test('status warns below the disk minimum and names tome prune, and still shows a site that is not ready', async (t) => {
  const { root } = await backups(t);
  const f = healthy(root);
  f.context.statfs = async () => ({ bsize: 4096, bavail: (3 * 1024 ** 3) / 4096 });
  f.context.fetch = async () => Response.json({ status: 'not-ready', checks: { database: 'ready', migrations: 'pending', storage: 'ready' } }, { status: 503 });
  f.context.runCommand = async () => ({ code: 0, stdout: JSON.stringify([{ Service: 'postgres', State: 'running', Health: 'healthy' }]), stderr: '' });
  assert.equal(await tome(['status'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  const out = f.out();
  assert.match(out, /^Site: not-ready \(migrations: pending\)$/m);
  assert.match(out, /^ {2}app +missing$/m, 'a listed array (older Compose) is read too');
  assert.match(out, /^Warning: only 3\.0 GiB free where backups go; updates and backups need 5\.0 GiB\..*sudo tome prune/m);
});

test('status flags a backup stuck with no job running, and says to free space and restart the updater', async (t) => {
  const { root } = await backups(t);
  // The record says it runs, and the updater's read-only /v1/busy says nothing holds the lock.
  const f = healthy(root, {
    'GET /v1/backup': [{ status: 200, body: backupRecord('restarting') }],
    'GET /v1/busy': [{ status: 200, body: { busy: false } }],
  });
  assert.equal(await tome(['status'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  assert.match(f.out(), /^Warning: a backup is stuck at "restarting" with no job running.*free some space.*sudo systemctl restart tomecms-updater/im);
  assert.deepEqual(f.calls.filter((call) => call.method === 'POST'), [], 'status sends nothing that could start a job');
});

test('an updater too old for /v1/busy never makes a backup read as stuck', async (t) => {
  const { root } = await backups(t);
  const f = healthy(root, {
    'GET /v1/backup': [{ status: 200, body: backupRecord('backing_up') }],
    'GET /v1/busy': [{ status: 404, body: { error: 'not_found' } }],
  });
  assert.equal(await tome(['status'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  assert.match(f.out(), /^Backup running: database, at "backing_up"/m);
});

test('status shows a backup that is running as running, not stuck', async (t) => {
  const { root } = await backups(t);
  const f = healthy(root, {
    'GET /v1/backup': [{ status: 200, body: backupRecord('backing_up') }],
    'GET /v1/busy': [{ status: 200, body: { busy: true } }],
  });
  f.context.fetch = async () => new Response(null, { status: 503 });
  assert.equal(await tome(['status', '--json'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  const report = JSON.parse(f.printed[0]!);
  assert.deepEqual(report.runningBackup, { id: backupRecord('backing_up').id, kind: 'database', phase: 'backing_up', startedAt: '2026-10-02T11:00:00.000Z', stuck: false });
  assert.deepEqual(report.site, { ready: false, status: 'not-ready', migrations: null });
});

test('status without an answering updater still shows the rest, and fails', async (t) => {
  const { root } = await backups(t);
  const f = healthy(root, { 'GET /v1/status': [new UpdaterUnreachableError()], 'GET /v1/backup': [new UpdaterUnreachableError()] });
  f.context.fetch = async () => { throw new TypeError('fetch failed'); };
  f.context.runCommand = async () => ({ code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' });
  assert.equal(await tome(['status'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 1);
  const out = f.out();
  assert.match(out, /^Updater: did not answer at \/run\/tome-cms\/updater\.sock/m);
  assert.match(out, /^Free disk where backups go: /m);
  assert.match(out, /^Site: unreachable$/m);
  assert.match(out, /^Containers: could not be listed/m);
  assert.match(out, /^Newest backup: database/m);
  assert.doesNotMatch(out, /Docker daemon/, 'command output is not passed through');
});

test('status with no backups yet says so', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tome-cli-status-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = healthy(root, { 'GET /v1/status': [statusAnswer(null)], 'GET /v1/backup': [{ status: 404, body: { error: 'not_found' } }] });
  assert.equal(await tome(['status'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  assert.match(f.out(), /^Last update: none$/m);
  assert.match(f.out(), /^Newest backup: none$/m);
});

test('an updater that answers with an error is one line, and the rest of the screen still shows', async (t) => {
  const { root } = await backups(t);
  const f = healthy(root, { 'GET /v1/status': [{ status: 500, body: { error: 'updater_unavailable' } }] });
  assert.equal(await tome(['status'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 1);
  const out = f.out();
  assert.match(out, /^Updater: it answered \/v1\/status with 500 \(updater_unavailable\)\. Check it with: sudo tome logs updater$/m);
  assert.match(out, /^Containers:$/m);
  assert.match(out, /^Free disk where backups go: 10\.0 GiB/m);
  assert.match(out, /^Newest backup: database/m);
  assert.equal(f.err(), '');
});

test('the newest backup is the one its manifest says was made last, and an unsafe manifest is passed over', async (t) => {
  const { root, newest } = await backups(t);
  // An older backup touched later is still older.
  const older = join(root, 'tomecms-20261001T100000000Z');
  await utimes(older, new Date('2026-10-02T11:30:00.000Z'), new Date('2026-10-02T11:30:00.000Z'));
  // A backup whose manifest is a link is never read, however new it claims to be.
  const linked = join(root, 'tomecms-20261002T113000000Z');
  await mkdir(linked);
  await writeFile(join(root, 'elsewhere.json'), manifest('2026-10-02T11:30:00.000Z', false));
  await symlink(join(root, 'elsewhere.json'), join(linked, 'manifest.json'));
  const f = healthy(root);
  assert.equal(await tome(['status', '--json'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  assert.equal(JSON.parse(f.printed[0]!).newestBackup.path, newest);
});

test('a directory not named as a backup is passed over, so its name never reaches the terminal', async (t) => {
  const { root, newest } = await backups(t);
  // Planted by the app's container, newer than any backup, with an escape sequence in its name.
  for (const name of ['tomecms-20261002T113000000Z\u001b]0;owned\u0007', 'not-a-backup']) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'manifest.json'), manifest('2026-10-02T11:30:00.000Z', false));
  }
  const f = healthy(root);
  assert.equal(await tome(['status', '--json'], { uid: 0, load: async () => f.context, print: f.context.print, warn: f.context.warn }), 0);
  assert.equal(JSON.parse(f.printed[0]!).newestBackup.path, newest);
});
