import assert from 'node:assert/strict';
import test from 'node:test';

import { bytesToBase64 } from '../../src/lib/media-client';

test('browser checksum encoding handles the maximum upload size without a spread overflow', () => {
  const bytes = new Uint8Array(8 * 1024 * 1024).fill(0xab);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});
