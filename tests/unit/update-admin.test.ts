import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPublishedAt } from '../../src/components/admin/UpdateManager.tsx';
import { getUpdateInstallability, updateActionSchema } from '../../src/server/update/admin.js';

test('accepts only check or one exact stable target', () => {
  assert.deepEqual(updateActionSchema.parse({ action: 'check' }), { action: 'check' });
  assert.deepEqual(updateActionSchema.parse({ action: 'apply', version: '1.0.1' }), { action: 'apply', version: '1.0.1' });
  for (const value of [
    { action: 'apply', version: 'latest' },
    { action: 'apply', version: '1.0.1', image: 'evil' },
    { action: 'run', command: 'docker' },
  ]) assert.throws(() => updateActionSchema.parse(value));
});

test('keeps check-only installation capability distinct from release availability', () => {
  assert.deepEqual(getUpdateInstallability('check-only'), {
    mode: 'check-only',
    installable: false,
    reason: 'This installation is configured for update checks only.',
  });
});

test('uses a safe publication-date fallback for malformed release metadata', () => {
  assert.equal(formatPublishedAt('not-a-date'), 'Publication date unavailable');
});
