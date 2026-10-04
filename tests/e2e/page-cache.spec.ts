import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * The public page cache, as a reader and the owner meet it on a running site.
 *
 * A second reader of a page is answered from memory; an edit in the admin shows on the very next
 * request; a scheduled post appears on the home page when its moment comes, though nothing is
 * written then; and a site closed for maintenance stores neither the 503 nor the owner's view.
 * The cache lives in the server's process, so this test changes content only through the app --
 * a write from here, behind its back, is exactly what the cache is allowed not to see.
 */

test.use({ stack: 'page-cache' });
test.skip(({ isMobile }) => Boolean(isMobile), 'One stack, on desktop.');

const PROJECT = 'tomecms-page-cache-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'page-cache-secret-at-least-32-chars-xx';
const OWNER = '8d2b6f14-3c7e-4a95-b1d0-5e9f2a7c4b63';

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

const paragraph = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

let server: ChildProcess | undefined;
let origin = '';
let cachedId = '';
let scheduledId = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  // The test store allows one browser origin. This file uploads nothing, but starts it as the others do.
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
    // The cache stands only in front of the bundled frontend.
    TOME_CMS_FRONTEND_MODE: 'bundled',
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-page-cache',
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
    values (true, ${OWNER}, 'Cache Bakery', 'en', 'UTC', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);
  // Seeded before the server starts, so no page of the app has been drawn, let alone kept, yet.
  const { createPost } = await import('../../src/server/content/posts');
  const fields = { excerpt: '', categoryIds: [], coverMediaId: null, metaTitle: null, metaDescription: null, status: 'published' as const };
  cachedId = (await createPost(OWNER, { ...fields, title: 'Cached bread', slug: 'cached-bread', contentJson: paragraph('A loaf kept warm.'),
    publishedAt: new Date(Date.now() - 86_400_000).toISOString() })).id;
  // Its moment is set for real right before the home page is first read, see the test.
  scheduledId = (await createPost(OWNER, { ...fields, title: 'Scheduled bread', slug: 'scheduled-bread', contentJson: paragraph('A loaf for later.'),
    publishedAt: new Date(Date.now() + 3_600_000).toISOString() })).id;

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Page cache server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Page cache server never became ready.\n${output}`);
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

test('pages come from the cache, an edit shows at once, a scheduled post appears on time, and maintenance stores nothing', async ({ context, page, request }) => {
  test.setTimeout(240_000);
  // `request` carries no session: it is an anonymous reader. `page.request` is the signed-in owner.
  const post = `${origin}/en/blog/cached-bread`;

  // 1. Miss, then hit, for anyone.
  const first = await request.get(post);
  expect(first.headers()['x-tome-cache']).toBe('miss');
  const second = await request.get(post);
  expect(second.headers()['x-tome-cache']).toBe('hit');
  expect(await second.text()).toContain('Cached bread');

  // 2. The owner signs in (one /recovery enrolment) and renames the post through the admin API the editor saves to.
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

  const loaded = await page.request.get(`${origin}/api/admin/posts?id=${cachedId}`);
  expect(loaded.status()).toBe(200);
  const { post: current } = await loaded.json() as { post: { content_json: unknown; slug: string; updated_at: string } };
  const renamed = await page.request.put(`${origin}/api/admin/posts`, {
    headers: { origin },
    data: {
      id: cachedId, title: 'Fresh bread', slug: current.slug, contentJson: current.content_json, excerpt: '',
      categoryIds: [], coverMediaId: null, metaTitle: null, metaDescription: null, status: 'published', updatedAt: current.updated_at,
    },
  });
  expect(renamed.status(), await renamed.text()).toBe(200);
  const after = await request.get(post);
  expect(after.headers()['x-tome-cache']).toBe('miss');
  expect(await after.text()).toContain('Fresh bread');

  // 3. The home page is kept without the scheduled post, and shows it once its moment has passed.
  // The dev server compiles the home route on its first request, which can take longer than the
  // schedule's margin under load: warm it with a search, which is never kept.
  expect((await request.get(`${origin}/en?q=warm`)).status()).toBe(200);
  // Set here, not in the seed, so the sign-in and the warm-up cannot use up its margin.
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`update posts set published_at = now() + interval '45 seconds' where id = ${scheduledId}`.execute(db);
  const before = await request.get(`${origin}/en`);
  expect(before.headers()['x-tome-cache']).toBe('miss');
  expect(await before.text()).not.toContain('Scheduled bread');
  expect((await request.get(`${origin}/en`)).headers()['x-tome-cache'], 'kept until then').toBe('hit');
  await expect.poll(async () => (await request.get(`${origin}/en`)).text(), { timeout: 90_000, intervals: [2_000] }).toContain('Scheduled bread');

  // 4. Maintenance, switched on from its screen: a reader gets 503 and nothing is kept; the owner sees the site.
  await page.goto(`${origin}/admin/maintenance`);
  const closeSwitch = page.getByRole('switch', { name: 'Close the site for maintenance' });
  const status = page.locator('.admin-save-bar p[role="status"]');
  await closeSwitch.click();
  await page.getByRole('button', { name: 'Close the site', exact: true }).click();
  await expect(status).toHaveText('Maintenance is on. Visitors see the maintenance page.');

  const closed = await request.get(post);
  expect(closed.status()).toBe(503);
  expect(closed.headers()['x-tome-cache']).toBeUndefined();
  const ownerView = await page.request.get(post);
  expect(ownerView.status()).toBe(200);
  expect(ownerView.headers()['x-tome-cache']).toBeUndefined();
  expect((await request.get(post)).status(), 'nor the owner’s view, for a reader after them').toBe(503);

  // Open again: the next reader draws the page afresh, and the one after is answered from memory.
  await closeSwitch.click();
  await expect(status).toHaveText('Maintenance is off. The site is open again.');
  const reopened = await request.get(post);
  expect(reopened.status()).toBe(200);
  expect(reopened.headers()['x-tome-cache']).toBe('miss');
  expect((await request.get(post)).headers()['x-tome-cache']).toBe('hit');
});
