import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Header sub-menus as a reader meets them, in Paper and in Plain.
 *
 * On a wide screen a parent's sub-menu is a `<details>` opened by a click, never a hover: one at
 * a time, closed by Escape (focus goes back to what opened it), by a click outside, or by focus
 * leaving it, and pulled back inside the window when it would pass the edge. On a phone Paper
 * lists the sub-items under their parent inside the Menu; Plain has no Menu, so its panel spans
 * the header instead of running off the screen.
 *
 * The menu is written before the server starts, with the same save the admin uses, so no one
 * has to sign in; the theme is switched with psql, as home-search.spec.ts does.
 *
 * SUBMENU_SHOTS=<dir> writes each theme at 1440 px with a sub-menu open and at 390 px with the
 * menu open, light and dark. Without it no picture is taken.
 */

test.use({ stack: 'navigation-submenus-site' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The widths are set by the tests themselves; one browser is enough.');

const PROJECT = 'tomecms-navigation-submenus-site';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'navigation-submenus-site-secret-32-chars';
const OWNER = 'submenu-site-owner';
const SHOTS = process.env.SUBMENU_SHOTS;

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-navigation-submenus-site',
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
      values (true, '${OWNER}', 'Submenu Site', 'en', 'UTC', '/admin');`);

  // Three live pages, and a header with a link parent, a group and a last parent whose long
  // sub-items would run past the window's edge at 1024 px. The pool is closed again before the
  // server opens its own, as public-plugins.spec.ts explains.
  const { createPage } = await import('../../src/server/content/pages');
  const page = async (title: string, slug: string) => (await createPage(OWNER, {
    excerpt: '', title, slug, metaTitle: null, metaDescription: null, status: 'published',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title}.` }] }] },
  })).id;
  const about = await page('About', 'about');
  const team = await page('Team', 'team');
  const history = await page('History', 'history');
  const link = (label: string, url: string, newTab = false) => ({ kind: 'custom' as const, label, pageId: null, url, newTab });
  const { replaceNavigation } = await import('../../src/server/content/navigation');
  await replaceNavigation(OWNER, { locale: 'en', location: 'header', items: [
    { kind: 'home', label: 'Home', pageId: null, url: null, newTab: false },
    { kind: 'page', label: 'About', pageId: about, url: null, newTab: false, children: [
      { kind: 'page', label: 'Team', pageId: team, url: null, newTab: false },
      link('Contact', '/contact'),
      link('Elsewhere', 'https://example.com/', true),
    ] },
    { kind: 'group', label: 'Company', pageId: null, url: null, newTab: false, children: [
      { kind: 'page', label: 'History', pageId: history, url: null, newTab: false },
      link('Press', '/press'),
    ] },
    { ...link('Resources', '/resources'), children: [
      link('Guides for writing well in any language', '/guides'),
      link('Everything else we have put together', '/more'),
    ] },
  ] });
  const { closeDatabase } = await import('../../src/server/db/client');
  await closeDatabase();

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Sub-menu test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Sub-menu test server never became ready.\n${output}`);
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  docker(['down', '--volumes', '--remove-orphans'], 90_000);
});

const useTheme = (id: 'paper' | 'plain') => psql(`update site_settings set theme_id = '${id}'`);

/** The header's visible navigation: Paper's desktop row, or Plain's only one. */
const primary = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

/** One parent in the header: its `<details>`, the summary that opens it and the panel. */
function parent(page: Page, label: string) {
  const item = primary(page).locator('.site-submenu-item').filter({ has: page.locator(`summary:has(> span:text-is("${label}")), summary[aria-label="Show the ${label} menu"]`) });
  return { details: item.locator('details'), item, panel: item.locator('.site-submenu'), summary: item.locator('summary') };
}

const isOpen = (details: Locator) => details.evaluate((element) => (element as HTMLDetailsElement).open);

for (const theme of ['paper', 'plain'] as const) {
  test(`${theme}: a sub-menu opens by click, one at a time, and closes by click, Escape, a click outside`, async ({ page }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/en`);
    const about = parent(page, 'About');
    const company = parent(page, 'Company');

    await expect(about.item.getByRole('link', { name: 'About', exact: true }), 'a link parent stays a link').toHaveAttribute('href', '/en/about');
    await expect(about.panel, 'closed until asked').toBeHidden();
    await about.summary.hover();
    await expect(about.panel, 'a hover opens nothing').toBeHidden();

    await about.summary.click();
    await expect(about.panel).toBeVisible();
    await expect(about.panel.getByRole('link')).toHaveText(['Team', 'Contact', 'Elsewhere (opens in a new tab)']);
    await expect(about.panel.getByRole('link', { name: /Elsewhere/ })).toHaveAttribute('target', '_blank');
    await expect(about.panel.getByRole('link', { name: /Elsewhere/ })).toHaveAttribute('rel', 'noopener noreferrer');
    await about.summary.click();
    await expect(about.panel, 'a second click closes it').toBeHidden();

    await about.summary.click();
    await company.summary.click();
    await expect(company.panel, 'a group opens by its label').toBeVisible();
    expect(await isOpen(about.details), 'and the first one closed').toBe(false);

    await page.keyboard.press('Escape');
    await expect(company.panel).toBeHidden();
    await expect(company.summary, 'focus is back on what opened it').toBeFocused();

    await about.summary.click();
    await expect(about.panel).toBeVisible();
    // The gutter beside the frame: nothing there to click by accident.
    await page.mouse.click(4, 600);
    await expect(about.panel, 'a click outside closes it').toBeHidden();

    // A press on the panel's own padding leaves focus on the page, outside the menu; Escape
    // still closes it, and focus goes to the summary all the same.
    await about.summary.click();
    await about.panel.click({ position: { x: 2, y: 2 } });
    await expect(about.panel, 'a press inside keeps it open').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(about.panel).toBeHidden();
    await expect(about.summary).toBeFocused();
  });

  test(`${theme}: the keyboard alone opens a sub-menu and walks its items, and leaving it closes it`, async ({ page }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/en`);
    const about = parent(page, 'About');
    for (let presses = 0; presses < 30 && !await about.summary.evaluate((element) => element === document.activeElement); presses += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(about.summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(about.panel).toBeVisible();
    for (const name of ['Team', 'Contact', /Elsewhere/]) {
      await page.keyboard.press('Tab');
      await expect(about.panel.getByRole('link', { name })).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(about.panel, 'tabbing past the last item closes it').toBeHidden();
  });

  test(`${theme}: on a sub-page its parent is the current section`, async ({ page }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/en/team`);
    const about = parent(page, 'About');
    await expect(about.item.getByRole('link', { name: 'About', exact: true })).toHaveAttribute('aria-current', 'true');
    await about.summary.click();
    await expect(about.panel.getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');

    await page.goto(`${origin}/en/history`);
    await expect(parent(page, 'Company').summary, 'a group is current by its label').toHaveAttribute('aria-current', 'true');
    await expect(parent(page, 'About').item.getByRole('link', { name: 'About', exact: true })).not.toHaveAttribute('aria-current', /.*/);
  });

  test(`${theme}: the last parent's panel stays inside the window at 1024 px`, async ({ page }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`${origin}/en`);
    const resources = parent(page, 'Resources');
    await resources.summary.click();
    await expect(resources.panel).toBeVisible();
    // Past the entry movement, which is vertical only, so the edges are already where they end.
    await expect.poll(() => resources.panel.evaluate((panel) => {
      const { left, right } = panel.getBoundingClientRect();
      return left >= 0 && right <= window.innerWidth;
    }), 'inside the window').toBe(true);
  });

  test(`${theme}: under reduced motion the panel arrives at once`, async ({ page }) => {
    test.setTimeout(120_000);
    useTheme(theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    const durations = (panel: Locator) => panel.evaluate((element) => getComputedStyle(element).transitionDuration.split(',').map(parseFloat));
    await page.goto(`${origin}/en`);
    const about = parent(page, 'About');
    await about.summary.click();
    expect(Math.max(...await durations(about.panel)), 'it moves for everyone else').toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${origin}/en`);
    await parent(page, 'About').summary.click();
    expect(Math.max(...await durations(parent(page, 'About').panel)), 'and for this reader not at all').toBe(0);
  });
}

test('with no script, a sub-menu still opens by click and only one is open', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  for (const theme of ['paper', 'plain'] as const) {
    useTheme(theme);
    await page.goto(`${origin}/en`);
    const about = parent(page, 'About');
    const company = parent(page, 'Company');
    await about.summary.click();
    await expect(about.panel, theme).toBeVisible();
    await company.summary.click();
    await expect(company.panel, theme).toBeVisible();
    await expect(about.panel, `${theme}: the shared name closed the first`).toBeHidden();
  }
  await context.close();
});

test('paper: on a phone the sub-items are listed, indented, under their parent in the Menu', async ({ page }) => {
  test.setTimeout(120_000);
  useTheme('paper');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/en`);
  await page.locator('.site-header__mobile > summary').click();
  const menu = page.locator('.site-header__mobile nav');
  const about = menu.getByRole('link', { name: 'About', exact: true });
  const team = menu.getByRole('link', { name: 'Team' });
  await expect(team, 'shown without a second tap').toBeVisible();
  await expect(menu.getByText('Company', { exact: true }), 'a group is a label').toBeVisible();
  await expect(menu.getByRole('link', { name: 'Press' })).toBeVisible();
  const [parentBox, childBox] = [await about.boundingBox(), await team.boundingBox()];
  expect(childBox!.x, 'indented under its parent').toBeGreaterThan(parentBox!.x);
  expect(childBox!.y, 'and below it').toBeGreaterThan(parentBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'no sideways scroll').toBeLessThanOrEqual(0);
});

test('plain: on a phone an open panel fits the screen', async ({ page }) => {
  test.setTimeout(120_000);
  useTheme('plain');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/en`);
  for (const label of ['About', 'Resources']) {
    const { panel, summary } = parent(page, label);
    await summary.click();
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.x, `${label} starts inside the screen`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${label} ends inside it`).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'no sideways scroll').toBeLessThanOrEqual(0);
    // An open panel lies over the rest of the row, as a menu should; it is closed to reach the next.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
});

test('pictures of both themes, when asked for', async ({ page }) => {
  test.skip(!SHOTS, 'SUBMENU_SHOTS is not set.');
  test.setTimeout(180_000);
  mkdirSync(SHOTS!, { recursive: true });
  for (const theme of ['paper', 'plain'] as const) {
    useTheme(theme);
    for (const width of [1440, 390]) {
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: width > 400 ? 900 : 844 });
        await page.goto(`${origin}/en/team`);
        if (width < 400 && theme === 'paper') await page.locator('.site-header__mobile > summary').click();
        else await parent(page, 'About').summary.click();
        // Off the page, so the picture shows the menu and not a hover state.
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${SHOTS}/task-4-${theme}-${width}-${scheme}.png` });
      }
    }
  }
});
