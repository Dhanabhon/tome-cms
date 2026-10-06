import type { APIRoute } from 'astro';

import { getPublicSiteUrl } from '../lib/seo';
import { robotsTxt } from '../lib/search-visibility';
import { getSiteSettings } from '../server/content/settings';
import { getServerEnv } from '../server/env';

export const GET: APIRoute = async ({ request, site }) => {
  const headless = getServerEnv().TOME_CMS_FRONTEND_MODE === 'headless';
  // Already read for this request by the middleware, so no second query.
  const hidden = !headless && Boolean((await getSiteSettings())?.hide_from_search);
  const sitemap = new URL('/sitemap.xml', getPublicSiteUrl(request, site)).toString();
  return new Response(robotsTxt({ headless, hidden, sitemap }), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
