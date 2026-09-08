# S3 File Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Storage and media-table access with S3-compatible direct uploads, PostgreSQL metadata/folders, stable media identity, reference-safe deletion, and a retryable cleanup path.

**Architecture:** One endpoint-configured AWS S3 client serves MinIO, R2, AWS S3, or another compatible provider. The browser requests a short-lived upload reservation, PUTs bytes directly with signed headers, and finalizes through TomeCMS. Finalization verifies the stored object before exposing metadata. PostgreSQL stores object keys and media IDs, never provider URLs; one resolver builds public URLs from `MEDIA_PUBLIC_URL`.

**Tech Stack:** AWS SDK for JavaScript v3, S3/MinIO, PostgreSQL/Kysely, `sharp`, Node crypto/streams, Astro Admin APIs, React File Manager, Playwright and real-MinIO integration tests.

**Spec:** [`docs/specs/2026-09-08-headless-core-migration-design.md`](../specs/2026-09-08-headless-core-migration-design.md)

## Global Constraints

- Complete the Foundation, Passkey/Installer, and PostgreSQL Content plans first.
- Run commands directly; do not use RTK.
- Use one `S3Client` configured by environment. Do not create MinIO/R2/AWS adapters or provider switches.
- `S3_ENDPOINT` is the canonical S3 API origin and must be reachable with the same hostname from both the Astro server and the browser receiving signed PUT URLs. Local host mode uses loopback; VPS mode exposes a dedicated HTTPS storage hostname through the documented reverse proxy. Do not sign an internal Docker hostname.
- This release accepts the existing image formats only: AVIF, GIF, JPEG, PNG, and WebP; 8 MB hard maximum. Do not turn File Manager into private document storage.
- S3 access/secret keys stay server-only. The browser receives only a single-object, short-lived signed PUT URL and required headers.
- TomeCMS generates every object key. Never trust a filename as a path or permit client-selected bucket/key.
- An item appears in File Manager only after finalization verifies bytes, MIME, checksum, and image dimensions.
- Content stores `mediaId` plus a stable TomeCMS media path where TipTap requires `src`; it never stores MinIO, R2, or S3 hostnames.
- Cross-store operations are not transactional. Use observable reservation/deletion states and idempotent retries instead of pretending PostgreSQL and S3 share a transaction.
- Keep existing File Manager, folders, search, cover guidance, drag/drop/paste, picker, alt text, and reference-blocking UX.
- Do not remove Supabase globally until Plan 5. Remove its media runtime only after all focused media tests pass.
- Before every commit, stage only named files and inspect/check/secret-scan the staged patch.

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| Packages | none | `package.json`, `package-lock.json` |
| Schema | `src/server/db/migrations/004_media.ts`, `tests/integration/media-schema.test.ts` | `src/server/db/types.ts`, `src/server/db/migrator.ts` |
| S3 boundary | `src/server/media/storage.ts`, `src/server/media/keys.ts`, `src/server/media/url.ts`, `tests/unit/media-storage.test.ts` | `src/server/health.ts` |
| Media service | `src/server/media/service.ts`, `src/server/media/image.ts`, `tests/integration/media-service.test.ts` | `src/server/content/editor.ts`, Post/Page content services |
| Admin API | `src/pages/api/admin/media/index.ts`, `src/pages/api/admin/media/folders.ts`, `src/pages/api/admin/media/uploads/index.ts`, `src/pages/api/admin/media/uploads/[id]/finalize.ts`, `src/pages/api/admin/media/[id].ts` | none |
| Public path | `src/pages/media/[id].ts` | none |
| Browser | none | `src/lib/media-client.ts`, `src/components/admin/ImageUploader.ts`, `MediaLibrary.tsx`, `MediaPicker.tsx`, `Editor.tsx`, `PostSettingsDrawer.tsx`, `ProfileForm.tsx` |
| Maintenance | `scripts/media-cleanup.ts`, `tests/unit/media-cleanup.test.ts` | `package.json`, `compose.yaml`, `scripts/bootstrap-core.mjs` |
| Tests/docs | `tests/e2e/s3-file-manager.spec.ts` | existing media/editor/public E2E specs, `tests/e2e/support.ts`, `README.md` |

---

## Task 1: Pin the S3 and image-verification packages

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the minimum packages**

```sh
npm install --save-exact @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp
```

`sharp` is required because the server must verify image dimensions/type from uploaded bytes; browser-reported dimensions are untrusted. Do not add an upload framework, multipart library, storage abstraction, or image transformation pipeline.

- [ ] **Step 2: Verify production installation and native binary support**

```sh
npm ls @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp
npm run check
docker build -t tomecms-media-deps .
```

- [ ] **Step 3: Commit**

```sh
git add package.json package-lock.json
git diff --cached --check
git diff --cached --stat
git commit -m "build(media): add s3 upload dependencies"
```

## Task 2: Add media metadata, reservation, and deletion states

**Files:**

- Create: `src/server/db/migrations/004_media.ts`
- Modify: `src/server/db/types.ts`
- Modify: `src/server/db/migrator.ts`
- Create: `tests/integration/media-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Cover owner/folder ownership, case-insensitive folder names, unique object keys, allowed image MIME, size/dimension bounds, reservation expiry, one-time finalization, valid state transitions, Post cover/profile avatar FKs, owner-crossing rejection, and cascade/set-null behavior.

- [ ] **Step 2: Add concrete media tables**

```ts
export type MediaState = 'ready' | 'deleting' | 'delete_failed';
export type ReservationState = 'pending' | 'finalized' | 'expired';

export interface MediaFolderTable {
  id: string;
  owner_id: string;
  name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MediaItemTable {
  id: string;
  owner_id: string;
  folder_id: string | null;
  object_key: string;
  original_name: string;
  mime_type: SupportedImageType;
  size_bytes: number;
  checksum_sha256: string;
  width: number;
  height: number;
  alt_text: string | null;
  state: MediaState;
  delete_error_code: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MediaUploadReservationTable {
  id: string;
  owner_id: string;
  object_key: string;
  original_name: string;
  mime_type: SupportedImageType;
  expected_size_bytes: number;
  expected_checksum_sha256: string;
  expires_at: Timestamp;
  finalized_at: Timestamp | null;
  created_at: Timestamp;
}
```

Use `bigint` safely: size is capped at 8 MB, so Kysely output may be converted to JS number at the service boundary after range validation.

- [ ] **Step 3: Implement `004_media`**

Create folder/item/reservation tables and indexes. Add `posts.cover_media_id` and `site_settings.author_avatar_media_id` FKs to `media_items(id)` with `on delete set null`. Add owner-aware composite FKs for folders and media references where possible. Add JSON GIN indexes on Post/Page `content_json` for reference checks; do not add a separate content-media join table until measured query cost justifies it.

- [ ] **Step 4: Run and commit**

```sh
npm run test:integration:foundation -- tests/integration/media-schema.test.ts
npm run check
git add src/server/db/migrations/004_media.ts src/server/db/types.ts src/server/db/migrator.ts tests/integration/media-schema.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(media): add s3 metadata and reservations"
```

## Task 3: Implement one S3 boundary and stable URL resolver

**Files:**

- Create: `src/server/media/storage.ts`
- Create: `src/server/media/keys.ts`
- Create: `src/server/media/url.ts`
- Create: `tests/unit/media-storage.test.ts`
- Modify: `src/server/health.ts`

- [ ] **Step 1: Write failing key/URL/config tests**

Test Unicode filenames do not enter keys, traversal input is irrelevant, keys have owner/date/random components, path segments are encoded, public-base changes alter resolved URLs without changing keys, path-style is configurable, and no returned config contains credentials.

- [ ] **Step 2: Implement the single client**

```ts
import { S3Client } from '@aws-sdk/client-s3';

const env = getServerEnv();
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});
```

Export:

```ts
export function createObjectKey(ownerId: string, mimeType: SupportedImageType, now?: Date): string;
export function resolveMediaUrl(objectKey: string): string;
export function stableMediaPath(mediaId: string): string;
```

Keys use validated UUID owner ID, UTC `yyyy/mm`, `crypto.randomUUID()`, and an extension selected from the MIME allowlist. `resolveMediaUrl` appends encoded key segments to `MEDIA_PUBLIC_URL`; it rejects `.`/`..`, empty segments, and backslashes.

- [ ] **Step 3: Make readiness check S3 for real**

Replace the foundation's `deferred` storage state with bounded `HeadBucketCommand`. Final readiness is healthy only when migrations and bucket access pass. A provider error maps to `storage: unavailable` without exposing endpoint/bucket names.

- [ ] **Step 4: Run and commit**

```sh
npm run test:unit -- tests/unit/media-storage.test.ts
npm run check
git add src/server/media/storage.ts src/server/media/keys.ts src/server/media/url.ts tests/unit/media-storage.test.ts src/server/health.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(media): add portable s3 boundary"
```

## Task 4: Implement reservation, signed PUT, and verified finalization

**Files:**

- Create: `src/server/media/image.ts`
- Create: `src/server/media/service.ts`
- Create: `tests/integration/media-service.test.ts`
- Create: `src/pages/api/admin/media/uploads/index.ts`
- Create: `src/pages/api/admin/media/uploads/[id]/finalize.ts`

- [ ] **Step 1: Write the failing real-MinIO tests**

Test success plus unsupported MIME, zero/oversize declaration, bad checksum syntax, expired signature, wrong content type, size mismatch, checksum mismatch, corrupt image, spoofed MIME, double finalization, foreign reservation, and orphan visibility. Assert no media row exists before successful finalize.

- [ ] **Step 2: Define strict request/response contracts**

```ts
export const reserveUploadSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ACCEPTED_IMAGE_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  folderId: z.uuid().nullable(),
  altText: z.string().trim().max(300),
}).strict();

export interface UploadReservationResponse {
  id: string;
  uploadUrl: string;
  expiresAt: string;
  headers: { 'content-type': SupportedImageType; 'x-amz-checksum-sha256': string };
}
```

- [ ] **Step 3: Reserve and sign**

Validate folder ownership, generate a key, insert a five-minute reservation, and sign:

```ts
const command = new PutObjectCommand({
  Bucket: env.S3_BUCKET,
  Key: objectKey,
  ContentType: input.mimeType,
  ChecksumSHA256: input.checksumSha256,
});
const uploadUrl = await getSignedUrl(s3, command, {
  expiresIn: 300,
  signableHeaders: new Set(['content-type']),
  unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
});
```

- [ ] **Step 4: Verify and finalize**

Lock the reservation, reject expired/finalized/foreign rows, `HeadObject` for declared length/type, then stream `GetObject` through SHA-256 and a bounded 8 MB buffer. `sharp(buffer).metadata()` must report the expected image family and positive dimensions. Insert the ready media item and mark the reservation finalized in one PostgreSQL transaction. On verification failure, delete the object best-effort and retain an expired/failed reservation for cleanup diagnostics.

- [ ] **Step 5: Run and commit**

```sh
npm run test:integration:foundation -- tests/integration/media-service.test.ts
npm run check
git add src/server/media/image.ts src/server/media/service.ts tests/integration/media-service.test.ts src/pages/api/admin/media/uploads
git diff --cached --check
git diff --cached --stat
git commit -m "feat(media): verify direct s3 uploads"
```

## Task 5: Move folders, listing, metadata, and reference-safe deletion

**Files:**

- Create: `src/pages/api/admin/media/index.ts`
- Create: `src/pages/api/admin/media/folders.ts`
- Create: `src/pages/api/admin/media/[id].ts`
- Create: `src/pages/media/[id].ts`
- Modify: `src/server/media/service.ts`
- Modify: `tests/integration/media-service.test.ts`

- [ ] **Step 1: Make current File Manager API behavior red at `/api/admin/media`**

Preserve folder CRUD, case-insensitive conflicts, unfiled filter, search, 48-item pages, ordering, alt text/folder edits, auth boundaries, and safe generic errors. Add deleting/delete-failed retry cases.

- [ ] **Step 2: Implement focused media service calls**

```ts
export async function listMedia(ownerId: string, input: MediaListInput): Promise<MediaPage>;
export async function listFolders(ownerId: string): Promise<MediaFolder[]>;
export async function createFolder(ownerId: string, name: string): Promise<MediaFolder>;
export async function renameFolder(ownerId: string, id: string, name: string): Promise<MediaFolder>;
export async function deleteFolder(ownerId: string, id: string): Promise<void>;
export async function updateMedia(ownerId: string, id: string, input: MediaMutation): Promise<MediaAsset>;
export async function deleteMedia(ownerId: string, id: string): Promise<void>;
```

Delete checks `posts.cover_media_id`, profile avatar, and Post/Page JSON nodes containing `attrs.mediaId`. If referenced, return `409` with a count by reference type. Otherwise mark `deleting`, attempt `DeleteObject`, then delete metadata; `NoSuchKey` is success. On S3 failure set `delete_failed` with a safe code and return retryable `503`.

- [ ] **Step 3: Add stable media path**

`GET /media/[id]` loads only `state = ready` media, returns `302` to `resolveMediaUrl(object_key)`, sets a public cache directive on the redirect, and never accepts an object key. Missing/deleting items return `404`.

- [ ] **Step 4: Run and commit**

```sh
npm run test:integration:foundation -- tests/integration/media-service.test.ts
npm run check
git add src/pages/api/admin/media src/pages/media src/server/media/service.ts tests/integration/media-service.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(media): move file manager metadata to postgres"
```

## Task 6: Switch browser uploads and rich-content media identity

**Files:**

- Modify: `src/lib/media-client.ts`
- Modify: `src/components/admin/ImageUploader.ts`
- Modify: `src/components/admin/MediaLibrary.tsx`
- Modify: `src/components/admin/MediaPicker.tsx`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/components/admin/PostSettingsDrawer.tsx`
- Modify: `src/components/admin/ProfileForm.tsx`
- Modify: `src/components/admin/DocumentCanvas.tsx`
- Modify: `src/server/content/editor.ts`
- Modify: Post/Page content services
- Modify: `src/types/cms.ts`
- Create: `tests/e2e/s3-file-manager.spec.ts`

- [ ] **Step 1: Write the failing browser flow**

Cover File Manager upload/folders/search/edit/delete, cover selection/guidance, avatar selection, drag/drop/paste/insert image, upload progress, network/finalize failure recovery, referenced deletion block, stable public rendering, and reload/re-edit of the same TipTap media node.

- [ ] **Step 2: Replace direct Supabase upload with reservation flow**

Browser steps are exact:

```ts
const checksum = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))));
const reservation = await postJson<UploadReservationResponse>('/api/admin/media/uploads', {
  originalName: file.name,
  mimeType: file.type,
  sizeBytes: file.size,
  checksumSha256: checksum,
  folderId: options.folderId ?? null,
  altText: options.altText ?? '',
});
await fetch(reservation.uploadUrl, { method: 'PUT', headers: reservation.headers, body: file });
return postJson<{ item: MediaAsset }>(`/api/admin/media/uploads/${reservation.id}/finalize`, {});
```

Avoid spreading very large typed arrays into `String.fromCharCode`; implement chunked base64 conversion in the actual helper and cover it with an 8 MB test.

- [ ] **Step 3: Store media identity in TipTap**

Image nodes use:

```ts
attrs: {
  src: `/media/${asset.id}`,
  mediaId: asset.id,
  alt: asset.alt_text ?? '',
  title: asset.original_name,
}
```

Extend both browser and server TipTap Image definitions to permit/render `mediaId` while sanitization allows only the stable relative `/media/<uuid>` form or vetted HTTP(S) legacy input during the branch. The final cutover test rejects provider hostnames in stored JSON/HTML.

- [ ] **Step 4: Replace cover/avatar URL state with IDs**

Editor payload sends `coverMediaId`; profile sends `authorAvatarMediaId`. Server services verify ownership and ready state. Responses resolve a `MediaAsset` object for display. Updating `MEDIA_PUBLIC_URL` must change rendered URLs without rewriting content rows.

- [ ] **Step 5: Run and commit**

```sh
npm run test:e2e -- tests/e2e/s3-file-manager.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/media-library.spec.ts tests/e2e/media-deletion.spec.ts --project=desktop
npm run check
npm run build
git add src/lib/media-client.ts src/components/admin src/server/content src/types/cms.ts tests/e2e/s3-file-manager.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/media-library.spec.ts tests/e2e/media-deletion.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(media): switch editor and file manager to s3"
```

Stage only listed media/editor files actually modified; do not include unrelated Admin components.

## Task 7: Add CORS, cleanup, and reset-safe object handling

**Files:**

- Create: `scripts/media-cleanup.ts`
- Create: `tests/unit/media-cleanup.test.ts`
- Modify: `compose.yaml`
- Modify: `compose.test.yaml`
- Modify: `scripts/bootstrap-core.mjs`
- Modify: `scripts/reset-installation.mjs`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add exact bucket CORS**

Bootstrap configures the bucket for `PUT`, `HEAD`, and `GET` from exactly `new URL(TOME_CMS_PUBLIC_URL).origin`, permits `content-type` and `x-amz-checksum-sha256`, exposes `etag` and checksum headers, and does not use wildcard origins for upload. Public anonymous GET remains enabled for the media bucket.

The VPS reverse-proxy example must publish the same HTTPS origin configured as `S3_ENDPOINT`; the app container must resolve and reach that origin too. Add a startup check that rejects `minio`, a private Compose-only hostname, or loopback when `NODE_ENV=production`.

- [ ] **Step 2: Add idempotent cleanup**

Add:

```json
{ "media:cleanup": "node --env-file-if-exists=.env.local --import tsx scripts/media-cleanup.ts" }
```

The command finds expired unfinalized reservations and `delete_failed` items, attempts object deletion, and changes only rows it successfully resolves. It defaults to dry-run; `--execute` requires typed confirmation containing the configured origin and bucket. Limit each run to 1,000 rows and print counts/safe IDs, never signed URLs.

- [ ] **Step 3: Update installation reset**

Reset preview counts ready/deleting/reserved objects. Execute deletes only keys selected from the database and bucket prefix generated by TomeCMS, verifies removal, then deletes metadata/content/auth. Keep schema, migrations, environment, bucket, and install token. If object deletion fails, retain installation marker and abort so the site does not falsely return to Wizard with abandoned data.

- [ ] **Step 4: Run and commit**

```sh
npm run test:unit -- tests/unit/media-cleanup.test.ts
npm run test:integration:foundation -- tests/integration/media-service.test.ts
npm run test:e2e -- tests/e2e/s3-file-manager.spec.ts --project=desktop
npm run check
git add scripts/media-cleanup.ts tests/unit/media-cleanup.test.ts compose.yaml compose.test.yaml scripts/bootstrap-core.mjs scripts/reset-installation.mjs package.json README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat(media): recover incomplete object operations"
```

## S3 File Manager Completion Gate

- [ ] Browser code contains no S3 credential and no Supabase Storage client.
- [ ] Real MinIO tests cover reservation, signed PUT, finalization, mismatch rejection, deletion, and cleanup.
- [ ] File Manager exposes only finalized ready items.
- [ ] Post/Page HTML and JSON contain stable media IDs/paths, not provider hostnames.
- [ ] Covers, avatars, editor images, folders, search, alt text, and deletion references work end to end.
- [ ] `/health/ready` requires working PostgreSQL, current migrations, and S3 bucket access.
- [ ] Reset cannot claim success while known media objects remain.
