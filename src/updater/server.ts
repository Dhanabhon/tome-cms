import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { lstat, unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';

import { parseStableVersion } from '../update/contracts.js';
import { toPublicUpdateJob, type UpdateJob, type UpdaterStateStore } from './state.js';

export interface ApplyRequest {
  version: string;
  requestId: string;
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
}): ReturnType<typeof createServer> {
  let active = false;
  return createServer(async (request, response) => {
    try {
      if (request.url === '/v1/status' && request.method === 'GET') {
        return json(response, 200, await publicStatus(input.state));
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
              }
            }).catch(() => { console.error('Updater recovery state could not be persisted'); })
              .finally(() => { active = false; });
          }
          return;
        } finally {
          if (!dispatched) active = false;
        }
      }
      if (request.url === '/v1/status' || request.url === '/v1/apply') {
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
    updaterVersion: '1.0.0',
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
