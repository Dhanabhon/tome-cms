---
title: Image lightbox
description: Let readers open the pictures in a post or a page at full size, over the page, without leaving it.
sidebar:
  order: 5
---

Image lightbox lets a reader open a picture in a post or a page at full size. The picture opens over the page, and closing it puts the reader back where they were.

## Switching it on

Image lightbox has no settings. Its card says "Off" from the start, and the switch turns it on straight away. [Cloudflare Turnstile](/tome-cms/plugins/turnstile/) describes the Plugins screen.

## What readers see

On a post or a page, every picture in the article can be opened, the cover included. The pointer turns into a magnifying glass over one. A reader clicks it, or reaches it with Tab and presses Enter or Space.

The picture opens large, up to nearly the whole window, over the darkened page, with a "Close image" button. Escape closes it too, and so does a click outside the picture. A picture with alt text keeps it in the lightbox. For one without, a screen reader says "Open the image full size" on the page.

Pictures beside the article are left alone, such as your author picture at the end of a post. So is a video's poster, which plays the video when pressed. The home page is not touched, and loads none of the lightbox's code.

## What it keeps and sends

Image lightbox talks to no service outside your site, and writes nothing to the reader's browser. The lightbox shows the same picture the page already loaded, so it fetches nothing new.
