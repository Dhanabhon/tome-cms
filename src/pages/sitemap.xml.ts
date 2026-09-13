import type { APIRoute } from 'astro';

import { pagePath, postPath } from '../lib/i18n';
import { getPublicSiteUrl } from '../lib/seo';
import { escapeXml } from '../lib/xml';
import { listPublishedPages, listPublishedPosts } from '../server/content/published';
import { getSiteSettings } from '../server/content/settings';
import { POST_LOCALES } from '../types/cms';

export const GET: APIRoute = async ({ request, site }) => {
  try {
    const settings = await getSiteSettings();
    if (!settings) throw new Error('Site settings are unavailable.');
    // ponytail: cap each content type at 1,000 URLs; add a sitemap index if either outgrows this limit.
    const [postResults, pageResults] = await Promise.all([
      Promise.all(POST_LOCALES.map((locale) => listPublishedPosts({ locale, limit: 1_000 }))),
      Promise.all(POST_LOCALES.map((locale) => listPublishedPages({ locale, limit: 1_000 }))),
    ]);
    const posts = postResults.flatMap(({ items }) => items);
    const pages = pageResults.flatMap(({ items }) => items);

    const siteUrl = getPublicSiteUrl(request, site);
    const entries: { lastModified?: string; location: string }[] = [
      { location: new URL('/th', siteUrl).toString() },
      { location: new URL('/en', siteUrl).toString() },
      ...posts.map((post) => ({
        lastModified: post.updated_at,
        location: new URL(postPath(post), siteUrl).toString(),
      })),
      ...pages.map((page) => ({
        lastModified: page.updated_at,
        location: new URL(pagePath(page), siteUrl).toString(),
      })),
    ];
    const urls = entries
      .map(
        ({ lastModified, location }) =>
          `  <url>\n    <loc>${escapeXml(location)}</loc>${lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : ''}\n  </url>`,
      )
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

    return new Response(xml, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
        'Content-Type': 'application/xml; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Sitemap generation failed:', error);
    return new Response('Sitemap is temporarily unavailable.\n', {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      status: 503,
    });
  }
};
