# Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A documentation site for TomeCMS in English and Thai, built with Astro Starlight under `website/` and published to `https://dhanabhon.github.io/tome-cms/`, which takes over the README's detail.

**Architecture:** `website/` is its own Astro project with its own lockfile. Content pages live in `src/content/docs/` (English, at the root) and `src/content/docs/th/` (Thai). The API reference is generated from the app's `src/server/http/openapi.ts`. Admin screenshots come from a Playwright script run against a disposable stack. `.github/workflows/docs.yml` builds and checks the site on every pull request that touches it, and deploys it from `main`.

**Tech Stack:** Astro 7, `@astrojs/starlight` 0.42, `starlight-openapi` 0.26, `starlight-links-validator` 0.26, Pagefind (bundled with Starlight), `@fontsource/ibm-plex-sans-thai`, Playwright (the root's), GitHub Actions and Pages.

**Spec:** `docs/specs/2026-09-25-docs-site-design.md`

## Global Constraints

- English is the `root` locale (`lang: 'en'`), and Thai is `th` (`lang: 'th'`). `site: 'https://dhanabhon.github.io'`, `base: '/tome-cms'`.
- Every page exists in both languages under the same file name: `src/content/docs/<path>.md` and `src/content/docs/th/<path>.md`. The build fails when one is missing.
- `website/` has its own `package.json` and `package-lock.json`. Nothing is added to the root's `dependencies`. The root gains two scripts and nothing else.
- `@astrojs/starlight` `^0.42.4`, `starlight-openapi` `^0.26.2`, `starlight-links-validator` `^0.26.0`, `astro` `^7.3.3` (the root's major version). Node 22.12 or later.
- The site looks like the app: `src/styles/installer-tokens.css` is imported, not copied, and mapped onto Starlight's accent and font properties. The font is IBM Plex Sans Thai, and the logo is `public/brand/`'s.
- The API reference is generated from `src/server/http/openapi.ts` into `website/src/generated/openapi.json`. That file is not committed.
- Admin screenshots come only from `npm run docs:screenshots`, taken on a disposable stack. They are never taken on the owner's port 4321, and never by hand.
- `docs.yml` pins every action by SHA and gives the deploy job only `pages: write` and `id-token: write`.
- **Writing rules (the `/humanizer` skill), for every page in both languages:**
  - No em dash (—) and no en dash (–), anywhere. Use a period, a comma, a colon or parentheses.
  - None of these words: *additionally, crucial, delve, fostering, garner, interplay, intricate, pivotal, showcase, tapestry, testament, underscore, vibrant, seamless*. Avoid *enhance, key* (as an adjective), *landscape* (figurative), *highlight* (as a verb), and *valuable* as well.
  - Plain `is`/`are`/`has` rather than *serves as, stands as, boasts, features*. No "It's not just X, it's Y". No lists of three used for rhythm. No trailing "-ing" clauses added for depth. No "Let's dive in", "Here's what you need to know", "In conclusion", or upbeat closing lines.
  - Headings in sentence case. No emojis. Straight quotes. No lists whose items start with a bold header and a colon.
  - Say what a thing does, for the person doing it. Short sentences mixed with longer ones. Plain, not promotional.
  - The Thai is written as Thai for a Thai reader, not translated word for word. Code, commands, paths, environment variable names and values are identical in both languages.
  - The admin's words are quoted exactly as the admin shows them. English labels come from `en` and Thai labels from `th` in `src/lib/admin-i18n.ts`; the public site's words come from `src/lib/i18n.ts`.
  - Say plainly where things stand before 1.0.0. For example, today's install is a pre-1.0 preview that each 0.x release replaces with a clean install.
- Every page's frontmatter has `title`, `description` (one sentence), and `sidebar.order`. The English and Thai files of a page carry the same `sidebar.order`.

**Standing rules for this repository:**

- Never `git stash`, `git reset --hard`, `git checkout --`, `git clean`. Stage by explicit path only.
- Commit messages are written to a file under the session scratchpad and committed with `git commit -F <file>` in a Bash call of its own. Conventional prefixes. **No attribution lines of any kind.**
- `--no-verify` is blocked by a hook, and so is any single Bash command containing both the words "git commit" and a `-n` flag. Write files with the Write tool.
- Never touch `tome-cms-postgres-1`, `tome-cms-seaweedfs-1` or port 4321. The screenshot script and the e2e specs share ports 55432/59000, so never run them at the same time.
- Gates run one at a time, in the foreground, with a 600000 ms timeout.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `website/package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`, `src/content.config.ts` | 1 | The site |
| `website/src/styles/tome.css`, `website/src/assets/brand/*` | 1 | The app's look |
| `website/scripts/check-docs.mjs` | 1 | Twin pages and writing marks, checked on every build |
| `website/scripts/check-search.mjs` | 1 | Thai and English search, checked against the built site |
| `website/src/content/docs/index.mdx`, `th/index.mdx` | 1, 8 | Home pages |
| `.github/workflows/docs.yml` | 1, 8 | Build and check, then deploy |
| `.gitignore`, root `package.json` | 1, 2, 5 | Ignores and the two root scripts |
| `website/scripts/openapi.ts` | 2 | Writes `src/generated/openapi.json` |
| `website/src/content/docs/{api}/…` (both languages) | 2 | Headless API pages |
| `website/src/content/docs/{start,running}/…` | 3, 4 | Start here, Running a site |
| `website/scripts/screenshots.ts`, `website/src/assets/screenshots/{en,th}/*.png` | 5 | Screenshots |
| `website/src/content/docs/{admin,plugins}/…` | 6 | Using the admin, Plugins |
| `website/src/content/docs/{extending,contributing}/…` | 7 | Extending, Contributing |
| `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | 8 | Going live |

The spec lists the five plugins under "Using the admin". The sidebar gives them a group of their own, right after it, because Starlight names an autogenerated subgroup after its directory, and a directory name cannot be translated.

---

### Task 1: The shell

**Files:**
- Create: `website/package.json`, `website/astro.config.mjs`, `website/tsconfig.json`, `website/src/content.config.ts`, `website/src/styles/tome.css`, `website/src/assets/brand/tomecms-logo-color.png`, `website/src/assets/brand/tomecms-logo-reverse.png` (copies of `public/brand/`), `website/scripts/check-docs.mjs`, `website/scripts/check-search.mjs`, `website/src/content/docs/index.mdx`, `website/src/content/docs/th/index.mdx`, `.github/workflows/docs.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: the `sidebar` array in `astro.config.mjs`, which each later task adds its group to; `npm run check --prefix website` (astro check plus `check-docs.mjs`); `npm run build --prefix website`; the root script `docs:check-search`.

- [ ] **Step 1: Write the page checker and its self-test**

Create `website/scripts/check-docs.mjs`:

```js
#!/usr/bin/env node
/**
 * The site's own rules, checked on every build.
 *
 * Every page has a twin in the other language, so a reader who switches never lands on a
 * missing page. No page carries the marks the /humanizer skill names: em and en dashes, and
 * the words that give machine-written prose away.
 *
 * Usage: node scripts/check-docs.mjs [--self-test]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = fileURLToPath(new URL('../src/content/docs/', import.meta.url));
const PAGE = /\.(md|mdx)$/;
const DASH = /[\u2013\u2014]/;
// The skill's high-frequency list, less the words with an ordinary technical meaning in these
// pages ("key" as in API key, "landscape" as in a picture's orientation).
const WORDS = /\b(additionally|crucial|delve[sd]?|delving|fostering|garner(?:s|ed)?|interplay|intricate|intricacies|pivotal|showcas(?:e|es|ed|ing)|tapestry|testament|underscor(?:e|es|ed|ing)|vibrant|seamless(?:ly)?)\b/i;

/** Every page under a directory, as paths relative to it with forward slashes. */
export function pagesIn(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pagesIn(path, base);
    return PAGE.test(entry.name) ? [relative(base, path).split('\\').join('/')] : [];
  });
}

/** Pages whose twin in the other language is missing. */
export function missingTwins(pages) {
  const thai = new Set(pages.filter((page) => page.startsWith('th/')).map((page) => page.slice(3)));
  const english = new Set(pages.filter((page) => !page.startsWith('th/')));
  return [
    ...[...english].filter((page) => !thai.has(page)).map((page) => `th/${page} is missing (twin of ${page})`),
    ...[...thai].filter((page) => !english.has(page)).map((page) => `${page} is missing (twin of th/${page})`),
  ];
}

/** Lines outside code that carry a dash or a listed word. */
export function marks(text) {
  const found = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const prose = line.replace(/`[^`]*`/g, '');
    if (DASH.test(prose)) found.push(`line ${index + 1}: an em or en dash`);
    const word = prose.match(WORDS);
    if (word) found.push(`line ${index + 1}: "${word[0]}"`);
  });
  return found;
}

function selfTest() {
  const pages = ['index.mdx', 'start/install.md', 'th/index.mdx', 'th/running/backups.md'];
  const twins = missingTwins(pages);
  if (twins.length !== 2 || !twins.includes('th/start/install.md is missing (twin of start/install.md)')
    || !twins.includes('running/backups.md is missing (twin of th/running/backups.md)')) {
    throw new Error(`missingTwins is wrong: ${JSON.stringify(twins)}`);
  }
  const text = ['A plain line.', 'A line \u2014 with a dash.', '```', 'code \u2014 is fine', '```', 'This is crucial.', 'Use `seamless` in code.'].join('\n');
  const found = marks(text);
  if (found.length !== 2 || !found[0].startsWith('line 2') || !found[1].includes('crucial')) {
    throw new Error(`marks is wrong: ${JSON.stringify(found)}`);
  }
  console.log('check-docs self-test passed.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const pages = pagesIn(DOCS);
  const problems = [
    ...missingTwins(pages),
    ...pages.flatMap((page) => marks(readFileSync(join(DOCS, page), 'utf8')).map((mark) => `${page} ${mark}`)),
  ];
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`${pages.length} pages: every page has its twin, and none carries a listed mark.`);
}
```

- [ ] **Step 2: Run the self-test**

Run: `node website/scripts/check-docs.mjs --self-test`
Expected: `check-docs self-test passed.` Then put a bug back to see the test catch it. Make `missingTwins` return `[]`, run it again and see it throw. Undo the change.

- [ ] **Step 3: Create the site**

Create `website/package.json`:

```json
{
  "name": "tome-cms-docs",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check && node scripts/check-docs.mjs --self-test && node scripts/check-docs.mjs"
  }
}
```

Then install, from `website/`: `npm install astro@^7.3.3 @astrojs/starlight@^0.42.4 @fontsource/ibm-plex-sans-thai@^5.3.0 sharp@^0.35.4` and `npm install --save-dev @astrojs/check@^0.9.10 typescript@^5.9.3`. `starlight-openapi` and `starlight-links-validator` come in Task 2 and Step 3 below respectively. Install the validator now: `npm install starlight-links-validator@^0.26.0`.

Create `website/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

Create `website/src/content.config.ts`:

```ts
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

Create `website/astro.config.mjs`:

```js
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';

export default defineConfig({
  site: 'https://dhanabhon.github.io',
  base: '/tome-cms',
  integrations: [
    starlight({
      title: 'TomeCMS',
      description: 'A CMS for sites in Thai and English, built with Astro.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        th: { label: 'ไทย', lang: 'th' },
      },
      logo: {
        alt: 'TomeCMS',
        dark: './src/assets/brand/tomecms-logo-reverse.png',
        light: './src/assets/brand/tomecms-logo-color.png',
        replacesTitle: true,
      },
      social: [{ href: 'https://github.com/Dhanabhon/tome-cms', icon: 'github', label: 'GitHub' }],
      editLink: { baseUrl: 'https://github.com/Dhanabhon/tome-cms/edit/main/website/' },
      customCss: [
        '@fontsource/ibm-plex-sans-thai/400.css',
        '@fontsource/ibm-plex-sans-thai/600.css',
        './src/styles/tome.css',
      ],
      plugins: [starlightLinksValidator()],
      // Each section's task adds its group here, so the site builds at every step.
      sidebar: [],
    }),
  ],
});
```

Create `website/src/styles/tome.css`:

```css
/* The app's own tokens, so the documentation looks like the product it documents. The token
 * file flips its values under the same data-theme attribute Starlight sets on <html>, so one
 * rule serves both themes. It is imported rather than copied, so the two cannot drift. */
@import '../../../src/styles/installer-tokens.css';

:root,
:root[data-theme='light'] {
  --sl-font: var(--font-body);
  --sl-color-accent: var(--color-accent);
  --sl-color-accent-high: var(--color-link);
  --sl-color-accent-low: color-mix(in oklch, var(--color-accent) 22%, var(--color-paper));
}
```

Copy `public/brand/tomecms-logo-color.png` and `public/brand/tomecms-logo-reverse.png` to `website/src/assets/brand/`.

Create `website/src/content/docs/index.mdx` and `website/src/content/docs/th/index.mdx` as Starlight splash pages (`template: splash`, a `hero` with a title, a tagline and one action that links to the GitHub repository). Write one short paragraph under the hero, following the writing rules, that says what TomeCMS is. The Thai page must contain the word `เอกสาร`, and the English page the word `documentation`; `check-search.mjs` searches for them. Give both pages `sidebar.order: 0`. Task 8 adds the cards linking into each section.

Add to `.gitignore`:

```text
# The documentation site's installs, builds and generated API document.
/website/node_modules/
/website/dist/
/website/.astro/
/website/src/generated/
```

- [ ] **Step 4: Check that Thai search works**

Create `website/scripts/check-search.mjs`:

```js
#!/usr/bin/env node
/**
 * Proves the built site's search finds a Thai word and an English one.
 *
 * Thai has no spaces between words, so it is the language a search index is most likely to get
 * wrong, and nothing else in the build would notice. Run it after `npm run build --prefix
 * website`: `npm run docs:check-search`.
 */
import { spawn } from 'node:child_process';

import { chromium } from 'playwright';

const PORT = 4331;
const ORIGIN = `http://localhost:${PORT}`;
const CASES = [
  { path: '/tome-cms/th/', word: 'เอกสาร' },
  { path: '/tome-cms/', word: 'documentation' },
];

const preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url),
  stdio: 'ignore',
});
try {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/tome-cms/`)).ok) break;
    } catch {
      // The preview server is still starting.
    }
    if (attempt > 60) throw new Error('The preview server never answered.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const browser = await chromium.launch();
  try {
    for (const { path, word } of CASES) {
      const page = await browser.newPage();
      await page.goto(`${ORIGIN}${path}`);
      await page.locator('site-search button[data-open-modal]').click();
      await page.locator('#starlight__search input').fill(word);
      const results = page.locator('.pagefind-ui__result');
      await results.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      const count = await results.count();
      if (!count) throw new Error(`Searching ${path} for "${word}" found nothing.`);
      console.log(`${path}: "${word}" found on ${count} page(s).`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  preview.kill('SIGTERM');
}
```

Add to the root `package.json` `scripts`: `"docs:check-search": "node website/scripts/check-search.mjs"`.

Run: `npm run check --prefix website`, then `npm run build --prefix website`, then `npm run docs:check-search`.
Expected: all three pass, and the last prints both words found. **If the Thai word is not found**, do not weaken the check. Report `DONE_WITH_CONCERNS` with what Pagefind indexed, so the owner can decide. You can find that in `website/dist/pagefind/`: look at the `pagefind-entry.json` languages and at whether the Thai page's text was split.

- [ ] **Step 5: The workflow that builds and checks**

Create `.github/workflows/docs.yml`:

```yaml
name: Docs

# Builds and checks the documentation site. Task 8 adds the deploy job; until then a push only
# proves the site still builds.
on:
  push:
    branches:
      - main
    paths:
      - 'website/**'
      - 'src/server/http/**'
      - 'src/styles/installer-tokens.css'
      - '.github/workflows/docs.yml'
  pull_request:
    paths:
      - 'website/**'
      - 'src/server/http/**'
      - 'src/styles/installer-tokens.css'
      - '.github/workflows/docs.yml'
  workflow_dispatch:

concurrency:
  group: docs-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5

      - name: Set up Node
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0 (node24)
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: |
            package-lock.json
            website/package-lock.json

      - name: Install the app's dependencies
        run: npm ci

      - name: Install the site's dependencies
        run: npm ci --prefix website

      - name: Check
        run: npm run check --prefix website

      - name: Build
        run: npm run build --prefix website
```

Check the YAML parses: `python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/docs.yml"))'`.

- [ ] **Step 6: Look at it, then commit**

Run `npm run preview --prefix website -- --port 4331` in the background (never the default port, 4321, which is the owner's dev server), and open `http://localhost:4331/tome-cms/`. Screenshot the English and Thai home pages in the light and dark themes at 1280 and 375 wide with the root's Playwright, then read them with the Read tool. Check the logo, the green accent, the Thai font and the language switch. Stop the preview.

Stage: `website/package.json website/package-lock.json website/astro.config.mjs website/tsconfig.json website/src/content.config.ts website/src/styles/tome.css website/src/assets/brand/tomecms-logo-color.png website/src/assets/brand/tomecms-logo-reverse.png website/scripts/check-docs.mjs website/scripts/check-search.mjs website/src/content/docs/index.mdx website/src/content/docs/th/index.mdx .github/workflows/docs.yml .gitignore package.json`

Message:

```text
feat(docs): a Starlight site for the documentation, in English and Thai

website/ is its own Astro project with its own lockfile. English is at the root and Thai at
/th/, it wears the app's tokens, font and logo, and its build fails on a broken link, a page
without its twin in the other language, or a dash or word the humanizer rules forbid. A
script proves the built site's search finds a Thai word. docs.yml builds and checks it.
```

---

### Task 2: The Headless API section

**Files:**
- Create: `website/scripts/openapi.ts`, `website/src/content/docs/api/overview.md`, `website/src/content/docs/api/counting-readers.md`, and their `th/` twins
- Modify: `website/astro.config.mjs`, `website/package.json` (the plugin), root `package.json` (the script), `.github/workflows/docs.yml` (the generate step)

**Interfaces:**
- Consumes: Task 1's config and checks.
- Produces: the root script `docs:openapi`; the reference under `/api/reference/`; pages `api/overview` and `api/counting-readers`.

- [ ] **Step 1: Generate the OpenAPI document**

Create `website/scripts/openapi.ts`:

```ts
/**
 * Writes the app's OpenAPI document where the documentation's reference pages are built from.
 * The reference is generated rather than written, so it cannot say anything the API does not do.
 * Run from the repository root, where the app's dependencies are: `npm run docs:openapi`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { openApiDocument } from '../../src/server/http/openapi';

const target = new URL('../src/generated/openapi.json', import.meta.url);
mkdirSync(new URL('.', target), { recursive: true });
writeFileSync(target, `${JSON.stringify(openApiDocument, null, 2)}\n`);
console.log(`Wrote ${Object.keys(openApiDocument.paths).length} paths to website/src/generated/openapi.json.`);
```

Add to the root `package.json` `scripts`: `"docs:openapi": "node --import tsx website/scripts/openapi.ts"`.

Run: `npm run docs:openapi`
Expected: `Wrote 10 paths to website/src/generated/openapi.json.`

- [ ] **Step 2: The reference**

From `website/`: `npm install starlight-openapi@^0.26.2`.

In `website/astro.config.mjs`, import the plugin and create the group:

```js
import starlightOpenAPI, { createOpenAPISidebarGroup } from 'starlight-openapi';

const apiReference = createOpenAPISidebarGroup();
```

Change `plugins` to:

```js
      plugins: [
        starlightOpenAPI([
          { base: 'api/reference', schema: './src/generated/openapi.json', sidebar: { group: apiReference, label: 'Reference' } },
        ]),
        starlightLinksValidator(),
      ],
```

Then add this group to `sidebar`, after any groups before it:

```js
        {
          label: 'Headless API',
          translations: { th: 'Headless API' },
          items: ['api/overview', 'api/counting-readers', apiReference],
        },
```

In `.github/workflows/docs.yml`, add this step after "Install the site's dependencies":

```yaml
      - name: Generate the API reference's source
        run: npm run docs:openapi
```

- [ ] **Step 3: Write the two pages, in both languages**

Follow the writing rules in Global Constraints. Check every fact against the named source, not against memory.

| Page (`order`) | English title / Thai title | Must cover | Check against |
|---|---|---|---|
| `api/overview.md` (1) | Using the headless API / ใช้งาน Headless API | That the API is anonymous, read-only and serves published content. Every route, with what it returns. The `locale` parameter. Cursor pagination with a worked `curl` example and the `next` link. Caching: `ETag`, `Last-Modified`, `304`. Wildcard CORS. Draft previews, which are token-scoped and private. The maintenance `503` and its `maintenance` object. That `/api/v1/content/openapi.json` is the contract. A link to the generated reference. | README "Headless content API"; `src/pages/api/v1/content/*`; `src/server/http/public-response.ts`; `src/server/http/openapi.ts`; `src/middleware.ts` (`maintenanceRoute`) |
| `api/counting-readers.md` (2) | Counting readers from a headless site / นับผู้อ่านจากเว็บแบบ headless | `POST /api/v1/stats/hit`. The body's fields and the rules each must meet. The `204` answer either way. `Content-Type: application/json` with `keepalive`. When to send `view` and when `read`. Leaving out Do Not Track and GPC readers and the owner. The per-address limit. Bundled mode accepting only the site itself. The README's snippet, rewritten as a page. | README "Headless content API" (the counting part); `src/server/stats/rules.ts` (`hitSchema`); `src/server/stats/hits.ts`; `src/components/StatsBeacon.astro` |

The Thai `api/overview.md` says in one sentence that the reference's schema text is in English, and links to it.

- [ ] **Step 4: Check, build, look, commit**

Run `npm run docs:openapi`, then `npm run check --prefix website`, then `npm run build --prefix website`. Open the built reference pages (preview on port 4331) and check that one operation page renders, including the stats `POST`.

Stage: `website/scripts/openapi.ts website/astro.config.mjs website/package.json website/package-lock.json website/src/content/docs/api/overview.md website/src/content/docs/api/counting-readers.md website/src/content/docs/th/api/overview.md website/src/content/docs/th/api/counting-readers.md package.json .github/workflows/docs.yml`

Message:

```text
feat(docs): the headless API, with a reference generated from the app's own contract

The OpenAPI document is written out from src/server/http/openapi.ts at build and
starlight-openapi turns it into reference pages, so the reference cannot drift from the
code. Two pages in each language: using the API, and counting readers from a headless site.
```

---

### Task 3: Start here

**Files:**
- Create: `website/src/content/docs/start/{what-is-tomecms,requirements,install,first-run}.md` and their `th/` twins, `website/src/assets/architecture-light.png` and `architecture-dark.png` (copies of `docs/tome-cms-overview.en.light.png` and `.dark.png`)
- Modify: `website/astro.config.mjs` (the sidebar group, first in the list)

**Interfaces:**
- Consumes: Task 1's config.
- Produces: pages `start/*`.

- [ ] **Step 1: Add the group**

Add this group first in `sidebar`:

```js
        { label: 'Start here', translations: { th: 'เริ่มต้นที่นี่' }, autogenerate: { directory: 'start' } },
```

- [ ] **Step 2: Write the pages, in both languages**

| Page (`order`) | English title / Thai title | Must cover | Check against |
|---|---|---|---|
| `start/what-is-tomecms.md` (1) | What TomeCMS is / TomeCMS คืออะไร | What it is and who it is for: one owner, a Thai and English site. What it does, following the README's key features without copying their wording. The architecture picture, light and dark, using Starlight's `<picture>` with `prefers-color-scheme` in an `.mdx` page or two images with `.light:only` / `.dark:only` classes; choose one and note it. One Node process, PostgreSQL, S3-compatible storage. The status before 1.0.0, in plain words. | README intro, "Key features", "Architecture", the status line; `docs/releases/1.0.0.md` |
| `start/requirements.md` (2) | What the server needs / สิ่งที่เซิร์ฟเวอร์ต้องมี | The server size and why, with the measured figures. The two HTTPS origins. The reverse proxy. The ports bound to `127.0.0.1`. | README "What the server needs" |
| `start/install.md` (3) | Installing on a VPS / ติดตั้งบน VPS | Today's pre-1.0 install, step by step, with its commands. What changes at 1.0.0 with the managed install, marked as not released yet. | README "Installing today", "Managed installation from 1.0.0"; `scripts/deploy-vps.sh`; `docs/releases/1.0.0.md` |
| `start/first-run.md` (4) | The first-run wizard / ตัวช่วยตั้งค่าครั้งแรก | Each step of the wizard and what it asks. The install token. The admin path, and why to bookmark it. The first passkey. | README "The first-run wizard"; `src/pages/install.astro` and its components |

If a README statement no longer matches the code, write what the code does, and list the mismatch in the report.

- [ ] **Step 3: Check, build, look, commit**

Run the check and the build. Look at `start/what-is-tomecms` in both themes, to see that the picture swaps.

Stage the eight pages, the two pictures and `website/astro.config.mjs`.

Message:

```text
docs(site): Start here, in English and Thai

What TomeCMS is, what the server needs, installing on a VPS, and the first-run wizard, taken
from the README, rewritten as pages of their own, and checked against the code.
```

---

### Task 4: Running a site

**Files:**
- Create: `website/src/content/docs/running/{configuration,modes,updating,backups,recovery,maintenance}.md` and their `th/` twins
- Modify: `website/astro.config.mjs` (the sidebar group, after Start here)

**Interfaces:**
- Consumes: Task 1's config.
- Produces: pages `running/*`.

- [ ] **Step 1: Add the group**

```js
        { label: 'Running a site', translations: { th: 'ดูแลเว็บไซต์' }, autogenerate: { directory: 'running' } },
```

- [ ] **Step 2: Write the pages, in both languages**

| Page (`order`) | English title / Thai title | Must cover | Check against |
|---|---|---|---|
| `running/configuration.md` (1) | Configuration / การตั้งค่า | A table of every environment variable: name, required or optional, default, and what it does. Include the optional ones that the app reads from `process.env` outside the schema (`TOME_CMS_COUNTRY_HEADER`, `TOME_CMS_GEOIP_PATH`, `DATABASE_POOL_MAX`, …). Production's HTTPS rule. The CORS rule for external object storage. What never to commit. | `src/server/env.ts` (the schema, every field); `git grep -n "process.env.TOME_CMS\|process.env.DATABASE" -- src`; `.env.example`; README "Configuration" |
| `running/modes.md` (2) | Bundled and headless / โหมด bundled และ headless | What each mode serves and refuses, `robots.txt`, and how to switch. | README "Bundled and headless modes"; `src/middleware.ts` (`isBundledFrontendPath`) |
| `running/updating.md` (3) | Updating / การอัปเดต | Migrations and `npm run db:migrate`. How many migrations are waiting from each earlier version. The admin's notice about them. The managed updater at 1.0.0, marked as not released yet. | README "Upgrading", "Managed installation from 1.0.0"; `src/server/db/migrator.ts` |
| `running/backups.md` (4) | Backups and restore / สำรองและกู้คืนข้อมูล | What is backed up and how, the restore check, and where the files go. | README "Backups"; `scripts/backup.ts`; `scripts/restore-check.ts` |
| `running/recovery.md` (5) | Getting back in / กลับเข้าหน้าผู้ดูแล | Recovery codes, `npm run admin:recover`, starting over with `admin:reset-installation`, and recovering a managed installation. | README "Getting back in, and starting over", "Recovering a managed installation"; `scripts/recover-owner.mjs`; `scripts/reset-installation.mjs` |
| `running/maintenance.md` (6) | Maintenance mode / ปิดปรับปรุง | What visitors see, the four templates, what stays open, the owner's bar, the API's `503`, the return time and `Retry-After`, and that the site never reopens by itself. | `docs/releases/0.11.0.md` "Maintenance"; `src/middleware.ts`; `src/lib/site-maintenance.ts`; `src/lib/admin-i18n.ts` (`maintenance` copy) |

- [ ] **Step 3: Check, build, commit**

Stage the twelve pages and `website/astro.config.mjs`.

Message:

```text
docs(site): Running a site, in English and Thai

Configuration with every environment variable, bundled and headless modes, updating,
backups and restore, getting back in, and maintenance mode.
```

---

### Task 5: The screenshot script

**Files:**
- Create: `website/scripts/screenshots.ts`, `website/src/assets/screenshots/en/*.png`, `website/src/assets/screenshots/th/*.png`
- Modify: root `package.json` (the script)

**Interfaces:**
- Produces: `npm run docs:screenshots`, and one PNG per admin screen per language, named as in `SCREENS` below. Task 6's pages use them as `../../../assets/screenshots/en/<name>.png` (English pages in `admin/`) and `../../../../assets/screenshots/th/<name>.png` (Thai pages in `th/admin/`).

- [ ] **Step 1: Write the script**

Create `website/scripts/screenshots.ts`. It follows `tests/e2e/stats.spec.ts`: its own Compose project, a fresh schema, an owner seeded directly, and a virtual passkey. Read that spec first. It also uses the media seeding of `tests/e2e/site-brand.spec.ts` and the post seeding of `tests/integration/stats-dashboard.test.ts`.

```ts
/**
 * Photographs the admin for the documentation, in English and in Thai.
 *
 * It builds a small, believable site on a disposable stack: posts and pages in both languages,
 * pictures, a menu, a slide and some counts. It signs in with a virtual passkey and saves one
 * picture per screen. Run it from the repository root when a screen changes:
 * `npm run docs:screenshots`. It uses ports 55432 and 59000, like the e2e specs, so never run
 * the two at once.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

import sharp from 'sharp';

import { chromium, type BrowserContext, type Page } from 'playwright';

const COMPOSE = ['compose', '-p', 'tomecms-docs-shots', '-f', 'compose.test.yaml'];
const CREDENTIAL = 'docs-screenshots-secret-at-least-32ch';
const OWNER = '2b7e1f3a-9c4d-4e5f-8a6b-7c8d9e0f1a2b';
const OUT = new URL('../src/assets/screenshots/', import.meta.url);

/** The screens, by file name and path under the admin. `edit` is filled in once a post exists. */
const SCREENS: Array<{ name: string; path: string }> = [
  { name: 'posts', path: '/admin' },
  { name: 'editor', path: '/admin/edit/:post' },
  { name: 'pages', path: '/admin/pages' },
  { name: 'navigation', path: '/admin/navigation' },
  { name: 'slides', path: '/admin/slides' },
  { name: 'media', path: '/admin/media' },
  { name: 'redirects', path: '/admin/redirects' },
  { name: 'stats', path: '/admin/stats' },
  { name: 'settings', path: '/admin/settings' },
  { name: 'maintenance', path: '/admin/maintenance' },
  { name: 'profile', path: '/admin/profile' },
  { name: 'security', path: '/admin/security' },
  { name: 'themes', path: '/admin/themes' },
  { name: 'plugins', path: '/admin/plugins' },
  { name: 'system', path: '/admin/system' },
];

function docker(args: string[], timeout = 180_000) {
  const result = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', timeout });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No port available.'));
      server.close(() => resolve(address.port));
    });
  });
}

const port = await freePort();
const origin = `http://localhost:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  ASTRO_DEV_BACKGROUND: '1',
  DATABASE_URL: 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
  TOME_CMS_PUBLIC_URL: origin,
  TOME_CMS_TEST_ORIGIN: origin,
  TOME_CMS_INSTALL_TOKEN: CREDENTIAL,
  BETTER_AUTH_SECRET: CREDENTIAL,
  TOME_CMS_CONTEXT_SECRET: CREDENTIAL,
  TOME_CMS_RECOVERY_PEPPER: CREDENTIAL,
  S3_ENDPOINT: 'http://127.0.0.1:59000',
  S3_ACCESS_KEY_ID: 'tomecms_test',
  S3_SECRET_ACCESS_KEY: 'foundation-test-only',
  S3_BUCKET: 'tomecms-test-media',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
  MEDIA_PUBLIC_URL: 'http://127.0.0.1:59000/tomecms-test-media/',
  TOME_CMS_FRONTEND_MODE: 'bundled',
  TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-docs-shots',
};
Object.assign(process.env, env);

let server: ChildProcess | undefined;
try {
  docker(['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'seaweedfs']);
  docker(['exec', '-T', 'postgres', 'psql', '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1',
    '-U', 'tomecms_test', '-d', 'tomecms_test', '-c', 'drop schema public cascade; create schema public;'], 60_000);

  const { migrateToLatest } = await import('../../src/server/db/migrator');
  await migrateToLatest();
  const postId = await seed();

  server = spawn(process.execPath, ['./node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock',
    '--host', 'localhost', '--port', String(port)], { cwd: process.cwd(), env, stdio: 'ignore' });
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await fetch(`${origin}/health/ready`)).ok) break;
    } catch {
      // Astro is still starting.
    }
    if (attempt > 120) throw new Error('The dev server never became ready.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ colorScheme: 'light', viewport: { height: 800, width: 1280 } });
    const page = await context.newPage();
    await signIn(context, page);
    const { sql } = await import('kysely');
    const { db } = await import('../../src/server/db/client');
    for (const locale of ['en', 'th'] as const) {
      // The admin speaks the site's default language.
      await sql`update site_settings set default_locale = ${locale}`.execute(db);
      mkdirSync(new URL(`${locale}/`, OUT), { recursive: true });
      for (const { name, path } of SCREENS) {
        await page.goto(`${origin}${path.replace(':post', postId)}`);
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: new URL(`${locale}/${name}.png`, OUT).pathname });
        console.log(`${locale}/${name}.png`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server?.kill('SIGTERM');
  try {
    const { closeDatabase } = await import('../../src/server/db/client');
    await closeDatabase();
  } catch {
    // The pool may never have opened.
  }
  docker(['down', '--volumes', '--remove-orphans'], 90_000);
}

async function signIn(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const enrollment = await issueRecoveryEnrollment(OWNER);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
}

/** A small site worth looking at. Returns an English post's id, for the editor's picture. */
async function seed(): Promise<string> {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { createObjectKey } = await import('../../src/server/media/keys');

  await sql`insert into "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
    values (${OWNER}, 'Somchai Writer', 'owner@tomecms.invalid', true, 'owner', now(), now())`.execute(db);
  await sql`insert into site_settings (id, owner_id, site_name, default_locale, timezone, admin_path)
    values (true, ${OWNER}, 'Quiet Notes', 'en', 'Asia/Bangkok', '/admin')`.execute(db);
  const category = await db.insertInto('categories').values({ owner_id: OWNER, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();

  // Pictures drawn here, so the documentation ships nothing it has no rights to.
  const picture = async (hue: number, name: string) => {
    const width = 1600;
    const height = 900;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 62%)"/><stop offset="1" stop-color="hsl(${hue + 40} 35% 30%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    const body = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
    const key = createObjectKey(OWNER, 'image/jpeg');
    await s3.send(new PutObjectCommand({ Body: body, Bucket: s3Bucket, ContentType: 'image/jpeg', Key: key }));
    return (await db.insertInto('media_items').values({
      alt_text: name, checksum_sha256: `${'A'.repeat(43)}=`, delete_error_code: null, folder_id: null, height,
      mime_type: 'image/jpeg', object_key: key, original_name: `${name}.jpg`, owner_id: OWNER, size_bytes: body.length,
      state: 'ready', width,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  };
  const pictures = [await picture(150, 'Morning light'), await picture(30, 'Paper and ink'), await picture(210, 'A quiet street')];

  const html = (text: string) => `<p>${text}</p>`;
  const post = (locale: 'en' | 'th', title: string, text: string, cover: string, status: 'draft' | 'published', publishedAt: Date | null) =>
    db.transaction().execute(async (trx) => {
      const group = await trx.insertInto('post_translation_groups').values({ owner_id: OWNER }).returning('id').executeTakeFirstOrThrow();
      const { id } = await trx.insertInto('posts').values({
        content_html: html(text), content_json: { content: [{ content: [{ text, type: 'text' }], type: 'paragraph' }], type: 'doc' },
        cover_media_id: cover, locale, meta_description: null, meta_title: null, owner_id: OWNER, published_at: publishedAt,
        slug: `${locale}-${randomUUID().slice(0, 8)}`, status, title, translation_group_id: group.id,
      }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('post_category_assignments').values({ category_id: category.id, owner_id: OWNER, translation_group_id: group.id }).execute();
      return id;
    });
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
  const first = await post('en', 'Notes from a quiet workshop', 'What a small studio learned about writing in two languages.', pictures[0], 'published', day(-6));
  await post('en', 'Keeping a site small', 'Fewer pages, read more often.', pictures[1], 'published', day(-3));
  await post('en', 'Draft: the next chapter', 'Still being written.', pictures[2], 'draft', null);
  await post('th', 'บันทึกจากโต๊ะทำงาน', 'สิ่งที่ได้เรียนรู้จากการเขียนสองภาษา', pictures[0], 'published', day(-5));
  await post('th', 'เว็บเล็ก ๆ ที่มีคนอ่าน', 'หน้าน้อยลง แต่ถูกอ่านบ่อยขึ้น', pictures[1], 'published', day(-2));
  await post('th', 'ตอนต่อไป (ร่าง)', 'ยังเขียนไม่เสร็จ', pictures[2], 'published', day(3));

  for (const [locale, title] of [['en', 'About'], ['th', 'เกี่ยวกับเรา']] as const) {
    const group = await db.insertInto('page_translation_groups').values({ owner_id: OWNER }).returning('id').executeTakeFirstOrThrow();
    const page = await db.insertInto('pages').values({
      content_html: html(title), content_json: { content: [], type: 'doc' }, locale, meta_description: null, meta_title: null,
      owner_id: OWNER, published_at: day(-10), slug: locale === 'en' ? 'about' : 'เกี่ยวกับเรา', status: 'published', title,
      translation_group_id: group.id,
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('navigation_items').values([
      { kind: 'home', label: locale === 'en' ? 'Home' : 'หน้าแรก', locale, location: 'header', owner_id: OWNER, page_id: null, position: 0, url: null },
      { kind: 'page', label: title, locale, location: 'header', owner_id: OWNER, page_id: page.id, position: 1, url: null },
    ]).execute();
    await db.insertInto('home_slides').values({
      body: locale === 'en' ? 'Short essays on making things.' : 'บทความสั้นว่าด้วยการลงมือทำ', button_label: null, heading: locale === 'en' ? 'Quiet Notes' : 'บันทึกเงียบ ๆ',
      link_kind: null, locale, media_id: pictures[0], owner_id: OWNER, page_id: null, position: 0, url: null,
    } as never).execute();
  }

  // Thirty days of counts, so the Stats screen has a shape.
  for (let back = 0; back < 30; back += 1) {
    const views = 12 + ((back * 7) % 19);
    await sql`insert into content_stats_daily (owner_id, day, kind, content_id, locale, referrer, device, country, views, reads)
      values (${OWNER}, current_date - ${back}::int, 'post', ${first}, 'en', ${back % 3 ? '' : 'news.example'},
        ${back % 2 ? 'mobile' : 'desktop'}, ${back % 4 ? 'TH' : 'US'}, ${views}, ${Math.floor(views / 3)})`.execute(db);
  }
  return first;
}
```

Add to the root `package.json` `scripts`: `"docs:screenshots": "node --import tsx website/scripts/screenshots.ts"`.

If a seeded column does not match the current schema, correct the seed against `src/server/db/types.ts` and say what you changed. If a screen needs a different path, correct `SCREENS` against `src/components/admin/AdminShell.astro`.

- [ ] **Step 2: Run it, and look at every picture**

Check `uptime` first, and make sure no e2e spec or integration test is running. Run `npm run docs:screenshots` in the foreground with a 600000 ms timeout.

Expected: 30 files, 15 under `en/` and 15 under `th/`. Read every one with the Read tool. Each should show:

- a real screen with content, not an error, a sign-in page or an empty state (except where empty is honest)
- in the right language
- with nothing half-loaded

Fix the seed or the waits until they all do. Keep each file under 400 KB; if one is larger, write it as PNG through `sharp` with `palette: true`.

- [ ] **Step 3: Commit**

Stage `website/scripts/screenshots.ts`, `package.json`, and every PNG under `website/src/assets/screenshots/`.

Message:

```text
feat(docs): the admin, photographed by a script in English and Thai

A small site seeded on a disposable stack, a virtual passkey, and one picture per admin
screen in each language. Run it again whenever a screen changes: npm run docs:screenshots.
```

---

### Task 6: Using the admin, and the plugins

**Files:**
- Create: `website/src/content/docs/admin/{writing,publishing,pages-and-menus,home-slides,file-library,stats,settings,themes}.md`, `website/src/content/docs/plugins/{turnstile,jev,sticky-banner,popup,lightbox}.md`, and all their `th/` twins
- Modify: `website/astro.config.mjs` (two sidebar groups, after Running a site)

**Interfaces:**
- Consumes: Task 5's pictures, by the paths in its Interfaces block.
- Produces: pages `admin/*` and `plugins/*`.

- [ ] **Step 1: Add the groups**

```js
        { label: 'Using the admin', translations: { th: 'ใช้งานหน้าผู้ดูแล' }, autogenerate: { directory: 'admin' } },
        { label: 'Plugins', translations: { th: 'ปลั๊กอิน' }, autogenerate: { directory: 'plugins' } },
```

- [ ] **Step 2: Write the pages, in both languages, with their pictures**

Each page opens with what the screen is for. It then walks through what the owner does there, in the order they would do it, using the admin's exact labels in each language. It shows the screenshot where it helps, and its alt text says what the picture shows.

| Page (`order`) | English title / Thai title | Picture | Check against |
|---|---|---|---|
| `admin/writing.md` (1) | Writing / การเขียนบทความ | `posts`, `editor` | The editor (`src/components/admin/editor/`), its `/` menu and bars, pictures and files in a post, the settings drawer (`PostSettingsDrawer.tsx`), and suggestions while writing (README) |
| `admin/publishing.md` (2) | Publishing / การเผยแพร่ | `redirects` | Publish and schedule (README "Publishing, addresses and redirects"), Thai addresses, redirects (`src/server/content/redirects.ts`) |
| `admin/pages-and-menus.md` (3) | Pages and menus / หน้าและเมนู | `pages`, `navigation` | `src/pages/admin/pages/`, `NavigationManager.tsx` |
| `admin/home-slides.md` (4) | Home slides / สไลด์หน้าแรก | `slides` | `SlidesManager.tsx`; `docs/releases/0.10.0.md` "Home slides" |
| `admin/file-library.md` (5) | The file library / คลังไฟล์ | `media` | `MediaLibrary.tsx`; accepted types in `src/lib/media.ts`; what the library refuses to delete |
| `admin/stats.md` (6) | Stats / สถิติ | `stats` | README "Stats"; `docs/releases/0.11.0.md` "Stats"; DB-IP attribution |
| `admin/settings.md` (7) | Settings, profile and passkeys / การตั้งค่า โปรไฟล์ และ passkey | `settings`, `profile`, `security`, `maintenance` (link to `running/maintenance`) | `src/pages/admin/settings.astro`, `profile.astro`, `security.astro`; the security copy in `admin-i18n.ts` |
| `admin/themes.md` (8) | Themes / ธีม | `themes` | README "Themes"; `src/themes/paper/theme.ts` and `src/themes/plain/theme.ts` settings |
| `plugins/turnstile.md` (1) | Cloudflare Turnstile / Cloudflare Turnstile | `plugins` | `src/plugins/turnstile/plugin.ts`; README "Plugins" |
| `plugins/jev.md` (2) | Jev (TypeSafe AI) / Jev (TypeSafe AI) | none | `src/plugins/typesafe/plugin.ts`; README "Suggestions while writing" |
| `plugins/sticky-banner.md` (3) | Sticky Banner / Sticky Banner | none | `src/plugins/notice/plugin.ts` |
| `plugins/popup.md` (4) | Popup / Popup | none | `src/plugins/popup/plugin.ts`; `docs/releases/0.11.0.md` "Popup" |
| `plugins/lightbox.md` (5) | Image lightbox / Image lightbox | none | `src/plugins/lightbox/plugin.ts` |

Every plugin page lists the plugin's settings from its manifest (the label in each language, and what the setting does) and says what the plugin adds to the site. For a plugin that talks to an outside service, it also says what is sent there.

- [ ] **Step 3: Check, build, look, commit**

Run the check and the build. Open two pages per language and check that the pictures render and are sharp.

Stage the twenty-six pages and `website/astro.config.mjs`.

Message:

```text
docs(site): using the admin, and each plugin, in English and Thai

Writing, publishing, pages and menus, home slides, the file library, stats, settings and
themes, with the admin's own words and its own pictures, and a page for each plugin with its
settings and what it adds to a site.
```

---

### Task 7: Extending and Contributing

**Files:**
- Create: `website/src/content/docs/extending/{themes,plugins}.md`, `website/src/content/docs/contributing/{setup,project-layout,tests,how-to-contribute,security,releases}.md`, and their `th/` twins
- Modify: `website/astro.config.mjs` (two sidebar groups, after the Headless API group)

**Interfaces:**
- Consumes: Task 1's config.
- Produces: pages `extending/*`, `contributing/*`.

- [ ] **Step 1: Add the groups**

```js
        { label: 'Extending', translations: { th: 'ต่อยอด' }, autogenerate: { directory: 'extending' } },
        { label: 'Contributing', translations: { th: 'ร่วมพัฒนา' }, autogenerate: { directory: 'contributing' } },
```

- [ ] **Step 2: Write the pages, in both languages**

| Page (`order`) | English title / Thai title | Must cover | Check against |
|---|---|---|---|
| `extending/themes.md` (1) | Writing a theme / เขียนธีม | The theme contract, a theme's settings, registering it, and the CSS snapshot and diff. | README "Writing a theme"; `src/themes/contract.ts`; `src/themes/registry.ts` |
| `extending/plugins.md` (2) | Writing a plugin / เขียนปลั๊กอิน | The contract: hooks, setting kinds, and "plugins describe, the core draws". The manifest. Registering a plugin. `npm run plugin:disable`. | README "Writing a plugin"; `src/plugins/contract.ts`; `src/plugins/manifests.ts`; `src/plugins/registry.ts` |
| `contributing/setup.md` (1) | Setting up for development / เตรียมเครื่องสำหรับพัฒนา | macOS and Windows setup, and running infrastructure and Astro in separate terminals. | README "Local setup on macOS", "on Windows", "Infrastructure and Astro in separate terminals"; `scripts/dev-local-macos.sh` |
| `contributing/project-layout.md` (2) | Project layout / โครงสร้างโปรเจกต์ | What lives where, and the stack. | README "Project layout", "Stack" |
| `contributing/tests.md` (3) | Tests / การทดสอบ | Every test command and what it needs. The disposable stacks. The operations harness. | README "Tests and checks"; `package.json` scripts |
| `contributing/how-to-contribute.md` (4) | How to contribute / วิธีร่วมพัฒนา | `CONTRIBUTING.md`, as a page, including the feature freeze before 1.0.0. | `CONTRIBUTING.md` |
| `contributing/security.md` (5) | Security policy / นโยบายความปลอดภัย | `SECURITY.md`, as a page, with the link to private reporting. | `SECURITY.md` |
| `contributing/releases.md` (6) | Releases and changes / รุ่นและการเปลี่ยนแปลง | Where the changelog and release notes are (links into the repository on GitHub), and what 0.x means. | `CHANGELOG.md`; `docs/releases/` |

- [ ] **Step 3: Check, build, commit**

Stage the sixteen pages and `website/astro.config.mjs`.

Message:

```text
docs(site): extending TomeCMS and contributing to it, in English and Thai

Writing a theme or a plugin, setting up for development, the project's layout, its tests,
how to contribute, the security policy, and where releases are recorded.
```

---

### Task 8: Going live

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.github/workflows/docs.yml`, `website/src/content/docs/index.mdx`, `website/src/content/docs/th/index.mdx`

**Interfaces:**
- Consumes: every section's pages.

- [ ] **Step 1: The home pages link into every section**

Under the hero of each home page, add a Starlight `CardGrid` with one `LinkCard` per section. Link to its first page: `start/what-is-tomecms`, `running/configuration`, `admin/writing`, `plugins/turnstile`, `api/overview`, `extending/themes`, `contributing/setup`. Each card has a one-line description in its page's language.

- [ ] **Step 2: Deploy from main**

In `.github/workflows/docs.yml`, add after the Build step in `build`:

```yaml
      - name: Set up Pages
        if: github.event_name != 'pull_request'
        uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0

      - name: Upload the site
        if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: website/dist
```

and a second job:

```yaml
  deploy:
    if: github.event_name != 'pull_request'
    needs: build
    runs-on: ubuntu-24.04
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1
```

Change the comment at the top of the file to say that a push to `main` builds, checks and deploys, and that a pull request only builds and checks.

- [ ] **Step 3: The README becomes an introduction**

Rewrite `README.md` to keep only:

- the logo and title block as they are
- one paragraph on what TomeCMS is
- the status line, updated to link to the site
- the architecture picture as it is, with its paragraph
- "Documentation", with one link per section of the site (the English pages at `https://dhanabhon.github.io/tome-cms/`, with the Thai site linked beside it)
- the links to `CONTRIBUTING.md` and `SECURITY.md`
- the license

Everything else now lives on the site. Follow the writing rules.

In `CONTRIBUTING.md`, point the links that went to README sections at the site instead:

- `#developing-tomecms` goes to `contributing/setup`
- `#writing-a-plugin` goes to `extending/plugins`
- `#tests-and-checks` goes to `contributing/tests`

Search the repository for other links into the README's removed sections (`git grep -n "README.md#"`). Point each live document at the site, and leave the release notes and old CHANGELOG entries as they are, since those are history.

Add to `CHANGELOG.md` under `## Unreleased` → `### Added`:

```markdown
- **Documentation** at [dhanabhon.github.io/tome-cms](https://dhanabhon.github.io/tome-cms/), in English and Thai: installing and running a site, every screen of the admin with its picture, each plugin, the headless API with a reference generated from the app's OpenAPI document, extending TomeCMS, and contributing. The README is now an introduction that links there.
```

- [ ] **Step 4: Check everything, then commit**

Run `npm run docs:openapi`, `npm run check --prefix website`, `npm run build --prefix website`, `npm run docs:check-search`, then the root's `npm run check`. Validate the workflow YAML.

Stage `README.md CONTRIBUTING.md CHANGELOG.md .github/workflows/docs.yml website/src/content/docs/index.mdx website/src/content/docs/th/index.mdx` and any other file whose README link you changed.

Message:

```text
docs(site): the site goes live, and the README becomes its introduction

docs.yml now deploys the site to GitHub Pages from main, the home pages link into every
section, and the README keeps what a visitor to the repository needs before following a
link there.
```

- [ ] **Step 5: Report what the owner must switch on**

The deploy fails until two repository settings change: Pages publishing from GitHub Actions, and the repository's Website field pointing at the site. Changing them is the controller's job, with the owner's permission. Say so in the report, and do not change them.
