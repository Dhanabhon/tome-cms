import { localePath, pagePath } from './i18n';
import { getSiteSettings } from './installation';
import { normalizeNavigationUrl } from './navigation-url';
import { createServiceRoleSupabaseClient } from './supabase';
import type { PageLocale, PublicNavigationItem } from '../types/cms';

if (typeof window !== 'undefined') throw new Error('Public navigation must be resolved on the server.');

export interface PublicNavigation {
  footer: PublicNavigationItem[];
  header: PublicNavigationItem[];
}

const cache = new Map<PageLocale, { expiresAt: number; navigation: PublicNavigation }>();
let cacheGeneration = 0;

export function invalidatePublicNavigationCache(): void {
  cache.clear();
  cacheGeneration++;
}

export async function getPublicNavigation(locale: PageLocale): Promise<PublicNavigation> {
  const cached = cache.get(locale);
  if (cached && cached.expiresAt > Date.now()) return cached.navigation;
  const generation = cacheGeneration;
  const navigation: PublicNavigation = { footer: [], header: [] };

  try {
    const settings = await getSiteSettings();
    if (!settings) return navigation;
    const supabase = createServiceRoleSupabaseClient();
    const { data: items, error } = await supabase.from('navigation_items')
      .select('id, kind, label, location, page_id, position, url')
      .eq('owner_id', settings.owner_id).eq('locale', locale)
      .order('position').order('id').limit(100);
    if (error) throw error;

    const pageIds = [...new Set((items ?? []).flatMap((item) => item.kind === 'page' && item.page_id ? [item.page_id] : []))];
    const pageUrls = new Map<string, string>();
    if (pageIds.length) {
      const { data: pages, error: pageError } = await supabase.from('pages')
        .select('id, slug').eq('author_id', settings.owner_id).eq('locale', locale)
        .eq('status', 'published').in('id', pageIds);
      if (pageError) throw pageError;
      for (const page of pages ?? []) pageUrls.set(page.id, pagePath({ locale, slug: page.slug }));
    }

    for (const item of items ?? []) {
      const href = item.kind === 'home' ? localePath(locale)
        : item.kind === 'page' ? pageUrls.get(item.page_id ?? '')
          : normalizeNavigationUrl(item.url ?? '');
      if (href && navigation[item.location].length < 50) {
        navigation[item.location].push({ href, kind: item.kind, label: item.label });
      }
    }
    // A read started before a successful PUT must not restore the invalidated cache.
    if (generation === cacheGeneration) cache.set(locale, { expiresAt: Date.now() + 5_000, navigation });
    return navigation;
  } catch (error) {
    console.error('Public navigation query failed:', error);
    return { footer: [], header: [] };
  }
}
