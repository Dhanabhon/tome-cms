import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupConfirmation,
  parseCleanupOptions,
  runCleanupCandidates,
  type CleanupCandidate,
} from '../../scripts/media-cleanup';

test('media cleanup is bounded, explicit, and keeps failures retryable', async () => {
  assert.deepEqual(parseCleanupOptions([]), { execute: false });
  assert.deepEqual(parseCleanupOptions(['--dry-run']), { execute: false });
  assert.deepEqual(parseCleanupOptions(['--execute']), { execute: true });
  assert.throws(() => parseCleanupOptions(['--yes']), /Usage/);
  assert.equal(cleanupConfirmation('https://cms.example.com', 'tomecms-media'), 'CLEAN https://cms.example.com tomecms-media');

  const candidates: CleanupCandidate[] = [
    { id: 'resolved', kind: 'reservation', objectKey: 'one' },
    { id: 'skipped', kind: 'media', objectKey: 'two' },
    { id: 'failed', kind: 'media', objectKey: 'three' },
  ];
  const result = await runCleanupCandidates(candidates, async ({ id }) => {
    if (id === 'failed') throw new Error('offline');
    return id === 'resolved';
  });
  assert.deepEqual(result.resolved.map(({ id }) => id), ['resolved']);
  assert.deepEqual(result.skipped.map(({ id }) => id), ['skipped']);
  assert.deepEqual(result.failed.map(({ id }) => id), ['failed']);
});
