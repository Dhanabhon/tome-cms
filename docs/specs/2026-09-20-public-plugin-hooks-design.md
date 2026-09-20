# A Plugin On The Page A Reader Sees

Date: 2026-09-20
Status: Awaiting owner review

## Why now

The plugin design of this morning closed with a sentence that has come due:

> Two hooks is a guess about what plugins need. It is the smallest set that makes Turnstile
> work, chosen over a larger one because the second plugin is what will show which of them
> was wrong.

The owner has asked for two more plugins — a sticky announcement bar and an image lightbox —
and both of them are on the public site. The current contract declares two hooks and both are
on the admin sign-in, with "plugins on the public site" written down as out of scope. So the
guess was wrong in exactly one direction, and this is the correction.

## What the two plugins actually need

They are not the same kind of thing, and reading them as one hook would produce a hook shaped
like neither.

- **The sticky bar is content.** The owner types a sentence; something draws it at the top of
  every page. Nothing runs in the browser except closing it.
- **The lightbox is behaviour.** Nobody types anything. Code runs in the reader's browser and
  attaches to images that are already there.

So: two hooks, not one.

## The hooks

```ts
/** Where the plugin has been asked. A plugin scopes itself; it does not go looking. */
export interface PublicPage {
  kind: 'home' | 'page' | 'post';
  locale: PostLocale;
}

/**
 * A band across the top of the page.
 *
 * Words and at most one link. Not markup, for the same reason the sign-in widget is not
 * markup: a plugin describes and the core draws, so nothing a plugin returns is ever written
 * into a page as HTML. The core owns the element, its classes, its colours and its dismissal.
 */
export interface SiteNotice {
  /** What closing it is remembered under. A plugin that derives this from its own text gets
   *  a new message shown again; one that hard-codes it does not. */
  dismissKey?: string;
  link?: { href: string; label: string };
  text: string;
}

export interface Plugin {
  // …the two sign-in hooks, unchanged…

  /** Null when this plugin has nothing to say on this page. */
  siteNotice?(settings: PluginSettings, page: PublicPage): SiteNotice | null;

  /**
   * Whether this plugin's own client module runs on this page, and what it is told.
   *
   * The module is `src/plugins/<id>/client.ts`, reached through a registry of dynamic
   * imports the way the themes are -- so a plugin that is off, or that returns null here,
   * ships no bytes to the reader. The dataset is written on the mount point as data-*
   * attributes, which is how settings reach it without a request.
   */
  publicClient?(settings: PluginSettings, page: PublicPage): { dataset?: Readonly<Record<string, string>> } | null;
}
```

## What the core keeps

- **Validating the link.** `href` is accepted only if it is same-origin or `https:`. A
  `javascript:` URL from a settings field is the first thing this would otherwise allow.
- **Drawing the notice**, including its dismiss button, its `localStorage` key and its markup.
  A plugin cannot choose a colour, a position or a tag.
- **One notice.** More than one enabled plugin may offer one; the first is drawn and the rest
  are ignored. Two stacked announcement bars is not a feature.
- **Loading the client module**, from a registry of dynamic imports. A plugin cannot name a
  third-party URL here -- `signInWidget.script` may, because Turnstile's script is Cloudflare's
  and the owner typed its keys; a module that runs on every reader's page is ours.

## What this actually grants, said plainly

`publicClient` runs plugin code in every reader's browser. That is a real increase over what
a plugin could do this morning, and it is worth being blunt about rather than describing it as
"a hook".

It is acceptable here only because of something the existing design already decided: plugins
ship in the repository and cannot be installed at runtime. The code in `src/plugins/*/client.ts`
is reviewed in the same commit as everything else, and is exactly as trusted as a theme's
`hero-slider.ts`, which has been running on the public site since this afternoon.

**If runtime installation is ever added, this hook has to be revisited before it is.** A
downloaded plugin running arbitrary code on every reader's page is a different product.

## The two plugins

- **`notice`** — a sticky bar. Settings: the text in each language, an optional link and its
  label, and whether a reader may close it. Fills `siteNotice`, and `publicClient` only when
  it is closable.
- **`lightbox`** — fills `publicClient` on `post` and `page` only, with no settings. Its module
  opens an article's images full-size in a `<dialog>`: Escape closes, focus returns, and it
  does nothing at all when the reader has asked for less motion beyond opening without a
  transition.

## Verification

- `npm run check` and `npm run test:unit` at each step.
- **What a page ships, measured rather than assumed.** With both plugins off, no plugin module
  is requested on any public page; with the lightbox on, its module is requested on an article
  and not on the homepage. This is the check that caught the feed shipping its code whether or
  not it was switched on, and it is the one that matters here too.
- A `javascript:` link in the notice settings is refused, and the refusal is a test.
- The existing plugin tests keep passing unchanged: the sign-in hooks are not touched.

## Risks

- **A public hook is a bigger grant than a sign-in hook**, and the thing that makes it safe is
  a rule written in another document. That rule is restated in the contract beside the hook,
  so removing it means reading it.
- **Two hooks is again a guess.** A plugin that wants to add something in the middle of an
  article, or to a card, still cannot. That is deliberate: the third plugin can say so.
