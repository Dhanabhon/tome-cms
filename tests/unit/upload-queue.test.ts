import assert from 'node:assert/strict';
import test from 'node:test';

import { runQueue } from '../../src/lib/upload-queue';

test('at most two uploads run at once, and every item is reached', async () => {
  let running = 0; let peak = 0; const done: number[] = [];
  await runQueue([0, 1, 2, 3, 4], async (item) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1; done.push(item);
  }, 2);
  assert.equal(peak, 2);
  assert.deepEqual([...done].sort(), [0, 1, 2, 3, 4]);
});

test('one failing upload does not stop the others', async () => {
  const done: number[] = [];
  await runQueue([0, 1, 2], async (item) => {
    if (item === 1) throw new Error('storage refused');
    done.push(item);
  });
  assert.deepEqual(done.sort(), [0, 2]);
});
