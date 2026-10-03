import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { parseBackupRecordCounts, type BackupRecordCounts } from '../update/backup.js';
import { parseStableVersion } from '../update/contracts.js';
import type { UpdaterConfig } from './config.js';
import { UPDATER_VERSION } from './version.js';

export type UpdatePhase =
  | 'preflight' | 'verifying' | 'downloading' | 'quiescing'
  | 'backing_up' | 'migrating' | 'restarting' | 'health_check'
  | 'rolling_back' | 'succeeded' | 'rolled_back' | 'failed_manual_recovery';

export interface InstalledState {
  version: string;
  imageDigest: string;
  composeContract: 1;
  environmentContract: 1;
  updaterProtocol: 1;
  installedAt: string;
}

export interface UpdateJob {
  id: string;
  requestId: string;
  targetVersion: string;
  previousVersion: string;
  previousImageDigest: string;
  targetImageDigest: string | null;
  phase: UpdatePhase;
  completedSteps: number;
  totalSteps: 8;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  backupDirectory: string | null;
  backupCreatedAt: string | null;
  /** When each phase began, in order. A job an earlier updater wrote has none. */
  timeline: Array<{ phase: UpdatePhase; at: string }>;
  /** What the backup copied: everything, or the database alone because no migration was due. */
  backupKind: BackupKind | null;
}

export type BackupKind = 'full' | 'database';

export type BackupPhase = 'quiescing' | 'backing_up' | 'restarting' | 'succeeded' | 'failed';

/**
 * A backup taken on request (`POST /v1/backup`), in its own `backup-job.json`. It is never the
 * update job: apps since 1.0 parse /v1/status strictly, so a backup there would read as an update.
 */
export interface BackupJob {
  /** The caller's request ID, so it knows what to follow before the answer arrives. */
  id: string;
  kind: BackupKind;
  phase: BackupPhase;
  startedAt: string;
  finishedAt: string | null;
  backupDirectory: string | null;
  sizeBytes: number | null;
  errorCode: string | null;
}

export type RestorePhase =
  | 'verifying' | 'quiescing' | 'safety_backup' | 'restoring' | 'migrating' | 'restarting' | 'checking'
  | 'rolling_back' | 'succeeded' | 'failed';

/** What `after-restore` reported: the records that came back, and the plugin secrets this server cannot open. */
export interface RestoreReport {
  records: BackupRecordCounts;
  sealedSecrets: number;
  unopenedSecrets: Array<{ plugin: string; setting: string }>;
}

/**
 * A restore of a backup into the site (`POST /v1/restore`), in its own `restore-job.json`, for the
 * same reason a backup has its own: /v1/status is the update's, and apps parse it strictly.
 */
export interface RestoreJob {
  /** The caller's request ID. */
  id: string;
  phase: RestorePhase;
  startedAt: string;
  finishedAt: string | null;
  /** The backup being restored, by its real path under the backup root. */
  backupDirectory: string;
  /** The full backup taken just before anything was replaced, which a failure puts back. */
  safetyBackupDirectory: string | null;
  migrated: boolean;
  errorCode: string | null;
  report: RestoreReport | null;
}

export type PublicUpdateJob = Pick<UpdateJob,
  | 'id' | 'targetVersion' | 'phase' | 'completedSteps' | 'totalSteps'
  | 'message' | 'startedAt' | 'finishedAt' | 'errorCode' | 'backupCreatedAt'
>;

export interface UpdaterStateStore {
  readInstalled(): Promise<InstalledState>;
  writeInstalled(value: InstalledState): Promise<void>;
  readJob(): Promise<UpdateJob | null>;
  refreshStatus(): Promise<UpdateJob | null>;
  createJob(input: Pick<UpdateJob, 'requestId' | 'targetVersion'>): Promise<UpdateJob>;
  recordBackup(id: string, backup: Pick<UpdateJob, 'backupDirectory' | 'backupCreatedAt' | 'backupKind'>): Promise<UpdateJob>;
  /** Boot-only terminalization after the caller verifies image identity and readiness. */
  reconcileJob(id: string, phase: 'succeeded' | 'rolled_back' | 'failed_manual_recovery'): Promise<UpdateJob>;
  transitionJob(id: string, phase: UpdatePhase, patch?: Partial<Pick<UpdateJob,
    'targetImageDigest' | 'finishedAt' | 'errorCode' | 'backupDirectory' | 'backupCreatedAt'
  >>): Promise<UpdateJob>;
  /**
   * Operator-only: sets aside a failed job that stopped before its backup, which is recorded before
   * any migration or image switch, so the database and the running image are as they were.
   */
  clearUnstartedFailure(): Promise<UpdateJob>;
  readBackup(): Promise<BackupJob | null>;
  /** Starts a backup in `quiescing`, which writes the public maintenance marker before anything stops. */
  createBackup(input: Pick<BackupJob, 'id' | 'kind'>): Promise<BackupJob>;
  transitionBackup(id: string, phase: BackupPhase, patch?: Partial<Pick<BackupJob,
    'kind' | 'backupDirectory' | 'sizeBytes' | 'errorCode'
  >>): Promise<BackupJob>;
  readRestore(): Promise<RestoreJob | null>;
  /** Starts a restore in `verifying`. The site stays up while the backup is checked, so no marker yet. */
  createRestore(input: Pick<RestoreJob, 'id' | 'backupDirectory'>): Promise<RestoreJob>;
  transitionRestore(id: string, phase: RestorePhase, patch?: Partial<Pick<RestoreJob,
    'safetyBackupDirectory' | 'migrated' | 'errorCode' | 'report'
  >>): Promise<RestoreJob>;
  /**
   * Operator-only: sets aside a restore that ended `rollback_failed`, which otherwise keeps the site
   * in maintenance and refuses every job. It touches no database, bucket or app: the operator then
   * restores the safety backup, or the backup again.
   */
  clearRollbackFailure(): Promise<{ restore: RestoreJob; keptAs: string }>;
}

const phases: readonly UpdatePhase[] = [
  'preflight', 'verifying', 'downloading', 'quiescing', 'backing_up', 'migrating',
  'restarting', 'health_check', 'rolling_back', 'succeeded', 'rolled_back',
  'failed_manual_recovery',
];
const terminalPhases = new Set<UpdatePhase>(['succeeded', 'rolled_back', 'failed_manual_recovery']);
const forwardPhases: Partial<Record<UpdatePhase, UpdatePhase>> = {
  preflight: 'verifying',
  verifying: 'downloading',
  downloading: 'quiescing',
  quiescing: 'backing_up',
  backing_up: 'migrating',
  migrating: 'restarting',
  restarting: 'health_check',
  health_check: 'succeeded',
};
const completedSteps: Record<UpdatePhase, number | null> = {
  preflight: 0,
  verifying: 1,
  downloading: 2,
  quiescing: 3,
  backing_up: 4,
  migrating: 5,
  restarting: 6,
  health_check: 7,
  succeeded: 8,
  rolling_back: null,
  rolled_back: null,
  failed_manual_recovery: null,
};
const messages: Record<UpdatePhase, string> = {
  preflight: 'Checking update prerequisites.',
  verifying: 'Verifying the official update.',
  downloading: 'Downloading the verified update.',
  quiescing: 'Preparing TomeCMS for maintenance.',
  backing_up: 'Creating a recovery backup.',
  migrating: 'Applying database migrations.',
  restarting: 'Starting the updated application.',
  health_check: 'Checking the updated application.',
  rolling_back: 'Restoring the previous application version.',
  succeeded: 'Update installed successfully.',
  rolled_back: 'The previous application version was restored.',
  failed_manual_recovery: 'Manual recovery is required.',
};
const installedKeys = [
  'version', 'imageDigest', 'composeContract', 'environmentContract', 'updaterProtocol', 'installedAt',
] as const;
const legacyJobKeys = [
  'id', 'requestId', 'targetVersion', 'previousVersion', 'previousImageDigest',
  'targetImageDigest', 'phase', 'completedSteps', 'totalSteps', 'message', 'startedAt',
  'finishedAt', 'errorCode', 'backupDirectory', 'backupCreatedAt',
] as const;
// Written since 1.3.0. An updater upgraded in the middle of a server's life finds a job.json from
// before them, so they may be missing -- both at once -- but never half there.
const jobKeys = [...legacyJobKeys, 'timeline', 'backupKind'] as const;
const backupKinds = new Set(['full', 'database']);
const patchKeys = ['targetImageDigest', 'finishedAt', 'errorCode', 'backupDirectory', 'backupCreatedAt'];
const backupKeys = ['id', 'kind', 'phase', 'startedAt', 'finishedAt', 'backupDirectory', 'sizeBytes', 'errorCode'] as const;
const backupPatchKeys = ['kind', 'backupDirectory', 'sizeBytes', 'errorCode'];
const backupTerminal = new Set<BackupPhase>(['succeeded', 'failed']);
// Checks that fail stop nothing, so `quiescing` may end at once. Once the app may be stopped, a
// running backup always passes `restarting`, the step that starts it again; straight to `failed`
// is for a boot that finds a backup cut short and has started the app itself.
const backupTransitions: Record<BackupPhase, readonly BackupPhase[]> = {
  quiescing: ['backing_up', 'restarting', 'failed'],
  backing_up: ['restarting', 'failed'],
  restarting: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
};
const restoreKeys = [
  'id', 'phase', 'startedAt', 'finishedAt', 'backupDirectory', 'safetyBackupDirectory', 'migrated', 'errorCode', 'report',
] as const;
const restorePatchKeys = ['safetyBackupDirectory', 'migrated', 'errorCode', 'report'];
const restoreTerminal = new Set<RestorePhase>(['succeeded', 'failed']);
// A check that fails while verifying stops nothing. Up to the safety backup nothing is replaced, so
// a failure there ends the restore once the app has been started again; from `restoring` on, every
// failure goes through `rolling_back`, which puts the safety backup back.
const restoreTransitions: Record<RestorePhase, readonly RestorePhase[]> = {
  verifying: ['quiescing', 'failed'],
  quiescing: ['safety_backup', 'failed'],
  safety_backup: ['restoring', 'failed'],
  restoring: ['migrating', 'restarting', 'rolling_back'],
  migrating: ['restarting', 'rolling_back'],
  restarting: ['checking', 'rolling_back'],
  checking: ['succeeded', 'rolling_back'],
  rolling_back: ['failed'],
  succeeded: [],
  failed: [],
};
// The update phase the app reads for each step of a restore. Every step that may stop the app or
// change the database is one the app refuses writes in; an update's `rolling_back` is not, so a
// restore's rolling back shows as `migrating`, which is what it does.
const restoreMarkerPhases: Partial<Record<RestorePhase, UpdatePhase>> = {
  quiescing: 'quiescing', safety_backup: 'backing_up', restoring: 'migrating', migrating: 'migrating',
  restarting: 'restarting', checking: 'health_check', rolling_back: 'migrating',
};

export function createUpdaterStateStore(config: UpdaterConfig): UpdaterStateStore {
  const installedPath = join(config.stateDirectory, 'installed.json');
  const jobPath = join(config.stateDirectory, 'job.json');
  const backupPath = join(config.stateDirectory, 'backup-job.json');
  const restorePath = join(config.stateDirectory, 'restore-job.json');
  let pending: Promise<void> = Promise.resolve();

  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };

  const readInstalled = async (): Promise<InstalledState> => parseInstalled(await readJson(installedPath));
  const readJob = async (): Promise<UpdateJob | null> => {
    try {
      return parseJob(await readJson(jobPath));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  };
  const readBackup = async (): Promise<BackupJob | null> => {
    try {
      return parseBackup(await readJson(backupPath));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  };
  const readRestore = async (): Promise<RestoreJob | null> => {
    try {
      return parseRestore(await readJson(restorePath));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  };
  const writeStatus = async (
    installed: InstalledState,
    job: UpdateJob | null,
    given: { backup?: BackupJob; restore?: RestoreJob } = {},
  ): Promise<void> => {
    // A backup or restore record that cannot be read gives no marker: it must not stop an update
    // writing its own, and the job itself cannot move without reading it.
    const backup = given.backup ?? await readBackup().catch(() => null);
    const restore = given.restore ?? await readRestore().catch(() => null);
    const restorePhase = restore && restoreMarkerPhase(restore);
    await atomicJson(config.statusPath, {
      protocolVersion: 1,
      updaterVersion: UPDATER_VERSION,
      managed: true,
      installed: { version: installed.version, imageDigest: installed.imageDigest },
      job: backup && !backupTerminal.has(backup.phase) ? maintenanceMarker(backup, backup.phase as UpdatePhase, installed)
        : restore && restorePhase ? maintenanceMarker(restore, restorePhase, installed)
          : job ? toPublicUpdateJob(job) : null,
    }, 0o640);
  };
  const assertNoActiveJob = async (): Promise<void> => {
    const job = await readJob();
    if (job?.phase === 'failed_manual_recovery') throw new Error('Manual recovery is required');
    if (job && !terminalPhases.has(job.phase)) throw new Error('An update job is already active');
    const backup = await readBackup();
    if (backup && !backupTerminal.has(backup.phase)) throw new Error('A backup job is already active');
    const restore = await readRestore();
    // Nothing may run on a database a failed restore left in a state no one knows.
    if (restore?.phase === 'failed' && restore.errorCode === 'rollback_failed') throw new Error('Manual recovery is required');
    if (restore && !restoreTerminal.has(restore.phase)) throw new Error('A restore job is already active');
  };

  return {
    readInstalled,
    readJob,
    refreshStatus() {
      return exclusive(async () => {
        const job = await readJob();
        await writeStatus(await readInstalled(), job);
        return job;
      });
    },
    writeInstalled(value) {
      return exclusive(async () => {
        const installed = parseInstalled(value);
        await atomicJson(installedPath, installed, 0o600);
        await writeStatus(installed, await readJob());
      });
    },
    createJob(input) {
      return exclusive(async () => {
        await assertNoActiveJob();
        parseStableVersion(input.targetVersion);
        if (!uuid(input.requestId)) throw new Error('Invalid update request ID');
        const installed = await readInstalled();
        const startedAt = new Date().toISOString();
        const job: UpdateJob = {
          id: randomUUID(), requestId: input.requestId, targetVersion: input.targetVersion,
          previousVersion: installed.version, previousImageDigest: installed.imageDigest,
          targetImageDigest: null, phase: 'preflight', completedSteps: 0, totalSteps: 8,
          message: messages.preflight, startedAt, finishedAt: null, errorCode: null,
          backupDirectory: null, backupCreatedAt: null,
          timeline: [{ phase: 'preflight', at: startedAt }], backupKind: null,
        };
        await atomicJson(jobPath, job, 0o600);
        await writeStatus(installed, job);
        return job;
      });
    },
    clearUnstartedFailure() {
      return exclusive(async () => {
        const job = await readJob();
        if (!job) throw new Error('There is no update job to clear.');
        if (job.phase !== 'failed_manual_recovery') throw new Error('Only a failed update can be cleared.');
        if (job.backupDirectory !== null || job.backupCreatedAt !== null) {
          throw new Error('This update made a backup before it failed, so it may have changed the database. Follow the recovery steps instead.');
        }
        const installed = await readInstalled();
        if (installed.imageDigest !== job.previousImageDigest) throw new Error('The installed image is not the one from before this update.');
        await rename(jobPath, `${jobPath}.cleared-${job.id}`);
        await writeStatus(installed, null);
        return job;
      });
    },
    recordBackup(id, backup) {
      return exclusive(async () => {
        const current = await readJob();
        if (!current || current.id !== id || current.phase !== 'backing_up') throw new Error('Invalid backup job phase');
        if (!isRecord(backup) || !hasExactKeys(backup, ['backupDirectory', 'backupCreatedAt', 'backupKind']) ||
          backup.backupDirectory === null || backup.backupCreatedAt === null || backup.backupKind === null) throw new Error('Invalid backup record');
        const job = parseJob({ ...current, ...backup });
        await atomicJson(jobPath, job, 0o600);
        await writeStatus(await readInstalled(), job);
        return job;
      });
    },
    reconcileJob(id, phase) {
      return exclusive(async () => {
        if (!terminalPhases.has(phase)) throw new Error('Invalid reconciliation phase');
        const current = await readJob();
        if (!current || current.id !== id) throw new Error('Update job not found');
        if (terminalPhases.has(current.phase)) throw new Error('Update job is terminal');
        const at = new Date().toISOString();
        const job = parseJob({ ...current, phase,
          completedSteps: completedSteps[phase] ?? current.completedSteps,
          message: messages[phase], finishedAt: at, timeline: [...current.timeline, { phase, at }],
          errorCode: phase === 'failed_manual_recovery' ? 'manual_recovery_required' : current.errorCode,
        });
        await atomicJson(jobPath, job, 0o600);
        await writeStatus(await readInstalled(), job);
        return job;
      });
    },
    transitionJob(id, phase, patch = {}) {
      return exclusive(async () => {
        if (!isRecord(patch) || !hasExactSubset(patch, patchKeys)) throw new Error('Invalid update job patch');
        const current = await readJob();
        if (!current || current.id !== id) throw new Error('Update job not found');
        if (terminalPhases.has(current.phase)) throw new Error('Update job is terminal');
        if (!validTransition(current.phase, phase)) throw new Error('Invalid update job transition');
        const terminal = terminalPhases.has(phase);
        const at = new Date().toISOString();
        const job = parseJob({
          ...current,
          ...patch,
          phase,
          completedSteps: completedSteps[phase] ?? current.completedSteps,
          message: messages[phase],
          finishedAt: terminal ? patch.finishedAt ?? at : null,
          timeline: [...current.timeline, { phase, at }],
        });
        const installed = await readInstalled();
        await atomicJson(jobPath, job, 0o600);
        await writeStatus(installed, job);
        return job;
      });
    },
    readBackup,
    createBackup(input) {
      return exclusive(async () => {
        await assertNoActiveJob();
        const backup = parseBackup({
          id: input.id, kind: input.kind, phase: 'quiescing', startedAt: new Date().toISOString(),
          finishedAt: null, backupDirectory: null, sizeBytes: null, errorCode: null,
        });
        const [installed, job] = await Promise.all([readInstalled(), readJob()]);
        await writeStatus(installed, job, { backup });
        try {
          await atomicJson(backupPath, backup, 0o600);
        } catch (error) {
          // No record, no backup: the marker it would have held goes too.
          await writeStatus(installed, job).catch(() => undefined);
          throw error;
        }
        return backup;
      });
    },
    transitionBackup(id, phase, patch = {}) {
      return exclusive(async () => {
        if (!isRecord(patch) || !hasExactSubset(patch, backupPatchKeys)) throw new Error('Invalid backup job patch');
        const current = await readBackup();
        if (!current || current.id !== id) throw new Error('Backup job not found');
        if (!backupTransitions[current.phase].includes(phase)) throw new Error('Invalid backup job transition');
        const backup = parseBackup({
          ...current, ...patch, phase, finishedAt: backupTerminal.has(phase) ? new Date().toISOString() : null,
        });
        const [installed, job] = await Promise.all([readInstalled(), readJob()]);
        // The marker is set before the record moves on, and cleared only after the record has ended:
        // a record that cannot be written leaves a marker that still tells the truth.
        if (backupTerminal.has(phase)) {
          await atomicJson(backupPath, backup, 0o600);
          await writeStatus(installed, job, { backup });
        } else {
          await writeStatus(installed, job, { backup });
          await atomicJson(backupPath, backup, 0o600);
        }
        return backup;
      });
    },
    readRestore,
    createRestore(input) {
      return exclusive(async () => {
        await assertNoActiveJob();
        const restore = parseRestore({
          id: input.id, phase: 'verifying', startedAt: new Date().toISOString(), finishedAt: null,
          backupDirectory: input.backupDirectory, safetyBackupDirectory: null, migrated: false, errorCode: null, report: null,
        });
        await atomicJson(restorePath, restore, 0o600);
        return restore;
      });
    },
    transitionRestore(id, phase, patch = {}) {
      return exclusive(async () => {
        if (!isRecord(patch) || !hasExactSubset(patch, restorePatchKeys)) throw new Error('Invalid restore job patch');
        const current = await readRestore();
        if (!current || current.id !== id) throw new Error('Restore job not found');
        if (!restoreTransitions[current.phase].includes(phase)) throw new Error('Invalid restore job transition');
        const restore = parseRestore({
          ...current, ...patch, phase, finishedAt: restoreTerminal.has(phase) ? new Date().toISOString() : null,
        });
        const [installed, job] = await Promise.all([readInstalled(), readJob()]);
        // As for a backup: the marker goes up before the record moves on, and comes down after it has ended.
        if (restoreTerminal.has(phase)) {
          await atomicJson(restorePath, restore, 0o600);
          await writeStatus(installed, job, { restore });
        } else {
          await writeStatus(installed, job, { restore });
          await atomicJson(restorePath, restore, 0o600);
        }
        return restore;
      });
    },
    clearRollbackFailure() {
      return exclusive(async () => {
        const restore = await readRestore();
        if (!restore) throw new Error('There is no restore to clear.');
        if (restore.phase !== 'failed' || restore.errorCode !== 'rollback_failed') {
          throw new Error('Only a restore whose safety backup could not be put back can be cleared.');
        }
        // A rename keeps the record's mode, beside the original, named by when it ended.
        const keptAs = join(config.stateDirectory, `restore-job.${restore.finishedAt!.replace(/[-:.]/g, '')}.json`);
        await rename(restorePath, keptAs);
        await writeStatus(await readInstalled(), await readJob());
        return { restore, keptAs };
      });
    },
  };
}

/**
 * The public maintenance marker for a backup or a restore: the very phase an update writes there,
 * so the app refuses writes the same way, and in the update job's exact shape, which every app
 * since 1.0 parses. Only status.json carries it; /v1/status keeps answering with the last update.
 */
function maintenanceMarker(source: { id: string; startedAt: string }, phase: UpdatePhase, installed: InstalledState): PublicUpdateJob {
  return {
    id: source.id, targetVersion: installed.version, phase, completedSteps: completedSteps[phase]!, totalSteps: 8,
    message: messages[phase], startedAt: source.startedAt, finishedAt: null, errorCode: null, backupCreatedAt: null,
  };
}

/**
 * The marker a restore holds up, or null for none. Verifying stops nothing, so it has none. A
 * restore whose safety backup could not be put back keeps one after it has ended: the database is
 * in a state no one knows, and nothing may write to it.
 */
function restoreMarkerPhase(restore: RestoreJob): UpdatePhase | null {
  if (restore.phase === 'failed' && restore.errorCode === 'rollback_failed') return 'migrating';
  return restoreMarkerPhases[restore.phase] ?? null;
}

function parseRestore(value: unknown): RestoreJob {
  if (!isRecord(value) || !hasExactKeys(value, restoreKeys) || !uuid(value.id) ||
    typeof value.phase !== 'string' || !Object.hasOwn(restoreTransitions, value.phase) ||
    !isoDate(value.startedAt) || !(value.finishedAt === null || isoDate(value.finishedAt)) ||
    restoreTerminal.has(value.phase as RestorePhase) !== (value.finishedAt !== null) ||
    !(typeof value.backupDirectory === 'string' && isAbsolute(value.backupDirectory)) ||
    !(value.safetyBackupDirectory === null || (typeof value.safetyBackupDirectory === 'string' && isAbsolute(value.safetyBackupDirectory))) ||
    typeof value.migrated !== 'boolean' ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && /^[a-z][a-z0-9_]*$/.test(value.errorCode)))) {
    throw new Error('Invalid restore job state');
  }
  return { ...value, report: value.report === null ? null : parseRestoreReport(value.report) } as unknown as RestoreJob;
}

/** A restore report, exactly: `after-restore`'s receipt, which the CLI prints. */
export function parseRestoreReport(value: unknown): RestoreReport {
  const name = (entry: unknown) => typeof entry === 'string' && entry.length > 0 && entry.length <= 200;
  if (!isRecord(value) || !hasExactKeys(value, ['records', 'sealedSecrets', 'unopenedSecrets']) ||
    !Number.isSafeInteger(value.sealedSecrets) || (value.sealedSecrets as number) < 0 ||
    !Array.isArray(value.unopenedSecrets) || value.unopenedSecrets.length > 1000 ||
    !value.unopenedSecrets.every((entry) => isRecord(entry) && hasExactKeys(entry, ['plugin', 'setting']) &&
      name(entry.plugin) && name(entry.setting))) throw new Error('Invalid restore report');
  return {
    records: parseBackupRecordCounts(value.records),
    sealedSecrets: value.sealedSecrets as number,
    unopenedSecrets: (value.unopenedSecrets as Array<{ plugin: string; setting: string }>).map(({ plugin, setting }) => ({ plugin, setting })),
  };
}

function parseBackup(value: unknown): BackupJob {
  if (!isRecord(value) || !hasExactKeys(value, backupKeys) || !uuid(value.id) ||
    !backupKinds.has(value.kind as string) || typeof value.phase !== 'string' || !Object.hasOwn(backupTransitions, value.phase) ||
    !isoDate(value.startedAt) || !(value.finishedAt === null || isoDate(value.finishedAt)) ||
    backupTerminal.has(value.phase as BackupPhase) !== (value.finishedAt !== null) ||
    !(value.backupDirectory === null || (typeof value.backupDirectory === 'string' && isAbsolute(value.backupDirectory))) ||
    !(value.sizeBytes === null || (Number.isSafeInteger(value.sizeBytes) && (value.sizeBytes as number) >= 0)) ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && /^[a-z][a-z0-9_]*$/.test(value.errorCode)))) {
    throw new Error('Invalid backup job state');
  }
  return { ...value } as unknown as BackupJob;
}

export function toPublicUpdateJob(job: UpdateJob): PublicUpdateJob {
  const {
    id, targetVersion, phase, completedSteps: completed, totalSteps, message,
    startedAt, finishedAt, errorCode, backupCreatedAt,
  } = job;
  return {
    id, targetVersion, phase, completedSteps: completed, totalSteps, message,
    startedAt, finishedAt, errorCode, backupCreatedAt,
  };
}

function validTransition(from: UpdatePhase, to: UpdatePhase): boolean {
  if (from === 'rolling_back') return to === 'rolled_back' || to === 'failed_manual_recovery';
  return forwardPhases[from] === to || to === 'rolling_back' || to === 'failed_manual_recovery';
}

function parseInstalled(value: unknown): InstalledState {
  if (!isRecord(value) || !hasExactKeys(value, installedKeys)) throw invalidInstalled();
  try {
    parseStableVersion(value.version);
  } catch {
    throw invalidInstalled();
  }
  if (!digest(value.imageDigest) || value.composeContract !== 1 || value.environmentContract !== 1 ||
    value.updaterProtocol !== 1 || !isoDate(value.installedAt)) throw invalidInstalled();
  return { ...value } as unknown as InstalledState;
}

function parseJob(input: unknown): UpdateJob {
  if (!isRecord(input)) throw invalidJob();
  const value: Record<string, unknown> = hasExactKeys(input, legacyJobKeys) ? { ...input, timeline: [], backupKind: null } : input;
  if (!hasExactKeys(value, jobKeys)) throw invalidJob();
  if (!(value.backupKind === null || backupKinds.has(value.backupKind as string)) || !validTimeline(value.timeline)) throw invalidJob();
  try {
    parseStableVersion(value.targetVersion);
    parseStableVersion(value.previousVersion);
  } catch {
    throw invalidJob();
  }
  const phase = value.phase as UpdatePhase;
  if (!uuid(value.id) || !uuid(value.requestId) || !digest(value.previousImageDigest) ||
    !(value.targetImageDigest === null || digest(value.targetImageDigest)) ||
    !phases.includes(phase) ||
    !Number.isSafeInteger(value.completedSteps) || (value.completedSteps as number) < 0 ||
    (value.completedSteps as number) > 8 || value.totalSteps !== 8 ||
    value.message !== messages[phase] || !isoDate(value.startedAt) ||
    !(value.finishedAt === null || isoDate(value.finishedAt)) ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && /^[a-z][a-z0-9_]*$/.test(value.errorCode))) ||
    !(value.backupDirectory === null || (typeof value.backupDirectory === 'string' && isAbsolute(value.backupDirectory))) ||
    !(value.backupCreatedAt === null || isoDate(value.backupCreatedAt))) throw invalidJob();
  const expectedCompleted = completedSteps[phase];
  if ((expectedCompleted !== null && value.completedSteps !== expectedCompleted) ||
    terminalPhases.has(phase) !== (value.finishedAt !== null)) throw invalidJob();
  return { ...value } as unknown as UpdateJob;
}

function validTimeline(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 64 && value.every((entry) => isRecord(entry) &&
    hasExactKeys(entry, ['phase', 'at']) && phases.includes(entry.phase as UpdatePhase) && isoDate(entry.at));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function atomicJson(path: string, value: unknown, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${path.split('/').at(-1)}.${randomUUID()}`);
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporaryPath, path);
  await chmod(path, mode);
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function hasExactSubset(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasCode(value: unknown, code: string): boolean {
  return value instanceof Error && 'code' in value && value.code === code;
}

function invalidInstalled(): Error {
  return new Error('Invalid installed state');
}

function invalidJob(): Error {
  return new Error('Invalid update job state');
}
