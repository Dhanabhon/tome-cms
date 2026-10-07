---
title: Status and logs
description: See a managed server on one screen with sudo tome status, and read a service's recent log lines with sudo tome logs.
sidebar:
  order: 2
---

These two commands show what the server is doing. Like every server command, they run with `sudo` and follow the rules on [The tome command](/tome-cms/cli/).

## tome status

Shows the server on one screen and changes nothing:

```text
$ sudo tome status
TomeCMS 1.11.0, updater 1.5.0
Site: ready (migrations: ready)
Containers:
  app        running, healthy
  postgres   running, healthy
  seaweedfs  running, healthy
Free disk where backups go: 10.0 GiB (/var/backups/tome-cms)
Last update: 1.11.0 succeeded, finished 2026-10-02 18:05
Newest backup: database, 1.5 MiB, 2 hours ago (/var/backups/tome-cms/tomecms-20261002T100000000Z)
```

The versions come from the updater. The site line is the application's own `/health/ready`. The disk line is the disk that holds `/var/backups/tome-cms/`. The time of the last update is in the server's own time zone.

Below the disk line, a warning appears when less than 5 GiB is free, which is the least an update or a backup needs. It names `sudo tome prune`. A backup that is stuck is flagged too, as [When the disk is full](/tome-cms/cli/updates/#when-the-disk-is-full) describes.

While a restore is running, a `Restore` line shows it, above the newest backup:

```text
Restore running: at "restoring" since 2026-10-03 11:00
```

A restore whose record stops with no job running is flagged as stuck, like a backup. A restore that failed and kept the site in maintenance shows a warning that starts `Warning: a restore failed (rollback_failed) and keeps the site in maintenance.`, then the steps out, which [Recovery](/tome-cms/running/recovery/#a-restore-that-kept-the-site-in-maintenance) explains. If the updater cannot read the restore's record, one line says so, `Restore: could not be read (…). Check it with: sudo tome logs updater`, and everything else still shows. The same goes for the backup's record, with `Backup: could not be read (…)`. With `--json`, the same is in a `restore` field, which is `null` when no restore is running and none is waiting for recovery.

| Option | What it does |
| --- | --- |
| `--json` | Prints the same as one JSON object, for scripts. |

It exits 1 only when the updater cannot be read: it does not answer, or it answers with something unexpected. Everything else it could read is still shown.

## tome logs

Shows recent log lines of one service, with secrets hidden:

```sh
sudo tome logs                 # the application, 100 lines
sudo tome logs postgres -n 20
sudo tome logs updater -f
```

| Argument or option | What it does |
| --- | --- |
| `app`, `postgres`, `seaweedfs` or `updater` | The service. With none named, `app`. |
| `-n N`, `--lines N` | How many lines, from 1. The default is 100. |
| `-f`, `--follow` | Keeps showing new lines until you press Ctrl+C. |

The first three come from `docker compose logs`, and `updater` from the journal of the `tomecms-updater` service. To hide the secrets, `tome` reads the server's environment file first. If it cannot read it, or cannot hide what is in it safely, it says why, shows nothing and exits 1.
