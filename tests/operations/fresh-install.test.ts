import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBackupOptions, safeBackupRoot } from '../../scripts/backup';
import { parseResetOptions, resetConfirmation } from '../../scripts/reset-installation.mjs';
import { parseRestoreOptions } from '../../scripts/restore-check';

test('destructive operations require narrow explicit targets', () => {
  assert.throws(() => parseBackupOptions([]), /Usage/);
  assert.throws(() => safeBackupRoot('/srv/tomecms/backups', '/srv/tomecms'), /outside/);
  assert.deepEqual(parseResetOptions([]), { execute: false });
  assert.equal(resetConfirmation('https://cms.example.com', 'tomecms', 'media'), 'RESET https://cms.example.com tomecms media');
  assert.throws(() => parseRestoreOptions(['--backup', '/tmp/backup', '--project', 'production']), /unique/);
});
