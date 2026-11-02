import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

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
let ids = { covered: '', second: '', plenty: '' };

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
  // More than a block can hold, for the picker to refuse the one past it.
  const plenty = await createCategory(OWNER, 'Plenty');
  for (let n = 1; n <= 24; n += 1) await post(`Plenty ${n}`, plenty.id);
  ids = { covered, second, plenty: plenty.id };

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

let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

/** The file signs in once, through the first test that needs to: /recovery allows five per spec file. */
async function signIn(context: BrowserContext, page: Page) {
  if (session) {
    await context.addCookies(session);
    return;
  }
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
  session = await context.cookies();
}

const hydrated = (page: Page) => page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));

test.describe('the page editor', () => {
  const canvas = (page: Page) => page.locator('.ProseMirror');
  const box = (page: Page) => page.locator('.ProseMirror .post-list-box');
  const settings = (page: Page) => page.getByRole('dialog', { name: 'Post list' });
  const tick = (page: Page, title: string) => settings(page).getByRole('checkbox', { name: title, exact: true });
  const save = (page: Page) => settings(page).getByRole('button', { name: 'Save', exact: true });

  async function openNewPage(context: BrowserContext, page: Page, title: string) {
    await signIn(context, page);
    await page.goto(`${origin}/admin/pages/new`);
    await hydrated(page);
    await page.locator('textarea.admin-title-input').fill(title);
    await canvas(page).click();
  }

  async function addFromMenu(page: Page) {
    await page.getByRole('button', { name: /Add block/i }).click();
    await page.getByRole('menuitem', { name: 'Post list', exact: true }).click();
    await expect(settings(page)).toBeVisible();
  }

  async function insertPicked(page: Page, ...titles: string[]) {
    await addFromMenu(page);
    for (const title of titles) await tick(page, title).check();
    await save(page).click();
    await expect(settings(page)).toHaveCount(0);
  }

  /** The top level of the document, by what each node is drawn as. */
  const topLevel = (page: Page) => canvas(page).evaluate((root) => [...root.children].map((child) => (
    child.classList.contains('node-postList') ? 'postList' : child.tagName.toLowerCase()
  )));

  async function publish(page: Page, title: string) {
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const { db } = await import('../../src/server/db/client');
    await expect.poll(async () => (await db.selectFrom('pages').select('status').where('title', '=', title).executeTakeFirst())?.status, { timeout: 30_000 }).toBe('published');
    return (await db.selectFrom('pages').select('slug').where('title', '=', title).executeTakeFirstOrThrow()).slug;
  }

  test('insert from the + menu, pick two posts, reorder, publish, read them in that order', async ({ context, page }) => {
    await openNewPage(context, page, 'Chosen and ordered');
    await addFromMenu(page);
    await expect(save(page), 'nothing chosen yet').toBeDisabled();
    await expect(tick(page, TITLES.second)).toBeVisible();

    await settings(page).getByLabel('Search by title').fill('tHE thIRD');
    await expect(settings(page).getByRole('checkbox')).toHaveCount(1);
    await tick(page, TITLES.third).check();
    await settings(page).getByLabel('Search by title').fill('');
    await tick(page, TITLES.second).check();

    const chosen = settings(page).locator('.post-list-dialog__chosen li');
    await expect(chosen).toHaveText([TITLES.third, TITLES.second]);
    await settings(page).getByRole('button', { name: `Move ${TITLES.second} up` }).click();
    await expect(chosen).toHaveText([TITLES.second, TITLES.third]);
    await settings(page).getByRole('button', { name: `Move ${TITLES.third} up` }).click();
    await expect(chosen).toHaveText([TITLES.third, TITLES.second]);

    await save(page).click();
    await expect(settings(page)).toHaveCount(0);
    await expect(box(page).locator('li')).toHaveText([TITLES.third, TITLES.second]);
    await expect(box(page)).toContainText('Grid, 3 columns');

    const slug = await publish(page, 'Chosen and ordered');
    await page.goto(`${origin}/en/${slug}`);
    await expect(page.locator('.post-list').getByRole('heading')).toHaveText([TITLES.third, TITLES.second]);
  });

  test('cancelling the settings window inserts nothing', async ({ context, page }) => {
    await openNewPage(context, page, 'Thought better of it');
    await page.keyboard.type('Words.');
    await addFromMenu(page);
    await tick(page, TITLES.second).check();
    await settings(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(settings(page)).toHaveCount(0);
    await expect(box(page)).toHaveCount(0);
    await expect(canvas(page), 'the writer can go on typing').toBeFocused();

    await addFromMenu(page);
    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
    await expect(box(page)).toHaveCount(0);
    await expect(canvas(page)).toBeFocused();
    await page.keyboard.type(' More.');
    await expect(canvas(page)).toHaveText('Words. More.');
  });

  test('a deleted post is marked in the editor and gone from the page', async ({ context, page }) => {
    await signIn(context, page);
    const { createPost, deletePost } = await import('../../src/server/content/posts');
    const { createPage } = await import('../../src/server/content/pages');
    const made = async (title: string, status: 'draft' | 'published', publishedAt: string | null) => createPost(OWNER, {
      title, slug: `marked-${title.toLowerCase().replaceAll(' ', '-')}`, excerpt: '', contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A post.' }] }] },
      categoryIds: [ids.plenty], coverMediaId: null, metaTitle: null, metaDescription: null, status, publishedAt,
    });
    const doomed = await made('Soon deleted', 'published', new Date(Date.now() - 3_600_000).toISOString());
    const draft = await made('Still a draft', 'draft', null);
    const dated = await made('Dated ahead', 'published', new Date(Date.now() + 86_400_000).toISOString());
    const built = await createPage(OWNER, {
      excerpt: '', title: 'With a stale row', slug: 'with-a-stale-row', metaTitle: null, metaDescription: null, status: 'published',
      contentJson: { type: 'doc', content: [{ type: 'postList', attrs: {
        source: 'posts', postGroupIds: [ids.second, doomed.translation_group_id, draft.translation_group_id, dated.translation_group_id], categoryId: null, limit: 6, layout: 'list',
      } }] },
    });
    await deletePost(OWNER, doomed.id, doomed.updated_at);

    await page.goto(`${origin}/admin/pages/edit/${built.id}`);
    await hydrated(page);
    const rows = box(page).locator('li');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toHaveText(TITLES.second);
    await expect(rows.nth(1)).toContainText('no longer shows');
    await expect(rows.nth(2)).toContainText('Still a draft');
    await expect(rows.nth(2)).toContainText('Not showing yet');
    await expect(rows.nth(3)).toContainText('Dated ahead');
    await expect(rows.nth(3)).toContainText('Not showing yet');

    // The stale row can be taken out, though nothing in the list above it can be unticked.
    await box(page).getByRole('button', { name: 'Post list settings' }).click();
    const stale = settings(page).locator('.post-list-dialog__chosen li').nth(1);
    await expect(stale).toContainText('no longer shows');
    await stale.getByRole('button', { name: /^Remove/ }).click();
    await expect(settings(page).locator('.post-list-dialog__chosen li')).toHaveCount(3);
    await settings(page).getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.goto(`${origin}/en/with-a-stale-row`);
    await expect(page.locator('.post-list').getByRole('heading')).toHaveText([TITLES.second]);
  });

  test('the 24th tick stops the rest and says why', async ({ context, page }) => {
    await openNewPage(context, page, 'A full block');
    await addFromMenu(page);
    await settings(page).getByLabel('Search by title').fill('Plenty');
    const reason = settings(page).getByText('A block holds at most 24 posts');
    for (let n = 1; n <= 23; n += 1) await tick(page, `Plenty ${n}`).check();
    await expect(reason).toHaveCount(0);
    await expect(tick(page, 'Plenty 24')).toBeEnabled();
    await tick(page, 'Plenty 24').check();
    await expect(reason).toBeVisible();
    await settings(page).getByLabel('Search by title').fill('');
    await expect(tick(page, TITLES.second)).toBeDisabled();
    await expect(tick(page, 'Plenty 24'), 'what is ticked can still be unticked').toBeEnabled();
    await tick(page, 'Plenty 24').uncheck();
    await expect(tick(page, TITLES.second)).toBeEnabled();
    await expect(reason).toHaveCount(0);
  });

  test('the post editor offers no post list', async ({ context, page }) => {
    await signIn(context, page);
    await page.goto(`${origin}/admin/new`);
    await hydrated(page);
    await canvas(page).click();
    await page.getByRole('button', { name: /Add block/i }).click();
    await expect(page.getByRole('menuitem', { name: 'Video', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Post list', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(canvas(page)).toBeFocused();
    await page.keyboard.type('/');
    await expect(page.getByRole('option', { name: /Video/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Post list/ })).toHaveCount(0);
    await page.keyboard.type('post');
    await expect(page.getByRole('option')).toHaveCount(0);
    await page.keyboard.press('Escape');
    for (let n = 0; n < 5; n += 1) await page.keyboard.press('Backspace');

    // One pasted in is kept, for saving to refuse with its reason, and there is nothing to set on it.
    await canvas(page).evaluate((root, group) => {
      const data = new DataTransfer();
      const attrs = JSON.stringify({ source: 'posts', postGroupIds: [group], categoryId: null, limit: 6, layout: 'grid-3' });
      data.setData('text/html', `<div class="tome-post-list" data-post-list='${attrs}'></div>`);
      root.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, ids.second);
    await expect(box(page)).toHaveText('Post list');
    await expect(box(page).getByRole('button')).toHaveCount(0);
  });

  test('a block inserted from inside a quote lands after the quote', async ({ context, page }) => {
    await openNewPage(context, page, 'After a quote');
    await page.keyboard.type('> Quoted words');
    await insertPicked(page, TITLES.second);
    expect(await topLevel(page)).toEqual(['blockquote', 'postList']);
  });

  test('a block inserted on an empty line replaces that line', async ({ context, page }) => {
    await openNewPage(context, page, 'On an empty line');
    await page.keyboard.type('Before.');
    await page.keyboard.press('Enter');
    await insertPicked(page, TITLES.second);
    expect(await topLevel(page)).toEqual(['p', 'postList']);
    await expect(canvas(page).locator('> p')).toHaveText('Before.');
  });

  test('undo removes an inserted block in one step', async ({ context, page }) => {
    await openNewPage(context, page, 'Undone');
    await page.keyboard.type('Before.');
    await page.keyboard.press('Enter');
    await insertPicked(page, TITLES.second);
    await expect(box(page)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(box(page)).toHaveCount(0);
    expect(await topLevel(page)).toEqual(['p', 'p']);
    await expect(canvas(page).locator('> p').first()).toHaveText('Before.');
  });

  test('the slash menu inserts one too, and the box can be set to a category', async ({ context, page }) => {
    await openNewPage(context, page, 'From a slash');
    await page.keyboard.type('/post');
    await page.getByRole('option', { name: /Post list/ }).click();
    await expect(settings(page)).toBeVisible();
    await tick(page, TITLES.second).check();
    await save(page).click();
    await expect(box(page).locator('li')).toHaveText([TITLES.second]);
    expect(await topLevel(page), 'the command is gone, and the line with it').toEqual(['postList']);

    await box(page).getByRole('button', { name: 'Post list settings' }).click();
    await expect(tick(page, TITLES.second), 'it opens on what the block holds').toBeChecked();
    await settings(page).getByRole('radio', { name: 'A category' }).check();
    await expect(save(page), 'no category chosen yet').toBeDisabled();
    await settings(page).getByRole('combobox', { name: 'Category' }).click();
    await page.getByRole('option', { name: 'Plenty', exact: true }).click();
    await expect(save(page)).toBeEnabled();
    const count = settings(page).getByLabel('How many posts');
    await expect(count).toHaveValue('6');
    await count.fill('25');
    await expect(save(page), 'past the most a block holds').toBeDisabled();
    await count.fill('2');
    await settings(page).getByRole('radio', { name: 'List' }).check();
    await save(page).click();
    await expect(settings(page)).toHaveCount(0);
    await expect(box(page)).toContainText('Plenty');
    await expect(box(page)).toContainText('List');
    await expect(box(page).locator('li')).toHaveCount(0);

    const slug = await publish(page, 'From a slash');
    await page.goto(`${origin}/en/${slug}`);
    await expect(page.locator('.post-list--list').getByRole('heading')).toHaveCount(2);
  });

  test('the box moves when it is dragged', async ({ context, page }) => {
    await openNewPage(context, page, 'Dragged');
    await page.keyboard.type('First.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second.');
    await insertPicked(page, TITLES.second);
    expect(await topLevel(page)).toEqual(['p', 'p', 'postList']);
    await box(page).locator('.post-list-box__summary').dragTo(canvas(page).locator('> p').first(), { targetPosition: { x: 10, y: 2 } });
    expect(await topLevel(page)).toEqual(['postList', 'p', 'p']);
  });

  test('what was written after the box was drawn is named once it is chosen', async ({ context, page }) => {
    await openNewPage(context, page, 'Chosen after drawing');
    await insertPicked(page, TITLES.second);
    await expect(box(page).locator('li')).toHaveText([TITLES.second]);

    // As another tab would, with this one left open.
    const { createCategory } = await import('../../src/server/content/categories');
    const { createPost } = await import('../../src/server/content/posts');
    const fresh = await createCategory(OWNER, 'Made later');
    await createPost(OWNER, {
      title: 'Written later', slug: 'written-later', excerpt: '', contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A post.' }] }] },
      categoryIds: [fresh.id], coverMediaId: null, metaTitle: null, metaDescription: null, status: 'published', publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });

    await box(page).getByRole('button', { name: 'Post list settings' }).click();
    await tick(page, 'Written later').check();
    await save(page).click();
    await expect(settings(page)).toHaveCount(0);
    await expect(box(page).locator('li')).toHaveText([TITLES.second, 'Written later']);
    await expect(box(page)).not.toContainText('no longer shows');

    await box(page).getByRole('button', { name: 'Post list settings' }).click();
    await settings(page).getByRole('radio', { name: 'A category' }).check();
    await settings(page).getByRole('combobox', { name: 'Category' }).click();
    await page.getByRole('option', { name: 'Made later', exact: true }).click();
    await save(page).click();
    await expect(settings(page)).toHaveCount(0);
    await expect(box(page)).toContainText('Newest from Made later');
    await expect(box(page)).not.toContainText('was deleted');
  });

  test('a read that fails says so and marks nothing', async ({ context, page }) => {
    await signIn(context, page);
    const { createPage } = await import('../../src/server/content/pages');
    const built = await createPage(OWNER, {
      excerpt: '', title: 'Unread', slug: 'unread', metaTitle: null, metaDescription: null, status: 'draft',
      contentJson: { type: 'doc', content: [{ type: 'postList', attrs: { source: 'posts', postGroupIds: [ids.second], categoryId: null, limit: 6, layout: 'grid-3' } }] },
    });
    await page.route('**/api/admin/post-list-options*', (route) => route.abort());
    await page.goto(`${origin}/admin/pages/edit/${built.id}`);
    await hydrated(page);
    await expect(box(page)).toContainText('The titles could not be read');
    await expect(box(page)).not.toContainText('no longer shows');

    await box(page).getByRole('button', { name: 'Post list settings' }).click();
    await expect(settings(page).locator('.admin-alert')).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
    await expect(box(page).getByRole('button', { name: 'Post list settings' })).toBeFocused();
  });

  test('shots of the window and the box', async ({ context, page }) => {
    const settled = (shot: Page) => shot.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    test.skip(!SHOTS, 'POST_LIST_SHOTS is not set.');
    mkdirSync(SHOTS!, { recursive: true });
    await signIn(context, page);
    const { createPage } = await import('../../src/server/content/pages');
    const built = await createPage(OWNER, {
      excerpt: '', title: 'Shots of the block', slug: 'shots-of-the-block', metaTitle: null, metaDescription: null, status: 'draft',
      contentJson: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Words above the block.' }] },
        { type: 'postList', attrs: { source: 'posts', postGroupIds: [ids.covered, ids.second, '11111111-1111-4111-8111-111111111111'], categoryId: null, limit: 6, layout: 'list' } },
        { type: 'postList', attrs: { source: 'category', postGroupIds: [], categoryId: ids.plenty, limit: 3, layout: 'grid-3' } },
        { type: 'postList', attrs: { source: 'category', postGroupIds: [], categoryId: '11111111-1111-4111-8111-111111111111', limit: 3, layout: 'grid-2' } },
      ] },
    });
    for (const width of [375, 1440]) {
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/admin/pages/edit/${built.id}`);
        await hydrated(page);
        await expect(box(page).first().locator('li').first()).toContainText(TITLES.covered);
        await page.screenshot({ path: `${SHOTS}/box-${width}-${scheme}.png` });
        await box(page).first().getByRole('button', { name: 'Post list settings' }).click();
        await expect(tick(page, TITLES.covered)).toBeChecked();
        await settled(page);
        await page.screenshot({ path: `${SHOTS}/window-posts-${width}-${scheme}.png` });
        await settings(page).getByRole('radio', { name: 'A category' }).check();
        await settled(page);
        await page.screenshot({ path: `${SHOTS}/window-category-${width}-${scheme}.png` });
        await page.keyboard.press('Escape');
        await expect(settings(page)).toHaveCount(0);
      }
    }
  });
});
