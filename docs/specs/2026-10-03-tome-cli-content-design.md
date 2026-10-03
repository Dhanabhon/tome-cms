# Tome CLI, part C: restore, export and import

Date: 2026-10-03
Status: Design, approved by the owner section by section on 2026-10-03. It ships as 1.13.0.
- Part A (server care, 1.11.0) is `docs/specs/2026-10-02-tome-cli-server-design.md`.
- Part B (building themes and plugins, 1.12.0) is `docs/specs/2026-10-03-tome-cli-builders-design.md`.

## Why

The owner wants to **back up and move a site**:
- move dhanabhon.com to a new VPS with a few commands, and sign in again;
- keep a readable copy of everything written.

Today there are two gaps:
- `tome backup --full` and the restore check exist, but no command restores a backup into the site
  itself. `running/backups.md` says so and lists the steps to do by hand.
- Nothing exports posts and pages in a form a person can read.

**Ruled out:** the roadmap's earlier idea of personal API tokens with `post new` and `publish`. Those
served writing from a laptop, which is not the purpose. 1.13.0 adds **no new way to write content
from outside the server**. Every command here runs on the server as root, like part A.

Owner decisions:
- **Both pieces in 1.13.0:** `tome restore` (A1, through the updater) and Markdown
  `tome export` / `tome import` (B1, inside the app's own image).
- **The domain never changes when moving**, so passkeys keep working. Restore refuses a backup from
  another domain.
- **Import keeps each item's status and dates**, skips a slug that is already taken, and never
  overwrites.

## Common rules

- These are part A's server commands: they need `sudo`, have the exit codes 0 / 1 / 2, support
  `--help`, and print English output.
- **Paths:** every path a command reads must resolve, after symlinks, to somewhere under the
  backup directory, `/var/backups/tome-cms` (`backupDirectory` in `src/updater/config.ts`). Every
  file a command writes goes there too, with mode `0600` for files and `0700` for directories.
- **Ownership:** everything under the backup directory is owned by `tomecms-updater`, the user the
  updater runs as, who owns that directory (`install-managed-vps.sh`).
  - `tome` runs as root, so before it hands a directory to the updater or to a one-shot container,
    it changes the directory's owner to `tomecms-updater`.
  - A backup copied in with `rsync` as root arrives owned by root, so this step matters for a move.
- **Confirmation:** `restore` and `import` print what they will do and ask y/N, and `--yes` skips
  the question. `import` also takes `--dry-run`.
- **Version checks:**
  - `tome` is built with the updater, so the commands exist only after
    `sudo npm run updater:upgrade` from a v1.13.0 checkout.
  - `restore` against an updater older than 1.6.0 says to upgrade the updater, and exits 1.
  - `export` and `import` against an installed app older than 1.13.0 say to update the app, and exit
    1.

## `sudo tome restore <backup-directory> [--yes]`

Restores a backup made by `tome backup` (full or database-only) or by the updater.

**Before anything is touched, it refuses with a sentence and exit 1** when one of the conditions
below holds. Who checks what:
- `tome` checks the cheap conditions before it asks y/N.
- The updater checks everything again, including every checksum, in the job's first phase,
  `verifying`, while the site is still up. Hashing gigabytes takes longer than a socket request
  allows.

The conditions:
- the directory has no `manifest.json` (a cut-off backup), or the manifest does not parse;
- the dump's checksum, or any object's checksum (full backups), does not match the manifest;
- the manifest's `config.publicUrl` is not this site's public URL;
- the manifest's `applicationVersion` is newer than the installed app. The message names the
  version to update to first;
- the installed app is older than 1.13.0, the first image that carries the restore steps;
- an update, backup, prune or restore holds the updater's lock;
- the backup directory has too little free space for the safety backup of step 1. The test is the
  same free-space test a backup uses, and the failure code is `insufficient_disk_space`.

**The summary before y/N:**
- the backup's date and version;
- its domain;
- its scope (full, or database only);
- its post, page and media counts;
- the words "Everything on this site will be replaced by the backup."

**It runs as an updater job, `POST /v1/restore`.** The job's state lives in its own file,
`restore-job.json`, beside `backup-job.json`. `GET /v1/restore` reads that state.
`/v1/status` and the update job record do not change, because older apps parse them strictly. The
job takes the same lock as apply, backup and prune, and `/v1/busy` reports it. The steps:

1. **Safety backup.** Take a full backup of the current site, the same backup `/v1/backup` takes.
   If it fails, stop before changing anything.
2. **Quiesce.** Write the maintenance marker, drain, and stop the app: the same first half of a
   maintenance window that a backup and an update use.
3. **Database.** Empty the database (`drop schema public cascade; create schema public;`), then
   restore `database.dump` with `pg_restore --no-owner --no-privileges`.
   - The restore runs as a one-shot of the installed app image. Its client is then at least as new
     as the `pg_dump` that wrote the dump.
   - Emptying the database first matters. Migrations are not idempotent, so a newer table left
     beside an older dump would make step 5 fail.
4. **Media** (full backups only). Make the bucket equal the backup: upload every object in the
   manifest, and delete every object the backup does not list. Reuse the object-restore steps that
   `scripts/restore-check.ts` already tests. A database-only backup leaves the bucket alone.
5. **Migrations.** If the backup's version is older than the app's, run the migration one-shot
   exactly as an update does.
6. **Sign everyone out.** Clear all sessions, so the owner signs in again with a passkey. MCP
   connections are kept.
7. **Start and check.** Start the app, wait for it to be healthy, and compare the restored posts,
   pages and media items with the manifest's `records`.
8. **Finish.** Clear the maintenance marker, and record success.

**On failure:**
- If any step from 3 onwards fails, the job puts the safety backup from step 1 back through steps
  3–7, then leaves maintenance, and records `failed` with a code and the safety backup's path.
- If the updater restarts with a restore job that has not finished, boot treats it the same way: it
  puts back the safety backup, clears maintenance, and marks the job failed. A site is never left
  half restored, or in maintenance, after a restart.
- **If putting the safety backup back also fails:**
  - the job records `rollback_failed` with both directories;
  - it keeps the maintenance marker, so no one writes to a database in an unknown state;
  - it leaves the app stopped.

  `tome` prints the manual steps. This is the only case that ends in maintenance.

**After the restore, `tome` prints:**
- the counts restored;
- whether migrations ran;
- the path of the safety backup;
- the after-move checklist, but only when it applies. If any plugin secret in the restored
  database cannot be opened with this server's `TOME_CMS_CONTEXT_SECRET` (`openSecret` returns
  null), the backup came from a server with other secrets. Then `tome` says:
  - which plugins need their secret set again, under Plugins;
  - that recovery codes must be issued again under Security, because they were made with the old
    server's `TOME_CMS_RECOVERY_PEPPER`.

  No secret is ever moved between servers.

**Moving a site (documented in `running/backups.md`):**
1. On the old server, run `sudo tome backup --full`.
2. Install TomeCMS on the new server with the same domain, at the same version or newer.
3. Copy the backup directory into `/var/backups/tome-cms` on the new server with `rsync -a`, as
   root.
4. Run `sudo tome restore /var/backups/tome-cms/tomecms-…`.
5. Point DNS at the new server, sign in with the passkey, then follow the checklist.

## `sudo tome export`

- **Writes** `/var/backups/tome-cms/markdown-<UTC timestamp>.tar.gz`.
- **Includes** every post and page, in every language and every status, plus the media they
  reference.
- **Leaves out:**
  - settings, menus, slides, redirects, accounts and stats, which belong to `restore`;
  - File Manager items that nothing references, which are in a full backup.
- **The site stays up.** All rows are read in one `REPEATABLE READ` transaction, so the archive is
  consistent.

**How it runs:**
- The export runs as a one-shot container of the installed app image: `docker compose run --rm
  --no-deps`, the way the updater runs migrations.
- A fresh work directory under the backup root is mounted into it.
- Inside, the app's own code reads the database and the bucket, and writes the files.
- `tome` then packs the directory with the system `tar` (argv only), checks the archive, and
  removes the work directory.

**The layout:**
```
manifest.json              {"format":"tomecms-markdown","version":1,"createdAt","applicationVersion",
                            "publicUrl","counts":{"posts","pages","media"},
                            "media":{"<media id>":{"path":"media/<object key>","name","type","sha256","size"}}}
posts/<locale>/<slug>.md
posts/<locale>/<slug>.tome.json
pages/<locale>/<slug>.md
pages/<locale>/<slug>.tome.json
media/<object key>
```

**Each `.md` file:**
- **YAML front matter:** `title`, `slug`, `language`, `status`, `published` (ISO date or absent),
  `planned` (ISO date or absent), `updated`, `categories` (names; posts only), `excerpt`, `cover`
  (a relative path into `media/`, or absent), `show_cover` (posts only), `meta_title`,
  `meta_description`, and `translation` (the translation group id as a string).
- **The body** is Markdown made with the same converter MCP uses (`src/server/mcp/markdown-out.ts`).
  - Image and file links are rewritten to relative paths into `media/`.
  - A block Markdown cannot hold (video, attachment, a table with merged cells) becomes a plain
    link or a short line naming it, not a `{{tome:block}}` marker. The `.md` is meant for people.
  - Colour, underline and alignment are dropped from the `.md`.
- **The `.tome.json`** beside it holds the exact editor document (`content_json`). Media URLs in it
  are rewritten to the same relative `media/` paths, so an import can relink them.

**At the end, `tome` prints:**
- the archive's path and size;
- the counts;
- how many items carry formatting the `.md` cannot show, with the note that their `.tome.json`
  keeps it.

## `sudo tome import <archive-or-directory> [--dry-run] [--yes]`

**Accepts** a `.tar.gz` from `tome export`, or a directory laid out the same way. A hand-written
`.md` with that layout works too. A missing `manifest.json` is allowed for a hand-written
directory.

**Runs** as the same kind of one-shot app container as export, with the archive unpacked into a
fresh work directory under the backup root.

**Refuses the whole input before writing anything** when:
- an entry in the archive has an absolute path or a `..` part, or is a symlink, hard link, device or
  FIFO. The archive is listed and checked before it is unpacked;
- it exceeds the size limits:
  - the archive at most 2 GiB;
  - at most 20,000 entries;
  - each media file within the File Manager's own limit for its kind: 8 MiB for a picture, 25 MiB
    for a document;
- a file's front matter does not parse, or has a field of the wrong type. The refusal names the
  file;
- the site is in maintenance, or the updater's `/v1/busy` says a job is running.

**The plan, printed before y/N**, and on its own with `--dry-run`:
- the posts and pages to create, by kind and language;
- each item skipped because its slug is already taken in that language, by path. **Nothing is
  overwritten**;
- the media to upload, and the media already on the site that will be reused, matched by SHA-256;
- the categories to create.

**Building each item:**
- **Content:** when `<slug>.tome.json` is present, its document is used. Otherwise the `.md` body
  is converted with the converter the admin's Markdown import uses (1.6.0).
- **Validation:** every item goes through the same validation and sanitising as a write from the
  editor or MCP (`contentMutationSchema` and the editor document checks). `content_html` is always
  rebuilt from the document and never read from the input.
- **Status and dates are kept:**
  - `status: published` creates a published item with its `published` date;
  - a draft keeps its `planned` date;
  - a missing `status` means a draft.
  - The `updated` field is informational; the row's `updated_at` is the import time.
- **Categories** have no language in TomeCMS.
  - They are matched by name, ignoring case, and missing ones are created.
  - `Uncategorized` maps to the site's default category.
  - A translation group's categories are the union of its items' lists.
- **Translations:** the items that share a `translation` value form one new translation group.
  When a sibling was skipped, the rest still form a group, and the plan says so.
- **Author:** the site's owner.
- **Media links** in the document and the cover are rewritten to the uploaded or reused File
  Manager items.

**Order and atomicity:**
1. Upload new media to the bucket, and create their File Manager rows.
2. Write every item and its categories in one database transaction.
3. If step 2 fails, delete what step 1 uploaded and created, and report the failure. Either every
   planned item appears or none does.

**At the end, it prints:** the items created, the items skipped with their reasons, the media
uploaded and reused, and the categories created.

## Updater 1.6.0

- **Routes:** `POST /v1/restore` and `GET /v1/restore`, with the job state in `restore-job.json`.
  The restore is added to `/v1/busy` and to the shared lock. `UPDATER_VERSION` becomes `1.6.0`.
- **Boot reconciliation** for an unfinished restore, as above.
- **Unchanged:** `/v1/status` and the update job record.
- An app from before 1.13.0 keeps working against updater 1.6.0, and `tome` 1.13.0 keeps working
  against an updater it can tell is older (see Common rules).
- `npm run test:operations:update` must still pass.

## Docs, en and th

- **`running/cli.md`:** `restore`, `export` and `import`, with their options, refusals and output.
- **`running/backups.md`:**
  - replace "TomeCMS has no command yet that restores a backup into the site itself" with
    `tome restore`;
  - add "Moving to a new server" with the five steps and the checklist;
  - add a short section on the Markdown archive: what is in it and what is not.
- **`running/updating.md`:** 1.13.0 brings updater 1.6.0, which `tome restore` needs. Give the
  upgrade command.

## Tests

- **Unit:**
  - the restore refusals: no manifest, a bad checksum, another domain, a newer version, busy;
  - the archive entry checks: absolute paths, `..`, links, devices, the size limits;
  - front matter written and read, round trip;
  - choosing `.tome.json` over `.md`;
  - the import plan: creates, skips by slug and language, media reuse by checksum, categories;
  - translation grouping with a skipped sibling;
  - the after-move checklist trigger.
- **Integration**, against a real database and bucket:
  - **Export then import into an empty site:** every item comes back with an equal `content_json`
    (media relinked), status, `published_at`, `planned_at`, categories and translation groups.
  - **Import into the same site:** everything is skipped and nothing changes.
  - **A bad item in an archive:** nothing is written, and the uploaded media are removed.
  - **Hand-written `.md` files** with no `.tome.json`: they become drafts unless their front matter
    says `published`.
- **Operations harness**, with Docker and real containers like `test:operations:update`:
  - **The basic path:** take a full backup, change the data, restore, and check that the counts
    and a known post come back and that sessions are cleared.
  - **A forced failure** after the database step puts the safety backup back, and the site works.
  - **An updater restart** mid-restore ends on a working site that is out of maintenance.
  - **A backup from the previous release** restores into this one, and its migrations run.
  - **Refusals:** another domain is refused, and so is a newer version.
- **Owner acceptance on daedalus**, after the release:
  1. upgrade the updater;
  2. `sudo tome backup --full`;
  3. `sudo tome export`;
  4. `sudo tome restore` of that backup on the same server;
  5. optionally, a real move to a spare VPS.

## Out of scope

- Personal API tokens, `post new` and `publish`, which are dropped from the roadmap.
- Changing the domain while moving, and carrying secrets between servers.
- Export and import in the admin, as a zip download or upload.
- Exporting File Manager items that nothing references.
- A database migration. None is expected; if one is needed, it is a plan change.
