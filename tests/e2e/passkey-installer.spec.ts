import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

import { expect, test } from '@playwright/test';

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const testCredential = 'x'.repeat(48);

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve an installer test port.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startInstallerServer() {
  const port = await availablePort();
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['./node_modules/astro/astro.js', 'dev', '--host', 'localhost', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://tomecms:test@127.0.0.1:9/tomecms',
      DATABASE_CONNECTION_TIMEOUT_MS: '100',
      DATABASE_QUERY_TIMEOUT_MS: '100',
      TOME_CMS_PUBLIC_URL: origin,
      TOME_CMS_INSTALL_TOKEN: testCredential,
      BETTER_AUTH_SECRET: testCredential,
      TOME_CMS_CONTEXT_SECRET: testCredential,
      TOME_CMS_RECOVERY_PEPPER: testCredential,
      S3_ENDPOINT: origin,
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: testCredential,
      S3_BUCKET: 'tomecms-test-media',
      S3_FORCE_PATH_STYLE: 'true',
      MEDIA_PUBLIC_URL: `${origin}/media`,
      TOME_CMS_FRONTEND_MODE: 'bundled',
      TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-passkey-installer-test',
    },
    stdio: 'pipe',
  });
  let output = '';
  const capture = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-4_000); };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Installer server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/install?lang=en`)).ok) return { child, origin };
    } catch {
      // Astro is still starting.
    }
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Installer server did not start.\n${output}`);
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

test('six-step installer preserves safe values and registers a primary Passkey', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Virtual WebAuthn is covered once in Chromium.');
  const { child, origin } = await startInstallerServer();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  let enrollmentAttempts = 0;
  let finalizeBody: Record<string, unknown> | null = null;

  try {
    await page.route(`${origin}/api/install/status`, (route) => route.fulfill({
      contentType: 'application/json',
      json: {
        installed: false,
        ready: true,
        checks: { database: 'ready', migrations: 'ready', storage: 'deferred', relyingParty: 'ready' },
        rp: { id: 'localhost', name: 'TomeCMS', origin },
      },
      status: 200,
    }));
    await page.route(`${origin}/api/install/enroll`, (route) => {
      enrollmentAttempts += 1;
      if (enrollmentAttempts === 1) return route.fulfill({ contentType: 'application/json', json: { error: 'The installation token is not valid.' }, status: 401 });
      return route.fulfill({ contentType: 'application/json', json: { context: 'signed-context', expiresAt: new Date(Date.now() + 600_000).toISOString(), rp: { id: 'localhost', name: 'TomeCMS' } }, status: 201 });
    });
    await page.route(/\/api\/auth\/passkey\/generate-register-options/, (route) => route.fulfill({
      contentType: 'application/json',
      json: {
        challenge: 'AAECAwQFBgcICQoLDA0ODw',
        rp: { id: 'localhost', name: 'TomeCMS' },
        user: { id: 'cGVuZGluZy1vd25lcg', name: 'owner@example.com', displayName: 'owner@example.com' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        timeout: 60_000,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: [],
      },
      status: 200,
    }));
    await page.route(`${origin}/api/auth/passkey/verify-registration`, (route) => route.fulfill({
      contentType: 'application/json',
      json: { id: 'passkey-id', name: 'Primary passkey', userId: 'pending-owner', session: { id: 'session-id' }, user: { id: 'pending-owner' } },
      status: 200,
    }));
    await page.route(`${origin}/api/install/finalize`, (route) => {
      finalizeBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        contentType: 'application/json',
        json: { recoveryCodes: Array.from({ length: 10 }, (_, index) => `code-${index}-0123456789abcdef`), redirectTo: '/studio' },
        status: 201,
      });
    });

    await page.goto(`${origin}/install?lang=en`);
    const progress = page.getByRole('progressbar');
    await expect(progress.first()).toHaveAttribute('aria-valuenow', '1');
    await expect(progress.nth(1)).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByText('Deferred', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Name your site' }).click();
    await page.getByLabel('Site name').fill('Tome Notes');
    await page.getByLabel('Tagline').fill('Ideas worth keeping');
    await page.getByLabel('Admin path').fill('/studio');
    await page.getByRole('button', { name: /Owner identity/ }).click();
    await page.getByLabel('Owner email').fill('owner@example.com');
    await page.getByRole('button', { name: /Verify installation token/ }).click();

    await page.getByLabel('Installation token').fill('wrong-token');
    await page.getByRole('button', { name: /Verify token/ }).click();
    await expect(page.getByRole('alert')).toContainText('installation token is not valid');
    await expect(page.getByLabel('Installation token')).toHaveValue('');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Owner email')).toHaveValue('owner@example.com');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Site name')).toHaveValue('Tome Notes');
    await page.getByRole('button', { name: /Owner identity/ }).click();
    await page.getByRole('button', { name: /Verify installation token/ }).click();
    await page.getByLabel('Installation token').fill('correct-token');
    await page.getByRole('button', { name: /Verify token/ }).click();

    await expect(progress.first()).toHaveAttribute('aria-valuenow', '5');
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    await page.getByRole('button', { name: /Create Passkey and install/ }).click();
    await expect(progress.first()).toHaveAttribute('aria-valuenow', '6');
    await expect(page.getByLabel('One-time recovery codes')).toContainText('code-9');
    expect(finalizeBody).toMatchObject({ adminPath: '/studio', context: 'signed-context', email: 'owner@example.com', tagline: 'Ideas worth keeping' });
    expect(finalizeBody).not.toHaveProperty('installationToken');
    await expect(page.getByRole('button', { name: /Continue to Admin/ })).toBeDisabled();
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: /Continue to Admin/ })).toBeEnabled();
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.send('WebAuthn.disable');
    await stopServer(child);
  }
});
