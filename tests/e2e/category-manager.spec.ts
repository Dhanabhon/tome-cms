import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { expect, test } from './own-worker';

/**
 * The category manager gives each category an address and a description in each language: made
 * from the name when the category is made, kept through a rename, changed only by the owner, and
 * refused with the field marked when another category has it or it is not an address. Uncategorized
 * has no page, so it takes a new name and nothing else, and its chip on the home follows the name.
 * It signs in once: /recovery allows five sign-ins per spec file.
 */

test.use({ stack: 'category-manager' });
test.skip(({ isMobile }) => Boolean(isMobile), 'The stack is set up once, on desktop; touch-targets-admin measures the form on a phone.');

const PROJECT = 'tomecms-category-manager-test';
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'compose.test.yaml'];
const CREDENTIAL = 'category-manager-secret-at-least-32-chars';
const OWNER = 'a7c3e1f0-2b4d-4e6f-8a1c-3d5e7f9b1c20';

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
    TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-category-manager',
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
    values (${OWNER}, 'Owner', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  await sql`insert into categories (owner_id, name, slug, is_default) values (${OWNER}, 'Uncategorized', 'uncategorized', true)`.execute(db);
  await sql`insert into categories (owner_id, name, slug, is_default) values (${OWNER}, 'Food', 'food', false)`.execute(db);
  // A published post in each, so the home has a chip for each to filter by.
  await sql.raw(`do $$
    declare g uuid;
    begin
      insert into post_translation_groups (owner_id) values ('${OWNER}') returning id into g;
      insert into posts (translation_group_id, locale, title, slug, excerpt, content_json, content_html, status, published_at, owner_id)
        values (g, 'en', 'Left as it is', 'left-as-it-is', '', '{"type":"doc","content":[]}'::jsonb, '<p>No category.</p>',
          'published', now() - interval '2 hours', '${OWNER}');
      insert into post_category_assignments (translation_group_id, category_id, owner_id)
        select g, id, owner_id from categories where owner_id = '${OWNER}' and is_default;
      insert into post_translation_groups (owner_id) values ('${OWNER}') returning id into g;
      insert into posts (translation_group_id, locale, title, slug, excerpt, content_json, content_html, status, published_at, owner_id)
        values (g, 'en', 'Rice for breakfast', 'rice-for-breakfast', '', '{"type":"doc","content":[]}'::jsonb, '<p>Rice.</p>',
          'published', now() - interval '1 hour', '${OWNER}');
      insert into post_category_assignments (translation_group_id, category_id, owner_id)
        select g, id, owner_id from categories where owner_id = '${OWNER}' and slug = 'food';
    end $$`).execute(db);
  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'pipe' });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  server.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk}`.slice(-4_000); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Category manager server exited early.\n${output}`);
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) return;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Category manager server never became ready.\n${output}`);
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

async function stored(name: string) {
  const { db } = await import('../../src/server/db/client');
  return db.selectFrom('categories').select(['slug', 'description_th', 'description_en'])
    .where('owner_id', '=', OWNER).where('name', '=', name).executeTakeFirst();
}

test('a category gets an address from its name, keeps it through a rename, and takes a new one and its descriptions when the owner edits them', async ({ context, page }) => {
  test.setTimeout(180_000);
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

  await page.goto(`${origin}/admin/categories`);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  // Uncategorized takes a new name, and nothing else: it has no page to address or describe, and it stays.
  const alert = page.locator('.category-manager [role="alert"]');
  const fallback = page.locator('.category-row').filter({ hasText: 'Uncategorized' });
  await expect(fallback.getByRole('button')).toHaveCount(1);
  await fallback.getByRole('button', { name: 'Edit Uncategorized' }).click();
  await expect(page.locator('.category-edit').getByRole('textbox')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Category name for Uncategorized' }).fill('Everything Else');
  await page.getByRole('button', { name: 'Save Everything Else' }).click();
  await expect(page.locator('.category-status')).toHaveText('Category “Everything Else” saved.');
  await expect(page.getByRole('button', { name: 'Edit Everything Else' })).toBeFocused();
  await expect(page.locator('.category-row').first()).toContainText('Default');
  expect(await stored('Everything Else')).toEqual({ slug: 'uncategorized', description_th: '', description_en: '' });
  // Its old name stays its own.
  await page.locator('#category-name').fill('uncategorized');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(alert).toHaveText('This name is kept for the default category.');
  // An address or a description for it is refused by the server, which names the field.
  const refusal = await page.evaluate(async () => {
    const list = await (await fetch('/api/admin/categories')).json() as { categories: Array<{ id: string; is_default: boolean }> };
    const id = list.categories.find(({ is_default }) => is_default)!.id;
    const response = await fetch('/api/admin/categories', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name: 'Everything Else', descriptionEn: 'All the rest.' }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  });
  expect(refusal).toMatchObject({ status: 400, body: { code: 'default_category_fixed', field: 'descriptionEn' } });

  // Made: the address comes from the name.
  await page.locator('#category-name').fill('Slow Mornings');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByRole('button', { name: 'Edit Slow Mornings' })).toBeVisible();
  expect(await stored('Slow Mornings')).toEqual({ slug: 'slow-mornings', description_th: '', description_en: '' });

  // Renamed: the address stays, so links to it keep working.
  await page.getByRole('button', { name: 'Edit Slow Mornings' }).click();
  const name = page.getByRole('textbox', { name: 'Category name for Slow Mornings' });
  const slug = page.getByRole('textbox', { name: 'URL name' });
  await expect(slug).toHaveValue('slow-mornings');
  await name.fill('Quiet Mornings');
  await page.getByRole('button', { name: 'Save Quiet Mornings' }).click();
  await expect(page.locator('.category-status')).toHaveText('Category “Quiet Mornings” saved.');
  await expect(page.getByRole('button', { name: 'Edit Quiet Mornings' })).toBeFocused();
  expect((await stored('Quiet Mornings'))?.slug).toBe('slow-mornings');

  // Another category's address is refused, the field marked and focused, and let go as the owner types.
  await page.getByRole('button', { name: 'Edit Quiet Mornings' }).click();
  await slug.fill('food');
  await page.getByRole('button', { name: 'Save Quiet Mornings' }).click();
  await expect(page.locator('.category-manager [role="alert"]')).toHaveText('Another category uses this URL name.');
  await expect(slug).toHaveAttribute('aria-invalid', 'true');
  await expect(slug).toBeFocused();
  // The error is the field's: a screen reader reads it with the field, beside the hint.
  await expect(slug).toHaveAccessibleDescription(/Another category uses this URL name\./);
  await slug.pressSequentially('-and-drink');
  await expect(slug).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.category-manager [role="alert"]')).toHaveCount(0);
  await expect(slug).not.toHaveAccessibleDescription(/Another category/);

  // So is one that is not an address.
  await slug.fill('Quiet Mornings');
  await page.getByRole('button', { name: 'Save Quiet Mornings' }).click();
  await expect(page.locator('.category-manager [role="alert"]')).toHaveText('Use lowercase letters, numbers, Thai and single hyphens in the URL name.');
  await expect(slug).toBeFocused();

  // A new address, Thai allowed, and a description in each language, each held to 160 characters.
  await slug.fill('เช้า-ช้า');
  const thai = page.getByRole('textbox', { name: /Description \(Thai\)/ });
  const english = page.getByRole('textbox', { name: /Description \(English\)/ });
  // Each field is named by its label alone; what helps fill it in is its description.
  await expect(slug).toHaveAccessibleName('URL name');
  await expect(slug).toHaveAccessibleDescription(/^The end of the category page’s URL/);
  for (const description of [thai, english]) {
    await expect(description).toHaveAccessibleDescription('Shown on the category page and in search results. Optional.');
  }
  await thai.fill('เรื่องเล่าตอนเช้า');
  await expect(page.locator('.category-edit label').filter({ has: thai })).toContainText('17/160');
  await english.fill('x'.repeat(170));
  await expect(english).toHaveValue('x'.repeat(160));
  await english.fill('  Stories for a slow start.  ');
  await page.getByRole('button', { name: 'Save Quiet Mornings' }).click();
  await expect(page.locator('.category-status')).toHaveText('Category “Quiet Mornings” saved.');
  expect(await stored('Quiet Mornings')).toEqual({ slug: 'เช้า-ช้า', description_th: 'เรื่องเล่าตอนเช้า', description_en: 'Stories for a slow start.' });

  // The form opens on what was saved, after a reload too.
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
  await page.getByRole('button', { name: 'Edit Quiet Mornings' }).click();
  await expect(slug).toHaveValue('เช้า-ช้า');
  await expect(english).toHaveValue('Stories for a slow start.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Quiet Mornings' })).toBeFocused();

  // A Thai site's admin says it all in Thai, the server's refusals included.
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  await sql`update site_settings set default_locale = 'th'`.execute(db);
  try {
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await page.locator('#category-name').fill('Food');
    await page.getByRole('button', { name: 'สร้างหมวดหมู่' }).click();
    await expect(page.locator('.category-manager [role="alert"]')).toHaveText('มีหมวดหมู่อื่นใช้ชื่อนี้แล้ว');
    await page.locator('#category-name').fill('Tea');
    await page.getByRole('button', { name: 'สร้างหมวดหมู่' }).click();
    await expect(page.locator('.category-status')).toHaveText('สร้างหมวดหมู่ “Tea” แล้ว');
  } finally {
    await sql`update site_settings set default_locale = 'en'`.execute(db);
  }

  // On the home, its chip carries the new name and still lists its posts alone.
  await page.goto(`${origin}/en`);
  const chip = page.getByRole('link', { name: 'Everything Else', exact: true });
  await expect(chip).toHaveAttribute('href', '/en?category=Everything+Else');
  await chip.click();
  await page.waitForURL(`${origin}/en?category=Everything+Else`);
  await expect(page.getByRole('link', { name: 'Left as it is' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rice for breakfast' })).toHaveCount(0);
});
