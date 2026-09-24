# Popup Plugin

Date: 2026-09-24
Status: Design, for the owner's review before planning

The owner wants a marketing popup on the public site: a picture on one side, a heading, a few
words, a button that goes somewhere, a way to say no, and small print. This design adds it as a
plugin, and adds to the plugin system only what such a plugin needs and the system does not yet
have: a picture setting, a choice setting, and a hook through which a plugin describes a popup
that the core draws.

## What was decided before this was written

Each of these was put to the owner as a question and chosen.

- **A button, not a form.** The popup has no email field and no questions. Its button is a
  link, to a page on the site or to an outside form such as Mailchimp's or Google Forms'. The
  site collects no personal data, so nothing here touches the rule that a plugin cannot reach
  the database, and nothing needs consent under PDPA.
- **Two ways to appear, the owner's choice:** after a delay, or when the reader is about to
  leave.
- **The core draws it** (approach A). The plugin describes the popup as data and says when to
  open it; the core renders the markup, the way it already renders the announcement band. A
  plugin never writes markup, in the page or in the browser.

## The plugin contract

`src/plugins/contract.ts` gains two setting kinds and one hook.

### Two setting kinds

| Kind | Stored as | Admin field | Checked when saved |
|---|---|---|---|
| `image` | a media id (uuid), or empty | "Choose picture" with a preview, through the existing `MediaPicker` | a ready image of this owner's, by `assertReadyMediaReferences` |
| `choice` | one of the setting's `options` values | the existing `UiSelect` | must be one of `options`; a `choice` declares `options` and a `fallback`, as a switch declares a fallback |

`PluginSetting` gains `options?: readonly { label: { en: string; th: string }; value: string }[]`,
required for `choice` and forbidden elsewhere. `tests/unit/plugin-admin.test.ts` holds every
manifest to this.

A picture a plugin setting holds cannot be deleted from the library. `findMediaReferences` in
`src/server/media/service.ts` looks in `plugin_settings.settings` under each `image` key its
manifest declares, whether the plugin is on or off, and the refusal names the plugin.
`MediaReferences` gains `plugins: Array<{ id: string; name: string }>` and a matching count.

### The `sitePopup` hook

```ts
/** A popup over the page. Words, one picture from the library and one link -- not markup. */
interface SitePopup {
  /** A media id; the core resolves it and draws it only if it is still a ready image of this owner's. */
  imageId?: string;
  heading: string;
  text?: string;
  action: { href: string; label: string };
  /** The words on the button that closes it. Absent means the core's. */
  decline?: string;
  finePrint?: string;
  trigger: 'delay' | 'exit';
  /** Seconds, for `trigger: 'delay'`. */
  delaySeconds?: number;
  /** What closing it is remembered under. Derived from its content, so a new popup is shown again. */
  dismissKey: string;
  /** The language of the words, which is the other one's when the page's own had none. */
  locale: PostLocale;
}

sitePopup?(settings: PluginSettings, page: PublicPage): SitePopup | null;
```

`publicAdditions` in `src/server/plugins/public.ts` takes at most one popup a page, the first
enabled plugin's to answer, as it takes at most one notice. It drops the popup when the heading
or the button's label is empty, or when the button's link fails the existing `safeHref`
(a path on this site, or https). It resolves `imageId` to the image's stable path, width and
height, and drops only the picture when it is no longer a ready image of this owner's.

## Drawing it

`src/layouts/BaseLayout.astro` renders the popup, closed, in the Shell's `above` slot beside the
notice band:

- `<dialog class="site-popup" aria-labelledby="site-popup-heading">`, carrying the trigger, the
  delay and the dismiss key as `data-*` attributes.
- A close button (✕) and the decline button are each in a `<form method="dialog">`, so they
  close it with no script. The action is a plain `<a>`.
- The picture, when there is one, is `alt=""` (it illustrates; the heading names the dialog),
  has its width and height, and is `loading="lazy"`, so it is not fetched until the popup opens
  and never competes with the page's largest paint.
- At 40rem and wider the picture sits on the left and the words on the right, at most about
  52rem across. Narrower, the picture is a short band on top and the words below; the dialog
  is at most 90% of the viewport high and scrolls inside itself.
- Its colours, type and spacing are the site's tokens, as the notice band's are, so it follows
  `paper` and `plain` and the light, dark and system setting. The styles live in
  `src/styles/global.css` beside `.site-notice`.
- The admin, the post and page previews and the maintenance page do not use `BaseLayout`, so
  they never carry a popup. The admin's theme previews do use it -- they are the homepage drawn
  with the theme named in the URL, shown in small frames on the Themes screen -- and it leaves
  them without the popup and without its code, since a box nobody can close would cover them.

## Opening and remembering

`src/plugins/popup/client.ts` is loaded only on a page whose popup was drawn, through the
existing registry of dynamic imports.

- **Delay:** it opens with `showModal()` after the chosen 5, 10 or 20 seconds on the page.
- **About to leave:** where the primary pointer is fine (a mouse), it opens when the pointer
  leaves the window through its top edge (`mouseout` with no `relatedTarget` and `clientY <= 0`).
  Where it is coarse (a phone), it opens once the reader has scrolled past half of the distance
  there is to scroll, so a page under two screens long does not open it on the first scroll.
- It never opens over another open modal dialog, such as the picture viewer; it waits until
  that one closes.
- **Remembering:** the dialog's `close` event, however it closed (✕, decline, Esc, a click on
  the backdrop, or the action), writes the dismiss key to `localStorage`, and a page whose key
  is stored does not open it. Storage that throws means the popup comes back on the next visit,
  but never twice on one page.
- **`#popup-preview`:** a page opened with this hash opens the popup at once, whatever the
  trigger and whatever was remembered, so the owner can look at it. It is public content, so a
  visitor who types the hash sees nothing they could not see anyway.
- A click on the backdrop closes it. Reduced motion (`prefers-reduced-motion: reduce`) opens it
  without its fade.

## The plugin

`src/plugins/popup/` with `plugin.ts` (the manifest), `index.ts` (the hooks) and `client.ts`.
Name **Popup**, hook `publicPage`, a new admin icon `popup`.

| Setting | Key | Kind | Fallback | Notes |
|---|---|---|---|---|
| Picture | `image` | `image` | empty | optional; without one the popup is a single column |
| Heading (Thai) / (English) | `headingTh` / `headingEn` | text | empty | at least one language |
| Message (Thai) / (English) | `textTh` / `textEn` | text | empty | optional |
| Button text (Thai) / (English) | `actionTh` / `actionEn` | text | empty | needed beside a heading |
| Button link | `actionHref` | text | empty | a path on this site or https |
| Decline (Thai) / (English) | `declineTh` / `declineEn` | text | empty | empty means "ไม่ล่ะ ขอบคุณ" / "No thanks" |
| Small print (Thai) / (English) | `finePrintTh` / `finePrintEn` | text | empty | optional |
| Opens | `trigger` | `choice` | `delay` | `delay`, `exit` |
| Delay | `delay` | `choice` | `10` | `5`, `10`, `20`; for `delay` only |
| Pages | `pages` | `choice` | `all` | `all`, `home` |

The settings are listed in that order: picture, the Thai set, the English set, the link, then
timing.

**Language.** The popup takes the page's language set when that set has a heading, and the
other language's whole set when it does not; it never mixes the two in one popup. It says which
language it chose as `locale`, and the dialog carries it as `lang`, so words shown on a page of
the other language are still read in their own voice. `sitePopup`
answers null when the chosen set has no heading or no button text, or when `pages` is `home` and
the page is not the home page. The dismiss key is a hash of the chosen set, the link and the
picture, the way the notice band derives its key from its words.

**Preview.** The plugin's settings form carries a "Preview" link to the home page with
`#popup-preview`, which works once the plugin is on.

All admin copy is in `src/lib/admin-i18n.ts`, and the decline fallback and the close button's
label in `publicCopy` (`src/lib/i18n.ts`), both in Thai and English.

## Not in this design

| Left out | Worth adding when |
|---|---|
| An email field or questions in the popup | the owner decides to collect subscribers; that needs a subscriber store, consent under PDPA, and a place outside the plugin system |
| Several popups or campaigns at once | different pages need different messages |
| A start and an end for the popup | a promotion must go up and come down on a schedule; the plugin's switch turns it off today |
| Counting views or clicks | the site has analytics |
| Groups in the plugin settings form | a second plugin has a form this long |
| "Show again after N days" | the owner wants to remind readers; changing the popup's content shows it again today |

## Verification

Every test is written before the code it covers, and every guard is checked by putting back the
bug it guards against.

**Unit**
- `tests/unit/plugin-admin.test.ts`: the popup plugin declares `publicPage` and implements both
  `sitePopup` and `publicClient`; every `choice` has `options` and a `fallback`, and no other
  kind has `options`.
- `tests/unit/popup-plugin.test.ts`: the language set is chosen whole; no heading or no button
  text answers null; the decline falls back to the core's words; `pages: home` answers null on a
  post; the dismiss key changes when the content changes and not otherwise.

**Integration**, against a real PostgreSQL
- A `choice` accepts only its options; an `image` accepts only a ready image of this owner's.
- A picture the popup holds cannot be deleted, and the refusal names the plugin.
- `publicAdditions` drops a popup whose link fails `safeHref`, resolves the picture, and gives
  at most one popup a page.

**Browser**, in `tests/e2e/public-plugins.spec.ts`
1. Delay: the popup is not open at load and opens after the delay, named by its heading, with
   focus inside it.
2. Decline, reload: it does not open again. Change the heading: it opens once more.
3. Esc closes it, and so does a click on the backdrop.
4. Leaving: at phone width it opens past half the page; on a desktop, on a `mouseout` through the
   top edge.
5. `#popup-preview` opens it at once, even after it was declined.
6. A page with the plugin off has no `<dialog class="site-popup">` and loads no popup chunk.
7. Nothing overflows at 375 wide.

**By eye:** screenshots with and without a picture, light and dark, at 1280 and 375, on `paper`
and `plain`.

Gates before each commit, one after another: `npm run check`, `npm run test:unit`, the
integration files touched, and the browser spec.

## Risks

- **A popup is an interruption.** It opens at most once a page and never again once closed, and
  never over another dialog; the owner chooses when. That is the whole of its manners, and the
  owner can switch the plugin off.
- **The contract grows.** `image`, `choice` and `sitePopup` are general, not popup-shaped, so the
  next plugin that wants a picture or a menu of choices uses them as they are.
- **Exit intent is a guess.** A mouse leaving through the top is a strong sign; half a page on a
  phone is only a proxy for it. The owner who finds it wrong can use the delay.
