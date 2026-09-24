/**
 * Everything a plugin is allowed to do.
 *
 * The core declares the hooks and a plugin implements the ones it needs. There is no hook
 * for "run some code on startup", none for reaching the database, and none for adding a
 * route, because a plugin that can do those is a plugin that can take the site down, and
 * the owner installing it has no way to know which kind they have.
 *
 * Two hooks is the smallest set that makes a challenge widget work, and a challenge widget
 * is the only plugin there is. The second one is what will show which of them was wrong.
 */

import type { BrandName } from '../lib/brand-marks';
import type { IconName } from '../lib/icons';
import type { PostLocale } from '../types/cms';

export type PluginSettings = Readonly<Record<string, string>>;

/** One answer a 'choice' offers: what is stored, and what the owner reads. */
export interface PluginSettingOption {
  label: { en: string; th: string };
  value: string;
}

/** A setting the admin renders a field for, and the API validates a write against. */
export interface PluginSetting {
  key: string;
  /**
   * A secret is encrypted at rest and never sent to a browser -- only whether it is set.
   * A switch is 'on' or 'off'. A colour is `#rrggbb`, which is the one shape that is safe to
   * put in a style attribute on a page every reader loads, so it is the only one accepted.
   * A choice is one of its `options`. An image is the id of a ready picture in this owner's
   * library, which the library then will not delete from under it.
   */
  kind: 'choice' | 'color' | 'image' | 'secret' | 'switch' | 'text';
  label: { en: string; th: string };
  hint?: { en: string; th: string };
  required: boolean;
  /** What a setting nobody has answered reads as. Every switch and colour declares one, so
   *  the core never has to guess what "missing" means for a plugin. */
  fallback?: string;
  /** Required by 'choice', and the only values a write may store for it. */
  options?: readonly PluginSettingOption[];
}

/**
 * The hooks the core declares, named so a manifest can say which it fills.
 *
 * The screen offering a plugin must not load it to find out what it does, and a sentence a
 * plugin wrote about itself is not an answer -- so a manifest names a hook from this closed
 * set and the core supplies the words. tests/unit/plugin-admin.test.ts holds each plugin to
 * what it declared: a plugin that names a hook has to implement it.
 *
 * 'signIn' is the admin's sign-in. 'publicPage' is every page a reader sees, and is the
 * larger of the two: see the note on publicClient.
 */
export type PluginHookId = 'editorSuggestions' | 'publicPage' | 'signIn';

export interface PluginManifest {
  description: { en: string; th: string };
  /** Where it acts, from the set above. */
  hooks: readonly PluginHookId[];
  /** The mark of the service this plugin talks to, where it talks to a named one. Named,
   *  not supplied: a plugin still cannot ship an image to the screen. */
  brand?: BrandName;
  /** One of the admin's own icons, used when there is no brand to show. */
  icon: IconName;
  id: string;
  name: string;
  /** A public address that shows this plugin at once, for the owner to look at. */
  previewHref?: string;
  settings: readonly PluginSetting[];
}

/**
 * What to put in the sign-in form.
 *
 * Data, not markup: the plugin describes and the form renders, so nothing a plugin returns
 * is ever written into the page as HTML, and the form keeps deciding what its own fields
 * look like.
 */
export interface SignInWidget {
  container: { className: string; dataset: Readonly<Record<string, string>> };
  /** Loaded once, asynchronously, before the widget is expected to appear. */
  script: string;
  /** The form field the widget writes its answer into. */
  tokenField: string;
}

/**
 * What a plugin found, not what should happen about it.
 *
 * `unavailable` is the case that matters: the third party could not be asked. Whether that
 * should stop someone signing in is a policy about this product's tolerance for locking its
 * owner out, and the core decides it in one place rather than letting each plugin restate
 * it -- or quietly disagree.
 */
export interface SignInVerdict {
  outcome: 'passed' | 'refused' | 'unavailable';
  /** For the log, never for the browser. */
  detail?: string;
}

/** Where the plugin has been asked. A plugin scopes itself; it does not go looking. */
export interface PublicPage {
  kind: 'home' | 'page' | 'post';
  locale: PostLocale;
}

/**
 * A band across the top of the page.
 *
 * Words and at most one link -- not markup, for the reason the sign-in widget is not markup:
 * a plugin describes and the core draws. The core owns the element, its classes, its colours
 * and its dismissal, and refuses a link that is neither same-origin nor https.
 */
export interface SiteNotice {
  /** The band's own colours, as `#rrggbb`. Absent means the core's. */
  colors?: { background: string; text: string };
  /** What closing it is remembered under. Derive it from the words and a new message is
   *  shown again; hard-code it and it is not. Absent means it cannot be closed at all. */
  dismissKey?: string;
  link?: { href: string; label: string };
  text: string;
}

/**
 * A box over the page: one picture from the library, words, and one link -- not markup, for
 * the reason the notice is not markup. The core draws it, checks the link as it checks the
 * notice's, and draws the picture only while it is still a ready image of this owner's.
 */
export interface SitePopup {
  action: { href: string; label: string };
  /** The words on the button that closes it. Absent means the core's. */
  decline?: string;
  /** Seconds, for `trigger: 'delay'`. */
  delaySeconds?: number;
  /** What closing it is remembered under. Derive it from its content and a new popup is shown again. */
  dismissKey: string;
  finePrint?: string;
  heading: string;
  imageId?: string;
  text?: string;
  trigger: 'delay' | 'exit';
}

/**
 * The draft an owner is writing, as it stands -- saved or not -- flattened to its words.
 *
 * Text rather than the editor's document: a plugin that judges an article has no business
 * with how the editor stores one, and nothing it returns can reach the document through this.
 */
export interface ArticleDraft {
  locale: PostLocale;
  text: string;
  title: string;
}

export interface Plugin {
  /** Null when the plugin has nothing to add -- unconfigured, or not that kind of plugin. */
  signInWidget(settings: PluginSettings): SignInWidget | null;
  verifySignIn(input: {
    remoteIp: string | null;
    settings: PluginSettings;
    token: string | null;
  }): Promise<SignInVerdict>;

  /** Null when this plugin has nothing to say on this page. */
  siteNotice?(settings: PluginSettings, page: PublicPage): SiteNotice | null;

  /** Null when this plugin has no popup for this page. */
  sitePopup?(settings: PluginSettings, page: PublicPage): SitePopup | null;

  /**
   * Whether this plugin's own client module runs on this page, and what it is told.
   *
   * The module is `src/plugins/<id>/client.ts`, reached through a registry of dynamic
   * imports the way the themes are, so a plugin that is off -- or that answers null here --
   * ships no bytes to the reader. The dataset reaches it as data-* attributes rather than
   * as a request.
   *
   * This runs plugin code in every reader's browser, which is a larger grant than the
   * sign-in hooks and is worth saying plainly. It is acceptable only because plugins ship
   * in this repository and cannot be installed at runtime: the module is reviewed in the
   * same commit as everything else. If runtime installation is ever added, this hook has
   * to be revisited before it is.
   */
  publicClient?(settings: PluginSettings, page: PublicPage): { dataset?: Readonly<Record<string, string>> } | null;

  /**
   * How likely the article belongs under each category, by category id. Null when it could
   * not be asked this time -- which the core reports as "did not answer", never as "no".
   *
   * A plugin supplies likelihoods and nothing else. Which of them become suggestions, and in
   * which band, is the core's policy, so no plugin can file an article or promote a guess.
   */
  categoryLikelihoods?(
    settings: PluginSettings,
    input: { article: ArticleDraft; categories: readonly { id: string; name: string }[] },
  ): Promise<Readonly<Record<string, number>> | null>;

  /**
   * Which of the passages the core found best introduces the article: `passage: null` when
   * none does, null when it could not be asked. The core keeps an answer only if it is one of
   * the passages it offered, so a plugin cannot put words on a card the owner did not write.
   */
  pickExcerpt?(
    settings: PluginSettings,
    input: { article: ArticleDraft; candidates: readonly string[] },
  ): Promise<{ passage: string | null } | null>;

  /**
   * Which of the passages best sums the article up for someone who found it in a search --
   * the description under its title there, and under a post's title on its own page. On
   * `pickExcerpt`'s terms, and kept on the same condition. A question of its own rather than
   * a flag on that one, so a plugin that only knows how to pick a card's line is never asked
   * for a summary it would answer with a teaser.
   */
  pickDescription?(
    settings: PluginSettings,
    input: { article: ArticleDraft; candidates: readonly string[] },
  ): Promise<{ passage: string | null } | null>;
}
