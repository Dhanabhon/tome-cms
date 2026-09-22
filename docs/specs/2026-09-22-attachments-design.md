# Files In An Article, Kept In The Library

Date: 2026-09-22
Status: Awaiting owner review

## What the owner asked for

While writing an article, attach a file to it; keep that file in the file library; and let the
library filter its files by type.

Today the library holds images and nothing else: five raster types of up to 8 MB, held there by
`ACCEPTED_IMAGE_TYPES` (`src/lib/media.ts`) and by the checks on `media_items` and
`media_upload_reservations` (`006_media`). An article can carry an image from it, the library
has folders and a search, and there is no filter.

## What was decided before this was written

| Question | Answer |
|---|---|
| Which files | PDF; Word, Excel and PowerPoint in their current formats (`docx`, `xlsx`, `pptx`); CSV; plain text; ZIP. Not the legacy binary Office formats, not the macro-enabled ones, and not HTML, SVG or programs. |
| How a file opens | It downloads under its own name, except a PDF, which opens in the browser. |
| How it appears in an article | A file card: a block of its own, inserted from the + menu and `/`, with the file's name, type and size, the whole card one link. |
| How the library filters | By group -- All, Images, PDF, Documents, Spreadsheets, Slides, ZIP -- beside the search, together with the folders, and kept in the page's address. |
| Where the files are kept | In the library that holds the images, approach A of the two offered: the same table, upload, folders and search, with each file's type deciding its rules. |

The legacy formats were in the first draft. A look at their signature cannot tell whether one
carries a macro: Word and Excel keep a macro project in a storage that only a walk through the
whole compound file finds, and PowerPoint keeps it inside compressed data. Accepting them would
have made the rule against macros true of some files and not of others. Office has saved `docx`,
`xlsx` and `pptx` by default since 2007.

## Storage

Migration `021_media_documents` changes the checks on `media_items` and
`media_upload_reservations`, and nothing else:

- `mime_type` also accepts the seven document types:

  | Type | Extension | MIME type |
  |---|---|---|
  | PDF | `pdf` | `application/pdf` |
  | Word | `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
  | Excel | `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
  | PowerPoint | `pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
  | CSV | `csv` | `text/csv` |
  | Text | `txt` | `text/plain` |
  | ZIP | `zip` | `application/zip` |

- `width` and `height` may be null, for a document only. An image still needs both, between 1 and
  100,000; a document has neither.
- The size limit depends on the kind: 8 MB (8,388,608 bytes) for an image, as now, and 25 MB
  (26,214,400 bytes) for a document.
- A document's `alt_text` is null. Alternative text describes an image.
- Its `down` refuses while the library holds a document. `width` and `height` cannot be made
  required again with documents in the table, and dropping those rows would leave cards in
  articles pointing at nothing. It deletes the reservations made for documents, which have
  nothing left to account for.

Object keys keep the library's grammar, `owners/<owner>/<yyyy>/<mm>/<uuid>.<ext>`, and the seven
extensions join it. Backup, restore-check, media-cleanup and reset all read keys through
`isTomeObjectKey` (`src/server/media/keys.ts`), and the reset's inventory already reads every key
on `media_items` and `media_upload_reservations`, so a document is accounted for with nothing
else added. Backup and restore-check also parse the manifest with `parseBackupManifest`
(`src/update/backup.ts`), which keeps its own copy of the grammar and a per-object size cap
because the updater's build is self-contained; the copy now accepts the seven extensions and
25 MB, and `tests/unit/backup-manifest.test.ts` holds the two together.

**Each document is stored with its `Content-Disposition`.** It is `attachment`, or `inline` for a
PDF, with the file's own name as `filename*=UTF-8''…` and an ASCII `filename` beside it for the
few clients that read no other: the name itself when it is plain ASCII, `file.<ext>` when it
is not. A reader reaches a file through `/media/<id>`, which redirects to
the object store, so the application never serves the bytes and has no moment to add a header;
the header travels with the object instead. It is signed into the upload's URL, so the store
refuses an upload that changes it or leaves it out.

This was checked against SeaweedFS 4.46, the version the stack pins, on a throwaway container:
the header is kept and returned to an anonymous GET with a Thai name intact; a changed or a
missing header is refused with `SignatureDoesNotMatch`; and the CORS preflight for the site's
origin allows the new request header, as it does the two the upload already sends.

## Upload

The library's three steps stay: reserve, PUT to the store from the browser, finalize.

- **The declared type comes from the name's extension.** Browsers disagree on the MIME type of a
  CSV or a ZIP, and some report none. The server refuses a document whose name's extension is
  not its declared type's own, so a file always reaches a reader under the name of what it was
  checked to be. Images keep today's rules.
- **The reservation's headers gain `content-disposition`.** The browser already sends every header
  a reservation names, so the upload code does not change.
- **Finalizing a document never holds the whole file.** A HEAD first: size, type, checksum and
  disposition must be the reservation's. Then one streaming read hashes the object and, for
  text, checks it as UTF-8 as it goes, keeping only its first kilobyte. A file built on ZIP is
  then read at its end with Range requests: the end-of-central-directory record, in the last
  65,557 bytes, and the directory it points to, at most 1 MB. An image is still read whole, as
  now, because `sharp` needs all of it.
- **Each type is held to what its bytes say:**

  | Type | Must be |
  |---|---|
  | PDF | Starts with `%PDF-`. |
  | Word, Excel, PowerPoint | A ZIP, starting with a local file header, whose central directory holds `[Content_Types].xml` and the type's main part -- `word/document.xml`, `xl/workbook.xml` or `ppt/presentation.xml` -- and no entry named `vbaProject.bin`, where a macro project is kept. |
  | CSV, text | UTF-8 throughout, a byte-order mark allowed, with no zero byte. |
  | ZIP | Starts with a local file header, or is an empty archive, and ends with an end-of-central-directory record whose directory lies inside the file. |

- **A file that fails is refused with the reason**, and its object is deleted, as a failed image's
  is today.

## In the editor

- **The + menu and `/` gain File**, in posts and pages alike. It opens the library's picker showing
  documents only, where the writer chooses a file or uploads one. An upload joins the library, in
  the folder the picker has open, and the card goes in at once.
- **The card is one block**, a Tiptap node `attachment` with `mediaId`, `href`, `name`, `mimeType`
  and `size`. A click selects it, Backspace or Delete removes it, and it drags like an image. A
  click on it in the editor never follows its link.
- **The server takes each card's name, type and size from the library** whenever it renders a
  document -- on a save, and on a publish, which renders what was saved -- and sets `href` to
  `/media/<id>`. What the editor sent for them is not used: the card is stored HTML, and a stale
  or a crafted request would otherwise let a 25 MB ZIP read as "PDF · 1 KB". A library file never
  changes once uploaded, so the server's answer is always the file's own. A card for a file that
  is not a ready document of this site is refused, as an image from elsewhere is.
- **A document holding only a card has content**, and can be published. A card's name is not
  counted among the article's words.

## What a reader sees

```html
<p class="file-card"><a href="/media/<id>" type="application/pdf" target="_blank" rel="noopener noreferrer"><span class="file-card__name">คู่มือการสมัคร.pdf</span> <span class="file-card__meta">PDF · 1.2 MB</span></a></p>
```

- **The type is written as its abbreviation** -- PDF, DOCX, XLSX, PPTX, CSV, TXT, ZIP -- so the
  card does not depend on the article's language. Sizes read in B, KB or MB, from the formatter
  the library uses.
- **A PDF opens in a new tab.** Every other file downloads without leaving the page, so its card
  has no `target`.
- **The card is styled in the core stylesheet**, `src/styles/global.css`, where the table's wrapper
  is, so every theme has it. It uses the theme's tokens and follows the dark theme, has designed
  hover and focus states, and carries a document glyph drawn by CSS rather than written into the
  HTML. The editor loads the same stylesheet and shows the card as a reader will.
- **Without that style it is a paragraph with a link**, which is what a theme or a feed reader that
  knows nothing of cards shows.
- **The sanitizer keeps what the card is made of** -- `p.file-card`, the two `span`s and their
  classes, and `type` on a link -- and nothing more than before otherwise.
- **A file an article or a page uses cannot be deleted from the library.** The refusal names where
  it is used: today's rule, which finds `attrs.mediaId` anywhere in a document. Its words say
  "file" where they said "image".

## The library

- **The filter** is a bar beside the search: All, Images, PDF, Documents, Spreadsheets, Slides and
  ZIP, in Thai ทั้งหมด, รูป, PDF, เอกสาร, ตารางคำนวณ, สไลด์ and ZIP. On a phone it is a select,
  as the folders are.

  | Group | Types |
  |---|---|
  | Images | the five image types |
  | PDF | PDF |
  | Documents | DOCX, TXT |
  | Spreadsheets | XLSX, CSV |
  | Slides | PPTX |
  | ZIP | ZIP |

- **It filters on the server**, `GET /api/admin/media?type=` with `image`, `file` (every document),
  `pdf`, `document`, `spreadsheet`, `slides` or `zip`, so "Load more" brings more of the same.
  It combines with the folder and the search.
- **The library page keeps the type and the folder in its address**, `?type=pdf&folder=<id>` or
  `unsorted`, so a reload or a shared link opens the same view. The folder is not in the address
  today; keeping only the type would lose the folder on a reload. The picker keeps its own, and
  the editor's address never changes.
- **Upload** takes images and documents on the library page, images alone in the image picker
  (a cover, the author's photo, the image block) and documents alone in the file picker.
- **A document in the grid** is a tile with its type's abbreviation where an image has its
  thumbnail, with its name, type and size.
- **A document's details** have no alternative text; they have its folder, its address with Copy,
  and Delete.
- All new words are in English and Thai, as everything in the admin is.

## The public API

`contentJson` carries the `attachment` nodes and `contentHtml` the cards. The `media` list on a
post or a page stays images only: its schema requires `width` and `height`, and a document in it
would break a client that relies on them. The OpenAPI document does not change.

## Verification

- **Unit.** The byte checks for every type, passing and refused: a DOCX holding `vbaProject.bin`, a
  PDF declared as a DOCX, text with a zero byte, broken UTF-8, a truncated ZIP, a name whose
  extension is not its type's. The `Content-Disposition` value for a Thai name and for names with
  quotes, apostrophes and parentheses. The card's HTML, and what the sanitizer keeps and drops. A
  card's facts taken from the library and not from the request, and a card for another site's
  file refused. The filter's groups.
- **Integration**, on the disposable database and SeaweedFS. A PDF and a DOCX uploaded end to end,
  and the header each returns to an anonymous GET. A refused file leaves nothing in the bucket.
  The migration's checks: an image without dimensions, a document with them, a 26 MB document.
  Its `down`, refused while a document is in the library.
- **Browser.** Upload a PDF in the library, filter to it, reload, and the filter holds. Insert a
  card from +, uploading a DOCX in the picker; publish; the public page shows the card, and its
  link answers with the file. Deleting the file while the post uses it is refused, naming the post.
- Each guard is checked by putting back the bug it guards against.
- The migration tripwire in `tests/unit/db-migrator.test.ts` moves to `021_media_documents`.

## Not in this design

- dropping a document onto the editor;
- a name on the card other than the file's;
- a list of files in the public API beside `media`;
- the legacy Office formats, OpenDocument, audio and video;
- a preview of a document's pages.

Each is an addition to what this builds, if it is ever asked for.

## Risks

- A CSV saved by Excel's plain "CSV" on a Thai system is in Windows-874, not UTF-8, and is
  refused. The refusal says to save it as "CSV UTF-8". Accepting any 8-bit text would stop the
  check from telling text from a binary.
- The header depends on the store keeping it. SeaweedFS 4.46 does, and the integration test pins
  it; S3, R2 and MinIO keep it as standard object metadata. A store that dropped it would show a
  PDF or a text file in the browser instead of downloading it.
- An external store whose CORS rule lists the headers it allows must add `content-disposition`,
  or a document's upload fails at the preflight. The bundled SeaweedFS answers with what was
  asked, for the site's origin only. The README's configuration section says so.
- `docx`, `xlsx` and `pptx` are recognised by the paths their producers write. The format lets a
  main part live elsewhere; a file that puts it there is refused.
