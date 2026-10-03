import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, sep } from 'node:path';
import { parseEnv } from 'node:util';

import { parseBackupManifest, type BackupManifest } from '../update/backup.js';
import { compareStableVersions } from '../update/contracts.js';
import { composePrefix, type UpdaterConfig } from './config.js';
import { readManifestBytes } from './files.js';
import { parseManagedDiagnosticSecrets, type CommandDiagnosticContext, type CommandDiagnosticStage } from './process.js';
import { parseRestoreReport, type InstalledState, type RestoreJob, type UpdaterStateStore } from './state.js';
import {
  cleanOneShot, defaults, exclusively, localPreflight, oneShotNames, restoreInstalledApp, runOneShot,
  stopAndBackUp, stopApp, updaterIdentity, verifyBackupFiles, type UpdateDependencies,
} from './transaction.js';

// The first release whose image carries the restore steps (`npm run content`).
const RESTORE_SINCE = '1.13.0';
const STEP_MS = 60 * 60_000;
const SHORT_STEP_MS = 15 * 60_000;

type RestoreInput = {
  restore: RestoreJob;
  config: UpdaterConfig;
  state: UpdaterStateStore;
  dependencies?: UpdateDependencies;
};

/** Everything one restore's steps share. */
interface Run {
  id: string;
  config: UpdaterConfig;
  state: UpdaterStateStore;
  installed: InstalledState;
  dependencies: UpdateDependencies;
  diagnostics: CommandDiagnosticContext;
  identity: string;
  names: ReturnType<typeof oneShotNames>;
  /**
   * The preflight found the app stopped, as a failed restore leaves it, on a database no one knows
   * the state of. Then no failure ever starts it: only a restore that succeeds does.
   */
  foundStopped: boolean;
}

/** A refusal while verifying, named by the code `tome` explains. Nothing has stopped. */
class RestoreRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * A restore of a backup into the site. It checks the backup while the site is still up, then takes
 * a maintenance window as an update does: the marker, the drain, the stop and a full safety backup.
 * Only then does it put the backup's database and media in place, migrate when the backup is from
 * an older version, compare what came back with the manifest, and start the app. From the first
 * restore step on, any failure puts the safety backup back the same way.
 */
export async function runRestore(input: RestoreInput): Promise<RestoreJob> {
  return exclusively(input.state, () => restoreBackup(input));
}

async function restoreBackup(input: RestoreInput): Promise<RestoreJob> {
  const { restore: job, state } = input;
  let run: Run;
  let manifest: BackupManifest;
  try {
    const prepared = await prepare(input, job.id);
    run = { ...prepared, foundStopped: await localPreflight(prepared.config, prepared.installed, prepared.dependencies, prepared.diagnostics, { appMayBeStopped: true }) };
    manifest = await verify(run, job.backupDirectory);
  } catch (error) {
    return state.transitionRestore(job.id, 'failed', { errorCode: error instanceof RestoreRefusal ? error.code : 'preflight_failed' });
  }
  const { config, installed, dependencies, diagnostics } = run;
  await state.transitionRestore(job.id, 'quiescing');
  let safetyBackupDirectory: string;
  try {
    ({ backupDirectory: safetyBackupDirectory } = await stopAndBackUp({
      config, installed, kind: 'full', name: run.names.backup, identity: run.identity, dependencies, diagnostics,
      backingUp: () => state.transitionRestore(job.id, 'safety_backup'),
    }));
    await state.transitionRestore(job.id, 'restoring', { safetyBackupDirectory });
  } catch {
    // Nothing has been replaced. The app is started again whatever the start does, and ending the
    // restore clears the marker; unless it was found stopped, when both stay as they were found.
    if (!run.foundStopped) await restoreInstalledApp(config, installed.imageDigest, dependencies, diagnostics, 'restart').catch(() => undefined);
    return state.transitionRestore(job.id, 'failed', { errorCode: 'safety_backup_failed', maintenanceKept: run.foundStopped });
  }
  try {
    await putBack(run, job.backupDirectory, manifest);
  } catch {
    return rollBack(run, safetyBackupDirectory, 'restore_failed');
  }
  return state.transitionRestore(job.id, 'succeeded');
}

async function prepare(input: Omit<RestoreInput, 'restore'>, id: string): Promise<Run> {
  const installed = await input.state.readInstalled();
  return {
    id, config: input.config, state: input.state, installed, dependencies: { ...defaults, ...input.dependencies },
    diagnostics: {
      jobId: id, targetVersion: installed.version,
      secrets: await readFile(input.config.environmentFile, 'utf8').then(parseManagedDiagnosticSecrets).catch(() => null),
    },
    identity: updaterIdentity(), names: oneShotNames(input.config.projectName, id), foundStopped: false,
  };
}

/** Everything `tome` checked before it asked, checked again, with every checksum. */
async function verify(run: Run, backupDirectory: string): Promise<BackupManifest> {
  if (compareStableVersions(run.installed.version, RESTORE_SINCE) < 0) throw new RestoreRefusal('app_too_old');
  const manifest = await verifyBackupDirectory(run.config, backupDirectory).catch(() => {
    throw new RestoreRefusal('backup_invalid');
  });
  // The domain never changes in a restore, so passkeys keep working.
  const site = parseEnv(await readFile(run.config.environmentFile, 'utf8')).TOME_CMS_PUBLIC_URL;
  if (new URL(manifest.config.publicUrl).origin !== new URL(site ?? '').origin) throw new RestoreRefusal('backup_other_site');
  let newer: boolean;
  try {
    newer = compareStableVersions(manifest.applicationVersion, run.installed.version) > 0;
  } catch {
    throw new RestoreRefusal('backup_invalid');
  }
  if (newer) throw new RestoreRefusal('backup_too_new');
  return manifest;
}

/**
 * A backup directory as a restore takes it: its own real path, under the backup root, a directory,
 * with a manifest that is a plain file and every file it lists matching its checksum.
 */
export async function verifyBackupDirectory(config: UpdaterConfig, path: string): Promise<BackupManifest> {
  if (!isAbsolute(path)) throw new Error('Unsafe backup directory');
  const tail = relative(await realpath(config.backupDirectory), path);
  if (!tail || tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail) ||
    await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw new Error('Unsafe backup directory');
  const manifest = parseBackupManifest(JSON.parse((await readManifestBytes(path)).toString('utf8')));
  await verifyBackupFiles(path, manifest);
  return manifest;
}

/** The backup's database, then its media, then migrations when it is older, the report and its check, and the start. */
async function putBack(run: Run, backupDirectory: string, manifest: BackupManifest): Promise<void> {
  const { config, state, id, installed, dependencies, diagnostics, names } = run;
  const work = await workPath(config, backupDirectory);
  await content(run, 'restore.database', names.restoreDatabase, 'restore-database', '--dump', `${work}/database.dump`);
  // A database-only backup lists no objects; the bucket is left as it is.
  if (manifest.scope !== 'database') await content(run, 'restore.objects', names.restoreObjects, 'restore-objects', '--backup', work);
  const migrated = compareStableVersions(manifest.applicationVersion, installed.version) < 0;
  if (migrated) {
    await state.transitionRestore(id, 'migrating');
    // The update's own migration one-shot, word for word.
    await runOneShot(names.migration, [...composePrefix(config), 'run', '--rm', '--name', names.migration, '--no-deps',
      'app', 'npm', 'run', 'db:migrate'], SHORT_STEP_MS, dependencies, diagnostics, 'restore.migrate');
  }
  const report = parseRestoreReport(await content(run, 'restore.report', names.afterRestore, 'after-restore'));
  // Compared before the start, so the app never runs on a database about to be put back. Site
  // settings are seeded by migrations as well, so only the content is compared.
  if ((['posts', 'pages', 'mediaItems'] as const).some((key) => report.records[key] !== manifest.records[key])) {
    throw new Error('The restored records differ from the backup');
  }
  await state.transitionRestore(id, 'restarting', { migrated, report });
  await restoreInstalledApp(config, installed.imageDigest, dependencies, diagnostics, 'restart');
  await state.transitionRestore(id, 'checking');
}

/**
 * Puts the safety backup back, through the same steps, and starts the app on it. If that fails too,
 * the restore ends `rollback_failed` with the marker kept and the app left stopped: no one may write
 * to a database in a state no one knows.
 */
async function rollBack(run: Run, safetyBackupDirectory: string | null, errorCode: string): Promise<RestoreJob> {
  const { config, state, id, installed, dependencies, diagnostics, names } = run;
  // Refused for a record already rolling back, as on a boot that finds it so. A record that cannot be
  // written does not hold the rollback back either: ending it then fails, and the next boot rolls back again.
  await state.transitionRestore(id, 'rolling_back').catch(() => undefined);
  try {
    if (!safetyBackupDirectory) throw new Error('There is no safety backup');
    // A one-shot left running by a CLI that died, here or before a restart, must not race the steps.
    for (const name of Object.values(names)) await cleanOneShot(name, dependencies, true, diagnostics);
    // Time may have passed since it was taken, a boot's worth or more: a damaged dump is never dropped in.
    await verifyBackupDirectory(config, safetyBackupDirectory);
    await stopApp(config, dependencies, diagnostics, 'rollback.stop_app');
    const work = await workPath(config, safetyBackupDirectory);
    await content(run, 'restore.rollback', names.restoreDatabase, 'restore-database', '--dump', `${work}/database.dump`);
    await content(run, 'restore.rollback', names.restoreObjects, 'restore-objects', '--backup', work);
    await content(run, 'restore.rollback', names.afterRestore, 'after-restore');
    // An app found stopped is left stopped: what was put back is the database it was stopped on.
    if (!run.foundStopped) await restoreInstalledApp(config, installed.imageDigest, dependencies, diagnostics, 'rollback');
  } catch {
    // Whatever stopped the rollback, the app does not serve a database in a state no one knows.
    await stopApp(config, dependencies, diagnostics, 'rollback.stop_app').catch(() => undefined);
    return state.transitionRestore(id, 'failed', { errorCode: 'rollback_failed', maintenanceKept: true });
  }
  return state.transitionRestore(id, 'failed', { errorCode, maintenanceKept: run.foundStopped });
}

/**
 * On boot, a restore the updater stopped in the middle of. Whether that restore found the app
 * stopped is not recorded, so a boot starts the app as for one that found it running. Cut off while verifying, nothing had
 * stopped. Cut off before its first restore step, nothing had been replaced, so the app is started
 * again. Later, the safety backup is put back. Either way it ends `interrupted`, and the marker goes,
 * unless the safety backup cannot be put back. Nothing here throws: a record that cannot be ended is
 * journalled, and stays active, refusing other jobs until it can be written.
 */
export async function reconcileRestore(input: Omit<RestoreInput, 'restore'>): Promise<RestoreJob | null> {
  try {
    const job = await input.state.readRestore();
    if (!job || job.phase === 'succeeded' || job.phase === 'failed') return job;
    if (job.phase === 'verifying') return await input.state.transitionRestore(job.id, 'failed', { errorCode: 'interrupted' });
    const run = await prepare(input, job.id);
    if (job.phase === 'quiescing' || job.phase === 'safety_backup') {
      // A safety backup still writing only reads the database.
      await cleanOneShot(run.names.backup, run.dependencies, true, run.diagnostics).catch(() => undefined);
      await restoreInstalledApp(run.config, run.installed.imageDigest, run.dependencies, run.diagnostics, 'restart').catch(() => undefined);
      return await input.state.transitionRestore(job.id, 'failed', { errorCode: 'interrupted' });
    }
    return await rollBack(run, job.safetyBackupDirectory, 'interrupted');
  } catch {
    try { console.error(JSON.stringify({ event: 'updater_restore_reconcile_failed' })); } catch { /* The updater still starts. */ }
    return null;
  }
}

/** Where a directory under the backup root is inside a one-shot, which mounts that root at /work. */
async function workPath(config: UpdaterConfig, directory: string): Promise<string> {
  const tail = relative(await realpath(config.backupDirectory), await realpath(directory));
  if (!tail || tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail)) throw new Error('Backup outside the backup root');
  return posix.join('/work', ...tail.split(sep));
}

/** One step of the image's content CLI, as a one-shot. Its receipt, without `ok`, when it says ok. */
async function content(run: Run, stage: CommandDiagnosticStage, name: string, step: string, ...args: string[]): Promise<Record<string, unknown>> {
  const output = await runOneShot(name, [
    ...composePrefix(run.config), 'run', '--rm', '--name', name, '--no-deps', '--user', run.identity,
    '--env', 'DATABASE_QUERY_TIMEOUT_MS=3600000', '--volume', `${run.config.backupDirectory}:/work`,
    'app', 'npm', 'run', '--silent', 'content', '--', step, ...args,
  ], step === 'after-restore' ? SHORT_STEP_MS : STEP_MS, run.dependencies, run.diagnostics, stage);
  const lines = output.split('\n').filter(Boolean);
  const receipt: unknown = lines.length === 1 ? JSON.parse(lines[0]!) : null;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('Invalid restore step receipt');
  const { ok, ...rest } = receipt as Record<string, unknown>;
  if (ok !== true) throw new Error('Invalid restore step receipt');
  return rest;
}
