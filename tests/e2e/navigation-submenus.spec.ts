import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Sub-items and groups on the Navigation screen.
 *
 * The screen keeps a flat list and the rules in src/lib/navigation-tree.ts keep it one the
 * server accepts; this walks the owner's path through it in a browser: build a header menu with
 * a group, put an item under it, move the group with its item, save, reload, and take the item
 * out again. A group with nothing under it blocks Save, whether the owner emptied it or it was
 * saved that way and lost its sub-item since.
 *
 * The second test drags rows by their grip: onto the middle of a row to put an item under it, onto
 * an edge to place it, refused where the menu would go two levels deep, and by touch on a phone.
 *
 * NAVIGATION_SHOTS=<dir> writes the screen with a group and its sub-item, light and dark, at
 * 1440 and 390 px, and a drag mid-way onto "put under" at the same sizes (nav1101-*.png).
 * Without it no picture is taken.
 */

test.use({ stack: 'navigation-submenus' });

const PROJECT = 'tomecms-navigation-submenus';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'navigation-submenus-secret-at-least-32';
const SHOTS = process.env.NAVIGATION_SHOTS;

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
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
let serverEnv: NodeJS.ProcessEnv = {};

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  serverEnv = {
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-navigation-submenus',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner, without walking the six-step wizard: what this test is about starts
  // after there is an owner to sign in as. The installer has its own acceptance.
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values ('signin-test-owner', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'signin-test-owner', 'Submenu Test', 'en', 'UTC', '/admin')`.execute(db);
  // A page to add, and a Thai menu whose group lost its only sub-item after it was saved.
  const { createPage } = await import('../../src/server/content/pages');
  await createPage('signin-test-owner', {
    excerpt: '', title: 'About', slug: 'about', metaTitle: null, metaDescription: null, status: 'draft',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'About us.' }] }] },
  });
  const { replaceNavigation } = await import('../../src/server/content/navigation');
  await replaceNavigation('signin-test-owner', { locale: 'th', location: 'header', items: [
    { kind: 'group', label: 'บริษัท', pageId: null, url: null, newTab: false, children: [{ kind: 'custom', label: 'ติดต่อ', pageId: null, url: '/contact', newTab: false }] },
  ] });
  await sql`delete from navigation_items where parent_id is not null`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Sign-in test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Sign-in test server never became ready.\n${output}`);
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


test.skip(
  ({ isMobile }) => Boolean(isMobile),
  'One browser walks the screen; the virtual authenticator needs Chromium anyway.',
);

/** The menu as the screen draws it: each label, a sub-item's indented by two spaces. */
async function outline(page: Page) {
  return page.locator('.navigation-item').evaluateAll((rows) => rows.map((row) => {
    const label = row.querySelector<HTMLInputElement>('input.admin-control')!.value;
    return row.getAttribute('data-depth') === '1' ? `  ${label}` : label;
  }));
}

/** The row now showing `label`, top-level or not. */
async function row(page: Page, label: string) {
  const index = (await outline(page)).findIndex((entry) => entry.trim() === label);
  if (index < 0) throw new Error(`No row for ${label}.`);
  return page.locator('.navigation-item').nth(index);
}

/** The middle of a row's grip, and a point `fraction` of the way down a row. */
async function gripPoint(target: Locator) {
  const box = (await target.locator('.navigation-grip').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function rowPoint(target: Locator, fraction: number) {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height * fraction };
}

/** Scrolls so both rows sit mid-window, clear of the edges where a drag scrolls the page. */
async function bringIntoView(page: Page, ...rows: Locator[]) {
  const boxes = await Promise.all(rows.map(async (entry) => (await entry.boundingBox())!));
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  await page.evaluate((by) => window.scrollBy(0, by), (top + bottom) / 2 - page.viewportSize()!.height / 2);
}

/** Presses `from`'s grip with the mouse and moves, in steps so pointermove fires, onto `onto`; the button stays down. */
async function dragOver(page: Page, from: Locator, onto: Locator, fraction: number) {
  await bringIntoView(page, from, onto);
  const start = await gripPoint(from);
  const end = await rowPoint(onto, fraction);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
}

/** The owner, signed in through a recovery enrolment with a virtual passkey. */
async function signIn(context: BrowserContext, page: Page): Promise<CDPSession> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const settings = await getSiteSettings();
  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
  return cdp;
}

/** Both themes at each width, written where NAVIGATION_SHOTS says. */
async function shoot(page: Page) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // The admin's colours ease from one theme to the other; a picture taken mid-way is half of each.
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/task-3-navigation-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test('a header item goes under a group, moves with it, saves, and an empty group blocks Save', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${origin}/admin/navigation`);
  const dialog = page.locator('dialog.navigation-dialog');
  const save = page.getByRole('button', { name: 'Save menu' });
  const emptyGroup = page.getByText('A group needs at least one item under it.');
  const actions = (item: number) => page.getByRole('group', { name: `Actions for item ${item}` });
  // The ⋯ menu that holds the nesting choices; it is there only when one applies.
  const nestMenu = (item: number) => actions(item).locator('summary');
  const add = async (kind: string, fill?: () => Promise<void>) => {
    await page.getByRole('button', { name: /Add item/i }).first().click();
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('radio', { name: kind }).check();
    await fill?.();
    await dialog.getByRole('button', { name: 'Add to menu' }).click();
    await dialog.waitFor({ state: 'hidden' });
  };

  await add('Home');
  await add('Page');
  await add('Group (no link)', async () => {
    await expect(dialog.locator('#navigation-placement'), 'a group goes in the header only').toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Label' }).fill('Company');
  });
  await expect(emptyGroup, 'the new group has nothing under it yet').toBeVisible();
  await expect(save).toBeDisabled();
  await add('Custom URL', async () => {
    await dialog.getByRole('textbox', { name: 'URL' }).fill('/contact');
    await dialog.getByRole('textbox', { name: 'Label' }).fill('Contact');
  });
  expect(await outline(page)).toEqual(['Home', 'About', 'Company', 'Contact']);
  await expect(save, 'still blocked while the group is empty').toBeDisabled();

  await expect(nestMenu(1), 'the first item has nothing above it to go under').toHaveCount(0);
  await expect(nestMenu(3), 'a group is never a sub-item').toHaveCount(0);
  // By keyboard alone: open the ⋯ menu, Escape closes it, open it again and choose.
  await nestMenu(4).focus();
  await page.keyboard.press('Enter');
  await expect(actions(4).getByRole('button', { name: 'Put under Company' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(actions(4).getByRole('button', { name: 'Put under Company' })).toBeHidden();
  await expect(nestMenu(4), 'Escape hands focus back to the ⋯ button').toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(actions(4).getByRole('button', { name: 'Put under Company' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await outline(page)).toEqual(['Home', 'About', 'Company', '  Contact']);
  await expect(page.locator('.navigation-status'), 'the move is announced').toHaveText('Moved Contact under Company.');
  await expect(nestMenu(4), 'focus stays on the moved row’s ⋯ button').toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Item 4 label under Company' }), 'a screen reader hears where it sits').toHaveValue('Contact');
  await expect(emptyGroup).toHaveCount(0);
  await expect(save).toBeEnabled();

  // The group moves up past About and takes Contact with it.
  await actions(3).getByRole('button', { name: 'Move up' }).click();
  expect(await outline(page)).toEqual(['Home', 'Company', '  Contact', 'About']);
  await expect(nestMenu(2), 'a parent cannot go under another').toHaveCount(0);
  await expect(actions(3).getByRole('button', { name: 'Move up' }), 'a lone sub-item has no sibling to pass').toBeDisabled();

  await save.click();
  await expect(page.locator('.admin-save-button')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect.poll(() => outline(page), { message: 'the tree comes back as it was saved' }).toEqual(['Home', 'Company', '  Contact', 'About']);
  await shoot(page);

  await nestMenu(3).click();
  await actions(3).getByRole('button', { name: 'Move out to the main menu' }).click();
  expect(await outline(page)).toEqual(['Home', 'Company', 'Contact', 'About']);
  await expect(page.locator('.navigation-status')).toHaveText('Moved Contact out of Company.');
  await expect(nestMenu(3), 'and the way back is on the same ⋯ button').toBeFocused();
  await expect(actions(3).getByRole('button', { name: 'Put under Company', includeHidden: true })).toHaveCount(1);
  await expect(emptyGroup, 'taking out its last item empties the group again').toBeVisible();
  await expect(save).toBeDisabled();

  // A group saved with a sub-item that has since gone says so as soon as its menu opens.
  await page.getByRole('tab', { name: 'ไทย' }).click();
  expect(await outline(page)).toEqual(['บริษัท']);
  await expect(emptyGroup).toBeVisible();
  await expect(save).toBeDisabled();

  // The footer has no sub-items and no groups.
  await page.getByRole('tab', { name: 'English' }).click();
  await page.getByRole('tab', { name: 'Footer' }).click();
  await add('Home');
  await expect(actions(1).getByRole('button'), 'up, down and remove only').toHaveCount(3);
  await expect(page.locator('.navigation-nest-menu'), 'no ⋯ menu: the footer has no sub-items').toHaveCount(0);
  // Choosing Group and then another kind leaves the placement as the owner set it.
  await page.getByRole('tab', { name: 'Header' }).click();
  await page.getByRole('button', { name: /Add item/i }).first().click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('#navigation-placement').click();
  await page.locator('.ui-select__option').last().click();
  await dialog.getByRole('radio', { name: 'Group (no link)' }).check();
  await dialog.getByRole('radio', { name: 'Home' }).check();
  await expect(dialog.locator('#navigation-placement .ui-select__label')).toHaveText('Both');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'Footer' }).click();

  await page.getByRole('button', { name: /Add item/i }).first().click();
  await dialog.waitFor({ state: 'visible' });
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await expect(dialog.getByRole('radio', { name: 'Group (no link)' })).toHaveCount(0);
});

test('rows nest by dragging onto the middle of another, place by its edges, and refuse a second level', async ({ context, page }) => {
  test.setTimeout(180_000);
  const cdp = await signIn(context, page);
  const { replaceNavigation } = await import('../../src/server/content/navigation');
  const link = (label: string, children?: { kind: 'custom'; label: string; pageId: null; url: string; newTab: false }[]) =>
    ({ kind: 'custom' as const, label, pageId: null, url: `/${label.toLowerCase()}`, newTab: false as const, ...(children ? { children } : {}) });
  await replaceNavigation('signin-test-owner', { locale: 'en', location: 'header', items: [
    link('Home'), link('About', [link('Team')]), link('Blog'), link('Contact'),
  ] });
  await replaceNavigation('signin-test-owner', { locale: 'en', location: 'footer', items: [link('Privacy'), link('Terms')] });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/admin/navigation`);
  await expect.poll(() => outline(page)).toEqual(['Home', 'About', '  Team', 'Blog', 'Contact']);
  const hint = page.locator('.navigation-hint');
  const live = hint.locator('[aria-live="polite"]');
  const save = page.getByRole('button', { name: 'Save menu' });

  // Mid-drag onto "put under", in pictures; Escape then puts the row back.
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    for (const [width, scheme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [390, 'dark']] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(600);
      // Team, a sub-item, over Home: the hint, the lit row and the ghost fit one window even at 390 px.
      await dragOver(page, await row(page, 'Team'), await row(page, 'Home'), 0.5);
      await expect(live).toHaveText('Put under Home');
      await page.screenshot({ path: `${SHOTS}/nav1101-into-${width}-${scheme}.png` });
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Escape cancels a drag: nothing moves and the hint goes back to how to drag.
  await dragOver(page, await row(page, 'Contact'), await row(page, 'About'), 0.5);
  await expect(live).toHaveText('Put under About');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await outline(page)).toEqual(['Home', 'About', '  Team', 'Blog', 'Contact']);
  await expect(hint).toContainText('Drag a row by its handle');
  await expect(page.locator('.navigation-ghost')).toHaveCount(0);

  // Onto the middle of About: Blog becomes About's last sub-item, and About is lit while it waits.
  await dragOver(page, await row(page, 'Blog'), await row(page, 'About'), 0.5);
  await expect(live).toHaveText('Put under About');
  await expect(await row(page, 'About')).toHaveAttribute('data-drop', 'into');
  await expect(page.locator('.navigation-ghost')).toHaveText('Blog');
  await page.mouse.up();
  expect(await outline(page)).toEqual(['Home', 'About', '  Team', '  Blog', 'Contact']);
  await expect(page.locator('.navigation-status')).toHaveText('Moved Blog under About.');

  // Over a sub-item, the halves place it in the same sub-menu.
  await dragOver(page, await row(page, 'Contact'), await row(page, 'Blog'), 0.2);
  await expect(live).toHaveText('In About’s sub-menu, above Blog');
  await expect(await row(page, 'Blog')).toHaveAttribute('data-drop', 'before');
  await page.keyboard.press('Escape');
  await page.mouse.up();

  // A sub-item onto a top-level row's top band: it leaves its parent, above that row.
  await dragOver(page, await row(page, 'Team'), await row(page, 'Contact'), 0.1);
  await expect(live).toHaveText('Above Contact, main menu');
  await expect(await row(page, 'Contact')).toHaveAttribute('data-drop', 'before');
  await page.mouse.up();
  expect(await outline(page)).toEqual(['Home', 'About', '  Blog', 'Team', 'Contact']);

  // A parent with a sub-item onto another row's middle: refused, with the reason, and nothing moves.
  await dragOver(page, await row(page, 'About'), await row(page, 'Contact'), 0.5);
  await expect(live).toHaveText('Can’t go here: a sub-menu is one level deep, and this item has sub-items of its own.');
  await expect(page.locator('.navigation-item[data-drop]')).toHaveCount(0);
  await page.mouse.up();
  expect(await outline(page)).toEqual(['Home', 'About', '  Blog', 'Team', 'Contact']);
  // And onto its own sub-item.
  await dragOver(page, await row(page, 'About'), await row(page, 'Blog'), 0.5);
  await expect(live).toHaveText('Can’t drop an item onto itself or its own sub-items.');
  await page.mouse.up();
  expect(await outline(page)).toEqual(['Home', 'About', '  Blog', 'Team', 'Contact']);

  // A parent dragged past another row's bottom band takes its sub-item along.
  await dragOver(page, await row(page, 'About'), await row(page, 'Team'), 0.9);
  await expect(live).toHaveText('Below Team, main menu');
  await page.mouse.up();
  expect(await outline(page)).toEqual(['Home', 'Team', 'About', '  Blog', 'Contact']);

  await save.click();
  await expect(page.locator('.admin-save-button')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect.poll(() => outline(page), { message: 'the dragged tree comes back as it was saved' }).toEqual(['Home', 'Team', 'About', '  Blog', 'Contact']);

  // The footer has no "into": the middle of a row is its upper or lower half.
  await page.getByRole('tab', { name: 'Footer' }).click();
  await expect.poll(() => outline(page)).toEqual(['Privacy', 'Terms']);
  await expect(hint).toHaveText('Drag a row by its handle to move it.');
  await dragOver(page, await row(page, 'Terms'), await row(page, 'Privacy'), 0.4);
  await expect(live).toHaveText('Above Privacy');
  await expect(page.locator('.navigation-item[data-drop="into"]')).toHaveCount(0);
  await expect(await row(page, 'Privacy')).toHaveAttribute('data-drop', 'before');
  await page.mouse.up();
  expect(await outline(page)).toEqual(['Terms', 'Privacy']);
  await page.getByRole('tab', { name: 'Header' }).click();

  // On a phone, by touch: the grip takes the finger, the rest of the row still scrolls the page.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.navigation-grip').first()).toHaveCSS('touch-action', 'none');
  await expect(page.locator('.navigation-item__content').first()).not.toHaveCSS('touch-action', 'none');
  const grip = (await page.locator('.navigation-grip').first().boundingBox())!;
  expect(grip.width, 'a 44px target for a finger').toBeGreaterThanOrEqual(44);
  expect(grip.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => window.addEventListener('pointerdown', (event) => { document.body.dataset.pointerType = event.pointerType; }, { once: true }));
  await bringIntoView(page, await row(page, 'Contact'), await row(page, 'About'));
  const from = await gripPoint(await row(page, 'Contact'));
  const to = await rowPoint(await row(page, 'About'), 0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12 }] });
  }
  await expect(live).toHaveText('Put under About');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('body')).toHaveAttribute('data-pointer-type', 'touch');
  expect(await outline(page)).toEqual(['Home', 'Team', 'About', '  Blog', '  Contact']);
});
