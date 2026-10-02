import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { lstat, unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';

import { parseStableVersion } from '../update/contracts.js';
import type { PruneResult } from './prune.js';
import { toPublicUpdateJob, type BackupJob, type BackupKind, type UpdateJob, type UpdaterStateStore } from './state.js';
import { InsufficientDiskSpaceError } from './verify.js';
import { UPDATER_VERSION } from './version.js';

export interface ApplyRequest {
  version: string;
  requestId: string;
}

export interface BackupRequest {
  requestId: string;
  kind: BackupKind;
}

const bodyLimit = 4 * 1024;

export async function removeStaleUpdaterSocket(path: string): Promise<void> {
  let metadata;
  try { metadata = await lstat(path); } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!metadata.isSocket()) throw new Error('Updater socket path is not a socket');
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(path);
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); reject(new Error('Updater is already listening')); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Updater socket probe timed out')); });
    socket.once('error', (error) => {
      socket.destroy();
      if ('code' in error && error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
  const current = await lstat(path);
  if (!current.isSocket() || current.ino !== metadata.ino || current.dev !== metadata.dev) {
    throw new Error('Updater socket changed during startup');
  }
  await unlink(path);
}

export function createUpdaterServer(input: {
  state: UpdaterStateStore;
  apply: (request: ApplyRequest) => Promise<UpdateJob>;
  execute?: (request: ApplyRequest) => Promise<UpdateJob>;
  backup?: {
    /** Refuses before anything starts, as the update preflight does: a disk below the minimum. */
    check: () => Promise<void>;
    /** Runs a backup created in `quiescing` to its end; it always starts the app again. */
    run: (job: BackupJob) => Promise<unknown>;
  };
  prune?: (request: { dryRun: boolean }) => Promise<PruneResult | null>;
}): ReturnType<typeof createServer> {
  // The one lock: an update, a backup and a prune never overlap.
  let active = false;
  return createServer(async (request, response) => {
    try {
      if (request.url === '/v1/status' && request.method === 'GET') {
        return json(response, 200, await publicStatus(input.state));
      }
      if (request.url === '/v1/busy' && request.method === 'GET') {
        // Whether an update, a backup or a prune holds the lock. It only reads the flag.
        return json(response, 200, { busy: active });
      }
      if (request.url === '/v1/timeline' && request.method === 'GET') {
        // Kept off /v1/status on purpose: an app from before 1.3.0 parses that strictly.
        const job = await input.state.readJob();
        if (!job) return json(response, 404, { error: 'not_found' });
        return json(response, 200, { jobId: job.id, backupKind: job.backupKind, timeline: job.timeline });
      }
      if (request.url === '/v1/apply' && request.method === 'POST') {
        const applyRequest = parseApplyRequest(await readBody(request));
        if (active) return json(response, 409, { error: 'update_in_progress' });
        active = true;
        let dispatched = false;
        try {
          const current = await input.state.readJob();
          if (current?.phase === 'failed_manual_recovery') return json(response, 409, { error: 'manual_recovery_required' });
          if (current && !isTerminal(current.phase)) return json(response, 409, { error: 'update_in_progress' });
          if ((await input.state.readInstalled()).version === applyRequest.version) {
            return json(response, 200, await publicStatus(input.state));
          }
          const job = await input.apply(applyRequest);
          json(response, 202, toPublicUpdateJob(job));
          if (input.execute) {
            dispatched = true;
            // Reserve durably before 202; run independently of the request/socket lifetime.
            void Promise.resolve().then(() => input.execute!(applyRequest)).catch(async () => {
              const latest = await input.state.readJob();
              if (latest?.id === job.id && !isTerminal(latest.phase)) {
                await input.state.transitionJob(job.id, 'failed_manual_recovery', { errorCode: 'manual_recovery_required' });
              } else if (latest?.id === job.id) {
                await input.state.refreshStatus();
              }
            }).catch(async (error) => {
              const latest = await input.state.readJob();
              if (latest?.id === job.id && isTerminal(latest.phase)) return input.state.refreshStatus();
              throw error;
            }).catch(() => { console.error('Updater recovery state could not be persisted'); })
              .finally(() => { active = false; });
          }
          return;
        } finally {
          if (!dispatched) active = false;
        }
      }
      if (request.url === '/v1/backup' && request.method === 'GET' && input.backup) {
        // Its own route and state: /v1/status is the update's, and older apps parse it strictly.
        const backup = await input.state.readBackup();
        return backup ? json(response, 200, backup) : json(response, 404, { error: 'not_found' });
      }
      if (request.url === '/v1/backup' && request.method === 'POST' && input.backup) {
        const backupRequest = parseBackupRequest(await readBody(request));
        // A request sent again is answered from its record and starts nothing: 202 while it runs,
        // and the record, as GET gives it, once it has ended.
        const known = await input.state.readBackup();
        if (known?.id === backupRequest.requestId) {
          return known.phase === 'succeeded' || known.phase === 'failed'
            ? json(response, 200, known) : json(response, 202, { id: known.id, phase: known.phase });
        }
        if (active) return json(response, 409, { error: 'update_in_progress' });
        active = true;
        let dispatched = false;
        try {
          try {
            await input.backup.check();
          } catch (error) {
            if (error instanceof InsufficientDiskSpaceError) return json(response, 409, { error: 'insufficient_disk_space' });
            throw error;
          }
          // Refused, as a 409, while an update is active or waits for manual recovery.
          const backup = await input.state.createBackup({ id: backupRequest.requestId, kind: backupRequest.kind });
          json(response, 202, { id: backup.id, phase: backup.phase });
          dispatched = true;
          void Promise.resolve().then(() => input.backup!.run(backup)).catch(async () => {
            // Only a record that could not be written reaches here; the app has been started again.
            // If ending it fails too, the record stays active and keeps refusing other jobs.
            const latest = await input.state.readBackup();
            if (latest?.id === backup.id && latest.phase !== 'succeeded' && latest.phase !== 'failed') {
              await input.state.transitionBackup(backup.id, 'failed', { errorCode: 'backup_failed' });
            } else {
              await input.state.refreshStatus();
            }
          }).catch(() => { console.error('Updater backup state could not be persisted'); })
            .finally(() => { active = false; });
          return;
        } finally {
          if (!dispatched) active = false;
        }
      }
      if (request.url === '/v1/prune' && request.method === 'POST' && input.prune) {
        const pruneRequest = parsePruneRequest(await readBody(request));
        if (active) return json(response, 409, { error: 'update_in_progress' });
        active = true;
        try {
          const result = await input.prune(pruneRequest);
          return result ? json(response, 200, result) : json(response, 503, { error: 'image_listing_unreadable' });
        } finally {
          active = false;
        }
      }
      if (['/v1/status', '/v1/apply', '/v1/timeline', '/v1/busy', '/v1/backup', '/v1/prune'].includes(request.url ?? '')) {
        return json(response, 405, { error: 'method_not_allowed' });
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof RequestError) return json(response, error.status, { error: error.code });
      if (error instanceof Error && /already active/i.test(error.message)) {
        return json(response, 409, { error: 'update_in_progress' });
      }
      if (error instanceof Error && /manual recovery/i.test(error.message)) {
        return json(response, 409, { error: 'manual_recovery_required' });
      }
      return json(response, 500, { error: 'updater_unavailable' });
    }
  });
}

async function publicStatus(state: UpdaterStateStore): Promise<unknown> {
  const [installed, job] = await Promise.all([state.readInstalled(), state.readJob()]);
  return {
    protocolVersion: 1,
    updaterVersion: UPDATER_VERSION,
    managed: true,
    installed: { version: installed.version, imageDigest: installed.imageDigest },
    job: job ? toPublicUpdateJob(job) : null,
  };
}

function parseApplyRequest(value: unknown): ApplyRequest {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'requestId']) || !uuid(value.requestId)) {
    throw new RequestError(400, 'invalid_request');
  }
  try {
    return { version: parseStableVersion(value.version).raw, requestId: value.requestId };
  } catch {
    throw new RequestError(400, 'invalid_request');
  }
}

function parseBackupRequest(value: unknown): BackupRequest {
  if (!isRecord(value) || !hasExactKeys(value, ['requestId', 'kind']) || !uuid(value.requestId) ||
    (value.kind !== 'database' && value.kind !== 'full')) throw new RequestError(400, 'invalid_request');
  return { requestId: value.requestId, kind: value.kind };
}

function parsePruneRequest(value: unknown): { dryRun: boolean } {
  if (!isRecord(value) || !hasExactKeys(value, ['dryRun']) || typeof value.dryRun !== 'boolean') {
    throw new RequestError(400, 'invalid_request');
  }
  return { dryRun: value.dryRun };
}

function readBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) {
    request.resume();
    throw new RequestError(413, 'request_too_large');
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > bodyLimit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (tooLarge) return reject(new RequestError(413, 'request_too_large'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks, length).toString('utf8')));
      } catch {
        reject(new RequestError(400, 'invalid_request'));
      }
    });
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTerminal(phase: UpdateJob['phase']): boolean {
  return phase === 'succeeded' || phase === 'rolled_back' || phase === 'failed_manual_recovery';
}

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}
