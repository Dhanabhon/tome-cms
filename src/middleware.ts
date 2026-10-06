import type { APIContext, MiddlewareHandler, MiddlewareNext } from 'astro';

import { adminSignInPath, matchAdminPath, normalizeAdminPath } from './lib/admin';
import { HIDDEN_FROM_SEARCH } from './lib/search-visibility';
import type { OwnerSession } from './server/auth/session';
import type { SiteSettings } from './server/content/site-settings';
import { invalidatePageCache, servePublicPage } from './server/http/page-cache';
import { renderDegraded, withRequestMemo } from './server/request-memo';
import { withStrictTransport } from './server/http/strict-transport';

const SETUP_PATHS = new Set([
  '/install',
  '/api/install/status',
  '/api/install/enroll',
  '/api/install/finalize',
]);

/** better-auth's own path; the response is a sign-in challenge, not an admin screen. */
const AUTHENTICATE_OPTIONS_PATH = '/api/auth/passkey/generate-authenticate-options';

const LOCALIZED_HOME = /^\/(?:th|en)\/?$/;
const LOCALIZED_POST = /^\/(?:th|en)\/blog\/[^/]+\/?$/;
const LOCALIZED_PAGE = /^\/(?:th|en)\/(?!blog(?:\/|$))[^/]+\/?$/;
const LEGACY_POST = /^\/blog\/[^/]+\/?$/;

export function isBundledFrontendPath(pathname: string): boolean {
  return pathname === '/'
    || pathname === '/sitemap.xml'
    || pathname === '/rss.xml'
    || LOCALIZED_HOME.test(pathname)
    || LOCALIZED_POST.test(pathname)
    || LOCALIZED_PAGE.test(pathname)
    || LEGACY_POST.test(pathname);
}

/**
 * What a closed site does with a path: draw the maintenance page, refuse a feed, refuse the
 * content API with the owner's words -- or leave it alone. Everything that is not a reader's
 * page or the public content stays open: the admin, sign-in, health, media, the API's own
 * description and the owner's previews.
 */
export function maintenanceRoute(pathname: string): 'api' | 'feed' | 'page' | null {
  if (pathname === '/sitemap.xml' || pathname === '/rss.xml') return 'feed';
  if (isBundledFrontendPath(pathname)) return 'page';
  if (!pathname.startsWith('/api/v1/content/')) return null;
  if (pathname === '/api/v1/content/openapi.json') return null;
  if (pathname === '/api/v1/content/preview' || pathname.startsWith('/api/v1/content/preview/')) return null;
  return 'api';
}

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
    || pathname === '/add-device'
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
    const { getServerEnv } = await import('./server/env');
    const { updateMaintenanceResponse } = await import('./server/update/maintenance');
    const maintenance = await updateMaintenanceResponse(context.request, getServerEnv().TOME_CMS_UPDATE_MODE);
    if (maintenance) return maintenance;
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

const CLOSED = 'The site is closed for maintenance.';

/**
 * A site closed for maintenance. A visitor gets 503 -- the page rewritten in place, so the address
 * does not change and a crawler sees the 503 where the page lives. The signed-in owner passes
 * through, marked private so no cache keeps what they were shown. Only while the site is closed
 * does a public request read the session at all.
 */
async function closedForMaintenance(context: APIContext, next: MiddlewareNext, settings: SiteSettings): Promise<Response | null> {
  if (!settings.maintenance_enabled) return null;
  const { pathname } = context.url;
  const route = maintenanceRoute(pathname);
  // A preflight answered 503 would hide the 503 that follows it from a headless site's browser.
  if (!route || (route === 'api' && context.request.method === 'OPTIONS')) return null;
  if (matchAdminPath(pathname, normalizeAdminPath(settings.admin_path)) !== null) return null;

  if (await setBetterAuthLocals(context, settings.owner_id)) {
    context.locals.maintenanceOwner = true;
    const response = await next();
    const own = new Response(response.body, response);
    own.headers.set('Cache-Control', 'private, no-store');
    return own;
  }

  const { maintenanceLocale, maintenanceNotice, retryAfter } = await import('./lib/site-maintenance');
  const locale = maintenanceLocale(context.url, settings.default_locale);
  if (route === 'page') {
    context.locals.maintenance = { locale, settings };
    return next('/maintenance');
  }
  const response = route === 'feed'
    ? new Response(`${CLOSED}\n`, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }, status: 503 })
    : (await import('./server/http/problem')).problem(context.request, 503, CLOSED, { maintenance: maintenanceNotice(settings, locale) });
  const retry = retryAfter(settings.maintenance_back_at, new Date());
  if (retry) response.headers.set('Retry-After', retry);
  return response;
}

export const preparedHeadlessRequest: MiddlewareHandler = async (context, next) => {
  if (context.url.pathname === AUTHENTICATE_OPTIONS_PATH) {
    const { withOwnerAllowedCredentials } = await import('./server/auth/allowed-credentials');
    return withOwnerAllowedCredentials(await next());
  }
  if (isSetupBypass(context.url.pathname) || isHeadlessStablePath(context.url.pathname)) return next();
  const { getSiteSettings } = await import('./server/content/site-settings');
  const settings = await getSiteSettings();
  if (!settings) return installationRequired(context);
  if (isBundledFrontendPath(context.url.pathname)) {
    const { getServerEnv } = await import('./server/env');
    if (getServerEnv().TOME_CMS_FRONTEND_MODE === 'headless') {
      return new Response('Not found.\n', {
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
        status: 404,
      });
    }
  }
  const response = await closedForMaintenance(context, next, settings) ?? await routeConfiguredAdmin(context, next, settings);
  return withSearchVisibility(response, context.url.pathname, settings.hide_from_search);
};

/**
 * A site kept out of search results says so on every public answer, not only in a page's
 * meta: a feed, the sitemap and the content API have no <head> to carry it. Applied to the
 * render, so the page cache keeps it with the page; saving the switch is an admin write,
 * which clears every page kept before it.
 */
export function withSearchVisibility(response: Response, pathname: string, hidden: boolean): Response {
  if (!hidden || !(isBundledFrontendPath(pathname) || pathname.startsWith('/api/v1/content/'))) return response;
  try {
    response.headers.set('X-Robots-Tag', HIDDEN_FROM_SEARCH);
    return response;
  } catch {
    // A redirect's headers are immutable; a copy takes the header.
    const copy = new Response(response.body, response);
    copy.headers.set('X-Robots-Tag', HIDDEN_FROM_SEARCH);
    return copy;
  }
}

/** An admin write that succeeded may have changed what a reader sees: the cached pages go. */
export function afterWrite(pathname: string, response: Response): Response {
  if (pathname.startsWith('/api/admin/') && response.status >= 200 && response.status < 300) invalidatePageCache();
  return response;
}

/**
 * A reader's page is answered from the page cache when it can be. A hit comes before the setup,
 * maintenance and admin checks inside `render`, which is safe: none of those situations ever
 * stores a page (the maintenance page and the owner's view are no-store or private).
 */
export async function cacheablePublicAnswer(
  context: Pick<APIContext, 'request' | 'url'>,
  render: () => Promise<Response>,
  deps: { bundled?: boolean; nextScheduled?: () => Promise<Date | null>; degraded?: () => boolean } = {},
): Promise<Response> {
  return servePublicPage({
    request: context.request,
    url: context.url,
    // Read raw, like HSTS: a hit must not wait on (or need) the runtime configuration.
    bundled: deps.bundled ?? (process.env.TOME_CMS_FRONTEND_MODE ?? 'bundled') === 'bundled',
    render,
    nextScheduled: deps.nextScheduled ?? (async () => (await import('./server/content/live')).nextScheduledPublish()),
    degraded: deps.degraded ?? renderDegraded,
  });
}

/** Reads are remembered for the request (see server/request-memo); a request that may write reads fresh. */
async function answer(context: APIContext, next: MiddlewareNext): Promise<Response> {
  // Reads are never refused, so they do not wait on (or need) the runtime configuration the guard reads.
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    const { getServerEnv } = await import('./server/env');
    const { crossSiteRefusal } = await import('./server/http/origin-guard');
    const refused = crossSiteRefusal(context.request, new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin);
    if (refused) return refused;
  }
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return afterWrite(context.url.pathname, (await preparedHeadlessRequest(context, next)) as Response);
  }
  return withRequestMemo(async () => cacheablePublicAnswer(context, async () => (await preparedHeadlessRequest(context, next)) as Response));
}

/** Every answer, refusals and redirects included, carries HSTS on an https: site. */
export const onRequest: MiddlewareHandler = async (context, next) => withStrictTransport(
  await answer(context, next),
  // Read raw, not through getServerEnv: /health/live answers before runtime configuration is loaded.
  process.env.TOME_CMS_PUBLIC_URL,
);
