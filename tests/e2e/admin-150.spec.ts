import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * The 1.5.0 admin behaviours, one test each and at most five in this file, so it signs in
 * five times at most: /recovery allows five sign-ins per spec file, and a sixth times out.
 * Each test signs in for itself with signIn() below and drives the screen it names.
 */

test.use({ stack: 'admin-150' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The stack is set up once, on desktop.');

const PROJECT = 'tomecms-150-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'admin-150-secret-at-least-32-chars-xxxx';

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

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  // The store's CORS allows this origin, so the browser may PUT a file to it; and a media key
  // is filed under its owner's UUID, so the owner below has one.
  process.env.TOME_CMS_TEST_ORIGIN = origin;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-admin-150',
  };
  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);
  Object.assign(process.env, env);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values ('a1500000-0000-4000-8000-000000000001', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'a1500000-0000-4000-8000-000000000001', 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values ('a1500000-0000-4000-8000-000000000001', 'Uncategorized', true)`.execute(db);
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Admin 1.5.0 server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Admin 1.5.0 server never became ready.\n${output}`);
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

async function signIn(context: BrowserContext, page: Page) {
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
}

test('a save button spins, says Saved, and asks again after an edit', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/settings`);
  const save = page.locator('.admin-save-button');
  await expect(save).toHaveAttribute('data-state', 'idle');
  await page.getByLabel('Tagline').fill('A small studio');
  await expect(save).toHaveAttribute('data-state', 'dirty');
  await save.click();
  await expect(save).toHaveAttribute('data-state', 'saved');
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveCount(1);
  const width = (await save.boundingBox())!.width;
  await page.getByLabel('Tagline').fill('A small studio, again');
  await expect(save).toHaveAttribute('data-state', 'dirty');
  expect(Math.round((await save.boundingBox())!.width)).toBe(Math.round(width));
});

test('a row menu closes on a press outside and on Escape', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').first().fill('Menu test');
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await page.goto(`${origin}/admin?status=all`);
  const menus = page.locator('details.admin-story-menu');
  const menu = menus.first();
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await page.mouse.click(5, 5);
  await expect(menu).not.toHaveAttribute('open', '');
  await menu.locator('summary').click();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(menu.locator('summary')).toBeFocused();
  // Safari does not focus a summary on click: with focus on the page, Escape still closes it.
  await menu.locator('summary').click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(menu.locator('summary')).toBeFocused();
});

test('a publish date is chosen with the keyboard and saved with the draft', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').first().fill('Date test');
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  const settings = page.locator('dialog.admin-editor-settings');
  const field = page.locator('#post-publish-at');
  const picker = page.getByRole('dialog', { name: 'Choose a date and time' });
  await expect(field).toContainText('Choose a date');

  // Escape closes the picker alone and hands the keyboard back to its button.
  await field.click();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(field).toBeFocused();
  await expect(settings, 'Escape did not take the drawer with it').toBeVisible();

  // Arrows, PageDown/PageUp and Enter drive the grid; Done closes it.
  await field.click();
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-date') ?? '');
  const start = await focused();
  await page.keyboard.press('PageDown');
  expect(await focused(), 'PageDown moves a month').not.toBe(start);
  await page.keyboard.press('PageUp');
  expect(await focused()).toBe(start);
  const filed = page.waitForResponse((response) => response.url().endsWith('/api/admin/posts')
    && ['POST', 'PUT'].includes(response.request().method()) && response.ok()
    && Boolean(response.request().postDataJSON()?.publishedAt));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toBeHidden();
  await expect(field).not.toContainText('Choose a date');
  await expect(field, 'a screen reader is told the chosen moment').toHaveAccessibleDescription(/09:00/);
  await filed;

  const { db } = await import('../../src/server/db/client');
  const row = await db.selectFrom('posts').select(['planned_at']).where('title', '=', 'Date test').executeTakeFirstOrThrow();
  expect(row.planned_at).not.toBeNull();
});

test('several files go up at once into the folder chosen for them, and a failed row can be retried', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/media`);
  await page.getByPlaceholder('Folder name').fill('Covers');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByRole('button', { name: 'Covers' })).toBeVisible();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  // The store refuses pixel-2 the first time it is asked, as a flaky network would.
  let refusedOnce = false;
  await page.route('**/api/admin/media/uploads', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.originalName === 'pixel-2.png' && !refusedOnce) {
      refusedOnce = true;
      await route.fulfill({ contentType: 'application/json', json: { error: 'Storage is busy.' }, status: 503 });
      return;
    }
    await route.continue();
  });
  await page.locator('.media-upload input[type="file"]').setInputFiles([
    ...[1, 2, 3].map((n) => ({ name: `pixel-${n}.png`, mimeType: 'image/png', buffer: png })),
    { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') },
  ]);
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  const rows = dialog.locator('.media-upload-row');
  await expect(rows).toHaveCount(4);
  // The file that cannot be kept is told at once, before anything is sent, and has no Retry.
  const refused = rows.filter({ hasText: 'setup.exe' });
  await expect(refused).toHaveAttribute('data-status', 'refused');
  await expect(refused.getByRole('alert')).not.toBeEmpty();
  await expect(refused.getByRole('button', { name: 'Retry' })).toHaveCount(0);

  // Escape closes the folder list alone; the dialog stays.
  const folder = dialog.locator('#media-upload-folder');
  await folder.click();
  await expect(dialog.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('listbox')).toBeHidden();
  await expect(dialog, 'Escape did not take the dialog with it').toBeVisible();
  await folder.click();
  await dialog.getByRole('option', { name: 'Covers' }).click();
  await expect(folder).toContainText('Covers');

  await dialog.getByRole('button', { name: 'Upload 3 files' }).click();
  await expect(rows.filter({ hasText: 'pixel-1.png' })).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  await expect(rows.filter({ hasText: 'pixel-3.png' })).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  const failed = rows.filter({ hasText: 'pixel-2.png' });
  await expect(failed).toHaveAttribute('data-status', 'failed');
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(failed).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.media-card')).toHaveCount(3);

  // Stop stops every upload, and Escape pressed again cannot leave the dialog hidden but mounted.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.unroute('**/api/admin/media/uploads');
  await page.route('**/api/admin/media/uploads', async (route) => {
    if (route.request().method() === 'POST' && String(route.request().postDataJSON()?.originalName).startsWith('held-')) {
      await held;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.locator('.media-upload input[type="file"]').setInputFiles([1, 2].map((n) => ({ name: `held-${n}.png`, mimeType: 'image/png', buffer: png })));
  await dialog.getByRole('button', { name: 'Upload 2 files' }).click();
  await expect(dialog.locator('.media-upload-row[data-status="uploading"]')).toHaveCount(2);
  const leave = page.getByRole('dialog', { name: 'Stop the uploads still running?' });
  await page.keyboard.press('Escape');
  await expect(leave).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(leave).toBeHidden();
  // Chromium sometimes closes a dialog on Escape without letting the page hold it back. That is
  // simulated rather than waited for: a cancel that cannot be cancelled is ignored by the page
  // (it must not open the prompt), then the dialog closes itself, and the page has to follow --
  // ending the uploads -- rather than keep a hidden dialog mounted with uploads running.
  const mounted = page.locator('dialog.media-upload-dialog');
  await page.evaluate(() => document.querySelector('dialog.media-upload-dialog')?.dispatchEvent(new Event('cancel', { cancelable: false })));
  await expect(leave, 'a cancel that cannot be held back does not ask').toBeHidden();
  await expect(mounted).toHaveCount(1);
  await page.evaluate(() => (document.querySelector('dialog.media-upload-dialog') as HTMLDialogElement | null)?.close());
  await expect(mounted, 'the dialog is gone, not hidden').toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  release();
  await expect(page.locator('.media-card')).toHaveCount(3);
  const { db } = await import('../../src/server/db/client');
  expect(await db.selectFrom('media_items').select('id').where('original_name', 'like', 'held-%').execute(), 'a stopped upload lands nothing').toHaveLength(0);

  const filed = await db.selectFrom('media_items').innerJoin('media_folders', 'media_folders.id', 'media_items.folder_id')
    .select('media_folders.name').execute();
  expect(filed.filter((row) => row.name === 'Covers')).toHaveLength(3);
});

test('an unticked cover leaves the top of the published article, and the shared-link image keeps it', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').first().fill('Cover test');
  await page.locator('.ProseMirror').first().fill('Body without pictures.');
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  // Uploading from the picker chooses the file as the cover in one step.
  await page.getByRole('button', { name: 'Choose image' }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.media-picker input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.admin-cover-preview')).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByLabel('Show the cover at the top of the post');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator('.admin-save-state[data-state="saved"]'), 'the toggle is saved like any other field').toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();

  const { db } = await import('../../src/server/db/client');
  await expect.poll(async () => (await db.selectFrom('posts').select('status').where('title', '=', 'Cover test').executeTakeFirst())?.status, { timeout: 30_000 }).toBe('published');
  const row = await db.selectFrom('posts').select(['slug', 'locale', 'show_cover']).where('title', '=', 'Cover test').executeTakeFirstOrThrow();
  expect(row.show_cover).toBe(false);
  await page.goto(`${origin}/${row.locale}/blog/${row.slug}`);
  await expect(page.locator('h1')).toContainText('Cover test');
  await expect(page.locator('.post-cover')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]'), 'the shared-link image still reads the cover').toHaveCount(1);
});
