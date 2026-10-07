import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupConfirmation,
  databaseLabel,
  orphanConfirmation,
  orphanReportLines,
  parseCleanupOptions,
  runCleanupCandidates,
  type CleanupCandidate,
} from '../../scripts/media-cleanup';

test('media cleanup is bounded, explicit, and keeps failures retryable', async () => {
  assert.deepEqual(parseCleanupOptions([]), { execute: false, orphans: false });
  assert.deepEqual(parseCleanupOptions(['--dry-run']), { execute: false, orphans: false });
  assert.deepEqual(parseCleanupOptions(['--execute']), { execute: true, orphans: false });
  assert.deepEqual(parseCleanupOptions(['--orphans']), { execute: false, orphans: true });
  assert.deepEqual(parseCleanupOptions(['--orphans', '--dry-run']), { execute: false, orphans: true });
  assert.deepEqual(parseCleanupOptions(['--orphans', '--execute']), { execute: true, orphans: true });
  assert.deepEqual(parseCleanupOptions(['--execute', '--orphans']), { execute: true, orphans: true });
  for (const args of [['--yes'], ['--orphans', '--orphans'], ['--execute', '--dry-run'], ['--orphans', '--yes']]) {
    assert.throws(() => parseCleanupOptions(args), /Usage/, args.join(' '));
  }
  assert.equal(cleanupConfirmation('https://cms.example.com', 'tomecms-media'), 'CLEAN https://cms.example.com tomecms-media');
  assert.equal(databaseLabel('postgresql://tomecms:secret@127.0.0.1:5432/tomecms'), '127.0.0.1:5432/tomecms', 'the host and name, never the password');
  assert.equal(
    orphanConfirmation('https://cms.example.com', '127.0.0.1:5432/tomecms', 'tomecms-media'),
    'SWEEP https://cms.example.com 127.0.0.1:5432/tomecms tomecms-media',
  );

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

test('the orphan report names the first keys, counts the rest, and says how to delete', () => {
  const keys = ['owners/a/2026/10/one.jpg', 'owners/a/2026/10/two.jpg'];
  assert.deepEqual(orphanReportLines({ count: 0, bytes: 0, keys: [], deleted: 0, failed: 0, kept: 0 }, false), [
    'No media files are left in storage with nothing pointing at them.',
  ]);
  assert.deepEqual(orphanReportLines({ count: 52, bytes: 3 * 1024 ** 2, keys, deleted: 0, failed: 0, kept: 0 }, false), [
    '52 media files in storage are over a day old and nothing points at them (3.0 MiB):',
    `  ${keys[0]}`,
    `  ${keys[1]}`,
    '  and 50 more',
    'If another TomeCMS site uses this bucket, these may be its files: do not delete them, give each site its own bucket.',
    'Dry run complete. No changes were made. Delete them with: npm run media:cleanup -- --orphans --execute',
  ]);
  assert.deepEqual(orphanReportLines({ count: 2, bytes: 10, keys, deleted: 1, failed: 0, kept: 1 }, true).slice(-2), [
    'Deleted: 1; failed: 0.',
    '1 came into use while the sweep ran, so it was kept.',
  ]);
});
