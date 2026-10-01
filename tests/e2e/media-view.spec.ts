import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * The File Manager shows its files as a grid or as a list, and remembers which.
 *
 * A row says the file's name and size, shows a rename as the card does, and a picker in List view
 * still hands back the file that was pressed. On a phone nothing runs past the screen.
 */

test.use({ stack: 'media-view' });

const PROJECT = 'tomecms-media-view';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'media-view-secret-at-least-32-chars';
// A media key is filed under its owner's UUID, so the owner has to have one.
const OWNER = '3e5a7b9c-2d4f-4a6b-8c1d-9e0f1a2b3c4d';
/** A name long enough to wrap to a second line on a phone, and to be cut at two on any screen. */
const LONG_NAME = 'A very long file name that goes on and on so that a row has to wrap it onto a second line and then stop.png';
/** Where the screenshots go, when asked for. The suite never writes them. */
const SHOTS = process.env.MEDIA_VIEW_SHOTS;

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('No port available.'));
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  // The browser puts a file straight into the store, which answers only the origin it is told.
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-media-view',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner, without walking the six-step wizard, and the category a post is filed under.
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'View Test', 'en', 'UTC', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`View test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`View test server never became ready.\n${output}`);
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
  'One browser is enough; the virtual authenticator needs Chromium anyway.',
);

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

/** A picture with some colour in it, so a thumbnail is told from an empty box. */
async function picture(from: string, to: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Files put in the library the way an owner does: the File Manager's upload dialog. */
async function uploadToLibrary(page: Page) {
  await page.goto(`${origin}/admin/media`);
  const files = [
    { name: 'Lake.png', mimeType: 'image/png', buffer: await picture('#264653', '#2a9d8f') },
    { name: 'Field.png', mimeType: 'image/png', buffer: await picture('#e9c46a', '#f4a261') },
    { name: LONG_NAME, mimeType: 'image/png', buffer: await picture('#e76f51', '#6d597a') },
    { name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Notes for the week.\n') },
  ];
  await page.locator('.media-upload input[type="file"]').setInputFiles(files);
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await dialog.getByRole('button', { name: `Upload ${files.length} files` }).click();
  for (const row of await dialog.locator('.media-upload-row').all()) {
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

/** Both themes at the width the page is at, written where MEDIA_VIEW_SHOTS says. */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const width = page.viewportSize()!.width;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // The admin's colours ease from one theme to the other; a picture taken mid-way is half of each.
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('the File Manager lists its files as rows, remembers the choice, and a picker still chooses from it', async ({ context, page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(context, page);
  await uploadToLibrary(page);

  const grid = page.getByRole('button', { name: 'Grid', exact: true });
  const list = page.getByRole('button', { name: 'List', exact: true });
  const rows = page.locator('ul.media-list');

  // A grid to begin with.
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.media-grid')).toBeVisible();
  await shoot(page, 'grid');

  // The list, and still the list after a reload.
  await list.click();
  await expect(list).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toBeVisible();
  await expect(page.locator('.media-grid')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tomecms.media.view'))).toBe('list');

  // A row says its name and its size, and keeps to two lines for a name that is too long.
  const lake = rows.getByRole('button', { name: /^Lake\.png,/ });
  await expect(lake.locator('.media-row__name')).toHaveText('Lake.png');
  await expect(lake.locator('.media-row__meta')).toContainText(/\d+(\.\d)? (B|KB|MB)/);
  await expect(lake.locator('.media-row__meta')).toContainText('PNG');
  await expect(rows.getByRole('button', { name: /^Notes\.txt,/ }).locator('.media-row__tile')).toBeVisible();
  const longName = await rows.getByRole('button', { name: new RegExp(`^${LONG_NAME.replace(/\./g, '\\.')},`) }).locator('.media-row__name').boundingBox();
  expect(longName!.height, 'at most two lines of the name show').toBeLessThanOrEqual(2 * 24);
  await shoot(page, 'list');

  // A rename is on the row at once, from the same state as the card.
  await lake.click();
  const details = page.locator('dialog.media-details');
  await details.getByRole('textbox', { name: 'Name', exact: true }).fill('Morning lake');
  await details.getByRole('button', { name: 'Save' }).click();
  await expect(details.getByRole('button', { name: 'Saved' })).toBeVisible();
  await details.getByRole('button', { name: 'Close details' }).click();
  await expect(details).toBeHidden();
  await expect(rows.getByRole('button', { name: /^Morning lake\.png,/ }).locator('.media-row__name')).toHaveText('Morning lake.png');
  await expect(rows.getByRole('button', { name: /^Lake\.png,/ })).toHaveCount(0);

  // On a phone the tile and the name share a row, what the file is wraps under the name, and
  // nothing runs past the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows).toBeVisible();
  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(overflow.scrollWidth, `no sideways scroll (${overflow.scrollWidth} in ${overflow.innerWidth})`).toBeLessThanOrEqual(overflow.innerWidth);
  const row = rows.getByRole('button', { name: /^Morning lake\.png,/ });
  const tile = (await row.locator('.media-row__tile').boundingBox())!;
  const name = (await row.locator('.media-row__name').boundingBox())!;
  const meta = (await row.locator('.media-row__meta').boundingBox())!;
  expect(name.y, 'the name is level with the tile').toBeLessThan(tile.y + tile.height);
  expect(name.x, 'and beside it').toBeGreaterThanOrEqual(tile.x + tile.width);
  expect(meta.y, 'the details are under the name').toBeGreaterThanOrEqual(name.y + name.height - 1);
  await shoot(page, 'list');
  await page.setViewportSize({ width: 1440, height: 900 });

  // The picker is in the list too, and the row that is pressed is the file that comes back.
  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('A picture from the list');
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await page.getByRole('button', { name: /Add block/i }).click();
  await page.getByRole('menuitem', { name: 'Image', exact: true }).click();
  const picker = page.locator('dialog.media-picker');
  await expect(picker.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('ul.media-list')).toBeVisible();
  await shoot(page, 'picker-list');
  await picker.getByRole('button', { name: /^Select Field\.png,/ }).click();
  await expect(picker).toBeHidden();
  await expect(canvas.locator('img')).toHaveCount(1);
  await expect(canvas.locator('img')).toHaveAttribute('title', 'Field.png');

  // Back to a grid, and the picker follows it.
  await page.goto(`${origin}/admin/media`);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.media-grid')).toBeVisible();
  await expect(page.locator('ul.media-list')).toHaveCount(0);
});
