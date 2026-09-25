---
title: Sticky Banner
description: Put a band with a sentence and a link across the top of every public page, in each language, and choose whether readers can close it.
sidebar:
  order: 3
---

Sticky Banner puts a band across the top of every public page, above the theme's header. It holds a sentence you write for each language, and a link if you give it one. Use it for news a reader should see wherever they land, such as a closure over a holiday or a new address.

## Setting it up

Sticky Banner needs no setting before it can be switched on, so its card says "Off" rather than "Not set up yet". Press "Set up" on the "Sticky Banner" card, fill in what you want and press "Save". Then switch it on. [Cloudflare Turnstile](/tome-cms/plugins/turnstile/) describes the Plugins screen.

| Setting | In Thai | What it does |
| --- | --- | --- |
| "Message (English)" | "ข้อความ (อังกฤษ)" | The sentence on English pages. |
| "Message (Thai)" | "ข้อความ (ไทย)" | The sentence on Thai pages. A language left empty shows the other language's message. With both empty, there is no band. |
| "Link" | "ลิงก์" | Optional. A path on this site, such as `/contact`, or an `https` address. Anything else is ignored, and the band shows without a link. |
| "Link text" | "ข้อความของลิงก์" | The words of the link, after the message. A link shows only when it has both an address and words. |
| "Readers can close it" | "ให้ผู้อ่านปิดแถบเองได้" | On to begin with. It puts a close button at the end of the band. Off keeps the band up for everyone, and the page carries no script for it at all. |
| "Background" | "สีพื้นหลัง" | The band's colour, black to begin with. |
| "Text" | "สีตัวอักษร" | The colour of the words and the link, white to begin with. Pick one that reads against the background: pale on dark, or dark on pale. |

There is one link, and its address and words are the same on pages in both languages.

## What readers see

The band sits at the very top of the home page, every post and every page, and scrolls away with the page. The theme previews on the "Themes" screen show it too.

With "Readers can close it" on, the band has a close button marked with a cross, named "Close announcement" for screen readers. A reader who presses it sees the band slide away, or go at once if they asked their device for less motion. It stays closed for them on every page in that language. When you change the message, the band comes back for everyone, because what a reader closed was that message.

## What it keeps and sends

Sticky Banner talks to no service outside your site. When a reader closes the band, their browser keeps `notice-` followed by a number made from the message, in `localStorage`, and sends nothing to the server. A band that readers cannot close writes nothing. [What a reader's browser keeps](/tome-cms/running/privacy/) lists this beside everything else the site stores in a reader's browser.
