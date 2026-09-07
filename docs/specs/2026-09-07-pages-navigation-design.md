# TomeCMS Pages and Navigation Design

Date: 2026-09-07  
Status: Approved

## Context

TomeCMS is a single-owner Astro CMS backed by Supabase Auth, Postgres, Row Level Security (RLS), and Storage. It has independently published Thai and English post editions, a focused Novel/Tiptap editor, server-rendered public routes, and a static public header and footer.

This design adds WordPress-like Pages without turning TomeCMS into a general page builder. It also adds a focused Navigation manager for the two public menu locations TomeCMS actually has: Header and Footer. Posts remain an independent content type and the existing blog homepage remains unchanged.

## Product Decisions

- Pages support independent Thai and English editions linked as translations.
- Navigation targets are Home, Pages, or custom URLs. Posts are not menu targets in this release.
- Menus are flat. Nested items and dropdowns are deferred.
- Header and Footer are fixed locations with independent ordering.
- Thai and English menus are managed independently.
- A menu label initially copies the Page title but becomes independently editable for each location.
- The existing locale homepage remains the blog index. Pages do not become the homepage.
- Public Pages render title and content only, with SEO metadata but no cover, author block, or visible publication date.
- A Page item renders only when its exact locale edition is published. There is no cross-language fallback.
- Unpublishing a Page hides its saved menu items without deleting them. Republishing makes them visible again.
- Deleting a Page permanently removes its navigation references after confirmation.

## Goals

- Let the owner create, edit, preview, translate, publish, unpublish, and delete Pages.
- Reuse the existing editor behavior without coupling Page-only concerns to Post-only fields.
- Let the owner build independent Header and Footer menus for Thai and English.
- Support Home, Page, and custom URL navigation items with editable labels and deterministic ordering.
- Keep public Pages, Header, and Footer server-rendered without adding application JavaScript.
- Preserve the existing Blog, Media Library, Profile, Settings, installer, and authentication behavior.

## Non-goals

- Nested menus, dropdown menus, or unlimited menu trees.
- Named menu collections or assignable menu slots.
- Page templates, page-builder sections, or arbitrary layouts.
- Selecting a Page as the homepage.
- Posts, categories, tags, archives, or media as navigation targets.
- Scheduled publishing, revisions, trash restoration, bulk actions, or analytics.
- Automatic translation or cross-language content fallback.
- A per-link `target="_blank"` setting.

## Information Architecture

Add these authenticated routes:

| Route | Purpose |
| --- | --- |
| `/admin/pages` | Search and filter Page editions |
| `/admin/pages/new` | Create a Page or missing translation |
| `/admin/pages/edit/:id` | Edit one Page edition |
| `/admin/pages/preview/:id` | Preview the latest persisted Page draft |
| `/admin/navigation` | Manage Header and Footer by locale |

Add `Pages` and `Navigation` to the Admin sidebar. Page new, edit, and preview routes use the focused editor layout rather than the Admin shell, matching the existing Post workflow.

Add these server endpoints:

| Route | Purpose |
| --- | --- |
| `/api/pages` | Authenticated Page list and CRUD operations |
| `/api/navigation` | Authenticated list and transactional replacement of one menu |

Add the public Page route `/<locale>/<slug>`, for example `/th/about` and `/en/about`. The existing `/<locale>` blog index and `/<locale>/blog/<slug>` article routes remain unchanged. `blog` is a reserved Page slug in both locales.

## Page Data Model

Create a `public.pages` table. One row represents one language edition:

- `id uuid primary key default gen_random_uuid()`.
- `translation_group_id uuid not null default gen_random_uuid()`.
- `locale text not null`, constrained to `th` or `en`.
- `title text not null`.
- `slug text not null`.
- `content_json jsonb not null` for re-editing.
- `content_html text not null` for public rendering.
- `meta_title text` and `meta_description text`.
- `status text not null default 'draft'`, constrained to `draft` or `published`.
- `published_at timestamptz` for SEO and lifecycle tracking, though it is not displayed publicly.
- `author_id uuid not null references auth.users(id) on delete cascade`.
- `created_at` and `updated_at` timestamps.

Constraints and indexes enforce:

- Unique `(locale, slug)`.
- Unique `(translation_group_id, locale)`.
- A composite unique key on `(id, author_id, locale)` so Navigation can enforce owner and locale consistency through a foreign key.
- Public lookup by `(locale, status, slug)`.
- Owner list ordering by `(author_id, updated_at desc)`.

RLS allows anonymous selection only when `status = 'published'`. Authenticated owners receive full CRUD access only when `auth.uid() = author_id`, with both `using` and `with check` predicates where applicable.

Publishing and unpublishing one edition never change its sibling. Deleting one edition never delete its sibling.
On the first transition to Published, `published_at` is set to the current database time. Later edits, unpublishing, and republishing retain that original value; `updated_at` records subsequent changes.

## Navigation Data Model

Create a `public.navigation_items` table:

- `id uuid primary key default gen_random_uuid()`.
- `owner_id uuid not null references auth.users(id) on delete cascade`.
- `locale text not null`, constrained to `th` or `en`.
- `location text not null`, constrained to `header` or `footer`.
- `kind text not null`, constrained to `home`, `page`, or `custom`.
- `label text not null`, trimmed and limited to 80 characters.
- `page_id uuid` for Page targets.
- `url text` for custom targets, limited to 2,048 characters.
- `position integer not null`, constrained to zero or greater.
- `created_at` and `updated_at` timestamps.

A composite foreign key from `(page_id, owner_id, locale)` to `pages(id, author_id, locale)` uses `on delete cascade`. This prevents a navigation item from targeting another owner's Page or the wrong language edition.

A database check constraint enforces the target shape:

- `home`: both `page_id` and `url` are null.
- `page`: `page_id` is present and `url` is null.
- `custom`: `url` is present and `page_id` is null.

Partial unique indexes prevent duplicate Home or Page targets within the same owner, locale, and location. The API rejects duplicate custom URL targets. Position does not need a unique constraint; public ordering is deterministic by `position`, then `id`, and the replacement operation normalizes positions to `0..n-1`.

Navigation rows are owner-only under RLS. They are not anonymously readable through the Data API. Public rendering resolves a minimal safe representation on the Astro server.

## Transactional Menu Replacement

Add a Postgres function that replaces the complete list for one authenticated owner, locale, and location in one transaction. It:

1. Requires `auth.uid()`.
2. Validates the locale and location.
3. Rejects more than 50 items and validates every label, target shape, duplicate target, and custom URL scheme.
4. Verifies Page targets through the composite ownership and locale relationship.
5. Deletes the previous list for that exact locale and location.
6. Inserts the validated list with normalized positions.

The function uses the authenticated session and RLS rather than accepting an owner ID. The API validates the request with Zod before calling it. A failed call rolls back the entire replacement, so the public menu never observes a partially reordered list.

## Shared Editor Architecture

Keep separate Post and Page shells while extracting only the editor behavior they genuinely share:

- Novel/Tiptap document canvas.
- Slash commands, formatting bubble, block insertion, and Media Picker.
- Serialized autosave queue and save-state feedback.
- HTML sanitation and editor-document validation.
- Safe navigation flushing and preview preparation.

The Post shell retains cover image, author/article presentation, Post settings, and Blog-specific routes. The Page shell owns title, slug, SEO metadata, translation switching, Page status, and Page endpoints. It does not display Post-only controls.

Draft saves require a non-empty title but may contain an empty document. Publishing additionally requires meaningful content and a valid, non-reserved slug. The server derives `author_id` and translation group membership; the browser never supplies either value directly.

## Pages Admin Experience

`/admin/pages` follows the established Posts list conventions:

- Page title and slug.
- TH or EN edition badge.
- Draft or Published status.
- Last-updated time in the configured timezone.
- Search by title.
- Language and status filters represented in URL query parameters.
- Link to the sibling edition or an action to add the missing translation.
- Edit, Preview, Publish/Unpublish, and Delete actions.

The Page editor keeps writing focused and outside the Admin shell. Its top bar contains Back to Pages, save state, TH/EN edition switcher, Preview, SEO/settings, and Publish or Update. Preview always flushes the newest local changes and renders persisted owner-scoped data with `noindex, nofollow`.

Deletion names the Page edition and warns that its menu references will also be removed. Unpublish explains that existing menu placement is retained but temporarily hidden.

## Navigation Admin Experience

`/admin/navigation` is an authenticated React island with two tab levels:

1. Location: `MenuBar` or `Footer`.
2. Language: `ไทย` or `English`.

The active list supports pointer and keyboard reordering. Each item displays its editable label, target summary, visibility state, and Remove action. Page labels copy the Page title only when first added; subsequent Page-title changes do not overwrite a customized navigation label.

The Add item flow supports:

- Home.
- A Page edition in the active language.
- A custom relative or absolute HTTP(S) URL.
- Placement in MenuBar, Footer, or both. Choosing both creates independent rows so their labels and ordering may later diverge.

The Page picker includes owned Page groups and indicates when the active-language translation is missing. A missing translation cannot be added. Draft editions may be added and appear as `Hidden — Draft` until published.

Edits remain local until `Save menu` is activated. The action submits the complete active list, disables duplicate submission, and shows pending, success, failure, and retry states. A failed save retains the edited order and labels in the browser.

## Public Navigation Rendering

Add `getPublicNavigation(locale)` as a server-only boundary. It reads at most 50 Header and 50 Footer rows for the locale, fetches only the referenced Pages whose status is `published`, and emits only `{ href, label, kind }` values needed by the templates.

Targets resolve as follows:

- Home → `/<locale>`.
- Page → `/<locale>/<page-slug>`.
- Custom → the validated stored URL.

A Page item whose target is Draft or missing is omitted without leaving an empty placeholder. Home and valid custom links remain visible. Unpublishing therefore hides an item without changing its saved position; republishing restores it.

The Header renders a flat desktop MenuBar and a native `<details>` disclosure on narrow screens. The Footer renders its independently ordered flat link list. Both are server-rendered Astro markup and add no application JavaScript. Custom links open in the current tab in this release.

## Public Page Rendering and SEO

The public Page route selects by exact locale, slug, and `published` status. Missing, unsupported, or Draft Pages return a real `404`; another-language edition is never substituted.

The route renders sanitized `content_html` in the existing public layout with:

- Title and content only.
- A self-referencing canonical URL.
- `hreflang="th"` and `hreflang="en"` only for published siblings.
- `x-default` only when the published default-language sibling exists.
- Open Graph and social metadata through the existing SEO component.
- JSON-LD with `@type: WebPage`.
- No React hydration or application JavaScript.

The sitemap includes every Published Page edition independently alongside the current homepage and article entries. Draft Pages and owner-only previews are excluded.

## Validation and Error Handling

- Page slugs use the existing normalization behavior and reject `blog` plus any route names explicitly reserved by the Page router.
- Duplicate slugs within a locale return `409 Conflict`.
- Duplicate translation editions return `409 Conflict`.
- Unsafe or malformed custom URLs return `400 Bad Request`.
- Relative custom URLs must begin with one `/`; protocol-relative URLs beginning `//` are rejected.
- Absolute custom URLs accept only `http:` or `https:`. `javascript:`, `data:`, and other schemes are rejected.
- Authentication failures return `401`; missing or foreign resources return `404`; unexpected failures return a generic `500` response while details stay in server logs.
- Every mutation exposes pending state and prevents duplicate submission.
- Page content and local Navigation edits survive recoverable request failures.

## Cache and Consistency

Public navigation may use the same short in-process cache pattern as site settings. The cache key includes locale and location. A successful Navigation save invalidates the local cache; a short TTL bounds staleness across multiple server processes where in-memory invalidation cannot propagate.

Page reads do not depend on the navigation cache. Publishing, unpublishing, and deletion therefore affect direct Page routes immediately; menu visibility converges within the bounded cache TTL on other processes.

## Installer, Reset, and Migration

Add one forward-only migration containing the new tables, indexes, RLS policies, grants, and menu-replacement function. Existing posts and site settings require no backfill.

Fresh-install readiness checks include `pages` and `navigation_items`, so an incomplete migration prevents setup from reporting ready. The installation reset workflow deletes Navigation first and then Pages before deleting the owner. Dry-run output includes both counts. The migration files and empty tables remain in place so reset still returns to the Wizard rather than rebuilding Supabase.

README documentation covers Page URLs, menu locations, migration application, public rendering behavior, and reset impact.

## Accessibility and Responsive Behavior

- Navigation tabs, Add item controls, reordering, Remove, and Save are keyboard operable.
- Reordering includes Move up and Move down controls rather than relying only on drag-and-drop.
- Save and error feedback use an appropriate live region and never rely on color alone.
- Mobile MenuBar disclosure uses semantic HTML, has a visible focus state, and does not trap focus.
- Public and Admin layouts are verified at 320, 375, 414, 768, 1280, and 1440 CSS pixels without horizontal overflow.
- Long labels truncate or wrap only in non-clickable Admin summaries; public clickable navigation labels remain on one line and the layout reflows instead.
- Reduced-motion preferences remove non-essential Admin reordering and disclosure transitions.

## Verification

- Apply the migration to a clean local Supabase stack and an existing installation containing Posts and Media.
- Verify two authenticated users cannot list, read, preview, mutate, translate, or target each other's Pages.
- Create Thai and English Page editions, including the same slug across languages, and reject a duplicate within one language.
- Verify Draft save, serialized autosave, Preview, Publish, Unpublish, republish, and edition switching with an active save.
- Verify missing and Draft public Pages return `404` without cross-language fallback.
- Verify Header/Footer and TH/EN lists have independent labels and ordering.
- Add Home, Page, and custom URL items; add one item to both locations and then reorder each independently.
- Verify Draft Page items remain saved but hidden, then reappear after publish.
- Delete a Page and verify its navigation references are removed while its sibling edition remains.
- Reject unsafe custom URLs and malformed navigation payloads.
- Force a menu-replacement failure and verify the previous database list remains intact while the edited browser list is retained.
- Verify canonical, published translation alternates, `x-default`, `WebPage` JSON-LD, and sitemap entries.
- Confirm public Pages, Header, and Footer ship no new application JavaScript.
- Verify keyboard navigation, Move up/down controls, focus restoration, status announcements, and all target viewport widths.
- Run Astro and TypeScript checks, the production build, focused API/RLS tests, and end-to-end Admin/public regression tests.

## Delivery Order

1. Add Page and Navigation schema, constraints, RLS, transactional function, and strict TypeScript types.
2. Extract shared content validation/editor behavior and implement Page CRUD, translation, preview, and public rendering.
3. Add the Pages Admin list and focused Page editor workflow.
4. Implement Navigation API and Admin manager with independent locale/location lists.
5. Integrate public Header/Footer, Page SEO, sitemap, installer readiness, reset workflow, and README.
6. Complete RLS, API, editor, navigation, accessibility, responsive, zero-JavaScript, and regression verification.

## Release Boundary

This release is complete when the owner can manage independent Thai and English Pages, publish them at locale-prefixed URLs, add Home/Page/custom links to separately ordered Header and Footer menus, and see only valid Published Page targets on the public site without adding JavaScript or regressing the existing Blog and Admin workflows.

Nested menus, named menus, Page templates, homepage assignment, Post targets, scheduling, revisions, trash restoration, analytics, and new-window link settings remain outside this release.
