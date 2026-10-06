import type { APIRoute } from 'astro';

import { pagePath, postPath } from '../lib/i18n';
import { getPublicSiteUrl } from '../lib/seo';
import { categorySitemapEntries, sitemapXml, type SitemapEntry } from '../lib/xml';
import { listPublishedCategories, listPublishedPages, listPublishedPosts } from '../server/content/published';
import { getSiteSettings } from '../server/content/settings';
import { POST_LOCALES } from '../types/cms';

/** Every public address, each language's home first. */
async function listedEntries(siteUrl: URL): Promise<SitemapEntry[]> {
  // ponytail: cap each content type at 1,000 URLs; add a sitemap index if either outgrows this limit.
  const [postResults, pageResults, categoryResults] = await Promise.all([
    Promise.all(POST_LOCALES.map((locale) => listPublishedPosts({ locale, limit: 1_000 }))),
    Promise.all(POST_LOCALES.map((locale) => listPublishedPages({ locale, limit: 1_000 }))),
    Promise.all(POST_LOCALES.map(async (locale) => ({ locale, ...await listPublishedCategories(locale) }))),
  ]);
  return [
    { location: new URL('/th', siteUrl).toString() },
    { location: new URL('/en', siteUrl).toString() },
    ...categorySitemapEntries(siteUrl, categoryResults),
    ...postResults.flatMap(({ items }) => items).map((post) => ({
      lastModified: post.updated_at,
      location: new URL(postPath(post), siteUrl).toString(),
    })),
    ...pageResults.flatMap(({ items }) => items).map((page) => ({
      lastModified: page.updated_at,
      location: new URL(pagePath(page), siteUrl).toString(),
    })),
  ];
}

export const GET: APIRoute = async ({ request, site }) => {
  try {
    const settings = await getSiteSettings();
    if (!settings) throw new Error('Site settings are unavailable.');
    // A site kept out of search results lists nothing: a sitemap is an invitation to index.
    const xml = sitemapXml(settings.hide_from_search ? [] : await listedEntries(getPublicSiteUrl(request, site)));
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
