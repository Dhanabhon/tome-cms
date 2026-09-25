---
title: Writing a plugin
description: Fill the hooks the core declares, describe the plugin in its manifest, register it, and switch it off from a shell when you need to.
sidebar:
  order: 2
---

A plugin adds to TomeCMS through hooks the core declares, from a closed set of three. No hook runs code when the server starts, reaches the database or adds a route. A plugin that could do those could take the site down, and the owner switching it on would have no way to tell.

Plugins ship in the repository. The owner switches them on and sets them up on the Plugins screen, as [Cloudflare Turnstile](/tome-cms/plugins/turnstile/) describes, and nothing installs a plugin while the site runs.

A plugin is a directory under `src/plugins/`, and the directory's name is the plugin's id.

| File | What it holds |
| --- | --- |
| `plugin.ts` | The manifest |
| `index.ts` | The hooks, each exported by name, and a default export typed `Plugin` |
| `client.ts` | Browser code, for a plugin that runs some on public pages |

## The hooks

`src/plugins/contract.ts` declares the hooks and the methods that fill them. The band on each card of the Plugins screen names the hooks in the core's words.

| Hook | On the Plugins screen | Methods |
| --- | --- | --- |
| `signIn` | "Admin sign-in" | `signInWidget` and `verifySignIn` |
| `publicPage` | "Every public page" | At least one of `siteNotice`, `sitePopup` and `publicClient` |
| `editorSuggestions` | "Suggestions while writing" | At least one of `categoryLikelihoods`, `pickExcerpt` and `pickDescription` |

The `Plugin` type requires `signInWidget` and `verifySignIn` of every plugin. One that does not guard the sign-in returns `null` from the first and `{ outcome: 'passed' }` from the second, as the lightbox does.

Every method is given the plugin's settings. The public page methods are also given the page they are asked about, as a `PublicPage`: its `kind`, which is `home`, `page` or `post`, and its `locale`. A plugin decides from these whether it has anything to add there, and returns `null` when it has not.

## Plugins describe, the core draws

A plugin returns data, and the core decides how it looks and what follows from it. Nothing a plugin returns is written into a page as HTML.

- `signInWidget` returns the class name and data attributes of a container, a script to load, and the name of the form field the widget writes its answer into. The sign-in form renders it.
- `siteNotice` returns words and at most one link, with the band's colours as `#rrggbb` and a key that closing it is remembered under, both optional. The core draws the band, with a close button when there is a key, and drops a link that is neither on the site nor `https`.
- `sitePopup` returns a heading, words, one link and a picture from the library by its id, with when it opens (`trigger`, after `delaySeconds` or as the reader leaves), the language of its words, and a key that closing it is remembered under. The core drops the whole popup when its heading or its link's label is empty, when the link is neither on the site nor `https`, or when the key is not 1 to 80 letters, digits and hyphens. It draws the picture only while it is still a ready image in the owner's library.
- `verifySignIn` says what it found: `passed`, `refused` or `unavailable`, with a `detail` for the log. The core decides what follows. A refused attempt is refused. An unavailable one, where the third party could not be asked, is logged and goes on to the passkey, and a plugin that throws counts as unavailable. So a plugin that breaks, or a service that is down, does not lock the owner out.
- `categoryLikelihoods` returns how likely the article belongs under each category, by category id. `pickExcerpt` and `pickDescription` choose one of the passages the core offered. The core decides which likelihoods become suggestions, keeps a passage only if it is one it offered, and treats `null` as "did not answer".

The core draws the band and the popup, but the browser code that opens a popup and closes a band is not in the core. It is in `src/plugins/popup/client.ts` and `src/plugins/notice/client.ts`, and each loads only through its own plugin's `publicClient`. A plugin of yours that returns `sitePopup`, or a `siteNotice` with a key, also returns `publicClient` for the same pages and ships a `client.ts` that does that work. Without one, the popup is drawn and never opens, and the band's close button does nothing.

The core also limits how many plugins act at once. One plugin stands in front of the sign-in, and a page carries at most one band and one popup. When several are switched on, the first in the registry's order that answers is the one used.

`publicClient` is the one hook that runs a plugin's own code in every reader's browser. It returns `null`, or an object whose `dataset` reaches the browser as `data-*` attributes on a hidden mount point. The core then loads `src/plugins/<id>/client.ts` with a dynamic import and calls its default export with that mount point. A plugin that is off, or that returns `null` for the page, sends the reader nothing. This much is allowed only because plugins ship in the repository and are reviewed in the same commits as everything else.

A plugin ships no stylesheet. The rules for what its browser code draws go in the core's `src/styles/global.css`, written with the design tokens, where the lightbox's are.

## Settings

A plugin lists its settings in its manifest. The core draws a field for each one under "Set up", checks every save against the list, and hands the plugin the stored values as `PluginSettings`, a record of strings.

| Kind | What a save may store |
| --- | --- |
| `text` | Any text, trimmed |
| `secret` | Text that is stored encrypted with `TOME_CMS_CONTEXT_SECRET` and never sent back to a browser. The screen is told only whether one is stored, and a blank field keeps it. |
| `switch` | `on` or `off` |
| `color` | A colour as `#rrggbb`, the only form that is safe in a style attribute on every public page |
| `choice` | One of the setting's `options` |
| `image` | The id of a ready picture in the owner's library, which the library then refuses to delete |

Each setting also has a `key`, a `label` and an optional `hint`, the last two as `{ en, th }`. `required: true` means the plugin says "Not set up yet" and cannot be switched on while the setting is empty. `fallback` is what a setting nobody has answered reads as. Give every switch and colour one. A choice's `fallback` has to be one of its `options`, and only a choice lists options.

A save that leaves a setting out keeps what is stored, which is how the switch on a card turns a plugin on or off without sending its fields. A secret that cannot be opened, because `TOME_CMS_CONTEXT_SECRET` changed, reaches the plugin as missing rather than as ciphertext.

## The manifest

`plugin.ts` exports the manifest, kept apart from the hooks so the admin can draw a plugin's card without loading the plugin.

| Field | What it is |
| --- | --- |
| `id` | The directory's name, and the id `npm run plugin:disable` takes |
| `name` | The card's title, the same in both languages |
| `description` | One sentence for the card, as `{ en, th }` |
| `hooks` | The hooks it fills, from the three above |
| `icon` | One of the admin's own icons, named from `src/lib/icons.ts` |
| `brand` | The mark of the service the plugin talks to, named from `src/lib/brand-marks.ts` and shown in place of the icon. Optional. |
| `previewHref` | An address on the public site that shows the plugin at once. While the plugin is on, "Set up" offers "Preview on the site". Optional. |
| `settings` | The settings above, in the order the form shows them |

The card draws only the core's icons and marks and the core's words for each hook. `tests/unit/plugin-admin.test.ts` holds every plugin to its manifest: each hook it names has to be implemented, and its icon has to exist.

## A plugin from start to finish

This plugin puts a "Back to top" button on posts, or on every page. Its manifest has one setting, a choice:

```ts
import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'A button that takes the reader back to the top of a long page.',
    th: 'ปุ่มที่พาผู้อ่านกลับขึ้นไปบนสุดของหน้ายาว ๆ',
  },
  hooks: ['publicPage'],
  icon: 'up',
  id: 'totop',
  name: 'Back to top',
  settings: [
    {
      fallback: 'post',
      key: 'where',
      kind: 'choice',
      label: { en: 'Where', th: 'แสดงที่' },
      options: [
        { label: { en: 'Posts', th: 'บทความ' }, value: 'post' },
        { label: { en: 'Every page', th: 'ทุกหน้า' }, value: 'all' },
      ],
      required: false,
    },
  ],
};
```

`index.ts` fills the hook, and answers the two sign-in methods with nothing:

```ts
import type { Plugin, PluginSettings, PublicPage, SignInVerdict, SignInWidget } from '../contract';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: this plugin is about the page a reader sees. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'back to top does not guard anything' };
}

export function publicClient(settings: PluginSettings, page: PublicPage) {
  if (settings.where !== 'all' && page.kind !== 'post') return null;
  return { dataset: { label: page.locale === 'th' ? 'กลับขึ้นบนสุด' : 'Back to top' } };
}

const plugin: Plugin = { publicClient, signInWidget, verifySignIn };
export default plugin;
```

`client.ts` runs in the reader's browser, and reads the label from the mount point:

```ts
export default function wireBackToTop(mount: HTMLElement): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'back-to-top';
  button.textContent = mount.dataset.label ?? 'Back to top';
  button.addEventListener('click', () => window.scrollTo({ top: 0 }));
  mount.replaceWith(button);
}
```

The `.back-to-top` rule goes in `src/styles/global.css`. `src/plugins/lightbox/` is the smallest plugin that ships, and is built the same way.

## Registering a plugin

1. Add the id to `PLUGINS` in `src/plugins/registry.ts`, as a dynamic import:

   ```ts
   const PLUGINS = {
     lightbox: () => import('./lightbox'),
     notice: () => import('./notice'),
     popup: () => import('./popup'),
     totop: () => import('./totop'),
     turnstile: () => import('./turnstile'),
     typesafe: () => import('./typesafe'),
   } as const;
   ```

2. Add its manifest to `PLUGIN_MANIFESTS` in `src/plugins/manifests.ts`:

   ```ts
   import { manifest as totop } from './totop/plugin';

   export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [turnstile, notice, popup, lightbox, typesafe, totop];
   ```

3. Run `npm run check` and `npm run test:unit`.

`client.ts` needs no entry anywhere: the core finds it by the plugin's id. The order of `PLUGINS` is the order plugins are asked in, and the order of `PLUGIN_MANIFESTS` is the order of the cards on the Plugins screen.

The registry is also what holds a plugin to the contract. It returns each module as a `Plugin`, so a module whose exports do not fit fails `npm run check`.

## Switching a plugin off from a shell

A plugin can be switched off from a terminal in the checkout, which reads `.env.local`:

```sh
npm run plugin:disable totop
npm run plugin:disable totop -- --forget
```

The first switches the plugin off and keeps its settings, and prints `totop is off.` The second clears its settings as well, which the admin cannot do, since a blank field there keeps what is stored. A plugin that was never saved on this site gets `totop was not switched on.` An id that is not installed gets the usage line and the list of installed ids.

This is the way back in when a plugin stands between you and the admin, such as a sign-in challenge that will not load. [Getting back in](/tome-cms/running/recovery/) has the steps for Turnstile.
