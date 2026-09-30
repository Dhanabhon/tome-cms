import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Searching the posts from the homepage, in both bundled themes, as a reader does it.
 *
 * The search box is a plain form that goes to `?q=`, so it works with no script at all, and Paper's
 * category pills, which swap the list in place, must not leave the old words in the box. What the
 * search finds is asserted on a real database in tests/integration/published-search.test.ts;
 * this file is about the page: where the box is, what a result page says, and that leaving a
 * search leaves it.
 */

test.use({ stack: 'home-search' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The widths are set by the tests themselves; one browser is enough.');

const PROJECT = 'tomecms-home-search';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'home-search-secret-at-least-32-chars!';
const OWNER = 'home-search-owner';

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function psql(statement: string) {
  return docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', statement], 60_000);
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

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-home-search',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  psql('drop schema public cascade; create schema public;');

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner, eight notes (so a page of six has an older one), one about compost, and
  // one in Thai. Field note 1 is also in "Notes", the pill the tests click.
  psql(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
      values (true, '${OWNER}', 'Search Test', 'en', 'UTC', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true), ('${OWNER}', 'Notes', false);
    do $$
    declare g uuid; n int;
    begin
      for n in 1..8 loop
        insert into post_translation_groups (owner_id) values ('${OWNER}') returning id into g;
        insert into posts (translation_group_id, locale, title, slug, excerpt, content_json, content_html, status, published_at, owner_id)
          values (g, 'en', 'Field note ' || n, 'field-note-' || n, 'Observation number ' || n,
            '{"type":"doc","content":[]}'::jsonb, '<p>Notes from the garden, day ' || n || '.</p>',
            'published', now() - (n || ' hours')::interval, '${OWNER}');
        insert into post_category_assignments (translation_group_id, category_id, owner_id)
          select g, id, '${OWNER}' from categories where name = case when n = 1 then 'Notes' else 'Uncategorized' end;
      end loop;
      insert into post_translation_groups (owner_id) values ('${OWNER}') returning id into g;
      insert into posts (translation_group_id, locale, title, slug, excerpt, content_json, content_html, status, published_at, owner_id)
        values (g, 'en', 'Gardening in winter', 'gardening-in-winter', '',
          '{"type":"doc","content":[]}'::jsonb, '<p>The <strong>compost</strong> heap needs turning.</p>',
          'published', now() - interval '20 hours', '${OWNER}');
      insert into post_category_assignments (translation_group_id, category_id, owner_id)
        select g, id, '${OWNER}' from categories where name = 'Uncategorized';
      insert into post_translation_groups (owner_id) values ('${OWNER}') returning id into g;
      insert into posts (translation_group_id, locale, title, slug, excerpt, content_json, content_html, status, published_at, owner_id)
        values (g, 'th', 'สวนหลังบ้าน', 'suan-lang-ban', 'วิธีปลูกกุหลาบ',
          '{"type":"doc","content":[]}'::jsonb, '<p>ปุ๋ยหมักต้องกลับกองทุกสัปดาห์</p>',
          'published', now() - interval '1 hour', '${OWNER}');
      insert into post_category_assignments (translation_group_id, category_id, owner_id)
        select g, id, '${OWNER}' from categories where name = 'Uncategorized';
    end $$;`);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Search test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Search test server never became ready.\n${output}`);
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

const useTheme = (id: 'paper' | 'plain') => psql(`update site_settings set theme_id = '${id}'`);
const cards = (page: Page, theme: 'paper' | 'plain') => page.locator(theme === 'paper' ? '.post-card' : '.plain-lead, .plain-grid > li');
const searchBox = (page: Page, label = 'Search posts') => page.getByRole('search').getByRole('searchbox', { name: label });
const robots = (page: Page) => page.locator('meta[name="robots"]').getAttribute('content');

for (const theme of ['paper', 'plain'] as const) {
  test(`${theme}: a search is a form in the page, it shows what was found, and it can be left`, async ({ page }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/en`);
    await expect(searchBox(page), 'the box is above the list, in the page').toBeVisible();
    expect(await robots(page) ?? '', 'the list is for search engines').not.toContain('noindex');
    // The feed may already be fetching the older cards behind the first page, so counts are floors.
    expect(await cards(page, theme).count()).toBeGreaterThanOrEqual(6);

    await searchBox(page).fill('compost');
    await searchBox(page).press('Enter');
    await expect(page).toHaveURL(`${origin}/en?q=compost`);
    await expect(cards(page, theme), 'the one post whose body says compost').toHaveCount(1);
    await expect(cards(page, theme).first()).toContainText('Gardening in winter');
    await expect(page.getByRole('status').filter({ hasText: 'Results for' })).toHaveText(/Results for “compost”.*Clear search/);
    await expect(searchBox(page), 'the words stay in the box').toHaveValue('compost');
    expect(await robots(page), 'a search is not something to index').toBe('noindex, follow');
    if (theme === 'paper') await expect(page.locator('.home-hero'), 'the results come first, not the hero').toHaveCount(0);

    await page.getByRole('link', { name: 'Clear search' }).click();
    await expect(page).toHaveURL(`${origin}/en`);
    await expect(searchBox(page)).toHaveValue('');
    expect(await cards(page, theme).count(), 'the whole list is back').toBeGreaterThanOrEqual(6);
    if (theme === 'paper') await expect(page.locator('.home-hero'), 'and the hero is back').toHaveCount(1);
  });

  test(`${theme}: a search with nothing found says so, and words are shown as text`, async ({ page }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    // Quotes to break out of the box's value, a tag, and the patterns String.replace treats as its own.
    const words = `"><b>zebra</b> $& $' 'x`;
    await page.goto(`${origin}/en?q=${encodeURIComponent(words)}`);
    await expect(cards(page, theme)).toHaveCount(0);
    await expect(page.getByText(`No posts match “${words}”.`), 'the words are text, not markup').toBeVisible();
    await expect(page.locator('b'), 'and no tag was made of them').toHaveCount(0);
    await expect(searchBox(page), 'the box holds exactly what was typed').toHaveValue(words);
    await expect(page, 'and the tab says what the page is').toHaveTitle(`Results for “${words}” | Search Test`);
  });

  test(`${theme}: with no script the form still searches, and the older posts keep the search`, async ({ browser }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${origin}/en`);
    await searchBox(page).fill('note');
    await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(`${origin}/en?q=note`);
    await expect(cards(page, theme), 'a page of six').toHaveCount(6);
    const older = page.getByRole('link', { name: theme === 'paper' ? /Older posts/ : /All posts →/ });
    await expect(older).toHaveAttribute('href', /q=note/);
    await older.click();
    await expect(page).toHaveURL(/q=note.*cursor=|cursor=.*q=note/);
    await expect(cards(page, theme), 'the other two of the eight notes').toHaveCount(2);
    expect(await robots(page)).toBe('noindex, follow');
    await context.close();
  });
}

// Plain's first page is its lead and a grid of six; Paper's is six cards. Either way the page after
// it carries on where it stopped: nothing twice, nothing missed, and nine posts in all.
for (const [theme, pages] of [['paper', [6, 3]], ['plain', [7, 2]]] as const) {
  test(`${theme}: an unsearched list pages as ${pages.join(' then ')}, with no post repeated or skipped`, async ({ browser }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const titles = () => cards(page, theme).locator('h2').allTextContents();
    await page.goto(`${origin}/en`);
    await expect(cards(page, theme)).toHaveCount(pages[0]);
    const first = await titles();
    await page.getByRole('link', { name: theme === 'paper' ? /Older posts/ : /All posts →/ }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(cards(page, theme)).toHaveCount(pages[1]);
    const second = await titles();
    expect(new Set([...first, ...second]).size, 'every post once').toBe(9);
    expect(await page.getByRole('link', { name: theme === 'paper' ? /Older posts/ : /All posts →/ }).count(), 'and nothing older than the last').toBe(0);
    await context.close();
  });
}

test('paper: choosing a category leaves the search, in the list and in the box', async ({ page }) => {
  test.setTimeout(120_000);
  useTheme('paper');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/en?q=note`);
  // The feed may already have fetched the older two behind the first six, so the count is not asked.
  await expect(page.locator('.post-card').first()).toContainText('Field note');
  await expect(page.getByText('Results for “note”')).toBeVisible();

  await page.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(`${origin}/en?category=Notes`);
  await expect(page.locator('.post-card'), 'only Field note 1 is in Notes').toHaveCount(1);
  await expect(page.getByText('Results for')).toHaveCount(0);
  await expect(searchBox(page), 'the box no longer claims a search that is not on screen').toHaveValue('');
});

test('thai: the box and the words around a result are in the reader\'s language', async ({ page }) => {
  test.setTimeout(120_000);
  useTheme('paper');
  await page.goto(`${origin}/th`);
  const box = searchBox(page, 'ค้นหาบทความ');
  await expect(box).toBeVisible();
  await box.fill('กุหลาบ');
  await box.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/th\\?q=${encodeURIComponent('กุหลาบ')}`));
  await expect(page.locator('.post-card')).toHaveCount(1);
  await expect(page.getByText('ผลการค้นหา “กุหลาบ”')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ล้างการค้นหา' })).toBeVisible();
});

test('a sender that searches once a second for a minute is told to wait, and nobody else is', async ({ request }) => {
  test.setTimeout(120_000);
  useTheme('paper');
  // The proxy in front of a real site writes who is asking; here the test does, from the loopback
  // the server treats as the proxy's side, so this sender's count is its own. A new one each run,
  // so a second run against the same server does not start with the last one's minute.
  const octet = () => 1 + Math.floor(Math.random() * 250);
  const greedy = `198.51.${octet()}.${octet()}`;
  const other = `198.51.${octet()}.${octet()}`;
  const as = (address: string) => ({ headers: { 'x-forwarded-for': address } });
  let held = 0;
  for (let count = 1; count <= 62; count += 1) {
    const answer = await request.get(`${origin}/en?q=note`, as(greedy));
    if (answer.status() === 429) {
      held += 1;
      expect(answer.headers()['retry-after']).toBe('60');
      expect(await answer.text()).toContain('Try again in a minute');
    } else {
      expect(answer.status(), `search ${count}`).toBe(200);
    }
  }
  expect(held, 'the 61st and 62nd').toBe(2);
  expect((await request.get(`${origin}/en`, as(greedy))).status(), 'the list itself is still there').toBe(200);
  expect((await request.get(`${origin}/en?q=note`, as(other))).status(), 'another reader searches as usual').toBe(200);
});

for (const theme of ['paper', 'plain'] as const) {
  for (const width of [375, 1440]) {
    test(`${theme}: the box fits at ${width} px, and the page does not scroll sideways`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      useTheme(theme);
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of [['idle', '/en'], ['results', '/en?q=note']] as const) {
        await page.goto(`${origin}${path}`);
        const box = searchBox(page);
        await expect(box).toBeVisible();
        const field = await box.boundingBox();
        const button = await page.getByRole('search').getByRole('button', { name: 'Search' }).boundingBox();
        expect(field && field.x >= 0 && field.x + field.width <= width, 'the field is inside the screen').toBe(true);
        expect(button && button.x >= 0 && button.x + button.width <= width, 'and so is the button').toBe(true);
        expect(field!.height, 'a target a thumb can hit').toBeGreaterThanOrEqual(40);
        expect(button!.height).toBeGreaterThanOrEqual(40);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
        await page.screenshot({ fullPage: false, path: testInfo.outputPath(`${theme}-${width}-${name}.png`) });
      }
    });
  }
}
