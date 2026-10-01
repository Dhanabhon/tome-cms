---
title: Connecting an AI app (MCP)
description: Let Claude, ChatGPT or another AI app read your posts and pages and write drafts, after you allow it with your passkey.
sidebar:
  order: 3
---

MCP is how an AI app such as Claude or ChatGPT talks to other programs. With the MCP plugin on, an AI app you allow can read your site and write drafts for you to look over. It never publishes anything: what it writes waits as a draft until you publish it yourself.

## What an AI can and cannot do

An AI app you connect can:

- read the site's name, languages, time zone and address;
- search your posts and pages, drafts included;
- list your posts, pages, categories and the pictures in your File Manager;
- read a post or a page in full, as Markdown;
- create a new post or page as a draft, or the other-language edition of one;
- change a draft: its text, title, slug, excerpt, search title and description, categories and cover.

It cannot publish, schedule, unpublish or delete anything, and it cannot upload pictures. It uses only pictures already in your File Manager and categories that already exist. It cannot touch menus, redirects, slides, settings, plugins, security or updates, and it never sees a password, a passkey or a plugin's settings.

When you connect, you choose whether the app may write drafts or only read. The plugin's **Allow AI to write drafts** setting stops every connection writing at once, without disconnecting any of them.

### Putting a draft back

When an AI changes a draft, TomeCMS keeps the draft as it was before. Open the draft in the editor and a bar at the top says which app changed it and when. **Put back** returns the draft to how it was before the AI started. If you have edited it yourself since, TomeCMS asks first, because your edits go too.

There is one step of undo. If the AI writes several times in a row, Put back goes to before the first of them. The kept copy is gone once you put it back, publish the draft or delete it.

## While you edit

You come first. While you have a draft open, the editor checks every 15 seconds whether an AI app has read or changed it in the last 3 minutes. If one has, a bar says so, for example "Claude read this draft 1 minute ago. While you have it open, an AI cannot change it." When the **Put back** bar is already showing and names the same app, this bar says only "While you have it open, an AI cannot change it."

While the draft is open, an AI's change to it is refused, and the AI is told to ask you to close the draft or to make a new draft instead. About 45 seconds after you close the draft, or switch to another tab, the AI can change it again. Reading a draft and creating new drafts are never blocked.

If the draft was changed somewhere else, such as from another tab, the bar says "This draft was changed elsewhere" and offers **Load the latest**.

## Switch it on

In the admin, open **Plugins** and switch **MCP** on. The card then shows the address to give your AI app, `https://<your site>/mcp`, with a **Copy** button, and the list of connections.

## Connect Claude

On claude.ai or in Claude Desktop:

1. Open **Settings**, then **Connectors**.
2. Choose **Add custom connector**.
3. Paste `https://<your site>/mcp` and add it.
4. Claude opens your site's admin. Sign in if you need to.
5. A screen asks whether to connect Claude to your site. Check that the address under **Your approval goes back to** is `claude.ai`, choose whether it may write drafts, then press **Allow with passkey** and use your passkey.

For Claude Code, run:

```sh
claude mcp add --transport http tomecms https://<your site>/mcp
```

Then use `/mcp` in Claude Code to sign in. The approval goes back to a program on your computer, so the screen warns you of that: allow it only if you just started it.

## Connect ChatGPT and Codex

In the ChatGPT desktop app, where Codex lives:

1. Open **Settings**, then **Plugins**, and the **MCPs** tab.
2. Press **Add**, then **Add MCP server**.
3. Give it a **Name**, such as your site's name, and choose **Streamable HTTP** as the **Type**.
4. Put `https://<your site>/mcp` in **URL**. Leave **Bearer token env var** and both lists of headers empty: your site signs the app in by itself.
5. Press **Save**. The server appears in the list with an **Authenticate** button. Press it.
6. Your browser opens your site's admin. Sign in if you need to, then allow it with your passkey, as above.

The app receives the approval on your own computer, so under **Your approval goes back to** the screen shows an address such as `127.0.0.1:49205` and warns that it is a program on this computer. That is expected for the desktop app: allow it if you just pressed **Authenticate**. The number after the colon changes each time.

If you connect from ChatGPT on the web instead, under its connector or app settings, the approval goes back to `chatgpt.com`. ChatGPT renames these menus from time to time. If a name here does not match, look for the place where you add an MCP server or a connector by its address.

## What to ask it

Once connected, you talk to the AI app as usual and it uses your site when the question needs it. Name the site, or say "my blog", so it knows where to look. Some examples:

**Finding and reading**

- "What have I written on my blog about passkeys? List the posts with their dates."
- "Which of my drafts have I not touched for over a month?"
- "Read my post *How I moved to a 1 GB server* and tell me which parts are out of date."
- "Which categories does my blog have, and how many posts are in each?"

**Writing a new draft**

- "Write a draft post for my blog in Thai about backing up a VPS, about 800 words, in the voice of my last three posts. Put it in the Notes category."
- "Turn these notes into a draft post on my blog, with headings and a short excerpt: …"
- "Make a draft page on my site called *About*, from this text: …"

**Translating**

- "Make an English draft of my Thai post *ทำไมต้องทำลิงก์สั้น*. Keep the headings and the pictures where they are."

A translation joins the post it comes from, so the two editions stay linked and share their categories.

**Editing a draft**

- "In my draft *Moving to TomeCMS*, tighten the introduction and fix the spelling. Leave the rest as it is."
- "Give my draft about Caddy a better title and a search description under 160 characters."
- "Add a picture from my File Manager that fits the second section of my draft about passkeys."

**Things it will refuse**

- "Publish my draft about backups." It has no way to publish: open the draft and publish it yourself.
- "Delete my old posts about 0.x." It cannot delete anything.
- "Add this image from the web to my draft." It can only place pictures already in your File Manager. Upload the picture first, then ask again.

Some habits help:

- Ask for one draft at a time, and read it in the editor before you publish.
- If you do not like what it changed, **Put back** in the editor returns the draft to how it was.
- If you edit a draft while the AI is working on it, the AI is told the draft changed and has to read it again. It never writes over your edit.

## See and revoke connections

The MCP card on **Plugins** lists every connection: the app's name, where its approval went, whether it can write, when it was connected and when it was last used. The Claude or OpenAI mark appears there, and on the screen where you allow a connection, only when your site could check who the app is: its approval goes back to claude.ai or chatgpt.com, or it identified itself with a client document on claude.ai, chatgpt.com or openai.com, which covers Claude Code and Codex. Any other app shows a computer icon and the name it gave, and an approval sent to a program on your computer reads "A program on this computer". **Revoke** stops a connection at once. To connect that app again, you allow it again with your passkey.

Switching MCP off makes your site stop answering AI apps at once. Switching it on again starts clean: every earlier connection is gone, and each app has to be allowed again.

## Privacy

What a tool returns goes to the company that runs that AI app, and is handled under its terms. That includes drafts, which are not public on your site. Connect only apps whose provider you are content to show your posts and pages to, and revoke a connection you no longer use.

## For other MCP clients

TomeCMS accepts Claude, ChatGPT and programs on your own computer without any setup. Another AI app may send its approval somewhere else. If connecting it fails with a request that is not valid, add the address it uses to the plugin's **More redirect addresses** setting, under **Set up** on the MCP card. Separate several with commas. Each must be an `https` address, or one on this computer (`http://localhost` or `http://127.0.0.1`).
