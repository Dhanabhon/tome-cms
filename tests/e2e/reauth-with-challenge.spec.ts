import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * The challenge plugin (Turnstile) stands on the recovery-code form, and never on a passkey.
 *
 * Until 1.17.0 it stood in front of `verify-authentication`. That refused an update and new
 * recovery codes on 1.1.0 (a signed-in owner has no token to give), and on 2026-10-06 it refused
 * the owner's own working passkey on a second PC: the form never waited for the token, never
 * reset a spent one, and a slow first passkey unlock let it expire. A passkey cannot be guessed;
 * a recovery code is the one secret a person types, so the check moved there.
 *
 * Each signIn() and each real POST /api/recovery/start here is one of the five recovery attempts
 * the server allows a spec file in half an hour, and a sixth is answered 429. This file makes
 * four, so a new test that spends one has one to spare.
 */

test.use({ stack: 'reauth-with-challenge' });

const PROJECT = 'tomecms-reauth-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'reauth-challenge-secret-at-least-32-ch';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-reauth-with-challenge',
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
    values (true, 'signin-test-owner', 'Select Test', 'en', 'UTC', '/admin')`.execute(db);
  // The challenge switched on, as an owner does under Plugins. Its secret is never used here: a
  // request without a token is refused before anything is sent to Cloudflare, and the browser
  // never reaches Cloudflare either (see challengeScript).
  const { writePluginSettings } = await import('../../src/server/plugins/store');
  await writePluginSettings('signin-test-owner', { enabled: true, id: 'turnstile', values: { secretKey: 'reauth-test-secret', siteKey: 'reauth-test-site-key' } });

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
  'One browser is enough: nothing here depends on the viewport, and the virtual authenticator needs Chromium anyway.',
);

/** Turnstile's script, as far as these tests need it: a 300×65 box, and a reset that clears the answer. */
async function challengeScript(context: BrowserContext) {
  await context.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      window.__resets = 0;
      window.turnstile = { reset() { window.__resets += 1; document.querySelectorAll('[name="cf-turnstile-response"]').forEach((input) => input.remove()); } };
      document.querySelectorAll('.cf-turnstile').forEach((box) => { box.style.width = '300px'; box.style.height = '65px'; });
    `,
  }));
}

async function signIn(context: BrowserContext, page: Page) {
  await challengeScript(context);
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

/** What the System screen is given by a managed install one release behind. */
const managedCheck = {
  availability: 'available',
  checkedAt: '2026-09-29T03:00:00.000Z',
  currentVersion: '1.0.4',
  installability: { code: 'installable', installable: true, mode: 'managed', reason: 'This managed installation can install the verified update.' },
  latest: { manifest: { releaseNotesUrl: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.1.0', version: '1.1.0' }, publishedAt: '2026-09-29T03:00:00.000Z' },
  message: 'TomeCMS 1.1.0 is available.',
  updateMode: 'managed',
  updater: { installed: { imageDigest: `sha256:${'a'.repeat(64)}`, version: '1.0.4' }, job: null, managed: true, protocolVersion: 1, updaterVersion: '1.0.0' },
};

async function openSystemScreen(page: Page) {
  await page.route('**/api/admin/system/updates', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: managedCheck });
    // The request that would start the update goes nowhere: the updater is not part of this stack.
    else await route.abort('failed');
  });
  await page.goto(`${origin}/admin/system`);
  // The first render of an island on a cold build is slower than the default five seconds.
  await expect(page.locator('.update-status')).toHaveText('Release availability: Update available', { timeout: 15_000 });
}

async function pressInstall(page: Page) {
  await page.getByRole('button', { name: 'Install 1.1.0' }).click();
  await page.getByRole('dialog', { name: 'Install TomeCMS 1.1.0?' }).getByRole('button', { name: 'Install 1.1.0' }).click();
}

const verification = (page: Page) => page.waitForResponse((response) => response.url().endsWith('/api/auth/passkey/verify-authentication'));

test('a signed-in owner can install an update while the challenge plugin is on', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await openSystemScreen(page);
  const verified = verification(page);
  await pressInstall(page);
  const answer = await verified;
  expect(answer.status(), await answer.text()).toBe(200);
  // The screen took the passkey and went on to watch for the update, which is what it does only
  // once the check has passed. An absent alert means nothing before that.
  await expect(page.getByRole('heading', { name: 'Installation progress' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a signed-in owner can make new recovery codes while the challenge plugin is on', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/security`);
  const verified = verification(page);
  await page.getByRole('button', { name: 'Verify and create new codes' }).click();
  const answer = await verified;
  expect(answer.status(), await answer.text()).toBe(200);
  await expect(page.getByText('New recovery codes created.')).toBeVisible();
});

test('the passkey sign-in asks the plugin nothing, and a recovery code without the check is refused', async () => {
  // A cookie is not a session; a made-up one is a caller with none. Neither meets a challenge any more:
  // whatever refuses them is better-auth's own answer about a passkey it does not know.
  for (const cookie of [undefined, 'better-auth.session_token=forged']) {
    const answer = await fetch(`${origin}/api/auth/passkey/verify-authentication`, {
      body: JSON.stringify({ response: { id: 'nobody' } }),
      headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
      method: 'POST',
    });
    expect(answer.status, cookie ?? 'no cookie').not.toBe(403);
    expect(await answer.text()).not.toContain('challenge_refused');
  }
  const recovery = await fetch(`${origin}/api/recovery/start`, {
    body: JSON.stringify({ code: 'not-a-recovery-code' }),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
  expect(recovery.status).toBe(403);
  expect(await recovery.json()).toMatchObject({ code: 'challenge_refused' });
});

test('the sign-in page has no challenge, and the recovery form waits for one and never resends it', async ({ context, page }) => {
  await challengeScript(context);
  const challengeRequests: string[] = [];
  page.on('request', (request) => { if (request.url().startsWith('https://challenges.cloudflare.com/')) challengeRequests.push(request.url()); });
  await page.goto(`${origin}/admin`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
  await expect(page.locator('.cf-turnstile')).toHaveCount(0);
  expect(challengeRequests, 'the sign-in page loads nothing from Cloudflare').toEqual([]);

  // Every attempt the form makes, answered as the server answers a refused check.
  const starts: (string | null)[] = [];
  await page.route('**/api/recovery/start', async (route) => {
    starts.push(route.request().headers()['x-tomecms-plugin-token'] ?? null);
    await route.fulfill({ contentType: 'application/problem+json', json: { code: 'challenge_refused', status: 403 }, status: 403 });
  });
  await page.goto(`${origin}/recovery`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.waitForFunction(() => 'turnstile' in window);
  await page.getByLabel('Recovery code').fill('aaaa-bbbb-cccc');
  const send = page.getByRole('button', { name: 'Continue securely' });
  await send.click();
  // Before the check has answered, nothing is sent: the request could only be refused.
  await expect(page.getByRole('alert')).toHaveText('Wait for the check to finish.');
  expect(starts).toEqual([]);

  // The check answers, as Turnstile does: a hidden field in the form.
  await page.locator('.cf-turnstile').evaluate((box) => {
    const input = Object.assign(document.createElement('input'), { name: 'cf-turnstile-response', type: 'hidden', value: 'one-use-token' });
    box.append(input);
  });
  await send.click();
  await expect(page.getByRole('alert')).toHaveText(/^The check before recovery was not passed\..*npm run plugin:disable turnstile$/);
  expect(starts).toEqual(['one-use-token']);
  // The spent token is gone, so pressing again waits for a fresh one instead of resending it.
  expect(await page.evaluate(() => (window as unknown as { __resets: number }).__resets)).toBe(1);
  await send.click();
  await expect(page.getByRole('alert')).toHaveText('Wait for the check to finish.');
  expect(starts).toEqual(['one-use-token']);

  // The check is a row of its own above the field and its button, which keep their line at desktop width.
  for (const width of [375, 932]) {
    await page.setViewportSize({ width, height: 900 });
    const check = (await page.locator('.cf-turnstile').boundingBox())!;
    const field = (await page.getByLabel('Recovery code').boundingBox())!;
    const button = (await send.boundingBox())!;
    expect(check.y + check.height, `${width}: the check sits above the field`).toBeLessThanOrEqual(field.y);
    if (width === 932) expect(Math.abs((button.y + button.height) - (field.y + field.height)), 'the button stays on the field\'s line').toBeLessThan(2);
    else expect(button.y, '375: the button wraps below the field').toBeGreaterThanOrEqual(field.y + field.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}: no sideways scroll`).toBeLessThanOrEqual(width);
  }
});

test('the last update says how long the site was offline and what the backup held', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  const at = (seconds: number) => new Date(Date.UTC(2026, 8, 29, 7, 50, 0) + seconds * 1000).toISOString();
  const job = {
    id: '440dc7fc-974e-4e07-9eea-ddbb20a84f73', targetVersion: '1.0.4', phase: 'succeeded', completedSteps: 8, totalSteps: 8,
    message: 'Update installed successfully.', startedAt: at(-60), finishedAt: at(21), errorCode: null, backupCreatedAt: at(5),
  };
  await page.route('**/api/admin/system/updates', (route) => route.fulfill({ json: {
    ...managedCheck, availability: 'current', latest: null, message: 'TomeCMS 1.0.4 is up to date.',
    installability: { code: 'no-update', installable: false, mode: 'managed', reason: 'No compatible update is available.' },
    updater: { ...managedCheck.updater, job },
    timeline: { jobId: job.id, backupKind: 'database', timeline: [
      { phase: 'preflight', at: at(-60) }, { phase: 'quiescing', at: at(0) }, { phase: 'backing_up', at: at(2) },
      { phase: 'migrating', at: at(5) }, { phase: 'succeeded', at: at(21) },
    ] },
  } }));
  await page.goto(`${origin}/admin/system`);
  const card = page.getByRole('region', { name: 'Last update' });
  await expect(card.getByText('Site offline for:'), 'measured from maintenance to the end').toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('21 s')).toBeVisible();
  await expect(card.getByText('Database only, no migration was due (3 s)')).toBeVisible();
});
