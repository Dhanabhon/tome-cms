import { request } from 'node:http';

import type { BackupJob, PublicUpdateJob, RestoreJob } from '../updater/state.js';
import { manualRecovery, printable } from './output.js';

export interface SocketAnswer {
  status: number;
  body: unknown;
}

/** One JSON request to the updater's socket. It throws `UpdaterUnreachableError` when nothing answers. */
export type SocketClient = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<SocketAnswer>;

export class UpdaterUnreachableError extends Error {
  constructor() { super('The updater did not answer'); }
}

/** The updater answered, but not with what was asked for: "it answered /v1/status with 500 (updater_unavailable)". */
export class UnexpectedAnswerError extends Error {
  constructor(path: string, answer: SocketAnswer) {
    const code = errorCodeOf(answer);
    super(`it answered ${path} with ${answer.status}${code ? ` (${code})` : ''}`);
  }
}

export interface UpdaterStatus {
  updaterVersion: string;
  installed: { version: string };
  job: PublicUpdateJob | null;
}

/**
 * How long a request may go without an answer. A prune answers only once Docker has listed and
 * removed every image (30 seconds, then up to a minute each), so it gets far longer.
 */
export const socketTimeouts = { timeoutMs: 10_000, pruneTimeoutMs: 600_000 } as const;

const responseLimit = 64 * 1024;
const updateTerminal = new Set(['succeeded', 'rolled_back', 'failed_manual_recovery']);
const backupTerminal = new Set(['succeeded', 'failed']);
const restoreTerminal = new Set(['succeeded', 'failed']);

export function unixSocketClient(socketPath: string, timeouts: { timeoutMs: number; pruneTimeoutMs: number } = socketTimeouts): SocketClient {
  return (method, path, body) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const timeout = method === 'POST' && path === '/v1/prune' ? timeouts.pruneTimeoutMs : timeouts.timeoutMs;
    const outgoing = request({
      socketPath, path, method, agent: false, timeout,
      headers: payload === undefined ? { accept: 'application/json' } : {
        accept: 'application/json', 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let length = 0;
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > responseLimit) outgoing.destroy(new Error('The updater answered with too much'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(new Error('The updater answered with something that is not JSON')); }
      });
    });
    outgoing.on('timeout', () => outgoing.destroy(new UpdaterUnreachableError()));
    outgoing.on('error', (error) => reject(error instanceof UpdaterUnreachableError || isConnectionError(error) ? new UpdaterUnreachableError() : error));
    outgoing.end(payload);
  });
}

export async function readStatus(socket: SocketClient): Promise<UpdaterStatus> {
  const answer = await socket('GET', '/v1/status');
  const body = answer.body as Partial<UpdaterStatus> | null;
  if (answer.status !== 200 || typeof body?.updaterVersion !== 'string' || typeof body.installed?.version !== 'string') {
    throw new UnexpectedAnswerError('/v1/status', answer);
  }
  return body as UpdaterStatus;
}

/** The last backup on request, or null before the first. */
export async function readBackup(socket: SocketClient): Promise<BackupJob | null> {
  const answer = await socket('GET', '/v1/backup');
  if (answer.status === 404) return null;
  const body = answer.body as Partial<BackupJob> | null;
  if (answer.status !== 200 || typeof body?.id !== 'string' || typeof body.phase !== 'string') {
    throw new UnexpectedAnswerError('/v1/backup', answer);
  }
  return body as BackupJob;
}

/** The last restore, or null before the first (and from an updater before 1.6.0, which has no such route). */
export async function readRestore(socket: SocketClient): Promise<RestoreJob | null> {
  const answer = await socket('GET', '/v1/restore');
  if (answer.status === 404) return null;
  const body = answer.body as Partial<RestoreJob> | null;
  if (answer.status !== 200 || typeof body?.id !== 'string' || typeof body.phase !== 'string') {
    throw new UnexpectedAnswerError('/v1/restore', answer);
  }
  return body as RestoreJob;
}

export function isRestoreRunning(restore: Pick<RestoreJob, 'phase'> | null): boolean {
  return restore !== null && !restoreTerminal.has(restore.phase);
}

/** A restore that ended with the site in maintenance and the app stopped, which refuses every job. */
export function isRestoreKeptInMaintenance(restore: Pick<RestoreJob, 'phase' | 'maintenanceKept'> | null): boolean {
  return restore?.phase === 'failed' && restore.maintenanceKept === true;
}

export function isBackupRunning(backup: Pick<BackupJob, 'phase'> | null): boolean {
  return backup !== null && !backupTerminal.has(backup.phase);
}

export function isUpdateRunning(job: Pick<PublicUpdateJob, 'phase'> | null): boolean {
  return job !== null && !updateTerminal.has(job.phase);
}

export function errorCodeOf(answer: SocketAnswer): string | null {
  const error = (answer.body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : null;
}

/**
 * POSTs a job. The updater lets go of its lock a tick after a job's last record is written, so a
 * request just after one ends can get 409 `update_in_progress` once. While no record says a job is
 * running, that is tried again a few times. The body, request id included, is the same each time,
 * so a retry can never start a second job.
 */
export async function postJob(socket: SocketClient, sleep: (ms: number) => Promise<void>, path: string, body: unknown): Promise<SocketAnswer> {
  for (let attempt = 1; ; attempt += 1) {
    const answer = await socket('POST', path, body);
    if (answer.status !== 409 || errorCodeOf(answer) !== 'update_in_progress' || attempt === 5) return answer;
    const [status, backup, restore] = await Promise.all([readStatus(socket), readBackup(socket), readRestore(socket)]);
    if (isUpdateRunning(status.job) || isBackupRunning(backup) || isRestoreRunning(restore)) return answer;
    await sleep(200);
  }
}

/**
 * Reads a job every second until `ended` says so, printing a line each time its step changes. The
 * updater may restart under it (an upgrade, a crash); a minute without an answer gives up.
 */
export async function follow<T>(
  context: { sleep: (ms: number) => Promise<void>; print: (line: string) => void },
  read: () => Promise<T>,
  step: (item: T) => string | null,
  ended: (item: T) => boolean | Promise<boolean>,
): Promise<T> {
  let shown: string | null = null;
  for (let misses = 0; ;) {
    let item: T;
    try {
      item = await read();
      misses = 0;
    } catch (error) {
      if (!(error instanceof UpdaterUnreachableError) || ++misses > 60) throw error;
      await context.sleep(1_000);
      continue;
    }
    const line = step(item);
    if (line && line !== shown) context.print(line);
    shown = line ?? shown;
    if (await ended(item)) return item;
    await context.sleep(1_000);
  }
}

/**
 * Whether an update, a backup or a prune holds the updater's lock, from its read-only `/v1/busy`.
 * Null when it cannot say: an updater before 1.5.0 has no such route.
 */
export async function readBusy(socket: SocketClient): Promise<boolean | null> {
  const answer = await socket('GET', '/v1/busy');
  const busy = (answer.body as { busy?: unknown } | null)?.busy;
  return answer.status === 200 && typeof busy === 'boolean' ? busy : null;
}

/**
 * A backup record that is not at its end while nothing holds the lock: its last write failed, most
 * likely on a full disk, and the record keeps refusing other jobs until the updater starts again.
 * The record is read again once the lock is seen free, since a backup that just ended lets go of it.
 */
export function isBackupStuck(socket: SocketClient, backup: BackupJob | null): Promise<boolean> {
  return isStuck(socket, backup, isBackupRunning, readBackup);
}

/** The same for a restore: its end could not be written, and it would be followed forever. */
export function isRestoreStuck(socket: SocketClient, restore: RestoreJob | null): Promise<boolean> {
  return isStuck(socket, restore, isRestoreRunning, readRestore);
}

async function isStuck<T extends { id: string; phase: string }>(
  socket: SocketClient, record: T | null, running: (record: T | null) => boolean, read: (socket: SocketClient) => Promise<T | null>,
): Promise<boolean> {
  if (!running(record) || await readBusy(socket) !== false) return false;
  const again = await read(socket);
  return again?.id === record!.id && running(again);
}

export function stuckBackupAdvice(phase: string): string {
  return `A backup is stuck at "${phase}" with no job running: the updater could not write its end, most likely because the disk is full. ` +
    'Free some space (sudo tome prune shows old images that can go), then run: sudo systemctl restart tomecms-updater';
}

export function stuckRestoreAdvice(phase: string): string {
  return `A restore is stuck at "${printable(phase)}" with no job running: the updater could not write its record, most likely because the disk is full. ` +
    'Free some space (sudo tome prune shows old images that can go), then run: sudo systemctl restart tomecms-updater. ' +
    'When it starts again, it ends the restore and puts the site back as it was before.';
}

/** What to tell the owner when the updater refuses a job. */
export async function refusal(socket: SocketClient, answer: SocketAnswer): Promise<string | null> {
  const code = errorCodeOf(answer);
  if (code === 'update_in_progress') {
    const backup = await readBackup(socket).catch(() => null);
    if (await isBackupStuck(socket, backup).catch(() => false)) return stuckBackupAdvice(backup!.phase);
    const restore = await readRestore(socket).catch(() => null);
    if (await isRestoreStuck(socket, restore).catch(() => false)) return stuckRestoreAdvice(restore!.phase);
    // A prune holds the lock too, and leaves no record; tome status shows the others.
    const job = await readStatus(socket).then((status) => status.job, () => null);
    const shown = isUpdateRunning(job) || isBackupRunning(backup) || isRestoreRunning(restore) ? '; sudo tome status shows it' : '';
    return `An update, a backup, a restore or an image clean-up is running. Wait for it to finish, then try again${shown}.`;
  }
  if (code === 'manual_recovery_required') {
    const restore = await readRestore(socket).catch(() => null);
    if (isRestoreKeptInMaintenance(restore)) {
      return ['An earlier restore failed and keeps the site in maintenance, so nothing else can run until it is recovered.', ...manualRecovery(restore!)].join('\n');
    }
    return 'The last update needs manual recovery before anything else can run. Follow "Troubleshooting" in the TomeCMS documentation.';
  }
  return null;
}

function isConnectionError(error: Error): boolean {
  return 'code' in error && ['ENOENT', 'ECONNREFUSED', 'EACCES', 'ECONNRESET'].includes(String(error.code));
}

/** `tome logs -f | head`: once the reader has gone, there is nobody to tell, so tome ends quietly. */
export function exitQuietlyOnClosedPipe(
  stream: { on(event: 'error', handler: (error: NodeJS.ErrnoException) => void): unknown },
  exit: (code: number) => void,
): void {
  stream.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
    exit(0);
  });
}
