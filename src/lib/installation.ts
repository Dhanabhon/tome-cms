import { createServiceRoleSupabaseClient } from './supabase';
import type { SiteSettings } from '../types/cms';

const INSTALLATION_CACHE_MS = 5_000;

export interface InstallationReadiness {
  installed: boolean;
  mediaBucket: boolean;
  migration: boolean;
  secureConnection: boolean;
  serviceRole: boolean;
  supabase: boolean;
}

let installationCache: { expiresAt: number; installed: boolean } | undefined;
let settingsCache: { expiresAt: number; settings: SiteSettings | null } | undefined;

function isMissingTable(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export function isSecureRequest(request: Request) {
  if (!import.meta.env.PROD) return true;
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return forwardedProtocol === 'https' || new URL(request.url).protocol === 'https:';
}

export function markInstalled(installed: boolean) {
  installationCache = { expiresAt: Date.now() + INSTALLATION_CACHE_MS, installed };
  settingsCache = undefined;
}

export async function getSiteSettings() {
  if (settingsCache && settingsCache.expiresAt > Date.now()) return settingsCache.settings;

  try {
    const { data, error } = await createServiceRoleSupabaseClient()
      .from('site_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error) throw error;
    settingsCache = { expiresAt: Date.now() + INSTALLATION_CACHE_MS, settings: data };
    return data;
  } catch (error) {
    console.error('Site settings query failed:', error);
    return null;
  }
}

export async function isInstalled() {
  if (installationCache && installationCache.expiresAt > Date.now()) return installationCache.installed;
  if (
    !import.meta.env.PUBLIC_SUPABASE_URL ||
    !import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    markInstalled(false);
    return false;
  }

  try {
    const { data, error } = await createServiceRoleSupabaseClient()
      .from('site_settings')
      .select('id')
      .eq('id', true)
      .maybeSingle();

    if (error && !isMissingTable(error)) throw error;
    const installed = Boolean(data);
    markInstalled(installed);
    return installed;
  } catch (error) {
    console.error('Installation state check failed:', error);
    markInstalled(false);
    return false;
  }
}

export async function getInstallationReadiness(request: Request): Promise<InstallationReadiness> {
  const readiness: InstallationReadiness = {
    installed: false,
    mediaBucket: false,
    migration: false,
    secureConnection: isSecureRequest(request),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabase: false,
  };

  if (!readiness.serviceRole) return readiness;

  try {
    const supabase = createServiceRoleSupabaseClient();
    const [{ error: postsError }, settingsResult, bucketsResult] = await Promise.all([
      supabase.from('posts').select('id', { count: 'exact', head: true }),
      supabase.from('site_settings').select('id').eq('id', true).maybeSingle(),
      supabase.storage.listBuckets(),
    ]);

    readiness.supabase = !postsError;
    readiness.migration = !postsError && !settingsResult.error;
    readiness.installed = Boolean(settingsResult.data);
    readiness.mediaBucket =
      !bucketsResult.error && bucketsResult.data.some((bucket) => bucket.id === 'blog-media');

    if (settingsResult.error && !isMissingTable(settingsResult.error)) {
      console.error('Site settings readiness check failed:', settingsResult.error.message);
    }
    if (postsError) console.error('Posts readiness check failed:', postsError.message);
    if (bucketsResult.error) console.error('Storage readiness check failed:', bucketsResult.error.message);

    markInstalled(readiness.installed);
  } catch (error) {
    console.error('Installer readiness check failed:', error);
  }

  return readiness;
}
