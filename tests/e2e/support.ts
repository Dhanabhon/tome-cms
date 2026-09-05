import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requiredEnv(name: 'PUBLIC_SUPABASE_ANON_KEY' | 'PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for E2E tests.`);
  return value;
}

export const supabaseUrl = requiredEnv('PUBLIC_SUPABASE_URL');
export const anonKey = requiredEnv('PUBLIC_SUPABASE_ANON_KEY');
export const admin = createClient(supabaseUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

export async function signInAdmin(page: Page, owner: TestOwner) {
  await page.goto('/admin');
  await page.locator('input[name="email"]').fill(owner.email);
  await page.locator('input[name="password"]').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}
