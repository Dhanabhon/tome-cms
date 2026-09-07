import { expect, type Locator, type Page, type Request } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type SupabaseEnvName =
  | 'PUBLIC_SUPABASE_URL'
  | 'PUBLIC_SUPABASE_PUBLISHABLE_KEY'
  | 'PUBLIC_SUPABASE_ANON_KEY'
  | 'SUPABASE_SECRET_KEY'
  | 'SUPABASE_SERVICE_ROLE_KEY';

function requiredEnv(...names: SupabaseEnvName[]) {
  const value = names.map((name) => process.env[name]).find(Boolean);
  if (!value) throw new Error(`${names.join(' or ')} is required for E2E tests.`);
  return value;
}

export const supabaseUrl = requiredEnv('PUBLIC_SUPABASE_URL');
export const anonKey = requiredEnv('PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PUBLIC_SUPABASE_ANON_KEY');
export const admin = createClient(supabaseUrl, requiredEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const editorWrites = new WeakMap<Page, Set<Promise<void>>>();

export interface TestOwner {
  client: SupabaseClient;
  email: string;
  id: string;
  password: string;
}

export async function createOwner(label: string): Promise<TestOwner> {
  const email = `e2e-${label}-${crypto.randomUUID()}@example.com`;
  const password = `TomeCMS-${crypto.randomUUID()}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('Test owner was not created.');

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, email, id: data.user.id, password };
}

export async function deleteOwner(owner: TestOwner) {
  const { data: objects, error: listError } = await admin.storage
    .from('blog-media')
    .list(owner.id, { limit: 100 });
  if (listError) throw listError;
  if (objects.length) {
    const paths = objects.map((object) => `${owner.id}/${object.name}`);
    const { error: removeError } = await admin.storage.from('blog-media').remove(paths);
    if (removeError) throw removeError;
  }
  const { error } = await admin.auth.admin.deleteUser(owner.id);
  if (error) throw error;
}

export async function cleanupEditor(page: Page, ...owners: TestOwner[]) {
  if (!page.isClosed()) {
    await page.unrouteAll({ behavior: 'wait' });
    // Stop new writes, then drain existing writes before deleting their database rows.
    await page.route('**/*', (route) => /^(POST|PUT|PATCH|DELETE)$/.test(route.request().method()) ? route.abort() : route.continue());
    await Promise.all(editorWrites.get(page) ?? []);
    await page.close();
  }
  for (const owner of owners) {
    const { error: navigationError } = await admin.from('navigation_items').delete().eq('owner_id', owner.id);
    if (navigationError) throw navigationError;
    const { error: pagesError } = await admin.from('pages').delete().eq('author_id', owner.id);
    if (pagesError) throw pagesError;
    const { error } = await admin.from('posts').delete().eq('author_id', owner.id);
    if (error) throw error;
    await deleteOwner(owner);
  }
}

export async function leaseSiteOwner(owner: TestOwner) {
  const { data: original, error: readError } = await admin
    .from('site_settings')
    .select('*')
    .eq('id', true)
    .single();
  if (readError) throw readError;

  const { error: updateError } = await admin
    .from('site_settings')
    .update({ owner_id: owner.id })
    .eq('id', true);
  if (updateError) throw updateError;

  return async () => {
    const { error } = await admin
      .from('site_settings')
      .update({
        author_avatar_media_id: original.author_avatar_media_id,
        author_bio_en: original.author_bio_en,
        author_bio_th: original.author_bio_th,
        author_links: original.author_links,
        author_name: original.author_name,
        default_locale: original.default_locale,
        owner_id: original.owner_id,
        site_description: original.site_description,
        site_name: original.site_name,
        tagline: original.tagline,
        timezone: original.timezone,
        updated_at: original.updated_at,
      })
      .eq('id', true);
    if (error) throw error;
    // The app caches public settings for five seconds; prevent restored test state leaking into the next serial test.
    await new Promise((resolve) => setTimeout(resolve, 5_100));
  };
}

export async function signInAdmin(page: Page, owner: TestOwner) {
  if (!editorWrites.has(page)) {
    const writes = new Set<Promise<void>>();
    editorWrites.set(page, writes);
    page.on('request', (request) => {
      if (!/^(POST|PUT|PATCH|DELETE)$/.test(request.method())) return;
      const pending = new Promise<void>((resolve) => {
        const finished = (completed: Request) => {
          if (completed !== request) return;
          page.off('requestfinished', finished);
          page.off('requestfailed', finished);
          resolve();
        };
        page.on('requestfinished', finished);
        page.on('requestfailed', finished);
      });
      writes.add(pending);
      void pending.then(() => writes.delete(pending));
    });
  }
  await page.goto('/admin');
  await page.locator('input[name="email"]').fill(owner.email);
  await page.locator('input[name="password"]').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

export async function chooseUiOption(scope: Locator | Page, label: string, option: string) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await scope.getByRole('option', { name: option, exact: true }).click();
}
