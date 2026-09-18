---
version: alpha
name: "TomeCMS Paper 2026"
description: "TomeCMS uses warm paper, near-black ink, and a restrained green (#2E7D5B) that carries the turning-page mark, actions, links, focus, and positive state. A lighter green (#69B98E) keeps the same identity legible in dark mode."
colors:
  paper: "#f7f6f2"
  surface: "#ffffff"
  soft: "#ebebe5"
  line: "#d9dcd3"
  ink: "#101317"
  muted: "#61665f"
  night: "#181d19"
  dim: "#acb3a8"
  brand-green: "#2e7d5b"
  brand-green-deep: "#256b4e"
  brand-green-light: "#69b98e"
  brand-green-soft: "#b9d8c8"
typography:
  display-hero:
    fontFamily: "Google Sans"
    fontSize: "64px"
    fontWeight: "700"
    lineHeight: "76.8px"
    letterSpacing: "-1.875px"
  display-large:
    fontFamily: "Google Sans"
    fontSize: "54px"
    fontWeight: "700"
    lineHeight: "64.8px"
    letterSpacing: "-1.875px"
  heading-xl:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "48px"
    fontWeight: "400"
    lineHeight: "72px"
  heading-l:
    fontFamily: "Google Sans"
    fontSize: "40px"
    fontWeight: "400"
    lineHeight: "60px"
  heading-m:
    fontFamily: "Google Sans"
    fontSize: "22px"
    fontWeight: "700"
    lineHeight: "28px"
    letterSpacing: "-0.25px"
  heading-s:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "20px"
    fontWeight: "600"
    lineHeight: "28px"
    letterSpacing: "-0.125px"
  body-regular:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "16px"
    fontWeight: "400"
    lineHeight: "24px"
  body-large:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "20px"
    fontWeight: "400"
    lineHeight: "30px"
  label-medium:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "14px"
    fontWeight: "500"
    lineHeight: "20px"
  label-small:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "12px"
    fontWeight: "500"
    lineHeight: "16px"
    letterSpacing: "0.125px"
  nav-link:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "16px"
    fontWeight: "500"
    lineHeight: "24px"
rounded:
  radius-sm: "0.375rem"
  radius-input: "0.5rem"
  radius-card: "0.5rem"
  radius-lg: "1rem"
  radius-pill: "9999px"
spacing:
  space-3xs: "0.125rem"
  space-2xs: "0.25rem"
  space-xs: "0.5rem"
  space-sm: "0.75rem"
  space-md: "1rem"
  space-lg: "1.5rem"
  space-xl: "2.5rem"
  space-2xl: "4rem"
  space-3xl: "5rem"
---

## Overview

TomeCMS pairs warm paper and near-black ink with a single restrained green family.
The master #2E7D5B carries the turning-page mark and primary actions; deeper and lighter
variants keep text, focus and dark-mode applications accessible. The existing IBM Plex
Sans Thai hierarchy, 12-column grid with 28px gutters, dual-radius language, and
progressive shadow system remain the structural foundation.

**Source of truth:** `src/styles/installer-tokens.css` owns every colour, spacing, radius and
type token. This document and `tailwind.config.mjs` follow it — they never declare a competing
value. `npm run check` runs `scripts/check-design-tokens.mjs`, which fails the build if they drift.

**Signature traits:**
- Single-family weight hierarchy: Builds hierarchy from IBM Plex Sans Thai across 4 weights rather than multiple families.
- Soft, rounded geometry: Generous corner rounding up to 9999px.

## Colors

Paper and ink, warmed, with one green accent family. The greys carry a faint green so the
page reads editorial rather than clinical; positive state uses the same hue and remains
understandable through its icon or label. `src/styles/installer-tokens.css` owns every
value below.

### The palette

| Hex | Token | Role |
|-----|-------|------|
| #F7F6F2 | `--color-paper-2` | the page |
| #FFFFFF | `--color-paper`, `--color-surface` | panels raised off it: cards, sidebar, inputs, dialogs |
| #EBEBE5 | `--color-paper-3` | recessed and hover surfaces |
| #D9DCD3 | `--color-rule` | hairline dividers and borders |
| #101317 | `--color-ink` | body text and headings |
| #61665F | `--color-muted` | secondary text |
| #181D19 | `--color-hero`, `--color-code-bg` | surfaces that are dark on purpose |
| #ACB3A8 | `--color-on-dark-muted` | secondary text on those |
| #2E7D5B | `--color-accent`, `--color-green` | master green: the fold in the logo and the favicon, primary actions and positive state |
| #256B4E | `--color-accent-hover`, `--color-link`, `--color-focus` | deep green: hover, links, icons and focus rings |
| #B9D8C8 | `--color-focus-soft` | selection and soft focus washes |
| #69B98E | dark-mode accent, link, focus and positive state | light green that remains readable on night |

Note the token names: `--color-paper` is the **panel**, not the page. The page is
`--color-paper-2`. That is how the stylesheets already used them, and renaming across
every component to fix the numbering would be a larger change than it is worth.

### Why the accent and the link use two green values

They are one green family in two jobs. Master green #2E7D5B measures **4.62** on the
cream page and white on it measures **5.00**, so it works as both a meaningful mark and
a button fill with a white label. On the soft surface its text contrast falls to **4.18**,
so links and small readable marks use the deeper #256B4E, which measures **5.33** there.

Positive state reuses the master hue rather than introducing a nearly identical second
green. State must also have an icon or label; colour is reinforcement, not the only cue.
`tests/unit/theme-contrast.test.ts` pins each value to the surfaces where it is used.

Errors sit at hue 20, clear of the green family near hue 162, so danger cannot be
mistaken for brand.

### Theme-Independent Roles

These carry meaning rather than a fixed lightness, so they stay correct when the
theme flips. Reach for them instead of `--color-surface` or a literal colour whenever
the surface is dark *on purpose*.

- **On Dark** (`--color-on-dark`): text on a surface that is dark in either theme — the hero panel, a code block, a danger fill.
- **On Dark Muted** (`--color-on-dark-muted`): secondary text on those same surfaces.
- **Code Background** (`--color-code-bg`): the code-block surface. Keyed separately from `--color-ink` because that token inverts with the theme.
- **Scrim** (`--color-scrim`): the wash behind a modal. Always dark, in both themes.

### Dark Theme

Three states. With no attribute the theme follows `prefers-color-scheme`;
`data-theme="light"` and `data-theme="dark"` on the root element override the system
setting in either direction. The installer pins itself to light.

Night is the page, white is the text, dim is everything secondary. The green family
lifts to #69B98E so small marks, links and filled controls remain readable; their label
switches back to ink. The reverse logo uses the same light-green expression.

The dark palette is declared twice — once inside the media query, once for the explicit
attribute — because the two contexts cannot share a rule. `light-dark()` would collapse
them but needs a newer baseline than the `color-mix()` already in use here, and fails
hard rather than degrading. `tests/unit/theme-contrast.test.ts` keeps the two copies
identical and computes 34 pinned pairs in both themes. Tightest measured: **4.62** light
and **5.36** dark among the text pairs, **3.63** and **3.16** among the borders and
rings. It also rejects a literal `bg-white` anywhere in `src/`.

## Typography

Typography uses two families. Google Sans carries the display roles -- the post title the writer types and the reader gets, the hero, and the card and section headings -- and IBM Plex Sans Thai carries the interface and the running text. A headline set in the interface face at 54px read as an app header rather than as a headline, so the pair is the point. Keep hierarchy mapped to these token rows before adding decorative type styles.

The display headlines lead at 1.2. Thai stacks marks above and below the letter, and a Latin headline's 1.0 to 1.04 brought a wrapped title's two lines into each other wherever a descender on the first met a tone mark on the second. Weight range spans bold, regular, semi-bold, medium. Sizes range from 12px to 64px.

### Type Scale Evidence
| Role | Font | Size | Weight | Line Height | Letter Spacing | Stack / Features | Notes |
|------|------|------|--------|-------------|----------------|------------------|-------|
| Hero headline (probe-confirmed h1 at 64px; CSSOM shows 54px w700 / 56px ls:-1.875px as closest match) | Google Sans | 64px | 700 | 76.8px | -1.875px | Google Sans, IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif | Extracted token |
| Section hero headings, large marketing titles | Google Sans | 54px | 700 | 64.8px | -1.875px | Google Sans, IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif | Extracted token |
| Large section headings | IBM Plex Sans Thai | 48px | 400 | 72px | normal | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Mid-page section headings | Google Sans | 40px | 400 | 60px | normal | Google Sans, IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif | Extracted token |
| Card titles, feature headings | Google Sans | 22px | 700 | 28px | -0.25px | Google Sans, IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif | Extracted token |
| Sub-section headings, callout titles | IBM Plex Sans Thai | 20px | 600 | 28px | -0.125px | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Primary body text, paragraph content (highest frequency: 443 hits) | IBM Plex Sans Thai | 16px | 400 | 24px | normal | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Hero subheadline, lead paragraph text | IBM Plex Sans Thai | 20px | 400 | 30px | normal | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Navigation labels, button text, UI labels (90 hits) | IBM Plex Sans Thai | 14px | 500 | 20px | normal | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Badges, tags, small metadata labels | IBM Plex Sans Thai | 12px | 500 | 16px | 0.125px | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Global navigation links (probe-confirmed: 16px w500) | IBM Plex Sans Thai | 16px | 500 | 24px | normal | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |

## Layout

Responsive system uses 4 breakpoint tier(s): mobile, tablet, desktop, wide.

This system uses a 4px base grid with scale values 2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 20, 24, 28, 32, 40, 48, 60, 64, 80.

### Responsive Strategy
- **mobile (375-919px)**: Constrain layout for small viewports and prioritize vertical stacking.
- **tablet (>= 712px)**: Increase spacing and column structure for medium-width viewports.
- **desktop (>= 1032px)**: Expand layout density and horizontal composition for wide viewports.
- **wide (>= 1440px)**: Stretch composition with generous gutters and wider layout spans.

### Spacing System
| Token | Value | Px | Role |
|------|-------|----|-------|
| space-3xs | 0.125rem | 2 | Hairline offsets, focus-ring offset |
| space-2xs | 0.25rem | 4 | Label-to-field gap, tight stacks |
| space-xs | 0.5rem | 8 | Inline gaps inside a control |
| space-sm | 0.75rem | 12 | Control padding, list-row gaps |
| space-md | 1rem | 16 | Default gap, page gutter floor |
| space-lg | 1.5rem | 24 | Card padding, section internals |
| space-xl | 2.5rem | 40 | Block separation, page gutter ceiling |
| space-2xl | 4rem | 64 | Page top padding, major breaks |
| space-3xl | 5rem | 80 | Page bottom padding |

## Elevation & Depth

Keep depth flat unless validated shadow or interaction evidence appears in the extraction payload. Do not invent shadows beyond this evidence boundary.

### Shadow Evidence
| Shadow Token | Layers | Details |
|--------------|--------|---------|
| n/a | 0 | No validated shadow payload |

### Interaction Signals
| Theme | Signal | Evidence |
|-------|--------|----------|
| Light | backdrop-filter | blur(12px) |
| Light | outline-style | solid |
| Light | outline-color | rgba(0, 0, 0, 0.898) ; rgba(255, 255, 255, 0) ; oklch(0.2928 0.0018 106.84) |
| Light | outline-width | 3px ; 2px |
| Light | outline-offset | 0px ; 2px |
| Light | transform | matrix(1, 0, 0, 1, 0, 0) ; matrix(1, 0, 0, 1, 0, -16) ; matrix(0.965926, -0.258819, 0.258819, 0.965926, 0, 0) |

## Shapes

Shape language maps directly to rounded tokens. Keep component corners consistent with the role mapping below before introducing bespoke geometry.

### Radius Roles

| Token | Value | Px | Role Mapping |
|------|-------|----|--------------|
| radius-sm | 0.375rem | 6 | Menu items, small inline controls |
| radius-input | 0.5rem | 8 | Inputs, buttons, cards, popovers |
| radius-card | 0.5rem | 8 | Alias of `radius-input`; kept so card geometry can diverge later |
| radius-lg | 1rem | 16 | Dialogs and full-surface overlays |
| radius-pill | 9999px | — | Badges, chips, circular triggers |

`border-radius: 50%` stays literal for avatars and circular marks — a circle is not a step on
this scale. Tailwind's `rounded-md` / `rounded-lg` / `rounded-xl` / `rounded-full` resolve to
`radius-sm` / `radius-input` / `radius-lg` / `radius-pill` respectively.

## Admin Surface

The admin is a working surface -- scanned, not read -- and takes its own shape and density on
top of the tokens above. The values are set on `.admin-body` in `src/styles/global.css`, not
on `:root`, so the public site and the installer keep the root values.
`scripts/check-design-tokens.mjs` checks the root tables only; this table is the record for
the admin. Icons are line drawings on a 24px grid with a 1.5px stroke, drawn at 20px in
`currentColor` from `src/lib/admin-icons.ts` (paths adapted from Lucide, ISC licence).

| Token | Root | Admin | Role in the admin |
|------|------|-------|-------------------|
| radius-sm | 0.375rem (6px) | 0.5rem (8px) | Nav items, menu items, chips |
| radius-input | 0.5rem (8px) | 0.625rem (10px) | Buttons, inputs, selects |
| radius-card | 0.5rem (8px) | 0.875rem (14px) | Cards, panels, story cards, empty states |
| control-height | 3rem (48px) | 2.5rem (40px); 2.75rem (44px) on a coarse pointer | Every control |
| text-title | clamp(1.75rem, 6vw, 2.5rem) | 1.75rem (28px), weight 600 | Page titles |
| admin-sidebar-width | -- | 16rem (256px) | Sidebar column; the main column and the navigation overlay start at its edge |
| admin-topbar-height | -- | 4rem (64px) | Sticky top bar: screen name, post search, view site |

Design: `docs/specs/2026-09-17-admin-modern-ui-design.md`.

## Components

(none detected)

## Do's and Don'ts

Guardrails protect Single-family weight hierarchy, Soft, rounded geometry without adding unsupported visual claims.

| Do | Don't |
|----|---------|
| Do maintain consistent spacing using the base grid | Don't make unsupported claims about absent visual features |
| Do maintain WCAG AA contrast ratios (4.5:1 for normal text) | Don't mix rounded and sharp corners in the same view |
| Do use the primary color only for the single most important action per screen |  |
| Do verify evidence before writing new design-system guidance |  |

## Responsive Evidence

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <= 599px | (max-width: 599px) |
| Mobile | <= 600px | screen and (max-width: 600px) |
| Breakpoint 3 | <= 839px | (max-width: 839px) |
| Breakpoint 4 | <= 919px | (max-width: 919px) |
| Mobile | >= 375px | (min-width: 375px) |
| Mobile | >= 400px | screen and (min-width: 400px) |
| Mobile | >= 440px | screen and (min-width: 440px) |
| Mobile | >= 600px | (min-width: 600px) |
| Mobile | >= 712px | screen and (min-width: 712px) |
| Tablet | >= 768px | (min-width: 768px) |
| Tablet | >= 840px | (min-width: 840px) |
| Tablet | >= 908px | (min-width: 908px) |
| Tablet | >= 942px | screen and (min-width: 942px) |
| Desktop | >= 1032px | (min-width: 1032px) |
| Desktop | >= 1080px | (min-width: 1080px) |
| Desktop | >= 1120px | (min-width: 1120px) |
| Desktop | >= 1156px | (min-width: 1156px) |
| Desktop | >= 1200px | (min-width: 1200px) |
| Desktop | >= 1280px | (min-width: 1280px) |
| Desktop | >= 1300px | (min-width: 1300px) |

## Agent Prompt Guide

### Example Component Prompts
- Create button component using validated primary color role and spacing tokens.
- Create card component with mapped radius role and evidence-backed elevation.
- Create form input component using inferred typography hierarchy and border roles.

### Iteration Guide
1. Start with extracted palette and typography roles only.
2. Map spacing and radius directly from token tables before visual polish.
3. Apply component patterns one section at a time and compare against source intent.
4. Keep elevation claims tied to explicit evidence in output.
5. Iterate with smallest diffs and re-check section hierarchy after each change.
