# A Theme Is What the Reader Sees

Date: 2026-09-20
Status: Awaiting owner review
Decided with the owner in conversation on 2026-09-20.

## Context

The public site is small and, for its size, unusually tangled with the admin:

| Part | Lines | What it holds |
|---|---|---|
| `pages/[locale]/index.astro` | 201 | the feed's query, its own copy table, and its markup |
| `pages/[locale]/blog/[slug].astro` | 87 | the post query and its markup |
| `pages/[locale]/[slug].astro` | 61 | the page query and its markup |
| `layouts/BaseLayout.astro` | 153 | the document, the head, the header and footer, the theme script |
| `components/blog/*` | 241 | Header, Footer, PostArticle, PageArticle, AuthorBlock, SEOHead |
| `styles/global.css` | **2,276** | the admin, the public site and the installer, in one file |

The owner wants to keep shaping the look, and the shape of the code is what makes
that expensive: changing the site means editing the same stylesheet the admin is
drawn from, and the same files that decide what a route fetches.

## Product Decisions

Settled with the owner, one question at a time:

- **A theme owns the templates and the CSS.** Routing, queries, SEO and i18n stay
  in core. A theme cannot make the site slow or wrong, only plain.
- **Themes live in the repository**, under `src/themes/`, and the owner picks one
  in Settings. No uploading, no sandbox, no plugin surface. They are typed against
  a contract, so a theme that does not satisfy it fails the build.
- **The public CSS moves into the theme.** Without this the work is decorative:
  editing a theme would still mean editing the admin's stylesheet.
- **A second, deliberately plain theme ships with it**, because a switch with one
  option proves nothing and an interface with one implementation is a guess.

Out of scope: theme upload or installation, per-theme settings, a customiser,
any change to what the routes fetch, and the admin's own appearance.

## The Design

### What a theme is

```
src/themes/
├── contract.ts        the props every theme is given, and the shape it must export
├── registry.ts        id -> () => import(...), and the one the settings name
├── paper/             the site as it stands today
│   ├── theme.ts       id, name, a sentence of description
│   ├── Layout.astro   the document: head, header, footer, slot
│   ├── Home.astro     the feed
│   ├── Post.astro     an article
│   ├── Page.astro     a page
│   ├── parts/         Header, Footer, AuthorBlock -- the theme's own business
│   └── theme.css      the public half of today's global.css
└── plain/             the same contract, a different opinion
```

### The contract

`contract.ts` is the whole interface between the product and its look. Each
template is given what the route already fetched, and nothing else:

```ts
export interface ThemeHomeProps {
  activeCategory: string | undefined;
  categories: PostCategoryBadge[];
  locale: PostLocale;
  nextCursor: string | null;
  posts: Post[];
  siteName: string;
  tagline: string;
}

export interface ThemePostProps {
  alternates: PostAlternate[];
  author: PublicAuthorProfile | null;
  categories: PostCategoryBadge[];
  locale: PostLocale;
  post: Post;
}

export interface Theme {
  Home: AstroComponent<ThemeHomeProps>;
  Layout: AstroComponent<ThemeLayoutProps>;
  Page: AstroComponent<ThemePageProps>;
  Post: AstroComponent<ThemePostProps>;
  description: string;
  id: string;
  name: string;
}
```

A route resolves the theme and hands over:

```astro
const theme = await resolveTheme(settings?.theme_id);
---
<theme.Layout {...layoutProps}>
  <theme.Home posts={posts} categories={categories} … />
</theme.Layout>
```

### Only the chosen theme is served

The registry maps an id to a **dynamic import**, not a static one:

```ts
const THEMES = {
  paper: () => import('./paper'),
  plain: () => import('./plain'),
} as const;
```

Static imports would bundle every theme's CSS into every public page, which is
the failure mode this design exists to avoid. With dynamic ones Vite splits them,
and a reader is served the stylesheet of the theme the owner chose.

### Splitting the stylesheet

`global.css` divides in three, not two:

| Stays in core | Moves to `paper/theme.css` |
|---|---|
| the token block, both colour schemes | `.home-hero`, `.post-card`, `.post-page`, `.post-*` |
| resets, `.icon`, `.sr-only`, focus rules | `.site-header`, `.site-footer`, `.public-navigation` |
| everything `.admin-*` and `.installer-*` | `.author-block`, `.category-*`, the article's prose rules |

Design tokens stay in core deliberately: a theme should be able to answer the
owner's light and dark settings without restating a palette, and the contrast
pairs are already pinned by `tests/unit/theme-contrast.test.ts`.

### Choosing one

A new `site_settings.theme_id` column, text, defaulting to `'paper'`. The
existing `theme` column keeps its meaning -- `system | light | dark` -- and the
admin stops calling that one a theme: it becomes **Appearance**, because two
different things called "theme" on one settings screen is a bug in the writing.
An id naming no installed theme falls back to `paper` rather than failing a page.

## Rollout

Four layers, each ending green, screenshotted, and committed on its own:

1. **The contract and the registry**, with `paper` re-exporting today's
   components unchanged. No visual change; the selector diff proves it.
2. **The routes hand over to the theme.** Still no visual change.
3. **The stylesheet splits.** The one layer that can change what a reader sees,
   so it ships alone, against a selector diff that must show only moves.
4. **`plain`, and the setting.** The second theme, the column, the migration and
   the Settings control.

## Verification

- `npm run check` and `npm run test:unit` at every layer.
- `scripts/css-selector-diff.mjs` across layers 1--3: the selectors served to a
  public page must be the same set before and after.
- Screenshots at 1440, 768 and 375, light and dark, on the homepage, an article
  and a page, compared against the same three today.
- New tests: every theme in the registry satisfies the contract; an unknown id
  resolves to `paper`; no theme file imports from `src/pages` or `src/server`.

## Risks

- **The stylesheet split is the whole risk.** 2,276 lines written without this
  boundary in mind will contain rules that serve both sides. Each one is a
  decision, and the selector diff catches only the ones that go missing, not the
  ones filed on the wrong side. Layer 3 ships alone for this reason.
- **The contract will be wrong in places.** The second theme is what finds that,
  which is why it is in scope rather than promised.
- **`plain` is not a design.** It exists to prove the switch. Shipping it as a
  real choice for a reader is a separate decision the owner has not made.
