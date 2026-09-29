import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * A passkey check by an owner who is already signed in is not a sign-in attempt.
 *
 * A sign-in challenge (the Turnstile plugin) stands in front of `verify-authentication`, and the
 * sign-in page is the only screen that can pass it a token. Installing an update and making new
 * recovery codes ask the owner for a passkey again, through the same call, with no token to
 * give -- so with the challenge on they were refused, the passkey was fine, and the update
 * screen said "the check did not finish, it may have been cancelled" and turned the release
 * status into "check unavailable". Nothing in a test over an unchallenged site could see it.
 *
 * Each signIn() here is one of the five /recovery sign-ins the server allows a spec file in half an
 * hour, and a sixth is answered 429. This file makes three, so a new test that signs in has one to spare.
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
  // The sign-in challenge switched on, as an owner does under Plugins. Its secret is never used
  // here: a request without a token is refused before anything is sent to Cloudflare.
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

test('a signed-in owner can install an update while a sign-in challenge is on', async ({ context, page }) => {
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

test('a signed-in owner can make new recovery codes while a sign-in challenge is on', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/security`);
  const verified = verification(page);
  await page.getByRole('button', { name: 'Verify and create new codes' }).click();
  const answer = await verified;
  expect(answer.status(), await answer.text()).toBe(200);
  await expect(page.getByText('New recovery codes created.')).toBeVisible();
});

const verifyWithoutToken = (cookie?: string) => fetch(`${origin}/api/auth/passkey/verify-authentication`, {
  body: JSON.stringify({ response: { id: 'nobody' } }),
  headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
  method: 'POST',
});

test('the challenge still stands in front of a caller with no session', async () => {
  // A cookie is not a session. One that is made up is a caller with none, and skipping the
  // challenge for anything that carries a cookie would leave it standing in front of nobody.
  for (const cookie of [undefined, 'better-auth.session_token=forged']) {
    const answer = await verifyWithoutToken(cookie);
    expect(answer.status, cookie ?? 'no cookie').toBe(403);
    expect(await answer.json()).toMatchObject({ code: 'challenge_refused' });
  }
});

test('a refused passkey is named on the update screen, and the release status stays true', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await openSystemScreen(page);
  // What the browser holds while it is signed in, to show again once the session is gone.
  const stale = (await context.cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
  // A screen left open until the session lapsed: the check is now a sign-in, and the challenge applies.
  const signedOut = await page.request.post(`${origin}/api/auth/sign-out`, { data: {}, headers: { origin } });
  expect(signedOut.ok()).toBe(true);
  await pressInstall(page);
  await expect(page.getByRole('alert')).toContainText('The sign-in check was not passed');
  // The check itself worked, so it does not say it failed.
  await expect(page.locator('.update-status')).toHaveText('Release availability: Update available');
  await expect(page.getByText('TomeCMS 1.1.0 is available.')).toBeVisible();
  // The cookie that was a session a moment ago is not one now, and the database is what says so.
  const replay = await verifyWithoutToken(stale);
  expect(replay.status).toBe(403);
  expect(await replay.json()).toMatchObject({ code: 'challenge_refused' });
});
