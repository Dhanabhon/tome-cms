import { createServiceRoleSupabaseClient } from './supabase';
import type { PostLocale, PublicAuthorProfile, SiteSettings } from '../types/cms';

export async function getPublicAuthorProfile(
  settings: SiteSettings,
  locale: PostLocale,
): Promise<PublicAuthorProfile | null> {
  if (!settings.author_name.trim()) return null;

  let avatarUrl: string | null = null;
  if (settings.author_avatar_media_id) {
    const admin = createServiceRoleSupabaseClient();
    const { data, error } = await admin
      .from('media_items')
      .select('storage_path')
      .eq('id', settings.author_avatar_media_id)
      .eq('owner_id', settings.owner_id)
      .maybeSingle();
    if (error) throw error;
    if (data) avatarUrl = admin.storage.from('blog-media').getPublicUrl(data.storage_path).data.publicUrl;
  }

  return {
    avatarUrl,
    bio: locale === 'th' ? settings.author_bio_th : settings.author_bio_en,
    links: settings.author_links,
    name: settings.author_name,
  };
}
