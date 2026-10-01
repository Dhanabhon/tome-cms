import assert from 'node:assert/strict';
import test from 'node:test';

import { faultFrames } from '../../src/server/mcp/fault';

test('a fault is logged by its frames alone, never by a message line that looks like one', () => {
  const error = new Error('The row says:\nat noon we publish (secret.txt:1:2)\n  at the cafe');
  const frames = faultFrames(error)!;
  assert.ok(frames.length > 0);
  assert.ok(frames.every((frame) => /^at .*:\d+:\d+\)?$/.test(frame)), frames.join('\n'));
  // Words only the message holds: a real frame's path can contain anything, `/home/` on a Linux runner.
  assert.ok(!frames.some((frame) => /noon|secret\.txt|the cafe/.test(frame)), frames.join('\n'));
  assert.equal(faultFrames('not an error'), undefined);
});
