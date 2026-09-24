import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const violates = (code: string, constraint: string) => (error: unknown) => typeof error === 'object'
  && error !== null && 'code' in error && error.code === code
  && 'constraint' in error && error.constraint === constraint;

test('content_stats_daily holds counters, and nothing a counter could not be', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  context.after(closeDatabase);
  await migrateToLatest();

  const owner = randomUUID();
  await db.insertInto('user').values({
    id: owner, name: 'Owner', email: 'stats-schema@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const row = {
    content_id: randomUUID(), country: 'TH', day: '2026-09-24', device: 'desktop' as const, kind: 'post' as const,
    locale: 'en' as const, owner_id: owner, reads: 0, referrer: '', views: 1,
  };
  // An id no post has: counts are history, and outlive what they counted.
  await db.insertInto('content_stats_daily').values(row).execute();

  const refused = (values: Record<string, unknown>, constraint: string) => assert.rejects(
    db.insertInto('content_stats_daily').values({ ...row, content_id: randomUUID(), ...values } as never).execute(),
    violates('23514', constraint),
    constraint,
  );
  await refused({ kind: 'feed' }, 'content_stats_daily_kind_check');
  await refused({ content_id: null }, 'content_stats_daily_content_check');
  await refused({ kind: 'home' }, 'content_stats_daily_content_check');
  await refused({ locale: 'fr' }, 'content_stats_daily_locale_check');
  await refused({ device: 'tablet' }, 'content_stats_daily_device_check');
  await refused({ country: 'th' }, 'content_stats_daily_country_check');
  await refused({ country: 'THA' }, 'content_stats_daily_country_check');
  await refused({ referrer: 'a'.repeat(254) }, 'content_stats_daily_referrer_check');
  await refused({ views: -1 }, 'content_stats_daily_counts_check');
  await refused({ reads: -1 }, 'content_stats_daily_counts_check');

  // The home page has no id, and null is not a way around the key: the same home row twice is
  // one row, or the upsert would add a new one on every hit.
  const home = { ...row, content_id: null, kind: 'home' as const };
  await db.insertInto('content_stats_daily').values(home).execute();
  await assert.rejects(db.insertInto('content_stats_daily').values(home).execute(), violates('23505', 'content_stats_daily_key'));

  await db.deleteFrom('user').where('id', '=', owner).execute();
  const left = await db.selectFrom('content_stats_daily').select('owner_id').where('owner_id', '=', owner).execute();
  assert.equal(left.length, 0, 'the owner\'s deletion takes the counts with it');
});
