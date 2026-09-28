# Can a theme or a plugin be updated on its own?

Feasibility study for TomeCMS 1.0.4 (the `develop` branch, Astro 7.3.3). Read-only: nothing in the repo was changed. Written 2026-09-29.

Labels used below: **Verified** = read in this repo's code or docs, with a path. **Inferred** = my reasoning from what I read, not tested. **External** = from a web page, cited.

---

## Answer in short

Not as the product is built today. A theme or plugin is compiled into the same application image as everything else, so changing one means building, signing, downloading and installing a whole new image, with the full backup, the restart and the health check that come with it. The cheapest real improvement is to make that whole-image update lighter when nothing in the database changes (the backup is what makes it slow), because that keeps every safety check you have. The only thing that could later be updated truly on its own, with the least new risk, is a theme's look (colours, fonts, CSS) shipped as signed data. Code that runs on your server (plugins) should not be loadable while the site runs: nothing in this stack (Node in Docker) can fence it in, and the product's own design notes say the same.

---

## How it works today

### Themes and plugins are part of the build (Verified)

| Fact | Where |
|---|---|
| A theme is a folder of Astro templates (`Shell`, `Home`, `Post`, `Page`), a `theme.css` and a manifest. Two exist: `paper`, `plain`. | `src/themes/paper/`, `src/themes/plain/` |
| The registry is a fixed list of dynamic imports. Vite splits each theme into its own chunk; nothing is found at runtime. | `src/themes/registry.ts:13-16`, `:35-37` |
| The stylesheet is found by a build-time glob (`import.meta.glob(..., { eager: true, query: '?url' })`). | `src/themes/styles.ts:17` |
| The admin names themes from a separate static list of manifests, so the Themes screen never loads a theme. | `src/themes/manifests.ts:9` |
| A plugin is a folder with `plugin.ts` (manifest), `index.ts` (hooks) and optionally `client.ts` (browser code). Five exist: turnstile, notice, popup, lightbox, typesafe (Jev). | `src/plugins/` |
| The plugin registry is also a fixed list of dynamic imports; `loadPlugin(id)` returns `null` for anything not in it. | `src/plugins/registry.ts:7-25` |
| Plugin browser code is found by a build-time glob of `./*/client.ts`. | `src/plugins/clients.ts:9` |
| The plugin manifests are a fixed static list. | `src/plugins/manifests.ts:12` |
| There is **no runtime loading anywhere**. The user docs say it outright: "nothing installs a theme while the site runs" and the same for plugins. | `website/src/content/docs/extending/themes.md:9`, `extending/plugins.md:11` |

What the build actually produces: `dist/server/chunks/paper_*.mjs`, `lightbox_*.mjs`, `turnstile_*.mjs` and so on. Each one imports the Astro render runtime, `i18n`, `Icon`, `SiteBrand` and other core code from **sibling chunks whose file names carry a content hash** (for example `./sequence_CgQow6uc.mjs`, `./i18n_B2JGoxkA.mjs`), and the Astro runtime itself is bundled inside `sequence_*.mjs` (its `#region node_modules/astro/dist/runtime/server/...` markers are there). Verified in the local `dist/` build of 2026-09-28: `dist/server/chunks/paper_DZHUB2-G.mjs:1-14`, `dist/server/chunks/sequence_CgQow6uc.mjs:487`, `dist/server/chunks/lightbox_C5Cmgd4L.mjs:1`. Those hashes change on every build.

### What the admin screens store (Verified)

The "Themes" and "Plugins" screens do not install anything. They **choose and configure code already in the image**, and keep the answers in the database:

| What | Where it lives | Code |
|---|---|---|
| Which theme is active | `site_settings.theme_id`, validated by "is this an id in the registry" | `src/server/content/settings.ts:31` |
| A theme's options (hero, columns, sticky header...) | `site_settings.theme_settings` (jsonb, keyed by theme id). The manifest declares each option; the store accepts only declared values and drops keys the theme no longer declares. | `src/server/themes/store.ts:44-82`, migration `016_theme_settings.ts` |
| Whether a plugin is on, and its settings | table `plugin_settings` (`id`, `enabled`, `settings` jsonb). Secrets are sealed with `TOME_CMS_CONTEXT_SECRET` and never sent back to a browser. | `src/server/plugins/store.ts:31-139`, migration `013_plugin_settings.ts` |
| Running a plugin on a public page | On every page, the server loops over the fixed plugin list, reads the enabled ones, calls their hooks and draws the result itself. | `src/server/plugins/public.ts:75-107` |
| Running a plugin at sign-in | Same pattern; a plugin that throws counts as "unavailable", not as a failed visitor. | `src/server/plugins/sign-in.ts:26-70` |

A useful consequence: **switching, configuring and even swapping a theme or plugin never needs a database migration.** Their data is jsonb settings under an id. Only the code is tied to the image.

### How a release is built and shipped (Verified)

1. A version bump on `develop`, plus a release-notes file `docs/releases/<version>.md`, is required (`tag-release.yml:81-84`). CI on that commit takes "about half an hour" per the workflow's own comment (`tag-release.yml:28`).
2. A merge into `main` with a new version is tagged automatically and `release.yml` runs on the tag (`tag-release.yml:65-87`, `release.yml:6-10`). The tag must equal `package.json`'s version (`release.yml:38-51`).
3. `release.yml` runs `npm run check`, unit tests and `npm run build` (`:56-63`), builds one multi-architecture image (amd64 + arm64, "about 4 minutes", `:100-112`), and attests it with GitHub artifact attestations (`:123-129`).
4. It then writes `update-manifest.json` (`:140-159`), attests that too (`:161-165`) and publishes a GitHub release with three assets: manifest, manifest attestation, image attestation (`:176-181`).
5. The Dockerfile builds the whole app in one stage (`Dockerfile:9-13`) and the runtime image copies `dist/` as one layer (`:28`), then runs `node dist/server/entry.mjs` (`:42`). `dist/` is about 4 MB, so download size is not the cost.
6. The manifest is a fixed, exact-key JSON: version, source commit, one image digest, and compatibility fields (`minimumDirectUpgradeFrom`, `minimumUpdaterVersion`, `targetMigration`, `rollbackSafeFrom`, `composeContract`, `environmentContract`, `updaterProtocol`) (`src/update/contracts.ts:16-39`). Unknown keys are rejected (`:62-64`, `:124-133`).
7. On the owner's server the host-side updater verifies the release: it must be immutable, with exactly the three official assets (`src/updater/verify.ts:225-255`); it verifies both attestations with `gh attestation verify`, pinned to the signer workflow `release.yml`, the source ref `refs/tags/v<version>`, the manifest's commit, and no self-hosted runners (`verify.ts:95-113`); and it checks that the compose/environment/updater contracts match (`verify.ts:294-312`).
8. Then the transaction (`src/updater/transaction.ts`): pull the image by digest (`:103`), list its migrations offline (`:105-108`), **stop the app** (`:115`), **take a full backup** (`:117-124`), write the new digest (`:125`), run migrations (`:129-130`), start the app (`:133`), wait for readiness (`:135`, up to 15 tries), and on failure swap back to the old digest (`:146-159`).

### What would change if only one theme file changed (Verified for the steps, Inferred for the conclusion)

Nothing about the pipeline gets smaller. A one-line CSS fix in `src/themes/paper/theme.css` still needs a version bump, a release-notes file, the ~30 minute CI run, the full release job, a new image digest (the digest changes because `dist/` file names are hashed), two attestations, and on the owner's server the whole update transaction above, including stopping the site and copying the whole database and every media file.

The last part is the real cost to an owner:

- **The site is down during the backup.** The app is stopped first (`transaction.ts:115`) and the backup runs as a one-shot while it is stopped (`:117-121`, `--offline --direct`). Public pages and the admin are unreachable for its duration.
- **The backup copies the whole media library, every time.** `mirrorObjects` lists the bucket and reads each object completely into memory, hashes it and writes it out (`scripts/backup.ts:147-175`). Time grows with the size of the library.
- **Backups are never pruned.** "It never deletes old backups, so leave room for them on the disk" (`website/src/content/docs/running/updating.md:37`). The check requires 5 GiB free (`src/updater/config.ts:32`).
- **Timeouts, not measurements, are all I can give you** for the length: stop grace 30 s (`transaction.ts:38`), backup up to 60 min, pull up to 15 min, migrations up to 15 min, start wait up to 90 s (`:473`), plus a 2 s drain (`:114`). Nothing in the repo records a measured end-to-end downtime, and I did not run one.
- The design accepts a maintenance window as a non-goal ("A no-downtime deployment", `docs/specs/2026-09-13-managed-web-updates-design.md:57`).
- Rollback after a failed update swaps the image only; restoring the backup is done by hand (`updating.md:38`). So for a release with **no migration**, the backup does not feed any automatic step. It protects against a bad migration and against manual recovery. (Verified from `transaction.ts:139-165`; the judgement that it is therefore optional for a no-migration release is mine and is the owner's call.)

The release cadence is already fast: five releases on 2026-09-28 alone (1.0.0 to 1.0.4, plus 0.14.1) per `git log`. The 1.0.4 notes say "no migration, no new setting and no new runtime dependency" (`docs/releases/1.0.4.md`), which is exactly the kind of release a theme or plugin fix would be.

### What a theme or plugin depends on (Verified)

The typed contract is narrow. The real dependency surface is much wider.

**Themes**
- Typed: manifest and four prop types (`src/themes/contract.ts:63-135`). A theme gets data as props and no handle to fetch more. Themes are barred from importing `/server/` by a test (`tests/unit/theme-registry.test.ts:49-52`).
- Not typed, but relied on: templates import core components and libraries directly: `Icon.astro`, `LanguageSwitcher.astro`, `SiteBrand.astro`, `ThemeToggle.astro`, `lib/i18n`, `lib/posts`, `lib/editor-content` (the sanitizer schema), `lib/home-slides`, `lib/theme`, `types/cms` (`src/themes/paper/Home.astro:2-8`, `parts/Header.astro:2-8`, `plain/Shell.astro:2-6`).
- CSS: `paper/theme.css` uses about 40 distinct design tokens from `src/styles/installer-tokens.css` (`--space-*`, `--color-*`, `--text-*`, `--rule-hair`, `--radius-*`, `--dur-*`, `--ease-out`, `--z-sticky-nav`), and relies on rules kept in `global.css` (`.icon`, `.sr-only`, `.article-title`, the category chip); see the header comment of `src/themes/paper/theme.css:1-14`.
- Tailwind: templates use utility classes (`flex min-h-screen flex-col` in `paper/Shell.astro:18`), which exist only because Tailwind scans `./src/**/*` at build (`tailwind.config.mjs:4`). A theme built elsewhere would not have them.
- Themes are also rendered **inside the admin page**: the post and page preview screens draw the active theme's templates and stylesheet in `AdminLayout` (`src/pages/admin/preview/[id].astro:68-76`, `src/pages/admin/pages/preview/[id].astro:56-61`).

**Plugins**
- Typed: manifest, settings kinds, and a `Plugin` interface with five families of hook (`src/plugins/contract.ts:1-225`). The comment at the top says a plugin has no hook for startup code, the database or routes (`:3-7`).
- Not enforced: plugin code runs **in the server process** with the same environment as the rest of the app. The "no reaching into `src/server`" rule is a convention reviewed in the same commit. I found no test that enforces it for plugins (there is one for themes). Today no plugin imports server modules or reads `process.env` (grep of `src/plugins`), but nothing but review would stop one.
- Plugin browser code imports core libraries (`lightbox/client.ts:1` imports `lib/overlay-motion`). Its styling lives in the core stylesheet (`src/styles/global.css:227-241` for the lightbox); the docs state "A plugin ships no stylesheet" (`extending/plugins.md`). So a plugin change can require a core CSS change.
- `publicClient` runs plugin code in every reader's browser. The contract says this is acceptable **only because plugins ship in this repository and cannot be installed at runtime**, and that if runtime installation is ever added, the hook "has to be revisited before it is" (`src/plugins/contract.ts:184-189`, `docs/specs/2026-09-20-public-plugin-hooks-design.md:92-96`).
- Two of the five plugins are thin adapters to someone else's HTTP service (Cloudflare Turnstile at `plugins/turnstile/verify.ts:3`, TypeSafe at `plugins/typesafe/api.ts:8`). Three are UI that the core draws or mounts (notice, popup, lightbox).

**Stability of the contracts** (Verified): neither contract carries a version field (grep for `contractVersion|apiVersion|schemaVersion` in `src/themes` and `src/plugins` finds nothing). Both changed often and recently: the theme contract in 10 commits between 2026-09-20 and 2026-09-23, the plugin contract in 8 commits between 2026-09-20 and 2026-09-24 (`git log -- src/themes/contract.ts src/plugins/contract.ts`). Today the compiler holds every theme to the contract at build time (`interface Props extends ThemeHomeProps`, described in `contract.ts:26-29`). That guarantee disappears the moment a theme or plugin is built separately from the core.

### Security posture any solution must keep (Verified)

- **Everything that is installed is verified.** Attestations bind the manifest and the image to the official repo, the `release.yml` workflow, the version tag and the commit (`verify.ts:95-113`; the installer does the same at `scripts/install-managed-vps.sh:406-409`). The browser cannot submit a URL, image, digest, or plugin (`docs/specs/2026-09-13-managed-web-updates-design.md:54` lists "Installing arbitrary container images, Compose files, scripts, plugins, or URLs supplied by the browser" as out of scope).
- **The web process is denied Docker.** The app talks to the host updater over a socket with one narrow protocol (`src/updater/server.ts`, design doc lines 11 and 117-119). Only the updater runs Docker Compose.
- **The updater is hard-wired to one image.** Its config has fixed, exact keys and one image repository (`src/updater/config.ts:18-31`, `src/update/contracts.ts:1-2`); `image.env` holds exactly one app digest (`verify.ts:330-335`). The installed compose file is copied once at install; a web update "replaces only the application image" and the updater, PostgreSQL and SeaweedFS "are upgraded by hand" (`updating.md`). A change to the compose contract makes a web update refuse with "Update contract is incompatible" (`verify.ts:307-311`).
- **Content is sanitised at a strict boundary**: editor HTML goes through a `sanitize-html` schema (`src/lib/editor-content.ts:1`, `:94`), settings that end up in style attributes are accepted only as `#rrggbb` (`store.ts:11`, `:98-102`), plugin links must be same-origin or https (`public.ts:31-39`), and plugins return **data, not markup**.
- **I found no Content-Security-Policy in the repository**, and no framing or content-type headers either; the only response headers I found set are `Referrer-Policy: no-referrer` on some responses (`src/server/http/problem.ts:40`, `public-response.ts:56`, `src/pages/recovery.astro:21`). A case-insensitive search of the whole tree, excluding `node_modules`, `dist` and `.git`, finds no `content-security-policy` string, and `deploy/cloud-init.yaml` sets no headers. So today the sanitiser and the "plugins return data" rule are the only defences on the public site; a design that loads foreign CSS or JS must not assume a CSP will catch it. (I am reporting this as a fact about the repo, not proposing a header.)
- **Provenance display**: the owner decided on 2026-09-24 that when third-party plugins exist, an "Official" badge is set by the core from its own registry, never from a manifest's own claim (project memory `plugin-names-no-tome-prefix`).
- Any change under `src/update`, `src/updater` or `src/server/update` must also pass `npm run test:operations:update` locally, because unit tests alone once missed a break that failed a release (project memory).

### The project has already thought about this (Verified)

`docs/specs/2026-09-14-plugin-system-design.md` (status "not scheduled") names four shapes: **A** declarative (data only), **B** sidecar container, **C** build-time (npm dependency), **D** runtime module loading from a mounted volume. It says A and B fit the product, C makes every plugin a fork, and D "asks a single-owner CMS to solve sandboxing, which is a research problem wearing a feature's clothes." It also warns that any shape running plugin code inside the core process asks the owner to trust plugin authors the way they trust the product. The 2026-09-20 plugin design lists "installing or uploading a plugin at runtime" as out of scope and "a later question" (`docs/specs/2026-09-20-plugin-system-design.md:32-33`, `:42`). The theme note says a tier-1 palette "is the one that fits the product as it stands" (`docs/specs/2026-09-14-theme-system-design.md`). This study reuses that thinking and tests it against the code as it is now.

---

## Options

Effort: S = days or less, M = about a week, L = several weeks, XL = a project. Risk is to the owner's site and to the verified-release model.

| | Option | Can a theme/plugin update alone? | Effort | Risk | Effect on the verified-release model |
|---|---|---|---|---|---|
| **A** | Keep everything in the image; make whole-image releases cheap (a "light update" lane) | No, but the cost of a small update drops to a restart | M | Low | None. Same signer, same manifest, same image by digest. |
| **B** | Runtime-loaded bundles from a mounted volume | Yes, code included | XL | High | Breaks it: a second signer/format, a new compose volume, code outside the attested image. |
| **C** | Themes as data (tokens + CSS), signed, installed at runtime; code stays in the image | Yes, for a theme's look only | M (first-party only) to L (owner-authored) | Medium | Adds a second, narrower signed artifact type. The image path is untouched. |
| **D** | A plugin runs as its own service (sidecar) behind an HTTP contract | Yes, for the async plugin hooks | L to XL | Medium-high | Needs the updater to manage a second image; today it is hard-wired to one. |
| **E1** | Themes in a restricted template language (Ghost style) | Yes, look and layout | XL | Medium | New renderer plus a second signed artifact type. |
| **E2** | A sandboxed plugin runtime (EmDash style) | Yes | XL | High (until proven) | Depends on a sandbox this stack does not have. |
| **E3** | Themes as separate headless front ends | Yes, by leaving the product | S to build, M to support | Medium | Outside the managed model entirely. |

### A. Keep it in the image; make releases cheap

**What it enables.** A theme or plugin fix ships as a normal patch release, and the owner installs it in about the time it takes to restart. Nothing new to trust.

**What it costs and what to change.** Three levers, in order of value:

1. *Skip or slim the backup when the release has no migration.* The updater already lists the target image's migrations offline (`transaction.ts:105-108`, `src/updater/inventory.ts`). It could list the **running** image's migrations the same way and compare. If they are identical, no migration will run, the database schema is unchanged, and the full media mirror (`scripts/backup.ts:147-175`) is the slow part that buys nothing automatic (rollback only swaps the image, `transaction.ts:146-159`). Options are: skip the backup, or take a database-only dump. This needs **no new manifest field**, which matters: the manifest parser rejects unknown keys (`contracts.ts:124-133`), so a new field would first have to reach every installed app and updater before a release could use it. (Inferred: I did not prototype this.) The catch is that the "Create recovery backup" step is one of eight fixed steps in the state machine and the admin copy (`state.ts:21-35`, `updating.md:31`), so the change touches the updater, the state machine, the admin progress screen and its tests, and must pass `npm run test:operations:update`.
2. *Shorten time to release.* CI is about 30 minutes and the release job about 10 more (`tag-release.yml:28`, `release.yml:100`). A hotfix lane that skips the browser suites is possible but weakens the gate that stops broken releases, so I would not start there.
3. *Prune old backups* by a retention rule. The design defers this (`docs/specs/2026-09-13-managed-web-updates-design.md:390`), and with more frequent small updates the disk fills faster, so it becomes necessary if lever 1 is not taken.

**Security.** No change. **Limits.** A user still gets a new TomeCMS version number for a theme fix, and a third party cannot ship anything on their own.

### B. Runtime-loaded packages from a mounted directory or volume

**What it enables.** Drop a signed bundle into a volume, restart or reload, and a new theme or plugin runs without a new image. This is the WordPress model.

**Why it is hard here (Verified unless marked):**
- *The SSR bundle is built ahead of time with hashed chunk names.* A separately built bundle cannot import `./sequence_CgQow6uc.mjs` or `./i18n_B2JGoxkA.mjs`, because those names change on every build (see the chunk list above). Either each bundle carries its own private copy of Astro's runtime and of core modules (duplicated code, two copies of `SiteBrand`, `i18n`, the sanitiser schema), or the core would have to publish a **stable, versioned SDK** as unhashed external entry points and Astro's runtime would have to stop being bundled into the hashed chunk. The local build confirms the runtime is bundled into a hashed chunk; an Astro issue also mentions the server build setting `noExternal: ["astro"]` (External, search snippet only: github.com/withastro/astro/issues/16679). I did not test overriding that.
- *`.astro` files are compiled by the Astro compiler into calls to internal helpers* (`createComponent`, `renderTemplate`, seen in `paper_*.mjs:1-14`). A pre-compiled theme therefore couples to the exact Astro version. (Inferred: these helpers are internal, not a documented API.)
- *Tailwind classes exist only if scanned at build* (`tailwind.config.mjs:4`), and client scripts (`hero-slider.ts`, plugin `client.ts`) become hashed assets referenced by Astro. A runtime bundle needs its own CSS and a route to serve its scripts.
- *The compose file has no volume for code.* The `app` service mounts only `/run/tome-cms` (`compose.managed.yaml:55-56`). Adding one changes the compose contract, and a web update refuses on a contract mismatch (`verify.ts:307-311`), so every existing installation needs a manual step first.
- *Rollback gets harder.* The updater rolls back by image digest. Bundles built for newer core code would be left in the volume next to an older image, so installed state would have to record the bundle set and each bundle would need a "works with core X to Y" range. Neither contract has a version today (see above), and both changed almost daily in their first week.
- *Node cannot fence a plugin in.* Plugin code would run in the same process as the database URL, the S3 keys and the key that seals plugin secrets (`TOME_CMS_CONTEXT_SECRET`, `store.ts:122`). Node's `vm` module is documented as not a security mechanism (External, from memory of https://nodejs.org/api/vm.html, not fetched this session), and I know of no per-module permission model in Node; permissions there apply to the whole process. A downloaded plugin could read and write anything the app can, and a theme rendered in the admin preview (`preview/[id].astro:76`) would run its scripts in the admin's origin. This is exactly the trust shift the project's own notes rule out (`2026-09-14-plugin-system-design.md`, "Security, stated plainly").

**Security and verification.** The current attestation policy is pinned to one workflow, one repo and a `refs/tags/vX.Y.Z` ref (`verify.ts:95-101`). Bundles would need a second policy (a component workflow, or per-author identities plus a trust list) and a way to say "this bundle is compatible with this core". `gh attestation verify` can verify any file with a bundle, as it already does for the manifest (`verify.ts:104`), so the tooling is reusable; the trust decisions are new.

**Effort/risk.** XL and high. It also needs a plugin sandbox (a separate process, which is option D) before it is safe for anything but first-party code. I would not do this.

### C. Themes as data: tokens and CSS only

**What it enables.** A theme "skin": a signed file holding token values and optional CSS, applied over an existing template set. The owner can install a new look, or receive a fixed colour or spacing bug, without a new image, with no code executing. The current `paper` theme already has eleven declared options stored as data (`src/themes/paper/theme.ts:8-151`), so "data-driven theme" is a small step from how settings work.

**What it cannot do.** It cannot change markup or behaviour. The templates (`Home`, `Post`, `Shell`, ...) stay in the image. Of the paper theme's 1,580 lines, `theme.css` is 722 (about 46 percent), the templates, parts and scripts about 693 (44 percent) and the manifest 152 (`wc -l` of `src/themes/paper`). The 2026-09-14 theme note calls this tier "most of what an owner means when they ask to change the look".

**What it costs (Verified constraints, Inferred design):**
- *Contrast proof.* Any palette must clear `tests/unit/theme-contrast.test.ts` in light and dark, and the note says either themes are first-party and measured, or the product needs a validator that refuses bad contrast at install time (`docs/specs/2026-09-14-theme-system-design.md`, tier 1).
- *CSS is not inert.* `url()`, `@import` and attribute selectors can make requests or leak values. The theme's stylesheet is also loaded in the admin layout during previews (`preview/[id].astro:76`), so a foreign stylesheet reaches the admin document. A package would need a parser-based allow-list (no `@import`, no external `url()`, allowed properties only) and should be applied only to the public site, or scoped inside the preview frame. With no CSP in the repo (above), this filter is the only line of defence.
- *Storage and delivery.* Verification uses `gh attestation verify`, which runs on the host in the updater, not in the app (`verify.ts:102-113`). The updater would need a second narrow request over its socket ("install skin X at version Y"), verify the file, and hand the bytes back to the app to store in the database or the bucket. The app never gets Docker.
- *A new signed artifact type*, with its own manifest (id, version, `requiresCore` range, token list, hash) and its own attested workflow, separate from `release.yml`. This is additive: the image/manifest path stays as it is.
- *Compatibility.* Tokens are the stable part of the design system (`installer-tokens.css` is the source of truth, per project memory). A skin should declare the token set it was made against and be ignored, not fail, if the core removes a token.

**Effort/risk.** M if only the TomeCMS team publishes skins (measured against the contrast test, applied from a fixed list). L if owners may write their own, because the CSS filter, the contrast validator and an editor become part of the product. Risk medium, contained to appearance.

### D. A plugin as its own service (sidecar)

**What it enables.** A plugin runs in its own container and is called over HTTP; it updates alone, fails alone, and cannot touch the app's database or secrets. This is shape B in the project's own note, and the e-commerce note says a shop needs it (`docs/specs/2026-09-14-ecommerce-plugin-design.md`). The repo already has one such design: the parked self-hosted suggestions model is a `systemone` Compose service on the internal network with no published port (`docs/plans/2026-09-21-self-hosted-systemone-implementation.md:33`, `:86`, `:212`).

**Fit with today's hooks (Verified by reading the contract).** Only some hooks can be remote:
- Async, tolerant hooks already return `null` for "could not ask": `verifySignIn`, `categoryLikelihoods`, `pickExcerpt`, `pickDescription` (`src/plugins/contract.ts:99-102`, `:199-224`). Turnstile and Jev are already thin adapters to someone else's HTTP API, so for them the "sidecar" is effectively the vendor.
- The public-page hooks (`siteNotice`, `sitePopup`, `publicClient`) are synchronous and called on every page render (`src/server/plugins/public.ts:83-104`). Making them network calls adds latency and a failure mode to every reader's page, and they exist to mount browser code, which a sidecar does not remove. These would need caching or stay in-image.

**What it costs.**
- *The updater cannot manage a second image.* It is fixed to one repository and one digest (`src/updater/config.ts:18-31`, `src/update/contracts.ts:1-2`, `verify.ts:330-335`), and a compose change makes web updates refuse (`verify.ts:307-311`). Managing sidecars means a new manifest version, a list of allowed component images, per-service health and rollback, and its own backup considerations. That is the bulk of the work.
- *A contract on the wire*: authentication (a scoped token per plugin), timeouts, versioning, and what the core does when the service is down (the sign-in contract shows the pattern to keep: down means "unavailable", never a lock-out).
- *Ops burden shifts to the owner*: today they run three services, this adds more, on servers that may already be small (project memory notes a 1 GB test VPS).

**Security.** The best of the runtime options: process and network boundary, revocable token, no shared secrets. Each sidecar image would be attested and pinned by digest like the app.

**Effort/risk.** L to XL. Worthwhile only when a plugin genuinely needs to run long, hold state or use a different runtime (a shop, a model server), not for banners and lightboxes.

### E. Other options with precedent

**E1. Restricted template language for themes (Ghost style).** External: Ghost themes are Handlebars templates plus CSS, uploaded as a zip in the admin, and Ghost has no in-process plugin system; extension goes through API integrations and webhooks ([Ghost theme docs](https://docs.ghost.org/themes/), [custom integrations](https://ghost.org/integrations/custom-integrations/)). This is why uploading a Ghost theme is comparatively safe: templates cannot run arbitrary code. For TomeCMS it would mean a second renderer (the current themes are Astro components) that supports the same props and the sanitiser, plus the same signed-artifact plumbing as option C. It would let a theme change layout as well as look. XL, and it duplicates what Astro components already do.

**E2. A sandboxed plugin runtime (EmDash style).** External: Cloudflare's EmDash, an Astro-based CMS announced in April 2026, runs each plugin in an isolated Worker sandbox with a manifest of declared capabilities, and the README says self-hosted Node deployments run plugins "in-process (safe mode)" instead ([Cloudflare blog](https://blog.cloudflare.com/emdash-wordpress/), [EmDash README](https://github.com/emdash-cms/emdash/blob/main/README.md)). The lesson is that real isolation came from the platform (Workers), not from the CMS. TomeCMS runs on Node in Docker, so the equivalent would be a separate process per plugin, which is option D.

**E3. Themes as separate headless front ends.** TomeCMS already serves a versioned REST API (`src/pages/api/v1/content`, README line 8), so a developer can build a front end anywhere and update it independently. This is the Strapi/Payload pattern. It is not a path for a non-expert owner: the plugins' page additions (notice, popup, lightbox mounts, maintenance mode, theme settings) are injected by the TomeCMS renderer (`BaseLayout.astro:96-135`) and would not apply.

**E4. Build-it-yourself installs (Strapi, Payload).** External: Strapi plugins are npm packages and the admin panel has to be rebuilt after changes ([Strapi admin docs](https://docs.strapi.io/cms/configurations/admin-panel)); Payload plugins are functions that transform the config at build time ([Payload plugins](https://payloadcms.com/docs/plugins/overview)). In both, installing an extension means rebuilding, which is the project's shape C. That is fine for a developer and contradicts the managed model, where the owner never builds.

**E5. Layering the image so only the theme layer changes.** Not useful. `dist/` is one 4 MB layer and the pull is not the bottleneck; the stop, backup and health check are.

**How WordPress compares (External).** Themes and plugins are PHP dropped into `wp-content` and updated on their own, running with the full privileges of the site. Core verifies signatures for core updates only, in a soft-fail mode by default, and does not verify plugin or theme packages ([WP Elevator guide](https://wpelevator.com/guides/wordpress-package-signing); the long-running Trac tickets [#39309](https://core.trac.wordpress.org/ticket/39309) and [#46615](https://core.trac.wordpress.org/ticket/46615) track it; I could read only search snippets of the tickets themselves). That is the model TomeCMS's verified-release design was built to avoid.

---

## Recommendation

**Choose option A, strengthened: keep themes and plugins in the image and make a small release cheap.** In particular, let an update that brings no migration skip the full media backup, so the site is down for about the length of a restart instead of the length of a backup.

Why:
1. It answers the practical goal (ship a theme or plugin fix quickly and safely) without loosening anything. Every check you built (attestation, digest pinning, compatibility fields, rollback) still applies unchanged.
2. The slow, risky part of a small update today is not the download or the theme. It is that the site is stopped while the whole database and every media file are copied, and that these copies pile up unpruned. That is fixable in the updater and benefits every release, not only theme and plugin ones.
3. Independent code updates (B, D) are the expensive answers, and nothing in the product asks for them yet: there are two themes and five plugins, all yours, and the contracts have no version and were still changing daily in the first week. The project's own notes deliberately put runtime installation in "a later question". A stable, versioned SDK has to exist before anyone outside can build against it, and that is a product decision, not a patch.
4. If you later want a look-only update path, option C is the one piece that can be added without touching the image or the trust model, and A does not get in its way.

**First small step (S, no code).** On a test server, read the recorded `startedAt` and `finishedAt` of the updater job for the recent admin updates (the fields exist in `UpdateJob`, `src/updater/state.ts:33-34`), together with the size of `/var/backups/tome-cms/`. That gives the real downtime and the real disk cost of one small update, which this study could only bound from timeouts. Decide the target from that number.

**Second step (M), only if the number is worth cutting.** Let the updater compare the running image's migration list with the target's (the same offline helper `migrationInventoryArgs` already exists) and, when they match, take a database-only dump or none. Keep the current full backup for any release that has a migration. Run `npm run test:operations:update` as well as the unit tests.

**Decision point after that.** If you want owners to change or install a theme's look without a release, start C with first-party skins only. Do not start B. Revisit D when a real plugin needs to run its own service.

---

## Open questions for the owner

1. **Who is the update for?** Is the goal "we can ship a theme or plugin fix faster and with less downtime" (option A answers it), or "someone other than the TomeCMS team can publish a theme or plugin that an owner installs" (that is B, C or D, and needs a public, versioned contract and a trust list)?
2. **How long may the site be down for a small fix?** Give a number (for example "under two minutes"). It decides whether the no-migration lane is enough.
3. **Is the full backup required before an update that has no database change?** The updater's automatic rollback never uses it (`transaction.ts:146-159`); it only protects against a bad migration and manual recovery. Is a database-only dump acceptable, or must every update keep the full copy?
4. **Do you want owners to make their own look?** If yes (colours, fonts, CSS), that is option C in its larger form, with a contrast validator and a CSS filter as part of the product. If only the team publishes looks, C is much smaller.
5. **Would you accept a second signer?** Options B, C and D need a signed artifact that is not the app image. Should that stay under the same `release.yml` workflow (simplest, first-party only), or may there be other signers, shown with an "Official" badge as you decided on 2026-09-24?

---

## Evidence

### Loading and registration
- `src/themes/registry.ts:13-16` (dynamic import map), `:22-37` (ids, fallback to default)
- `src/themes/manifests.ts:9`; `src/themes/styles.ts:17` (`import.meta.glob`, `?url`)
- `src/themes/contract.ts:1-135` (props, manifest, settings; no version field)
- `src/themes/paper/index.ts`, `paper/theme.ts:8-151` (eleven declared options), `paper/theme.css:1-14` (what stays in core), `paper/Shell.astro:18`, `paper/Home.astro:2-8`, `paper/parts/Header.astro:2-8`, `plain/Shell.astro:2-6`
- `src/plugins/registry.ts:7-25`; `manifests.ts:12`; `clients.ts:9`; `contract.ts:1-225` (hooks, `:176-190` runtime-install warning)
- `src/plugins/turnstile/verify.ts:3`, `typesafe/api.ts:8` (remote services), `lightbox/client.ts:1`, `src/styles/global.css:227-241`
- `src/layouts/BaseLayout.astro:96-135`; `src/components/PluginClients.astro`
- `src/pages/admin/preview/[id].astro:68-76`, `src/pages/admin/pages/preview/[id].astro:56-61`
- `src/server/themes/store.ts:44-82`; `src/server/plugins/store.ts:11-139`; `public.ts:31-107`; `sign-in.ts:26-70`; `src/server/content/settings.ts:31`
- `src/server/db/migrations/013_plugin_settings.ts`, `016_theme_settings.ts`
- `tests/unit/theme-registry.test.ts:49-52` (themes cannot import `/server/`); no matching plugin test found
- `tailwind.config.mjs:4` (`content: ['./src/**/*...']`)
- Build output (local `dist/`, built 2026-09-28): `dist/server/chunks/paper_DZHUB2-G.mjs:1-14`, `lightbox_C5Cmgd4L.mjs:1`, `turnstile_B4rk3Awr.mjs:1`, `sequence_CgQow6uc.mjs:487`

### Release and update
- `Dockerfile:9-13,26,28,42`; `compose.managed.yaml:45-63`
- `.github/workflows/release.yml:6-10,38-63,100-112,123-129,140-181`; `tag-release.yml:28,65-87`
- `src/update/contracts.ts:1-2,16-39,62-64,124-133`; `scripts/release-manifest.ts:32-69`
- `src/updater/verify.ts:62-128,225-255,294-312,330-335`; `transaction.ts:38,99-165,473`; `state.ts:12-35`; `config.ts:18-32`; `inventory.ts`; `server.ts`
- `scripts/backup.ts:147-175`; `scripts/install-managed-vps.sh:406-409`
- `website/src/content/docs/running/updating.md` (steps, "never deletes old backups", "replaces only the application image"); `extending/themes.md:9`, `extending/plugins.md:11`
- `docs/releases/1.0.4.md` (no migration); `git log` (five releases on 2026-09-28; contract commit history)

### Design history
- `docs/specs/2026-09-14-plugin-system-design.md` (shapes A to D, security stated plainly)
- `docs/specs/2026-09-14-theme-system-design.md` (tiers; palette proof)
- `docs/specs/2026-09-14-ecommerce-plugin-design.md` (needs a sidecar)
- `docs/specs/2026-09-20-plugin-system-design.md:32-33,42`; `2026-09-20-public-plugin-hooks-design.md:92-96`
- `docs/specs/2026-09-13-managed-web-updates-design.md:11,54,57,117-119,390`
- `docs/plans/2026-09-21-self-hosted-systemone-implementation.md:33,86,212` (sidecar precedent)
- Project memory: `plugin-names-no-tome-prefix.md` (Official badge from the core's own registry), `tomecms-run-ops-harness-on-update-changes.md`

### External sources (paraphrased, not copied)
- Ghost themes: https://docs.ghost.org/themes/ ; Ghost custom integrations: https://ghost.org/integrations/custom-integrations/
- WordPress signing: https://wpelevator.com/guides/wordpress-package-signing ; Trac https://core.trac.wordpress.org/ticket/39309 and https://core.trac.wordpress.org/ticket/46615 (page fetch was refused; only search snippets seen)
- Strapi admin panel rebuild: https://docs.strapi.io/cms/configurations/admin-panel ; Payload plugins: https://payloadcms.com/docs/plugins/overview
- EmDash: https://blog.cloudflare.com/emdash-wordpress/ and https://github.com/emdash-cms/emdash/blob/main/README.md (the README's Node "safe mode" is stated in one line; details not documented there)
- Astro bundling its runtime into the server build: https://github.com/withastro/astro/issues/16679 (search snippet only)

### What I did not verify
- Real downtime and backup size of an update; no measurement exists in the repo and I did not run one.
- Whether a pre-compiled Astro component can be loaded from outside the build at all (I reasoned from the hashed chunks; I did not build a test bundle).
- Whether the installer's reverse proxy sets a CSP at run time; the repository shows none being configured.
- How the `Official` badge or any component registry would be stored; that is not designed yet.
