import type { BrandName } from '../../lib/brand-marks';
import { bareHost, isLoopbackHost } from './redirects';

/** Where Claude's, ChatGPT's and Gemini's own approvals go. */
const BY_REDIRECT_HOST: ReadonlyMap<string, BrandName> = new Map([
  ['claude.ai', 'claude'],
  ['chatgpt.com', 'openai'],
  // Google's relay. The host alone is enough: only Google receives there, and of its addresses
  // redirects.ts allows only Gemini's own `/r/user_bound_custom-mcp-` ones (unless the owner adds another).
  ['oauth-redirect.googleusercontent.com', 'gemini'],
]);

/** Where their client documents (CIMD) are hosted, which covers Claude Code and Codex. */
const BY_DOCUMENT_HOST: ReadonlyMap<string, BrandName> = new Map([
  ['claude.ai', 'claude'],
  ['chatgpt.com', 'openai'],
  ['openai.com', 'openai'],
  ['platform.openai.com', 'openai'],
]);

/**
 * The mark an AI app has earned: read from the host its approval goes to, or from the host of the
 * client document it identified itself with (CIMD). Both are things the app cannot choose for
 * itself; the name it gives is, and so the name never decides.
 * Exact hosts only: a subdomain or a lookalike earns nothing.
 */
export function clientBrand(clientId: string, redirectHost: string): BrandName | null {
  if (clientId.startsWith('https://') && URL.canParse(clientId)) {
    const fromDocument = BY_DOCUMENT_HOST.get(bareHost(new URL(clientId).host));
    if (fromDocument) return fromDocument;
  }
  return isLoopbackHost(redirectHost) ? null : BY_REDIRECT_HOST.get(bareHost(redirectHost)) ?? null;
}
