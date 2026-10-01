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

## Connect ChatGPT

1. In ChatGPT, open **Settings**, then **Connectors**. On some plans you first turn on developer mode to add your own.
2. Choose **Add**, or **Create**, and paste `https://<your site>/mcp`.
3. Allow it on your site with your passkey, as above. The address under **Your approval goes back to** is `chatgpt.com`.

ChatGPT renames these menus from time to time. If a name here does not match, look for the place in ChatGPT's settings where you add a connector or an app by its address.

## See and revoke connections

The MCP card on **Plugins** lists every connection: the app's name, where its approval went, whether it can write, when it was connected and when it was last used. **Revoke** stops a connection at once. To connect that app again, you allow it again with your passkey.

Switching MCP off makes your site stop answering AI apps at once. Switching it on again starts clean: every earlier connection is gone, and each app has to be allowed again.

## Privacy

What a tool returns goes to the company that runs that AI app, and is handled under its terms. That includes drafts, which are not public on your site. Connect only apps whose provider you are content to show your posts and pages to, and revoke a connection you no longer use.

## For other MCP clients

TomeCMS accepts Claude, ChatGPT and programs on your own computer without any setup. Another AI app may send its approval somewhere else. If connecting it fails with a request that is not valid, add the address it uses to the plugin's **More redirect addresses** setting, under **Set up** on the MCP card. Separate several with commas. Each must be an `https` address, or one on this computer (`http://localhost` or `http://127.0.0.1`).
