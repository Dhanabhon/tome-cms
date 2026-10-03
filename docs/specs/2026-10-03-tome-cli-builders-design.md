# Tome CLI, part B: building themes and plugins

Date: 2026-10-03
Status: Design. The owner approved both parts on 2026-10-03. It ships as 1.12.0. Part A (server
care, 1.11.0) is `docs/specs/2026-10-02-tome-cli-server-design.md`; part C (content with tokens)
comes later.

## Who it is for

The owner, and contributors working in a TomeCMS source checkout. They use it to:
- start a new theme or plugin in seconds, as Almanac was started by hand;
- catch mistakes before a pull request or a release.

**Themes and plugins still ship with TomeCMS.** Nothing here installs code into a running site,
and the design keeps it that way.

## How it runs

- It is the same `tome` program as part A (`src/cli/`), run from a checkout with
  `npm run tome -- <command>`. Add the script to `package.json`; it runs `src/cli/main.ts` through
  `tsx`, as the other scripts do.
- The commands here are `theme new`, `plugin new` and `check`. They do **not** need root.
- They work only inside a TomeCMS checkout. They find the repository root by walking up to a
  `package.json` whose name is `tome-cms` and which has `src/themes/manifests.ts`. Run elsewhere,
  including the server's installed `tome`, they say "Run this in a TomeCMS source checkout" and
  exit 1.
- Part A's server commands keep their root check. The two groups do not mix.
- Exit codes are as in part A: 0 for success, 1 for a failure or refusal, 2 for wrong usage.
- `--help` works for every command.

## Ids

- **Format:** `^[a-z][a-z0-9]{1,30}$`. Lowercase letters and digits, 2–31 characters, starting
  with a letter, as every existing theme and plugin id is. There are no hyphens, because the id is
  also the import name in `manifests.ts`.
- **Refused when taken:** an id is refused when its directory already exists, or when it is
  already listed in that kind's `manifests.ts` or `registry.ts`.

## `tome theme new <id> [--from plain|paper|almanac] [--dry-run]`

- **It copies `src/themes/<from>/`** (default `plain`) to `src/themes/<id>/`. It does not use a
  separate template, so the start is always the current contract.
- **Renaming in the copy:**
  - the theme id where it appears as the id: the manifest `id`, `body` or data attributes, and
    registry-style references;
  - CSS class prefixes that carry the source theme's id, e.g. `.plain-head` becomes `.<id>-head`,
    and `almanac-` becomes `<id>-`;
  - the manifest's `name` and `description`, which become the id itself in both en and th, for the
    author to edit.

  Renaming follows explicit, tested rules; it is not a blind replace of every occurrence of the
  word. Words in comments and prose that merely mention the source theme are left alone.
- **Font links.** A font the source theme loads, such as Almanac's Trirong `fonts.css`, carries
  over as a link to the same files. Nothing is copied under `public/fonts/`.
- **Registration.** It adds `<id>` to `src/themes/manifests.ts` (the import and the
  `THEME_MANIFESTS` entry) and to `src/themes/registry.ts` (the dynamic import), and to any other
  list that names every theme, if one exists. The theme is then selectable under
  Appearance → Themes.
- **Next steps.** It prints them: `npm run dev`; choose it under Appearance → Themes; then
  `npm run tome -- check`.

## `tome plugin new <id> --hook publicPage|signIn|editorSuggestions [--client] [--dry-run]`

- **It writes `src/plugins/<id>/plugin.ts`,** a manifest that declares the hook, with the name and
  description set to the id in en and th and no settings.
- **It writes `src/plugins/<id>/index.ts`** with the default export typed `Plugin`:
  - **The required methods** for the chosen hook, returning safe defaults, so nothing appears until
    the author writes real code:
    - `signIn`: `signInWidget` returns `null`, and `verifySignIn` returns `{ outcome: 'passed' }`;
    - `publicPage`: `siteNotice` returns `null`;
    - `editorSuggestions`: `categoryLikelihoods` returns `[]`, or whatever the contract's empty
      answer is.
  - **The always-required sign-in pair,** in the same harmless form, as `contract.ts` demands of
    every plugin. Take every shape from `src/plugins/contract.ts`; never guess.
- **With `--client`,** it writes `client.ts` and the `publicClient` method, following how existing
  plugins do it (e.g. lightbox).
- **Registration.** It adds the plugin to `src/plugins/manifests.ts` and `src/plugins/registry.ts`.
  It appears on the Plugins screen switched off, since plugins start off.
- **Next steps.** It prints them, as `theme new` does.

## Editing `manifests.ts` and `registry.ts`

- **Lines are inserted at known anchors:**
  - the last `import { manifest as … }` line;
  - the array literal of `THEME_MANIFESTS` or `PLUGIN_MANIFESTS`;
  - the object literal of the registry, kept in alphabetical order where the file already is.
- **When an anchor is missing or ambiguous,** it changes nothing. It prints the exact lines to add
  by hand and exits 1. A file in an unexpected shape is never rewritten.
- **The order of work:**
  1. check the id;
  2. check the anchors;
  3. write the new directory;
  4. edit the two files.

  If an edit then fails, the new directory is removed, so a half-made theme or plugin is never
  left behind.
- **`--dry-run`** prints the files it would create and the exact lines it would add, and writes
  nothing.

## `tome check`

`tome check` checks every theme and every plugin, and reports each problem as
`path:line: what is wrong`. It exits 0 when there are none, and 1 otherwise.

**Rules:**
1. **Directories match ids.** Every directory under `src/themes/` and `src/plugins/` that holds a
   theme or plugin has a manifest whose `id` equals the directory name. Skip shared files, such as
   `contract.ts` and `registry.ts`.
2. **Listed in both places.** Every theme and plugin is listed in both its `manifests.ts` and its
   `registry.ts`, and nothing is listed there that has no directory.
3. **Required files.**
   - A theme has `index.ts`, `theme.ts`, `Shell.astro`, `Home.astro`, `Post.astro`, `Page.astro`
     and `theme.css`.
   - A plugin has `plugin.ts` and `index.ts`.
   - A plugin with a `publicClient` has a `client.ts`.
4. **Settings are well formed** (themes and plugins):
   - keys are unique;
   - the kind is one the contract allows;
   - every `label` and `hint` has non-empty `en` and `th`;
   - a `choice` has options, its fallback is one of them, and every option label has `en` and `th`;
   - a `text` setting has a max length;
   - a `switch` fallback is `on` or `off`.

   Read the shapes from `src/themes/contract.ts` and `src/plugins/contract.ts`.
5. **Hooks are implemented.** A plugin implements the methods the hook it declares requires, and
   the always-required sign-in pair. Check this by loading the module's default export and
   inspecting function properties, with no execution beyond the import. If importing is unsafe,
   check statically.
6. **No server imports in themes.** Themes import nothing from `src/server/`. An existing unit test
   may already guard this; reuse its logic, and do not duplicate it.
7. **Tokens.** A theme's CSS uses tokens only. Run the existing `scripts/check-design-tokens.mjs`
   logic on each theme's CSS; do not write a second checker.

`npm run check` runs `tome check`, so CI catches these before merge.

## Docs

Both pages are in en and th.
- **`extending/themes.md` and `extending/plugins.md`:** a short section at the top, "Starting
  with tome", covering `npm run tome -- theme new …` / `plugin new …`, what each creates, and
  `tome check`.
- **`running/cli.md`:** a short "Building themes and plugins" section, which says these commands
  run in a source checkout, not on the server, and links to the two pages above.

## Tests

- **Unit:**
  - the id validation;
  - finding the repository root;
  - every rename rule (the id, class prefixes, the manifest; prose left alone);
  - the anchor edits, both the expected output and the refusal when an anchor is missing or
    ambiguous;
  - rollback when an edit fails;
  - `--dry-run` writing nothing;
  - the plugin skeleton for each hook, with and without `--client`;
  - each `tome check` rule, each with a failing fixture;
  - exit codes.

  Use a temporary copy of the needed parts of `src/themes` and `src/plugins`. Never touch the
  working tree.
- **The real repository:** `tome check` passes on the current repository. That is part of
  `npm run check`.
- **CI** (a step in the workflow, or a test that copies the repo to a temp dir):
  1. `tome theme new zzdemo` and `tome plugin new zzdemoplugin --hook publicPage --client`;
  2. `astro check` and `tome check` on that copy;
  3. throw the copy away.

  This proves the generated code builds.

## Release

1.12.0, with no migration. The updater and the server's `tome` are unchanged in what they do on a
server: these commands refuse outside a checkout. `UPDATER_VERSION` stays 1.5.0.
