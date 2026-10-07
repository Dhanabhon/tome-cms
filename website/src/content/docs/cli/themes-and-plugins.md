---
title: Themes and plugins
description: The tome commands of a source checkout, theme new, plugin new and check, which run with npm run tome --.
sidebar:
  order: 6
---

Three commands help you write a theme or a plugin. They are not for a server. They run in a TomeCMS source checkout, with `npm run tome --`, need no `sudo`, and say `Run this in a TomeCMS source checkout.` and exit 1 anywhere else. Only the checkout's own `src/cli/main.ts` runs them, so the `tome` installed on a server always refuses, even in its release clone at `/opt/tome-cms-src`. The server commands keep their `sudo`, and the two groups do not mix.

```sh
npm run tome -- theme new <id> [--from plain|paper|almanac] [--dry-run]
npm run tome -- plugin new <id> --hook publicPage|signIn|editorSuggestions [--client] [--dry-run]
npm run tome -- check
```

- `theme new` copies an existing theme under a new id and registers it. [Writing a theme](/tome-cms/extending/themes/#starting-with-tome) says what it renames.
- `plugin new` writes a plugin that fills its hook and does nothing yet, switched off. [Writing a plugin](/tome-cms/extending/plugins/#starting-with-tome) shows what it writes.
- `check` checks every theme and plugin, and prints each problem as `path:line: what is wrong`. It changes nothing. It exits 0 when it found none and 1 when it found any. `npm run check` runs it, so CI stops a mistake before it is merged.

`check` looks for these:

1. a theme or plugin whose directory name is not its manifest's id;
2. one that is not listed in both its `manifests.ts` and its `registry.ts`, or a list entry with no directory;
3. a missing file: a theme needs `index.ts`, `theme.ts`, `Shell.astro`, `Home.astro`, `Post.astro`, `Page.astro` and `theme.css`; a plugin needs `plugin.ts` and `index.ts`, and `client.ts` when it has a `publicClient`;
4. a setting that is not well formed: a repeated key, a kind the contract does not allow, a label or hint missing in English or Thai, a choice without options or whose fallback is not one of them, a theme's text setting without a maximum length (a plugin's text has none in its contract), a switch whose fallback is not `on` or `off`;
5. a plugin whose `index.ts` does not export the sign-in pair every plugin answers, or a method of each hook it declares;
6. a theme that imports from `src/server/` or `src/pages/`;
7. a raw colour in a theme's CSS outside a token block. A raw colour is a hex such as `#c00`, or `rgb()`, `hsl()`, `hwb()`, `oklch()`, `oklab()`, `lab()`, `lch()` or `color()`. A token block is a rule whose own declarations are all custom properties, such as `--color-ink: oklch(24% 0.012 70);`; a rule nested inside it is checked on its own. Everywhere else the stylesheet uses `var(--color-ink)`. Comments are not read, and neither is a colour name such as `red`.
8. a font a theme's manifest preloads, in `preloadFonts`, that is not a `.woff2` file in `public/fonts/`.

It does not run a plugin. It imports each manifest and each plugin's `index.ts`, as the core does, and calls nothing in them. Any way of exporting a method counts, including `export * from './hooks'`. A method that is only on the default export object does not count, because the core uses the module's named exports.

A checkout with nothing wrong:

```text
$ npm run tome -- check
Checked 3 themes and 6 plugins: no problems.
```

A plugin made with `plugin new nimbus --hook publicPage`, with `export` then taken off the `siteNotice` line of its `index.ts`, and `settings: [],` in its `plugin.ts` replaced by a setting with no Thai label:

```ts
  settings: [
    { key: 'message', kind: 'text', label: { en: 'Message', th: '' }, required: false },
  ],
```

```text
$ npm run tome -- check
src/plugins/nimbus/plugin.ts:11: setting "message" has no Thai label
src/plugins/nimbus/index.ts:1: declares publicPage, but exports none of siteNotice, sitePopup, publicClient
2 problems.
```

`npm run tome -- --help` lists them, and every command takes `--help`.
