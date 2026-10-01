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
 * where the page is before and after.
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
    await insertNearTheEnd(page, canvas, 'Line 36', async (picker) => {
      await picker.locator('input[type="file"]').setInputFiles({ name: upload, mimeType: 'image/png', buffer: await picture('#e76f51') });
    });
    // Chosen from the File Manager: a picture already there.
    await insertNearTheEnd(page, canvas, 'Line 33', async (picker) => {
      await picker.getByRole('button', { name: /^Select Harbour\.png,/ }).click();
    });
  }
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
  await page.goto(`${origin}/admin/media`);
  const files = await Promise.all(names.map(async (name, index) => ({
    name, mimeType: 'image/png', buffer: await picture(['#264653', '#2a9d8f'][index % 2]!),
  })));
  await page.locator('.media-upload input[type="file"]').setInputFiles(files);
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await dialog.getByRole('button', { name: `Upload ${names.length} files` }).click();
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

/** The caret at the end of `line`, a picture put in from +, and where the page and the picture are after. */
async function insertNearTheEnd(page: Page, canvas: Locator, line: string, choose: (picker: Locator) => Promise<void>) {
  const pictures = await canvas.locator('img').count();
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
  expect(Math.abs(after - before), `the page stayed where it was (${before} then ${after})`).toBeLessThanOrEqual(HELD);
  // The new picture is the one after the line the caret was on.
  const inserted = canvas.locator(`p:has-text("${line}:") + img`);
  await expect(inserted, 'the new picture is in view').toBeInViewport();
  // The caret is just after the picture, where the next words go.
  const caret = await canvas.evaluate((node) => {
    const { state } = (node as unknown as { editor: Editor }).editor;
    const { $from, empty } = state.selection;
    const index = $from.index(0);
    return { before: index > 0 ? state.doc.child(index - 1).type.name : null, empty, offset: $from.parentOffset, parent: $from.parent.type.name };
  });
  expect(caret, 'the caret is just after the picture').toEqual({ before: 'image', empty: true, offset: 0, parent: 'paragraph' });
}
