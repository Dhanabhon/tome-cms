import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { UpdaterConfig } from '../../src/updater/config.js';
import { runCommand } from '../../src/updater/process.js';
import { createUpdaterServer } from '../../src/updater/server.js';
import { createUpdaterStateStore, type InstalledState } from '../../src/updater/state.js';

const installed: InstalledState = {
  version: '1.0.0', imageDigest: `sha256:${'a'.repeat(64)}`,
  composeContract: 1, environmentContract: 1, updaterProtocol: 1,
  installedAt: '2026-09-20T10:00:00.000Z',
};

test('exposes only bounded status and exact apply requests over the Unix socket', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'tomecms-updater-server-'));
  const socketPath = join(root, 'updater.sock');
  const state = createUpdaterStateStore({
    stateDirectory: join(root, 'state'), statusPath: join(root, 'status.json'),
  } as UpdaterConfig);
  await state.writeInstalled(installed);
  const applied: unknown[] = [];
  const server = createUpdaterServer({
    state,
    apply: async (input) => {
      applied.push(input);
      return state.createJob({ requestId: input.requestId, targetVersion: input.version });
    },
  });
  server.listen(socketPath);
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const status = await unixRequest(socketPath, 'GET', '/v1/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.json, {
    protocolVersion: 1, updaterVersion: '1.0.0', managed: true,
    installed: { version: '1.0.0', imageDigest: installed.imageDigest }, job: null,
  });

  const alreadyInstalled = await unixRequest(socketPath, 'POST', '/v1/apply', {
    version: '1.0.0', requestId: crypto.randomUUID(),
  });
  assert.equal(alreadyInstalled.status, 200);
  assert.deepEqual(alreadyInstalled.json, status.json);
  assert.deepEqual(applied, []);

  const apply = { version: '1.0.1', requestId: '2cb65d31-2210-4cee-ab70-df64178948de' };
  assert.equal((await unixRequest(socketPath, 'POST', '/v1/apply', apply)).status, 202);
  assert.deepEqual(applied, [apply]);
  assert.equal((await unixRequest(socketPath, 'POST', '/v1/apply', {
    version: '1.0.2', requestId: crypto.randomUUID(),
  })).status, 409);

  for (const invalid of [
    { version: 'latest', requestId: crypto.randomUUID() },
    { version: '1.0.1', requestId: crypto.randomUUID(), command: 'docker' },
    { version: '1.0.1', requestId: 'not-a-uuid' },
  ]) assert.equal((await unixRequest(socketPath, 'POST', '/v1/apply', invalid)).status, 400);

  assert.equal((await unixRequest(socketPath, 'POST', '/v1/apply', 'x'.repeat(4097))).status, 413);
  assert.equal((await unixRequest(socketPath, 'GET', '/v1/unknown')).status, 404);
  assert.equal((await unixRequest(socketPath, 'DELETE', '/v1/status')).status, 405);
});

test('bounds command output and terminates timed-out children', { timeout: 8_000 }, async () => {
  const bounded = await runCommand(process.execPath, [
    '-e', "process.stdout.write('a'.repeat(40*1024));process.stderr.write('b'.repeat(40*1024))",
  ], { timeoutMs: 2_000 });
  assert.equal(bounded.code, 0);
  assert.equal(Buffer.byteLength(bounded.stdout), 32 * 1024);
  assert.equal(Buffer.byteLength(bounded.stderr), 32 * 1024);

  const splitUtf8 = await runCommand(process.execPath, [
    '-e', "process.stdout.write(Buffer.concat([Buffer.alloc(32767,97),Buffer.from([0xe2]),Buffer.alloc(100)]))",
  ], { timeoutMs: 2_000 });
  assert.ok(Buffer.byteLength(splitUtf8.stdout) <= 32 * 1024);

  // SIGTERM is ignored before the program runs: the shell sets it, and exec keeps it. A child
  // that installed its own handler raced its start-up, and under load was killed by the SIGTERM
  // it was meant to ignore. Node resets signals as it starts, so the program is sleep.
  const started = Date.now();
  const timedOut = await runCommand('/bin/sh', ['-c', "trap '' TERM; exec sleep 30"], { timeoutMs: 500 });
  assert.equal(timedOut.code, 124);
  assert.ok(Date.now() - started >= 5_000);
});

async function unixRequest(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = request({
      socketPath, method, path,
      headers: payload === undefined ? undefined : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, json: text ? JSON.parse(text) : null });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}
