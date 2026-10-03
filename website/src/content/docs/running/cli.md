---
title: The tome command
description: Look after a managed server with short commands. Check its status, read its logs, back it up, install an update and clear old images, all with sudo tome.
sidebar:
  order: 9
---

`tome` is a command on a managed server. It puts the long `docker compose …` and `curl --unix-socket …` commands behind short ones that already know where everything is: `sudo tome status`, `sudo tome logs`, `sudo tome backup`, `sudo tome update` and `sudo tome prune`.

Every command:

- runs as root, so start it with `sudo`. Run as anyone else, it says so and stops;
- never prints a secret. Passwords, tokens and keys from the server's environment are hidden;
- prints in English, plain and short;
- accepts `--help`, which lists its options.

| Exit code | Meaning |
| --- | --- |
| 0 | It worked. |
| 1 | It failed or was refused. The message says why and what to do. |
| 2 | Wrong usage, such as an unknown command or option. It prints the usage. |

The changes it makes all go through the updater, the service that already installs updates from "System". `tome` never stops a container or deletes an image itself.

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

If `/usr/local/bin/tome` already exists and is not TomeCMS's own, the upgrade refuses before it stops anything and says to move that file aside.

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

Below the disk line, a warning appears when less than 5 GiB is free, which is the least an update or a backup needs. It names `sudo tome prune`. A backup that is stuck is flagged too, as [When the disk is full](#when-the-disk-is-full) describes.

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

It refuses, and exits 1, while an update, another backup or an image clean-up is running, when less than 5 GiB is free where backups go, and when the last update needs manual recovery. If you decline the prompt it prints `Nothing was done.` and exits 1.

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

It exits 1 when you decline, when the release is not one this server can take directly, when the server's updater is too old for it (the message names `sudo npm run updater:upgrade`), when GitHub cannot be reached, and when an update, a backup or an image clean-up is already running.

## tome prune

Clears the old TomeCMS images that every update used to leave on the disk. It is a dry run unless you add `--yes`:

```text
$ sudo tome prune
These old application images can go:
  sha256:bbbbbbbbbbbb  1.1 GiB
  sha256:cccccccccccc  718 MiB
Total: about 1.8 GiB.
Remove them with: sudo tome prune --yes
```

`sudo tome prune --yes` removes them and prints what went (`Removed sha256:…`) and `Freed about 1.8 GiB.` The updater applies the rules it uses after a successful update:

- only the official application images, `ghcr.io/dhanabhon/tome-cms`;
- only untagged ones, and never the PostgreSQL or SeaweedFS images;
- always keeping the installed image and the one before it, which a rollback needs;
- nothing at all when Docker's list of images cannot be read in full. It says so and exits 1.

An image a stopped container still uses cannot be removed. `tome` says how many it left. With nothing to remove it says `No old application images to remove.` and exits 0. It refuses while an update, a backup or another clean-up is running.

| Option | What it does |
| --- | --- |
| `-y`, `--yes` | Removes the images instead of only listing them. |

## Building themes and plugins

Three more commands help you write a theme or a plugin. They are not for a server. They run in a TomeCMS source checkout, with `npm run tome --`, need no `sudo`, and say `Run this in a TomeCMS source checkout.` and exit 1 anywhere else, including from the `tome` installed on a server. The server commands above keep their `sudo`, and the two groups do not mix.

```sh
npm run tome -- theme new <id> [--from plain|paper|almanac] [--dry-run]
npm run tome -- plugin new <id> --hook publicPage|signIn|editorSuggestions [--client] [--dry-run]
npm run tome -- check
```

- `theme new` copies an existing theme under a new id and registers it. [Writing a theme](/tome-cms/extending/themes/#starting-with-tome) says what it renames.
- `plugin new` writes a plugin that fills its hook and does nothing yet, switched off. [Writing a plugin](/tome-cms/extending/plugins/#starting-with-tome) shows what it writes.
- `check` checks every theme and plugin, and prints each problem as `path:line: what is wrong`. It changes nothing. It exits 0 when it found none and 1 when it found any. `npm run check` runs it, so CI stops a mistake before it is merged.

`check` looks for these:

1. a theme or plugin whose directory name is not its manifest's id;
2. one that is not listed in both its `manifests.ts` and its `registry.ts`, or a list entry with no directory;
3. a missing file: a theme needs `index.ts`, `theme.ts`, `Shell.astro`, `Home.astro`, `Post.astro`, `Page.astro` and `theme.css`; a plugin needs `plugin.ts` and `index.ts`, and `client.ts` when it has a `publicClient`;
4. a setting that is not well formed: a repeated key, a kind the contract does not allow, a label or hint missing in English or Thai, a choice without options or whose fallback is not one of them, a theme's text setting without a maximum length (a plugin's text has none in its contract), a switch whose fallback is not `on` or `off`;
5. a plugin whose `index.ts` does not export the sign-in pair every plugin answers, or a method of each hook it declares;
6. a theme that imports from `src/server/` or `src/pages/`;
7. a raw colour in a theme's CSS outside a token block. A raw colour is a hex such as `#c00`, or `rgb()`, `hsl()`, `hwb()`, `oklch()`, `oklab()`, `lab()`, `lch()` or `color()`. A token block is a rule whose own declarations are all custom properties, such as `--color-ink: oklch(24% 0.012 70);`; a rule nested inside it is checked on its own. Everywhere else the stylesheet uses `var(--color-ink)`. Comments are not read, and neither is a colour name such as `red`.

It does not run a plugin. It imports each manifest and each plugin's `index.ts`, as the core does, and calls nothing in them. Any way of exporting a method counts, including `export * from './hooks'`. A method that is only on the default export object does not count, because the core uses the module's named exports.

A checkout with nothing wrong:

```text
$ npm run tome -- check
Checked 3 themes and 6 plugins: no problems.
```

A plugin made with `plugin new nimbus --hook publicPage`, with `export` then taken off the `siteNotice` line of its `index.ts`, and `settings: [],` in its `plugin.ts` replaced by a setting with no Thai label:

```ts
  settings: [
    { key: 'message', kind: 'text', label: { en: 'Message', th: '' }, required: false },
  ],
```

```text
$ npm run tome -- check
src/plugins/nimbus/plugin.ts:11: setting "message" has no Thai label
src/plugins/nimbus/index.ts:1: declares publicPage, but exports none of siteNotice, sitePopup, publicClient
2 problems.
```

`npm run tome -- --help` lists them, and every command takes `--help`.

## When the disk is full

A full disk is where `tome` helps most. When there is less than 5 GiB free where backups go, an update or a backup refuses with `Not enough free disk space where backups go`, and `tome status` shows the warning.

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
