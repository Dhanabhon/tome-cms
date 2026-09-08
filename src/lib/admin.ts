const ADMIN_ORIGIN = 'https://admin.invalid';
const DEFAULT_ADMIN_PATH = '/admin';
const ADMIN_PATH_PATTERN = /^\/[a-z0-9][a-z0-9-]{1,39}$/;
const RESERVED_ADMIN_PATHS = new Set(['/api', '/install', '/health', '/_astro', '/blog', '/th', '/en']);

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
