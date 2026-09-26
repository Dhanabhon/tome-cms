import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

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
      notice: asked.some((url) => url.includes('/plugins/notice/')),
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
  expect(refused.notice, 'the core closes the band, so the plugin ships no code for it').toBe(false);
  await expect(band.locator('[data-notice-close]'), 'and it can still be closed').toHaveCount(1);
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
  expect(kept.some((url) => url.includes('/plugins/notice/')), 'and no plugin code for a band that stays').toBe(false);
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

  // Closable, the default. Closing is the core's, so no plugin code comes with it.
  setPlugin('notice', true, { textEn: 'We are adding features.', background: '#000000', text: '#ffffff' });
  const closable = await scripts('/en');
  expect(closable.some((url) => url.includes('/plugins/notice/')), 'closing is the core’s: the plugin ships no code').toBe(false);
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

test('a Thai address is an address', async ({ page }) => {
  test.setTimeout(120_000);
  // The whole trip a Thai slug makes: stored as Thai, linked as Thai, asked for by a browser
  // that percent-encodes it, decoded by the router, and found by the query.
  const slug = 'เขียน-ไว้-อย่าง-ตั้งใจ';
  psql(`insert into post_translation_groups (id, owner_id) values ('7b0e5f4e-1c1a-4c5e-9f7a-2d7e8b6a1c01', '${OWNER}');
    insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select '7b0e5f4e-1c1a-4c5e-9f7a-2d7e8b6a1c01', c.id, '${OWNER}' from categories c limit 1;
    insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
      values ('7b0e5f4e-1c1a-4c5e-9f7a-2d7e8b6a1c01', 'th', 'เขียนไว้อย่างตั้งใจ', '${slug}',
        '{"type":"doc","content":[]}'::jsonb, '<p>เนื้อหา</p>', 'published', now() - interval '1 minute', '${OWNER}');`);

  const answered = await page.goto(`${origin}/th/blog/${encodeURIComponent(slug)}`);
  expect(answered?.status(), 'the router decodes it and the query finds it').toBe(200);
  await expect(page.locator('h1')).toHaveText('เขียนไว้อย่างตั้งใจ');

  // The homepage links it as Thai, which the browser follows as the same page.
  await page.goto(`${origin}/th`);
  await page.getByRole('link', { name: 'เขียนไว้อย่างตั้งใจ' }).first().click();
  await expect(page.locator('h1')).toHaveText('เขียนไว้อย่างตั้งใจ');

  // A sitemap is read by machines, and the protocol wants its addresses escaped.
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  expect(sitemap, 'the sitemap carries it percent-encoded')
    .toContain(new URL(`/th/blog/${slug}`, origin).pathname);
});

test('an old address sends a reader on, permanently', async ({ page }) => {
  test.setTimeout(120_000);
  const group = '5c1d7a2e-8b3f-4e6a-9d1c-3f2a7b8e9c02';
  psql(`insert into post_translation_groups (id, owner_id) values ('${group}', '${OWNER}');
    insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select '${group}', c.id, '${OWNER}' from categories c limit 1;
    insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id)
      values ('${group}', 'en', 'Renamed once', 'the-old-name', '{"type":"doc","content":[]}'::jsonb,
        '<p>Body</p>', 'published', now() - interval '1 minute', '${OWNER}');
    update posts set slug = 'the-new-name' where slug = 'the-old-name';`);

  // A 301 and not a 302: the move is for good, and a search engine should carry what it
  // knew about the old address over to the new one rather than keep asking.
  const answer = await fetch(`${origin}/en/blog/the-old-name`, { redirect: 'manual' });
  expect(answer.status, 'moved permanently').toBe(301);
  expect(new URL(answer.headers.get('location') ?? '', origin).pathname).toBe('/en/blog/the-new-name');

  const landed = await page.goto(`${origin}/en/blog/the-old-name`);
  expect(landed?.status(), 'and the reader arrives').toBe(200);
  expect(new URL(page.url()).pathname).toBe('/en/blog/the-new-name');
  await expect(page.locator('h1')).toHaveText('Renamed once');

  // An address that never held anything is still simply not found.
  const nothing = await fetch(`${origin}/en/blog/never-was`, { redirect: 'manual' });
  expect(nothing.status, 'no forwarding address is invented').toBe(404);
});

const POPUP = {
  actionEn: 'Claim my savings', actionHref: '/en', declineEn: 'No thanks', finePrintEn: 'Exclusions apply.',
  headingEn: 'Hottest deals', textEn: 'Fifteen percent off your first order.',
};

/**
 * The popup's code wires itself after `goto` and `reload` have returned, and it removes its
 * mount point first, in the same task that adds its listeners and starts its timer. So a test
 * that leaves the page, scrolls or runs the clock waits for the mount to go before it does.
 */
const wired = (page: Page) => expect(page.locator('[data-plugin="popup"]')).toHaveCount(0);

/**
 * Time stands still from before the first load and moves only when a test runs it. A clock
 * that is installed and left running keeps real time, so the delay would start counting at
 * a moment the test does not know. The pause is kept across reloads.
 */
async function stillClock(page: Page) {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 1_000);
}

test('a popup opens when it was told, once, and is remembered', async ({ page }) => {
  test.setTimeout(120_000);
  setPlugin('popup', true, { ...POPUP, delay: '5', trigger: 'delay' });
  const popup = page.getByRole('dialog', { name: 'Hottest deals' });

  await stillClock(page);
  await page.goto(`${origin}/en`);
  await wired(page);
  await expect(page.locator('dialog.site-popup')).toHaveCount(1);
  await expect(popup, 'not at once').toBeHidden();
  await page.clock.runFor(4_000);
  await expect(popup, 'not before its time').toBeHidden();
  await page.clock.runFor(1_500);
  await expect(popup).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('dialog.site-popup') !== null), 'focus is inside it').toBe(true);
  await expect(popup.getByRole('link', { name: 'Claim my savings' })).toHaveAttribute('href', '/en');
  await expect(popup.getByText('Exclusions apply.')).toBeVisible();

  await popup.getByRole('button', { name: 'No thanks' }).click();
  await expect(popup).toBeHidden();
  await page.reload();
  await wired(page);
  await page.clock.runFor(20_000);
  await expect(popup, 'declined is remembered').toBeHidden();

  setPlugin('popup', true, { ...POPUP, delay: '5', headingEn: 'New deals', trigger: 'delay' });
  await page.reload();
  await wired(page);
  await page.clock.runFor(6_000);
  const fresh = page.getByRole('dialog', { name: 'New deals' });
  await expect(fresh, 'a new popup is shown again').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fresh, 'Escape closes it').toBeHidden();
  await page.reload();
  await wired(page);
  await page.clock.runFor(20_000);
  await expect(fresh, 'and closed by Escape is remembered too').toBeHidden();

  // Another page, not the same one with a hash: a hash alone does not load the page again.
  await page.goto(`${origin}/en/blog/an-article#popup-preview`);
  await wired(page);
  await expect(fresh, 'the preview opens it at once, though it was closed').toBeVisible();
  // Selecting its words by dragging out past its edge is not asking for it to go: the click
  // that ends a drag lands on the dialog, which is where a click on the backdrop lands too.
  const words = (await fresh.getByRole('heading', { name: 'New deals' }).boundingBox())!;
  await page.mouse.move(words.x + words.width / 2, words.y + words.height / 2);
  await page.mouse.down();
  await page.mouse.move(4, 4, { steps: 4 });
  await page.mouse.up();
  await expect(fresh, 'a drag from inside the box onto the backdrop leaves it open').toBeVisible();
  await page.mouse.click(4, 4);
  await expect(fresh, 'a click outside closes it').toBeHidden();
});

test('a popup never opens over another dialog', async ({ page }) => {
  test.setTimeout(120_000);
  setPlugin('lightbox', true, {});
  setPlugin('popup', true, { ...POPUP, delay: '5', trigger: 'delay' });
  const popup = page.getByRole('dialog', { name: 'Hottest deals' });
  const viewer = page.locator('dialog.lightbox');

  await stillClock(page);
  await page.goto(`${origin}/en/blog/an-article`);
  await wired(page);
  await expect(viewer, 'the picture viewer is wired too').toHaveCount(1);
  await page.locator('article img[data-lightbox]').first().click();
  await expect(viewer).toBeVisible();
  await page.clock.runFor(6_000);
  await expect(popup, 'its time has come, but a picture is open').toBeHidden();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(popup, 'and it opens once the picture is closed').toBeVisible();
});

test('a popup for a leaving reader, on a mouse and on a phone', async ({ browser, isMobile, page }) => {
  test.skip(isMobile, 'This test builds its own phone context; the mouse half needs a fine pointer.');
  test.setTimeout(120_000);
  setPlugin('popup', true, { ...POPUP, trigger: 'exit' });
  const popup = page.getByRole('dialog', { name: 'Hottest deals' });
  await page.goto(`${origin}/en`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await wired(page);
  await expect(popup).toBeHidden();
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientY: -1, relatedTarget: null })));
  await expect(popup, 'the pointer leaving through the top opens it').toBeVisible();

  const phone = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 740 } });
  try {
    const small = await phone.newPage();
    await small.goto(`${origin}/en/blog/an-article`);
    await wired(small);
    const shown = small.getByRole('dialog', { name: 'Hottest deals' });
    await expect(shown).toBeHidden();
    /** Scrolls to this far from half of the distance there is to scroll, and waits until the
     *  scroll has been told to every listener -- the popup's was added first. */
    const scrollFromHalf = (offset: number) => small.evaluate((by) => new Promise<void>((resolve) => {
      window.addEventListener('scroll', () => requestAnimationFrame(() => resolve()), { once: true });
      window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) / 2 + by);
    }), offset);
    await small.evaluate(() => {
      document.body.append(Object.assign(document.createElement('div'), { style: 'height: 4000px' }));
    });
    await scrollFromHalf(-40);
    await expect(shown, 'short of half of the way down is still reading').toBeHidden();
    await scrollFromHalf(40);
    await expect(shown, 'past half the page opens it on a phone').toBeVisible();
    expect(await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing runs off the side').toBe(true);
    const box = await shown.boundingBox();
    expect(box!.x >= 0 && box!.x + box!.width <= 375, 'the popup fits the phone').toBe(true);
  } finally {
    await phone.close();
  }
});

test('a popup where it was asked for, and none where it is off', async ({ page }) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'script') asked.push(request.url()); });
  const popupCode = () => asked.some((url) => url.includes('popup'));

  // No decline words of its own, so the core's are drawn: in the popup's language.
  setPlugin('popup', true, { ...POPUP, declineEn: '', pages: 'home' });
  await page.goto(`${origin}/en/blog/an-article`);
  await expect(page.locator('dialog.site-popup'), 'home only is not an article').toHaveCount(0);
  await page.goto(`${origin}/en`);
  await wired(page);
  await expect(page.locator('dialog.site-popup')).toHaveCount(1);
  expect(popupCode(), 'on, it brings its code').toBe(true);
  await page.goto(`${origin}/th`);
  await wired(page);
  await expect(page.locator('dialog.site-popup'), 'English words on a Thai page are read as English')
    .toHaveAttribute('lang', 'en');
  await expect(page.locator('.site-popup__decline'), 'and its buttons are English with them, not the page’s Thai')
    .toHaveText('No thanks');
  await expect(page.locator('.site-popup__close button')).toHaveAttribute('aria-label', 'Close this window');

  setPlugin('popup', false, POPUP);
  asked.splice(0);
  await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
  await expect(page.locator('dialog.site-popup'), 'off draws nothing').toHaveCount(0);
  expect(popupCode(), 'and off, it ships none of its code').toBe(false);
});
