import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * A video plays only after a reader presses play, and only ever on YouTube's no-cookie host
 * or Vimeo's do-not-track host. Before that click, the page is a poster and a link: nothing
 * asked for from either provider, no cookie, nothing written to storage.
 */

test.use({ stack: 'video' });

const PROJECT = 'tomecms-video-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'video-block-test-secret-at-least-32ch';
const OWNER = 'video-block-owner';
const POSTER = '7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function psql(statement: string) {
  return docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', statement], 60_000);
}

/** The same row `writePluginSettings` would leave, without opening a pool to leave it. */
function setPlugin(id: string, enabled: boolean, values: Record<string, string>) {
  const settings = JSON.stringify(values).replaceAll("'", "''");
  psql(`insert into plugin_settings (id, owner_id, enabled, settings)
    values ('${id}', '${OWNER}', ${enabled}, '${settings}'::jsonb)
    on conflict (id) do update set enabled = excluded.enabled, settings = excluded.settings, updated_at = now()`);
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
  const serverEnv = {
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-video',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  psql('drop schema public cascade; create schema public;');

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner with one published article, without walking the six-step wizard.
  psql(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
      values (true, '${OWNER}', 'Video Test', 'en', 'UTC', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);`);

  psql(`insert into media_items (id, owner_id, folder_id, object_key, original_name, mime_type, size_bytes, checksum_sha256, width, height, alt_text, state, delete_error_code)
    values ('${POSTER}', '${OWNER}', null, 'owners/${OWNER}/2026/09/${POSTER}.jpg', 'A clip worth watching', 'image/jpeg', 100, '${'A'.repeat(43)}=', 480, 360, null, 'ready', null)`);

  const { prepareEditorContent } = await import('../../src/server/content/editor');
  for (const [slug, attrs] of [
    ['with-a-video', { mediaId: POSTER, provider: 'youtube', start: 30, title: 'A clip worth watching', videoId: 'dQw4w9WgXcQ' }],
    ['with-a-vimeo', { mediaId: null, provider: 'vimeo', start: null, title: '', videoId: '76979871' }],
  ] as const) {
    const { contentHtml, contentJson } = prepareEditorContent({ contentJson: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before the video.' }] },
      { type: 'video', attrs },
    ] } });
    // The category assignment must exist before the post itself: a trigger on posts requires
    // its translation group to already have one. Chaining it as a CTE the final insert
    // selects from (rather than a separate statement afterward) keeps the order the trigger
    // wants and guarantees Postgres actually runs it.
    psql(`with g as (insert into post_translation_groups (owner_id) values ('${OWNER}') returning id),
        a as (insert into post_category_assignments (translation_group_id, category_id, owner_id)
          select g.id, c.id, '${OWNER}' from g, categories c returning translation_group_id)
      insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
      select a.translation_group_id, 'en', 'A post ${slug}', '${slug}', '${JSON.stringify(contentJson).replaceAll("'", "''")}'::jsonb,
        '${contentHtml.replaceAll("'", "''")}', 'published', now(), '${OWNER}' from a`);
  }

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Video test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Video test server never became ready.\n${output}`);
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

const VIDEO_HOSTS = /^https:\/\/([^/]+\.)?(youtube\.com|youtube-nocookie\.com|ytimg\.com|vimeo\.com|vimeocdn\.com)\//;

async function watchOutside(page: Page): Promise<string[]> {
  const outside: string[] = [];
  await page.route(VIDEO_HOSTS, async (route) => {
    outside.push(route.request().url());
    await route.abort();
  });
  return outside;
}

test('a video loads nothing from YouTube until the reader presses play, then plays in place', async ({ page }) => {
  test.setTimeout(120_000);
  const outside = await watchOutside(page);
  await page.goto(`${origin}/en/blog/with-a-video`);
  const link = page.locator('figure.tome-video a.tome-video__play');
  await expect(link).toHaveAttribute('aria-label', 'Play video: A clip worth watching');
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
  await link.scrollIntoViewIfNeeded();
  await expect(link.locator('img')).toHaveJSProperty('complete', true);
  expect(outside, 'nothing reaches a video host before a click').toEqual([]);

  await link.click();
  const player = page.locator('figure.tome-video iframe.tome-video__player');
  await expect(player).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=30');
  await expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await expect(player).toHaveAttribute('title', 'A clip worth watching');
  await expect(player).toBeFocused();
  await expect(page.locator('figure.tome-video a.tome-video__play')).toHaveCount(0);
  expect(await page.evaluate(() => ({ cookies: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ cookies: '', local: [], session: [] });
});

test('a Vimeo clip with no poster is a plain panel, and plays in do-not-track mode', async ({ page }) => {
  test.setTimeout(120_000);
  await watchOutside(page);
  await page.goto(`${origin}/en/blog/with-a-vimeo`);
  const link = page.locator('figure.tome-video a.tome-video__play');
  await expect(link.locator('img')).toHaveCount(0);
  await expect(page.locator('figure.tome-video figcaption')).toHaveText('Vimeo');
  await expect(link).toHaveAttribute('aria-label', 'Play video: Vimeo');
  await link.click();
  await expect(page.locator('iframe.tome-video__player')).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1');
});

test('without JavaScript a video is a link to the clip', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${origin}/en/blog/with-a-video`);
  const link = page.locator('figure.tome-video a.tome-video__play');
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
  await expect(link.locator('.tome-video__title')).toHaveText('A clip worth watching');
  await context.close();
});

test('the lightbox leaves a poster to its video', async ({ page }) => {
  test.setTimeout(120_000);
  setPlugin('lightbox', true, {});
  await watchOutside(page);
  await page.goto(`${origin}/en/blog/with-a-video`);
  await page.locator('figure.tome-video img').click();
  await expect(page.locator('dialog.lightbox[open]')).toHaveCount(0);
  await expect(page.locator('iframe.tome-video__player')).toHaveCount(1);
  setPlugin('lightbox', false, {});
});
