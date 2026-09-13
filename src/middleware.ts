import type { APIContext, MiddlewareHandler, MiddlewareNext } from 'astro';

import { adminSignInPath, matchAdminPath, normalizeAdminPath } from './lib/admin';
import type { OwnerSession } from './server/auth/session';
import type { SiteSettings } from './server/content/site-settings';

const SETUP_PATHS = new Set([
  '/install',
  '/api/install/status',
  '/api/install/enroll',
  '/api/install/finalize',
]);

function isSetupBypass(pathname: string): boolean {
  return SETUP_PATHS.has(pathname)
    || pathname === '/api/auth'
    || pathname.startsWith('/api/auth/')
    || pathname === '/health/live'
    || pathname === '/health/ready'
    || pathname.startsWith('/_astro/')
    || pathname === '/favicon.svg';
}

function isHeadlessStablePath(pathname: string): boolean {
  return pathname === '/recovery'
    || pathname === '/api/recovery'
    || pathname.startsWith('/api/recovery/');
}

function installationRequired(context: APIContext): Response {
  if (context.url.pathname.startsWith('/api/')) {
    return Response.json(
      { error: 'TomeCMS must be installed before this API can be used.', setupUrl: '/install' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 },
    );
  }
  return context.redirect('/install', 302);
}

async function setBetterAuthLocals(context: APIContext, ownerId: string): Promise<OwnerSession | null> {
  const { getSession } = await import('./server/auth/session');
  const current = await getSession(context.request.headers);
  const owner = current?.user.id === ownerId ? current : null;
  context.locals.session = owner?.session ?? null;
  context.locals.user = owner?.user ?? null;
  return owner;
}

async function routeConfiguredAdmin(
  context: APIContext,
  next: MiddlewareNext,
  settings: SiteSettings,
): Promise<Response> {
  const { pathname, search, searchParams } = context.url;
  const adminPath = normalizeAdminPath(settings.admin_path);

  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
    await setBetterAuthLocals(context, settings.owner_id);
    return next();
  }

  const suffix = matchAdminPath(pathname, adminPath);
  if (suffix !== null) {
    const current = await setBetterAuthLocals(context, settings.owner_id);
    const isSignInPage = suffix === '' && searchParams.get('signin') === '1';
    if (!current && !isSignInPage) {
      return context.redirect(adminSignInPath(`${pathname}${search}`, adminPath), 302);
    }
    return next(`/admin${suffix}${search}`);
  }

  if (adminPath !== '/admin' && matchAdminPath(pathname, '/admin') !== null) {
    return new Response('Not found.', {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
  }

  return next();
}

export const preparedHeadlessRequest: MiddlewareHandler = async (context, next) => {
  if (isSetupBypass(context.url.pathname) || isHeadlessStablePath(context.url.pathname)) return next();
  const { getSiteSettings } = await import('./server/content/site-settings');
  const settings = await getSiteSettings();
  if (!settings) return installationRequired(context);
  return routeConfiguredAdmin(context, next, settings);
};

export const onRequest: MiddlewareHandler = preparedHeadlessRequest;
