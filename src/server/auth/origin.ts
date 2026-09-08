const SAFE_METHODS = new Set(['GET', 'HEAD']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function assertSameOrigin(request: Request, configuredOrigin: string): void {
  const expected = new URL(configuredOrigin);
  if (expected.origin !== configuredOrigin) throw new Error('Configured origin must contain only an origin.');
  if (expected.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || !LOOPBACK_HOSTS.has(expected.hostname))) {
    throw new Error('HTTPS is required outside local development.');
  }

  const origin = request.headers.get('Origin');
  if (!origin && SAFE_METHODS.has(request.method)) return;
  if (origin !== expected.origin) throw new Error('Request origin is not allowed.');
}
