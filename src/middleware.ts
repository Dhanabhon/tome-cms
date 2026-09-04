import { defineMiddleware } from 'astro:middleware';

import { isInstalled } from './lib/installation';

const SETUP_PATHS = new Set(['/install', '/api/install', '/api/install/status']);

export const onRequest = defineMiddleware(async ({ redirect, url }, next) => {
  const { pathname } = url;
  if (SETUP_PATHS.has(pathname) || pathname.startsWith('/_astro/') || pathname === '/favicon.svg') {
    return next();
  }

  if (await isInstalled()) return next();

  if (pathname.startsWith('/api/')) {
    return Response.json(
      { error: 'TomeCMS must be installed before this API can be used.', setupUrl: '/install' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 },
    );
  }

  return redirect('/install', 302);
});
