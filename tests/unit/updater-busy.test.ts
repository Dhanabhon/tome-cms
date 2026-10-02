import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createUpdaterServer } from '../../src/updater/server.js';
import type { UpdaterStateStore } from '../../src/updater/state.js';

function call(socketPath: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = request({ socketPath, method, path, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}

test('GET /v1/busy says whether the lock is held, and takes no lock itself', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-busy-'));
  const socketPath = join(root, 'u.sock');
  let release!: () => void;
  let prunes = 0;
  // Only the prune route is used; no state is ever read, which a stub with nothing in it proves.
  const server = createUpdaterServer({
    state: {} as UpdaterStateStore,
    apply: async () => { throw new Error('unused'); },
    prune: async () => {
      prunes += 1;
      if (prunes === 1) await new Promise<void>((resolve) => { release = resolve; });
      return { candidates: [], removed: [] };
    },
  });
  server.listen(socketPath);
  await once(server, 'listening');
  t.after(async () => { server.close(); await rm(root, { recursive: true, force: true }); });

  assert.deepEqual(await call(socketPath, 'GET', '/v1/busy'), { status: 200, json: { busy: false } });
  // Asked many times, it never holds the lock: a job still starts at once.
  await Promise.all(Array.from({ length: 10 }, () => call(socketPath, 'GET', '/v1/busy')));
  const held = call(socketPath, 'POST', '/v1/prune', { dryRun: true });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await call(socketPath, 'GET', '/v1/busy'), { status: 200, json: { busy: true } });
  assert.deepEqual(await call(socketPath, 'POST', '/v1/prune', { dryRun: true }), { status: 409, json: { error: 'update_in_progress' } });
  release();
  assert.equal((await held).status, 200);
  assert.deepEqual(await call(socketPath, 'GET', '/v1/busy'), { status: 200, json: { busy: false } });
  assert.equal((await call(socketPath, 'POST', '/v1/prune', { dryRun: true })).status, 200);
  assert.deepEqual(await call(socketPath, 'POST', '/v1/busy', {}), { status: 405, json: { error: 'method_not_allowed' } });
});
