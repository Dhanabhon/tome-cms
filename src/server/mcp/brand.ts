import type { BrandName } from '../../lib/brand-marks';
import { bareHost, isLoopbackHost } from './redirects';

/**
 * The mark an AI app has earned: read from the host its approval goes to, or from the host of the
 * client document it identified itself with (CIMD). Both are things the app cannot choose for
 * itself; the name it gives is, and so the name never decides.
 */
const BY_HOST: ReadonlyMap<string, BrandName> = new Map([
  ['claude.ai', 'claude'],
  ['chatgpt.com', 'openai'],
  ['openai.com', 'openai'],
  ['platform.openai.com', 'openai'],
]);

/** Exact hosts only: a subdomain or a lookalike earns nothing. */
function hostBrand(host: string): BrandName | null {
  return BY_HOST.get(bareHost(host)) ?? null;
}

export function clientBrand(clientId: string, redirectHost: string): BrandName | null {
  if (clientId.startsWith('https://')) {
    const fromDocument = URL.canParse(clientId) ? hostBrand(new URL(clientId).host) : null;
    if (fromDocument) return fromDocument;
  }
  return isLoopbackHost(redirectHost) ? null : hostBrand(redirectHost);
}
