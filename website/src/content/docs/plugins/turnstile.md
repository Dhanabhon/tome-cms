---
title: Cloudflare Turnstile
description: Put a Cloudflare challenge on the recovery-code form, and switch plugins on and off from the Plugins screen.
sidebar:
  order: 1
---

Cloudflare Turnstile puts a Cloudflare challenge on the recovery-code form at `/recovery`. The server checks each recovery code with Cloudflare before it reads the code, and an attempt that fails the challenge goes no further. A recovery code is the one secret you type, so that is where a guess could be made. Signing in with a passkey never meets the challenge, since a passkey cannot be guessed, and neither does creating the passkey a recovery ends with. Readers never meet it either.

Until 1.17.0 the challenge stood on the sign-in form. It moved because it could refuse a passkey that worked.

## The Plugins screen

"Plugins", under "Appearance" in "Configuration", has a card for each plugin that comes with TomeCMS. Every plugin is off until you switch it on.

![The Plugins screen with five cards: "Cloudflare Turnstile", "Sticky Banner", "Popup", "Image lightbox" and "Jev (TypeSafe AI)". Each card has the plugin's name and what it does, then a band saying where it acts, such as "Admin sign-in" or "Every public page", then a switch and a "Set up" button. Turnstile, Popup and Jev say "Not set up yet", and Sticky Banner and Image lightbox say "Off". Beside the Jev card is "Where plugins come from", and below is "A plugin cannot lock you out".](../../../assets/screenshots/en/plugins.png)

The band on each card says where the plugin acts: "Recovery-code form", "Every public page" or "Suggestions while writing". Pressing the switch at the foot of the card asks first, and says what the plugin will do or stop doing; "Switch on" or "Switch off" makes it apply, and "Cancel" leaves the plugin as it was. The word beside the switch says where it stands: "On", "Off", or "Not set up yet" while a setting the plugin needs is still empty. A plugin that is not set up cannot be switched on.

"Set up" opens the plugin's settings at the side of the screen, under "Set up" and the plugin's name. While something it needs is missing, the top of the drawer says "Fill in what it needs before switching it on." Press "Save" and the card says "Saved." Saving leaves the plugin on or off, as it was.

Some settings are secret, such as a key for another service. A secret is stored encrypted with `TOME_CMS_CONTEXT_SECRET` and is never sent back to the browser, so its field stays empty, and once a key is stored it says "Stored. Leave blank to keep it." Leave it blank and the stored key stays. Type a new one to replace it. [Configuration](/tome-cms/running/configuration/) explains why that secret must not change once the site is installed.

Plugins come with TomeCMS, as the card "Where plugins come from" says, and nothing on this screen installs one. The card "A plugin cannot lock you out" says why: a plugin never stands in front of your passkey, or of the passkey a recovery creates, and a plugin that fails to answer never blocks you. Any plugin can also be switched off from the server with `npm run plugin:disable` and its id: `turnstile`, `typesafe` for Jev, `notice` for Sticky Banner, `popup` or `lightbox`.

## Setting it up

1. In your Cloudflare dashboard, add a Turnstile widget for your site's host name, the one in `TOME_CMS_PUBLIC_URL`. Cloudflare gives it a site key and a secret key.
2. On the "Cloudflare Turnstile" card, press "Set up", paste both keys and press "Save".
3. Switch it on. The card now says "On".

| Setting | In Thai | What it does |
| --- | --- | --- |
| "Site key" | "Site key" | The key that shows the challenge on the recovery-code form. It is public, and it reaches your browser in the form. Required. |
| "Secret key" | "Secret key" | The key the server uses to ask Cloudflare whether a challenge was passed. Stored encrypted and never shown again. Required. |

The challenge appears only while both keys are stored.

## Recovering with it on

The recovery-code form shows the challenge above the "Recovery code" field. Wait for it to finish before you press "Continue securely": pressed earlier, the form says "Wait for the check to finish. If it never appears, run npm run plugin:disable turnstile on the server." and sends nothing. When you press it, the server first sends Cloudflare the challenge's answer and waits up to five seconds for a reply.

| Cloudflare says | What happens |
| --- | --- |
| The challenge was passed | The server goes on to check your recovery code, as usual. |
| The answer is wrong, was used already, or is missing because the challenge never loaded | The attempt is refused, the code is not read, and the form says "The check before recovery was not passed." It tells you to try again, or to switch the plugin off on the server. The server logs Cloudflare's reason. |
| Nothing it can use: the secret key is wrong, Cloudflare answers with an error, cannot be reached, or does not answer in time | The server logs the reason and goes on to check your recovery code. |

Each answer is good for one check. After any attempt that does not start a recovery, the form asks the challenge for a fresh answer, so trying again never sends a spent one.

The last row is why a mistyped secret key cannot lock you out. If the challenge will not load in your browser, switch the plugin off from the server, or make a one-time recovery link there with `npm run admin:recover`: a link does not pass through the form. [Getting back in](/tome-cms/running/recovery/) has both.

When you are signed in and the admin asks for your passkey once more, to install an update or to make new recovery codes, the challenge is neither shown nor checked. On 1.1.0 and earlier it was checked, and those two stopped: see [Troubleshooting](/tome-cms/running/troubleshooting/#the-passkey-check-did-not-finish-it-may-have-been-cancelled-try-again-when-installing-an-update).

## What Cloudflare receives

In your browser, the recovery page at `/recovery` loads Cloudflare's script from `challenges.cloudflare.com`, and the challenge runs there. Cloudflare sees what any site you load something from sees, your address included. No other page loads it, and a reader of the public site never reaches Cloudflare through this plugin.

From the server, each recovery-code attempt sends Cloudflare's `siteverify` address the secret key, the answer the challenge gave your browser, and the address the attempt came from. Nothing about your content or your readers is sent. [What a reader's browser keeps](/tome-cms/running/privacy/) lists every service the site can reach.
