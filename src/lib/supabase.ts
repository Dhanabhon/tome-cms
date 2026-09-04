import { createBrowserClient, createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, isAuthSessionMissingError, type SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

import type { Database } from '../types/cms';

let browserClient: SupabaseClient<Database> | undefined;

function publicConfig() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY must be configured.');
  }

  return { anonKey, url };
}

export function createBrowserSupabaseClient() {
  const { anonKey, url } = publicConfig();
  browserClient ??= createBrowserClient<Database>(url, anonKey);
  return browserClient;
}

export function createServerSupabaseClient(cookies: AstroCookies, request: Request) {
  const { anonKey, url } = publicConfig();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get('cookie') ?? ''),
      setAll: (cookiesToSet) => {
        for (const { name, options, value } of cookiesToSet) {
          cookies.set(name, value, options);
        }
      },
    },
  });
}

export function createServiceRoleSupabaseClient() {
  if (typeof window !== 'undefined') {
    throw new Error('The Supabase service-role client is server-only.');
  }

  const { url } = publicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be configured on the server.');
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authenticate(cookies: AstroCookies, request: Request) {
  const supabase = createServerSupabaseClient(cookies, request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && isAuthSessionMissingError(error)) return null;
  if (error) throw error;
  return user ? { supabase, user } : null;
}
