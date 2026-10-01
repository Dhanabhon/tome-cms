import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * Renaming a file in the File Manager changes its name and nothing else.
 *
 * The card shows the new name as soon as "Save" answers, the ending is the stored file's, and a
 * post that uses the picture still points at it.
 */

test.use({ stack: 'media-rename' });

const PROJECT = 'tomecms-media-rename';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'media-rename-secret-at-least-32-chars';
const OWNER = '7e1b5a4f-9d6c-4b8a-8f0e-4c5d6e7f8091';
const PICTURE = '8f2c6b5a-0e7d-4c9b-9a1f-5d6e7f8091a2';
const GROUP = '9a3d7c6b-1f8e-4dac-8b2a-6e7f8091a2b3';

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function psql(statement: string) {
  return docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', statement], 60_000);
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

let server: ChildProcess | undefined;
let origin = '';

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-media-rename',
  };

  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  psql('drop schema public cascade; create schema public;');

  Object.assign(process.env, serverEnv);
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();

  // An installed owner, a picture in their library, and a post that has it as its cover.
  psql(`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
      values ('${OWNER}', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now());
    insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
      values (true, '${OWNER}', 'Rename Test', 'en', 'UTC', '/admin');
    insert into categories (owner_id, name, is_default) values ('${OWNER}', 'Uncategorized', true);
    insert into media_items (id, owner_id, folder_id, object_key, original_name, mime_type, size_bytes,
        width, height, checksum_sha256, alt_text, state)
      values ('${PICTURE}', '${OWNER}', null, 'seed/lake.webp', 'lake.webp', 'image/webp', 1000, 1600, 900,
        '${'a'.repeat(43)}=', 'A lake at dawn', 'ready');
    insert into post_translation_groups (id, owner_id) values ('${GROUP}', '${OWNER}');
    insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select '${GROUP}', c.id, '${OWNER}' from categories c;
    insert into posts (translation_group_id, locale, title, slug, content_json, content_html, status, published_at, owner_id, cover_media_id)
      values ('${GROUP}', 'en', 'Lakes', 'lakes', '{"type":"doc","content":[]}'::jsonb,
        '<p><img src="/media/${PICTURE}" alt="A lake at dawn"></p>', 'published', now() - interval '1 day', '${OWNER}', '${PICTURE}');`);

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env: serverEnv, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Rename test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Rename test server never became ready.\n${output}`);
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

test('a renamed file shows its new name at once, keeps its ending, and what uses it is untouched', async ({ context, page }) => {
  test.setTimeout(180_000);
  await signIn(context, page);
  await page.goto(`${origin}/admin/media`);

  await page.getByRole('button', { name: /^lake\.webp,/ }).click();
  const details = page.locator('dialog.media-details');
  const name = details.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue('lake.webp');
  const save = details.getByRole('button', { name: 'Save' });

  // A blank name is said so, not dropped: nothing is saved and the field is marked.
  await name.fill('   ');
  await save.click();
  await expect(details.getByRole('alert').filter({ hasText: 'Enter a name for the file.' })).toBeVisible();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(psql(`select original_name from media_items where id = '${PICTURE}'`).stdout).toContain('lake.webp');

  // Typed without its ending, the name is kept with the stored file's.
  await name.fill('Morning lake');
  await save.click();
  await expect(details.getByRole('button', { name: 'Saved' })).toBeVisible();
  await expect(details.getByRole('status').filter({ hasText: 'Renamed' })).toBeVisible();
  await expect(name).toHaveValue('Morning lake.webp');
  await expect(details.locator('p.break-all')).toHaveText('Morning lake.webp');
  await details.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByRole('button', { name: /^Morning lake\.webp,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^lake\.webp,/ })).toHaveCount(0);

  // The file's address, its stored object and the post's body are what they were.
  const stored = psql(`select original_name || '|' || object_key from media_items where id = '${PICTURE}'`).stdout;
  expect(stored).toContain('Morning lake.webp|seed/lake.webp');
  const body = psql(`select content_html || '|' || cover_media_id from posts where slug = 'lakes'`).stdout;
  expect(body).toContain(`/media/${PICTURE}`);
  expect(body).toContain(`|${PICTURE}`);
});
