import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * A select opens clear of the dialog it lives in.
 *
 * Both the menu dialog and the editors' drawers are scroll boxes, and the list used to be
 * absolutely positioned inside one -- so a select near the bottom of a dialog had its list
 * cut off at the dialog's edge, and the only way to reach the rest was to scroll the dialog
 * under it. Nothing caught that: the markup was right, the CSS was right on its own, and it
 * is only wrong in a place it happens to be put.
 *
 * So this measures the rendered thing. It opens the list at three window heights, and asks
 * whether the whole of it is on screen and whether its last option can actually be hit.
 */

test.use({ stack: 'select-in-dialog' });

const PROJECT = 'tomecms-select-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'select-in-dialog-secret-at-least-32-ch';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-select-in-dialog',
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
  'One browser is enough to measure a layout; the virtual authenticator needs Chromium anyway.',
);

test('a select opens clear of the dialog it lives in', async ({ context, page }) => {
  test.setTimeout(120_000);
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

  // Tall enough for the list to fit under the trigger, and short enough that it cannot.
  for (const height of [900, 560, 420]) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto(`${origin}/admin/navigation`);
    await page.getByRole('button', { name: /Add item/i }).first().click();
    await page.locator('dialog.navigation-dialog').waitFor({ state: 'visible' });
    await page.locator('#navigation-placement').click();
    await page.locator('.ui-select__menu').waitFor({ state: 'visible' });

    const shown = await page.evaluate(() => {
      const list = document.querySelector('.ui-select__menu') as HTMLElement;
      const box = list.getBoundingClientRect();
      const last = (list.lastElementChild as HTMLElement).getBoundingClientRect();
      // What is painted on top at the last option: if something clipped or covered the
      // list, this point belongs to that instead.
      const onTop = document.elementFromPoint(last.left + 8, last.top + last.height / 2);
      return {
        lastOptionOnTop: Boolean(onTop && list.contains(onTop)),
        whole: Math.round(box.height) >= list.scrollHeight - 1,
        withinWindow: box.top >= 0 && box.bottom <= window.innerHeight,
      };
    });
    expect(shown, `the whole list is reachable at ${height}px tall`).toEqual({
      lastOptionOnTop: true, whole: true, withinWindow: true,
    });

    // Reachable is not the same as usable: the last option has to answer a click.
    await page.locator('.ui-select__option').last().click();
    await expect(page.locator('#navigation-placement .ui-select__label')).toHaveText('Both');
  }
});

test('a switch in Customize saves what it shows', async ({ context, page }) => {
  test.setTimeout(120_000);
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

  const toggle = page.getByRole('checkbox', { name: /Reading progress bar/i });
  const openCustomize = async () => {
    await page.goto(`${origin}/admin/themes`);
    await page.getByRole('button', { name: /^Customize$/ }).first().click();
    await toggle.waitFor({ state: 'visible' });
  };
  // Waiting on the write rather than on a clock: navigating away from a save in flight
  // cancels it, and a test that does that is measuring its own haste.
  const save = async () => {
    const written = page.waitForResponse((response) => response.url().includes('/api/admin/themes')
      && response.request().method() === 'PUT');
    await page.getByRole('button', { name: /^Save$/ }).click();
    expect((await written).ok(), 'the save was accepted').toBe(true);
  };

  await openCustomize();
  await expect(toggle, 'a setting nobody has answered shows its fallback').not.toBeChecked();

  await toggle.check();
  await save();
  await openCustomize();
  await expect(toggle, 'and what was saved is what comes back').toBeChecked();

  // A box that will not come back unticked is a setting the owner cannot turn off, which a
  // switch sending nothing when it is off makes easy to ship.
  await toggle.uncheck();
  await save();
  await openCustomize();
  await expect(toggle, 'unticked is an answer too').not.toBeChecked();
});

test('a drawer slides in, and leaves nothing behind for a menu to be measured against', async ({ context, page }) => {
  test.setTimeout(120_000);
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

  await page.goto(`${origin}/admin/themes`);
  // Armed before the click, so this measures the drawer opening rather than how fast the
  // question was asked afterwards.
  await page.evaluate(() => {
    (window as unknown as { slid: Promise<string> }).slid = new Promise((resolve) => {
      document.addEventListener('animationstart', (event) => {
        resolve((event as AnimationEvent).animationName);
      }, { once: true });
    });
  });
  await page.getByRole('button', { name: /^Customize$/ }).first().click();
  const drawer = page.locator('dialog.admin-editor-settings');
  await drawer.waitFor({ state: 'visible' });

  expect(await page.evaluate(() => (window as unknown as { slid: Promise<string> }).slid),
    'the drawer arrives from the edge it lives on').toBe('drawer-in');

  // The reason it is a keyframe with no fill. A transform that stays is a containing block
  // that stays, and the menus in these drawers are placed against the window so that a
  // panel which scrolls cannot clip them -- which is how they were broken once already.
  const settled = await page.evaluate(async () => {
    const panel = document.querySelector('dialog.admin-editor-settings')!;
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    return getComputedStyle(panel).transform;
  });
  expect(settled, 'and holds no transform once it has arrived').toBe('none');

  // Leaving is a thing a reader watches too, and a panel unmounted the instant it is asked
  // to go gives CSS nothing to play -- which is why closing waits for the exit.
  await page.evaluate(() => {
    (window as unknown as { left: Promise<string> }).left = new Promise((resolve) => {
      document.addEventListener('animationstart', (event) => {
        resolve((event as AnimationEvent).animationName);
      }, { once: true });
    });
  });
  await page.getByRole('button', { name: /Close|ปิด/i }).first().click();
  expect(await page.evaluate(() => (window as unknown as { left: Promise<string> }).left),
    'the drawer leaves the way it arrived').toBe('drawer-out');
  await expect(drawer).toBeHidden();

  // The page behind a panel is a place to click to be done with it.
  await page.getByRole('button', { name: /^Customize$/ }).first().click();
  await drawer.waitFor({ state: 'visible' });
  await page.mouse.click(40, 400);
  await expect(drawer, 'a click on the page behind closes it').toBeHidden();
});

