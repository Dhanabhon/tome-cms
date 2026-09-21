import assert from 'node:assert/strict';
import test from 'node:test';

import { atLeast, MIN_BUSY_MS } from '../../src/lib/busy';

/** A wait that ends when the test says so, so nothing here depends on a clock. */
function heldWait() {
  let release!: () => void;
  const waited = new Promise<void>((resolve) => { release = resolve; });
  return { release, wait: () => waited };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

test('a quick answer waits out the minimum before it arrives', async () => {
  const { release, wait } = heldWait();
  let arrived = false;
  const pending = atLeast(Promise.resolve('saved'), MIN_BUSY_MS, wait).then((value) => { arrived = true; return value; });
  await turn();
  assert.equal(arrived, false, 'the button would stop spinning before anyone saw it');
  release();
  assert.equal(await pending, 'saved');
});

test('a failure waits the same minimum, and then fails as it did', async () => {
  const { release, wait } = heldWait();
  let failed = false;
  const pending = atLeast(Promise.reject(new Error('refused')), MIN_BUSY_MS, wait).catch((error: Error) => { failed = true; return error.message; });
  await turn();
  assert.equal(failed, false, 'the message would flash in before the spinner was seen');
  release();
  assert.equal(await pending, 'refused');
});

test('a slow answer is not held back past it', async () => {
  // The minimum is already over; the work decides when it ends.
  let finish!: (value: string) => void;
  const work = new Promise<string>((resolve) => { finish = resolve; });
  const pending = atLeast(work, MIN_BUSY_MS, async () => undefined);
  finish('late');
  assert.equal(await pending, 'late');
});

test('the minimum is long enough to be seen', () => {
  // One frame is 16 ms; a spinner shown for under a few hundred reads as a flicker.
  assert.equal(MIN_BUSY_MS, 400);
});
