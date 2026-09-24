import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fillSeries, parseStatsQuery, percentChange, pointsChange, readRatio, statsHref, statsPeriods,
} from '../../src/server/stats/report';

const TODAY = '2026-09-24';

test('each range and the period of the same length just before it', () => {
  assert.deepEqual(statsPeriods('7d', TODAY), {
    current: { from: '2026-09-18', to: TODAY }, previous: { from: '2026-09-11', to: '2026-09-17' }, unit: 'day',
  });
  assert.deepEqual(statsPeriods('30d', TODAY), {
    current: { from: '2026-08-26', to: TODAY }, previous: { from: '2026-07-27', to: '2026-08-25' }, unit: 'day',
  });
  assert.deepEqual(statsPeriods('90d', TODAY), {
    current: { from: '2026-06-27', to: TODAY }, previous: { from: '2026-03-29', to: '2026-06-26' }, unit: 'day',
  });
  // Twelve calendar months, this one included; before it, the same 359 days.
  assert.deepEqual(statsPeriods('12m', TODAY), {
    current: { from: '2025-10-01', to: TODAY }, previous: { from: '2024-10-07', to: '2025-09-30' }, unit: 'month',
  });
});

test('every day or month of a period, in order, with the empty ones as zeros', () => {
  const days = fillSeries([{ key: '2026-09-20', reads: 1, views: 3 }], { from: '2026-09-18', to: '2026-09-24' }, 'day');
  assert.deepEqual(days.map(({ key }) => key), ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
  assert.deepEqual(days[2], { key: '2026-09-20', reads: 1, views: 3 });
  assert.deepEqual(days[0], { key: '2026-09-18', reads: 0, views: 0 });

  const months = fillSeries([{ key: '2026-01', reads: 2, views: 9 }], { from: '2025-10-01', to: TODAY }, 'month');
  assert.equal(months.length, 12);
  assert.equal(months[0].key, '2025-10');
  assert.equal(months[11].key, '2026-09');
  assert.deepEqual(months[3], { key: '2026-01', reads: 2, views: 9 });
});

test('counts change by a percentage, the read ratio by points, and nothing before is no change', () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(100, 100), 0);
  assert.equal(percentChange(7, 3), 133);
  assert.equal(percentChange(10, 0), null, 'a previous period of zero');
  assert.equal(pointsChange({ reads: 40, views: 100 }, { reads: 42, views: 100 }), -2, '40% from 42% is two points, not five percent');
  assert.equal(pointsChange({ reads: 14, views: 32 }, { reads: 5, views: 20 }), 19, '44% from 25%, each rounded as the screen shows it');
  assert.equal(pointsChange({ reads: 1, views: 2 }, { reads: 0, views: 0 }), null);
  assert.equal(readRatio({ reads: 1, views: 4 }), 0.25);
  assert.equal(readRatio({ reads: 0, views: 0 }), 0);
  assert.equal(readRatio({ reads: 3, views: 2 }), 1, 'a read whose view was dropped never makes more than all');
});

test('the address holds the choices, and anything else falls back to the defaults', () => {
  assert.deepEqual(parseStatsQuery(new URLSearchParams('')), { lang: null, page: 1, range: '30d', sort: 'views' });
  assert.deepEqual(parseStatsQuery(new URLSearchParams('range=12m&lang=th&sort=ratio&page=3')), { lang: 'th', page: 3, range: '12m', sort: 'ratio' });
  assert.deepEqual(parseStatsQuery(new URLSearchParams('range=1y&lang=fr&sort=title&page=-2')), { lang: null, page: 1, range: '30d', sort: 'views' });
  assert.equal(parseStatsQuery(new URLSearchParams('page=2.5')).page, 1);
  assert.equal(parseStatsQuery(new URLSearchParams('page=99999')).page, 1_000, 'a page far past the last is capped');

  const query = parseStatsQuery(new URLSearchParams('range=7d&lang=en&sort=reads&page=2'));
  assert.equal(statsHref('/admin/stats', query, {}), '/admin/stats?range=7d&lang=en&sort=reads&page=2');
  assert.equal(statsHref('/admin/stats', query, { page: 1, range: '30d' }), '/admin/stats?lang=en&sort=reads', 'defaults are left out');
  assert.equal(statsHref('/admin/stats', query, { lang: null, page: 1, sort: 'views' }), '/admin/stats?range=7d');
  assert.equal(statsHref('/studio/stats', parseStatsQuery(new URLSearchParams('')), {}), '/studio/stats');
});
