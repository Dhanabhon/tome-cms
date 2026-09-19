# Theme System Implementation Plan

**Goal:** The public site becomes one theme among others: templates and CSS behind a typed
contract, chosen by the owner in Settings.

**Spec:** [docs/specs/2026-09-20-theme-system-design.md](../specs/2026-09-20-theme-system-design.md)

**Tech stack:** Astro 5 SSR, TypeScript, Kysely/Postgres, plain CSS with `var()` tokens.

## Global constraints

- `npm run check` reports `0 errors` and `npm run test:unit` is green at the end of every task.
- `scripts/css-selector-diff.mjs --save` before a layer, `--diff` after: layers 1 and 2 must
  report no selector added or removed. Both sides need `npm run build`.
- No theme file may import from `src/pages` or `src/server`. A theme gets what it is given.
- Commit messages carry no attribution lines.

## A correction to the spec's rollout

The spec lists four layers, the first being the contract and registry with the routes left
alone. That layer renders nothing, so nothing can verify it -- a selector diff over code no
page reaches is not evidence. Layers 1 and 2 are therefore merged: the contract arrives with
the routes already handing over to it, which a diff and a screenshot can both speak to.

Three layers, then, each shipped on its own:

| Layer | What | Risk |
|---|---|---|
| 1 | contract, registry, `paper`, routes handing over | none visible; the diff proves it |
| 2 | the stylesheet splits | all of it -- ships alone |
| 3 | `plain`, the column, the migration, the Settings control | low |

---

## Layer 1: the contract, and the routes handing over

### File structure

| Path | Responsibility |
|---|---|
| `src/themes/contract.ts` | the props each template is given; the `Theme` shape |
| `src/themes/registry.ts` | `THEMES`, `DEFAULT_THEME_ID`, `resolveTheme(id)` |
| `src/themes/paper/theme.ts` | id, name, description |
| `src/themes/paper/index.ts` | the `Theme` object |
| `src/themes/paper/Shell.astro` | `<body>`: header, main, footer |
| `src/themes/paper/Home.astro` | the feed, moved out of the route |
| `src/themes/paper/Post.astro` | an article |
| `src/themes/paper/Page.astro` | a page |
| `src/themes/paper/parts/*` | Header, Footer, AuthorBlock, PostArticle, PageArticle, moved |
| `src/layouts/BaseLayout.astro` | modified: keeps the head, renders the theme's shell |
| `src/pages/[locale]/index.astro` | modified: queries only, then hands over |
| `src/pages/[locale]/blog/[slug].astro` | modified: same |
| `src/pages/[locale]/[slug].astro` | modified: same |

### What stays in core, and why

- **The head.** SEO is a product promise, not a decoration: `BaseLayout` goes on computing
  canonicals, alternates and structured data, and a theme cannot drop them.
- **Font preloads.** The two families are the admin's as well. A theme that wants its own
  typography is a later question, recorded here rather than answered.
- **The not-found and unavailable notices.** A missing post is a system state, not a design.
  `ThemePostProps.post` is therefore never null, and the route renders the notice itself.

### Steps

- [ ] **1. Write the contract.** `src/themes/contract.ts`: `ThemeShellProps`,
      `ThemeHomeProps`, `ThemePostProps`, `ThemePageProps`, `Theme`. Each props type carries
      what the route already fetched and nothing computed for it.
- [ ] **2. Write the registry.** `src/themes/registry.ts`: `THEMES` mapping an id to
      `() => import(...)`, `DEFAULT_THEME_ID = 'paper'`, and `resolveTheme(id?)` which falls
      back to the default for an id it does not know.
- [ ] **3. Move the parts.** `git mv` the five `components/blog` templates into
      `src/themes/paper/parts/`. `SEOHead.astro` stays: it belongs to the head.
- [ ] **4. Write `Shell.astro`** from `BaseLayout`'s body half, and reduce `BaseLayout` to the
      head plus `<theme.Shell>`.
- [ ] **5. Write `Home.astro`** from the markup in `[locale]/index.astro`, taking its
      formatting helpers with it. The route keeps the queries.
- [ ] **6. Write `Post.astro` and `Page.astro`**, each rendering the part it already had.
- [ ] **7. Hand the routes over.** Each resolves the theme and renders its template.
- [ ] **8. Test.** `tests/unit/theme-registry.test.ts`: every registered theme satisfies the
      contract; an unknown id resolves to `paper`; no theme file imports `src/pages` or
      `src/server`.
- [ ] **9. Verify.** Selector diff clean; screenshots at 1440/768/375, light and dark, on the
      homepage, an article and a page, against the same three before the change.
- [ ] **10. Commit.**

---

## Layer 2: the stylesheet splits

- [ ] **1.** Take an inventory of `global.css` by selector prefix, and write down for each
      block whether it is the admin's, the theme's, or shared. The inventory is the artefact
      to review -- not the diff afterwards.
- [ ] **2.** Move the theme's blocks into `src/themes/paper/theme.css`, imported by
      `Shell.astro`. Tokens, resets, `.icon`, `.sr-only`, focus rules and the notice classes
      stay in `global.css`.
- [ ] **3.** Selector diff: every selector still served, none added.
- [ ] **4.** Screenshots again, same nine.
- [ ] **5.** Commit alone.

---

## Layer 3: a second theme, and the setting

- [ ] **1.** Migration `012_site_theme`: `site_settings.theme_id text not null default 'paper'`.
- [ ] **2.** `db/types.ts`, `types/cms.ts`, the settings schema and the update mapping.
- [ ] **3.** `src/themes/plain/`: the same contract, system fonts, one column, no cards.
- [ ] **4.** The Settings control, and the admin's existing `theme` field renamed in the copy
      to **Appearance** in both locales, so one screen does not call two things a theme.
- [ ] **5.** `resolveTheme(settings?.theme_id)` in `BaseLayout` and the three routes.
- [ ] **6.** Tests: the column round-trips; an unknown id falls back; both themes satisfy the
      contract.
- [ ] **7.** Screenshots of `plain` at the three widths, to show the switch does something.
- [ ] **8.** Commit.
