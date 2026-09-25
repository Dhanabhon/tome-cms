---
title: Popup
description: Open a box over the public site with a heading, a few words, a button and a picture, after a moment or as the reader leaves.
sidebar:
  order: 4
---

Popup opens a box over a public page with a heading, a few words and a button, and a picture if you give it one. It opens after a few seconds, or as the reader is about to leave, on every page or on the home page only. Once a reader closes it, it stays closed for them until you change what it says.

## Setting it up

The popup needs a "Button link", so its card says "Not set up yet" until you give it one. Press "Set up" on the "Popup" card, fill in the popup for one language or both, and press "Save". Then switch it on. [Cloudflare Turnstile](/tome-cms/plugins/turnstile/) describes the Plugins screen.

Once it is on, the drawer has "Preview on the site", which opens the home page with the popup already open, even if you closed it there before. While it is off, the drawer says "Switch it on to preview it on the site."

| Setting | In Thai | What it does |
| --- | --- | --- |
| "Picture" | "รูปภาพ" | Optional. "Choose picture" picks one from the File Manager, and "Remove picture" takes it off. It sits beside the words, or above them on a phone. |
| "Heading (Thai)", "Heading (English)" | "หัวข้อ (ไทย)", "หัวข้อ (อังกฤษ)" | The popup's heading in each language. A language with no heading shows the other language's popup instead, all of it, so a Thai heading never sits over an English button. |
| "Message (Thai)", "Message (English)" | "ข้อความ (ไทย)", "ข้อความ (อังกฤษ)" | Optional words under the heading. |
| "Button text (Thai)", "Button text (English)" | "ข้อความบนปุ่ม (ไทย)", "ข้อความบนปุ่ม (อังกฤษ)" | The words on the button. A language needs a heading and button text for its popup to show. |
| "Decline (Thai)", "Decline (English)" | "คำปฏิเสธ (ไทย)", "คำปฏิเสธ (อังกฤษ)" | The words on the second button, which closes the popup. Left empty, it says "No thanks" on English pages and "ไม่ล่ะ ขอบคุณ" on Thai ones. |
| "Small print (Thai)", "Small print (English)" | "หมายเหตุตัวเล็ก (ไทย)", "หมายเหตุตัวเล็ก (อังกฤษ)" | Optional. A line in small type at the bottom of the box. |
| "Button link" | "ลิงก์ของปุ่ม" | Where the button leads, the same for both languages: a path on this site, such as `/contact`, or an `https` address. With anything else, the popup is not shown. Required. |
| "Opens" | "ขึ้นเมื่อ" | "After a moment" (to begin with), or "As the reader leaves". Leaving means the pointer heading out through the top of the window. On a phone, which has no pointer, it means reading past half the page. |
| "After" | "รอ" | For "After a moment": "5 seconds", "10 seconds" (to begin with) or "20 seconds". |
| "Pages" | "หน้าที่ขึ้น" | "Every page" (to begin with), or "The home page only". |

The picture has to be a ready image in the File Manager. While the popup keeps it, the library refuses to delete it, even with the plugin off, as [The file library](/tome-cms/admin/file-library/) explains.

## What readers see

The popup opens over the page and darkens what is behind it. It never opens over another box, such as a picture opened by [Image lightbox](/tome-cms/plugins/lightbox/): it waits until that one closes.

A reader can close it with the cross in its corner, named "Close this window" for screen readers, with the decline button, with Escape, or by clicking outside the box. Pressing the main button closes it too, on the way to its link. However it closes, the reader's browser remembers, and that popup does not open for them again. Change any of its words, its link or its picture and it is a new popup, which opens again for everyone. The Thai and English popups are closed separately.

The picture is decoration, and a screen reader passes over it, so put everything that matters in the words. The theme previews on the "Themes" screen never show the popup.

## What it keeps and sends

Popup talks to no service outside your site, and its picture comes from your own storage. When a reader closes it, their browser keeps `popup-` followed by a short code made from the popup's content, in `localStorage`, and sends nothing to the server. [What a reader's browser keeps](/tome-cms/running/privacy/) lists this beside everything else the site stores in a reader's browser.
