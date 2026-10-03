---
title: Writing a theme
description: Build a theme for the public site against the theme contract, give it settings the admin can offer, register it, and check what its stylesheet changes.
sidebar:
  order: 1
---

A theme draws the public site. It owns its templates and its stylesheet and nothing else. Routing, database queries, the `<head>` with its search engine tags, the fonts and the design tokens stay in the core, so a theme cannot make the site slow or wrong.

Themes ship in the repository. The owner picks one of the themes a release contains on the [Themes](/tome-cms/admin/themes/) screen, and nothing installs a theme while the site runs. TomeCMS has three: `paper`, the default, `plain`, a spare second that exists so the contract has more than one reader, and `almanac`, a warm third with serif headings, a hero, a row of category pills and a grid of cards, which shows a theme with its own fonts, settings and scroll-driven bar. Copying `plain` is the quickest way to start, and `almanac` is the one to read when you want a theme that does more.

## Starting with tome

In a TomeCMS source checkout, `tome` starts a theme for you. It is the same program as the [`tome` command](/tome-cms/running/cli/) on a server, but these commands are for development: they run from the checkout with `npm run tome --`, need no `sudo`, and refuse anywhere else.

```sh
npm run tome -- theme new ledger
npm run tome -- theme new ledger --from almanac
npm run tome -- theme new ledger --dry-run
```

| Argument or option | What it does |
| --- | --- |
| `id` | The new theme's id: 2 to 31 lowercase letters and digits, starting with a letter. There are no hyphens, because the id is also an import name. It is refused when `src/themes/<id>` exists, when the id is already in `manifests.ts` or `registry.ts`, or when it is a one-word Tailwind utility such as `grid`, since the id is also the body's class. |
| `--from THEME` | The theme to copy: `plain` (the default), `paper` or `almanac`. |
| `--dry-run` | Prints what it would do and writes nothing. |

It copies `src/themes/<from>/` to `src/themes/<id>/`, so the start is always the current contract, not an older template. In the copy it renames what carries the source theme's name:

- the manifest's `id`, and its `name` and `description`, which all become the id for you to rewrite;
- every class, element id and custom property that starts with the source's name, so `.almanac-card` becomes `.ledger-card`;
- the theme's own class on `<body>` and in the stylesheet, so `body.almanac` becomes `body.ledger`.

A comment that only mentions the source theme is left as it was. A custom property of the core, such as `--color-paper-2`, is not renamed. Nor is a `<from>-` name the core itself uses: a copy of `plain` keeps `plain-body`, because the core's `code.css` draws code blocks inside it.

Fonts are not copied. When the source loads its own, as `almanac` does with Trirong, the new stylesheet imports the source's `fonts.css`, so both load the same files under `public/fonts/`.

Then it registers the theme: it adds the import and the `THEME_MANIFESTS` entry to `src/themes/manifests.ts`, and the dynamic import to `src/themes/registry.ts`. It writes the new directory first and removes it again if registering fails, so it never leaves half a theme behind. When either list is in a shape it does not recognise, it changes nothing, prints the lines to add by hand and exits 1. A dry run of `theme new ledger` prints:

```text
$ npm run tome -- theme new ledger --dry-run
Would create:
  src/themes/ledger/Home.astro
  src/themes/ledger/Page.astro
  src/themes/ledger/Post.astro
  src/themes/ledger/Shell.astro
  src/themes/ledger/index.ts
  src/themes/ledger/lead.ts
  src/themes/ledger/theme.css
  src/themes/ledger/theme.ts
Would add to src/themes/manifests.ts:
  import { manifest as ledger } from './ledger/theme';
  export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, almanac, ledger];
Would add to src/themes/registry.ts:
    ledger: () => import('./ledger'),
Nothing was written.
```

Without `--dry-run` it ends by saying what to do next:

```text
Next:
  npm run dev
  Choose ledger under Appearance → Themes.
  npm run tome -- check
```

The theme is already selectable on the [Themes](/tome-cms/admin/themes/) screen. [`tome check`](/tome-cms/running/cli/#building-themes-and-plugins) then looks for what a pull request would be sent back for: a missing file, a manifest that does not match its directory, a setting without both languages, a theme that imports from `src/server/`, a stylesheet that does not keep to the design tokens. The sections below explain what each file is for, and [Registering a theme](#registering-a-theme) does by hand what `tome` just did.

## What a theme is made of

A theme is a directory under `src/themes/`, and the directory's name is the theme's id.

| File | What it holds |
| --- | --- |
| `Shell.astro` | Everything inside `<body>`: the header, the main area and the footer |
| `Home.astro` | The home page's list of posts |
| `Post.astro` | One post |
| `Page.astro` | One page |
| `theme.css` | The theme's own stylesheet |
| `theme.ts` | The manifest: the id, the name, the sentence the Themes screen shows, any settings, and the fonts it preloads |
| `index.ts` | Exports the manifest and the four templates |

`index.ts` is the same in every theme:

```ts
import Home from './Home.astro';
import Page from './Page.astro';
import Post from './Post.astro';
import Shell from './Shell.astro';

export { manifest } from './theme';

export { Home, Page, Post, Shell };
```

`src/themes/styles.ts` finds each theme's `theme.css`, and the page links the stylesheet of the theme in use, so a reader downloads only that one. A template never imports `theme.css` itself: the build would then put the stylesheet in the wrong bundle.

Tailwind reads every file under `src/` for class names, comments included. The name of a utility class written in a comment in a theme can put that rule on every page a reader loads.

## The contract

`src/themes/contract.ts` says what each template is given. Each template declares its props by extending the matching type:

```astro
---
import type { ThemeHomeProps } from '../contract';

interface Props extends ThemeHomeProps {}
---
```

The registry returns a union of every theme's templates, so a template whose props drift from the contract fails the build where a route renders it.

| Template | Props | What it is given |
| --- | --- | --- |
| `Shell` | `ThemeShellProps` | `themeSettings`, `allowVisitorTheme`, `alternates` (the same page in the other language), `brand`, the `header` and `footer` menus, `locale`, `showPoweredBy`, `siteName`, and `theme`, the light or dark choice the server rendered |
| `Home` | `ThemeHomeProps` | `themeSettings`, `posts` (each a `ThemeHomePost`, which may carry its `categories`), `categories`, `activeCategory`, `query`, what the reader searched for, `cursor` and `nextCursor` for moving between pages of posts, `loadError`, `locale`, `profile`, `slides`, `siteName`, `tagline` and `timezone` |
| `Post` | `ThemePostProps` | `themeSettings`, `post`, `categories`, `locale`, `profile`, `settings` (the site's name and time zone), and `preview`, set when the owner is looking at a draft |
| `Page` | `ThemePageProps` | `page`, `locale` and `preview`. A page is not given the theme's settings. |

When `query` is set, the route has already narrowed `posts` to the ones that match. What is left to a `Home` template:

- draw a `<form role="search" method="get">` whose field is named `q`, so search works with no script, and put the current `query` back in it;
- say what was searched for and how to leave it, printing the reader's words as text, never as markup;
- carry `q` on the link to older posts, next to `category`;
- draw the results before any hero, and say when nothing matched.

All three bundled themes do this. The route also sends `noindex, follow` for a page of results, and a template needs nothing for that.

All of it is what the route already had in hand. A theme gets no way to fetch more, and a test fails any file in a theme that imports from `src/server/` or `src/pages/`.

`Shell` renders two slots. `<slot name="above" />` comes before anything the theme draws, and the core puts there what is not the theme's, such as the band a plugin supplies words for and the points a plugin's browser code attaches to. The default `<slot />` is the page itself, usually inside `<main>`. The logo is drawn with the core's `SiteBrand` component, given `brand` and `siteName`, as `plain`'s `Shell.astro` does.

## Drawing sub-menus

The `header` and `footer` menus a `Shell` is given are lists of `PublicNavigationItem`, from `src/types/cms.ts`. `children` is new in 1.10.0, and `href` and `kind` now allow a group:

| Field | What it holds |
| --- | --- |
| `href` | The link, or `null` for a group. Only a group has no link. |
| `kind` | `home`, `page`, `custom`, or `group` |
| `label` | The words readers see |
| `newTab` | The owner asked for the link to open in a new tab. A theme adds `target` and `rel`. |
| `children` | The item's sub-items. It is always there: an empty list for a plain item, for a sub-item, and for everything in the footer. |

An item in `header` with something under it has `children` filled in. It is one level deep, so a child's own `children` is empty and a child is never a `group`. The `footer` stays flat: its items are links, with empty `children`. A group is only ever in `header`, and has at least one child, because the core drops the ones left with none. A parent whose page is not published reaches the theme as a group, `href: null`, as long as a child is live, so a template cannot assume a parent has a link.

The menu is cached and does not depend on the page being viewed, so the theme works out the current section from its own path. `isCurrentSection(item, pathname)` and `isLink(item)` are in `src/lib/navigation-current.ts`. A header template draws a plain item as a link and one with children as a sub-menu:

```astro
---
import SiteNavLink from '../../components/SiteNavLink.astro';
import SiteSubmenu from '../../components/SiteSubmenu.astro';
import SubmenuScript from '../../components/SubmenuScript.astro';
import { publicCopy } from '../../lib/i18n';
import { isLink } from '../../lib/navigation-current';

const { header, locale } = Astro.props;
const copy = publicCopy(locale);
const currentPath = Astro.url.pathname;
---

<ul>
  {header.map((item) => item.children.length
    ? <SiteSubmenu copy={copy} currentPath={currentPath} item={item} />
    : isLink(item) && <li><SiteNavLink copy={copy} currentPath={currentPath} item={item} /></li>)}
</ul>
{header.some(({ children }) => children.length) && <SubmenuScript />}
```

A theme can reuse three pieces of the core, and all three bundled themes do:

- `SiteNavLink` draws one link the way every theme should, with `aria-current` on the page being viewed and a note for screen readers on a link that opens a new tab.
- `SiteSubmenu` draws one parent and its sub-menu. It is a `<details>` that all share one `name`, so the browser keeps only one open, with no script at all. For a link parent it puts a ▾ button beside the link, and for a group the label is the button. Style `.site-submenu-item`, `.site-submenu` inside it, and `summary`, with your tokens. The panel is placed by `[data-align="end"]` when it would run past the window.
- `SubmenuScript` is the one script, and the page needs it once. It closes the open sub-menu on Escape, on a press outside and when focus leaves it, and sets `data-align="end"` on a panel that would pass the window's edge. Without it the sub-menus still open and close.

A theme that draws its own markup keeps those behaviours: a sub-menu opened by a click, never a hover, with a button whose name says which menu it opens. The words for that name are `showMenu` in `publicCopy`, "Show the {label} menu". For a phone, list the children under their parent inside the theme's own Menu, as `paper`'s `Header.astro` does, and draw a group as a label rather than a link.

## A theme's settings

A theme can ask the admin to offer settings for it by listing them in its manifest. The core draws the form under "Customize" on the Themes screen, stores the answers for that theme, and hands them to the templates as `themeSettings`. The screen offering the settings never loads the theme to learn what they are, which is why the manifest lives in `theme.ts`, apart from the templates. A theme with no `settings` has nothing to customize.

| Field | What it is |
| --- | --- |
| `key` | The name a template reads the value by, as in `themeSettings.showDates` |
| `kind` | `choice`, `switch` or `text` |
| `label` | The field's name on the form, as `{ en, th }` |
| `hint` | A line under the field, as `{ en, th }`. Optional. |
| `fallback` | The value until the owner chooses one. Required. |
| `options` | Required by a `choice`: the values it may store, each with its own `label` |
| `max` | Required by a `text`: the most characters it may store |

Every value is a string. A switch is `'on'` or `'off'`, a choice is one of its options' values, and a text is trimmed and at most `max` characters long. The server refuses a save that breaks these and names the setting, as in `Headline is longer than 60 characters.`

A template always finds every key its manifest declares. One the owner never chose comes back as its `fallback`, and so does a stored value the theme no longer offers, such as a choice removed in a later release. A key the manifest has dropped is not handed back at all.

This manifest offers a switch, a line of text and a choice:

```ts
import type { ThemeManifest } from '../contract';

/** Kept apart from the templates so the admin can name the theme without loading it. */
export const manifest: ThemeManifest = {
  description: 'Titles and dates in one column, like a ledger.',
  id: 'ledger',
  name: 'Ledger',
  settings: [
    {
      fallback: 'on',
      key: 'showDates',
      kind: 'switch',
      label: { en: 'Show dates', th: 'แสดงวันที่' },
    },
    {
      fallback: '',
      hint: { en: 'Left blank, the tagline is shown.', th: 'ถ้าเว้นว่าง จะแสดงข้อความประจำเว็บไซต์' },
      key: 'intro',
      kind: 'text',
      label: { en: 'Introduction', th: 'คำนำ' },
      max: 80,
    },
    {
      fallback: 'roomy',
      key: 'spacing',
      kind: 'choice',
      label: { en: 'Spacing', th: 'ระยะห่าง' },
      options: [
        { label: { en: 'Roomy', th: 'โปร่ง' }, value: 'roomy' },
        { label: { en: 'Compact', th: 'กระชับ' }, value: 'compact' },
      ],
    },
  ],
};
```

And its `Home.astro` reads them:

```astro
---
import { postPath } from '../../lib/i18n';
import type { ThemeHomeProps } from '../contract';

interface Props extends ThemeHomeProps {}

const { posts, tagline, themeSettings } = Astro.props;
const showDates = themeSettings.showDates === 'on';
const intro = themeSettings.intro || tagline;
---

<div class={`ledger-home ledger-home--${themeSettings.spacing}`}>
  <p>{intro}</p>
  <ol>
    {posts.map((post) => (
      <li>
        <a href={postPath(post)}>{post.title}</a>
        {showDates && post.published_at && <time datetime={post.published_at}>{post.published_at.slice(0, 10)}</time>}
      </li>
    ))}
  </ol>
</div>
```

## The fonts a theme preloads

`preloadFonts` in the manifest lists the font files a page asks for before the theme's stylesheet does, as paths under `public/`:

```ts
  preloadFonts: ['/fonts/google-sans-latin-400-normal.woff2', '/fonts/google-sans-thai-400-normal.woff2'],
```

Name the faces the first screen is drawn in, so they do not swap in late. The page preloads exactly that list. A theme with no `preloadFonts` preloads nothing, and its faces load when its stylesheet asks for them. `tome check` reports a path that is not a `.woff2` file in `public/fonts/`, and `tome theme new` copies the list with the theme.

## Registering a theme

1. Copy `src/themes/plain/` to a directory named after the new theme, such as `src/themes/ledger/`.
2. In its `theme.ts`, set `id` to the directory's name, and give the theme a `name` and a one-sentence `description`. The Themes screen shows that sentence as it is written, in both languages.
3. Add the id to `THEMES` in `src/themes/registry.ts`, as a dynamic import:

   ```ts
   const THEMES = {
     paper: () => import('./paper'),
     plain: () => import('./plain'),
     almanac: () => import('./almanac'),
     ledger: () => import('./ledger'),
   } as const;
   ```

4. Add its manifest to `THEME_MANIFESTS` in `src/themes/manifests.ts`:

   ```ts
   import { manifest as ledger } from './ledger/theme';

   export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, almanac, ledger];
   ```

5. Run `npm run check` and `npm run test:unit`.

Both lists are needed. The registry is how a page reaches the templates, and the manifests are how the admin names a theme without loading it. `tests/unit/theme-registry.test.ts` fails when the directories, the registry and the manifests do not name the same themes, and it checks the exports and the props of each template.

The registry's import has to stay dynamic. Importing the themes directly would bundle every theme's templates and stylesheet into every public page, while the dynamic import lets the server load only the theme the settings name. If a site's chosen theme later leaves a release, that site is drawn with `paper`.

## Checking what the stylesheet changes

`css:snapshot` and `css:diff` compare the CSS the build serves, selector by selector, before and after a change. They read the built stylesheets, so build first, and give both commands the same file:

```sh
npm run build
npm run css:snapshot -- /tmp/css-before.json
# change the stylesheets
npm run build
npm run css:diff -- /tmp/css-before.json
```

The diff prints how many selectors were removed or added and how many had their declarations changed, then lists each one. It exits with an error only when a selector that is still there ended up with different declarations. A removal you meant should show up in the list. A changed declaration block almost never should: deleting the last selector of a group can leave the selectors above it bound to the next rule, and nobody sees that in the patch.

This is how the split between the core's `src/styles/global.css` and each theme's `theme.css` is kept honest. `npm run check` runs only the script's self-test, so run the two commands yourself when you move rules between stylesheets.
