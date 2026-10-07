import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * The installer, for real: an empty database, a passkey made by a virtual authenticator and
 * registered by the server, and the finalize route writing the site. passkey-installer.spec.ts
 * walks the same wizard with every server answer mocked; this one mocks nothing, and then reads
 * back what finalize wrote. Like every spec that owns a stack it has its own compose project and
 * drops the schema first, so it starts from nothing and leaves nothing behind. No /recovery
 * sign-in: the owner is signed in by the installer itself.
 */

test.use({ stack: 'installer-real' });
test.skip(({ isMobile }) => Boolean(isMobile), 'Virtual WebAuthn is driven over CDP and covered once, on desktop Chromium.');

const PROJECT = 'tomecms-installer-real-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'installer-real-secret-at-least-32-chars';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-installer-real',
  };
  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);
  Object.assign(process.env, env);
  // Migrated and nothing else: no owner, no settings, no category. That is what an install starts from.
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Installer server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Installer server never became ready.\n${output}`);
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

test('an empty site is installed through the real routes, and finalize writes the owner, the site, Uncategorized and the recovery codes', async ({ context, page }) => {
  test.setTimeout(180_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { db } = await import('../../src/server/db/client');
  expect(await db.selectFrom('site_settings').select('id').executeTakeFirst(), 'the site starts uninstalled').toBeUndefined();

  // Anything but the installer sends an uninstalled site to it.
  await page.goto(`${origin}/admin`);
  await expect(page).toHaveURL(`${origin}/install`);
  await page.goto(`${origin}/install?lang=en`);
  // All four checks pass against the real database, migrations, storage and origin.
  await expect(page.locator('.installer-check[data-state="ready"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Name your site' }).click();
  await page.getByLabel('Site name').fill('Quiet Notes');
  await page.getByLabel('Tagline').fill('Small things, written down');
  await page.getByLabel('Site description').fill('A notebook kept in public.');
  await page.getByLabel('Admin path').fill('/studio');
  await page.getByRole('button', { name: /Owner identity/ }).click();
  await page.getByLabel('Owner email').fill('Owner@Example.com');
  await page.getByRole('button', { name: /Verify installation token/ }).click();
  await page.getByLabel('Installation token').fill(CREDENTIAL);
  await page.getByRole('button', { name: /Verify token/ }).click();

  const finalized = page.waitForResponse((response) => response.url() === `${origin}/api/install/finalize`);
  await page.getByRole('button', { name: /Create passkey and install/ }).click();
  const response = await finalized;
  expect(response.status()).toBe(201);
  const finalizeBody = response.request().postDataJSON() as Record<string, unknown>;
  expect(finalizeBody).not.toHaveProperty('installationToken');

  // The codes are shown once, on the last step.
  const shown = page.getByLabel('One-time recovery codes');
  await expect(shown).toBeVisible();
  const codes = (await shown.inputValue()).split('\n');
  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(10);

  // What finalize wrote.
  const owner = await db.selectFrom('user').select(['id', 'email', 'role']).executeTakeFirstOrThrow();
  expect(owner).toMatchObject({ email: 'owner@example.com', role: 'owner' });
  expect(await db.selectFrom('user').select('id').execute(), 'one user, the owner').toHaveLength(1);
  expect(await db.selectFrom('passkey').select(['userId', 'name']).execute()).toEqual([{ userId: owner.id, name: 'Primary passkey' }]);
  expect(await db.selectFrom('installation_enrollments').select('consumed_at').where('pending_user_id', '=', owner.id).execute())
    .toEqual([{ consumed_at: expect.any(Date) }]);
  expect(await db.selectFrom('site_settings')
    .select(['owner_id', 'site_name', 'tagline', 'site_description', 'site_description_en', 'site_description_th', 'default_locale', 'timezone', 'admin_path'])
    .executeTakeFirstOrThrow()).toEqual({
    owner_id: owner.id,
    site_name: 'Quiet Notes',
    tagline: 'Small things, written down',
    site_description: 'A notebook kept in public.',
    site_description_en: 'A notebook kept in public.',
    site_description_th: '',
    default_locale: 'en',
    timezone: 'Asia/Bangkok',
    admin_path: '/studio',
  });
  expect(await db.selectFrom('categories').select(['owner_id', 'name', 'slug', 'is_default']).execute())
    .toEqual([{ owner_id: owner.id, name: 'Uncategorized', slug: 'uncategorized', is_default: true }]);
  // Kept hashed: each shown code matches one stored hash, and no code is stored as itself.
  const { hashRecoveryCode } = await import('../../src/server/auth/recovery');
  const stored = await db.selectFrom('recovery_codes').select(['user_id', 'code_hash', 'consumed_at']).execute();
  expect(stored).toHaveLength(10);
  expect(stored.every(({ user_id, consumed_at }) => user_id === owner.id && consumed_at === null)).toBe(true);
  expect(new Set(stored.map(({ code_hash }) => code_hash))).toEqual(new Set(codes.map(hashRecoveryCode)));
  expect(stored.some(({ code_hash }) => codes.includes(code_hash))).toBe(false);

  // A second finalize, with the same signed-in session and context, is refused: the site is installed.
  const again = await page.evaluate(async (body) => {
    const answer = await fetch('/api/install/finalize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: answer.status, body: await answer.json() as Record<string, unknown> };
  }, finalizeBody);
  expect(again).toEqual({ status: 409, body: { error: 'TomeCMS is already installed.' } });
  expect(await db.selectFrom('recovery_codes').select('id').execute(), 'no second set of codes').toHaveLength(10);
  expect(await db.selectFrom('categories').select('id').execute()).toHaveLength(1);

  // The admin opens at the chosen path, signed in.
  await expect(page.getByRole('button', { name: /Continue to Admin/ })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Continue to Admin/ }).click();
  await page.waitForURL(`${origin}/studio`);
  await expect(page.locator('.admin-shell')).toBeVisible();

  // And the codes are not shown again: the installer now sends the owner to the admin.
  await page.goto(`${origin}/install?lang=en`);
  await expect(page).toHaveURL(`${origin}/studio`);
  await expect(page.getByLabel('One-time recovery codes')).toHaveCount(0);
});
