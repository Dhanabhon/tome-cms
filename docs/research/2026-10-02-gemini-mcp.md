# Can Gemini connect to TomeCMS over MCP? Research note

Study date: 2026-10-02. Code studied: `develop` at 1.8.2 (`src/server/mcp/oauth.ts`, `redirects.ts`, `brand.ts`).
Read-only; nothing in the repo changed.

## Answer in short

Yes, for three of Google's surfaces, but **today none of them connects cleanly**. The Gemini web app
needs three small changes on our side. The Antigravity CLI (which replaced the Gemini CLI) should
work already, through the loopback redirect, apart from a bug on its side. Gemini Enterprise needs one
more redirect. There is also a **regional limit**: custom apps in the Gemini web app are for personal
accounts in the US, aged 18 and over, in English. An owner in Thailand may not be able to add one yet.

## Google's surfaces

| Surface | How it connects | Redirect it uses | Works with 1.8.2? |
|---|---|---|---|
| **Gemini web app** (gemini.google.com, "custom apps" in Connected Apps, rolled out from 2026-06-29) | OAuth + **DCR** | `https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-<id>-<server host>`, one per user and connector | **No**: three gaps, below |
| **Antigravity CLI** (`agy`; replaced the Gemini CLI on 2026-06-18 for free, Pro and Ultra) | OAuth + DCR when the server asks for it | Loopback, `http://localhost:<port>/oauth/callback` (the Gemini CLI default was port 7777 or a random port) | **Probably yes**: loopback is allowed. Its v1.0.0 had a bug that sent `initialize` without the bearer token |
| **Gemini Enterprise** (custom MCP data store) | OAuth, client registered by the admin | Fixed: `https://vertexaisearch.cloud.google.com/oauth-redirect` | **No**: redirect not allowed. Not for a personal site |

Write actions: the Gemini app asks the user to confirm every write before it runs it.

## The three gaps for the Gemini web app

1. **Its redirect is not a fixed address.** Our allowlist matches non-loopback redirects exactly
   (`redirects.ts` `DEFAULT_REDIRECTS`). Google's relay puts a per-user, per-connector id in the path.
   The fix is a rule for exactly this host and path prefix: `https`, host
   `oauth-redirect.googleusercontent.com`, path `/r/user_bound_custom-mcp-` followed by a non-empty
   id, with no query, fragment or userinfo. The host is Google's own, so a forged client still cannot
   receive a code anywhere else.
2. **It registers as a confidential client.** Its DCR request asks for
   `token_endpoint_auth_method: client_secret_basic`. `registerClient` refuses anything but `none`
   (`oauth.ts:111`). When registration fails, Gemini falls back to asking the user for a client id
   and secret. RFC 7591 §3.2.1 lets a server register the client with different metadata than it
   asked for. We should answer with `none` (a public client with PKCE) instead of refusing, as
   another server did for Gemini (erp-mafia/accounted#3301).
3. **It adds `offline_access` to the scope.** `startAuthorization` refuses any unknown scope
   (`oauth.ts:216`). `offline_access` should be accepted and ignored, because every grant already gets
   a refresh token. Other unknown scopes stay refused.

## The mark

Its approval goes to `oauth-redirect.googleusercontent.com`, Google's own host, which an app cannot
choose for itself. By our rule (marks only from hosts the app cannot choose), that redirect, with the
`user_bound_custom-mcp-` path, earns a `gemini` mark. thesvg.org has Google and Gemini marks, so it
would be fetched unmodified the way Claude's and OpenAI's were. The Antigravity CLI uses loopback
with DCR, so it shows the computer icon and "(the name it gave)", like any self-registered local
program, unless it turns out to use a client document on a Google host.

## Recommendation for 1.9.0

Small and safe to include:
- the relay redirect rule;
- accepting `client_secret_basic` by registering it as `none`;
- ignoring `offline_access`;
- the `gemini` mark for that redirect;
- a docs section covering the Gemini web app (with the US-only limit stated plainly) and the
  Antigravity CLI (`agy mcp add <name> https://<site>/mcp`).

Each change gets a unit or integration test.

Leave Gemini Enterprise out unless asked: it is for organisations and needs an admin-registered
client. The real test is the owner connecting from gemini.google.com, which the regional limit may
block. If it does, the Antigravity CLI is the way to check on daedalus.

## Sources

- [Connect & manage custom apps for Gemini Apps](https://support.google.com/gemini/answer/17209137?hl=en)
- [erp-mafia/accounted#3301: connecting Gemini custom apps over OAuth](https://github.com/erp-mafia/accounted/pull/3301)
- [MCP servers with Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)
- [Antigravity MCP docs](https://antigravity.google/docs/mcp)
- [Antigravity CLI issue #25: initialize sent without bearer token](https://github.com/google-antigravity/antigravity-cli/issues/25)
- [Gemini Enterprise: set up your custom MCP server](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server)
- [How to add a custom MCP server to Gemini (2026)](https://www.usecarly.com/blog/gemini-mcp/)
