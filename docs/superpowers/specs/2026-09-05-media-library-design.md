# TomeCMS Media Library and Editor Insertion Design

Date: 2026-09-05  
Status: Approved direction, awaiting written-spec review

## Context

TomeCMS already uses Supabase Postgres, Auth, Row Level Security (RLS), and the public `blog-media` Storage bucket. The editor supports slash commands, selection formatting, pasted images, dropped images, and direct browser uploads. This design extends those working paths instead of replacing them.

The deployment architecture remains Supabase-compatible. Local development uses the Supabase CLI stack in Docker. Production may use managed Supabase or the official self-hosted Supabase Docker stack. TomeCMS continues to call the Supabase Storage API, so a self-hosted operator can later move the Storage backend from the local filesystem to an external S3-compatible provider without changing the editor.

## Goals

- Make block insertion discoverable while writing, without removing the existing `/` command palette.
- Provide a reusable image library for post content and cover images.
- Let an owner create one-level image categories and move images between them.
- Give clear cover-image format, dimension, and file-size guidance.
- Keep all media mutations owner-scoped through Supabase Auth and RLS.
- Preserve the public blog's zero-JavaScript rendering path.

## Non-goals for v1

- Video, audio, PDF, SVG, or arbitrary document uploads.
- Nested folders, tags, bulk editing, image cropping, or image transformations.
- Direct use of S3 access keys in the browser or an AWS SDK dependency.
- A separate MinIO service in TomeCMS's Docker deployment.
- Storage versioning, a recycle bin, or cross-owner media sharing.

## Chosen Architecture

### Database metadata

Add two public-schema tables through a Supabase-generated migration.

`media_folders` stores one-level user-created categories:

- `id uuid` primary key.
- `name text` required, trimmed, 1–80 characters.
- `owner_id uuid` required, referencing `auth.users(id)` with cascade delete.
- `created_at` and `updated_at` timestamps.
- A case-insensitive unique index on `(owner_id, lower(name))`.

`media_items` stores the CMS metadata that the object store does not model:

- `id uuid` primary key.
- `folder_id uuid` nullable, referencing `media_folders(id)` with `on delete set null`.
- `storage_path text` required and unique.
- `original_name text`, `mime_type text`, `size_bytes bigint`, `width integer`, and `height integer`.
- `alt_text text` nullable, capped at 300 characters.
- `owner_id uuid` required, referencing `auth.users(id)` with cascade delete.
- `created_at` and `updated_at` timestamps.

Indexes cover `(owner_id, created_at desc)` and `(owner_id, folder_id)`. Both tables enable RLS. Authenticated users can select, insert, update, and delete only rows whose `owner_id` equals `auth.uid()`. Folder assignment is validated so an item cannot reference another owner's folder. The migration explicitly grants the required table privileges to `authenticated`; RLS remains the authorization boundary.

### Storage model

Keep the existing public `blog-media` bucket with its 8 MB limit and image-only MIME allowlist. Object paths remain stable and independent from categories:

```text
<owner-id>/<random-uuid>.<extension>
```

Categories live in `media_items.folder_id`, not in object paths. Renaming or moving a category therefore requires only a database update and never moves the object or changes URLs already embedded in posts.

Public bucket URLs remain readable by blog visitors. Storage listing and mutations remain owner-scoped. The existing broad `SELECT` policy on `storage.objects` will be replaced with an authenticated owner-only listing policy; public object delivery continues through the bucket's public URL.

Supabase Storage's S3 endpoint and its physical S3 backend are separate concerns. TomeCMS will use neither S3 credentials nor a vendor-specific client. A self-hosted operator can configure Supabase Storage to use AWS S3, Cloudflare R2, RustFS, or another compatible backend later. Current Supabase guidance recommends RustFS rather than a new MinIO deployment because MinIO no longer publishes or maintains its former open-source Docker distribution.

## Upload and Mutation Flow

1. The browser verifies authentication and validates the selected file.
2. Accepted formats are JPEG, PNG, WebP, AVIF, and GIF; SVG is rejected.
3. The hard file-size limit is 8 MB. The browser also decodes the image to confirm it is readable and records its intrinsic dimensions.
4. The browser uploads directly to the owner's path in `blog-media` with `upsert: false`.
5. After Storage succeeds, it inserts the `media_items` record through the authenticated Supabase client.
6. If metadata insertion fails, it removes the newly uploaded object as compensation and reports the error.
7. Moving an image changes only `folder_id`. Renaming a category changes only `media_folders.name`.
8. Deleting a category sets its images to `Unsorted`; it does not delete objects.
9. Before deleting an image, an authenticated server endpoint checks the owner's posts for the image URL in `cover_image` or `content_html`. Deletion is blocked when the image is in use. Otherwise, the object and metadata row are removed and a clear error is returned if either operation fails.

No service-role key is exposed to client code. S3 access keys are not introduced.

## Admin Media Library

Add `Media` to the Admin navigation and create `/admin/media` as an authenticated page with a React island.

The desktop layout uses a compact category rail and an image grid. Mobile uses a category selector above the grid. The screen includes:

- `All media` and `Unsorted` system views.
- User-created categories with create, rename, and delete actions.
- Single-image upload with visible loading, success, and failure states.
- Search by original filename or alt text.
- Paginated loading in groups of 48, newest first.
- Image preview with filename, dimensions, format, size, category, and alt text.
- Actions to edit alt text, move category, copy URL, select the image, or delete it when unused.

Category deletion requires confirmation because it changes organization, but it never deletes files. Image deletion requires confirmation and remains unavailable while usage validation is pending or when the image is referenced by a post.

## Editor Integration

Keep all current editor interactions and add a discoverable block insertion control:

- A `+` button appears beside the active block when the editor has focus and the selection is collapsed.
- Activating it opens a keyboard-accessible menu for paragraph, H1, H2, H3, bullet list, quote, code block, and image.
- Choosing `Image` opens the shared Media Picker. The writer may select an existing image or upload a new one.
- Selecting an image inserts the Tiptap image node at the current cursor position and returns focus to the editor.
- The existing slash command palette remains available for keyboard-first writers.
- The existing formatting bubble remains available when text is selected.

On narrow screens the insertion menu is anchored within the editor instead of outside the page edge. It never causes horizontal scrolling and supports keyboard focus, Escape dismissal, and reduced motion.

## Cover Image Experience

Replace the single upload control with two actions: `Choose from library` and `Upload new`. Both resolve to a `media_items` image and set its public URL as the post cover.

The UI displays these guidelines directly below the field:

- Recommended canvas: 1600 × 900 px, 16:9.
- Recommended minimum: 1200 × 675 px.
- Best delivery formats: WebP or JPEG; PNG and AVIF are also supported.
- GIF is accepted but discouraged for covers, especially when animated.
- Aim for 2 MB or less; the hard limit is 8 MB.

Images below the recommended minimum remain selectable but show a non-blocking warning. Invalid formats, empty files, undecodable images, and files over 8 MB are rejected before upload.

## Components and Boundaries

- `MediaLibrary`: owns browsing, filtering, category management, and media actions on `/admin/media`.
- `MediaPicker`: shared dialog/drawer used by inline image insertion and cover selection.
- `BlockInsertMenu`: owns the active-block `+` trigger and Tiptap block commands.
- `ImageUploader`: remains the single browser upload path and returns a complete `MediaItem` instead of only a URL.
- Media API route: owns usage validation and coordinated deletion only; regular reads and uploads continue through authenticated Supabase clients and RLS.
- Editor: coordinates picker results with either the current Tiptap selection or the cover-image field; it does not implement storage rules itself.

The existing `Editor.tsx` should be split only where these boundaries reduce responsibility. No generic storage-provider interface or speculative backend abstraction is added.

## Error Handling

- Every asynchronous screen has explicit loading, empty, error, and retry states.
- Upload validation errors identify the rejected format, size, or decode failure.
- A failed upload creates no metadata row.
- A failed metadata insert triggers best-effort object cleanup and reports whether cleanup also failed.
- Category name conflicts are shown inline without losing the typed name.
- A failed category deletion leaves both the category and its items unchanged.
- An in-use image deletion returns `409 Conflict` with the referencing post titles.
- Authentication failures return `401`; ownership failures return `404` so another owner's media identity is not disclosed.
- The editor retains unsaved content when the picker or upload fails.

## Security

- The browser receives only the public Supabase URL and anon/publishable key.
- The service-role key remains server-only and is not needed for normal media operations.
- RLS checks ownership on both metadata tables and Storage paths.
- Update policies include both `using` and `with check` predicates.
- Storage object replacement remains disabled; random immutable paths prevent cache poisoning and accidental overwrite.
- SVG and arbitrary HTML-bearing media are not accepted.
- Public retrieval does not imply public bucket listing.
- User-provided filenames and alt text are escaped by React and never interpolated into SQL.

## Deployment

No MinIO container is added to TomeCMS. Local development continues to use the Supabase CLI Storage filesystem backend. Production supports either managed Supabase or the official self-hosted Supabase Docker stack. A self-hosted operator may later configure Supabase Storage with an external S3-compatible backend without any TomeCMS application change.

The production runbook must back up Postgres metadata and stored objects separately. Supabase's local CLI stack remains development-only and must not be exposed as a production deployment.

## Verification

- Run Astro and TypeScript checks with zero diagnostics.
- Apply the generated migration to a clean local Supabase stack and verify the migration list.
- Verify RLS with two authenticated users: each user can see and mutate only their own folders, metadata, and Storage listing.
- Upload every supported format plus rejected SVG, oversized, empty, and undecodable fixtures.
- Verify compensation removes an object when metadata insertion fails.
- Verify category create, rename, move, and delete-to-Unsorted behavior.
- Verify unused media deletion succeeds and in-use deletion returns `409` without removing the object.
- Verify the `+` menu, slash palette, formatting bubble, Media Picker, inline insertion, and cover selection with keyboard and pointer input.
- Render-check Admin at 320, 375, 414, 768, 1280, and 1440 CSS pixels with no horizontal overflow.
- Confirm public blog pages still ship no application JavaScript.

## Delivery Order

1. Database schema, RLS, TypeScript types, and reusable upload behavior.
2. Media Library page and category operations.
3. Shared Media Picker and cover-image guidance.
4. Active-block insertion menu and inline editor integration.
5. End-to-end security, responsive, and public-route regression verification.

## References

- [Supabase: Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase: Configure S3 Storage](https://supabase.com/docs/guides/self-hosting/self-hosted-s3)
- [Supabase: Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase: Standard Uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Supabase: Storage Limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
