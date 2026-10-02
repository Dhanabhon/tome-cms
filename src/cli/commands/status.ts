import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseBackupManifest } from '../../update/backup.js';
import { composePrefix, directorySize } from '../../updater/transaction.js';
import type { CliContext } from '../main.js';
import { formatAge, formatBytes, localTime } from '../output.js';
import { isBackupStuck, readBackup, readStatus, stuckBackupAdvice, UpdaterUnreachableError, type UpdaterStatus } from '../socket.js';

export interface StatusReport {
  versions: { app: string; updater: string } | null;
  site: { ready: boolean; status: string; migrations: string | null };
  containers: Array<{ service: string; state: string; health: string | null }> | null;
  disk: { path: string; freeBytes: number | null; minimumFreeBytes: number; low: boolean };
  lastUpdate: { version: string; phase: string; errorCode: string | null; finishedAt: string | null } | null;
  newestBackup: { path: string; kind: 'database' | 'full'; sizeBytes: number; createdAt: string } | null;
  runningBackup: { id: string; kind: string; phase: string; startedAt: string; stuck: boolean } | null;
}

const services = ['app', 'postgres', 'seaweedfs'];

/** One screen, read-only. It fails (exit 1) only when the updater does not answer. */
export async function status(context: CliContext, options: { json: boolean }): Promise<number> {
  const [updater, site, containers, disk, newestBackup] = await Promise.all([
    readUpdater(context), readSite(context), readContainers(context), readDisk(context), readNewestBackup(context.config.backupDirectory),
  ]);
  const report: StatusReport = {
    versions: updater && { app: updater.status.installed.version, updater: updater.status.updaterVersion },
    site, containers, disk,
    lastUpdate: updater?.status.job ? {
      version: updater.status.job.targetVersion, phase: updater.status.job.phase,
      errorCode: updater.status.job.errorCode, finishedAt: updater.status.job.finishedAt,
    } : null,
    newestBackup,
    runningBackup: updater?.runningBackup ?? null,
  };
  if (options.json) context.print(JSON.stringify(report));
  else printReport(context, report);
  return updater ? 0 : 1;
}

async function readUpdater(context: CliContext): Promise<{ status: UpdaterStatus; runningBackup: StatusReport['runningBackup'] } | null> {
  try {
    const [status, backup] = await Promise.all([readStatus(context.socket), readBackup(context.socket)]);
    if (!backup || backup.phase === 'succeeded' || backup.phase === 'failed') return { status, runningBackup: null };
    const stuck = await isBackupStuck(context.socket, backup);
    return { status, runningBackup: { id: backup.id, kind: backup.kind, phase: backup.phase, startedAt: backup.startedAt, stuck } };
  } catch (error) {
    if (error instanceof UpdaterUnreachableError) return null;
    throw error;
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

/** The most recently written backup with a manifest that reads; one still being written has none yet. */
async function readNewestBackup(root: string): Promise<StatusReport['newestBackup']> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const directories = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const path = join(root, entry.name);
    return { path, modified: (await lstat(path)).mtimeMs };
  }));
  for (const { path } of directories.sort((left, right) => right.modified - left.modified)) {
    try {
      const manifest = parseBackupManifest(JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')));
      return { path, kind: manifest.scope === 'database' ? 'database' : 'full', sizeBytes: await directorySize(path), createdAt: manifest.createdAt };
    } catch {
      // Not a finished backup; try the one before.
    }
  }
  return null;
}

function printReport(context: CliContext, report: StatusReport): void {
  const { print } = context;
  if (report.versions) print(`TomeCMS ${report.versions.app}, updater ${report.versions.updater}`);
  else print(`Updater: did not answer at ${context.config.socketPath}. Check it with: sudo systemctl status tomecms-updater`);

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

  const backup = report.newestBackup;
  print(backup
    ? `Newest backup: ${backup.kind}, ${formatBytes(backup.sizeBytes)}, ${formatAge(backup.createdAt, context.now())} (${backup.path})`
    : 'Newest backup: none');
}
