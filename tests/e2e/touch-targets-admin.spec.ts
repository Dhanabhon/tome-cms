import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Locator, Page } from '@playwright/test';

import type { EditorNode } from '../../src/types/cms';
import { expect, test } from './own-worker';
import { everyState } from './touch-targets';

/**
 * Every control in the admin is at least 44 × 44 CSS px under a coarse pointer: the fifteen screens
 * admin-shots.spec.ts shoots, the mobile navigation, the post editor and its formatting bar, and the
 * editor's open states -- the image and table bars, the slash menu, the settings drawer, the link
 * dialog, the media picker, a folder's menu and the confirm dialog it opens. On a phone, and again on
 * a tablet held upright (768, the admin's wider layout). Runs on the mobile project (a Pixel 5,
 * hasTouch), where (pointer: coarse) matches at either width; a mouse sees none of the rules this
 * holds to. It signs in once: /recovery allows five sign-ins per spec file.
 */

test.use({ stack: 'touch-admin' });
test.skip(({ isMobile }) => !isMobile, 'Measured on the mobile project, whose pointer is coarse.');

const PROJECT = 'tomecms-touch-admin-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'touch-admin-secret-at-least-32-chars-xy';
const OWNER = 'touch-admin-owner';

const SCREENS: ReadonlyArray<readonly [name: string, path: string]> = [
  ['posts', '/admin'], ['pages', '/admin/pages'], ['categories', '/admin/categories'],
  ['media', '/admin/media'], ['navigation', '/admin/navigation'], ['slides', '/admin/slides'],
  ['redirects', '/admin/redirects'], ['stats', '/admin/stats'], ['profile', '/admin/profile'],
  ['security', '/admin/security'], ['settings', '/admin/settings'], ['maintenance', '/admin/maintenance'],
  ['themes', '/admin/themes'], ['plugins', '/admin/plugins'], ['system', '/admin/system'],
];

// Each entry: a selector and why it may stay under 44 px. Filled from the first run's findings, never guessed.
const ALLOWED: readonly string[] = [
  // A prefixed field's input fills its control inside the 1 px border, so it measures 42; the control
  // around it, 44 tall, and the label around that are what a finger presses, and both focus it.
  '.admin-control--prefixed > input',
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
/** The draft with a picture and a table, and the library folder, the editor's open states need. */
let draftId = '';
let folderId = '';

/** A draft with a picture and a table in it, and a folder in the library, written as the admin would. */
async function seed() {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const [folder] = (await sql<{ id: string }>`insert into media_folders (owner_id, name) values (${OWNER}, 'Workshop')
    returning id`.execute(db)).rows;
  folderId = folder.id;
  // A library row with no object behind it: the browser is handed a picture for it below.
  const [image] = (await sql<{ id: string }>`insert into media_items (owner_id, folder_id, object_key, original_name, mime_type,
      size_bytes, width, height, checksum_sha256, alt_text, state)
    values (${OWNER}, null, 'seed/desk.webp', 'desk.webp', 'image/webp', 1000, 1600, 900, ${`${'a'.repeat(43)}=`}, 'A desk in a corner', 'ready')
    returning id`.execute(db)).rows;
  const paragraph = (text: string): EditorNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const cell = (type: 'tableCell' | 'tableHeader', text: string): EditorNode => ({ type, content: [paragraph(text)] });
  const { createPost } = await import('../../src/server/content/posts');
  const draft = await createPost(OWNER, {
    title: 'A desk, a lamp and a table', slug: 'a-desk-a-lamp-and-a-table', excerpt: '', categoryIds: [], coverMediaId: null,
    metaTitle: null, metaDescription: null, status: 'draft',
    contentJson: { type: 'doc', content: [
      paragraph('The desk still fits in one corner of the room.'),
      { type: 'image', attrs: { src: `/media/${image.id}`, alt: 'A desk in a corner', mediaId: image.id } },
      { type: 'table', content: [
        { type: 'tableRow', content: [cell('tableHeader', 'Tool'), cell('tableHeader', 'Where')] },
        { type: 'tableRow', content: [cell('tableCell', 'Lamp'), cell('tableCell', 'Left')] },
      ] },
      paragraph('Last, a plain paragraph so the post does not end on a table.'),
    ] },
  });
  draftId = draft.id;
}

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-touch-admin',
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
  // Kept out of search results, so every screen's sidebar carries the mark that says so, and it is measured too.
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path, hide_from_search)
    values (true, ${OWNER}, 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin', true)`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);
  await seed();
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Touch server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Touch server never became ready.\n${output}`);
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

// The picture is not in the object store; the media route, and the store's own address, would answer 404.
// Only those two: the admin's own /api/admin/media calls go through.
test.beforeEach(async ({ page }) => {
  const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#8a9b7a"/></svg>';
  await page.route((url) => url.pathname.startsWith('/media/') || url.port === '59000',
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: picture }));
});

/** A tablet held upright: the admin's wider layout, still under a finger. */
const TABLET = { width: 768, height: 1024 } as const;

/** The editor as Tiptap hands it to its element, for a selection no finger can make exactly. */
type EditorElement = HTMLElement & { editor?: {
  commands: { focus(at: 'end'): boolean };
  chain(): { focus(): { setTextSelection(range: { from: number; to: number }): { run(): boolean } } };
} };

/**
 * A dialog rises in as a CSS animation, scaled a little short of its size until it lands, and a box
 * mid-way is a scaled one: it is measured at rest. everyState waits on transitions only.
 */
async function settle(dialog: Locator) {
  await dialog.waitFor({ state: 'visible' });
  await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .map((animation) => animation.finished.catch(() => undefined))));
}

/**
 * The editor's open states, one at a time, on the seeded draft: the image's bar and the picker it
 * opens, the table's bar, the slash menu, the settings drawer, and the link dialog.
 */
async function editorStates(page: Page, measure: (name: string) => Promise<void>) {
  await page.goto(`${origin}/admin/edit/${draftId}`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.waitForLoadState('networkidle');
  const canvas = page.locator('.ProseMirror').first();

  // A press on the picture chooses it, and its bar comes.
  await canvas.locator('img').first().click();
  const imageBar = page.getByRole('group', { name: 'Image', exact: true });
  await imageBar.waitFor({ state: 'visible' });
  await measure('editor, image bar');
  await imageBar.getByRole('button', { name: 'Replace picture' }).click();
  const picker = page.locator('dialog.media-picker');
  await picker.getByRole('button', { name: /^Select desk\.webp,/ }).waitFor({ state: 'visible' });
  await settle(picker);
  await measure('editor, media picker');
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toBeHidden();

  // The caret in a cell brings the table's bar.
  await canvas.locator('td').first().click();
  const tableBar = page.getByRole('group', { name: 'Table', exact: true });
  await tableBar.waitFor({ state: 'visible' });
  await measure('editor, table bar');

  // A slash at the start of a new line at the end. End scrolls rather than moving the caret in Chromium
  // on macOS; the editor's own command does not.
  await canvas.evaluate((element: EditorElement) => element.editor?.commands.focus('end'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const slash = page.locator('.editor-menu[role="listbox"]');
  await slash.waitFor({ state: 'visible' });
  await measure('editor, slash menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await expect(slash).toBeHidden();

  // Words chosen in the first line, and the formatting bar's Link opens the link dialog.
  await canvas.evaluate((element: EditorElement) => element.editor?.chain().focus().setTextSelection({ from: 1, to: 9 }).run());
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Add a link' });
  await settle(linkDialog);
  await measure('editor, link dialog');
  await page.keyboard.press('Escape');
  await expect(linkDialog).toBeHidden();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const drawer = page.locator('dialog.admin-editor-settings');
  await settle(drawer);
  await measure('editor, settings drawer');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
}

/** The library opened on the folder, its menu open, and the confirm dialog its Delete asks with. */
async function folderStates(page: Page, measure: (name: string) => Promise<void>) {
  await page.goto(`${origin}/admin/media?folder=${folderId}`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.waitForLoadState('networkidle');
  const menu = page.locator('details.media-category-menu').filter({ visible: true }).first();
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await measure('media, folder menu');
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.locator('.ui-dialog');
  await settle(confirm);
  await measure('media, confirm dialog');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toBeHidden();
}

test('every admin control is at least 44 × 44 under a coarse pointer', async ({ context, page }) => {
  test.setTimeout(900_000);
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

  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the premise: a coarse pointer').toBe(true);
  await expect(page.locator('.admin-shell-site__search'), 'the search mark, in the sidebar and the drawer').toHaveCount(2);
  const failures: string[] = [];
  let width = 'phone';
  const measure = async (name: string) => {
    for (const line of await everyState(page, ALLOWED)) failures.push(`${width} ${name}: ${line}`);
    if (width !== 'tablet') return;
    const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    if (scroll > inner) failures.push(`${width} ${name}: scrolls sideways, ${scroll} > ${inner}`);
  };

  // One post and one page, through the editors, so the lists have a card, a row and their menus to
  // measure. The post editor is measured as it stands, and again with words chosen, which brings
  // the formatting bar.
  const created = (url: string) => page.waitForResponse((r) => r.url().endsWith(url) && r.request().method() === 'POST' && r.ok());
  const postSaved = created('/api/admin/posts');
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').fill('Notes from a quiet workshop');
  const body = page.locator('.ProseMirror').first();
  await body.fill('The desk still fits in one corner of the room.');
  await postSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await measure('post editor');
  await body.press('ControlOrMeta+a');
  await page.locator('.editor-menu').waitFor({ state: 'visible' });
  await measure('post editor, words chosen');
  // A 44-pixel button is no target when the bar has clipped it: every one of them is on the screen.
  const offscreen = await page.locator('.editor-menu button').evaluateAll((buttons) => buttons
    .filter((button) => { const box = button.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth; })
    .map((button) => button.getAttribute('aria-label')));
  expect(offscreen, 'the formatting bar fits the phone').toEqual([]);
  const pageSaved = created('/api/admin/pages');
  await page.goto(`${origin}/admin/pages/new`);
  await page.locator('textarea.admin-title-input').fill('About');
  await page.locator('.ProseMirror').first().fill('A small studio, writing in two languages.');
  await pageSaved;
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });

  const screens = async () => {
    for (const [name, path] of SCREENS) {
      await page.goto(`${origin}${path}`);
      await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
      await page.waitForLoadState('networkidle');
      await measure(name);
    }
    // The navigation is the same dialog on every screen, so it is opened and measured once. A phone
    // always has its button; a tablet may show the sidebar instead, and then there is no dialog to open.
    const opener = page.locator('[data-nav-open]');
    if (width === 'phone') await expect(opener, 'a phone has the navigation button').toBeVisible();
    if (await opener.isVisible()) {
      await opener.click();
      await page.locator('dialog.admin-mobile-nav[open]').waitFor({ state: 'visible' });
      await measure('navigation menu');
      await page.keyboard.press('Escape');
    }
    await editorStates(page, measure);
    await folderStates(page, measure);
  };
  await screens();

  // A tablet is still a finger, and at 768 the admin lays out wider.
  await page.setViewportSize(TABLET);
  width = 'tablet';
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the premise: a coarse pointer at 768').toBe(true);
  await screens();
  expect(failures, failures.join('\n')).toEqual([]);
});
