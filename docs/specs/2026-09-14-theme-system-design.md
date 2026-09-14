# Theme System — Design Note

> **Status: not scheduled.** A note for a future release. Nothing here is built.
> Read "The name is already taken" first — it is the cheapest mistake to avoid and the
> most expensive to undo.

**Goal:** Let an owner change how their public site looks without editing the source.

Related notes: [plugin system](2026-09-14-plugin-system-design.md) ·
[e-commerce plugin](2026-09-14-ecommerce-plugin-design.md)

---

## The name is already taken

`site_settings.theme` exists and means **light / dark / system**. It is read by
`BaseLayout.astro` into the `data-theme` attribute, written by the settings form,
validated by `siteSettingsMutationSchema`, and pinned by the contrast tests. Its
companion `site_settings.allow_visitor_theme` decides whether visitors get a control of
their own.

A visual-theme feature must **not** reuse that column, that word in the settings UI, or
that word in the admin copy. Two meanings of "theme" one line apart in the same form is
a support burden forever.

Candidate names that stay clear of it: **appearance**, **skin**, **preset**, **look**.
"Appearance" reads best in both languages and does not collide with the light/dark
control, which is genuinely about *theme* in the CSS sense.

---

## What a theme could be, in increasing order of ambition

### 1. A palette (tokens only)

Swap the values in `installer-tokens.css` for another measured set. Structure, layout
and components stay exactly as they are.

- **Reaches:** a different feel, quickly. The current repaint from teal-and-mint to
  paper-and-tomato was one file of values plus nine declarations, which is the evidence
  that this tier works.
- **The hard part is not the swap, it is the proof.** Every palette has to clear
  `tests/unit/theme-contrast.test.ts` in both light and dark, and the pairs are pinned
  to how each colour is *used* — an accent that fills is checked against its label, a
  link is checked against every surface it can land on. A theme that ships without that
  computation is a theme that ships unreadable text somewhere nobody looked.
- **So a palette is not free-form.** Either themes are first-party and measured, or the
  product needs a contrast validator an owner can run against their own palette and be
  refused by.

### 2. A palette plus type

Add the display and body faces. Fonts are self-hosted (`scripts/sync-fonts.mjs` copies
woff2 subsets into `public/fonts/` and generates `public/fonts.css`), so a theme that
changes the typeface changes what has to be shipped and preloaded — it is a build-time
concern, not a settings value.

### 3. Palette, type and layout

Different section rhythm, different header, different post template. This stops being a
theme and becomes a **template set**, which means Astro components, which means the
build. See constraint 1 in the [plugin note](2026-09-14-plugin-system-design.md): server
code cannot be added to a running installation, because an update replaces the image.

---

## Where each tier can live

| Tier | Storage | Installable at runtime |
|---|---|---|
| Palette | a settings value naming a first-party preset, or a row of measured OKLCH values | yes |
| Palette + type | needs the fonts in the image | no, without a font-fetch story |
| Templates | Astro components, compiled | no — rebuild |

**Tier 1 is the one that fits the product as it stands.** It is also, honestly, most of
what an owner means when they ask to change the look.

---

## What would have to be decided

| Question | Why it matters |
|---|---|
| First-party presets, or owner-authored palettes? | Presets can be measured once and pinned by the existing test. Owner-authored palettes need a validator that refuses bad contrast at save time, which is a feature of its own. |
| Does a preset carry both light and dark? | The current system has three states and two full palettes. A preset supplying only light would have to derive dark or disable the control, and deriving dark by formula is how the light-on-light code block happened the first time. |
| Does the admin follow the site preset? | The admin is a working tool with its own density and its own light/dark control. Letting a site preset repaint it is probably wrong. |
| Is a preset a plugin, or core? | If themes stay tier 1, core is simpler. Reaching tier 3 makes them plugins by definition. |

---

## What not to change

- **The token indirection.** Every colour in the app resolves through
  `installer-tokens.css`; nothing hardcodes a hex. That is what made the last repaint a
  one-file change, and it is the precondition for this feature existing at all.
- **The contrast test's shape.** Its pairs encode *usage*, not a generic grid — that is
  what caught an accent being used as text. A theme feature should extend it, never
  loosen it.
- **`DESIGN.md` as the document that follows the CSS.** `scripts/check-design-tokens.mjs`
  already enforces that for radii and spacing; a theme feature is the moment to extend
  that check to colour rather than let the document drift.
