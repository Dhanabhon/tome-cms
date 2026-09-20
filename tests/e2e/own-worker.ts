import { test as base } from '@playwright/test';

/**
 * A spec that owns a database gets a worker of its own.
 *
 * Playwright runs every spec file in one worker process, and `src/server/db/client.ts` is a
 * module singleton bound at import: `closeDatabase()` destroys it for good, so the second
 * spec to reach for it was handed a dead pool. Not closing it would have been worse -- each
 * spec tears down its own Postgres container, so a pool carried over points at one that no
 * longer exists.
 *
 * Playwright starts a separate worker for tests whose worker-scoped options differ, and a
 * separate worker is a separate module registry and a separate pool. So each spec names
 * itself here, and gets one.
 */
/* eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Playwright's own shape
   for "no test-scoped fixtures, one worker-scoped option". */
type NoTestFixtures = {};

export const test = base.extend<NoTestFixtures, { stack: string }>({
  stack: ['shared', { option: true, scope: 'worker' }],
});

export { expect } from '@playwright/test';
