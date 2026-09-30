import assert from 'node:assert/strict';
import test from 'node:test';

import { checkRange } from '../../src/server/media/range';

test('a request with no Range header reads the whole object', () => {
  assert.equal(checkRange(null), 'whole');
});

test('one byte range is accepted in each of its three forms', () => {
  for (const header of ['bytes=0-99', 'bytes=100-', 'bytes=-500', 'bytes=7-7']) {
    assert.equal(checkRange(header), 'range', header);
  }
});

test('anything else is malformed: other units, several ranges, reversed or empty ranges', () => {
  for (const header of ['', 'bytes=', 'bytes=-', 'bytes=abc-', 'bytes=5-2', 'bytes=0-1,4-5', 'items=0-9', 'bytes 0-9', 'bytes=-0', 'bytes=0-99 ']) {
    assert.equal(checkRange(header), 'malformed', JSON.stringify(header));
  }
});
