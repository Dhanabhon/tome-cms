import { spawnSync } from 'node:child_process';

import type { Browser, BrowserContext } from '@playwright/test';

/**
 * The public page cache lives in the dev server's memory. A spec that changes the database from
 * its own process does it behind the app's back, and the page drawn before the change is served
 * again. In the app every such change is an owner's admin write, and an admin write clears the
 * cache; so a spec signs the owner in once and makes one after each change of its own.
 */
export interface Owner {
  origin: string;
  cookie: string;
}

/** One /recovery sign-in, in a context of its own, so the spec's pages stay signed out. */
export async function signInOwner(browser: Browser, origin: string, ownerId: string): Promise<Owner> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const enrollment = await issueRecoveryEnrollment(ownerId);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
  const owner = await ownerFrom(context, origin);
  await context.close();
  return owner;
}

/**
 * The owner as a signed-in context holds them. A recovery enrolment ends every other session, the
 * one signInOwner made included, so a spec that signs in again takes the new session from here.
 */
export async function ownerFrom(context: BrowserContext, origin: string): Promise<Owner> {
  const cookie = (await context.cookies(origin)).map(({ name, value }) => `${name}=${value}`).join('; ');
  return { origin, cookie };
}

/**
 * Clears the page cache with an admin write that changes nothing a page shows: the site is
 * already open. Synchronous, like the specs' psql helper it follows, so no caller has to await it.
 * Before the owner is signed in there is nothing to clear: the spec is still seeding, and no page
 * has been drawn yet.
 */
export function clearPageCache(owner: Owner | undefined): void {
  if (!owner) return;
  const { origin, cookie } = owner;
  const result = spawnSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'PUT',
    '-H', `origin: ${origin}`, '-H', `cookie: ${cookie}`, '-H', 'content-type: application/json',
    '--data', '{"enabled":false}', `${origin}/api/admin/maintenance/state`], { encoding: 'utf8', timeout: 30_000 });
  if (result.error) throw new Error(`Clearing the page cache could not run curl: ${result.error.message}`);
  if (result.stdout !== '200') throw new Error(`Clearing the page cache answered ${result.stdout || 'nothing'}. ${result.stderr ?? ''}`.trim());
}
