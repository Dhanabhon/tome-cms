import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { publicCopy } from '../../src/lib/i18n';
import { tone } from '../../src/themes/almanac/tone';
import { expect, test } from './own-worker';

/**
 * Almanac as a reader meets it: the warm theme, its home page, its post and its page.
 *
 * What is measured is the rendered thing, because the markup of a card or a post is only half of
 * "does this work": whether a title that will not break stays in its box at 390 px, whether the
 * cover is the one eager image, whether a post with no category grows an empty pill, and whether
 * a reader who asked for less motion is given none. Each is an edge a real site reaches --
 * a post with no category, a Thai category, a title with no break in it, a hero link the owner
 * mistyped, an empty tagline, no posts at all.
 *
 * The data is written once, before the server starts, through the same functions the admin uses.
 * The theme and its settings are switched with psql between tests, as home-search.spec.ts does.
 * Only the draft preview needs the owner, and signs in once, through a recovery enrollment.
 *
 * ALMANAC_SHOTS=<dir> writes the home page, a post, a page and a search at 390, 768 and 1440 px,
 * light and dark. Without it no picture is taken.
 */

// Reduced motion unless a test is about motion: a layout is measured with nothing lifting, fading or
// sliding under it. The motion test and the progress test turn it back on for themselves.
test.use({ stack: 'almanac', reducedMotion: 'reduce' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The widths are set by the tests themselves; one browser is enough.');

const PROJECT = 'tomecms-almanac';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'almanac-e2e-secret-at-least-32-chars';
const OWNER = 'almanac-owner';
const SHOTS = process.env.ALMANAC_SHOTS;

const SITE = 'Almanac Site';
const TAGLINE = 'Notes from a small bakery';
/** A word with no place to break, as a long title in any language can carry. */
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const LONG_TITLE = `A very long title that keeps going well past what a card can hold, ${LONG_WORD}, and on and on for lines`;
const THAI_CATEGORY = 'สูตรขนม';
const copy = publicCopy('en');

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
let draftId = '';
/** The category ids a card's tone comes from, by name. */
const categoryIds: Record<string, string> = {};

test.beforeAll(async () => {
  // Seeding, a migrated schema and a cold dev server are more than the 30 s a test gets.
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-almanac',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  psql('drop schema public cascade; create schema public;');

  // The pool this opens stays open for the whole run, beside the dev server's own: the draft preview
  // test signs in through a recovery enrollment, which needs the worker's own connection
  // (public-plugins.spec.ts explains why a second pool is otherwise avoided; overlay-motion keeps one too).
  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  psql(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path, tagline)
      values (true, '${OWNER}', '${SITE}', 'en', 'Asia/Bangkok', '/admin', '${TAGLINE}');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);
    insert into media_items (owner_id, folder_id, object_key, original_name, mime_type, size_bytes,
        width, height, checksum_sha256, alt_text, state)
      values ('${OWNER}', null, 'seed/cover.webp', 'cover.webp', 'image/webp', 1000, 1600, 900,
        '${'a'.repeat(43)}=', 'A loaf on a board', 'ready');`);

  const { seedAlmanac } = await import('../helpers/almanac-seed');
  const seeded = await seedAlmanac(OWNER, THAI_CATEGORY, LONG_TITLE);
  Object.assign(categoryIds, seeded.categoryIds);
  draftId = seeded.draftId;

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Almanac test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Almanac test server never became ready.\n${output}`);
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

/** Almanac with the settings a test wants, and the tagline the site was given unless it says. */
function useAlmanac(settings: Record<string, string> = {}, tagline = TAGLINE) {
  const json = JSON.stringify({ almanac: settings }).replaceAll("'", "''");
  psql(`update site_settings set theme_id = 'almanac', theme_settings = '${json}'::jsonb, tagline = '${tagline.replaceAll("'", "''")}'`);
}

// The covers are not in the object store; the media route would answer 404 for each of them.
test.beforeEach(async ({ page }) => {
  await page.route('**/media/**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#8a9b7a"/></svg>',
  }));
});

const cards = (page: Page) => page.locator('.almanac-card');
const hero = (page: Page) => page.locator('.almanac-hero');
const feed = (page: Page) => page.locator('[data-post-feed]');
const searchBox = (page: Page) => page.getByRole('search').getByRole('searchbox', { name: copy.searchLabel });
const pills = (page: Page) => page.getByRole('navigation', { name: copy.categories });
const cardNamed = (page: Page, title: string) => cards(page).filter({ has: page.getByRole('heading', { name: title }) });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function open(page: Page, path: string, width = 1440) {
  await page.setViewportSize({ width, height: width > 400 ? 900 : 844 });
  await page.goto(`${origin}${path}`);
  // A concrete element first, then quiet: the dev server can re-optimise and reload a page after
  // it loads, and a read made in that gap is made against a page that is about to be replaced.
  await expect(page.locator('h1').first()).toBeAttached();
  await page.waitForLoadState('networkidle');
}

/** Tabs from wherever focus is until the locator holds it, so a path is the keyboard's own. */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, `Tab never reached it in ${limit} presses`).toBeFocused();
}

const focusRing = (target: Locator) => target.evaluate((element) => {
  const { outlineStyle, outlineWidth } = getComputedStyle(element);
  return outlineStyle !== 'none' && parseFloat(outlineWidth) > 0;
});

const POST = '/en/blog/why-we-bake-at-night';

/** Signs the owner in through a recovery enrollment, as a new device would. */
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

test('Almanac is the site: its hero, its pills, six cards, its serif, one h1', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en');
  await expect(page.locator('body.almanac')).toHaveCount(1);
  await expect(page.locator('h1'), 'one h1, and it is the hero\'s').toHaveCount(1);
  await expect(page.locator('h1')).toHaveText(SITE);
  await expect(page.locator('.almanac-hero__lead'), 'the lead is the tagline').toHaveText(TAGLINE);
  await expect(hero(page).getByRole('link', { name: copy.startReading }), 'it opens the newest post').toHaveAttribute('href', POST);
  await expect(hero(page).getByRole('link', { name: copy.allPosts })).toHaveAttribute('href', '/en#posts');
  await expect(cards(page), 'a page of six').toHaveCount(6);
  await expect(pills(page).getByRole('link')).toHaveText([copy.allPosts, 'Uncategorized', 'Field Notes', 'Recipes', THAI_CATEGORY]);
  await expect(pills(page).getByRole('link', { name: copy.allPosts })).toHaveAttribute('aria-current', 'page');

  const serif = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
      loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family),
    };
  });
  expect(serif.heading, 'headings are Trirong').toContain('Trirong');
  expect(serif.loaded.some((family) => family.includes('Trirong')), 'and it was fetched').toBe(true);
});

test('the cards: one link each, and a letter on a tone when there is no cover', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en');

  const cover = cardNamed(page, 'Why we bake at night');
  await expect(cover.locator('img'), 'a cover is the panel').toHaveCount(1);
  await expect(cover.locator('img'), 'and is a decoration inside a link already named by the title').toHaveAttribute('alt', '');
  await expect(cover.locator('img')).toHaveAttribute('width', '800');
  expect(await cover.locator('img').getAttribute('fetchpriority'), 'the first card\'s cover is the one asked for first').toBe('high');
  await expect(cover.locator('.almanac-card__letter')).toHaveCount(0);
  // A cover further down the page is lazy, and is not the one asked for first.
  const lazy = cardNamed(page, 'Notes on the first recipe').locator('img');
  await expect(lazy).toHaveAttribute('loading', 'lazy');
  await expect(lazy).not.toHaveAttribute('fetchpriority', /.*/);

  await expect(cardNamed(page, 'ขนมปังซาวร์โดว์สำหรับมือใหม่').locator('.almanac-card__letter'), 'a Thai category gives its first grapheme, mark and all').toHaveText('สู');
  await expect(cardNamed(page, 'Zymurgy, butter and patience').locator('.almanac-card__letter'), 'no category chosen is the default, Uncategorized').toHaveText('U');

  for (const card of await cards(page).all()) {
    await expect(card.getByRole('link'), 'one link per card').toHaveCount(1);
    await expect(card.locator('.almanac-card__meta'), 'the reading time, then the day').toHaveText(/^\d+ min read · \d+ \p{L}+/u);
  }
  const first = cardNamed(page, 'Why we bake at night');
  await expect(first.getByRole('link'), 'a link is named by its title alone').toHaveAccessibleName('Why we bake at night');
  await expect(first.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);

  // Each lettered panel wears the tone of its own category: the tone the id hashes to, whichever it is.
  const toneOf = (title: string) => cardNamed(page, title).locator('.almanac-card__panel').evaluate((panel) => (panel as HTMLElement).style.getPropertyValue('--card-tone'));
  const expected = (category: string) => `var(--almanac-tone-${tone(categoryIds[category])})`;
  expect(await toneOf('ขนมปังซาวร์โดว์สำหรับมือใหม่'), 'a Thai category').toBe(expected(THAI_CATEGORY));
  expect(await toneOf(LONG_TITLE), 'Field Notes').toBe(expected('Field Notes'));
  expect(await toneOf('Zymurgy, butter and patience'), 'the default category').toBe(expected('Uncategorized'));
  expect(await toneOf('Notes on the second recipe'), 'Recipes').toBe(expected('Recipes'));
  await expect(cover.locator('.almanac-card__panel'), 'a cover has no tone').not.toHaveAttribute('style', /--almanac-tone/);
});

test('a very long title stays in its card, clamped to three lines, and in its post', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  for (const width of [1440, 390]) {
    await open(page, '/en', width);
    const title = cardNamed(page, LONG_TITLE).locator('.almanac-card__title');
    await expect(title).toBeVisible();
    const box = await title.evaluate((element) => {
      const { lineHeight, webkitLineClamp } = getComputedStyle(element) as CSSStyleDeclaration & { webkitLineClamp: string };
      return { clamp: webkitLineClamp, height: element.getBoundingClientRect().height, line: parseFloat(lineHeight), clipped: element.scrollWidth > element.clientWidth + 1 };
    });
    expect(box.clamp, `${width}px: a title of up to three lines`).toBe('3');
    expect(box.height, `${width}px: no taller than three lines`).toBeLessThanOrEqual(box.line * 3 + 1);
    expect(box.clipped, `${width}px: the unbreakable word does not push its card wider`).toBe(false);
    expect(await overflow(page), `${width}px: no sideways scroll`).toBeLessThanOrEqual(0);

    await open(page, '/en/blog/long-title', width);
    await expect(page.locator('h1')).toHaveText(LONG_TITLE);
    expect(await page.locator('h1').evaluate((element) => element.scrollWidth - element.clientWidth), `${width}px: the h1 holds its word`).toBeLessThanOrEqual(1);
    expect(await overflow(page), `${width}px: the post has no sideways scroll`).toBeLessThanOrEqual(0);
  }
});

test('the hero is the owner\'s: their words, their links, and none of a mistyped one', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac({
    heroHeadline: 'Notes from the oven', heroLead: 'Baking, written down.',
    primaryLabel: 'Read now', primaryLink: '/en/about', secondaryLabel: 'Subscribe', secondaryLink: 'https://example.com/feed',
  });
  await open(page, '/en');
  await expect(page.locator('h1')).toHaveText('Notes from the oven');
  await expect(page.locator('.almanac-hero__lead')).toHaveText('Baking, written down.');
  await expect(hero(page).getByRole('link', { name: 'Read now' })).toHaveAttribute('href', '/en/about');
  await expect(hero(page).getByRole('link', { name: 'Subscribe' })).toHaveAttribute('href', 'https://example.com/feed');

  // A link the save did not refuse (a text setting is checked for length only) is dropped when drawn.
  for (const bad of ['javascript:alert(1)', 'http://example.com/', '//evil.example/', 'data:text/html,x', 'a b']) {
    useAlmanac({ primaryLink: bad, secondaryLink: bad });
    await open(page, '/en');
    await expect(hero(page), `${bad}: the band is still there`).toBeVisible();
    await expect(hero(page).getByRole('link'), `${bad}: with no button to go anywhere`).toHaveCount(0);
  }
  useAlmanac({ primaryLink: 'javascript:alert(1)' });
  await open(page, '/en');
  await expect(hero(page).getByRole('link'), 'a bad primary leaves the secondary alone').toHaveText([copy.allPosts]);

  // A button with no label is not drawn either.
  useAlmanac({ primaryLabel: '', secondaryLabel: '' });
  await open(page, '/en');
  await expect(hero(page).getByRole('link'), 'an empty label is the default label').toHaveText([copy.startReading, copy.allPosts]);
});

test('with the hero off the page still has its one h1, and the posts come first', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac({ hero: 'off' });
  await open(page, '/en');
  await expect(hero(page)).toHaveCount(0);
  await expect(page.locator('h1'), 'the site\'s name is the h1, for the reader who cannot see it').toHaveText(SITE);
  await expect(page.locator('h1')).toHaveClass(/sr-only/);
  await expect(cards(page)).toHaveCount(6);
  await expect(pills(page)).toBeVisible();
});

test('an empty tagline falls back to the theme\'s, in the language of the page', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac({}, '');
  await open(page, '/en');
  await expect(page.locator('.almanac-hero__lead'), 'never an empty paragraph').toHaveText(copy.defaultTagline);
  await open(page, '/en', 390);
  await expect(page.locator('.almanac-hero__lead')).toHaveText(copy.defaultTagline);
  expect(await overflow(page), 'and it fits a phone').toBeLessThanOrEqual(0);
  await open(page, '/th');
  await expect(page.locator('.almanac-hero__lead')).toHaveText(publicCopy('th').defaultTagline);
});

test('with no posts at all the page says so, and the hero offers only where it can go', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  // Nothing is written in Thai.
  await open(page, '/th');
  const thai = publicCopy('th');
  await expect(page.locator('body.almanac')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(cards(page)).toHaveCount(0);
  await expect(feed(page).getByText(thai.noPosts)).toBeVisible();
  await expect(pills(page), 'no categories, no row of pills').toHaveCount(0);
  await expect(hero(page).getByRole('link'), 'with no newest post, "start reading" has nowhere to go').toHaveText([thai.allPosts]);
  await expect(page.locator('.almanac-more'), 'nothing more to load').toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('the pills filter the list in place, by click and by keyboard, in Thai too', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en');
  await page.evaluate(() => { (window as unknown as { stayed: boolean }).stayed = true; });

  await pills(page).getByRole('link', { name: 'Field Notes' }).click();
  await expect(page).toHaveURL(`${origin}/en?category=Field+Notes`);
  await expect(cards(page), 'two posts are in Field Notes').toHaveCount(2);
  await expect(feed(page).getByRole('heading', { level: 2 }), 'the list says what it is').toHaveText('Field Notes');
  await expect(pills(page).getByRole('link', { name: 'Field Notes' })).toHaveAttribute('aria-current', 'page');
  await expect(hero(page), 'a pill does not take the hero away').toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed), 'and the page was not reloaded').toBe(true);
  await expect(page.locator('h1')).toHaveCount(1);

  await pills(page).getByRole('link', { name: THAI_CATEGORY }).click();
  await expect(page).toHaveURL(`${origin}/en?category=${encodeURIComponent(THAI_CATEGORY)}`);
  await expect(cards(page)).toHaveCount(1);
  await expect(feed(page).getByRole('heading', { level: 2 })).toHaveText(THAI_CATEGORY);

  // The keyboard alone: Tab to a pill, Enter.
  const recipes = pills(page).getByRole('link', { name: 'Recipes' });
  await tabTo(page, recipes);
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(5);
  await expect(recipes).toHaveAttribute('aria-current', 'page');

  await pills(page).getByRole('link', { name: copy.allPosts }).click();
  await expect(cards(page)).toHaveCount(6);
  await expect(page).toHaveURL(`${origin}/en`);
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);

  // Straight to an address: the pill is already the current one.
  await open(page, '/en?category=Recipes');
  await expect(pills(page).getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page');
  await expect(cards(page)).toHaveCount(5);
});

test('search finds a post, says what it found, prints the words as text, and can be left', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en');
  await searchBox(page).fill('zymurgy');
  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(`${origin}/en?q=zymurgy`);
  await expect(cards(page), 'the one post that says it').toHaveCount(1);
  await expect(cards(page).first()).toContainText('Zymurgy, butter and patience');
  await expect(feed(page).getByRole('heading', { level: 2 })).toHaveText('Results for “zymurgy”');
  await expect(hero(page), 'the results come first').toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(searchBox(page), 'the words stay in the box').toHaveValue('zymurgy');
  expect(await page.locator('meta[name="robots"]').getAttribute('content'), 'a search is not for the index').toBe('noindex, follow');

  await page.getByRole('link', { name: copy.clearSearch }).click();
  await expect(page).toHaveURL(`${origin}/en`);
  await expect(hero(page)).toHaveCount(1);
  await expect(searchBox(page)).toHaveValue('');
});

test('a search with no result says so, and the reader\'s words are text, never markup', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  // Quotes to leave the box's value, a tag, and the patterns String.replace gives a meaning.
  const words = `"><b>zebra</b> $& $' 'x`;
  await open(page, `/en?q=${encodeURIComponent(words)}`);
  await expect(cards(page)).toHaveCount(0);
  await expect(feed(page).getByText(copy.noResults.replace('{query}', () => words))).toBeVisible();
  await expect(feed(page).getByRole('heading', { level: 2 })).toHaveText(copy.searchResults.replace('{query}', () => words));
  await expect(page.locator('b'), 'no tag was made of them').toHaveCount(0);
  await expect(searchBox(page), 'the box holds exactly what was typed').toHaveValue(words);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('.almanac-more')).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await open(page, '/en?category=Nothing+here');
  await expect(feed(page).getByText(copy.noPostsInCategory)).toBeVisible();
});

test('"More posts" carries on where the list stopped: nothing twice, nothing missed', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en');
  const titles = () => cards(page).getByRole('heading').allTextContents();
  const first = await titles();
  expect(first).toHaveLength(6);
  await page.getByRole('link', { name: new RegExp(`^${copy.morePosts}`) }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(hero(page), 'the hero is for the first page').toHaveCount(0);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(cards(page), 'the other three').toHaveCount(3);
  expect(new Set([...first, ...await titles()]).size, 'nine posts, each once').toBe(9);
  await expect(page.getByRole('link', { name: new RegExp(`^${copy.morePosts}`) }), 'and nothing older than the last').toHaveCount(0);
});

test('a post: the pill, the one eager cover, the reading bar, and the way on', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, POST);
  await expect(page.locator('h1'), 'one h1, though the body wrote another').toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Why we bake at night');
  await expect(page.locator('.almanac-prose h1')).toHaveCount(0);
  await expect(page.locator('.almanac-prose h2').first(), 'it became a heading two').toHaveText('A heading one in the body');
  await expect(page.locator('.almanac-article__pill')).toHaveText('Field Notes');
  await expect(page.locator('.almanac-article__pill')).toHaveAttribute('href', '/en?category=Field+Notes');
  await expect(page.locator('.almanac-article__more')).toHaveText('More in Field Notes →');
  await expect(page.locator('.almanac-article__more')).toHaveAttribute('href', '/en?category=Field+Notes');
  await expect(page.locator('.almanac-article__lead')).toHaveText('The dough is calmer after dark, and so is the baker.');
  await expect(page.locator('.almanac-article__meta')).toContainText(/^By .+·.+·\d+ min read$/);

  const cover = page.locator('.almanac-article__cover');
  await expect(cover).toHaveAttribute('loading', 'eager');
  await expect(cover).toHaveAttribute('fetchpriority', 'high');
  await expect(cover, 'room is kept for it, so nothing jumps').toHaveAttribute('width', '1200');
  await expect(cover).toHaveAttribute('height', '675');
  expect(await page.locator('img[loading="lazy"]').count(), 'nothing else on the page is eager but the cover').toBe(await page.locator('img').count() - 1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // The pill is a way to the filtered list.
  await page.locator('.almanac-article__pill').click();
  await expect(page).toHaveURL(`${origin}/en?category=Field+Notes`);
  await expect(pills(page).getByRole('link', { name: 'Field Notes' })).toHaveAttribute('aria-current', 'page');
});

test('a post with no cover has none, and one with no category chosen is filed under the default', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en/blog/butter-and-patience');
  await expect(page.locator('h1')).toHaveText('Zymurgy, butter and patience');
  await expect(page.locator('.almanac-article__cover'), 'no cover, no empty frame').toHaveCount(0);
  await expect(page.locator('.almanac-article__pill'), 'the default category is still a category').toHaveText('Uncategorized');
  await expect(page.locator('.almanac-article__more')).toHaveText('More in Uncategorized →');
  await expect(page.locator('.almanac-article__meta')).toContainText('min read');
});

test('a draft in the preview has no category, so it has neither a pill nor a "More in"', async ({ page, context }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await signIn(context, page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/admin/preview/${draftId}`);
  await expect(page.locator('.almanac-article h1')).toHaveText('A draft in the making');
  await expect(page.locator('.almanac-article__draft')).toHaveText(copy.draftPreview);
  await expect(page.locator('.almanac-article__cover')).toHaveCount(0);
  await expect(page.locator('.almanac-article__pill'), 'no pill').toHaveCount(0);
  await expect(page.locator('.almanac-article__more'), 'and no "More in"').toHaveCount(0);
  await expect(page.locator('.almanac-article__end')).toHaveCount(0);
  await expect(page.locator('.almanac-article__meta'), 'the meta says it was saved, not published').toContainText(copy.lastSaved);
  expect(await page.locator('.almanac-article__title').evaluate((element) => getComputedStyle(element).fontFamily), 'drawn in Almanac\'s serif').toContain('Trirong');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('the reading progress follows the scroll, and is gone when switched off', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  // The bar is drawn only for a reader who did not ask for less motion.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, '/en/blog/why-we-bake-at-night');
  // A page long enough to scroll, so there is something to measure the bar against.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.querySelector('.almanac-prose')!.append(spacer);
  });
  const bar = page.locator('.almanac-progress');
  await expect(bar).toHaveCount(1);
  const style = await bar.evaluate((element) => {
    const style = getComputedStyle(element);
    // Not in the DOM typings yet.
    return { animationName: style.animationName, animationTimeline: style.getPropertyValue('animation-timeline') };
  });
  expect(style.animationName).toBe('almanac-progress');
  expect(style.animationTimeline, 'driven by the scroll, not by time').toMatch(/^scroll\(/);
  const scale = () => bar.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
  expect(await scale(), 'empty at the top').toBeLessThan(0.05);
  await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
  await expect.poll(scale, 'about half at the middle').toBeGreaterThan(0.3);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(scale, 'full at the end').toBeGreaterThan(0.95);

  useAlmanac({ readingProgress: 'off' });
  await open(page, POST);
  await expect(page.locator('.almanac-progress'), 'switched off, it is not drawn at all').toHaveCount(0);
  await expect(page.locator('.almanac-article')).toBeVisible();

  useAlmanac();
  await open(page, '/en/about');
  await expect(page.locator('.almanac-progress'), 'a page has none').toHaveCount(0);
});

test('a page is a title and a body: no pill, no meta, no bar, no "More in"', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en/about');
  await expect(page.locator('body.almanac')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('About the bakery');
  await expect(page.locator('.almanac-prose h1'), 'a heading one in the body, aligned or not, is a heading two').toHaveCount(0);
  await expect(page.locator('.almanac-prose')).toContainText('A bakery on a quiet street.');
  for (const absent of ['.almanac-article__pill', '.almanac-article__meta', '.almanac-progress', '.almanac-article__more', '.almanac-article__cover']) {
    await expect(page.locator(absent), absent).toHaveCount(0);
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

// Every kind of page Almanac draws, at the narrowest width it is asked to: one h1 each, and
// nothing pushing the window wider than the screen.
const ROUTES: [string, string][] = [
  ['the home page', '/en'],
  ['a later page of posts', '/en?cursor=__LATER__'],
  ['a category', '/en?category=Field+Notes'],
  ['a Thai category', `/en?category=${encodeURIComponent(THAI_CATEGORY)}`],
  ['a search', '/en?q=zymurgy'],
  ['a search with no result', '/en?q=qqqqqq'],
  ['a post with a cover', POST],
  ['a post with a long title', '/en/blog/long-title'],
  ['a post with no cover', '/en/blog/butter-and-patience'],
  ['a page', '/en/about'],
  ['the Thai home with no posts', '/th'],
];

test('every kind of page has one h1 and no sideways scroll at 390 px', async ({ page }) => {
  test.setTimeout(180_000);
  useAlmanac();
  await open(page, '/en', 390);
  const later = await page.getByRole('link', { name: new RegExp(`^${copy.morePosts}`) }).getAttribute('href');
  expect(later).toContain('cursor=');
  for (const [name, route] of ROUTES) {
    await open(page, route.replace('/en?cursor=__LATER__', later!), 390);
    await expect(page.locator('h1'), `${name}: one h1`).toHaveCount(1);
    expect(await overflow(page), `${name}: no sideways scroll`).toBeLessThanOrEqual(0);
    await expect(page.locator('main'), `${name}: a main landmark`).toHaveCount(1);
  }
});

test('the header\'s sub-menu opens by click on a wide screen, and by the keyboard, one way out each', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const about = nav.locator('.site-submenu-item').filter({ has: page.locator('summary[aria-label="Show the About menu"]') });
  const summary = about.locator('summary');
  const panel = about.locator('.site-submenu');

  await expect(about.getByRole('link', { name: 'About', exact: true }), 'a link parent stays a link').toHaveAttribute('href', '/en/about');
  await expect(panel).toBeHidden();
  await summary.click();
  await expect(panel.getByRole('link')).toHaveText(['Team', 'Contact']);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(summary, 'focus goes back to what opened it').toBeFocused();

  // A fresh page, so focus starts at the top and Tab has to get there.
  await open(page, '/en');
  await page.mouse.move(0, 0);
  await tabTo(page, summary);
  expect(await focusRing(summary), 'a ring on the keyboard\'s focus').toBe(true);
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  for (const name of ['Team', 'Contact']) {
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('link', { name })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(panel, 'tabbing out of the last closes it').toBeHidden();

  await page.goto(`${origin}/en/team`);
  await expect(about.getByRole('link', { name: 'About', exact: true }), 'on a sub-page its parent is the current section').toHaveAttribute('aria-current', 'true');
});

test('on a phone the Menu lists the sub-items under their parent, and the row fits', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en', 390);
  await expect(page.getByRole('navigation', { name: 'Primary' }).filter({ has: page.locator('.site-submenu-item') }), 'the wide row is not drawn').toBeHidden();
  await page.locator('.almanac-header__mobile > summary').click();
  const menu = page.locator('.almanac-header__mobile nav');
  const about = menu.getByRole('link', { name: 'About', exact: true });
  const team = menu.getByRole('link', { name: 'Team' });
  await expect(team, 'shown without a second tap').toBeVisible();
  await expect(menu.getByRole('link', { name: 'Contact' })).toBeVisible();
  const [parentBox, childBox] = [await about.boundingBox(), await team.boundingBox()];
  expect(childBox!.x, 'indented under its parent').toBeGreaterThan(parentBox!.x);
  expect(childBox!.y, 'and below it').toBeGreaterThan(parentBox!.y);
  expect(childBox!.height, 'a target a thumb can hit').toBeGreaterThanOrEqual(40);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('on a phone the site name is not cut short, and the language and theme are still there', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en', 390);
  const brand = page.locator('.almanac-brand');
  await expect(brand).toHaveText(SITE);
  // Measured in the serif the name is set in, which is wider than the one it is first drawn in.
  await page.evaluate(() => document.fonts.ready);
  // The core's name span is the one that clips and ends in an ellipsis.
  expect(await brand.locator('.site-brand__name').evaluate((element) => element.scrollWidth - element.clientWidth), 'the whole name is drawn, no ellipsis').toBeLessThanOrEqual(0);
  await expect(page.locator('.almanac-header .language-switcher__trigger')).toBeVisible();
  await expect(page.locator('.almanac-header [data-theme-toggle], .almanac-header .ui-theme__trigger').first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('the body\'s rhythm reaches a code block and a second paragraph in a list item', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, POST);
  const gaps = await page.evaluate(() => {
    const margin = (selector: string) => {
      const { marginTop, marginBottom } = getComputedStyle(document.querySelector(selector)!);
      return { marginTop, marginBottom };
    };
    return { pre: margin('.almanac-prose > pre'), item: margin('.almanac-prose li > p + p') };
  });
  // 1.25 of the article's 18 px, as a paragraph has, and none below: the next block brings its own.
  expect(gaps.pre, 'core\'s own margins on a code block do not win').toEqual({ marginTop: '22.5px', marginBottom: '0px' });
  expect(gaps.item.marginTop, 'a gap between paragraphs of one item').toBe('13.5px');
});

test('the keyboard alone reaches the pills, the search, the cards and "More posts", with a ring on each', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  await open(page, '/en');

  const pill = pills(page).getByRole('link', { name: 'Recipes' });
  await tabTo(page, pill);
  expect(await focusRing(pill), 'a pill').toBe(true);

  // The field marks focus with its border and an inner line rather than an outline: not the same as resting.
  const fieldLook = () => searchBox(page).evaluate((element) => {
    const { borderColor, boxShadow } = getComputedStyle(element);
    return { borderColor, boxShadow };
  });
  const resting = await fieldLook();
  await tabTo(page, searchBox(page));
  expect(await fieldLook(), 'the search field shows where it is').not.toEqual(resting);
  await page.keyboard.type('zymurgy');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/en?q=zymurgy`);
  await expect(cards(page)).toHaveCount(1);

  const card = cards(page).first().getByRole('link');
  await tabTo(page, card);
  expect(await focusRing(card), 'a card').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/en/blog/butter-and-patience`);

  await open(page, '/en');
  const more = page.getByRole('link', { name: new RegExp(`^${copy.morePosts}`) });
  await tabTo(page, more);
  expect(await focusRing(more), '"More posts"').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/cursor=/);
  await expect(cards(page)).toHaveCount(3);
});

test('a reader who asked for less motion is given none: no lift, no fade, no bar, no arrow', async ({ page }) => {
  test.setTimeout(120_000);
  useAlmanac();
  const card = cardNamed(page, 'Why we bake at night').getByRole('link');
  const lazyCover = () => cardNamed(page, 'Notes on the first recipe').locator('img');
  const bar = () => page.locator('.almanac-progress').evaluate((element) => getComputedStyle(element).display);
  const arrow = () => page.locator('.almanac-article__more span').evaluate((element) => getComputedStyle(element).transitionDuration);
  const lift = () => card.evaluate((element) => ({ transform: getComputedStyle(element).transform, duration: getComputedStyle(element).transitionDuration }));

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, '/en');
  await card.hover();
  await expect.poll(async () => (await lift()).transform, 'it lifts for everyone else').not.toBe('none');
  expect(await lazyCover().evaluate((element) => getComputedStyle(element).animationName), 'a cover fades in').toBe('almanac-fade-in');
  await open(page, POST);
  expect(await bar(), 'the bar is drawn').not.toBe('none');
  expect(parseFloat(await arrow()), 'and the arrow moves').toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/en');
  await card.hover();
  expect((await lift()).transform, 'it does not lift').toBe('none');
  expect(Math.max(...(await lift()).duration.split(',').map(parseFloat)), 'it does not even transition').toBe(0);
  expect(await lazyCover().evaluate((element) => getComputedStyle(element).animationName), 'the cover is simply there').toBe('none');
  expect(await lazyCover().evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  await open(page, POST);
  expect(await bar(), 'the bar is not drawn').toBe('none');
  expect(parseFloat(await arrow()), 'the arrow stays still').toBe(0);
});

test('pictures of the home page, a post, a page and a search, when asked for', async ({ page }) => {
  test.skip(!SHOTS, 'ALMANAC_SHOTS is not set.');
  test.setTimeout(300_000);
  mkdirSync(SHOTS!, { recursive: true });
  useAlmanac();
  const shots = [['home', '/en'], ['post', POST], ['page', '/en/about'], ['search', '/en?q=zymurgy']];
  for (const width of [390, 768, 1440]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const [name, route] of shots) {
        await open(page, route, width);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${SHOTS}/almanac-${name}-${width}-${scheme}.png`, fullPage: true });
      }
    }
  }
});
