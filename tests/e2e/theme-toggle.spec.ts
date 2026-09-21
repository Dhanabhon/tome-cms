import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * The light/dark choice: a round button, and a panel that floats from it.
 *
 * Measured rather than read from the markup. Where a panel lands is decided by anchor
 * positioning, its fallbacks and the window at once, and whether it is on screen, under its
 * button, or gone after a choice are questions for the rendered page.
 */

test.use({ stack: 'theme-toggle' });

const PROJECT = 'tomecms-theme-toggle';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'theme-toggle-secret-at-least-32-char';
const OWNER = '7c2d4e6f-8a0b-4c1d-9e2f-3a4b5c6d7e8f';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-theme-toggle',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'Theme Test', 'en', 'UTC', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Theme test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Theme test server never became ready.\n${output}`);
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

test.skip(({ isMobile }) => Boolean(isMobile), 'One browser is enough; the authenticator needs Chromium.');

/** Once the open panel has finished arriving: its box, its button's, and the window's. */
async function settled(page: Page) {
  await expect(page.locator('.ui-theme__panel:popover-open')).toHaveCSS('opacity', '1');
  return page.evaluate(() => {
    const panel = document.querySelector('.ui-theme__panel:popover-open')!;
    const button = panel.closest('.ui-theme')!.querySelector('.ui-theme__trigger')!;
    return {
      button: button.getBoundingClientRect().toJSON() as DOMRect,
      height: innerHeight,
      panel: panel.getBoundingClientRect().toJSON() as DOMRect,
      width: innerWidth,
    };
  });
}

test('the theme button opens a panel under itself, and a choice made there closes it', async ({ page }) => {
  await page.goto(`${origin}/en`);
  const button = page.getByRole('button', { name: 'Theme: System' });
  await button.click();
  const boxes = await settled(page);
  expect(boxes.panel.top, 'under its button').toBeGreaterThanOrEqual(boxes.button.bottom);
  expect(Math.abs(boxes.panel.right - boxes.button.right), 'lined up with its end').toBeLessThan(1);
  expect(boxes.panel.left, 'and on the screen').toBeGreaterThanOrEqual(0);
  // This site has no navigation, which is what used to leave the button stranded mid-row.
  const apart = await page.evaluate(() => document.querySelector('.site-header .language-switcher')!.getBoundingClientRect().left
    - document.querySelector('.site-header .ui-theme__trigger')!.getBoundingClientRect().right);
  expect(apart, 'the controls gather on the right, whether or not a nav pushes them there').toBeLessThan(32);

  await page.locator('.ui-theme__option', { hasText: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.ui-theme__panel'), 'a choice made with a pointer is done').toBeHidden();
  await expect(page.getByRole('button', { name: 'Theme: Dark' }), 'and the button says what is in force').toBeFocused();
  await expect(page.locator('.site-header .ui-theme__glyph--dark'), 'and shows it').toHaveCSS('opacity', '1');
  await expect(page.locator('.site-header .ui-theme__glyph--system')).toHaveCSS('opacity', '0');
});

test('the keyboard walks the choices, and Escape puts the panel away', async ({ page }) => {
  await page.goto(`${origin}/en`);
  const button = page.getByRole('button', { name: 'Theme: System' });
  await button.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('.ui-theme__panel');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'System' }), 'the choice in force is where the keyboard lands').toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Asked of the popover's state, not of what is drawn: a closing panel stays drawn while it
  // fades, and would pass for an open one.
  await expect(page.locator('.ui-theme__panel:popover-open'), 'an arrow may be the first of several choices').toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeFocused();
});

test('on a phone the panel stays on the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(`${origin}/en`);
  const button = page.getByRole('button', { name: 'Theme: System' });
  await button.click();
  const boxes = await settled(page);
  expect(boxes.panel.left).toBeGreaterThanOrEqual(0);
  expect(boxes.panel.right).toBeLessThanOrEqual(boxes.width);
  expect(boxes.panel.bottom).toBeLessThanOrEqual(boxes.height);
});

test('where anchoring is missing, the script puts the panel where anchoring would', async ({ page }) => {
  // A browser without anchor positioning: the script is told so, and the stylesheet's
  // anchoring is taken away, so the only thing left placing the panel is the script.
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((...args: [string, string?]) => (String(args[0]).includes('anchor') ? false : supports(...(args as [string])))) as typeof CSS.supports;
  });
  await page.goto(`${origin}/en`);
  await page.addStyleTag({ content: '.ui-theme__panel { position-area: none !important; margin: 0 !important; }' });
  const button = page.getByRole('button', { name: 'Theme: System' });
  await button.click();
  const boxes = await settled(page);
  expect(boxes.panel.top, 'under its button').toBeGreaterThanOrEqual(boxes.button.bottom);
  expect(boxes.panel.top - boxes.button.bottom, 'and close to it').toBeLessThan(12);
  expect(Math.abs(boxes.panel.right - boxes.button.right), 'lined up with its end').toBeLessThan(1);
});

test('nothing moves for a reader who asked for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${origin}/en`);
  await page.getByRole('button', { name: 'Theme: System' }).click();
  await expect(page.locator('.ui-theme__panel')).toHaveCSS('opacity', '1');
  const transforms = await page.evaluate(() => [...document.querySelectorAll('.ui-theme__panel, .ui-theme__glyph')]
    .map((element) => getComputedStyle(element).transform));
  expect(new Set(transforms), 'the panel and the icons fade, and nothing turns or grows').toEqual(new Set(['none']));
});

test('in the admin sidebar the panel opens upward, on the screen', async ({ context, page }) => {
  test.setTimeout(120_000);
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

  const button = page.locator('.admin-sidebar').getByRole('button', { name: 'Admin appearance: System' });
  await button.click();
  const boxes = await settled(page);
  expect(boxes.panel.bottom, 'over its button, at the foot of the sidebar').toBeLessThanOrEqual(boxes.button.top);
  expect(boxes.panel.top).toBeGreaterThanOrEqual(0);
  expect(boxes.panel.left).toBeGreaterThanOrEqual(0);
  expect(boxes.panel.right).toBeLessThanOrEqual(boxes.width);
});
