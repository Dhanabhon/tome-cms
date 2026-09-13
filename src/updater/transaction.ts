import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

import { compareStableVersions, OFFICIAL_IMAGE_REPOSITORY, parseStableVersion } from '../update/contracts.js';
import type { UpdaterConfig } from './config.js';
import { runCommand } from './process.js';
import type { InstalledState, UpdateJob, UpdaterStateStore } from './state.js';
import { runPreflight, verifyTargetRelease, type VerifiedRelease } from './verify.js';

export interface UpdateDependencies {
  runCommand: typeof runCommand;
  verifyTargetRelease: typeof verifyTargetRelease;
  runPreflight: typeof runPreflight;
  fetcher: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
}

const defaults: UpdateDependencies = {
  runCommand, verifyTargetRelease, runPreflight, fetcher: fetch,
  sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)), now: () => new Date(),
};
const active = new WeakSet<UpdaterStateStore>();
const terminal = new Set(['succeeded', 'rolled_back', 'failed_manual_recovery']);
const migrationInventoryScript = "import { migrations } from '/app/src/server/db/migrator.ts'; process.stdout.write(JSON.stringify(Object.keys(migrations)));";

type UpdateInput = {
  version: string;
  requestId: string;
  updaterVersion: string;
  config: UpdaterConfig;
  state: UpdaterStateStore;
  dependencies?: UpdateDependencies;
};

export async function applyUpdate(input: UpdateInput): Promise<UpdateJob> {
  if (active.has(input.state)) throw new Error('An update job is already active');
  active.add(input.state);
  try {
    const version = parseStableVersion(input.version).raw;
    const current = await input.state.readJob();
    if (current?.phase === 'failed_manual_recovery') throw new Error('Manual recovery is required');
    if (current && !terminal.has(current.phase) &&
      !(current.phase === 'preflight' && current.requestId === input.requestId && current.targetVersion === version)) {
      throw new Error('An update job is already active');
    }
    const installed = await input.state.readInstalled();
    if (version === installed.version) {
      if (current?.phase === 'succeeded' && current.targetVersion === version) return current;
      // An idempotent direct call reports success without replacing durable job history.
      return {
        id: input.requestId, requestId: input.requestId, targetVersion: version,
        previousVersion: version, previousImageDigest: installed.imageDigest, targetImageDigest: installed.imageDigest,
        phase: 'succeeded', completedSteps: 8, totalSteps: 8, message: 'Update installed successfully.',
        startedAt: installed.installedAt, finishedAt: installed.installedAt, errorCode: null,
        backupDirectory: null, backupCreatedAt: null,
      };
    }
    const job = current && !terminal.has(current.phase) ? current : await input.state.createJob({
      targetVersion: version, requestId: input.requestId,
    });
    return await transact(input, installed, job);
  } finally {
    active.delete(input.state);
  }
}

async function transact(input: UpdateInput, installed: InstalledState, job: UpdateJob): Promise<UpdateJob> {
  const { config, state } = input;
  const dependencies = { ...defaults, ...input.dependencies };
  const command = commandRunner(dependencies);
  const compose = composePrefix(config);
  const names = oneShotNames(job.id);
  let verified: VerifiedRelease | undefined;
  let quiesced = false;
  let migrationStarted = false;
  let errorCode = 'preflight_failed';
  try {
    const identity = updaterIdentity();
    // Target-dependent preflight belongs to verifyTargetRelease, which invokes Task 7's full gate.
    await localPreflight(config, installed);
    errorCode = 'release_unavailable';
    await state.transitionJob(job.id, 'verifying');
    verified = await dependencies.verifyTargetRelease({
      version: input.version, installed, updaterVersion: input.updaterVersion, config,
    });
    await state.transitionJob(job.id, 'downloading', { targetImageDigest: verified.manifest.image.digest });
    await command(['pull', verified.imageReference], 15 * 60_000);
    errorCode = 'incompatible_update';
    const inventory = await runOneShot(names.inventory, [
      'run', '--rm', '--name', names.inventory, '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--entrypoint', 'node', verified.imageReference,
      '--import', 'tsx', '--input-type=module', '-e', migrationInventoryScript,
    ], 30_000, dependencies);
    verifyMigrationInventory(inventory, verified.manifest.compatibility.targetMigration);

    errorCode = 'backup_failed';
    // transitionJob must finish writing the public maintenance marker before drain/stop.
    await state.transitionJob(job.id, 'quiescing');
    quiesced = true;
    await dependencies.sleep(2_000);
    await command([...compose, 'stop', '--timeout', '30', 'app'], 30_000);
    await state.transitionJob(job.id, 'backing_up');
    const output = await runOneShot(names.backup, [
      ...compose, 'run', '--rm', '--name', names.backup, '--no-deps', '--user', identity,
      '--volume', `${config.backupDirectory}:/backups`, 'app', 'npm', 'run', '--silent', 'backup', '--',
      '--offline', '--direct', '--json', '--output-root', '/backups',
    ], 60 * 60_000, dependencies);
    const backup = await validateBackup(output, config, installed.version);
    // Persist the recovery reference before image selection can change (including a crash here).
    await state.recordBackup(job.id, backup);
    await writeImageEnvironment(config.imageEnvironmentFile, verified.manifest.image.digest);
    errorCode = 'migration_failed';
    await state.transitionJob(job.id, 'migrating');
    migrationStarted = true;
    await runOneShot(names.migration, [...compose, 'run', '--rm', '--name', names.migration, '--no-deps',
      'app', 'npm', 'run', 'db:migrate'], 15 * 60_000, dependencies);
    errorCode = 'health_failed';
    await state.transitionJob(job.id, 'restarting');
    await startApp(config, dependencies);
    await state.transitionJob(job.id, 'health_check');
    await awaitReadiness(config, dependencies);
    await state.writeInstalled({ ...installed, version: input.version,
      imageDigest: verified.manifest.image.digest, installedAt: dependencies.now().toISOString() });
    return await finishJob(state, job.id, () => state.transitionJob(job.id, 'succeeded'));
  } catch (error) {
    const committed = await repairCommittedTerminal(state, job.id);
    if (committed) return committed;
    if (error instanceof OneShotCleanupError || (quiesced && migrationStarted && (!verified ||
      compareStableVersions(installed.version, verified.manifest.compatibility.rollbackSafeFrom) < 0))) {
      return finishJob(state, job.id, () => state.transitionJob(job.id, 'failed_manual_recovery', { errorCode: 'manual_recovery_required' }));
    }
    try {
      await state.transitionJob(job.id, 'rolling_back', { errorCode });
      if (quiesced) {
        await writeImageEnvironment(config.imageEnvironmentFile, installed.imageDigest);
        await startApp(config, dependencies);
        await awaitReadiness(config, dependencies);
        // installed.json may have committed immediately before the final status write failed.
        if ((await state.readInstalled()).imageDigest !== installed.imageDigest) await state.writeInstalled(installed);
      }
      return await finishJob(state, job.id, () => state.transitionJob(job.id, 'rolled_back', { errorCode }));
    } catch {
      const committed = await repairCommittedTerminal(state, job.id);
      if (committed) return committed;
      return finishJob(state, job.id, () => state.transitionJob(job.id, 'failed_manual_recovery', { errorCode: 'manual_recovery_required' }));
    }
  }
}

export async function reconcileUpdate(input: {
  config: UpdaterConfig;
  state: UpdaterStateStore;
  dependencies?: UpdateDependencies;
}): Promise<UpdateJob | null> {
  const job = await input.state.readJob();
  const dependencies = { ...defaults, ...input.dependencies };
  if (!job || terminal.has(job.phase)) {
    if (job?.phase === 'failed_manual_recovery') {
      try {
        for (const name of Object.values(oneShotNames(job.id))) await cleanOneShot(name, dependencies);
        console.info('Manual-recovery one-shot cleanup verified; operator repair still required');
      } catch {
        console.error('Manual-recovery one-shot cleanup could not be verified');
      }
    }
    // /run is volatile across host reboots; rebuild the sanitized mirror from durable state.
    return input.state.refreshStatus();
  }
  try {
    // Docker CLI death does not imply container death, including after a host-service restart.
    for (const name of Object.values(oneShotNames(job.id))) await cleanOneShot(name, dependencies);
    const configured = await readFile(input.config.imageEnvironmentFile, 'utf8');
    const command = commandRunner(dependencies);
    const containerId = (await command([...composePrefix(input.config), 'ps', '--quiet', 'app'], 30_000)).trim();
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('Invalid running container');
    const inspection: unknown = JSON.parse(await command(['inspect', '--type', 'container', containerId], 30_000));
    if (!Array.isArray(inspection) || inspection.length !== 1) throw new Error('Invalid container inspection');
    const container = inspection[0];
    if (container?.State?.Running !== true || typeof container?.Config?.Image !== 'string') {
      throw new Error('Application is not running');
    }
    const targetRunning = job.targetImageDigest !== null &&
      configured === imageEnvironment(job.targetImageDigest) &&
      container.Config.Image === `${OFFICIAL_IMAGE_REPOSITORY}@${job.targetImageDigest}`;
    const previousRunning = configured === imageEnvironment(job.previousImageDigest) &&
      container.Config.Image === `${OFFICIAL_IMAGE_REPOSITORY}@${job.previousImageDigest}`;
    if (!targetRunning && !previousRunning) throw new Error('Application image disagrees');
    await awaitReadiness(input.config, dependencies);
    const installed = await input.state.readInstalled();
    const version = targetRunning ? job.targetVersion : job.previousVersion;
    const imageDigest = targetRunning ? job.targetImageDigest! : job.previousImageDigest;
    if (installed.version !== version || installed.imageDigest !== imageDigest) {
      await input.state.writeInstalled({ ...installed, version, imageDigest, installedAt: dependencies.now().toISOString() });
    }
    return await finishJob(input.state, job.id, () => input.state.reconcileJob(job.id, targetRunning ? 'succeeded' : 'rolled_back'));
  } catch {
    const committed = await repairCommittedTerminal(input.state, job.id);
    if (committed) return committed;
    return finishJob(input.state, job.id, () => input.state.reconcileJob(job.id, 'failed_manual_recovery'));
  }
}

async function repairCommittedTerminal(state: UpdaterStateStore, id: string): Promise<UpdateJob | null> {
  const durable = await state.readJob();
  if (!durable || durable.id !== id || !terminal.has(durable.phase)) return null;
  // The job rename may have succeeded even when its subsequent runtime mirror write failed.
  await state.refreshStatus();
  return durable;
}

async function finishJob(state: UpdaterStateStore, id: string, persist: () => Promise<UpdateJob>): Promise<UpdateJob> {
  try { return await persist(); }
  catch (error) {
    const committed = await repairCommittedTerminal(state, id);
    if (committed) return committed;
    throw error;
  }
}

function oneShotNames(id: string): { inventory: string; backup: string; migration: string } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid updater job ID');
  }
  const prefix = `tomecms-update-${id.toLowerCase()}`;
  return { inventory: `${prefix}-inventory`, backup: `${prefix}-backup`, migration: `${prefix}-migration` };
}

class OneShotCleanupError extends Error {
  constructor() { super('One-shot container cleanup could not be verified'); }
}

async function runOneShot(name: string, args: readonly string[], timeoutMs: number, dependencies: UpdateDependencies): Promise<string> {
  let output: string;
  try {
    output = await commandRunner(dependencies)(args, timeoutMs);
  } catch (error) {
    await cleanOneShot(name, dependencies, true);
    throw error;
  }
  // --rm should have completed before the attached CLI exits successfully.
  if (await cleanOneShot(name, dependencies)) throw new Error('One-shot container outlived successful CLI');
  return output;
}

async function cleanOneShot(name: string, dependencies: UpdateDependencies, force = false): Promise<boolean> {
  const command = commandRunner(dependencies);
  const probe = ['ps', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'];
  const remove = () => dependencies.runCommand('docker', ['rm', '--force', name], { timeoutMs: 30_000 }).catch(() => undefined);
  try {
    if (force) await remove();
    const output = (await command(probe, 30_000)).trim();
    if (!output) return false;
    if (output !== name || force) throw new OneShotCleanupError();
    await remove();
    if ((await command(probe, 30_000)).trim()) throw new OneShotCleanupError();
    return true;
  } catch {
    // A failed removal is safe only if a successful daemon query proves absence.
    throw new OneShotCleanupError();
  }
}

function composePrefix(config: UpdaterConfig): string[] {
  return ['compose', '-p', 'tomecms', '-f', config.composeFile,
    '--env-file', config.environmentFile, '--env-file', config.imageEnvironmentFile];
}

function commandRunner(dependencies: UpdateDependencies) {
  return async (args: readonly string[], timeoutMs: number): Promise<string> => {
    const result = await dependencies.runCommand('docker', args, { timeoutMs });
    if (result.code !== 0) throw new Error('Updater command failed');
    return result.stdout;
  };
}

function updaterIdentity(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid! <= 0 || gid! < 0) {
    throw new Error('Updater must run as a non-root system user');
  }
  return `${uid}:${gid}`;
}

async function localPreflight(config: UpdaterConfig, installed: InstalledState): Promise<void> {
  for (const [path, directory] of [
    [config.composeFile, false], [config.environmentFile, false], [config.imageEnvironmentFile, false],
    [config.stateDirectory, true], [config.backupDirectory, true],
  ] as const) {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile())) {
      throw new Error('Invalid managed prerequisite');
    }
  }
  if (await readFile(config.imageEnvironmentFile, 'utf8') !== imageEnvironment(installed.imageDigest)) {
    throw new Error('Installed and configured image disagree');
  }
}

function verifyMigrationInventory(output: string, target: string): void {
  if (Buffer.byteLength(output) >= 32 * 1024) throw new Error('Migration inventory too large');
  const keys: unknown = JSON.parse(output);
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 1000 ||
    keys.some((key) => typeof key !== 'string' || !/^\d{3}_[a-z]+(?:_[a-z0-9]+)*$/.test(key)) ||
    new Set(keys).size !== keys.length || !keys.includes(target)) throw new Error('Target migration not shipped');
}

async function validateBackup(output: string, config: UpdaterConfig, applicationVersion: string): Promise<{
  backupDirectory: string; backupCreatedAt: string;
}> {
  if (Buffer.byteLength(output) >= 32 * 1024) throw new Error('Backup receipt too large');
  const receipt = JSON.parse(output);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
    Object.keys(receipt).sort().join(',') !== 'backupDirectory,manifestSha256' ||
    typeof receipt.backupDirectory !== 'string' || !receipt.backupDirectory.startsWith('/backups/') ||
    posix.normalize(receipt.backupDirectory) !== receipt.backupDirectory ||
    typeof receipt.manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.manifestSha256)) {
    throw new Error('Invalid backup receipt');
  }
  const tail = posix.relative('/backups', receipt.backupDirectory);
  if (!tail || tail === '..' || tail.startsWith('../') || posix.isAbsolute(tail)) throw new Error('Invalid backup directory');
  const root = await realpath(config.backupDirectory);
  const directory = resolve(root, tail);
  if (relative(root, directory).startsWith(`..${sep}`) || await realpath(directory) !== directory ||
    !(await lstat(directory)).isDirectory()) throw new Error('Unsafe backup directory');
  const file = await open(join(directory, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const metadata = await file.stat();
    // ponytail: 32 MiB manifest ceiling; stream validation if object inventories exceed it.
    if (!metadata.isFile() || metadata.size > 32 * 1024 ** 2) throw new Error('Invalid backup manifest');
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.manifestSha256) throw new Error('Backup manifest hash mismatch');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest?.format !== 'tomecms-backup' || manifest?.version !== 1 || manifest?.applicationVersion !== applicationVersion ||
    typeof manifest?.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(manifest.createdAt) ||
    !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Invalid backup manifest');
  return { backupDirectory: join(config.backupDirectory, tail), backupCreatedAt: manifest.createdAt };
}

function imageEnvironment(digest: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid image digest');
  return `TOME_CMS_APP_IMAGE='${OFFICIAL_IMAGE_REPOSITORY}@${digest}'\n`;
}

async function writeImageEnvironment(path: string, digest: string): Promise<void> {
  const value = imageEnvironment(digest);
  const temporary = join(dirname(path), `.image.env.${randomUUID()}`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function startApp(config: UpdaterConfig, dependencies: UpdateDependencies): Promise<void> {
  await commandRunner(dependencies)([...composePrefix(config), 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'app'], 90_000);
}

async function awaitReadiness(config: UpdaterConfig, dependencies: UpdateDependencies): Promise<void> {
  // Fifteen five-second requests with one-second retry gaps stay below ninety seconds.
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await dependencies.fetcher(config.appHealthUrl, { signal: AbortSignal.timeout(5_000), redirect: 'error' });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* Retry transient startup errors within the readiness budget. */ }
    if (attempt < 14) await dependencies.sleep(1_000);
  }
  throw new Error('Application readiness failed');
}
