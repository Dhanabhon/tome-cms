import assert from 'node:assert/strict';
import test from 'node:test';
import { getBuildInfo } from '../../src/server/update/current.js';

test('prefers baked release identity and validates it', () => {
  assert.deepEqual(getBuildInfo({
    TOME_CMS_VERSION: '1.0.1', TOME_CMS_COMMIT_SHA: 'a'.repeat(40),
  }), { version: '1.0.1', commitSha: 'a'.repeat(40) });
  assert.throws(() => getBuildInfo({ TOME_CMS_VERSION: 'latest', TOME_CMS_COMMIT_SHA: 'main' }));
});
