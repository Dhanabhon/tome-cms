import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';
import { clearPageCache, ownerFrom, signInOwner, type Owner } from './page-cache-reset';

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
let owner: Owner | undefined;
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

// The owner, signed in once, for the writes that clear the page cache: see page-cache-reset.
test.beforeAll(async ({ browser }) => {
  owner = await signInOwner(browser, origin, OWNER);
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
  clearPageCache(owner);

  await page.goto(`${origin}/en`);
  const home = page.locator('header a[href="/en"]').first();
  await expect(home.locator('img.site-brand__logo--light')).toHaveAttribute('src', new RegExp(`${light}$`));
  await expect(home.locator('.site-brand__name'), 'the name beside the logo').toHaveText('Brand Test');
  await expect(home.locator('img.site-brand__logo--light'), 'decoration while the name is there').toHaveAttribute('alt', '');

  await db.updateTable('site_settings').set({ hide_site_name: true }).execute();
  clearPageCache(owner);
  await page.reload();
  await expect(home.locator('.site-brand__name')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Brand Test' }).first(), 'the link keeps a name').toBeVisible();

  await db.updateTable('site_settings').set({ brand_logo_dark: brand({ height: 40, key: dark, mime: 'image/svg+xml', width: 120 }) }).execute();
  clearPageCache(owner);
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
  clearPageCache(owner);
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
  clearPageCache(owner);
  await page.goto(`${origin}/en`);
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', new RegExp(`${icon.png32Key}$`));
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', new RegExp(`${icon.png180Key}$`));
  await expect(page.locator('link[href="/favicon.svg"]')).toHaveCount(0);
  await page.goto(`${origin}/admin`);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
});

test('the owner uploads a logo and an icon, and hides the name behind the logo', async ({ context, page }) => {
  test.setTimeout(120_000);
  const { db } = await import('../../src/server/db/client');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const sharp = (await import('sharp')).default;
  // What the two tests above left on the row is not this test's starting point.
  await db.updateTable('site_settings').set({ brand_icon: null, brand_logo: null, brand_logo_dark: null, hide_site_name: false }).execute();
  clearPageCache(owner);

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const enrollment = await issueRecoveryEnrollment(OWNER);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
  // The enrolment ended the session that clears the page cache: this one does it from now on.
  owner = await ownerFrom(context, origin);

  await page.goto(`${origin}/admin/settings`);
  const hide = page.getByRole('checkbox', { name: 'Hide the site name in the header' });
  await expect(hide, 'nothing to hide the name behind yet').toBeDisabled();

  const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><script>alert(1)</script><rect width="120" height="40" fill="#2e7d5b"/></svg>');
  await page.locator('input[name="brand-logo"]').setInputFiles({ buffer: logo, mimeType: 'image/svg+xml', name: 'logo.svg' });
  const logoField = page.locator('.brand-field[data-kind="logo"]');
  await expect(logoField.locator('[role="status"]')).toHaveText('Saved.');
  await expect(logoField.locator('.brand-preview img').first()).toBeVisible();
  await expect(hide).toBeEnabled();

  // A file field applied on the spot; the form's own save still goes through after it.
  await hide.check();
  // And the press is seen: this server answers in milliseconds, and the button still spins
  // for the admin's minimum rather than for a frame.
  const save = page.getByRole('button', { name: 'Save' });
  await save.evaluate((button) => {
    const log: number[] = [];
    (window as unknown as { busyLog: number[] }).busyLog = log;
    new MutationObserver(() => log.push(performance.now())).observe(button, { attributeFilter: ['aria-busy'], attributes: true });
  });
  await save.click();
  await expect(page.locator('.admin-save-button')).toHaveAttribute('data-state', 'saved');
  const [spinning, stopped] = await page.evaluate(() => (window as unknown as { busyLog: number[] }).busyLog);
  expect((stopped ?? 0) - (spinning ?? 0), 'long enough to be seen').toBeGreaterThanOrEqual(350);

  await page.goto(`${origin}/en`);
  await expect(page.locator('header .site-brand__name')).toHaveCount(0);
  await expect(page.locator('header img.site-brand__logo--light')).toHaveAttribute('alt', 'Brand Test');

  await page.goto(`${origin}/admin/settings`);
  const tiny = await sharp({ create: { background: '#fff', channels: 4, height: 64, width: 64 } }).png().toBuffer();
  await page.locator('input[name="brand-icon"]').setInputFiles({ buffer: tiny, mimeType: 'image/png', name: 'icon.png' });
  await expect(page.locator('.brand-field[data-kind="icon"] [role="alert"]')).toHaveText('An icon must be at least 180 × 180 pixels.');
});

test('keeping the site out of search results marks every public answer, and turning it off unmarks them', async ({ context, page }) => {
  test.setTimeout(120_000);
  const { db } = await import('../../src/server/db/client');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  await db.updateTable('site_settings').set({ hide_from_search: false }).execute();
  clearPageCache(owner);

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const enrollment = await issueRecoveryEnrollment(OWNER);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
  owner = await ownerFrom(context, origin);

  const badge = page.locator('.admin-sidebar .admin-shell-site__search');
  const flip = async (on: boolean) => {
    await page.goto(`${origin}/admin/settings`);
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    const box = page.getByRole('checkbox', { name: 'Keep this site out of search results' });
    await box.setChecked(on);
    await page.getByRole('button', { name: 'Save' }).click();
    // Saving this switch reloads the screen, so the sidebar can say what it now is.
    await expect(badge).toHaveCount(on ? 1 : 0);
  };
  const robotsMeta = page.locator('meta[name="robots"]');

  await flip(true);
  await expect(badge).toHaveText('Hidden from search');
  await expect(badge).toHaveAttribute('href', '/admin/settings');
  const admin = await page.request.get(`${origin}/admin/settings`);
  expect(admin.headers()['x-robots-tag'], 'the admin keeps its own').toBeUndefined();

  for (const state of ['miss', 'hit']) {
    const answer = await page.goto(`${origin}/en`);
    expect(answer?.headers()['x-tome-cache']).toBe(state);
    expect(answer?.headers()['x-robots-tag'], state).toBe('noindex, nofollow');
    await expect(robotsMeta).toHaveAttribute('content', 'noindex, nofollow');
  }
  const robots = await (await page.request.get(`${origin}/robots.txt`)).text();
  expect(robots).toContain('User-agent: *\nAllow: /\n');
  expect(robots).not.toContain('Sitemap:');
  const sitemap = await page.request.get(`${origin}/sitemap.xml`);
  expect(sitemap.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(await sitemap.text()).not.toContain('<url>');
  const api = await page.request.get(`${origin}/api/v1/content/site`);
  expect(api.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(JSON.stringify(await api.json()), 'the switch is the owner\'s, not the API\'s').not.toContain('hide');

  await flip(false);
  const listed = await page.goto(`${origin}/en`);
  expect(listed?.headers()['x-robots-tag']).toBeUndefined();
  await expect(robotsMeta).toHaveAttribute('content', /^index, follow/);
  expect(await (await page.request.get(`${origin}/robots.txt`)).text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
  expect(await (await page.request.get(`${origin}/sitemap.xml`)).text()).toContain('<url>');
});

test('a share image and a description for each language, set in Settings, are what a shared page shows', async ({ context, page }) => {
  test.setTimeout(120_000);
  const { db } = await import('../../src/server/db/client');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const { createPage } = await import('../../src/server/content/pages');
  const sharp = (await import('sharp')).default;
  await db.updateTable('site_settings').set({ brand_share: null, hide_from_search: false }).execute();
  await createPage(OWNER, {
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Who writes here.' }] }] },
    excerpt: '', metaDescription: null, metaTitle: null, slug: 'about-share', status: 'published', title: 'About',
  });
  clearPageCache(owner);
  await page.goto(`${origin}/en/about-share`);
  await expect(page.locator('meta[property="og:image"]'), 'nothing to show yet').toHaveCount(0);

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const enrollment = await issueRecoveryEnrollment(OWNER);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
  owner = await ownerFrom(context, origin);

  await page.goto(`${origin}/admin/settings`);
  const field = page.locator('.brand-field[data-kind="share"]');
  await expect(field.locator('.brand-field__label')).toContainText('Shown when a page without a cover is shared on LINE, Facebook or X. Cropped to 1200 × 630.');
  const input = page.locator('input[name="brand-share"]');
  await input.setInputFiles({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 6"/>'), mimeType: 'image/svg+xml', name: 'share.svg' });
  await expect(field.locator('[role="alert"]')).toHaveText('Use PNG, JPEG or WebP. LINE, Facebook and X do not show SVG.');
  const photo = await sharp({ create: { background: '#2e7d5b', channels: 3, height: 1000, width: 1600 } }).png().toBuffer();
  await input.setInputFiles({ buffer: photo, mimeType: 'image/png', name: 'share.png' });
  await expect(field.locator('[role="status"]')).toHaveText('Saved.');
  await expect(field.locator('.brand-preview img')).toBeVisible();
  const stored = (await db.selectFrom('site_settings').select('brand_share').executeTakeFirstOrThrow()).brand_share as { key: string };

  // Each language has its own description, the site's own language first, saved with the form.
  const descriptions = page.locator('.admin-settings-form textarea');
  expect(await descriptions.evaluateAll((areas) => areas.map((area) => area.getAttribute('name')))).toEqual(['siteDescriptionEn', 'siteDescriptionTh']);
  await page.getByLabel('Site description (English)').fill('Notes on work, in English.');
  await page.getByLabel('Site description (Thai)').fill('บันทึกเรื่องงาน ภาษาไทย');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.admin-save-button')).toHaveAttribute('data-state', 'saved');
  for (const [path, said] of [['/en', 'Notes on work, in English.'], ['/th', 'บันทึกเรื่องงาน ภาษาไทย']]) {
    await page.goto(`${origin}${path}`);
    await expect(page.locator('meta[name="description"]'), path).toHaveAttribute('content', said!);
  }

  for (const path of ['/en/about-share', '/th', '/en']) {
    await page.goto(`${origin}${path}`);
    await expect(page.locator('meta[property="og:image"]'), path).toHaveAttribute('content', new RegExp(`${stored.key}$`));
    await expect(page.locator('meta[property="og:image:width"]'), path).toHaveAttribute('content', '1200');
    await expect(page.locator('meta[property="og:image:height"]'), path).toHaveAttribute('content', '630');
    await expect(page.locator('meta[property="og:image:alt"]'), path).toHaveAttribute('content', 'Brand Test');
    await expect(page.locator('meta[name="twitter:card"]'), path).toHaveAttribute('content', 'summary_large_image');
  }

  // The page also carries the way back to its language's home page; the home page carries none.
  const trails = async () => (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((text) => JSON.parse(text) as { '@type': string; itemListElement?: unknown })
    .filter((data) => data['@type'] === 'BreadcrumbList');
  expect(await trails(), 'the home page').toEqual([]);
  await page.goto(`${origin}/en/about-share`);
  expect(await trails()).toEqual([{
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', item: `${origin}/en`, name: 'Brand Test', position: 1 },
      { '@type': 'ListItem', item: `${origin}/en/about-share`, name: 'About', position: 2 },
    ],
  }]);
});
