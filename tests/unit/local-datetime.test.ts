import assert from 'node:assert/strict';
import test from 'node:test';

import { fromLocalInput, isScheduled, toLocalInput } from '../../src/lib/local-datetime';

test('the input shows the owner\'s own clock, and gives back an instant', () => {
  // A round trip is the only property worth asserting without pinning the test to a zone:
  // what the input shows for an instant must store as that same instant again.
  for (const iso of ['2026-09-21T02:40:00.000Z', '2026-01-01T23:59:00.000Z', '2026-06-30T00:00:00.000Z']) {
    const shown = toLocalInput(iso);
    assert.match(shown, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `${iso} is not a value the input accepts`);
    assert.equal(fromLocalInput(shown), iso, `${iso} did not survive the round trip`);
  }
});

test('an empty box is an answer, and rubbish is not a date', () => {
  // Blank means the owner named no date, which the server reads as "now, or leave it" --
  // not as an invalid date it should refuse.
  assert.equal(toLocalInput(null), '');
  assert.equal(toLocalInput(''), '');
  assert.equal(toLocalInput('not a date'), '');
  assert.equal(fromLocalInput(''), null);
  assert.equal(fromLocalInput('not a date'), null);
});

test('scheduled is published with the moment still to come', () => {
  const now = Date.parse('2026-09-21T00:00:00.000Z');
  assert.equal(isScheduled('published', '2026-09-22T00:00:00.000Z', now), true);
  assert.equal(isScheduled('published', '2026-09-20T00:00:00.000Z', now), false, 'a date that has come is out');
  assert.equal(isScheduled('published', null, now), false, 'no date is not a schedule');
  // A draft dated for Friday is still a draft. The database drops the date entirely, and
  // the screen must not claim otherwise in the moment before it hears back.
  assert.equal(isScheduled('draft', '2026-09-22T00:00:00.000Z', now), false);
});
