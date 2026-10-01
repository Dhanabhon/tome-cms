import assert from 'node:assert/strict';
import { test } from 'node:test';

import { oneAtATime, relativeTime, shouldBeat } from '../../src/lib/editing-poll';

test('the editor checks in only while its tab is visible', () => {
  assert.equal(shouldBeat('visible'), true);
  assert.equal(shouldBeat('hidden'), false);
});

test('an AI touch is told in minutes, in the owner language', () => {
  const now = Date.parse('2026-10-01T10:00:00Z');
  const minuteAgo = new Date(now - 60_000).toISOString();
  assert.equal(relativeTime(minuteAgo, now, 'en'), '1 minute ago');
  assert.equal(relativeTime(minuteAgo, now, 'th'), '1 นาทีที่ผ่านมา');
  assert.equal(relativeTime(new Date(now - 150_000).toISOString(), now, 'en'), '3 minutes ago');
  // A touch seconds old, or one a skewed clock puts ahead, still reads as a minute, never "now".
  assert.equal(relativeTime(new Date(now - 5_000).toISOString(), now, 'en'), '1 minute ago');
  assert.equal(relativeTime(new Date(now + 5_000).toISOString(), now, 'th'), '1 นาทีที่ผ่านมา');
});

test('one check at a time: a tick while one is in flight is skipped, so an older answer never lands after a newer one', async () => {
  let runs = 0;
  let finish: () => void = () => {};
  const check = oneAtATime(() => {
    runs += 1;
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const first = check();
  await check();
  assert.equal(runs, 1, 'the second call did not start a request');
  finish();
  await first;
  const second = check();
  assert.equal(runs, 2, 'once the first is done, the next one runs');
  finish();
  await second;

  const failing = oneAtATime(async () => { runs += 1; throw new Error('offline'); });
  await assert.rejects(failing());
  await assert.rejects(failing(), 'a failed check does not leave it stuck');
  assert.equal(runs, 4);
});
