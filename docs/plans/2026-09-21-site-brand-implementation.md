# Site Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logo in the public header (SVG included) with an optional logo for the dark scheme, the site's name hidden from the header while there is a logo, and the site's own icon on public pages.

**Architecture:** The three files are uploaded through the server, checked and -- for SVG -- sanitized, stored in the media bucket under the library's own key grammar, and recorded as jsonb on `site_settings`. A pure module (`src/lib/site-brand.ts`) turns what is stored into what a page, a theme and the public API are given; a core component draws the header's logo inside each theme's home link.

**Tech Stack:** Astro 7 SSR, React islands, Kysely/PostgreSQL 17, `@aws-sdk/client-s3` on SeaweedFS, `sharp` (already a dependency), `sanitize-html` (already a dependency), zod 4, node:test, Playwright.

**Spec:** `docs/specs/2026-09-21-site-brand-design.md`

## Global Constraints

- SVG is accepted for the logo, the dark logo and the icon only. The media library's five types, and the checks on `media_items` and `media_upload_reservations`, do not change.
- Limits: 1 MB for any brand file; a raster icon at least 180 × 180; icon renditions of 32 × 32 and 180 × 180 PNG.
- The admin and the installer keep `/favicon.svg`.
- Every object key passes `isTomeObjectKey` -- backup, restore-check and reset refuse any that does not.
- Owner-facing copy exists in English and Thai, with the same keys in the same order (`tests/unit/admin-i18n.test.ts`).
- Tests run only on disposable stacks: `node scripts/test-foundation.mjs <file>` (project `tomecms-foundation-test`) and the e2e specs' own compose projects. Never the owner's `tome-cms-*` containers or the dev server on :4321.
- Commits: stage by explicit path, never `git stash`, message in a scratch file and `git commit -F <file>` in its own Bash call, no attribution lines.
- Each new guard is checked by putting back the bug it guards against before its task is committed.

## Amendments to the spec, found while planning

1. **Keys.** `backup.ts`, `restore-check.ts` and `reset-installation.mjs` refuse any object whose key fails `isTomeObjectKey` (`owners/<owner>/<yyyy>/<mm>/<uuid>.<ext>`, raster extensions only). Brand files therefore use that grammar -- a fresh UUID per upload, which busts caches as well as a hash would -- and `svg` joins its extensions. `brand/<kind>-<hash>` is dropped.
2. **Reset.** `reset-installation.mjs` refuses a bucket holding objects no table accounts for. Its `knownObjects` counts the keys on `site_settings`.
3. **Versions.** The public site's `Last-Modified` is `site_settings.updated_at`, so a brand write moves it, and returns the new value for the Settings form, whose next save would otherwise be refused as stale.
4. **A light sample.** The admin previews a logo on the light page in either admin theme; `--color-sample-light` joins the theme-independent roles beside `--color-hero`.

## File structure

| File | Responsibility |
|---|---|
| `src/server/media/keys.ts` (modify) | Key grammar accepts `svg`; `createBrandObjectKey` |
| `src/server/media/svg.ts` (create) | `sanitizeSvg`, `insideOnlyCss` -- pure |
| `src/server/media/image.ts` (modify) | Export the byte sniffer as `detectImageType` |
| `src/server/media/brand-image.ts` (create) | `prepareBrandImage` -- type from bytes, limits, sanitizing, icon renditions |
| `src/lib/site-brand.ts` (create) | Stored shapes, `siteBrand`, `storedBrandKeys`, `iconLinks` -- pure, shared by server, themes and admin |
| `src/server/db/migrations/020_site_brand.ts` (create) | Four columns on `site_settings` |
| `src/server/content/settings.ts` (modify) | Parse brand columns, `hideSiteName`, `writeSiteBrand` |
| `src/server/content/brand.ts` (create) | `storeBrandImage`, `removeBrandImage` -- S3 and the setting, in order |
| `src/pages/api/admin/brand/[kind].ts` (create) | POST and DELETE |
| `scripts/reset-installation.mjs` (modify) | `knownObjects` counts brand keys, exported |
| `src/components/SiteBrand.astro` (create) | What goes inside a theme's home link |
| `src/themes/contract.ts`, both themes, `src/layouts/BaseLayout.astro`, `src/components/blog/SEOHead.astro` (modify) | Brand to themes; icon links |
| `src/server/http/public-schemas.ts`, `serialize.ts`, `src/server/content/published.ts`, `src/pages/api/v1/content/site.ts`, `src/types/cms.ts` (modify) | `brand` in the public API |
| `src/components/admin/SiteBrandFields.tsx` (create), `SettingsForm.tsx`, `ThemeForm.tsx`, `src/pages/admin/settings.astro` (modify) | The admin |
| `src/styles/installer-tokens.css`, `DESIGN.md`, `src/styles/global.css`, `src/lib/admin-i18n.ts` (modify) | Token, styles, copy |

---

### Task 1: The key grammar holds a brand file

**Files:**
- Modify: `src/server/media/keys.ts`
- Test: `tests/unit/media-storage.test.ts`

**Interfaces:**
- Produces: `createBrandObjectKey(ownerId: string, extension: 'jpg' | 'png' | 'svg' | 'webp', now?: Date): string`; `isTomeObjectKey` accepts `.svg`.

- [ ] **Step 1: Write the failing test** -- in `tests/unit/media-storage.test.ts`, inside the first test, after `assert.throws(() => createObjectKey('../owner', 'image/png'));`, and add `createBrandObjectKey` to the destructured import:

```ts
  // A logo is a file the library does not hold, in the grammar a backup and a reset accept.
  const brandKey = createBrandObjectKey(ownerId, 'svg', new Date('2026-09-21T00:00:00Z'));
  assert.match(brandKey, /^owners\/123e4567-e89b-42d3-a456-426614174000\/2026\/09\/[0-9a-f-]{36}\.svg$/);
  assert.equal(isTomeObjectKey(brandKey), true);
  assert.notEqual(createBrandObjectKey(ownerId, 'svg'), createBrandObjectKey(ownerId, 'svg'), 'a new file is a new address');
  assert.equal(isTomeObjectKey(`owners/${ownerId}/2026/09/${crypto.randomUUID()}.svgz`), false);
  assert.throws(() => createBrandObjectKey('../owner', 'png'));
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test tests/unit/media-storage.test.ts`
Expected: FAIL -- `createBrandObjectKey is not a function`.

- [ ] **Step 3: Implement** -- `src/server/media/keys.ts`:

```ts
const OBJECT_KEY = /^owners\/([0-9a-f-]{36})\/(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f-]{36})\.(avif|gif|jpg|png|svg|webp)$/i;

// ...isUuid and isTomeObjectKey unchanged...

function objectKey(ownerId: string, extension: string, now: Date): string {
  if (!isUuid(ownerId)) throw new Error('Media owner ID must be a UUID.');
  if (Number.isNaN(now.getTime())) throw new Error('Media date is invalid.');
  return `owners/${ownerId.toLowerCase()}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${extension}`;
}

export function createObjectKey(ownerId: string, mimeType: SupportedImageType, now = new Date()): string {
  if (!isUuid(ownerId)) throw new Error('Media owner ID must be a UUID.');
  const extension = imageExtension(mimeType);
  if (!extension) throw new Error('Unsupported media type.');
  return objectKey(ownerId, extension, now);
}

/**
 * A key for one of the site's logos or its icon: files the library does not hold, in the
 * grammar that backup, restore and reset accept. SVG is in that grammar for these alone --
 * the library's own types, and the checks on its tables, do not include it.
 */
export function createBrandObjectKey(ownerId: string, extension: 'jpg' | 'png' | 'svg' | 'webp', now = new Date()): string {
  return objectKey(ownerId, extension, now);
}
```

- [ ] **Step 4: Run the test and the other key users**

Run: `node --import tsx --test tests/unit/media-storage.test.ts tests/unit/media-cleanup.test.ts && node --import tsx scripts/reset-installation.mjs --self-test && node --import tsx scripts/backup.ts --self-test`
Expected: PASS.

- [ ] **Step 5: Mutation check** -- remove `svg|` from `OBJECT_KEY`; the new assertion fails; restore.

- [ ] **Step 6: Commit** -- `src/server/media/keys.ts`, `tests/unit/media-storage.test.ts`: `feat(media): a key a logo can be stored under, SVG included`.

---

### Task 2: An SVG that runs nothing and reaches nothing

**Files:**
- Create: `src/server/media/svg.ts`
- Test: `tests/unit/svg-sanitize.test.ts`

**Interfaces:**
- Produces: `sanitizeSvg(source: string): string`; `insideOnlyCss(css: string): string`.

- [ ] **Step 1: Write the failing test** -- `tests/unit/svg-sanitize.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { insideOnlyCss, sanitizeSvg } from '../../src/server/media/svg';

// Everything a hostile or careless file carries, beside a real logo's shapes.
const HOSTILE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="http://sodipodi.sourceforge.net" viewBox="0 0 120 40" onload="alert(1)">
<sodipodi:namedview id="n"/><metadata><rdf>kept out</rdf></metadata>
<script><![CDATA[alert(2)]]></script>
<foreignObject><div>leaked</div></foreignObject>
<a href="javascript:alert(3)"><rect width="10" height="10"/></a>
<image href="https://evil.test/t.png"/>
<use xlink:href="https://evil.test/sprite.svg#i"/>
<defs><linearGradient id="g"><stop offset="0" stop-color="#123"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>
<use href="#g"/>
<style><![CDATA[@import url('https://evil.test/x.css'); .a{fill:url(#g)} .b{fill:url("https://evil.test/p.png")}]]></style>
<path d="M0 0L10 10" style="fill:#2e7d5b;background:url(https://evil.test/q.png)" onclick="alert(4)"/>
<text x="4" y="30">Tome &amp; co</text>
</svg>`;

test('nothing that runs survives', () => {
  const clean = sanitizeSvg(HOSTILE);
  for (const gone of ['<script', 'alert(', 'onload', 'onclick', 'foreignObject', 'leaked', 'javascript:', '<a ', '<image', 'sodipodi', 'kept out']) {
    assert.ok(!clean.includes(gone), `${gone} survived`);
  }
});

test('nothing reaches outside the file', () => {
  const clean = sanitizeSvg(HOSTILE);
  assert.ok(!clean.includes('evil.test'), 'an outside address survived');
  assert.ok(clean.includes('href="#g"'), 'a reference inside the file was lost');
  assert.ok(clean.includes('url(#g)'), 'a gradient fill was lost');
});

test('what a logo is drawn with keeps its shape and its case', () => {
  const clean = sanitizeSvg(HOSTILE);
  for (const kept of ['viewBox="0 0 120 40"', '<linearGradient', '<clipPath', 'stop-color="#123"', 'd="M0 0L10 10"', 'fill:#2e7d5b', 'Tome &amp; co']) {
    assert.ok(clean.includes(kept), `${kept} was lost`);
  }
  assert.match(clean, /^<svg[\s>]/, 'the drawing is still the root');
});

test('CSS with an escape in it is not read at all', () => {
  // An escape can spell url( without its letters; a logo has no use for one.
  assert.equal(insideOnlyCss('.a{background:\\75 rl(https://evil.test/)}'), '');
  assert.equal(insideOnlyCss('.a{background-image:image-set("https://evil.test/a.png" 1x)}'), '');
  assert.equal(insideOnlyCss('.a{fill:url( #g )}'), '.a{fill:url( #g )}');
  assert.equal(insideOnlyCss(".a{fill:url('#g')}"), ".a{fill:url('#g')}");
});

test('what is left can still be drawn', async () => {
  const metadata = await sharp(Buffer.from(sanitizeSvg(HOSTILE))).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['svg', 120, 40]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test tests/unit/svg-sanitize.test.ts`
Expected: FAIL -- cannot find module `src/server/media/svg`.

- [ ] **Step 3: Implement** -- `src/server/media/svg.ts`:

```ts
import sanitizeHtml from 'sanitize-html';

/**
 * What a logo or an icon is drawn with, and nothing else.
 *
 * An allowlist, so what it does not name is gone -- script, foreignObject, a, image, the
 * animation elements, editors' own namespaces. Names keep their case: viewBox, clipPath and
 * linearGradient are not their lowercase selves.
 */
const ELEMENTS = [
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'style',
];

const ATTRIBUTES = [
  'xmlns', 'xmlns:xlink', 'version', 'viewBox', 'preserveAspectRatio', 'width', 'height',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'dx', 'dy', 'd', 'points', 'pathLength',
  'transform', 'id', 'class', 'style', 'href', 'xlink:href',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color', 'display', 'visibility',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'clip-path', 'clipPathUnits', 'mask', 'maskUnits', 'maskContentUnits',
  'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline',
];

/** A reference inside this file -- the only kind a logo needs. */
const internal = (value: string) => value.trim().startsWith('#');

/**
 * CSS that loads nothing from outside the file.
 *
 * `@import` goes, and so does every `url()` that is not a `#` reference. CSS with an escape in
 * it is dropped whole, as is `image-set()`: an escape can spell `url(` without its letters,
 * and a logo has no use for either.
 */
export function insideOnlyCss(css: string): string {
  if (/\\|image-set\s*\(/i.test(css)) return '';
  return css.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(['"]?)(?!#)[^)]*?\1\s*\)/gi, 'none');
}

/**
 * The file as it may be stored and served.
 *
 * The site shows it only through `<img>`, where a browser runs nothing and loads nothing
 * outside. This is for the other way in: the file opened at its own address, where it is a
 * document and this is the only guard -- TomeCMS does not set the headers the media origin
 * sends.
 */
export function sanitizeSvg(source: string): string {
  const sanitized = sanitizeHtml(source, {
    allowedTags: ELEMENTS,
    allowedAttributes: { '*': ATTRIBUTES },
    // style is allowed on purpose; what it may say is checked below.
    allowVulnerableTags: true,
    // A dropped element takes its text with it, rather than leaving it loose in the drawing.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'foreignObject', 'metadata'],
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
    transformTags: {
      '*': (tagName, attribs) => ({
        tagName,
        attribs: Object.fromEntries(Object.entries(attribs)
          .filter(([name, value]) => !/^(xlink:)?href$/.test(name) || internal(value))
          .map(([name, value]) => [name, name === 'style' ? insideOnlyCss(value) : value])),
      }),
    },
  });
  // sanitize-html passes a style element's text through untouched, so it is read here.
  return sanitized
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, (_, open: string, css: string, close: string) => `${open}${insideOnlyCss(css)}${close}`)
    .trim();
}
```

- [ ] **Step 4: Run** -- `node --import tsx --test tests/unit/svg-sanitize.test.ts` -- Expected: PASS.

- [ ] **Step 5: Mutation checks** -- one at a time, each restored: remove the `.replace(/(<style...` pass (the outside-address test fails); remove `'foreignObject'` from `nonTextTags` (`leaked` survives); make `internal` return `true` (an outside `use` survives); drop the escape check in `insideOnlyCss` (the escape test fails).

- [ ] **Step 6: Commit** -- `src/server/media/svg.ts`, `tests/unit/svg-sanitize.test.ts`: `feat(media): an SVG that runs nothing and reaches nothing outside itself`.

---

### Task 3: A brand file, checked and prepared

**Files:**
- Modify: `src/server/media/image.ts` (export the sniffer)
- Create: `src/server/media/brand-image.ts`
- Test: `tests/unit/brand-image.test.ts`

**Interfaces:**
- Consumes: `sanitizeSvg` (Task 2).
- Produces:

```ts
export type BrandKind = 'logo' | 'logo-dark' | 'icon';
export const BRAND_KINDS: readonly BrandKind[];
export const MAX_BRAND_BYTES: number;           // 1 MB
export type BrandMime = 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'image/webp';
export interface PreparedFile { body: Buffer; contentType: BrandMime; extension: 'jpg' | 'png' | 'svg' | 'webp' }
export type PreparedBrand =
  | { kind: 'logo' | 'logo-dark'; source: PreparedFile; mime: BrandMime; width: number; height: number }
  | { kind: 'icon'; svg: PreparedFile | null; png32: PreparedFile; png180: PreparedFile };
export function prepareBrandImage(kind: BrandKind, bytes: Buffer): Promise<PreparedBrand>;
// Refusals are HttpError with details.code: brand_too_large (413), brand_type (415),
// brand_icon_small (400), brand_svg_unusable (400).
```

- [ ] **Step 1: Write the failing test** -- `tests/unit/brand-image.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { HttpError } from '../../src/server/http/errors';
import { MAX_BRAND_BYTES, prepareBrandImage } from '../../src/server/media/brand-image';

const png = (width: number, height: number) =>
  sharp({ create: { background: '#2e7d5b', channels: 4, height, width } }).png().toBuffer();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><circle cx="12" cy="12" r="10" fill="#2e7d5b"/></svg>');

async function refused(pending: Promise<unknown>, status: number, code: string) {
  await assert.rejects(pending, (error: unknown) =>
    error instanceof HttpError && error.status === status && error.details?.code === code);
}

test('a raster logo is stored as it came, with its size read', async () => {
  const bytes = await png(400, 100);
  const prepared = await prepareBrandImage('logo', bytes);
  assert.equal(prepared.kind, 'logo');
  if (prepared.kind === 'icon') return;
  assert.deepEqual([prepared.width, prepared.height, prepared.mime, prepared.source.extension], [400, 100, 'image/png', 'png']);
  assert.ok(prepared.source.body.equals(bytes), 'not resized and not re-encoded');
});

test('an SVG logo is kept only as made safe', async () => {
  const prepared = await prepareBrandImage('logo-dark', SVG);
  if (prepared.kind === 'icon') throw new Error('not an icon');
  assert.equal(prepared.mime, 'image/svg+xml');
  assert.equal(prepared.source.contentType, 'image/svg+xml');
  assert.ok(!prepared.source.body.toString('utf8').includes('script'));
  assert.deepEqual([prepared.width, prepared.height], [24, 24]);
});

test('the type is read from the bytes, and each kind takes its own', async () => {
  await refused(prepareBrandImage('logo', Buffer.from('GIF89a\x01\x00\x01\x00')), 415, 'brand_type');
  await refused(prepareBrandImage('logo', Buffer.from('not an image at all')), 415, 'brand_type');
  const jpeg = await sharp({ create: { background: '#fff', channels: 3, height: 512, width: 512 } }).jpeg().toBuffer();
  await refused(prepareBrandImage('icon', jpeg), 415, 'brand_type');
});

test('an icon is drawn at the two sizes a tab and a phone ask for, square', async () => {
  const prepared = await prepareBrandImage('icon', await png(600, 300));
  if (prepared.kind !== 'icon') throw new Error('an icon');
  assert.equal(prepared.svg, null);
  for (const [file, size] of [[prepared.png32, 32], [prepared.png180, 180]] as const) {
    const metadata = await sharp(file.body).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height, file.contentType], ['png', size, size, 'image/png']);
  }
});

test('an SVG icon is kept for the browsers that take one', async () => {
  const prepared = await prepareBrandImage('icon', SVG);
  if (prepared.kind !== 'icon') throw new Error('an icon');
  assert.ok(prepared.svg && !prepared.svg.body.toString('utf8').includes('script'));
  assert.equal((await sharp(prepared.png180.body).metadata()).width, 180);
});

test('what cannot be used is refused, and says why', async () => {
  await refused(prepareBrandImage('icon', await png(120, 120)), 400, 'brand_icon_small');
  await refused(prepareBrandImage('logo', Buffer.alloc(MAX_BRAND_BYTES + 1)), 413, 'brand_too_large');
  await refused(prepareBrandImage('logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>')), 400, 'brand_svg_unusable');
});
```

- [ ] **Step 2: Run it and see it fail** -- `node --import tsx --test tests/unit/brand-image.test.ts` -- Expected: FAIL, module not found.

- [ ] **Step 3: Export the sniffer** -- in `src/server/media/image.ts`, rename `function detectedType` to `export function detectImageType` and its one caller in `inspectImage`.

- [ ] **Step 4: Implement** -- `src/server/media/brand-image.ts`:

```ts
import sharp from 'sharp';

import { HttpError } from '../http/errors';
import { detectImageType } from './image';
import { sanitizeSvg } from './svg';

export type BrandKind = 'logo' | 'logo-dark' | 'icon';
export const BRAND_KINDS: readonly BrandKind[] = ['logo', 'logo-dark', 'icon'];

/** The most a logo or an icon may weigh, before anything is done with it. */
export const MAX_BRAND_BYTES = 1024 * 1024;
/** A phone's home screen draws an icon at 180 pixels; a raster one smaller would be blown up. */
export const MIN_ICON_PIXELS = 180;
const MAX_PIXELS = 40_000_000;
const ICON_SIZES = [32, 180] as const;

export type BrandMime = 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'image/webp';
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp' } as const;
const ACCEPTED: Record<BrandKind, readonly BrandMime[]> = {
  icon: ['image/png', 'image/svg+xml'],
  logo: ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'],
  'logo-dark': ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'],
};

export interface PreparedFile { body: Buffer; contentType: BrandMime; extension: 'jpg' | 'png' | 'svg' | 'webp' }
export type PreparedBrand =
  | { kind: 'logo' | 'logo-dark'; source: PreparedFile; mime: BrandMime; width: number; height: number }
  | { kind: 'icon'; svg: PreparedFile | null; png32: PreparedFile; png180: PreparedFile };

const refuse = (status: 400 | 413 | 415, message: string, code: string) => new HttpError(status, message, { code });

/** An SVG says so in its first tag; nothing else here is text. */
function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head);
}

function file(body: Buffer, contentType: BrandMime): PreparedFile {
  return { body, contentType, extension: EXTENSION[contentType] };
}

async function sizeOf(body: Buffer): Promise<{ height: number; width: number }> {
  const metadata = await sharp(body, { failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata();
  return { height: metadata.height ?? 0, width: metadata.width ?? 0 };
}

/** Drawn on a transparent square, so an icon that is not square is centred rather than stretched. */
function rendition(source: Buffer, size: number, density: number): Promise<Buffer> {
  return sharp(source, { density, failOn: 'error', limitInputPixels: MAX_PIXELS })
    .resize(size, size, { background: { alpha: 0, b: 0, g: 0, r: 0 }, fit: 'contain' })
    .png()
    .toBuffer();
}

/**
 * A logo or an icon as it may be stored: the type read from the bytes, an SVG made safe and
 * still drawable, a raster logo as it came, an icon drawn at a tab's size and a phone's.
 */
export async function prepareBrandImage(kind: BrandKind, bytes: Buffer): Promise<PreparedBrand> {
  if (bytes.byteLength > MAX_BRAND_BYTES) throw refuse(413, 'The file is larger than 1 MB.', 'brand_too_large');

  let source: PreparedFile;
  let size: { height: number; width: number };
  if (looksLikeSvg(bytes)) {
    if (!ACCEPTED[kind].includes('image/svg+xml')) throw refuse(415, 'This kind of file is not accepted here.', 'brand_type');
    const clean = sanitizeSvg(bytes.toString('utf8'));
    try {
      if (!/^<svg[\s>]/.test(clean)) throw new Error('No drawing left.');
      source = file(Buffer.from(clean, 'utf8'), 'image/svg+xml');
      size = await sizeOf(source.body);
    } catch {
      throw refuse(400, 'This SVG could not be drawn once made safe.', 'brand_svg_unusable');
    }
    if (!size.width || !size.height) throw refuse(400, 'This SVG could not be drawn once made safe.', 'brand_svg_unusable');
  } else {
    const detected = detectImageType(bytes);
    if (!detected || !(ACCEPTED[kind] as readonly string[]).includes(detected)) {
      throw refuse(415, 'This kind of file is not accepted here.', 'brand_type');
    }
    source = file(bytes, detected as BrandMime);
    try {
      size = await sizeOf(bytes);
    } catch {
      throw refuse(415, 'This image could not be read.', 'brand_type');
    }
    if (!size.width || !size.height) throw refuse(415, 'This image could not be read.', 'brand_type');
  }

  if (kind !== 'icon') return { height: size.height, kind, mime: source.contentType, source, width: size.width };

  const isSvg = source.contentType === 'image/svg+xml';
  if (!isSvg && Math.min(size.width, size.height) < MIN_ICON_PIXELS) {
    throw refuse(400, 'An icon must be at least 180 by 180 pixels.', 'brand_icon_small');
  }
  // An SVG is drawn at the density that gives it a 512-pixel short side first, so the 180-pixel
  // icon is drawn from detail rather than blown up from a 24-pixel viewBox.
  const density = isSvg ? Math.min(2400, Math.max(72, Math.ceil(72 * 512 / Math.min(size.width, size.height)))) : 72;
  const [png32, png180] = await Promise.all(ICON_SIZES.map(async (edge) => file(await rendition(source.body, edge, density), 'image/png')));
  return { kind, png180: png180!, png32: png32!, svg: isSvg ? source : null };
}
```

- [ ] **Step 5: Run** -- `node --import tsx --test tests/unit/brand-image.test.ts tests/unit/svg-sanitize.test.ts` -- Expected: PASS. Also `node --import tsx --test tests/unit/media-*.test.ts` (the sniffer rename).

- [ ] **Step 6: Mutation checks** -- each restored: remove the `MIN_ICON_PIXELS` check (`brand_icon_small` test fails); accept JPEG for `icon` (type test fails); return `bytes` instead of the sanitized body for an SVG (`script` test fails); drop `fit: 'contain'` (the square test fails for 600×300).

- [ ] **Step 7: Commit** -- `src/server/media/image.ts`, `src/server/media/brand-image.ts`, `tests/unit/brand-image.test.ts`: `feat(media): a logo or an icon, read from its bytes and made ready to store`.

---

### Task 4: What is stored, and what a page is given

**Files:**
- Create: `src/lib/site-brand.ts`
- Test: `tests/unit/site-brand.test.ts`

**Interfaces:**
- Produces:

```ts
export const storedBrandImageSchema: z.ZodType<StoredBrandImage>;
export const storedBrandIconSchema: z.ZodType<StoredBrandIcon>;
export interface StoredBrandImage { height: number; key: string; mime: BrandMime; width: number }
export interface StoredBrandIcon { png180Key: string; png32Key: string; svgKey: string | null }
export interface StoredBrand { brand_icon: StoredBrandIcon | null; brand_logo: StoredBrandImage | null; brand_logo_dark: StoredBrandImage | null; hide_site_name: boolean }
export interface BrandImage { height: number; mimeType: BrandMime; url: string; width: number }
export interface BrandIcon { png180: string; png32: string; svg: string | null }
export interface SiteBrand { icon: BrandIcon | null; logo: BrandImage | null; logoDark: BrandImage | null; showSiteName: boolean }
export const NO_BRAND: SiteBrand;
export function parseStoredImage(value: unknown): StoredBrandImage | null;
export function parseStoredIcon(value: unknown): StoredBrandIcon | null;
export function siteBrand(stored: StoredBrand, resolve: (key: string) => string): SiteBrand;
export function storedBrandKeys(value: unknown): string[];
export function iconLinks(icon: BrandIcon | null): IconLink[];
export interface IconLink { href: string; rel: 'apple-touch-icon' | 'icon'; sizes?: string; type?: string }
```

- [ ] **Step 1: Write the failing test** -- `tests/unit/site-brand.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { iconLinks, NO_BRAND, siteBrand, storedBrandKeys, type StoredBrand } from '../../src/lib/site-brand';

const logo = { height: 80, key: 'owners/o/2026/09/a.svg', mime: 'image/svg+xml' as const, width: 240 };
const dark = { ...logo, key: 'owners/o/2026/09/b.svg' };
const icon = { png180Key: 'owners/o/2026/09/c.png', png32Key: 'owners/o/2026/09/d.png', svgKey: 'owners/o/2026/09/e.svg' };
const resolve = (key: string) => `https://media.test/${key}`;
const stored = (overrides: Partial<StoredBrand>): StoredBrand => ({
  brand_icon: null, brand_logo: null, brand_logo_dark: null, hide_site_name: false, ...overrides,
});

test('the name leaves the header only while a logo stands in for it', () => {
  assert.equal(siteBrand(stored({ brand_logo: logo, hide_site_name: true }), resolve).showSiteName, false);
  assert.equal(siteBrand(stored({ brand_logo: logo }), resolve).showSiteName, true);
  // The switch still says hide; with no logo the header needs the name, so it stays.
  assert.equal(siteBrand(stored({ hide_site_name: true }), resolve).showSiteName, true);
});

test('a dark logo is drawn only beside a logo', () => {
  const both = siteBrand(stored({ brand_logo: logo, brand_logo_dark: dark }), resolve);
  assert.equal(both.logoDark?.url, `https://media.test/${dark.key}`);
  assert.equal(siteBrand(stored({ brand_logo_dark: dark }), resolve).logoDark, null);
});

test('keys become addresses, and nothing else of the key leaks', () => {
  const brand = siteBrand(stored({ brand_icon: icon, brand_logo: logo }), resolve);
  assert.deepEqual(brand.logo, { height: 80, mimeType: 'image/svg+xml', url: `https://media.test/${logo.key}`, width: 240 });
  assert.deepEqual(brand.icon, {
    png180: `https://media.test/${icon.png180Key}`, png32: `https://media.test/${icon.png32Key}`, svg: `https://media.test/${icon.svgKey}`,
  });
  assert.deepEqual(siteBrand(stored({}), resolve), NO_BRAND);
});

test('every object a stored value names is found, and garbage names none', () => {
  assert.deepEqual(storedBrandKeys(logo), [logo.key]);
  assert.deepEqual(storedBrandKeys(icon), [icon.svgKey, icon.png32Key, icon.png180Key]);
  assert.deepEqual(storedBrandKeys({ ...icon, svgKey: null }), [icon.png32Key, icon.png180Key]);
  for (const nothing of [null, undefined, {}, 'owners/x.png', { key: 42 }]) assert.deepEqual(storedBrandKeys(nothing), []);
});

test('the icon links a public page carries, in the order browsers read them', () => {
  assert.deepEqual(iconLinks(null), [{ href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' }]);
  const links = iconLinks(siteBrand(stored({ brand_icon: icon }), resolve).icon);
  assert.deepEqual(links.map(({ rel, sizes, type }) => [rel, sizes ?? null, type ?? null]), [
    ['icon', '32x32', 'image/png'],
    ['icon', null, 'image/svg+xml'],
    ['apple-touch-icon', null, null],
  ]);
  assert.equal(iconLinks(siteBrand(stored({ brand_icon: { ...icon, svgKey: null } }), resolve).icon).length, 2);
});
```

- [ ] **Step 2: Run it and see it fail** -- `node --import tsx --test tests/unit/site-brand.test.ts` -- module not found.

- [ ] **Step 3: Implement** -- `src/lib/site-brand.ts`:

```ts
import { z } from 'zod';

const brandMime = z.enum(['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']);
const objectKey = z.string().min(1).max(512);

export const storedBrandImageSchema = z.object({
  height: z.number().int().positive(),
  key: objectKey,
  mime: brandMime,
  width: z.number().int().positive(),
}).strict();

export const storedBrandIconSchema = z.object({
  png180Key: objectKey,
  png32Key: objectKey,
  svgKey: objectKey.nullable(),
}).strict();

export type BrandMime = z.infer<typeof brandMime>;
export type StoredBrandImage = z.infer<typeof storedBrandImageSchema>;
export type StoredBrandIcon = z.infer<typeof storedBrandIconSchema>;

/** What site_settings holds about the site's own logo, name and icon. */
export interface StoredBrand {
  brand_icon: StoredBrandIcon | null;
  brand_logo: StoredBrandImage | null;
  brand_logo_dark: StoredBrandImage | null;
  hide_site_name: boolean;
}

export interface BrandImage { height: number; mimeType: BrandMime; url: string; width: number }
export interface BrandIcon { png180: string; png32: string; svg: string | null }
export interface SiteBrand { icon: BrandIcon | null; logo: BrandImage | null; logoDark: BrandImage | null; showSiteName: boolean }
export interface IconLink { href: string; rel: 'apple-touch-icon' | 'icon'; sizes?: string; type?: string }

export const NO_BRAND: SiteBrand = { icon: null, logo: null, logoDark: null, showSiteName: true };

/** A brand column's value, or nothing: a value of any other shape reads as nothing stored. */
export function parseStoredImage(value: unknown): StoredBrandImage | null {
  const parsed = storedBrandImageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseStoredIcon(value: unknown): StoredBrandIcon | null {
  const parsed = storedBrandIconSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * What a site wears, with each key made an address.
 *
 * The name leaves the header only while a logo stands in for it: take the logo away and the
 * name comes back, whatever the switch still says. A dark logo is the dark half of a logo, so
 * it is drawn only beside one.
 */
export function siteBrand(stored: StoredBrand, resolve: (key: string) => string): SiteBrand {
  const image = (value: StoredBrandImage | null): BrandImage | null => value
    ? { height: value.height, mimeType: value.mime, url: resolve(value.key), width: value.width }
    : null;
  const logo = image(stored.brand_logo);
  const icon = stored.brand_icon;
  return {
    icon: icon ? { png180: resolve(icon.png180Key), png32: resolve(icon.png32Key), svg: icon.svgKey ? resolve(icon.svgKey) : null } : null,
    logo,
    logoDark: logo ? image(stored.brand_logo_dark) : null,
    showSiteName: !logo || !stored.hide_site_name,
  };
}

/** Every object a stored value names -- what a replacement deletes and a reset accounts for. */
export function storedBrandKeys(value: unknown): string[] {
  const image = parseStoredImage(value);
  if (image) return [image.key];
  const icon = parseStoredIcon(value);
  return icon ? [icon.svgKey, icon.png32Key, icon.png180Key].filter((key): key is string => key !== null) : [];
}

/**
 * The icon links a public page carries. A PNG first, for every browser; the SVG after it, for
 * those that prefer one; a phone's home screen takes only the PNG. Without an icon of its own
 * the site wears TomeCMS's.
 */
export function iconLinks(icon: BrandIcon | null): IconLink[] {
  if (!icon) return [{ href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' }];
  return [
    { href: icon.png32, rel: 'icon', sizes: '32x32', type: 'image/png' },
    ...(icon.svg ? [{ href: icon.svg, rel: 'icon' as const, type: 'image/svg+xml' }] : []),
    { href: icon.png180, rel: 'apple-touch-icon' },
  ];
}
```

- [ ] **Step 4: Run** -- Expected: PASS.

- [ ] **Step 5: Mutation checks** -- each restored: `showSiteName: !stored.hide_site_name` (the no-logo case fails); `logoDark: image(stored.brand_logo_dark)` (the dark-without-logo case fails); drop the `.filter` in `storedBrandKeys` (the null-svg case fails).

- [ ] **Step 6: Commit** -- `src/lib/site-brand.ts`, `tests/unit/site-brand.test.ts`: `feat(site): what the site's logo, name and icon are, stored and given`.

---

### Task 5: Four columns, and the settings that carry them

**Files:**
- Create: `src/server/db/migrations/020_site_brand.ts`
- Modify: `src/server/db/migrator.ts`, `src/server/db/types.ts`, `src/types/cms.ts`, `src/server/content/settings.ts`, `src/components/admin/SettingsForm.tsx`, `src/components/admin/ThemeForm.tsx`
- Test: `tests/unit/db-migrator.test.ts`, `tests/integration/settings-service.test.ts`, `tests/unit/public-serialization.test.ts` (fixture)

**Interfaces:**
- Consumes: `parseStoredImage`, `parseStoredIcon`, `StoredBrandImage`, `StoredBrandIcon` (Task 4).
- Produces: `SiteSettings` (server) now has `brand_logo`, `brand_logo_dark`, `brand_icon` (parsed) and `hide_site_name`; `siteSettingsMutationSchema` requires `hideSiteName: boolean`;

```ts
export type BrandColumn = 'brand_icon' | 'brand_logo' | 'brand_logo_dark';
export function writeSiteBrand(ownerId: string, column: BrandColumn, value: StoredBrandImage | StoredBrandIcon | null): Promise<{ previous: unknown; settings: SiteSettings }>;
```

- [ ] **Step 1: Write the failing tests** -- in `tests/unit/db-migrator.test.ts` change the tripwire to `'020_site_brand'`. In `tests/integration/settings-service.test.ts`, add `hideSiteName: true` to the mutation it sends, and after the update assert:

```ts
  assert.equal(updated.hide_site_name, true, 'the switch is kept');
  assert.equal(updated.brand_logo, null, 'a site starts with no logo');
```

- [ ] **Step 2: Run and see them fail** -- `node --import tsx --test tests/unit/db-migrator.test.ts` (tripwire) and `node scripts/test-foundation.mjs tests/integration/settings-service.test.ts` (column missing).

- [ ] **Step 3: The migration** -- `src/server/db/migrations/020_site_brand.ts`:

```ts
import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * The site's own logo, a second one for the dark scheme, and its icon -- and whether the
 * header still says the site's name beside the logo.
 *
 * On the settings row rather than in media_items: the library holds five raster types and
 * checks that it does, and SVG belongs to these three alone. Each is null or an object, and
 * is parsed where it is read (src/lib/site-brand.ts).
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .addColumn('brand_logo', 'jsonb', (column) => column.check(sql`brand_logo is null or jsonb_typeof(brand_logo) = 'object'`))
    .addColumn('brand_logo_dark', 'jsonb', (column) => column.check(sql`brand_logo_dark is null or jsonb_typeof(brand_logo_dark) = 'object'`))
    .addColumn('brand_icon', 'jsonb', (column) => column.check(sql`brand_icon is null or jsonb_typeof(brand_icon) = 'object'`))
    .addColumn('hide_site_name', 'boolean', (column) => column.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('site_settings')
    .dropColumn('hide_site_name').dropColumn('brand_icon').dropColumn('brand_logo_dark').dropColumn('brand_logo')
    .execute();
}
```

Register it in `src/server/db/migrator.ts` (`import * as siteBrand from './migrations/020_site_brand';` and `'020_site_brand': siteBrand,`).

- [ ] **Step 4: Types** -- `src/server/db/types.ts`, in `SiteSettingsTable` after `author_links`:

```ts
  /** { key, mime, width, height } or null -- see migrations/020_site_brand. */
  brand_logo: unknown;
  brand_logo_dark: unknown;
  /** { svgKey, png32Key, png180Key } or null. */
  brand_icon: unknown;
  hide_site_name: Generated<boolean>;
```

`src/types/cms.ts`, in `SiteSettings` after `author_links`: `hide_site_name: boolean;`.

- [ ] **Step 5: The settings service** -- `src/server/content/settings.ts`:

```ts
import { parseStoredIcon, parseStoredImage, type StoredBrandIcon, type StoredBrandImage } from '../../lib/site-brand';

// in siteSettingsMutationSchema, after defaultLocale:
  hideSiteName: z.boolean(),

type BrandFields = 'author_links' | 'brand_icon' | 'brand_logo' | 'brand_logo_dark';
export type SiteSettings = Omit<Selectable<SiteSettingsTable>, BrandFields> & {
  author_links: AuthorLink[];
  brand_icon: StoredBrandIcon | null;
  brand_logo: StoredBrandImage | null;
  brand_logo_dark: StoredBrandImage | null;
};

function normalizeSettings(row: Selectable<SiteSettingsTable>): SiteSettings {
  return {
    ...row,
    author_links: authorLinksSchema.parse(row.author_links),
    brand_icon: parseStoredIcon(row.brand_icon),
    brand_logo: parseStoredImage(row.brand_logo),
    brand_logo_dark: parseStoredImage(row.brand_logo_dark),
  };
}

// in updateSiteSettings .set({...}): hide_site_name: input.hideSiteName,

export type BrandColumn = 'brand_icon' | 'brand_logo' | 'brand_logo_dark';

/**
 * One brand column set, and what it held before, so the caller can delete what it replaced.
 *
 * Moves updated_at like every write to this row: the public site's Last-Modified is read from
 * it, and a cache must not keep serving the old logo. The Settings form is handed the new
 * version, or its next save would be refused as stale. Not versioned itself -- a file field
 * applies on the spot and cannot lose an edit the owner is still making.
 */
export async function writeSiteBrand(
  ownerId: string,
  column: BrandColumn,
  value: StoredBrandImage | StoredBrandIcon | null,
): Promise<{ previous: unknown; settings: SiteSettings }> {
  return db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('site_settings').select(column)
      .where('id', '=', true).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Site settings not found.');
    const row = await trx.updateTable('site_settings')
      .set({ [column]: value === null ? null : sql<Json>`${JSON.stringify(value)}::jsonb`, updated_at: nextVersion })
      .where('id', '=', true).where('owner_id', '=', ownerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { previous: current[column], settings: normalizeSettings(row) };
  });
}
```

- [ ] **Step 6: Both forms that write the record whole carry it** -- `SettingsForm.tsx`: add `'hide_site_name'` to the `initialSettings` Pick, `const [hideSiteName] = useState(initialSettings.hide_site_name);` for now (the switch arrives in Task 9), and `hideSiteName` in the PUT body. `ThemeForm.tsx`: add `'hide_site_name'` to `ThemeSettings`, and `hideSiteName: initialSettings.hide_site_name,` in its PUT body.

- [ ] **Step 7: Fixtures** -- in `tests/unit/public-serialization.test.ts`'s settings row add `brand_icon: null, brand_logo: null, brand_logo_dark: null, hide_site_name: false,`. Run `npm run check` and add the same four to any other fixture it names.

- [ ] **Step 8: Run** -- `node --import tsx --test tests/unit/db-migrator.test.ts tests/unit/public-serialization.test.ts`, `node scripts/test-foundation.mjs tests/integration/settings-service.test.ts`, `npm run check` -- all PASS.

- [ ] **Step 9: Mutation check** -- drop `hide_site_name: input.hideSiteName` from the update; the integration assertion fails; restore.

- [ ] **Step 10: Commit** -- the files above: `feat(settings): room on the settings row for a logo, a dark logo and an icon`.

---

### Task 6: Storing, replacing and removing, with nothing left behind

**Files:**
- Create: `src/server/content/brand.ts`, `src/pages/api/admin/brand/[kind].ts`, `tests/integration/site-brand.test.ts`
- Modify: `scripts/reset-installation.mjs` (export `knownObjects`, count brand keys), `scripts/test-foundation.mjs` (storage for this test)

**Interfaces:**
- Consumes: `prepareBrandImage`, `BRAND_KINDS`, `MAX_BRAND_BYTES` (Task 3); `createBrandObjectKey` (Task 1); `siteBrand`, `storedBrandKeys` (Task 4); `writeSiteBrand` (Task 5).
- Produces: `storeBrandImage(ownerId, kind, bytes): Promise<{ brand: SiteBrand; updatedAt: string }>`; `removeBrandImage(ownerId, kind)` with the same result; `brandOf(settings: SiteSettings): SiteBrand`; `POST|DELETE /api/admin/brand/{logo|logo-dark|icon}` answering `{ brand, updatedAt }` or `{ code, error }`.

- [ ] **Step 1: Write the failing test** -- `tests/integration/site-brand.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

const OWNER = '5b0e1f3c-2d4a-4e6b-8c9d-0a1b2c3d4e5f';
const HOSTILE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><script>alert(1)</script><rect width="120" height="40" fill="#2e7d5b"/></svg>');

test('a logo and an icon are stored, replaced and removed, and nothing is left behind', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { getSiteSettings } = await import('../../src/server/content/settings');
  const { brandOf, removeBrandImage, storeBrandImage } = await import('../../src/server/content/brand');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const { knownObjects } = await import('../../scripts/reset-installation.mjs');
  const sharp = (await import('sharp')).default;
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({ id: OWNER, name: 'Owner', email: 'brand@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({ id: true, owner_id: OWNER, site_name: 'Brand', default_locale: 'en', timezone: 'UTC', admin_path: '/admin' }).execute();

  const head = async (key: string) => {
    try { return await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key })); } catch { return null; }
  };
  const bucket = async () => ((await s3.send(new ListObjectsV2Command({ Bucket: s3Bucket }))).Contents ?? []).map(({ Key }) => Key).sort();
  const row = async () => db.selectFrom('site_settings').select(['brand_icon', 'brand_logo', 'updated_at']).executeTakeFirstOrThrow();

  // An SVG is stored as made safe, under a key backup and reset accept.
  const first = await storeBrandImage(OWNER, 'logo', HOSTILE);
  const logoKey = (await row()).brand_logo as { key: string } | null;
  assert.ok(logoKey);
  assert.match(logoKey.key, new RegExp(`^owners/${OWNER}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.svg$`));
  assert.equal((await head(logoKey.key))?.ContentType, 'image/svg+xml');
  const stored = await (await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: logoKey.key }))).Body!.transformToString();
  assert.ok(!stored.includes('script'), 'stored as made safe');
  assert.ok(first.brand.logo?.url.endsWith(logoKey.key));
  assert.ok((await knownObjects(db)).some(({ key }) => key === logoKey.key), 'a reset accounts for the logo');

  // A replacement deletes what it replaced, and moves the version the public API reads.
  const png = await sharp({ create: { background: '#123456', channels: 4, height: 100, width: 400 } }).png().toBuffer();
  const second = await storeBrandImage(OWNER, 'logo', png);
  assert.equal(await head(logoKey.key), null, 'the replaced logo is gone');
  assert.ok(Date.parse(second.updatedAt) > Date.parse(first.updatedAt));

  // An icon is three objects; a removal clears the setting and all three.
  await storeBrandImage(OWNER, 'icon', HOSTILE);
  const icon = (await row()).brand_icon as { png180Key: string; png32Key: string; svgKey: string };
  for (const key of [icon.svgKey, icon.png32Key, icon.png180Key]) assert.ok(await head(key), `${key} was not stored`);
  assert.equal((await head(icon.png180Key))?.ContentType, 'image/png');
  await removeBrandImage(OWNER, 'icon');
  for (const key of [icon.svgKey, icon.png32Key, icon.png180Key]) assert.equal(await head(key), null, `${key} was left behind`);
  assert.equal((await row()).brand_icon, null);

  // A refused file leaves nothing in the bucket.
  const before = await bucket();
  const small = await sharp({ create: { background: '#fff', channels: 4, height: 64, width: 64 } }).png().toBuffer();
  await assert.rejects(storeBrandImage(OWNER, 'icon', small), (error: unknown) =>
    (error as { details?: { code?: string } }).details?.code === 'brand_icon_small');
  assert.deepEqual(await bucket(), before);

  // Hiding the name holds while there is a logo, and removing the logo brings it back.
  await db.updateTable('site_settings').set({ hide_site_name: true }).execute();
  assert.equal(brandOf((await getSiteSettings())!).showSiteName, false);
  await removeBrandImage(OWNER, 'logo');
  assert.equal(brandOf((await getSiteSettings())!).showSiteName, true);
});
```

- [ ] **Step 2: Give the test its storage** -- `scripts/test-foundation.mjs`:

```js
// Files that talk to object storage; every other focused run starts Postgres alone.
const STORAGE_TESTS = new Set(['tests/integration/foundation.test.ts', 'tests/integration/site-brand.test.ts']);
const requiresStorage = runAll || testFiles.some((file) => STORAGE_TESTS.has(file));
```

- [ ] **Step 3: Run and see it fail** -- `node scripts/test-foundation.mjs tests/integration/site-brand.test.ts` -- Expected: FAIL, `src/server/content/brand` not found.

- [ ] **Step 4: The service** -- `src/server/content/brand.ts`:

```ts
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { siteBrand, storedBrandKeys, type SiteBrand, type StoredBrandIcon, type StoredBrandImage } from '../../lib/site-brand';
import { prepareBrandImage, type BrandKind, type PreparedFile } from '../media/brand-image';
import { createBrandObjectKey } from '../media/keys';
import { s3, s3Bucket } from '../media/storage';
import { resolveMediaUrl } from '../media/url';
import { writeSiteBrand, type BrandColumn, type SiteSettings } from './settings';

const COLUMN: Record<BrandKind, BrandColumn> = { icon: 'brand_icon', logo: 'brand_logo', 'logo-dark': 'brand_logo_dark' };
/** A key is never reused, so what is behind one never changes. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

export interface BrandResult { brand: SiteBrand; updatedAt: string }

export function brandOf(settings: SiteSettings): SiteBrand {
  return siteBrand(settings, resolveMediaUrl);
}

async function put(ownerId: string, file: PreparedFile, written: string[]): Promise<string> {
  const key = createBrandObjectKey(ownerId, file.extension);
  await s3.send(new PutObjectCommand({ Body: file.body, Bucket: s3Bucket, CacheControl: IMMUTABLE, ContentType: file.contentType, Key: key }));
  written.push(key);
  return key;
}

/** Best effort: an object nothing points at is harmless; a setting that points at nothing is not. */
async function removeObjects(keys: string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key }))));
  if (results.some(({ status }) => status === 'rejected')) console.error('A brand object could not be deleted');
}

/**
 * A logo, a dark logo or an icon, in this order: checked, stored, recorded, and only then is
 * what it replaced deleted. A failure before the record deletes what this request stored.
 */
export async function storeBrandImage(ownerId: string, kind: BrandKind, bytes: Buffer): Promise<BrandResult> {
  const prepared = await prepareBrandImage(kind, bytes);
  const written: string[] = [];
  let recorded: Awaited<ReturnType<typeof writeSiteBrand>>;
  try {
    let value: StoredBrandIcon | StoredBrandImage;
    if (prepared.kind === 'icon') {
      value = {
        png180Key: await put(ownerId, prepared.png180, written),
        png32Key: await put(ownerId, prepared.png32, written),
        svgKey: prepared.svg ? await put(ownerId, prepared.svg, written) : null,
      };
    } else {
      value = { height: prepared.height, key: await put(ownerId, prepared.source, written), mime: prepared.mime, width: prepared.width };
    }
    recorded = await writeSiteBrand(ownerId, COLUMN[kind], value);
  } catch (error) {
    await removeObjects(written);
    throw error;
  }
  await removeObjects(storedBrandKeys(recorded.previous));
  return { brand: brandOf(recorded.settings), updatedAt: recorded.settings.updated_at.toISOString() };
}

export async function removeBrandImage(ownerId: string, kind: BrandKind): Promise<BrandResult> {
  const { previous, settings } = await writeSiteBrand(ownerId, COLUMN[kind], null);
  await removeObjects(storedBrandKeys(previous));
  return { brand: brandOf(settings), updatedAt: settings.updated_at.toISOString() };
}
```

- [ ] **Step 5: The endpoint** -- `src/pages/api/admin/brand/[kind].ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';

import { assertSameOrigin } from '../../../../server/auth/origin';
import { requireInstalledOwner } from '../../../../server/auth/session';
import { removeBrandImage, storeBrandImage } from '../../../../server/content/brand';
import { getServerEnv } from '../../../../server/env';
import { adminErrorResponse, HttpError } from '../../../../server/http/errors';
import { BRAND_KINDS, MAX_BRAND_BYTES, type BrandKind } from '../../../../server/media/brand-image';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const headers = (requestId: string) => ({ 'Cache-Control': 'no-store', 'X-Request-ID': requestId });

async function owner(request: Request) {
  const current = await requireInstalledOwner(request.headers);
  try {
    assertSameOrigin(request, configuredOrigin);
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
  return current;
}

function kindOf(value: string | undefined): BrandKind {
  if (!value || !(BRAND_KINDS as readonly string[]).includes(value)) throw new HttpError(404, 'Not found.');
  return value as BrandKind;
}

/** The body, read no further than a brand file may weigh. */
async function readFile(request: Request): Promise<Buffer> {
  const tooLarge = () => new HttpError(413, 'The file is larger than 1 MB.', { code: 'brand_too_large' });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BRAND_BYTES) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(415, 'Choose a file.', { code: 'brand_type' });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BRAND_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const POST: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await owner(request);
    const result = await storeBrandImage(current.user.id, kindOf(params.kind), await readFile(request));
    return Response.json(result, { headers: headers(requestId) });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const requestId = randomUUID();
  try {
    const current = await owner(request);
    return Response.json(await removeBrandImage(current.user.id, kindOf(params.kind)), { headers: headers(requestId) });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
```

- [ ] **Step 6: The reset counts them** -- `scripts/reset-installation.mjs`: `import { storedBrandKeys } from '../src/lib/site-brand.ts';`, export `knownObjects`, and inside it:

```js
  // The site's logos and icon live in the same bucket and are accounted for by the settings row.
  const brand = await database.selectFrom('site_settings').select(['brand_logo', 'brand_logo_dark', 'brand_icon']).execute();
  const brandKeys = brand.flatMap((row) => [row.brand_logo, row.brand_logo_dark, row.brand_icon].flatMap(storedBrandKeys))
    .map((object_key) => ({ id: 'site_settings', object_key }));
  for (const row of [...media, ...reservations, ...brandKeys]) {
```

- [ ] **Step 7: Run** -- `node scripts/test-foundation.mjs tests/integration/site-brand.test.ts` and `node --import tsx scripts/reset-installation.mjs --self-test`, then `npm run check` -- PASS.

- [ ] **Step 8: Mutation checks** -- each restored: skip `removeObjects(storedBrandKeys(recorded.previous))` (the replaced logo stays); remove the `catch` compensation and make `writeSiteBrand` throw once (the bucket gains an object -- check by temporarily throwing inside `writeSiteBrand` for `brand_icon`); drop `brandKeys` from `knownObjects` (the reset assertion fails).

- [ ] **Step 9: Commit** -- the files above: `feat(settings): a logo and an icon stored, replaced and removed without leaving anything behind`.

---

### Task 7: What a reader sees

**Files:**
- Create: `src/components/SiteBrand.astro`, `tests/e2e/site-brand.spec.ts`
- Modify: `src/themes/contract.ts`, `src/themes/paper/Shell.astro`, `src/themes/paper/parts/Header.astro`, `src/themes/paper/theme.css`, `src/themes/plain/Shell.astro`, `src/themes/plain/theme.css`, `src/layouts/BaseLayout.astro`, `src/components/blog/SEOHead.astro`, `src/styles/global.css`

**Interfaces:**
- Consumes: `siteBrand`, `iconLinks`, `NO_BRAND`, `SiteBrand`, `BrandIcon` (Task 4); `resolveMediaUrl`.
- Produces: `ThemeShellProps.brand: ThemeBrand` with `export type ThemeBrand = Pick<SiteBrand, 'logo' | 'logoDark' | 'showSiteName'>`.

- [ ] **Step 1: Write the failing browser test** -- `tests/e2e/site-brand.spec.ts`, its setup copied from `tests/e2e/theme-settings.spec.ts` with `test.use({ stack: 'site-brand' })`, `PROJECT = 'tomecms-site-brand'`, `TOME_CMS_VITE_CACHE_DIR: 'node_modules/.vite-site-brand'`, the owner id `OWNER = '5b0e1f3c-2d4a-4e6b-8c9d-0a1b2c3d4e5f'` in place of `'signin-test-owner'`, no posts or media seeded, and this first test:

```ts
test('the header wears the logo, hides the name only behind it, and swaps it in the dark', async ({ page }) => {
  test.setTimeout(120_000);
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { s3, s3Bucket } = await import('../../src/server/media/storage');
  const { createBrandObjectKey } = await import('../../src/server/media/keys');
  const put = async (extension: 'png' | 'svg', body: string | Buffer, contentType: string) => {
    const key = createBrandObjectKey(OWNER, extension);
    await s3.send(new PutObjectCommand({ Body: body, Bucket: s3Bucket, ContentType: contentType, Key: key }));
    return key;
  };
  const light = await put('svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#111"/></svg>', 'image/svg+xml');
  const dark = await put('svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#eee"/></svg>', 'image/svg+xml');
  const brand = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
  await db.updateTable('site_settings').set({ brand_logo: brand({ height: 40, key: light, mime: 'image/svg+xml', width: 120 }) }).execute();

  await page.goto(`${origin}/en`);
  const home = page.locator('header a[href="/en"]').first();
  await expect(home.locator('img.site-brand__logo--light')).toHaveAttribute('src', new RegExp(`${light}$`));
  await expect(home.locator('.site-brand__name'), 'the name beside the logo').toHaveText('Brand Test');
  await expect(home.locator('img.site-brand__logo--light'), 'decoration while the name is there').toHaveAttribute('alt', '');

  await db.updateTable('site_settings').set({ hide_site_name: true }).execute();
  await page.reload();
  await expect(home.locator('.site-brand__name')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Brand Test' }).first(), 'the link keeps a name').toBeVisible();

  await db.updateTable('site_settings').set({ brand_logo_dark: brand({ height: 40, key: dark, mime: 'image/svg+xml', width: 120 }) }).execute();
  await page.reload();
  const shown = async () => page.evaluate(() => [...document.querySelectorAll('header img.site-brand__logo')]
    .filter((image) => getComputedStyle(image).display !== 'none').map((image) => image.className));
  expect(await shown()).toEqual(['site-brand__logo site-brand__logo--light']);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect(await shown(), 'the visitor chose dark').toEqual(['site-brand__logo site-brand__logo--dark']);
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await shown(), 'the system is dark').toEqual(['site-brand__logo site-brand__logo--dark']);

  // Without a logo the name comes back, whatever the switch still says.
  await db.updateTable('site_settings').set({ brand_logo: null }).execute();
  await page.reload();
  await expect(home.locator('.site-brand__name')).toHaveText('Brand Test');
});

test('a public page wears the site icon, and the admin keeps TomeCMS\'s', async ({ page }) => {
  const { sql } = await import('kysely');
  const { db } = await import('../../src/server/db/client');
  const icon = { png180Key: `owners/${OWNER}/2026/09/${crypto.randomUUID()}.png`, png32Key: `owners/${OWNER}/2026/09/${crypto.randomUUID()}.png`, svgKey: null };
  await db.updateTable('site_settings').set({ brand_icon: sql`${JSON.stringify(icon)}::jsonb` }).execute();
  await page.goto(`${origin}/en`);
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', new RegExp(`${icon.png32Key}$`));
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', new RegExp(`${icon.png180Key}$`));
  await expect(page.locator('link[href="/favicon.svg"]')).toHaveCount(0);
  await page.goto(`${origin}/admin/login`);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
});
```

Seed `site_name` as `'Brand Test'` in the spec's `beforeAll`.

- [ ] **Step 2: Run and see it fail** -- `PLAYWRIGHT_BROWSERS_PATH=<chromium-only path> npm run test:e2e -- tests/e2e/site-brand.spec.ts` -- FAIL, no `.site-brand__logo--light`.

- [ ] **Step 3: The contract** -- `src/themes/contract.ts`:

```ts
import type { SiteBrand } from '../lib/site-brand';

/** What a theme is told about the site's logo; it draws it with SiteBrand, not by hand. */
export type ThemeBrand = Pick<SiteBrand, 'logo' | 'logoDark' | 'showSiteName'>;

// in ThemeShellProps, beside siteName:
  /** The logo, a dark one, and whether the name is beside them. Put <SiteBrand> in the home link. */
  brand: ThemeBrand;
```

- [ ] **Step 4: The component** -- `src/components/SiteBrand.astro`:

```astro
---
import type { ThemeBrand } from '../themes/contract';

interface Props {
  brand: ThemeBrand;
  siteName: string;
}

/**
 * What goes inside a theme's home link: the site's logo, its name, or both.
 *
 * The core's, so every theme hides the name by one rule and never leaves the link without a
 * name: with the name shown the logo is decoration, and with it hidden the logo carries it.
 * A dark logo is the second image, swapped in by CSS (global.css) -- no script.
 */
const { brand, siteName } = Astro.props;
const alt = brand.showSiteName ? '' : siteName;
---

<span class:list={['site-brand', { 'site-brand--has-dark': brand.logoDark }]}>
  {brand.logo && <img alt={alt} class="site-brand__logo site-brand__logo--light" decoding="async" height={brand.logo.height} src={brand.logo.url} width={brand.logo.width} />}
  {brand.logoDark && <img alt={alt} class="site-brand__logo site-brand__logo--dark" decoding="async" height={brand.logoDark.height} src={brand.logoDark.url} width={brand.logoDark.width} />}
  {brand.showSiteName && <span class="site-brand__name">{siteName}</span>}
</span>
```

- [ ] **Step 5: Its styles** -- `src/styles/global.css`, after the `.site-notice` rules:

```css
/* The site's logo, drawn by the core inside each theme's home link. A theme sizes it with
 * --site-logo-height. A dark logo swaps in by the selectors the colour tokens use, so it
 * follows a visitor's toggle as well as their system; <picture> would follow only the system. */
.site-brand { display: inline-flex; min-width: 0; max-width: 100%; align-items: center; gap: var(--space-sm); vertical-align: middle; }
.site-brand__logo { display: block; width: auto; height: var(--site-logo-height, 2rem); max-width: 100%; object-fit: contain; }
.site-brand__logo--dark { display: none; }
.site-brand__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .site-brand--has-dark .site-brand__logo--light { display: none; }
  :root:not([data-theme='light']) .site-brand--has-dark .site-brand__logo--dark { display: block; }
}
:root[data-theme='dark'] .site-brand--has-dark .site-brand__logo--light { display: none; }
:root[data-theme='dark'] .site-brand--has-dark .site-brand__logo--dark { display: block; }
```

- [ ] **Step 6: Both themes** -- paper: `Header.astro` takes `brand: ThemeBrand`, and the link becomes `<a class="site-wordmark min-w-0 flex-1 truncate text-ink" href={localePath(locale)}><SiteBrand brand={brand} siteName={siteName} /></a>`; `Shell.astro` passes `brand={brand}`; `theme.css` adds `.site-wordmark { --site-logo-height: 2.25rem; }`. plain: `Shell.astro` destructures `brand` and its link becomes `<a class="plain-wordmark" href={localePath(locale)}><SiteBrand brand={brand} siteName={siteName} /></a>`; `theme.css` adds `.plain-wordmark { --site-logo-height: 1.75rem; }`.

- [ ] **Step 7: The layout and the head** -- `BaseLayout.astro`: `import { NO_BRAND, siteBrand } from '../lib/site-brand';` and `import { resolveMediaUrl } from '../server/media/url';`, then `const brand = settings ? siteBrand(settings, resolveMediaUrl) : NO_BRAND;`, `brand={brand}` on `activeTheme.Shell` and `icon={brand.icon}` on `SEOHead`. `SEOHead.astro`: `icon?: BrandIcon | null` in `Props`, `import { iconLinks, type BrandIcon } from '../../lib/site-brand';`, and the fixed favicon line becomes:

```astro
{iconLinks(icon ?? null).map(({ href, rel, sizes, type }) => <link rel={rel} href={href} sizes={sizes} type={type} />)}
```

- [ ] **Step 8: Run** -- the spec, then `npm run check` -- PASS.

- [ ] **Step 9: Mutation checks** -- each restored: remove the `:root[data-theme='dark']` pair (the toggle assertion fails); set `alt` to `''` always (the accessible-name assertion fails); pass `icon={null}` from `BaseLayout` (the icon test fails).

- [ ] **Step 10: Commit** -- the files above: `feat(themes): the header wears the site's logo, and a public page its icon`.

---

### Task 8: The public API says the same

**Files:**
- Modify: `src/types/cms.ts`, `src/server/http/public-schemas.ts`, `src/server/http/serialize.ts`, `src/server/content/published.ts`, `src/pages/api/v1/content/site.ts`
- Test: `tests/unit/public-serialization.test.ts`, `tests/integration/site-brand.test.ts`

**Interfaces:**
- Consumes: `SiteBrand`, `NO_BRAND` (Task 4); `brandOf` (Task 6).
- Produces: `PublicSite.brand: SiteBrand`; `serializePublicSite(row, avatar, brand)`; `getPublishedSite()` result gains `brand`.

- [ ] **Step 1: Write the failing tests** -- in `tests/unit/public-serialization.test.ts`, call `serializePublicSite({...}, media, brand)` with

```ts
const brand = {
  icon: { png180: 'https://media.test/c.png', png32: 'https://media.test/d.png', svg: null },
  logo: { height: 40, mimeType: 'image/svg+xml' as const, url: 'https://media.test/a.svg', width: 120 },
  logoDark: null,
  showSiteName: false,
};
```

and add `brand` to the expected object. In `tests/integration/site-brand.test.ts`, after the first logo is stored:

```ts
  const { getPublishedSite } = await import('../../src/server/content/published');
  assert.equal((await getPublishedSite())?.brand.logo?.url, first.brand.logo?.url, 'the API gives the same logo');
```

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement** -- `src/types/cms.ts`: `import type { SiteBrand } from '../lib/site-brand';` and `brand: SiteBrand;` in `PublicSite`. `public-schemas.ts`:

```ts
const brandUrlSchema = z.url({ protocol: /^https?$/ });
const brandImageSchema = z.object({
  height: z.number().int().positive(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']),
  url: brandUrlSchema,
  width: z.number().int().positive(),
}).strict();

// in publicSiteSchema:
  brand: z.object({
    icon: z.object({ png180: brandUrlSchema, png32: brandUrlSchema, svg: brandUrlSchema.nullable() }).strict().nullable(),
    logo: brandImageSchema.nullable(),
    logoDark: brandImageSchema.nullable(),
    showSiteName: z.boolean(),
  }).strict(),
```

`serialize.ts`: `serializePublicSite(row: SiteSettings, avatar: ReadyMedia | null, brand: SiteBrand)` with `brand` in the parsed object. `published.ts`: `return { avatar, brand: brandOf(settings), lastModified: ..., settings };` (import `brandOf` from `./brand`), and the result type gains `brand: SiteBrand`. `site.ts`: `serializePublicSite(site.settings, site.avatar, site.brand)`.

- [ ] **Step 4: Run** -- unit, `node scripts/test-foundation.mjs tests/integration/site-brand.test.ts`, `node --import tsx --test tests/unit/openapi.test.ts`, `npm run check` -- PASS.

- [ ] **Step 5: Commit** -- `feat(api): the public site says what logo and icon it wears`.

---

### Task 9: The owner sets them

**Files:**
- Create: `src/components/admin/SiteBrandFields.tsx`
- Modify: `src/styles/installer-tokens.css`, `DESIGN.md`, `src/styles/global.css`, `src/lib/admin-i18n.ts`, `src/components/admin/SettingsForm.tsx`, `src/pages/admin/settings.astro`
- Test: `tests/unit/admin-surface-tokens.test.ts`, `tests/e2e/site-brand.spec.ts`

**Interfaces:**
- Consumes: `SiteBrand` (Task 4); `POST|DELETE /api/admin/brand/:kind` (Task 6).
- Produces: `<SiteBrandFields copy initialBrand onChange={(brand: SiteBrand, updatedAt: string) => void} />`.

- [ ] **Step 1: Write the failing tests** -- in `admin-surface-tokens.test.ts`'s control list add `['SiteBrandFields', "pressed(kind, 'upload')"],`. In the e2e spec add a signed-in test (sign-in copied from `editor-blocks.spec.ts`: a CDP virtual authenticator, `issueRecoveryEnrollment(OWNER)`, `/recovery`):

```ts
test('the owner uploads a logo and an icon, and hides the name behind the logo', async ({ context, page }) => {
  test.setTimeout(120_000);
  // ...virtual authenticator and recovery sign-in, as in editor-blocks.spec.ts...
  await page.goto(`${origin}/admin/settings`);
  const logoSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><script>alert(1)</script><rect width="120" height="40" fill="#2e7d5b"/></svg>');
  const hide = page.getByRole('checkbox', { name: 'Hide the site name in the header' });
  await expect(hide, 'nothing to hide the name behind yet').toBeDisabled();

  await page.locator('input[name="brand-logo"]').setInputFiles({ buffer: logoSvg, mimeType: 'image/svg+xml', name: 'logo.svg' });
  await expect(page.locator('.brand-field[data-kind="logo"] [role="status"]')).toHaveText('Saved.');
  await expect(page.locator('.brand-field[data-kind="logo"] .brand-preview img').first()).toBeVisible();
  await expect(hide).toBeEnabled();

  // A file field applied on the spot; the form's own save still goes through afterwards.
  await hide.check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.admin-save-bar [role="status"]')).toHaveText('Saved.');

  await page.goto(`${origin}/en`);
  await expect(page.locator('header .site-brand__name')).toHaveCount(0);
  await expect(page.locator('header img.site-brand__logo--light')).toHaveAttribute('alt', 'Brand Test');

  await page.goto(`${origin}/admin/settings`);
  const tiny = await (await import('sharp')).default({ create: { background: '#fff', channels: 4, height: 64, width: 64 } }).png().toBuffer();
  await page.locator('input[name="brand-icon"]').setInputFiles({ buffer: tiny, mimeType: 'image/png', name: 'icon.png' });
  await expect(page.locator('.brand-field[data-kind="icon"] [role="alert"]')).toHaveText('An icon must be at least 180 × 180 pixels.');
});
```

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: The token and its entry** -- `installer-tokens.css`, after `--color-hero` in `:root`, and not in either dark block:

```css
  /* The light page in either theme, for where the admin shows how something will look on
   * it -- the logo preview. Its partner for the dark page is --color-hero. */
  --color-sample-light: oklch(97.28% 0.0054 95.1);
```

`DESIGN.md`, under Theme-Independent Roles:

```md
- **Light Sample** (`--color-sample-light`): the light page in either theme, where the admin shows how something will look on it — the logo preview. Its partner for the dark page is `--color-hero`.
```

- [ ] **Step 4: Copy** -- `admin-i18n.ts`, a `brand` group after `settings` in both languages, the same keys in the same order:

```ts
  brand: {
    choose: 'Choose a file',
    heading: 'Logo and icon',
    hideName: 'Hide the site name in the header',
    hideNameHint: 'The logo stands in for it. The name stays in the tab, in search results and in the footer.',
    hideNameNeedsLogo: 'Add a logo first. Without one, the header needs the name.',
    hint: 'What a reader sees before anything else: the header, the tab and a phone’s home screen.',
    icon: 'Site icon',
    iconHint: 'Square, SVG or PNG of at least 512 pixels. Used in the browser tab and on a phone’s home screen.',
    iconTooSmall: 'An icon must be at least 180 × 180 pixels.',
    logo: 'Logo',
    logoDark: 'Logo for the dark theme',
    logoDarkHint: 'Optional. Shown in place of the logo when the site is dark.',
    logoHint: 'SVG, or PNG at least 80 pixels tall. Turn text in an SVG into outlines: text is drawn in the reader’s fonts.',
    onDark: 'On the dark theme',
    remove: 'Remove',
    removeFailed: 'The file could not be removed.',
    removed: 'Removed.',
    svgUnusable: 'This SVG could not be drawn once the unsafe parts were removed.',
    tooLarge: 'The file must be 1 MB or smaller.',
    typeRefused: 'Use PNG, JPEG, WebP or SVG. An icon must be PNG or SVG.',
    uploadFailed: 'The file could not be uploaded.',
    uploaded: 'Saved.',
    uploading: 'Uploading…',
  },
```

```ts
  brand: {
    choose: 'เลือกไฟล์',
    heading: 'โลโก้และไอคอน',
    hideName: 'ซ่อนชื่อเว็บในส่วนหัว',
    hideNameHint: 'โลโก้แสดงแทนชื่อ ชื่อเว็บยังอยู่ในแท็บเบราว์เซอร์ ผลค้นหา และท้ายเว็บ',
    hideNameNeedsLogo: 'ใส่โลโก้ก่อน ถ้าไม่มีโลโก้ ส่วนหัวต้องแสดงชื่อเว็บ',
    hint: 'สิ่งที่ผู้อ่านเห็นก่อนอย่างอื่น: ส่วนหัว แท็บเบราว์เซอร์ และหน้าจอหลักของโทรศัพท์',
    icon: 'ไอคอนเว็บ',
    iconHint: 'สี่เหลี่ยมจัตุรัส เป็น SVG หรือ PNG ขนาดอย่างน้อย 512 พิกเซล ใช้ในแท็บเบราว์เซอร์และบนหน้าจอหลักของโทรศัพท์',
    iconTooSmall: 'ไอคอนต้องมีขนาดอย่างน้อย 180 × 180 พิกเซล',
    logo: 'โลโก้',
    logoDark: 'โลโก้สำหรับโหมดมืด',
    logoDarkHint: 'ไม่บังคับ ใช้แทนโลโก้หลักเมื่อเว็บอยู่ในโหมดมืด',
    logoHint: 'ใช้ SVG หรือ PNG ที่สูงอย่างน้อย 80 พิกเซล ถ้า SVG มีตัวอักษร ให้แปลงเป็นเส้นก่อน เพราะตัวอักษรจะถูกวาดด้วยฟอนต์ในเครื่องของผู้อ่าน',
    onDark: 'บนโหมดมืด',
    remove: 'ลบ',
    removeFailed: 'ลบไฟล์ไม่สำเร็จ',
    removed: 'ลบแล้ว',
    svgUnusable: 'ไฟล์ SVG นี้ใช้ไม่ได้หลังตัดส่วนที่ไม่ปลอดภัยออก',
    tooLarge: 'ไฟล์ต้องมีขนาดไม่เกิน 1 MB',
    typeRefused: 'ใช้ไฟล์ PNG, JPEG, WebP หรือ SVG ส่วนไอคอนต้องเป็น PNG หรือ SVG',
    uploadFailed: 'อัปโหลดไฟล์ไม่สำเร็จ',
    uploaded: 'บันทึกแล้ว',
    uploading: 'กำลังอัปโหลด…',
  },
```

- [ ] **Step 5: The fields** -- `src/components/admin/SiteBrandFields.tsx`:

```tsx
import { useRef, useState, type ChangeEvent } from 'react';

import type { AdminCopy } from '../../lib/admin-i18n';
import type { SiteBrand } from '../../lib/site-brand';
import Icon from '../Icon';

type Kind = 'icon' | 'logo' | 'logo-dark';
type Action = 'remove' | 'upload';

interface SiteBrandFieldsProps {
  copy: AdminCopy;
  initialBrand: SiteBrand;
  /** A file applies on the spot; the form is handed the brand and the row's new version. */
  onChange: (brand: SiteBrand, updatedAt: string) => void;
}

const ACCEPT: Record<Kind, string> = {
  icon: 'image/png,image/svg+xml',
  logo: 'image/png,image/jpeg,image/webp,image/svg+xml',
  'logo-dark': 'image/png,image/jpeg,image/webp,image/svg+xml',
};
const REFUSALS: Record<string, keyof AdminCopy['brand']> = {
  brand_icon_small: 'iconTooSmall',
  brand_svg_unusable: 'svgUnusable',
  brand_too_large: 'tooLarge',
  brand_type: 'typeRefused',
};

/**
 * The site's logo, its dark logo and its icon: each chosen, previewed where it will be seen,
 * and removed. Each applies on its own request, so there is nothing here for Save to lose.
 */
export default function SiteBrandFields({ copy, initialBrand, onChange }: SiteBrandFieldsProps) {
  const [brand, setBrand] = useState(initialBrand);
  const [busy, setBusy] = useState<{ action: Action; kind: Kind } | null>(null);
  const [message, setMessage] = useState<{ failed: boolean; kind: Kind; text: string } | null>(null);
  const inputs = { icon: useRef<HTMLInputElement>(null), logo: useRef<HTMLInputElement>(null), 'logo-dark': useRef<HTMLInputElement>(null) };
  const pressed = (kind: Kind, action: Action) => busy?.kind === kind && busy.action === action;

  const send = async (kind: Kind, action: Action, file?: File) => {
    if (busy) return;
    setBusy({ action, kind });
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/brand/${kind}`, action === 'upload'
        ? { body: file, headers: { 'content-type': file?.type || 'application/octet-stream' }, method: 'POST' }
        : { method: 'DELETE' });
      const result = await response.json().catch(() => ({})) as { brand?: SiteBrand; code?: string; updatedAt?: string };
      if (!response.ok || !result.brand || !result.updatedAt) {
        const refusal = result.code ? REFUSALS[result.code] : undefined;
        throw new Error(refusal ? copy.brand[refusal] : action === 'upload' ? copy.brand.uploadFailed : copy.brand.removeFailed);
      }
      setBrand(result.brand);
      onChange(result.brand, result.updatedAt);
      setMessage({ failed: false, kind, text: action === 'upload' ? copy.brand.uploaded : copy.brand.removed });
    } catch (failure) {
      setMessage({ failed: true, kind, text: failure instanceof Error ? failure.message : copy.brand.uploadFailed });
    } finally {
      setBusy(null);
    }
  };

  const chosen = (kind: Kind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void send(kind, 'upload', file);
  };

  const field = (kind: Kind, label: string, hint: string, present: boolean, preview: React.ReactNode) => (
    <div className="brand-field" data-kind={kind} key={kind}>
      <div className="brand-field__label"><strong>{label}</strong><small>{hint}</small></div>
      {present && <div className="brand-field__previews">{preview}</div>}
      <div className="brand-field__actions">
        <input accept={ACCEPT[kind]} aria-label={label} hidden name={`brand-${kind}`} onChange={chosen(kind)} ref={inputs[kind]} type="file" />
        <button aria-busy={pressed(kind, 'upload')} className="admin-button admin-button--secondary" disabled={busy !== null} onClick={() => inputs[kind].current?.click()} type="button">
          {pressed(kind, 'upload') ? copy.brand.uploading : copy.brand.choose}
        </button>
        {present && (
          <button aria-busy={pressed(kind, 'remove')} className="admin-button admin-button--ghost" disabled={busy !== null} onClick={() => void send(kind, 'remove')} type="button">
            <Icon name="trash" /> {copy.brand.remove}
          </button>
        )}
      </div>
      {message?.kind === kind && <p className={message.failed ? 'admin-field-error' : 'brand-field__status'} role={message.failed ? 'alert' : 'status'}>{message.text}</p>}
    </div>
  );

  return (
    <div className="brand-fields">
      {field('logo', copy.brand.logo, copy.brand.logoHint, Boolean(brand.logo), brand.logo && <>
        <figure className="brand-preview brand-preview--light"><img alt="" src={brand.logo.url} /></figure>
        {/* Without a dark logo this one is used on the dark theme too, so it is shown there. */}
        {!brand.logoDark && <figure className="brand-preview brand-preview--dark"><img alt="" src={brand.logo.url} /><figcaption>{copy.brand.onDark}</figcaption></figure>}
      </>)}
      {field('logo-dark', copy.brand.logoDark, copy.brand.logoDarkHint, Boolean(brand.logoDark), brand.logoDark &&
        <figure className="brand-preview brand-preview--dark"><img alt="" src={brand.logoDark.url} /></figure>)}
      {field('icon', copy.brand.icon, copy.brand.iconHint, Boolean(brand.icon), brand.icon &&
        <figure className="brand-preview brand-preview--light brand-preview--icon">
          <img alt="" height={32} src={brand.icon.png32} width={32} />
          <img alt="" height={90} src={brand.icon.png180} width={90} />
        </figure>)}
    </div>
  );
}
```

- [ ] **Step 6: The form** -- `SettingsForm.tsx`: props gain `initialBrand: SiteBrand`; state `const [hasLogo, setHasLogo] = useState(Boolean(initialBrand.logo));` and `const [hideSiteName, setHideSiteName] = useState(initialSettings.hide_site_name);`; `hideSiteName` joins both snapshots; and a card between identity and regional:

```tsx
          <section className="admin-card" aria-labelledby="settings-brand-heading">
            <header className="admin-card__head">
              <h2 id="settings-brand-heading">{copy.brand.heading}</h2>
              <p>{copy.brand.hint}</p>
            </header>
            <SiteBrandFields copy={copy} initialBrand={initialBrand} onChange={(brand, next) => { setHasLogo(Boolean(brand.logo)); setUpdatedAt(next); }} />
            <div className="admin-check">
              <label>
                <input aria-describedby="hideSiteName-help" checked={hasLogo && hideSiteName} disabled={!hasLogo} name="hideSiteName" onChange={(event) => { setHideSiteName(event.target.checked); setStatus(''); }} type="checkbox" />
                <span>{copy.brand.hideName}</span>
              </label>
              <small id="hideSiteName-help">{hasLogo ? copy.brand.hideNameHint : copy.brand.hideNameNeedsLogo}</small>
            </div>
          </section>
```

`settings.astro`: `import { siteBrand } from '../../lib/site-brand';`, `import { resolveMediaUrl } from '../../server/media/url';`, and `initialBrand={siteBrand(settings, resolveMediaUrl)}` on `SettingsForm`.

- [ ] **Step 7: Its styles** -- `global.css`, with the admin's other field rules:

```css
.brand-fields { display: grid; gap: var(--space-lg); }
.brand-field { display: grid; gap: var(--space-xs); }
.brand-field__label { display: grid; gap: var(--space-3xs); }
.brand-field__label small, .brand-field__status { color: var(--color-muted); font-size: var(--text-sm); }
.brand-field__previews, .brand-field__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
.brand-preview { display: grid; min-width: 10rem; min-height: 4.5rem; place-items: center; gap: var(--space-2xs); margin: 0; padding: var(--space-sm) var(--space-md); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-card); }
.brand-preview img { max-width: 14rem; max-height: 3rem; object-fit: contain; }
.brand-preview--light { background: var(--color-sample-light); }
.brand-preview--dark { background: var(--color-hero); }
.brand-preview--dark figcaption { color: var(--color-on-dark-muted); font-size: var(--text-xs); }
.brand-preview--icon { grid-auto-flow: column; }
.brand-preview--icon img { max-height: none; }
```

- [ ] **Step 8: Run** -- `node --import tsx --test tests/unit/admin-surface-tokens.test.ts tests/unit/admin-i18n.test.ts`, the e2e spec, `npm run check` -- PASS. Screenshot the Settings card at 1440 and 375 in both admin themes and look at them.

- [ ] **Step 9: Mutation checks** -- each restored: `aria-busy={busy !== null}` on the choose button (the surface test fails); drop `setUpdatedAt(next)` (Save after an upload answers 409 -- the e2e "Saved." fails); `disabled={false}` on the switch (the disabled assertion fails).

- [ ] **Step 10: Commit** -- `feat(admin): the owner sets the site's logo, dark logo and icon, and hides the name behind the logo`.

---

### Task 10: The owner is told

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** In "What is included", after the Themes line: `- A logo (SVG included) with an optional logo for the dark theme, and the site's own icon, under Settings`.
- [ ] **Step 2:** Run the whole of it once: `npm run test:unit`, `node scripts/test-foundation.mjs --all`, `npm run test:e2e`, `npm run check`.
- [ ] **Step 3: Commit** -- `README.md`: `docs: a site's own logo and icon`.

The release notes are written when the version is next bumped: they tell theme authors about `ThemeShellProps.brand` and `<SiteBrand>`, and headless sites about `brand` in `GET /api/v1/content/site`.
