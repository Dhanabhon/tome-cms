/** The layouts an admin page can take while it loads (components/admin/AdminSkeleton.astro). */
export type AdminSkeletonKind = 'posts' | 'pages' | 'list' | 'media' | 'form' | 'editor';

const FORMS = new Set(['/profile', '/security', '/settings', '/system']);

/**
 * The layout of the admin page a URL leads to, so the navigation overlay can stand in for it
 * in its own shape. Null where no admin layout fits: another origin, the public site, a
 * preview (it renders the public post), or the admin path signed out, which is the sign-in
 * screen.
 */
export function transitionKind(url: URL, adminPath: string, origin: string): AdminSkeletonKind | null {
  if (url.origin !== origin) return null;
  if (url.pathname !== adminPath && !url.pathname.startsWith(`${adminPath}/`)) return null;
  if (url.searchParams.has('signin') || url.searchParams.has('returnTo')) return null;
  const path = url.pathname.slice(adminPath.length).replace(/\/+$/, '');
  if (/^(?:\/pages)?\/preview(?:\/|$)/.test(path)) return null;
  if (/^(?:\/pages)?\/(?:new|edit\/[^/]+)$/.test(path)) return 'editor';
  if (path === '') return 'posts';
  if (path === '/pages') return 'pages';
  if (path === '/media') return 'media';
  return FORMS.has(path) ? 'form' : 'list';
}
