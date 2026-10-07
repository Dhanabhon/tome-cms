---
title: Backups and restore with tome
description: Back up a managed server with sudo tome backup, and put a backup back with sudo tome restore.
sidebar:
  label: Backups and restore
  order: 3
---

These two commands make a backup and put one back. [Backups and restore](/tome-cms/running/backups/) explains backups as a whole, including copies you keep off the server.

## tome backup

Asks the updater for a backup, then shows its steps as they happen:

```text
$ sudo tome backup
Back up the database? The site is in maintenance while it runs, about 3 minutes last time. [y/N] y
[1/3] Prepare maintenance
[2/3] Create the backup
[3/3] Restart TomeCMS
Backup saved to /var/backups/tome-cms/tomecms-20261002T110000000Z (12.0 MiB).
```

**The site is offline for a short while.** The updater puts up the maintenance page, stops the application, takes the backup, starts the application again and waits until it is ready, the same steps as the backup in an update. It always starts the application again, even when the backup fails. The prompt says how long the last backup of the same kind took. Without one it says "for a few minutes", and with `--full` that it may take longer, since it copies the media too.

By default the backup holds the database only, which is quick. With `--full` it holds the media bucket too, and the site stays offline longer. [Backups and restore](/tome-cms/running/backups/) explains why you still want your own copies of the media.

| Option | What it does |
| --- | --- |
| `--full` | Backs up the media too, not only the database. |
| `-y`, `--yes` | Does not ask first. |

It refuses, and exits 1, while an update, another backup, a restore or an image clean-up is running, when less than 5 GiB is free where backups go, and when the last update needs manual recovery or a failed restore kept the site in maintenance. If you decline the prompt it prints `Nothing was done.` and exits 1.

## tome restore

Puts a backup back into the site. **Everything on the site is replaced by the backup**: its posts, pages, settings and accounts, and with a full backup its media too.

```sh
sudo tome restore /var/backups/tome-cms/tomecms-20261001T100000000Z
```

```text
$ sudo tome restore /var/backups/tome-cms/tomecms-20261001T100000000Z
Backup: /var/backups/tome-cms/tomecms-20261001T100000000Z
Made 2026-10-01 17:00 by TomeCMS 1.12.1, for https://example.com.
It holds the database and media: 12 posts, 3 pages, 40 media items.
Everything on this site will be replaced by the backup.
Restore this backup? [y/N] y
[1/7] Check the backup
[2/7] Prepare maintenance
[3/7] Create the safety backup
[4/7] Restore the backup
[5/7] Apply database migrations
[6/7] Restart TomeCMS
[7/7] Check the restored site
Restored: 12 posts, 3 pages, 40 media items.
Migrations ran.
The site as it was before the restore is kept in /var/backups/tome-cms/tomecms-20261003T110100000Z.
```

The backup can be one `tome backup` made, full or database only, one an update made, or one copied from another server. For a backup of the database only, the summary says `It holds the database only` and `its media stay as they are`, and the restore leaves the media alone. [Moving to a new server](/tome-cms/running/backups/#moving-to-a-new-server) shows the copy.

What the backup has to be:

- **Directly in `/var/backups/tome-cms`.** Not in a folder inside it, and not a link to somewhere else.
- **Made for this site's address.** A restore never changes the domain, so passkeys keep working.
- **Made by this TomeCMS or an older one.** A backup from a newer version is refused.
- **Whole.** It has its `manifest.json`, every file matches its checksum, and it holds no link or special file.

Once you have said yes, `tome` changes the owner of the backup directory to the updater's user, `tomecms-updater`. The updater runs as that user and could not read it otherwise. A backup copied in with `rsync -a` keeps the owner it had on the old server, which is not the updater's user here, so this matters for a move: `tome restore` sets the owner whatever it is. Nothing outside that directory changes.

A backup that fails a check is refused with one sentence and exit code 1. `tome` checks what it can before it asks, and the updater checks everything again in the first step, every checksum included, while the site is still up. These are the refusals:

| It says | Why |
| --- | --- |
| `That is not a backup directory under /var/backups/tome-cms.` | The path is missing, is not directly inside that directory, or leads outside it. |
| `That backup has no manifest.json, so it was cut off or is not a TomeCMS backup.` | A backup writes its manifest last, so a directory without one was cut off. Do not restore it. |
| `That backup did not pass its checks: its manifest.json does not read as a TomeCMS backup's. Nothing was changed.` | The manifest is damaged or is not a TomeCMS backup's. |
| `That backup holds a link or a special file (objects/link), so nothing was changed.` | A backup made by TomeCMS has only plain files and folders. |
| `That backup is from https://other.example, and this site is https://example.com. A restore keeps the site's address.` | It was made for another domain. |
| `That backup is from TomeCMS 1.14.0, newer than this site's 1.13.0. Update the site to 1.14.0 first: sudo tome update 1.14.0` | A site cannot hold data from a newer version. |
| `This site runs TomeCMS 1.12.0. Restore needs 1.13.0 or newer: sudo tome update` | The application has to carry the restore steps. |
| `The updater is 1.5.0. Restore needs updater 1.6.0: run sudo npm run updater:upgrade from a v1.13.0 checkout.` | [Upgrading the updater](/tome-cms/running/updating/#upgrading-the-updater) shows the commands. |
| `An update, a backup, a restore or an image clean-up is running. Wait for it to finish, then try again; sudo tome status shows it.` | One job runs at a time. |
| `Not enough free disk space where backups go (/var/backups/tome-cms): it needs 5.0 GiB. See which old images can go with: sudo tome prune` | The safety backup of step 3 needs the room a backup needs. |
| `An earlier restore failed and keeps the site in maintenance, so nothing else can run until it is recovered.` | It is followed by the steps out, which [Recovery](/tome-cms/running/recovery/#a-restore-that-kept-the-site-in-maintenance) explains. |
| `The backup did not pass its checks (a file is missing, or does not match its checksum), so nothing was changed. See what happened with: sudo tome logs updater` | The updater's own check of every file found a difference. |

If you decline the question, it prints `Nothing was done.` and exits 1.

Then it follows the job, one line per step. The site is in maintenance from step 2 to the end, and that takes longer the more media the site holds.

1. **Check the backup.** The updater checks every file against the manifest. The site is still up.
2. **Prepare maintenance.** It puts up the maintenance page and stops the application.
3. **Create the safety backup.** It takes a full backup of the site as it is now. If this fails, nothing has been replaced.
4. **Restore the backup.** It empties the database and puts the backup's back. With a full backup it also makes the media bucket equal to the backup's: it uploads every file the backup lists and deletes every TomeCMS file it does not list. A file TomeCMS did not write is left alone.
5. **Apply database migrations.** Only when the backup is from an older version, so this number is skipped otherwise.
6. **Restart TomeCMS.** Everyone is signed out, so you sign in again with your passkey. MCP connections are kept.
7. **Check the restored site.** The application is up and ready. Before the restart, the updater has already compared the restored posts, pages and media items with the backup's counts, and a difference makes the restore fail.

**When a step from the fourth on fails**, the updater puts the safety backup back and opens the site as it was. `tome` says `The restore failed, so the safety backup was put back. See what happened with: sudo tome logs updater` and exits 1. The same happens when the updater itself is stopped in the middle, by a reboot for example. When it starts again, a restore cut off before step 4 has replaced nothing, so it just opens the site. One cut off from step 4 on has the safety backup put back first. A half restored database is never served.

If the safety backup cannot be put back either, the site stays in maintenance with the application stopped, so that no one writes to a database in an unknown state. [Recovery](/tome-cms/running/recovery/#a-restore-that-kept-the-site-in-maintenance) has the steps out.

When it succeeds, it prints the counts it restored, `Migrations ran.` when they did, and where the safety backup is. The updater never deletes backups, so remove the safety backup yourself once you trust the restored site. When a plugin's secret in the backup cannot be opened on this server, because the backup came from a server with other secrets, it lists each one:

```text
These plugin settings could not be opened on this server, so enter them again in each plugin:
  turnstile: secretKey
Issue new recovery codes under Security: the ones you have were made on the old server.
```

When the backup holds no plugin secret at all, it says `If this backup came from another server, issue new recovery codes under Security.` [The checklist after a move](/tome-cms/running/backups/#after-the-move) goes through the rest.

| Argument or option | What it does |
| --- | --- |
| `backup` | The backup directory to restore. |
| `-y`, `--yes` | Does not ask first. |
