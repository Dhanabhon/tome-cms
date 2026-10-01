import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './own-worker';

/**
 * MCP end to end, as an AI app meets it: the owner switches it on, a client registers and asks,
 * the owner allows it with a passkey, the client writes a draft twice, the owner puts the draft
 * back from the editor, the client waits while the owner has the draft open, then the owner
 * revokes. One test and one sign-in: /recovery allows five per file.
 */

test.use({ stack: 'mcp' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The stack is set up once, on desktop.');

const PROJECT = 'tomecms-mcp-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'mcp-e2e-secret-at-least-32-characters-xx';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-mcp',
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
    values ('a7000000-0000-4000-8000-000000000001', 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, 'a7000000-0000-4000-8000-000000000001', 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, is_default) values ('a7000000-0000-4000-8000-000000000001', 'Uncategorized', true)`.execute(db);
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`MCP server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`MCP server never became ready.\n${output}`);
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

const CALLBACK = 'http://localhost:39999/callback';
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

type ToolResult = { isError?: boolean; content: { text: string }[] };

/** What an AI app's server sends: no Origin, no cookie. */
async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!response.ok) return { status: response.status, result: null };
  // The SDK answers as one SSE event; its data line is the JSON-RPC reply.
  const data = (await response.text()).split('\n').find((line) => line.startsWith('data: '));
  return { status: response.status, result: JSON.parse(data!.slice(6)).result as ToolResult };
}

async function mcp(token: string, name: string, args: Record<string, unknown>) {
  const { status, result } = await callTool(token, name, args);
  if (!result) return { status, result: null };
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return { status, result: JSON.parse(result.content[0]!.text.replace(/^[^\n]*\n/, '')) };
}

async function shoot(page: Page, name: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflows at ${size.width}px`).toBe(true);
  await page.screenshot({ fullPage: true, path: test.info().outputPath(`${name}-${size.width}.png`) });
}

test('an AI app connects with a passkey, writes a draft, is put back, waits for the owner and is revoked', async ({ context, page }) => {
  // One real wait of 50 s below: the server's clock cannot be moved from here.
  test.setTimeout(360_000);
  await page.setViewportSize(WIDE);
  await signIn(context, page);

  // Switch it on.
  await page.goto(`${origin}/admin/plugins`);
  const card = page.locator('.plugin-card').filter({ has: page.locator('strong', { hasText: /^MCP/ }) });
  // The switch is controlled: it moves once the server has answered, so a click, then a wait.
  await card.getByRole('switch').click();
  await expect(card.getByRole('switch')).toBeChecked();
  await expect(card.getByRole('heading', { name: /Connections/ })).toBeVisible();
  await expect(card.getByText('Nothing is connected yet.')).toBeVisible();

  // The dot-directory routes answer with the right names.
  const metadata = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json() as { issuer: string };
  expect(metadata.issuer).toBe(origin);
  const resource = await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json() as { resource: string };
  expect(resource.resource).toBe(`${origin}/mcp`);

  // Register as Claude Code would.
  const registered = await fetch(`${origin}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [CALLBACK] }),
  });
  expect(registered.status).toBe(201);
  const { client_id: clientId } = await registered.json() as { client_id: string };

  // Ask, in the browser, with a PKCE pair.
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(8).toString('hex');
  await page.goto(`${origin}/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge,
    code_challenge_method: 'S256', scope: 'content:read drafts:write', state, resource: `${origin}/mcp`,
  })}`);
  await expect(page).toHaveURL(/\/admin\/connect\?request=/);
  await expect(page.getByRole('heading', { name: 'Connect Claude Code to your site?' })).toBeVisible();
  await expect(page.getByText(/This is a program on this computer, not a website/)).toBeVisible();
  // It only calls itself Claude Code, so it gets no mark and the name is said to be its own.
  await expect(page.locator('.mcp-consent__host')).toHaveText('A program on this computer');
  await expect(page.locator('.mcp-consent__address')).toHaveText(new URL(CALLBACK).host);
  await expect(page.getByText('(the name it gave)')).toBeVisible();
  await expect(page.locator('.mcp-consent__mark .brand-mark')).toHaveCount(0);
  await shoot(page, 'consent', WIDE);
  await shoot(page, 'consent', NARROW);

  // Allow. The virtual authenticator from signIn answers the passkey re-check.
  let callback: URL | null = null;
  await page.route(`${CALLBACK}**`, (route) => {
    callback = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Connected.' });
  });
  await page.getByRole('button', { name: 'Allow with passkey' }).click();
  await page.waitForURL(/localhost:39999\/callback/, { timeout: 30_000 });
  const returned = callback as URL | null;
  expect(returned?.searchParams.get('state')).toBe(state);
  const code = returned?.searchParams.get('code');
  expect(code).toBeTruthy();
  await page.setViewportSize(WIDE);

  // Exchange the code as a server would: form-encoded, no Origin.
  const exchanged = await fetch(`${origin}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier }),
  });
  expect(exchanged.status).toBe(200);
  const { access_token: token } = await exchanged.json() as { access_token: string };
  expect(token).toBeTruthy();

  // Write a draft, then change it.
  const created = await mcp(token, 'create_draft', { kind: 'post', locale: 'en', title: 'Field notes', body: 'The first version, by the AI.' });
  const { id, updatedAt } = created.result as { id: string; updatedAt: string };
  await mcp(token, 'update_draft', { kind: 'post', id, updatedAt, body: 'The second version, by the AI.' });

  // Put it back from the editor.
  await page.goto(`${origin}/admin/edit/${id}`);
  const bar = page.getByRole('status').filter({ hasText: /Claude Code changed this draft at/ });
  await expect(bar).toBeVisible();
  await expect(page.getByText('The second version, by the AI.')).toBeVisible();
  await shoot(page, 'editor-bar', NARROW);
  await shoot(page, 'editor-bar', WIDE);
  await bar.getByRole('button', { name: 'Put back' }).click();
  await expect(page.getByText('The first version, by the AI.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('The second version, by the AI.')).toHaveCount(0);
  await expect(bar).toHaveCount(0);

  // The open editor shows the AI that read the draft, on its next check, and holds the draft.
  // Claude Code on this computer earns no mark, so the bar has the computer icon.
  const read = await mcp(token, 'get_post', { id });
  const status = page.getByRole('status').filter({ hasText: 'Claude Code read this draft 1 minute ago. While you have it open, an AI cannot change it.' });
  await expect(status).toBeVisible({ timeout: 20_000 });
  await expect(status.locator('.editing-status__mark .icon')).toBeVisible();
  await shoot(page, 'editing-status', NARROW);
  await shoot(page, 'editing-status', WIDE);
  const third = { kind: 'post', id, updatedAt: (read.result as { updatedAt: string }).updatedAt, body: 'The third version, by the AI.' };
  const held = await callTool(token, 'update_draft', third);
  expect(held.result?.isError).toBe(true);
  expect(held.result?.content[0]?.text).toMatch(/open in the editor/);

  // Closing the editor lets go of it: 45 s after its last check, the AI may write again.
  await page.goto(`${origin}/admin`);
  await page.waitForTimeout(50_000);
  await mcp(token, 'update_draft', third);
  await page.goto(`${origin}/admin/edit/${id}`);
  await expect(page.getByText('The third version, by the AI.')).toBeVisible();
  // The undo bar tells of the write; the status bar says only that the owner comes first.
  await expect(page.getByRole('status').filter({ hasText: /Claude Code changed this draft at/ })).toBeVisible();
  await expect(page.locator('.editing-status__ai')).toHaveText('While you have it open, an AI cannot change it.', { timeout: 20_000 });
  await expect(page.getByText('Claude Code changed this draft 1 minute ago.')).toHaveCount(0);

  // A new draft is the owner's from its first save, before the editor has ever been reloaded.
  const firstBeat = page.waitForResponse((response) => response.url().endsWith('/api/admin/editing') && response.ok(), { timeout: 20_000 });
  await page.goto(`${origin}/admin/new`);
  await page.locator('textarea.admin-title-input').fill('Owner notes');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Written by the owner.');
  await page.locator('.admin-save-state[data-state="saved"]').waitFor({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/admin\/edit\/[0-9a-f-]{36}$/);
  const newId = new URL(page.url()).pathname.split('/').pop()!;
  await firstBeat;
  const fresh = await mcp(token, 'get_post', { id: newId });
  const onNew = await callTool(token, 'update_draft', { kind: 'post', id: newId, updatedAt: (fresh.result as { updatedAt: string }).updatedAt, title: 'AI title' });
  expect(onNew.result?.isError).toBe(true);
  expect(onNew.result?.content[0]?.text).toMatch(/open in the editor/);
  // One status bar, from the editor itself, which tells of the read on its next check.
  await expect(page.locator('.editing-status')).toHaveCount(1, { timeout: 20_000 });
  await shoot(page, 'new-draft-status', NARROW);
  await page.setViewportSize(WIDE);

  // The card lists the connection; revoke it.
  await page.goto(`${origin}/admin/plugins`);
  await expect(card.getByText('Claude Code')).toBeVisible();
  // No mark, so the list says the name is the app's own, as the consent screen did.
  await expect(card.getByText('(the name it gave)')).toBeVisible();
  await expect(card.getByText(/A program on this computer · Reads and writes drafts/)).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await shoot(page, 'plugins-card', WIDE);
  await shoot(page, 'plugins-card', NARROW);
  await card.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(card.getByText('Nothing is connected yet.')).toBeVisible();
  expect((await mcp(token, 'get_site', {})).status).toBe(401);
});
