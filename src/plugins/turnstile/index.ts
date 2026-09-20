import type { Plugin, PluginSettings, SignInVerdict, SignInWidget } from '../contract';

export { manifest } from './plugin';

import { verifyTurnstileToken } from './verify';

/**
 * Cloudflare Turnstile.
 *
 * The widget is offered only when the check behind it can also be made: a site key without
 * a secret key would put a box on the sign-in form that nobody is able to verify, which
 * looks like security and is decoration.
 */
export function signInWidget(settings: PluginSettings): SignInWidget | null {
  const siteKey = settings.siteKey?.trim();
  if (!siteKey || !settings.secretKey?.trim()) return null;
  return {
    // Turnstile renders itself into any element carrying this class once its script loads,
    // and writes its answer into a hidden input it adds to the surrounding form.
    container: { className: 'cf-turnstile', dataset: { sitekey: siteKey, theme: 'auto' } },
    script: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
    tokenField: 'cf-turnstile-response',
  };
}

/**
 * A missing token is a refusal, and it has to be.
 *
 * Treating it as unavailable would let anything that simply omits the header past the
 * challenge, which is the whole of what the challenge does. The cost is real: a browser
 * that cannot load Cloudflare's script produces no token and is refused, so the refusal
 * says where the way out is rather than only that there was a wall.
 */
export async function verifySignIn(input: {
  remoteIp: string | null;
  settings: PluginSettings;
  token: string | null;
}): Promise<SignInVerdict> {
  const secret = input.settings.secretKey?.trim();
  if (!secret) return { outcome: 'unavailable', detail: 'no secret key stored' };
  if (!input.token) return { outcome: 'refused', detail: 'no token' };
  return verifyTurnstileToken({ remoteIp: input.remoteIp, secret, token: input.token });
}

const plugin: Plugin = { signInWidget, verifySignIn };
export default plugin;
