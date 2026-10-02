import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { stopStreams, streamCommand } from '../../src/cli/main.js';
import { exitQuietlyOnClosedPipe, socketTimeouts, unixSocketClient, UpdaterUnreachableError } from '../../src/cli/socket.js';

test('a prune may take minutes to answer; every other request gives up after its short timeout', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tome-cli-socket-'));
  const socketPath = join(root, 'u.sock');
  // An updater that answers everything late, as a prune removing several images does.
  const server = createServer((request, response) => {
    request.resume();
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ path: request.url }));
    }, 300);
  });
  server.listen(socketPath);
  await once(server, 'listening');
  t.after(async () => { server.close(); await rm(root, { recursive: true, force: true }); });

  const socket = unixSocketClient(socketPath, { timeoutMs: 100, pruneTimeoutMs: 2_000 });
  assert.deepEqual(await socket('POST', '/v1/prune', { dryRun: false }), { status: 200, body: { path: '/v1/prune' } });
  for (const [method, path] of [['GET', '/v1/status'], ['GET', '/v1/busy'], ['POST', '/v1/apply'], ['POST', '/v1/backup']] as const) {
    await assert.rejects(socket(method, path, method === 'POST' ? {} : undefined), UpdaterUnreachableError, `${method} ${path}`);
  }
});

test('the defaults: 10 seconds, and 10 minutes for a prune', () => {
  assert.deepEqual(socketTimeouts, { timeoutMs: 10_000, pruneTimeoutMs: 600_000 });
});

test('a closed pipe ends tome quietly; any other output error is not hidden', () => {
  const handlers: Array<(error: NodeJS.ErrnoException) => void> = [];
  const exits: number[] = [];
  exitQuietlyOnClosedPipe({ on: (_event, handler) => { handlers.push(handler); } }, (code) => { exits.push(code); });
  handlers[0]!(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  assert.deepEqual(exits, [0]);
  assert.throws(() => handlers[0]!(Object.assign(new Error('write EIO'), { code: 'EIO' })), /EIO/);
});

test('when the pipe closes, the logs -f it was following are stopped, not left running', async () => {
  // A follower that never ends on its own, as docker compose logs -f and journalctl --follow do.
  const following = streamCommand(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
  stopStreams();
  assert.equal(await following, 1);
});
