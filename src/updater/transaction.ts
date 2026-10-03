import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import { parseBackupManifest, type BackupManifest } from '../update/backup.js';
import { compareStableVersions, OFFICIAL_IMAGE_REPOSITORY, parseStableVersion } from '../update/contracts.js';
import { composePrefix, type UpdaterConfig } from './config.js';
import { directorySize, readManifestBytes } from './files.js';
import { migrationInventoryArgs } from './inventory.js';
import {
  parseManagedDiagnosticSecrets,
  runCheckedCommand,
  runCommand,
  type CommandDiagnosticContext,
  type CommandDiagnosticStage,
} from './process.js';
import { pruneOldImages, type PruneResult } from './prune.js';
import type { BackupJob, BackupKind, InstalledState, UpdateJob, UpdaterStateStore } from './state.js';
import { InsufficientDiskSpaceError, runPreflight, verifyTargetRelease, type VerifiedRelease } from './verify.js';

export interface UpdateDependencies {
  runCommand: typeof runCommand;
  verifyTargetRelease: typeof verifyTargetRelease;
  runPreflight: typeof runPreflight;
  fetcher: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
}

export const defaults: UpdateDependencies = {
  runCommand, verifyTargetRelease, runPreflight, fetcher: fetch,
  sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)), now: () => new Date(),
};
const active = new WeakSet<UpdaterStateStore>();
const terminal = new Set(['succeeded', 'rolled_back', 'failed_manual_recovery']);
// How long `compose stop` lets the app exit on SIGTERM before it kills it, and how long the
// command itself may take: the grace plus 30 s for Docker. 1.0.1 gave the command only the grace,
// so an app that used all of it (Node as PID 1 ignores SIGTERM) always timed out.
const STOP_GRACE_SECONDS = 30;
const STOP_COMMAND_MS = (STOP_GRACE_SECONDS + 30) * 1_000;
// The first release whose backup script takes --database-only. The backup runs in the installed
// image, so an older one would refuse the flag and fail the update.
const DATABASE_ONLY_SINCE = '1.3.0';
// The first release whose app knows `insufficient_disk_space`.
const DISK_SPACE_CODE_SINCE = '1.10.0';

type UpdateInput = {
  version: string;
  requestId: string;
  updaterVersion: string;
  config: UpdaterConfig;
  state: UpdaterStateStore;
  dependencies?: UpdateDependencies;
};

export async function applyUpdate(input: UpdateInput): Promise<UpdateJob> {
  return exclusively(input.state, async () => {
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
        backupDirectory: null, backupCreatedAt: null, timeline: [], backupKind: null,
      };
    }
    const job = current && !terminal.has(current.phase) ? current : await input.state.createJob({
      targetVersion: version, requestId: input.requestId,
    });
    return transact(input, installed, job);
  });
}

/** The one lock: an update, a backup, a prune and a restore never run at once. */
export async function exclusively<T>(state: UpdaterStateStore, work: () => Promise<T>): Promise<T> {
  if (active.has(state)) throw new Error('An update job is already active');
  active.add(state);
  try {
    return await work();
  } finally {
    active.delete(state);
  }
}

async function transact(input: UpdateInput, installed: InstalledState, job: UpdateJob): Promise<UpdateJob> {
  const { config, state } = input;
  const dependencies = { ...defaults, ...input.dependencies };
  const diagnostics: CommandDiagnosticContext = { jobId: job.id, targetVersion: job.targetVersion, secrets: null };
  const command = commandRunner(dependencies, diagnostics);
  const compose = composePrefix(config);
  const names = oneShotNames(config.projectName, job.id);
  let verified: VerifiedRelease | undefined;
  let quiesced = false;
  let migrationStarted = false;
  let errorCode = 'preflight_failed';
  try {
    const identity = updaterIdentity();
    // Target-dependent preflight belongs to verifyTargetRelease, which invokes Task 7's full gate.
    await localPreflight(config, installed, dependencies, diagnostics);
    errorCode = 'release_unavailable';
    await state.transitionJob(job.id, 'verifying');
    verified = await dependencies.verifyTargetRelease({
      version: input.version, installed, updaterVersion: input.updaterVersion, config, diagnostics,
    });
    await state.transitionJob(job.id, 'downloading', { targetImageDigest: verified.manifest.image.digest });
    await command('download.image', ['pull', verified.imageReference], 15 * 60_000);
    errorCode = 'incompatible_update';
    const inventory = await runOneShot(names.inventory, [
      'run', '--rm', '--name', names.inventory, ...migrationInventoryArgs(verified.imageReference),
    ], 30_000, dependencies, diagnostics, 'verify.migration_inventory');
    verifyMigrationInventory(inventory, verified.manifest.compatibility.targetMigration);
    const backupKind = await chooseBackupKind(installed, inventory, names.installedInventory, dependencies, diagnostics);

    errorCode = 'backup_failed';
    // transitionJob must finish writing the public maintenance marker before drain/stop.
    await state.transitionJob(job.id, 'quiescing');
    quiesced = true;
    const backup = await stopAndBackUp({
      config, installed, kind: backupKind, name: names.backup, identity, dependencies, diagnostics,
      backingUp: () => state.transitionJob(job.id, 'backing_up'),
    });
    // Persist the recovery reference before image selection can change (including a crash here).
    await state.recordBackup(job.id, { ...backup, backupKind });
    await writeImageEnvironment(config.imageEnvironmentFile, verified.manifest.image.digest);
    errorCode = 'migration_failed';
    await state.transitionJob(job.id, 'migrating');
    migrationStarted = true;
    await runOneShot(names.migration, [...compose, 'run', '--rm', '--name', names.migration, '--no-deps',
      'app', 'npm', 'run', 'db:migrate'], 15 * 60_000, dependencies, diagnostics, 'migration.apply');
    errorCode = 'health_failed';
    await state.transitionJob(job.id, 'restarting');
    await startApp(config, dependencies, diagnostics, 'restart.start_app');
    await state.transitionJob(job.id, 'health_check');
    await awaitReadiness(config, dependencies);
    await state.writeInstalled({ ...installed, version: input.version,
      imageDigest: verified.manifest.image.digest, installedAt: dependencies.now().toISOString() });
    const succeeded = await finishJob(state, job.id, () => state.transitionJob(job.id, 'succeeded'));
    if (succeeded.phase === 'succeeded') {
      await pruneOldImages(command, [verified.manifest.image.digest, job.previousImageDigest], diagnostics).catch(() => undefined);
    }
    return succeeded;
  } catch (error) {
    const committed = await repairCommittedTerminal(state, job.id);
    if (committed) return committed;
    if (error instanceof OneShotCleanupError || (quiesced && migrationStarted && (!verified ||
      compareStableVersions(installed.version, verified.manifest.compatibility.rollbackSafeFrom) < 0))) {
      return finishJob(state, job.id, () => state.transitionJob(job.id, 'failed_manual_recovery', { errorCode: 'manual_recovery_required' }));
    }
    // The disk check runs while the release is verified; it is not the release that failed. An app
    // before 1.10.0 refuses a status with a code it does not know, so it is told the old one.
    if (error instanceof InsufficientDiskSpaceError &&
      compareStableVersions(installed.version, DISK_SPACE_CODE_SINCE) >= 0) errorCode = 'insufficient_disk_space';
    try {
      await state.transitionJob(job.id, 'rolling_back', { errorCode });
      if (quiesced) {
        await restoreInstalledApp(config, installed.imageDigest, dependencies, diagnostics, 'rollback');
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
  const diagnostics: CommandDiagnosticContext | null = job ? {
    jobId: job.id, targetVersion: job.targetVersion, secrets: await diagnosticSecrets(input.config.environmentFile).catch(() => null),
  } : null;
  if (!job || terminal.has(job.phase)) {
    if (job?.phase === 'failed_manual_recovery') {
      try {
        for (const name of Object.values(oneShotNames(input.config.projectName, job.id))) await cleanOneShot(name, dependencies, false, diagnostics!);
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
    for (const name of Object.values(oneShotNames(input.config.projectName, job.id))) await cleanOneShot(name, dependencies, false, diagnostics!);
    const configured = await readFile(input.config.imageEnvironmentFile, 'utf8');
    const runningImage = await inspectRunningApp(input.config, dependencies, diagnostics!, 'reconcile');
    const targetRunning = job.targetImageDigest !== null &&
      configured === imageEnvironment(job.targetImageDigest) &&
      runningImage === `${OFFICIAL_IMAGE_REPOSITORY}@${job.targetImageDigest}`;
    const previousRunning = configured === imageEnvironment(job.previousImageDigest) &&
      runningImage === `${OFFICIAL_IMAGE_REPOSITORY}@${job.previousImageDigest}`;
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

type BackupInput = {
  backup: BackupJob;
  config: UpdaterConfig;
  state: UpdaterStateStore;
  dependencies?: UpdateDependencies;
};

/**
 * A backup on request, with an update's own steps: the marker (written when the backup was
 * created), the drain, the stop, the offline backup, then the installed app started again and
 * ready. Once the app may have been stopped, it is always started again, whatever the backup did.
 */
export async function runBackup(input: BackupInput): Promise<BackupJob> {
  return exclusively(input.state, () => takeBackup(input));
}

async function takeBackup({ backup, config, state, dependencies: given }: BackupInput): Promise<BackupJob> {
  const dependencies = { ...defaults, ...given };
  const installed = await state.readInstalled();
  const diagnostics: CommandDiagnosticContext = { jobId: backup.id, targetVersion: installed.version, secrets: null };
  // An app before 1.3.0 has no --database-only; everything is the safe answer.
  const kind = compareStableVersions(installed.version, DATABASE_ONLY_SINCE) < 0 ? 'full' : backup.kind;
  let identity: string;
  try {
    identity = updaterIdentity();
    await localPreflight(config, installed, dependencies, diagnostics);
  } catch {
    // Nothing has been stopped; ending the backup clears the marker.
    return state.transitionBackup(backup.id, 'failed', { errorCode: 'preflight_failed' });
  }
  let errorCode: string | null = 'backup_failed';
  let taken: Pick<BackupJob, 'backupDirectory' | 'sizeBytes'> = { backupDirectory: null, sizeBytes: null };
  try {
    const { backupDirectory } = await stopAndBackUp({
      config, installed, kind, name: oneShotNames(config.projectName, backup.id).backup, identity, dependencies, diagnostics,
      backingUp: () => state.transitionBackup(backup.id, 'backing_up', { kind }),
    });
    taken = { backupDirectory, sizeBytes: null };
    errorCode = null;
  } catch { /* The app is started again below, and the backup ends failed. */ }
  // The backup has been checked file by file; a size that cannot be read is only unknown.
  if (taken.backupDirectory) taken = { ...taken, sizeBytes: await directorySize(taken.backupDirectory).catch(() => null) };
  // A record that cannot be written must not keep the app down: it is started either way.
  await state.transitionBackup(backup.id, 'restarting', taken).catch(() => undefined);
  try {
    await restoreInstalledApp(config, installed.imageDigest, dependencies, diagnostics, 'restart');
  } catch {
    errorCode = 'health_failed';
  }
  return state.transitionBackup(backup.id, errorCode ? 'failed' : 'succeeded', errorCode ? { errorCode } : {});
}

/**
 * On boot, a backup the updater stopped in the middle of: its one-shot is removed, the app is
 * started again if it is down, and the backup ends failed, which clears the marker.
 *
 * An app that is running is left alone. The backup may have been cut short before its stop, or
 * the host may have rebooted and started it; a running app on another image is someone's
 * deliberate change, which a backup's preflight does not touch either. Nothing here throws: a
 * record that cannot be ended (a full disk) is journalled, the updater still starts, and the
 * record, still active, keeps refusing updates and backups until it can be written.
 */
export async function reconcileBackup(input: Omit<BackupInput, 'backup'>): Promise<BackupJob | null> {
  try {
    const backup = await input.state.readBackup();
    if (!backup || backup.phase === 'succeeded' || backup.phase === 'failed') return backup;
    const dependencies = { ...defaults, ...input.dependencies };
    const installed = await input.state.readInstalled();
    const diagnostics: CommandDiagnosticContext = {
      jobId: backup.id, targetVersion: installed.version,
      secrets: await diagnosticSecrets(input.config.environmentFile).catch(() => null),
    };
    // A backup that is still writing reads the database; the app beside it does no harm.
    await cleanOneShot(oneShotNames(input.config.projectName, backup.id).backup, dependencies, true, diagnostics).catch(() => undefined);
    let errorCode = 'backup_failed';
    if (!await appStillServing(input.config, installed, dependencies, diagnostics)) {
      try {
        await restoreInstalledApp(input.config, installed.imageDigest, dependencies, diagnostics, 'restart');
      } catch {
        errorCode = 'health_failed';
      }
    }
    return await input.state.transitionBackup(backup.id, 'failed', { errorCode });
  } catch {
    try { console.error(JSON.stringify({ event: 'updater_backup_reconcile_failed' })); } catch { /* The updater still starts. */ }
    return null;
  }
}

/** True when the app runs another image, or the installed one and is ready: then it is not restarted. */
async function appStillServing(
  config: UpdaterConfig,
  installed: InstalledState,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
): Promise<boolean> {
  let image: string;
  try {
    image = await inspectRunningApp(config, dependencies, diagnostics, 'reconcile');
  } catch {
    return false;
  }
  if (image !== `${OFFICIAL_IMAGE_REPOSITORY}@${installed.imageDigest}`) return true;
  return awaitReadiness(config, dependencies).then(() => true, () => false);
}

/**
 * The image clean-up on request, a dry run or not. It keeps what the clean-up after an update
 * keeps: the installed image and the one before it. That one is known when the last update
 * succeeded and is what is installed: its job says what ran before. Otherwise (no update since
 * the install, a rollback, or an installed image the last job did not put there), the digests
 * the last job names are kept, and prune.ts keeps the likely previous one by build date. When in
 * doubt, more is kept.
 */
export async function runPrune(input: {
  dryRun: boolean;
  config: UpdaterConfig;
  state: UpdaterStateStore;
  dependencies?: UpdateDependencies;
}): Promise<PruneResult | null> {
  return exclusively(input.state, async () => {
    const [installed, job] = await Promise.all([input.state.readInstalled(), input.state.readJob()]);
    if (job?.phase === 'failed_manual_recovery') throw new Error('Manual recovery is required');
    if (job && !terminal.has(job.phase)) throw new Error('An update job is already active');
    const previousKnown = job?.phase === 'succeeded' && job.targetImageDigest === installed.imageDigest;
    const keep = [installed.imageDigest, job?.previousImageDigest, job?.targetImageDigest].filter((value) => typeof value === 'string');
    const diagnostics: CommandDiagnosticContext = { jobId: randomUUID(), targetVersion: installed.version, secrets: null };
    return pruneOldImages(commandRunner({ ...defaults, ...input.dependencies }, diagnostics), keep, diagnostics, {
      dryRun: input.dryRun, ...previousKnown ? {} : { previousUnknownFor: installed.imageDigest },
    });
  });
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

/**
 * The database alone when nothing in it will change: the installed image and the target ship the
 * same migrations, so the update swaps code and no table. The media library is what makes a full
 * backup slow, and an update like that does not touch it. Anything uncertain is a full backup.
 */
async function chooseBackupKind(
  installed: InstalledState,
  targetInventory: string,
  name: string,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
): Promise<BackupKind> {
  if (compareStableVersions(installed.version, DATABASE_ONLY_SINCE) < 0) return 'full';
  try {
    const current = await runOneShot(name, [
      'run', '--rm', '--name', name, ...migrationInventoryArgs(`${OFFICIAL_IMAGE_REPOSITORY}@${installed.imageDigest}`),
    ], 30_000, dependencies, diagnostics, 'verify.migration_inventory');
    const same = JSON.stringify(JSON.parse(current)) === JSON.stringify(JSON.parse(targetInventory));
    return same ? 'database' : 'full';
  } catch {
    return 'full';
  }
}

export function oneShotNames(projectName: UpdaterConfig['projectName'], id: string): {
  inventory: string; backup: string; migration: string; installedInventory: string;
  restoreDatabase: string; restoreObjects: string; afterRestore: string;
} {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid updater job ID');
  }
  const prefix = `${projectName}-update-${id.toLowerCase()}`;
  return {
    inventory: `${prefix}-inventory`, backup: `${prefix}-backup`, migration: `${prefix}-migration`,
    installedInventory: `${prefix}-installed-inventory`, restoreDatabase: `${prefix}-restore-database`,
    restoreObjects: `${prefix}-restore-objects`, afterRestore: `${prefix}-after-restore`,
  };
}

class OneShotCleanupError extends Error {
  constructor() { super('One-shot container cleanup could not be verified'); }
}

export async function runOneShot(
  name: string,
  args: readonly string[],
  timeoutMs: number,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
  stage: CommandDiagnosticStage,
): Promise<string> {
  let output: string;
  try {
    output = await commandRunner(dependencies, diagnostics)(stage, args, timeoutMs);
  } catch (error) {
    await cleanOneShot(name, dependencies, true, diagnostics);
    throw error;
  }
  // --rm should have completed before the attached CLI exits successfully.
  if (await cleanOneShot(name, dependencies, false, diagnostics)) throw new Error('One-shot container outlived successful CLI');
  return output;
}

export async function cleanOneShot(
  name: string,
  dependencies: UpdateDependencies,
  force: boolean,
  diagnostics: CommandDiagnosticContext,
): Promise<boolean> {
  const command = commandRunner(dependencies, diagnostics);
  const probe = ['ps', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'];
  const remove = () => command('cleanup.one_shot.remove', ['rm', '--force', name], 30_000).catch(() => undefined);
  try {
    if (force) await remove();
    const output = (await command('cleanup.one_shot.list', probe, 30_000)).trim();
    if (!output) return false;
    if (output !== name || force) throw new OneShotCleanupError();
    await remove();
    if ((await command('cleanup.one_shot.list', probe, 30_000)).trim()) throw new OneShotCleanupError();
    return true;
  } catch {
    // A failed removal is safe only if a successful daemon query proves absence.
    throw new OneShotCleanupError();
  }
}

function commandRunner(dependencies: UpdateDependencies, diagnostics: CommandDiagnosticContext) {
  return async (stage: CommandDiagnosticStage, args: readonly string[], timeoutMs: number): Promise<string> =>
    (await runCheckedCommand(
      dependencies.runCommand,
      'docker',
      args,
      { timeoutMs },
      diagnostics,
      stage,
      'Updater command failed',
    )).stdout;
}

export function updaterIdentity(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid! <= 0 || gid! < 0) {
    throw new Error('Updater must run as a non-root system user');
  }
  return `${uid}:${gid}`;
}

export async function localPreflight(
  config: UpdaterConfig,
  installed: InstalledState,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
): Promise<void> {
  for (const [path, directory] of [
    [config.composeFile, false], [config.environmentFile, false], [config.imageEnvironmentFile, false],
    [config.stateDirectory, true], [config.backupDirectory, true],
  ] as const) {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile())) {
      throw new Error('Invalid managed prerequisite');
    }
  }
  diagnostics.secrets = await diagnosticSecrets(config.environmentFile);
  if (await readFile(config.imageEnvironmentFile, 'utf8') !== imageEnvironment(installed.imageDigest)) {
    throw new Error('Installed and configured image disagree');
  }
  if (await inspectRunningApp(config, dependencies, diagnostics, 'preflight') !== `${OFFICIAL_IMAGE_REPOSITORY}@${installed.imageDigest}`) {
    throw new Error('Running application image does not match installed image');
  }
}

async function inspectRunningApp(
  config: UpdaterConfig,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
  phase: 'preflight' | 'reconcile',
): Promise<string> {
  const command = commandRunner(dependencies, diagnostics);
  const containerIds = (await command(`${phase}.app.list`, [...composePrefix(config), 'ps', '--quiet', 'app'], 30_000))
    .trim().split(/\s+/).filter(Boolean);
  if (containerIds.length !== 1 || !/^[0-9a-f]{64}$/.test(containerIds[0]!)) {
    throw new Error('Expected exactly one valid running application container');
  }
  let inspection: unknown;
  try {
    inspection = JSON.parse(await command(`${phase}.app.inspect`, ['inspect', '--type', 'container', containerIds[0]!], 30_000));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Application container inspection is not valid JSON');
    throw error;
  }
  if (!Array.isArray(inspection) || inspection.length !== 1 || !inspection[0] || typeof inspection[0] !== 'object') {
    throw new Error('Application container inspection must contain exactly one container');
  }
  const container = inspection[0] as Record<string, unknown>;
  const state = container.State;
  const containerConfig = container.Config;
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
    (state as Record<string, unknown>).Running !== true) throw new Error('Application container is not running');
  if (!containerConfig || typeof containerConfig !== 'object' || Array.isArray(containerConfig) ||
    typeof (containerConfig as Record<string, unknown>).Image !== 'string') {
    throw new Error('Application container image is unavailable');
  }
  return (containerConfig as Record<string, unknown>).Image as string;
}

async function diagnosticSecrets(environmentFile: string): Promise<string[]> {
  return parseManagedDiagnosticSecrets(await readFile(environmentFile, 'utf8'));
}

function verifyMigrationInventory(output: string, target: string): void {
  if (Buffer.byteLength(output) >= 32 * 1024) throw new Error('Migration inventory too large');
  const keys: unknown = JSON.parse(output);
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 1000 ||
    keys.some((key) => typeof key !== 'string' || !/^\d{3}_[a-z]+(?:_[a-z0-9]+)*$/.test(key)) ||
    new Set(keys).size !== keys.length || !keys.includes(target)) throw new Error('Target migration not shipped');
}

async function validateBackup(output: string, config: UpdaterConfig, applicationVersion: string, kind: BackupKind): Promise<{
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
  const bytes = await readManifestBytes(directory);
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.manifestSha256) throw new Error('Backup manifest hash mismatch');
  const manifest = parseBackupManifest(JSON.parse(bytes.toString('utf8')));
  if (manifest.applicationVersion !== applicationVersion) throw new Error('Invalid backup manifest');
  if ((manifest.scope === 'database') !== (kind === 'database')) throw new Error('Backup is not the kind that was asked for');
  await verifyBackupFiles(directory, manifest);
  return { backupDirectory: join(config.backupDirectory, tail), backupCreatedAt: manifest.createdAt };
}

/** Every file a backup's manifest lists, each read without following a link, against its checksum. */
export async function verifyBackupFiles(directory: string, manifest: BackupManifest): Promise<void> {
  await verifyBackupFile(directory, manifest.database.file, manifest.database.sha256);
  for (const object of manifest.objects) {
    await verifyBackupFile(directory, join('objects', ...object.key.split('/')), object.sha256, object.sizeBytes);
  }
}

async function verifyBackupFile(directory: string, relativePath: string, checksum: string, size?: number): Promise<void> {
  const path = resolve(directory, relativePath);
  const tail = relative(directory, path);
  if (!tail || tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail) || await realpath(path) !== path) {
    throw new Error('Unsafe backup file');
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size < 1 ||
      (size !== undefined && metadata.size !== size)) throw new Error('Invalid backup file');
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== checksum) throw new Error('Backup file checksum mismatch');
  } finally {
    await file.close();
  }
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

/**
 * The first half of a maintenance window, the same for an update, a backup on request and a
 * restore's safety backup: drain, stop the app, take the offline backup in a one-shot container,
 * and check what it wrote. The caller has already written the public maintenance marker (its job
 * in `quiescing`), and starts the app again whatever this throws.
 */
export async function stopAndBackUp(input: {
  config: UpdaterConfig;
  installed: InstalledState;
  kind: BackupKind;
  name: string;
  identity: string;
  backingUp: () => Promise<unknown>;
  dependencies: UpdateDependencies;
  diagnostics: CommandDiagnosticContext;
}): Promise<{ backupDirectory: string; backupCreatedAt: string }> {
  const { config, dependencies, diagnostics } = input;
  const compose = composePrefix(config);
  await dependencies.sleep(2_000);
  await stopApp(config, dependencies, diagnostics, 'quiesce.stop_app');
  await input.backingUp();
  const output = await runOneShot(input.name, [
    ...compose, 'run', '--rm', '--name', input.name, '--no-deps', '--user', input.identity,
    '--volume', `${config.backupDirectory}:/backups`, 'app', 'npm', 'run', '--silent', 'backup', '--',
    '--offline', '--direct', '--json', '--output-root', '/backups',
    ...(input.kind === 'database' ? ['--database-only'] : []),
  ], 60 * 60_000, dependencies, diagnostics, 'backup.create');
  return validateBackup(output, config, input.installed.version, input.kind);
}

/**
 * Starts the installed app again and waits until it is ready: an update's rollback, the end of
 * every backup on request, failed or not, and a restore's start. A stop that timed out can still
 * be under way in Docker, and starting the app then fails; stopping again waits for it. It is best
 * effort: if it fails too, the start decides.
 */
export async function restoreInstalledApp(
  config: UpdaterConfig,
  imageDigest: string,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
  stage: 'rollback' | 'restart',
): Promise<void> {
  await stopApp(config, dependencies, diagnostics, `${stage}.stop_app`).catch(() => undefined);
  await writeImageEnvironment(config.imageEnvironmentFile, imageDigest);
  await startApp(config, dependencies, diagnostics, `${stage}.start_app`);
  await awaitReadiness(config, dependencies);
}

/** Stops the app, letting it exit on SIGTERM for the grace period first. */
export async function stopApp(
  config: UpdaterConfig,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
  stage: 'quiesce.stop_app' | 'restart.stop_app' | 'rollback.stop_app',
): Promise<void> {
  await commandRunner(dependencies, diagnostics)(stage,
    [...composePrefix(config), 'stop', '--timeout', String(STOP_GRACE_SECONDS), 'app'], STOP_COMMAND_MS);
}

async function startApp(
  config: UpdaterConfig,
  dependencies: UpdateDependencies,
  diagnostics: CommandDiagnosticContext,
  stage: 'restart.start_app' | 'rollback.start_app',
): Promise<void> {
  await commandRunner(dependencies, diagnostics)(stage,
    [...composePrefix(config), 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', 'app'], 90_000);
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
