/**
 * The Stats screen's arithmetic: which days a range covers, what they are compared with, how a
 * change is said, and how the choices sit in the address. Pure, so the screen and its tests
 * agree on every edge.
 */

export const STATS_RANGES = ['7d', '30d', '90d', '12m'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const STATS_SORTS = ['views', 'reads', 'ratio'] as const;
export type StatsSort = (typeof STATS_SORTS)[number];

export interface StatsQuery {
  lang: 'en' | 'th' | null;
  page: number;
  range: StatsRange;
  sort: StatsSort;
}

/** Both ends included, as YYYY-MM-DD. */
export interface StatsPeriod {
  from: string;
  to: string;
}

export interface StatsPeriods {
  current: StatsPeriod;
  previous: StatsPeriod;
  unit: 'day' | 'month';
}

/** One bar of the chart: a day (YYYY-MM-DD) or a month (YYYY-MM). */
export interface SeriesPoint {
  key: string;
  reads: number;
  views: number;
}

const DAY_MS = 86_400_000;
const LAST_PAGE = 1_000;

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayAt = (number: number) => new Date(number * DAY_MS).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => dayAt(dayNumber(day) + days);

/** The first day of the month `months` away from the one `day` is in. */
function monthStart(day: string, months: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

/** A range ending today, and the same number of days just before it. */
export function statsPeriods(range: StatsRange, today: string): StatsPeriods {
  const from = range === '12m' ? monthStart(today, -11) : addDays(today, 1 - Number.parseInt(range, 10));
  const length = dayNumber(today) - dayNumber(from) + 1;
  return {
    current: { from, to: today },
    previous: { from: addDays(from, -length), to: addDays(from, -1) },
    unit: range === '12m' ? 'month' : 'day',
  };
}

/** Every day (or month) of the period, in order, with the ones nobody came as zeros. */
export function fillSeries(rows: readonly SeriesPoint[], period: StatsPeriod, unit: 'day' | 'month'): SeriesPoint[] {
  const found = new Map(rows.map((row) => [row.key, row]));
  const keys: string[] = [];
  if (unit === 'day') {
    for (let day = period.from; day <= period.to; day = addDays(day, 1)) keys.push(day);
  } else {
    for (let month = monthStart(period.from, 0); month <= period.to; month = monthStart(month, 1)) keys.push(month.slice(0, 7));
  }
  return keys.map((key) => found.get(key) ?? { key, reads: 0, views: 0 });
}

/** A whole-number percentage change, or null when there was nothing before to compare with. */
export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}

/** Reads over views, never more than all of them. */
export function readRatio({ reads, views }: { reads: number; views: number }): number {
  return views > 0 ? Math.min(1, reads / views) : 0;
}

/**
 * The read ratio's change in points: 40% from 42% is -2, never -5%. Each ratio is rounded as the
 * screen shows it first, so the change agrees with the two numbers beside it.
 */
export function pointsChange(current: { reads: number; views: number }, previous: { reads: number; views: number }): number | null {
  if (previous.views === 0) return null;
  return Math.round(readRatio(current) * 100) - Math.round(readRatio(previous) * 100);
}

export function parseStatsQuery(params: URLSearchParams): StatsQuery {
  const range = STATS_RANGES.find((value) => value === params.get('range')) ?? '30d';
  const sort = STATS_SORTS.find((value) => value === params.get('sort')) ?? 'views';
  const lang = params.get('lang');
  const page = Number(params.get('page'));
  return {
    lang: lang === 'th' || lang === 'en' ? lang : null,
    page: Number.isSafeInteger(page) && page > 1 ? Math.min(page, LAST_PAGE) : 1,
    range,
    sort,
  };
}

/** The screen's address with some choices changed; the defaults are left out. */
export function statsHref(base: string, query: StatsQuery, change: Partial<StatsQuery>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.range !== '30d') params.set('range', next.range);
  if (next.lang) params.set('lang', next.lang);
  if (next.sort !== 'views') params.set('sort', next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}
