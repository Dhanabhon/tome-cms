import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from '@playwright/test';

/**
 * Signing in with a Passkey, end to end, against a disposable database.
 *
 * Nothing covered this path before, and on 2026-09-20 that let a sign-in ship that could
 * never succeed: the credential list the server offers was missing the `type` member every
 * WebAuthn descriptor requires, so `navigator.credentials.get()` threw before the ceremony
 * began and the client reported it as "no Passkey was used". Registration was unaffected, so
 * recovery kept working and the installation looked healthy right up until someone signed
 * out. Unit tests, the type checker, the build and the installer acceptance all passed.
 *
 * The only thing that catches that class of fault is using a credential to sign in. This
 * test registers one through the real recovery flow, signs out, and signs back in.
 */

const PROJECT = 'tomecms-signin-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'passkey-sign-in-test-secret-at-least-32';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-passkey-sign-in-test',
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
    values (true, 'signin-test-owner', 'Sign-in Test', 'en', 'UTC', '/admin')`.execute(db);

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
  'Virtual WebAuthn is driven over CDP and covered once, on desktop Chromium.',
);

test('a Passkey registered by recovery can sign its owner back in', async ({ context, page }) => {
  test.setTimeout(120_000);

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const { db } = await import('../../src/server/db/client');
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const settings = await getSiteSettings();
  expect(settings, 'the seeded owner is installed').toBeTruthy();

  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });

  const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials.credentials, 'the authenticator holds the new Passkey').toHaveLength(1);
  expect(await db.selectFrom('session').select('id').execute(), 'registering signed the owner in').toHaveLength(1);

  // The list the sign-in is about to be offered. Every descriptor in it needs `type`, and
  // this one is appended after the options were generated, so nothing else supplies it.
  const options = await (await page.request.get(`${origin}/api/auth/passkey/generate-authenticate-options`)).json();
  expect(options.allowCredentials, 'the sign-in offers the Passkey this installation knows').toEqual([
    expect.objectContaining({ id: credentials.credentials[0].credentialId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), type: 'public-key' }),
  ]);

  await page.getByRole('button', { name: /Sign out/i }).first().click();
  await page.getByRole('button', { name: /Sign out/i }).last().click();
  await expect.poll(async () => (await db.selectFrom('session').select('id').execute()).length, {
    message: 'signing out ends the session',
    timeout: 20_000,
  }).toBe(0);

  await page.goto(`${origin}/admin?signin=1`);
  await page.getByRole('button', { name: /Sign in with a Passkey/i }).click();

  // The whole point: a credential that registered must also be able to authenticate.
  await expect.poll(async () => (await db.selectFrom('session').select('id').execute()).length, {
    message: 'the Passkey signs the owner back in',
    timeout: 30_000,
  }).toBe(1);
  // And the owner lands in the admin rather than back on the form they just used.
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
  await expect(page.locator('.admin-shell')).toBeVisible();

  // And the sign-in is recorded. A Passkey synced through a password manager never moves its
  // signature counter, so this has to come from the verification rather than from a counter.
  const passkey = await db.selectFrom('passkey').select(['last_used_at', 'counter']).executeTakeFirstOrThrow();
  expect(passkey.last_used_at, 'the Passkey is marked used').not.toBeNull();
});
