# E-commerce Plugin — Design Note

> **Status: not scheduled, and blocked.** A note for a future release. It cannot be
> built before the [plugin system](2026-09-14-plugin-system-design.md) exists, and it
> needs the shape that note calls B (sidecar) rather than A (declarative).

**Goal:** Let an owner sell something from their TomeCMS site.

Related notes: [plugin system](2026-09-14-plugin-system-design.md) ·
[theme system](2026-09-14-theme-system-design.md) ·
[.tome backup container](2026-09-14-tome-backup-format-design.md)

---

## Why this is the plugin system's proving ground

Every capability the plugin note says shape A cannot reach, a shop needs at once:

- **It runs.** Capturing a payment, confirming a webhook, decrementing stock, sending a
  receipt — none of that is a content type described as data.
- **It owns tables.** Products, variants, orders, line items, payments, inventory
  movements. Migrations are a compiled-in registry the updater audits
  (`verify.migration_inventory`), so this is the constraint that decides the shape.
- **It has a public surface with state.** A cart is per-visitor state on pages that
  today ship zero JavaScript.
- **It touches money**, which changes what "a bug" costs.

If the plugin API can carry a shop, it can carry anything. If it cannot, it is a
content-modelling feature with a more ambitious name.

---

## The three things that will actually decide the design

### 1. The cart breaks the zero-JavaScript rule

The public pages carry no client JavaScript. The visitor theme control is the only
thing that has ever spent that, and it comes with an owner switch to take it back —
`allow_visitor_theme` exists precisely so the site can return to zero-JS.

A cart needs client state. The options, honestly:

- **Server-rendered cart, cookie-backed, form POSTs.** Every "add to basket" is a form
  submission and a redirect. Zero-JS holds. Feels like 2009, works everywhere, and is
  genuinely fine for a small catalogue.
- **A small island on shop routes only.** The rest of the site stays zero-JS; product
  and cart pages do not. Needs the same kind of honest switch the theme control has.
- **Give up the rule for shop installs.** Simplest, and the thing to say out loud
  rather than discover.

### 2. Payments must not be the plugin's problem

Never hold card data. A hosted checkout (Stripe Checkout, Omise, PromptPay via a
provider) means the money leaves the product's blast radius entirely. The plugin's job
reduces to: create an order, hand off, verify the webhook, mark it paid.

Consequences that follow:

- **Webhook verification is the security-critical code**, not the checkout page. It is
  the one endpoint an attacker can reach without authentication that changes money
  state. Signature checking and idempotency keys are the whole feature.
- **Orders need their own idempotency**, because a webhook can arrive twice and a
  customer can double-submit.
- The app already has a rate limiter (`security_rate_limits`, actions pinned by a check
  constraint) — a shop adds public endpoints to a product whose only public surface is
  currently read-only HTML.

### 3. Customer data is not owner data

TomeCMS today has exactly one human in the database: the owner, with a passkey and
recovery codes. A shop introduces **customers** — names, addresses, order history — and
with them:

- The reset script's `RESET_TABLES` is a typed `Record` over the schema so no table is
  forgotten. Shop tables must be in it, and someone has to decide whether "reset the
  installation" should be allowed to delete order history at all, or refuse while orders
  exist.
- The backup carries the database whole, so a `.tome` file would now contain customer
  addresses. That note already says a backup is credential material; this makes it
  personal data as well, which is a different legal sentence.
- Tax and invoicing rules are jurisdictional and are not a plugin's decision to guess.

---

## What a first version could deliberately refuse

A small shop is a much better first target than a general one. Refusing loudly is
cheaper than half-supporting:

- one currency, set once
- no variants — one product, one price, one stock count
- no shipping zones or rate tables; a flat rate or free
- no discount codes
- no guest-vs-account distinction: every order is a guest order
- digital or single-region physical, not both

Each of those is a real shop feature and each one roughly doubles the model.

---

## Rough order, if it is ever scheduled

1. The [plugin system](2026-09-14-plugin-system-design.md), shape B, with a hook surface
   and a capability model. This note cannot start before it.
2. Catalogue only — products as content, rendered publicly, no cart. Useful on its own
   as a "what I sell" page, and it proves the content half.
3. Cart and checkout against one hosted provider, with the zero-JS decision made
   explicitly and written down.
4. Orders in the admin, and the reset/backup decisions above.

Step 1 is most of the work. Step 3 is most of the risk.
