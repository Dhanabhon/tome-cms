import type { PostAlternate, PostCategoryBadge, PublicCategory, PublicMedia, PublicNavigation, PublicPage, PublicPost, PublicSite } from '../../types/cms';
import type { PublishedPage, PublishedPost } from '../content/published';
import type { SiteSettings } from '../content/settings';
import type { ReadyMedia } from '../media/service';
import {
  publicCategorySchema,
  publicMediaSchema,
  publicNavigationSchema,
  publicPageSchema,
  publicPostSchema,
  publicSiteSchema,
} from './public-schemas';

export function serializePublicMedia(row: ReadyMedia): PublicMedia {
  return publicMediaSchema.parse({
    altText: row.alt_text,
    height: row.height,
    id: row.id,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    url: row.publicUrl,
    width: row.width,
  });
}

export function serializePublicCategory(row: PostCategoryBadge): PublicCategory {
  return publicCategorySchema.parse({ id: row.id, name: row.name });
}

function serializeTranslations(rows: readonly PostAlternate[]) {
  return rows.map((row) => ({ href: row.href, locale: row.locale }));
}

export function serializePublicPost(row: PublishedPost): PublicPost {
  return publicPostSchema.parse({
    categories: row.categories.map(serializePublicCategory),
    contentHtml: row.content_html,
    contentJson: row.content_json,
    coverImage: row.coverImage ? serializePublicMedia(row.coverImage) : null,
    createdAt: row.created_at,
    id: row.id,
    locale: row.locale,
    media: row.media.map(serializePublicMedia),
    publishedAt: row.published_at,
    seo: { description: row.meta_description, title: row.meta_title },
    slug: row.slug,
    status: row.status,
    title: row.title,
    translationGroupId: row.translation_group_id,
    translations: serializeTranslations(row.translations),
    updatedAt: row.updated_at,
  });
}

export function serializePublicPage(row: PublishedPage): PublicPage {
  return publicPageSchema.parse({
    contentHtml: row.content_html,
    contentJson: row.content_json,
    createdAt: row.created_at,
    id: row.id,
    locale: row.locale,
    media: row.media.map(serializePublicMedia),
    publishedAt: row.published_at,
    seo: { description: row.meta_description, title: row.meta_title },
    slug: row.slug,
    status: row.status,
    title: row.title,
    translationGroupId: row.translation_group_id,
    translations: serializeTranslations(row.translations),
    updatedAt: row.updated_at,
  });
}

export function serializePublicSite(row: SiteSettings, avatar: ReadyMedia | null = null): PublicSite {
  return publicSiteSchema.parse({
    author: row.author_name.trim() ? {
      avatar: avatar ? serializePublicMedia(avatar) : null,
      bio: { en: row.author_bio_en, th: row.author_bio_th },
      links: row.author_links.map(({ label, url }) => ({ label, url })),
      name: row.author_name,
    } : null,
    defaultLocale: row.default_locale,
    description: row.site_description,
    name: row.site_name,
    supportedLocales: ['th', 'en'],
    tagline: row.tagline,
    timezone: row.timezone,
    updatedAt: row.updated_at.toISOString(),
  });
}

export function serializePublicNavigation(row: PublicNavigation): PublicNavigation {
  return publicNavigationSchema.parse({
    footer: row.footer.map(({ href, kind, label }) => ({ href, kind, label })),
    header: row.header.map(({ href, kind, label }) => ({ href, kind, label })),
  });
}
