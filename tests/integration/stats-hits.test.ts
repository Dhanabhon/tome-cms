import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

// Ten connections instead of the harness's one. With one, "200 at once" would queue in the pool
// and prove nothing about two writers meeting on the same row.
process.env.DATABASE_POOL_MAX = '10';

/** TOME_CMS_PUBLIC_URL in scripts/test-foundation.mjs. */
const SITE = 'http://localhost:4321';
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function hitRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}/api/v1/stats/hit`, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: SITE, 'User-Agent': BROWSER, ...headers },
    method: 'POST',
  });
}

test('a hit is counted once into the right row, and anything else is dropped with its reason', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  const { sql } = await import('kysely');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { countHit, receiveHit } = await import('../../src/server/stats/hits');
  context.after(closeDatabase);
  await migrateToLatest();

  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'stats-hits@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Stats', default_locale: 'en', timezone: 'Asia/Bangkok', admin_path: '/admin',
    author_avatar_media_id: null,
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const post = (values: { locale?: 'en' | 'th'; published_at?: Date | null; status?: 'draft' | 'published' } = {}) =>
    db.transaction().execute(async (trx) => {
      const group = await trx.insertInto('post_translation_groups').values({ owner_id: ownerId }).returning('id').executeTakeFirstOrThrow();
      const { id } = await trx.insertInto('posts').values({
        content_html: '<p>Words</p>', content_json: { content: [], type: 'doc' }, cover_media_id: null,
        locale: values.locale ?? 'en', meta_description: null, meta_title: null, owner_id: ownerId,
        published_at: values.published_at === undefined ? new Date('2026-01-01T00:00:00Z') : values.published_at,
        slug: `post-${randomUUID()}`, status: values.status ?? 'published', title: 'A post', translation_group_id: group.id,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('post_category_assignments').values({ category_id: category.id, owner_id: ownerId, translation_group_id: group.id }).execute();
      return id;
    });

  const article = await post();
  const draft = await post({ published_at: null, status: 'draft' });
  const due = await post({ published_at: new Date(Date.now() + 86_400_000) });
  const thai = await post({ locale: 'th' });

  const NOON = new Date('2026-09-24T05:00:00Z'); // 12:00 in Bangkok
  let next = 0;
  // A new address for every hit, so the limit is only in play where it is being tested.
  const send = (body: unknown, headers?: Record<string, string>, options: { headless?: boolean; now?: Date } = {}) =>
    receiveHit(hitRequest(body, headers), `203.0.113.${(next += 1) % 250}`, { headless: options.headless ?? false, now: options.now ?? NOON });
  const rows = () => db.selectFrom('content_stats_daily')
    .select([sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'), 'kind', 'content_id', 'locale', 'referrer', 'device', 'country', 'views', 'reads'])
    .where('owner_id', '=', ownerId).orderBy('day').orderBy('referrer').orderBy('device').orderBy('kind').execute();
  const view = { event: 'view', id: article, kind: 'post', locale: 'en', width: 1280 };

  assert.equal(await send(view, { 'CF-IPCountry': 'TH' }), null);
  assert.equal(await send({ ...view, event: 'read', referrer: 'https://www.news.example/story?x=1', width: 375 }), null);
  assert.equal(await send({ ...view, referrer: `${SITE}/en/` }), null);
  assert.equal(await send(view, {}, { now: new Date('2026-09-24T17:30:00Z') }), null, 'half past midnight in Bangkok');
  assert.equal(await send({ event: 'view', kind: 'home', locale: 'en', width: 800 }), null);
  assert.deepEqual(await rows(), [
    { content_id: null, country: '', day: '2026-09-24', device: 'desktop', kind: 'home', locale: 'en', reads: 0, referrer: '', views: 1 },
    { content_id: article, country: 'TH', day: '2026-09-24', device: 'desktop', kind: 'post', locale: 'en', reads: 0, referrer: '', views: 1 },
    { content_id: article, country: '', day: '2026-09-24', device: 'desktop', kind: 'post', locale: 'en', reads: 0, referrer: 'internal', views: 1 },
    { content_id: article, country: '', day: '2026-09-24', device: 'mobile', kind: 'post', locale: 'en', reads: 1, referrer: 'news.example', views: 0 },
    { content_id: article, country: '', day: '2026-09-25', device: 'desktop', kind: 'post', locale: 'en', reads: 0, referrer: '', views: 1 },
  ]);

  const before = await rows();
  // Thunks, run one after another: started together, an assertion that fails early would leave
  // the rest still in flight when `after(closeDatabase)` tears down the pool, and the run hangs
  // instead of failing. Concurrency itself is covered separately, by the 200-writer case below.
  for (const [reason, drop] of [
    ['not-live', () => send({ ...view, id: draft })],
    ['not-live', () => send({ ...view, id: due })],
    ['not-live', () => send({ ...view, id: thai })],
    ['not-live', () => send({ ...view, id: randomUUID() })],
    ['invalid', () => send({ ...view, kind: 'home' })],
    ['invalid', () => send({ event: 'read', kind: 'home', locale: 'en', width: 800 })],
    ['invalid', () => send({ ...view, width: 0 })],
    ['not-json', () => send('{"event":')],
    ['not-json', () => send(view, { 'Content-Type': 'text/plain' })],
    ['too-large', () => send({ ...view, referrer: `https://a.example/${'x'.repeat(1_100)}` })],
    ['bot', () => send(view, { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })],
    ['cross-origin', () => send(view, { Origin: 'https://elsewhere.example' })],
    ['cross-origin', () => receiveHit(new Request(`${SITE}/api/v1/stats/hit`, {
      body: JSON.stringify(view), headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER }, method: 'POST',
    }), '203.0.113.200', { headless: false, now: NOON })],
  ] as const) {
    assert.equal(await drop(), reason);
  }
  assert.deepEqual(await rows(), before, 'nothing dropped reached a row');

  assert.equal(await send(view, { Origin: '', 'Sec-Fetch-Site': 'same-origin' }), null, 'a same-origin request that sent no Origin');
  assert.equal(await send(view, { Origin: 'https://reader.example' }, { headless: true }), null, 'any origin, when the site is headless');

  // The limit, from one address.
  const outcomes = [];
  for (let hit = 0; hit < 125; hit += 1) {
    outcomes.push(await receiveHit(hitRequest(view), '198.51.100.7', { headless: false, now: NOON }));
  }
  assert.equal(outcomes.filter((outcome) => outcome === null).length, 120);
  assert.deepEqual(outcomes.slice(120), Array(5).fill('rate-limited'));

  // Two hundred writers on one row.
  const row = {
    contentId: article, country: '', day: '2026-01-01', device: 'desktop' as const, kind: 'post' as const,
    locale: 'en' as const, ownerId, referrer: 'concurrency.example',
  };
  await Promise.all(Array.from({ length: 200 }, () => countHit(row, 'view')));
  const counted = await db.selectFrom('content_stats_daily').select(['views', 'reads'])
    .where('owner_id', '=', ownerId).where('referrer', '=', 'concurrency.example').execute();
  assert.deepEqual(counted, [{ reads: 0, views: 200 }]);

  const everything = JSON.stringify(await db.selectFrom('content_stats_daily').selectAll().execute());
  assert.equal(/203\.0\.113\.|198\.51\.100\./.test(everything), false, 'no address in any row');
});
