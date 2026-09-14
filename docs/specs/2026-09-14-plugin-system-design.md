# Plugin System — Design Note

> **Status: not scheduled.** A note for a future release. Nothing here is built, and
> nothing here is a commitment to build it. Read "The two constraints" before planning
> anything: they rule out the shape most people picture when they hear "plugin".

**Goal:** Let a TomeCMS installation gain capabilities its owner did not get in the box.

Related notes: [theme system](2026-09-14-theme-system-design.md) ·
[e-commerce plugin](2026-09-14-ecommerce-plugin-design.md) ·
[.tome backup container](2026-09-14-tome-backup-format-design.md)

---

## The two constraints

Both are architectural facts of this codebase, not preferences. Every design below is
shaped by them.

### 1. The app ships as a Docker image, and updates by replacing it

`src/updater/transaction.ts` runs an update as a staged, rollback-able transaction:

```
backup.create → download.image → quiesce.stop_app → migration.apply
              → restart.start_app → verify.migration_inventory
              (→ rollback.start_app on failure)
```

So there is no directory a plugin's server code could be dropped into that survives an
update. Anything written into the container is gone the moment the owner updates, which
is the one operation the product most wants to be safe.

**A plugin that adds server code therefore cannot be "installed from the admin UI" in
the way WordPress means it.** Any design that assumes otherwise is designing for a
different deployment model.

### 2. Migrations are a compiled-in registry, and the updater audits it

`src/server/db/migrator.ts` imports each migration module by name into a `migrations`
object. `pendingMigrationNames()` reads that object; the updater's
`verify.migration_inventory` stage checks it after applying. `tests/unit/db-migrator.test.ts`
pins the roster, ordering and head.

A plugin that needs its own tables cannot add to that registry at runtime. The schema is
part of the image.

---

## Four shapes, and what each costs

| Shape | Plugins can add | Installable at runtime | Survives an update | Isolation |
|---|---|---|---|---|
| **A. Declarative** | content types, fields, admin panels described as data | yes | yes (rows, not code) | total — no plugin code runs |
| **B. Sidecar** | anything, in its own container | yes, by editing compose | yes | process-level |
| **C. Build-time** | anything, as an npm dependency | no — owner rebuilds the image | yes | none |
| **D. Runtime module loading** | anything, from a mounted volume | yes | only if the volume is mounted | weak |

**A and B are the ones that fit this product.** C turns every plugin into a fork, which
is a fine answer for a developer and a useless one for an owner. D asks a single-owner
CMS to solve sandboxing, which is a research problem wearing a feature's clothes.

### A. Declarative plugins

A plugin is rows, not code: a manifest describing content types, fields, validation and
admin panels, rendered by generic core UI. The core already has most of the machinery —
an editor, a media library, a settings form, a list view with filters.

- **Reaches:** custom content types, extra fields on posts and pages, extra settings
  panels, new public routes that render existing content differently.
- **Does not reach:** anything needing to *run* — payment capture, external API calls,
  scheduled work, a cart.
- **Schema:** one generic table (or JSONB on a shared one) rather than a table per
  plugin, which sidesteps constraint 2 entirely.

### B. Sidecar plugins

A plugin is a container the owner adds to their compose file, speaking to the core over
HTTP with a scoped token. The core exposes hooks; the sidecar answers them.

- **Reaches:** everything, including payments and background work.
- **Costs:** the owner edits compose to install one, so "installing" is an ops action,
  not a click. Needs a hook surface, a token scheme, and a story for what happens when
  a sidecar is down.
- **Fits the deployment model exactly** — the product already asks the owner to run
  Docker Compose, and an update replaces one image without touching the others.

**The likely answer is both**, with A covering the long tail and B covering the few
plugins that need to act.

---

## What the core would have to grow first

None of these exist today, and each is a real piece of work:

1. **A hook surface.** Named points where a plugin can observe or contribute — content
   saved, page rendered, settings panel assembled, admin nav built. Today these are
   direct function calls with no seam.
2. **A capability/permission model.** Right now there is one role, `owner`, and every
   admin route is `requireInstalledOwner`. A plugin acting on the owner's behalf needs
   a narrower grant than "is the owner".
3. **Public-route extension** that does not break the zero-JavaScript rule the public
   pages hold (the visitor theme control is the only thing that has ever spent it, and
   it is switchable off for exactly that reason).
4. **A place for plugin state** that the reset script and the backup both understand —
   `RESET_TABLES` is a typed `Record` over the schema precisely so nothing is forgotten,
   and plugin state must not become the exception.

---

## Security, stated plainly

A plugin in a single-owner self-hosted CMS runs with access to the owner's content, the
media bucket, and — if given a database handle — the `passkey` and `recovery_codes`
tables. There is no second administrator to notice misbehaviour.

Shape A is safe because nothing executes. Shape B is safe because the boundary is a
process and a token, both of which the owner can see and revoke. Any shape that runs
plugin code inside the core process is asking the owner to trust plugin authors the way
they trust the product, and should not ship without saying so in those words.

---

## Rough order, if it is ever scheduled

1. The hook surface and the capability model, with no plugins at all — the seams have
   to exist before anything can sit in them.
2. Shape A end to end, with one first-party declarative plugin as proof.
3. Shape B, with the [e-commerce plugin](2026-09-14-ecommerce-plugin-design.md) as its
   first consumer, because it needs everything A cannot do.

Steps 1 and 2 are the feature. Step 3 is where it earns its keep.
