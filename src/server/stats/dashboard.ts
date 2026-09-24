import { sql, type RawBuilder } from 'kysely';

import { live } from '../content/live';
import { db } from '../db/client';
import { fillSeries, type SeriesPoint, type StatsPeriod, type StatsPeriods, type StatsSort } from './report';

export interface StatsFilter {
  /** One edition, for its own screen. */
  contentId?: string;
  lang: 'en' | 'th' | null;
  ownerId: string;
}

export interface Totals {
  reads: number;
  views: number;
}

export interface Share {
  key: string;
  views: number;
}

export interface StatsReport {
  countries: Share[];
  devices: Share[];
  locales: Share[];
  previous: Totals;
  referrers: Share[];
  series: SeriesPoint[];
  totals: Totals;
}

export interface StatsArticle {
  id: string;
  kind: 'page' | 'post';
  locale: 'en' | 'th';
  reads: number;
  /** Null when the edition has been deleted since it was read. */
  title: string | null;
  views: number;
}

export interface StatsEdition {
  id: string;
  kind: 'page' | 'post';
  /** Whether a reader could open it now: published, dated, and its moment has come. */
  live: boolean;
  locale: 'en' | 'th';
  slug: string | null;
  title: string | null;
}

export const STATS_PAGE_SIZE = 50;
const TOP = 10;

/** PostgreSQL sums integers into bigint, which node-postgres hands over as a string. */
const count = (value: unknown): number => Number(value ?? 0);

function scope(filter: StatsFilter, period: StatsPeriod): RawBuilder<unknown> {
  return sql`owner_id = ${filter.ownerId}
    and day between ${period.from}::date and ${period.to}::date
    ${filter.lang ? sql`and locale = ${filter.lang}` : sql``}
    ${filter.contentId ? sql`and content_id = ${filter.contentId}::uuid` : sql``}`;
}

async function totals(filter: StatsFilter, period: StatsPeriod): Promise<Totals> {
  const { rows } = await sql<{ reads: string | null; views: string | null }>`
    select sum(views) as views, sum(reads) as reads from content_stats_daily where ${scope(filter, period)}
  `.execute(db);
  return { reads: count(rows[0]?.reads), views: count(rows[0]?.views) };
}

async function series(filter: StatsFilter, periods: StatsPeriods): Promise<SeriesPoint[]> {
  const format = periods.unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const { rows } = await sql<{ key: string; reads: string; views: string }>`
    select to_char(day, ${format}) as key, sum(views) as views, sum(reads) as reads
    from content_stats_daily where ${scope(filter, periods.current)}
    group by 1
  `.execute(db);
  return fillSeries(rows.map((row) => ({ key: row.key, reads: count(row.reads), views: count(row.views) })), periods.current, periods.unit);
}

async function shares(filter: StatsFilter, period: StatsPeriod, column: 'country' | 'device' | 'locale' | 'referrer', top?: number): Promise<Share[]> {
  const { rows } = await sql<{ key: string; views: string }>`
    select ${sql.ref(column)} as key, sum(views) as views
    from content_stats_daily where ${scope(filter, period)}
    group by 1 having sum(views) > 0
    order by 2 desc, 1
    ${top ? sql`limit ${top}` : sql``}
  `.execute(db);
  return rows.map((row) => ({ key: row.key, views: count(row.views) }));
}

export async function readStats(filter: StatsFilter, periods: StatsPeriods): Promise<StatsReport> {
  const [now, before, points, referrers, devices, countries, locales] = await Promise.all([
    totals(filter, periods.current),
    totals(filter, periods.previous),
    series(filter, periods),
    shares(filter, periods.current, 'referrer', TOP),
    shares(filter, periods.current, 'device'),
    shares(filter, periods.current, 'country', TOP),
    shares(filter, periods.current, 'locale'),
  ]);
  return { countries, devices, locales, previous: before, referrers, series: points, totals: now };
}

/** Whether anything has been counted for this owner at all, which is what the empty screen is about. */
export async function hasStats(ownerId: string): Promise<boolean> {
  const row = await db.selectFrom('content_stats_daily').select('owner_id').where('owner_id', '=', ownerId).limit(1).executeTakeFirst();
  return row !== undefined;
}

const ORDER: Record<StatsSort, RawBuilder<unknown>> = {
  ratio: sql`least(1, sum(s.reads)::float / nullif(sum(s.views), 0)) desc nulls last`,
  reads: sql`sum(s.reads) desc`,
  views: sql`sum(s.views) desc`,
};

/** Articles and pages with their numbers, fifty a page. The home page is in the totals, not here. */
export async function readStatsArticles(
  filter: StatsFilter,
  period: StatsPeriod,
  sort: StatsSort,
  page: number,
): Promise<{ articles: StatsArticle[]; hasMore: boolean }> {
  const { rows } = await sql<{ content_id: string; kind: 'page' | 'post'; locale: 'en' | 'th'; reads: string; title: string | null; views: string }>`
    select s.content_id, s.kind, s.locale, sum(s.views) as views, sum(s.reads) as reads, coalesce(p.title, g.title) as title
    from content_stats_daily s
    left join posts p on s.kind = 'post' and p.id = s.content_id and p.owner_id = s.owner_id
    left join pages g on s.kind = 'page' and g.id = s.content_id and g.owner_id = s.owner_id
    where s.owner_id = ${filter.ownerId} and s.kind <> 'home'
      and s.day between ${period.from}::date and ${period.to}::date
      ${filter.lang ? sql`and s.locale = ${filter.lang}` : sql``}
    group by s.content_id, s.kind, s.locale, p.title, g.title
    order by ${ORDER[sort]}, s.content_id
    limit ${STATS_PAGE_SIZE + 1} offset ${(page - 1) * STATS_PAGE_SIZE}
  `.execute(db);
  return {
    articles: rows.slice(0, STATS_PAGE_SIZE).map((row) => ({
      id: row.content_id, kind: row.kind, locale: row.locale, reads: count(row.reads), title: row.title, views: count(row.views),
    })),
    hasMore: rows.length > STATS_PAGE_SIZE,
  };
}

/** What one edition is, for its screen's heading and links; a deleted one is known by its counts. */
export async function readStatsEdition(ownerId: string, id: string): Promise<StatsEdition | null> {
  const post = await db.selectFrom('posts').select(['id', 'locale', 'slug', 'title', live('posts').as('live')])
    .where('owner_id', '=', ownerId).where('id', '=', id).executeTakeFirst();
  if (post) return { ...post, kind: 'post' };
  const page = await db.selectFrom('pages').select(['id', 'locale', 'slug', 'title', live('pages').as('live')])
    .where('owner_id', '=', ownerId).where('id', '=', id).executeTakeFirst();
  if (page) return { ...page, kind: 'page' };
  const counted = await db.selectFrom('content_stats_daily').select(['kind', 'locale'])
    .where('owner_id', '=', ownerId).where('content_id', '=', id).limit(1).executeTakeFirst();
  return counted && counted.kind !== 'home' ? { id, kind: counted.kind, live: false, locale: counted.locale, slug: null, title: null } : null;
}
