---
title: Troubleshooting
description: Messages you may meet while installing and running TomeCMS, what each one means, and what to do about it.
sidebar:
  order: 8
---

Each entry starts with what you see, word for word, so you can search this page for it. The installer's and the deploy helper's own messages are also in the tables on [Installing on a VPS](/tome-cms/start/install/#if-the-installer-stops).

On a managed install, this command shows the application's log. Several entries below use it:

```sh
sudo tome logs app
```

That is [the `tome` command](/tome-cms/cli/), which arrives with `sudo npm run updater:upgrade` from 1.11.0. A server that does not have it yet shows the same log with the long form:

```sh
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env logs --tail 100 app
```

## Installing

### `TOME_CMS_PUBLIC_URL is not set.` or `S3_ENDPOINT is not set.`

The installer reads the two addresses from the shell it runs in, and this shell has none. A new SSH session, or `sudo -i`, starts without the values you exported earlier. Export them again, in the same shell, as step 2 of [Installing on a VPS](/tome-cms/start/install/#2-set-the-three-addresses) shows, then run the installer.

### `TOME_CMS_PUBLIC_URL requires HTTPS without credentials; configure TLS separately.`

The address is not an `https://` address, or it has a user name or password in it. Use the plain `https://` address that DNS points at the server. The 1.0.0 installer also showed this message when the address was not set at all; later versions say so instead.

### `Port 4321 is unavailable.` (or `5432`, `9000`)

Something on the server already listens on that port, most often an earlier TomeCMS install, such as a 0.x one. This shows which program it is:

```sh
ss -tlnp | grep -E ':(4321|9000|5432) '
```

A managed install needs a fresh server. Install there, or remove the earlier install first if you are sure you no longer need it and have a backup of it.

### `Checkout must match the exact stable release tag.`

The folder you run the installer from is not a clean clone of a release tag, for instance a clone of `main` that has moved on since. Check it with `git describe --tags --exact-match` in that folder. It should print the version you pass to `--version`, such as `v1.0.2`. If it does not, clone the tag again, as [Preparing a new server](/tome-cms/start/prepare-server/#run-the-script) shows.

### Installing 1.0.0 stops after it pulls the image

The 1.0.0 installer could not finish on any server: its check of the image's migrations failed. It removes what it created before it stops, so nothing needs cleaning up. Install 1.0.1 or later instead.

## Updating

### The update stops at "Prepare maintenance", and the site answers `502`

On a server installed with 1.0.1 or 1.0.2, the application ignores the signal to stop. The updater gives up after 30 seconds, and the rollback fails as well, so the application stays stopped and "System" cannot start another update. Check it on the server. `sudo tome status` shows the phase on its "Last update" line. The `"backupCreatedAt"` below is only in the updater's own status, which a server without `tome` also has to read this way:

```sh
sudo curl --unix-socket /run/tome-cms/updater.sock http://localhost/v1/status
```

`"phase":"failed_manual_recovery"` with `"backupCreatedAt":null` means the update stopped before its backup: the database and the running version are as they were. Then:

1. Run the application under an init, and start it again on the version it had:

   ```sh
   grep -q '^    init: true' /opt/tome-cms/compose.managed.yaml || sed -i '/^  app:$/a\    init: true' /opt/tome-cms/compose.managed.yaml
   cd /opt/tome-cms && docker compose -p tomecms -f compose.managed.yaml \
     --env-file /etc/tome-cms/tome-cms.env \
     --env-file /var/lib/tome-cms/updater/image.env up -d --wait --no-deps --pull never app
   ```

2. Set the failed update aside, from a checkout of 1.0.3 or later:

   ```sh
   cd /opt/tome-cms-src
   git fetch --depth 1 origin tag v1.0.3
   git checkout --detach v1.0.3
   npm ci
   sudo npm run updater:clear-failed
   ```

   It keeps the record as `job.json.cleared-<id>`, and restarts the updater.
3. Update again from "System".

### `This update made a backup before it failed, so it may have changed the database. Follow the recovery steps instead.`

`npm run updater:clear-failed` sets aside only an update that stopped before its backup, and a restore that kept the site in maintenance. This update got further, and may have run migrations. Follow [Recovering a managed installation](/tome-cms/running/recovery/#recovering-a-managed-installation) instead.

### `Warning: a restore failed (rollback_failed) and keeps the site in maintenance.`

`sudo tome status` shows this after a `sudo tome restore` that failed and could not put the safety backup back. The site shows the maintenance page and the application is stopped, because the database may be half restored, and every other job is refused, with `An earlier restore failed and keeps the site in maintenance, so nothing else can run until it is recovered.` Set the restore aside with `sudo npm run updater:clear-failed` from a checkout of v1.13.0 or newer, then restore the safety backup with `sudo tome restore`. [A restore that kept the site in maintenance](/tome-cms/running/recovery/#a-restore-that-kept-the-site-in-maintenance) has the steps, and what the other codes in that warning mean.

### `The passkey check did not finish. It may have been cancelled. Try again.` when installing an update

This shows on "System" after you confirm an update, although your passkey works: signing out and back in goes through. The line "Release availability" also turns red and says "Check unavailable", although the check worked.

It happens on 1.1.0 and earlier, on a site with the [Cloudflare Turnstile](/tome-cms/plugins/turnstile/) plugin switched on. Asking for your passkey again went through the same sign-in check as signing in, only the sign-in page can pass that check, and the server refused. "Verify and create new codes", under "Recovery codes" on "Security", ran into the same wall and says `The sign-in check was not passed.` Nothing was changed. From 1.1.1 the check is asked for only when there is no session, so an owner who is signed in is not asked.

The running version is the one that asks, so an update started from 1.1.0 or earlier still needs this:

1. Open "Plugins", under "Appearance" in "Configuration", and switch "Cloudflare Turnstile" off. Its keys stay stored.
2. Install the update from "System", as [Updating](/tome-cms/running/updating/) describes.
3. Switch "Cloudflare Turnstile" on again.

### `Not enough free disk space for the backup: the update needs 5 GB free.`

"System" shows this when an update stopped at "Verify the official update". Before it changes anything, the updater checks that the disk holding `/var/backups/tome-cms/` has 5 GB free, and it found less. Nothing changed, and the site kept running.

Only the application from 1.10.0 on, with updater 1.4.0 or later, shows this message. An earlier application, or an earlier updater, refuses in the same way but reports it as `release_unavailable`, and "System" says only that the previous version was restored. On a full disk, that is this entry.

See what takes the space. `sudo tome status` shows the free disk where backups go, and `sudo tome prune` lists the old application images that can go, with their sizes. [The `tome` command](/tome-cms/cli/updates/#when-the-disk-is-full) walks through it. On a server without `tome`, these commands show the same:

```sh
df -h /var/backups/tome-cms
sudo docker system df
```

Before updater 1.4.0, every update left the application image it replaced on the disk, about 750 MB each. `sudo tome prune --yes` removes the old ones. Without `tome`, remove the images that no container uses:

```sh
sudo docker image prune -a --filter "until=24h"
```

It removes every image, from any repository, that was created more than 24 hours ago and that no container uses, running or stopped. The running application, PostgreSQL and SeaweedFS each have a container, so their images stay. The previous version's image goes if it is older than that. The updater never deletes old backups either: copy those you want to keep off the server, then remove them from `/var/backups/tome-cms/`. Then update again from "System".

From updater 1.4.0, a successful update removes the older application images itself, as [Updating](/tome-cms/running/updating/) says.

## Connecting to the server

### `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!`

SSH remembers each server's key, and a server rebuilt from a fresh image has a new one. If you rebuilt the server yourself, remove the old key on your own computer, then connect again and accept the new one:

```sh
ssh-keygen -R your-server-address
```

If you did not rebuild it, stop and find out why the key changed before you connect.

## The application

### `/health/ready` shows `"storage":"unavailable"`

The application reaches the media bucket at `S3_INTERNAL_ENDPOINT` when it is set. On a managed install where it is not set, which includes one updated from the admin, since that keeps its old Compose file, the application defaults to the bundled SeaweedFS at `http://seaweedfs:8333`. Anywhere else it uses `S3_ENDPOINT`, the media origin. That address does not answer. On a managed install from 1.5.2 on, look at the `seaweedfs` container first. Otherwise check that the media host name points at the server, as [Pointing DNS at the server](/tome-cms/start/requirements/#pointing-dns-at-the-server) describes, and that Caddy runs, with `systemctl status caddy`.

### `Storage verification is temporarily unavailable. Try finalizing again.`

This shows when you upload a file in the admin. After the browser uploads the file, the server checks it in the bucket, and here the bucket did not answer that check.

On 1.0.1 and earlier it happened to every upload: SeaweedFS refused the first check that came right after an upload, and the server gave up at once. 1.0.2 waits it out. Update from "System" in the admin, as [Updating](/tome-cms/running/updating/) describes, then upload the file again.

If it happens on a file Cloudflare or another CDN has not cached yet, and the log shows `SignatureDoesNotMatch` or a 403, the cause is the CDN. The application checks the file with a signed request to the media origin, and a CDN in front of storage can fail that request. 1.5.2 fixes this on a managed install: the application now reaches the bundled SeaweedFS directly and the public media address is used only for the browser's upload. Update from "System" in the admin, then upload again. On any other install, set `S3_INTERNAL_ENDPOINT` to an address the application reaches without the CDN, as [the configuration reference](/tome-cms/running/configuration/) describes.

If it still happens on 1.0.2 or later, look at `/health/ready` first, as in the entry above. Then read the application's log with the command at the top of this page. A line that starts `Upload verification failed:`, `Image verification failed:` or `Document verification failed:` names the storage error and its status, such as `Unknown 403`.

### `Too many sign-in attempts. Wait a few minutes and try again.` although you tried once

This is the limit on signing in, 10 attempts in 15 minutes. On 1.1.1 and earlier the application counted every attempt against the reverse proxy in front of it rather than the person who made it, so there was one count for everyone: ten failed requests from anywhere, bots included, kept the owner out for up to fifteen minutes. Your passkey and your account are fine. Wait it out. From 1.1.2 each visitor has a count of their own, as long as the proxy sets `X-Forwarded-For`, as [the reverse proxy](/tome-cms/start/requirements/#the-reverse-proxy) says. The limits on recovery, installing and updating were counted the same way.

### `The request could not be completed.` when deleting a file, removing a logo, or making new recovery codes

On 1.0.3 and earlier, these three requests went out with no content type, and Astro refuses such a request when the site sits behind an HTTPS proxy, which every managed install does. Nothing was changed: the file, the logo and the old codes are all still there. Update to 1.0.4 or later from "System", as [Updating](/tome-cms/running/updating/) describes, and try again.
