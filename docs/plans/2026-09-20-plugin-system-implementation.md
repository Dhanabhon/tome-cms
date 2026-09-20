# Plugin System Implementation Plan

**Goal:** A plugin implements hooks the core declares, ships in the repository, and is
switched on and configured in the admin. The first is Cloudflare Turnstile on the sign-in.

**Spec:** [docs/specs/2026-09-20-plugin-system-design.md](../specs/2026-09-20-plugin-system-design.md)

**Tech stack:** Astro 5 SSR, React islands, TypeScript, Kysely/Postgres, node:crypto.

## Global constraints

- `npm run check` reports `0 errors` and `npm run test:unit` is green at the end of every task.
- No plugin file imports from `src/pages` or `src/server`. A plugin gets what it is given.
- No plugin is imported into a bundle for a page that does not use it. Check the built page,
  not the build: the theme work shipped a bug that a whole-build check could not see.
- The guard ships last, and never touches registration. The recovery path stays open.
- Commit messages carry no attribution lines.

---

## Layer 1: the contract, the table, and the screen

### File structure

| Path | Responsibility |
|---|---|
| `src/plugins/contract.ts` | `SignInWidget`, `SignInVerdict`, `Plugin`, `PluginManifest`, `PluginSetting` |
| `src/plugins/manifests.ts` | id, name, description and settings schema -- no implementation |
| `src/plugins/registry.ts` | `PLUGIN_IDS`, `isPluginId`, `loadPlugin(id)` by dynamic import |
| `src/plugins/turnstile/plugin.ts` | the manifest |
| `src/plugins/turnstile/index.ts` | the hooks, stubbed until layers 2 and 3 |
| `src/server/plugins/secrets.ts` | AES-256-GCM seal/open under `TOME_CMS_CONTEXT_SECRET` |
| `src/server/plugins/store.ts` | read and write `plugin_settings`; secrets never leave sealed |
| `src/server/db/migrations/013_plugin_settings.ts` | the table |
| `src/pages/api/admin/plugins.ts` | `GET` state, `PUT` one plugin's enabled + settings |
| `src/pages/admin/plugins.astro` | the screen |
| `src/components/admin/PluginManager.tsx` | the form, driven by the settings schema |
| `src/lib/admin.ts`, `src/lib/icons.ts`, `src/lib/admin-i18n.ts` | nav entry, icon, copy |

### What the browser may know

A `secret` setting never reaches it. The API answers with `{ configured: boolean }` for those
keys and takes a new value on write; an empty string on write means "leave what is there".

### Steps

- [ ] **1. The contract.** `contract.ts`, with the two hooks and the settings schema types.
- [ ] **2. Sealing.** `secrets.ts`: `sealSecret`/`openSecret`, AES-256-GCM, random IV per
      value, the key derived from `TOME_CMS_CONTEXT_SECRET` with SHA-256. Test round-trip,
      a tampered payload, and that two seals of one value differ.
- [ ] **3. The table.** Migration 013, `db/types.ts`, `types/cms.ts`.
- [ ] **4. The store.** `store.ts`: `readPluginState(ownerId)` for the admin (secrets as
      `configured` only), `readPluginConfig(id)` for the server (secrets opened), and
      `writePluginSettings`.
- [ ] **5. The manifest.** Turnstile's id, name, description, and its two settings.
- [ ] **6. The registry.** Dynamic import per id, as the themes do.
- [ ] **7. The API.** `GET`/`PUT` under the owner session, validated against the schema.
- [ ] **8. The screen.** Nav entry, icon, page, and a form generated from the schema.
- [ ] **9. Tests.** Sealing; the API's refusal to return a secret; the manifest's schema
      matching what the plugin reads; no plugin imported outside its own directory.
- [ ] **10. Verify.** Enable and configure Turnstile in the admin; confirm the sign-in page
      is byte-for-byte unchanged, because nothing reads the plugin yet.
- [ ] **11. Commit.**

---

## Layer 2: the widget

- [ ] **1.** `signInWidget` returns the descriptor when both keys are set, `null` otherwise.
- [ ] **2.** The sign-in page resolves the enabled plugin server-side and passes the
      descriptor to `PasskeySignIn` as props.
- [ ] **3.** The island renders the container, loads the script once, and reads the token
      from its own `FormData` on submit. It sends the token with the attempt.
- [ ] **4.** Check the built sign-in page: the descriptor is there, the plugin's module is
      not, and no other page carries either.
- [ ] **5.** Screenshots with the plugin off and on.
- [ ] **6.** Commit.

---

## Layer 3: the guard, and the policy

- [ ] **1.** `verifySignIn` calls `siteverify`, and maps its answers: a rejection is
      `refused`, a network failure or a 5xx is `unavailable`, a timeout is `unavailable`.
- [ ] **2.** The gate in `/api/auth/[...all].ts` runs it for
      `POST /passkey/verify-authentication` only, beside the rate limiter, and acts on the
      verdict: `refused` answers 403 with a message the owner can act on; `unavailable`
      proceeds and logs.
- [ ] **3.** `npm run plugin:disable <id>`.
- [ ] **4.** Tests against Cloudflare's documented test keys -- always-pass, always-fail --
      and against an unreachable endpoint, which must sign in.
- [ ] **5.** Commit.
