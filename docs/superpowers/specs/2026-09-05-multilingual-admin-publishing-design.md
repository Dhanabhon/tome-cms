# TomeCMS Multilingual Admin and Publishing Design

Date: 2026-09-05  
Status: Approved

## Context

TomeCMS is a single-owner Astro CMS backed by Supabase Auth, Postgres, Row Level Security (RLS), and Storage. It already has draft and published posts, a Tiptap editor with autosave, a media library, and server-rendered public articles. The current Admin area uses a top navigation bar, the post list is compact, post settings permanently consume editor width, and the public site has one unprefixed language route.

This design expands the existing model instead of introducing a new CMS layer. Medium's writer and Stories screens are interaction references only. TomeCMS keeps the visual language, typography, colors, focus treatment, and restrained motion defined in `DESIGN.md` and `DESIGN-TOKENS.json`.

The product context is fixed as:

- Audience: one site owner and administrator.
- Primary use: writing and managing editorial content.
- Tone: utilitarian and editorial.

## Goals

- Add a reusable Admin shell with sidebar navigation for Posts, Media, Profile, and Settings.
- Keep the post editor as a separate, focused writing workspace.
- Let the owner preview the latest saved draft before publishing.
- Make the editor feel closer to a focused Medium-style writing surface without copying Medium's brand.
- Support independently managed Thai and English editions of the same post.
- Add locale-prefixed public routes, language switching, and correct multilingual SEO metadata.
- Add an owner Profile whose data appears in a shared author block on posts.
- Redesign the Posts screen around a clear Stories-style list.

## Non-goals for this release

- Multiple owners, authors, roles, invitations, or permissions management.
- A public profile or author archive page.
- Statistics or analytics.
- Automatic or AI translation.
- Side-by-side translation editing.
- Revision history or restoration.
- Scheduled, unlisted, submitted, or imported stories.
- Bulk post actions or pagination.
- New UI, state-management, or editor dependencies.

## Information Architecture

Authenticated Admin routes are:

| Route | Experience |
| --- | --- |
| `/admin` | Posts list and the unauthenticated login entry point |
| `/admin/media` | Existing Media Library inside the Admin shell |
| `/admin/profile` | Owner identity, localized bios, avatar, and links |
| `/admin/settings` | Site name, description, default locale, and timezone |
| `/admin/new` | Focused editor for a new post |
| `/admin/edit/:id` | Focused editor for an existing post edition |
| `/admin/preview/:id` | Authenticated rendering of the latest saved draft |

The Admin shell is used only by the first four routes. New, edit, and preview routes deliberately bypass the sidebar so writing and reading remain focused. An unauthenticated request is redirected to the login experience and returns to its original safe same-origin Admin destination after authentication.

Public routes are:

| Route | Behavior |
| --- | --- |
| `/` | Redirect to `/<default-locale>` |
| `/th` | Published Thai post index |
| `/en` | Published English post index |
| `/th/blog/:slug` | Published Thai article |
| `/en/blog/:slug` | Published English article |
| `/blog/:slug` | Permanent redirect, preferring the matching post in the default locale |

Unsupported locales and missing or unpublished posts return `404`.

## Multilingual Post Model

Keep `posts` as the only post table. One row represents one language edition. Add:

- `locale text not null`, constrained to `th` or `en`.
- `translation_group_id uuid not null default gen_random_uuid()`.
- A unique constraint on `(translation_group_id, locale)`.
- A unique constraint on `(locale, slug)`, replacing the current global `slug` uniqueness.
- A public lookup index covering locale, status, and publication ordering.

Thai and English editions in the same `translation_group_id` are related but remain independent posts. Each edition owns its title, slug, content, cover, SEO fields, draft/published status, and timestamps. Publishing, unpublishing, or deleting one edition never changes or removes its sibling.

The browser never supplies a raw `translation_group_id`. To start a missing translation it opens `/admin/new?sourcePostId=<owned-post-id>&locale=<target-locale>`. The server resolves the owned source post and its group, rejects a duplicate locale, and applies the group when the new edition is first saved. The new edition starts with an empty translated title, body, slug, and SEO fields; it may reuse the source cover image. No database row is created until the owner enters a valid title and the normal save succeeds.

A normal new post uses `site_settings.default_locale` and receives its own generated translation group. The existing two statuses, `draft` and `published`, remain unchanged.

## Safe Migration

The migration preserves every existing post:

1. Add the locale and translation-group columns in a backfillable state.
2. Read the single `site_settings.default_locale`, falling back to `th` only if installation data is unexpectedly absent.
3. Assign that locale to every existing post and generate a distinct translation group for every row.
4. Make both columns non-null.
5. Replace global slug uniqueness with `(locale, slug)` uniqueness.
6. Add `(translation_group_id, locale)` uniqueness and the public lookup index.

The migration does not change existing IDs, slugs, content, status, author, or timestamps. Consequently, every existing `/blog/:slug` can resolve in the default locale and redirect to its new canonical URL.

## Admin Shell

The desktop shell uses a persistent compact sidebar with the TomeCMS identity, the active navigation state, and these links in order:

1. Posts
2. Media
3. Profile
4. Settings

`View site` and `Sign out` sit at the bottom. Stats is omitted rather than shown as an inactive placeholder.

On narrow screens the sidebar becomes a modal side drawer opened by a labelled menu button. It traps focus while open, closes with Escape or its close control, restores focus to the trigger, and never causes horizontal overflow. All navigation, hover, active, disabled, and focus-visible states use the existing design tokens.

## Posts Screen

`/admin` remains the canonical Posts screen to preserve the current route. It has a `Posts` heading, a primary `New post` action, search, language filtering, and three status tabs:

- `Drafts`, selected by default.
- `Published`.
- `All`.

The language filter is `All`, `TH`, or `EN`. Search matches the title. Results are ordered by most recently updated. Filters are represented in URL query parameters so reload, Back, and Forward preserve the view; the existing server-rendered data path performs the filtering without adding a client table library.

Each row represents one language edition so Draft and Published filters are unambiguous. A row contains:

- Cover thumbnail or a restrained placeholder.
- Title, with `Untitled` used only as a UI fallback.
- TH or EN badge.
- Estimated reading time.
- Updated or published time in the configured timezone.
- Draft or Published status.
- A compact link/status for its sibling edition, including an add action when missing.
- An overflow menu for Edit, Preview, Publish or Unpublish, and Delete.

Deleting requires confirmation and names the edition being removed. It deletes only that row. Empty and error states retain the current filters and provide an obvious recovery or creation action.

## Profile

Profile remains single-owner configuration and has no public route. Extend the single `site_settings` row with:

- `author_name text`.
- `author_avatar_media_id uuid`, nullable, referencing `media_items(id)` with `on delete set null`.
- `author_bio_th text` and `author_bio_en text`.
- `author_links jsonb`, defaulting to an empty array and constrained to an array shape.

The Profile form contains display name, a Media Library avatar picker, Thai bio, English bio, and up to five ordered custom links. Each link has a label and an absolute HTTP or HTTPS URL. The authenticated server endpoint verifies that a chosen media item belongs to the owner before saving its ID.

Profile uses an explicit Save action. Public articles read the current profile at request time, so changing it updates the author block on all posts. If no display name is configured, the author block is omitted rather than rendering an empty component.

## Settings

Settings remains intentionally small:

- Site name.
- Site description.
- Default locale.
- Timezone.

It uses an explicit Save action with field-level validation. Changing the default locale changes the `/` destination, default-language creation choice, and preferred legacy `/blog/:slug` resolution. It does not alter the locale, translation relationship, slug, or publication state of an existing post.

Profile and Settings are separate screens but update whitelisted fields in the same single `site_settings` row. The table remains service-role-only. Each server endpoint first authenticates the user and verifies that the session user equals `site_settings.owner_id`; only then may the server-only client perform the update.

## Focused Editor

The editor is a full-page workspace with no Admin sidebar. Its compact top bar contains:

- Back to Posts.
- Draft/Published state and `Saving…`, `Saved`, or `Save failed` feedback.
- TH/EN edition switcher, with a `+` action for a missing translation.
- Preview.
- Settings drawer trigger.
- Publish or Update action.

The writing canvas is approximately 740 CSS pixels wide, with title and body on the same reading axis. The existing Tiptap editor, formatting bubble, slash commands, media picker, and image behavior remain. The block insertion control follows the currently focused caret line and stays in the editor gutter; it does not track the pointer or overlap text.

Autosave remains the primary draft-save control and runs after a short editing pause. The separate `Save draft` button is removed. Saves are serialized so an older request cannot overwrite newer edits. The status is announced accessibly and never reports `Saved` until the newest local change is persisted. A failed save leaves content in the editor, displays a persistent retry action, and keeps the state visibly unsaved.

The permanent settings column is replaced with an on-demand right drawer containing cover image, slug, meta title, and meta description. On mobile it becomes a full-screen sheet. The drawer traps focus, closes with Escape, restores focus to its trigger, and preserves unsaved field values.

Switching to an existing language first flushes the latest edit, then navigates to the sibling edition. Adding a language also flushes the source before opening the new-edition route. A save failure stops navigation and exposes a retry, preventing silent data loss.

## Draft Preview

Preview always renders persisted data, never an independent unsaved browser snapshot:

1. The click synchronously opens a same-origin placeholder tab so browser popup protection does not block it.
2. The editor cancels its pending debounce, waits for any active save, and saves the newest local version as its current status.
3. On success, the placeholder navigates to `/admin/preview/:id`.
4. On failure, the preview tab shows a clear failure state with retry and return-to-editor actions; it never displays a stale draft as current.

A new draft needs a title and successful first save before Preview is enabled. Preview does not require publish-level completeness beyond the normal draft-save schema.

The preview route authenticates the request and selects the post by both ID and owner. It is never accessible through a public token. The page includes a visible `Draft preview` banner, an edit return action, and `noindex, nofollow` metadata.

Extract one shared server-rendered article component used by public article routes and Admin preview. The shared component owns the article structure and author block; the surrounding route owns public SEO or preview chrome. This keeps Preview faithful without adding JavaScript to public articles.

## Public Rendering and SEO

Locale index pages select only rows matching both the route locale and `published` status. Article pages select by locale, slug, and published status. The language switcher queries the current `translation_group_id` and displays only published siblings.

Each published edition has a self-referencing canonical URL. `hreflang="th"` and `hreflang="en"` are emitted only for published siblings. `hreflang="x-default"` points to the published default-locale sibling; it is omitted when that edition is not published. The sitemap contains each published locale URL independently.

The legacy `/blog/:slug` route first looks up a published post using the current default locale and the supplied slug. If none exists, it falls back to the matching published edition in the other supported locale so changing the default does not break an existing inbound link. It returns a `301` redirect to the selected locale-prefixed canonical URL, or `404` when neither locale has a published match.

The Profile author block uses the edition's language to select the matching bio and does not substitute a bio written in the other language. The name, avatar, and links can still render when that localized bio is empty; the entire block is omitted only when the display name is empty. Public pages receive only the display fields required for rendering.

## API and Authorization Boundaries

The existing authenticated post API remains the single create/update/delete path and is extended with locale-aware validation. Trust-boundary rules are:

- Accept only `th` or `en`.
- Derive the default locale server-side for a normal new post.
- Accept `sourcePostId` only for a new translated edition; resolve its group and ownership server-side.
- Never accept `author_id`, `owner_id`, or `translation_group_id` from the client.
- Scope reads, updates, deletes, publishing, and preview by the authenticated user's ID.
- Return `409 Conflict` for a duplicate slug within a locale or an existing edition in the requested language.
- Return `404` rather than disclosing a post or media record owned by another user.
- Sanitize article HTML through the existing save path.

Post RLS continues to expose only published rows publicly and all owned rows to their author. Database constraints enforce locale and translation uniqueness even when two requests race. Settings mutations remain behind authenticated server endpoints because `site_settings` intentionally has no browser-facing RLS policy.

## Validation and Error Handling

- Draft save requires a non-empty title; content may remain empty.
- Publish additionally requires a non-empty title, valid locale slug, and non-empty article content.
- Slugs are normalized with the existing slug generator and checked within their locale.
- Profile links accept only absolute HTTP or HTTPS URLs and at most five entries.
- All mutation controls show pending state and reject duplicate submission.
- Inline field errors preserve entered values.
- Authentication failures return `401`; missing or foreign resources return `404`; uniqueness conflicts return `409`; unexpected failures return a generic `500` response and log server detail.
- Preview, publish, edition switching, and leaving the editor all use the same save queue so none can race an active autosave.

## Accessibility and Responsive Behavior

- Every icon-only control has an accessible name and at least a 44 by 44 CSS-pixel pointer target on touch layouts.
- Visible focus uses the tokenized focus ring and is never removed without an equivalent replacement.
- Save and error states use `aria-live`; errors are not communicated by color alone.
- Sidebar and settings drawers manage initial focus, focus containment, Escape dismissal, and focus restoration.
- Tabs and overflow menus are keyboard operable with semantic controls.
- Thai and English text use the fonts and line-height rules defined by the design system.
- Admin screens are verified at 320, 375, 414, 768, 1280, and 1440 CSS pixels with no horizontal overflow.
- Reduced-motion preferences disable non-essential drawer and menu transitions.

## Delivery Order

1. Add and verify the data migration, generated database types, locale-aware post validation, and owner-scoped Profile/Settings APIs.
2. Extract the shared article renderer; add localized indexes and article routes, legacy redirects, language switching, canonical metadata, `hreflang`, and sitemap entries.
3. Add the Admin shell and rebuild Posts, Profile, and Settings within it; place the existing Media Library in the shell.
4. Rework the focused editor header and canvas, add edition creation/switching, move settings into the drawer, and add authenticated Draft Preview.
5. Complete accessibility, responsive, migration, RLS, and end-to-end verification.

## Verification

- Apply every migration to a fresh local Supabase stack and to a copy of the pre-change schema containing existing draft and published posts.
- Confirm existing post IDs, content, status, timestamps, and slugs are unchanged after migration.
- Verify two authenticated users cannot read, preview, translate, update, delete, or select media belonging to each other.
- Create a Thai post and English sibling, use the same slug in both languages, and confirm a duplicate within one language returns `409`.
- Publish and unpublish each edition independently and verify the public indexes and switcher expose only published editions.
- Verify `/`, both locale indexes, both locale article routes, legacy `301` redirects, `404` behavior, canonical URLs, `hreflang`, `x-default`, and sitemap output.
- Make an edit and immediately select Preview; verify the preview contains the newest text and an unauthenticated request cannot load it.
- Trigger edition switching during an active save and verify the newest content persists without duplicate or out-of-order writes.
- Verify Profile changes update author blocks and that another owner's media ID is rejected as an avatar.
- Verify Settings changes affect only future default selection and routing behavior, not existing post locale or status.
- Verify Posts filters survive reload and Back/Forward navigation and that each row action affects only its edition.
- Run Astro and TypeScript checks with zero diagnostics, the production build, focused API tests, and end-to-end Admin/public flows.

## Release Boundary

This release is complete when the single owner can manage Admin pages through the new shell; create, edit, preview, translate, publish, unpublish, and delete Thai and English editions safely; configure the public author identity and core site settings; and browse correct locale-prefixed public pages without regressions to the editor or Media Library.

Stats, multi-author workflows, public profiles, automated translation, revision history, scheduling, unlisted posts, submissions, imports, bulk actions, and pagination remain deliberately outside this release.
