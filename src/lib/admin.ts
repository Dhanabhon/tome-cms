const ADMIN_ORIGIN = 'https://admin.invalid';
const DEFAULT_ADMIN_PATH = '/admin';
const ADMIN_PATH_PATTERN = /^\/[a-z0-9][a-z0-9-]{1,39}$/;
export const RESERVED_ADMIN_PATHS: ReadonlySet<string> = new Set([
  '/api',
  '/install',
  '/health',
  '/_astro',
  '/blog',
  '/th',
  '/en',
  '/recovery',
]);

export interface AdminPathSettings {
  admin_path: string;
}

export function normalizeAdminPath(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;
  return ADMIN_PATH_PATTERN.test(normalized) && !RESERVED_ADMIN_PATHS.has(normalized)
    ? normalized
    : DEFAULT_ADMIN_PATH;
}

export function matchAdminPath(pathname: string, adminPath: string): string | null {
  const base = normalizeAdminPath(adminPath);
  if (pathname === base) return '';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
}

/**
 * Where a draft is previewed: the rendered page, behind the owner's session.
 *
 * Both the list's Preview link and the editor's Preview button go through here, so the
 * two cannot drift apart again. They did once: the editors were moved onto
 * /api/v1/content/preview/<token>, the headless JSON endpoint, while the list kept the
 * page -- and the writer's preview tab filled with raw JSON.
 */
export function adminPreviewHref(settings: AdminPathSettings, contentType: 'page' | 'post', id: string): string {
  return adminHref(settings, contentType === 'post' ? `/preview/${id}` : `/pages/preview/${id}`);
}

export function adminHref(settings: AdminPathSettings, suffix = ''): string {
  const base = normalizeAdminPath(settings.admin_path);
  if (!suffix) return base;

  try {
    const internal = new URL(
      suffix.startsWith('/') || suffix.startsWith('?') || suffix.startsWith('#')
        ? `/admin${suffix}`
        : `/admin/${suffix}`,
      ADMIN_ORIGIN,
    );
    const matched = matchAdminPath(internal.pathname, DEFAULT_ADMIN_PATH);
    return matched === null ? base : `${base}${matched}${internal.search}${internal.hash}`;
  } catch {
    return base;
  }
}

export function safeAdminReturnTo(value: string | null | undefined, adminPath = DEFAULT_ADMIN_PATH) {
  const base = normalizeAdminPath(adminPath);
  if (!value || !value.startsWith('/') || value.startsWith('//')) return base;
  try {
    const url = new URL(value, ADMIN_ORIGIN);
    if (url.origin !== ADMIN_ORIGIN || matchAdminPath(url.pathname, base) === null) return base;
    return `${url.pathname}${url.search}`;
  } catch {
    return base;
  }
}

export function adminLoginPath(path: string, adminPath = DEFAULT_ADMIN_PATH) {
  const base = normalizeAdminPath(adminPath);
  const target = safeAdminReturnTo(path, base);
  if (base === DEFAULT_ADMIN_PATH) {
    return target === base ? base : `${base}?returnTo=${encodeURIComponent(target)}`;
  }
  return adminSignInPath(path, base);
}

export function adminSignInPath(path: string, adminPath = DEFAULT_ADMIN_PATH) {
  const base = normalizeAdminPath(adminPath);
  const target = safeAdminReturnTo(path, base);
  const params = new URLSearchParams({ signin: '1' });
  if (target !== base) params.set('returnTo', target);
  return `${base}?${params}`;
}

/**
 * What the admin top bar's post search sends besides the words typed. On the Posts list it
 * keeps the status and language filters in force and shows the current query; from any other
 * screen it starts from all posts.
 */
export function postSearchState(url: URL, postsPath: string): { hidden: Array<[string, string]>; query: string } {
  const trim = (path: string) => path.replace(/\/+$/, '') || '/';
  if (trim(url.pathname) !== trim(postsPath)) return { hidden: [], query: '' };
  const hidden = (['status', 'locale'] as const).flatMap((name): Array<[string, string]> => {
    const value = url.searchParams.get(name);
    return value ? [[name, value]] : [];
  });
  return { hidden, query: url.searchParams.get('q') ?? '' };
}

/** The sidebar's links, in order. Each one's id is also the name of its icon. */
export const ADMIN_NAV_IDS = ['posts', 'pages', 'media', 'navigation', 'profile', 'security', 'settings', 'appearance', 'themes', 'plugins', 'system'] as const;
export type AdminNavId = (typeof ADMIN_NAV_IDS)[number];

/**
 * The message an admin failure should show.
 *
 * The API answers in English because its contract is English, and an unexpected error is
 * more use in the server's own words than behind a sentence the admin made up. A *coded*
 * refusal is different: it is a rule the admin knows, written in the owner's language.
 */
export function apiErrorMessage(payload: unknown, copy: { contentRequired: string; failed: string }): string {
  const body = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null;
  if (body?.code === 'content_required') return copy.contentRequired;
  return typeof body?.error === 'string' ? body.error : copy.failed;
}
