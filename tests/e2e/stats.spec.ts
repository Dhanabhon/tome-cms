import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Counting readers, measured in their browser and read back from the table.
 *
 * Counts are read with psql, not through the app's pool: a second pool in the Playwright worker
 * beside the dev server's own hung another suite (see public-plugins.spec.ts). The pool is opened
 * only to issue the owner's sign-in, as maintenance.spec.ts does.
 */

test.use({ stack: 'stats' });

const PROJECT = 'tomecms-stats';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'stats-secret-at-least-32-characters!';
const OWNER = '3a9c2e1f-7b4d-4e6a-8c5f-0d1e2f3a4b5c';
const ARTICLE = '5d0c7a1e-8b2f-4c3d-9e4f-1a2b3c4d5e6f';
const THAI = '6e1d8b2f-9c3a-4d4e-8f5a-2b3c4d5e6f70';
const GONE = '7f2e9c3a-ad4b-4e5f-9a6b-3c4d5e6f7081';
const ARTICLE_GROUP = '8a3f0d4b-be5c-4f6a-8b7c-4d5e6f708192';
const THAI_GROUP = '9b4a1e5c-cf6d-4a7b-9c8d-5e6f708192a3';
// Long enough that the end of the article is below the fold on both projects.
const BODY = Array.from({ length: 40 }, () => `<p>${'A sentence worth reading slowly. '.repeat(30)}</p>`).join('');

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function query(statement: string): string {
  return docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-t', '-A',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', statement], 60_000).stdout.trim();
}

function counts(id: string): { reads: number; views: number } {
  const [views, reads] = query(`select coalesce(sum(views), 0) || '|' || coalesce(sum(reads), 0)
    from content_stats_daily where content_id = '${id}'`).split('|').map(Number);
  return { reads, views };
}

/** The events a page posts to the counter, in order, as the browser sends them. */
function watchHits(page: Page): string[] {
  const events: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/stats/hit') {
      events.push(String(JSON.parse(request.postData() ?? '{}').event));
    }
  });
  return events;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No port available.'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function signIn(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const enrollment = await issueRecoveryEnrollment(OWNER);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
}

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  process.env.TOME_CMS_TEST_ORIGIN = origin;
  const serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    // Astro 7 backgrounds the dev server when it detects an agent, and a detached server is
    // one this test cannot wait on or stop.
    ASTRO_DEV_BACKGROUND: '1',
    DATABASE_URL: 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    TOME_CMS_PUBLIC_URL: origin,
    TOME_CMS_INSTALL_TOKEN: CREDENTIAL,
    BETTER_AUTH_SECRET: CREDENTIAL,
    TOME_CMS_CONTEXT_SECRET: CREDENTIAL,
    TOME_CMS_RECOVERY_PEPPER: CREDENTIAL,
    S3_ENDPOINT: 'http://127.0.0.1:59000',
    S3_ACCESS_KEY_ID: 'tomecms_test',
    S3_SECRET_ACCESS_KEY: 'foundation-test-only',
    S3_BUCKET: 'tomecms-test-media',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: 'true',
    MEDIA_PUBLIC_URL: 'http://127.0.0.1:59000/tomecms-test-media/',
    TOME_CMS_FRONTEND_MODE: 'bundled',
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-stats',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  query('drop schema public cascade; create schema public;');

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner with an English and a Thai article, without walking the wizard.
  query(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
      values (true, '${OWNER}', 'Stats Test', 'en', 'UTC', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);
    insert into post_translation_groups (id, owner_id) values ('${ARTICLE_GROUP}', '${OWNER}'), ('${THAI_GROUP}', '${OWNER}');
    insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select g.id, c.id, '${OWNER}' from post_translation_groups g, categories c;
    insert into posts (id, translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
      values ('${ARTICLE}', '${ARTICLE_GROUP}', 'en', 'Worth reading', 'worth-reading', '{"type":"doc","content":[]}'::jsonb,
          '${BODY}', 'published', now() - interval '1 day', '${OWNER}'),
        ('${THAI}', '${THAI_GROUP}', 'th', 'บทความภาษาไทย', 'thai-article', '{"type":"doc","content":[]}'::jsonb,
          '<p>สั้น ๆ</p>', 'published', now() - interval '1 day', '${OWNER}');`);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Stats test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Stats test server never became ready.\n${output}`);
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  try {
    const { closeDatabase } = await import('../../src/server/db/client');
    await closeDatabase();
  } catch {
    // The pool may never have opened.
  }
  docker(['down', '--volumes', '--remove-orphans'], 90_000);
});

test('a view counts once a tab, and a read takes the end and fifteen visible seconds', async ({ context, page }) => {
  test.setTimeout(90_000);
  await context.clock.install();
  const first = watchHits(page);
  await page.goto(`${origin}/en/blog/worth-reading`);
  await expect.poll(() => counts(ARTICLE)).toEqual({ reads: 0, views: 1 });

  await page.reload();
  await context.clock.runFor(20_000);
  expect(first, 'a reload sends nothing, and twenty seconds above the end are not a read').toEqual(['view']);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => first).toEqual(['view', 'read']);
  await expect.poll(() => counts(ARTICLE)).toEqual({ reads: 1, views: 1 });

  // A new tab is a new reader as far as a tab can tell: a view, and a read of its own once earned.
  const second = await context.newPage();
  const more = watchHits(second);
  await second.bringToFront();
  await second.goto(`${origin}/en/blog/worth-reading`);
  await second.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await context.clock.runFor(10_000);
  expect(more, 'the end reached, but ten seconds are not fifteen').toEqual(['view']);
  await context.clock.runFor(5_000);
  await expect.poll(() => more).toEqual(['view', 'read']);
  await expect.poll(() => counts(ARTICLE)).toEqual({ reads: 2, views: 2 });
});

test('a long same-site referrer is sent as just its origin, staying well under the 1 KB body limit', async ({ page }) => {
  test.setTimeout(60_000);
  // Percent-encoded, as a real same-site link's referrer would be: a Thai slug is 9 bytes a
  // character encoded, so 160 of them alone would push the body past the 1 KB limit.
  const referer = `${origin}/th/${encodeURIComponent('ก'.repeat(160))}`;
  let sentReferrer: string | undefined;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/stats/hit') {
      const body = JSON.parse(request.postData() ?? '{}');
      if (body.event === 'view') sentReferrer = body.referrer;
    }
  });
  const before = counts(ARTICLE);
  await page.goto(`${origin}/en/blog/worth-reading`, { referer });
  await expect.poll(() => counts(ARTICLE), 'a long referrer must not push the hit over the body limit').toEqual({ ...before, views: before.views + 1 });
  expect(sentReferrer, 'the beacon sends only the referrer’s origin, not its long Thai path').toBe(origin);
});

test('a reader who asked not to be followed, and a hit from another site, count nothing', async ({ browser, request }) => {
  for (const [why, script] of [
    ['Do Not Track', 'Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1" })'],
    ['Global Privacy Control', 'Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true })'],
  ] as const) {
    const context = await browser.newContext();
    await context.addInitScript(script);
    const page = await context.newPage();
    const hits = watchHits(page);
    await page.goto(`${origin}/en/blog/worth-reading`);
    expect(hits, why).toEqual([]);
    await context.close();
  }

  const before = counts(ARTICLE);
  const hit = { event: 'view', id: ARTICLE, kind: 'post', locale: 'en', width: 1280 };
  const refused = await request.post(`${origin}/api/v1/stats/hit`, { data: hit, headers: { Origin: 'https://elsewhere.example' } });
  expect(refused.status(), 'the same answer as a hit that counted').toBe(204);
  // The same request from the site itself does count, so the one above was refused, not lost.
  const own = await request.post(`${origin}/api/v1/stats/hit`, { data: hit, headers: { Origin: origin } });
  expect(own.status()).toBe(204);
  await expect.poll(() => counts(ARTICLE)).toEqual({ ...before, views: before.views + 1 });
});

test('the owner’s own browser counts nothing, and neither does a theme preview', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);

  const tab = await context.newPage();
  const hits = watchHits(tab);
  await tab.goto(`${origin}/en/blog/worth-reading`);
  expect(hits, 'a browser that has opened the admin').toEqual([]);
  await tab.close();

  await page.goto(`${origin}/admin/themes/preview/paper`);
  await expect(page.locator('[data-stats]')).toHaveCount(0);
});

test('Stats shows what was counted, by range, language and sort, and one article alone', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  const shoot = (name: string) => page.screenshot({ fullPage: true, path: test.info().outputPath(`stats-${name}.png`) });

  query('delete from content_stats_daily');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/admin/stats`);
  await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No readers counted yet' })).toBeVisible();
  await expect(page.getByText('Your own visits are not counted.')).toBeVisible();
  await expect(page.locator('a[href="/admin/stats"]').first()).toBeAttached();
  await shoot('empty-1280-light');

  query(`insert into content_stats_daily (owner_id, day, kind, content_id, locale, referrer, device, country, views, reads) values
    ('${OWNER}', current_date, 'post', '${ARTICLE}', 'en', 'news.example', 'desktop', 'TH', 10, 4),
    ('${OWNER}', current_date - 4, 'post', '${ARTICLE}', 'en', '', 'mobile', 'US', 6, 1),
    ('${OWNER}', current_date - 14, 'post', '${THAI}', 'th', 'internal', 'mobile', 'TH', 8, 6),
    ('${OWNER}', current_date - 1, 'home', null, 'en', '', 'desktop', '', 5, 0),
    ('${OWNER}', current_date - 19, 'post', '${GONE}', 'en', 'news.example', 'desktop', 'TH', 3, 3),
    ('${OWNER}', current_date - 45, 'post', '${ARTICLE}', 'en', '', 'desktop', 'TH', 20, 5)`);
  await page.reload();
  const summary = page.locator('.stats-summary > div');
  await expect(summary.nth(0)).toHaveText(/Views\s*32\s*↑ 60%/);
  await expect(summary.nth(1)).toHaveText(/Reads\s*14\s*↑ 180%/);
  await expect(summary.nth(2)).toHaveText(/Read ratio\s*44%\s*↑ 19 points/);
  await expect(page.getByRole('heading', { name: 'Views and reads per day' })).toBeVisible();
  await expect(page.locator('.stats-share').filter({ hasText: 'Where readers came from' })).toContainText('news.example');
  await expect(page.locator('.stats-share').filter({ hasText: 'Where readers came from' })).toContainText('This site');
  await expect(page.locator('.stats-share').filter({ hasText: 'Countries' })).toContainText('Thailand');
  await expect(page.getByRole('link', { name: 'IP Geolocation by DB-IP' })).toHaveAttribute('href', 'https://db-ip.com');
  const rows = page.locator('.stats-articles tbody tr');
  await expect(rows.first().locator('th')).toHaveText('Worth reading');
  await expect(rows.last().locator('th')).toHaveText('Deleted');
  await shoot('data-1280-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shoot('data-1280-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.getByRole('link', { name: 'Last 7 days' }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(summary.nth(0)).toHaveText(/Views\s*21\s*Nothing to compare with yet/);

  await page.getByRole('link', { name: 'Last 30 days' }).click();
  await page.getByRole('link', { name: 'Thai', exact: true }).click();
  await expect(page).toHaveURL(/lang=th/);
  await expect(summary.nth(0)).toHaveText(/Views\s*8/);
  await expect(page.locator('.stats-articles thead').getByRole('link', { name: 'Reads' }), 'a sort keeps the language').toHaveAttribute('href', '/admin/stats?lang=th&sort=reads');
  await page.getByRole('link', { name: 'All languages' }).click();

  await page.locator('.stats-articles thead').getByRole('link', { name: 'Reads' }).click();
  await expect(page).toHaveURL(/sort=reads/);
  await expect(rows.first().locator('th')).toHaveText('บทความภาษาไทย');

  await page.setViewportSize({ width: 375, height: 812 });
  // The admin clips the page itself (html and body, overflow-x: clip), so an overflow shows in its main, not the document.
  expect(await page.locator('main').evaluate((main) => main.scrollWidth), 'nothing wider than a small phone').toBeLessThanOrEqual(375);
  await shoot('data-375-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shoot('data-375-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole('link', { name: 'Worth reading' }).click();
  await expect(page.getByRole('heading', { name: 'Worth reading', level: 1 })).toBeVisible();
  await expect(summary.nth(0)).toHaveText(/Views\s*16/);
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', `/admin/edit/${ARTICLE}`);
  await expect(page.getByRole('link', { name: 'View on site' })).toHaveAttribute('href', '/en/blog/worth-reading');
  await page.getByRole('link', { name: 'All stats' }).click();
  await expect(page).toHaveURL(/\/admin\/stats\?sort=reads$/);

  await page.goto(`${origin}/admin/stats/${GONE}`);
  await expect(page.getByRole('heading', { name: 'Deleted', level: 1 })).toBeVisible();
  const missing = await page.goto(`${origin}/admin/stats/00000000-0000-4000-8000-000000000000`);
  expect(missing?.status()).toBe(404);
});
