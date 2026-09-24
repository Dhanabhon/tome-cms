import type { Plugin, PluginSettings, PublicPage, SignInVerdict, SignInWidget, SitePopup } from '../contract';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: this plugin is about the page a reader sees. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'the popup does not guard anything' };
}

const DELAYS = new Set(['5', '10', '20']);

/** One language's words, trimmed. */
function words(settings: PluginSettings, language: 'En' | 'Th') {
  const read = (key: string) => settings[`${key}${language}`]?.trim() ?? '';
  return { action: read('action'), decline: read('decline'), finePrint: read('finePrint'), heading: read('heading'), text: read('text') };
}

/** The notice's hash, over a popup's content: a new popup is shown again, the same one is not. */
function hash(value: string): string {
  return [...value].reduce((total, character) => (total * 31 + character.codePointAt(0)!) >>> 0, 7).toString(36);
}

/**
 * The popup, in the language the page is read in when that language has one, and otherwise the
 * other language's whole -- never a Thai heading over an English button.
 */
export function sitePopup(settings: PluginSettings, page: PublicPage): SitePopup | null {
  if (settings.pages === 'home' && page.kind !== 'home') return null;
  const own = words(settings, page.locale === 'th' ? 'Th' : 'En');
  const chosen = own.heading ? own : words(settings, page.locale === 'th' ? 'En' : 'Th');
  const href = settings.actionHref?.trim() ?? '';
  if (!chosen.heading || !chosen.action || !href) return null;
  const imageId = settings.image?.trim() || undefined;
  return {
    action: { href, label: chosen.action },
    ...(chosen.decline ? { decline: chosen.decline } : {}),
    delaySeconds: Number(DELAYS.has(settings.delay ?? '') ? settings.delay : '10'),
    dismissKey: `popup-${hash(JSON.stringify([chosen, href, imageId ?? '']))}`,
    ...(chosen.finePrint ? { finePrint: chosen.finePrint } : {}),
    heading: chosen.heading,
    ...(imageId ? { imageId } : {}),
    ...(chosen.text ? { text: chosen.text } : {}),
    trigger: settings.trigger === 'exit' ? 'exit' : 'delay',
  };
}

/** The browser code opens it, so it runs only where there is something to open. */
export function publicClient(settings: PluginSettings, page: PublicPage) {
  return sitePopup(settings, page) ? {} : null;
}

const plugin: Plugin = { publicClient, signInWidget, sitePopup, verifySignIn };
export default plugin;
