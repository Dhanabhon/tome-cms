# Public Homepage, in the Admin's Language

Date: 2026-09-19
Status: Awaiting owner review
Decided with the owner in conversation on 2026-09-19, from two variants rendered at full size
against the built stylesheet (`variant A`, the admin's language, was chosen over `variant B`,
a borderless magazine grid).

## Context

The admin was rebuilt over 2026-09-17..19 into a flat, hairline-separated surface: paper cards
with quiet borders and rounded corners, pill chips, one icon set, one badge, one menu. The
public homepage was rebuilt on 2026-09-16..17 into a card grid, but in the older language:

- A full-bleed dark green hero band written in Tailwind utilities (`bg-hero text-white`) -- the
  last utility block on the page.
- Post cards with no surface at all: a cover, a title, an excerpt and a meta line sitting
  directly on the page, separated by 64px of vertical space.
- Category chips whose selected state is a filled ink box.
- A meta line that separates its parts with `::before` bullets and draws no icons, while the
  admin's cards date their work with a clock.

The owner asked for the homepage to feel as modern as the admin. Moving between the two today
is moving between two products.

## Product Decisions

Settled with the owner, one question at a time:

- **The homepage only.** The article page, the Page template, the header and the footer keep
  what they have. Clicking a post still leads to the older treatment, and that is accepted.
- **Direction A: the admin's language, not a magazine's.** Cards take a surface; the choice was
  made against a rendered alternative, not described.
- **The green band goes.** The hero becomes a page head on paper, the way every admin screen
  opens. `--color-hero` keeps its other uses (code blocks, the sign-in context panel), so no
  token is orphaned.
- **The clock comes too**, which means the icon set stops being the admin's private property.

Out of scope: the article page, the header and footer, the hero's English headline (it is
hard-coded in the route and stays that way), any change to how posts are fetched, filtered or
paged.

## The Design

### Hero

`.home-hero` replaces the utility band. Paper-2 background, the display title at its current
size, the tagline beneath it in muted ink, and a hairline across the bottom -- the same shape
`.admin-page__head` gives every admin screen. In dark mode the band and the page are one
colour and the hairline carries the separation, which is what the admin does too.

### Post card

A card is a surface, as on the Posts screen:

| Part | Value |
|---|---|
| Surface | `--color-paper`, `--rule-hair` in `--color-rule`, `--radius-lg` (16px) |
| Cover | flush inside the frame, 2:1, clipped by the card's own `overflow` |
| Body | title, excerpt and meta inside the frame with `--space-md` sides |
| Hover | the border lifts to `--color-rule-strong`; the cover keeps its 1.03 zoom |
| Grid | `--space-lg` in both directions, from 64px vertical |

The card's radius is `--radius-lg`, not the admin's 14px: 14px is an override on `.admin-body`
and cannot be reached from a public route. 16px is the nearest token that already exists, and
the difference is not visible without measuring.

### Category chips

The unselected chip keeps its shape and takes the quiet surface: `--color-paper` with a
`--color-rule` edge. The selected chip stops being a filled ink box and becomes a ring: the
`--color-accent` border with `--color-link` text, which is how the admin marks a chosen folder
in the file library. Both pairs are already pinned in `tests/unit/theme-contrast.test.ts`.

### The meta line

The byline stays on the left. On the right, a clock leads the date, then the read time after a
bullet, as the admin's cards do. The clock is `ICONS.clock` at the date's own size and colour.

### One icon set for the product

`src/lib/admin-icons.ts` becomes `src/lib/icons.ts`, exporting `ICONS` and `IconName`;
`ADMIN_NAV_IDS` moves to `src/lib/admin.ts`, where the other admin helpers live. The two
renderers move with it: `components/admin/AdminIcon.astro` and `.tsx` become
`components/Icon.astro` and `components/Icon.tsx`. Every current call site is mechanical --
the component's props and markup do not change -- and the test that pins both renderers to the
same attributes moves with them.

This is the only structural change in the work, and it exists because a public page now draws
an icon. Without it the homepage would either import a module called "admin" or hand-copy a
path, and the second is how two icon sets start.

## Rollout

Two layers, each ending in screenshots, the owner's review and a commit:

1. **One icon set.** The rename above, with no visual change anywhere. A green test suite and
   an unchanged selector diff are the proof.
2. **The homepage.** Hero, card, chips, meta, spacing.

## Verification

- `npm run test:unit` and `npm run check` at every layer.
- `scripts/css-selector-diff.mjs` against the previous build. Layer 1 must show no change at
  all; layer 2's removals are the utility band's classes and nothing else.
- Screenshots at 1440, 768 and 375, light and dark, from the dev server if the database has
  posts, otherwise from the fixture used to choose the direction
  (`$S/home/variant-a.html`).
- New tests: the homepage no longer carries `bg-hero`; `.post-card` declares a surface; the
  meta line draws the clock.

## Risks

- **The homepage and the article page will not match** until the article page is done. The
  owner accepted this; the card's frame stops at the grid, so the mismatch is a difference in
  density rather than in palette.
- **The rename touches fifteen files** (counted, not estimated: ten components, two routes,
  the module itself and two test files). It is mechanical and the icon tests already pin what must
  not drift, but it is the one change here that could break a build; it ships in its own layer
  so a failure has one cause.
- **A filled chip carries more contrast than a ring.** The ring's pair is measured, but the
  selected chip will be quieter than it is today. If the owner finds it too quiet, the fix is
  one declaration.
