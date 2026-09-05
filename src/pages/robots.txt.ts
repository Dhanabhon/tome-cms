import type { APIRoute } from 'astro';

import { getPublicSiteUrl } from '../lib/seo';

export const GET: APIRoute = ({ request, site }) => {
  const sitemap = new URL('/sitemap.xml', getPublicSiteUrl(request, site)).toString();
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
