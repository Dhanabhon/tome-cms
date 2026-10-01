# MCP: who is working on a draft, the owner first, and the apps' marks

Date: 2026-10-01
Status: Design, for the owner's approval before planning

This builds on 1.7.0 (`docs/specs/2026-10-01-mcp-design.md`). An AI app connected over MCP can read a
draft and then, a minute or two later, write it. The owner may be editing that same draft in the
meantime. Today nothing is overwritten: both sides send `updatedAt`, and the later save gets 409. But
it is the owner who loses. The editor's next autosave fails ([Editor.tsx:120](../../src/components/admin/Editor.tsx)),
and reloading throws away whatever was typed since. This release makes the editor say what an AI is
doing, and makes the AI wait for the owner, not the other way round. It also gives Claude and ChatGPT
their marks on the consent screen and in the connections list.

## What was decided before this was written

The owner decided each of these on 2026-10-01.

- **Show and yield, never lock the owner out.**
  - An AI that reads or writes a draft is shown in the editor ("ก", presence).
  - While the owner has a draft open, an AI cannot write it ("ข", the owner first).
  - The editor never becomes read-only because of an AI. The reasons:
    - an MCP call is one stateless request, and the server cannot know when an AI has finished;
    - a lock on every read would freeze every post an AI merely looked at;
    - the owner decides and the AI helps, not the reverse.
- **Marks:** Claude's and ChatGPT/Codex's marks appear on the consent screen and in the connections
  list. They come from thesvg.org, unmodified, the way Cloudflare's already does
  (`src/lib/brand-marks.ts`).
- **A program on this computer is named as one.** For a loopback approval, the screen and the list
  read "โปรแกรมบนเครื่องนี้" (a program on this computer), with the `127.0.0.1:49205` address small
  beneath. Today the bare address is the headline.

## 1. Presence: what the editor shows

The server keeps, per post or page, the last AI touch: which connection, its app name, read or write,
and when. **Every** read and write tool records one: `get_post`/`get_page`, `create_draft` for the
new draft, and `update_draft`. List and search tools do not, because they touch many items at once
and say nothing about one.

While a draft is open, the editor asks the server every **15 seconds**, and only while its tab is
visible. One request carries both directions:

- **Editor → server:** "I have this draft open" (the heartbeat, section 2), plus the `updatedAt` it
  holds.
- **Server → editor:** the last AI touch, if there was one in the last **3 minutes**, and whether the
  draft's stored `updatedAt` is newer than the editor's.

The bar above the editor, beside the existing Put back bar:

| State | Bar (th / en) |
|---|---|
| An AI read it within 3 min | "Claude อ่านฉบับร่างนี้เมื่อ 1 นาทีที่แล้ว ระหว่างที่คุณเปิดหน้านี้อยู่ AI จะแก้ฉบับร่างนี้ไม่ได้" / "Claude read this draft 1 minute ago. While you have it open, an AI cannot change it." |
| The stored draft is newer than the editor's | "ฉบับร่างนี้ถูกแก้จากที่อื่น · [โหลดฉบับล่าสุด]" / "This draft was changed elsewhere · [Load the latest]" |

The second state can still happen: from another tab, or when an AI wrote just before the editor
opened. **Load the latest** reloads the page. If the editor has unsaved changes, the editor's own
unsaved-changes prompt asks first.

The bar's time is relative ("เมื่อ 1 นาทีที่แล้ว", "1 minute ago") and is refreshed on each check.

## 2. The owner first: an AI cannot write an open draft

- The 15-second check is also the editor's heartbeat. The server keeps, per post or page, when the
  owner last checked in.
- `update_draft` refuses while the owner's last heartbeat for that item is less than **45 seconds**
  old. The refusal goes back to the AI as a tool error it can act on:
  - "The owner has this draft open in the editor. Ask them to close it, or create a new draft
    instead."
  - Nothing is written, and no undo copy is taken.
- Reading is never refused. `create_draft` is never refused either: a new draft is open nowhere yet.
- **The heartbeat stops on its own.** Closing the tab, or leaving it hidden, ends it, and 45 seconds
  later the AI may write again. There is no lock to release and nothing to get stuck.
- **Put back** (the owner's own action) is unaffected.

## 3. Where it is kept

Presence and heartbeats live in the app's memory, not in the database:
- two Maps keyed by `post:<id>` / `page:<id>`;
- each holds at most 500 entries, and the oldest is dropped first;
- an entry expires on read once it is past its window.

`ponytail:` a restart forgets them, which costs at most 45 seconds of the owner-first rule and
3 minutes of the AI status. One app process serves a TomeCMS site, as the pending OAuth requests
already assume. A table is the upgrade if that ever changes.

So **no migration**, and an update from 1.7.0 takes a database-only backup.

## 4. The route

`POST /api/admin/editing` takes `{ kind: 'post' | 'page', id: uuid, updatedAt: iso }`.
- **Checks:** `requireInstalledOwner`, `assertSameOrigin`, strict zod. The item must be the owner's,
  or the answer is 404.
- **It records** the heartbeat.
- **It returns:**
  - `{ ai: { clientName, brand, action: 'read' | 'write', at } | null, newer: boolean }`;
  - `brand` is the mark the connection earned (section 5), or `null`.
- **While MCP is off:**
  - it still answers, with `ai: null`;
  - the editor stops showing AI status;
  - `newer` still works, because "changed elsewhere" is useful without MCP too.

## 5. Marks: Claude, ChatGPT and Codex

`BRAND_MARKS` gains `claude` and `openai`, from thesvg.org unmodified, under the file's existing
trademark note.

A connection's mark is decided by something the app **cannot choose for itself**:

| How the app connected | Mark |
|---|---|
| Approval goes to `claude.ai` | `claude` |
| Approval goes to `chatgpt.com` | `openai` |
| A CIMD client whose `client_id` is on `claude.ai` (Claude Code) | `claude` |
| A CIMD client whose `client_id` is on `openai.com` or `chatgpt.com` | `openai` |
| Anything else, including a DCR client on loopback that only *calls itself* "Codex" | no mark; a generic computer icon, and the name followed by "(ชื่อที่โปรแกรมแจ้ง)" / "(the name it gave)" |

The rule is the same on the consent screen, where a borrowed logo would be phishing, and in the
connections list.

**Settled on daedalus (2026-10-01).** Both real clients identify themselves by CIMD:

| kind | client_id | name |
|---|---|---|
| cimd | `https://claude.ai/oauth/mcp-oauth-client-metadata` | Claude |
| cimd | `https://chatgpt.com/oauth/codex/client.json` | Codex |

Claude on the web gets `claude` from both its redirect and its `client_id`. Codex, from the ChatGPT
desktop app, uses a loopback redirect, but its `client_id` is on `chatgpt.com`, so it gets `openai`
by the rule above. No exception is needed. The mark goes by the **host** of the `client_id`
(`claude.ai`; `chatgpt.com` or `openai.com`), never by the name.

The query that settled it:

```sh
sudo docker exec -i $(sudo docker ps -qf name=postgres) psql -U tomecms -d tomecms -c "select kind, left(id, 80) as id, name from mcp_clients;"
```

## 6. Loopback, named as such

- **Consent screen:** for an approval going to loopback, the large line reads "โปรแกรมบนเครื่องนี้"
  / "A program on this computer". The `127.0.0.1:49205` address goes on a small line under it. The
  existing warning stays.
- **Connections list:** the line under the app's name reads "โปรแกรมบนเครื่องนี้ · อ่านและเขียนฉบับร่าง"
  (a program on this computer · reads and writes drafts) instead of the bare address.

## 7. Docs

The MCP page, in both languages, gains:
- a short "While you edit" section: what the bar means, that an AI waits while you have a draft
  open, and that it can write again 45 seconds after you close it;
- the marks rule, in one sentence.

The example prompts and the ChatGPT/Codex connection steps already on develop ship with this release.

## Tests

- **Unit:**
  - the presence Map: window, expiry and cap;
  - the heartbeat rule at 44 s and 46 s, with an injected clock;
  - `clientBrand` for every row of the table in section 5, including a DCR client named "Claude" on
    loopback, which gets no mark.
- **Integration:**
  - `update_draft` refused while a heartbeat is fresh, and allowed after it lapses (clock injected);
  - `create_draft` and reads never refused;
  - every read and write tool records presence;
  - `/api/admin/editing` scoped to the owner, refused across origins, `ai: null` while MCP is off,
    and `newer` right after an AI write.
- **Browser** (extending `tests/e2e/mcp.spec.ts`):
  - open a draft and have the test client `get_post` it: the bar says the app read it;
  - `update_draft` is refused while the editor is open;
  - close the editor and wait past the window (or advance the clock): the write goes through;
  - reopen: the editor shows the new text.
  - The consent screen and the card show the Claude mark for a `claude.ai` client and the computer
    icon for an unverified loopback one, at 390 px and 1440 px.

## Release

**1.8.0**: a feature, with no migration and no new dependency.

## Left for later

- A live push (server-sent events) instead of a 15-second check. Not needed at this scale.
- Showing AI presence on the posts list.
- More marks (Cursor, other clients), each added by the same rule.
