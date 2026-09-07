import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

import { expect, test } from '@playwright/test';

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Installer test could not reserve a port.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startUninstalledServer() {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['./node_modules/astro/astro.js', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PUBLIC_SUPABASE_ANON_KEY: '',
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      PUBLIC_SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-installer-test',
    },
    stdio: 'pipe',
  });
  let output = '';
  const capture = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-4_000); };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Installer test server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/install`)).ok) return { child, origin };
    } catch {
      // The server is still starting.
    }
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Installer test server did not start.\n${output}`);
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

test('installer completion exposes and copies the fixed Admin URL without mobile overflow', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One browser project covers the isolated installer server.');
  const { child, origin } = await startUninstalledServer();

  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.route(`${origin}/api/install/status`, (route) => route.fulfill({
      contentType: 'application/json',
      json: {
        installed: false,
        mediaBucket: true,
        migration: true,
        provider: 'cloud',
        secureConnection: true,
        serviceRole: true,
        supabase: true,
      },
      status: 200,
    }));
    await page.route(`${origin}/api/install`, (route) => route.fulfill({
      contentType: 'application/json',
      json: { redirectTo: '/admin' },
      status: 201,
    }));

    await page.goto(`${origin}/install?lang=en`);
    await expect(page.getByText('Cloud ready', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Name your site' }).click();
    await page.getByRole('button', { name: 'Create owner account' }).click();
    await page.getByLabel('Sign-in email').fill('owner@example.com');
    await page.locator('input[name="password"]').fill('a-secure-password');
    await page.locator('input[name="passwordConfirm"]').fill('a-secure-password');
    await page.getByRole('button', { name: 'Review details' }).click();
    await page.getByLabel('Installation token').fill('test-token');
    await page.getByRole('button', { name: 'Install TomeCMS' }).click();

    const adminUrl = `${origin}/admin`;
    const field = page.getByLabel('Admin URL');
    await expect(field).toHaveValue(adminUrl);
    await expect(field).toHaveAttribute('aria-describedby', 'admin-url-help');
    await expect(page.getByRole('link', { name: 'Open Admin' })).toHaveAttribute('href', '/admin');
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(field).toBeVisible();
    }

    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(adminUrl);

    await page.waitForTimeout(2_600);
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: () => Promise.reject(new Error('Clipboard unavailable')),
      });
    });
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: 'URL selected' })).toBeVisible();
    expect(await field.evaluate((input: HTMLInputElement) => ({
      end: input.selectionEnd,
      length: input.value.length,
      start: input.selectionStart,
    }))).toEqual({ end: adminUrl.length, length: adminUrl.length, start: 0 });
  } finally {
    await stopServer(child);
  }
});
