---
title: Jev (TypeSafe AI)
description: Let TypeSafe AI read the article you are writing and suggest its categories, a line for its excerpt and a passage for its meta description.
sidebar:
  order: 2
---

Jev (TypeSafe AI) reads the article you are writing and suggests which of your own categories it belongs under. It also picks a line from the article for the excerpt, and a passage for the meta description. The judging is done by TypeSafe AI's service, which your server asks when you press a button in the editor. Nothing is filled in until you press it yourself.

## Setting it up

1. Get an API key from your TypeSafe console.
2. On the "Jev (TypeSafe AI)" card under "Plugins", press "Set up", paste the key into "API key" and press "Save". [Cloudflare Turnstile](/tome-cms/plugins/turnstile/) describes the Plugins screen.
3. Switch it on. The card now says "On".

| Setting | In Thai | What it does |
| --- | --- | --- |
| "API key" | "API key" | The key your server sends with each request to TypeSafe AI. Stored encrypted and never shown again. Leave it blank when you save to keep the one stored. Required. |

## What it adds to the editor

With the plugin on, a post's settings drawer has three more buttons, and a page's has the last two, as [Writing](/tome-cms/admin/writing/) and [Pages and menus](/tome-cms/admin/pages-and-menus/) show:

- "Suggest from the text" offers categories you already have and have not chosen yet, each a chip you press to add it. The ones it is less sure of come after "Perhaps:". It never makes up a category.
- "Suggest a line from the text" offers a sentence from the article for the excerpt, short enough for a card, with "Use this line".
- "Suggest a description from the text" offers a passage for the meta description, short enough for a search result, with "Use as the description".

While it works, the drawer says "Reading the article…". When nothing fits, it says so, as in "Nothing here matches a category you have." or "No line in the article works on its own under the title." When the service does not answer, the drawer says "The suggestion service did not answer. Try again in a moment." Your server waits up to eight seconds, and asks again twice in that time when the service says it is busy.

The words it offers are always yours. TomeCMS picks passages from your article first and asks the service to choose one of them, or none, and keeps an answer only when it is one of those passages. Likewise, the service only says how likely each category is, and TomeCMS decides which to offer.

With the plugin off, the buttons are not there, and nothing is sent anywhere.

## What TypeSafe AI receives

Only when you press one of the three buttons, your server sends a request to `api.typesafe.ai` with:

- your API key
- the article's title, and whether it is in Thai or English
- the article's text as it stands in the editor, saved or not: up to its first 4,000 characters for categories, and up to 6,000 for a line or a description
- for categories, the name of each category you have
- for a line or a description, the passages TomeCMS picked from the text for it to choose from

The request goes from your server, never from a browser. Nothing a reader does reaches TypeSafe AI, and nothing is sent while you type. What TypeSafe AI keeps from a request is set by its own terms. [What a reader's browser keeps](/tome-cms/running/privacy/) lists every service the site can reach.
