import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import type { BrowserContext, Page, Route } from '@playwright/test';

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
// A media key is filed under its owner's UUID, so the owner has to have one.
const OWNER = '6c1f2e3d-4b5a-4c7d-8e9f-0a1b2c3d4e5f';

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
  // The browser puts a file straight into the store, which answers only the origin it is told.
  process.env.TOME_CMS_TEST_ORIGIN = origin;
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
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'Select Test', 'en', 'UTC', '/admin')`.execute(db);
  // Somewhere for a post to be filed: saving one files it under the default category,
  // and an installation always has one.
  await sql`insert into categories (owner_id, name, is_default) values (${OWNER}, 'Uncategorized', true)`.execute(db);

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


// Every test here signs in on its own, through the recovery page, and recovery allows five in
// half an hour -- a limit for a person at a keyboard, which this file reaches at its sixth
// test. The limiter has tests of its own; here it only stands between a test and the editor.
test.beforeEach(async () => {
  const { db } = await import('../../src/server/db/client');
  await db.deleteFrom('security_rate_limits').execute();
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

test('the + menu opens where all of it can be seen, wherever the line is', async ({ context, page }) => {
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

  // Found where the menu fit neither below the line nor above it: it opened above anyway and
  // slid under the editor's bar, and its first items could not be chosen -- on a phone, and
  // on a laptop once the menu grew an item. So this walks the line down the window at both
  // sizes, and opens the menu at every step.
  const canvas = page.locator('.ProseMirror');
  const misplaced: string[] = [];
  for (const size of [{ height: 720, width: 1280 }, { height: 740, width: 375 }]) {
    await page.setViewportSize(size);
    await page.goto(`${origin}/admin/new`);
    await canvas.click();
    for (let line = 0; line < 14; line += 1) {
      await page.getByRole('button', { name: /Add block/i }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      // Up from the first item is the last, which a menu held short has to scroll to.
      await page.keyboard.press('ArrowUp');
      await expect(page.getByRole('menuitem', { name: 'Image' })).toBeFocused();
      const reachable = await page.evaluate(() => {
        const menu = document.querySelector('.block-insert-menu')?.getBoundingClientRect();
        const bar = document.querySelector('.admin-editor-bar')?.getBoundingClientRect();
        const last = document.activeElement;
        if (!menu || !bar || !(last instanceof HTMLElement)) return false;
        const box = last.getBoundingClientRect();
        return menu.top >= bar.bottom && menu.bottom <= innerHeight
          && last.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      });
      if (!reachable) misplaced.push(`${size.width}px, line ${line}`);
      await page.keyboard.press('Escape');
      await expect(canvas).toBeFocused();
      await page.keyboard.press('Enter');
    }
  }
  expect(misplaced, 'the lines where the menu was covered, cut off, or could not reach its end').toEqual([]);
});

test('the formatting bar is whole, wherever the words it formats begin', async ({ context, page }) => {
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

  // Reported from a real draft: a word chosen at the start of a line, and the bar over it cut
  // off at the canvas's edge with its first button half gone. The bar is centred on the words,
  // so a short word at the start of a line puts its left end past the canvas -- and the bar
  // lives inside the canvas, which clipped whatever crossed its edge. Popper moves a bar back
  // inside the boxes that would clip it, but it does not count `overflow: clip` as one.
  await page.goto(`${origin}/admin/new`);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Hi');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');

  /** The buttons a pointer cannot press at both ends: a clipped end is not there to hit. */
  const cut = () => page.evaluate(() => ['Bold', 'Italic', 'Link', 'Inline code'].filter((label) => {
    const button = document.querySelector(`button[aria-label="${label}"]`);
    if (!button) return true;
    const box = button.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    return [box.left + 1, box.right - 1].some((x) => !button.contains(document.elementFromPoint(x, middle)));
  }));
  await expect.poll(cut, { message: 'every button on the bar can be pressed, end to end' }).toEqual([]);
});

test('a link opens a new tab only when its writer asked it to', async ({ context, page }) => {
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

  // Every link used to open a new tab, and the button that made one was an arrow. It is a
  // link drawn as a link now, and the writer says where each one opens.
  await page.goto(`${origin}/admin/new`);
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  const linkWord = async (address: string, newTab: boolean) => {
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('Shift+ArrowLeft');
    const button = page.getByRole('button', { name: 'Link' });
    await expect(button.locator('svg'), 'a drawn icon, not a typed arrow').toHaveCount(1);
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Add a link' });
    const choice = dialog.getByRole('checkbox', { name: 'Open in a new tab' });
    await expect(choice, 'as every link did before there was a choice').toBeChecked();
    await choice.setChecked(newTab);
    await dialog.getByRole('textbox').fill(address);
    await dialog.getByRole('button', { name: 'Apply link' }).click();
    await expect(canvas).toBeFocused();
  };
  // The whole line first: words typed straight after a link join it.
  await page.keyboard.type('Read this or that');
  await linkWord('example.com/here', false);
  // From the start of "that", back over " or " to the end of "this".
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowLeft');
  await linkWord('example.com/away', true);

  const links = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror a')]
    .map((link) => [link.textContent, link.getAttribute('target')]));
  expect(links).toEqual([['this', '_blank'], ['that', null]]);
});

test('a line and a table cell can be aligned, from either bar', async ({ context, page }) => {
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

  await page.goto(`${origin}/admin/new`);
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await page.keyboard.type('A centred line');
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('Shift+ArrowLeft');
  const center = page.getByRole('button', { name: 'Align center' });
  await expect(page.getByRole('button', { name: 'Align left' }), 'left is what a line has to begin with').toHaveAttribute('aria-pressed', 'true');
  await center.click();
  await expect(canvas.locator('p').first()).toHaveCSS('text-align', 'center');
  await expect(center, 'and the bar says so').toHaveAttribute('aria-pressed', 'true');

  // A table's bar aligns the cell the cursor is in, and each of its buttons is drawn as well
  // as named.
  await expect(canvas).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Add block/i }).click();
  await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
  await expect(canvas).toBeFocused();
  await page.keyboard.type('Name');
  const tableBar = page.getByRole('group', { name: 'Table' });
  for (const name of ['Add row', 'Add column', 'Delete row', 'Delete column', 'Delete table']) {
    await expect(tableBar.getByRole('button', { name }).locator('svg'), `${name} has an icon`).toHaveCount(1);
  }
  await tableBar.getByRole('button', { name: 'Align right' }).click();
  await expect(canvas.locator('th p').first()).toHaveCSS('text-align', 'right');
  await expect(canvas.locator('th p').nth(1), 'only the cell the cursor was in').toHaveCSS('text-align', 'start');
});

test('a draft that cannot be saved can still be left', async ({ context, page }) => {
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

  // Reported from a real draft: words typed, then not wanted, and no way out of the editor.
  // Back saves before it leaves, so nothing is lost on the way -- and a draft with no title
  // cannot be saved, so every press of Back only showed that error again.
  const backToPosts = page.getByRole('link', { name: /Back to Posts/ });

  // Written and taken back again: nothing to save and nothing to lose, so nothing to ask.
  await page.goto(`${origin}/admin/new`);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await backToPosts.click();
  await page.waitForURL(`${origin}/admin`, { timeout: 10_000 });

  // Words without a title cannot be saved, so leaving asks first -- and staying stays.
  await page.goto(`${origin}/admin/new`);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Words without a title');
  await backToPosts.click();
  await page.getByRole('button', { name: 'Stay in editor' }).click();
  await expect(page, 'staying is staying').toHaveURL(`${origin}/admin/new`);
  await expect(page.locator('.ProseMirror'), 'with the words still there').toHaveText('Words without a title');
  await backToPosts.click();
  await page.getByRole('button', { name: 'Leave without saving' }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 10_000 });

  // A page is left the same way.
  await page.goto(`${origin}/admin/pages/new`);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('A page without a title');
  await page.getByRole('link', { name: /Back to Pages/ }).click();
  await page.getByRole('button', { name: 'Leave without saving' }).click();
  await page.waitForURL(`${origin}/admin/pages`, { timeout: 10_000 });
});

test('a table is written, grown and trimmed in the editor, and scrolls on a phone', async ({ context, page }) => {
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

  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('A table');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Before the table.');
  await page.keyboard.press('Enter');

  // From the + menu into its first cell, and Tab walks the cells from there. Tiptap hands focus
  // back to the page a frame after a menu or bar button is pressed, and keys sent sooner are
  // lost -- no hand is that quick, a test is.
  const canvas = page.locator('.ProseMirror');
  await page.getByRole('button', { name: /Add block/i }).click();
  await page.getByRole('menuitem', { name: 'Table', exact: true }).click();
  await expect(canvas).toBeFocused();
  for (const word of ['Name', 'Word', 'Note', 'Alice']) {
    if (word !== 'Name') await page.keyboard.press('Tab');
    await page.keyboard.type(word);
  }
  /** How many cells each row has, top to bottom. */
  const shape = () => page.evaluate(() => [...document.querySelectorAll('.ProseMirror table tr')].map((row) => row.children.length));
  expect(await shape(), 'three rows of three').toEqual([3, 3, 3]);
  await expect(page.locator('.ProseMirror tr').first().locator('th'), 'the first of them headers').toHaveCount(3);

  // A cursor in a cell brings the table's bar and not the formatting one; words chosen in a
  // cell bring the formatting bar and send the table's away. Both at once overlap.
  const tableBar = page.getByRole('group', { name: 'Table' });
  const bold = page.getByRole('button', { name: 'Bold' });
  await expect(tableBar).toBeVisible();
  await expect(bold).toBeHidden();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(bold).toBeVisible();
  await expect(tableBar).toBeHidden();
  await page.keyboard.press('ArrowRight');

  await tableBar.getByRole('button', { name: 'Add column' }).click();
  expect(await shape(), 'a column to the right').toEqual([4, 4, 4]);
  await tableBar.getByRole('button', { name: 'Delete row' }).click();
  expect(await shape(), 'the row the cursor was in is gone').toEqual([4, 4]);

  // The keyboard's way to the same things, since Tab inside a table moves between cells: '/'
  // offers them first, and does not offer another table inside this one.
  await expect(canvas).toBeFocused();
  await page.keyboard.type('/');
  await expect(page.getByRole('option', { name: /^Add row/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /^Table/ })).toHaveCount(0);
  await page.keyboard.press('Enter');
  expect(await shape(), '/ added a row').toEqual([4, 4, 4]);

  // Nor does the + menu offer a table inside one.
  await page.getByRole('button', { name: /Add block/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Text', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Table', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(canvas).toBeFocused();

  // Wider than a phone on purpose: one word that cannot break.
  await page.keyboard.type('Pneumonoultramicroscopicsilicovolcanoconiosis');

  // Cells chosen together are the table's to act on, so its bar stands for them. From words
  // chosen straight to cells chosen, so both bars have to change places: each waits a moment
  // after a selection before it moves, and a bar that never appears proves nothing sooner.
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(bold).toBeVisible();
  await expect(tableBar).toBeHidden();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(tableBar).toBeVisible();
  await expect(bold).toBeHidden();
  const written = page.waitForResponse((response) => response.url().includes('/api/admin/posts')
    && ['POST', 'PUT'].includes(response.request().method()) && response.ok());
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await written;

  const { db } = await import('../../src/server/db/client');
  const { slug } = await db.selectFrom('posts').select('slug').where('title', '=', 'A table')
    .orderBy('created_at', 'desc').executeTakeFirstOrThrow();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${origin}/en/blog/${slug}`);
  await expect(page.locator('.tableWrapper th').first(), 'a reader gets the table').toHaveText('Name');
  const reach = await page.locator('.tableWrapper').evaluate((wrapper) => {
    wrapper.scrollLeft = wrapper.scrollWidth;
    return { right: wrapper.getBoundingClientRect().right, scrolled: wrapper.scrollLeft, width: innerWidth };
  });
  expect(reach.scrolled, 'on a phone the table scrolls inside its box').toBeGreaterThan(0);
  expect(reach.right, 'and the box stays on the screen').toBeLessThanOrEqual(reach.width);
});

test('the settings drawer opens where it can be seen, every time', async ({ context, page }) => {
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

  await page.goto(`${origin}/admin/new`);
  const drawer = page.locator('dialog.admin-editor-settings');
  const open = page.getByRole('button', { name: /^Settings$/ }).first();

  /** On screen, and drawn where it says it is. */
  const arrived = async () => page.evaluate(async () => {
    const panel = document.querySelector('dialog.admin-editor-settings') as HTMLElement;
    // After it has arrived, not while it is arriving.
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    const box = panel.getBoundingClientRect();
    return { left: Math.round(box.left), width: Math.round(box.width), within: box.right <= window.innerWidth + 1 };
  });

  await open.click();
  await drawer.waitFor({ state: 'visible' });
  const first = await arrived();
  expect(first.within && first.width > 0, 'the drawer is on screen').toBe(true);

  // This panel is closed rather than unmounted, so the mark its exit leaves is still on it
  // when it is asked for again: without clearing that, the second open is off-screen.
  await page.getByRole('button', { name: /Close settings/i }).click();
  await expect(drawer).toBeHidden();
  await open.click();
  await drawer.waitFor({ state: 'visible' });
  expect(await arrived(), 'and is in the same place the second time').toEqual(first);

  await page.mouse.click(40, 400);
  await expect(drawer, 'a click on the editor behind closes it').toBeHidden();
});

test('a post can be published for later, and is nobody else\'s until then', async ({ context, page }) => {
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

  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('Out on Friday');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Words enough to be publishable.');

  // Tomorrow, in the clock the owner is looking at -- which is what the input holds.
  const friday = await page.evaluate(() => {
    const when = new Date(Date.now() + 86_400_000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  });
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  const when = page.locator('dialog.admin-editor-settings input[type="datetime-local"]');
  await when.waitFor({ state: 'visible' });
  await when.fill(friday);
  await page.getByRole('button', { name: /Close settings/i }).click();

  const written = page.waitForResponse((response) => response.url().includes('/api/admin/posts')
    && ['POST', 'PUT'].includes(response.request().method()) && response.ok());
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await written;

  // Only the button that was pressed says it is working. It used to follow the whole
  // editor's saving, so every autosave put a spinner on Update while the owner typed -- which
  // reads as publishing. Each save here is held until it has been looked at.
  const update = page.getByRole('button', { name: /^Update$/ });
  const holdSaves = async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/admin/posts', async (route) => { await held; await route.continue(); });
    return release;
  };
  const saved = () => page.waitForResponse((response) => response.url().endsWith('/api/admin/posts')
    && response.request().method() === 'PUT' && response.ok());

  let release = await holdSaves();
  let answered = saved();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(' And a few more.');
  await expect(page.locator('.admin-save-state'), 'the editor is saving').toHaveAttribute('data-state', 'saving');
  await expect(update, 'but nobody pressed Update').toHaveAttribute('aria-busy', 'false');
  release();
  await answered;
  await page.unroute('**/api/admin/posts');

  release = await holdSaves();
  answered = saved();
  await update.click();
  await expect(update, 'the button that was pressed says so').toHaveAttribute('aria-busy', 'true');
  release();
  await answered;
  await expect(update, 'until it is done').toHaveAttribute('aria-busy', 'false');
  await page.unroute('**/api/admin/posts');

  // The three places the answer has to agree: what the row says, what the list shows, and
  // what a reader gets. A screen that says Scheduled over a page anyone can already read is
  // the failure worth catching.
  const { db } = await import('../../src/server/db/client');
  const row = await db.selectFrom('posts').select(['slug', 'status', 'published_at'])
    .where('title', '=', 'Out on Friday').executeTakeFirstOrThrow();
  expect(row.status, 'published').toBe('published');
  expect(row.published_at!.getTime(), 'for a date still to come').toBeGreaterThan(Date.now());

  await page.goto(`${origin}/admin`);
  // Scheduled is a kind of published, so that is the tab it belongs under.
  await page.locator('.admin-post-tabs').getByRole('link', { name: /Published/ }).click();
  await expect(page.getByRole('link', { name: /Out on Friday/ }).first()).toBeVisible();
  await expect(page.locator('.admin-status').first(), 'the list says so in a word')
    .toHaveText(/Scheduled/i);

  const reader = await page.goto(`${origin}/en/blog/${row.slug}`);
  expect(reader?.status(), 'and a reader is not served it yet').toBe(404);
});

test('an owner can forward an old address, and stop', async ({ context, page }) => {
  test.setTimeout(120_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const { createPost } = await import('../../src/server/content/posts');
  const { db } = await import('../../src/server/db/client');
  const settings = await getSiteSettings();
  const [category] = await db.selectFrom('categories').select('id').where('is_default', '=', true).execute();
  await createPost(settings!.owner_id, {
    categoryIds: [category!.id], contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Here.' }] }] },
    coverMediaId: null, excerpt: '', metaDescription: null, metaTitle: null,
    slug: 'destination', status: 'published', title: 'Destination',
  });
  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });

  await page.goto(`${origin}/admin/redirects`);
  await page.locator('.redirect-add select').selectOption({ label: 'EN · Destination' });
  // The field shows where the address will live once the article is chosen.
  await expect(page.locator('.redirect-add .admin-control--prefixed > span')).toHaveText('/en/blog/');
  await page.locator('.redirect-add input[type="text"]').fill('somewhere-old');
  await page.getByRole('button', { name: /^Forward$/ }).click();

  const row = page.locator('.redirect-row', { hasText: '/en/blog/somewhere-old' });
  await expect(row, 'listed once it is saved').toBeVisible();
  await expect(row.getByRole('link', { name: 'Destination' })).toHaveAttribute('href', '/en/blog/destination');

  const forwarded = await fetch(`${origin}/en/blog/somewhere-old`, { redirect: 'manual' });
  expect(forwarded.status, 'and a reader is sent on').toBe(301);

  await row.getByRole('button', { name: /Stop forwarding/ }).click();
  await expect(row, 'gone from the list').toHaveCount(0);
  const stopped = await fetch(`${origin}/en/blog/somewhere-old`, { redirect: 'manual' });
  expect(stopped.status, 'and from the site').toBe(404);
});

test('suggestions are offered, never applied, and a maybe reads as one', async ({ context, page }) => {
  test.setTimeout(120_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const { db } = await import('../../src/server/db/client');
  const settings = await getSiteSettings();
  const [fallback] = await db.selectFrom('categories').select('id').where('is_default', '=', true).execute();
  const [design, travel] = await db.insertInto('categories').values([
    { owner_id: settings!.owner_id, name: 'Design', is_default: false },
    { owner_id: settings!.owner_id, name: 'Travel', is_default: false },
  ]).returning(['id', 'name']).execute();
  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });

  // An installation that has not switched a suggester on draws no button at all: sending an
  // article anywhere is the owner's choice, made on the Plugins screen, not a default.
  await page.goto(`${origin}/admin/new`);
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  await expect(page.getByRole('button', { name: /Suggest/ }), 'nothing to suggest with').toHaveCount(0);
  await page.getByRole('button', { name: /Close settings/i }).click();

  const { writePluginSettings } = await import('../../src/server/plugins/store');
  // Never used: the tests answer the suggestion requests in the browser, so nothing here
  // reaches the real service -- but it is stored sealed, exactly as the owner's would be.
  await writePluginSettings(settings!.owner_id, { enabled: true, id: 'typesafe', values: { apiKey: 'e2e-key-never-sent' } });

  // The judgements are answered here, in the browser, as the service would answer them.
  await page.route('**/api/admin/posts/suggest-categories', (route) => route.fulfill({
    json: { suggestions: [
      { band: 'likely', id: design!.id, likelihood: 0.9, name: 'Design' },
      { band: 'possible', id: travel!.id, likelihood: 0.45, name: 'Travel' },
    ] },
  }));
  const line = 'This is the line that says what the article is about.';
  // A description is asked for by name. Answered as an excerpt instead, the description field
  // would show the card's line, and the checks below would say so.
  const summary = 'This passage sums up what the article says, the way a search result shows it under the title.';
  const answerByPurpose = (route: Route) => route.fulfill({
    json: { excerpt: route.request().postDataJSON()?.purpose === 'description' ? summary : line },
  });
  await page.route('**/api/admin/suggest-excerpt', answerByPurpose);

  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('Suggested');
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  const drawer = page.locator('dialog.admin-editor-settings');

  await drawer.getByRole('button', { name: /Suggest from the text/ }).click();
  const likely = drawer.locator('.drawer-suggest__band[data-band="likely"]');
  const possible = drawer.locator('.drawer-suggest__band[data-band="possible"]');
  await expect(likely.getByRole('button', { name: '+ Design' })).toBeVisible();
  // A maybe is apart from the suggestions, and says so.
  await expect(possible).toContainText('Perhaps');
  await expect(possible.getByRole('button', { name: '+ Travel' })).toBeVisible();
  const designBox = drawer.getByRole('checkbox', { name: 'Design' });
  await expect(designBox, 'offered is not the same as filed').not.toBeChecked();
  await likely.getByRole('button', { name: '+ Design' }).click();
  await expect(designBox, 'until the owner presses it').toBeChecked();

  const field = drawer.locator('textarea').first();
  await field.fill('What I had written.');
  await drawer.getByRole('button', { name: /Suggest a line from the text/ }).click();
  await expect(drawer.locator('.drawer-suggestion blockquote')).toHaveText(line);
  await expect(field, 'a suggestion does not overwrite what is there').toHaveValue('What I had written.');
  await drawer.getByRole('button', { name: 'Use this line' }).click();
  await expect(field, 'until the owner asks it to').toHaveValue(line);
  void fallback;

  // The description has its own button, under its own field, and the same manners.
  const search = drawer.locator('section', { has: page.getByRole('heading', { name: 'Search preview' }) });
  const description = search.getByRole('textbox', { name: /Meta description/ });
  await description.fill('What I had for search.');
  await search.getByRole('button', { name: 'Suggest a description from the text' }).click();
  await expect(search.locator('.drawer-suggestion blockquote')).toHaveText(summary);
  await expect(description, 'a suggestion does not overwrite what is there').toHaveValue('What I had for search.');
  await search.getByRole('button', { name: 'Use as the description' }).click();
  await expect(description, 'until the owner asks it to').toHaveValue(summary);
  await expect(field, 'and the excerpt is a field of its own').toHaveValue(line);

  // The service not answering is its own answer. It used to read as "no line works on its
  // own" and "nothing matches a category" -- claims about the article that nobody made.
  await page.unroute('**/api/admin/suggest-excerpt');
  await page.unroute('**/api/admin/posts/suggest-categories');
  const unavailable = { status: 503, json: { error: 'Suggestions are unavailable right now.' } };
  await page.route('**/api/admin/suggest-excerpt', (route) => route.fulfill(unavailable));
  await page.route('**/api/admin/posts/suggest-categories', (route) => route.fulfill(unavailable));

  await drawer.getByRole('button', { name: /Suggest a line from the text/ }).click();
  await expect(drawer.getByText('The suggestion service did not answer')).toHaveCount(1);
  await expect(drawer.getByText('No line in the article works on its own'), 'not a claim about the article')
    .toHaveCount(0);
  await drawer.getByRole('button', { name: /Suggest from the text/ }).click();
  await expect(drawer.getByText('The suggestion service did not answer')).toHaveCount(2);
  await expect(drawer.getByText('Nothing here matches a category'), 'nor about the categories').toHaveCount(0);
  await search.getByRole('button', { name: 'Suggest a description from the text' }).click();
  await expect(drawer.getByText('The suggestion service did not answer')).toHaveCount(3);
  await expect(drawer.getByText('Nothing in the article sums it up'), 'nor about the description').toHaveCount(0);

  // A page's drawer offers the same, wired to its own field.
  await page.unroute('**/api/admin/suggest-excerpt');
  await page.route('**/api/admin/suggest-excerpt', answerByPurpose);
  await page.goto(`${origin}/admin/pages/new`);
  await page.locator('#page-title').fill('A page');
  await page.getByRole('button', { name: /^Settings$/ }).first().click();
  const pageSearch = page.locator('dialog.admin-editor-settings section', { has: page.getByRole('heading', { name: 'Search preview' }) });
  await pageSearch.getByRole('button', { name: 'Suggest a description from the text' }).click();
  await pageSearch.getByRole('button', { name: 'Use as the description' }).click();
  await expect(pageSearch.getByRole('textbox', { name: /Meta description/ })).toHaveValue(summary);
});

test('a file joins the library, is found by its type, and the filter holds through a reload', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#2a9d8f' } }).png().toBuffer();

  await page.goto(`${origin}/admin/media`);
  const upload = page.locator('.media-upload input[type="file"]');
  await upload.setInputFiles({ name: 'Swatch.png', mimeType: 'image/png', buffer: png });
  const swatch = page.getByRole('button', { name: /^Swatch\.png,/ });
  await expect(swatch).toBeVisible();
  await upload.setInputFiles({ name: 'Guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF\n') });
  const guide = page.getByRole('button', { name: /^Guide\.pdf, PDF,/ });
  await expect(guide).toBeVisible();

  const types = page.getByRole('group', { name: 'File types' });
  await types.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page).toHaveURL(/[?&]type=pdf(&|$)/);
  await expect(guide).toBeVisible();
  await expect(swatch).toHaveCount(0);

  // The address is the view: a reload opens the same one.
  await page.reload();
  await expect(types.getByRole('button', { name: 'PDF', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(guide).toBeVisible();
  await expect(swatch).toHaveCount(0);

  await types.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(swatch).toBeVisible();
  await expect(guide).toHaveCount(0);

  // A document's details have no alternative text, and name it a file.
  await types.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page).not.toHaveURL(/type=/);
  await guide.click();
  const details = page.getByRole('dialog', { name: 'File details' });
  await expect(details.getByLabel('File URL')).toHaveValue(/^\/media\/[0-9a-f-]{36}$/);
  await expect(details.getByLabel('Alt text')).toHaveCount(0);
  await details.getByRole('button', { name: 'Close details' }).click();

  // A spreadsheet saved in the Thai code page is refused, and the owner is told how to save it --
  // in the admin's words ("this file"), not the API's ("the file").
  await upload.setInputFiles({ name: 'รายชื่อ.csv', mimeType: 'text/csv', buffer: Buffer.from([0xaa, 0xd7, 0xe8, 0xcd, 0x2c, 0x31, 0x0a]) });
  await expect(page.getByRole('alert')).toContainText('Save this file as UTF-8 (in Excel, "CSV UTF-8")');
});

/** Signs the owner in through a recovery enrollment, as a new device would. */
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

