import type { BrandName } from '../../lib/brand-marks';

/**
 * The mark an AI app has earned: read from the host its approval goes to, or from the host of the
 * client document it identified itself with (CIMD). Both are things the app cannot choose for
 * itself; the name it gives is, and so the name never decides.
 */
const BY_HOST: Readonly<Record<string, BrandName>> = {
  'claude.ai': 'claude',
  'chatgpt.com': 'openai',
  'openai.com': 'openai',
};

function bareHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, '');
}

function hostBrand(host: string): BrandName | null {
  const bare = bareHost(host);
  for (const [domain, brand] of Object.entries(BY_HOST)) {
    if (bare === domain || bare.endsWith(`.${domain}`)) return brand;
  }
  return null;
}

export function isLoopbackHost(host: string): boolean {
  const bare = bareHost(host);
  return bare === '127.0.0.1' || bare === 'localhost' || bare === '[::1]';
}

export function clientBrand(clientId: string, redirectHost: string): BrandName | null {
  if (clientId.startsWith('https://')) {
    const fromDocument = URL.canParse(clientId) ? hostBrand(new URL(clientId).host) : null;
    if (fromDocument) return fromDocument;
  }
  return isLoopbackHost(redirectHost) ? null : hostBrand(redirectHost);
}
