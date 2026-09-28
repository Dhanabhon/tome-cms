---
title: Troubleshooting
description: Messages you may meet while installing and running TomeCMS, what each one means, and what to do about it.
sidebar:
  order: 8
---

Each entry starts with what you see, word for word, so you can search this page for it. The installer's and the deploy helper's own messages are also in the tables on [Installing on a VPS](/tome-cms/start/install/#if-the-installer-stops).

On a managed install, this command shows the application's log. Several entries below use it:

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

On a server installed with 1.0.1 or 1.0.2, the application ignores the signal to stop. The updater gives up after 30 seconds, and the rollback fails as well, so the application stays stopped and "System" cannot start another update. Check it on the server:

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

`npm run updater:clear-failed` sets aside only an update that stopped before its backup. This one got further, and may have run migrations. Follow [Recovering a managed installation](/tome-cms/running/recovery/#recovering-a-managed-installation) instead.

## Connecting to the server

### `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!`

SSH remembers each server's key, and a server rebuilt from a fresh image has a new one. If you rebuilt the server yourself, remove the old key on your own computer, then connect again and accept the new one:

```sh
ssh-keygen -R your-server-address
```

If you did not rebuild it, stop and find out why the key changed before you connect.

## The application

### `/health/ready` shows `"storage":"unavailable"`

The application reaches the media bucket through `S3_ENDPOINT`, the media origin, and it does not answer. Check that the media host name points at the server, as [Pointing DNS at the server](/tome-cms/start/requirements/#pointing-dns-at-the-server) describes, and that Caddy runs, with `systemctl status caddy`.

### `Storage verification is temporarily unavailable. Try finalizing again.`

This shows when you upload a file in the admin. After the browser uploads the file, the server checks it in the bucket, and here the bucket did not answer that check.

On 1.0.1 and earlier it happened to every upload: SeaweedFS refused the first check that came right after an upload, and the server gave up at once. 1.0.2 waits it out. Update from "System" in the admin, as [Updating](/tome-cms/running/updating/) describes, then upload the file again.

If it still happens on 1.0.2 or later, look at `/health/ready` first, as in the entry above. Then read the application's log with the command at the top of this page. A line that starts `Upload verification failed:` or `Image verification failed:` names the storage error and its status, such as `Unknown 403`.
