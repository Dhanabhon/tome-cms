const ADMIN_ORIGIN = 'https://admin.invalid';

export function safeAdminReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/admin';
  try {
    const url = new URL(value, ADMIN_ORIGIN);
    const isAdmin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    if (url.origin !== ADMIN_ORIGIN || !isAdmin) return '/admin';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/admin';
  }
}

export function adminLoginPath(path: string) {
  const target = safeAdminReturnTo(path);
  return target === '/admin' ? '/admin' : `/admin?returnTo=${encodeURIComponent(target)}`;
}
