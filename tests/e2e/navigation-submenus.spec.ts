import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Sub-items and groups on the Navigation screen.
 *
 * The screen keeps a flat list and the rules in src/lib/navigation-tree.ts keep it one the
 * server accepts; this walks the owner's path through it in a browser: build a header menu with
 * a group, put an item under it, move the group with its item, save, reload, and take the item
 * out again. A group with nothing under it blocks Save, whether the owner emptied it or it was
 * saved that way and lost its sub-item since.
 *
 * NAVIGATION_SHOTS=<dir> writes the screen with a group and its sub-item, light and dark, at
 * 1440 and 390 px. Without it no picture is taken.
 */

test.use({ stack: 'navigation-submenus' });

const PROJECT = 'tomecms-navigation-submenus';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'navigation-submenus-secret-at-least-32';
const SHOTS = process.env.NAVIGATION_SHOTS;

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-navigation-submenus',
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
    values (true, 'signin-test-owner', 'Submenu Test', 'en', 'UTC', '/admin')`.execute(db);
  // A page to add, and a Thai menu whose group lost its only sub-item after it was saved.
  const { createPage } = await import('../../src/server/content/pages');
  await createPage('signin-test-owner', {
    excerpt: '', title: 'About', slug: 'about', metaTitle: null, metaDescription: null, status: 'draft',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'About us.' }] }] },
  });
  const { replaceNavigation } = await import('../../src/server/content/navigation');
  await replaceNavigation('signin-test-owner', { locale: 'th', location: 'header', items: [
    { kind: 'group', label: 'บริษัท', pageId: null, url: null, newTab: false, children: [{ kind: 'custom', label: 'ติดต่อ', pageId: null, url: '/contact', newTab: false }] },
  ] });
  await sql`delete from navigation_items where parent_id is not null`.execute(db);

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
  'One browser walks the screen; the virtual authenticator needs Chromium anyway.',
);

/** The menu as the screen draws it: each label, a sub-item's indented by two spaces. */
async function outline(page: Page) {
  return page.locator('.navigation-item').evaluateAll((rows) => rows.map((row) => {
    const label = row.querySelector<HTMLInputElement>('input.admin-control')!.value;
    return row.getAttribute('data-depth') === '1' ? `  ${label}` : label;
  }));
}

/** Both themes at each width, written where NAVIGATION_SHOTS says. */
async function shoot(page: Page) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // The admin's colours ease from one theme to the other; a picture taken mid-way is half of each.
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/task-3-navigation-${width}-${scheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test('a header item goes under a group, moves with it, saves, and an empty group blocks Save', async ({ context, page }) => {
  test.setTimeout(180_000);
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
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${origin}/admin/navigation`);
  const dialog = page.locator('dialog.navigation-dialog');
  const save = page.getByRole('button', { name: 'Save menu' });
  const emptyGroup = page.getByText('A group needs at least one item under it.');
  const actions = (item: number) => page.getByRole('group', { name: `Actions for item ${item}` });
  const add = async (kind: string, fill?: () => Promise<void>) => {
    await page.getByRole('button', { name: /Add item/i }).first().click();
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('radio', { name: kind }).check();
    await fill?.();
    await dialog.getByRole('button', { name: 'Add to menu' }).click();
    await dialog.waitFor({ state: 'hidden' });
  };

  await add('Home');
  await add('Page');
  await add('Group (no link)', async () => {
    await expect(dialog.locator('#navigation-placement'), 'a group goes in the header only').toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Label' }).fill('Company');
  });
  await expect(emptyGroup, 'the new group has nothing under it yet').toBeVisible();
  await expect(save).toBeDisabled();
  await add('Custom URL', async () => {
    await dialog.getByRole('textbox', { name: 'URL' }).fill('/contact');
    await dialog.getByRole('textbox', { name: 'Label' }).fill('Contact');
  });
  expect(await outline(page)).toEqual(['Home', 'About', 'Company', 'Contact']);
  await expect(save, 'still blocked while the group is empty').toBeDisabled();

  await expect(actions(1).getByRole('button', { name: 'Move under the item above' }), 'the first item has nothing above it').toBeDisabled();
  await expect(actions(3).getByRole('button', { name: 'Move under the item above' }), 'a group is never a sub-item').toBeDisabled();
  await actions(4).getByRole('button', { name: 'Move under the item above' }).click();
  expect(await outline(page)).toEqual(['Home', 'About', 'Company', '  Contact']);
  await expect(page.getByRole('textbox', { name: 'Item 4 label under Company' }), 'a screen reader hears where it sits').toHaveValue('Contact');
  await expect(emptyGroup).toHaveCount(0);
  await expect(save).toBeEnabled();

  // The group moves up past About and takes Contact with it.
  await actions(3).getByRole('button', { name: 'Move up' }).click();
  expect(await outline(page)).toEqual(['Home', 'Company', '  Contact', 'About']);
  await expect(actions(2).getByRole('button', { name: 'Move under the item above' }), 'a parent cannot go under another').toBeDisabled();
  await expect(actions(3).getByRole('button', { name: 'Move up' }), 'a lone sub-item has no sibling to pass').toBeDisabled();

  await save.click();
  await expect(page.locator('.admin-save-button')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect.poll(() => outline(page), { message: 'the tree comes back as it was saved' }).toEqual(['Home', 'Company', '  Contact', 'About']);
  await shoot(page);

  await actions(3).getByRole('button', { name: 'Move out' }).click();
  expect(await outline(page)).toEqual(['Home', 'Company', 'Contact', 'About']);
  await expect(emptyGroup, 'taking out its last item empties the group again').toBeVisible();
  await expect(save).toBeDisabled();

  // A group saved with a sub-item that has since gone says so as soon as its menu opens.
  await page.getByRole('tab', { name: 'ไทย' }).click();
  expect(await outline(page)).toEqual(['บริษัท']);
  await expect(emptyGroup).toBeVisible();
  await expect(save).toBeDisabled();

  // The footer has no sub-items and no groups.
  await page.getByRole('tab', { name: 'English' }).click();
  await page.getByRole('tab', { name: 'Footer' }).click();
  await add('Home');
  await expect(actions(1).getByRole('button'), 'up, down and remove only').toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Move under the item above' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move out' })).toHaveCount(0);
  await page.getByRole('button', { name: /Add item/i }).first().click();
  await dialog.waitFor({ state: 'visible' });
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await expect(dialog.getByRole('radio', { name: 'Group (no link)' })).toHaveCount(0);
});
