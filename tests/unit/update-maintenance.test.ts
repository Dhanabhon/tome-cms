import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { isUpdateWriteBlocked, readMaintenanceStatus, updateMaintenanceResponse } from '../../src/server/update/maintenance.js';

const phases = [
  ['preflight', 'Checking update prerequisites.'],
  ['verifying', 'Verifying the official update.'],
  ['downloading', 'Downloading the verified update.'],
  ['quiescing', 'Preparing TomeCMS for maintenance.'],
  ['backing_up', 'Creating a recovery backup.'],
  ['migrating', 'Applying database migrations.'],
  ['restarting', 'Starting the updated application.'],
  ['health_check', 'Checking the updated application.'],
  ['succeeded', 'Update installed successfully.'],
  ['rolling_back', 'Restoring the previous application version.'],
  ['rolled_back', 'The previous application version was restored.'],
  ['failed_manual_recovery', 'Manual recovery is required.'],
];

test('blocks exactly the five maintenance phases and fails open on missing/malformed/oversized status', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tome-maintenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statusPath = join(root, 'status.json');
  assert.equal(await isUpdateWriteBlocked(statusPath), false);
  assert.deepEqual(await readMaintenanceStatus(statusPath), { managed: false });
  for (const [index, [phase, message]] of phases.entries()) {
    const terminal = ['succeeded', 'rolled_back', 'failed_manual_recovery'].includes(phase);
    await writeFile(statusPath, JSON.stringify({
      protocolVersion: 1, updaterVersion: '1.0.0', managed: true,
      installed: { version: '1.0.0', imageDigest: `sha256:${'a'.repeat(64)}` },
      job: {
        id: randomUUID(), targetVersion: '1.0.1', phase, message, completedSteps: Math.min(index, 8), totalSteps: 8,
        startedAt: '2026-09-20T10:00:00.000Z', finishedAt: terminal ? '2026-09-20T10:01:00.000Z' : null,
        errorCode: null, backupCreatedAt: null,
      },
    }));
    assert.equal((await readMaintenanceStatus(statusPath)).managed, true, phase);
    assert.equal(await isUpdateWriteBlocked(statusPath), index >= 3 && index <= 7, phase);
    if (phase === 'quiescing') {
      const request = (path: string, method: string) => new Request(`http://localhost${path}`, { method });
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const blocked = await updateMaintenanceResponse(request('/api/admin/posts', method), 'managed', statusPath);
        assert.equal(blocked?.status, 503);
        assert.equal(blocked?.headers.get('Cache-Control'), 'no-store');
        assert.equal(blocked?.headers.get('Retry-After'), '10');
        assert.deepEqual(await blocked?.json(), { error: 'TomeCMS is installing an update. Try again shortly.' });
      }
      for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(await updateMaintenanceResponse(request('/api/admin/posts', method), 'managed', statusPath), null);
      for (const path of ['/api/admin/system/updates', '/api/admin/system/updates/', '/api/auth/passkey/verify-authentication', '/api/v1/posts']) {
        assert.equal(await updateMaintenanceResponse(request(path, 'POST'), 'managed', statusPath), null);
      }
      assert.equal(await updateMaintenanceResponse(request('/api/admin/posts', 'POST'), 'check-only', statusPath), null);
    }
  }
  for (const invalid of ['{', '{"job":{"phase":"quiescing"}}', ' '.repeat(4097)]) {
    await writeFile(statusPath, invalid);
    assert.equal(await isUpdateWriteBlocked(statusPath), false);
    assert.deepEqual(await readMaintenanceStatus(statusPath), { managed: false });
  }
});
