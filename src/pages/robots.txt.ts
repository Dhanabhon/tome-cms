import type { APIRoute } from 'astro';

import { getPublicSiteUrl } from '../lib/seo';
import { getServerEnv } from '../server/env';

export const GET: APIRoute = ({ request, site }) => {
  if (getServerEnv().TOME_CMS_FRONTEND_MODE === 'headless') {
    return new Response('User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n', {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

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
