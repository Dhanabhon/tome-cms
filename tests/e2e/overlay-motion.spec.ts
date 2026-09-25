import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Every drawer, modal and menu arrives and leaves as motion, and nothing behind it moves.
 *
 * What is measured is what the reader's browser does. As an overlay opens, something is
 * animating on it. As a dialog is asked to close, it is still open, marked as leaving, and its
 * exit is running -- the exit plays while the dialog is in the top layer, which is what lets a
 * browser without `overlay` show it at all. A popover, which the browser closes itself, plays
 * its exit from CSS alone. And no layout shift is recorded while any of it happens.
 *
 * The frames are saved to be looked at: the start, middle and end of each entry and the middle
 * of each exit, paused with the Web Animations API so the picture is the same on every run.
 *
 * Rows are written with psql, as public-plugins.spec.ts explains; the pool opens only to issue
 * the owner's sign-in, as stats.spec.ts does.
 */

test.use({ stack: 'overlay-motion' });

const PROJECT = 'tomecms-overlay-motion';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'overlay-motion-secret-at-least-32-chars';
const OWNER = '4b8e2d1c-6a3f-4e5d-9c7b-1f2e3d4c5b6a';
const GROUP = '5c9f3e2d-7b4a-4f6e-8d8c-2a3b4c5d6e7f';
const PICTURE = '6d0a4f3e-8c5b-4a7f-9e9d-3b4c5d6e7f80';
const MEDIA = 'http://127.0.0.1:59000/tomecms-test-media/';
const WORDS = `<p>${'A paragraph long enough to stand behind a dialog and show that it does not move. '.repeat(8)}</p>`;
const POPUP = {
  actionEn: 'Claim my savings', actionHref: '/en', declineEn: 'No thanks', finePrintEn: 'Exclusions apply.',
  headingEn: 'Hottest deals', textEn: 'Fifteen percent off your first order.', trigger: 'exit',
};

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

async function signIn(context: BrowserContext, page: Page) {
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
}

interface Snapshot {
  at: number;
  closing: boolean;
  durations: number[];
  /** What is animating on the overlay itself or its ::backdrop, not on something inside it. */
  own: string[];
  /** Its pointer-events: a dialog that is leaving takes no more clicks. */
  pointer: string | null;
  properties: string[];
  shown: boolean;
  transform: string | null;
}

/** Where the overlay's two sides were at one moment of its entry, and the window's width. */
interface Edges { left: number; right: number; width: number }

interface Probe {
  arm: (selector: string, hold: boolean) => void;
  log: () => Snapshot[];
  release: (finish: boolean) => void;
  seek: (fraction: number) => void;
  /** Steps the held entry from its start to its end, and says where the overlay's sides were at each step. */
  sweep: (steps: number) => Edges[];
  /** What shifted from that moment on, by the elements that moved. */
  shifts: (from: number) => string[][];
}

declare global {
  interface Window { overlayProbe: Probe }
}

/**
 * Runs in the page before any of its own code. It watches one overlay: each time the overlay
 * is shown, starts leaving or is gone, it notes what is animating on it right then. Held, it
 * also pauses those animations at their start, so the test can place them and take a picture.
 *
 * It is armed through sessionStorage so that a reload is watched from its first line: the
 * popup is opened on a fresh load of its page, and the watch has to be there already. And it
 * keeps every layout shift, whatever its input, for as long as the page lives.
 */
function overlayProbe() {
  const shifts: { at: number; moved: string[] }[] = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & { sources?: { node?: Node | null }[] })[]) {
      shifts.push({
        at: entry.startTime,
        moved: (entry.sources ?? []).map(({ node }) => (node instanceof Element ? `${node.tagName.toLowerCase()}.${node.className}` : String(node?.nodeName))),
      });
    }
  }).observe({ buffered: true, type: 'layout-shift' });

  let watched: { hold: boolean; log: Snapshot[]; selector: string } | null = null;
  let held: Animation[] = [];
  const record = () => {
    if (!watched) return;
    const element = document.querySelector<HTMLElement>(watched.selector);
    const shown = element instanceof HTMLDialogElement ? element.open
      : element?.hasAttribute('popover') ? element.matches(':popover-open')
        : Boolean(element && !element.hidden);
    const closing = Boolean(element?.hasAttribute('data-closing'));
    const last = watched.log.at(-1);
    if (last && last.shown === shown && last.closing === closing) return;
    const animations = element?.getAnimations({ subtree: true }) ?? [];
    // Held only as it arrives and as it starts to leave: whatever is still running once it
    // has gone -- a hover fading on a button that moved away -- is not its exit.
    const moment = (shown && !last?.shown) || closing || (!shown && last?.shown && !last.closing);
    if (watched.hold && moment) {
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = 0;
        held.push(animation);
      }
    }
    const name = (animation: Animation) => {
      const effect = animation.effect as KeyframeEffect | null;
      const property = (animation as CSSTransition).transitionProperty ?? (animation as CSSAnimation).animationName ?? 'script';
      return `${effect?.pseudoElement ?? ''}${property}`;
    };
    watched.log.push({
      at: performance.now(),
      closing,
      durations: animations.map((animation) => Number(animation.effect?.getTiming().duration)),
      own: animations.filter((animation) => (animation.effect as KeyframeEffect | null)?.target === element).map(name),
      pointer: element ? getComputedStyle(element).pointerEvents : null,
      properties: animations.map(name),
      shown,
      transform: element ? getComputedStyle(element).transform : null,
    });
  };
  const arm = (selector: string, hold: boolean) => {
    watched = { hold, log: [], selector };
    held = [];
    record();
  };
  new MutationObserver(record).observe(document, {
    attributeFilter: ['data-closing', 'hidden', 'open'], attributes: true, childList: true, subtree: true,
  });
  // A popover changes no attribute as it opens or closes; `toggle` does not bubble, so it is
  // heard on its way down.
  document.addEventListener('toggle', record, true);
  try {
    const saved = JSON.parse(sessionStorage.getItem('overlay-probe') ?? 'null') as { hold: boolean; selector: string } | null;
    if (saved) arm(saved.selector, saved.hold);
  } catch {
    // A page with no storage is not one this test visits.
  }
  window.overlayProbe = {
    arm: (selector, hold) => {
      sessionStorage.setItem('overlay-probe', JSON.stringify({ hold, selector }));
      arm(selector, hold);
    },
    log: () => watched?.log ?? [],
    release: (finish) => {
      for (const animation of held) {
        if (finish) animation.finish();
        else animation.play();
      }
      held = [];
    },
    seek: (fraction) => {
      for (const animation of held) animation.currentTime = Number(animation.effect?.getTiming().duration) * fraction;
    },
    sweep: (steps) => {
      const element = watched && document.querySelector(watched.selector);
      if (!element) return [];
      const longest = Math.max(...held.map((animation) => Number(animation.effect?.getTiming().duration)));
      return Array.from({ length: steps + 1 }, (_, step) => {
        for (const animation of held) animation.currentTime = (longest * step) / steps;
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, width: document.documentElement.clientWidth };
      });
    },
    shifts: (from) => shifts.filter(({ at }) => at >= from).map(({ moved }) => moved),
  };
}

const log = (page: Page) => page.evaluate(() => window.overlayProbe.log());

/**
 * The page's main content, where the reader was: it must not move for anything over it.
 * Measured against the document rather than the window, so a scroll the test itself made to
 * reach a control is not mistaken for the page moving; and once the fonts are in, so a font
 * arriving late is not either.
 */
const mainBox = (page: Page) => page.locator('main').first().evaluate(async (main) => {
  await document.fonts.ready;
  const box = main.getBoundingClientRect();
  return [box.x + window.scrollX, box.y + window.scrollY, box.width, box.height].map(Math.round);
});

/** A transition of the overlay's own movement or fade, the two things its motion is made of. */
const moves = (property: string) => property === 'opacity' || property === 'transform';

const settle = (overlay: Locator) => overlay.evaluate((element) => Promise.allSettled(
  element.getAnimations({ subtree: true }).map((animation) => animation.finished),
));

interface Surface {
  /** How it is put away; none for a menu that React unmounts at once, which only arrives. */
  close?: () => Promise<unknown>;
  /** The side of the window a drawer is fixed to: nothing may show between the two as it comes in. */
  edge?: 'left' | 'right';
  /** Whose exit to expect: the helper's, played while still open, or the one CSS plays alone. */
  exit?: 'css' | 'helper';
  /** Its way out saves something the page then reports, so the page may change once it has gone. */
  reports?: boolean;
  name: string;
  /** The control that opens it, or what opens it when that is not one click. */
  open: Locator | (() => Promise<unknown>);
  selector: string;
  /** A file name to save its frames under. */
  shots?: string;
}

/** Opens one overlay and closes it again, asking at each step what the reader would see. */
async function exercise(page: Page, { close, edge, exit = 'helper', name, open, reports = false, selector, shots }: Surface) {
  const overlay = page.locator(selector);
  const shoot = (frame: string) => page.screenshot({ path: test.info().outputPath(`${shots}-${frame}.png`) });
  if (typeof open !== 'function') await open.scrollIntoViewIfNeeded();
  const before = await mainBox(page);
  await page.evaluate(([watch, hold]) => window.overlayProbe.arm(watch, hold), [selector, Boolean(shots)] as const);
  if (typeof open === 'function') await open();
  else await open.click();

  await expect.poll(async () => (await log(page)).some((snapshot) => snapshot.shown), `${name} opens`).toBe(true);
  const entry = (await log(page)).find((snapshot) => snapshot.shown)!;
  // On the overlay itself: a button inside it fading its hover is not the overlay arriving.
  expect(entry.own.filter(moves), `${name}: the entry animates\n${JSON.stringify(entry)}`).not.toEqual([]);
  if (shots) {
    await shoot('1-entry-start');
    if (edge) {
      // Frame by frame through the whole entry, overshoot and all: the side it is fixed to
      // never leaves the window's edge, or the page shows through the gap.
      const frames = await page.evaluate((steps) => window.overlayProbe.sweep(steps), 52);
      const gaps = frames.map(({ left, right, width }) => (edge === 'left' ? left : width - right));
      expect(Math.max(...gaps), `${name}: its ${edge} side stays on the window's edge all the way in`).toBeLessThanOrEqual(0.5);
    }
    await page.evaluate(() => window.overlayProbe.seek(0.5));
    await shoot('2-entry-middle');
    expect(await mainBox(page), `${name}: nothing behind it moves as it arrives`).toEqual(before);
    await page.evaluate(() => window.overlayProbe.release(true));
    await shoot('3-entry-end');
  } else {
    await settle(overlay);
    expect(await mainBox(page), `${name}: nothing behind it moves as it arrives`).toEqual(before);
  }
  if (!close) {
    expect(await page.evaluate((from) => window.overlayProbe.shifts(from), entry.at), `${name}: no layout shift`).toEqual([]);
    return entry;
  }

  await close();
  if (exit === 'helper') {
    await expect.poll(async () => (await log(page)).some((snapshot) => snapshot.closing), `${name} is marked as leaving`).toBe(true);
    const leaving = (await log(page)).find((snapshot) => snapshot.closing)!;
    expect(leaving.shown, `${name}: still open while its exit plays`).toBe(true);
    expect(leaving.own.filter(moves), `${name}: the exit animates, on the overlay itself\n${JSON.stringify(leaving)}`).not.toEqual([]);
    expect(leaving.pointer, `${name}: and takes no more clicks while it does`).toBe('none');
  } else {
    await expect.poll(async () => (await log(page)).some((snapshot) => snapshot.at > entry.at && !snapshot.shown), `${name} closes`).toBe(true);
    const snapshots = await log(page);
    const leaving = snapshots.find((snapshot) => snapshot.at > entry.at && !snapshot.shown)!;
    expect(leaving.own.filter(moves), `${name}: the exit animates, on the overlay itself, after the browser has closed it\n${JSON.stringify(snapshots)}`).not.toEqual([]);
  }
  if (shots) {
    await page.evaluate(() => window.overlayProbe.seek(0.5));
    await shoot('4-exit-middle');
    await page.evaluate(() => window.overlayProbe.release(false));
  }
  await expect(overlay, `${name} is gone once its exit is over`).toBeHidden();
  await expect(page.locator(`${selector}[data-closing]`), `${name}: no leaving mark is left behind`).toHaveCount(0);
  if (reports) return entry;
  expect(await mainBox(page), `${name}: nothing behind it moved`).toEqual(before);
  expect(await page.evaluate((from) => window.overlayProbe.shifts(from), entry.at), `${name}: no layout shift`).toEqual([]);
  return entry;
}

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  process.env.TOME_CMS_TEST_ORIGIN = origin;
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
    MEDIA_PUBLIC_URL: MEDIA,
    TOME_CMS_FRONTEND_MODE: 'bundled',
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-overlay-motion',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  psql('drop schema public cascade; create schema public;');

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // A real picture in the store, so the frames show one: a lightbox of a broken image is an
  // empty box, and an empty box says nothing about how it moves.
  const sharp = (await import('sharp')).default;
  const picture = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d9a4"/><stop offset="0.55" stop-color="#8fb9c9"/><stop offset="1" stop-color="#2f5f6e"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#sky)"/><rect y="560" width="1600" height="340" fill="#264653" opacity="0.75"/></svg>`)).webp().toBuffer();
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  await new S3Client({
    credentials: { accessKeyId: 'tomecms_test', secretAccessKey: 'foundation-test-only' },
    endpoint: 'http://127.0.0.1:59000', forcePathStyle: true, region: 'us-east-1',
  }).send(new PutObjectCommand({ Body: picture, Bucket: 'tomecms-test-media', ContentType: 'image/webp', Key: 'seed/lake.webp' }));

  // An installed owner, the picture in their library, and one article that carries it twice:
  // as its cover and in its body.
  psql(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
      values (true, '${OWNER}', 'Overlay Test', 'en', 'UTC', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);
    insert into media_items (id, owner_id, folder_id, object_key, original_name, mime_type, size_bytes,
        width, height, checksum_sha256, alt_text, state)
      values ('${PICTURE}', '${OWNER}', null, 'seed/lake.webp', 'lake.webp', 'image/webp', ${picture.length}, 1600, 900,
        '${'a'.repeat(43)}=', 'A lake at dawn', 'ready');
    insert into post_translation_groups (id, owner_id) values ('${GROUP}', '${OWNER}');
    insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select '${GROUP}', c.id, '${OWNER}' from categories c;
    insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id, cover_media_id)
      values ('${GROUP}', 'en', 'Overlays', 'overlays', '{"type":"doc","content":[]}'::jsonb,
        '${WORDS}<p><img src="${MEDIA}seed/lake.webp" alt="A lake at dawn" width="1600" height="900"></p>${WORDS}',
        'published', now() - interval '1 day', '${OWNER}', '${PICTURE}');`);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Overlay test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Overlay test server never became ready.\n${output}`);
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

// Recovery allows five sign-ins in half an hour, a limit for a person at a keyboard; this file
// signs in more often than that. The limiter has tests of its own.
test.beforeEach(async ({ page }) => {
  psql('delete from security_rate_limits');
  await page.addInitScript(overlayProbe);
});

test('the phone navigation slides in from its edge, and the confirm dialog rises over it', async ({ context, isMobile, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  if (!isMobile) await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(`${origin}/admin`);

  const nav = page.locator('.admin-mobile-nav');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await exercise(page, {
      close: () => nav.locator('[data-nav-close]').click(), edge: 'left', name: 'the phone navigation, by its button',
      open: page.locator('[data-nav-open]'), selector: '.admin-mobile-nav', shots: `phone-navigation-${scheme}`,
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the phone navigation, by Escape',
    open: page.locator('[data-nav-open]'), selector: '.admin-mobile-nav',
  });

  // Signing out asks first, in the dialog every confirmation uses. Only ever answered No.
  await page.locator('[data-nav-open]').click();
  await expect(nav).toBeVisible();
  const confirm = page.locator('.ui-dialog');
  await exercise(page, {
    close: () => confirm.getByRole('button', { name: 'Cancel' }).click(), name: 'the confirm dialog, by Cancel',
    open: nav.locator('[data-sign-out]'), selector: '.ui-dialog', shots: 'confirm-dialog',
  });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the confirm dialog, by Escape',
    open: nav.locator('[data-sign-out]'), selector: '.ui-dialog',
  });
  await expect(page, 'and No is what was answered').toHaveURL(`${origin}/admin`);
  await expect(nav, 'the navigation it was asked from is still open under it').toBeVisible();
});

test('the menu dialog and the file details rise in, and drop away', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);

  await page.goto(`${origin}/admin/navigation`);
  const menu = page.locator('dialog.navigation-dialog');
  await exercise(page, {
    close: () => menu.getByRole('button', { name: 'Cancel' }).click(), name: 'the menu dialog, by Cancel',
    open: page.getByRole('button', { name: /Add item/i }).first(), selector: 'dialog.navigation-dialog', shots: 'menu-dialog',
  });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the menu dialog, by Escape',
    open: page.getByRole('button', { name: /Add item/i }).first(), selector: 'dialog.navigation-dialog',
  });

  await page.goto(`${origin}/admin/media`);
  const details = page.locator('dialog.media-details');
  await exercise(page, {
    close: () => details.getByRole('button', { name: 'Close details' }).click(), name: 'the file details, by their button',
    open: page.getByRole('button', { name: /^lake\.webp,/ }), selector: 'dialog.media-details', shots: 'file-details',
  });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the file details, by Escape',
    open: page.getByRole('button', { name: /^lake\.webp,/ }), selector: 'dialog.media-details',
  });
  await expect(page.getByRole('button', { name: /^lake\.webp,/ }), 'the card that opened them has the focus back').toBeFocused();
});

test('a settings drawer comes in from the right, leaves every way, and a select in it lands at its trigger', async ({ context, isMobile, page }) => {
  test.setTimeout(240_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/slides`);
  const add = page.getByRole('button', { name: 'Add slide' });
  const drawer = page.locator('dialog.admin-editor-settings');

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await exercise(page, {
      close: () => drawer.getByRole('button', { name: 'Close', exact: true }).click(), edge: 'right', name: 'the drawer, by its close button',
      open: add, selector: 'dialog.admin-editor-settings', shots: `drawer-${scheme}`,
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the drawer, by Escape', open: add, selector: 'dialog.admin-editor-settings',
  });
  await exercise(page, {
    close: () => drawer.getByRole('button', { name: 'Cancel', exact: true }).click(), name: 'the drawer, by Cancel',
    open: add, selector: 'dialog.admin-editor-settings',
  });
  // A phone's drawer is the whole width of the screen, so there is no page behind it to click.
  if (!isMobile) {
    await exercise(page, {
      close: () => page.mouse.click(40, 400), name: 'the drawer, by a click on the page behind it',
      open: add, selector: 'dialog.admin-editor-settings',
    });
  }

  // Once it has arrived the drawer holds no transform: one that stayed would be the box a
  // fixed menu inside it is placed against, and every select in it would open in the wrong place.
  await add.click();
  await expect(drawer).toBeVisible();
  await settle(drawer);
  expect(await drawer.evaluate((element) => getComputedStyle(element).transform), 'the drawer ends at no transform').toBe('none');
  const trigger = drawer.locator('#home-slide-align');
  await exercise(page, { name: 'a select in the drawer', open: trigger, selector: '#home-slide-align-listbox', shots: 'select-menu' });
  const [list, button] = await Promise.all([
    page.locator('#home-slide-align-listbox').boundingBox(),
    trigger.boundingBox(),
  ]);
  expect(Math.abs(list!.x - button!.x), 'the list lines up with its trigger').toBeLessThan(1);
  expect(list!.y - (button!.y + button!.height), 'and opens just under it').toBeGreaterThanOrEqual(0);
  expect(list!.y - (button!.y + button!.height), 'and opens just under it').toBeLessThan(8);
  await page.locator('#home-slide-align-listbox').getByRole('option', { name: 'Center' }).click();
  await expect(page.locator('#home-slide-align-listbox')).toBeHidden();

  // The library opened from the drawer, over it.
  const picker = page.locator('dialog.media-picker');
  await exercise(page, {
    close: () => picker.getByRole('button', { exact: true, name: 'Cancel' }).click(), name: 'the picture picker, by Cancel',
    open: drawer.getByRole('button', { name: 'Choose picture' }), selector: 'dialog.media-picker', shots: 'picture-picker',
  });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the picture picker, by Escape',
    open: drawer.getByRole('button', { name: 'Choose picture' }), selector: 'dialog.media-picker',
  });
  await expect(drawer, 'the drawer under it stays open').toBeVisible();

  // Saving is the usual way out of a plugin's set-up, and it leaves the way the others do.
  await page.goto(`${origin}/admin/plugins`);
  const banner = page.locator('.plugin-card', { hasText: 'Sticky Banner' });
  await exercise(page, {
    close: async () => {
      await drawer.getByLabel('Message (English)').fill('Saved from its drawer.');
      await drawer.getByRole('button', { exact: true, name: 'Save' }).click();
    },
    name: 'a plugin set-up, by Save', open: banner.getByRole('button', { name: 'Set up' }), reports: true,
    selector: 'dialog.admin-editor-settings',
  });
  await expect(banner.getByRole('status'), 'and what it saved was saved').toBeVisible();
});

test('the block menu and the slash menu drop in', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/new`);
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await exercise(page, {
    name: 'the block menu', open: page.getByRole('button', { name: /Add block/i }), selector: '.block-insert-menu', shots: 'block-menu',
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('.block-insert-menu')).toHaveCount(0);

  // Typing is what opens it, and the first thing typed marks the post unsaved, which redraws
  // the bar above the editor. So the post is made unsaved first, and only the menu is measured.
  const state = page.locator('.admin-save-state');
  const saved = (await state.textContent()) ?? '';
  await canvas.click();
  await page.keyboard.type('Words ');
  await expect(state).not.toHaveText(saved);
  await exercise(page, {
    name: 'the slash menu', open: () => page.keyboard.type('/'), selector: '.editor-menu[role="listbox"]', shots: 'slash-menu',
  });
  await page.keyboard.press('Escape');
});

/**
 * A fresh load of the article, forgetting the popup was ever closed, and then the reader
 * leaving: a pointer out through the top, or on a phone, reading past half the page. Asked
 * for once the page has settled, so what is measured is the popup and not the page loading.
 */
const leave = (page: Page, isMobile: boolean) => async () => {
  await page.evaluate(() => {
    localStorage.clear();
    window.scrollTo(0, 0);
  });
  await page.reload();
  await expect(page.locator('[data-plugin="popup"]'), 'the popup is wired').toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (isMobile) await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  else await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientY: -1, relatedTarget: null })));
};

test('the popup rises in, and every way out plays its exit and is still remembered', async ({ isMobile, page }) => {
  test.setTimeout(180_000);
  setPlugin('popup', true, POPUP);
  try {
    await page.goto(`${origin}/en/blog/overlays`);
    const popup = page.locator('dialog.site-popup');
    const open = leave(page, isMobile);
    const remembered = () => popup.evaluate((dialog: HTMLDialogElement) => [dialog.returnValue, localStorage.getItem(dialog.dataset.dismissKey!)]);

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await exercise(page, {
        close: () => popup.getByRole('button', { name: 'Close this window' }).click(), name: 'the popup, by its ✕',
        open, selector: 'dialog.site-popup', shots: `popup-${scheme}`,
      });
      expect(await remembered(), 'a form of method dialog still answers with its button, and is remembered').toEqual(['close', '1']);
    }
    await page.emulateMedia({ colorScheme: 'light' });

    await exercise(page, {
      close: () => popup.getByRole('button', { name: 'No thanks' }).click(), name: 'the popup, by No thanks',
      open, selector: 'dialog.site-popup',
    });
    expect(await remembered()).toEqual(['decline', '1']);

    await exercise(page, {
      close: () => page.mouse.click(4, 4), name: 'the popup, by a click outside', open, selector: 'dialog.site-popup',
    });
    expect((await remembered())[1]).toBe('1');

    // A page may hold Escape back only once the reader has done something on it; a click on
    // the words is that something.
    await exercise(page, {
      close: async () => {
        await popup.getByRole('heading', { name: 'Hottest deals' }).click();
        await page.keyboard.press('Escape');
      },
      name: 'the popup, by Escape', open, selector: 'dialog.site-popup',
    });
    expect((await remembered())[1]).toBe('1');

    // A close the helper never hears of -- a script calling close(), as the popup's own button
    // does on its way to another page -- still plays an exit, from CSS alone.
    await exercise(page, {
      close: () => popup.evaluate((dialog: HTMLDialogElement) => dialog.close()), exit: 'css',
      name: 'the popup, closed by a script', open, selector: 'dialog.site-popup',
    });
    expect((await remembered())[1]).toBe('1');
  } finally {
    setPlugin('popup', false, POPUP);
  }
});

test('the lightbox rises in and drops away; the language menu and the theme panel drop in and fade out', async ({ page }) => {
  test.setTimeout(180_000);
  setPlugin('lightbox', true, {});
  await page.goto(`${origin}/en/blog/overlays`);
  const image = page.locator('article img[data-lightbox][alt="A lake at dawn"]').last();
  await image.scrollIntoViewIfNeeded();
  await image.evaluate((element: HTMLImageElement) => element.decode());
  const lightbox = page.locator('dialog.lightbox');
  await exercise(page, {
    close: () => lightbox.getByRole('button', { name: 'Close image' }).click(), name: 'the lightbox, by its button',
    open: image, selector: 'dialog.lightbox', shots: 'lightbox',
  });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the lightbox, by Escape', open: image, selector: 'dialog.lightbox',
  });
  await exercise(page, {
    close: () => page.mouse.click(4, 4), name: 'the lightbox, by a click outside', open: image, selector: 'dialog.lightbox',
  });

  await page.goto(`${origin}/en`);
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), exit: 'css', name: 'the language menu',
    open: page.locator('.language-switcher__trigger'), selector: '#language-switcher-menu', shots: 'language-menu',
  });
  await exercise(page, {
    close: () => page.keyboard.press('Escape'), exit: 'css', name: 'the theme panel',
    open: page.locator('.site-header .ui-theme__trigger'), selector: '#tome-theme-site-panel', shots: 'theme-panel',
  });
});

test('a reader who asked for less motion gets a short fade, and nothing moves', async ({ context, isMobile, page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = (name: string, entry: Snapshot) => {
    expect(entry.transform, `${name}: it opens where it stays`).toBe('none');
    expect(entry.properties.filter((property) => property.endsWith('transform')), `${name}: nothing moves`).toEqual([]);
    expect(Math.max(...entry.durations), `${name}: the fade is short`).toBeLessThanOrEqual(100);
  };

  setPlugin('popup', true, POPUP);
  try {
    await page.goto(`${origin}/en/blog/overlays`);
    const popup = page.locator('dialog.site-popup');
    still('the popup', await exercise(page, {
      close: () => popup.getByRole('button', { name: 'Close this window' }).click(), name: 'the popup, reduced',
      open: leave(page, isMobile), selector: 'dialog.site-popup',
    }));
  } finally {
    setPlugin('popup', false, POPUP);
  }
  await page.goto(`${origin}/en`);
  still('the language menu', await exercise(page, {
    close: () => page.keyboard.press('Escape'), exit: 'css', name: 'the language menu, reduced',
    open: page.locator('.language-switcher__trigger'), selector: '#language-switcher-menu',
  }));

  await signIn(context, page);
  await page.goto(`${origin}/admin/navigation`);
  still('the menu dialog', await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the menu dialog, reduced',
    open: page.getByRole('button', { name: /Add item/i }).first(), selector: 'dialog.navigation-dialog',
  }));
  await page.goto(`${origin}/admin/slides`);
  still('the drawer', await exercise(page, {
    close: () => page.keyboard.press('Escape'), name: 'the drawer, reduced',
    open: page.getByRole('button', { name: 'Add slide' }), selector: 'dialog.admin-editor-settings',
  }));
  expect(await page.locator('dialog.admin-editor-settings').count(), 'and it is gone').toBe(0);
});
