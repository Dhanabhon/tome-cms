import type { APIRoute } from 'astro';

import { postPath } from '../lib/i18n';
import { getPublicSiteUrl } from '../lib/seo';
import { createServerSupabaseClient } from '../lib/supabase';

const escapeXml = (value: string) =>
  value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);

export const GET: APIRoute = async ({ cookies, request, site }) => {
  try {
    const { data: posts, error } = await createServerSupabaseClient(cookies, request)
      .from('posts')
      .select('locale, slug, updated_at')
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      // ponytail: one sitemap covers this small CMS; add a sitemap index if a site exceeds 1,000 posts.
      .limit(1_000);
    if (error) throw error;

    const siteUrl = getPublicSiteUrl(request, site);
    const entries: { lastModified?: string; location: string }[] = [
      { location: new URL('/th', siteUrl).toString() },
      { location: new URL('/en', siteUrl).toString() },
      ...posts.map((post) => ({
        lastModified: post.updated_at,
        location: new URL(postPath(post), siteUrl).toString(),
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
