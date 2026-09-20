import type { Plugin, PublicPage, SignInVerdict, SignInWidget } from '../contract';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: this plugin is about the page a reader sees. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'the lightbox does not guard anything' };
}

/** Only where an article's images are: a homepage of cards has nothing to open. */
export function publicClient(_settings: unknown, page: PublicPage) {
  return page.kind === 'home' ? null : {};
}

const plugin: Plugin = { publicClient, signInWidget, verifySignIn };
export default plugin;
