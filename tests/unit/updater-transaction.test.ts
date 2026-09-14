import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { OFFICIAL_IMAGE_REPOSITORY, type UpdateManifest } from '../../src/update/contracts.js';
import type { UpdaterConfig } from '../../src/updater/config.js';
import { createUpdaterServer, removeStaleUpdaterSocket } from '../../src/updater/server.js';
import { createUpdaterStateStore, toPublicUpdateJob, type InstalledState } from '../../src/updater/state.js';
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
    projectName: 'tomecms',
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
  const databaseBytes = Buffer.from('postgres custom-format backup fixture');
  const objectBytes = Buffer.from('image backup fixture');
  const objectKey = 'owners/123e4567-e89b-42d3-a456-426614174000/2026/09/123e4567-e89b-42d3-a456-426614174001.webp';
  await writeFile(join(backup, 'database.dump'), databaseBytes);
  const objectPath = join(backup, 'objects', ...objectKey.split('/'));
  await mkdir(dirname(objectPath), { recursive: true });
  await writeFile(objectPath, objectBytes);
  const backupManifest = {
    format: 'tomecms-backup', version: 1, applicationVersion: previous.version,
    createdAt: '2026-09-20T10:01:00.000Z',
    config: {
      publicUrl: 'https://example.com', database: 'tomecms',
      s3Endpoint: 'http://seaweedfs:8333', bucket: 'blog-media',
    },
    database: { file: 'database.dump', sha256: createHash('sha256').update(databaseBytes).digest('hex') },
    records: { siteSettings: 1, posts: 2, pages: 3, mediaItems: 1 },
    objects: [{
      key: objectKey, contentType: 'image/webp', sizeBytes: objectBytes.byteLength,
      sha256: createHash('sha256').update(objectBytes).digest('hex'),
    }],
  };
  const manifestBytes = JSON.stringify(backupManifest);
  await writeFile(join(backup, 'manifest.json'), manifestBytes);
  const report = { backupDirectory: '/backups/backup-1', manifestSha256: createHash('sha256').update(manifestBytes).digest('hex') };
  const manifest = {
    version: '1.0.1', image: { digest: targetDigest },
    compatibility: { targetMigration: '999_future_migration', rollbackSafeFrom: '1.0.0' },
  } as UpdateManifest;
  let failure = '';
  let readiness = true;
  let runningDigest = previous.imageDigest;
  let runningContainerIds = `${'c'.repeat(64)}\n`;
  let inspectionOutput: string | undefined;
  let migrationOutput = JSON.stringify(['001_system', '999_future_migration']);
  let backupOutput = JSON.stringify(report);
  let interrupted = '';
  let rejectInterrupted = false;
  let cleanupFails = false;
  let successfulLeftover = '';
  const containers = new Set<string>();
  const lifecycle: string[] = [];
  const commands: Array<{ args: readonly string[]; timeoutMs: number }> = [];
  const dependencies: UpdateDependencies = {
    runPreflight: async () => { events.push('preflight'); },
    verifyTargetRelease: async () => {
      events.push('verify');
      if (failure === 'verify') throw new Error('private failure');
      return { manifest, imageReference: targetImage };
    },
    runCommand: async (executable, args, options) => {
      assert.equal(executable, 'docker');
      commands.push({ args, timeoutMs: options.timeoutMs });
      if (args[0] === 'ps') {
        const filter = args[args.indexOf('--filter') + 1];
        const name = filter.slice('name=^/'.length, -1);
        lifecycle.push(`check:${name}`);
        return { code: 0, stdout: containers.has(name) ? `${name}\n` : '', stderr: '' };
      }
      if (args[0] === 'rm') {
        const name = args.at(-1)!;
        lifecycle.push(`remove:${name}`);
        if (!cleanupFails) containers.delete(name);
        return { code: cleanupFails ? 1 : 0, stdout: '', stderr: '' };
      }
      let event: string;
      let stdout = '';
      if (args[0] === 'pull') event = 'pull';
      else if (args[0] === 'run') { event = 'migrations'; stdout = migrationOutput; }
      else if (args[0] === 'inspect') {
        event = 'inspect'; stdout = inspectionOutput ?? JSON.stringify([{ Config: { Image: `${OFFICIAL_IMAGE_REPOSITORY}@${runningDigest}` }, State: { Running: true } }]);
      } else if (args.includes('ps')) { event = 'ps'; stdout = runningContainerIds; }
      else if (args.includes('stop')) event = 'stop';
      else if (args.includes('backup')) {
        event = 'backup'; stdout = backupOutput;
        assert.equal(await readFile(config.imageEnvironmentFile, 'utf8'), imageEnv(previous.imageDigest));
      } else if (args.includes('db:migrate')) event = 'migrate';
      else if (args.includes('up')) {
        assert.equal(containers.size, 0, 'must prove all one-shot containers absent before starting app');
        const selected = await readFile(config.imageEnvironmentFile, 'utf8');
        event = selected === imageEnv(targetDigest) ? 'start-target' : 'start-previous';
      } else throw new Error(`Unexpected command ${args.join(' ')}`);
      events.push(event);
      if (event === interrupted || event === successfulLeftover) {
        const name = args[args.indexOf('--name') + 1];
        assert.match(name, /^tomecms-update-[0-9a-f-]{36}-(backup|migration|inventory)$/);
        containers.add(name);
        if (event === interrupted) {
          if (rejectInterrupted) throw new Error('CLI interrupted');
          return { code: 124, stdout: '', stderr: 'CLI timeout' };
        }
      }
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
  return { input, root, state, events, commands, backup, backupManifest, report, manifest, containers, lifecycle,
    interrupt: (stage: string, reject = false) => { interrupted = stage; rejectInterrupted = reject; },
    failCleanup: () => { cleanupFails = true; },
    leaveOnSuccess: (stage: string) => { successfulLeftover = stage; },
    fail: (value: string) => { failure = value; }, unready: () => { readiness = false; },
    running: (digest: string) => { runningDigest = digest; },
    runningContainers: (value: string) => { runningContainerIds = value; },
    inspection: (value: string) => { inspectionOutput = value; },
    migrations: (value: string) => { migrationOutput = value; },
    backupOutput: (value: string) => { backupOutput = value; },
    writeBackupManifest: async (value: unknown) => {
      const bytes = JSON.stringify(value);
      await writeFile(join(backup, 'manifest.json'), bytes);
      backupOutput = JSON.stringify({ ...report,
        manifestSha256: createHash('sha256').update(bytes).digest('hex') });
    },
  };
}

test('orders backup, migration, readiness and installed commit; retains backup and fixes argv/timeouts', async (t) => {
  const f = await fixture(t);
  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'succeeded');
  assert.deepEqual(f.events, ['state:preflight', 'ps', 'inspect', 'state:verifying', 'verify', 'state:downloading',
    'pull', 'migrations', 'state:quiescing', 'drain:2000', 'stop', 'state:backing_up', 'backup',
    'state:migrating', 'migrate', 'state:restarting', 'start-target', 'state:health_check',
    'health-target', 'installed:1.0.1', 'state:succeeded']);
  assert.equal((await f.state.readInstalled()).imageDigest, targetDigest);
  assert.equal(job.backupDirectory, f.backup);
  assert.ok(await readFile(join(f.backup, 'manifest.json')));
  const prefix = ['compose', '-p', 'tomecms', '-f', f.input.config.composeFile,
    '--env-file', f.input.config.environmentFile, '--env-file', f.input.config.imageEnvironmentFile];
  assert.deepEqual(f.commands.slice(0, 2), [
    { args: [...prefix, 'ps', '--quiet', 'app'], timeoutMs: 30000 },
    { args: ['inspect', '--type', 'container', 'c'.repeat(64)], timeoutMs: 30000 },
  ]);
  const commands = f.commands.filter(({ args }) => args[0] !== 'ps' && args[0] !== 'rm' &&
    args[0] !== 'inspect' && !args.includes('ps'));
  assert.deepEqual(commands[0], { args: ['pull', targetImage], timeoutMs: 900000 });
  assert.ok(commands[1].args.includes(targetImage));
  assert.ok(commands[1].args.includes(`tomecms-update-${job.id}-inventory`));
  assert.ok(!commands[1].args.includes('sh'));
  assert.deepEqual(commands[2], { args: [...prefix, 'stop', '--timeout', '30', 'app'], timeoutMs: 30000 });
  assert.deepEqual(commands[3], { args: [...prefix, 'run', '--rm', '--name', `tomecms-update-${job.id}-backup`, '--no-deps', '--user', `${process.getuid!()}:${process.getgid!()}`,
    '--volume', `${f.input.config.backupDirectory}:/backups`, 'app', 'npm', 'run', '--silent', 'backup', '--', '--offline', '--direct', '--json', '--output-root', '/backups'], timeoutMs: 3600000 });
  assert.deepEqual(commands[4], { args: [...prefix, 'run', '--rm', '--name', `tomecms-update-${job.id}-migration`, '--no-deps', 'app', 'npm', 'run', 'db:migrate'], timeoutMs: 900000 });
  assert.deepEqual(commands[5], { args: [...prefix, 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'app'], timeoutMs: 90000 });
  assert.deepEqual(f.lifecycle, ['inventory', 'backup', 'migration'].map((kind) => `check:tomecms-update-${job.id}-${kind}`));
});

test('journals one bounded stage diagnostic while public update state stays enumerated', async (t) => {
  const f = await fixture(t);
  const secret = 'private:"value+/ with spaces?&=';
  const runtimeSecret = 'runtime-private-token-with-a-distinct-value';
  process.env.TOME_CMS_RUNTIME_SECRET = runtimeSecret;
  t.after(() => { delete process.env.TOME_CMS_RUNTIME_SECRET; });
  await writeFile(f.input.config.environmentFile, `TOME_CMS_INSTALL_TOKEN='${secret}'\n`);
  const forms = [secret, runtimeSecret].flatMap((value) => [value, encodeURIComponent(value), encodeURI(value),
    new URLSearchParams({ value }).toString().slice('value='.length),
    JSON.stringify(value).slice(1, -1), Buffer.from(value).toString('base64'),
    Buffer.from(value).toString('base64url')]);
  const run = f.input.dependencies.runCommand;
  f.input.dependencies.runCommand = async (executable, args, options) => {
    if (args.includes('db:migrate')) {
      return { code: 124, timedOut: true, signal: 'SIGKILL',
        stdout: `${forms.join('\n')}\n${'x'.repeat(16 * 1024)}`, stderr: forms.join('\n') };
    }
    return run(executable, args, options);
  };
  const messages: string[] = [];
  t.mock.method(console, 'error', (message: unknown) => { messages.push(String(message)); });

  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'rolled_back');
  assert.equal(messages.length, 1);
  const diagnostic = JSON.parse(messages[0]!) as Record<string, unknown>;
  assert.deepEqual({ event: diagnostic.event, jobId: diagnostic.jobId, targetVersion: diagnostic.targetVersion,
    executable: diagnostic.executable, stage: diagnostic.stage, exitCode: diagnostic.exitCode,
    timedOut: diagnostic.timedOut, signal: diagnostic.signal }, {
    event: 'updater_command_failed', jobId: job.id, targetVersion: '1.0.1', executable: 'docker',
    stage: 'migration.apply', exitCode: 124, timedOut: true, signal: 'SIGKILL',
  });
  assert.equal('args' in diagnostic, false);
  assert.ok(forms.every((form) => !messages[0]!.includes(form)));
  assert.ok(Buffer.byteLength(String(diagnostic.stdout)) <= 4 * 1024);
  assert.ok(Buffer.byteLength(String(diagnostic.stderr)) <= 4 * 1024);
  assert.ok(Buffer.byteLength(messages[0]!) < 16 * 1024);
  const publicJob = JSON.stringify(toPublicUpdateJob(job));
  assert.ok(forms.every((form) => !publicJob.includes(form)));
  assert.equal(publicJob.includes('stdout'), false);
  assert.equal(publicJob.includes('stderr'), false);
});

test('unsafe diagnostic secrets and logger errors cannot interrupt rollback', async (t) => {
  for (const loggerThrows of [false, true]) {
    const f = await fixture(t);
    f.fail('migrate');
    process.env.RUNTIME_API_KEY = 'short';
    t.after(() => { delete process.env.RUNTIME_API_KEY; });
    const messages: string[] = [];
    t.mock.method(console, 'error', (message: unknown) => {
      if (loggerThrows) throw new Error('journal unavailable');
      messages.push(String(message));
    });
    const job = await applyUpdate(f.input);
    assert.equal(job.phase, 'rolled_back');
    assert.ok(f.events.includes('start-previous'));
    if (!loggerThrows) {
      assert.equal(messages.length, 1);
      const entry = JSON.parse(messages[0]!);
      assert.match(entry.stdout, /omitted/i);
      assert.match(entry.stderr, /omitted/i);
    }
    t.mock.restoreAll();
  }
});

test('capture-capped diagnostics fail closed without interrupting rollback', async (t) => {
  const f = await fixture(t);
  const secret = 'boundary-secret-value-'.repeat(196).slice(0, 4 * 1024);
  const captured = Buffer.from(`${secret}\n`.repeat(9)).subarray(0, 32 * 1024).toString('utf8');
  assert.equal(Buffer.byteLength(captured), 32 * 1024);
  await writeFile(f.input.config.environmentFile, `TOME_CMS_INSTALL_TOKEN='${secret}'\n`);
  const run = f.input.dependencies.runCommand;
  f.input.dependencies.runCommand = async (executable, args, options) => {
    const result = await run(executable, args, options);
    return args.includes('db:migrate')
      ? { code: 1, stdout: captured, stderr: 'migration command failed' }
      : result;
  };
  const messages: string[] = [];
  t.mock.method(console, 'error', (message: unknown) => { messages.push(String(message)); });

  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'rolled_back');
  assert.ok(f.events.includes('start-previous'));
  assert.equal(messages.length, 1);
  const entry = JSON.parse(messages[0]!);
  assert.match(entry.stdout, /omitted/i);
  assert.match(entry.stderr, /omitted/i);
  assert.equal(messages[0]!.includes(secret.slice(0, 128)), false);
});

test('rejects interpolated managed secrets before running Docker', async (t) => {
  const f = await fixture(t);
  await writeFile(f.input.config.environmentFile, 'TOME_CMS_INSTALL_TOKEN=${RUNTIME_SECRET}\n');
  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'rolled_back');
  assert.equal(job.errorCode, 'preflight_failed');
  assert.deepEqual(f.commands, []);
});

test('uses the configured project identity for Compose and one-shot resources', async (t) => {
  const f = await fixture(t);
  const project = 'tomecms-test-abc123def456';
  Object.defineProperty(f.input.config, 'projectName', { value: project });
  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'succeeded');
  for (const { args } of f.commands.filter(({ args }) => args[0] === 'compose')) {
    assert.deepEqual(args.slice(0, 3), ['compose', '-p', project]);
  }
  for (const kind of ['inventory', 'backup', 'migration']) {
    assert.ok(f.lifecycle.includes(`check:${project}-update-${job.id}-${kind}`));
  }
});

for (const stage of ['migrations', 'backup', 'migrate']) {
  for (const reject of [false, true]) test(`${stage} CLI interruption cleans named container before releasing or restarting`, async (t) => {
    const f = await fixture(t); f.interrupt(stage, reject);
    const job = await applyUpdate(f.input);
    assert.equal(job.phase, 'rolled_back');
    assert.equal(f.containers.size, 0);
    const kind = stage === 'migrations' ? 'inventory' : stage === 'migrate' ? 'migration' : 'backup';
    assert.ok(f.lifecycle.includes(`remove:tomecms-update-${job.id}-${kind}`));
    if (stage === 'migrations') assert.equal(f.events.includes('stop'), false);
    else assert.ok(f.events.includes('start-previous'));
  });
  test(`${stage} cleanup failure requires manual recovery without restarting app`, async (t) => {
    const f = await fixture(t); f.interrupt(stage); f.failCleanup();
    const job = await applyUpdate(f.input);
    assert.equal(job.phase, 'failed_manual_recovery');
    assert.equal(f.containers.size, 1);
    assert.equal(f.events.includes('start-previous'), false);
    assert.equal(f.events.includes('state:rolled_back'), false);
    await assert.rejects(() => applyUpdate({ ...f.input, requestId: randomUUID() }), /manual recovery/i);
  });
}

test('successful CLI exit cannot pass while its one-shot container still exists', async (t) => {
  const f = await fixture(t); f.leaveOnSuccess('backup');
  assert.equal((await applyUpdate(f.input)).phase, 'rolled_back');
  assert.equal(f.containers.size, 0);
  assert.equal(f.events.includes('migrate'), false);
});

test('boot cleans interrupted job one-shots before readiness, or requires manual recovery', async (t) => {
  for (const failed of [false, true]) {
    const f = await fixture(t);
    const job = await f.state.createJob({ requestId: f.input.requestId, targetVersion: '1.0.1' });
    for (const kind of ['backup', 'migration', 'inventory']) f.containers.add(`tomecms-update-${job.id}-${kind}`);
    f.running(previous.imageDigest);
    if (failed) f.failCleanup();
    const result = await reconcileUpdate(f.input);
    assert.equal(result?.phase, failed ? 'failed_manual_recovery' : 'rolled_back');
    if (failed) assert.equal(f.events.includes('health-previous'), false);
    else assert.equal(f.containers.size, 0);
  }
});

test('repairs runtime mirror after durable succeeded commits, without rolling back installed target', async (t) => {
  const f = await fixture(t);
  const transition = f.state.transitionJob.bind(f.state);
  let injected = false;
  f.state.transitionJob = async (...args) => {
    if (args[1] !== 'succeeded') return transition(...args);
    const statusPath = f.input.config.statusPath;
    // Force only the runtime write to fail after the durable job rename succeeds.
    f.input.config.statusPath = join(f.input.config.environmentFile, 'not-a-directory');
    try { return await transition(...args); }
    finally { f.input.config.statusPath = statusPath; injected = true; }
  };
  const result = await applyUpdate(f.input);
  assert.ok(injected);
  assert.equal(result.phase, 'succeeded');
  assert.equal((await f.state.readInstalled()).imageDigest, targetDigest);
  assert.equal(JSON.parse(await readFile(f.input.config.statusPath, 'utf8')).job.phase, 'succeeded');
  assert.equal(f.events.includes('start-previous'), false);
  assert.equal(f.events.includes('state:rolling_back'), false);
  const commandCount = f.commands.length;
  await writeFile(f.input.config.statusPath, JSON.stringify({ job: { phase: 'health_check' } }));
  assert.equal((await reconcileUpdate(f.input))?.phase, 'succeeded');
  assert.equal(JSON.parse(await readFile(f.input.config.statusPath, 'utf8')).job.phase, 'succeeded');
  assert.equal(f.commands.length, commandCount);
});

test('failure to query one-shot absence blocks rollback even after successful removal', async (t) => {
  const f = await fixture(t); f.interrupt('migrate');
  const run = f.input.dependencies.runCommand;
  f.input.dependencies.runCommand = async (executable, args, options) => {
    if (args[0] === 'ps' && args.some((arg) => arg.endsWith('-migration$'))) {
      return { code: 1, stdout: '', stderr: 'daemon unavailable' };
    }
    return run(executable, args, options);
  };
  assert.equal((await applyUpdate(f.input)).phase, 'failed_manual_recovery');
  assert.equal(f.events.includes('start-previous'), false);
  assert.equal(f.containers.size, 0);
});

test('socket fallback repairs a terminal manual-recovery mirror write failure', async (t) => {
  const f = await fixture(t);
  const transition = f.state.transitionJob.bind(f.state);
  f.state.transitionJob = async (...args) => {
    if (args[1] !== 'failed_manual_recovery') return transition(...args);
    const statusPath = f.input.config.statusPath;
    f.input.config.statusPath = join(f.input.config.environmentFile, 'not-a-directory');
    try { return await transition(...args); }
    finally { f.input.config.statusPath = statusPath; }
  };
  let refreshed!: () => void;
  const repaired = new Promise<void>((resolve) => { refreshed = resolve; });
  const refresh = f.state.refreshStatus.bind(f.state);
  f.state.refreshStatus = async () => { const result = await refresh(); refreshed(); return result; };
  const server = createUpdaterServer({ state: f.state,
    apply: ({ version, requestId }) => f.state.createJob({ targetVersion: version, requestId }),
    execute: async () => { throw new Error('Transaction interrupted'); },
  });
  const socketPath = join(f.root, 'fallback.sock');
  server.listen(socketPath); await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const accepted = await new Promise<number>((resolve, reject) => {
    const req = request({ socketPath, path: '/v1/apply', method: 'POST' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject); req.end(JSON.stringify({ version: '1.0.1', requestId: randomUUID() }));
  });
  assert.equal(accepted, 202);
  await repaired;
  assert.equal((await f.state.readJob())?.phase, 'failed_manual_recovery');
  assert.equal(JSON.parse(await readFile(f.input.config.statusPath, 'utf8')).job.phase, 'failed_manual_recovery');
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

for (const change of ['missing database', 'database checksum', 'missing object', 'object size',
  'object checksum', 'object traversal', 'object symlink', 'missing records', 'malformed records',
  'duplicate object', 'unsafe object size', 'extra manifest field'] as const) {
  test(`rejects a recovery point with ${change} before image selection or migration`, async (t) => {
    const f = await fixture(t);
    const manifest = structuredClone(f.backupManifest);
    const objectPath = join(f.backup, 'objects', ...manifest.objects[0]!.key.split('/'));
    if (change === 'missing database') await rm(join(f.backup, 'database.dump'));
    if (change === 'database checksum') await writeFile(join(f.backup, 'database.dump'), 'corrupt');
    if (change === 'missing object') await rm(objectPath);
    if (change === 'object size') {
      manifest.objects[0]!.sizeBytes += 1;
      await f.writeBackupManifest(manifest);
    }
    if (change === 'object checksum') {
      manifest.objects[0]!.sha256 = '0'.repeat(64);
      await f.writeBackupManifest(manifest);
    }
    if (change === 'object traversal') {
      manifest.objects[0]!.key = '../escape.webp';
      await f.writeBackupManifest(manifest);
    }
    if (change === 'object symlink') {
      await rm(objectPath);
      await symlink(f.input.config.imageEnvironmentFile, objectPath);
    }
    if (change === 'missing records') await f.writeBackupManifest({ ...manifest, records: undefined });
    if (change === 'malformed records') {
      await f.writeBackupManifest({ ...manifest, records: { ...manifest.records, posts: -1 } });
    }
    if (change === 'duplicate object') {
      await f.writeBackupManifest({ ...manifest, objects: [...manifest.objects, manifest.objects[0]] });
    }
    if (change === 'unsafe object size') {
      manifest.objects[0]!.sizeBytes = Number.MAX_SAFE_INTEGER;
      await f.writeBackupManifest(manifest);
    }
    if (change === 'extra manifest field') await f.writeBackupManifest({ ...manifest, unexpected: true });

    const job = await applyUpdate(f.input);
    assert.equal(job.phase, 'rolled_back');
    assert.equal(job.backupDirectory, null);
    assert.equal(await readFile(f.input.config.imageEnvironmentFile, 'utf8'), imageEnv(previous.imageDigest));
    assert.equal(f.events.includes('migrate'), false);
    assert.equal(f.events.includes('start-target'), false);
  });
}

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

test('running image drift fails preflight before verification, backup, or quiescing', async (t) => {
  const f = await fixture(t);
  f.running(targetDigest);
  const job = await applyUpdate(f.input);
  assert.equal(job.phase, 'rolled_back');
  assert.equal(job.errorCode, 'preflight_failed');
  assert.equal(f.events.includes('verify'), false);
  assert.equal(f.events.includes('state:quiescing'), false);
  assert.equal(f.events.includes('stop'), false);
  assert.equal(f.events.includes('backup'), false);
  assert.deepEqual(f.commands.map(({ args }) => args[0] === 'compose' ? args.at(-3) : args[0]), ['ps', 'inspect']);
});

for (const scenario of [
  { name: 'missing container ID', ids: '' },
  { name: 'invalid container ID', ids: 'not-a-container-id\n' },
  { name: 'multiple container IDs', ids: `${'c'.repeat(64)}\n${'d'.repeat(64)}\n` },
  { name: 'malformed inspection JSON', inspection: '{' },
  { name: 'stopped container', inspection: JSON.stringify([{ Config: { Image: `${OFFICIAL_IMAGE_REPOSITORY}@${previous.imageDigest}` }, State: { Running: false } }]) },
] as const) {
  test(`rejects ${scenario.name} before update side effects`, async (t) => {
    const f = await fixture(t);
    if (typeof scenario.ids === 'string') f.runningContainers(scenario.ids);
    if (typeof scenario.inspection === 'string') f.inspection(scenario.inspection);
    const job = await applyUpdate(f.input);
    assert.equal(job.phase, 'rolled_back');
    assert.equal(job.errorCode, 'preflight_failed');
    assert.equal(f.events.includes('verify'), false);
    assert.equal(f.events.includes('state:quiescing'), false);
    assert.equal(f.events.includes('stop'), false);
    assert.equal(f.events.includes('backup'), false);
  });
}

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

test('boot rebuilds a missing runtime mirror and keeps manual recovery durable after cleanup', async (t) => {
  const f = await fixture(t);
  const job = await f.state.createJob({ requestId: randomUUID(), targetVersion: '1.0.1' });
  await f.state.transitionJob(job.id, 'failed_manual_recovery');
  f.containers.add(`tomecms-update-${job.id}-migration`);
  await rm(f.input.config.statusPath);
  assert.equal((await reconcileUpdate(f.input))?.phase, 'failed_manual_recovery');
  assert.equal(JSON.parse(await readFile(f.input.config.statusPath, 'utf8')).job.phase, 'failed_manual_recovery');
  assert.equal(f.containers.size, 0);
  assert.ok(f.commands.every(({ args }) => args[0] === 'ps' || args[0] === 'rm'));
  await assert.rejects(() => f.state.createJob({ requestId: randomUUID(), targetVersion: '1.0.2' }), /manual recovery/i);
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
