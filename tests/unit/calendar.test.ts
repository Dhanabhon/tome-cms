import assert from 'node:assert/strict';
import test from 'node:test';

import { addDays, addMonths, endOfWeek, formatLocal, isBefore, monthGrid, parseLocal, startOfWeek, todayLocal } from '../../src/lib/calendar';

test('a value round-trips through its parts unchanged', () => {
  for (const value of ['2026-09-30T18:05', '2024-02-29T00:00', '2027-01-01T23:59']) {
    assert.equal(formatLocal(parseLocal(value)!), value);
  }
  for (const bad of ['', '2026-13-01T10:00', '2026-02-30T10:00', '2026-09-30T24:00', '2026-09-30', 'nonsense']) {
    assert.equal(parseLocal(bad), null, bad);
  }
});

test('days move across months and years on the calendar, not on the clock', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('a month from the 31st lands on the last day of the next month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
});

test('a month grid is six Sunday-first weeks around the month', () => {
  const grid = monthGrid('2026-09-30');
  assert.equal(grid.length, 42);
  assert.deepEqual(grid[0], { date: '2026-08-30', inMonth: false });
  assert.deepEqual(grid.find((cell) => cell.date === '2026-09-01'), { date: '2026-09-01', inMonth: true });
  assert.equal(grid.filter((cell) => cell.inMonth).length, 30);
});

test('a week runs Sunday to Saturday, and dates compare as dates', () => {
  assert.equal(startOfWeek('2026-09-30'), '2026-09-27');
  assert.equal(endOfWeek('2026-09-30'), '2026-10-03');
  assert.equal(isBefore('2026-09-29', '2026-09-30'), true);
  assert.equal(isBefore('2026-09-30', '2026-09-30'), false);
  assert.equal(todayLocal(new Date(2026, 8, 30, 23, 30)), '2026-09-30');
});
