import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { copiedFlag, COPIED_MS } from '../../src/lib/copy-feedback';

test('"Copied" stays on the button for two seconds and then goes', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const seen: boolean[] = [];
    const flag = copiedFlag((copied) => seen.push(copied));
    assert.equal(COPIED_MS, 2000);
    flag.flash();
    mock.timers.tick(COPIED_MS - 1);
    assert.deepEqual(seen, [true]);
    mock.timers.tick(1);
    assert.deepEqual(seen, [true, false]);
  } finally {
    mock.timers.reset();
  }
});

test('copying again restarts the wait, and cancelling puts the label back at once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const seen: boolean[] = [];
    const flag = copiedFlag((copied) => seen.push(copied));
    flag.flash();
    mock.timers.tick(1500);
    flag.flash();
    mock.timers.tick(1500);
    assert.deepEqual(seen, [true, true], 'the first wait is gone: still copied 3 s after the first copy');
    mock.timers.tick(500);
    assert.deepEqual(seen, [true, true, false]);
    flag.flash();
    flag.cancel();
    assert.deepEqual(seen, [true, true, false, true, false]);
    mock.timers.tick(COPIED_MS);
    assert.equal(seen.length, 5, 'and the cancelled wait does not fire');
  } finally {
    mock.timers.reset();
  }
});
