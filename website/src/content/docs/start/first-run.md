---
title: The first-run wizard
description: The six steps that turn a fresh TomeCMS install into a site with an owner, a passkey and a private admin address.
sidebar:
  order: 4
---

Once the deploy helper has finished, open `/install` on the CMS origin, for example `https://cms.example.com/install`. The wizard takes six steps and asks for no password.

It opens in Thai. For English, choose it from the language menu at the top, or open `/install?lang=en`.

Open it at exactly the address in `TOME_CMS_PUBLIC_URL`, over HTTPS. The passkey you create at the end is bound to that host name, and the wizard will not go on from another address.

## Step 1: System readiness

The wizard checks four things, and all four have to show "Ready" before it lets you on:

| Check | What it looks at |
| --- | --- |
| "PostgreSQL database" | The database answers. |
| "Database migrations" | No migration is waiting. |
| "S3-compatible storage" | The bucket answers at `S3_ENDPOINT`. |
| "HTTPS / Passkey identity" | `TOME_CMS_PUBLIC_URL` is HTTPS on a host name, not an IP address, and matches the address you opened. |

A check that fails shows "Needs attention" with a hint. Fix what it names and press "Check again". On today's VPS install, a waiting migration or a stopped container is fixed by running `./scripts/deploy-vps.sh` again. If you opened the wizard at another address, the hint gives the one it expects.

When all four pass, "Name your site" takes you to the next step.

## Step 2: Site details

| Field | What it takes |
| --- | --- |
| "Site name" | The name readers see. Required, up to 120 characters. |
| "Tagline" | A short line under the name, up to 120 characters. |
| "Site description" | A description for the home page and search engines, up to 160 characters. |
| "Default language" | ไทย or English. It starts as the language the wizard is in, and the admin speaks it too. |
| "Timezone" | `Asia/Bangkok` or `UTC`. Dates on the public site and in the admin are shown in this time zone. |
| "Admin path" | The address of the admin. Required. |

All of these except the admin path can be changed later, under "Settings" and then "General".

### The admin path

The field starts as `/admin`. You can choose another, such as `/studio`: a slash followed by 2 to 40 lowercase letters, digits or hyphens, starting with a letter or a digit. Paths the system uses are refused: `/api`, `/install`, `/health`, `/_astro`, `/blog`, `/th`, `/en` and `/recovery`.

Bookmark the address as soon as the wizard is done. The public site has no link to the admin, and once you choose a path other than `/admin`, `/admin` answers `404`. The admin has no setting to change the path afterwards either. You sign in at this address, for example `https://cms.example.com/studio`.

## Step 3: Owner identity

"Owner email" is the owner account's name. Enter a complete address. There is no password to set, because signing in uses a passkey that your device keeps.

## Step 4: Installation token

The token proves that you control the server being installed. The deploy helper printed it at the end of its run, and it is in `.env.local` in the checkout:

```sh
grep '^TOME_CMS_INSTALL_TOKEN=' .env.local
```

The value sits between single quotes. Paste it without them into "Installation token" and press "Verify token". The server checks it, and the wizard does not keep it.

The wizard's "Where is the installation token?" box shows two commands. On today's install, the "Local" one is the right one on a VPS too, because the helper writes `.env.local`. The "VPS" one reads `/etc/tome-cms/tome-cms.env`, which only the managed install from 1.0.0 writes.

A wrong token gets "The installation token is not valid." The wizard allows eight attempts in 15 minutes from one IP address, then asks you to wait. After the token passes, you have 10 minutes to finish the next step. Past that, verify the token again.

## Step 5: Primary Passkey

The wizard shows what it is about to set up: "Website", "Owner", "Passkey RP" (TomeCMS and your host name) and "Admin URL". Press "Create Passkey and install".

Your browser then asks your device to create the passkey, with Touch ID, Windows Hello, a security key or another passkey provider. The passkey is saved as "Primary passkey" and works only on the CMS host name. Create it in an ordinary browser window. A passkey made in a private window may not outlive the window, and the site would then hold a passkey no browser can offer.

When the passkey is created, the wizard saves the site and you are signed in. If you cancel the device's prompt, the wizard says so. Press "Create Passkey and install" to try again, or "Verify a new token" to go back to step 4. If the passkey was created but saving the site failed, the button becomes "Retry finalization".

## Step 6: Recovery codes

The wizard shows ten recovery codes. Each one works once, and this is the only time they are shown. Use "Copy" or "Download .txt" (the file is `tomecms-recovery-codes.txt`) and keep them somewhere other than the device that holds the passkey.

Tick "I saved the recovery codes somewhere safe." and press "Continue to Admin". You arrive in the admin at the path you chose, already signed in.

If you ever have no passkey at hand, a recovery code at `/recovery` lets you register a new passkey and [get back in](/tome-cms/running/recovery/).
