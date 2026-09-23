import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * An owner's home slides, made in the admin, drawn on the home page of their language alone.
 *
 * A slide belongs to one language: an owner working in the admin's English can still be
 * building slides for the site's Thai home page, and the two are kept apart all the way
 * through -- from the drawer where they are written to the page where they are read.
 */

test.use({ stack: 'home-slides' });

const PROJECT = 'tomecms-select-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'home-slides-secret-at-least-32-chars';
// A media key is filed under its owner's UUID, so the owner has to have one.
const OWNER = '6c1f2e3d-4b5a-4c7d-8e9f-0a1b2c3d4e5f';

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
  // The browser puts a file straight into the store, which answers only the origin it is told.
  process.env.TOME_CMS_TEST_ORIGIN = origin;
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-home-slides',
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
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'Slides Test', 'en', 'UTC', '/admin')`.execute(db);
  // Somewhere for a post to be filed: saving one files it under the default category,
  // and an installation always has one.
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

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


// Every test here signs in on its own, through the recovery page, and recovery allows five in
// half an hour -- a limit for a person at a keyboard, which this file reaches at its sixth
// test. The limiter has tests of its own; here it only stands between a test and the editor.
test.beforeEach(async () => {
  const { db } = await import('../../src/server/db/client');
  await db.deleteFrom('security_rate_limits').execute();
});

test.skip(
  ({ isMobile }) => Boolean(isMobile),
  'The editor is driven by a keyboard here, and the virtual authenticator needs Chromium.',
);

test('an owner makes slides for one language, orders them by keyboard, and sees them on that home page alone', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  const { writeThemeSettings } = await import('../../src/server/themes/store');
  await writeThemeSettings(OWNER, { id: 'paper', values: { hero: 'slides' } });
  const sharp = (await import('sharp')).default;
  const lake = await sharp({ create: { width: 1800, height: 800, channels: 3, background: '#264653' } }).jpeg().toBuffer();
  const status = page.locator('.navigation-status');

  await page.goto(`${origin}/admin/slides`);
  await expect(page.getByRole('heading', { name: 'Home slides', level: 1 })).toBeVisible();
  await expect(page.getByText('once the theme’s hero is set to Your slides'), 'the hero shows slides, so nothing warns').toHaveCount(0);
  await page.getByRole('tab', { name: 'ไทย' }).click();

  // The first: a picture uploaded from the drawer, a heading, and a button that leaves the site.
  await page.getByRole('button', { name: 'Add slide' }).click();
  const drawer = page.getByRole('dialog', { name: 'New slide' });
  await drawer.getByRole('button', { name: 'Choose picture' }).click();
  const picker = page.locator('dialog.media-picker');
  await picker.locator('input[type="file"]').setInputFiles({ name: 'Lake.jpg', mimeType: 'image/jpeg', buffer: lake });
  await expect(drawer.getByText('1800 × 800'), 'the picture is chosen and its size said').toBeVisible();
  await expect(drawer.getByText(/Under 1,600/), 'wide enough, so no warning').toHaveCount(0);
  await drawer.getByLabel('Heading', { exact: true }).fill('ทะเลสาบยามเช้า');
  await drawer.getByLabel('Button text', { exact: true }).fill('อ่านต่อ');
  await drawer.getByRole('radio', { name: 'An address' }).check();
  await drawer.getByLabel('Address', { exact: true }).fill('https://example.com/');
  await drawer.getByRole('checkbox', { name: 'Open in a new tab' }).check();
  await drawer.getByRole('button', { name: 'Done' }).click();
  await expect(status).toHaveText('Added a slide. Save to publish it.');

  // The second: the same picture, chosen from the library this time, other words, no button.
  await page.getByRole('button', { name: 'Add slide' }).click();
  await drawer.getByRole('button', { name: 'Choose picture' }).click();
  await picker.getByRole('button', { name: /^Select Lake\.jpg,/ }).click();
  await drawer.getByLabel('Heading', { exact: true }).fill('Second');
  await drawer.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Save slides' }).click();
  await expect(status).toHaveText('Slides saved.');

  const home = async (locale: 'th' | 'en') => {
    await page.goto(`${origin}/${locale}`);
    return page.evaluate(() => [...document.querySelectorAll('.hero-slide')].map((slide) => {
      const image = slide.querySelector('img')!;
      return {
        fetchpriority: image.getAttribute('fetchpriority'),
        heading: slide.querySelector('h2')?.textContent ?? null,
        loading: image.getAttribute('loading'),
        target: slide.querySelector('a')?.getAttribute('target') ?? null,
      };
    }));
  };
  expect(await home('th'), 'both slides, the first fetched first, the button opening a new tab').toEqual([
    { fetchpriority: 'high', heading: 'ทะเลสาบยามเช้า', loading: 'eager', target: '_blank' },
    { fetchpriority: 'low', heading: 'Second', loading: 'lazy', target: null },
  ]);
  expect(await home('en'), 'the English home page has slides of its own, and none yet').toEqual([]);

  // On a phone the band grows to hold its words rather than cutting them off.
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(`${origin}/th`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.hero-slide')].some((slide) => {
    const box = slide.getBoundingClientRect();
    const words = slide.querySelector('.hero-slide__words')?.getBoundingClientRect();
    return words ? words.top < box.top - 0.5 || words.bottom > box.bottom + 0.5 : false;
  }));
  expect(clipped, 'no slide cuts off its words on a phone').toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Reordered by keyboard alone, and the home page follows once it is saved.
  await page.goto(`${origin}/admin/slides`);
  await page.getByRole('group', { name: 'Actions for slide 1' }).getByRole('button', { name: 'Move down' }).focus();
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('Moved slide 1 to position 2.');
  await page.getByRole('button', { name: 'Save slides' }).click();
  await expect(status).toHaveText('Slides saved.');
  expect((await home('th')).map((slide) => slide.heading)).toEqual(['Second', 'ทะเลสาบยามเช้า']);

  // The library will not delete the picture from under them, and names each slide.
  await page.goto(`${origin}/admin/media`);
  await page.getByRole('button', { name: /^Lake\.jpg,/ }).click();
  const details = page.getByRole('dialog', { name: 'File details' });
  await details.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('still used');
  await expect(details.getByRole('link', { name: 'Second' })).toBeVisible();
  await expect(details.getByRole('link', { name: 'ทะเลสาบยามเช้า' })).toBeVisible();
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
