---
title: Updates and clean-up
description: Install an update with sudo tome update, clear old images and media files nothing points at with sudo tome prune, and what to do when the disk is full.
sidebar:
  order: 4
---

These two commands keep a managed server up to date and its disk from filling up.

## tome update

Installs the newest stable release, or the version you name, the way "System" does:

```sh
sudo tome update
sudo tome update 1.11.0
```

With no version, it asks GitHub for the newest stable release, the same check the admin makes, and shows it next to the installed one with a link to its release notes. When you are already on it, it says `TomeCMS 1.11.0 is up to date.` and exits 0. Then it asks:

```text
Install 1.11.0? The updater checks the release, backs up the database (or everything, when the release has a migration) and puts the site in maintenance for a few minutes. [y/N]
```

Answer `y` and it follows the update to its end, one line per step, with the names "System" uses: from `[1/8] Check prerequisites` to `[8/8] Check application health`, then `TomeCMS 1.11.0 is installed.` If the update fails, it prints the error code's meaning and what to do, and says which version is running again.

**There is no passkey here.** "System" asks for your passkey to be sure it is you at the keyboard. Running `sudo` on the server already means full control of it, so a passkey would prove nothing. Everything else is the same as in the admin: the updater still verifies the release against its attestations, checks that it is compatible, makes the backup and puts the previous version back when the new one does not come up.

| Argument or option | What it does |
| --- | --- |
| `version` | An exact release such as `1.11.0`. The installed version is reported up to date, with exit code 0, and only an older one is refused. |
| `-y`, `--yes` | Does not ask first. |

It exits 1 when you decline, when the release is not one this server can take directly, when the server's updater is too old for it (the message names `sudo npm run updater:upgrade`), when GitHub cannot be reached, and when an update, a backup, a restore or an image clean-up is already running.

## tome prune

Clears what a server leaves behind: the old TomeCMS images that every update used to leave on the disk, and media files in storage that nothing on the site points at. It is a dry run unless you add `--yes` or `--orphans`:

```text
$ sudo tome prune
These old application images can go:
  sha256:bbbbbbbbbbbb  1.1 GiB
  sha256:cccccccccccc  718 MiB
Total: about 1.8 GiB.
Remove them with: sudo tome prune --yes
These media files are over a day old, and nothing on the site points at them:
  owners/5b0e1f3c-2d4a-4e6b-8c9d-0a1b2c3d4e5f/2026/09/3f2a9c1e-7b4d-4e8a-9c2f-1d6e5a4b3c2d.jpg
Total: 1 file, 2.4 MiB.
Delete them with: sudo tome prune --orphans
```

### Old images

`sudo tome prune --yes` removes them and prints what went (`Removed sha256:…`) and `Freed about 1.8 GiB.` The updater applies the rules it uses after a successful update:

- only the official application images, `ghcr.io/dhanabhon/tome-cms`;
- only untagged ones, and never the PostgreSQL or SeaweedFS images;
- always keeping the installed image and the one before it, which a rollback needs;
- nothing at all when Docker's list of images cannot be read in full. It says so and exits 1.

An image a stopped container still uses cannot be removed. `tome` says how many it left. With nothing to remove it says `No old application images to remove.` and exits 0. It refuses while an update, a backup, a restore or another clean-up is running.

### Media files nothing points at

A file can stay in storage after nothing points at it: the server stopped between an upload and its record, a delete failed, or the site went back to 1.19 after 1.20 had made smaller copies of its images. Such files take space, and [resetting the installation](/tome-cms/running/recovery/) refuses a bucket that holds them.

The list holds only files under the names TomeCMS gives, that no media item, smaller copy, logo, icon, share image or upload in progress points at, and that are over a day old, so an upload still on its way is never touched. Another app's files in the bucket are never listed. It names the first 50 and counts the rest. After you restore an older or a database-only backup, files uploaded after that backup count as files nothing points at, and `--orphans` deletes those that are over a day old. Do not sweep soon after such a restore unless you mean to stay on it.

`sudo tome prune --orphans` deletes them and prints `Deleted 3 media files nothing pointed at.` Just before each batch it asks the database again, so a file that came into use while it ran is kept. A file it cannot delete does not stop the rest: it says how many, exits 1, and running it again takes them. With nothing to delete it says `No media files are left with nothing pointing at them.`

The list needs TomeCMS 1.21.0 or newer; on an older site `sudo tome prune` leaves it out, and `--orphans` refuses with the version to update to. An older `tome` does not know `--orphans`: it prints its usage and exits 2, so run `sudo npm run updater:upgrade` as [Upgrading the updater](/tome-cms/running/updating/#upgrading-the-updater) shows. It also refuses while the site is in maintenance or the updater is busy. In a source checkout, `npm run media:cleanup -- --orphans` lists the same files with the site, database and bucket it checked, and `npm run media:cleanup -- --orphans --execute` deletes them after you type a line naming all three.

The sweep knows only its own site's database. When two TomeCMS sites share one bucket, such as staging and production, or several checkouts on one local SeaweedFS, each site's files look like files nothing points at to the other. Do not sweep a shared bucket: give each site its own bucket. A managed server has its own SeaweedFS, so its bucket is not shared.

| Option | What it does |
| --- | --- |
| `-y`, `--yes` | Removes the images instead of only listing them. |
| `--orphans` | Deletes the media files nothing points at instead of only listing them. |

## When the disk is full

A full disk is where `tome` helps most. When there is less than 5 GiB free where backups go, an update, a backup, a restore, an export or an import refuses with `Not enough free disk space where backups go`, and `tome status` shows the warning.

1. See how much is free, and which old images can go:

   ```sh
   sudo tome status
   sudo tome prune
   ```

2. Remove the images with `sudo tome prune --yes`. The updater never deletes old backups. Copy off the server any you want to keep, then remove them from `/var/backups/tome-cms/`.
3. Run `sudo tome status` again to see the new free space.

If the disk filled up while a backup was running, the updater may not have been able to write the end of its record. Then `tome status` flags the backup as stuck, with no job running:

```text
Warning: A backup is stuck at "backing_up" with no job running: the updater could not write its end, most likely because the disk is full. Free some space (sudo tome prune shows old images that can go), then run: sudo systemctl restart tomecms-updater
```

Free the space first, then restart the updater:

```sh
sudo systemctl restart tomecms-updater
```

The updater starts the application again even when it cannot write the record, but until it is restarted the stuck record keeps refusing updates and backups. On start it ends the record, and starts the application if it is down. [Troubleshooting](/tome-cms/running/troubleshooting/) lists the messages you may meet.
