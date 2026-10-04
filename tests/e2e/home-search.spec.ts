import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { expect, test } from './own-worker';
import { clearPageCache, signInOwner, type Owner } from './page-cache-reset';

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
  const result = docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', statement], 60_000);
  // A write behind the app's back: without this the page it drew before is served again.
  clearPageCache(owner);
  return result;
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
let owner: Owner | undefined;

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

// The owner, signed in once, for the writes that clear the page cache: see page-cache-reset.
test.beforeAll(async ({ browser }) => {
  owner = await signInOwner(browser, origin, OWNER);
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
    await expect(page.getByRole('status').filter({ hasText: 'Results for' })).toContainText('Results for “compost”');
    await expect(page.getByRole('link', { name: 'Clear search' })).toBeVisible();
    // Paper names the list in a heading, which is not inside the status, so it is not read out twice.
    if (theme === 'paper') await expect(page.getByRole('heading', { level: 2, name: 'Results for “compost”' })).toBeVisible();
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
    const older = page.getByRole('link', { name: theme === 'paper' ? /Older posts/ : /More posts/ });
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
    await page.getByRole('link', { name: theme === 'paper' ? /Older posts/ : /More posts/ }).click();
    await expect(page).toHaveURL(/cursor=/);
    await expect(cards(page, theme)).toHaveCount(pages[1]);
    const second = await titles();
    expect(new Set([...first, ...second]).size, 'every post once').toBe(9);
    expect(await page.getByRole('link', { name: theme === 'paper' ? /Older posts/ : /More posts/ }).count(), 'and nothing older than the last').toBe(0);
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
  await expect(page.getByRole('heading', { name: 'Results for “note”' })).toBeVisible();

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
  await expect(page.getByRole('heading', { name: 'ผลการค้นหา “กุหลาบ”' })).toBeVisible();
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

// Paper's home and its header, as a reader meets them (1.14.0). Each test sets the hero and the
// name it needs, and leaves them as the file found them: the text hero, and "Search Test".
test.describe('paper', () => {
  test.beforeEach(() => useTheme('paper'));
  test.afterEach(async () => {
    const { writeThemeSettings } = await import('../../src/server/themes/store');
    await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'text' } });
    clearPageCache(owner);
    psql(`update site_settings set site_name = 'Search Test'`);
  });

  test('a chosen category is shown like a search: no hero band, and a heading that names it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/en?category=Notes`);
    await expect(page.locator('.home-hero'), 'no band above a category').toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Notes', exact: true })).toBeVisible();

    // Chosen by its pill, which swaps the list in place: the band still gives way to it.
    await page.goto(`${origin}/en`);
    await expect(page.locator('.home-hero')).toBeVisible();
    await expect(page.locator('h1'), 'the text hero home has one h1').toHaveCount(1);
    await page.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: 'Notes' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Notes', exact: true })).toBeVisible();
    await expect(page.locator('.home-hero')).toBeHidden();
    await expect(page.locator('h1'), 'and still one when the band gives way').toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Search Test');
  });

  test('an empty category offers the way back to every post', async ({ page }) => {
    test.setTimeout(120_000);
    psql(`insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Bare', false) on conflict do nothing`);
    await page.goto(`${origin}/en?category=Bare`);
    // A category nobody has filed under is not listed, so its address is the only way in.
    await expect(page.getByText('No posts in this category yet.')).toBeVisible();
    await expect(page.locator('.post-feed').getByRole('link', { name: 'All posts' })).toHaveAttribute('href', '/en');
  });

  test('the home has one h1 whatever the band, and none of them hides it', async ({ page }) => {
    test.setTimeout(120_000);
    const { writeThemeSettings } = await import('../../src/server/themes/store');
    await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'off' } });
    clearPageCache(owner);
    for (const path of ['/en', '/en?q=note', '/en?category=Notes']) {
      await page.goto(`${origin}${path}`);
      await expect(page.locator('h1'), path).toHaveCount(1);
      await expect(page.locator('h1'), path).toHaveText('Search Test');
    }
  });

  test('on a phone the brand is whole beside the language, which is its code', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 812 });
    // The name the audit saw cut to "The Nigh…" beside the full language name.
    psql(`update site_settings set site_name = 'The Night Bakery'`);
    for (const [path, code] of [['/en', 'EN'], ['/th', 'TH']] as const) {
      await page.goto(`${origin}${path}`);
      const cut = await page.locator('.site-header .site-wordmark').evaluate((link) => {
        const name = link.querySelector('.site-brand__name')!.getBoundingClientRect();
        return link.scrollWidth > link.clientWidth || name.right > link.getBoundingClientRect().right + 0.5;
      });
      expect(cut, `${path}: the brand is not cut short`).toBe(false);
      const trigger = await page.locator('.site-header .language-switcher__trigger').boundingBox();
      expect(trigger!.width, `${path}: the language button is the width of its code`).toBeLessThan(100);
      const shown = await page.locator('.site-header .language-switcher__trigger').evaluate((trigger) => getComputedStyle(trigger, '::before').content);
      expect(shown, `${path}: the language as its code`).toBe(`"${code}"`);
    }
  });

  test('a slide shows its picture whole below 64rem, and its words read at 4.5:1 wherever they sit', async ({ page }) => {
    test.setTimeout(180_000);
    // A slide wants a picture in the library. The row has no object behind it: the browser is
    // handed a flat colour for it below -- white, the worst a photograph can be, and the mid-tone
    // the audit measured the slide words on.
    const { sql } = await import('kysely');
    const { db } = await import('../../src/server/db/client');
    const [image] = (await sql<{ id: string }>`insert into media_items (owner_id, folder_id, object_key, original_name, mime_type,
        size_bytes, width, height, checksum_sha256, alt_text, state)
      values (${OWNER}, null, 'seed/slide.webp', 'slide.webp', 'image/webp', 1000, 1600, 900, ${`${'c'.repeat(43)}=`}, 'A field', 'ready')
      returning id`.execute(db)).rows;
    const { homeSlidesSchema } = await import('../../src/lib/home-slides');
    const { replaceSlides } = await import('../../src/server/content/slides');
    // Two, so the slider's buttons are drawn too.
    const slide = (heading: string) => ({ mediaId: image.id, heading, body: 'Notes from a small bakery, set down while the oven cools.',
      align: 'start', overlay: 'soft', button: { label: 'Read the notes', link: { kind: 'custom', url: '/en', newTab: false } } });
    await replaceSlides(OWNER, homeSlidesSchema.parse({ locale: 'en', slides: [slide('Warm bread before the street wakes.'), slide('Second')] }));
    const { writeThemeSettings } = await import('../../src/server/themes/store');
    await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'slides' } });
    clearPageCache(owner);
    let fill = '#ffffff';
    await page.route('**/media/**', (route) => route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'cache-control': 'no-store' },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="${fill}"/></svg>`,
    }));
    // Still, so the first slide is the one on screen throughout.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sharp = (await import('sharp')).default;
    const luminance = ([r, g, b]: number[]) => {
      const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const shown = async () => {
      await page.goto(`${origin}/en`);
      await expect(page.locator('.hero-slide img').first()).toHaveJSProperty('complete', true);
    };
    // The server holds a language's live slides for five seconds, and the tests above read the home.
    // A home page drawn inside those seconds would be kept without its slides, so each try draws afresh.
    await expect(async () => {
      clearPageCache(owner);
      await page.goto(`${origin}/en`);
      await expect(page.locator('.hero-slide img')).toHaveCount(2, { timeout: 500 });
    }).toPass({ timeout: 15_000 });

    for (const colour of ['#ffffff', '#8a9b7a']) {
      fill = colour;
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await shown();
        const first = page.locator('.hero-slide').first();
        if (width < 1024) {
          // The picture whole, nothing over it, and the words and the buttons under it, apart: on a
          // tablet too, where a scrim deep enough for the words covered nearly all of the picture.
          const picture = (await first.locator('img').boundingBox())!;
          const words = (await first.locator('.hero-slide__words').boundingBox())!;
          const buttons = (await page.locator('.hero-slider__controls').boundingBox())!;
          expect(words.y, `${width}px: the words start under the picture`).toBeGreaterThanOrEqual(picture.y + picture.height - 0.5);
          expect(buttons.y, `${width}px: the buttons come after the words`).toBeGreaterThanOrEqual(words.y + words.height - 0.5);
          expect(buttons.x + buttons.width, `${width}px: and on the screen`).toBeLessThanOrEqual(width);
          expect(await first.evaluate((element) => getComputedStyle(element, '::after').content), 'no scrim on the picture').toBe('none');
        } else {
          // Over the picture, the scrim is short: at least half the picture is clear, or under no
          // more than the first half of the fade (a fifth of the scrim's ink at most).
          const slide = (await first.boundingBox())!;
          const words = (await first.locator('.hero-slide__words').boundingBox())!;
          const fade = await first.locator('.hero-slide__words').evaluate((element) => -parseFloat(getComputedStyle(element, '::before').top));
          expect((words.y - fade / 2 - slide.y) / slide.height, `${width}px: most of the picture stays clear`).toBeGreaterThanOrEqual(0.5);
        }
        for (const part of ['.hero-slide__heading', '.hero-slide__body']) {
          const words = first.locator(part);
          // The words' own colour, as the browser resolves it, read back through a canvas.
          const ink = await words.evaluate((element) => {
            const context = document.createElement('canvas').getContext('2d')!;
            context.fillStyle = getComputedStyle(element).color;
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
          });
          // What is behind them: the same box with the letters made clear, at the pixel nearest the
          // letters' own lightness -- the lightest under light words, the darkest under dark ones. Only
          // the letters: the scrim is drawn by the words' own box.
          const box = (await words.boundingBox())!;
          await page.addStyleTag({ content: '.hero-slide__words * { color: transparent !important; }' });
          const shot = await page.screenshot({ clip: box });
          await shown();
          const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const text = luminance(ink);
          let ratio = Infinity;
          for (let at = 0; at < data.length; at += info.channels) {
            const behind = luminance([data[at], data[at + 1], data[at + 2]]);
            ratio = Math.min(ratio, (Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05));
          }
          expect(ratio, `${part} at ${width}px over ${colour}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    await replaceSlides(OWNER, homeSlidesSchema.parse({ locale: 'en', slides: [] }));
  });
});

// Plain's home, as a reader meets it (1.14.0, spec §3). The tab-row test files posts under more
// categories, so it comes last.
test.describe('plain', () => {
  test.beforeEach(() => useTheme('plain'));
  const tabs = (page: Page) => page.getByRole('navigation', { name: 'Categories' });

  test('the home has one h1, the site\'s name, whatever the list', async ({ page }) => {
    test.setTimeout(120_000);
    for (const path of ['/en', '/en?q=note', '/en?category=Notes', '/th']) {
      await page.goto(`${origin}${path}`);
      await expect(page.locator('h1'), path).toHaveCount(1);
      await expect(page.locator('h1'), path).toHaveText('Search Test');
    }
  });

  test('the next page is "More posts", and a later page leads back to the newest', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${origin}/en?category=Uncategorized`);
    await expect(page.getByRole('link', { name: 'All posts →' }), 'the old label, the first tab\'s name').toHaveCount(0);
    await expect(page.getByRole('link', { name: /Latest posts/ }), 'the first page is the newest').toHaveCount(0);
    await page.getByRole('link', { name: 'More posts' }).click();
    await expect(page).toHaveURL(/category=Uncategorized.*cursor=/);
    const back = page.getByRole('link', { name: 'Latest posts' });
    await expect(back, 'the same list, from its newest').toHaveAttribute('href', '/en?category=Uncategorized');
    await back.click();
    await expect(page).toHaveURL(`${origin}/en?category=Uncategorized`);
  });

  test('an empty list says why: an empty category, and a list that failed to load', async ({ page }) => {
    test.setTimeout(120_000);
    psql(`insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Bare', false) on conflict do nothing`);
    await page.goto(`${origin}/en?category=Bare`);
    // It has no tab to mark it, so the list names it.
    await expect(page.getByRole('heading', { level: 2, name: 'Bare', exact: true })).toBeVisible();
    const empty = page.locator('.plain-empty');
    await expect(empty).toHaveText('No posts in this category yet. All posts');
    await expect(empty.getByRole('link', { name: 'All posts' })).toHaveAttribute('href', '/en');
    // A cursor that does not verify is a list that could not be read.
    await page.goto(`${origin}/en?cursor=not-a-cursor`);
    await expect(page.getByRole('alert')).toHaveText('Published posts are temporarily unavailable.');
    await expect(page.locator('.plain-empty:not([role])'), 'and no second sentence under it').toHaveCount(0);
  });

  test('during a search, "All posts" is not the list on screen', async ({ page }) => {
    test.setTimeout(120_000);
    const all = () => tabs(page).getByRole('link', { name: 'All posts' });
    await page.goto(`${origin}/en`);
    await expect(all()).toHaveAttribute('aria-current', 'page');
    await page.goto(`${origin}/en?q=note`);
    await expect(all()).not.toHaveAttribute('aria-current');
  });

  test('on a phone and a tablet the tabs are one row that scrolls, and the keyboard brings a tab into view', async ({ page }) => {
    test.setTimeout(120_000);
    // Enough names, long enough, that the row runs past a phone's and a tablet's width.
    const names = ['Kitchen experiments', 'Seasonal baking', 'Letters from readers', 'Equipment and tools', 'Market days', 'Long-read essays'];
    psql(`insert into categories (owner_id, name, is_default) values ${names.map((name) => `('${OWNER}', '${name}', false)`).join(', ')} on conflict do nothing;
      insert into post_category_assignments (translation_group_id, category_id, owner_id)
        select p.translation_group_id, c.id, '${OWNER}'
        from (values ${names.map((name, index) => `('field-note-${index + 2}', '${name}')`).join(', ')}) as v(slug, name)
        join posts p on p.slug = v.slug join categories c on c.name = v.name
        on conflict do nothing;`);
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`${origin}/en`);
      const row = tabs(page);
      const links = row.getByRole('link');
      await expect(links).toHaveCount(names.length + 3);
      const [scrolls, tops] = await row.evaluate((nav) => [
        nav.scrollWidth > nav.clientWidth,
        new Set([...nav.querySelectorAll('a')].map((link) => Math.round(link.getBoundingClientRect().top))).size,
      ]);
      expect(scrolls, `${width}: the row runs past the screen`).toBe(true);
      expect(tops, `${width}: on one line`).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${width}: the page does not scroll sideways`).toBeLessThanOrEqual(0);

      const last = links.last();
      const inView = () => last.evaluate((link) => {
        const tab = link.getBoundingClientRect();
        const box = link.parentElement!.getBoundingClientRect();
        return tab.left >= box.left - 0.5 && tab.right <= box.right + 0.5;
      });
      expect(await inView(), `${width}: the last tab starts out of view`).toBe(false);
      await page.getByRole('searchbox', { name: 'Search posts' }).focus();
      for (let presses = 0; presses < 20 && !await last.evaluate((link) => link === document.activeElement); presses += 1) {
        await page.keyboard.press('Tab');
      }
      await expect(last).toBeFocused();
      await expect.poll(inView, `${width}: focus brings it into view`).toBe(true);

      // Chosen, it is in view on arrival, with its bar. The row is in the site's order, not this list's.
      await page.goto(`${origin}/en?category=${encodeURIComponent((await last.textContent())!)}`);
      await expect(last).toHaveAttribute('aria-current', 'page');
      await expect.poll(inView, `${width}: the chosen tab is shown`).toBe(true);
    }
  });
});
