import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * DESIGN.md: the primary colour is for the single most important action on a screen. This walks
 * every admin screen, in each state that changes what is on it -- an empty list and a filled one,
 * a form with nothing changed and one with a change, a row being renamed -- and counts the filled
 * buttons a reader can see, at 1440 and at 375. An unchanged Save is a secondary button, so it is
 * not counted until there is a change. It signs in once: /recovery allows five sign-ins per spec file.
 */

test.use({ stack: 'admin-one-primary' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The stack is set up once, on desktop.');

const PROJECT = 'tomecms-one-primary-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'one-primary-secret-at-least-32-chars-x';
// A media key is filed under its owner's UUID, so the owner has to have one (Home slides uploads a picture).
const OWNER = '3a9e1c47-5b2d-4f60-9c1e-7d8b2a4f6e05';

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
  // The browser puts a file straight into the store, which answers only the origin it is told.
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-one-primary',
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
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`One-primary server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`One-primary server never became ready.\n${output}`);
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

/** The filled buttons a reader can see right now, enabled or not. */
const primaries = (page: Page) => page.locator('.admin-button--primary:visible');

test('every admin screen has at most one primary action, empty or filled, changed or not', async ({ context, page }) => {
  test.setTimeout(300_000);
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
  await page.setViewportSize({ width: 1440, height: 1000 });

  /**
   * Opens a screen and waits until every island has hydrated, client:idle ones included, and what
   * they fetch has arrived, before counting: a late island or list could add a primary after a count.
   */
  const open = async (path: string, ready: string) => {
    await page.goto(`${origin}${path}`);
    await page.locator(ready).first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await page.waitForLoadState('networkidle');
  };
  /** Counts at a desktop width and a phone's: a primary hidden or shown by a breakpoint counts too. */
  const count = async (screen: string, expected: number) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(primaries(page), `${screen} at ${width}`).toHaveCount(expected);
    }
  };

  // Empty lists: the empty block's Create first holds the one primary; the head offers none.
  await open('/admin', '.admin-empty');
  await count('Posts, empty', 1);
  await expect(page.locator('.admin-empty .admin-button--primary')).toHaveText('Create first post');
  await open('/admin/pages', '.admin-empty');
  await count('Pages, empty', 1);
  await expect(page.locator('.admin-empty .admin-button--primary')).toHaveText('Create first page');

  // Stats with nothing counted: the masthead, the filters with their language select, one block.
  await open('/admin/stats', '.stats-filters');
  await count('Stats, empty', 0);
  await expect(page.locator('.stats-filters .ui-select__trigger'), 'the language is the admin select').toHaveAccessibleName('Language');
  await expect(page.locator('.admin-empty'), 'one empty block').toHaveCount(1);
  await expect(page.locator('.stats-chart'), 'no blank chart').toHaveCount(0);
  await expect(page.locator('.stats-summary'), 'no figures at zero').toHaveCount(0);

  // Navigation: an empty menu's Add item, in its empty block, is the primary, with no save row;
  // one change, and Save menu is the primary and Add item goes back to the head as a secondary.
  await open('/admin/navigation', '.navigation-tabs');
  await count('Navigation, empty and unchanged', 1);
  await expect(page.locator('.admin-empty .admin-button--primary')).toHaveText('Add item');
  await expect(page.locator('.navigation-save')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add item' }).click();
  const dialog = page.locator('dialog.navigation-dialog');
  await dialog.waitFor({ state: 'visible' });
  // A modal dialog is its own screen: the page behind it is inert, so its one primary is the dialog's.
  await expect(dialog.locator('.admin-button--primary'), 'Navigation, adding an item').toHaveCount(1);
  await dialog.getByRole('radio', { name: 'Home' }).check();
  await dialog.getByRole('button', { name: 'Add to menu' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await count('Navigation, changed', 1);
  await expect(primaries(page)).toContainText('Save menu');
  await expect(page.locator('.admin-page__head').getByRole('button', { name: 'Add item' })).toHaveClass(/admin-button--secondary/);

  await open('/admin/themes', '.theme-card');
  await count('Themes', 0);
  await expect(page.getByRole('button', { name: 'Use this theme' }).first()).toHaveClass(/admin-button--secondary/);
  await open('/admin/plugins', '.plugin-card');
  await count('Plugins', 0);
  // An unchanged Save is a secondary button, disabled; a change makes it the screen's primary.
  await open('/admin/settings', '.admin-save-bar');
  await count('Settings, unchanged', 0);
  await expect(page.locator('.admin-save-bar .admin-save-button')).toHaveClass(/admin-button--secondary/);
  await expect(page.locator('.admin-save-bar .admin-save-button')).toBeDisabled();
  await page.getByRole('textbox', { name: 'Site name' }).fill('Quiet Notes, again');
  await expect(page.locator('.admin-save-bar .admin-button--primary')).toBeEnabled();
  await count('Settings, changed', 1);

  // Home slides: an empty list adds from its empty block; a new slide makes Save slides the one
  // primary and Add slide a secondary in the head; once saved, neither is filled.
  await open('/admin/slides', '.home-slides .admin-empty');
  await count('Home slides, empty', 1);
  await expect(page.locator('.admin-empty .admin-button--primary')).toHaveText('Add slide');
  await page.getByRole('button', { name: 'Add slide' }).click();
  const drawer = page.getByRole('dialog', { name: 'New slide' });
  await drawer.getByRole('button', { name: 'Choose image' }).click();
  const sharp = (await import('sharp')).default;
  const lake = await sharp({ create: { width: 1800, height: 800, channels: 3, background: '#264653' } }).jpeg().toBuffer();
  const picker = page.locator('dialog.media-picker');
  await picker.locator('input[type="file"]').setInputFiles({ name: 'Lake.jpg', mimeType: 'image/jpeg', buffer: lake });
  await expect(drawer.getByText('1800 × 800')).toBeVisible();
  await drawer.getByLabel('Heading', { exact: true }).fill('Morning on the lake');
  await drawer.getByRole('button', { name: 'Done' }).click();
  await drawer.waitFor({ state: 'hidden' });
  await count('Home slides, changed', 1);
  await expect(primaries(page)).toContainText('Save slides');
  await expect(page.locator('.admin-page__head').getByRole('button', { name: 'Add slide' })).toHaveClass(/admin-button--secondary/);
  await page.getByRole('button', { name: 'Save slides' }).click();
  await expect(page.locator('.admin-save-button')).toHaveAttribute('data-state', 'saved');
  await count('Home slides, saved', 0);

  await open('/admin/media', '.media-upload');
  await count('Media', 1);
  await open('/admin/redirects', '.redirect-add');
  await count('Redirects', 1);

  // Security: Add a spare passkey is the one; renaming a key saves as a secondary beside it.
  await open('/admin/security', '.security-key');
  await count('Security', 1);
  await page.getByRole('button', { name: 'Rename Recovery passkey' }).click();
  await count('Security, renaming a passkey', 1);

  await open('/admin/profile', '.admin-save-bar');
  await count('Profile, unchanged', 0);
  await page.getByRole('textbox', { name: 'Author name' }).fill('Quiet Owner');
  await count('Profile, changed', 1);

  await open('/admin/maintenance', '.maintenance-templates');
  await count('Maintenance, unchanged', 0);
  await page.locator('.maintenance-template input:not(:checked)').first().check();
  await count('Maintenance, changed', 1);

  // Categories: Create category is the one; editing a row saves as a secondary.
  await open('/admin/categories', '.category-row');
  await count('Categories', 1);
  await page.locator('#category-name').fill('Travel');
  await page.getByRole('button', { name: 'Create category' }).click();
  await page.getByRole('button', { name: 'Edit Travel' }).click();
  await count('Categories, editing', 1);

  // A check-only installation has nothing to install, so System offers no primary.
  await open('/admin/system', '.update-actions');
  await count('System', 0);

  // One post and one page, through the editors, and the lists are no longer empty.
  const created = (url: string) => page.waitForResponse((r) => r.url().endsWith(url) && r.request().method() === 'POST' && r.ok());
  const postSaved = created('/api/admin/posts');
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').fill('Notes from a quiet workshop');
  await page.locator('.ProseMirror').first().fill('The desk still fits in one corner of the room.');
  await postSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await count('the post editor', 1);
  const pageSaved = created('/api/admin/pages');
  await page.goto(`${origin}/admin/pages/new`);
  await page.locator('textarea.admin-title-input').fill('About');
  await page.locator('.ProseMirror').first().fill('A small studio, writing in two languages.');
  await pageSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });

  await open('/admin', '.admin-story-grid article');
  await count('Posts, filled', 1);
  await expect(page.locator('.admin-page__head .admin-button--primary')).toContainText('New post');
  await open('/admin/pages', '.admin-story-row');
  await count('Pages, filled', 1);
  await expect(page.locator('.admin-page__head .admin-button--primary')).toContainText('New page');

  // A delete asks first, and its confirm is that dialog's one filled button, in the danger colour.
  const menu = page.locator('.admin-story-menu').first();
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.locator('dialog.ui-dialog[open]');
  await expect(confirm.locator('.admin-button--primary')).toHaveCount(1);
  await expect(confirm.locator('.admin-button--primary')).toHaveClass(/admin-button--danger/);
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
});
