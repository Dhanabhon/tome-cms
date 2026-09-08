# TomeCMS Post Categories Design

Date: 2026-09-08
Status: Approved

## Context

TomeCMS is a single-owner Astro CMS backed by Supabase Auth, Postgres, Row Level Security (RLS), and Storage. A logical Post may have Thai and English editions linked by `translation_group_id`. The Admin already has a focused Post editor, a Posts list, and server-rendered public article and homepage routes.

This design adds reusable Post Categories without adding a general tagging system or a public archive subsystem. One Post may belong to several Categories. Category membership belongs to the logical translation group, so Thai and English editions always share the same Categories.

## Product Decisions

- A Post may belong to multiple Categories.
- Thai and English editions in the same translation group always share Category membership.
- Every Post translation group has at least one Category.
- `Uncategorized` is the immutable system fallback and cannot be renamed or deleted.
- Selecting one or more custom Categories removes `Uncategorized`; removing every custom Category restores it.
- Categories use one shared name across both public languages.
- Category names are unique per owner without regard to letter case.
- Category management lives at `/admin/categories`, reached through `Manage categories` actions on the Posts list and Post editor. It is not another primary Admin navigation item.
- Public category badges appear on article pages and homepage article entries.
- Public badges are plain labels in this release; they do not link to Category archives.

## Goals

- Let the owner create, rename, and delete custom Categories.
- Let the owner assign several Categories while writing a Post.
- Keep membership synchronized automatically across translated editions.
- Safely return an orphaned Post to `Uncategorized` when a custom Category is deleted.
- Backfill existing installations without losing or changing Post content.
- Preserve zero-JavaScript public rendering.

## Non-goals

- Category archive routes, filtering, pagination, feeds, or sitemap entries.
- Category slugs, descriptions, cover images, hierarchy, or ordering controls.
- Tags or free-form taxonomy.
- Per-language Category names or translated Category records.
- Categories for Pages, Navigation, or File Library items.
- Bulk Category assignment from the Posts list.
- A new top-level Admin navigation item.

## Information Architecture

Add these authenticated routes:

| Route | Purpose |
| --- | --- |
| `/admin/categories` | Create, rename, and delete custom Categories |
| `/api/categories` | Authenticated Category list and CRUD operations |
| `/api/posts/categories` | Replace Category membership for one owned Post translation group |

The Posts list and Post settings drawer link to `/admin/categories`. The Category manager uses the existing Admin shell. Post new, edit, and preview routes retain their focused layouts.

## Category Data Model

Create `public.categories`:

- `id uuid primary key default gen_random_uuid()`.
- `owner_id uuid not null references auth.users(id) on delete cascade`.
- `name text not null`, trimmed and limited to 80 characters.
- `is_default boolean not null default false`.
- `created_at` and `updated_at` timestamps.

Constraints and indexes enforce:

- Unique `(id, owner_id)` for composite ownership references.
- Case-insensitive unique names per owner using `owner_id` and `lower(name)`.
- At most one default Category per owner using a partial unique index.
- A protected default row: database triggers reject renaming, deleting, or clearing `is_default` on `Uncategorized`.

Create `public.post_category_assignments`:

- `translation_group_id uuid not null`.
- `category_id uuid not null`.
- `owner_id uuid not null`.
- `created_at timestamptz default now() not null`.
- Primary key `(translation_group_id, category_id)`.
- Composite foreign key `(translation_group_id, owner_id)` to `post_translation_groups(id, author_id)` with `on delete cascade`.
- Composite foreign key `(category_id, owner_id)` to `categories(id, owner_id)` with `on delete cascade`.

The assignment targets `post_translation_groups`, not individual Post rows. This makes Category membership identical for every language edition by construction and removes the need for application-side edition synchronization.

## Default Category Invariant

An internal database function creates `Uncategorized` idempotently for an owner. It runs when:

- The migration encounters an existing installed owner or existing Post translation group.
- A fresh installation inserts `site_settings`.
- A new `post_translation_groups` row is created.

Creating a translation group inserts its default assignment in the same transaction. Existing translation groups receive one `Uncategorized` assignment during migration. Rows whose author was already removed are not given a new owner or Category.

Authenticated clients cannot mutate assignment rows directly. Membership replacement and Category deletion use database functions so the at-least-one-Category invariant is never temporarily broken.

## Transactional Membership Replacement

Add a Postgres function that replaces membership for one translation group:

1. Requires `auth.uid()` and verifies ownership of the supplied Post or translation group.
2. Accepts at most 20 unique Category UUIDs.
3. Rejects missing or foreign Categories.
4. If any custom Categories are supplied, removes `Uncategorized` from the requested set.
5. If no custom Category remains, selects the owner's default Category.
6. Replaces the complete assignment set in one transaction.

The public HTTP endpoint accepts `{ postId, categoryIds }`, resolves the owned Post to its translation group on the server, validates the payload with Zod, and invokes the function. The browser never supplies an owner ID or translation group ID.

## Transactional Category Deletion

Deleting a custom Category uses a database function rather than a direct table delete:

1. Requires `auth.uid()` and verifies Category ownership.
2. Rejects deletion of `Uncategorized`.
3. Captures every affected translation group.
4. Deletes the Category and its assignments.
5. Assigns `Uncategorized` only to affected groups that no longer have another Category.

All steps commit or roll back together. A failure never leaves a translation group without a Category.

## RLS and Privileges

- Owners may list and mutate only their own Category rows.
- Owners may read assignments only for their own translation groups.
- Assignment inserts, updates, and deletes are revoked from direct authenticated Data API access; only the membership and deletion functions may mutate them.
- Anonymous clients may read only Category labels and assignments associated with at least one Published Post edition.
- Draft-only Category membership is not exposed publicly.
- Composite foreign keys prevent cross-owner assignments even when privileged server code is used incorrectly.

Database functions derive ownership from `auth.uid()`, set a fixed `search_path`, expose only the required execute grants, and do not accept an owner ID from the caller.

## Category API

`GET /api/categories` returns the owner's Categories in name order with the number of translation groups using each Category. `Uncategorized` is identified explicitly for the UI.

`POST /api/categories` accepts a trimmed `name` and creates a custom Category. `PUT /api/categories` accepts `{ id, name }` and renames an owned custom Category. `DELETE /api/categories` accepts an owned Category ID and calls the transactional deletion function.

Validation and responses:

- Empty or longer-than-80-character names return `400`.
- Duplicate names return `409` without exposing database details.
- Attempts to rename or delete `Uncategorized` return `409`.
- Missing or foreign Categories return `404`.
- Authentication failures return `401`.
- Unexpected failures return a generic `500`; provider details stay in server logs.

## Post Save Flow

Category membership is saved through `/api/posts/categories` rather than expanding the existing Post content payload:

1. The editor first completes the existing Post `POST` or `PUT` request.
2. Once a Post ID exists, it submits the selected Category IDs.
3. A newly created Post already has `Uncategorized` from the translation-group trigger, so a failed second request cannot create an uncategorized orphan or a duplicate draft.
4. The existing serialized save queue retains the dirty Category state and retries a failed membership update.

Creating a missing translation starts with the source translation group's existing membership automatically. No copy operation is required.

## Category Management Experience

`/admin/categories` contains:

- Page heading and a compact create form.
- `Uncategorized` pinned first with a `Default` indicator and no edit/delete actions.
- Custom Categories ordered alphabetically.
- Usage count based on logical translation groups, not language-edition rows.
- Inline rename with Save and Cancel.
- Delete confirmation naming the Category and explaining how many Posts are affected.
- Pending, success, failure, and retry feedback that does not rely on color alone.

The manager reuses existing Admin controls and dialog patterns. Create and rename preserve the typed value after recoverable errors. Delete updates the visible list only after the server confirms success.

## Post Editor Experience

Add a `Categories` fieldset to the existing Post settings drawer:

- Native checkboxes allow several custom Categories.
- A new Post begins with `Uncategorized` selected.
- Selecting the first custom Category clears `Uncategorized` in the UI.
- Clearing the final custom Category restores `Uncategorized` immediately.
- `Uncategorized` is read-only while custom Categories are selected.
- A `Manage categories` link opens `/admin/categories` in the same tab after the existing save-and-navigation guard runs.

Initial Category options and selected IDs are loaded server-side for edit and translation routes and passed to the React island. The editor's existing save status reports Category failures with the same retry behavior as content failures.

## Posts Admin Experience

The Posts list adds a `Manage categories` action near `New post`. Each Post group displays its Category badges without duplicating labels for Thai and English editions. Existing search, locale, status, publication, and deletion behavior remains unchanged.

No Category filter is added in this release. It becomes worthwhile only when a real content volume makes filtering necessary.

## Public Rendering

Server-only helpers load Category assignments for the translation group IDs already present in a Post query. They use one batched assignment query rather than one query per Post.

- Article pages render Category badges above the title metadata.
- The featured article and remaining article rows on `/<locale>` render the same labels.
- Labels are HTML-escaped Astro text and are never inserted through `set:html`.
- Badges have no links or client-side behavior.
- Public Post pages and the homepage ship no additional application JavaScript.

Public category lookup failure does not render incorrect labels. The route logs the provider detail, returns a generic server error state consistent with its existing Post-query behavior, and does not expose private diagnostics.

## Installer, Reset, and Migration

Add one forward-only migration containing the Category tables, constraints, indexes, triggers, RLS policies, grants, database functions, and existing-data backfill.

Fresh-install readiness checks include `categories` and `post_category_assignments`; an incomplete migration cannot report ready. The installation reset workflow deletes assignments before Posts, then Categories before the owner account. Dry-run output includes Category and assignment counts. Reinstallation recreates `Uncategorized` when the new `site_settings` row is inserted.

README documentation covers Category behavior, the immutable fallback, migration application, Admin route, public badges, and reset impact.

## Accessibility and Responsive Behavior

- Category options use a labelled `fieldset` and native checkboxes.
- Create, rename, Save, Cancel, and Delete controls have accessible names and keyboard focus states.
- Delete confirmation uses the existing accessible dialog and restores focus to its trigger.
- Dynamic save and error feedback uses live regions.
- Long Category names wrap without causing horizontal overflow at 320, 375, 414, 768, 1280, and 1440 CSS pixels.
- Public badges wrap across lines and retain readable contrast in the existing mint/teal design system.

## Verification

- Apply the migration to a clean local Supabase stack and an existing installation with Posts in both languages.
- Verify existing translation groups receive exactly one `Uncategorized` assignment.
- Verify a fresh installation and new Post group create the fallback idempotently.
- Verify two authenticated users cannot list, assign, rename, or delete each other's Categories.
- Reject duplicate names regardless of case or surrounding whitespace.
- Reject attempts to rename, delete, or clear the default Category through both HTTP and direct Data API paths.
- Assign several Categories and verify both language editions expose the identical set.
- Create a missing translation and verify it inherits membership without copying rows.
- Delete one of several Categories and preserve the others.
- Delete the only custom Category and verify fallback to `Uncategorized` in the same transaction.
- Force membership and deletion failures and verify the previous assignment set remains intact.
- Verify Category manager CRUD, focus restoration, pending states, recoverable errors, and mobile overflow.
- Verify editor checkbox behavior, serialized saving, retry behavior, and safe navigation with unsaved changes.
- Verify Admin Posts, homepage, article, and preview badges.
- Confirm public pages add no client-side application JavaScript.
- Run Astro and TypeScript checks, the production build, focused API/RLS/editor/public tests, and the full end-to-end suite.

## Delivery Order

1. Add Category schema, transactional functions, RLS, backfill, and strict TypeScript types.
2. Add Category and membership APIs with focused API/RLS tests.
3. Add Category manager and Post editor assignment flow.
4. Add Admin and public badges through one batched server helper.
5. Update installer readiness, reset workflow, README, and regression coverage.
