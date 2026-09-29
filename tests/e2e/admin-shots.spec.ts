import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { expect, test } from './own-worker';

/**
 * Shoots every admin screen at three widths in both themes, and measures the few
 * boxes the editorial refresh makes claims about. Run by hand around a layer:
 *
 *   ADMIN_SHOTS=before npm run test:e2e -- tests/e2e/admin-shots.spec.ts --project=desktop
 *
 * Writes to .superpowers/admin-shots/<label>/ (git-ignored): Playwright empties test-results/
 * at the start of every run, so nothing written there survives the next one.
 *
 * Without ADMIN_SHOTS it skips, so the suite never pays for it. It signs in once:
 * /recovery allows five sign-ins per file, and one is all this needs.
 */

test.use({ stack: 'admin-shots' });
test.skip(!process.env.ADMIN_SHOTS, 'Set ADMIN_SHOTS=<label> to write screenshots.');
test.skip(({ isMobile }) => Boolean(isMobile), 'Widths are set by hand below.');

// Unset, the file is skipped above, but it is still loaded: join() must not see undefined.
const LABEL = process.env.ADMIN_SHOTS ?? 'unset';
const OUT = join('.superpowers', 'admin-shots', LABEL);
const PROJECT = 'tomecms-shots-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'admin-shots-secret-at-least-32-chars-x';
const WIDTHS = [1440, 768, 375] as const;
const SCREENS: ReadonlyArray<readonly [name: string, path: string]> = [
  ['posts', '/admin'], ['pages', '/admin/pages'], ['categories', '/admin/categories'],
  ['media', '/admin/media'], ['navigation', '/admin/navigation'], ['slides', '/admin/slides'],
  ['redirects', '/admin/redirects'], ['stats', '/admin/stats'], ['profile', '/admin/profile'],
  ['security', '/admin/security'], ['settings', '/admin/settings'], ['maintenance', '/admin/maintenance'],
  ['themes', '/admin/themes'], ['plugins', '/admin/plugins'], ['system', '/admin/system'],
];

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-admin-shots',
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
    values ('shots-owner', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'shots-owner', 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values ('shots-owner', 'Uncategorized', true)`.execute(db);
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Shots server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Shots server never became ready.\n${output}`);
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

test('every admin screen, three widths, both themes', async ({ context, page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const settings = await getSiteSettings();
  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });

  // One draft post and one draft page, through the editors, so the lists have a card and a
  // row to show as well as their empty states (shot first, before these exist).
  const empties: Array<readonly [string, string]> = [['posts-empty', '/admin'], ['pages-empty', '/admin/pages']];
  const measure: Record<string, unknown> = {};
  // One readiness rule for the shots and the measurements, so they cannot drift apart.
  const open = async (path: string) => {
    await page.goto(`${origin}${path}`);
    await page.locator('.admin-page, .media-shell, .security-page').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
  };
  const shoot = async (name: string, path: string) => {
    for (const width of WIDTHS) {
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 1000 });
        await open(path);
        await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}.png`), fullPage: true });
      }
    }
    // Measured at 1440 light, where the claims are made.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(path);
    measure[name] = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const { top, left, width, height } = element.getBoundingClientRect();
        return { top: Math.round(top), left: Math.round(left), width: Math.round(width), height: Math.round(height) };
      };
      return {
        title: box('.admin-page__head h1'),
        titleFont: getComputedStyle(document.querySelector('.admin-page__head h1') ?? document.body).font,
        sidebar: box('.admin-sidebar'),
        siteName: box('.admin-shell-site__name'),
        active: box('.admin-sidebar nav a[aria-current="page"]'),
        topbar: box('.admin-topbar'),
        firstCard: box('.admin-card'),
        saveBar: box('.admin-save-bar'),
        empty: box('.admin-empty'),
        figure: box('.stats-summary__value'),
      };
    });
  };
  for (const [name, path] of empties) await shoot(name, path);

  const created = (url: string) => page.waitForResponse((r) => r.url().endsWith(url) && r.request().method() === 'POST' && r.ok());
  const postSaved = created('/api/admin/posts');
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').fill('Notes from a quiet workshop');
  await page.locator('.ProseMirror').first().fill('Six posts in, and the desk still fits in one corner of the room.');
  await postSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  const pageSaved = created('/api/admin/pages');
  await page.goto(`${origin}/admin/pages/new`);
  await page.locator('textarea.admin-title-input').fill('About');
  await page.locator('.ProseMirror').first().fill('A small studio, writing in two languages.');
  await pageSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });

  for (const [name, path] of SCREENS) await shoot(name, path);
  writeFileSync(join(OUT, 'measure.json'), JSON.stringify(measure, null, 2));
  expect(Object.keys(measure).length).toBe(SCREENS.length + empties.length);
});
