import type { APIRoute } from 'astro';

import { postPath } from '../lib/i18n';
import { postExcerpt } from '../lib/posts';
import { getPublicSiteUrl } from '../lib/seo';
import { escapeXml } from '../lib/xml';
import { listPublishedPosts } from '../server/content/published';
import { getSiteSettings } from '../server/content/settings';
import { POST_LOCALES } from '../types/cms';

export const GET: APIRoute = async ({ request, site }) => {
  try {
    const settings = await getSiteSettings();
    if (!settings) throw new Error('Site settings are unavailable.');
    // ponytail: cap each locale at 1,000 feed items; add feed pagination only when readers need it.
    const results = await Promise.all(POST_LOCALES.map((locale) => listPublishedPosts({ locale, limit: 1_000 })));
    const posts = results.flatMap(({ items }) => items).sort((left, right) => {
      const byDate = new Date(right.published_at!).getTime() - new Date(left.published_at!).getTime();
      return byDate || right.id.localeCompare(left.id);
    });
    const siteUrl = getPublicSiteUrl(request, site);
    const feedUrl = new URL('/rss.xml', siteUrl).toString();
    const channelUrl = new URL(`/${settings.default_locale}`, siteUrl).toString();
    const fallbackDescription = settings.site_description || settings.tagline || 'Latest published articles.';
    const items = posts.map((post) => {
      const url = new URL(postPath(post), siteUrl).toString();
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <description>${escapeXml(postExcerpt(post, fallbackDescription))}</description>`,
        `      <pubDate>${new Date(post.published_at!).toUTCString()}</pubDate>`,
        '    </item>',
      ].join('\n');
    }).join('\n');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      `    <title>${escapeXml(settings.site_name)}</title>`,
      `    <link>${escapeXml(channelUrl)}</link>`,
      `    <description>${escapeXml(fallbackDescription)}</description>`,
      `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
      items,
      '  </channel>',
      '</rss>',
      '',
    ].filter(Boolean).join('\n');

    return new Response(xml, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
        'Content-Type': 'application/rss+xml; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('RSS generation failed:', error);
    return new Response('RSS is temporarily unavailable.\n', {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      status: 503,
    });
  }
};
