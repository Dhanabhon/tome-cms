---
title: Backups and restore
description: Back up the database and the media bucket together, check that the backup restores, restore it with sudo tome restore, move a site to a new server, and keep a Markdown copy of your writing.
sidebar:
  order: 4
---

A TomeCMS site keeps its content in two places. Posts, pages, settings and sign-in data are in PostgreSQL. The files in the File Manager, logos included, are objects in the media bucket. A backup of the database alone is incomplete, so `npm run backup` copies both in one run, taken while the application is stopped so the two match.

## Before the first backup

The backup and the restore check run on the server, from the checkout, with Node.js. The deploy helper builds the application inside Docker and leaves the checkout without the packages these two commands need, so install them once:

```sh
npm ci
```

Both commands read `.env.local` from the checkout. The backup reaches PostgreSQL through Compose and the bucket through `S3_INTERNAL_ENDPOINT` when you set it and `S3_ENDPOINT` when you do not, so both services and the proxy of the media origin (or the internal address) have to be up. These commands run on the host, so an `S3_INTERNAL_ENDPOINT` in `.env.local` must be an address the host can reach, such as `http://127.0.0.1:9000`; `http://seaweedfs:8333` resolves only inside a managed install's Docker network.

## Making a backup

Stop the application first, so nothing writes while the copy is made:

```sh
docker compose -f compose.yaml --env-file .env.local stop app
```

Then back up into a directory outside the checkout:

```sh
npm run backup -- --offline --output-root "$HOME/tomecms-backups"
```

`--offline` is required. With it you confirm that nothing is writing, and the command also refuses to start while the application container is running. When it finishes it prints where the backup is and how much it holds:

```text
Backup complete: /home/deploy/tomecms-backups/tomecms-20260913T120000000Z
Database records: 42; media objects: 118
```

The first number counts posts and pages together. Start the application again when you are done, unless you are about to [upgrade](/tome-cms/running/updating/):

```sh
docker compose -f compose.yaml --env-file .env.local start app
```

The backup stops with `The media bucket contains an unsupported object key.` when the bucket holds an object whose name TomeCMS did not give it. Move such objects out of the bucket and run it again.

## What a backup holds

Each run makes one new directory under the output root, named after the time it started in UTC, such as `tomecms-20260913T120000000Z`. It holds:

| Path | What it is |
| --- | --- |
| `database.dump` | The whole `tomecms` database, dumped by `pg_dump` in its custom format, without owners or privileges. |
| `objects/` | Every object in the bucket, at the same path as its key. |
| `manifest.json` | The version of TomeCMS that made the backup, the site's address, the database and bucket names, how many settings, posts, pages and File Manager items the database held, a SHA-256 checksum for the dump, and a checksum, content type and size for each object. |

The manifest is written last. A directory without `manifest.json` is a backup that failed or was cut off, and must not be restored.

`--database-only` leaves the bucket out: the directory has no `objects/`, and the manifest says `"scope": "database"` and lists no objects. The updater takes one of these before an update that brings no migration, from 1.3.0 on, because such an update changes no table and is not expected to rewrite the files. To restore one, restore the dump and leave the bucket as it is. The restore check handles both kinds and says which it checked.

A backup carries none of the credentials in `.env.local`. A site restored from it needs the secrets it had, so keep a private copy of `.env.local` apart from the backups, as [Configuration](/tome-cms/running/configuration/) explains. The dump still holds everything in the database, sign-in data included, so keep backups as private as that file. A restore onto another server uses that server's own secrets, which is why [moving a site](#moving-to-a-new-server) ends with a checklist.

## Where the files go

`--output-root` takes an absolute path outside the checkout. The command refuses a relative path, a path inside the checkout and the root of the filesystem, and creates the directory if it is missing. Each backup's directories are readable by their owner only (`0700`), and so are its files (`0600`).

A backup on the server's own disk is lost with that disk, so copy each one to another machine. Each one copies the database and every file in the bucket again, so plan the disk for the number you keep on the server.

## Checking a backup

Check each backup before you rely on it. The restore check restores one into a separate, disposable Compose project and compares the result with the manifest:

```sh
npm run restore:check -- \
  --backup /home/deploy/tomecms-backups/tomecms-20260913T120000000Z \
  --project tomecms-restore-check-20260913
```

`--backup` takes the backup's absolute path. `--project` names the disposable project: `tomecms-restore-check-` followed by up to 40 lower-case letters, digits and hyphens, starting and ending with a letter or a digit. Use a new name each time, because the check refuses a project that already has containers. It never touches the site's own project.

The check works through these steps:

1. It checks the dump and every object against their checksums in the manifest.
2. It starts a PostgreSQL and a SeaweedFS of its own on ports `55432` and `59000` of `127.0.0.1`, so keep those free while it runs.
3. It restores the dump into that PostgreSQL.
4. It puts every object back with its content type. Each document also gets back its `Content-Disposition` header, which sets the name it downloads under and whether a PDF opens in the browser. The header lives on the object in the bucket, and a backup does not carry it, so the check rebuilds it from the document's row in `media_items`.
5. It compares the restored settings, posts, pages and File Manager items with the manifest's counts, and the restored objects with its list.
6. It removes the disposable containers and their volumes, whether the check passed or not.

A backup that passes ends with `Restore verified in disposable project tomecms-restore-check-20260913.` Anything else ends with a line starting `Error:`, such as `Database dump checksum does not match its manifest.` or `Restored object inventory does not match the backup.` Do not rely on a backup that fails the check.

## Restoring a site

On a managed server, from 1.13.0, `sudo tome restore` puts a backup back into the site. It takes a backup of the site as it is first, then replaces the database and, with a full backup, the media. If a step fails, it puts that safety backup back, so a half restored site is never served:

```sh
sudo tome restore /var/backups/tome-cms/tomecms-20261001T100000000Z
```

The backup has to sit directly in `/var/backups/tome-cms`, and it has to be made for this site's address by this TomeCMS or an older one. A backup holding a link or a special file is refused. `tome restore` changes the backup's owner to the updater's user, because the updater runs as that user. [The `tome` command](/tome-cms/running/cli/#tome-restore) shows the steps, every refusal and what happens when a step fails. Everyone is signed out afterwards, so you sign in again with your passkey, and the safety backup stays in `/var/backups/tome-cms/` until you remove it.

A server needs the application at 1.13.0 and the updater at 1.6.0. `sudo npm run updater:upgrade` from a v1.13.0 checkout installs the updater and the new `tome` together, as [Updating](/tome-cms/running/updating/#upgrading-the-updater) shows. A build from source has no `tome`. There the restore is done by hand, with the application stopped, the way the restore check does it:

- Restore `database.dump` into the site's PostgreSQL with `pg_restore`.
- Put every file under `objects/` back into the bucket at its key, with the content type the manifest records.
- Give every document its `Content-Disposition` header, built the way `contentDisposition` in `src/server/media/disposition.ts` builds it from the document's name and type in `media_items`. Without it, a document loses the name it downloads under.
- Start the application with the `.env.local` the site had when the backup was made.

Practise it on a spare server before you need it, and keep the old data until the restored site works.

## Moving to a new server

The domain stays the same when you move, so your passkeys keep working. A restore refuses a backup from another address.

1. On the old server, make a full backup. It prints where it saved it:

   ```sh
   sudo tome backup --full
   ```

2. Install TomeCMS on the new server with the same domain, at the same version as the old site or newer, as [Installing on a VPS](/tome-cms/start/install/) describes. `tome restore` refuses a backup made for another address or by a newer version.
3. Copy the backup into `/var/backups/tome-cms` on the new server, as root. `rsync -a` keeps the directory as it is:

   ```sh
   sudo rsync -a /var/backups/tome-cms/tomecms-20261003T110000000Z \
     root@new.example.com:/var/backups/tome-cms/
   ```

   The copy has to land directly in that directory, not in a folder inside it. `rsync -a` keeps the owner the copy had on the old server, and `tome restore` sets the owner to the updater's user whatever it is.
4. On the new server, restore it:

   ```sh
   sudo tome restore /var/backups/tome-cms/tomecms-20261003T110000000Z
   ```

5. Point the domain's DNS at the new server, sign in with your passkey, and go through the checklist below.

Anything written on the old server after step 1 is not in the backup, so stop writing there once you have made it.

### After the move

- **Sign in again.** Everyone is signed out by a restore. Your passkey works, because the domain did not change.
- **Enter the plugin secrets again.** A secret is sealed with the server's own `TOME_CMS_CONTEXT_SECRET`, and no secret is ever moved between servers. When a restored one cannot be opened here, `tome restore` lists the plugin and the setting, and you enter them again under "Plugins".
- **Make new recovery codes.** They were made with the old server's `TOME_CMS_RECOVERY_PEPPER`, so the old ones do not work. Issue new ones under "Security".
- **Look at the site.** Open a few posts with pictures, a file download, and "System", before you take the old server down.

`tome restore` prints the second and third item itself when they apply, and when the backup holds no plugin secret at all it says to issue new recovery codes in case it came from another server.

## A Markdown copy of your writing

`sudo tome export` writes every post and page, with the media they use, to `/var/backups/tome-cms/markdown-<time>.tar.gz`, and `sudo tome import` adds them to a site. It is a copy you can read, keep or move into another TomeCMS site. It is not a backup: it cannot restore your settings or your accounts.

It holds every post and page, in every language and every status, and the media they reference. It leaves out the settings, menus, slides, redirects, accounts and stats, which `tome restore` brings back from a backup, and the files in the File Manager that nothing uses, which a full backup holds. The site stays up while it is written.

```text
manifest.json
posts/en/hello.md
posts/en/hello.tome.json
pages/th/about.md
pages/th/about.tome.json
media/<object key>
```

- **`manifest.json`** says the archive is a TomeCMS Markdown archive, when and by which version it was made, for which address, how many posts, pages and media files it holds, and the name, type, checksum and size of each file. From 1.20.0 it also lists, under `categories`, the URL name and both descriptions of each category the posts are in, except the default one. From 1.21.0 it also says, under `defaultCategory`, what the default is called.
- **Each `.md` file** is the writing to read. Its front matter holds `title`, `slug`, `language`, `status`, `published` and `planned` when set, `updated`, the `categories` of a post by name, `excerpt`, `cover`, `show_cover`, `meta_title`, `meta_description` and `translation`, which is the same in every language of one translated item. The body is Markdown, and its images and file links point into `media/`. A block Markdown cannot hold, such as a video, an attachment or a table with merged cells, becomes a plain link or a short line naming it. Colour, underline and alignment are dropped from the `.md`.
- **Each `.tome.json` file** keeps the exact editor document, with its media links pointing into `media/`. An import uses it when it is there, so nothing the `.md` cannot show is lost. `tome export` ends by counting the items that carry such formatting.

To bring the writing in, run `sudo tome import` on the archive, as [The `tome` command](/tome-cms/running/cli/#tome-import) describes. It never overwrites an item whose address the site already has. You can write the files by hand too: a `.md` with a title is enough, at `posts/en/<slug>.md` or `pages/th/<slug>.md`.
