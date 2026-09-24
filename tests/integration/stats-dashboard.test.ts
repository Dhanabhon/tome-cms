import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

type Row = [day: string, kind: 'home' | 'page' | 'post', id: string | null, locale: 'en' | 'th',
  referrer: string, device: 'desktop' | 'mobile', country: string, views: number, reads: number];

test('the Stats screen reads the right totals, periods, filters, top tens and pages', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { hasStats, readStats, readStatsArticles, readStatsEdition, STATS_PAGE_SIZE } = await import('../../src/server/stats/dashboard');
  const { statsPeriods } = await import('../../src/server/stats/report');
  context.after(closeDatabase);
  await migrateToLatest();

  const TODAY = '2026-09-24';
  const [owner, other, paged] = [randomUUID(), randomUUID(), randomUUID()];
  await db.insertInto('user').values([owner, other, paged].map((id, index) => ({
    id, name: 'Owner', email: `stats-dashboard-${index}@example.invalid`, emailVerified: true, image: null, role: 'owner',
  }))).execute();
  const category = await db.insertInto('categories').values({ owner_id: owner, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const edition = (
    kind: 'page' | 'post', locale: 'en' | 'th', title: string,
    overrides: { published_at?: Date | null; status?: 'draft' | 'published' } = {},
  ) => db.transaction().execute(async (trx) => {
    const fields = {
      content_html: '<p>Words</p>', content_json: { content: [], type: 'doc' as const }, locale, meta_description: null,
      meta_title: null, owner_id: owner,
      published_at: overrides.published_at === undefined ? new Date('2026-01-01T00:00:00Z') : overrides.published_at,
      slug: `s-${randomUUID()}`, status: overrides.status ?? 'published' as const, title,
    };
    if (kind === 'page') {
      const group = await trx.insertInto('page_translation_groups').values({ owner_id: owner }).returning('id').executeTakeFirstOrThrow();
      return (await trx.insertInto('pages').values({ ...fields, translation_group_id: group.id }).returning('id').executeTakeFirstOrThrow()).id;
    }
    const group = await trx.insertInto('post_translation_groups').values({ owner_id: owner }).returning('id').executeTakeFirstOrThrow();
    const { id } = await trx.insertInto('posts').values({ ...fields, cover_media_id: null, translation_group_id: group.id })
      .returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('post_category_assignments').values({ category_id: category.id, owner_id: owner, translation_group_id: group.id }).execute();
    return id;
  });
  const seed = (ownerId: string, rows: Row[]) => db.insertInto('content_stats_daily').values(rows.map(
    ([day, kind, id, locale, referrer, device, country, views, reads]) => ({
      content_id: id, country, day, device, kind, locale, owner_id: ownerId, reads, referrer, views,
    }),
  )).execute();

  const alpha = await edition('post', 'en', 'Alpha');
  const beta = await edition('post', 'th', 'บีตา');
  const about = await edition('page', 'en', 'About');
  const draft = await edition('post', 'en', 'Draft', { published_at: null, status: 'draft' });
  const gone = randomUUID();
  await seed(owner, [
    ['2026-09-24', 'post', alpha, 'en', 'news.example', 'desktop', 'TH', 10, 4],
    ['2026-09-20', 'post', alpha, 'en', '', 'mobile', 'US', 6, 1],
    ['2026-09-10', 'post', beta, 'th', 'internal', 'mobile', 'TH', 8, 6],
    ['2026-09-01', 'page', about, 'en', '', 'desktop', '', 4, 0],
    ['2026-09-23', 'home', null, 'en', '', 'desktop', '', 5, 0],
    ['2026-09-05', 'post', gone, 'en', 'news.example', 'desktop', 'TH', 3, 3],
    ['2026-08-10', 'post', alpha, 'en', '', 'desktop', 'TH', 20, 5],
    ['2026-06-15', 'post', alpha, 'en', '', 'desktop', 'TH', 7, 2],
    ['2025-09-15', 'post', beta, 'th', '', 'mobile', 'TH', 9, 3],
  ]);
  const all = { lang: null, ownerId: owner };

  const month = await readStats(all, statsPeriods('30d', TODAY));
  assert.deepEqual(month.totals, { reads: 14, views: 36 });
  assert.deepEqual(month.previous, { reads: 5, views: 20 });
  assert.equal(month.series.length, 30);
  assert.deepEqual(month.series[0], { key: '2026-08-26', reads: 0, views: 0 });
  assert.deepEqual(month.series.at(-1), { key: TODAY, reads: 4, views: 10 });
  assert.deepEqual(month.series.at(-2), { key: '2026-09-23', reads: 0, views: 5 });
  assert.deepEqual(month.referrers, [{ key: '', views: 15 }, { key: 'news.example', views: 13 }, { key: 'internal', views: 8 }]);
  assert.deepEqual(month.devices, [{ key: 'desktop', views: 22 }, { key: 'mobile', views: 14 }]);
  assert.deepEqual(month.countries, [{ key: 'TH', views: 21 }, { key: '', views: 9 }, { key: 'US', views: 6 }]);
  assert.deepEqual(month.locales, [{ key: 'en', views: 28 }, { key: 'th', views: 8 }]);

  const week = await readStats(all, statsPeriods('7d', TODAY));
  assert.deepEqual([week.totals, week.previous], [{ reads: 5, views: 21 }, { reads: 0, views: 0 }]);
  const quarter = await readStats(all, statsPeriods('90d', TODAY));
  assert.deepEqual([quarter.totals, quarter.previous], [{ reads: 19, views: 56 }, { reads: 2, views: 7 }]);
  const year = await readStats(all, statsPeriods('12m', TODAY));
  assert.deepEqual([year.totals, year.previous], [{ reads: 21, views: 63 }, { reads: 3, views: 9 }]);
  assert.deepEqual(year.series.map(({ key }) => key), [
    '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
  ]);
  assert.deepEqual(year.series.at(-1), { key: '2026-09', reads: 14, views: 36 });
  assert.deepEqual(year.series.at(-2), { key: '2026-08', reads: 5, views: 20 });
  assert.deepEqual(year.series[8], { key: '2026-06', reads: 2, views: 7 });

  assert.deepEqual((await readStats({ ...all, lang: 'th' }, statsPeriods('30d', TODAY))).totals, { reads: 6, views: 8 });
  assert.deepEqual((await readStats({ ...all, lang: 'en' }, statsPeriods('30d', TODAY))).totals, { reads: 8, views: 28 });
  const one = await readStats({ ...all, contentId: alpha }, statsPeriods('30d', TODAY));
  assert.deepEqual([one.totals, one.previous], [{ reads: 5, views: 16 }, { reads: 5, views: 20 }]);

  const period = statsPeriods('30d', TODAY).current;
  const titles = async (sort: 'ratio' | 'reads' | 'views', lang: 'en' | 'th' | null = null) =>
    (await readStatsArticles({ lang, ownerId: owner }, period, sort, 1)).articles.map(({ title }) => title);
  assert.deepEqual(await titles('views'), ['Alpha', 'บีตา', 'About', null], 'no home page, and the deleted one without a title');
  assert.deepEqual(await titles('reads'), ['บีตา', 'Alpha', null, 'About']);
  assert.deepEqual(await titles('ratio'), [null, 'บีตา', 'Alpha', 'About']);
  assert.deepEqual(await titles('views', 'th'), ['บีตา']);
  const [first] = (await readStatsArticles(all, period, 'views', 1)).articles;
  assert.deepEqual(first, { id: alpha, kind: 'post', locale: 'en', reads: 5, title: 'Alpha', views: 16 });

  // Top tens, from an owner of their own: nothing of the first owner's reaches them.
  const codes = ['AR', 'AU', 'BR', 'CA', 'DE', 'ES', 'FR', 'GB', 'IN', 'JP', 'TH', 'US'];
  await seed(other, codes.map((code, index): Row => [TODAY, 'home', null, 'en', `r${String(index + 1).padStart(2, '0')}.example`, 'desktop', code, index + 1, 0]));
  const tops = await readStats({ lang: null, ownerId: other }, statsPeriods('30d', TODAY));
  assert.equal(tops.referrers.length, 10);
  assert.deepEqual([tops.referrers[0], tops.referrers[9]], [{ key: 'r12.example', views: 12 }, { key: 'r03.example', views: 3 }]);
  assert.equal(tops.countries.length, 10);
  assert.deepEqual([tops.countries[0], tops.countries[9]], [{ key: 'US', views: 12 }, { key: 'BR', views: 3 }]);
  assert.deepEqual(tops.totals, { reads: 0, views: 78 });

  // Fifty a page.
  await seed(paged, Array.from({ length: STATS_PAGE_SIZE + 1 }, (): Row => [TODAY, 'post', randomUUID(), 'en', '', 'desktop', '', 1, 0]));
  const pageOne = await readStatsArticles({ lang: null, ownerId: paged }, period, 'views', 1);
  const pageTwo = await readStatsArticles({ lang: null, ownerId: paged }, period, 'views', 2);
  assert.deepEqual([pageOne.articles.length, pageOne.hasMore, pageTwo.articles.length, pageTwo.hasMore], [50, true, 1, false]);
  assert.equal(new Set([...pageOne.articles, ...pageTwo.articles].map(({ id }) => id)).size, 51, 'no row on both pages');

  assert.equal((await readStatsEdition(owner, alpha))?.title, 'Alpha');
  assert.equal((await readStatsEdition(owner, alpha))?.live, true);
  assert.equal((await readStatsEdition(owner, about))?.kind, 'page');
  assert.equal((await readStatsEdition(owner, draft))?.live, false, 'a draft is not live');
  assert.deepEqual(await readStatsEdition(owner, gone), { id: gone, kind: 'post', live: false, locale: 'en', slug: null, title: null });
  assert.equal(await readStatsEdition(owner, randomUUID()), null);
  assert.equal(await readStatsEdition(other, alpha), null, 'another owner’s article');

  // A read past its view caps the ratio at 100%, the way the screen does, instead of outranking a true 100%.
  const ratioOwner = randomUUID();
  await db.insertInto('user').values({
    id: ratioOwner, name: 'Owner', email: 'stats-ratio@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const over = randomUUID();
  const full = randomUUID();
  await seed(ratioOwner, [
    [TODAY, 'post', over, 'en', '', 'desktop', '', 2, 5],
    [TODAY, 'post', full, 'en', '', 'desktop', '', 4, 4],
  ]);
  const tieOrder = [over, full].sort();
  const ratioArticles = (await readStatsArticles({ lang: null, ownerId: ratioOwner }, period, 'ratio', 1)).articles;
  assert.deepEqual(ratioArticles.map(({ id }) => id), tieOrder, 'a ratio past 100% ties a true 100% and falls back to id order');
  assert.deepEqual(
    ratioArticles.map(({ reads, views }) => ({ reads, views })),
    tieOrder.map((id) => (id === over ? { reads: 5, views: 2 } : { reads: 4, views: 4 })),
  );

  assert.equal(await hasStats(owner), true);
  assert.equal(await hasStats(randomUUID()), false);
});
