import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { publicCopy } from '../../src/lib/i18n';
import type { PostListLayout } from '../../src/lib/editor-post-list';
import type { EditorNode } from '../../src/types/cms';
import { expect, test } from './own-worker';

/**
 * A page's post lists as a reader meets them, in each theme: where they fall among the page's text,
 * how many columns they take, and that nothing they hold runs off a phone's screen.
 *
 * The data is written once, before the server starts, through the functions the admin uses. Each
 * theme has its own copy of each page: the page cache keeps a page by its address, so a theme
 * switched with psql would otherwise be answered with the last theme's drawing, and clearing the
 * cache takes a sign-in these public pages have no other use for.
 *
 * POST_LIST_SHOTS=<dir> writes each theme's lists at 320 and 1440 px, light and dark. Without it no
 * picture is taken.
 */

test.use({ stack: 'post-list', reducedMotion: 'reduce' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The widths are set by the tests themselves; one browser is enough.');
// A cold dev server compiles each theme the first time one of its pages is asked for.
test.describe.configure({ timeout: 60_000 });

const PROJECT = 'tomecms-post-list';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'post-list-e2e-secret-at-least-32-chars';
const OWNER = 'post-list-owner';
const SHOTS = process.env.POST_LIST_SHOTS;
const copy = publicCopy('en');

const THEMES = ['paper', 'plain', 'almanac'] as const;
/** Each theme's own prose container: a text part of a page's body. */
const PROSE = { paper: '.post-body', plain: '.plain-body', almanac: '.almanac-prose' };
/** The cover and the title of a card, in the themes whose cards have a cover. */
const CARD = {
  paper: { cover: '.post-card__cover', title: '.post-card__title' },
  almanac: { cover: '.almanac-card__panel', title: '.almanac-card__title' },
};

/** A card's cover area, with a picture or without one. */
const BAND = { paper: '.post-card__cover', almanac: ':is(.almanac-card__panel, .almanac-card__band)' };

/** No space to break on, and no word the browser's Thai dictionary knows. */
const LONG_THAI = 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ'.repeat(3);
const TITLES = { covered: 'A post with a cover', second: 'The second post', third: 'The third post' };

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
let workPage = '';

async function seed() {
  const { createCategory } = await import('../../src/server/content/categories');
  const { createPost } = await import('../../src/server/content/posts');
  const { createPage } = await import('../../src/server/content/pages');
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const cover = (await sql<{ id: string }>`select id from media_items limit 1`.execute(db)).rows[0].id;
  const [work, few, thai] = await Promise.all(['Work', 'Few', LONG_THAI.slice(0, 40)].map((name) => createCategory(OWNER, name)));
  workPage = `/en/category/${encodeURIComponent(work.slug)}`;

  const text = (value: string): EditorNode => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
  let posts = 0;
  const post = async (title: string, category: string, coverMediaId: string | null = null) => (await createPost(OWNER, {
    title, slug: `post-${posts += 1}`, excerpt: 'What this post is about, which takes a line or two to say.',
    contentJson: { type: 'doc', content: [text('A post.')] }, categoryIds: [category], coverMediaId, metaTitle: null, metaDescription: null,
    status: 'published', publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
  })).translation_group_id;

  const covered = await post(TITLES.covered, work.id, cover);
  const second = await post(TITLES.second, work.id);
  const third = await post(TITLES.third, work.id);
  await post('The fourth post', work.id);
  await post('One of few', few.id);
  await post('Two of few', few.id);
  const long = await post(LONG_THAI, thai.id);

  const picked = (groups: string[], layout: PostListLayout = 'grid-3'): EditorNode => ({
    type: 'postList', attrs: { source: 'posts', postGroupIds: groups, categoryId: null, limit: 6, layout },
  });
  const category = (id: string, limit: number): EditorNode => ({
    type: 'postList', attrs: { source: 'category', postGroupIds: [], categoryId: id, limit, layout: 'grid-2' },
  });
  const pages: Record<string, EditorNode[]> = {
    textonly: [text('Only words here.')],
    order: [text('Before the list.'), picked([third, covered, second]), text('After the list.')],
    // The same post in both: a post can be in two blocks, and its card must not bring an id twice.
    two: [picked([covered, second]), picked([second, third])],
    only: [picked([covered, second])],
    more: [category(work.id, 3), category(few.id, 6)],
    thai: [picked([long], 'list'), picked([long, second, third], 'grid-3'), picked([long, second], 'grid-2')],
    layouts: [picked([covered, second, third]), picked([covered, second], 'grid-2'), picked([covered, second, long], 'list')],
  };
  for (const theme of THEMES) {
    for (const [name, blocks] of Object.entries(pages)) {
      await createPage(OWNER, {
        excerpt: '', title: `A ${name} page`, slug: `${name}-${theme}`, metaTitle: null, metaDescription: null, status: 'published',
        contentJson: { type: 'doc', content: blocks },
      });
    }
  }
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-post-list',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  psql('drop schema public cascade; create schema public;');

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  psql(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
      values (true, '${OWNER}', 'Post List Site', 'en', 'Asia/Bangkok', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);
    insert into media_items (owner_id, folder_id, object_key, original_name, mime_type, size_bytes,
        width, height, checksum_sha256, alt_text, state)
      values ('${OWNER}', null, 'seed/cover.webp', 'cover.webp', 'image/webp', 1000, 1600, 900,
        '${'a'.repeat(43)}=', 'A loaf on a board', 'ready');`);
  await seed();

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Post list test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Post list test server never became ready.\n${output}`);
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

// The covers are not in the object store; the media route would answer 404 for each of them.
test.beforeEach(async ({ page }) => {
  await page.route('**/media/**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#8a9b7a"/></svg>',
  }));
});

const trackCounts = (page: Page) => page.locator('.post-list').evaluateAll((lists) => lists.map(
  (list) => getComputedStyle(list).gridTemplateColumns.split(' ').length,
));

for (const theme of THEMES) {
  test.describe(theme, () => {
    test.beforeEach(() => {
      psql(`update site_settings set theme_id = '${theme}', theme_settings = '{}'::jsonb`);
    });

    const open = (page: Page, name: string) => page.goto(`${origin}/en/${name}-${theme}`);

    test('a page with no block is one prose container, as it was', async ({ page }) => {
      await open(page, 'textonly');
      await expect(page.locator(PROSE[theme])).toHaveCount(1);
      await expect(page.locator(PROSE[theme])).toContainText('Only words here.');
      await expect(page.locator('.post-list')).toHaveCount(0);
    });

    test('a page draws its text and its lists in order', async ({ page }) => {
      await open(page, 'order');
      await expect(page.locator('.post-list')).toHaveCount(1);
      const body = await page.locator('.post-list').evaluate((list, prose) => [...(list.parentElement?.children ?? [])]
        .filter((part) => part === list || part.matches(prose))
        .map((part) => (part === list ? 'list' : part.textContent?.trim())), PROSE[theme]);
      expect(body).toEqual(['Before the list.', 'list', 'After the list.']);
      await expect(page.locator('.post-list').getByRole('heading')).toHaveText([TITLES.third, TITLES.covered, TITLES.second]);
    });

    test('two blocks in a row are two lists', async ({ page }) => {
      await open(page, 'two');
      await expect(page.locator('.post-list')).toHaveCount(2);
      await expect(page.locator('.post-list + .post-list')).toHaveCount(1);
      // More between the lists than between a list's own rows, or they read as one.
      const [between, rows] = await page.locator('.post-list + .post-list').evaluate((list) => {
        const { marginBlockStart, rowGap } = getComputedStyle(list);
        return [parseFloat(marginBlockStart), parseFloat(rowGap) || 0];
      });
      expect(between).toBeGreaterThan(rows);
      const ids = await page.locator('[id]').evaluateAll((elements) => elements.map(({ id }) => id));
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    });

    test('a page of only a block has no empty prose', async ({ page }) => {
      await open(page, 'only');
      await expect(page.locator('.post-list')).toHaveCount(1);
      await expect(page.locator(PROSE[theme])).toHaveCount(0);
    });

    test('a card\'s cover is not the page\'s lead image', async ({ page }) => {
      await open(page, 'only');
      await expect(page.locator('.post-list')).toHaveCount(1);
      if (theme !== 'plain') await expect(page.locator(`.post-list ${CARD[theme].cover} img`)).toHaveCount(1);
      await expect(page.locator('.post-list img[fetchpriority]')).toHaveCount(0);
      await expect(page.locator('.post-list img:not([loading="lazy"])')).toHaveCount(0);
    });

    test('see all shows only when the category holds more', async ({ page }) => {
      await open(page, 'more');
      await expect(page.locator('.post-list')).toHaveCount(2);
      await expect(page.locator('.post-list').first().getByRole('heading')).toHaveCount(3);
      const link = page.getByRole('link', { name: copy.seeAll, exact: true });
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('href', workPage);
      await expect(page.locator('.post-list + .post-list__more + .post-list')).toHaveCount(1);
    });

    test('no sideways scroll with a long Thai title', async ({ page }) => {
      for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 800 });
        await open(page, 'thai');
        await expect(page.locator('.post-list')).toHaveCount(3);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `at ${width}`).toBe(true);
      }
    });

    test('columns follow the layout', async ({ page }) => {
      await open(page, 'layouts');
      for (const [width, tracks] of [[1440, [3, 2, 1]], [700, [2, 2, 1]], [375, [1, 1, 1]]] as const) {
        await page.setViewportSize({ width, height: 800 });
        expect(await trackCounts(page), `at ${width}`).toEqual(tracks);
      }
    });

    if (theme !== 'plain') {
      test('a list\'s cover sits beside its text, and above it on a phone', async ({ page }) => {
        const { cover, title } = CARD[theme];
        const list = page.locator('.post-list--list');
        const boxes = async () => ({
          card: (await list.locator(`:is(.post-card, .almanac-card)`).first().boundingBox())!,
          cover: (await list.locator(cover).first().boundingBox())!,
          title: (await list.locator(title).first().boundingBox())!,
        });
        await page.setViewportSize({ width: 1440, height: 800 });
        await open(page, 'layouts');
        const wide = await boxes();
        expect(wide.cover.x + wide.cover.width).toBeLessThanOrEqual(wide.title.x);
        expect(wide.cover.y).toBeLessThan(wide.title.y + wide.title.height);
        expect(Math.abs(wide.cover.width - wide.card.width / 3)).toBeLessThan(wide.card.width * 0.02);
        // Whatever the band says: a long category name is cut short, and does not widen its cover.
        const widths = await list.locator(BAND[theme]).evaluateAll((covers) => covers.map((one) => one.getBoundingClientRect().width));
        expect(widths.length).toBe(3);
        for (const width of widths) expect(Math.abs(width - wide.cover.width)).toBeLessThan(1);

        await page.setViewportSize({ width: 375, height: 800 });
        const narrow = await boxes();
        expect(narrow.cover.y + narrow.cover.height).toBeLessThanOrEqual(narrow.title.y);
      });
    }

    test('shots of each layout', async ({ page }) => {
      test.skip(!SHOTS, 'POST_LIST_SHOTS is not set.');
      mkdirSync(SHOTS!, { recursive: true });
      for (const width of [320, 1440]) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
          await page.setViewportSize({ width, height: 900 });
          for (const name of ['layouts', 'more', 'order']) {
            await open(page, name);
            await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((image) => image.setAttribute('loading', 'eager')));
            await page.screenshot({ path: `${SHOTS}/${theme}-${name}-${width}-${scheme}.png`, fullPage: true });
          }
        }
      }
    });
  });
}
