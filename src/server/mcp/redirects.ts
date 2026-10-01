/**
 * Where an authorization code may be sent. A client registered by anyone (DCR, CIMD) still cannot
 * receive a code anywhere but here, so a forged client gets nothing even if the owner approves it.
 */
export const DEFAULT_REDIRECTS: readonly string[] = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(uri: string): URL | null {
  try {
    const url = new URL(uri);
    // A URL that normalizes to something else (dot segments, a different case) is not the one asked for.
    // A bare origin gains a trailing slash when parsed, which is the same address, so that is allowed.
    // A fragment is never allowed in a redirect URI (RFC 6749 3.1.2).
    return !url.hash && (url.href === uri || url.href === `${uri}/`) ? url : null;
  } catch {
    return null;
  }
}

/** http to this machine: a native app's redirect (RFC 8252), on whatever port it got. */
export function isLoopback(uri: string): boolean {
  const url = parse(uri);
  return Boolean(url && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password);
}

export function parseExtraRedirects(text: string): string[] {
  return text.split(',').map((entry) => entry.trim()).filter((entry) => {
    const url = parse(entry);
    return Boolean(url && (url.protocol === 'https:' || isLoopback(entry)) && !url.username && !url.password);
  });
}

export function redirectAllowed(uri: string, extra: readonly string[]): boolean {
  if (isLoopback(uri)) return true;
  return parse(uri) !== null && (DEFAULT_REDIRECTS.includes(uri) || extra.includes(uri));
}

/** A requested redirect against a client's registered ones: exact, except a loopback's port. */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  if (!isLoopback(requested)) return false;
  const wanted = new URL(requested);
  return registered.some((entry) => {
    if (!isLoopback(entry)) return false;
    const url = new URL(entry);
    return url.hostname === wanted.hostname && url.pathname === wanted.pathname && url.search === wanted.search;
  });
}
