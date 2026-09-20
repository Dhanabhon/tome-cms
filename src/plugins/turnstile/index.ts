import type { Plugin, PluginSettings, SignInVerdict, SignInWidget } from '../contract';

export { manifest } from './plugin';

/**
 * Cloudflare Turnstile.
 *
 * Both hooks answer as though the plugin were off until the layers that implement them:
 * the widget arrives before anything consults it, and the check arrives last. At every
 * step before that, the worst this can do is show a box that nothing reads.
 */
export function signInWidget(_settings: PluginSettings): SignInWidget | null {
  return null;
}

export async function verifySignIn(_input: {
  remoteIp: string | null;
  settings: PluginSettings;
  token: string | null;
}): Promise<SignInVerdict> {
  return { outcome: 'passed' };
}

const plugin: Plugin = { signInWidget, verifySignIn };
export default plugin;
