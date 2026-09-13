import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { getApplyResponseAction } from '../../src/components/admin/UpdateManager';
import { getManagedInstallability, getUpdaterStatus, parseUpdaterStatus, requestUpdate } from '../../src/server/update/updater-client.js';

const job = {
  id: randomUUID(), targetVersion: '1.0.1', phase: 'preflight', completedSteps: 0, totalSteps: 8,
  message: 'Checking update prerequisites.', startedAt: '2026-09-20T10:00:00.000Z',
  finishedAt: null, errorCode: null, backupCreatedAt: null,
};
const status = {
  protocolVersion: 1, updaterVersion: '1.0.0', managed: true,
  installed: { version: '1.0.0', imageDigest: `sha256:${'a'.repeat(64)}` }, job,
};

test('late apply replies preserve observed active jobs and resolve already-installed races', () => {
  assert.equal(getApplyResponseAction(null, 'refused'), 'stop');
  assert.equal(getApplyResponseAction(null, 'ambiguous'), 'continue');
  assert.equal(getApplyResponseAction(null, 'already_installed'), 'refresh');
  for (const response of ['refused', 'ambiguous', 'already_installed'] as const) {
    assert.equal(getApplyResponseAction({ phase: 'preflight' }, response), 'preserve');
    assert.equal(getApplyResponseAction({ phase: 'health_check' }, response), 'preserve');
    for (const phase of ['succeeded', 'rolled_back', 'failed_manual_recovery'] as const) {
      assert.equal(getApplyResponseAction({ phase }, response), 'ignore');
    }
  }
});

async function socketServer(context: TestContext, listener: RequestListener) {
  const root = await mkdtemp(join(tmpdir(), 'tome-bridge-'));
  const socketPath = join(root, 'updater.sock');
  const server = createServer(listener);
  server.listen(socketPath);
  await once(server, 'listening');
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return socketPath;
}

test('uses Unix HTTP only, forwards exactly version and request UUID, parses accepted job', async (t) => {
  const received: unknown[] = [];
  const socketPath = await socketServer(t, async (req, res) => {
    assert.equal(req.headers.cookie, undefined);
    if (req.method === 'GET') {
      assert.equal(req.url, '/v1/status');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status));
    } else {
      assert.equal(req.url, '/v1/apply');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify(job));
    }
  });
  assert.deepEqual(await getUpdaterStatus({ socketPath }), status);
  const requestId = randomUUID();
  assert.deepEqual(await requestUpdate({ socketPath, version: '1.0.1', requestId }), { outcome: 'accepted', job });
  assert.deepEqual(received, [{ version: '1.0.1', requestId }]);
  await assert.rejects(requestUpdate({ socketPath, version: 'latest', requestId }));
  await assert.rejects(requestUpdate({ socketPath, version: '1.0.1', requestId: 'invalid' }));
  assert.equal(received.length, 1);
});

test('returns an enumerated already-installed result when apply loses the completion race', async (t) => {
  const current = {
    ...status,
    installed: { version: '1.0.1', imageDigest: `sha256:${'b'.repeat(64)}` },
    job: null,
  };
  const socketPath = await socketServer(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(current));
  });
  assert.deepEqual(await requestUpdate({ socketPath, version: '1.0.1', requestId: randomUUID() }), {
    outcome: 'already_installed', installed: current.installed,
  });
  await assert.rejects(
    requestUpdate({ socketPath, version: '1.0.2', requestId: randomUUID() }),
    /unavailable/i,
  );
});

test('missing socket is unmanaged with no TCP or Docker fallback', async () => {
  const socketPath = join(tmpdir(), `${randomUUID()}.sock`);
  assert.deepEqual(await getUpdaterStatus({ socketPath }), { managed: false });
  await assert.rejects(requestUpdate({ socketPath, version: '1.0.1', requestId: randomUUID() }), /unavailable/i);
  assert.deepEqual(await getUpdaterStatus({ socketPath: 'http://localhost:80' }), { managed: false });
});

test('bounds responses to 4 KiB even without Content-Length', async (t) => {
  const socketPath = await socketServer(t, (_req, res) => {
    res.writeHead(202, { 'content-type': 'application/json' });
    res.write(' '.repeat(4096));
    res.end(JSON.stringify(job));
  });
  await assert.rejects(requestUpdate({ socketPath, version: '1.0.1', requestId: randomUUID() }), /unavailable/i);
});

test('enforces a two-second wall-clock deadline even while bytes arrive', async (t) => {
  const socketPath = await socketServer(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const interval = setInterval(() => res.write(' '), 40);
    res.on('close', () => clearInterval(interval));
  });
  const started = Date.now();
  assert.deepEqual(await getUpdaterStatus({ socketPath, timeoutMs: 2000 }), { managed: false });
  assert.ok(Date.now() - started >= 1900);
  assert.ok(Date.now() - started < 3000);
});

test('strictly rejects unknown keys, versions, phases, messages, dates, progress, and error codes', () => {
  assert.deepEqual(parseUpdaterStatus(status), status);
  for (const invalid of [
    { ...status, secret: 'raw output' }, { ...status, protocolVersion: 2 },
    { ...status, updaterVersion: 'latest' }, { ...status, managed: false },
    { ...status, installed: { ...status.installed, command: 'docker' } },
    ...[
      { phase: 'unknown' }, { message: 'secret child output' }, { completedSteps: 9 },
      { totalSteps: 9 }, { completedSteps: 1 }, { startedAt: 'yesterday' },
      { finishedAt: job.startedAt }, { errorCode: 'raw_output' }, { backupDirectory: '/secret' },
    ].map((patch) => ({ ...status, job: { ...job, ...patch } })),
  ]) assert.throws(() => parseUpdaterStatus(invalid));
});

test('returns only safe errors from updater refusal', async (t) => {
  const socketPath = await socketServer(t, (_req, res) => {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'update_in_progress' }));
  });
  await assert.rejects(requestUpdate({ socketPath, version: '1.0.1', requestId: randomUUID() }), /already in progress/i);
});

test('requires a compatible managed updater, exact installed identity, and an available direct upgrade', () => {
  const check = {
    currentVersion: '1.0.0', availability: 'available' as const,
    latest: { manifest: { version: '1.0.1', compatibility: {
      minimumUpdaterVersion: '1.0.0', minimumDirectUpgradeFrom: '1.0.0', rollbackSafeFrom: '1.0.0',
      updaterProtocol: 1, composeContract: 1, environmentContract: 1, targetMigration: '007_preview_tokens',
    } } },
  };
  const updater = parseUpdaterStatus({ ...status, job: null });
  assert.equal(getManagedInstallability(check, updater).installable, true);
  assert.equal(getManagedInstallability(check, { managed: false }).installable, false);
  assert.equal(getManagedInstallability(check, parseUpdaterStatus(status)).installable, false);
  assert.equal(getManagedInstallability({ ...check, availability: 'current' }, updater).installable, false);
  assert.equal(getManagedInstallability({ ...check, currentVersion: '0.9.0' }, updater).installable, false);
  for (const compatibility of [
    { ...check.latest.manifest.compatibility, minimumUpdaterVersion: '1.0.1' },
    { ...check.latest.manifest.compatibility, minimumDirectUpgradeFrom: '1.0.1' },
    { ...check.latest.manifest.compatibility, rollbackSafeFrom: '1.0.1' },
    { ...check.latest.manifest.compatibility, updaterProtocol: 2 },
    { ...check.latest.manifest.compatibility, composeContract: 2 },
    { ...check.latest.manifest.compatibility, environmentContract: 2 },
  ]) assert.equal(getManagedInstallability({ ...check, latest: { manifest: { ...check.latest.manifest, compatibility } } }, updater).installable, false);
});

test('fresh-session gate matches the exact authenticated credential and database five-minute window', async (t) => {
  const environment = {
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
    TOME_CMS_PUBLIC_URL: 'http://localhost:4321', TOME_CMS_INSTALL_TOKEN: 'i'.repeat(32),
    BETTER_AUTH_SECRET: 'a'.repeat(32), TOME_CMS_CONTEXT_SECRET: 'c'.repeat(32),
    TOME_CMS_RECOVERY_PEPPER: 'r'.repeat(32), S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 's'.repeat(24), S3_BUCKET: 'test-media',
    MEDIA_PUBLIC_URL: 'http://localhost:9000/test-media/',
  };
  for (const [key, value] of Object.entries(environment)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { FRESH_SESSION_SECONDS, requireFreshOwnerSession } = await import('../../src/server/auth/fresh-session');
  t.after(closeDatabase);
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  let found = true;
  t.mock.method(db.getExecutor(), 'executeQuery', async (query: { sql: string; parameters: readonly unknown[] }) => {
    queries.push(query);
    return { rows: found ? [{ id: 'current-session' }] : [] };
  });
  const current = { user: { id: 'owner' }, session: { id: 'current-session', token: 'current-token' } } as Parameters<typeof requireFreshOwnerSession>[0];
  await requireFreshOwnerSession(current);
  assert.equal(FRESH_SESSION_SECONDS, 300);
  assert.equal(queries[0].sql, 'select "id" from "session" where "id" = $1 and "token" = $2 and "userId" = $3 and "expiresAt" > CURRENT_TIMESTAMP and "createdAt" >= CURRENT_TIMESTAMP - ($4 * interval \'1 second\')');
  assert.deepEqual(queries[0].parameters, ['current-session', 'current-token', 'owner', 300]);
  found = false;
  await assert.rejects(requireFreshOwnerSession(current), { status: 403, message: 'Verify a Passkey and try again.' });
});
