import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * The site's own logo, name and icon, as a reader meets them.
 *
 * Measured rather than read from the markup: which of two logos a browser actually shows is a
 * question for the rendered page, and the answer depends on a stylesheet, a data attribute
 * and the system's colour scheme at once.
 */

test.use({ stack: 'site-brand' });

const PROJECT = 'tomecms-site-brand';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'site-brand-secret-at-least-32-chars';
// A UUID, as an installation's owner is: brand files are keyed under it.
const OWNER = '5b0e1f3c-2d4a-4e6b-8c9d-0a1b2c3d4e5f';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-site-brand',
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
    values (true, ${OWNER}, 'Brand Test', 'en', 'UTC', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Brand test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Brand test server never became ready.\n${output}`);
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

test('the header wears the logo, hides the name only behind it, and swaps it in the dark', async ({ page }) => {
  test.setTimeout(120_000);
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { createBrandObjectKey } = await import('../../src/server/media/keys');
  const put = async (body: string) => {
    const key = createBrandObjectKey(OWNER, 'svg');
    await s3.send(new PutObjectCommand({ Body: body, Bucket: s3Bucket, ContentType: 'image/svg+xml', Key: key }));
    return key;
  };
  const light = await put('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#111"/></svg>');
  const dark = await put('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#eee"/></svg>');
  const brand = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
  await db.updateTable('site_settings').set({ brand_logo: brand({ height: 40, key: light, mime: 'image/svg+xml', width: 120 }) }).execute();

  await page.goto(`${origin}/en`);
  const home = page.locator('header a[href="/en"]').first();
  await expect(home.locator('img.site-brand__logo--light')).toHaveAttribute('src', new RegExp(`${light}$`));
  await expect(home.locator('.site-brand__name'), 'the name beside the logo').toHaveText('Brand Test');
  await expect(home.locator('img.site-brand__logo--light'), 'decoration while the name is there').toHaveAttribute('alt', '');

  await db.updateTable('site_settings').set({ hide_site_name: true }).execute();
  await page.reload();
  await expect(home.locator('.site-brand__name')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Brand Test' }).first(), 'the link keeps a name').toBeVisible();

  await db.updateTable('site_settings').set({ brand_logo_dark: brand({ height: 40, key: dark, mime: 'image/svg+xml', width: 120 }) }).execute();
  await page.reload();
  const shown = async () => page.evaluate(() => [...document.querySelectorAll('header img.site-brand__logo')]
    .filter((image) => getComputedStyle(image).display !== 'none').map((image) => image.className));
  expect(await shown()).toEqual(['site-brand__logo site-brand__logo--light']);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect(await shown(), 'the visitor chose dark').toEqual(['site-brand__logo site-brand__logo--dark']);
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await shown(), 'the system is dark').toEqual(['site-brand__logo site-brand__logo--dark']);

  // Without a logo the name comes back, whatever the switch still says.
  await db.updateTable('site_settings').set({ brand_logo: null }).execute();
  await page.reload();
  await expect(home.locator('.site-brand__name')).toHaveText('Brand Test');
});

test('a public page wears the site icon, and the admin keeps TomeCMS\'s', async ({ page }) => {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const icon = {
    png180Key: `owners/${OWNER}/2026/09/${crypto.randomUUID()}.png`,
    png32Key: `owners/${OWNER}/2026/09/${crypto.randomUUID()}.png`,
    svgKey: null,
  };
  await db.updateTable('site_settings').set({ brand_icon: sql`${JSON.stringify(icon)}::jsonb` }).execute();
  await page.goto(`${origin}/en`);
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', new RegExp(`${icon.png32Key}$`));
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', new RegExp(`${icon.png180Key}$`));
  await expect(page.locator('link[href="/favicon.svg"]')).toHaveCount(0);
  await page.goto(`${origin}/admin`);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
});
