import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scrollTargetFor } from '../../src/lib/ui-select-scroll';

// Ten rows of 30px inside 8px of padding: 316 tall, 100 showing.
const list = (scrollTop: number) => ({ clientHeight: 100, scrollHeight: 316, scrollTop });
const row = (index: number) => ({ offsetHeight: 30, offsetTop: 8 + index * 30 });

test('the first row scrolls to the very top, padding included', () => {
  assert.equal(scrollTargetFor(list(150), row(0), 0, 10), 0);
});

test('the last row scrolls to the very end, padding included', () => {
  assert.equal(scrollTargetFor(list(0), row(9), 9, 10), 216);
});

test('a list that does not scroll stays at 0', () => {
  assert.equal(scrollTargetFor({ clientHeight: 100, scrollHeight: 90, scrollTop: 0 }, row(2), 2, 3), 0);
});

test('a middle row above the fold goes to the top edge, below it to the bottom edge, in sight it stays', () => {
  assert.equal(scrollTargetFor(list(150), row(2), 2, 10), 68);
  assert.equal(scrollTargetFor(list(0), row(5), 5, 10), 188 - 100);
  assert.equal(scrollTargetFor(list(60), row(3), 3, 10), 60);
});
