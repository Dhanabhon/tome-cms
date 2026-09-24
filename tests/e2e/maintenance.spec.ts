import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';
import type { APIContext } from 'astro';

import { expect, test } from './own-worker';

/**
 * A site closed for maintenance, as a visitor, a headless site and its owner meet it.
 *
 * A reader's page answers 503 with the owner's maintenance page at the address they asked for,
 * in its language; the feeds and the content API refuse with the same 503 and the return time;
 * and what must stay open -- the API's description, a preflight, health -- stays open. The
 * owner writes the page, closes the site from the admin, and still sees the site while it is.
 */

test.use({ stack: 'maintenance' });

const PROJECT = 'tomecms-select-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'maintenance-secret-at-least-32-chars';
// The owner signs in as this id, and the site's settings are filed under it.
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
  // The test store allows one browser origin. This file uploads nothing, but starts it as the others do.
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-maintenance',
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
    values (true, ${OWNER}, 'Maintenance Test', 'en', 'UTC', '/admin')`.execute(db);
  // An installation always has a default category, so this one does too.
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Maintenance test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Maintenance test server never became ready.\n${output}`);
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


// The owner's test signs in through the recovery page, and recovery allows five in half an
// hour -- a limit for a person at a keyboard. The limiter has tests of its own; here it only
// stands between a test and the admin.
test.beforeEach(async () => {
  const { db } = await import('../../src/server/db/client');
  await db.deleteFrom('security_rate_limits').execute();
});

test.skip(
  ({ isMobile }) => Boolean(isMobile),
  'One stack per file; the phone width is checked by setting the viewport, and the virtual authenticator needs Chromium.',
);

async function closeSite(values: { backAt: Date | null; copy: object; template: string }) {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`update site_settings set maintenance_enabled = true, maintenance_template = ${values.template},
    maintenance_copy = ${JSON.stringify(values.copy)}::jsonb, maintenance_media_id = null,
    maintenance_back_at = ${values.backAt?.toISOString() ?? null}::timestamptz`.execute(db);
}

async function openSite() {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`update site_settings set maintenance_enabled = false, maintenance_template = 'minimal',
    maintenance_copy = '{}'::jsonb, maintenance_back_at = null`.execute(db);
}

test('a closed site answers 503 in the reader’s language, and leaves health open', async ({ page }) => {
  test.setTimeout(120_000);
  // Whole seconds: Retry-After is an HTTP date, which has no milliseconds.
  const until = new Date(Math.ceil(Date.now() / 1000) * 1000 + 2 * 3_600_000);
  await closeSite({ backAt: until, copy: { th: { heading: 'ปิดซ่อมระบบ', message: '' } }, template: 'countdown' });

  const thai = await fetch(`${origin}/th/`);
  expect(thai.status).toBe(503);
  expect(thai.headers.get('cache-control')).toBe('no-store');
  expect(thai.headers.get('retry-after')).toBe(until.toUTCString());
  const thaiPage = await thai.text();
  expect(thaiPage, 'the owner’s heading').toContain('ปิดซ่อมระบบ');
  expect(thaiPage, 'and the product’s message where none was written').toContain('เราจะกลับมาเร็ว ๆ นี้');

  const english = await fetch(`${origin}/en/about`);
  expect(english.status).toBe(503);
  expect(await english.text(), 'English words where the owner wrote only Thai').toContain('Down for maintenance');
  expect((await fetch(`${origin}/`)).status, 'the root too').toBe(503);

  const feed = await fetch(`${origin}/rss.xml`);
  expect(feed.status).toBe(503);
  expect(await feed.text()).toBe('The site is closed for maintenance.\n');

  const api = await fetch(`${origin}/api/v1/content/posts?locale=th`);
  expect(api.status).toBe(503);
  expect(api.headers.get('content-type')).toContain('application/problem+json');
  expect(api.headers.get('retry-after')).toBe(until.toUTCString());
  expect((await api.json() as { maintenance: unknown }).maintenance).toEqual({
    backAt: until.toISOString(), heading: 'ปิดซ่อมระบบ', locale: 'th', message: 'เราจะกลับมาเร็ว ๆ นี้',
  });
  expect((await fetch(`${origin}/api/v1/content/posts`, { method: 'OPTIONS' })).status, 'a preflight still answers').toBe(204);
  // `astro dev` answers every preflight in Vite before the app sees one, so the gate is asked itself.
  const { preparedHeadlessRequest } = await import('../../src/middleware');
  const preflight = new Request(`${origin}/api/v1/content/posts`, { method: 'OPTIONS' });
  const reached = await preparedHeadlessRequest(
    { locals: {}, request: preflight, url: new URL(preflight.url) } as APIContext,
    async () => new Response('the route'),
  );
  expect(await reached?.text(), 'the gate lets a preflight through to the route').toBe('the route');
  expect((await fetch(`${origin}/api/v1/content/openapi.json`)).status).toBe(200);
  expect((await fetch(`${origin}/health/ready`)).status, 'health stays open, or the deploy helper would roll back').toBe(200);
  expect((await fetch(`${origin}/media/${randomUUID()}`, { redirect: 'manual' })).status, 'media stays open: a missing file is 404, not 503').toBe(404);
  expect((await fetch(`${origin}/maintenance`)).status, 'the page is not an address of its own').toBe(404);

  // On a phone: the clock ticks and nothing runs off the side.
  await page.setViewportSize({ width: 375, height: 740 });
  expect((await page.goto(`${origin}/th/`))?.status()).toBe(503);
  await expect(page.getByRole('heading', { level: 1, name: 'ปิดซ่อมระบบ' })).toBeVisible();
  const seconds = page.locator('[data-unit="seconds"]');
  await expect(page.locator('[data-countdown]')).toBeVisible();
  const first = await seconds.textContent();
  await expect.poll(() => seconds.textContent(), { timeout: 5_000 }).not.toBe(first);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);

  // Once the time has come the page says so, and asks no one to retry at a time gone by.
  await closeSite({ backAt: new Date(Date.now() - 60_000), copy: {}, template: 'countdown' });
  expect((await page.goto(`${origin}/en/`))?.headers()['retry-after']).toBeUndefined();
  await expect(page.getByText('Back any moment now')).toBeVisible();
  await expect(page.locator('[data-countdown]')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  await openSite();
  expect((await fetch(`${origin}/th/`)).status, 'open again on the next request').toBe(200);
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

test('the owner writes the page, previews it, closes the site, still sees it, and opens it again', async ({ context, page }) => {
  test.setTimeout(180_000);
  await openSite();
  await signIn(context, page);
  const status = page.locator('.admin-save-bar [role="status"]');

  await page.goto(`${origin}/admin/maintenance`);
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible();
  await expect(page.getByText('The site is open to everyone.')).toBeVisible();
  const section = page.locator('details.admin-nav-section[open]:visible').filter({ has: page.locator('a[aria-current="page"]') });
  await expect(section.locator('summary'), 'Maintenance sits under Settings, open while it is read').toContainText('Settings');
  await expect(section.locator('a[aria-current="page"]')).toHaveText('Maintenance');
  await expect(section.getByRole('link', { name: 'General', exact: true })).toBeVisible();

  await page.getByRole('radio', { name: /^Countdown/ }).check();
  await page.getByLabel('Heading', { exact: true }).fill('ปิดปรับปรุงระบบ');
  await page.getByLabel('Message', { exact: true }).fill('ขอบคุณที่รอ');
  await page.getByRole('tab', { name: 'English' }).click();
  await expect(page.getByLabel('Heading', { exact: true }), 'the product’s words shown as the placeholder').toHaveAttribute('placeholder', 'Down for maintenance');
  await page.getByLabel('Heading', { exact: true }).fill('Closed for upgrades');
  await page.getByLabel('Date and time', { exact: true }).fill('2030-01-01T09:00');

  const closeSwitch = page.getByRole('switch', { name: 'Close the site for maintenance' });
  await expect(closeSwitch).not.toBeChecked();
  await expect(closeSwitch, 'the site never closes on unsaved words').toBeDisabled();
  await expect(page.getByText('Save your changes before turning maintenance on.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status).toHaveText('Saved.');
  await page.getByLabel('Heading', { exact: true }).fill('Closed for upgrades!');
  await expect(status, 'typing replaces the last message').toHaveText('Unsaved changes · Preview shows the last saved version.');
  await page.getByLabel('Heading', { exact: true }).fill('Closed for upgrades');
  await expect(status).toHaveText('No unsaved changes');

  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /Preview/ }).click()]);
  await expect(preview.getByRole('heading', { level: 1 }), 'the preview follows the language tab').toHaveText('Closed for upgrades');
  await preview.close();

  await closeSwitch.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(closeSwitch, 'a cancelled confirmation leaves the site open').not.toBeChecked();
  await closeSwitch.click();
  await page.getByRole('button', { name: 'Close the site', exact: true }).click();
  await expect(status).toHaveText('Maintenance is on. Visitors see the maintenance page.');
  await expect(closeSwitch).toBeChecked();
  await page.reload();
  await expect(page.getByText('The site is closed for maintenance', { exact: true }), 'here the Status card says it').toHaveCount(0);
  await page.goto(`${origin}/admin/settings`);
  await expect(page.getByText('The site is closed for maintenance', { exact: true }), 'every other admin screen says so').toBeVisible();
  await expect(page.getByRole('link', { name: 'Maintenance settings' })).toBeVisible();

  const own = await page.goto(`${origin}/th`);
  expect(own?.status(), 'the owner still sees the site').toBe(200);
  expect(own?.headers()['cache-control']).toBe('private, no-store');
  await expect(page.getByText('เว็บปิดปรับปรุงอยู่ ผู้เยี่ยมชมจะเห็นหน้าปิดปรับปรุง')).toBeVisible();

  const visitor = await fetch(`${origin}/th`);
  expect(visitor.status).toBe(503);
  expect(await visitor.text()).toContain('ปิดปรับปรุงระบบ');
  const stranger = await fetch(`${origin}/api/admin/maintenance/state`, {
    body: JSON.stringify({ enabled: false }), headers: { 'content-type': 'application/json', origin }, method: 'PUT',
  });
  expect(stranger.status, 'only the owner switches it').toBe(401);
  expect((await fetch(`${origin}/api/admin/maintenance`, { headers: { origin } })).status, 'or reads it').toBe(401);

  await page.goto(`${origin}/admin/maintenance`);
  await closeSwitch.click();
  await expect(status).toHaveText('Maintenance is off. The site is open again.');
  await expect(closeSwitch).not.toBeChecked();
  expect((await fetch(`${origin}/th`)).status).toBe(200);
});
