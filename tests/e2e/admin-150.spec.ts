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
    values ('admin-150-owner', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'admin-150-owner', 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values ('admin-150-owner', 'Uncategorized', true)`.execute(db);
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
});
