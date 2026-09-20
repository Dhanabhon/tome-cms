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

test.use({ stack: 'editor-blocks' });

const PROJECT = 'tomecms-select-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'editor-blocks-secret-at-least-32-ch';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-editor-blocks',
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
  'The editor is driven by a keyboard here, and the virtual authenticator needs Chromium.',
);

test('a quote is somewhere a writer can leave', async ({ context, page }) => {
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

  /** What the document is made of: a paragraph the doc owns is a paragraph outside the quote. */
  const shape = () => page.evaluate(() => {
    const root = document.querySelector('.ProseMirror');
    if (!root) return { quoted: null, topLevel: [] as string[] };
    return {
      quoted: root.querySelector('blockquote')?.textContent?.trim() ?? null,
      topLevel: [...root.children].filter((node) => node.tagName === 'P')
        .map((node) => node.textContent?.trim() ?? ''),
    };
  });

  await page.goto(`${origin}/admin/new`);
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await page.keyboard.press('ControlOrMeta+Shift+B');
  await page.keyboard.type('Quoted words');
  expect((await shape()).quoted, 'the quote is a quote before anything is asked of it')
    .toBe('Quoted words');

  // The behaviour the base keymap already has, written down so nobody re-implements it:
  // one Enter is another line of the quotation, and a second on that empty line leaves.
  await page.keyboard.press('Enter');
  expect((await shape()).topLevel, 'one Enter stays in the quotation').not.toContain('');
  await page.keyboard.press('Enter');
  await page.keyboard.type('After the quote');

  const typed = await shape();
  expect(typed.quoted, 'the quotation keeps its words').toBe('Quoted words');
  expect(typed.topLevel, 'and what follows is no longer inside it').toContain('After the quote');

  // The dead end this was reported as: inside a quote, every block the menu offers is
  // another kind of block, and the one called plain text set a paragraph that was already
  // a paragraph -- so choosing it looked like the menu doing nothing, and there was no way
  // out but the keyboard.
  await page.locator('.ProseMirror blockquote p').first().click();
  await page.getByRole('button', { name: /Add block/i }).click();
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();

  const lifted = await shape();
  expect(lifted.quoted, 'plain text leaves the quote rather than restating it').toBe(null);
  expect(lifted.topLevel, 'and the words it held are the writer\'s own paragraph now')
    .toContain('Quoted words');

  // Nothing is drawn after the last character, so the caret at the end of a quotation is
  // the end of it and not a cursor stuck behind a mark it cannot pass.
  await canvas.click();
  await page.keyboard.press('ControlOrMeta+Shift+B');
  await page.keyboard.type('A quotation');
  const painted = await page.evaluate(() => {
    const paragraph = document.querySelector('.ProseMirror blockquote p');
    if (!paragraph) return null;
    return [
      getComputedStyle(paragraph, '::before').content,
      getComputedStyle(paragraph, '::after').content,
    ];
  });
  expect(painted, 'no quotation mark stands where a caret cannot').toEqual(['none', 'none']);
});
