import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';
import { everyState } from './touch-targets';

/**
 * Every control in the admin is at least 44 × 44 CSS px under a coarse pointer: the fifteen screens
 * admin-shots.spec.ts shoots, the mobile navigation, the post editor and its formatting bar. Runs on
 * the mobile project (a Pixel 5, hasTouch), where (pointer: coarse) matches; a mouse sees none of the
 * rules this holds to. It signs in once: /recovery allows five sign-ins per spec file.
 */

test.use({ stack: 'touch-admin' });
test.skip(({ isMobile }) => !isMobile, 'Measured on the mobile project, whose pointer is coarse.');

const PROJECT = 'tomecms-touch-admin-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'touch-admin-secret-at-least-32-chars-xy';
const OWNER = 'touch-admin-owner';

const SCREENS: ReadonlyArray<readonly [name: string, path: string]> = [
  ['posts', '/admin'], ['pages', '/admin/pages'], ['categories', '/admin/categories'],
  ['media', '/admin/media'], ['navigation', '/admin/navigation'], ['slides', '/admin/slides'],
  ['redirects', '/admin/redirects'], ['stats', '/admin/stats'], ['profile', '/admin/profile'],
  ['security', '/admin/security'], ['settings', '/admin/settings'], ['maintenance', '/admin/maintenance'],
  ['themes', '/admin/themes'], ['plugins', '/admin/plugins'], ['system', '/admin/system'],
];

// Each entry: a selector and why it may stay under 44 px. Filled from the first run's findings, never guessed.
const ALLOWED: readonly string[] = [
  // A prefixed field's input fills its control inside the 1 px border, so it measures 42; the control
  // around it, 44 tall, and the label around that are what a finger presses, and both focus it.
  '.admin-control--prefixed > input',
];

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-touch-admin',
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
    if (server.exitCode !== null) throw new Error(`Touch server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Touch server never became ready.\n${output}`);
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

test('every admin control is at least 44 × 44 under a coarse pointer', async ({ context, page }) => {
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

  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the premise: a coarse pointer').toBe(true);
  const failures: string[] = [];
  const measure = async (name: string) => {
    for (const line of await everyState(page, ALLOWED)) failures.push(`${name}: ${line}`);
  };

  // One post and one page, through the editors, so the lists have a card, a row and their menus to
  // measure. The post editor is measured as it stands, and again with words chosen, which brings
  // the formatting bar.
  const created = (url: string) => page.waitForResponse((r) => r.url().endsWith(url) && r.request().method() === 'POST' && r.ok());
  const postSaved = created('/api/admin/posts');
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').fill('Notes from a quiet workshop');
  const body = page.locator('.ProseMirror').first();
  await body.fill('The desk still fits in one corner of the room.');
  await postSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await measure('post editor');
  await body.press('ControlOrMeta+a');
  await page.locator('.editor-menu').waitFor({ state: 'visible' });
  await measure('post editor, words chosen');
  // A 44-pixel button is no target when the bar has clipped it: every one of them is on the screen.
  const offscreen = await page.locator('.editor-menu button').evaluateAll((buttons) => buttons
    .filter((button) => { const box = button.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth; })
    .map((button) => button.getAttribute('aria-label')));
  expect(offscreen, 'the formatting bar fits the phone').toEqual([]);
  const pageSaved = created('/api/admin/pages');
  await page.goto(`${origin}/admin/pages/new`);
  await page.locator('textarea.admin-title-input').fill('About');
  await page.locator('.ProseMirror').first().fill('A small studio, writing in two languages.');
  await pageSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });

  for (const [name, path] of SCREENS) {
    await page.goto(`${origin}${path}`);
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await page.waitForLoadState('networkidle');
    await measure(name);
  }
  // The navigation is the same dialog on every screen, so it is opened and measured once.
  await page.locator('[data-nav-open]').click();
  await page.locator('dialog.admin-mobile-nav[open]').waitFor({ state: 'visible' });
  await measure('navigation menu');
  expect(failures, failures.join('\n')).toEqual([]);
});
