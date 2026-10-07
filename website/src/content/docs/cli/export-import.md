---
title: Moving your writing
description: Write every post and page to one Markdown archive with sudo tome export, and add an archive's posts and pages to a site with sudo tome import.
sidebar:
  order: 5
---

These two commands move your writing as Markdown, from one site to another or out of TomeCMS. [A Markdown copy of your writing](/tome-cms/running/backups/#a-markdown-copy-of-your-writing) shows what an archive holds.

## tome export

Writes every post and page, with the media they use, to one Markdown archive:

```text
$ sudo tome export
Exported to /var/backups/tome-cms/markdown-20261003T120000000Z.tar.gz (3.2 MiB).
12 posts, 3 pages and 40 media files.
3 items carry formatting the .md files cannot show (colour, underline or alignment); their .tome.json files keep it.
```

It asks nothing and takes no options. The site stays up: everything is read in one consistent view of the database, so the archive matches a single moment. The archive is in `/var/backups/tome-cms/`, owned by the updater's user and readable by its owner only (`0600`). It holds every post and page, in every language and every status, and the media they use. It leaves out the settings, menus, slides, redirects, accounts and stats, and files nothing uses; a full backup has all of those. [A Markdown copy of your writing](/tome-cms/running/backups/#a-markdown-copy-of-your-writing) shows what is inside.

It refuses with exit code 1, and writes nothing, when the site runs TomeCMS before 1.13.0 (`This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update`), when the site is in maintenance or the updater is busy (`The site is in maintenance, or the updater is busy. Try again when it is done.`), and when less than 5 GiB is free where backups go (`Not enough free disk space where backups go (/var/backups/tome-cms) for the export: it needs 5.0 GiB, so nothing was exported; sudo tome prune shows old images that can go.`). The archive is written there twice over, as a work directory and then packed. A post that uses a file that is gone from storage stops it, with `A media file the content uses (…) is missing from storage, so nothing was exported.` A failed export leaves no archive behind.

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

- **Addresses.** A `slug` that is already a valid address is kept exactly as written, so a move keeps every address, Thai ones included. One that is not, such as `Rye & Spelt!`, is made into one, as the editor would make it; with no `slug`, the file's name is used, and the title when the name has no words.
- **Status and dates.** `status: published` makes a published item with its `published` date. A draft keeps its `planned` date. A file with no `status` is a draft. The updated time is the time of the import.
- **Content.** When a `<slug>.tome.json` sits beside the `.md`, its exact document is used. Otherwise the `.md` body is converted, with the converter the admin's Markdown import uses. Every item is checked and cleaned the way a save from the editor is.
- **Media.** Files are matched by checksum, so one the site already has is reused and not uploaded again. A file the content names that is missing from the archive shows as a line saying it is missing, and the end says how many.
- **Categories.** They are matched by name, ignoring case, with no language. A name the site lacks is created, with the URL name and descriptions the archive's manifest gives it, or a URL name made from its name when the archive is from before 1.20.0 or that URL name is taken. A category the site already has keeps its own. A post in the archive's default category goes into the site's default, whether the archive names it `Uncategorized` or by the name in its manifest's `defaultCategory`, or names it by the site's own default name. The site's default keeps its own name, and so a custom category in the archive that is called what the site's renamed default is called lands in the default too.
- **Translations.** Items that share a `translation` value form one new group. When one of them was skipped, the rest still form a group, and the plan says so.
- **Author.** The site's owner.

**A hand-written `.md` has no `.tome.json`.** Only a `title` in its front matter is needed. A picture is matched by its relative path into `media/`. A relative link to a file is not: it keeps its text and loses the link. Put the file at `posts/en/<slug>.md` or `pages/th/<slug>.md`; [A Markdown copy of your writing](/tome-cms/running/backups/#a-markdown-copy-of-your-writing) shows the layout.

The archive or directory has to be directly in `/var/backups/tome-cms`. `tome` refuses the whole input, and imports nothing, in these cases:

| It says | Why |
| --- | --- |
| `That archive is not under /var/backups/tome-cms.` | It is somewhere else, or a link out. |
| `That archive holds a path outside itself (…), so nothing was imported.` | An entry starts with `/` or has a `..` part. |
| `That archive holds a link or a special file (…), so nothing was imported.` | An entry is a link, a device or a pipe. |
| `That archive could not be read as a .tar.gz, so nothing was imported.` | It is not a `.tar.gz`, or it is damaged. |
| `That archive holds an entry its listing does not show (…), so nothing was imported.` | Unpacking it made a file its listing did not name, as an archive made to hide one does. |
| `That archive is larger than 2 GiB, or holds more than 20,000 entries.` | The limits of an archive. |
| `media/big.png is larger than the File Manager accepts for its kind.` | The File Manager's own limit applies to each media file: 8 MiB for a picture, 25 MiB for a document. |
| `posts/en/a.md has front matter TomeCMS cannot read: published.` | A file's front matter does not read, or a field has the wrong type. It names the file, and the field when it can. |
| `notes.txt does not fit the archive's layout: manifest.json, media/, and posts/ or pages/ in th/ or en/.` | A file has no place in the layout. |
| `This site runs TomeCMS 1.12.4. Export and import need 1.13.0 or newer: sudo tome update` | The application has to carry the import. |
| `The site is in maintenance, or the updater is busy. Try again when it is done.` | Nothing is imported while the site is in maintenance or another job runs. |
| `Not enough free disk space where backups go (/var/backups/tome-cms) for the import: it needs 5.0 GiB, so nothing was imported; sudo tome prune shows old images that can go.` | An import needs 5 GiB free where backups go, or twice the archive's size when that is more, because the archive is unpacked there. |

A refusal about a file is followed by `Nothing was imported.` Other file problems have their own sentence, such as `media/x.exe is not a picture or a document the File Manager accepts.`

`--dry-run` imports nothing, but a directory is still handed to the updater's user, as `restore` does with a backup, so that the plan can read it. An archive is unpacked into a work directory that is removed afterwards, so the archive itself is not changed. The plan reads every file and checks its layout, front matter and size, but pictures are decoded and each item's content is checked the way the editor checks a save only when it is written. So an import can still refuse a file the dry run let through, and when it does, nothing is imported.

| Argument or option | What it does |
| --- | --- |
| `archive` | The `.tar.gz` or the directory to import. |
| `--dry-run` | Prints the plan and imports nothing. |
| `-y`, `--yes` | Does not ask first. |

If you decline, it prints `Nothing was done.` and exits 1.
