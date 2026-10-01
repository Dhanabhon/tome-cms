import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * The Markdown import sheet, one test per flow and at most five in this file, so it signs in
 * five times at most: /recovery allows five sign-ins per spec file, and a sixth times out.
 * Each test signs in for itself with signIn() below and drives the sheet on the post list.
 *
 * The dev server reads a file in the request's own thread: the worker and its time limit
 * (markdown-import-run.ts) are used by the built server and under tsx, and are covered by
 * tests/integration/markdown-import-built.test.ts.
 */

test.use({ stack: 'markdown-import' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The stack is set up once, on desktop.');

const PROJECT = 'tomecms-md-import-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'markdown-import-secret-at-least-32-chars-x';

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
  // The store's CORS allows this origin, so the browser may PUT a file to it; and a media key
  // is filed under its owner's UUID, so the owner below has one.
  process.env.TOME_CMS_TEST_ORIGIN = origin;
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-markdown-import',
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
    values ('a1600000-0000-4000-8000-000000000001', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'a1600000-0000-4000-8000-000000000001', 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values ('a1600000-0000-4000-8000-000000000001', 'Uncategorized', true)`.execute(db);
  await sql`insert into categories (owner_id, name) values ('a1600000-0000-4000-8000-000000000001', 'Notes')`.execute(db);
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Markdown import server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Markdown import server never became ready.\n${output}`);
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

async function signIn(context: BrowserContext, page: Page) {
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
}

// A 1x1 PNG: the library checks that an upload really is the picture it says.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// The same picture written into the post twice, under two addresses: one file, uploaded once.
const file = (title: string) => [
  '---', `title: ${title}`, 'locale: en', 'categories: [Notes, Gardening]', '---', '',
  '![one](./images/one.png)', '', 'Words between.', '', '![one again](one.png)', '',
  '![two](two.png)', '', '![three](./three.png)', '',
].join('\n');

/** How many times the library holds a file of that name. */
async function uploads(name: string): Promise<number> {
  const { db } = await import('../../src/server/db/client');
  const { sql } = await import('kysely');
  return Number((await sql<{ count: string }>`select count(*) from media_items where original_name = ${name}`.execute(db)).rows[0]!.count);
}

/** Opens the sheet once its island has hydrated: a click before that lands on nothing. */
async function openSheet(page: Page) {
  await page.goto(`${origin}/admin`);
  await expect(page.locator('astro-island[component-url*="MarkdownImport"]')).not.toHaveAttribute('ssr', /.*/);
  const opener = page.getByRole('button', { name: 'Import Markdown' });
  await opener.click();
  // Not by name: the title says what the step is, and the last one says the draft is ready.
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Import a post from Markdown' })).toBeVisible();
  return { opener, sheet };
}

test('a Markdown file with pictures becomes a draft, and a skipped picture leaves a line, at phone and desktop widths', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  for (const width of [390, 1440]) {
    const title = `Imported at ${width}`;
    await page.setViewportSize({ width, height: 900 });
    const { sheet } = await openSheet(page);
    // The system's file chooser, as a reader uses it: its click reaches the dialog, which stays open.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), sheet.getByText('Choose a .md file').click()]);
    await chooser.setFiles({ name: `post-${width}.md`, mimeType: 'text/markdown', buffer: Buffer.from(file(title)) });
    await expect(sheet.getByText(title)).toBeVisible();
    // What the import will make, before any picture is sent.
    const summary = sheet.locator('.markdown-import-summary');
    await expect(summary).toContainText('English');
    await expect(summary).toContainText(`imported-at-${width}`);
    await expect(summary).toContainText('Notes');
    await expect(summary).not.toContainText('Gardening');
    const before = { one: await uploads('one.png'), two: await uploads('TWO.png') };
    await sheet.getByTestId('markdown-pictures').setInputFiles([
      { name: 'one.png', mimeType: 'image/png', buffer: PNG },
      { name: 'TWO.png', mimeType: 'image/png', buffer: PNG },
    ]);
    await expect(sheet.getByText('Matched with one.png')).toHaveCount(2);
    await expect(sheet.getByText('Matched with TWO.png')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Import as draft' })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Import as draft' })).toHaveAccessibleDescription('Choose or skip every picture that needs a file.');
    // The control that was pressed goes away; the focus goes to what replaces it, never to the page.
    await sheet.getByRole('button', { name: 'Skip' }).click();
    await expect(sheet.getByRole('button', { name: 'Undo' })).toBeFocused();
    await sheet.getByRole('button', { name: 'Undo' }).click();
    const rowChooser = sheet.getByRole('listitem').filter({ hasText: 'three.png' }).locator('input[type=file]');
    await expect(rowChooser).toBeFocused();
    await sheet.getByRole('button', { name: 'Skip' }).click();
    await expect(sheet.getByRole('button', { name: 'Import as draft' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await sheet.getByRole('button', { name: 'Import as draft' }).click();
    await expect(sheet.getByText('One picture was skipped. Search the post for "Missing image".')).toBeVisible();
    await expect(sheet.getByText('These categories do not exist: Gardening.')).toBeVisible();
    // One file under two addresses went up once.
    expect(await uploads('one.png')).toBe(before.one + 1);
    expect(await uploads('TWO.png')).toBe(before.two + 1);

    // Closing the sheet brings the new draft into the list behind it.
    await page.keyboard.press('Escape');
    const card = page.locator('.admin-story-row', { hasText: title });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Notes');
    await card.getByRole('link', { name: title }).first().click();
    await expect(page.getByPlaceholder('Untitled post')).toHaveValue(title);
    const editor = page.locator('.ProseMirror');
    await expect(editor).toContainText('Words between.');
    await expect(editor).toContainText('[Missing image: three.png]');
    const sources = await editor.locator('img[src^="/media/"]').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
    expect(sources).toHaveLength(3);
    expect(sources[0]).toBe(sources[1]);
    expect(new Set(sources).size).toBe(2);
  }
});

test('a file the server refuses says why, the sheet keeps its place while it saves, and an upload that fails says why', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { opener, sheet } = await openSheet(page);

  await sheet.getByTestId('markdown-file').setInputFiles({ name: 'big.md', mimeType: 'text/markdown', buffer: Buffer.alloc(900_001, 'a') });
  await expect(sheet.getByRole('alert')).toHaveText('This file is larger than 900 KB.');

  const tags = Array.from({ length: 320 }, (_, index) => `<x${index}>word</x${index}>`).join('\n\n');
  await sheet.getByTestId('markdown-file').setInputFiles({ name: 'tags.md', mimeType: 'text/markdown', buffer: Buffer.from(tags) });
  await expect(sheet.getByRole('alert')).toContainText('too many kinds of HTML tag');

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();

  // A picture the library will not keep goes back to needing a file, with the reason the library gave.
  await sheet.getByTestId('markdown-file').setInputFiles({ name: 'one.md', mimeType: 'text/markdown', buffer: Buffer.from('# One picture\n\n![one](one.png)\n') });
  await sheet.getByTestId('markdown-pictures').setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') });
  await sheet.getByRole('button', { name: 'Import as draft' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('The uploaded object is not a valid supported image.');
  await expect(sheet.getByText('Needs a file', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Import as draft' })).toBeDisabled();
  await expect(sheet.getByRole('listitem').locator('input[type=file]')).toBeFocused();
  await sheet.getByRole('listitem').locator('input[type=file]').setInputFiles({ name: 'better.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.getByText('Matched with better.png')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Import as draft' })).toBeFocused();

  // A failure that may pass keeps the file matched, and the row offers Retry.
  let refused = false;
  await page.route('**/api/admin/media/uploads', async (route) => {
    if (refused || route.request().method() !== 'POST') return route.fallback();
    refused = true;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'storage_unreachable', error: 'Storage is down.' }) });
  });
  await sheet.getByRole('button', { name: 'Import as draft' }).click();
  await expect(sheet.getByText('The upload could not reach storage. Try again.')).toBeVisible();
  await expect(sheet.getByText('Matched with better.png')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Retry' })).toBeFocused();

  // While the draft is being made the sheet cannot be left, and the close control says so.
  await page.route('**/api/admin/posts/import', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.fallback();
  });
  await sheet.getByRole('button', { name: 'Retry' }).click();
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Open the draft' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeEnabled();

  // The draft opens with its title, and an editor that is told a post is too long says so in words.
  await sheet.getByRole('link', { name: 'Open the draft' }).click();
  await expect(page.getByPlaceholder('Untitled post')).toHaveValue('One picture');
  await page.route('**/api/admin/posts', async (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'content_too_large', error: 'The editor content is invalid.' }) });
  });
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('More words');
  await expect(page.getByRole('alert')).toContainText('This post is too long to save. Split it or remove some of it.');
});

test('a dialog the browser closes while the draft is being made leaves no dead sheet behind', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { opener, sheet } = await openSheet(page);
  await sheet.getByTestId('markdown-file').setInputFiles({ name: 'plain.md', mimeType: 'text/markdown', buffer: Buffer.from('# Closed by the browser\n\nJust words.\n') });
  await expect(sheet.getByText('Closed by the browser')).toBeVisible();
  // Held in flight, so the moment the browser closes the dialog is the one the lock covers.
  await page.route('**/api/admin/posts/import', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fallback();
  });
  await sheet.getByRole('button', { name: 'Import as draft' }).click();
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeDisabled();
  // What Chromium does on a second Escape with no click between: a cancel that cannot be held back, then a close.
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]') as HTMLDialogElement;
    dialog.dispatchEvent(new Event('cancel', { cancelable: false }));
    dialog.close();
  });
  await expect(page.locator('dialog[aria-labelledby="markdown-import-title"]')).toHaveCount(0);
  // Once the answer is in, the list is fresh (the draft is in it) and the button opens the sheet again.
  await expect(page.locator('.admin-story-row', { hasText: 'Closed by the browser' })).toBeVisible();
  await opener.click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Import a post from Markdown' })).toBeVisible();
});
