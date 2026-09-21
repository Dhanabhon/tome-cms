import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * What a plugin adds to a public page, measured in the reader's browser.
 *
 * Two plugins now reach a page nobody has signed in to: an announcement bar the owner
 * writes, and a lightbox that opens an article's images. The questions worth asking are
 * about what is actually served -- that a plugin switched off ships none of its code, that
 * one that only belongs on an article is not fetched on the homepage, and that a link typed
 * into a settings field cannot turn into `javascript:` on every page of the site.
 *
 * The rows are written with psql rather than `writePluginSettings`: a second connection pool
 * inside the Playwright worker, alongside the dev server's own, hung this suite for its full
 * timeout. The write path has its own coverage in tests/integration/plugin-settings.test.ts,
 * and this file is about the page.
 */

test.use({ stack: 'public-plugins' });

const PROJECT = 'tomecms-public-plugins';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'public-plugins-secret-at-least-32-ch!';
const OWNER = 'public-plugins-owner';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-public-plugins',
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
      values (true, '${OWNER}', 'Plugin Test', 'en', 'UTC', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);
    insert into post_translation_groups (owner_id) values ('${OWNER}');
    insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select g.id, c.id, '${OWNER}' from post_translation_groups g, categories c;
    insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
      select g.id, 'en', 'An article', 'an-article', '{"type":"doc","content":[]}'::jsonb,
        '<p><img src="/x.webp" alt="In the body"></p>', 'published', now(), '${OWNER}' from post_translation_groups g;
    insert into media_items (owner_id, folder_id, object_key, original_name, mime_type, size_bytes,
        width, height, checksum_sha256, alt_text, state)
      values ('${OWNER}', null, 'seed/cover.webp', 'cover.webp', 'image/webp', 1000, 1600, 900,
        '${'a'.repeat(43)}=', '', 'ready');
    update posts set cover_media_id = (select id from media_items limit 1);`);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Plugin test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Plugin test server never became ready.\n${output}`);
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

test('a public page carries only the plugins that asked to be on it', async ({ page }) => {
  test.setTimeout(180_000);

  /** Every script the page asked the network for, which is the only honest answer to "does
   *  this ship?" -- a chunk that is never requested is a chunk the reader never pays for. */
  const visit = async (path: string) => {
    const asked: string[] = [];
    const listen = (request: { resourceType: () => string; url: () => string }) => {
      if (request.resourceType() === 'script') asked.push(request.url());
    };
    page.on('request', listen);
    await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
    page.off('request', listen);
    return {
      asked,
      lightbox: asked.some((url) => url.includes('lightbox')),
      notice: asked.some((url) => url.includes('notice')),
    };
  };

  const band = page.locator('[data-site-notice]');

  const off = await visit('/en');
  await expect(band).toHaveCount(0);
  expect(off.notice, 'a plugin that is off ships nothing').toBe(false);
  expect(off.lightbox, 'a plugin that is off ships nothing').toBe(false);

  // A link the owner typed, of the one shape that would run as code on every page.
  setPlugin('notice', true, {
    textEn: 'We are adding features. Expect the occasional glitch.',
    textTh: 'กำลังเพิ่มฟีเจอร์อยู่ อาจมีสะดุดบ้าง',
    linkHref: 'javascript:alert(1)',
    linkLabel: 'More',
  });

  const refused = await visit('/en');
  await expect(band).toHaveText(/Expect the occasional glitch/);
  await expect(band.locator('a'), 'a javascript: link is dropped, the message is not')
    .toHaveCount(0);
  expect(refused.notice, 'a band a reader can close brings its code').toBe(true);
  expect(refused.lightbox, 'the other plugin is still off').toBe(false);

  await visit('/th');
  await expect(band).toHaveText(/กำลังเพิ่มฟีเจอร์อยู่/);

  setPlugin('notice', true, {
    textEn: 'We are adding features.',
    textTh: 'กำลังเพิ่มฟีเจอร์อยู่',
    linkHref: '/en/about',
    linkLabel: 'More',
  });
  await visit('/en');
  await expect(band.locator('a')).toHaveAttribute('href', '/en/about');

  setPlugin('lightbox', true, {});

  const home = await visit('/en');
  expect(home.lightbox, 'a homepage of cards has no images to open').toBe(false);

  const article = await visit('/en/blog/an-article');
  expect(article.lightbox, 'an article does').toBe(true);

  // Fetching the chunk is not opening anything. This is the assertion whose absence let a
  // lightbox ship that found no images at all: it read one theme's class names, so the
  // cover -- which lives outside the body in both themes -- was never openable, and on a
  // site whose articles carry no other image nothing was.
  const openable = page.locator('article img[data-lightbox]');
  await expect(openable, 'the cover and the image in the body, and nothing beside them')
    .toHaveCount(2);

  const dialog = page.locator('dialog.lightbox');
  await expect(dialog).toBeHidden();
  await openable.first().click();
  await expect(dialog, 'clicking the cover opens it').toBeVisible();
  await expect(page.locator('.lightbox__image')).toHaveAttribute('src', /\/media\//);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A control only a mouse can reach is half a control.
  await openable.last().focus();
  await page.keyboard.press('Enter');
  await expect(dialog, 'and so does pressing Enter on one').toBeVisible();
  await expect(page.locator('.lightbox__image')).toHaveAttribute('alt', 'In the body');
});

test('the banner is the owner\'s colours, and stays or goes as they said', async ({ page }) => {
  test.setTimeout(120_000);
  const band = page.locator('[data-site-notice]');
  const scripts = async (path: string) => {
    const asked: string[] = [];
    const listen = (request: { resourceType: () => string; url: () => string }) => {
      if (request.resourceType() === 'script') asked.push(request.url());
    };
    page.on('request', listen);
    await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
    page.off('request', listen);
    return asked;
  };

  // Kept up, in the owner's colours.
  setPlugin('notice', true, {
    textEn: 'Maintenance on Sunday.', textTh: 'ปิดปรับปรุงวันอาทิตย์', dismissible: 'off',
    background: '#ffaa00', text: '#1a1a1a',
  });
  const kept = await scripts('/en');
  await expect(band).toHaveText(/Maintenance on Sunday/);
  await expect(band.locator('[data-notice-close]'), 'nothing to close it with').toHaveCount(0);
  expect(kept.some((url) => url.includes('notice')), 'and no script for a band that stays').toBe(false);
  expect(await band.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color];
  }), 'drawn in the colours it was given').toEqual(['rgb(255, 170, 0)', 'rgb(26, 26, 26)']);

  // A row edited by hand never went through the store, so the page checks again before
  // a setting becomes CSS on every page a reader loads.
  setPlugin('notice', true, {
    textEn: 'Maintenance on Sunday.', dismissible: 'off',
    background: 'red;background-image:url(https://evil.invalid/x.png)', text: '#1a1a1a',
  });
  await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
  expect(await band.getAttribute('style'), 'a colour that is not only a colour is not written').toBe(null);

  // Closable: the default, and the one that ships a script.
  setPlugin('notice', true, { textEn: 'We are adding features.', background: '#000000', text: '#ffffff' });
  const closable = await scripts('/en');
  expect(closable.some((url) => url.includes('notice')), 'a band that can be closed brings its script').toBe(true);
  await page.evaluate(() => {
    (window as unknown as { left: Promise<string> }).left = new Promise((resolve) => {
      document.addEventListener('animationstart', (event) => resolve((event as AnimationEvent).animationName), { once: true });
    });
  });
  await band.locator('[data-notice-close]').click();
  expect(await page.evaluate(() => (window as unknown as { left: Promise<string> }).left),
    'it slides away rather than vanishing').toBe('notice-out');
  await expect(band, 'and is gone once it has').toHaveCount(0);

  // Gone once the page has settled is not the same as never shown. The check for "closed
  // before" ran in a module script, which runs after the first paint -- so every load drew
  // the band, then took it away, and a reader refreshing quickly saw it flash each time.
  // Watched from the first frame of the next load, before any of the page's own code.
  await page.addInitScript(() => {
    const seen = { painted: false };
    (window as unknown as { banner: typeof seen }).banner = seen;
    const look = () => {
      const shown = document.querySelector<HTMLElement>('[data-site-notice]');
      if (shown && getComputedStyle(shown).display !== 'none' && shown.getBoundingClientRect().height > 0) {
        seen.painted = true;
      }
      if (document.readyState !== 'complete') requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(band, 'and stays gone for the reader who closed it').toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { banner: { painted: boolean } }).banner.painted),
    'without being drawn first and taken away after').toBe(false);
});

