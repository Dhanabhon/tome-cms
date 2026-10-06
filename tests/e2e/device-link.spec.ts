import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * Adding a device from the Security screen, end to end, against a disposable database.
 *
 * One signed-in device makes a link and a QR code; a second device, with an authenticator of
 * its own, opens the link and registers a passkey. Nothing else proves that the screen, the
 * link endpoint, the /add-device page and better-auth's registration agree with each other.
 */

test.use({ stack: 'device-link' });

const PROJECT = 'tomecms-device-link-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'device-link-test-secret-at-least-32-chars';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-device-link-test',
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
    values ('device-link-owner', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'device-link-owner', 'Device Link Test', 'en', 'UTC', '/admin')`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Device link test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Device link test server never became ready.\n${output}`);
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
  'Virtual WebAuthn is driven over CDP and covered once, on desktop Chromium.',
);

const AUTHENTICATOR = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

test('a link made on a signed-in device adds a passkey on another, once', async ({ browser, context, page }) => {
  test.setTimeout(180_000);
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');

  // Device A: signed in through the one recovery sign-in this spec allows itself.
  const cdpA = await context.newCDPSession(page);
  await cdpA.send('WebAuthn.enable');
  const { authenticatorId: authenticatorA } = await cdpA.send('WebAuthn.addVirtualAuthenticator', { options: AUTHENTICATOR });
  const settings = await getSiteSettings();
  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
  const passkeyOfA = await db.selectFrom('passkey').select(['id', 'credentialID']).executeTakeFirstOrThrow();

  // An owner's session is usually older than the five minutes the server accepts, so the
  // screen has to ask for a passkey before it can make a link.
  await sql`update session set "createdAt" = now() - interval '10 minutes'`.execute(db);
  await page.goto(`${origin}/admin/security`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.getByRole('button', { name: 'Create a link' }).click();

  const link = page.getByRole('textbox', { name: 'Link for the new device' });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const url = await link.inputValue();
  expect(url).toMatch(new RegExp(`^${origin}/add-device\\?context=`));
  const qr = page.getByRole('img', { name: 'QR code for the link' });
  await expect(qr).toBeVisible();
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  await expect(page.getByText(/^Expires at /)).toBeVisible();
  // The screen says it is watching, so a link left on screen does not look stuck.
  await expect(page.getByText('Waiting for the other device…')).toBeVisible();

  // Device B: a browser of its own, with an authenticator of its own.
  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    const cdpB = await contextB.newCDPSession(pageB);
    await cdpB.send('WebAuthn.enable');
    const { authenticatorId: authenticatorB } = await cdpB.send('WebAuthn.addVirtualAuthenticator', { options: AUTHENTICATOR });
    await pageB.goto(url);
    await pageB.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await pageB.getByRole('button', { name: 'Create a passkey' }).click();
    await pageB.waitForURL(`${origin}/admin`, { timeout: 30_000 });
    expect((await cdpB.send('WebAuthn.getCredentials', { authenticatorId: authenticatorB })).credentials, 'B holds the new passkey').toHaveLength(1);

    const passkeys = await db.selectFrom('passkey').select(['id', 'credentialID']).execute();
    expect(passkeys, 'the owner now has two passkeys').toHaveLength(2);
    expect(passkeys.find((row) => row.id === passkeyOfA.id)?.credentialID, "A's passkey is untouched").toBe(passkeyOfA.credentialID);
    expect((await db.selectFrom('session').select('id').execute()).length, 'B has a session of its own').toBeGreaterThanOrEqual(2);
  } finally {
    await contextB.close();
  }

  // The link showing on A is spent. A never lost focus -- the owner was holding the other device --
  // so the screen has to notice by itself: it names the device that came in, marks its row, and
  // takes the link and its QR away.
  await expect(page.locator('.security-link__outcome'), 'said in the card the owner is looking at')
    .toHaveText(/^Added .+\. Its passkey is in the list above\.$/, { timeout: 15_000 });
  await expect(page.locator('.security-key')).toHaveCount(2);
  await expect(page.locator('.security-key--new')).toHaveCount(1);
  await expect(link).toHaveCount(0);
  await expect(qr).toHaveCount(0);

  // A spent link is a dead one: a fresh browser sees the expired message at once, and no button.
  const contextC = await browser.newContext();
  try {
    const pageC = await contextC.newPage();
    await pageC.goto(url);
    await pageC.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await expect(pageC.getByText('This link has expired or was already used.')).toBeVisible();
    await expect(pageC.getByRole('button', { name: 'Create a passkey' })).toHaveCount(0);
  } finally {
    await contextC.close();
  }

  // A second link. A device that already holds this site's passkey (A itself) is told so,
  // and the link stays good.
  // A's clock runs a quarter of an hour fast from here: the screen counts the time the server
  // gives it, so the link stays up instead of expiring the moment it appears.
  await page.clock.setFixedTime(new Date(Date.now() + 15 * 60_000));
  await page.getByRole('button', { name: 'Create a link' }).click();
  await expect(link).toBeVisible({ timeout: 30_000 });
  const second = await link.inputValue();
  expect(second).not.toBe(url);
  // Virtual authenticators belong to one tab, so the new tab gets a copy of A's, credential included.
  const sameDevice = await context.newPage();
  const cdpSame = await context.newCDPSession(sameDevice);
  await cdpSame.send('WebAuthn.enable');
  const { authenticatorId: authenticatorSame } = await cdpSame.send('WebAuthn.addVirtualAuthenticator', { options: AUTHENTICATOR });
  const { credentials } = await cdpA.send('WebAuthn.getCredentials', { authenticatorId: authenticatorA });
  expect(credentials, 'A holds its passkey').toHaveLength(1);
  await cdpSame.send('WebAuthn.addCredential', { authenticatorId: authenticatorSame, credential: credentials[0] });
  await sameDevice.goto(second);
  await sameDevice.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await sameDevice.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(sameDevice.getByText('This device can already sign in with a passkey.')).toBeVisible({ timeout: 30_000 });
  await expect(sameDevice.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await sameDevice.close();

  // Cancelling takes the link and the QR away, and the link stops working.
  await page.getByRole('button', { name: 'Cancel link' }).click();
  await expect(link).toHaveCount(0);
  await expect(qr).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create a link' })).toBeVisible();
  const contextD = await browser.newContext();
  try {
    const pageD = await contextD.newPage();
    await pageD.goto(second);
    await pageD.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await expect(pageD.getByText('This link has expired or was already used.')).toBeVisible();
    await expect(pageD.getByRole('button', { name: 'Create a passkey' })).toHaveCount(0);
  } finally {
    await contextD.close();
  }
  expect((await db.selectFrom('passkey').select('id').execute()).length, 'no further passkey was added').toBe(2);

  // Last, because issuing a recovery ends the owner's sessions. A recovery context is accepted by
  // the same registration, so this page must refuse it on sight: finishing it would replace every
  // passkey.
  const recovery = await issueRecoveryEnrollment(settings!.owner_id);
  const contextE = await browser.newContext();
  try {
    const pageE = await contextE.newPage();
    await pageE.goto(`${origin}/add-device?context=${encodeURIComponent(recovery.context)}`);
    await pageE.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await expect(pageE.getByText('This link has expired or was already used.')).toBeVisible();
    await expect(pageE.getByRole('button', { name: 'Create a passkey' })).toHaveCount(0);
  } finally {
    await contextE.close();
  }
});

test('a link that dies while the passkey is being made shows the expired message', async ({ browser }) => {
  test.setTimeout(120_000);
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { cancelDeviceEnrollments, issueDeviceEnrollment } = await import('../../src/server/auth/device-link');
  const { db } = await import('../../src/server/db/client');
  const settings = await getSiteSettings();
  const ownerId = settings!.owner_id;
  const ownerPasskeys = async () => (await db.selectFrom('passkey').select('id').where('userId', '=', ownerId).execute()).length;
  const passkeysBefore = await ownerPasskeys();
  const { context: linkContext } = await issueDeviceEnrollment(ownerId);

  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    const cdpB = await contextB.newCDPSession(pageB);
    await cdpB.send('WebAuthn.enable');
    await cdpB.send('WebAuthn.addVirtualAuthenticator', { options: AUTHENTICATOR });
    // The options were handed out while the link was good; it is cancelled before the browser's
    // answer reaches the server, as when the owner cancels it on the other device mid-way.
    await pageB.route('**/api/auth/passkey/verify-registration', async (route) => {
      await cancelDeviceEnrollments(ownerId);
      await route.continue();
    });
    await pageB.goto(`${origin}/add-device?context=${encodeURIComponent(linkContext)}`);
    await pageB.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await pageB.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(pageB.getByText('This link has expired or was already used.')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByRole('button', { name: 'Create a passkey' })).toHaveCount(0);
  } finally {
    await contextB.close();
  }
  expect(await ownerPasskeys(), 'the dead link added no passkey').toBe(passkeysBefore);
});
