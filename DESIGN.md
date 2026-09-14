---
version: alpha
name: "TomeCMS Mint 2026"
description: "TomeCMS uses a calm mint-and-teal palette anchored by reference mint (#c5e5e4), reference teal (#498f8c), and near-black ink (#0a0c0c). Accessible action teal (#236a67) carries CTAs and links, while deep evergreen (#0f3d3a) grounds dark surfaces. The existing IBM Plex Sans Thai hierarchy, 12-column grid, dual-radius language, and progressive shadows remain unchanged."
colors:
  surface-white: "#ffffff"
  surface-base: "#f2f8f7"
  surface-mint: "#c5e5e4"
  hero-evergreen: "#0f3d3a"
  accent-teal: "#236a67"
  focus-teal: "#498f8c"
  accent-red: "#f64932"
  text-medium: "#526e6b"
  text-muted: "#4d6865"
  text-primary: "#0a0c0c"
  border-subtle: "#0f3d3a"
typography:
  display-hero:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "64px"
    fontWeight: "700"
    lineHeight: "64px"
    letterSpacing: "-1.875px"
  display-large:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "54px"
    fontWeight: "700"
    lineHeight: "56px"
    letterSpacing: "-1.875px"
  heading-xl:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "48px"
    fontWeight: "400"
    lineHeight: "72px"
  heading-l:
    fontFamily: "IBM Plex Sans Thai"
    fontSize: "40px"
    fontWeight: "400"
    lineHeight: "60px"
  heading-m:
    fontFamily: "IBM Plex Sans Thai"
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

TomeCMS pairs white and pale-mint surfaces with deep evergreen anchors, using the reference artwork's mint (#c5e5e4), teal (#498f8c), and near-black ink (#0a0c0c). Accessible action teal (#236a67) drives CTAs and links. The existing IBM Plex Sans Thai hierarchy, 12-column grid with 28px gutters, dual-radius language, and progressive shadow system remain the structural foundation.

**Source of truth:** `src/styles/installer-tokens.css` owns every colour, spacing, radius and
type token. This document and `tailwind.config.mjs` follow it — they never declare a competing
value. `npm run check` runs `scripts/check-design-tokens.mjs`, which fails the build if they drift.

**Signature traits:**
- Single-family weight hierarchy: Builds hierarchy from IBM Plex Sans Thai across 4 weights rather than multiple families.
- Soft, rounded geometry: Generous corner rounding up to 9999px.

## Colors

The palette uses 11 validated color tokens across one theme profile. Semantic roles stay attached to observed usage so generation agents can choose accents without inventing new color meaning.

**Semantic naming:**
- **surface-background** maps to `surface-base`: Role "background" is grounded by usage context "Primary page background and quiet application surfaces".
- **surface-primary** maps to `surface-white`: Role "primary" is grounded by usage context "Navigation dropdown panels, card surfaces, modal overlays".
- **action-text** maps to `accent-teal`: Role "text" is grounded by usage context "Primary CTA fill and links; darkened from the reference teal to preserve white-label contrast".
- **content-text** maps to `text-primary`: Role "text" is grounded by usage context "Body text, headings, nav labels; dominant text color across all zones".

### Primary Brand
- **Surface White** (#ffffff): Navigation dropdown panels, card surfaces, modal overlays. Role: primary. {authored: rgb(255, 255, 255), space: rgb, alpha: 0}
- **Surface Mint** (#c5e5e4): Selected states, quiet highlights, and branded soft surfaces. Role: background. {authored: rgb(197, 229, 228), space: rgb}
- **Hero Evergreen** (#0f3d3a): Dark hero, editor code, and grounded navigation surfaces. Role: background. {authored: rgb(15, 61, 58), space: rgb}
- **Accent Teal** (#236a67): Primary CTA fill and links; passes WCAG AA against white and mint surfaces. Role: action. {authored: rgb(35, 106, 103), space: rgb}
- **Focus Teal** (#498f8c): Focus rings and non-text brand accents from the reference artwork. Role: focus. {authored: rgb(73, 143, 140), space: rgb}

### Text Scale
- **Accent Red** (#f64932): Warning/error states, status tags; maps to --color-red-500. Role: text. {authored: rgb(246, 73, 50), space: rgb}
- **Text Medium** (#526e6b): Secondary copy and icon states. Role: text. {authored: rgb(82, 110, 107), space: rgb}
- **Text Muted** (#4d6865): Placeholder text and tertiary labels; passes WCAG AA against white, base, and mint surfaces. Role: text. {authored: rgb(77, 104, 101), space: rgb}
- **Text Primary** (#0a0c0c): Body text, headings, nav labels; dominant text color across all zones. Role: text. {authored: rgb(10, 12, 12), space: rgb}

### Interactive
- **Border Subtle** (#0f3d3a): Hairline dividers mixed at 10% and strong borders mixed at 26%. Role: border. {authored: rgb(15, 61, 58), space: rgb}

### Surface & Shadows
- **Surface Base** (#f2f8f7): Primary page background and quiet application surfaces. Role: background. {authored: rgb(242, 248, 247), space: rgb}

## Typography

Typography uses IBM Plex Sans Thai across extracted hierarchy roles. Keep hierarchy mapped to these token rows before adding decorative type styles.

Uses IBM Plex Sans Thai throughout for a uniform feel. Weight range spans bold, regular, semi-bold, medium. Sizes range from 12px to 64px.

### Type Scale Evidence
| Role | Font | Size | Weight | Line Height | Letter Spacing | Stack / Features | Notes |
|------|------|------|--------|-------------|----------------|------------------|-------|
| Hero headline (probe-confirmed h1 at 64px; CSSOM shows 54px w700 / 56px ls:-1.875px as closest match) | IBM Plex Sans Thai | 64px | 700 | 64px | -1.875px | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Section hero headings, large marketing titles | IBM Plex Sans Thai | 54px | 700 | 56px | -1.875px | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Large section headings | IBM Plex Sans Thai | 48px | 400 | 72px | normal | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Mid-page section headings | IBM Plex Sans Thai | 40px | 400 | 60px | normal | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Card titles, feature headings | IBM Plex Sans Thai | 22px | 700 | 28px | -0.25px | IBM Plex Sans Thai, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
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
