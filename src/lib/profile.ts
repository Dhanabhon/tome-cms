import type { PostLocale, PublicAuthorProfile, SiteSettings } from '../types/cms';

export async function getPublicAuthorProfile(
  settings: Pick<SiteSettings, 'author_avatar_media_id' | 'author_bio_en' | 'author_bio_th' | 'author_links' | 'author_name'>,
  locale: PostLocale,
): Promise<PublicAuthorProfile | null> {
  if (!settings.author_name.trim()) return null;
  return {
    avatarUrl: settings.author_avatar_media_id ? `/media/${settings.author_avatar_media_id}` : null,
    bio: locale === 'th' ? settings.author_bio_th : settings.author_bio_en,
    links: settings.author_links,
    name: settings.author_name,
  };
}
