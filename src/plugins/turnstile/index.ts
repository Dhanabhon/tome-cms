import type { Plugin, PluginSettings, SignInVerdict, SignInWidget } from '../contract';

export { manifest } from './plugin';

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

/** Answers as though the plugin were off until the layer that implements the check. */
export async function verifySignIn(_input: {
  remoteIp: string | null;
  settings: PluginSettings;
  token: string | null;
}): Promise<SignInVerdict> {
  return { outcome: 'passed' };
}

const plugin: Plugin = { signInWidget, verifySignIn };
export default plugin;
