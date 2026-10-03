---
title: The tome command
description: Look after a managed server with short commands. Check its status, read its logs, back it up, restore a backup, install an update, clear old images and move your writing as Markdown, all with sudo tome.
sidebar:
  order: 9
---

`tome` is a command on a managed server. It puts the long `docker compose …` and `curl --unix-socket …` commands behind short ones that already know where everything is: `sudo tome status`, `sudo tome logs`, `sudo tome backup`, `sudo tome update` and `sudo tome prune`. Three more put a backup back and move your writing: `sudo tome restore`, `sudo tome export` and `sudo tome import`.

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

Most changes go through the updater, the service that already installs updates from "System". `tome` never stops a container or deletes an image itself. `export` and `import` are the exception: they run in a short-lived container of the installed application, which `tome` starts and removes, and the site stays up.

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

While a restore is running, a `Restore` line shows it, above the newest backup:

```text
Restore running: at "restoring" since 2026-10-03 11:00
```

A restore whose record stops with no job running is flagged as stuck, like a backup. A restore that failed and kept the site in maintenance shows a warning that starts `Warning: a restore failed (rollback_failed) and keeps the site in maintenance.`, then the steps out, which [Recovery](/tome-cms/running/recovery/#a-restore-that-kept-the-site-in-maintenance) explains. If the updater cannot read the restore's record, one line says so, `Restore: could not be read (…). Check it with: sudo tome logs updater`, and everything else still shows. With `--json`, the same is in a `restore` field, which is `null` when no restore is running and none is waiting for recovery.

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

It refuses, and exits 1, while an update, another backup, a restore or an image clean-up is running, when less than 5 GiB is free where backups go, and when the last update needs manual recovery or a failed restore kept the site in maintenance. If you decline the prompt it prints `Nothing was done.` and exits 1.

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

An image a stopped container still uses cannot be removed. `tome` says how many it left. With nothing to remove it says `No old application images to remove.` and exits 0. It refuses while an update, a backup, a restore or another clean-up is running.

| Option | What it does |
| --- | --- |
| `-y`, `--yes` | Removes the images instead of only listing them. |

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

## tome export

Writes every post and page, with the media they use, to one Markdown archive:

```text
$ sudo tome export
Exported to /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz (3.2 MiB).
12 posts, 3 pages and 40 media files.
3 items carry formatting the .md files cannot show (colour, underline or alignment); their .tome.json files keep it.
```

It asks nothing and takes no options. The site stays up: everything is read in one consistent view of the database, so the archive matches a single moment. The archive is in `/var/backups/tome-cms/`, owned by the updater's user and readable by its owner only (`0600`). It holds every post and page, in every language and every status, and the media they use. It leaves out the settings, menus, slides, redirects, accounts and stats, and files nothing uses; a full backup has all of those. [A Markdown copy of your writing](/tome-cms/running/backups/#a-markdown-copy-of-your-writing) shows what is inside.

It refuses with exit code 1, and writes nothing, when the site runs TomeCMS before 1.13.0 (`This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update`) and when the site is in maintenance or the updater is busy (`The site is in maintenance, or the updater is busy. Try again when it is done.`). A post that uses a file that is gone from storage stops it, with `A media file the content uses (…) is missing from storage, so nothing was exported.` A failed export leaves no archive behind.

## tome import

Adds the posts and pages in an archive to the site. It takes an archive from `tome export`, or a directory laid out the same way, such as a folder of Markdown files you wrote. See the plan first with `--dry-run`:

```sh
sudo tome import /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz --dry-run
```

Without `--dry-run`, it prints the same plan, asks, and imports:

```text
$ sudo tome import /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz
Archive: /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz
To create: 2 posts in English, 1 post in Thai and 1 page in English.
Skipped, because the address is already taken (nothing is overwritten):
  posts/en/hello.md
Media: 2 files to upload, 1 already on the site.
Categories to create: Baking, Travel.
These translations had an edition skipped, so the rest form a group without it:
  7: posts/en/hello.md
Import these? [y/N] y
Created 2 posts in English, 1 post in Thai and 1 page in English.
Skipped 1, whose address was already taken.
Media: 2 uploaded, 1 reused.
Categories created: Baking, Travel.
```

For a directory, the first line says `Directory:` instead of `Archive:`.

**Nothing is overwritten.** An item whose address (its slug in that language) is already on the site is skipped, and listed by its path in the archive. Run on the site the archive came from, everything is skipped, and it says `Nothing to import: everything in it is already on the site.` without asking.

**Either everything is imported or nothing is.** The media go up first, and the items are written in one transaction. If that fails, the media it uploaded are removed again.

What it keeps and decides:

- **Status and dates.** `status: published` makes a published item with its `published` date. A draft keeps its `planned` date. A file with no `status` is a draft. The updated time is the time of the import.
- **Content.** When a `<slug>.tome.json` sits beside the `.md`, its exact document is used. Otherwise the `.md` body is converted, with the converter the admin's Markdown import uses. Every item is checked and cleaned the way a save from the editor is.
- **Media.** Files are matched by checksum, so one the site already has is reused and not uploaded again. A file the content names that is missing from the archive shows as a line saying it is missing, and the end says how many.
- **Categories.** They are matched by name, ignoring case, with no language. A name the site lacks is created, and `Uncategorized` is matched by name like any other, so it joins the site's default category while that is still called that.
- **Translations.** Items that share a `translation` value form one new group. When one of them was skipped, the rest still form a group, and the plan says so.
- **Author.** The site's owner.

**A hand-written `.md` has no `.tome.json`.** Only a `title` in its front matter is needed. A picture is matched by its relative path into `media/`. A relative link to a file is not: it keeps its text and loses the link. Put the file at `posts/en/<slug>.md` or `pages/th/<slug>.md`; [A Markdown copy of your writing](/tome-cms/running/backups/#a-markdown-copy-of-your-writing) shows the layout.

The archive or directory has to be directly in `/var/backups/tome-cms`. `tome` refuses the whole input, and imports nothing, in these cases:

| It says | Why |
| --- | --- |
| `That archive is not under /var/backups/tome-cms.` | It is somewhere else, or a link out. |
| `That archive holds a path outside itself (…), so nothing was imported.` | An entry starts with `/` or has a `..` part. |
| `That archive holds a link or a special file (…), so nothing was imported.` | An entry is a link, a device or a pipe. |
| `That archive is larger than 2 GiB, or holds more than 20,000 entries.` | The limits of an archive. |
| `media/big.png is larger than the File Manager accepts for its kind.` | The File Manager's own limit applies to each media file: 8 MiB for a picture, 25 MiB for a document. |
| `posts/en/a.md has front matter TomeCMS cannot read: published.` | A file's front matter does not read, or a field has the wrong type. It names the file, and the field when it can. |
| `notes.txt does not fit the archive's layout: manifest.json, media/, and posts/ or pages/ in th/ or en/.` | A file has no place in the layout. |
| `This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update` | The application has to carry the import. |
| `The site is in maintenance, or the updater is busy. Try again when it is done.` | Nothing is imported while the site is in maintenance or another job runs. |

A refusal about a file is followed by `Nothing was imported.` Other file problems have their own sentence, such as `media/x.exe is not a picture or a document the File Manager accepts.`

`--dry-run` imports nothing, but a directory is still handed to the updater's user, as `restore` does with a backup, so that the plan can read it. An archive is unpacked into a work directory that is removed afterwards, so the archive itself is not changed.

| Argument or option | What it does |
| --- | --- |
| `archive` | The `.tar.gz` or the directory to import. |
| `--dry-run` | Prints the plan and imports nothing. |
| `-y`, `--yes` | Does not ask first. |

If you decline, it prints `Nothing was done.` and exits 1.

## Building themes and plugins

Three more commands help you write a theme or a plugin. They are not for a server. They run in a TomeCMS source checkout, with `npm run tome --`, need no `sudo`, and say `Run this in a TomeCMS source checkout.` and exit 1 anywhere else. Only the checkout's own `src/cli/main.ts` runs them, so the `tome` installed on a server always refuses, even in its release clone at `/opt/tome-cms-src`. The server commands above keep their `sudo`, and the two groups do not mix.

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

A full disk is where `tome` helps most. When there is less than 5 GiB free where backups go, an update, a backup or a restore refuses with `Not enough free disk space where backups go`, and `tome status` shows the warning.

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
