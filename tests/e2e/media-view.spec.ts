import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import type { BrowserContext, JSHandle, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * The File Manager shows its files as a grid or as a list, and remembers which.
 *
 * A row says the file's name and size, shows a rename as the card does, and a picker in List view
 * still hands back the file that was pressed. On a phone nothing runs past the screen.
 */

test.use({ stack: 'media-view' });

const PROJECT = 'tomecms-media-view';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'media-view-secret-at-least-32-chars';
// A media key is filed under its owner's UUID, so the owner has to have one.
const OWNER = '3e5a7b9c-2d4f-4a6b-8c1d-9e0f1a2b3c4d';
/** A name long enough to wrap to a second line on a phone, and to be cut at two on any screen. */
const LONG_NAME = 'A very long file name that goes on and on so that a row has to wrap it onto a second line and then stop.png';
/** Where the screenshots go, when asked for. The suite never writes them. */
const SHOTS = process.env.MEDIA_VIEW_SHOTS;

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('No port available.'));
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  // The browser puts a file straight into the store, which answers only the origin it is told.
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
    MEDIA_PUBLIC_URL: 'http://127.0.0.1:59000/tomecms-test-media/',
    TOME_CMS_FRONTEND_MODE: 'bundled',
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-media-view',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  // A schema of its own, so this never reads or writes whatever the last suite left behind.
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner, without walking the six-step wizard, and the category a post is filed under.
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'View Test', 'en', 'UTC', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`View test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`View test server never became ready.\n${output}`);
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
  'One browser is enough; the virtual authenticator needs Chromium anyway.',
);

/** Signs the owner in through a recovery enrollment, as a new device would. */
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

/** A picture with some colour in it, so a thumbnail is told from an empty box. */
async function picture(from: string, to: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Files put in the library the way an owner does: the File Manager's upload dialog. */
async function uploadToLibrary(page: Page) {
  await page.goto(`${origin}/admin/media`);
  const files = [
    { name: 'Lake.png', mimeType: 'image/png', buffer: await picture('#264653', '#2a9d8f') },
    { name: 'Field.png', mimeType: 'image/png', buffer: await picture('#e9c46a', '#f4a261') },
    { name: LONG_NAME, mimeType: 'image/png', buffer: await picture('#e76f51', '#6d597a') },
    { name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Notes for the week.\n') },
  ];
  await page.locator('.media-upload input[type="file"]').setInputFiles(files);
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await dialog.getByRole('button', { name: `Upload ${files.length} files` }).click();
  for (const row of await dialog.locator('.media-upload-row').all()) {
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

/** Both themes at the width the page is at, written where MEDIA_VIEW_SHOTS says. */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const width = page.viewportSize()!.width;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // The admin's colours ease from one theme to the other; a picture taken mid-way is half of each.
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('the File Manager lists its files as rows, remembers the choice, and a picker still chooses from it', async ({ context, page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(context, page);
  await uploadToLibrary(page);

  const grid = page.getByRole('button', { name: 'Grid', exact: true });
  const list = page.getByRole('button', { name: 'List', exact: true });
  const rows = page.locator('ul.media-list');

  // A grid to begin with.
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(list).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.media-grid')).toBeVisible();
  await shoot(page, 'grid');

  // The list, and still the list after a reload.
  await list.click();
  await expect(list).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toBeVisible();
  await expect(page.locator('.media-grid')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tomecms.media.view'))).toBe('list');

  // A row says its name and its size, and keeps to two lines for a name that is too long.
  const lake = rows.getByRole('button', { name: /^Lake\.png,/ });
  await expect(lake.locator('.media-row__name')).toHaveText('Lake.png');
  await expect(lake.locator('.media-row__meta')).toContainText(/\d+(\.\d)? (B|KB|MB)/);
  await expect(lake.locator('.media-row__meta')).toContainText('PNG');
  await expect(rows.getByRole('button', { name: /^Notes\.txt,/ }).locator('.media-row__tile')).toBeVisible();
  const longName = await rows.getByRole('button', { name: new RegExp(`^${LONG_NAME.replace(/\./g, '\\.')},`) }).locator('.media-row__name').boundingBox();
  expect(longName!.height, 'at most two lines of the name show').toBeLessThanOrEqual(2 * 24);
  await shoot(page, 'list');

  // A rename is on the row at once, from the same state as the card.
  await lake.click();
  const details = page.locator('dialog.media-details');
  await details.getByRole('textbox', { name: 'Name', exact: true }).fill('Morning lake');
  await details.getByRole('button', { name: 'Save' }).click();
  await expect(details.getByRole('button', { name: 'Saved' })).toBeVisible();
  await details.getByRole('button', { name: 'Close details' }).click();
  await expect(details).toBeHidden();
  await expect(rows.getByRole('button', { name: /^Morning lake\.png,/ }).locator('.media-row__name')).toHaveText('Morning lake.png');
  await expect(rows.getByRole('button', { name: /^Lake\.png,/ })).toHaveCount(0);

  // On a phone the tile and the name share a row, what the file is wraps under the name, and
  // nothing runs past the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows).toBeVisible();
  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(overflow.scrollWidth, `no sideways scroll (${overflow.scrollWidth} in ${overflow.innerWidth})`).toBeLessThanOrEqual(overflow.innerWidth);
  const row = rows.getByRole('button', { name: /^Morning lake\.png,/ });
  const tile = (await row.locator('.media-row__tile').boundingBox())!;
  const name = (await row.locator('.media-row__name').boundingBox())!;
  const meta = (await row.locator('.media-row__meta').boundingBox())!;
  expect(name.y, 'the name is level with the tile').toBeLessThan(tile.y + tile.height);
  expect(name.x, 'and beside it').toBeGreaterThanOrEqual(tile.x + tile.width);
  expect(meta.y, 'the details are under the name').toBeGreaterThanOrEqual(name.y + name.height - 1);
  await shoot(page, 'list');
  await page.setViewportSize({ width: 1440, height: 900 });

  // The picker is in the list too, and the row that is pressed is the file that comes back.
  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('A picture from the list');
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await page.getByRole('button', { name: /Add block/i }).click();
  await page.getByRole('menuitem', { name: 'Image', exact: true }).click();
  const picker = page.locator('dialog.media-picker');
  await expect(picker.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('ul.media-list')).toBeVisible();
  await shoot(page, 'picker-list');
  await picker.getByRole('button', { name: /^Select Field\.png,/ }).click();
  await expect(picker).toBeHidden();
  await expect(canvas.locator('img')).toHaveCount(1);
  await expect(canvas.locator('img')).toHaveAttribute('title', 'Field.png');

  // Back to a grid, and the picker follows it.
  await page.goto(`${origin}/admin/media`);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.media-grid')).toBeVisible();
  await expect(page.locator('ul.media-list')).toHaveCount(0);
});

/** A drag built in the page, as the system hands one over: files, or a line of text. */
async function dragData(page: Page, files: { name: string; type: string; base64: string }[], text?: string) {
  return page.evaluateHandle(({ files, text }) => {
    const data = new DataTransfer();
    for (const file of files) data.items.add(new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, { type: file.type }));
    if (text) data.setData('text/plain', text);
    return data;
  }, { files, text });
}

test('files dragged onto the File Manager wait in the upload dialog, then go into the folder that is open', async ({ context, page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(context, page);
  await page.goto(`${origin}/admin/media`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));

  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const named = async (names: string[]) => (await sql<{ folder_id: string | null }>`select folder_id from media_items where original_name = any(${names})`.execute(db)).rows;

  // A folder to drop into, and open.
  await page.getByRole('textbox', { name: 'Folder name' }).fill('Drops');
  await page.getByRole('button', { name: 'Create folder' }).click();
  const folderButton = page.locator('.media-categories nav').getByRole('button', { name: 'Drops', exact: true });
  await folderButton.click();
  await expect(folderButton).toHaveAttribute('aria-pressed', 'true');
  const [{ id: folder }] = (await sql<{ id: string }>`select id from media_folders where name = 'Drops'`.execute(db)).rows;

  const zone = page.locator('.media-files');
  const overlay = page.locator('.media-drop');
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  const one = (await picture('#1d3557', '#457b9d')).toString('base64');
  const two = (await picture('#ffb703', '#fb8500')).toString('base64');
  const images = [{ name: 'Drop one.png', type: 'image/png', base64: one }, { name: 'Drop two.png', type: 'image/png', base64: two }];
  // A folder from the computer, as a browser that cannot open it gives it: empty, with no type.
  const holiday = { name: 'Holiday', type: '', base64: '' };

  // Text dragged within the page is not a file: no overlay.
  const text = await dragData(page, [], 'Just some words');
  await zone.dispatchEvent('dragenter', { dataTransfer: text });
  await zone.dispatchEvent('dragover', { dataTransfer: text });
  await expect(overlay).toHaveCount(0);
  await zone.dispatchEvent('dragleave', { dataTransfer: text });

  // Files say where they will go, and leaving the page or Escape takes that away at once.
  const both = await dragData(page, [...images, holiday]);
  await zone.dispatchEvent('dragenter', { dataTransfer: both });
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText('Drop files to upload them to “Drops”');
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await shoot(page, 'drop-overlay');
  await zone.dispatchEvent('dragleave', { dataTransfer: both });
  await expect(overlay).toHaveCount(0);
  await zone.dispatchEvent('dragenter', { dataTransfer: both });
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  // A folder alone has nothing to upload: a notice, and no dialog.
  const onlyFolder = await dragData(page, [holiday]);
  await zone.dispatchEvent('dragenter', { dataTransfer: onlyFolder });
  await zone.dispatchEvent('drop', { dataTransfer: onlyFolder });
  await expect(page.locator('.media-status[role="status"]')).toHaveText('Folders cannot be uploaded. Drop the files inside them.');
  await expect(dialog).toHaveCount(0);

  // A drop while a confirm is open (deleting the folder) is ignored: no upload dialog on top of it.
  await page.locator('.media-categories nav summary[aria-label="Actions for Drops"]').click();
  await page.locator('.media-categories nav [data-folder-action="delete"]').click();
  const confirm = page.getByRole('dialog', { name: 'Delete folder?' });
  await expect(confirm).toBeVisible();
  await zone.dispatchEvent('dragenter', { dataTransfer: both });
  await expect(overlay).toHaveCount(0);
  await zone.dispatchEvent('drop', { dataTransfer: both });
  await expect(dialog).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);

  // Dropped, the files wait in the upload dialog, filed into the open folder, and nothing is sent yet.
  await zone.dispatchEvent('dragenter', { dataTransfer: both });
  await zone.dispatchEvent('dragover', { dataTransfer: both });
  await zone.dispatchEvent('drop', { dataTransfer: both });
  await expect(overlay).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.media-upload-row__name')).toHaveText(['Drop one.png', 'Drop two.png']);
  await expect(dialog.locator('.media-upload-dialog__note')).toHaveText('1 folder was left out. Only files are uploaded.');
  await expect(dialog.locator('#media-upload-folder')).toHaveAttribute('data-value', folder);
  await expect(dialog.locator('#media-upload-folder')).toHaveText('Drops');
  expect(await named(['Drop one.png', 'Drop two.png'])).toEqual([]);
  await shoot(page, 'drop-dialog');

  // Another drop while the dialog is open changes nothing in it, and shows no overlay.
  const third = await dragData(page, [{ name: 'Drop three.png', type: 'image/png', base64: one }]);
  await zone.dispatchEvent('dragenter', { dataTransfer: third });
  await expect(overlay).toHaveCount(0);
  await zone.dispatchEvent('drop', { dataTransfer: third });
  await expect(dialog.locator('.media-upload-row__name')).toHaveText(['Drop one.png', 'Drop two.png']);

  // The dialog's own button sends them, and both land in the folder.
  await dialog.getByRole('button', { name: 'Upload 2 files' }).click();
  for (const row of await dialog.locator('.media-upload-row').all()) {
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  expect(await named(['Drop one.png', 'Drop two.png'])).toEqual([{ folder_id: folder }, { folder_id: folder }]);
  expect(await named(['Drop three.png'])).toEqual([]);
  await expect(zone.getByRole('button', { name: /^Drop one\.png,/ })).toBeVisible();
  await expect(zone.getByRole('button', { name: /^Drop two\.png,/ })).toBeVisible();
});

test('a file dragged onto the picker goes into the folder it has open, and only the picker takes it', async ({ context, page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(context, page);

  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const named = async (names: string[]) => (await sql<{ folder_id: string | null }>`select folder_id from media_items where original_name = any(${names})`.execute(db)).rows;

  // A folder for the picker to have open.
  await page.goto(`${origin}/admin/media`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.getByRole('textbox', { name: 'Folder name' }).fill('Picked');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.locator('.media-categories nav').getByRole('button', { name: 'Picked', exact: true })).toBeVisible();
  const [{ id: folder }] = (await sql<{ id: string }>`select id from media_folders where name = 'Picked'`.execute(db)).rows;

  // The picker a writer opens for a picture, on the folder.
  await page.goto(`${origin}/admin/new`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.locator('#post-title').fill('A picture dropped on the picker');
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await page.getByRole('button', { name: /Add block/i }).click();
  await page.getByRole('menuitem', { name: 'Image', exact: true }).click();
  const picker = page.locator('dialog.media-picker');
  await expect(picker).toBeVisible();
  const folderButton = picker.locator('.media-categories nav').getByRole('button', { name: 'Picked', exact: true });
  await folderButton.click();
  await expect(folderButton).toHaveAttribute('aria-pressed', 'true');

  const zone = picker.locator('.media-files');
  const overlay = picker.locator('.media-drop');
  const notice = picker.locator('.media-status[role="status"]');
  const one = (await picture('#2b2d42', '#8d99ae')).toString('base64');
  const dropped = { name: 'Picked.png', type: 'image/png', base64: one };
  /**
   * A drag event where a hand would make it: in the middle of the files the picker shows, so the
   * browser's hit lands on the picker's own box rather than its backdrop. Says whether the page
   * held the browser's own handling back, and what the point hit.
   */
  const at = (type: string, data: JSHandle<DataTransfer>) => zone.evaluate((element, { type, data }) => {
    const files = element.getBoundingClientRect();
    const dialog = element.closest('dialog')!.getBoundingClientRect();
    const x = files.left + files.width / 2;
    const y = (Math.max(files.top, dialog.top) + Math.min(files.bottom, dialog.bottom)) / 2;
    const hit = document.elementFromPoint(x, y);
    const held = !element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: data }));
    return { held, inPicker: Boolean(hit && hit !== element.closest('dialog') && element.closest('dialog')!.contains(hit)), onTop: hit?.closest('dialog')?.id ?? '' };
  }, { type, data });

  // The picker's own dialog does not stand in the way: the overlay names the folder it has open.
  const single = await dragData(page, [dropped]);
  expect((await at('dragenter', single)).inPicker, 'the point is on the picker itself').toBe(true);
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText('Drop a file to upload it to “Picked”');
  await zone.dispatchEvent('dragleave', { dataTransfer: single });
  await expect(overlay).toHaveCount(0);

  // Two files: the picker hands back one, so it takes neither and says so.
  const two = await dragData(page, [dropped, { name: 'Picked two.png', type: 'image/png', base64: one }]);
  await zone.dispatchEvent('dragenter', { dataTransfer: two });
  await zone.dispatchEvent('drop', { dataTransfer: two });
  await expect(notice).toHaveText('Drop just one file.');
  await expect(picker).toBeVisible();

  // A PDF on a picker for a picture: refused as the upload button refuses it.
  const pdf = await dragData(page, [{ name: 'Notes.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64') }]);
  await zone.dispatchEvent('dragenter', { dataTransfer: pdf });
  await zone.dispatchEvent('drop', { dataTransfer: pdf });
  await expect(notice).toHaveText('Use a JPEG, PNG, WebP, GIF, or AVIF image.');
  await expect(picker).toBeVisible();
  expect(await named(['Picked.png', 'Picked two.png', 'Notes.pdf'])).toEqual([]);

  // A window opened on top of the picker (as a confirm would be) takes the drop from it: no
  // overlay, and nothing goes up. Were it taken, the picker would close and the file be in twice.
  await page.evaluate(() => {
    const onTop = document.createElement('dialog');
    onTop.id = 'on-top';
    onTop.textContent = 'On top';
    document.body.append(onTop);
    onTop.showModal();
  });
  expect((await at('dragenter', single)).onTop, 'the point is on the window on top').toBe('on-top');
  await expect(overlay).toHaveCount(0);
  await at('drop', single);
  await expect(picker).toBeVisible();
  await page.evaluate(() => {
    const onTop = document.getElementById('on-top') as HTMLDialogElement;
    onTop.close();
    onTop.remove();
  });

  // One picture: up at once into the open folder, and it comes back chosen. The drop is the
  // picker's alone: the browser does not open the file, and the editor behind puts nothing in.
  await at('dragenter', single);
  const { held, inPicker } = await at('drop', single);
  expect(inPicker, 'dropped on the picker itself').toBe(true);
  expect(held, 'the browser does not open the dropped file').toBe(true);
  await expect(picker).toBeHidden({ timeout: 30_000 });
  await expect(canvas.locator('img')).toHaveCount(1);
  await expect(canvas.locator('img')).toHaveAttribute('title', 'Picked.png');
  expect(await named(['Picked.png'])).toEqual([{ folder_id: folder }]);
  expect(await named(['Picked two.png', 'Notes.pdf'])).toEqual([]);
});
