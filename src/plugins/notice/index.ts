import type { Plugin, PluginSettings, PublicPage, SignInVerdict, SignInWidget, SiteNotice } from '../contract';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: this plugin is about the page a reader sees. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'the announcement bar does not guard anything' };
}

/**
 * The band, in the language the page is being read in.
 *
 * A site that wrote only one of the two shows that one in both, which is kinder than
 * showing nothing to half the readers over a field somebody had not got to yet.
 */
export function siteNotice(settings: PluginSettings, page: PublicPage): SiteNotice | null {
  const own = (page.locale === 'th' ? settings.textTh : settings.textEn)?.trim();
  const other = (page.locale === 'th' ? settings.textEn : settings.textTh)?.trim();
  const text = own || other;
  if (!text) return null;
  const href = settings.linkHref?.trim();
  const label = settings.linkLabel?.trim();
  return {
    colors: { background: settings.background || '#000000', text: settings.text || '#ffffff' },
    // Derived from the words, so a new message is shown again to a reader who closed the
    // last one, and the same message is not. Absent when the owner wants it to stay.
    ...(settings.dismissible !== 'off'
      ? { dismissKey: `notice-${[...text].reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 7)}` }
      : {}),
    text,
    ...(href && label ? { link: { href, label } } : {}),
  };
}

/** Only where there is something to close: a band that stays needs no script at all. */
export function publicClient(settings: PluginSettings, page: PublicPage) {
  return siteNotice(settings, page)?.dismissKey ? {} : null;
}

const plugin: Plugin = { publicClient, signInWidget, siteNotice, verifySignIn };
export default plugin;
