import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { OFFICIAL_IMAGE_REPOSITORY, type UpdateManifest } from '../../src/update/contracts.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import { createUpdaterServer, removeStaleUpdaterSocket } from '../../src/updater/server.js';
import { createUpdaterStateStore, type InstalledState } from '../../src/updater/state.js';
import { applyUpdate, reconcileUpdate, type UpdateDependencies } from '../../src/updater/transaction.js';

const previous: InstalledState = {
  version: '1.0.0', imageDigest: `sha256:${'a'.repeat(64)}`, composeContract: 1,
  environmentContract: 1, updaterProtocol: 1, installedAt: '2026-09-20T10:00:00.000Z',
};
const targetDigest = `sha256:${'b'.repeat(64)}`;
const targetImage = `${OFFICIAL_IMAGE_REPOSITORY}@${targetDigest}`;
const imageEnv = (digest: string) => `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${digest}'\n`;

async function fixture(context: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-transaction-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    stateDirectory: join(root, 'state'), statusPath: join(root, 'status.json'),
    imageEnvironmentFile: join(root, 'image.env'), backupDirectory: join(root, 'backups'),
    composeFile: join(root, 'compose.yaml'), environmentFile: join(root, 'app.env'),
    appHealthUrl: 'http://127.0.0.1:4321/health/ready',
  } as UpdaterConfig;
  await mkdir(config.backupDirectory);
  await writeFile(config.composeFile, 'services: {}');
  await writeFile(config.environmentFile, '');
  await writeFile(config.imageEnvironmentFile, imageEnv(previous.imageDigest));
  const state = createUpdaterStateStore(config);
  await state.writeInstalled(previous);
  const events: string[] = [];
  const transition = state.transitionJob.bind(state);
  state.transitionJob = async (...args) => {
    const result = await transition(...args);
    if (result.phase === 'migrating') {
      assert.equal(await readFile(config.imageEnvironmentFile, 'utf8'), imageEnv(targetDigest));
      assert.equal(result.backupDirectory, backup);
    }
    events.push(`state:${result.phase}`);
    return result;
  };
  const create = state.createJob.bind(state);
  state.createJob = async (input) => { const job = await create(input); events.push('state:preflight'); return job; };
  const install = state.writeInstalled.bind(state);
  state.writeInstalled = async (value) => { events.push(`installed:${value.version}`); await install(value); };
  const backup = join(config.backupDirectory, 'backup-1');
  await mkdir(backup);
  const manifestBytes = JSON.stringify({ format: 'tomecms-backup', version: 1,
    applicationVersion: previous.version, createdAt: '2026-09-20T10:01:00.000Z' });
  await writeFile(join(backup, 'manifest.json'), manifestBytes);
  const report = { backupDirectory: '/backups/backup-1', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex') };
  const manifest = {
    version: '1.0.1', image: { digest: targetDigest },
    compatibility: { targetMigration: '999_future_migration', rollbackSafeFrom: '1.0.0' },
  } as UpdateManifest;
  let failure = '';
  let readiness = true;
  let runningDigest = targetDigest;
  let migrationOutput = JSON.stringify(['001_system', '999_future_migration']);
  let backupOutput = JSON.stringify(report);
  const commands: Array<{ args: readonly string[]; timeoutMs: number }> = [];
  const dependencies: UpdateDependencies = {
    runPreflight: async () => { events.push('preflight'); },
    verifyTargetRelease: async () => {
      events.push('verify');
      if (failure === 'verify') throw new Error('private failure');
      return { manifest, manifestPath: '/unused', imageReference: targetImage };
    },
    runCommand: async (executable, args, options) => {
      assert.equal(executable, 'docker');
      commands.push({ args, timeoutMs: options.timeoutMs });
      let event: string;
      let stdout = '';
      if (args[0] === 'pull') event = 'pull';
      else if (args[0] === 'run') { event = 'migrations'; stdout = migrationOutput; }
      else if (args[0] === 'inspect') {
        event = 'inspect'; stdout = JSON.stringify([{ Config: { Image: `${OFFICIAL_IMAGE_REPOSITORY}@${runningDigest}` }, State: { Running: true } }]);
      } else if (args.includes('ps')) { event = 'ps'; stdout = `${'c'.repeat(64)}\n`; }
      else if (args.includes('stop')) event = 'stop';
      else if (args.includes('backup')) {
        event = 'backup'; stdout = backupOutput;
        assert.equal(await readFile(config.imageEnvironmentFile, 'utf8'), imageEnv(previous.imageDigest));
      } else if (args.includes('db:migrate')) event = 'migrate';
      else if (args.includes('up')) {
        const selected = await readFile(config.imageEnvironmentFile, 'utf8');
        event = selected === imageEnv(targetDigest) ? 'start-target' : 'start-previous';
      } else throw new Error(`Unexpected command ${args.join(' ')}`);
      events.push(event);
      if (failure === event) return { code: 1, stdout: '', stderr: 'private failure' };
      return { code: 0, stdout, stderr: '' };
    },
    fetcher: async () => {
      const selected = await readFile(config.imageEnvironmentFile, 'utf8');
      const target = selected === imageEnv(targetDigest);
      events.push(target ? 'health-target' : 'health-previous');
      assert.equal((await state.readInstalled()).version, previous.version);
      return new Response('', { status: !readiness || (failure === 'health' && target) ? 503 : 200 });
    },
    sleep: async (ms) => {
      if (ms === 2000) {
        assert.equal(JSON.parse(await readFile(config.statusPath, 'utf8')).job.phase, 'quiescing');
        events.push('drain:2000');
      }
    },
    now: () => new Date('2026-09-20T10:02:00.000Z'),
  };
  const input = { version: '1.0.1', requestId: randomUUID(), updaterVersion: '1.0.0', config, state, dependencies };
  return { input, root, state, events, commands, backup, report, manifest,
    fail: (value: string) => { failure = value; }, unready: () => { readiness = false; },
    running: (digest: string) => { runningDigest = digest; },
    migrations: (value: string) => { migrationOutput = value; },
    backupOutput: (value: string) => { backupOutput = value; },
  };
}

test('orders backup, migration, readiness and installed commit; retains backup and fixes argv/timeouts', async (t) => {
  const f = await fixture(t);
  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'succeeded');
  assert.deepEqual(f.events, ['state:preflight', 'state:verifying', 'verify', 'state:downloading',
    'pull', 'migrations', 'state:quiescing', 'drain:2000', 'stop', 'state:backing_up', 'backup',
    'state:migrating', 'migrate', 'state:restarting', 'start-target', 'state:health_check',
    'health-target', 'installed:1.0.1', 'state:succeeded']);
  assert.equal((await f.state.readInstalled()).imageDigest, targetDigest);
  assert.equal(job.backupDirectory, f.backup);
  assert.ok(await readFile(join(f.backup, 'manifest.json')));
  const prefix = ['compose', '-p', 'tomecms', '-f', f.input.config.composeFile,
    '--env-file', f.input.config.environmentFile, '--env-file', f.input.config.imageEnvironmentFile];
  assert.deepEqual(f.commands[0], { args: ['pull', targetImage], timeoutMs: 900000 });
  assert.ok(f.commands[1].args.includes(targetImage));
  assert.ok(!f.commands[1].args.includes('sh'));
  assert.deepEqual(f.commands[2], { args: [...prefix, 'stop', '--timeout', '30', 'app'], timeoutMs: 30000 });
  assert.deepEqual(f.commands[3], { args: [...prefix, 'run', '--rm', '--no-deps', '--user', `${process.getuid!()}:${process.getgid!()}`,
    '--volume', `${f.input.config.backupDirectory}:/backups`, 'app', 'npm', 'run', '--silent', 'backup', '--', '--offline', '--direct', '--json', '--output-root', '/backups'], timeoutMs: 3600000 });
  assert.deepEqual(f.commands[4], { args: [...prefix, 'run', '--rm', '--no-deps', 'app', 'npm', 'run', 'db:migrate'], timeoutMs: 900000 });
  assert.deepEqual(f.commands[5], { args: [...prefix, 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'app'], timeoutMs: 90000 });
});

for (const failure of ['verify', 'pull', 'migrations']) test(`${failure} failure leaves app and installed image untouched`, async (t) => {
  const f = await fixture(t); f.fail(failure);
  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'rolled_back');
  assert.equal(f.events.includes('state:quiescing'), false);
  assert.equal(f.events.includes('stop'), false);
  assert.deepEqual(await f.state.readInstalled(), previous);
  assert.equal(await readFile(f.input.config.imageEnvironmentFile, 'utf8'), imageEnv(previous.imageDigest));
});

for (const output of ['[]', '["001_system"]', '["999_future_migration","999_future_migration"]', '["../escape"]', '{}', 'x'.repeat(32768)]) {
  test('rejects absent or malformed target migration inventory before maintenance', async (t) => {
    const f = await fixture(t); f.migrations(output);
    assert.equal((await applyUpdate(f.input)).phase, 'rolled_back');
    assert.equal(f.events.includes('state:quiescing'), false);
  });
}

test('backup failure restarts previous app without migrating', async (t) => {
  const f = await fixture(t); f.fail('backup');
  assert.equal((await applyUpdate(f.input)).phase, 'rolled_back');
  assert.ok(f.events.includes('start-previous'));
  assert.equal(f.events.includes('migrate'), false);
});

test('compatible post-migration health failure rolls back only the image', async (t) => {
  const f = await fixture(t); f.fail('health');
  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'rolled_back');
  assert.equal(f.events.filter((e) => e === 'migrate').length, 1);
  assert.ok(f.events.includes('health-previous'));
  assert.equal(job.backupDirectory, f.backup);
  assert.deepEqual(await f.state.readInstalled(), previous);
});

test('unsafe rollback and failed previous readiness require durable manual recovery', async (t) => {
  for (const unsafe of [true, false]) {
    const f = await fixture(t); f.fail('health');
    if (unsafe) f.manifest.compatibility.rollbackSafeFrom = '1.0.1';
    else f.unready();
    const job = await applyUpdate(f.input);
    assert.equal(job.phase, 'failed_manual_recovery');
    assert.equal(job.backupDirectory, f.backup);
    if (unsafe) assert.equal(f.events.includes('start-previous'), false);
    const fresh = createUpdaterStateStore(f.input.config);
    await assert.rejects(() => fresh.createJob({ requestId: randomUUID(), targetVersion: '1.0.2' }), /manual recovery/i);
    await assert.rejects(() => applyUpdate({ ...f.input, state: fresh }), /manual recovery/i);
  }
});

test('strict backup receipt, hash, path, regular manifest and app version precede image mutation', async (t) => {
  for (const change of ['extra', 'escape', 'hash', 'version', 'symlink', 'format']) {
    const f = await fixture(t);
    if (change === 'extra') f.backupOutput(JSON.stringify({ ...f.report, extra: true }));
    if (change === 'escape') f.backupOutput(JSON.stringify({ ...f.report, backupDirectory: '/backups/../escape' }));
    if (change === 'hash') f.backupOutput(JSON.stringify({ ...f.report, manifestSha256: '0'.repeat(64) }));
    if (change === 'symlink') {
      await rm(join(f.backup, 'manifest.json'));
      await symlink(f.input.config.imageEnvironmentFile, join(f.backup, 'manifest.json'));
    }
    if (change === 'version' || change === 'format') {
      const bytes = JSON.stringify({ format: change === 'format' ? 'other' : 'tomecms-backup', version: 1,
        applicationVersion: change === 'version' ? '9.0.0' : '1.0.0', createdAt: '2026-09-20T10:00:00.000Z' });
      await writeFile(join(f.backup, 'manifest.json'), bytes);
      f.backupOutput(JSON.stringify({ ...f.report, manifestSha256: createHash('sha256').update(bytes).digest('hex') }));
    }
    assert.equal((await applyUpdate(f.input)).phase, 'rolled_back', change);
    assert.equal(f.events.includes('migrate'), false, change);
  }
});

test('rejects lifecycle banner or surrounding output around the strict backup JSON', async (t) => {
  const f = await fixture(t);
  f.backupOutput(`\n> tome-cms@1.0.0 backup\n> node --env-file-if-exists=.env.local --import tsx scripts/backup.ts --offline --direct --json --output-root /backups\n\n${JSON.stringify(f.report)}\n`);
  assert.equal((await applyUpdate(f.input)).phase, 'rolled_back');
  assert.equal(f.events.includes('migrate'), false);
});

test('already installed target is idempotent with no commands or state changes', async (t) => {
  const f = await fixture(t);
  const result = await applyUpdate({ ...f.input, version: previous.version });
  assert.equal(result.phase, 'succeeded');
  assert.deepEqual(f.events, []);
  assert.equal(await f.state.readJob(), null);
});

test('root identity and mismatched local image fail before verification or Docker commands', async (t) => {
  const root = await fixture(t);
  t.mock.method(process as NodeJS.Process & { getuid: () => number }, 'getuid', () => 0);
  assert.equal((await applyUpdate(root.input)).phase, 'rolled_back');
  assert.deepEqual(root.commands, []);
  assert.equal(root.events.includes('verify'), false);
  t.mock.restoreAll();
  const mismatch = await fixture(t);
  await writeFile(mismatch.input.config.imageEnvironmentFile, imageEnv(targetDigest));
  assert.equal((await applyUpdate(mismatch.input)).phase, 'rolled_back');
  assert.deepEqual(mismatch.commands, []);
});

for (const stage of ['stop', 'migrate', 'start-target']) test(`${stage} failure performs compatible rollback without repeating migration`, async (t) => {
  const f = await fixture(t); f.fail(stage);
  const result = await applyUpdate(f.input);
  assert.equal(result.phase, 'rolled_back');
  assert.equal(f.events.filter((e) => e === 'migrate').length, stage === 'stop' ? 0 : 1);
  assert.ok(f.events.includes('start-previous'));
});

test('concurrent direct callers cannot adopt the same preflight reservation twice', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([applyUpdate(f.input), applyUpdate(f.input)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.events.filter((e) => e === 'migrate').length, 1);
});

test('boot rebuilds a missing runtime mirror and keeps manual recovery durable without commands', async (t) => {
  const f = await fixture(t);
  const job = await f.state.createJob({ requestId: randomUUID(), targetVersion: '1.0.1' });
  await f.state.transitionJob(job.id, 'failed_manual_recovery');
  await rm(f.input.config.statusPath);
  assert.equal((await reconcileUpdate(f.input))?.phase, 'failed_manual_recovery');
  assert.equal(JSON.parse(await readFile(f.input.config.statusPath, 'utf8')).job.phase, 'failed_manual_recovery');
  assert.deepEqual(f.commands, []);
});

test('socket cleanup refuses non-sockets and live listeners', async (t) => {
  const f = await fixture(t);
  const socketPath = join(f.root, 'updater.sock');
  await removeStaleUpdaterSocket(socketPath);
  await writeFile(socketPath, 'do not remove');
  await assert.rejects(() => removeStaleUpdaterSocket(socketPath), /socket/i);
  assert.equal(await readFile(socketPath, 'utf8'), 'do not remove');
  await rm(socketPath);
  const server = createUpdaterServer({ state: f.state, apply: () => applyUpdate(f.input) });
  server.listen(socketPath); await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await assert.rejects(() => removeStaleUpdaterSocket(socketPath), /listening/i);
});

test('socket cleanup removes a stale socket left by a crashed updater', async (t) => {
  const f = await fixture(t);
  const socketPath = join(f.root, 'crashed.sock');
  const child = spawn(process.execPath, ['-e',
    "require('node:net').createServer().listen(process.argv[1],()=>process.stdout.write('ready'))", socketPath],
  { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(async () => { child.kill('SIGKILL'); });
  await once(child.stdout!, 'data');
  child.kill('SIGKILL'); await once(child, 'exit');
  await removeStaleUpdaterSocket(socketPath);
  await assert.rejects(() => readFile(socketPath), { code: 'ENOENT' });
});

test('reconciles target and previous digests only when configured image and actual container agree and ready', async (t) => {
  for (const mode of ['target', 'previous', 'mismatch', 'unready']) {
    const f = await fixture(t);
    const job = await f.state.createJob({ requestId: f.input.requestId, targetVersion: '1.0.1' });
    await f.state.transitionJob(job.id, 'verifying', { targetImageDigest: targetDigest, backupDirectory: f.backup });
    if (mode !== 'previous') await writeFile(f.input.config.imageEnvironmentFile, imageEnv(targetDigest));
    f.running(mode === 'previous' || mode === 'mismatch' ? previous.imageDigest : targetDigest);
    if (mode === 'unready') f.unready();
    const result = await reconcileUpdate(f.input);
    assert.equal(result?.phase, mode === 'target' ? 'succeeded' : mode === 'previous' ? 'rolled_back' : 'failed_manual_recovery');
    assert.equal(result?.backupDirectory, f.backup);
    assert.equal((await f.state.readInstalled()).version, mode === 'target' ? '1.0.1' : '1.0.0');
    assert.equal(f.commands.some(({ args }) => args.includes('db:migrate')), false);
  }
});

test('socket reserves durable job, returns before execution ends, rejects concurrency and is idempotent', async (t) => {
  const f = await fixture(t);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let executions = 0;
  const server = createUpdaterServer({ state: f.state,
    apply: ({ version, requestId }) => f.state.createJob({ targetVersion: version, requestId }),
    execute: async () => { executions++; await pending; return (await f.state.readJob())!; },
  });
  const socketPath = join(f.root, 'updater.sock');
  server.listen(socketPath); await once(server, 'listening');
  t.after(async () => { finish(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const post = (version: string) => new Promise<number>((resolve, reject) => {
    const req = request({ socketPath, path: '/v1/apply', method: 'POST' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject); req.end(JSON.stringify({ version, requestId: randomUUID() }));
  });
  assert.equal(await post('1.0.0'), 200);
  assert.equal(executions, 0);
  assert.deepEqual((await Promise.all([post('1.0.1'), post('1.0.1')])).sort(), [202, 409]);
  assert.equal(executions, 1);
  const job = (await f.state.readJob())!;
  await f.state.transitionJob(job.id, 'failed_manual_recovery');
  finish(); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await post('1.0.2'), 409);
});
