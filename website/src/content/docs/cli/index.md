---
title: The tome command
description: What the tome command is, where it runs, how to install it, the rules every command follows, and a list of every command.
sidebar:
  label: Overview
  order: 1
---

`tome` is a command on a managed server. It puts the long `docker compose …` and `curl --unix-socket …` commands behind short ones that already know where everything is: `sudo tome status`, `sudo tome logs`, `sudo tome backup`, `sudo tome update` and `sudo tome prune`. Three more put a backup back and move your writing: `sudo tome restore`, `sudo tome export` and `sudo tome import`.

In a TomeCMS source checkout, the same program has three more commands, for writing a theme or a plugin. They run with `npm run tome --` and need no `sudo`, as [Themes and plugins](/tome-cms/cli/themes-and-plugins/) explains.

Every server command:

- runs as root, so start it with `sudo`. Run as anyone else, it says so and stops;
- never prints a secret. Passwords, tokens and keys from the server's environment are hidden;
- prints in English, plain and short;
- accepts `--help`, which lists its options.

| Exit code | Meaning |
| --- | --- |
| 0 | It worked. |
| 1 | It failed or was refused. The message says why and what to do. |
| 2 | Wrong usage, such as an unknown command or option. It prints the usage. |

Most changes go through the updater, the service that already installs updates from "System". `tome` never stops a container or deletes an image itself. `export` and `import` are the exception: they run in a short-lived container of the installed application, which `tome` starts and removes, and the site stays up.

## The commands

| Command | What it does |
| --- | --- |
| [`sudo tome status`](/tome-cms/cli/status-and-logs/#tome-status) | Shows the server on one screen and changes nothing. |
| [`sudo tome logs`](/tome-cms/cli/status-and-logs/#tome-logs) | Shows recent log lines of one service, with secrets hidden. |
| [`sudo tome backup`](/tome-cms/cli/backups/#tome-backup) | Asks the updater for a backup, of the database or, with `--full`, of the media too. |
| [`sudo tome restore`](/tome-cms/cli/backups/#tome-restore) | Puts a backup back into the site. |
| [`sudo tome update`](/tome-cms/cli/updates/#tome-update) | Installs the newest stable release, or the version you name, the way "System" does. |
| [`sudo tome prune`](/tome-cms/cli/updates/#tome-prune) | Clears old TomeCMS images and media files in storage that nothing on the site points at. |
| [`sudo tome export`](/tome-cms/cli/export-import/#tome-export) | Writes every post and page, with the media they use, to one Markdown archive. |
| [`sudo tome import`](/tome-cms/cli/export-import/#tome-import) | Adds the posts and pages in an archive to the site. |
| [`npm run tome -- theme new`](/tome-cms/cli/themes-and-plugins/) | Copies an existing theme under a new id and registers it. In a source checkout. |
| [`npm run tome -- plugin new`](/tome-cms/cli/themes-and-plugins/) | Writes a plugin that fills its hook and does nothing yet, switched off. In a source checkout. |
| [`npm run tome -- check`](/tome-cms/cli/themes-and-plugins/) | Checks every theme and plugin, and changes nothing. In a source checkout. |

To free a full disk, see [When the disk is full](/tome-cms/cli/updates/#when-the-disk-is-full).

## Installing

A server installed with 1.11.0 or later has `tome` already. On an existing managed server, update the application to 1.11.0 from "System" first, as [Updating](/tome-cms/running/updating/) describes. Then, from a checkout of 1.11.0, upgrade the updater:

```sh
cd /opt/tome-cms-src
git fetch --depth 1 origin tag v1.11.0
git checkout --detach v1.11.0
npm ci
sudo npm run updater:upgrade -- --dry-run
sudo npm run updater:upgrade
```

A server installed before 1.0.2 has no `/opt/tome-cms-src`. Clone the release there instead of the first three lines:

```sh
git clone --depth 1 --branch v1.11.0 https://github.com/Dhanabhon/tome-cms.git /opt/tome-cms-src
cd /opt/tome-cms-src
```

That one command brings updater 1.5.0 and `tome`, which it installs as `/usr/local/bin/tome`. The updater needs 1.5.0 because `tome backup` and `tome prune` use two requests that earlier updaters do not have. At its end it prints `tome is installed at /usr/local/bin/tome. Try: sudo tome status`. [Upgrading the updater](/tome-cms/running/updating/#upgrading-the-updater) explains the rest, including what `--dry-run` does.

`tome restore`, `tome export` and `tome import` come with 1.13.0, which brings updater 1.6.0. Update the application to 1.13.0 from "System", then upgrade the updater again from a checkout of v1.13.0, with the same commands as above. Until then the `tome` on the server is the old one, which does not know these commands: it prints its usage and exits 2. `sudo npm run updater:upgrade` from a v1.13.0 checkout installs both the new updater and the new `tome`.

If `/usr/local/bin/tome` already exists and is not TomeCMS's own, the upgrade refuses before it stops anything and says to move that file aside.
