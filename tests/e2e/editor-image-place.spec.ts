import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { Editor } from '@tiptap/core';
import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * A picture goes in where the writer is, and the page stays there.
 *
 * Inserting a picture far down a long post scrolled the page back to its top, whichever way the
 * picture came: uploaded in the picker or chosen from the File Manager. So this writes a post
 * long enough to scroll, puts the caret near its end, inserts a picture both ways, and measures
 * where the page is before and after. Replacing a picture is measured the same way.
 */

test.use({ stack: 'editor-image-place' });

const PROJECT = 'tomecms-image-place';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'image-place-secret-at-least-32-chars';
// A media key is filed under its owner's UUID, so the owner has to have one.
const OWNER = '2d4f6a8b-1c3e-4f5a-9b7c-8d9e0f1a2b3c';
/** How far the page may move: a line or two settling, never a jump. */
const HELD = 200;

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-editor-image-place',
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
    values (true, ${OWNER}, 'Image Test', 'en', 'UTC', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Image test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Image test server never became ready.\n${output}`);
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
  'One browser is enough to measure a scroll; the virtual authenticator needs Chromium anyway.',
);

test('a picture goes in far down a long post, and the page stays where it went', async ({ context, page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(context, page);
  await uploadToLibrary(page, ['Harbour.png', 'Meadow.png']);

  for (const [editor, upload] of [['/admin/new', 'Post.png'], ['/admin/pages/new', 'Page.png']] as const) {
    await page.goto(`${origin}${editor}`);
    const canvas = page.locator('.ProseMirror');
    await writeLongPost(canvas);

    // Uploaded in the picker: the file joins the library and its picture goes in.
    await insertNearTheEnd(page, canvas, 'Line 36', 'Line 37', async (picker) => {
      await picker.locator('input[type="file"]').setInputFiles({ name: upload, mimeType: 'image/png', buffer: await picture('#e76f51') });
    });
    // Chosen from the File Manager: a picture already there.
    await insertNearTheEnd(page, canvas, 'Line 33', 'Line 34', async (picker) => {
      await picker.getByRole('button', { name: /^Select Harbour\.png,/ }).click();
    });
    // After the last line, where there is no line to go on in.
    await insertNearTheEnd(page, canvas, 'Line 40', null, async (picker) => {
      await picker.getByRole('button', { name: /^Select Harbour\.png,/ }).click();
    });
  }
});

test('a file put in at the end of a line is not left selected, so the next key does not type over it', async ({ context, page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(context, page);
  await uploadFiles(page, [{ name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Notes for the week.\n') }]);

  await page.goto(`${origin}/admin/new`);
  const canvas = page.locator('.ProseMirror');
  await writeLongPost(canvas);

  // Mid-post, at the end of a line: the card is one block more and the next line is still next.
  const before = await shape(canvas);
  await putFileAtEndOf(page, canvas, 'Line 12');
  const mid = await shape(canvas);
  expect(mid, 'the card, and nothing else').toHaveLength(before.length + 1);
  expect(mid.slice(11, 14).map((block) => block.slice(0, 8)), 'the card sits between the two lines').toEqual(['Line 12:', 'attachme', 'Line 13:']);
  // The caret is on the line after the card, so a key goes there and the card stays.
  await page.keyboard.type('x');
  const typed = await shape(canvas);
  expect(typed.filter((block) => block === 'attachment'), 'the card is still there').toHaveLength(1);
  expect(typed[13], 'the key went in the next line, not over the card').toMatch(/^xLine 13:/);
  expect(typed, 'and nothing else changed').toHaveLength(mid.length);

  // After the last line, where nothing follows: a line is made for the caret.
  await putFileAtEndOf(page, canvas, 'Line 40');
  const last = await shape(canvas);
  expect(last, 'the card, and a line after it').toHaveLength(typed.length + 2);
  expect(last.slice(-2), 'a new empty paragraph follows').toEqual(['attachment', '']);
  await page.keyboard.type('y');
  expect((await shape(canvas)).slice(-2), 'the key went in that line').toEqual(['attachment', 'y']);
});

test('a picture is replaced from the File Manager, one undo puts it back, and the new one is saved', async ({ context, page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(context, page);
  await uploadToLibrary(page, ['Lake.png', 'Field.png']);
  // The file a picture is replaced with has alt text of its own, which a picture with none takes.
  const { db } = await import('../../src/server/db/client');
  await db.updateTable('media_items').set({ alt_text: 'A field at noon' }).where('original_name', '=', 'Field.png').execute();

  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('A replaced picture');
  const canvas = page.locator('.ProseMirror');
  await writeLongPost(canvas);
  await insertNearTheEnd(page, canvas, 'Line 30', 'Line 31', async (picker) => {
    await picker.getByRole('button', { name: /^Select Lake\.png,/ }).click();
  });
  const image = canvas.locator('p:has-text("Line 30:") + img');
  const lake = await image.getAttribute('src');
  expect(lake).toMatch(/^\/media\/[0-9a-f-]{36}$/);
  // The same picture higher up, which a replace further down must leave alone.
  await canvas.evaluate((node, src) => {
    const { editor } = node as unknown as { editor: Editor };
    const afterLineTwo = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    editor.commands.insertContentAt(afterLineTwo, { type: 'image', attrs: { alt: 'Lake.png', src, title: 'Lake.png' } });
  }, lake);
  const higher = canvas.locator('p:has-text("Line 2:") + img');
  await expect(higher).toHaveAttribute('src', lake!);

  // Chosen, the picture has a bar, and the keyboard reaches it from the picture.
  await image.click();
  const replace = page.getByRole('group', { name: 'Image' }).getByRole('button', { name: 'Replace picture' });
  await expect(replace).toBeVisible();
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Tab');
  await expect(replace, 'one Tab from the picture').toBeFocused();
  await page.keyboard.press('Enter');
  const picker = page.locator('dialog.media-picker');
  await expect(picker.getByText('Upload image'), 'the picker offers pictures').toBeVisible();
  await picker.getByRole('button', { name: /^Select Field\.png,/ }).click();
  await expect(picker).toBeHidden();

  const field = await image.getAttribute('src');
  expect(field).toMatch(/^\/media\/[0-9a-f-]{36}$/);
  expect(field, 'the picture is the new file').not.toBe(lake);
  await expect(image).toHaveAttribute('data-media-id', field!.split('/').pop()!);
  await expect(image, 'it takes the new file\'s alt text, not the old one\'s').toHaveAttribute('alt', 'A field at noon');
  await expect(image, 'and takes the new file\'s name').toHaveAttribute('title', 'Field.png');
  await expect(canvas.locator('img'), 'in its place, not as another picture').toHaveCount(2);
  await expect(higher, 'the picture higher up is untouched').toHaveAttribute('src', lake!);
  const held = async () => Math.abs(await page.evaluate(() => window.scrollY) - before);
  expect(await held(), 'the page stayed where it was').toBeLessThanOrEqual(HELD);

  // One undo, and the old picture is back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveAttribute('src', lake!);
  await expect(image).toHaveAttribute('data-media-id', lake!.split('/').pop()!);
  await expect(image).toHaveAttribute('title', 'Lake.png');
  expect(await held(), 'and still where it was').toBeLessThanOrEqual(HELD);

  // A picture with no alt text takes the new file's, as with any. One pasted in with a size of its own drops
  // the size: the new file may be another shape. Set outside the history, so the undo below
  // is the replace's alone.
  await canvas.evaluate((node) => {
    const { editor } = node as unknown as { editor: Editor };
    let at = -1;
    editor.state.doc.descendants((child, position) => { if (child.type.name === 'image') at = position; });
    editor.chain().setNodeSelection(at).updateAttributes('image', { alt: '', height: 90, width: 160 }).setMeta('addToHistory', false).run();
  });
  await expect(image).toHaveAttribute('width', '160');
  await image.click();
  await replace.click();
  await picker.getByRole('button', { name: /^Select Field\.png,/ }).click();
  await expect(picker).toBeHidden();
  await expect(image).toHaveAttribute('src', field!);
  await expect(image).toHaveAttribute('alt', 'A field at noon');
  await expect(image).not.toHaveAttribute('width');
  await expect(image).not.toHaveAttribute('height');

  // Undone, the alt text, the size and the file all come back; done again, the new picture returns.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveAttribute('src', lake!);
  await expect(image).toHaveAttribute('alt', '');
  await expect(image).toHaveAttribute('width', '160');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(image).toHaveAttribute('src', field!);
  await expect(image).toHaveAttribute('alt', 'A field at noon');

  // Saved, and back after a reload: the new picture is the one stored, and it is drawn.
  const written = page.waitForResponse((response) => response.url().includes('/api/admin/posts')
    && ['POST', 'PUT'].includes(response.request().method()) && response.ok());
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await written;
  const stored = await db.selectFrom('posts').select('content_html').where('title', '=', 'A replaced picture').executeTakeFirstOrThrow();
  expect(stored.content_html.split(`src="${field}"`), 'the replaced picture is stored').toHaveLength(2);
  expect(stored.content_html.split(`src="${lake}"`), 'and the old file only where it still is, higher up').toHaveLength(2);
  await page.reload();
  const saved = page.locator(`.ProseMirror img[src="${field}"]`);
  await expect(saved).toBeVisible();
  await expect.poll(() => saved.evaluate((node) => (node as HTMLImageElement).naturalWidth), 'the picture loads').toBeGreaterThan(0);
});

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

/** A picture big enough to take room on the page, as a real one would. */
async function picture(background: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 640, height: 360, channels: 4, background } }).png().toBuffer();
}

/** Files put in the library the way an owner does: the File Manager's upload dialog. */
async function uploadToLibrary(page: Page, names: string[]) {
  await uploadFiles(page, await Promise.all(names.map(async (name, index) => ({
    name, mimeType: 'image/png', buffer: await picture(['#264653', '#2a9d8f'][index % 2]!),
  }))));
}

async function uploadFiles(page: Page, files: { buffer: Buffer; mimeType: string; name: string }[]) {
  await page.goto(`${origin}/admin/media`);
  await page.locator('.media-upload input[type="file"]').setInputFiles(files);
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await dialog.getByRole('button', { name: files.length === 1 ? 'Upload 1 file' : `Upload ${files.length} files` }).click();
  for (const row of await dialog.locator('.media-upload-row').all()) {
    await expect(row).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

/** Forty paragraphs, typed in as one document: long enough that its end is far below its start. */
async function writeLongPost(canvas: Locator) {
  await canvas.click();
  await canvas.evaluate((node) => {
    const lines = Array.from({ length: 40 }, (_, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Line ${index + 1}: a short paragraph.` }],
    }));
    (node as HTMLElement & { editor: { commands: { setContent(content: unknown): void } } })
      .editor.commands.setContent({ type: 'doc', content: lines });
  });
}

/**
 * The caret at the end of `line`, a picture put in from +, and where the page, the picture and the
 * caret are after. `following` is the line after `line`, or null when nothing follows it.
 */
async function insertNearTheEnd(page: Page, canvas: Locator, line: string, following: string | null, choose: (picker: Locator) => Promise<void>) {
  const pictures = await canvas.locator('img').count();
  const blocksBefore = await blocks(canvas);
  // Mid-window, where a writer's eye is: a line at the window's very edge would have the picture land out of sight.
  const target = canvas.locator('p', { hasText: `${line}:` });
  await target.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  // Past the end of its words, which puts the caret after them. End would too, and also scroll
  // the page to its foot as it does, which is the key moving the page and not the editor.
  const box = (await target.boundingBox())!;
  await target.click({ position: { x: box.width - 2, y: box.height / 2 } });
  // The editor reads where the caret went a moment after the browser moves it.
  await expect.poll(() => canvas.evaluate((node) => {
    const { $from } = (node as unknown as { editor: Editor }).editor.state.selection;
    return $from.parentOffset === $from.parent.content.size ? $from.parent.textContent : null;
  }), 'the caret is at the end of the line').toMatch(new RegExp(`^${line}:`));
  const before = await page.evaluate(() => window.scrollY);
  expect(before, 'the line is far enough down that the page has scrolled to it').toBeGreaterThan(400);

  // As a pointer would, where they are: a click by the test scrolls the page to what it clicks
  // first, which is the test moving the page, not the editor.
  await page.getByRole('button', { name: /Add block/i }).dispatchEvent('click');
  await page.getByRole('menuitem', { name: 'Image', exact: true }).dispatchEvent('click');
  const picker = page.locator('dialog.media-picker');
  await picker.waitFor();
  await choose(picker);

  await expect(picker).toBeHidden();
  await expect(canvas.locator('img')).toHaveCount(pictures + 1);
  // Two frames: whatever the insert scrolls, it has scrolled by then.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const after = await page.evaluate(() => window.scrollY);
  // The new picture is the one after the line the caret was on.
  const inserted = canvas.locator(`p:has-text("${line}:") + img`);
  // The post's last line cannot be scrolled up to the middle of the window: it sits at the foot,
  // and showing the picture under it takes the page down by the picture, as a line typed there would.
  const room = following ? 0 : (await inserted.boundingBox())!.height;
  expect(Math.abs(after - before), `the page stayed where it was (${before} then ${after})`).toBeLessThanOrEqual(HELD + room);
  await expect(inserted, 'the new picture is in view').toBeInViewport();
  // The caret is just after the picture, where the next words go.
  const caret = await canvas.evaluate((node) => {
    const { state } = (node as unknown as { editor: Editor }).editor;
    const { $from, empty } = state.selection;
    const index = $from.index(0);
    return { before: index > 0 ? state.doc.child(index - 1).type.name : null, empty, offset: $from.parentOffset, parent: $from.parent.type.name };
  });
  expect(caret, 'the caret is just after the picture').toEqual({ before: 'image', empty: true, offset: 0, parent: 'paragraph' });
  // The line that followed still follows: a picture between two paragraphs adds itself and no
  // empty line. Only a picture with nothing after it has a new line made for the caret.
  expect(await blocks(canvas), following ? 'the picture, and nothing else' : 'the picture, and a line for the caret')
    .toBe(blocksBefore + (following ? 1 : 2));
  await expect(inserted.locator('xpath=following-sibling::*[1]')).toHaveText(following ? new RegExp(`^${following}:`) : '');
}

/** How many blocks the post has. */
async function blocks(canvas: Locator): Promise<number> {
  return canvas.evaluate((node) => (node as unknown as { editor: Editor }).editor.state.doc.childCount);
}

/** The post's blocks: a paragraph as its text, any other as its type. */
async function shape(canvas: Locator): Promise<string[]> {
  return canvas.evaluate((node) => {
    const { doc } = (node as unknown as { editor: Editor }).editor.state;
    return doc.children.map((block) => (block.type.name === 'paragraph' ? block.textContent : block.type.name));
  });
}

/** The caret at the end of `line`, and Notes.txt put in from + as a file card. */
async function putFileAtEndOf(page: Page, canvas: Locator, line: string) {
  const target = canvas.locator('p', { hasText: `${line}:` });
  await target.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const box = (await target.boundingBox())!;
  await target.click({ position: { x: box.width - 2, y: box.height / 2 } });
  await expect.poll(() => canvas.evaluate((node) => {
    const { $from } = (node as unknown as { editor: Editor }).editor.state.selection;
    return $from.parentOffset === $from.parent.content.size ? $from.parent.textContent : null;
  }), 'the caret is at the end of the line').toMatch(new RegExp(`^${line}:`));
  const cards = await canvas.locator('.file-card').count();
  // As a pointer would, where they are: see insertNearTheEnd.
  await page.getByRole('button', { name: /Add block/i }).dispatchEvent('click');
  await page.getByRole('menuitem', { name: 'File', exact: true }).dispatchEvent('click');
  const picker = page.locator('dialog.media-picker');
  await picker.waitFor();
  await picker.getByRole('button', { name: /^Select Notes\.txt,/ }).click();
  await expect(picker).toBeHidden();
  await expect(canvas.locator('.file-card')).toHaveCount(cards + 1);
}
