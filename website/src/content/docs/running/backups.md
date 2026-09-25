---
title: Backups and restore
description: Back up the database and the media bucket together, and check that the backup restores.
sidebar:
  order: 4
---

A TomeCMS site keeps its content in two places. Posts, pages, settings and sign-in data are in PostgreSQL. The files in the library, logos included, are objects in the media bucket. A backup of the database alone is incomplete, so `npm run backup` copies both in one run, taken while the application is stopped so the two match.

## Before the first backup

The backup and the restore check run on the server, from the checkout, with Node.js. The deploy helper builds the application inside Docker and leaves the checkout without the packages these two commands need, so install them once:

```sh
npm ci
```

Both commands read `.env.local` from the checkout. The backup reaches PostgreSQL through Compose and the bucket through `S3_ENDPOINT`, so both services and the media origin's proxy have to be up.

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
| `manifest.json` | The version of TomeCMS that made the backup, the site's address, the database and bucket names, how many settings, posts, pages and library items the database held, a SHA-256 checksum for the dump, and a checksum, content type and size for each object. |

The manifest is written last. A directory without `manifest.json` is a backup that failed or was cut off, and must not be restored.

A backup carries none of the credentials in `.env.local`. A site restored from it needs the secrets it had, so keep a private copy of `.env.local` apart from the backups, as [Configuration](/tome-cms/running/configuration/) explains. The dump still holds everything in the database, sign-in data included, so keep backups as private as that file.

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
5. It compares the restored settings, posts, pages and library items with the manifest's counts, and the restored objects with its list.
6. It removes the disposable containers and their volumes, whether the check passed or not.

A backup that passes ends with `Restore verified in disposable project tomecms-restore-check-20260913.` Anything else ends with a line starting `Error:`, such as `Database dump checksum does not match its manifest.` or `Restored object inventory does not match the backup.` Do not rely on a backup that fails the check.

## Restoring a site

TomeCMS has no command yet that restores a backup into the site itself. The restore check shows each step, and a restore by hand has to do the same against the site's own services, with the application stopped:

- Restore `database.dump` into the site's PostgreSQL with `pg_restore`.
- Put every file under `objects/` back into the bucket at its key, with the content type the manifest records.
- Give every document its `Content-Disposition` header, built the way `contentDisposition` in `src/server/media/disposition.ts` builds it from the document's name and type in `media_items`. Without it, a document loses the name it downloads under.
- Start the application with the `.env.local` the site had when the backup was made.

Practise it on a spare server before you need it, and keep the old data until the restored site works.
