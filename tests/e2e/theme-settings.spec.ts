import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * A theme is told how to draw the feed, and the feed is drawn that way.
 *
 * Six posts a load was a constant in the homepage route, with a comment explaining that six
 * ends on a full row at one, two or three cards across -- which is true of paper's grid and
 * means nothing to a one-column list. It is the theme's to say now, and this asks whether
 * saying it changes what a reader is served.
 */

test.use({ stack: 'theme-settings' });

const PROJECT = 'tomecms-theme-settings';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'theme-settings-secret-at-least-32-char';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-theme-settings',
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

  await db.transaction().execute(async (trx) => {
    const category = (await sql<{ id: string }>`insert into categories (owner_id, name, is_default) values ('signin-test-owner', 'Uncategorized', true) returning id`.execute(trx)).rows[0].id;
    for (let n = 0; n < 20; n += 1) {
      const group = (await sql<{ id: string }>`insert into post_translation_groups (owner_id) values ('signin-test-owner') returning id`.execute(trx)).rows[0].id;
      await sql`insert into post_category_assignments (translation_group_id, category_id, owner_id) values (${group}::uuid, ${category}::uuid, 'signin-test-owner')`.execute(trx);
      await sql`insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
        values (${group}::uuid, 'en', ${`Post ${n}`}, ${`post-${n}`}, ${JSON.stringify({ type: 'doc', content: [] })}::jsonb, '<p>x</p>',
          'published', now() - (${n + 1} || ' days')::interval, 'signin-test-owner')`.execute(trx);
    }
  });

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


test.skip(({ isMobile }) => Boolean(isMobile), 'One browser is enough; the authenticator needs Chromium.');

test('what a theme is told is what the feed does', async ({ page }) => {
  test.setTimeout(180_000);
  const { sql: query } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { readThemeSettings, writeThemeSettings } = await import('../../src/server/themes/store');
  await page.setViewportSize({ width: 1440, height: 900 });

  const feed = async () => {
    await page.goto(`${origin}/en`);
    await page.locator('.post-card').first().waitFor();
    return page.evaluate(() => ({
      cards: document.querySelectorAll('.post-card').length,
      // The marker the feed script looks for. Without it there is nothing to wire.
      endless: Boolean(document.querySelector('[data-post-feed]')),
      olderLink: Boolean(document.querySelector('[data-post-next]')),
    }));
  };

  expect(await readThemeSettings('paper'), 'a theme nobody has answered gets what it declared')
    .toEqual({ infiniteScroll: 'on', postsPerLoad: '6' });
  expect(await feed()).toEqual({ cards: 6, endless: true, olderLink: true });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { postsPerLoad: '12' } });
  expect(await feed(), 'the page holds what the theme was told to hold').toEqual({ cards: 12, endless: true, olderLink: true });

  await writeThemeSettings('signin-test-owner', { id: 'paper', values: { infiniteScroll: 'off' } });
  expect(await feed(), 'off leaves the link a reader without JavaScript already follows')
    .toEqual({ cards: 12, endless: false, olderLink: true });
  expect((await readThemeSettings('paper')).postsPerLoad, 'writing one control does not clear the other').toBe('12');

  await expect(
    writeThemeSettings('signin-test-owner', { id: 'paper', values: { postsPerLoad: '7' } }),
    'a value the theme does not offer is refused',
  ).rejects.toThrow(/does not offer/);

  // A row edited by hand, or a release that dropped a choice, must not reach a template.
  await query`update site_settings set theme_settings = '{"paper":{"postsPerLoad":"99"}}'::jsonb`.execute(db);
  expect(await readThemeSettings('paper'), 'a stored value the theme no longer offers is not a value')
    .toEqual({ infiniteScroll: 'on', postsPerLoad: '6' });
});
