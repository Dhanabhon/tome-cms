---
version: alpha
name: "Notion Marketing 2024"
description: "Notion's marketing homepage pairs a deep navy (#02093a) hero section with a light (#f6f5f4) body, using a custom typeface (NotionInter) across all text roles. The design employs a 12-column grid with 28px gutters, a dual-radius language (8px for cards, 9999px for pills), and a multi-layer progressive shadow system for floating UI elements. Brand blue (#2537b1) drives CTAs and accent highlights, while a semantic gray-scale ladder (gray-200 through gray-900) structures all text and surface hierarchy."
colors:
  surface-white: "#ffffff"
  hero-dark-navy: "#02093a"
  surface-base: "#f6f5f4"
  accent-blue: "#097fe8"
  accent-red: "#f64932"
  brand-blue: "#2537b1"
  text-medium: "#615d59"
  text-muted: "#a39e98"
  text-primary: "#000000"
  border-subtle: "#000000"
typography:
  display-hero:
    fontFamily: "NotionInter"
    fontSize: "64px"
    fontWeight: "700"
    lineHeight: "64px"
    letterSpacing: "-1.875px"
  display-large:
    fontFamily: "NotionInter"
    fontSize: "54px"
    fontWeight: "700"
    lineHeight: "56px"
    letterSpacing: "-1.875px"
  heading-xl:
    fontFamily: "NotionInter"
    fontSize: "48px"
    fontWeight: "400"
    lineHeight: "72px"
  heading-l:
    fontFamily: "NotionInter"
    fontSize: "40px"
    fontWeight: "400"
    lineHeight: "60px"
  heading-m:
    fontFamily: "NotionInter"
    fontSize: "22px"
    fontWeight: "700"
    lineHeight: "28px"
    letterSpacing: "-0.25px"
  heading-s:
    fontFamily: "NotionInter"
    fontSize: "20px"
    fontWeight: "600"
    lineHeight: "28px"
    letterSpacing: "-0.125px"
  body-regular:
    fontFamily: "NotionInter"
    fontSize: "16px"
    fontWeight: "400"
    lineHeight: "24px"
  body-large:
    fontFamily: "NotionInter"
    fontSize: "20px"
    fontWeight: "400"
    lineHeight: "30px"
  label-medium:
    fontFamily: "NotionInter"
    fontSize: "14px"
    fontWeight: "500"
    lineHeight: "20px"
  label-small:
    fontFamily: "NotionInter"
    fontSize: "12px"
    fontWeight: "500"
    lineHeight: "16px"
    letterSpacing: "0.125px"
  nav-link:
    fontFamily: "NotionInter"
    fontSize: "16px"
    fontWeight: "500"
    lineHeight: "24px"
rounded:
  radius-none: "0px"
  radius-xs: "2px"
  radius-sm: "4px"
  radius-md: "5px"
  radius-base: "6px"
  radius-card: "8px"
  radius-lg: "12px"
  radius-xl: "16px"
  radius-2xl: "20px"
  radius-pill: "9999px"
spacing:
  spacing-1: "2px"
  spacing-2: "3px"
  spacing-3: "4px"
  spacing-4: "5px"
  spacing-5: "6px"
  spacing-6: "8px"
  spacing-7: "10px"
  spacing-8: "12px"
  spacing-9: "14px"
  spacing-10: "15px"
  spacing-11: "16px"
  spacing-12: "20px"
  spacing-13: "24px"
  spacing-14: "28px"
  spacing-15: "32px"
  spacing-16: "40px"
---

## Overview

Notion's marketing homepage pairs a deep navy (#02093a) hero section with a light (#f6f5f4) body, using a custom typeface (NotionInter) across all text roles. The design employs a 12-column grid with 28px gutters, a dual-radius language (8px for cards, 9999px for pills), and a multi-layer progressive shadow system for floating UI elements. Brand blue (#2537b1) drives CTAs and accent highlights, while a semantic gray-scale ladder (gray-200 through gray-900) structures all text and surface hierarchy.

**Signature traits:**
- Single-family weight hierarchy: Builds hierarchy from NotionInter across 4 weights rather than multiple families.
- Soft, rounded geometry: Generous corner rounding up to 9999px.

## Colors

The palette uses 10 validated color tokens across 1 theme profile. Semantic roles stay attached to observed usage so generation agents can choose accents without inventing new color meaning.

**Semantic naming:**
- **surface-background** maps to `surface-base`: Role "background" is grounded by usage context "Primary page background and card surfaces; maps to --color-gray-200".
- **surface-primary** maps to `surface-white`: Role "primary" is grounded by usage context "Navigation dropdown panels, card surfaces, modal overlays".
- **action-text** maps to `brand-blue`: Role "text" is grounded by usage context "Primary CTA button fill, key links, hero accent; maps to --color-campaigns-agents-launch-blue-200".
- **content-text** maps to `text-primary`: Role "text" is grounded by usage context "Body text, headings, nav labels; dominant text color across all zones".

### Primary Brand
- **Surface White** (#ffffff): Navigation dropdown panels, card surfaces, modal overlays. Role: primary. {authored: rgb(255, 255, 255), space: rgb, alpha: 0}

### Text Scale
- **Accent Blue** (#097fe8): Inline links, badge text, code keyword highlights; maps to --color-blue-500. Role: text. {authored: rgb(9, 127, 232), space: rgb}
- **Accent Red** (#f64932): Warning/error states, status tags; maps to --color-red-500. Role: text. {authored: rgb(246, 73, 50), space: rgb}
- **Brand Blue** (#2537b1): Primary CTA button fill, key links, hero accent; maps to --color-campaigns-agents-launch-blue-200. Role: text. {authored: rgb(37, 55, 177), space: rgb}
- **Text Medium** (#615d59): Tertiary text, icon button states; maps to --color-gray-600. Role: text. {authored: rgb(97, 93, 89), space: rgb}
- **Text Muted** (#a39e98): Secondary labels, placeholder text, icon fills; maps to --color-gray-400. Role: text. {authored: rgb(163, 158, 152), space: rgb}
- **Text Primary** (#000000): Body text, headings, nav labels; dominant text color across all zones. Role: text. {authored: rgb(0, 0, 0), space: rgb, alpha: 0.05}

### Interactive
- **Border Subtle** (#000000): Hairline dividers at 8% opacity; maps to --border-color-regular. Role: border. {authored: rgb(0, 0, 0), space: rgb, alpha: 0.05}

### Surface & Shadows
- **Hero Dark Navy** (#02093a): Hero section deep background; maps to --color-campaigns-agents-launch-blue-900. Role: background. {authored: rgb(2, 9, 58), space: rgb}
- **Surface Base** (#f6f5f4): Primary page background and card surfaces; maps to --color-gray-200. Role: background. {authored: rgb(246, 245, 244), space: rgb}

## Typography

Typography uses NotionInter across extracted hierarchy roles. Keep hierarchy mapped to these token rows before adding decorative type styles.

Uses NotionInter throughout for a uniform feel. Weight range spans bold, regular, semi-bold, medium. Sizes range from 12px to 64px.

### Type Scale Evidence
| Role | Font | Size | Weight | Line Height | Letter Spacing | Stack / Features | Notes |
|------|------|------|--------|-------------|----------------|------------------|-------|
| Hero headline (probe-confirmed h1 at 64px; CSSOM shows 54px w700 / 56px ls:-1.875px as closest match) | NotionInter | 64px | 700 | 64px | -1.875px | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Section hero headings, large marketing titles | NotionInter | 54px | 700 | 56px | -1.875px | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Large section headings | NotionInter | 48px | 400 | 72px | normal | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Mid-page section headings | NotionInter | 40px | 400 | 60px | normal | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Card titles, feature headings | NotionInter | 22px | 700 | 28px | -0.25px | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Sub-section headings, callout titles | NotionInter | 20px | 600 | 28px | -0.125px | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Primary body text, paragraph content (highest frequency: 443 hits) | NotionInter | 16px | 400 | 24px | normal | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Hero subheadline, lead paragraph text | NotionInter | 20px | 400 | 30px | normal | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Navigation labels, button text, UI labels (90 hits) | NotionInter | 14px | 500 | 20px | normal | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Badges, tags, small metadata labels | NotionInter | 12px | 500 | 16px | 0.125px | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |
| Global navigation links (probe-confirmed: 16px w500) | NotionInter | 16px | 500 | 24px | normal | NotionInter, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Apple Color Emoji, Arial, sans-serif, Segoe UI Emoji, Segoe UI Symbol; features: "lnum", "locl" 0 | Extracted token |

## Layout

Responsive system uses 4 breakpoint tier(s): mobile, tablet, desktop, wide.

This system uses a 4px base grid with scale values 2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 20, 24, 28, 32, 40, 48, 60, 64, 80.

### Responsive Strategy
- **mobile (375-919px)**: Constrain layout for small viewports and prioritize vertical stacking.
- **tablet (>= 712px)**: Increase spacing and column structure for medium-width viewports.
- **desktop (>= 1032px)**: Expand layout density and horizontal composition for wide viewports.
- **wide (>= 1440px)**: Stretch composition with generous gutters and wider layout spans.

### Spacing System
| Token | Value | Px | Notes |
|------|-------|----|-------|
| spacing-1 | 2px | 2 | Extracted spacing token |
| spacing-2 | 3px | 3 | Extracted spacing token |
| spacing-3 | 4px | 4 | Extracted spacing token |
| spacing-4 | 5px | 5 | Extracted spacing token |
| spacing-5 | 6px | 6 | Extracted spacing token |
| spacing-6 | 8px | 8 | Extracted spacing token |
| spacing-7 | 10px | 10 | Extracted spacing token |
| spacing-8 | 12px | 12 | Mapped to --grid-sm-gutter |
| spacing-9 | 14px | 14 | Extracted spacing token |
| spacing-10 | 15px | 15 | Extracted spacing token |
| spacing-11 | 16px | 16 | Extracted spacing token |
| spacing-12 | 20px | 20 | Mapped to --base-padding |
| spacing-13 | 24px | 24 | Mapped to --spacing-block-m |
| spacing-14 | 28px | 28 | Mapped to --grid-gutter |
| spacing-15 | 32px | 32 | Mapped to --spacing-block-l |
| spacing-16 | 40px | 40 | Mapped to --spacing-s |
| spacing-17 | 48px | 48 | Extracted spacing token |
| spacing-18 | 60px | 60 | Mapped to --spacing-l |
| spacing-19 | 64px | 64 | Extracted spacing token |
| spacing-20 | 80px | 80 | Extracted spacing token |

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
| radius-none | 0px | 0 | Hairline corner |
| radius-xs | 2px | 2 | Hairline corner |
| radius-sm | 4px | 4 | Subtle corner |
| radius-md | 5px | 5 | Subtle corner |
| radius-base | 6px | 6 | Subtle corner |
| radius-card | 8px | 8 | Control corner |
| radius-lg | 12px | 12 | Control corner |
| radius-xl | 16px | 16 | Card corner |
| radius-2xl | 20px | 20 | Card corner |
| radius-pill | 9999px | 9999 | Large surface corner |

### Geometry Evidence
| Radius Token | Shape | Units |
|--------------|-------|-------|
| radius-none | 0 | px |
| radius-xs | 2px | px |
| radius-sm | 4px | px |
| radius-md | 5px | px |
| radius-base | 6px | px |
| radius-card | 8px | px |
| radius-lg | 12px | px |
| radius-xl | 16px | px |
| radius-2xl | 20px | px |
| radius-pill | 9999px | px |

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
