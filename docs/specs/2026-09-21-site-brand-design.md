# The Site's Own Logo, Name And Icon

Date: 2026-09-21
Status: Awaiting owner review

## What the owner asked for

Three settings a site has and TomeCMS does not:

- a logo in the header, SVG included;
- the site's name taken out of the header;
- the site's own icon in a browser tab, in place of TomeCMS's.

Today the header of both themes is a text link made of `siteName`
(`src/themes/paper/parts/Header.astro`, `src/themes/plain/Shell.astro`), and every page -- the
public site, the admin and the installer -- links the same `/favicon.svg`.

## What was decided before this was written

| Question | Answer |
|---|---|
| Where SVG is accepted | For the logos and the icon only. The media library keeps its five raster types and the constraints that hold it to them. |
| What "take the name out" means | The header only, and only while there is a logo. The name stays in the tab title, search results, shared links, the footer and the feed, and becomes the logo's text alternative. |
| Where the icon applies | The public site. The admin and the installer keep TomeCMS's, so the owner can tell the admin's tab from the site's. |
| A logo for the dark scheme | An optional second logo. Without one, the first is used in both. |
| How the files are kept | Their own upload, through the server -- not the media library (approach A of the three offered). |

The reasons for the last one are the reasons for the first: an SVG can carry script, and the
media library is reached from covers, the editor, `og:image` and the public API. SVG in the
library would have to be kept out of every one of those, and `og:image` cannot be an SVG at
all. A path of its own keeps the SVG in the one place it is checked.

## Storage

Migration `020_site_brand` adds to `site_settings`:

- `brand_logo jsonb`, `brand_logo_dark jsonb` -- null, or `{ key, mime, width, height }`;
- `brand_icon jsonb` -- null, or `{ svgKey, png32Key, png180Key }`, `svgKey` null when the icon
  was not an SVG;
- `hide_site_name boolean not null default false`.

Each jsonb column carries a check that it is null or an object, and is parsed with zod where it
is read, as the other jsonb columns are. The media tables, and their mime type checks, are not
touched.

The files live in the media bucket under the library's own key grammar,
`owners/<owner>/<yyyy>/<mm>/<uuid>.<ext>`, with a fresh UUID for every upload -- so a changed
logo is a new address and is never served from a cache as the old one. Backup, restore-check
and reset refuse any object whose key falls outside that grammar, which is why a brand file
does not get a prefix of its own; `svg` joins the grammar's extensions, for these files alone.
The reset's inventory of objects counts the keys on `site_settings`, or a bucket with a logo in
it would read as holding something TomeCMS does not track. Public addresses come from
`src/server/media/url.ts`, as the media library's do.

## Upload

`POST /api/admin/brand/logo`, `/logo-dark` and `/icon` take one file; `DELETE` on the same path
removes it. Only the installed owner, and only from the site's own origin, as every admin
endpoint.

| | Accepted | Limits |
|---|---|---|
| Logo, dark logo | PNG, JPEG, WebP, SVG | 1 MB |
| Icon | PNG, SVG | 1 MB; a raster icon at least 180 × 180 |

- **The type is read from the bytes**, by `sharp`, not taken from the file name or from what the
  browser declared. A PNG named `.svg` is a PNG.
- **A raster logo is stored as it came** -- not resized and not re-encoded. Its size is the
  owner's to choose, and the header draws it at the height its theme sets.
- **An SVG is sanitized before it is stored** (next section), and `sharp` must still be able to
  draw what is left. If it cannot, the upload is refused with that reason; a broken logo is not
  stored.
- **The icon is drawn twice by `sharp`**: 32 × 32 for a tab, 180 × 180 for a phone's home screen,
  which accepts nothing but PNG. A source that is not square is centred on a transparent square
  rather than stretched. An SVG icon is also kept as it is, for browsers that take one.
- **An upload applies at once.** The setting is written in the request that stored the file,
  not by the form's Save button. The order is: check, store the new objects, write the setting,
  then delete the objects it replaced. If the write fails, the new objects are deleted; if a
  deletion of old ones fails, that is logged and left -- an orphan is harmless, a setting that
  points at nothing is not.
- **The write moves `updated_at`**, as every write to that row does: the public site's
  `Last-Modified` is read from it, and a cache must not keep the old logo. The new version goes
  back to the Settings form, whose next save would otherwise be refused as stale.

`hide_site_name` is not a file: it travels with the settings record like `show_powered_by`, and
both forms that write that record whole -- `SettingsForm` and `ThemeForm` -- carry it.

## What an SVG may keep

Sanitized with `sanitize-html`, which the editor already uses (`src/lib/editor-content.ts`),
as an allowlist in XML mode with tag and attribute names kept in their case -- `viewBox`,
`linearGradient` and `clipPath` are not their lowercase selves. Everything not on the list is
dropped:

- **Kept:** `svg`, `g`, `defs`, `symbol`, `use`, `title`, `desc`, the shapes (`path`, `rect`,
  `circle`, `ellipse`, `line`, `polyline`, `polygon`), `text` and `tspan`, `linearGradient`,
  `radialGradient`, `stop`, `clipPath`, `mask`, and `style`; presentation attributes, geometry,
  `transform`, `id`, `class`, and the namespace declarations.
- **Dropped:** `script`, `foreignObject`, `image`, `a`, animation elements, every `on*`
  attribute, and anything else not named above.
- **References stay inside the file.** `href` and `xlink:href` are kept only when they begin with
  `#`. In CSS, `@import` and any `url()` that does not begin with `#` are removed.

The site shows every one of these files through `<img>`, where a browser runs no script and
loads nothing from outside. The sanitizing is for the other way to reach one: a visitor opening
the file's own address, where it is a document. TomeCMS does not set the headers the media
origin sends, so there it is the only guard, and it is said here so that nobody later counts on
a second one.

## What a reader sees

`ThemeShellProps` gains one field, beside `siteName`, which stays:

```ts
interface BrandImage { url: string; width: number; height: number }

brand: {
  logo: BrandImage | null;
  logoDark: BrandImage | null;
  /** False only when there is a logo and the owner chose to hide the name. */
  showSiteName: boolean;
}
```

The rule for `showSiteName` is the core's, applied in `BaseLayout` before a theme is called, so
no theme can apply it differently. Removing the logo brings the name back even while the switch
is still on.

A core component, `SiteBrand.astro`, draws what goes inside the home link; both themes put it
inside their own link and size it in their own stylesheet:

- the logo, with the stored `width` and `height`, so the header does not move as it loads;
- beside it the name, when it is shown -- and then the logo's `alt` is empty, because the name
  already says what the link is;
- when the name is hidden, the logo's `alt` is the site's name, so the link still has one.

With a dark logo, both images are drawn and one is hidden by CSS, using the two selectors the
colour tokens use (`src/styles/installer-tokens.css`): the system's dark preference unless the
visitor chose light, and `:root[data-theme='dark']`. That follows the visitor's toggle as well as
their system; `<picture>` with a media query would follow only the system. The cost is that both
files are downloaded, and logos are small.

On public pages, with an icon set, `SEOHead` links the 32-pixel PNG with `sizes="32x32"`, the SVG
with `type="image/svg+xml"` when there is one, and the 180-pixel PNG as `apple-touch-icon`.
Without one it links `/favicon.svg`, as now. `AdminLayout` and `install.astro` keep
`/favicon.svg` either way.

## The admin

Settings gains a section, "Logo and icon", after the site's identity:

- three file fields -- logo, dark logo, icon -- each with a preview, a choose button and a remove
  button. The logo is previewed on the light surface and the dark logo on the dark one, so the
  owner sees whether each can be read where it will be -- in either admin theme, on
  `--color-sample-light` and `--color-hero`, two roles that do not flip with it. Without a dark
  logo, the logo is shown on the dark surface too, because that is where it will be used. The icon is previewed at tab size and at
  home-screen size.
- the pressed button is the one that says it is working, by `aria-busy`, as everywhere since the
  Update fix; the others are disabled while it does.
- a refusal is shown in the owner's language, and says which rule the file broke: its type, its
  size, an icon too small, or an SVG that could not be drawn once made safe.
- hints for the owner: an SVG, or a PNG at least 80 pixels tall so it stays sharp on a dense
  screen; a square icon, SVG or at least 512 pixels; and text in an SVG logo turned into
  outlines, because text is drawn with whatever fonts the reader has.
- "Hide the site name in the header" is a switch that is disabled without a logo, and says why
  beneath it. It is saved with the form.

## The public API

`GET /api/v1/content/site` gains `brand`: `logo` and `logoDark` as `{ url, width, height,
mimeType }` or null, `icon` as `{ png32, png180, svg }` or null, and `showSiteName`. A site that
uses TomeCMS headless gets the same logo its bundled theme would draw. The OpenAPI document
(`src/server/http/openapi.ts`) describes it. Nothing is removed from the response.

## Verification

- **Unit.** The sanitizer: `script`, `foreignObject`, `on*`, an outside `href`, `javascript:` and
  an outside `url()` are gone; paths, gradients and `#` references survive; case-sensitive names
  keep their case; what is left can still be drawn. Type detection from bytes, a PNG named `.svg`
  among them. The `showSiteName` rule. The icon's links, with and without an SVG.
- **Integration**, on the disposable database and SeaweedFS. Each kind is stored under a hashed
  key with the right Content-Type and written to the setting. A replacement deletes the objects
  it replaced; a removal clears the setting and its objects. A refused file leaves nothing in the
  bucket. An SVG uploaded with a script is stored without it.
- **Browser.** A logo uploaded on Settings is in the public header. With the name hidden, the
  home link still has an accessible name. Toggling the scheme swaps the logos, measured by the
  rendered `display`, not by the markup. The public head links the new icon and the admin's links
  TomeCMS's.
- Each guard is checked by putting back the bug it guards against, as with everything since
  0.4.0.
- The migration tripwire in `tests/unit/db-migrator.test.ts` moves to `020_site_brand`.

## Not in this design

- choosing a logo from the media library;
- icons for installing the site as an app (a web app manifest);
- a logo per language;
- the site's logo in the admin's own header.

Each is a small addition to what this builds, if it is ever asked for.

## Risks

- `sanitize-html` is an HTML sanitizer used here for SVG. Its behaviour in XML mode -- case, self-
  closing tags, namespaces -- is pinned by the unit tests rather than assumed.
- A logo that relied on something dropped -- an embedded bitmap, an external font, an animation --
  changes when sanitized. The preview shows the owner what will be used before anyone else sees it.
- The contract of every theme changes. Both themes ship in this repository and are changed in the
  same commit; the release notes tell theme authors, as they did for `themeSettings`.
