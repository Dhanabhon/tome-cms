import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseBackupManifest } from '../../update/backup.js';
import { composePrefix } from '../../updater/config.js';
import { directorySize, readManifestBytes } from '../../updater/files.js';
import type { CliContext } from '../main.js';
import { formatAge, formatBytes, localTime, manualRecovery, printable } from '../output.js';
import {
  isBackupStuck, isRestoreKeptInMaintenance, isRestoreRunning, isRestoreStuck, readBackup, readRestore, readStatus, stuckBackupAdvice,
  stuckRestoreAdvice, UnexpectedAnswerError, UpdaterUnreachableError, type UpdaterStatus,
} from '../socket.js';

export interface StatusReport {
  versions: { app: string; updater: string } | null;
  /** Why the updater could not be read, when it could not. */
  updaterError: string | null;
  site: { ready: boolean; status: string; migrations: string | null };
  containers: Array<{ service: string; state: string; health: string | null }> | null;
  disk: { path: string; freeBytes: number | null; minimumFreeBytes: number; low: boolean };
  lastUpdate: { version: string; phase: string; errorCode: string | null; finishedAt: string | null } | null;
  newestBackup: { path: string; kind: 'database' | 'full'; sizeBytes: number; createdAt: string } | null;
  runningBackup: { id: string; kind: string; phase: string; startedAt: string; stuck: boolean } | null;
  /** A restore that is running, or one that failed and keeps the site in maintenance; null otherwise. */
  restore: {
    id: string; phase: string; startedAt: string; errorCode: string | null; backupDirectory: string;
    safetyBackupDirectory: string | null; maintenanceKept: boolean; stuck: boolean;
  } | null;
}

const services = ['app', 'postgres', 'seaweedfs'];
// The name scripts/backup.ts gives each backup: tomecms-<its ISO time without - : .>. Nothing else there is read.
const backupNamePattern = /^tomecms-\d{8}T\d{9}Z$/;

/** One screen, read-only. It fails (exit 1) only when the updater cannot be read. */
export async function status(context: CliContext, options: { json: boolean }): Promise<number> {
  const [updater, site, containers, disk, newestBackup] = await Promise.all([
    readUpdater(context), readSite(context), readContainers(context), readDisk(context), readNewestBackup(context.config.backupDirectory),
  ]);
  const read = 'error' in updater ? null : updater;
  const report: StatusReport = {
    versions: read && { app: read.status.installed.version, updater: read.status.updaterVersion },
    updaterError: 'error' in updater ? updater.error : null,
    site, containers, disk,
    lastUpdate: read?.status.job ? {
      version: read.status.job.targetVersion, phase: read.status.job.phase,
      errorCode: read.status.job.errorCode, finishedAt: read.status.job.finishedAt,
    } : null,
    newestBackup,
    runningBackup: read?.runningBackup ?? null,
    restore: read?.restore ?? null,
  };
  if (options.json) context.print(JSON.stringify(report));
  else printReport(context, report);
  return read ? 0 : 1;
}

/** The updater's side, or why it could not be read: this is the screen for a sick server, so nothing here stops it. */
async function readUpdater(context: CliContext): Promise<{
  status: UpdaterStatus; runningBackup: StatusReport['runningBackup']; restore: StatusReport['restore'];
} | { error: string }> {
  try {
    const [status, backup, restore] = await Promise.all([readStatus(context.socket), readBackup(context.socket), readRestore(context.socket)]);
    const shown = isRestoreRunning(restore) || isRestoreKeptInMaintenance(restore) ? {
      id: restore!.id, phase: restore!.phase, startedAt: restore!.startedAt, errorCode: restore!.errorCode,
      backupDirectory: restore!.backupDirectory, safetyBackupDirectory: restore!.safetyBackupDirectory,
      maintenanceKept: restore!.maintenanceKept, stuck: await isRestoreStuck(context.socket, restore),
    } : null;
    if (!backup || backup.phase === 'succeeded' || backup.phase === 'failed') return { status, runningBackup: null, restore: shown };
    const stuck = await isBackupStuck(context.socket, backup);
    return { status, runningBackup: { id: backup.id, kind: backup.kind, phase: backup.phase, startedAt: backup.startedAt, stuck }, restore: shown };
  } catch (error) {
    if (error instanceof UpdaterUnreachableError) {
      return { error: `did not answer at ${context.config.socketPath}. Check it with: sudo systemctl status tomecms-updater` };
    }
    const reason = error instanceof UnexpectedAnswerError ? error.message : `could not be read (${error instanceof Error ? error.message : String(error)})`;
    return { error: `${reason}. Check it with: sudo tome logs updater` };
  }
}

async function readSite(context: CliContext): Promise<StatusReport['site']> {
  let response: Response;
  try {
    response = await context.fetch(context.config.appHealthUrl, { signal: AbortSignal.timeout(5_000) });
  } catch {
    return { ready: false, status: 'unreachable', migrations: null };
  }
  // The app answers { status, checks: { migrations, … } }; read what is there, and no more.
  const body = await response.json().catch(() => null) as { status?: unknown; checks?: { migrations?: unknown } } | null;
  const status = typeof body?.status === 'string' ? body.status : response.ok ? 'ready' : 'not-ready';
  const migrations = typeof body?.checks?.migrations === 'string' ? body.checks.migrations : null;
  return { ready: response.ok && status === 'ready', status, migrations };
}

async function readContainers(context: CliContext): Promise<StatusReport['containers']> {
  const result = await context.runCommand('docker', [...composePrefix(context.config), 'ps', '--all', '--format', 'json'], { timeoutMs: 30_000 })
    .catch(() => null);
  if (!result || result.code !== 0) return null;
  let rows: unknown[];
  try {
    // Compose 2.21 and later print one object per line; earlier ones print one array.
    const text = result.stdout.trim();
    rows = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return null;
  }
  return services.map((service) => {
    const row = rows.find((candidate): candidate is Record<string, unknown> =>
      typeof candidate === 'object' && candidate !== null && (candidate as Record<string, unknown>).Service === service);
    if (!row) return { service, state: 'missing', health: null };
    return { service, state: String(row.State ?? 'unknown'), health: typeof row.Health === 'string' && row.Health ? row.Health : null };
  });
}

async function readDisk(context: CliContext): Promise<StatusReport['disk']> {
  const { backupDirectory: path, minimumFreeBytes } = context.config;
  const filesystem = await context.statfs(path).catch(() => null);
  const freeBytes = filesystem ? filesystem.bsize * filesystem.bavail : null;
  return { path, freeBytes, minimumFreeBytes, low: freeBytes !== null && freeBytes < minimumFreeBytes };
}

/**
 * The backup whose manifest says it was made last. A directory with no manifest that reads (one still
 * being written, one that has gone, or a manifest that is a link) is passed over. The manifests are
 * read as the updater reads them: no links, regular files, 32 MiB at most.
 */
async function readNewestBackup(root: string): Promise<StatusReport['newestBackup']> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  // ponytail: every manifest is read to compare dates; keep an index if servers hold hundreds of backups.
  const backups = await Promise.all(entries.filter((entry) => entry.isDirectory() && backupNamePattern.test(entry.name)).map(async (entry) => {
    const path = join(root, entry.name);
    try {
      return { path, manifest: parseBackupManifest(JSON.parse((await readManifestBytes(path)).toString('utf8'))) };
    } catch {
      return null;
    }
  }));
  const newest = backups.filter((backup) => backup !== null)
    .sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt))[0];
  if (!newest) return null;
  const sizeBytes = await directorySize(newest.path).catch(() => null);
  if (sizeBytes === null) return null;
  return { path: newest.path, kind: newest.manifest.scope === 'database' ? 'database' : 'full', sizeBytes, createdAt: newest.manifest.createdAt };
}

function printReport(context: CliContext, report: StatusReport): void {
  const { print } = context;
  if (report.versions) print(`TomeCMS ${report.versions.app}, updater ${report.versions.updater}`);
  else print(`Updater: ${report.updaterError}`);

  const { site } = report;
  print(`Site: ${site.status}${site.migrations ? ` (migrations: ${site.migrations})` : ''}`);

  if (report.containers) {
    print('Containers:');
    for (const container of report.containers) {
      print(`  ${container.service.padEnd(10)} ${container.state}${container.health ? `, ${container.health}` : ''}`);
    }
  } else {
    print('Containers: could not be listed. Is Docker running? Check with: sudo systemctl status docker');
  }

  const { disk } = report;
  print(`Free disk where backups go: ${disk.freeBytes === null ? 'unknown' : formatBytes(disk.freeBytes)} (${disk.path})`);
  if (disk.low && disk.freeBytes !== null) {
    print(`Warning: only ${formatBytes(disk.freeBytes)} free where backups go; updates and backups need ${formatBytes(disk.minimumFreeBytes)}. ` +
      'See which old images can go with: sudo tome prune');
  }

  if (report.versions) {
    const update = report.lastUpdate;
    print(update
      ? `Last update: ${update.version} ${update.phase}${update.errorCode ? ` (${update.errorCode})` : ''}${update.finishedAt ? `, finished ${localTime(update.finishedAt)}` : ''}`
      : 'Last update: none');
  }

  const running = report.runningBackup;
  if (running?.stuck) print(`Warning: ${stuckBackupAdvice(running.phase)}`);
  else if (running) print(`Backup running: ${running.kind}, at "${running.phase}" since ${localTime(running.startedAt)}`);

  const restore = report.restore;
  if (restore?.maintenanceKept) {
    print(`Warning: a restore failed (${printable(restore.errorCode ?? 'unknown')}) and keeps the site in maintenance.`);
    for (const line of manualRecovery(restore)) print(`  ${line}`);
  } else if (restore?.stuck) {
    print(`Warning: ${stuckRestoreAdvice(restore.phase)}`);
  } else if (restore) {
    print(`Restore running: at "${printable(restore.phase)}" since ${localTime(restore.startedAt)}`);
  }

  const backup = report.newestBackup;
  print(backup
    ? `Newest backup: ${backup.kind}, ${formatBytes(backup.sizeBytes)}, ${formatAge(backup.createdAt, context.now())} (${printable(backup.path)})`
    : 'Newest backup: none');
}
