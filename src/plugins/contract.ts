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

import type { IconName } from '../lib/icons';

export type PluginSettings = Readonly<Record<string, string>>;

/** A setting the admin renders a field for, and the API validates a write against. */
export interface PluginSetting {
  key: string;
  /** A secret is encrypted at rest and never sent to a browser -- only whether it is set. */
  kind: 'secret' | 'text';
  label: { en: string; th: string };
  hint?: { en: string; th: string };
  required: boolean;
}

/**
 * The hooks the core declares, named so a manifest can say which it fills.
 *
 * The screen offering a plugin must not load it to find out what it does, and a sentence a
 * plugin wrote about itself is not an answer -- so a manifest names a hook from this closed
 * set and the core supplies the words. tests/unit/plugin-admin.test.ts holds each plugin to
 * what it declared: a plugin that names a hook has to implement it.
 */
export type PluginHookId = 'signIn';

export interface PluginManifest {
  description: { en: string; th: string };
  /** Where it acts, from the set above. */
  hooks: readonly PluginHookId[];
  /** One of the admin's own icons, so a plugin cannot ship an image to the screen. */
  icon: IconName;
  id: string;
  name: string;
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

export interface Plugin {
  /** Null when the plugin has nothing to add -- unconfigured, or not that kind of plugin. */
  signInWidget(settings: PluginSettings): SignInWidget | null;
  verifySignIn(input: {
    remoteIp: string | null;
    settings: PluginSettings;
    token: string | null;
  }): Promise<SignInVerdict>;
}
