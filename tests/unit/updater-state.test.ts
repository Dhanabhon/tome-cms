import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { UpdaterConfig } from '../../src/updater/config.js';
import { createUpdaterStateStore, type InstalledState, type UpdatePhase } from '../../src/updater/state.js';
import { UPDATER_VERSION } from '../../src/updater/version.js';

const installed: InstalledState = {
  version: '1.0.0',
  imageDigest: `sha256:${'a'.repeat(64)}`,
  composeContract: 1,
  environmentContract: 1,
  updaterProtocol: 1,
  installedAt: '2026-09-20T10:00:00.000Z',
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-updater-state-'));
  const stateDirectory = join(root, 'state');
  const statusPath = join(root, 'run', 'status.json');
  const config = { stateDirectory, statusPath } as UpdaterConfig;
  return { root, stateDirectory, statusPath, store: createUpdaterStateStore(config) };
}

test('persists strict durable state and a sanitized public status atomically', async () => {
  const { stateDirectory, statusPath, store } = await fixture();
  await store.writeInstalled(installed);
  assert.deepEqual(await store.readInstalled(), installed);
  assert.equal((await stat(join(stateDirectory, 'installed.json'))).mode & 0o777, 0o600);

  const job = await store.createJob({ requestId: '2cb65d31-2210-4cee-ab70-df64178948de', targetVersion: '1.0.1' });
  assert.equal(job.phase, 'preflight');
  assert.equal(job.previousVersion, '1.0.0');
  assert.equal((await stat(join(stateDirectory, 'job.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(statusPath)).mode & 0o777, 0o640);

  const status = JSON.parse(await readFile(statusPath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(status), ['protocolVersion', 'updaterVersion', 'managed', 'installed', 'job']);
  assert.deepEqual(status.installed, { version: '1.0.0', imageDigest: installed.imageDigest });
  assert.ok(status.job && typeof status.job === 'object');
  for (const privateKey of ['requestId', 'previousImageDigest', 'targetImageDigest', 'backupDirectory']) {
    assert.equal(privateKey in (status.job as object), false);
  }

  await writeFile(join(stateDirectory, '.installed.json.interrupted'), '{', { mode: 0o600 });
  assert.deepEqual(await store.readInstalled(), installed);
});

test('enforces forward transitions, terminal immutability, and one active job', async () => {
  const { store } = await fixture();
  await store.writeInstalled(installed);
  const first = await store.createJob({ requestId: '2cb65d31-2210-4cee-ab70-df64178948de', targetVersion: '1.0.1' });
  await assert.rejects(() => store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.2' }), /active/i);
  await assert.rejects(() => store.transitionJob(first.id, 'downloading'), /transition/i);

  const phases: UpdatePhase[] = [
    'verifying', 'downloading', 'quiescing', 'backing_up', 'migrating',
    'restarting', 'health_check', 'succeeded',
  ];
  let current = first;
  for (const phase of phases) current = await store.transitionJob(first.id, phase);
  assert.equal(current.completedSteps, 8);
  assert.ok(current.finishedAt);
  await assert.rejects(() => store.transitionJob(first.id, 'rolling_back'), /terminal/i);

  const second = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.2' });
  const rollingBack = await store.transitionJob(second.id, 'rolling_back', {
    errorCode: 'health_failed', backupDirectory: '/var/backups/tome-cms/job-2',
  });
  assert.equal(rollingBack.phase, 'rolling_back');
  await assert.rejects(() => store.transitionJob(second.id, 'rolling_back'), /transition/i);
  const rolledBack = await store.transitionJob(second.id, 'rolled_back');
  assert.ok(rolledBack.finishedAt);
});

test('rejects malformed or extended installed and job records', async () => {
  const { stateDirectory, store } = await fixture();
  await store.writeInstalled(installed);
  await writeFile(join(stateDirectory, 'installed.json'), JSON.stringify({ ...installed, secret: 'nope' }));
  await assert.rejects(() => store.readInstalled(), /installed state/i);

  await store.writeInstalled(installed);
  await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  const jobPath = join(stateDirectory, 'job.json');
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  await writeFile(jobPath, JSON.stringify({ ...job, stdout: 'secret output' }));
  await assert.rejects(() => store.readJob(), /job state/i);
  await writeFile(jobPath, JSON.stringify({ ...job, message: 'raw child output' }));
  await assert.rejects(() => store.readJob(), /job state/i);
});

test('manual recovery blocks new durable jobs, including after reopening the store', async () => {
  const { stateDirectory, statusPath, store } = await fixture();
  await store.writeInstalled(installed);
  const job = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  await store.transitionJob(job.id, 'failed_manual_recovery');
  const reopened = createUpdaterStateStore({ stateDirectory, statusPath } as UpdaterConfig);
  await assert.rejects(() => reopened.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.2' }), /manual recovery/i);
});

test('records backup before image selection and permits explicit boot reconciliation without fake forward steps', async () => {
  const { store } = await fixture();
  await store.writeInstalled(installed);
  const job = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  const backup = { backupDirectory: '/var/backups/tome-cms/backup-1', backupCreatedAt: '2026-09-20T10:01:00.000Z', backupKind: 'full' as const };
  await assert.rejects(() => store.recordBackup(job.id, backup), /phase/i);
  for (const phase of ['verifying', 'downloading', 'quiescing', 'backing_up'] as const) await store.transitionJob(job.id, phase);
  await store.recordBackup(job.id, backup);
  assert.equal((await store.readJob())?.phase, 'backing_up');
  assert.equal((await store.readJob())?.backupDirectory, backup.backupDirectory);
  await store.reconcileJob(job.id, 'succeeded');
  assert.equal((await store.readJob())?.completedSteps, 8);
  await assert.rejects(() => store.reconcileJob(job.id, 'rolled_back'), /terminal/i);
});

test('refreshes runtime mirror from durable state without changing installed or terminal job files', async () => {
  const { store, stateDirectory, statusPath } = await fixture();
  await store.writeInstalled(installed);
  const job = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  await store.reconcileJob(job.id, 'succeeded');
  const installedPath = join(stateDirectory, 'installed.json');
  const jobPath = join(stateDirectory, 'job.json');
  const before = [await stat(installedPath), await stat(jobPath)];
  await writeFile(statusPath, JSON.stringify({ job: { phase: 'health_check' } }));
  assert.equal((await store.refreshStatus())?.phase, 'succeeded');
  assert.equal(JSON.parse(await readFile(statusPath, 'utf8')).job.phase, 'succeeded');
  const after = [await stat(installedPath), await stat(jobPath)];
  assert.deepEqual(after.map((value) => [value.ino, value.mtimeMs]), before.map((value) => [value.ino, value.mtimeMs]));
});

test('only a failure from before its backup can be cleared, and the job is kept aside', async () => {
  const { stateDirectory, statusPath, store } = await fixture();
  await store.writeInstalled(installed);
  await assert.rejects(() => store.clearUnstartedFailure(), /no update job/i);

  const running = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  await assert.rejects(() => store.clearUnstartedFailure(), /only a failed update/i);

  // Stopped before the backup: the database and the image are as they were, so it may go.
  await store.transitionJob(running.id, 'failed_manual_recovery');
  const cleared = await store.clearUnstartedFailure();
  assert.equal(cleared.id, running.id);
  assert.equal(await store.readJob(), null);
  assert.equal(JSON.parse(await readFile(join(stateDirectory, `job.json.cleared-${running.id}`), 'utf8')).id, running.id);
  assert.equal(JSON.parse(await readFile(statusPath, 'utf8')).job, null);
  await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
});

test('a failure after its backup is never cleared', async () => {
  const { store } = await fixture();
  await store.writeInstalled(installed);
  const job = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  for (const phase of ['verifying', 'downloading', 'quiescing', 'backing_up'] as UpdatePhase[]) await store.transitionJob(job.id, phase);
  await store.recordBackup(job.id, { backupDirectory: '/var/backups/tome-cms/b', backupCreatedAt: '2026-09-28T08:00:00.000Z', backupKind: 'full' });
  await store.transitionJob(job.id, 'failed_manual_recovery');
  await assert.rejects(() => store.clearUnstartedFailure(), /backup/i);
  assert.equal((await store.readJob())?.phase, 'failed_manual_recovery');
});

test('a job keeps when each phase began, and which kind of backup it made, apart from the public status', async () => {
  const { statusPath, store } = await fixture();
  await store.writeInstalled(installed);
  const job = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  for (const phase of ['verifying', 'downloading', 'quiescing', 'backing_up'] as const) await store.transitionJob(job.id, phase);
  await store.recordBackup(job.id, { backupDirectory: '/var/backups/tome-cms/b', backupCreatedAt: '2026-09-20T10:01:00.000Z', backupKind: 'database' });
  for (const phase of ['migrating', 'restarting', 'health_check', 'succeeded'] as const) await store.transitionJob(job.id, phase);
  const done = await store.readJob();
  assert.deepEqual(done?.timeline.map(({ phase }) => phase), [
    'preflight', 'verifying', 'downloading', 'quiescing', 'backing_up', 'migrating', 'restarting', 'health_check', 'succeeded',
  ]);
  assert.ok(done?.timeline.every(({ at }, index, all) => index === 0 || Date.parse(at) >= Date.parse(all[index - 1]!.at)));
  assert.equal(done?.backupKind, 'database');
  // The public status keeps its old shape: an app from before this release parses it strictly.
  const status = JSON.parse(await readFile(statusPath, 'utf8')) as { job: Record<string, unknown>; updaterVersion: string };
  assert.equal('timeline' in status.job, false);
  assert.equal('backupKind' in status.job, false);
  assert.equal(status.updaterVersion, UPDATER_VERSION);
});

test('a job written by an earlier updater is still read, and carries on from there', async () => {
  const { stateDirectory, store } = await fixture();
  await store.writeInstalled(installed);
  const job = await store.createJob({ requestId: crypto.randomUUID(), targetVersion: '1.0.1' });
  const jobPath = join(stateDirectory, 'job.json');
  const { timeline: _timeline, backupKind: _kind, ...legacy } = JSON.parse(await readFile(jobPath, 'utf8'));
  await writeFile(jobPath, JSON.stringify(legacy));
  const read = await store.readJob();
  assert.deepEqual(read?.timeline, [], 'no timeline was kept then');
  assert.equal(read?.backupKind, null);
  await store.transitionJob(job.id, 'verifying');
  assert.deepEqual((await store.readJob())?.timeline.map(({ phase }) => phase), ['verifying']);
  await writeFile(jobPath, JSON.stringify({ ...legacy, backupKind: 'everything' }));
  await assert.rejects(() => store.readJob(), /job state/i);
});
