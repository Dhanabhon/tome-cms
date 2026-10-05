import assert from 'node:assert/strict';
import test from 'node:test';

test('a menu or a hero drawn around a failed read marks the render degraded; a whole read does not', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { getPublicNavigation, invalidatePublicNavigationCache } = await import('../../src/server/content/navigation');
  const { getPublicSlides, invalidatePublicSlidesCache } = await import('../../src/server/content/slides');
  const { renderDegraded, withRequestMemo } = await import('../../src/server/request-memo');
  context.after(closeDatabase);
  await migrateToLatest();

  const fresh = () => { invalidatePublicNavigationCache(); invalidatePublicSlidesCache(); };
  const degradedAfter = (read: () => Promise<unknown>) => withRequestMemo(async () => { await read(); return renderDegraded(); });

  fresh();
  assert.equal(await degradedAfter(() => getPublicNavigation('en')), false, 'a menu read that worked');
  assert.equal(await degradedAfter(() => getPublicSlides('en')), false, 'a slides read that worked');

  // A pool timeout under load, as the one-gigabyte server saw it.
  const quiet = context.mock.method(console, 'error', () => undefined);
  const failing = context.mock.method(db, 'selectFrom', () => { throw new Error('timeout exceeded when trying to connect'); });
  fresh();
  assert.deepEqual(await withRequestMemo(async () => [await getPublicNavigation('en'), renderDegraded()]), [{ footer: [], header: [] }, true]);
  fresh();
  assert.deepEqual(await withRequestMemo(async () => [await getPublicSlides('en'), renderDegraded()]), [[], true]);
  failing.mock.restore();
  quiet.mock.restore();

  fresh();
  assert.equal(await degradedAfter(() => getPublicNavigation('en')), false, 'the next request starts whole again');
});
