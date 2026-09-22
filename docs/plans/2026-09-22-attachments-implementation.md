# Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Documents -- PDF, docx, xlsx, pptx, CSV, text and ZIP -- are kept in the file library beside the images, can be filtered by type there, and go into an article as a file card that a reader downloads, or opens if it is a PDF.

**Architecture:** The library's upload path gains a second kind. A document is reserved with a signed `Content-Disposition`, put straight into the store by the browser as an image is, and finalized by one streaming read plus Range reads at a ZIP's end, so it is never held whole. A shared Tiptap node, `attachment`, draws the card in the editor and writes the stored HTML, and the server fills its name, type and size from the library whenever it renders. The library's list takes a type filter, which the library page keeps in its address.

**Tech Stack:** Astro 7 SSR, React islands, Tiptap 2.27.3 through novel, Kysely on PostgreSQL 17, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` on SeaweedFS 4.46, `sanitize-html`, zod 4, node:test, Playwright 1.63. No new dependency.

**Spec:** `docs/specs/2026-09-22-attachments-design.md`

## Global Constraints

- The seven document types, exactly, as MIME type (extension, label): `application/pdf` (pdf, PDF); `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx, DOCX); `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx, XLSX); `application/vnd.openxmlformats-officedocument.presentationml.presentation` (pptx, PPTX); `text/csv` (csv, CSV); `text/plain` (txt, TXT); `application/zip` (zip, ZIP). No legacy binary or macro-enabled Office, no HTML, SVG or programs.
- Limits: an image 8,388,608 bytes, as now; a document 26,214,400 bytes. A ZIP's end record is looked for in its last 65,557 bytes, and its central directory is read only up to 1,048,576 bytes. A streaming read keeps the first 1,024 bytes of a file and nothing else.
- A document's `Content-Disposition` is `attachment`, or `inline` for `application/pdf`, then `; filename="<fallback>"; filename*=UTF-8''<the name, RFC 5987>`. The fallback is the name when it is printable ASCII with no `"` or `\`, else `file.<extension>`. It is a signed header of the upload.
- A document's name ends in its type's extension; images keep today's rules. A document has no dimensions and no alternative text.
- Covers, the author's photo and image nodes take images only; attachment nodes take documents only.
- The card's stored HTML is `<p class="file-card"><a href="/media/<id>" type="<mime>"[ target="_blank" rel="noopener noreferrer"]><span class="file-card__name"><name></span> <span class="file-card__meta"><LABEL> · <size></span></a></p>`, with `target` for a PDF only.
- The library's `type` values: `image`, `file` (every document), `pdf`, `document` (DOCX, TXT), `spreadsheet` (XLSX, CSV), `slides` (PPTX), `zip`. The library page keeps `type` and `folder` (`unsorted` or a folder id) in its query; the pickers never touch the address.
- The public API's `media` list stays images only, and the OpenAPI document does not change.
- Owner-facing copy exists in English and Thai with the same keys in the same order, and every Thai entry that has words has Thai characters (`tests/unit/admin-i18n.test.ts`). "PDF" and "ZIP" labels therefore come from the type table, not from the copy.
- Tests run only on disposable stacks: `node scripts/test-foundation.mjs <file>` (project `tomecms-foundation-test`) and the e2e specs' own compose projects. Never the owner's `tome-cms-*` containers or the dev server on :4321.
- Before every commit: `npm run test:unit` (the whole suite) and `npm run check`, both clean.
- Commits: stage by explicit path, never `git stash`, write the message to a scratch file and run `git commit -F <file>` in a Bash call of its own, no attribution lines. Nothing is pushed unless the owner says so.
- Each new guard is checked by putting back the bug it guards against before its task is committed.

## Amendments to the spec, found while planning

1. **Images only where images go.** `assertReadyMediaReferences` checks that an id is a ready item of this site, and nothing more. Once the library holds documents, a crafted request could make a PDF a cover, the author's photo or a picture in an article. It takes a kind, `image` by default, so every existing call keeps asking for images and the new call asks for documents.
2. **The publish path reads through its transaction.** `updatePostStatus` and `updatePageStatus` render inside a transaction, and the integration harness runs a pool of one connection (`DATABASE_POOL_MAX: '1'`); a lookup through `db` there would wait on itself. `prepareContent` takes the database handle to read the library through.
3. **The pickers speak the owner's language.** `BlockInsertMenu` and `ProfileForm` open `MediaPicker` without `ownerLocale`, so the editor's image picker and the author's photo picker have always been in English. The file picker opens through the same menu; all three get the locale.
4. **Refusals speak it too.** The library shows an error as the server wrote it, in English. The three refusals a person causes -- bytes that are not the named type, a macro project, text that is not UTF-8 -- carry a `code` the library turns into its copy, as the editors do with `content_required`. The browser's own checks (unsupported, too large, empty) use the copy directly.
5. **One size formatter.** The library's `formatSize` knows B and KB. `formatBytes` in `src/lib/media.ts` adds MB, and the library and the card both use it.
6. **Cut and paste keep a card.** ProseMirror moves a cut card through clipboard HTML, which only `parseHTML` reads back, so the node renders `data-media-id` and `data-size` for the editor's own clipboard. The sanitizer strips both from what is stored.
7. **Uploads in the browser tests.** No e2e test has uploaded through the library before. The browser puts a file straight into the store, whose test configuration allows `http://localhost:4321` only, while each spec's server takes a free port. `compose.test.yaml` reads the origin from `TOME_CMS_TEST_ORIGIN`, defaulting to today's, and the editor spec sets it.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/media.ts` (modify) | Document types, kinds, filters and limits; `declaredMediaType`, `documentTypeForName`, `formatBytes`, `formatLabel`, `mediaExtension`, `acceptAttribute`, `isImageAsset` |
| `src/server/media/keys.ts` (modify) | The key grammar gains the seven extensions; `createObjectKey` takes any supported type |
| `src/server/db/migrations/021_media_documents.ts` (create), `src/server/db/migrator.ts`, `src/server/db/types.ts` (modify) | Checks by kind, and a `down` that refuses while documents exist |
| `src/server/media/document.ts` (create) | `readDocument`, `findCentralDirectory`, `centralDirectoryNames`, `documentRefusal` -- pure |
| `src/server/media/disposition.ts` (create) | `contentDisposition` -- pure |
| `src/server/media/service.ts` (modify) | Reserving and finalizing documents; `listMedia` by type; kinds in `assertReadyMediaReferences`; `listReadyImagesByIds`, `listReadyDocumentFiles`; the delete message |
| `src/pages/api/admin/media/index.ts` (modify) | The `type` query |
| `src/server/content/published.ts`, `src/server/http/serialize.ts` (modify) | `ReadyImage` for covers, content images and the author's photo |
| `src/lib/editor-attachment.ts` (create) | The `attachment` node, `AttachmentFile`, `attachmentMeta`, `PICK_FILE_EVENT` |
| `src/server/content/editor.ts` (modify) | Registers the node; `parseEditorContent`, `renderEditorContent`, `editorFileIds`; cards filled from the library |
| `src/server/content/mutations.ts`, `posts.ts`, `pages.ts` (modify) | `prepareContent(database, ownerId, input)`, `assertContentMedia` |
| `src/lib/editor-content.ts` (modify) | The sanitizer keeps a card, and a card is content |
| `src/types/cms.ts`, `src/lib/media-client.ts` (modify) | Nullable dimensions; `uploadFile`; `type` in `listMedia`; coded errors |
| `src/components/admin/MediaTypes.tsx` (create), `MediaLibrary.tsx`, `MediaPicker.tsx` (modify) | The type filter, the address, kinds, tiles, details |
| `src/components/admin/BlockInsertMenu.tsx`, `SlashCommands.tsx`, `DocumentCanvas.tsx`, `ProfileForm.tsx`, `PostSettingsDrawer.tsx` (modify) | File in + and /, picker kinds and locale, the card in the editor |
| `src/styles/global.css`, `src/lib/icons.ts`, `src/lib/admin-i18n.ts` (modify) | The card, tiles and the filter; the `file` icon; copy |
| `compose.test.yaml`, `scripts/test-foundation.mjs` (modify) | The test store's allowed origin; storage for the new storage test |
| `README.md` (modify) | CORS for an external store |
| `tests/helpers/zip.ts` (create) | A stored-ZIP writer for fixtures |

---

### Task 1: What a document is, and where it is kept

**Files:**
- Modify: `src/lib/media.ts`, `src/server/media/keys.ts`
- Create: `tests/unit/media-types.test.ts`

**Interfaces:**
- Produces, from `src/lib/media.ts`:
  - `MAX_DOCUMENT_FILE_BYTES = 26_214_400`
  - `ACCEPTED_DOCUMENT_TYPES`, `ACCEPTED_MEDIA_TYPES` (readonly tuples); `SupportedDocumentType`, `SupportedMediaType`, `MediaKind = 'image' | 'document'`
  - `DOCUMENT_GROUPS = ['pdf', 'document', 'spreadsheet', 'slides', 'zip']`, `MEDIA_TYPE_FILTERS = ['image', 'file', ...DOCUMENT_GROUPS]`, `DocumentGroup`, `MediaTypeFilter`
  - `isImageType(type: string): type is SupportedImageType`, `isDocumentType(type: string): type is SupportedDocumentType`
  - `documentExtension(type: SupportedDocumentType): string`, `documentLabel(type: SupportedDocumentType): string`
  - `documentTypeForName(name: string): SupportedDocumentType | null`
  - `mediaExtension(type: string): string | null`
  - `typesForFilter(filter: MediaTypeFilter): readonly SupportedMediaType[]`
  - `formatBytes(bytes: number): string`, `formatLabel(type: SupportedMediaType): string`
  - `MediaRefusal`, `class MediaFileError extends Error { readonly refusal: MediaRefusal }`
  - `declaredMediaType(file: { name: string; size: number; type: string }, accept?: MediaKind | 'any'): SupportedMediaType`
  - `acceptAttribute(accept: MediaKind | 'any'): string`
- Produces, from `src/server/media/keys.ts`: `createObjectKey(ownerId: string, mimeType: SupportedMediaType, now?: Date): string`; `isTomeObjectKey` accepts `csv|docx|pdf|pptx|txt|xlsx|zip` beside the raster types and `svg`.

- [ ] **Step 1: Write the failing test** -- `tests/unit/media-types.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  acceptAttribute,
  ACCEPTED_DOCUMENT_TYPES,
  declaredMediaType,
  documentLabel,
  documentTypeForName,
  formatBytes,
  formatLabel,
  MAX_DOCUMENT_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MediaFileError,
  mediaExtension,
  typesForFilter,
} from '../../src/lib/media';
import { createObjectKey, isTomeObjectKey } from '../../src/server/media/keys';

const OWNER = '123e4567-e89b-42d3-a456-426614174000';

/** What `declaredMediaType` says of a file: its type, or the reason it will not be sent. */
function verdict(file: { name: string; size: number; type: string }, accept?: 'any' | 'document' | 'image') {
  try {
    return declaredMediaType(file, accept);
  } catch (error) {
    return error instanceof MediaFileError ? `refused: ${error.refusal}` : 'thrown';
  }
}

test('a document is known by its name, and only the seven are known', () => {
  assert.equal(documentTypeForName('คู่มือการสมัคร.PDF'), 'application/pdf');
  assert.equal(documentTypeForName('Budget 2569.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(documentTypeForName('notes.txt '), 'text/plain', 'a trailing space is not part of the extension');
  for (const name of ['old.doc', 'old.xls', 'old.ppt', 'macros.docm', 'macros.xlsm', 'macros.pptm', 'page.html', 'logo.svg', 'setup.exe', 'pdf', 'archive.zip.exe']) {
    assert.equal(documentTypeForName(name), null, `${name} is not a document the library keeps`);
  }
  assert.deepEqual(ACCEPTED_DOCUMENT_TYPES.map(documentLabel), ['PDF', 'DOCX', 'XLSX', 'PPTX', 'CSV', 'TXT', 'ZIP']);
  assert.equal(mediaExtension('application/zip'), 'zip');
  assert.equal(mediaExtension('image/jpeg'), 'jpg');
  assert.equal(mediaExtension('application/msword'), null);
  assert.equal(mediaExtension('toString'), null, 'nothing is found on the prototype');
  assert.equal(formatLabel('image/webp'), 'WEBP');
  assert.equal(formatLabel('text/csv'), 'CSV');
});

test('a chosen file is sent as what it is, or refused in the browser with a reason', () => {
  assert.equal(verdict({ name: 'photo.png', size: 10, type: 'image/png' }), 'image/png');
  // Browsers disagree on a CSV's type and some report none for a ZIP, so a document's name decides.
  assert.equal(verdict({ name: 'data.csv', size: 10, type: 'application/vnd.ms-excel' }), 'text/csv');
  assert.equal(verdict({ name: 'archive.zip', size: 10, type: '' }), 'application/zip');
  assert.equal(verdict({ name: 'empty.pdf', size: 0, type: 'application/pdf' }), 'refused: empty');
  assert.equal(verdict({ name: 'old.doc', size: 10, type: 'application/msword' }), 'refused: unsupported');
  assert.equal(verdict({ name: 'guide.pdf', size: 10, type: 'application/pdf' }, 'image'), 'refused: unsupportedImage');
  assert.equal(verdict({ name: 'photo.png', size: 10, type: 'image/png' }, 'document'), 'refused: unsupportedDocument');
  assert.equal(verdict({ name: 'photo.png', size: MAX_IMAGE_BYTES + 1, type: 'image/png' }), 'refused: imageTooLarge');
  assert.equal(verdict({ name: 'big.zip', size: MAX_DOCUMENT_FILE_BYTES + 1, type: 'application/zip' }), 'refused: documentTooLarge');
  assert.equal(verdict({ name: 'big.zip', size: MAX_DOCUMENT_FILE_BYTES, type: 'application/zip' }), 'application/zip', '25 MB exactly');
  assert.equal(MAX_DOCUMENT_FILE_BYTES, 26_214_400);
});

test('sizes read in B, KB or MB', () => {
  assert.equal(formatBytes(812), '812 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(86_016), '84 KB');
  assert.equal(formatBytes(1_258_291), '1.2 MB');
  assert.equal(formatBytes(26_214_400), '25 MB');
});

test('a filter admits its group, and an input takes what its picker takes', () => {
  assert.deepEqual(typesForFilter('document'), ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']);
  assert.deepEqual(typesForFilter('spreadsheet'), ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']);
  assert.deepEqual(typesForFilter('slides'), ['application/vnd.openxmlformats-officedocument.presentationml.presentation']);
  assert.deepEqual(typesForFilter('file'), [...ACCEPTED_DOCUMENT_TYPES]);
  assert.ok(typesForFilter('image').every((type) => type.startsWith('image/')));
  assert.doesNotMatch(acceptAttribute('image'), /pdf|zip/);
  assert.match(acceptAttribute('document'), /(^|,)\.csv(,|$)/);
  assert.doesNotMatch(acceptAttribute('document'), /image\//);
  assert.match(acceptAttribute('any'), /image\/png.*\.pdf/);
});

test('a document lives under the grammar backup, restore and reset accept', () => {
  const key = createObjectKey(OWNER, 'application/pdf', new Date('2026-09-22T00:00:00Z'));
  assert.match(key, /^owners\/123e4567-e89b-42d3-a456-426614174000\/2026\/09\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(isTomeObjectKey(key), true);
  for (const extension of ['csv', 'docx', 'pdf', 'pptx', 'txt', 'xlsx', 'zip']) {
    assert.equal(isTomeObjectKey(`owners/${OWNER}/2026/09/${randomUUID()}.${extension}`), true, extension);
  }
  for (const extension of ['doc', 'docm', 'xlsm', 'exe', 'html']) {
    assert.equal(isTomeObjectKey(`owners/${OWNER}/2026/09/${randomUUID()}.${extension}`), false, extension);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test tests/unit/media-types.test.ts`
Expected: FAIL -- `SyntaxError` naming the first missing export, `acceptAttribute`.

- [ ] **Step 3: Implement** -- in `src/lib/media.ts`, below `MAX_IMAGE_BYTES`, add:

```ts
/**
 * A document is checked as it streams past rather than held whole, as an image has to be for
 * sharp, so it may be larger than one.
 */
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;
```

Below `ACCEPTED_IMAGE_TYPES`, add:

```ts
/**
 * What the library keeps beside its images. Office in its current formats only: a legacy
 * binary file can carry a macro that no look at its signature finds, and a macro-enabled one
 * is named for carrying them.
 */
export const ACCEPTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'application/zip',
] as const;

export const ACCEPTED_MEDIA_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_DOCUMENT_TYPES] as const;
```

Replace everything from `export type SupportedImageType` through the end of `imageExtension` with:

```ts
export type SupportedImageType = keyof typeof IMAGE_EXTENSIONS;
export type SupportedDocumentType = (typeof ACCEPTED_DOCUMENT_TYPES)[number];
export type SupportedMediaType = SupportedImageType | SupportedDocumentType;
export type MediaKind = 'image' | 'document';

/** The groups the library filters documents by, beside images. */
export const DOCUMENT_GROUPS = ['pdf', 'document', 'spreadsheet', 'slides', 'zip'] as const;
export type DocumentGroup = (typeof DOCUMENT_GROUPS)[number];
/** What `GET /api/admin/media?type=` takes. `file` is every document. */
export const MEDIA_TYPE_FILTERS = ['image', 'file', ...DOCUMENT_GROUPS] as const;
export type MediaTypeFilter = (typeof MEDIA_TYPE_FILTERS)[number];

/** Each document's extension, its group, and the abbreviation a reader sees in every language. */
const DOCUMENT_FORMATS: Record<SupportedDocumentType, { extension: string; group: DocumentGroup; label: string }> = {
  'application/pdf': { extension: 'pdf', group: 'pdf', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', group: 'document', label: 'DOCX' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', group: 'spreadsheet', label: 'XLSX' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { extension: 'pptx', group: 'slides', label: 'PPTX' },
  'text/csv': { extension: 'csv', group: 'spreadsheet', label: 'CSV' },
  'text/plain': { extension: 'txt', group: 'document', label: 'TXT' },
  'application/zip': { extension: 'zip', group: 'zip', label: 'ZIP' },
};

export function isImageType(type: string): type is SupportedImageType {
  return Object.hasOwn(IMAGE_EXTENSIONS, type);
}

export function isDocumentType(type: string): type is SupportedDocumentType {
  return Object.hasOwn(DOCUMENT_FORMATS, type);
}

export function imageExtension(type: string): string | null {
  return isImageType(type) ? IMAGE_EXTENSIONS[type] : null;
}

export function documentExtension(type: SupportedDocumentType): string {
  return DOCUMENT_FORMATS[type].extension;
}

/** 'PDF', 'DOCX': what a card and a tile call a document, the same in every language. */
export function documentLabel(type: SupportedDocumentType): string {
  return DOCUMENT_FORMATS[type].label;
}

/** What a tile calls a file's format: PNG and WEBP for images, PDF and DOCX for documents. */
export function formatLabel(type: SupportedMediaType): string {
  return isDocumentType(type) ? documentLabel(type) : type.replace('image/', '').toUpperCase();
}

export function mediaExtension(type: string): string | null {
  if (isImageType(type)) return IMAGE_EXTENSIONS[type];
  return isDocumentType(type) ? DOCUMENT_FORMATS[type].extension : null;
}

/** The document a name says a file is, by its extension alone. */
export function documentTypeForName(name: string): SupportedDocumentType | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  return ACCEPTED_DOCUMENT_TYPES.find((type) => DOCUMENT_FORMATS[type].extension === extension) ?? null;
}

/** The types a filter admits, for the library's query. */
export function typesForFilter(filter: MediaTypeFilter): readonly SupportedMediaType[] {
  if (filter === 'image') return ACCEPTED_IMAGE_TYPES;
  if (filter === 'file') return ACCEPTED_DOCUMENT_TYPES;
  return ACCEPTED_DOCUMENT_TYPES.filter((type) => DOCUMENT_FORMATS[type].group === filter);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
}

/** Why the browser will not send a file, as a key of the admin's copy. */
export type MediaRefusal = 'documentTooLarge' | 'empty' | 'imageTooLarge' | 'unsupported' | 'unsupportedDocument' | 'unsupportedImage';

export class MediaFileError extends Error {
  constructor(readonly refusal: MediaRefusal) {
    super(refusal);
  }
}

/**
 * The type a chosen file is sent as. An image is what the browser says, having read it. A
 * document is what its name says, because browsers disagree on a CSV's type or a ZIP's and some
 * report none. The server reads the bytes either way.
 */
export function declaredMediaType(
  file: { name: string; size: number; type: string },
  accept: MediaKind | 'any' = 'any',
): SupportedMediaType {
  if (!file.size) throw new MediaFileError('empty');
  if (accept !== 'document' && isImageType(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) throw new MediaFileError('imageTooLarge');
    return file.type;
  }
  const documentType = accept === 'image' ? null : documentTypeForName(file.name);
  if (documentType) {
    if (file.size > MAX_DOCUMENT_FILE_BYTES) throw new MediaFileError('documentTooLarge');
    return documentType;
  }
  throw new MediaFileError(accept === 'image' ? 'unsupportedImage' : accept === 'document' ? 'unsupportedDocument' : 'unsupported');
}

/** A file input's `accept`: types for images, types and extensions for documents. */
export function acceptAttribute(accept: MediaKind | 'any'): string {
  const images = accept === 'document' ? [] : [...ACCEPTED_IMAGE_TYPES];
  const documents = accept === 'image' ? [] : ACCEPTED_DOCUMENT_TYPES.flatMap((type) => [type, `.${DOCUMENT_FORMATS[type].extension}`]);
  return [...images, ...documents].join(',');
}
```

In `src/server/media/keys.ts`, change the import to `import { mediaExtension, type SupportedMediaType } from '../../lib/media';`, the grammar to:

```ts
const OBJECT_KEY = /^owners\/([0-9a-f-]{36})\/(\d{4})\/(0[1-9]|1[0-2])\/([0-9a-f-]{36})\.(avif|csv|docx|gif|jpg|pdf|png|pptx|svg|txt|webp|xlsx|zip)$/i;
```

and `createObjectKey` to:

```ts
export function createObjectKey(ownerId: string, mimeType: SupportedMediaType, now = new Date()): string {
  if (!isUuid(ownerId)) throw new Error('Media owner ID must be a UUID.');
  const extension = mediaExtension(mimeType);
  if (!extension) throw new Error('Unsupported media type.');
  return objectKey(ownerId, extension, now);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import tsx --test tests/unit/media-types.test.ts tests/unit/media-storage.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Put each guard's bug back, one at a time, and see the test catch it**

1. In `declaredMediaType`, return `file.type` for documents when it is set, instead of the name's type. Expected: FAIL at `data.csv`.
2. Drop `docx` from `OBJECT_KEY`. Expected: FAIL at `docx` in the grammar test.
3. Use `type in IMAGE_EXTENSIONS` in `isImageType`. Expected: FAIL at `toString`.

Restore each before the next.

- [ ] **Step 6: The whole unit suite and the check**

Run: `npm run test:unit && npm run check`
Expected: every unit test passes; `astro check` reports 0 errors and 0 warnings, and the self-tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/media.ts src/server/media/keys.ts tests/unit/media-types.test.ts
```

Message:

```
feat(media): the library knows seven document types, and keys them like images

PDF, docx, xlsx, pptx, CSV, text and ZIP: what each is called, the extension its name ends
in, the group the library filters it by, and the abbreviation a reader sees. A document is
typed by its name in the browser, since browsers disagree on a CSV's type and some report
none for a ZIP; an image keeps the type the browser read. Sizes read in MB now as well.

The key grammar that backup, restore-check and reset accept gains the seven extensions.
```

---

### Task 2: The tables hold a document by its own rules

**Files:**
- Create: `src/server/db/migrations/021_media_documents.ts`, `tests/integration/media-documents-schema.test.ts`
- Modify: `src/server/db/migrator.ts`, `src/server/db/types.ts`, `tests/unit/db-migrator.test.ts`, and -- for three lines Task 4 replaces -- `src/server/media/service.ts`

**Interfaces:**
- Consumes: `SupportedMediaType` (Task 1).
- Produces: `MediaItemTable.mime_type: SupportedMediaType`, `width: number | null`, `height: number | null`; `MediaUploadReservationTable.mime_type: SupportedMediaType`; migration `021_media_documents` with `up` and a `down` that throws while a document is in the library.

- [ ] **Step 1: Write the failing test** -- `tests/integration/media-documents-schema.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { SupportedMediaType } from '../../src/lib/media';

test('a document has no dimensions and no alternative text, and may be 25 MB', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const documents = await import('../../src/server/db/migrations/021_media_documents');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'documents@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const checksum = `${'A'.repeat(43)}=`;
  const item = {
    owner_id: ownerId, folder_id: null, original_name: 'guide.pdf', mime_type: 'application/pdf' as SupportedMediaType,
    size_bytes: 1024, checksum_sha256: checksum, width: null as number | null, height: null as number | null,
    alt_text: null as string | null, state: 'ready' as const, delete_error_code: null,
  };
  const key = () => `owners/${ownerId}/2026/09/${randomUUID()}.pdf`;
  const refused = { code: '23514' };

  const pdf = await db.insertInto('media_items').values({ ...item, object_key: key(), size_bytes: 26_214_400 })
    .returning('id').executeTakeFirstOrThrow();
  for (const [wrong, why] of [
    [{ size_bytes: 26_214_401 }, 'a document over 25 MB'],
    [{ width: 10, height: 10 }, 'a document with dimensions'],
    [{ alt_text: 'A guide' }, 'a document with alternative text'],
    [{ mime_type: 'application/msword' as SupportedMediaType }, 'a legacy Word file'],
    [{ mime_type: 'application/vnd.ms-word.document.macroEnabled.12' as SupportedMediaType }, 'a macro-enabled one'],
    [{ mime_type: 'image/png' as SupportedMediaType }, 'an image without dimensions'],
    [{ mime_type: 'image/png' as SupportedMediaType, width: 1, height: 1, size_bytes: 8_388_609 }, 'an image over 8 MB'],
  ] as const) {
    await assert.rejects(db.insertInto('media_items').values({ ...item, object_key: key(), ...wrong }).execute(), refused, why);
  }
  await db.insertInto('media_items').values({
    ...item, object_key: key(), mime_type: 'image/png', width: 1, height: 1, alt_text: 'Still an image', size_bytes: 8_388_608,
  }).execute();

  const reservation = {
    owner_id: ownerId, folder_id: null, original_name: 'guide.pdf', mime_type: 'application/pdf' as SupportedMediaType,
    expected_size_bytes: 26_214_400, expected_checksum_sha256: checksum, alt_text: null as string | null,
    state: 'pending' as const, expires_at: new Date(Date.now() + 300_000), finalized_at: null,
  };
  await db.insertInto('media_upload_reservations').values({ ...reservation, object_key: key() }).execute();
  await assert.rejects(db.insertInto('media_upload_reservations').values({ ...reservation, object_key: key(), alt_text: 'x' }).execute(), refused);
  await assert.rejects(db.insertInto('media_upload_reservations').values({ ...reservation, object_key: key(), expected_size_bytes: 26_214_401 }).execute(), refused);

  // Undoing it refuses while a document is in the library, and says why and what to do.
  await assert.rejects(documents.down(db), /cannot be undone while the library holds 1 document/);
  await db.deleteFrom('media_items').where('id', '=', pdf.id).execute();
  await documents.down(db);
  assert.equal(await db.selectFrom('media_upload_reservations').select('id').where('mime_type', '=', 'application/pdf').executeTakeFirst(),
    undefined, 'the reservations made for documents went with it');
  await assert.rejects(db.insertInto('media_items').values({ ...item, object_key: key() }).execute(), refused, 'and a document is refused again');
  await documents.up(db);
  await db.insertInto('media_items').values({ ...item, object_key: key() }).execute();
});
```

In `tests/unit/db-migrator.test.ts`, change the tripwire to `assert.equal(names.at(-1), '021_media_documents');`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/db-migrator.test.ts` and `node scripts/test-foundation.mjs tests/integration/media-documents-schema.test.ts`
Expected: the unit test FAILS on `'020_site_brand' !== '021_media_documents'`; the integration test FAILS to import `021_media_documents`.

- [ ] **Step 3: Implement** -- `src/server/db/migrations/021_media_documents.ts`:

```ts
import { sql, type Kysely } from 'kysely';

import type { Database } from '../types';

/**
 * Documents beside the images: PDF, docx, xlsx, pptx, CSV, text and ZIP. Each kind keeps its
 * own rules. An image has its dimensions and may be 8 MB; a document has none and may be 25.
 * Alternative text describes an image, so a document has none.
 *
 * The lists are written out rather than imported: a migration says what it did on the day it
 * ran, whatever the application later accepts.
 */
const IMAGE_TYPES = sql`('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')`;
const MEDIA_TYPES = sql`('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain', 'application/zip')`;

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table media_items
      drop constraint media_items_mime_type_check,
      drop constraint media_items_size_check,
      drop constraint media_items_dimensions_check,
      alter column width drop not null,
      alter column height drop not null,
      add constraint media_items_mime_type_check check (mime_type in ${MEDIA_TYPES}),
      add constraint media_items_size_check check (
        size_bytes between 1 and case when mime_type in ${IMAGE_TYPES} then 8388608 else 26214400 end
      ),
      add constraint media_items_dimensions_check check (
        (mime_type in ${IMAGE_TYPES} and width is not null and height is not null
          and width between 1 and 100000 and height between 1 and 100000)
        or (mime_type not in ${IMAGE_TYPES} and width is null and height is null)
      ),
      add constraint media_items_alt_text_kind_check check (mime_type in ${IMAGE_TYPES} or alt_text is null);

    alter table media_upload_reservations
      drop constraint media_upload_reservations_mime_type_check,
      drop constraint media_upload_reservations_size_check,
      add constraint media_upload_reservations_mime_type_check check (mime_type in ${MEDIA_TYPES}),
      add constraint media_upload_reservations_size_check check (
        expected_size_bytes between 1 and case when mime_type in ${IMAGE_TYPES} then 8388608 else 26214400 end
      ),
      add constraint media_upload_reservations_alt_text_kind_check check (mime_type in ${IMAGE_TYPES} or alt_text is null);
  `.execute(db);
}

/**
 * Refuses while the library holds a document. Dimensions cannot be made required again with
 * documents in the table, and dropping their rows would leave cards in articles pointing at
 * nothing. The reservations made for documents go: without a document they account for
 * nothing.
 */
export async function down(db: Kysely<Database>): Promise<void> {
  const { rows } = await sql<{ documents: number }>`
    select count(*)::integer as documents from media_items where mime_type not in ${IMAGE_TYPES}
  `.execute(db);
  const documents = rows[0]?.documents ?? 0;
  if (documents) {
    throw new Error(`021_media_documents cannot be undone while the library holds ${documents} document${documents === 1 ? '' : 's'}. `
      + 'Delete them in the file library first.');
  }
  await sql`
    delete from media_upload_reservations where mime_type not in ${IMAGE_TYPES};

    alter table media_items
      drop constraint media_items_alt_text_kind_check,
      drop constraint media_items_dimensions_check,
      drop constraint media_items_size_check,
      drop constraint media_items_mime_type_check,
      alter column width set not null,
      alter column height set not null,
      add constraint media_items_mime_type_check check (mime_type in ${IMAGE_TYPES}),
      add constraint media_items_size_check check (size_bytes between 1 and 8388608),
      add constraint media_items_dimensions_check check (width between 1 and 100000 and height between 1 and 100000);

    alter table media_upload_reservations
      drop constraint media_upload_reservations_alt_text_kind_check,
      drop constraint media_upload_reservations_size_check,
      drop constraint media_upload_reservations_mime_type_check,
      add constraint media_upload_reservations_mime_type_check check (mime_type in ${IMAGE_TYPES}),
      add constraint media_upload_reservations_size_check check (expected_size_bytes between 1 and 8388608);
  `.execute(db);
}
```

A `mime_type in (...) and width is not null` check is written out in full on purpose: a check whose expression is null passes, so `width between 1 and 100000` alone would let an image through with no width.

In `src/server/db/migrator.ts`, import it as `import * as mediaDocuments from './migrations/021_media_documents';` after the `siteBrand` import, and add `'021_media_documents': mediaDocuments,` after `'020_site_brand': siteBrand,`.

In `src/server/db/types.ts`, import `SupportedMediaType` beside `SupportedImageType` (drop `SupportedImageType` from that import if nothing else in the file uses it), and in `MediaItemTable` set:

```ts
  mime_type: SupportedMediaType;
  size_bytes: ColumnType<string, number, number>;
  checksum_sha256: string;
  /** Null for a document: only an image has dimensions. */
  width: number | null;
  height: number | null;
```

and in `MediaUploadReservationTable` set `mime_type: SupportedMediaType;`.

- [ ] **Step 4: Run them to see them pass**

Run: `node --import tsx --test tests/unit/db-migrator.test.ts` and `node scripts/test-foundation.mjs tests/integration/media-documents-schema.test.ts tests/integration/media-schema.test.ts`
Expected: PASS. `media-schema.test.ts` is the old image-only schema test, run to show its images are still held to the same rules.

- [ ] **Step 5: Put each guard's bug back**

1. Write the dimensions check as `width between 1 and 100000 and height between 1 and 100000 or width is null`. Expected: FAIL at "an image without dimensions".
2. Remove `media_items_alt_text_kind_check`. Expected: FAIL at "a document with alternative text".
3. Make `down` skip its count. Expected: FAIL at the `cannot be undone` assertion, with Postgres refusing to set `width` not null.

- [ ] **Step 6: The whole unit suite and the check**

Run: `npm run check`
Expected: `astro check` names three lines in `src/server/media/service.ts`, the only code that reads a media row's type and dimensions into image-only shapes: `readyMedia`'s `mime_type` and `width`/`height`, and the `inspectImage` call in `finalizeUpload`. No document can reach them before Task 4, which rewrites all three, so hold them to images for now and nothing else:

```ts
    mime_type: row.mime_type as SupportedImageType,
    size_bytes: size,
    width: row.width ?? 0,
    height: row.height ?? 0,
```

```ts
        dimensions = await inspectImage(body, reservation.mime_type as SupportedImageType);
```

Then run `npm run test:unit && npm run check`.
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/migrations/021_media_documents.ts src/server/db/migrator.ts src/server/db/types.ts \
  src/server/media/service.ts tests/integration/media-documents-schema.test.ts tests/unit/db-migrator.test.ts
```

Message:

```
feat(db): a document has no dimensions, no alternative text, and up to 25 MB

Migration 021_media_documents lets media_items and media_upload_reservations hold the seven
document types beside the five image types, each by its kind's rules: an image keeps its
dimensions and 8 MB, a document has none and may be 25 MB, and only an image has alternative
text. A check whose expression is null passes, so an image's dimensions are required in so
many words rather than by a range.

Its down refuses while the library holds a document, and says to delete them first:
dimensions cannot be required again with documents in the table, and dropping their rows
would leave cards pointing at nothing.
```

---

### Task 3: A document is judged by its bytes as they stream past

**Files:**
- Create: `src/server/media/document.ts`, `src/server/media/disposition.ts`, `tests/helpers/zip.ts`, `tests/unit/media-documents.test.ts`

**Interfaces:**
- Consumes: `SupportedDocumentType`, `documentExtension` (Task 1).
- Produces, from `src/server/media/document.ts`: `HEAD_BYTES = 1024`, `ZIP_TAIL_BYTES = 65_557`, `MAX_CENTRAL_DIRECTORY_BYTES = 1_048_576`; `type DocumentRefusal = 'media_macros' | 'media_text_encoding' | 'media_type_mismatch'`; `interface DocumentRead { checksum: string; head: Buffer; size: number; utf8: boolean }`; `isTextDocument(type): boolean`; `readDocument(body: AsyncIterable<Uint8Array>, maximum: number, text: boolean): Promise<DocumentRead | null>` (null when the body runs past `maximum`); `findCentralDirectory(tail: Buffer, fileSize: number): { entries: number; offset: number; size: number } | null`; `centralDirectoryNames(directory: Buffer, entries: number): string[] | null`; `documentRefusal(type, read, range: (start: number, end: number) => Promise<Buffer>): Promise<DocumentRefusal | null>`.
- Produces, from `src/server/media/disposition.ts`: `contentDisposition(name: string, type: SupportedDocumentType): string`.
- Produces, from `tests/helpers/zip.ts`: `zip(entries: ZipEntry[], comment?: string): Buffer`; `office(main: 'word/document.xml' | 'xl/workbook.xml' | 'ppt/presentation.xml', extra?: ZipEntry[]): Buffer`.

- [ ] **Step 1: Write the fixture writer** -- `tests/helpers/zip.ts`:

```ts
import { crc32 } from 'node:zlib';

/** One file in an archive. */
export interface ZipEntry {
  data: Buffer | string;
  name: string;
}

/**
 * A ZIP with its entries stored uncompressed, which every reader accepts: enough to stand for
 * an Office file or an archive in a test.
 */
export function zip(entries: ZipEntry[], comment = ''): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names in UTF-8
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const listing = Buffer.concat(directory);
  const note = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(note.length, 20);
  return Buffer.concat([...parts, listing, end, note]);
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

/** The least an Office file is recognised by: its content types and its main part. */
export function office(main: 'word/document.xml' | 'xl/workbook.xml' | 'ppt/presentation.xml', extra: ZipEntry[] = []): Buffer {
  return zip([{ data: CONTENT_TYPES, name: '[Content_Types].xml' }, { data: '<x/>', name: main }, ...extra]);
}
```

- [ ] **Step 2: Write the failing test** -- `tests/unit/media-documents.test.ts`:

```ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import type { SupportedDocumentType } from '../../src/lib/media';
import { contentDisposition } from '../../src/server/media/disposition';
import { centralDirectoryNames, documentRefusal, findCentralDirectory, readDocument } from '../../src/server/media/document';
import { office, zip } from '../helpers/zip';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' as const;

/** Streams `bytes` in pieces of `size`, so a check that only works on a whole file fails. */
function pieces(bytes: Buffer, size = 7): Readable {
  const parts: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += size) parts.push(bytes.subarray(at, at + size));
  return Readable.from(parts);
}

/** What the service does: one read of the whole file, then ranges answered from it. */
async function judge(type: SupportedDocumentType, bytes: Buffer) {
  const read = await readDocument(pieces(bytes), bytes.length, type === 'text/csv' || type === 'text/plain');
  assert.ok(read);
  const ranges: Array<[number, number]> = [];
  const refusal = await documentRefusal(type, read, async (start, end) => {
    ranges.push([start, end]);
    return bytes.subarray(start, end + 1);
  });
  return { ranges, refusal };
}

test('one read hashes a document and keeps only its first kilobyte', async () => {
  const bytes = Buffer.alloc(300_000, 0x61);
  const read = await readDocument(pieces(bytes, 4096), bytes.length, true);
  assert.equal(read?.checksum, createHash('sha256').update(bytes).digest('base64'));
  assert.equal(read?.size, 300_000);
  assert.equal(read?.head.length, 1024);
  assert.equal(await readDocument(pieces(bytes), bytes.length - 1, false), null, 'a file longer than declared stops the read');
});

test('text is UTF-8 without a zero byte, wherever the store cuts it', async () => {
  // Seven-byte pieces cut Thai letters, three bytes each, across reads.
  const thai = Buffer.from('ชื่อ,อายุ\nสมชาย,30\n', 'utf8');
  assert.equal((await judge('text/csv', thai)).refusal, null);
  assert.equal((await judge('text/csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), thai]))).refusal, null, 'a byte-order mark');
  // What Excel's plain "CSV" writes on a Thai system: Windows-874, one byte a letter.
  assert.equal((await judge('text/csv', Buffer.from([0xaa, 0xd7, 0xe8, 0xcd, 0x2c, 0x31, 0x0a]))).refusal, 'media_text_encoding');
  assert.equal((await judge('text/plain', Buffer.from([0x61, 0x00, 0x62]))).refusal, 'media_text_encoding', 'a zero byte');
  assert.equal((await judge('text/plain', Buffer.from([0x61, 0xe0, 0xb8]))).refusal, 'media_text_encoding', 'a letter cut off at the end');
});

test('a PDF starts as one', async () => {
  assert.equal((await judge('application/pdf', Buffer.from('%PDF-1.7\n%%EOF\n'))).refusal, null);
  assert.equal((await judge('application/pdf', office('word/document.xml'))).refusal, 'media_type_mismatch');
});

test('an Office file is its type and carries no macro project, and only its end is fetched again', async () => {
  assert.equal((await judge(DOCX, office('word/document.xml'))).refusal, null);
  assert.equal((await judge(XLSX, office('xl/workbook.xml'))).refusal, null);
  assert.equal((await judge(PPTX, office('ppt/presentation.xml'))).refusal, null);
  assert.equal((await judge(DOCX, office('xl/workbook.xml'))).refusal, 'media_type_mismatch', 'a workbook named .docx');
  assert.equal((await judge(DOCX, office('word/document.xml', [{ data: 'x', name: 'word/vbaProject.bin' }]))).refusal,
    'media_macros', 'a .docm renamed');
  assert.equal((await judge(XLSX, office('xl/workbook.xml', [{ data: 'x', name: 'xl/VBAPROJECT.BIN' }]))).refusal, 'media_macros');
  assert.equal((await judge(DOCX, Buffer.from('%PDF-1.7\n'))).refusal, 'media_type_mismatch');
  const docx = office('word/document.xml');
  assert.equal((await judge(DOCX, docx.subarray(0, docx.length - 10))).refusal, 'media_type_mismatch', 'an archive cut short');

  const large = office('word/document.xml', [{ data: Buffer.alloc(200_000, 1), name: 'word/media/photo.bin' }]);
  const { ranges, refusal } = await judge(DOCX, large);
  assert.equal(refusal, null);
  assert.deepEqual(ranges[0], [large.length - 65_557, large.length - 1], 'the end, and only the end');
  assert.ok(ranges.every(([start, end]) => end - start < 70_000), 'never the whole file');
});

test('a ZIP is one to its end, and an empty one is still one', async () => {
  assert.equal((await judge('application/zip', zip([{ data: 'a', name: 'a.txt' }], 'a comment at the end'))).refusal, null);
  const empty = zip([]);
  assert.equal(empty.length, 22);
  assert.equal((await judge('application/zip', empty)).refusal, null);
  assert.equal((await judge('application/zip', Buffer.from('PK not really'))).refusal, 'media_type_mismatch');
});

test('a directory is read only where it says it is', () => {
  const archive = zip([{ data: '1', name: 'one.txt' }, { data: '2', name: 'สอง.txt' }]);
  const directory = findCentralDirectory(archive.subarray(-65_557), archive.length);
  assert.ok(directory);
  assert.equal(directory.entries, 2);
  assert.deepEqual(centralDirectoryNames(archive.subarray(directory.offset, directory.offset + directory.size), directory.entries),
    ['one.txt', 'สอง.txt']);
  // An end record that points past itself is not one.
  const lying = Buffer.from(archive);
  lying.writeUInt32LE(archive.length, archive.length - 6);
  assert.equal(findCentralDirectory(lying.subarray(-65_557), lying.length), null);
  assert.equal(centralDirectoryNames(Buffer.from('not a directory at all, not even close to one'), 1), null);
});

test('a document keeps its own name, and a PDF opens where it is', () => {
  assert.equal(contentDisposition('คู่มือการสมัคร.pdf', 'application/pdf'),
    `inline; filename="file.pdf"; filename*=UTF-8''${encodeURIComponent('คู่มือการสมัคร.pdf')}`);
  assert.equal(contentDisposition('Budget 2026.xlsx', XLSX), `attachment; filename="Budget 2026.xlsx"; filename*=UTF-8''Budget%202026.xlsx`);
  // RFC 5987 has no room for these unescaped.
  assert.equal(contentDisposition(`Tom's (final) *copy*.docx`, DOCX),
    `attachment; filename="Tom's (final) *copy*.docx"; filename*=UTF-8''Tom%27s%20%28final%29%20%2Acopy%2A.docx`);
  // A quote would end the plain name early.
  assert.equal(contentDisposition('say "hi".txt', 'text/plain'), `attachment; filename="file.txt"; filename*=UTF-8''say%20%22hi%22.txt`);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --import tsx --test tests/unit/media-documents.test.ts`
Expected: FAIL -- cannot find module `src/server/media/disposition`.

- [ ] **Step 4: Implement** -- `src/server/media/disposition.ts`:

```ts
import { documentExtension, type SupportedDocumentType } from '../../lib/media';

/** RFC 5987's attr-char leaves out four that encodeURIComponent lets through: ' ( ) *. */
function encodeFilename(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * How a document is handed to a reader: downloaded under its own name, or opened in the
 * browser if it is a PDF. `filename*` carries the name in UTF-8. `filename` is for the few
 * clients that read no other, and is the name itself only when it is printable ASCII that
 * needs no escaping.
 */
export function contentDisposition(name: string, type: SupportedDocumentType): string {
  const fallback = /^[ -~]+$/.test(name) && !/["\\]/.test(name) ? name : `file.${documentExtension(type)}`;
  return `${type === 'application/pdf' ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeFilename(name)}`;
}
```

`src/server/media/document.ts`:

```ts
import { createHash } from 'node:crypto';

import type { SupportedDocumentType } from '../../lib/media';

/** How much of a document's start a read keeps: more than any signature it is held to. */
export const HEAD_BYTES = 1024;
/** A ZIP's end record is 22 bytes, and a comment of up to 65,535 may follow it. */
export const ZIP_TAIL_BYTES = 22 + 0xffff;
/** An Office file's directory runs to kilobytes; one past a megabyte is not one. */
export const MAX_CENTRAL_DIRECTORY_BYTES = 1024 * 1024;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

/** The part every producer of each Office type writes. */
const MAIN_PART: Partial<Record<SupportedDocumentType, string>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/presentation.xml',
};

/** Why a document is refused, as the code the admin finds its words by. */
export type DocumentRefusal = 'media_macros' | 'media_text_encoding' | 'media_type_mismatch';

export interface DocumentRead {
  checksum: string;
  head: Buffer;
  size: number;
  /** Whether every byte was UTF-8 and none was zero. Only asked of text. */
  utf8: boolean;
}

export interface CentralDirectory {
  entries: number;
  offset: number;
  size: number;
}

export function isTextDocument(type: SupportedDocumentType): boolean {
  return type === 'text/csv' || type === 'text/plain';
}

/**
 * One pass over a document as the store sends it: the hash of all of it, its first kilobyte,
 * and, for text, whether it is UTF-8 without a zero byte. Nothing else is kept, so a 25 MB file
 * costs what a kilobyte does. Null when it runs past `maximum`.
 */
export async function readDocument(body: AsyncIterable<Uint8Array>, maximum: number, text: boolean): Promise<DocumentRead | null> {
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const head: Buffer[] = [];
  let kept = 0;
  let size = 0;
  let utf8 = text;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maximum) return null;
    hash.update(chunk);
    if (kept < HEAD_BYTES) {
      const part = Buffer.from(chunk.subarray(0, HEAD_BYTES - kept));
      head.push(part);
      kept += part.length;
    }
    if (utf8 && chunk.includes(0)) utf8 = false;
    if (utf8) {
      try {
        decoder.decode(chunk, { stream: true });
      } catch {
        utf8 = false;
      }
    }
  }
  if (utf8) {
    try {
      decoder.decode();
    } catch {
      utf8 = false;
    }
  }
  return { checksum: hash.digest('base64'), head: Buffer.concat(head), size, utf8 };
}

/**
 * The central directory an end record in `tail` points at, if `tail` really ends a ZIP of
 * `fileSize` bytes: the record's comment has to run exactly to the end, and the directory has
 * to lie before the record. A ZIP64 archive, whose record points nowhere, is not one here.
 */
export function findCentralDirectory(tail: Buffer, fileSize: number): CentralDirectory | null {
  for (let at = tail.length - 22; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) !== END_OF_DIRECTORY) continue;
    if (at + 22 + tail.readUInt16LE(at + 20) !== tail.length) continue;
    const directory = { entries: tail.readUInt16LE(at + 10), offset: tail.readUInt32LE(at + 16), size: tail.readUInt32LE(at + 12) };
    return directory.offset + directory.size <= fileSize - tail.length + at ? directory : null;
  }
  return null;
}

/** The names in a central directory, or null when it is not one. */
export function centralDirectoryNames(directory: Buffer, entries: number): string[] | null {
  const names: string[] = [];
  let at = 0;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_HEADER) return null;
    const nameLength = directory.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
    if (next > directory.length) return null;
    names.push(directory.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
    at = next;
  }
  return at === directory.length ? names : null;
}

/**
 * Why a document's bytes are not what its type says, or null when they are. Text and a PDF are
 * judged by the read alone. A ZIP, and the three Office types built on one, by what its end
 * says of its directory: `range` fetches that from the store, and nothing else is fetched.
 */
export async function documentRefusal(
  type: SupportedDocumentType,
  read: DocumentRead,
  range: (start: number, end: number) => Promise<Buffer>,
): Promise<DocumentRefusal | null> {
  if (isTextDocument(type)) return read.utf8 ? null : 'media_text_encoding';
  if (type === 'application/pdf') return read.head.subarray(0, 5).toString('latin1') === '%PDF-' ? null : 'media_type_mismatch';

  const signature = read.head.length >= 4 ? read.head.readUInt32LE(0) : 0;
  const emptyArchive = type === 'application/zip' && read.size === 22 && signature === END_OF_DIRECTORY;
  if (signature !== LOCAL_HEADER && !emptyArchive) return 'media_type_mismatch';
  const directory = findCentralDirectory(await range(Math.max(0, read.size - ZIP_TAIL_BYTES), read.size - 1), read.size);
  if (!directory) return 'media_type_mismatch';
  const main = MAIN_PART[type];
  if (!main) return null;

  if (!directory.size || directory.size > MAX_CENTRAL_DIRECTORY_BYTES) return 'media_type_mismatch';
  const names = centralDirectoryNames(await range(directory.offset, directory.offset + directory.size - 1), directory.entries);
  if (!names) return 'media_type_mismatch';
  if (names.some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) return 'media_macros';
  return names.includes('[Content_Types].xml') && names.includes(main) ? null : 'media_type_mismatch';
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `node --import tsx --test tests/unit/media-documents.test.ts`
Expected: PASS, all seven tests.

- [ ] **Step 6: Put each guard's bug back**

1. Drop the `vbaProject.bin` line. Expected: FAIL at "a .docm renamed".
2. Stop checking `chunk.includes(0)`. Expected: FAIL at "a zero byte".
3. Decode each chunk without `{ stream: true }`. Expected: FAIL at the Thai CSV cut into seven-byte pieces.
4. In `findCentralDirectory`, return the directory without comparing it to the record's place. Expected: FAIL at the end record that points past itself.
5. Drop the `'()*` replacement. Expected: FAIL at `Tom's (final) *copy*.docx`.

- [ ] **Step 7: The whole unit suite and the check**

Run: `npm run test:unit && npm run check`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/media/document.ts src/server/media/disposition.ts tests/helpers/zip.ts tests/unit/media-documents.test.ts
```

Message:

```
feat(media): a document is judged by its bytes as they stream past

One read hashes a document, keeps its first kilobyte, and checks text as UTF-8 without a zero
byte as the pieces arrive, so a 25 MB file costs what a kilobyte does. A PDF has to start as
one. A ZIP is read again only at its end, for the record that says where its directory is,
and an Office file is its type only if that directory holds its content types and its main
part and no macro project.

Content-Disposition is written here too: attachment, or inline for a PDF, with the file's own
name in UTF-8 and a plain one beside it for the clients that read nothing else.
```

---

### Task 4: Documents upload beside images, each handed out as it should be

**Files:**
- Modify: `src/server/media/service.ts`, `src/pages/api/admin/media/index.ts`, `src/server/content/published.ts`, `src/server/http/serialize.ts`, `scripts/test-foundation.mjs`
- Create: `tests/integration/media-documents.test.ts`, `tests/integration/media-documents-storage.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces; `readDocument`, `documentRefusal`, `isTextDocument`, `DocumentRefusal` and `contentDisposition` (Task 3); the tables of Task 2.
- Produces, from `src/server/media/service.ts`:
  - `reserveUploadSchema.mimeType` accepts `ACCEPTED_MEDIA_TYPES`; `sizeBytes` up to `MAX_DOCUMENT_FILE_BYTES`.
  - `UploadReservationResponse.headers` gains `'content-disposition'?: string`, set for a document.
  - `ReadyMedia.mime_type: SupportedMediaType`, `width: number | null`, `height: number | null`; `interface ReadyImage extends ReadyMedia { mime_type: SupportedImageType; width: number; height: number }`.
  - `mediaListInputSchema` gains `type?: MediaTypeFilter`.
  - `assertReadyMediaReferences(database, ownerId, ids, kind: MediaKind = 'image')`.
  - `listReadyImagesByIds(ownerId, ids): Promise<ReadyImage[]>`.
  - A refused document's `HttpError` carries `details.code`: `media_macros`, `media_text_encoding` or `media_type_mismatch`.
- Produces: `GET /api/admin/media?type=<MediaTypeFilter>`.

- [ ] **Step 1: Write the failing tests**

`tests/integration/media-documents.test.ts`, against a store the test holds in memory, as `media-service.test.ts` does:

```ts
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

import type { SupportedMediaType } from '../../src/lib/media';
import { office } from '../helpers/zip';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

test('a document is reserved with how it is handed out, judged by its bytes, and kept apart from images', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPost } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  const { contentDisposition } = await import('../../src/server/media/disposition');
  const { finalizeUpload, listMedia, mediaListInputSchema, reserveUpload, reserveUploadSchema } = await import('../../src/server/media/service');
  const { s3 } = await import('../../src/server/media/storage');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Files Owner', email: 'files@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  const objects = new Map<string, { body: Buffer; disposition?: string; mimeType: string }>();
  const deleted = new Set<string>();
  const transport = s3 as unknown as { send(command: object): Promise<object> };
  const originalSend = transport.send;
  transport.send = async (command) => {
    const input = (command as { input?: { Key?: string; Range?: string } }).input ?? {};
    const key = input.Key ?? '';
    if (command instanceof DeleteObjectCommand) {
      objects.delete(key);
      deleted.add(key);
      return {};
    }
    const object = objects.get(key);
    if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    if (command instanceof HeadObjectCommand) {
      return { ChecksumSHA256: sha(object.body), ContentDisposition: object.disposition, ContentLength: object.body.length, ContentType: object.mimeType };
    }
    if (command instanceof GetObjectCommand) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(input.Range ?? '');
      const body = range ? object.body.subarray(Number(range[1]), Number(range[2]) + 1) : object.body;
      return { Body: Readable.from([body.subarray(0, 5), body.subarray(5)]) };
    }
    throw new Error('Unexpected storage command.');
  };
  context.after(() => { transport.send = originalSend; });

  /** Reserves a file and stores what the browser would put -- or `stored` in its place. */
  const put = async (originalName: string, mimeType: string, body: Buffer, stored: { disposition?: string } = {}) => {
    const reservation = await reserveUpload(ownerId, {
      originalName, mimeType: mimeType as SupportedMediaType, sizeBytes: body.length, checksumSha256: sha(body),
      folderId: null, altText: 'Only an image keeps this',
    });
    const { object_key: key } = await db.selectFrom('media_upload_reservations').select('object_key')
      .where('id', '=', reservation.id).executeTakeFirstOrThrow();
    objects.set(key, { body, disposition: stored.disposition ?? reservation.headers['content-disposition'], mimeType });
    return { key, reservation };
  };
  const refusedAs = (code: string) => (error: unknown) => error instanceof HttpError && error.status === 400 && error.details?.code === code;
  const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

  // A PDF is reserved with how it is handed out, signed into the upload.
  const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
  const guide = await put('คู่มือ.pdf', 'application/pdf', pdf);
  assert.equal(guide.reservation.headers['content-disposition'], contentDisposition('คู่มือ.pdf', 'application/pdf'));
  assert.match(new URL(guide.reservation.uploadUrl).searchParams.get('X-Amz-SignedHeaders') ?? '', /content-disposition/);
  const guideItem = await finalizeUpload(ownerId, guide.reservation.id);
  assert.deepEqual(
    { alt: guideItem.alt_text, height: guideItem.height, type: guideItem.mime_type, width: guideItem.width },
    { alt: null, height: null, type: 'application/pdf', width: null },
  );

  // An Office file is judged by its directory; a macro project is refused, and nothing is kept of it.
  const plan = await put('plan.docx', DOCX, office('word/document.xml'));
  assert.equal((await finalizeUpload(ownerId, plan.reservation.id)).mime_type, DOCX);
  const macro = await put('macro.docx', DOCX, office('word/document.xml', [{ data: 'x', name: 'word/vbaProject.bin' }]));
  await assert.rejects(finalizeUpload(ownerId, macro.reservation.id), refusedAs('media_macros'));
  assert.ok(deleted.has(macro.key), 'its object is deleted');
  assert.equal((await db.selectFrom('media_upload_reservations').select('state')
    .where('id', '=', macro.reservation.id).executeTakeFirstOrThrow()).state, 'expired');

  const thaiCsv = await put('รายชื่อ.csv', 'text/csv', Buffer.from([0xaa, 0xd7, 0xe8, 0xcd, 0x2c, 0x31, 0x0a]));
  await assert.rejects(finalizeUpload(ownerId, thaiCsv.reservation.id), refusedAs('media_text_encoding'));
  const disguised = await put('report.docx', DOCX, pdf);
  await assert.rejects(finalizeUpload(ownerId, disguised.reservation.id), refusedAs('media_type_mismatch'));
  // The store kept a header other than the one signed: what arrived is not what was reserved.
  const swapped = await put('notes.txt', 'text/plain', Buffer.from('notes'), { disposition: 'inline' });
  await assert.rejects(finalizeUpload(ownerId, swapped.reservation.id),
    (error: unknown) => badRequest(error) && /does not match its reservation/.test((error as Error).message));

  // A document is named for what it is, and may be 25 MB where an image may be 8.
  const reserve = (originalName: string, mimeType: string, sizeBytes: number) => reserveUpload(ownerId, {
    originalName, mimeType: mimeType as SupportedMediaType, sizeBytes, checksumSha256: sha(pdf), folderId: null, altText: '',
  });
  await assert.rejects(reserve('guide.docx', 'application/pdf', 100), badRequest, 'a PDF named .docx');
  await assert.rejects(reserve('photo.png', 'image/png', 8_388_609), badRequest, 'an image over 8 MB');
  await reserve('big.zip', 'application/zip', 26_214_400);
  assert.equal(reserveUploadSchema.safeParse({
    originalName: 'big.zip', mimeType: 'application/zip', sizeBytes: 26_214_401, checksumSha256: sha(pdf), folderId: null, altText: '',
  }).success, false);

  // The list filters by type, and an image is still an image.
  const png = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#2a9d8f' } }).png().toBuffer();
  const image = await finalizeUpload(ownerId, (await put('photo.png', 'image/png', png)).reservation.id);
  assert.deepEqual({ height: image.height, width: image.width }, { height: 1, width: 2 });
  const listed = async (type?: string) => (await listMedia(ownerId, mediaListInputSchema.parse({ page: 1, search: '', type })))
    .items.map((entry) => entry.original_name).sort();
  assert.deepEqual(await listed('pdf'), ['คู่มือ.pdf']);
  assert.deepEqual(await listed('document'), ['plan.docx']);
  assert.deepEqual(await listed('file'), ['plan.docx', 'คู่มือ.pdf']);
  assert.deepEqual(await listed('image'), ['photo.png']);
  assert.equal((await listed()).length, 3);
  assert.equal(mediaListInputSchema.safeParse({ type: 'exe' }).success, false);

  // A cover and an article's pictures are images: a document is refused as either.
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Files', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  const post = (coverMediaId: string | null, src?: string) => createPost(ownerId, {
    excerpt: '', categoryIds: [category.id], coverMediaId, metaDescription: null, metaTitle: null,
    slug: `post-${randomUUID()}`, status: 'draft', title: 'Covered',
    contentJson: { type: 'doc', content: src ? [{ type: 'image', attrs: { src } }] : [{ type: 'paragraph' }] },
  });
  await assert.rejects(post(guideItem.id), badRequest, 'a PDF as a cover');
  await assert.rejects(post(null, guideItem.publicUrl), badRequest, 'a PDF as a picture');
  assert.equal((await post(image.id, image.publicUrl)).cover_media_id, image.id, 'an image is still both');
});
```

`tests/integration/media-documents-storage.test.ts`, against the disposable SeaweedFS:

```ts
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { office } from '../helpers/zip';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

test('the store keeps how a document is handed out, and refuses an upload that changes it', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { contentDisposition } = await import('../../src/server/media/disposition');
  const { deleteMedia, finalizeUpload, reserveUpload } = await import('../../src/server/media/service');
  const { resolveMediaUrl } = await import('../../src/server/media/url');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'stored-files@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  const upload = async (originalName: string, mimeType: 'application/pdf' | typeof DOCX, body: Buffer) => {
    const reservation = await reserveUpload(ownerId, {
      originalName, mimeType, sizeBytes: body.length, checksumSha256: sha(body), folderId: null, altText: '',
    });
    const headers = reservation.headers as Record<string, string>;
    // The browser asks first, from the site's origin, and may send the header.
    const preflight = await fetch(reservation.uploadUrl, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4321', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': Object.keys(headers).join(',') },
    });
    assert.equal(preflight.status, 200);
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-disposition/i);
    // A changed header, or none, breaks the signature, and the store refuses the upload.
    const changed = { ...headers, 'content-disposition': 'attachment; filename="page.html"' };
    const missing = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'content-disposition'));
    for (const sent of [changed, missing]) {
      assert.equal((await fetch(reservation.uploadUrl, { method: 'PUT', headers: sent, body })).status, 403);
    }
    assert.equal((await fetch(reservation.uploadUrl, { method: 'PUT', headers, body })).status, 200);
    const item = await finalizeUpload(ownerId, reservation.id);
    const { object_key: key } = await db.selectFrom('media_items').select('object_key').where('id', '=', item.id).executeTakeFirstOrThrow();
    const download = await fetch(resolveMediaUrl(key));
    assert.equal(download.status, 200);
    return { download, item };
  };

  const guide = await upload('คู่มือการสมัคร.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n%%EOF\n'));
  assert.equal(guide.download.headers.get('content-disposition'), contentDisposition('คู่มือการสมัคร.pdf', 'application/pdf'));
  assert.equal(guide.download.headers.get('content-type'), 'application/pdf');
  const plan = await upload('แผนงาน.docx', DOCX, office('word/document.xml'));
  assert.equal(plan.download.headers.get('content-disposition'), contentDisposition('แผนงาน.docx', DOCX));

  await deleteMedia(ownerId, guide.item.id);
  await deleteMedia(ownerId, plan.item.id);
});
```

In `scripts/test-foundation.mjs`, add `'tests/integration/media-documents-storage.test.ts'` to `STORAGE_TESTS`.

- [ ] **Step 2: Run them to see them fail**

Run: `node scripts/test-foundation.mjs tests/integration/media-documents.test.ts tests/integration/media-documents-storage.test.ts`
Expected: both FAIL. In the first, the first `put` is refused by Postgres (`media_upload_reservations_alt_text_kind_check`): nothing keeps a document's alternative text null yet. In the second, the preflight's allowed headers lack `content-disposition`, because the reservation does not name it.

- [ ] **Step 3: Implement** -- in `src/server/media/service.ts`:

Replace the import from `'../../lib/media'` with:

```ts
import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_MEDIA_TYPES,
  documentExtension,
  documentLabel,
  documentTypeForName,
  isDocumentType,
  isImageType,
  MAX_DOCUMENT_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MEDIA_TYPE_FILTERS,
  typesForFilter,
  type MediaKind,
  type SupportedDocumentType,
  type SupportedImageType,
  type SupportedMediaType,
} from '../../lib/media';
```

and add, beside the other local imports:

```ts
import { contentDisposition } from './disposition';
import { documentRefusal, isTextDocument, readDocument, type DocumentRefusal } from './document';
```

Replace `reserveUploadSchema` and `mediaListInputSchema` with:

```ts
export const reserveUploadSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ACCEPTED_MEDIA_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_FILE_BYTES),
  checksumSha256,
  folderId: z.uuid().nullable(),
  altText: z.string().trim().max(300),
}).strict();
```

```ts
export const mediaListInputSchema = z.object({
  folderId: z.uuid().nullable().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  search: z.string().trim().max(100).default(''),
  type: z.enum(MEDIA_TYPE_FILTERS).optional(),
}).strict();
```

Replace `UploadReservationResponse` and `ReadyMedia` with:

```ts
export interface UploadReservationResponse {
  id: string;
  uploadUrl: string;
  expiresAt: string;
  headers: {
    /** A document's only: how the store will hand it out, signed into the upload. */
    'content-disposition'?: string;
    'content-type': SupportedMediaType;
    'x-amz-checksum-sha256': string;
  };
}

export interface ReadyMedia {
  id: string;
  folder_id: string | null;
  original_name: string;
  mime_type: SupportedMediaType;
  size_bytes: number;
  /** Null for a document: only an image has dimensions. */
  width: number | null;
  height: number | null;
  alt_text: string | null;
  created_at: string;
  updated_at: string;
  publicUrl: string;
}

/** An image in the library: what a cover, the author's photo and an article's pictures are. */
export interface ReadyImage extends ReadyMedia {
  mime_type: SupportedImageType;
  width: number;
  height: number;
}
```

Replace `InvalidUploadError` with:

```ts
class InvalidUploadError extends Error {
  constructor(message: string, readonly objectKey: string, readonly status: 400 | 409 = 400, readonly code?: DocumentRefusal) {
    super(message);
  }
}

/** What a person is told when a document is not what it claims. The admin says it in the owner's language. */
const REFUSALS: Record<DocumentRefusal, string> = {
  media_macros: 'The file carries macros, which the library does not keep. Save it without them and upload it again.',
  media_text_encoding: 'Save the file as UTF-8 (in Excel, "CSV UTF-8") and upload it again.',
  media_type_mismatch: 'The file is not what its name says it is.',
};
```

In `readyMedia`, hold the size to the row's kind and pass the dimensions through as they are:

```ts
function readyMedia(row: Selectable<MediaItemTable>): ReadyMedia {
  const size = Number(row.size_bytes);
  const limit = isImageType(row.mime_type) ? MAX_IMAGE_BYTES : MAX_DOCUMENT_FILE_BYTES;
  if (!Number.isSafeInteger(size) || size < 1 || size > limit) throw new Error('Stored media size is invalid.');
  return {
    id: row.id,
    folder_id: row.folder_id,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: size,
    width: row.width,
    height: row.height,
    alt_text: row.alt_text,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    publicUrl: stableMediaPath(row.id),
  };
}

function isReadyImage(media: ReadyMedia): media is ReadyImage {
  return isImageType(media.mime_type) && media.width !== null && media.height !== null;
}
```

Add, above `reserveUpload`:

```ts
/**
 * A document's Content-Disposition, or null for an image. A document's name has to end in its
 * type's extension, so the name a reader downloads is the name of what the bytes were checked
 * to be; and it may be 25 MB, where an image may be 8.
 */
function uploadDisposition(input: ReserveUploadInput): string | null {
  if (isImageType(input.mimeType)) {
    if (input.sizeBytes > MAX_IMAGE_BYTES) throw new HttpError(400, 'Images must be 8 MB or smaller.');
    return null;
  }
  if (documentTypeForName(input.originalName) !== input.mimeType) {
    throw new HttpError(400, `A ${documentLabel(input.mimeType)} file's name ends in .${documentExtension(input.mimeType)}.`);
  }
  return contentDisposition(input.originalName, input.mimeType);
}
```

In `reserveUpload`: compute `const disposition = uploadDisposition(input);` as its first line; insert `alt_text: disposition ? null : input.altText || null`; build the command and its signature as:

```ts
  const command = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: objectKey,
    ContentType: input.mimeType,
    ChecksumSHA256: input.checksumSha256,
    ...(disposition ? { ContentDisposition: disposition } : {}),
  });
  try {
    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 300,
      // Signed, so the store refuses an upload that would change how the file is handed out.
      signableHeaders: new Set(disposition ? ['content-type', 'content-disposition'] : ['content-type']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return {
      id: reservation.id,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      headers: {
        ...(disposition ? { 'content-disposition': disposition } : {}),
        'content-type': input.mimeType,
        'x-amz-checksum-sha256': input.checksumSha256,
      },
    };
  } catch {
```

(the `catch` block stays as it is).

In `finalizeUpload`, extend the HEAD comparison and replace everything from `let body: Buffer;` through the end of the `inspectImage` block with the two readers below, so the transaction reads:

```ts
      const expectedSize = Number(reservation.expected_size_bytes);
      const expectedDisposition = isDocumentType(reservation.mime_type)
        ? contentDisposition(reservation.original_name, reservation.mime_type)
        : undefined;
      if (head.ContentLength !== expectedSize || head.ContentType !== reservation.mime_type
        || (head.ChecksumSHA256 && head.ChecksumSHA256 !== reservation.expected_checksum_sha256)
        || head.ContentDisposition !== expectedDisposition) {
        throw new InvalidUploadError('The uploaded object does not match its reservation.', reservation.object_key);
      }

      const dimensions = isImageType(reservation.mime_type)
        ? await verifiedImage(reservation.object_key, reservation.mime_type, expectedSize, reservation.expected_checksum_sha256)
        : await verifiedDocument(reservation.object_key, reservation.mime_type, expectedSize, reservation.expected_checksum_sha256);
      const item = await trx.insertInto('media_items').values({
        id: reservation.id,
        owner_id: ownerId,
        folder_id: reservation.folder_id,
        object_key: reservation.object_key,
        original_name: reservation.original_name,
        mime_type: reservation.mime_type,
        size_bytes: expectedSize,
        checksum_sha256: reservation.expected_checksum_sha256,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        alt_text: reservation.alt_text,
        state: 'ready',
        delete_error_code: null,
      }).returningAll().executeTakeFirstOrThrow();
```

and in its `catch`, pass the code on:

```ts
    if (error instanceof InvalidUploadError) {
      await expireInvalidReservation(ownerId, reservationId, error.objectKey);
      throw new HttpError(error.status, error.message, error.code ? { code: error.code } : undefined);
    }
```

Add the readers below `finalizeUpload`:

```ts
/** An image, read whole: sharp needs all of it, and it is 8 MB at most. */
async function verifiedImage(objectKey: string, type: SupportedImageType, size: number, checksum: string): Promise<{ height: number; width: number }> {
  let body: Buffer;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: objectKey, ChecksumMode: 'ENABLED' }));
    body = await readObjectBody(object.Body, size, objectKey);
  } catch (error) {
    if (error instanceof InvalidUploadError) throw error;
    throw new HttpError(503, 'Storage verification is temporarily unavailable. Try finalizing again.');
  }
  if (body.length !== size || createHash('sha256').update(body).digest('base64') !== checksum) {
    throw new InvalidUploadError('The uploaded object checksum or size is invalid.', objectKey);
  }
  try {
    return await inspectImage(body, type);
  } catch {
    throw new InvalidUploadError('The uploaded object is not a valid supported image.', objectKey);
  }
}

/** A document, read once as it streams and again only at a ZIP's end: never held whole. */
async function verifiedDocument(objectKey: string, type: SupportedDocumentType, size: number, checksum: string): Promise<null> {
  let refusal: DocumentRefusal | null;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: objectKey, ChecksumMode: 'ENABLED' }));
    if (!object.Body || !(Symbol.asyncIterator in object.Body)) throw new Error('Object body is unavailable.');
    const read = await readDocument(object.Body as AsyncIterable<Uint8Array>, size, isTextDocument(type));
    if (!read) throw new InvalidUploadError('The uploaded object is larger than declared.', objectKey);
    if (read.size !== size || read.checksum !== checksum) {
      throw new InvalidUploadError('The uploaded object checksum or size is invalid.', objectKey);
    }
    refusal = await documentRefusal(type, read, (start, end) => readRange(objectKey, start, end));
  } catch (error) {
    if (error instanceof InvalidUploadError) throw error;
    throw new HttpError(503, 'Storage verification is temporarily unavailable. Try finalizing again.');
  }
  if (refusal) throw new InvalidUploadError(REFUSALS[refusal], objectKey, 400, refusal);
  return null;
}

async function readRange(objectKey: string, start: number, end: number): Promise<Buffer> {
  const object = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: objectKey, Range: `bytes=${start}-${end}` }));
  return readObjectBody(object.Body, end - start + 1, objectKey);
}
```

Replace `assertReadyMediaReferences` with:

```ts
/**
 * Every id is a ready item of this site, of the kind asked for. Images by default: a cover, the
 * author's photo and an article's pictures are images, and a crafted request must not make a
 * PDF one of them.
 */
export async function assertReadyMediaReferences(
  database: Kysely<Database>,
  ownerId: string,
  ids: string[],
  kind: MediaKind = 'image',
): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await database.selectFrom('media_items').select('id')
    .where('owner_id', '=', ownerId).where('state', '=', 'ready').where('id', 'in', unique)
    .where('mime_type', 'in', kind === 'image' ? [...ACCEPTED_IMAGE_TYPES] : [...ACCEPTED_DOCUMENT_TYPES])
    .forShare().execute();
  if (rows.length !== unique.length) throw new HttpError(400, kind === 'image' ? 'Choose media from this site.' : 'Choose a file from this site.');
}
```

In `listMedia`, after the folder conditions, add:

```ts
  if (input.type) query = query.where('mime_type', 'in', [...typesForFilter(input.type)]);
```

Below `listReadyMediaByIds`, add:

```ts
/** Images only: covers, the author's photo and an article's pictures, which carry dimensions. */
export async function listReadyImagesByIds(ownerId: string, requestedIds: readonly string[]): Promise<ReadyImage[]> {
  return (await listReadyMediaByIds(ownerId, requestedIds)).filter(isReadyImage);
}
```

In `deleteMedia`, say "file" where it said "image": `This file is still used in ${count} location${count === 1 ? '' : 's'}.` and `Storage is temporarily unavailable. Try deleting the file again.`

The three lines Task 2 held to images -- the casts in `readyMedia` and at `inspectImage` -- are gone now.

In `src/pages/api/admin/media/index.ts`, pass the type on:

```ts
    const input = mediaListInputSchema.parse({
      folderId: requestedFolder === 'unfiled' ? null : requestedFolder || undefined,
      page: url.searchParams.get('page') || undefined,
      search: url.searchParams.get('search') ?? '',
      type: url.searchParams.get('type') || undefined,
    });
```

In `src/server/content/published.ts`, import `listReadyImagesByIds, type ReadyImage` in place of `listReadyMediaByIds, type ReadyMedia`, call `listReadyImagesByIds` at its three calls, and type `coverImage`, `media` and `avatar` with `ReadyImage`. In `src/server/http/serialize.ts`, `serializePublicMedia` takes a `ReadyImage` (import the type from `../media/service` in place of `ReadyMedia`). The public `media` list stays images, and `publicMediaSchema` does not change.

- [ ] **Step 4: Run them to see them pass**

Run: `node scripts/test-foundation.mjs tests/integration/media-documents.test.ts tests/integration/media-documents-storage.test.ts tests/integration/media-service.test.ts tests/integration/published-api-queries.test.ts`
Expected: PASS. The last two are the image upload and the public API, run to show images and the `media` list are unchanged.

- [ ] **Step 5: Put each guard's bug back**

1. Sign only `content-type`. Expected: the storage test FAILS -- the changed header is accepted with 200.
2. Drop the name check in `uploadDisposition`. Expected: FAIL at "a PDF named .docx".
3. Drop the `mime_type in` condition from `assertReadyMediaReferences`. Expected: FAIL at "a PDF as a cover".
4. Leave `ContentDisposition` out of the HEAD comparison. Expected: FAIL at `notes.txt` stored `inline`.
5. Throw `REFUSALS[refusal]` without the code. Expected: FAIL at `refusedAs('media_macros')`.

- [ ] **Step 6: The whole unit suite and the check**

Run: `npm run test:unit && npm run check`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/media/service.ts src/pages/api/admin/media/index.ts src/server/content/published.ts src/server/http/serialize.ts \
  scripts/test-foundation.mjs tests/integration/media-documents.test.ts tests/integration/media-documents-storage.test.ts
```

Message:

```
feat(media): documents upload beside images, each handed out as it should be

A document is reserved with its Content-Disposition, attachment or inline for a PDF, signed
into the upload's URL so the store refuses a PUT that changes it or leaves it out; the
disposable SeaweedFS shows both refusals, the preflight that allows the header, and the header
coming back on an anonymous GET. Its name has to end in its type's extension, and it may be
25 MB where an image may be 8.

Finalizing reads a document once as it streams, and a ZIP again only at its end. The three
refusals a person causes carry a code, so the admin can say them in the owner's language.

The library lists by type. And the checks that a cover, the author's photo or an article's
picture is ready now also ask that it is an image, which the library holding PDFs made
necessary. The public API's media list reads images only, as its schema always said.
```

---

### Task 5: A file card, written from what the library says of its file

**Files:**
- Create: `src/lib/editor-attachment.ts`, `tests/integration/attachment-content.test.ts`
- Modify: `src/server/content/editor.ts`, `src/server/content/mutations.ts`, `src/server/content/posts.ts`, `src/server/content/pages.ts`, `src/server/media/service.ts`, `src/lib/editor-content.ts`, `tests/unit/editor-rendering.test.ts`

**Interfaces:**
- Consumes: `SupportedDocumentType`, `documentLabel`, `formatBytes`, `isDocumentType`, `ACCEPTED_DOCUMENT_TYPES` (Task 1); `assertReadyMediaReferences(..., kind)` (Task 4).
- Produces, from `src/lib/editor-attachment.ts`: `interface AttachmentFile { mimeType: SupportedDocumentType; name: string; size: number }`; `PICK_FILE_EVENT = 'tome:pick-file'`; `attachmentMeta(file: Pick<AttachmentFile, 'mimeType' | 'size'>): string`; the Tiptap node `attachment` (name `'attachment'`, block, atom, draggable; attributes `href`, `mediaId`, `mimeType`, `name`, `size`).
- Produces, from `src/server/content/editor.ts`: `editorFileIds(document: EditorDocument): string[]`; `parseEditorContent(input: unknown): EditorDocument`; `renderEditorContent(contentJson: EditorDocument, files?: ReadonlyMap<string, AttachmentFile>): StoredEditorContent`; `prepareEditorContent(input: unknown, files?: ReadonlyMap<string, AttachmentFile>): StoredEditorContent`.
- Produces, from `src/server/content/mutations.ts`: `prepareContent(database: Kysely<Database>, ownerId: string, input: { contentJson: unknown; status: PostStatus }): Promise<StoredEditorContent>`; `assertContentMedia(database: Kysely<Database>, ownerId: string, contentJson: EditorDocument, imageIds?: string[]): Promise<void>`.
- Produces, from `src/server/media/service.ts`: `listReadyDocumentFiles(database: Kysely<Database>, ownerId: string, ids: readonly string[]): Promise<Map<string, AttachmentFile>>`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/editor-rendering.test.ts`, importing `editorFileIds` from `'../../src/server/content/editor'` beside what is imported there already:

```ts
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

test('a file card says what the library says of its file, and nothing the editor sent', () => {
  const mediaId = '22222222-2222-4222-8222-222222222222';
  const files = new Map([[mediaId, { mimeType: 'application/pdf' as const, name: 'คู่มือการสมัคร.pdf', size: 1_258_291 }]]);
  const card = (attrs: Record<string, string | number>): EditorDocument => ({ type: 'doc', content: [{ type: 'attachment', attrs }] });
  const { contentHtml, contentJson } = prepareEditorContent({
    contentJson: card({ href: 'https://elsewhere.example/x', mediaId: mediaId.toUpperCase(), mimeType: 'application/zip', name: 'lie.zip', size: 1 }),
  }, files);
  assert.deepEqual(contentJson.content?.[0]?.attrs,
    { href: `/media/${mediaId}`, mediaId, mimeType: 'application/pdf', name: 'คู่มือการสมัคร.pdf', size: 1_258_291 });
  assert.match(contentHtml,
    /^<p class="file-card"><a [^>]*><span class="file-card__name">คู่มือการสมัคร\.pdf<\/span> <span class="file-card__meta">PDF · 1\.2 MB<\/span><\/a><\/p>$/);
  assert.match(contentHtml, new RegExp(`<a [^>]*href="/media/${mediaId}"`));
  assert.match(contentHtml, /<a [^>]*type="application\/pdf"/);
  assert.match(contentHtml, /<a [^>]*target="_blank"/, 'a PDF opens in a tab of its own');
  assert.doesNotMatch(contentHtml, /data-|elsewhere|lie\.zip/, "what the editor sent, and the clipboard's attributes, are not kept");
  assert.equal(editorText(contentJson), '', "a card's name is not among the article's words");
  assert.equal(hasMeaningfulContent(contentJson), true, 'a card alone is content');

  const docxId = '33333333-3333-4333-8333-333333333333';
  const docx = prepareEditorContent({ contentJson: card({ mediaId: docxId }) },
    new Map([[docxId, { mimeType: DOCX, name: '<b>Plan</b>.docx', size: 84 * 1024 }]]));
  assert.doesNotMatch(docx.contentHtml, /target=/, 'anything but a PDF downloads where it is');
  assert.match(docx.contentHtml, /&lt;b&gt;Plan&lt;\/b&gt;\.docx/, 'a name is text, never markup');
  assert.match(docx.contentHtml, /DOCX · 84 KB/);
  assert.throws(() => prepareEditorContent({ contentJson: card({ mediaId }) }), ValidationError, 'a card for a file the library does not have');
  assert.deepEqual(editorFileIds(card({ mediaId: mediaId.toUpperCase() })), [mediaId]);
  assert.deepEqual(editorFileIds(card({ mediaId: 'not-a-uuid' })), [], 'nothing a lookup would choke on');
});

test('a card keeps its parts through the sanitizer, and nothing that rides in with them', () => {
  const html = sanitizedContentHtmlSchema.parse(
    '<p class="file-card intruder" data-media-id="x" onclick="x"><a href="/media/11111111-1111-4111-8111-111111111111" type="application/pdf" data-size="1">'
    + '<span class="file-card__name wide" style="color:red">A</span> <span class="file-card__meta">PDF · 1 B</span></a></p><span class="other">B</span>',
  );
  assert.equal(html, '<p class="file-card"><a href="/media/11111111-1111-4111-8111-111111111111" type="application/pdf" rel="noopener noreferrer">'
    + '<span class="file-card__name">A</span> <span class="file-card__meta">PDF · 1 B</span></a></p><span>B</span>');
});
```

`tests/integration/attachment-content.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('a card is written from the library, keeps its file from deletion, and is written again on publish', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPage } = await import('../../src/server/content/pages');
  const { createPost, updatePostStatus } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'cards@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: ownerId, site_name: 'Cards', default_locale: 'en', timezone: 'UTC', admin_path: '/admin',
  }).execute();
  const category = await db.insertInto('categories').values({ owner_id: ownerId, name: 'Uncategorized', is_default: true })
    .returning('id').executeTakeFirstOrThrow();
  // What a finished upload leaves in the library: a PDF, and an image.
  const stored = {
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, state: 'ready' as const, delete_error_code: null,
  };
  const pdf = await db.insertInto('media_items').values({
    ...stored, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.pdf`, original_name: 'คู่มือการสมัคร.pdf',
    mime_type: 'application/pdf', size_bytes: 1_258_291, width: null, height: null,
  }).returning('id').executeTakeFirstOrThrow();
  const png = await db.insertInto('media_items').values({
    ...stored, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.png`, original_name: 'photo.png',
    mime_type: 'image/png', size_bytes: 100, width: 2, height: 1,
  }).returning('id').executeTakeFirstOrThrow();

  const card = (mediaId: string): EditorDocument => ({ type: 'doc', content: [{
    type: 'attachment', attrs: { href: 'https://elsewhere.example/', mediaId, mimeType: 'application/zip', name: 'lie.zip', size: 1 },
  }] });
  const input = (contentJson: EditorDocument) => ({
    excerpt: '', categoryIds: [category.id], coverMediaId: null, contentJson, metaDescription: null, metaTitle: null,
    slug: `post-${randomUUID()}`, status: 'draft' as const, title: 'With a file',
  });
  const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

  const post = await createPost(ownerId, input(card(pdf.id)));
  assert.deepEqual(post.content_json.content?.[0]?.attrs,
    { href: `/media/${pdf.id}`, mediaId: pdf.id, mimeType: 'application/pdf', name: 'คู่มือการสมัคร.pdf', size: 1_258_291 });
  assert.match(post.content_html, /<span class="file-card__meta">PDF · 1\.2 MB<\/span>/);
  assert.doesNotMatch(post.content_html, /elsewhere|lie\.zip/);

  // An image is not a file to attach, and neither is one the library does not have.
  await assert.rejects(createPost(ownerId, input(card(png.id))), badRequest);
  await assert.rejects(createPost(ownerId, input(card(randomUUID()))), badRequest);

  // Publishing writes the card again, through the transaction it runs in: the pool holds one connection.
  const published = await updatePostStatus(ownerId, { id: post.id, status: 'published', updatedAt: post.updated_at });
  assert.equal(published.status, 'published');
  assert.match(published.content_html, /class="file-card"/);

  // A page takes a card as well, and the file cannot be deleted while either uses it.
  await createPage(ownerId, {
    excerpt: '', contentJson: card(pdf.id), metaDescription: null, metaTitle: null,
    slug: `page-${randomUUID()}`, status: 'draft', title: 'A page with a file',
  });
  await assert.rejects(deleteMedia(ownerId, pdf.id), (error: unknown) => {
    const counts = (error as { details?: { references?: { counts?: Record<string, number> } } }).details?.references?.counts;
    return error instanceof HttpError && error.status === 409 && counts?.postContent === 1 && counts.pageContent === 1;
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/editor-rendering.test.ts` and `node scripts/test-foundation.mjs tests/integration/attachment-content.test.ts`
Expected: the unit test FAILS to import `editorFileIds`; the integration test FAILS at `createPost` with a 400 -- `attachment` is not in the server's schema, so the document is "unsupported editor structure".

- [ ] **Step 3: Implement** -- `src/lib/editor-attachment.ts`:

```ts
import { Node } from '@tiptap/core';

import { documentLabel, formatBytes, isDocumentType, type SupportedDocumentType } from './media';

/** What a card says of its file. The server takes it from the library, never from the editor. */
export interface AttachmentFile {
  mimeType: SupportedDocumentType;
  name: string;
  size: number;
}

/** Sent on the editor's DOM to open the file picker: '/' has none of its own, and the + menu has. */
export const PICK_FILE_EVENT = 'tome:pick-file';

/** The line under a card's name: its type and its size, in no language in particular. */
export function attachmentMeta(file: Pick<AttachmentFile, 'mimeType' | 'size'>): string {
  return `${documentLabel(file.mimeType)} · ${formatBytes(file.size)}`;
}

const MEDIA_PATH = /^\/media\/([0-9a-f-]{36})$/i;

/**
 * A file in an article: one block, one link. The editor and the server share this node, so the
 * card a writer sees and the HTML a reader gets cannot drift apart.
 */
export const attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: null, rendered: false },
      mediaId: { default: null, rendered: false },
      mimeType: { default: null, rendered: false },
      name: { default: '', rendered: false },
      size: { default: 0, rendered: false },
    };
  },

  // A card that is cut and pasted goes through the editor's clipboard as HTML, and this reads it
  // back. The server fills in the rest from the library when it is saved.
  parseHTML() {
    return [{
      tag: 'p.file-card',
      getAttrs: (element) => {
        const link = element.querySelector('a');
        const mediaId = MEDIA_PATH.exec(link?.getAttribute('href') ?? '')?.[1]?.toLowerCase();
        const mimeType = link?.getAttribute('type') ?? '';
        if (!mediaId || !isDocumentType(mimeType)) return false;
        return {
          href: `/media/${mediaId}`,
          mediaId,
          mimeType,
          name: element.querySelector('.file-card__name')?.textContent ?? '',
          size: Number(element.getAttribute('data-size')) || 0,
        };
      },
    }];
  },

  renderHTML({ node }) {
    const { href, mediaId, mimeType, name, size } = node.attrs as { href: string; mediaId: string; mimeType: SupportedDocumentType; name: string; size: number };
    // A PDF opens in the browser, so it gets a tab of its own; anything else downloads in place.
    const tab = mimeType === 'application/pdf' ? { target: '_blank', rel: 'noopener noreferrer' } : {};
    return ['p', { class: 'file-card', 'data-media-id': mediaId, 'data-size': String(size) },
      ['a', { href, type: mimeType, ...tab },
        ['span', { class: 'file-card__name' }, name],
        ' ',
        ['span', { class: 'file-card__meta' }, attachmentMeta({ mimeType, size })]]];
  },
});
```

In `src/server/media/service.ts`, import `type AttachmentFile` from `'../../lib/editor-attachment'` and add below `listReadyImagesByIds`:

```ts
/** The library's word on each document a card points at: its name, its type and its size. */
export async function listReadyDocumentFiles(
  database: Kysely<Database>,
  ownerId: string,
  requestedIds: readonly string[],
): Promise<Map<string, AttachmentFile>> {
  const ids = [...new Set(requestedIds)];
  if (!ids.length) return new Map();
  const rows = await database.selectFrom('media_items').select(['id', 'mime_type', 'original_name', 'size_bytes'])
    .where('owner_id', '=', ownerId).where('state', '=', 'ready').where('id', 'in', ids)
    .where('mime_type', 'in', [...ACCEPTED_DOCUMENT_TYPES]).execute();
  const files = new Map<string, AttachmentFile>();
  for (const row of rows) {
    if (isDocumentType(row.mime_type)) files.set(row.id, { mimeType: row.mime_type, name: row.original_name, size: Number(row.size_bytes) });
  }
  return files;
}
```

In `src/server/content/editor.ts`: import `{ attachment, type AttachmentFile }` from `'../../lib/editor-attachment'`; add `attachment` to `extensions` after `textAlign`; give `normalizeMediaNodes` a second parameter, `files: ReadonlyMap<string, AttachmentFile>`, and inside its loop, after the image branch:

```ts
    if (node.type === 'attachment') {
      const mediaId = typeof node.attrs?.mediaId === 'string' ? node.attrs.mediaId.toLowerCase() : '';
      const file = files.get(mediaId);
      if (!file) throw new ValidationError('Attachments require a file from this site.');
      // The library's word, not the editor's: the card is stored, and says what its file is.
      node.attrs = { href: `/media/${mediaId}`, mediaId, mimeType: file.mimeType, name: file.name, size: file.size };
    }
```

Add below `editorMediaIds`:

```ts
/** The documents a document's cards point at, as ids a lookup can take. */
export function editorFileIds(document: EditorDocument): string[] {
  const ids = new Set<string>();
  const pending: EditorNode[] = [document];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    const mediaId = node.attrs?.mediaId;
    if (node.type === 'attachment' && typeof mediaId === 'string' && isUuid(mediaId)) ids.add(mediaId.toLowerCase());
    pending.push(...(node.content ?? []));
  }
  return [...ids];
}
```

and replace `prepareEditorContent` with:

```ts
/** The bounds and the shape of a document sent by an editor, before anything is looked up. */
export function parseEditorContent(input: unknown): EditorDocument {
  const raw = rawEditorContentInputSchema.parse(input);
  assertJsonBounds(raw.contentJson);
  return editorContentInputSchema.parse(input).contentJson;
}

/** A parsed document made safe to store: its media named by id, its cards filled from `files`. */
export function renderEditorContent(contentJson: EditorDocument, files: ReadonlyMap<string, AttachmentFile> = new Map()): StoredEditorContent {
  normalizeMediaNodes(contentJson, files);
  return { contentJson, contentHtml: renderEditorHtml(contentJson) };
}

export function prepareEditorContent(input: unknown, files: ReadonlyMap<string, AttachmentFile> = new Map()): StoredEditorContent {
  return renderEditorContent(parseEditorContent(input), files);
}
```

In `src/server/content/mutations.ts`, replace the import from `'./editor'` with:

```ts
import type { Kysely } from 'kysely';

import type { Database } from '../db/types';
import { assertReadyMediaReferences, listReadyDocumentFiles } from '../media/service';
import {
  editorFileIds,
  editorMediaIds,
  parseEditorContent,
  renderEditorContent,
  ValidationError,
  type StoredEditorContent,
} from './editor';
```

(the `EditorDocument` type joins the existing import from `'../../types/cms'`), and replace `prepareContent` with:

```ts
/**
 * A document ready to store: checked, its cards filled from the library, and refused for
 * publishing if there is nothing in it. `database` is what the library is read through --
 * inside a transaction, the transaction, since the pool may hold no second connection.
 */
export async function prepareContent(
  database: Kysely<Database>,
  ownerId: string,
  input: { contentJson: unknown; status: PostStatus },
): Promise<StoredEditorContent> {
  let content: StoredEditorContent;
  try {
    const contentJson = parseEditorContent({ contentJson: input.contentJson });
    content = renderEditorContent(contentJson, await listReadyDocumentFiles(database, ownerId, editorFileIds(contentJson)));
  } catch (error) {
    if (error instanceof ValidationError || error instanceof z.ZodError) {
      throw new HttpError(400, 'The editor content is invalid.');
    }
    throw error;
  }
  if (input.status === 'published'
    && (!hasMeaningfulContent(content.contentJson) || !hasMeaningfulHtml(content.contentHtml))) {
    // The sentence is the API's, in the API's English. The code is for the admin, which
    // has this same refusal written in the owner's language.
    throw new HttpError(400, 'Add content before publishing.', { code: 'content_required' });
  }
  return content;
}

/** A document's pictures, and `imageIds` beside them, are ready images; its cards, ready documents. */
export async function assertContentMedia(
  database: Kysely<Database>,
  ownerId: string,
  contentJson: EditorDocument,
  imageIds: string[] = [],
): Promise<void> {
  await assertReadyMediaReferences(database, ownerId, [...editorMediaIds(contentJson), ...imageIds]);
  await assertReadyMediaReferences(database, ownerId, editorFileIds(contentJson), 'document');
}
```

In `src/server/content/posts.ts`:
- `createPost` and `updatePost`: `const content = await prepareContent(db, ownerId, input);`
- `createPost`'s check becomes `await assertContentMedia(trx, ownerId, content.contentJson, coverMediaId ? [coverMediaId] : []);`, and `updatePost`'s `await assertContentMedia(trx, ownerId, content.contentJson, input.coverMediaId ? [input.coverMediaId] : []);`
- `updatePostStatus`: `? await prepareContent(trx, ownerId, { contentJson: current.content_json, status: input.status })`
- import `assertContentMedia` from `'./mutations'` beside `prepareContent`, and drop the imports of `assertReadyMediaReferences` and `editorMediaIds`, which nothing else there uses.

In `src/server/content/pages.ts`, the same: `await prepareContent(db, ownerId, input)` in `createPage` and `updatePage`, `await assertContentMedia(trx, ownerId, content.contentJson);` for both checks, `await prepareContent(trx, ownerId, { ... })` in `updatePageStatus`, and the same imports.

In `src/lib/editor-content.ts`, let the sanitizer keep a card:

```ts
    'td',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel', 'type'],
```

```ts
  // A table's wrapper and a file card's parts are the only things that carry a class: the
  // wrapper is how a wide table scrolls inside its box on a phone, and the card is drawn by it.
  allowedClasses: { div: ['tableWrapper'], p: ['file-card'], span: ['file-card__name', 'file-card__meta'] },
```

and count a card as content: `if (node.type === 'image' || node.type === 'attachment') return true;` in `hasMeaningfulContent`.

- [ ] **Step 4: Run them to see them pass**

Run: `node --import tsx --test tests/unit/editor-rendering.test.ts` and `node scripts/test-foundation.mjs tests/integration/attachment-content.test.ts tests/integration/content-services.test.ts tests/integration/media-service.test.ts`
Expected: PASS. The last two save posts and pages with pictures and covers, run to show the new checks leave them as they were.

- [ ] **Step 5: Put each guard's bug back**

1. Keep the editor's `name` in `normalizeMediaNodes` (`name: node.attrs?.name ?? file.name`). Expected: FAIL at the `deepEqual` of the card's attributes.
2. Read the library through `db` in `updatePostStatus`. Expected: the integration test FAILS at the publish, the one connection held by the transaction.
3. Give every card `target="_blank"`. Expected: FAIL at "anything but a PDF downloads where it is".
4. Allow any class on `p`. Expected: FAIL at the sanitizer test, `intruder` kept.
5. Leave `attachment` out of `hasMeaningfulContent`. Expected: FAIL at "a card alone is content".

- [ ] **Step 6: The whole unit suite and the check**

Run: `npm run test:unit && npm run check`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/editor-attachment.ts src/server/content/editor.ts src/server/content/mutations.ts src/server/content/posts.ts \
  src/server/content/pages.ts src/server/media/service.ts src/lib/editor-content.ts \
  tests/unit/editor-rendering.test.ts tests/integration/attachment-content.test.ts
```

Message:

```
feat(admin): a file card, written from what the library says of its file

An attachment node is one block with one link, shared by the editor and the server so the
card a writer sees and the HTML a reader gets cannot drift. Whenever the server renders a
document -- a save, or a publish that renders what was saved -- it fills each card's name,
type and size from the library and points its link at /media/<id>; what the editor sent is
not used, since the card is stored and a stale or crafted request could otherwise make a
25 MB ZIP read as a 1 KB PDF. A publish reads through its own transaction.

A PDF's card opens in a new tab and anything else downloads in place. The sanitizer keeps the
card's classes and a link's type, and a card alone is content. A card points at a document
and a picture at an image, and a file a card uses cannot be deleted.
```

---

### Task 6: The library holds documents and filters them by type

**Files:**
- Create: `src/components/admin/MediaTypes.tsx`
- Modify: `src/types/cms.ts`, `src/lib/media.ts`, `src/lib/media-client.ts`, `src/components/admin/MediaLibrary.tsx`, `src/components/admin/MediaPicker.tsx`, `src/components/admin/PostSettingsDrawer.tsx`, `src/components/admin/ProfileForm.tsx`, `src/components/admin/BlockInsertMenu.tsx`, `src/lib/admin-i18n.ts`, `src/styles/global.css`, `compose.test.yaml`, `tests/e2e/editor-blocks.spec.ts`

**Interfaces:**
- Consumes: Task 1's `acceptAttribute`, `declaredMediaType`, `DOCUMENT_GROUPS`, `formatBytes`, `formatLabel`, `MediaFileError`, `MediaKind`, `MediaTypeFilter`; Task 4's `GET /api/admin/media?type=` and coded refusals.
- Produces:
  - `MediaAsset.mime_type: SupportedMediaType`, `width: number | null`, `height: number | null`; `isImageAsset(asset: MediaAsset)` in `src/lib/media.ts`.
  - `uploadFile(file: File, options?: { accept?: MediaKind | 'any'; altText?; folderId?; onProgress? }): Promise<MediaAsset>`; `listMedia({ ..., type?: MediaTypeFilter })`; `MediaRequestError.code?: string`.
  - `<MediaPicker kind={MediaKind} ... />`, `kind` required; `<MediaLibrary mode="select" kind={MediaKind} ... />`.
  - Copy: `media.allTypes`, `documents`, `fileDetails`, `fileLabel`, `fileTypes`, `fileUrl`, `images`, `refusals.*`, `selectFileLabel`, `slides`, `spreadsheets`, `uploadFile`, and `deleteFile*` in place of `deleteImage*`.

- [ ] **Step 1: Let the test store take the spec's origin** -- in `compose.test.yaml`, the SeaweedFS command's origin becomes:

```yaml
      - -s3.allowedOrigins=${TOME_CMS_TEST_ORIGIN:-http://localhost:4321}
```

In `tests/e2e/editor-blocks.spec.ts`'s `beforeAll`, right after `origin = ...`, add:

```ts
  // The browser puts a file straight into the store, which answers only the origin it is told.
  process.env.TOME_CMS_TEST_ORIGIN = origin;
```

- [ ] **Step 2: Write the failing test** -- add to `tests/e2e/editor-blocks.spec.ts`, with the sign-in the other tests there use made a helper at the bottom of the file:

```ts
/** Signs the owner in through a recovery enrollment, as a new device would. */
async function signIn(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const { getSiteSettings } = await import('../../src/server/content/site-settings');
  const { issueRecoveryEnrollment } = await import('../../src/server/auth/recovery');
  const settings = await getSiteSettings();
  const enrollment = await issueRecoveryEnrollment(settings!.owner_id);
  await page.goto(`${origin}/recovery?context=${encodeURIComponent(enrollment.context)}`);
  await page.getByRole('button', { name: /Create recovery Passkey/i }).click();
  await page.waitForURL(`${origin}/admin`, { timeout: 30_000 });
}

test('a file joins the library, is found by its type, and the filter holds through a reload', async ({ context, page }) => {
  test.setTimeout(120_000);
  await signIn(context, page);
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#2a9d8f' } }).png().toBuffer();

  await page.goto(`${origin}/admin/media`);
  const upload = page.locator('.media-upload input[type="file"]');
  await upload.setInputFiles({ name: 'Swatch.png', mimeType: 'image/png', buffer: png });
  const swatch = page.getByRole('button', { name: /^Swatch\.png,/ });
  await expect(swatch).toBeVisible();
  await upload.setInputFiles({ name: 'Guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF\n') });
  const guide = page.getByRole('button', { name: /^Guide\.pdf, PDF,/ });
  await expect(guide).toBeVisible();

  const types = page.getByRole('group', { name: 'File types' });
  await types.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page).toHaveURL(/[?&]type=pdf(&|$)/);
  await expect(guide).toBeVisible();
  await expect(swatch).toHaveCount(0);

  // The address is the view: a reload opens the same one.
  await page.reload();
  await expect(types.getByRole('button', { name: 'PDF', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(guide).toBeVisible();
  await expect(swatch).toHaveCount(0);

  await types.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(swatch).toBeVisible();
  await expect(guide).toHaveCount(0);

  // A document's details have no alternative text, and name it a file.
  await types.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page).not.toHaveURL(/type=/);
  await guide.click();
  const details = page.getByRole('dialog', { name: 'File details' });
  await expect(details.getByLabel('File URL')).toHaveValue(/^\/media\/[0-9a-f-]{36}$/);
  await expect(details.getByLabel('Alt text')).toHaveCount(0);
  await details.getByRole('button', { name: 'Close details' }).click();

  // A spreadsheet saved in the Thai code page is refused, and the owner is told how to save it --
  // in the admin's words ("this file"), not the API's ("the file").
  await upload.setInputFiles({ name: 'รายชื่อ.csv', mimeType: 'text/csv', buffer: Buffer.from([0xaa, 0xd7, 0xe8, 0xcd, 0x2c, 0x31, 0x0a]) });
  await expect(page.getByRole('alert')).toContainText('Save this file as UTF-8 (in Excel, "CSV UTF-8")');
});
```

Add `type BrowserContext, type Page` to the file's import from `'@playwright/test'`.

- [ ] **Step 3: Run it to see it fail**

Run: `npm run test:e2e -- tests/e2e/editor-blocks.spec.ts -g "a file joins the library"`
Expected: FAIL at `Guide.pdf` -- the input takes images only, so the PDF is refused before it is sent.

- [ ] **Step 4: Implement the types and the client**

In `src/types/cms.ts`, import `SupportedMediaType` beside `SupportedImageType` and make `MediaAsset`:

```ts
export interface MediaAsset {
  alt_text: string | null;
  created_at: string;
  folder_id: string | null;
  /** Null for a document: only an image has dimensions. */
  height: number | null;
  id: string;
  mime_type: SupportedMediaType;
  original_name: string;
  publicUrl: string;
  size_bytes: number;
  updated_at: string;
  width: number | null;
}
```

In `src/lib/media.ts`, add at the end:

```ts
/** A library item that is an image, with the dimensions every image has. */
export function isImageAsset(asset: MediaAsset): asset is MediaAsset & { height: number; mime_type: SupportedImageType; width: number } {
  return isImageType(asset.mime_type) && asset.width !== null && asset.height !== null;
}
```

with `import type { MediaAsset } from '../types/cms';` at the top.

In `src/lib/media-client.ts`:

```ts
import { declaredMediaType, isImageType, validateImageFile, type MediaKind, type MediaTypeFilter, type SupportedImageType, type SupportedMediaType } from './media';
```

```ts
export interface ListMediaInput {
  folderId?: string | null;
  page?: number;
  search?: string;
  type?: MediaTypeFilter;
}

export interface UploadFileOptions extends UploadImageOptions {
  /** What the picker it is chosen in takes: images, documents, or -- the library page -- any. */
  accept?: MediaKind | 'any';
}

interface UploadReservation {
  expiresAt: string;
  /** Every header the store signed; a document's include its Content-Disposition. */
  headers: Record<string, string>;
  id: string;
  uploadUrl: string;
}

export class MediaRequestError extends Error {
  constructor(message: string, readonly references?: MediaReferences, readonly code?: string) {
    super(message);
  }
}

function errorCode(payload: unknown): string | undefined {
  return typeof payload === 'object' && payload !== null && 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined;
}
```

`readJson` throws `new MediaRequestError(errorMessage(payload) ?? 'The request could not be completed.', errorReferences(payload), errorCode(payload))`. `listMedia` adds `if (input.type) params.set('type', input.type);`. Replace `uploadImage` with:

```ts
async function upload(file: File, mimeType: SupportedMediaType, options: UploadImageOptions): Promise<MediaAsset> {
  const checksumSha256 = await sha256(file);
  const reservation = (await sendJson<{ reservation: UploadReservation }>('/api/admin/media/uploads', 'POST', {
    originalName: file.name,
    mimeType,
    sizeBytes: file.size,
    checksumSha256,
    folderId: options.folderId ?? null,
    altText: isImageType(mimeType) ? options.altText ?? '' : '',
  })).reservation;
  await uploadToStorage(reservation, file, options.onProgress);
  options.onProgress?.(100);
  return (await sendJson<{ item: MediaAsset }>(`/api/admin/media/uploads/${reservation.id}/finalize`, 'POST', {})).item;
}

/** An image dropped or pasted into the editor. */
export async function uploadImage(file: File, options: UploadImageOptions = {}): Promise<MediaAsset> {
  validateImageFile(file);
  return upload(file, file.type as SupportedImageType, options);
}

/** Any file the library keeps, refused in the browser -- with a MediaFileError -- when it cannot be kept. */
export async function uploadFile(file: File, options: UploadFileOptions = {}): Promise<MediaAsset> {
  return upload(file, declaredMediaType(file, options.accept ?? 'any'), options);
}
```

`uploadToStorage` needs no change: it already sends every header a reservation names.

- [ ] **Step 5: Implement the copy** -- in `src/lib/admin-i18n.ts`, the English `media` block becomes the following (the Thai one after it); the keys and their order are the same in both:

```ts
  media: {
    allFiles: 'All files',
    allTypes: 'All',
    altText: 'Alt text',
    cancel: 'Cancel',
    cancelRename: 'Cancel rename',
    clipboardUnavailable: 'Clipboard unavailable.',
    closeDetails: 'Close details',
    copyUrl: 'Copy URL',
    createFolder: 'Create folder',
    delete: 'Delete',
    deleteFile: 'Delete file',
    deleteFileMessage: 'Delete {name}? This cannot be undone.',
    deleteFileTitle: 'Delete file?',
    deleteFolder: 'Delete folder',
    deleteFolderLabel: 'Delete {name}',
    deleteFolderMessage: 'Delete {name}? Files in this folder will move to Unsorted.',
    deleteFolderTitle: 'Delete folder?',
    deleting: 'Deleting…',
    documents: 'Documents',
    emptyBody: 'Upload an image or a file to start your library.',
    emptyTitle: 'No files yet',
    fileDetails: 'File details',
    fileLabel: '{name}, {format}, {size}',
    fileTypes: 'File types',
    fileUrl: 'File URL',
    folder: 'Folder',
    folderName: 'Folder name',
    folders: 'File folders',
    heading: 'File Manager',
    images: 'Images',
    itemLabel: '{name}, {width} × {height}, {format}, {size}',
    loadMore: 'Load more',
    loading: 'Loading…',
    loadingFiles: 'Loading files…',
    profileAvatar: 'This image is the profile avatar.',
    refusals: {
      documentTooLarge: 'Files must be 25 MB or smaller.',
      empty: 'This file is empty.',
      imageTooLarge: 'Images must be 8 MB or smaller.',
      macros: 'This file carries macros, which the library does not keep. Save it without them and upload it again.',
      textEncoding: 'Save this file as UTF-8 (in Excel, "CSV UTF-8") and upload it again.',
      typeMismatch: 'This file is not what its name says it is.',
      unsupported: 'Upload an image, a PDF, a Word, Excel or PowerPoint file, a CSV, a text file or a ZIP.',
      unsupportedDocument: 'Upload a PDF, a Word, Excel or PowerPoint file, a CSV, a text file or a ZIP.',
      unsupportedImage: 'Use a JPEG, PNG, WebP, GIF, or AVIF image.',
    },
    renameFolderLabel: 'Rename {name}',
    retry: 'Retry',
    retryFolders: 'Retry folders',
    save: 'Save',
    saveFolderName: 'Save folder name',
    saved: 'Saved.',
    searchFiles: 'Search files',
    select: 'Select',
    selectFileLabel: 'Select {name}, {format}, {size}',
    selectLabel: 'Select {name}, {width} × {height}, {format}, {size}',
    slides: 'Slides',
    spreadsheets: 'Spreadsheets',
    subheading: 'Upload and find images and files for your posts and pages.',
    unavailable: 'The File Manager is temporarily unavailable.',
    unsorted: 'Unsorted',
    uploadFile: 'Upload file',
    uploadImage: 'Upload image',
    uploading: 'Uploading…',
    uploadingProgress: 'Uploading…',
    urlCopied: 'URL copied.',
    urlSelected: 'URL selected. Copy it with your keyboard shortcut.',
  },
```

```ts
  media: {
    allFiles: 'ไฟล์ทั้งหมด',
    allTypes: 'ทั้งหมด',
    altText: 'ข้อความอธิบายภาพ',
    cancel: 'ยกเลิก',
    cancelRename: 'ยกเลิกการเปลี่ยนชื่อ',
    clipboardUnavailable: 'ใช้คลิปบอร์ดไม่ได้',
    closeDetails: 'ปิดรายละเอียด',
    copyUrl: 'คัดลอก URL',
    createFolder: 'สร้างโฟลเดอร์',
    delete: 'ลบ',
    deleteFile: 'ลบไฟล์',
    deleteFileMessage: 'ลบ {name} ใช่ไหม? การลบนี้ย้อนกลับไม่ได้',
    deleteFileTitle: 'ลบไฟล์?',
    deleteFolder: 'ลบโฟลเดอร์',
    deleteFolderLabel: 'ลบ {name}',
    deleteFolderMessage: 'ลบ {name} ใช่ไหม? ไฟล์ในโฟลเดอร์นี้จะถูกย้ายไปที่ "ยังไม่จัดหมวด"',
    deleteFolderTitle: 'ลบโฟลเดอร์?',
    deleting: 'กำลังลบ…',
    documents: 'เอกสาร',
    emptyBody: 'อัปโหลดภาพหรือไฟล์เพื่อเริ่มต้นคลังของคุณ',
    emptyTitle: 'ยังไม่มีไฟล์',
    fileDetails: 'รายละเอียดไฟล์',
    fileLabel: '{name}, {format}, {size}',
    fileTypes: 'ชนิดไฟล์',
    fileUrl: 'URL ของไฟล์',
    folder: 'โฟลเดอร์',
    folderName: 'ชื่อโฟลเดอร์',
    folders: 'โฟลเดอร์ไฟล์',
    heading: 'คลังไฟล์',
    images: 'รูป',
    itemLabel: '{name}, {width} × {height}, {format}, {size}',
    loadMore: 'โหลดเพิ่ม',
    loading: 'กำลังโหลด…',
    loadingFiles: 'กำลังโหลดไฟล์…',
    profileAvatar: 'ภาพนี้ถูกใช้เป็นรูปโปรไฟล์',
    refusals: {
      documentTooLarge: 'ไฟล์ต้องมีขนาดไม่เกิน 25 MB',
      empty: 'ไฟล์นี้ว่างเปล่า',
      imageTooLarge: 'ภาพต้องมีขนาดไม่เกิน 8 MB',
      macros: 'ไฟล์นี้มี macro ซึ่งคลังไม่เก็บ บันทึกเป็นไฟล์ที่ไม่มี macro แล้วอัปโหลดใหม่',
      textEncoding: 'บันทึกไฟล์เป็น UTF-8 (ใน Excel เลือก "CSV UTF-8") แล้วอัปโหลดใหม่',
      typeMismatch: 'เนื้อไฟล์ไม่ตรงกับชนิดที่ชื่อไฟล์บอก',
      unsupported: 'อัปโหลดได้เฉพาะภาพ, PDF, ไฟล์ Word, Excel หรือ PowerPoint, CSV, ไฟล์ข้อความ หรือ ZIP',
      unsupportedDocument: 'อัปโหลดได้เฉพาะ PDF, ไฟล์ Word, Excel หรือ PowerPoint, CSV, ไฟล์ข้อความ หรือ ZIP',
      unsupportedImage: 'ใช้ภาพ JPEG, PNG, WebP, GIF หรือ AVIF',
    },
    renameFolderLabel: 'เปลี่ยนชื่อ {name}',
    retry: 'ลองใหม่',
    retryFolders: 'โหลดโฟลเดอร์ใหม่',
    save: 'บันทึก',
    saveFolderName: 'บันทึกชื่อโฟลเดอร์',
    saved: 'บันทึกแล้ว',
    searchFiles: 'ค้นหาไฟล์',
    select: 'เลือก',
    selectFileLabel: 'เลือก {name}, {format}, {size}',
    selectLabel: 'เลือก {name}, {width} × {height}, {format}, {size}',
    slides: 'สไลด์',
    spreadsheets: 'ตารางคำนวณ',
    subheading: 'อัปโหลดและค้นหาภาพและไฟล์สำหรับบทความและเพจของคุณ',
    unavailable: 'คลังไฟล์ไม่พร้อมใช้งานชั่วคราว',
    unsorted: 'ยังไม่จัดหมวด',
    uploadFile: 'อัปโหลดไฟล์',
    uploadImage: 'อัปโหลดภาพ',
    uploading: 'กำลังอัปโหลด…',
    uploadingProgress: 'กำลังอัปโหลด…',
    urlCopied: 'คัดลอก URL แล้ว',
    urlSelected: 'เลือก URL ไว้แล้ว กดคัดลอกด้วยคีย์ลัดของคุณ',
  },
```

- [ ] **Step 6: Implement the filter** -- `src/components/admin/MediaTypes.tsx`:

```tsx
import type { AdminCopy } from '../../lib/admin-i18n';
import type { MediaTypeFilter } from '../../lib/media';
import UiSelect from './UiSelect';

interface MediaTypesProps {
  copy: AdminCopy;
  /** The choices, in order. Null is every kind; in a file picker, `file` stands for every document. */
  filters: ReadonlyArray<MediaTypeFilter | null>;
  onChange: (filter: MediaTypeFilter | null) => void;
  value: MediaTypeFilter | null;
}

/** "PDF" and "ZIP" are the same word in every language; the rest are the owner's. */
function filterLabel(filter: MediaTypeFilter | null, copy: AdminCopy): string {
  switch (filter) {
    case null:
    case 'file':
      return copy.media.allTypes;
    case 'image':
      return copy.media.images;
    case 'document':
      return copy.media.documents;
    case 'spreadsheet':
      return copy.media.spreadsheets;
    case 'slides':
      return copy.media.slides;
    case 'pdf':
      return 'PDF';
    case 'zip':
      return 'ZIP';
  }
}

const key = (filter: MediaTypeFilter | null) => filter ?? 'all';

/** The library's types beside its search: a row of choices on a wide screen, a select on a phone, as its folders are. */
export default function MediaTypes({ copy, filters, onChange, value }: MediaTypesProps) {
  return (
    <div className="media-types">
      <div aria-label={copy.media.fileTypes} className="media-types__choices" role="group">
        {filters.map((filter) => (
          <button aria-pressed={value === filter} className="media-category" key={key(filter)} onClick={() => onChange(filter)} type="button">
            {filterLabel(filter, copy)}
          </button>
        ))}
      </div>
      <div className="media-types__select">
        <UiSelect
          ariaLabel={copy.media.fileTypes}
          className="admin-control"
          id="media-types"
          onValueChange={(next) => onChange(filters.find((filter) => key(filter) === next) ?? null)}
          options={filters.map((filter) => ({ label: filterLabel(filter, copy), value: key(filter) }))}
          value={key(value)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implement the library** -- in `src/components/admin/MediaLibrary.tsx`:

Imports: `uploadFile` in place of `uploadImage` from `'../../lib/media-client'`; in place of `import { ACCEPTED_IMAGE_TYPES } from '../../lib/media';`:

```ts
import {
  acceptAttribute,
  DOCUMENT_GROUPS,
  formatBytes,
  formatLabel,
  isImageAsset,
  MediaFileError,
  type MediaKind,
  type MediaTypeFilter,
} from '../../lib/media';
```

and `import MediaTypes from './MediaTypes';`.

Replace everything from `type MediaLibraryProps` through `function folderId` with:

```ts
type MediaLibraryProps = { ownerLocale?: PostLocale | null } & (
  | { mode: 'manage' }
  | { kind: MediaKind; mode: 'select'; onCancel: () => void; onSelect: (asset: MediaAsset) => void }
);

type CategorySelection = 'all' | 'unsorted' | string;
type ReferencingPost = { id: string; title: string };
type ReferencingPage = { id: string; title: string };
type FailedRequest = { append: boolean; filter: MediaTypeFilter | null; page: number; selection: CategorySelection; term: string };

/** The server's refusal codes, by the copy that says them in the owner's language. */
const REFUSAL_COPY: Partial<Record<string, 'macros' | 'textEncoding' | 'typeMismatch'>> = {
  media_macros: 'macros',
  media_text_encoding: 'textEncoding',
  media_type_mismatch: 'typeMismatch',
};
/** The library page filters by every kind; a file picker by documents alone. */
const LIBRARY_FILTERS: ReadonlyArray<MediaTypeFilter | null> = [null, 'image', ...DOCUMENT_GROUPS];
const FILE_FILTERS: ReadonlyArray<MediaTypeFilter | null> = ['file', ...DOCUMENT_GROUPS];
const FOLDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(error: unknown, copy: AdminCopy) {
  if (error instanceof MediaFileError) return copy.media.refusals[error.refusal];
  const refusal = error instanceof MediaRequestError && error.code ? REFUSAL_COPY[error.code] : undefined;
  if (refusal) return copy.media.refusals[refusal];
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return copy.media.unavailable;
}

function folderId(selection: CategorySelection) {
  if (selection === 'all') return undefined;
  return selection === 'unsorted' ? null : selection;
}

/**
 * Where a library opens. The page takes its type and folder from its address, so a reload or a
 * shared link shows the same files; a picker starts from its kind and never reads the address.
 */
function initialView(props: MediaLibraryProps): { filter: MediaTypeFilter | null; selection: CategorySelection } {
  if (props.mode === 'select') return { filter: props.kind === 'image' ? 'image' : 'file', selection: 'all' };
  const query = new URLSearchParams(window.location.search);
  const type = query.get('type');
  const folder = query.get('folder') ?? '';
  return {
    filter: LIBRARY_FILTERS.find((filter) => filter !== null && filter === type) ?? null,
    selection: folder === 'unsorted' || FOLDER_ID.test(folder) ? folder : 'all',
  };
}
```

In the component:
- `const [view] = useState(() => initialView(props));` first, then `const [selection, setSelection] = useState<CategorySelection>(view.selection);` and, beside it, `const [filter, setFilter] = useState<MediaTypeFilter | null>(view.filter);`
- `failedRequest` is `useState<FailedRequest | null>(null)`.
- `const currentSelection = useRef<CategorySelection>(view.selection);` and `const currentFilter = useRef<MediaTypeFilter | null>(view.filter);`
- `load` takes a fifth parameter, `nextFilter: MediaTypeFilter | null`, lists with `listMedia({ folderId: folderId(nextSelection), page: nextPage, search: term, type: nextFilter ?? undefined })`, and records `{ append, filter: nextFilter, page: nextPage, selection: nextSelection, term }` when it fails. Every call to `load` passes the filter: `filter` in the listing effect and "Load more", `currentFilter.current` in `saveDetails` and `deleteSelected`, `failedRequest.filter` in Retry.
- The listing effect, and the address after it:

```ts
  useEffect(() => {
    void load(1, false, debouncedSearch, selection, filter);
  }, [debouncedSearch, filter, load, selection]);

  // The library page's address says which files it shows, and a change of view is not a step to
  // go back through. A picker's view is its own.
  useEffect(() => {
    if (props.mode !== 'manage') return;
    const url = new URL(window.location.href);
    if (filter) url.searchParams.set('type', filter);
    else url.searchParams.delete('type');
    if (selection === 'all') url.searchParams.delete('folder');
    else url.searchParams.set('folder', selection);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [filter, props.mode, selection]);
```

- Beside `selectCategory`:

```ts
  function selectType(nextFilter: MediaTypeFilter | null) {
    currentFilter.current = nextFilter;
    setPage(1);
    setFilter(nextFilter);
  }
```

- In `handleUpload`, keep `const uploadFilter = currentFilter.current;` beside the other two, upload with:

```ts
      const asset = await atLeast(uploadFile(file, {
        accept: props.mode === 'select' ? props.kind : 'any',
        folderId: folderId(uploadSelection) ?? null,
        onProgress: setUploadProgress,
      }));
```

  and reload only if the filter is unchanged too: `if (currentSelection.current === uploadSelection && currentQuery.current === uploadQuery && currentFilter.current === uploadFilter) await load(1, false, uploadQuery, uploadSelection, uploadFilter);`
- `deleteSelected`'s confirmation uses `copy.media.deleteFileTitle`, `copy.media.deleteFileMessage` and `copy.media.deleteFile`.
- Delete `formatSize`; sizes come from `formatBytes`.

The toolbar, between the search label and `media-toolbar__end`:

```tsx
        {!(props.mode === 'select' && props.kind === 'image') && (
          <MediaTypes copy={copy} filters={props.mode === 'select' ? FILE_FILTERS : LIBRARY_FILTERS} onChange={selectType} value={filter} />
        )}
```

and its upload control:

```tsx
          <label aria-busy={uploading} className="admin-button admin-button--primary media-upload">
            <span>{props.mode === 'select' && props.kind === 'image' ? copy.media.uploadImage : copy.media.uploadFile}</span>
            <input accept={acceptAttribute(props.mode === 'select' ? props.kind : 'any')} className="sr-only" disabled={uploading} onChange={handleUpload} type="file" />
          </label>
```

The grid:

```tsx
          {items.length > 0 && <><div className="media-grid">{items.map((item) => {
            const image = isImageAsset(item) ? item : null;
            const format = formatLabel(item.mime_type);
            const size = formatBytes(item.size_bytes);
            const label = image
              ? fill(props.mode === 'select' ? copy.media.selectLabel : copy.media.itemLabel, { format, height: image.height, name: item.original_name, size, width: image.width })
              : fill(props.mode === 'select' ? copy.media.selectFileLabel : copy.media.fileLabel, { format, name: item.original_name, size });
            return <button aria-label={label} className="media-card" key={item.id} onClick={(event) => props.mode === 'select' ? props.onSelect(item) : openDetails(item, event.currentTarget)} type="button">
              {image
                ? <img alt="" className="aspect-square w-full object-cover" height={image.height} loading="lazy" src={item.publicUrl} width={image.width} />
                : <span aria-hidden="true" className="media-card__file">{format}</span>}
              <strong className="block truncate text-sm">{item.original_name}</strong>
              <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">{image && <span>{image.width} × {image.height}</span>}<span>{format}</span><span>{size}</span></span>
              {props.mode === 'select' && <span className="media-card-select">{copy.media.select}</span>}
            </button>;
          })}</div>{hasMore && <div className="media-status"><button aria-busy={loading} className="admin-button" disabled={loading} onClick={() => void load(page + 1, true, currentQuery.current, selection, filter)} type="button">{copy.media.loadMore}</button></div>}</>}
```

In the details dialog: its `aria-label` is `copy.media.fileDetails`; in place of its `<img>` and the line under the name,

```tsx
{isImageAsset(selected)
  ? <img alt="" height={selected.height} src={selected.publicUrl} width={selected.width} />
  : <span aria-hidden="true" className="media-card__file media-details__file">{formatLabel(selected.mime_type)}</span>}
<p className="break-all font-medium">{selected.original_name}</p>
<p className="text-sm text-muted">{isImageAsset(selected) ? `${selected.width} × ${selected.height} · ` : ''}{formatLabel(selected.mime_type)} · {formatBytes(selected.size_bytes)}</p>
```

the alternative text field only for an image (`{isImageAsset(selected) && <label>{copy.media.altText}<textarea ... /></label>}`), and the address field labelled `copy.media.fileUrl` (its `<label>` text and its `aria-label`).

In `src/components/admin/MediaPicker.tsx`, take `kind: MediaKind` (from `'../../lib/media'`) and pass it on: `<MediaLibrary kind={kind} mode="select" onCancel={cancel} onSelect={select} ownerLocale={ownerLocale} />`.

The pickers: `PostSettingsDrawer.tsx` opens `<MediaPicker kind="image" ...>`; `ProfileForm.tsx` opens `<MediaPicker kind="image" ownerLocale={ownerLocale} ...>` (amendment 3); `BlockInsertMenu.tsx` opens `<MediaPicker kind="image" ...>` for now -- Task 7 gives it the file picker and the locale.

In `src/styles/global.css`, below `.media-toolbar__end`:

```css
/* The library's types: a row of choices under the search on a wide screen, a select on a phone. */
.media-types { order: 3; flex: 1 1 100%; min-width: 0; }
.media-types__choices { display: flex; flex-wrap: wrap; gap: var(--space-2xs); }
.media-types__select { display: none; }
```

below `.media-card img`:

```css
/* A document has no picture to show, so its tile says what it is. */
.media-card__file {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  width: 100%;
  margin-block-end: var(--space-xs);
  border-radius: calc(var(--radius-card) - var(--rule-hair)) calc(var(--radius-card) - var(--rule-hair)) 0 0;
  background: var(--color-paper-3);
  color: var(--color-muted);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.media-details__file { @apply mb-4 aspect-video rounded-md; }
```

and inside `@media (max-width: 52.499rem)`, beside the folder list's rules:

```css
  .media-types__choices {
    display: none;
  }

  .media-types__select {
    display: block;
  }
```

- [ ] **Step 8: Run it to see it pass**

Run: `npm run test:e2e -- tests/e2e/editor-blocks.spec.ts`
Expected: PASS, the new test and every test the spec had.

- [ ] **Step 9: Put each guard's bug back**

1. Skip the address effect. Expected: FAIL after the reload, `PDF` not pressed.
2. Leave `type` out of `listMedia`'s query. Expected: FAIL, `Swatch.png` still shown under PDF.
3. Show the server's message instead of `REFUSAL_COPY`'s. Expected: FAIL at the alert, which says the API's "Save the file" where the copy says "Save this file".

- [ ] **Step 10: The whole unit suite and the check**

Run: `npm run test:unit && npm run check`
Expected: all pass, `admin-i18n.test.ts` included.

- [ ] **Step 11: Commit**

```bash
git add src/components/admin/MediaTypes.tsx src/types/cms.ts src/lib/media.ts src/lib/media-client.ts \
  src/components/admin/MediaLibrary.tsx src/components/admin/MediaPicker.tsx src/components/admin/PostSettingsDrawer.tsx \
  src/components/admin/ProfileForm.tsx src/components/admin/BlockInsertMenu.tsx src/lib/admin-i18n.ts src/styles/global.css \
  compose.test.yaml tests/e2e/editor-blocks.spec.ts
```

Message:

```
feat(admin): the library holds documents and filters them by type

The library page uploads images and documents, shows a document as a tile with its type where
an image has its picture, and filters by All, Images, PDF, Documents, Spreadsheets, Slides and
ZIP beside its search: a row of choices, or a select on a phone. The type and the folder are
kept in the page's address, so a reload or a shared link opens the same view; the pickers keep
theirs to themselves. A document's details have no alternative text.

A refusal is said in the owner's language, whether the browser made it -- an unsupported file,
one too large, an empty one -- or the server did, by its code. The author's photo picker opens
in the owner's language too; it never had it.

The test store takes the spec's origin from TOME_CMS_TEST_ORIGIN, since the browser now puts
files into it from a server on a free port.
```

---

### Task 7: A file goes into an article from + or /, and a reader downloads it

**Files:**
- Create: `tests/unit/file-card-surface.test.ts`
- Modify: `src/components/admin/BlockInsertMenu.tsx`, `src/components/admin/SlashCommands.tsx`, `src/components/admin/DocumentCanvas.tsx`, `src/lib/icons.ts`, `src/lib/admin-i18n.ts`, `src/styles/global.css`, `tests/e2e/editor-blocks.spec.ts`

**Interfaces:**
- Consumes: `attachment`, `attachmentMeta`, `PICK_FILE_EVENT` (Task 5); `MediaPicker`'s `kind`, `isImageAsset`, `signIn` in the spec (Task 6); `office` (Task 3).
- Produces: `BlockInsertMenu` takes `ownerLocale`; the icon `file`; copy `blocks.file`, `blocks.fileHint`; the card's styles.

- [ ] **Step 1: Write the failing tests**

`tests/unit/file-card-surface.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CSS = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

/** The declarations of the first unindented rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('a file card is a quiet surface every theme has, and its link no underlined word', () => {
  const card = rule('p.file-card > :is(a, .file-card__link)');
  assert.match(card, /border: var\(--rule-hair\) solid var\(--color-rule\);/);
  assert.match(card, /border-radius: var\(--radius-card\);/);
  assert.match(card, /text-decoration: none;/);
  assert.match(rule('p.file-card > a:hover'), /text-decoration: none;/, 'a theme that underlines links on hover does not reach it');
  assert.match(rule('p.file-card > a:focus-visible'), /outline: 2px solid var\(--color-focus\);/);
});
```

Add to `tests/e2e/editor-blocks.spec.ts`:

```ts
test('a file goes into an article from + or /, and a reader downloads it', async ({ context, page }) => {
  test.setTimeout(150_000);
  await signIn(context, page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const { office } = await import('../helpers/zip');

  await page.goto(`${origin}/admin/new`);
  await page.locator('#post-title').fill('With files');
  const canvas = page.locator('.ProseMirror');
  await canvas.click();
  await page.keyboard.type('Before the files.');
  await page.keyboard.press('Enter');

  // From +, uploading in the picker: the file joins the library and its card goes in.
  await page.getByRole('button', { name: /Add block/i }).click();
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  const picker = page.locator('dialog.media-picker');
  await expect(picker.getByRole('group', { name: 'File types' }).getByRole('button', { name: 'PDF', exact: true }), 'documents, by type').toBeVisible();
  await expect(picker.getByRole('button', { name: 'Images', exact: true }), 'and no images').toHaveCount(0);
  await picker.locator('input[type="file"]').setInputFiles({
    name: 'แผนงาน.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: office('word/document.xml'),
  });
  const cards = canvas.locator('.file-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('แผนงาน.docx');
  await expect(cards.first()).toContainText('DOCX');

  // From /, choosing the file now in the library.
  await canvas.getByText('Before the files.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.getByRole('option', { name: /^File/ }).click();
  await picker.getByRole('button', { name: /^Select แผนงาน\.docx,/ }).click();
  await expect(cards).toHaveCount(2);

  // A card that is cut and pasted is still a card: the clipboard carries it as HTML.
  await cards.first().click();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(cards).toHaveCount(1);
  await canvas.getByText('Before the files.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(cards).toHaveCount(2);

  const written = page.waitForResponse((response) => response.url().includes('/api/admin/posts')
    && ['POST', 'PUT'].includes(response.request().method()) && response.ok());
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await written;

  const { db } = await import('../../src/server/db/client');
  const { slug } = await db.selectFrom('posts').select('slug').where('title', '=', 'With files')
    .orderBy('created_at', 'desc').executeTakeFirstOrThrow();
  await page.goto(`${origin}/en/blog/${slug}`);
  const links = page.locator('article p.file-card > a');
  await expect(links).toHaveCount(2);
  await expect(links.first()).toContainText('แผนงาน.docx');
  await expect(links.first()).toContainText(/DOCX · \d+ B/);
  await expect(links.first(), 'a document downloads where it is').not.toHaveAttribute('target', '_blank');
  expect(await links.first().evaluate((link) => getComputedStyle(link).textDecorationLine), 'a card, not an underlined word').toBe('none');

  // The link answers with the file, which the store hands out under its own name.
  const href = await links.first().getAttribute('href');
  const redirect = await fetch(`${origin}${href}`, { redirect: 'manual' });
  expect(redirect.status).toBe(302);
  const download = await fetch(redirect.headers.get('location') ?? '');
  expect(download.headers.get('content-disposition'))
    .toBe(`attachment; filename="file.docx"; filename*=UTF-8''${encodeURIComponent('แผนงาน.docx')}`);

  // The library will not delete a file an article uses, and says where.
  await page.goto(`${origin}/admin/media`);
  await page.getByRole('button', { name: /^แผนงาน\.docx, DOCX,/ }).click();
  const details = page.getByRole('dialog', { name: 'File details' });
  await details.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('still used');
  await expect(details.getByRole('link', { name: 'With files' })).toBeVisible();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/file-card-surface.test.ts` and `npm run test:e2e -- tests/e2e/editor-blocks.spec.ts -g "a file goes into an article"`
Expected: the unit test FAILS with `no rule for p.file-card > :is(a, .file-card__link)`; the e2e test FAILS at the `File` menu item, which is not there.

- [ ] **Step 3: Implement** -- in `src/lib/icons.ts`, beside `media`:

```ts
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
```

In `src/lib/admin-i18n.ts`, after `deleteTableHint` in `blocks`: English `file: 'File',` and `fileHint: 'Attach a file from the library',`; Thai `file: 'ไฟล์',` and `fileHint: 'แนบไฟล์จากคลัง',`.

In `src/components/admin/BlockInsertMenu.tsx`:
- imports:

```ts
import { PICK_FILE_EVENT } from '../../lib/editor-attachment';
import { NEW_TABLE } from '../../lib/editor-table';
import { isImageAsset, type MediaKind } from '../../lib/media';
import type { MediaAsset, PostLocale } from '../../types/cms';
```

- `export default function BlockInsertMenu({ copy, ownerLocale }: { copy: AdminCopy; ownerLocale?: PostLocale | null }) {`
- `const [picker, setPicker] = useState<MediaKind | null>(null);` in place of `pickerOpen`; in `update`, `if (!shouldShow && picker === null) setMenuOpen(false);`, and `picker` in its dependencies in place of `pickerOpen`.
- after the `useLayoutEffect`, before `if (!editor) return null;`:

```ts
  // '/' has no picker of its own. It asks for this one, at the cursor it leaves behind.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const pickFile = () => {
      savedPosition.current = editor.state.selection.from;
      setMenuOpen(false);
      setPicker('document');
    };
    dom.addEventListener(PICK_FILE_EVENT, pickFile);
    return () => dom.removeEventListener(PICK_FILE_EVENT, pickFile);
  }, [editor]);
```

- `openPicker` and the actions:

```ts
  const openPicker = (kind: MediaKind) => {
    savedPosition.current = editor.state.selection.from;
    setMenuOpen(false);
    setPicker(kind);
  };

  const actions = [
    ...blockActions,
    { icon: 'media', label: copy.blocks.image, run: () => openPicker('image') },
    { icon: 'file', label: copy.blocks.file, run: () => openPicker('document') },
  ] as const;
```

- `selectAsset`:

```ts
  const selectAsset = (asset: MediaAsset) => {
    const kind = picker;
    setPicker(null);
    const position = Math.min(savedPosition.current, editor.state.doc.content.size);
    const chain = editor.chain().focus().setTextSelection(position);
    if (kind === 'image' && isImageAsset(asset)) {
      chain.insertContent({
        type: 'image',
        attrs: { alt: asset.alt_text || asset.original_name, mediaId: asset.id, src: asset.publicUrl, title: asset.original_name },
      }).run();
    } else if (kind === 'document') {
      // These draw the card until it is saved; then the server fills it from the library.
      chain.insertContent({
        type: 'attachment',
        attrs: { href: asset.publicUrl, mediaId: asset.id, mimeType: asset.mime_type, name: asset.original_name, size: asset.size_bytes },
      }).run();
    }
  };
```

- the picker:

```tsx
      {picker && (
        <MediaPicker
          kind={picker}
          onCancel={() => {
            setPicker(null);
            editor.commands.focus();
          }}
          onSelect={selectAsset}
          ownerLocale={ownerLocale}
          returnFocus={editor.view.dom}
        />
      )}
```

In `src/components/admin/SlashCommands.tsx`, import `PICK_FILE_EVENT` from `'../../lib/editor-attachment'`, and add after the table's entry:

```ts
  {
    title: copy.blocks.file,
    description: copy.blocks.fileHint,
    icon: <Icon name="file" />,
    searchTerms: ['file', 'attachment', 'document', 'pdf', 'download'],
    // The picker belongs to the + menu; this asks it to open where the command was typed.
    command: ({ editor, range }: { editor: EditorInstance; range: Range }) => {
      editor.chain().focus().deleteRange(range).run();
      editor.view.dom.dispatchEvent(new CustomEvent(PICK_FILE_EVENT));
    },
  },
```

In `src/components/admin/DocumentCanvas.tsx`, import `{ attachment, attachmentMeta }` from `'../../lib/editor-attachment'`, add below `editorImage`:

```ts
/**
 * The editor draws a card with no link in it: a click selects the card, as a click on a picture
 * does, and a drag moves the card rather than its address. The stored HTML keeps the link.
 */
const editorAttachment = attachment.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('p');
      dom.className = 'file-card';
      const box = document.createElement('span');
      box.className = 'file-card__link';
      const name = document.createElement('span');
      name.className = 'file-card__name';
      name.textContent = String(node.attrs.name ?? '');
      const meta = document.createElement('span');
      meta.className = 'file-card__meta';
      meta.textContent = attachmentMeta({ mimeType: node.attrs.mimeType, size: Number(node.attrs.size) || 0 });
      box.append(name, ' ', meta);
      dom.append(box);
      return { dom };
    };
  },
});
```

add `editorAttachment` to `buildExtensions` after `textAlign`, and render `<BlockInsertMenu copy={copy} ownerLocale={ownerLocale} />` (amendment 3).

In `src/styles/global.css`, below the `.tableWrapper` rule:

```css
/*
 * A file in an article: one bordered row that is all link. Here beside the table's wrapper, so
 * every theme has it. The editor draws the same card with a span where a reader's has the link.
 */
p.file-card { margin-block: var(--space-md); }

p.file-card > :is(a, .file-card__link) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: var(--space-sm);
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-paper);
  color: var(--color-ink);
  text-decoration: none;
}

/* A page with a turned corner, in the accent: one mark for every type, which the line under the name spells out. */
p.file-card > :is(a, .file-card__link)::before {
  content: '';
  grid-row: span 2;
  width: 1.5rem;
  height: 1.5rem;
  background: var(--color-accent);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3C/svg%3E") center / contain no-repeat;
}

.file-card__name { font-weight: 600; overflow-wrap: anywhere; }
.file-card__meta { color: var(--color-muted); font-size: var(--text-xs); }

/* Themes underline a link on hover; a card is not a word in a sentence. */
p.file-card > a:hover { border-color: var(--color-rule-strong); text-decoration: none; }

p.file-card > a:focus-visible { outline: 2px solid var(--color-focus); outline-offset: var(--space-3xs); }

.ProseMirror-selectednode.file-card > .file-card__link { border-color: var(--color-focus); }
```

The selectors carry `p` and `>` on purpose: `p.file-card > a` outweighs a theme's `.plain-body a`, which would otherwise underline the card and colour it as a link.

- [ ] **Step 4: Run them to see them pass**

Run: `node --import tsx --test tests/unit/file-card-surface.test.ts tests/unit/icons.test.ts tests/unit/admin-i18n.test.ts` and `npm run test:e2e -- tests/e2e/editor-blocks.spec.ts`
Expected: PASS, the new tests and all the spec had.

Look at the card before going on: take a screenshot of the published page at 1440 and at 375 wide, in the light theme and the dark, and of the editor with a card selected. The card is one bordered row, the mark beside the name and the type and size under it, nothing underlined, and at 375 a long Thai name wraps inside the card rather than widening the page.

- [ ] **Step 5: Put each guard's bug back**

1. Make `parseHTML` return `[]`. Expected: FAIL after the paste, one card.
2. Drop the `dispatchEvent` from the `/` command. Expected: FAIL at `Select แผนงาน.docx`, no picker.
3. Remove `text-decoration: none` from the hover rule. Expected: the unit test FAILS.
4. Insert an `image` node for a document in `selectAsset`. Expected: FAIL, no card.

- [ ] **Step 6: The whole unit suite and the check**

Run: `npm run test:unit && npm run check`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/BlockInsertMenu.tsx src/components/admin/SlashCommands.tsx src/components/admin/DocumentCanvas.tsx \
  src/lib/icons.ts src/lib/admin-i18n.ts src/styles/global.css tests/unit/file-card-surface.test.ts tests/e2e/editor-blocks.spec.ts
```

Message:

```
feat(admin): a file goes into an article from + or /, and a reader downloads it

File in the + menu and in / opens the library's picker with documents only, where a writer
chooses a file or uploads one; an upload joins the library in the folder the picker has open,
and its card goes in at once. / has no picker of its own and asks the + menu's.

In the editor a card is drawn without its link, so a click selects it as a click on a picture
does, and a drag moves it; cut and paste keep it a card. On the page it is one bordered row,
styled beside the table's wrapper so every theme has it, and no theme's underline reaches it.
The editor's image picker opens in the owner's language now, which it never did.
```

---

### Task 8: An external store is told what it must allow, and the whole is checked

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Say it in the README** -- in "Configuration", after the paragraph that ends "when you need high availability or more than one node.", add:

```markdown
The browser puts uploads straight into the bucket, so an external store needs a CORS rule for the site's origin that allows `PUT` with the `content-type`, `x-amz-checksum-sha256` and `content-disposition` headers. The last carries a document's name and how it opens, and is signed into the upload. The bundled SeaweedFS allows what the site's origin asks for, and nothing to any other origin.
```

- [ ] **Step 2: Run every gate**

Run, one after another:

```bash
npm run test:unit
npm run check
node scripts/test-foundation.mjs --all
npm run test:e2e
npm run build
```

Expected: every unit test passes; `astro check` has 0 errors and 0 warnings; every integration file passes, `media-documents-storage.test.ts` among those given storage; every e2e spec passes; the build completes. The chunk-size warning the build already printed before this work is the only warning.

- [ ] **Step 3: Read what goes in**

Run: `git log --format='%h %s' main@{upstream}..HEAD` and `git log --format='%B' main@{upstream}..HEAD | grep -iE 'co-authored-by|generated with'`
Expected: the eight commits of this plan, and no attribution line.

- [ ] **Step 4: Commit**

```bash
git add README.md
```

Message:

```
docs: an external store's CORS rule allows the upload's new header

A document's upload carries content-disposition beside content-type and the checksum, signed
into its URL. The bundled SeaweedFS allows whatever the site's own origin asks for; an
external store whose rule lists headers has to list this one, or documents fail at the
preflight.
```
