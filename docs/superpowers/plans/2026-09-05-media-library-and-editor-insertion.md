# TomeCMS Media Library and Editor Insertion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-scoped image library with categories, safe reuse and deletion, a shared cover/inline image picker, and a discoverable active-block insertion menu without changing TomeCMS's Supabase architecture or public zero-JavaScript blog output.

**Architecture:** Supabase Storage remains the object store and public delivery layer; new Postgres tables hold owner-scoped image metadata and one-level categories. The authenticated browser performs normal reads, uploads, and metadata mutations under RLS. One authenticated Astro endpoint coordinates destructive image deletion after checking post usage. `MediaLibrary`, `MediaPicker`, and `BlockInsertMenu` are focused React components reused by the admin editor.

**Tech Stack:** Astro 5 SSR, React 18 islands, TypeScript strict mode, Novel/Tiptap, Supabase Auth/Postgres/Storage/RLS, Tailwind/global CSS, Zod, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-05-media-library-design.md`](../specs/2026-09-05-media-library-design.md)

## Global Constraints

- Run every shell command through `rtk` in this repository.
- Treat all pre-existing working-tree changes as user-owned. Never restore or overwrite them; integrate with overlapping edits and stage only files owned by the current task.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Browser code may use only `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`.
- Keep the existing public `blog-media` bucket, stable owner-prefixed object paths, direct authenticated uploads, and `upsert: false`.
- Do not add MinIO, an S3 SDK, S3 credentials, a storage-provider interface, nested folders, bulk actions, or non-image media.
- Keep TypeScript strict with no `any`.
- Preserve the public blog route as server-rendered HTML with no hydration directive or application script.
- Keep each task independently reviewable. Run its focused check before committing, then stage only the listed files.

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add Playwright scripts and one dev dependency. |
| `package-lock.json` | Modify | Lock the Playwright dependency. |
| `playwright.config.ts` | Create | Run focused desktop/mobile admin and public-route checks against a dedicated Astro port. |
| `tests/e2e/support.ts` | Create | Create/delete isolated Supabase users and sign an owner into the Admin UI. |
| `tests/e2e/media-rls.spec.ts` | Create | Prove metadata and Storage isolation between owners. |
| `tests/e2e/media-library.spec.ts` | Create | Cover upload, browse, search, categories, metadata, and responsive states. |
| `tests/e2e/media-deletion.spec.ts` | Create | Cover unused deletion and in-use `409` behavior. |
| `tests/e2e/editor-media.spec.ts` | Create | Cover Media Picker, cover selection, block menu, slash menu, and inline insertion. |
| `tests/e2e/public-blog.spec.ts` | Create | Guard zero-JavaScript blog rendering. |
| `supabase/migrations/*_create_media_library.sql` | Create via Supabase CLI | Add media tables, constraints, indexes, RLS, grants, and owner-only Storage listing. |
| `src/types/cms.ts` | Modify | Add strict media row, insert/update, and view-model types. |
| `src/lib/media.ts` | Modify | Centralize accepted MIME types, validation limits, dimensions, and cover guidance. |
| `src/lib/media-client.ts` | Create | Own authenticated media/category queries and stable public-URL derivation. |
| `src/lib/installation.ts` | Modify | Include media tables in migration readiness. |
| `src/components/admin/ImageUploader.ts` | Modify | Return a complete media asset and compensate if metadata insertion fails. |
| `src/components/admin/MediaLibrary.tsx` | Create | Render and operate the full Media page, with an optional selection mode. |
| `src/components/admin/MediaPicker.tsx` | Create | Wrap Media Library in an accessible dialog/drawer for editor reuse. |
| `src/components/admin/BlockInsertMenu.tsx` | Create | Position the active-block `+` and run Tiptap block/image commands. |
| `src/components/admin/Editor.tsx` | Modify | Coordinate Media Picker results with cover and inline editor state. |
| `src/layouts/AdminLayout.astro` | Modify | Add the Media navigation item. |
| `src/pages/admin/media.astro` | Create | Authenticate and mount Media Library with `client:only="react"`. |
| `src/pages/api/media/[id].ts` | Create | Validate ownership/usage and coordinate deletion. |
| `src/styles/global.css` | Modify | Add responsive Media Library, picker, cover, and insertion-menu styles using existing admin tokens. |
| `README.md` | Modify | Document media behavior, limits, local verification, and production backup scope. |

## Shared Interfaces

The following names are the contract between tasks. Add them to `src/types/cms.ts` before UI work:

```ts
export type SupportedImageType = 'image/avif' | 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';

export interface MediaFolder {
  created_at: string;
  id: string;
  name: string;
  owner_id: string;
  updated_at: string;
}

export interface MediaItem {
  alt_text: string | null;
  created_at: string;
  folder_id: string | null;
  height: number;
  id: string;
  mime_type: SupportedImageType;
  original_name: string;
  owner_id: string;
  size_bytes: number;
  storage_path: string;
  updated_at: string;
  width: number;
}

export interface MediaAsset extends MediaItem {
  publicUrl: string;
}

export interface UploadImageOptions {
  altText?: string | null;
  folderId?: string | null;
}
```

The media client exports these functions directly; do not wrap them in a repository class:

```ts
export const MEDIA_PAGE_SIZE = 48;

export async function listMedia(input: {
  folderId?: string | null;
  page?: number;
  search?: string;
}): Promise<{ hasMore: boolean; items: MediaAsset[] }>;

export async function listMediaFolders(): Promise<MediaFolder[]>;
export async function createMediaFolder(name: string): Promise<MediaFolder>;
export async function renameMediaFolder(id: string, name: string): Promise<MediaFolder>;
export async function deleteMediaFolder(id: string): Promise<void>;
export async function updateMediaItem(
  id: string,
  values: { alt_text?: string | null; folder_id?: string | null },
): Promise<MediaAsset>;
export function publicMediaUrl(storagePath: string): string;
```

---

### Task 1: Add the focused browser/security test harness

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/e2e/support.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Consumes:** Existing Admin login form at `/admin`; `.env.local` created by `npm run dev:macos`.

**Produces:** `test:e2e` and `test:e2e:media` commands, an isolated port, and reusable owner fixtures.

- [ ] **Step 1: Install only the required E2E dependency**

Run:

```bash
rtk npm install --save-dev --save-exact @playwright/test
```

Add scripts:

```json
{
  "scripts": {
    "test:e2e": "node --env-file=.env.local ./node_modules/@playwright/test/cli.js test",
    "test:e2e:media": "node --env-file=.env.local ./node_modules/@playwright/test/cli.js test tests/e2e/media-rls.spec.ts tests/e2e/media-library.spec.ts tests/e2e/media-deletion.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/public-blog.spec.ts"
  }
}
```

- [ ] **Step 2: Configure one deterministic local server**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4322',
    reuseExistingServer: true,
    timeout: 120_000,
    url: 'http://127.0.0.1:4322',
  },
});
```

- [ ] **Step 3: Add strict Supabase test helpers**

Create `tests/e2e/support.ts` with typed environment access, service-role owner creation, owner cleanup, and Admin login:

```ts
import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requiredEnv(name: 'PUBLIC_SUPABASE_ANON_KEY' | 'PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for E2E tests.`);
  return value;
}

export const supabaseUrl = requiredEnv('PUBLIC_SUPABASE_URL');
export const anonKey = requiredEnv('PUBLIC_SUPABASE_ANON_KEY');
export const admin = createClient(supabaseUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

export interface TestOwner {
  client: SupabaseClient;
  email: string;
  id: string;
  password: string;
}

export async function createOwner(label: string): Promise<TestOwner> {
  const email = `e2e-${label}-${crypto.randomUUID()}@example.com`;
  const password = `TomeCMS-${crypto.randomUUID()}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('Test owner was not created.');

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, email, id: data.user.id, password };
}

export async function deleteOwner(owner: TestOwner) {
  const { data: objects, error: listError } = await admin.storage
    .from('blog-media')
    .list(owner.id, { limit: 100 });
  if (listError) throw listError;
  if (objects.length) {
    const paths = objects.map((object) => `${owner.id}/${object.name}`);
    const { error: removeError } = await admin.storage.from('blog-media').remove(paths);
    if (removeError) throw removeError;
  }
  const { error } = await admin.auth.admin.deleteUser(owner.id);
  if (error) throw error;
}

export async function signInAdmin(page: Page, owner: TestOwner) {
  await page.goto('/admin');
  await page.getByLabel('Email address').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}
```

The helper deliberately lists only the test owner's prefix and never empties the shared bucket.

- [ ] **Step 4: Prove the harness starts before adding media tests**

Run:

```bash
rtk npx playwright install chromium
rtk npm run check
rtk npm run test:e2e -- --list
```

Expected: Astro check passes and Playwright lists zero tests without configuration errors.

- [ ] **Step 5: Commit only the harness**

```bash
rtk git add package.json package-lock.json playwright.config.ts tests/e2e/support.ts
rtk git commit -m "test: add media e2e harness"
```

---

### Task 2: Create media metadata, constraints, and RLS

**Files:**

- Create via CLI: `supabase/migrations/*_create_media_library.sql`
- Create: `tests/e2e/media-rls.spec.ts`
- Modify: `src/types/cms.ts`
- Modify: `src/lib/installation.ts`

**Consumes:** Auth users; existing `blog-media` bucket and owner-prefixed Storage policies.

**Produces:** `media_folders`, `media_items`, owner-only metadata access, owner-only object listing, strict generated-style TypeScript types.

- [ ] **Step 1: Write the failing two-owner security test**

The test must create owner A and owner B, insert one folder/item for A, then assert B receives no rows and cannot assign an item to A's folder. It must also upload one object per owner and prove each authenticated client lists only its own prefix.

Core assertions in `tests/e2e/media-rls.spec.ts`:

```ts
const { data: hiddenFolders, error: hiddenFoldersError } = await ownerB.client
  .from('media_folders')
  .select('id')
  .eq('id', folder.id);
expect(hiddenFoldersError).toBeNull();
expect(hiddenFolders).toEqual([]);

const { error: foreignFolderError } = await ownerB.client.from('media_items').insert({
  folder_id: folder.id,
  height: 1,
  mime_type: 'image/png',
  original_name: 'blocked.png',
  owner_id: ownerB.id,
  size_bytes: 68,
  storage_path: `${ownerB.id}/${crypto.randomUUID()}.png`,
  width: 1,
});
expect(foreignFolderError).not.toBeNull();
```

Run:

```bash
rtk npm run test:e2e -- tests/e2e/media-rls.spec.ts --project=desktop
```

Expected: FAIL because the media tables do not exist.

- [ ] **Step 2: Generate the migration with the Supabase CLI**

```bash
rtk npx supabase migration new create_media_library
```

Put this schema in the newly generated file:

```sql
create table public.media_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80 and name = btrim(name)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index media_folders_owner_name_key
  on public.media_folders (owner_id, lower(name));

create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.media_folders(id) on delete set null,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  alt_text text check (alt_text is null or char_length(alt_text) <= 300),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index media_items_owner_created_idx on public.media_items (owner_id, created_at desc);
create index media_items_owner_folder_idx on public.media_items (owner_id, folder_id);

create or replace function public.set_media_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger media_folders_set_updated_at
before update on public.media_folders
for each row execute function public.set_media_updated_at();

create trigger media_items_set_updated_at
before update on public.media_items
for each row execute function public.set_media_updated_at();

alter table public.media_folders enable row level security;
alter table public.media_items enable row level security;

create policy "Owners can select media folders" on public.media_folders
for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can insert media folders" on public.media_folders
for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update media folders" on public.media_folders
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy "Owners can delete media folders" on public.media_folders
for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "Owners can select media items" on public.media_items
for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can insert media items" on public.media_items
for insert to authenticated with check (
  (select auth.uid()) = owner_id
  and (
    folder_id is null
    or exists (
      select 1 from public.media_folders
      where media_folders.id = folder_id
        and media_folders.owner_id = (select auth.uid())
    )
  )
);
create policy "Owners can update media items" on public.media_items
for update to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and (
    folder_id is null
    or exists (
      select 1 from public.media_folders
      where media_folders.id = folder_id
        and media_folders.owner_id = (select auth.uid())
    )
  )
);
create policy "Owners can delete media items" on public.media_items
for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.media_folders to authenticated;
grant select, insert, update, delete on public.media_items to authenticated;
revoke all on public.media_folders from anon;
revoke all on public.media_items from anon;

drop policy if exists "Public can read blog media" on storage.objects;
create policy "Owners can list their blog media" on storage.objects
for select to authenticated
using (
  bucket_id = 'blog-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
```

- [ ] **Step 3: Apply the migration without deleting local data**

Apply pending migrations to the running local Supabase development database and lint the resulting schema:

```bash
rtk npx supabase migration up --local
rtk npx supabase migration list --local
rtk npx supabase db lint --local
```

Expected: all three migrations appear as applied and lint reports no schema errors. Do not use `db reset`; local content may belong to the user.

- [ ] **Step 4: Add strict media types and database table mappings**

Add the shared interfaces from this plan to `src/types/cms.ts`. Extend `Database['public']['Tables']` with `media_folders` and `media_items`, including distinct `Row`, `Insert`, and `Update` shapes. Reuse `SupportedImageType` for `mime_type`; do not cast query results through `unknown`.

- [ ] **Step 5: Make installer readiness detect stale schemas**

Extend the `Promise.all` in `getInstallationReadiness()` with head-only queries for both new tables. Set `readiness.migration` true only when posts, settings, folders, and items all succeed. Log each non-missing-table failure with its table name.

- [ ] **Step 6: Run the RLS test and type check**

```bash
rtk npm run test:e2e -- tests/e2e/media-rls.spec.ts --project=desktop
rtk npm run check
```

Expected: PASS; owner B cannot see or mutate owner A's metadata or list owner A's path.

- [ ] **Step 7: Commit the secure persistence slice**

```bash
rtk git add supabase/migrations src/types/cms.ts src/lib/installation.ts tests/e2e/media-rls.spec.ts
rtk git commit -m "feat: add owner scoped media metadata"
```

---

### Task 3: Build direct upload and the basic Media Library

**Files:**

- Modify: `src/lib/media.ts`
- Create: `src/lib/media-client.ts`
- Modify: `src/components/admin/ImageUploader.ts`
- Create: `src/components/admin/MediaLibrary.tsx`
- Create: `src/pages/admin/media.astro`
- Modify: `src/layouts/AdminLayout.astro`
- Modify: `src/styles/global.css`
- Create: `tests/e2e/media-library.spec.ts`

**Consumes:** Media schema/types; existing browser Supabase client; `blog-media` public bucket.

**Produces:** Owner-only image upload/list/search UI at `/admin/media`; `uploadImage(file, options)` returning `MediaAsset`.

- [ ] **Step 1: Write the failing upload/browse test**

Use valid in-memory fixtures for JPEG, PNG, WebP, AVIF, and GIF. Upload each, then assert the card shows its name, dimensions, format, and size. Reject SVG, empty, oversized, and undecodable fixtures before an object appears. Intercept the metadata insert once with a failing response and verify the compensating Storage removal leaves no object. Use the mobile project to assert `document.documentElement.scrollWidth === window.innerWidth`.

Key assertions:

```ts
await page.getByLabel('Upload image').setInputFiles({
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr0sAAAAASUVORK5CYII=', 'base64'),
  mimeType: 'image/png',
  name: 'pixel.png',
});
await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();
await expect(page.getByText('1 × 1')).toBeVisible();
```

Run:

```bash
rtk npm run test:e2e -- tests/e2e/media-library.spec.ts --project=desktop
```

Expected: FAIL because `/admin/media` does not exist.

- [ ] **Step 2: Centralize image validation and decode**

In `src/lib/media.ts`, keep the existing 8 MB constant and MIME map, then add:

```ts
export const ACCEPTED_IMAGE_TYPES = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export async function imageDimensions(file: File): Promise<{ height: number; width: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('The image has no readable dimensions.');
    return { height: image.naturalHeight, width: image.naturalWidth };
  } catch {
    throw new Error('This image cannot be decoded. Choose a valid image file.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
```

Keep one `validateImageFile(file)` function as the trust-boundary check for empty files, MIME allowlist, and 8 MB limit. Both editor and Media Library must call it.

- [ ] **Step 3: Implement the direct media client**

In `src/lib/media-client.ts`, implement the shared functions exactly once. Build public URLs with the existing Supabase Storage client:

```ts
export function publicMediaUrl(storagePath: string) {
  return createBrowserSupabaseClient().storage.from('blog-media').getPublicUrl(storagePath).data.publicUrl;
}

function toAsset(item: MediaItem): MediaAsset {
  return { ...item, publicUrl: publicMediaUrl(item.storage_path) };
}
```

For `listMedia`, fetch `MEDIA_PAGE_SIZE + 1` rows, newest first, select a range derived from the one-based page, and apply `folder_id IS NULL` for Unsorted. Normalize search before `.or()` with:

```ts
const searchTerm = input.search
  ?.trim()
  .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .slice(0, 100);
```

Skip the filter when the result is empty; otherwise search `original_name` and `alt_text` with `ilike`. Return the first 48 rows and a `hasMore` flag.

- [ ] **Step 4: Upgrade the single upload path with compensation**

Change `uploadImage` to:

```ts
export async function uploadImage(file: File, options: UploadImageOptions = {}): Promise<MediaAsset> {
  validateImageFile(file);
  const dimensions = await imageDimensions(file);
  const supabase = createBrowserSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error('Sign in before uploading images.');

  const storagePath = `${userData.user.id}/${crypto.randomUUID()}.${imageExtension(file.type)}`;
  const { error: uploadError } = await supabase.storage.from('blog-media').upload(storagePath, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data, error: metadataError } = await supabase.from('media_items').insert({
    alt_text: options.altText?.trim() || null,
    folder_id: options.folderId ?? null,
    height: dimensions.height,
    mime_type: file.type as SupportedImageType,
    original_name: file.name,
    owner_id: userData.user.id,
    size_bytes: file.size,
    storage_path: storagePath,
    width: dimensions.width,
  }).select('*').single();

  if (metadataError) {
    const { error: cleanupError } = await supabase.storage.from('blog-media').remove([storagePath]);
    if (cleanupError) throw new Error(`${metadataError.message} Cleanup also failed: ${cleanupError.message}`);
    throw metadataError;
  }

  return { ...data, publicUrl: publicMediaUrl(data.storage_path) };
}
```

Keep Novel's `uploadFn` adapter, but return `asset.publicUrl` from the new result.

- [ ] **Step 5: Add the authenticated page and minimal complete UI states**

`src/pages/admin/media.astro` authenticates exactly like `admin/new.astro`; unauthenticated users redirect to `/admin`. Mount:

```astro
<MediaLibrary client:only="react" mode="manage" />
```

`MediaLibrary` must implement loading, error with Retry, empty, uploading, and populated states from the first commit. Use a native hidden `<input type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp">`, an explicit label, a 48-item page, and a Load more button. Search is a controlled input with a 250 ms timer; clear the timer on unmount.

Add `Media` to `AdminLayout.astro` beside `Posts`. Preserve `View site` with `target="_blank" rel="noreferrer"`.

- [ ] **Step 6: Style by reusing current Admin tokens**

Add only media-specific selectors to `src/styles/global.css`: `.media-shell`, `.media-toolbar`, `.media-grid`, `.media-card`, `.media-empty`, and `.media-status`. Use CSS Grid with `repeat(auto-fill, minmax(min(11rem, 100%), 1fr))`; do not create a second color/token system.

- [ ] **Step 7: Verify upload and responsive behavior**

```bash
rtk npm run test:e2e -- tests/e2e/media-library.spec.ts
rtk npm run check
```

Expected: valid upload appears once, invalid files leave no card, loading/error/empty states are reachable, and mobile has no horizontal overflow.

- [ ] **Step 8: Commit the browse/upload slice**

```bash
rtk git add src/lib/media.ts src/lib/media-client.ts src/components/admin/ImageUploader.ts src/components/admin/MediaLibrary.tsx src/pages/admin/media.astro src/layouts/AdminLayout.astro src/styles/global.css tests/e2e/media-library.spec.ts
rtk git commit -m "feat: add admin media library"
```

---

### Task 4: Add categories and media metadata actions

**Files:**

- Modify: `src/lib/media-client.ts`
- Modify: `src/components/admin/MediaLibrary.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/media-library.spec.ts`

**Consumes:** Basic Media Library and RLS-protected tables.

**Produces:** All/Unsorted views, one-level category CRUD, move, alt-text edit, URL copy, and accessible details.

- [ ] **Step 1: Extend the test with failing category and metadata flows**

Cover these transitions in one serial flow:

1. Create `Headers` and reject a duplicate name inline without clearing the input.
2. Upload an image into `Headers`.
3. Rename `Headers` to `Covers`.
4. Edit alt text and verify it survives reload.
5. Move the image to Unsorted.
6. Delete `Covers` and confirm the image remains in All media and Unsorted.
7. Search by filename and alt text.
8. Copy URL from a secure-context test page or assert the fallback-selected text when Clipboard permission is unavailable.

Run the focused test and see it fail on the first missing category control.

- [ ] **Step 2: Implement category operations with existing RLS**

Add the shared category functions to `media-client.ts`. Every mutation must call `auth.getUser()`, include `owner_id` on inserts, and include `.eq('owner_id', user.id)` on update/delete even though RLS also enforces ownership. Map PostgreSQL unique violation `23505` to `A category with this name already exists.`.

- [ ] **Step 3: Add desktop rail and mobile selector**

Render `All media`, `Unsorted`, and owner categories from the same state. Use a semantic `<nav aria-label="Media categories">` on desktop and a native `<select aria-label="Media category">` below 768 px. Selection resets pagination to page 1.

Create, rename, and delete use compact inline forms. Category deletion uses a native confirmation dialog and explains that images move to Unsorted. The database foreign key performs that move; do not loop over items in JavaScript.

- [ ] **Step 4: Add a single details panel**

Selecting a card opens one details panel/dialog containing preview, escaped filename, dimensions, MIME label, formatted byte size, category select, alt-text field capped at 300, copy URL, and Save. Keep unsaved values when a request fails. Use one state shape:

```ts
interface MediaDraft {
  altText: string;
  folderId: string;
}
```

- [ ] **Step 5: Verify and commit**

```bash
rtk npm run test:e2e -- tests/e2e/media-library.spec.ts
rtk npm run check
rtk git add src/lib/media-client.ts src/components/admin/MediaLibrary.tsx src/styles/global.css tests/e2e/media-library.spec.ts
rtk git commit -m "feat: organize media with categories"
```

---

### Task 5: Block deletion of media that posts still use

**Files:**

- Create: `src/pages/api/media/[id].ts`
- Modify: `src/components/admin/MediaLibrary.tsx`
- Create: `tests/e2e/media-deletion.spec.ts`

**Consumes:** Authenticated server Supabase client; media item URL; owner posts.

**Produces:** Owner-scoped deletion with `401`, `404`, `409`, and safe success behavior.

- [ ] **Step 1: Write failing API and UI deletion tests**

Test four cases: unauthenticated returns `401`; another owner's ID returns `404`; an unused image removes metadata and object; a cover/content reference returns `409` with post title and leaves both intact.

Expected conflict shape:

```json
{
  "error": "This image is used by 1 post.",
  "posts": [{ "id": "post-id", "title": "Referenced post" }]
}
```

- [ ] **Step 2: Implement the smallest safe deletion endpoint**

In `src/pages/api/media/[id].ts`:

1. Authenticate with `authenticate(cookies, request)`.
2. Select the item by `id` and `owner_id`; return `404` for no row.
3. Derive its public URL from `storage_path` server-side.
4. Select only `id`, `title`, `cover_image`, and `content_html` from the owner's posts.
5. Filter exact cover matches and HTML string occurrences in process.
6. Return `409` with referencing titles when found.
7. Remove the Storage object, then delete the metadata row by both `id` and `owner_id`.
8. Return `{ "deleted": true }`.

Add this deliberate ceiling at the scan:

```ts
// ponytail: scans one owner's posts; add a media_usage table only when measured post volume makes this slow.
```

Validate `id` with `z.string().uuid()`. Wrap the handler in `try/catch`; log the internal error and return a non-sensitive `500` message.

- [ ] **Step 3: Wire confirmation and conflict recovery into Media Library**

Disable Delete while the request runs. On `409`, keep the image and show the returned post titles as links to `/admin/edit/:id`. On success, remove the item from local state without refetching the entire page. On other failures, leave the item selected and expose Retry.

- [ ] **Step 4: Verify and commit**

```bash
rtk npm run test:e2e -- tests/e2e/media-deletion.spec.ts --project=desktop
rtk npm run check
rtk git add 'src/pages/api/media/[id].ts' src/components/admin/MediaLibrary.tsx tests/e2e/media-deletion.spec.ts
rtk git commit -m "feat: prevent deleting media in use"
```

---

### Task 6: Reuse the library for cover images

**Files:**

- Create: `src/components/admin/MediaPicker.tsx`
- Modify: `src/components/admin/MediaLibrary.tsx`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/lib/media.ts`
- Modify: `src/styles/global.css`
- Create: `tests/e2e/editor-media.spec.ts`

**Consumes:** Media Library selection mode and `MediaAsset`.

**Produces:** Choose-from-library and upload-new cover flow with visible guidance and non-blocking low-resolution warning.

- [ ] **Step 1: Write the failing cover picker test**

Sign in, seed one media row/object, open `/admin/new`, click `Choose from library`, select the seeded image, and assert the preview and hidden cover value use its public URL. Upload a 1 × 1 cover and assert the recommendation warning is visible but Save remains enabled.

- [ ] **Step 2: Give Media Library a selection mode without duplicating it**

Use a discriminated prop type:

```ts
type MediaLibraryProps =
  | { mode: 'manage' }
  | { mode: 'select'; onCancel: () => void; onSelect: (asset: MediaAsset) => void };
```

Selection mode hides destructive category/image controls, keeps browse/search/upload, and changes each card's primary action to Select.

- [ ] **Step 3: Build an accessible picker shell**

`MediaPicker` renders only while open, uses `<dialog>` where supported, labels the dialog `Media library`, traps focus through the native dialog behavior, closes on Escape/Cancel, and returns one `MediaAsset`. On screens below 768 px it fills the viewport through CSS rather than a separate component.

- [ ] **Step 4: Replace the cover upload-only control**

In `Editor.tsx`, keep `coverImage` as the saved URL and add `coverAsset` only for current-session dimensions. Render `Choose from library`, `Upload new`, preview/remove, and this exact guidance from shared constants:

```ts
export const COVER_IMAGE_GUIDANCE = {
  hardLimitBytes: MAX_IMAGE_BYTES,
  recommendedHeight: 900,
  recommendedMaxBytes: 2 * 1024 * 1024,
  recommendedMinHeight: 675,
  recommendedMinWidth: 1200,
  recommendedWidth: 1600,
} as const;
```

Show the warning when `asset.width < 1200 || asset.height < 675`. Do not block selection.

- [ ] **Step 5: Verify and commit**

```bash
rtk npm run test:e2e -- tests/e2e/editor-media.spec.ts --project=desktop --grep "cover"
rtk npm run check
rtk git add src/components/admin/MediaPicker.tsx src/components/admin/MediaLibrary.tsx src/components/admin/Editor.tsx src/lib/media.ts src/styles/global.css tests/e2e/editor-media.spec.ts
rtk git commit -m "feat: choose cover images from media"
```

---

### Task 7: Add the active-block insertion menu and inline image picker

**Files:**

- Create: `src/components/admin/BlockInsertMenu.tsx`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/editor-media.spec.ts`

**Consumes:** Novel editor context; Media Picker; current SlashCommands and FormattingBubble.

**Produces:** Keyboard-accessible `+` menu for paragraph, headings, bullet list, quote, code, and existing media.

- [ ] **Step 1: Extend the editor test and see it fail**

Cover pointer and keyboard behavior:

- Focus an empty paragraph and see `Add block`.
- Open it and choose Heading 2; assert the active node becomes `h2`.
- Reopen, choose Image, select a library asset, and assert one editor `<img>` uses its URL and alt text.
- Escape closes both menus and returns focus to the editor.
- Typing `/` still opens the existing slash palette.
- Selecting text still opens the existing formatting bubble.
- Mobile has no horizontal overflow.

- [ ] **Step 2: Implement one context-aware component**

`BlockInsertMenu.tsx` calls `useEditor()` and subscribes to editor focus, blur, selection, and transaction updates. Show the `+` only when the editor is focused, editable, and the selection is collapsed. Position with `editor.view.coordsAtPos(editor.state.selection.from)` relative to the nearest `.editor-canvas`; clamp the x-coordinate inside the canvas on narrow screens.

Use this command table rather than one component per command:

```ts
const blockActions = [
  { label: 'Text', run: () => editor.chain().focus().setParagraph().run() },
  { label: 'Heading 1', run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: 'Heading 2', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'Heading 3', run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run() },
  { label: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run() },
  { label: 'Code block', run: () => editor.chain().focus().toggleCodeBlock().run() },
] as const;
```

The menu button uses `aria-haspopup="menu"` and `aria-expanded`; items use `role="menuitem"`. Arrow keys move through items, Enter activates, Escape closes and focuses the editor. Respect `prefers-reduced-motion` in CSS.

- [ ] **Step 3: Insert selected media at the saved cursor**

Before opening Media Picker, save `editor.state.selection.from`. On selection, restore focus and insert:

```ts
editor
  .chain()
  .focus()
  .setTextSelection(savedPosition)
  .setImage({ alt: asset.alt_text || asset.original_name, src: asset.publicUrl })
  .run();
```

Clamp `savedPosition` to `editor.state.doc.content.size` if the document changed while the picker was open. A picker failure must not mutate editor content.

- [ ] **Step 4: Mount beside existing Novel tools**

Inside the existing `EditorContent` children, keep `SlashCommands` and `FormattingBubble`, then add `BlockInsertMenu`. Do not replace the slash palette or selection bubble.

- [ ] **Step 5: Verify and commit**

```bash
rtk npm run test:e2e -- tests/e2e/editor-media.spec.ts
rtk npm run check
rtk git add src/components/admin/BlockInsertMenu.tsx src/components/admin/Editor.tsx src/styles/global.css tests/e2e/editor-media.spec.ts
rtk git commit -m "feat: add active block insertion menu"
```

---

### Task 8: Harden deployment docs and zero-JavaScript regression

**Files:**

- Create: `tests/e2e/public-blog.spec.ts`
- Modify: `tests/e2e/media-library.spec.ts`
- Modify: `README.md`
- Modify: `src/pages/api/upload.ts`

**Consumes:** Completed media feature; existing local macOS helper and VPS instructions.

**Produces:** Documented operator workflow, a retired orphan-producing legacy upload path, and public route regression evidence.

- [ ] **Step 1: Retire the unused legacy upload endpoint**

Search all callers:

```bash
rtk rg -n "api/upload|uploadImage|uploadFn" src tests README.md
```

The current code has no caller for `/api/upload`, and its success path would create a Storage object without a `media_items` row. Keep the route as an explicit compatibility response instead of silently producing invisible media:

```ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async () => Response.json(
  { error: 'This upload endpoint has been retired. Use the authenticated Media Library.' },
  { status: 410 },
);
```

Add an endpoint assertion to `media-library.spec.ts` so this contract cannot regress into an orphan-producing upload.

- [ ] **Step 2: Add the public-route JavaScript guard**

Create and publish a test post, visit `/blog/:slug` with JavaScript disabled, and assert its sanitized content renders. Then inspect the HTML response and assert it has no module script or Astro island markers:

```ts
expect(html).not.toMatch(/<script[^>]+type=["']module["']/i);
expect(html).not.toContain('astro-island');
expect(html).toContain('Public media regression');
```

- [ ] **Step 3: Update the README**

Add concise sections covering:

- Media Library route and image-only v1 scope.
- Accepted formats and 8 MB hard limit.
- Cover recommendation: 1600 × 900, minimum 1200 × 675, target at or below 2 MB.
- Local prerequisite: Docker Desktop running, then `npm run dev:macos`; migration application remains automatic through the helper.
- Focused verification: `npm run test:e2e:media` after local Supabase is ready.
- Production: apply migrations before app restart; back up Postgres metadata and Storage objects separately.
- Self-hosting: keep Supabase Storage; external S3-compatible storage is an operator configuration, and TomeCMS adds no MinIO container or S3 browser credentials.

- [ ] **Step 4: Run the full verification matrix**

Stop any manually running Astro server before checks so Vite's optimize cache is not invalidated underneath it. Then run:

```bash
rtk npm run check
rtk npm run build
rtk npm run test:e2e:media
rtk git diff --check
rtk git status --short
```

Manually verify Admin widths 320, 375, 414, 768, 1280, and 1440 CSS pixels. Confirm no horizontal overflow, visible focus, Escape dismissal, loading/error/empty states, and reduced-motion behavior.

- [ ] **Step 5: Commit only final hardening files**

```bash
rtk git add README.md tests/e2e/public-blog.spec.ts tests/e2e/media-library.spec.ts src/pages/api/upload.ts
rtk git commit -m "docs: add media operations and regression checks"
```

- [ ] **Step 6: Final scope audit**

Run:

```bash
rtk git log --oneline -8
rtk rg -n "SUPABASE_SERVICE_ROLE_KEY|S3_ACCESS|MINIO" src
rtk rg -n "client:" src/pages/blog src/components/blog
```

Expected: service role appears only in server modules, no S3/MinIO client configuration exists, and public blog files contain no hydration directive.

## Completion Criteria

- The migration applies cleanly and two-owner RLS tests pass.
- Every accepted image format is validated; empty, oversized, SVG, and undecodable input is rejected before upload.
- A metadata insert failure triggers object cleanup.
- Media browse/search/pagination and category create/rename/move/delete-to-Unsorted work on desktop and mobile.
- Unused media deletion succeeds; referenced media returns `409` and remains intact.
- Cover selection and inline insertion reuse the same Media Picker and upload path.
- `+`, slash, and formatting controls coexist with pointer and keyboard support.
- `npm run check`, `npm run build`, and `npm run test:e2e:media` pass.
- Public blog HTML still contains neither an Astro island nor a module script.
- No unrelated pre-existing working-tree change is included in any task commit.
