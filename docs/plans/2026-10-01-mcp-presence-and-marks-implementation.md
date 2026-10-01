# MCP Presence and Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four changes:
- the editor shows when an AI app has just read or written a draft;
- an AI cannot write a draft the owner has open;
- Claude's and ChatGPT/Codex's marks appear where the app is named;
- a program on this computer is called one.

**Architecture:**
- **Presence store.** A small in-memory store, `src/server/mcp/presence.ts`, records the last AI touch per post or page and the owner's editor heartbeat per item.
- **Tool hooks.** The MCP tools record touches, and `update_draft` refuses while a heartbeat is fresh.
- **Editor.** A new admin route, `POST /api/admin/editing`, is both the heartbeat and the status read. An editor island polls it every 15 s while visible.
- **Marks.** Chosen by `clientBrand()` from the CIMD `client_id` host or the redirect host, never from the app's name.

**Tech Stack:** Astro 7, React, Kysely and Postgres, zod 4, `node:test`, Playwright. No new dependency and no migration.

**Spec:** `docs/specs/2026-10-01-mcp-presence-and-marks-design.md`, which builds on `docs/specs/2026-10-01-mcp-design.md`.

## Global Constraints

- **Git:** no `git stash`. Stage files by path. Write the commit message to a file and run `git commit -F` in its own call. No `Co-Authored-By` or "Generated with" lines.
- **Windows** (exact values):
  - editor check every **15 s**, only while `document.visibilityState === 'visible'`;
  - the owner-first rule holds while the last heartbeat is **< 45 s** old;
  - AI status is shown for touches **≤ 3 min** old;
  - each in-memory Map holds at most **500** entries, oldest dropped first.
- **Touches:** read and write tools record them (`get_post`, `get_page`, `create_draft`, `update_draft`). List and search tools do not.
- **Owner first:** `update_draft` refuses while the heartbeat is fresh, writing nothing and taking no snapshot. Reads, `create_draft` and Put back are never refused.
- **Marks come from something the app cannot choose:**

  | Source | Mark |
  |---|---|
  | redirect host `claude.ai` | `claude` |
  | redirect host `chatgpt.com` | `openai` |
  | CIMD `client_id` host `claude.ai` | `claude` |
  | CIMD `client_id` host `chatgpt.com` or `openai.com` | `openai` |
  | anything else | no mark |

  The client's name never decides the mark. The real clients on daedalus are `https://claude.ai/oauth/mcp-oauth-client-metadata` and `https://chatgpt.com/oauth/codex/client.json`.
- **Mark sources:** thesvg.org (`github.com/glincker/thesvg`), unmodified:
  - `public/icons/claude/default.svg` becomes `claude`;
  - `public/icons/openai-chatgpt/default.svg` becomes `openai`.

  They are stored as `BRAND_MARKS` entries under the file's existing trademark note.
- **Loopback** means the host is `127.0.0.1`, `localhost` or `[::1]`. It is shown as "โปรแกรมบนเครื่องนี้" / "A program on this computer", with the host and port in small text.
- **Copy:** every new string goes into `src/lib/admin-i18n.ts` in both `en` and `th`, and the Thai must read naturally.
- **Release:** 1.8.0, with no migration.

## Review Focus

1. **A Claude Code or Codex client on loopback** must still get its mark from its CIMD `client_id`. A DCR loopback client named "Claude" must get none. Unit test in Task 1.
2. **Two editor tabs on one draft**, then one closes: the other's heartbeat must keep the owner-first rule alive. A heartbeat is per item and refreshed by any tab. Unit test in Task 2.
3. **The owner opens a draft seconds after an AI wrote it:** the editor must load the AI's version. It is loaded fresh, so there is no conflict, and the bar says the app wrote it. Browser test in Task 3.
4. **A hidden tab** must stop its heartbeat, so the AI may write again after 45 s. Unit test of the poll gate in Task 3, with the visibility state injected.
5. **MCP switched off** while an editor is open: the route still answers, with `ai: null`, and `newer` still works. Integration test in Task 3.

---

### Task 1: Marks, and loopback named as such

**Files:**
- Modify: `src/lib/brand-marks.ts`: add `claude` and `openai`.
- Create: `src/server/mcp/brand.ts`: `clientBrand(clientId: string, redirectHost: string): BrandName | null` and `isLoopbackHost(host: string): boolean`.
- Modify: `src/server/mcp/oauth.ts`:
  - `PendingSummary` gains `brand: BrandName | null` and `redirectIsLoopback: boolean`, set from the pending request's `clientId` and redirect host;
  - `VerifiedToken` gains `brand: BrandName | null`, from the connection's `client_id` and `redirect_host`, using the query `verifyAccessToken` already makes.
- Modify: `src/server/mcp/connections.ts`: `McpConnectionSummary` gains `brand` and `loopback`, which needs `client_id` selected.
- Modify: `src/components/admin/McpConsent.tsx` and `src/components/admin/McpConnections.tsx`:
  - show `<BrandMark name={brand}/>` when there is a brand, otherwise the existing `system` icon from `src/lib/icons.ts`;
  - for loopback, the headline or line reads `copy.mcp.thisComputer`, with the host and port in small text.
- Modify: `src/lib/admin-i18n.ts`: `mcp.thisComputer` and `mcp.nameGiven`.
- Test: `tests/unit/mcp-brand.test.ts`; extend `tests/integration/mcp-oauth.test.ts` and `tests/integration/mcp-connections.test.ts`.

**Interfaces:** `clientBrand`, `isLoopbackHost`, and `VerifiedToken.brand`. Task 2 uses `VerifiedToken.brand`.

- [ ] **Step 1: Add the marks.**
  - Fetch both SVGs:
    ```sh
    gh api repos/glincker/thesvg/contents/public/icons/claude/default.svg -q .content | base64 -d
    gh api repos/glincker/thesvg/contents/public/icons/openai-chatgpt/default.svg -q .content | base64 -d
    ```
  - Take each one's `viewBox` and its inner elements, unmodified. Claude's `default.svg` puts `fill="#D97757"` on the root `<svg>`, and `BrandMark` renders only the inner paths, so move that fill onto the path, for example `<path fill="#D97757" d="…"/>`, and change nothing else. Do the same for any root fill on the OpenAI mark.
  - Add a line to the file's header comment: "Claude's and OpenAI's marks, from thesvg.org, unmodified; shown only to say which AI app a connection is."
  - Titles: `'Claude'` and `'OpenAI'`.

- [ ] **Step 2: Write the failing unit test.**

```ts
// tests/unit/mcp-brand.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { clientBrand, isLoopbackHost } from '../../src/server/mcp/brand';

test('a mark comes from where the approval goes or from the client document host, never from a name', () => {
  assert.equal(clientBrand('https://claude.ai/oauth/mcp-oauth-client-metadata', 'claude.ai'), 'claude');
  assert.equal(clientBrand('dcr:1f0c', 'claude.ai'), 'claude');
  assert.equal(clientBrand('dcr:1f0c', 'chatgpt.com'), 'openai');
  // Codex from the ChatGPT desktop app: loopback redirect, CIMD on chatgpt.com.
  assert.equal(clientBrand('https://chatgpt.com/oauth/codex/client.json', '127.0.0.1:49205'), 'openai');
  assert.equal(clientBrand('https://platform.openai.com/x.json', 'localhost:1'), 'openai');
  assert.equal(clientBrand('https://claude.ai/oauth/claude-code-client-metadata', '127.0.0.1:3118'), 'claude');
  // A self-registered client that only calls itself Claude gets nothing, wherever it sends.
  assert.equal(clientBrand('dcr:9a9a', '127.0.0.1:3118'), null);
  assert.equal(clientBrand('https://claude.ai.evil.example/meta.json', '127.0.0.1:1'), null);
  assert.equal(clientBrand('https://evil.example/claude.ai', 'evil.example'), null);
});

test('loopback is this computer by any of its names', () => {
  for (const host of ['127.0.0.1:49205', 'localhost:3118', '[::1]:8080', '127.0.0.1']) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ['claude.ai', 'chatgpt.com', '127.0.0.2:1', 'localhost.evil.example']) assert.equal(isLoopbackHost(host), false, host);
});
```

- [ ] **Step 3: Implement `brand.ts`.**

```ts
// src/server/mcp/brand.ts
import type { BrandName } from '../../lib/brand-marks';

/**
 * The mark an AI app has earned: read from the host its approval goes to, or from the host of the
 * client document it identified itself with (CIMD). Both are things the app cannot choose for
 * itself; the name it gives is, and so the name never decides.
 */
const BY_HOST: Readonly<Record<string, BrandName>> = {
  'claude.ai': 'claude',
  'chatgpt.com': 'openai',
  'openai.com': 'openai',
};

function hostBrand(host: string): BrandName | null {
  const bare = host.toLowerCase().replace(/:\d+$/, '');
  for (const [domain, brand] of Object.entries(BY_HOST)) {
    if (bare === domain || bare.endsWith(`.${domain}`)) return brand;
  }
  return null;
}

export function isLoopbackHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/:\d+$/, '');
  return bare === '127.0.0.1' || bare === 'localhost' || bare === '[::1]';
}

export function clientBrand(clientId: string, redirectHost: string): BrandName | null {
  if (clientId.startsWith('https://')) {
    const fromDocument = hostBrand(new URL(clientId).host);
    if (fromDocument) return fromDocument;
  }
  return isLoopbackHost(redirectHost) ? null : hostBrand(redirectHost);
}
```

  `platform.openai.com` matches through the `.openai.com` suffix rule. `chatgpt.com` and `claude.ai` match exactly.

- [ ] **Step 4: Run the unit test.** Run `node --import tsx --test tests/unit/mcp-brand.test.ts`. It should pass.

- [ ] **Step 5: Thread the mark through the server.**
  - **`describeRequest`:** returns `brand: clientBrand(found.clientId, redirectHost)` and `redirectIsLoopback: isLoopbackHost(redirectHost)`.
  - **`verifyAccessToken`:** joins `mcp_connections.client_id` and `redirect_host` (it already reads the connection) and returns `brand`.
  - **`listConnections`:** selects `client_id` and returns `brand` and `loopback: isLoopbackHost(redirect_host)`.
  - **Integration assertions:**
    - in `mcp-oauth`: a `claude.ai` DCR client's summary has `brand: 'claude'`; a CIMD client on `https://chatgpt.com/…` with a loopback redirect has `brand: 'openai'` and `redirectIsLoopback: true`; a DCR loopback client has `brand: null`;
    - in `mcp-connections`: the list carries `brand` and `loopback`.

- [ ] **Step 6: Change the two screens.**
  - **Consent.** The dark panel's headline becomes `text.thisComputer` when `redirectIsLoopback`, and the `host` drops to a small line under it. The existing loopback warning stays.
  - **Mark beside the title.** Next to the "Connect {client} to your site?" title, show the brand mark at about 32 px when there is one. Otherwise show `Icon name="system"` and append `text.nameGiven` after the client name.
  - **Card list.** Each connection gets the mark, or the `system` icon, beside its name at about 20 px. The sub-line reads `${loopback ? thisComputer : redirectHost} · scope words`.
  - **Copy:**
    - `mcp.thisComputer` = "A program on this computer" / "โปรแกรมบนเครื่องนี้"
    - `mcp.nameGiven` = "(the name it gave)" / "(ชื่อที่โปรแกรมแจ้ง)"
  - **Styling.** Use the existing `.brand-mark` styling. Add only the size rules this needs, beside the plugin card's own brand-mark rule (find it with `grep -rn "brand-mark" src/styles`).

- [ ] **Step 7: Run and commit.**
  - Run `npm run check`, `npm run test:unit`, and `node scripts/test-foundation.mjs` on `tests/integration/mcp-oauth.test.ts` and `tests/integration/mcp-connections.test.ts`.
  - Commit message: `feat: Claude's and OpenAI's marks where an AI app is named, and a program on this computer called one`.

---

### Task 2: Presence, and the owner first

**Files:**
- Create: `src/server/mcp/presence.ts`
- Modify: `src/server/mcp/tools.ts`:
  - `get_post` and `get_page` record a `read` touch after a successful read;
  - `create_draft` records a `write` touch on the new item;
  - `update_draft` checks `ownerIsEditing` first, after `writeRefusal`, and records a `write` touch after success.
- Test: `tests/unit/mcp-presence.test.ts`; extend `tests/integration/mcp-tools.test.ts`.

**Interfaces:**
- Produces:
  - `recordTouch(key: ItemKey, touch: { connectionId: string; clientName: string; brand: BrandName | null; action: 'read' | 'write' }, now?: number): void`
  - `lastTouch(key: ItemKey, now?: number): Touch | null` (only within 3 min)
  - `beat(key: ItemKey, now?: number): void`
  - `ownerIsEditing(key: ItemKey, now?: number): boolean` (a beat < 45 s old)
  - `type ItemKey = \`${'post' | 'page'}:${string}\``
  - `itemKey(kind, id)`
  - a test seam, `resetPresenceForTest()`

- [ ] **Step 1: Write the failing unit test.**

```ts
// tests/unit/mcp-presence.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { beat, itemKey, lastTouch, ownerIsEditing, recordTouch, resetPresenceForTest } from '../../src/server/mcp/presence';

const key = itemKey('post', '11111111-1111-4111-8111-111111111111');
const touch = { connectionId: 'c1', clientName: 'Claude', brand: 'claude' as const, action: 'read' as const };

test('an AI touch is shown for three minutes, then forgotten', () => {
  resetPresenceForTest();
  recordTouch(key, touch, 1_000_000);
  assert.equal(lastTouch(key, 1_000_000 + 180_000)?.clientName, 'Claude');
  assert.equal(lastTouch(key, 1_000_000 + 180_001), null);
});

test('the owner holds a draft for 45 seconds after the last beat, from any tab', () => {
  resetPresenceForTest();
  beat(key, 0);
  assert.equal(ownerIsEditing(key, 44_999), true);
  beat(key, 30_000); // a second tab
  assert.equal(ownerIsEditing(key, 74_999), true);
  assert.equal(ownerIsEditing(key, 75_000), false);
  assert.equal(ownerIsEditing(itemKey('page', 'x'), 0), false);
});

test('each store keeps at most 500 items, dropping the oldest', () => {
  resetPresenceForTest();
  for (let i = 0; i < 501; i += 1) beat(itemKey('post', String(i)), 0);
  assert.equal(ownerIsEditing(itemKey('post', '0'), 1), false);
  assert.equal(ownerIsEditing(itemKey('post', '500'), 1), true);
});
```

- [ ] **Step 2: Implement `presence.ts`.**
  - Use two `Map`s: re-insert a key on each write so iteration order is the age order, and delete the first key while `size > 500`.
  - The functions take `now = Date.now()`.
  - Add `ponytail:` comments: the stores are in memory and a restart forgets them (at most 45 s and 3 min); one app process serves a site; a table is the upgrade path.

- [ ] **Step 3: Wire it into the tools.**
  - In `update_draft`, after `writeRefusal()` and before loading the item:

    ```ts
    if (ownerIsEditing(itemKey(args.kind, args.id))) {
      return refuse('The owner has this draft open in the editor. Ask them to close it, or create a new draft instead.');
    }
    ```

  - Record touches with `token.clientName` and `token.brand`.

- [ ] **Step 4: Integration tests, added to `mcp-tools.test.ts`.**
  - Call `beat(itemKey('post', id))`. `update_draft` is then refused: `updated_at` is unchanged and there is no snapshot row.
  - Call `beat` with `Date.now() - 46_000`. `update_draft` then succeeds.
  - `create_draft` and `get_post` succeed while a beat is fresh.
  - `get_post` and `update_draft` each leave `lastTouch` set, with the right action and brand.
  - `list_posts` and `search_content` leave no touch.
  - Call `resetPresenceForTest()` in each test's setup.

- [ ] **Step 5: Run and commit.**
  - Run the unit file, `mcp-tools`, `npm run check` and `npm run test:unit`.
  - Commit message: `feat: an AI waits while the owner has a draft open, and its reads and writes are remembered for the editor`.

---

### Task 3: The editor's status bar and heartbeat

**Files:**
- Create: `src/pages/api/admin/editing.ts`
- Create: `src/components/admin/EditingStatus.tsx`
- Create: `src/lib/editing-poll.ts`: a pure gate, `shouldBeat(visibility: DocumentVisibilityState): boolean`, plus the relative-time helper, so both can be unit-tested.
- Modify: `src/pages/admin/edit/[id].astro` and `src/pages/admin/pages/edit/[id].astro`: render `<EditingStatus client:load …/>` above the editor, beside `AiUndoBar`, for any saved post or page.
- Modify: `src/lib/admin-i18n.ts`: an `editing` block.
- Test: `tests/unit/editing-poll.test.ts`, `tests/integration/mcp-editing-route.test.ts`, and an extension of `tests/e2e/mcp.spec.ts`.

**Interfaces:**
- Consumes (Task 2): `beat`, `lastTouch` and `itemKey`.
- Consumes (Task 1): `BrandMark`.
- Produces: `POST /api/admin/editing` with body `{ kind, id, updatedAt }`, answering `{ ai: { clientName, brand, action, at } | null, newer: boolean }`.

- [ ] **Step 1: The route.**
  - Checks, in the order the other admin routes use: `requireInstalledOwner`, then `assertSameOrigin`, then zod `{ kind: z.enum(['post','page']), id: z.uuid(), updatedAt: z.iso.datetime({ offset: true }) }`.
  - Load the item with `getPost` or `getPage`, which are owner-scoped. If it is missing, return 404.
  - Call `beat(itemKey(kind, id))`.
  - `ai`: `lastTouch(...)` when `mcpConfig()` is not null, else `null`. Send `at` as ISO.
  - `newer`: `item.updated_at > updatedAt`, comparing milliseconds.
  - Respond with `Cache-Control: no-store`.

- [ ] **Step 2: Test the route.** `tests/integration/mcp-editing-route.test.ts`:
  - it records a beat, so `ownerIsEditing` becomes true;
  - another owner's item gives 404;
  - a bad origin gives 403;
  - with MCP off it still returns 200 with `ai: null`;
  - `newer` is true after an `updatePost` with a later `updated_at`.

  Call the route module's `POST` directly, as `mcp-connections.test.ts` does.

- [ ] **Step 3: The island.**

  **Polling.** `EditingStatus` polls on mount and then every 15 s. It polls only while `shouldBeat(document.visibilityState)` is true. On `visibilitychange` to visible, it polls at once.

  **What it shows:**
  - when `ai` is set, the mark (or the `system` icon) and either `fill(text.read, { client, when })` or `fill(text.wrote, { client, when })`, followed by `text.youFirst`;
  - when `newer` is true, `text.newer` with a **Load the latest** button that calls `location.reload()`. The editor's own unsaved-changes prompt guards anything that is not yet saved.

  **Relative time.** `when` comes from `relativeTime(at, now, locale)` in `editing-poll.ts`, built on `Intl.RelativeTimeFormat` with values like "1 นาทีที่แล้ว" or "1 minute ago". It updates on each poll.

  **Accessibility.** The bar is `role="status"`.

  **Copy (en / th):**
  - `editing.read`: "{client} read this draft {when}." / "{client} อ่านฉบับร่างนี้{when}"
  - `editing.wrote`: "{client} changed this draft {when}." / "{client} แก้ฉบับร่างนี้{when}"
  - `editing.youFirst`: "While you have it open, an AI cannot change it." / "ระหว่างที่คุณเปิดหน้านี้อยู่ AI จะแก้ฉบับร่างนี้ไม่ได้"
  - `editing.newer`: "This draft was changed elsewhere." / "ฉบับร่างนี้ถูกแก้จากที่อื่น"
  - `editing.loadLatest`: "Load the latest" / "โหลดฉบับล่าสุด"

  **Thai spacing.** Check that the Thai joins naturally with `{when}`, which is "เมื่อ 1 นาทีที่แล้ว" in Thai. Adjust the template so there is a natural space.

- [ ] **Step 4: Unit test the pure helpers.** In `editing-poll.test.ts`:
  - `shouldBeat('visible')` is true;
  - `shouldBeat('hidden')` is false;
  - `relativeTime` gives a minutes value in both locales.

- [ ] **Step 5: Extend the e2e.** In `tests/e2e/mcp.spec.ts`, after the existing flow and before Revoke:
  1. Open the AI's draft in the editor.
  2. Call `get_post` from the test client. Within 20 s, expect the bar `/Claude Code read this draft/` (or the client name the test uses).
  3. Call `update_draft` from the test client. Expect a tool error naming "open in the editor".
  4. Navigate away to the posts list, then `await page.clock.fastForward(50_000)` (or `test.slow()` and a real wait, if the clock API does not reach the server; then assert through the tool with a 46-s-old beat seeded through the test seam instead).
  5. `update_draft` now succeeds.
  6. Reopen: the editor shows the new text.

  Take screenshots of the bar at 390 px and 1440 px, kept outside `test-results/`.

- [ ] **Step 6: Run and commit.**
  - Run `npm run check`, `npm run test:unit`, the new integration file, `mcp-tools`, and the e2e.
  - Commit message: `feat: the editor shows an AI app at work on a draft, and keeps the draft the owner's while it is open`.

---

### Task 4: Docs and the spec in line

**Files:**
- Modify: `website/src/content/docs/extending/mcp.md` and `th/extending/mcp.md`.
- Modify: `docs/specs/2026-10-01-mcp-presence-and-marks-design.md`, only where the build differed.

- [ ] **Step 1: Add the docs section.** Add "While you edit" / "ระหว่างที่คุณแก้ไข" after "Putting a draft back". It says three things:
  - the bar tells you an app read or changed the draft in the last few minutes;
  - while you have a draft open, an app cannot change it and is told to wait or make a new draft;
  - it can write again about 45 seconds after you close the draft or switch away from its tab.

  Add one sentence about the marks: a mark appears only for an app whose identity the site could check (Claude and ChatGPT/Codex). Any other app shows a computer icon and the name it gave.
- [ ] **Step 2: Check and commit.**
  - Run the docs check: `cd website && npm run check && npm run build`.
  - Commit message: `docs: an AI app at work on a draft, the owner first, and the marks`.

---

## After the plan

Release **1.8.0** through the usual flow:
- no migration, so the updater takes a database-only backup;
- the notes cover presence, the owner-first rule, the marks, loopback naming, and the docs already on develop (example prompts, and the ChatGPT/Codex steps).

On daedalus:
1. Open a draft and ask Claude to read it, then to change it. The bar shows the read, and the change is refused.
2. Close the editor and wait a minute. The change goes through.
3. Check the marks for Claude and Codex.
