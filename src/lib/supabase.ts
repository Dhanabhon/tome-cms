import { createBrowserClient, createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, isAuthSessionMissingError, type SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';

import type { Database } from '../types/cms';

let browserClient: SupabaseClient<Database> | undefined;

function publicKey() {
  return import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
}

function adminKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    import.meta.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function hasSupabasePublicConfig() {
  return Boolean(import.meta.env.PUBLIC_SUPABASE_URL && publicKey());
}

export function hasSupabaseAdminKey() {
  return Boolean(adminKey());
}

export function supabaseDeploymentMode(): 'cloud' | 'local' | 'self-hosted' | 'unknown' {
  const configured = process.env.TOME_CMS_SUPABASE_MODE || import.meta.env.TOME_CMS_SUPABASE_MODE;
  if (configured === 'cloud' || configured === 'local' || configured === 'self-hosted') return configured;

  try {
    const hostname = new URL(import.meta.env.PUBLIC_SUPABASE_URL).hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return 'local';
    return hostname === 'supabase.co' || hostname.endsWith('.supabase.co') ? 'cloud' : 'self-hosted';
  } catch {
    return 'unknown';
  }
}

function publicConfig() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = publicKey();

  if (!url || !key) {
    throw new Error('PUBLIC_SUPABASE_URL and a Supabase publishable or anon key must be configured.');
  }

  return { key, url };
}

export function createBrowserSupabaseClient() {
  const { key, url } = publicConfig();
  browserClient ??= createBrowserClient<Database>(url, key);
  return browserClient;
}

export function createServerSupabaseClient(cookies: AstroCookies, request: Request) {
  const { key, url } = publicConfig();

  return createServerClient<Database>(url, key, {
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
  const key = adminKey();

  if (!key) {
    throw new Error('A Supabase secret or service-role key must be configured on the server.');
  }

  return createClient<Database>(url, key, {
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
