import { categoryPath } from './i18n';
import type { PostCategoryBadge, PostLocale } from '../types/cms';

const XML_ESCAPES = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&apos;',
  '<': '&lt;',
  '>': '&gt;',
} as const;

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character as keyof typeof XML_ESCAPES]);
}

export interface SitemapEntry {
  lastModified?: string;
  location: string;
}

export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map(
      ({ lastModified, location }) =>
        `  <url>\n    <loc>${escapeXml(location)}</loc>${lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : ''}\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * The sitemap's category pages: one for each category with a live post in a language, the
 * default category never, as its page would not answer. Dated by the newest change to what the
 * page shows, when that is known.
 */
export function categorySitemapEntries(
  siteUrl: URL,
  lists: ReadonlyArray<{ items: readonly PostCategoryBadge[]; locale: PostLocale; modified: ReadonlyMap<string, Date> }>,
): SitemapEntry[] {
  return lists.flatMap(({ items, locale, modified }) => items.filter(({ is_default }) => !is_default).map((category) => {
    const at = modified.get(category.id);
    return { ...(at ? { lastModified: at.toISOString() } : {}), location: new URL(categoryPath(locale, category.slug), siteUrl).toString() };
  }));
}
