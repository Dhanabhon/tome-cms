---
title: Writing a theme
description: Build a theme for the public site against the theme contract, give it settings the admin can offer, register it, and check what its stylesheet changes.
sidebar:
  order: 1
---

A theme draws the public site. It owns its templates and its stylesheet and nothing else. Routing, database queries, the `<head>` with its search engine tags, the fonts and the design tokens stay in the core, so a theme cannot make the site slow or wrong.

Themes ship in the repository. The owner picks one of the themes a release contains on the [Themes](/tome-cms/admin/themes/) screen, and nothing installs a theme while the site runs. TomeCMS has two: `paper`, the default, and `plain`, a spare second that exists so the contract has more than one reader. Copying `plain` is the quickest way to start.

## What a theme is made of

A theme is a directory under `src/themes/`, and the directory's name is the theme's id.

| File | What it holds |
| --- | --- |
| `Shell.astro` | Everything inside `<body>`: the header, the main area and the footer |
| `Home.astro` | The home page's list of posts |
| `Post.astro` | One post |
| `Page.astro` | One page |
| `theme.css` | The theme's own stylesheet |
| `theme.ts` | The manifest: the id, the name, the sentence the Themes screen shows, and any settings |
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
| `Home` | `ThemeHomeProps` | `themeSettings`, `posts`, `categories`, `activeCategory`, `cursor` and `nextCursor` for moving between pages of posts, `loadError`, `locale`, `profile`, `slides`, `siteName`, `tagline` and `timezone` |
| `Post` | `ThemePostProps` | `themeSettings`, `post`, `categories`, `locale`, `profile`, `settings` (the site's name and time zone), and `preview`, set when the owner is looking at a draft |
| `Page` | `ThemePageProps` | `page`, `locale` and `preview`. A page is not given the theme's settings. |

All of it is what the route already had in hand. A theme gets no way to fetch more, and a test fails any file in a theme that imports from `src/server/` or `src/pages/`.

`Shell` renders two slots. `<slot name="above" />` comes before anything the theme draws, and the core puts there what is not the theme's, such as the band a plugin supplies words for and the points a plugin's browser code attaches to. The default `<slot />` is the page itself, usually inside `<main>`. The logo is drawn with the core's `SiteBrand` component, given `brand` and `siteName`, as `plain`'s `Shell.astro` does.

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

## Registering a theme

1. Copy `src/themes/plain/` to a directory named after the new theme, such as `src/themes/ledger/`.
2. In its `theme.ts`, set `id` to the directory's name, and give the theme a `name` and a one-sentence `description`. The Themes screen shows that sentence as it is written, in both languages.
3. Add the id to `THEMES` in `src/themes/registry.ts`, as a dynamic import:

   ```ts
   const THEMES = {
     paper: () => import('./paper'),
     plain: () => import('./plain'),
     ledger: () => import('./ledger'),
   } as const;
   ```

4. Add its manifest to `THEME_MANIFESTS` in `src/themes/manifests.ts`:

   ```ts
   import { manifest as ledger } from './ledger/theme';

   export const THEME_MANIFESTS: readonly ThemeManifest[] = [paper, plain, ledger];
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
