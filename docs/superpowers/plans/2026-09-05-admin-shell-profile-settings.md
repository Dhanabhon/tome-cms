# TomeCMS Admin Shell, Profile, Settings, and Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the single TomeCMS owner a responsive Admin sidebar, a Stories-style Posts screen, editable Profile data used by public author blocks, and focused core Settings screens.

**Architecture:** Keep `AdminLayout` as the noindex document frame and add one `AdminShell` component for authenticated content pages. Store Profile fields in the existing single `site_settings` row, mutate Profile and Settings through separate strict server endpoints, and keep the service-role client server-only. Continue rendering the Posts list in Astro; use a small delegated script for row mutations rather than adding a table or state library.

**Tech Stack:** Astro 5 SSR, React 18 islands, TypeScript strict mode, Supabase Auth/Postgres/Storage/RLS, Zod, native HTML dialog/details/forms, Tailwind/global CSS, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-05-multilingual-admin-publishing-design.md`](../specs/2026-09-05-multilingual-admin-publishing-design.md)

## Global Constraints

- Complete `2026-09-05-multilingual-data-and-public-routes.md` first.
- Run every shell command through `rtk` in this repository.
- Preserve all pre-existing working-tree changes and stage only each task's files or reviewed hunks.
- Use the visual rules in `DESIGN.md` and values in `DESIGN-TOKENS.json`; Medium is an interaction reference, not a brand or pixel reference.
- Keep one configured owner. Do not add roles, invitations, multi-author UI, public profiles, or a Stats placeholder.
- Keep `site_settings` inaccessible to browser Supabase queries. Authenticate first, verify `site_settings.owner_id`, then use the server-only service-role client for whitelisted updates.
- Profile and Settings use explicit Save actions; do not autosave site configuration.
- Use existing React, Media Picker, CSS tokens, and native dialogs. Add no dependencies.
- Keep the existing Media Library behavior intact while placing it inside the shell.
- Do not add bulk post actions or pagination. The small single-owner list is filtered server-side in memory until measured volume requires database pagination.
- Run a focused test before each commit and stage only the listed files.

## File Map

| Path | Action | Responsibility |
| --- | --- | --- |
| `supabase/migrations/*_add_owner_profile.sql` | Create via Supabase CLI | Add validated Profile fields and avatar reference to `site_settings`. |
| `src/types/cms.ts` | Modify | Add author-link/profile settings and public profile types. |
| `src/lib/installation.ts` | Modify | Load owner-only settings without cache and invalidate cached public settings after mutation. |
| `src/lib/admin.ts` | Create | Validate safe Admin return paths and build the login return URL. |
| `src/lib/profile.ts` | Create | Resolve a locale-specific public author profile and avatar URL server-side. |
| `src/lib/posts.ts` | Modify | Filter the small owner post list and calculate row metadata. |
| `src/pages/api/profile.ts` | Create | Validate and save Profile fields only. |
| `src/pages/api/settings.ts` | Create | Validate and save core site settings only. |
| `src/pages/api/posts/index.ts` | Modify | Add owner-scoped Publish/Unpublish status mutation for post rows. |
| `src/layouts/AdminLayout.astro` | Modify | Become the shared Admin document/noindex frame without navigation policy. |
| `src/components/admin/AdminShell.astro` | Create | Render desktop sidebar, mobile dialog navigation, View site, and Sign out. |
| `src/components/admin/ProfileForm.tsx` | Create | Edit display name, avatar, localized bios, and five links. |
| `src/components/admin/SettingsForm.tsx` | Create | Edit site name, description, default locale, and timezone. |
| `src/components/blog/AuthorBlock.astro` | Create | Render the locale-specific public author identity without a profile link. |
| `src/components/blog/PostArticle.astro` | Modify | Include the shared author block. |
| `src/layouts/BaseLayout.astro` | Modify | Use configured person data in article structured data. |
| `src/pages/admin/index.astro` | Modify | Keep login outside the shell and render the Stories-style filtered Posts list inside it. |
| `src/pages/admin/media.astro` | Modify | Wrap the existing Media Library with `AdminShell`. |
| `src/pages/admin/profile.astro` | Create | Authenticate the configured owner and mount `ProfileForm`. |
| `src/pages/admin/settings.astro` | Create | Authenticate the configured owner and mount `SettingsForm`. |
| `src/pages/[locale]/blog/[slug].astro` | Modify | Resolve and pass the public author profile. |
| `src/styles/global.css` | Modify | Add shell, sidebar, list, form, author-block, and responsive states using current tokens. |
| `tests/e2e/support.ts` | Modify | Temporarily assign/restore the installed owner and support login return destinations in serial tests. |
| `tests/e2e/site-settings.spec.ts` | Create | Cover owner checks, Profile validation, avatar ownership, Settings, and public author data. |
| `tests/e2e/admin-shell.spec.ts` | Create | Cover desktop/mobile navigation, focus, return-to-login, and sign out. |
| `tests/e2e/admin-posts.spec.ts` | Create | Cover filters, edition rows, status actions, deletion, and URL history. |
| `tests/e2e/public-blog.spec.ts` | Modify | Cover author block and structured-data author behavior. |

## Shared Interfaces

Extend `src/types/cms.ts` in Task 1:

```ts
export interface AuthorLink {
  label: string;
  url: string;
}

export interface SiteSettings {
  id: boolean;
  site_name: string;
  site_description: string;
  default_locale: PostLocale;
  timezone: 'Asia/Bangkok' | 'UTC';
  owner_id: string;
  installed_at: string;
  updated_at: string;
  author_name: string;
  author_avatar_media_id: string | null;
  author_bio_th: string;
  author_bio_en: string;
  author_links: AuthorLink[];
}

export interface PublicAuthorProfile {
  avatarUrl: string | null;
  bio: string;
  links: AuthorLink[];
  name: string;
}
```

`src/lib/installation.ts` adds:

```ts
export async function getSiteSettingsForOwner(ownerId: string): Promise<SiteSettings | null>;
export function invalidateSiteSettingsCache(): void;
```

`src/lib/admin.ts` exports:

```ts
export function safeAdminReturnTo(value: string | null | undefined): string;
export function adminLoginPath(path: string): string;
```

`src/lib/profile.ts` exports:

```ts
export async function getPublicAuthorProfile(
  settings: SiteSettings,
  locale: PostLocale,
): Promise<PublicAuthorProfile | null>;
```

---

### Task 1: Persist Profile fields behind configured-owner endpoints

**Files:**

- Create via CLI: `supabase/migrations/*_add_owner_profile.sql`
- Modify: `src/types/cms.ts`
- Modify: `src/lib/installation.ts`
- Create: `src/pages/api/profile.ts`
- Create: `src/pages/api/settings.ts`
- Modify: `tests/e2e/support.ts`
- Create: `tests/e2e/site-settings.spec.ts`

**Interfaces:**

- Consumes: The single `site_settings` row, `authenticate()`, service-role client, `media_items`, and existing installation cache.
- Produces: Profile columns/types, owner-only settings lookup, explicit cache invalidation, strict Profile/Settings update endpoints, and a safe test owner lease.

- [ ] **Step 1: Add a reversible test-owner lease and failing endpoint tests**

Add this helper to `tests/e2e/support.ts`; every caller must restore the original owner before `deleteOwner()`:

```ts
export async function leaseSiteOwner(owner: TestOwner) {
  const { data: original, error: readError } = await admin
    .from('site_settings')
    .select('*')
    .eq('id', true)
    .single();
  if (readError) throw readError;

  const { error: updateError } = await admin
    .from('site_settings')
    .update({ owner_id: owner.id })
    .eq('id', true);
  if (updateError) throw updateError;

  return async () => {
    const { error } = await admin
      .from('site_settings')
      .update({
        author_avatar_media_id: original.author_avatar_media_id,
        author_bio_en: original.author_bio_en,
        author_bio_th: original.author_bio_th,
        author_links: original.author_links,
        author_name: original.author_name,
        default_locale: original.default_locale,
        owner_id: original.owner_id,
        site_description: original.site_description,
        site_name: original.site_name,
        timezone: original.timezone,
      })
      .eq('id', true);
    if (error) throw error;
    // The app caches public settings for five seconds; prevent restored test state leaking into the next serial test.
    await new Promise((resolve) => setTimeout(resolve, 5_100));
  };
}
```

Create `tests/e2e/site-settings.spec.ts`. Lease owner A, sign them in, and assert:

```ts
const savedProfile = await page.request.put('/api/profile', {
  data: {
    authorAvatarMediaId: null,
    authorBioEn: 'English bio',
    authorBioTh: 'ประวัติภาษาไทย',
    authorLinks: [{ label: 'Website', url: 'https://example.com/about' }],
    authorName: 'Tome Owner',
  },
});
expect(savedProfile.status()).toBe(200);

const invalidProtocol = await page.request.put('/api/profile', {
  data: {
    authorAvatarMediaId: null,
    authorBioEn: '',
    authorBioTh: '',
    authorLinks: [{ label: 'Unsafe', url: 'javascript:alert(1)' }],
    authorName: 'Tome Owner',
  },
});
expect(invalidProtocol.status()).toBe(400);
```

Create owner B and one B-owned media row; assert owner A receives `404` when saving B's ID as the avatar. Seed an owner-A post, change the default locale through `/api/settings`, assert `/` redirects to the new locale, and assert the seeded post's locale/status did not change. Restore the complete original site settings and owner in `finally`, then delete both test users. Also assert unauthenticated requests return `401` and authenticated non-owner requests return `404`.

Run and expect `404` because the endpoints do not exist.

- [ ] **Step 2: Generate the Profile migration**

```bash
rtk npx supabase migration new add_owner_profile
```

Use:

```sql
alter table public.site_settings
  add column author_name text not null default ''
    check (char_length(author_name) <= 120),
  add column author_avatar_media_id uuid
    references public.media_items(id) on delete set null,
  add column author_bio_th text not null default ''
    check (char_length(author_bio_th) <= 1000),
  add column author_bio_en text not null default ''
    check (char_length(author_bio_en) <= 1000),
  add column author_links jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(author_links) = 'array'
      and jsonb_array_length(author_links) <= 5
    );
```

The database owns structural limits; the server validates each link object and URL protocol.

- [ ] **Step 3: Extend strict settings types and cache helpers**

Add `AuthorLink`, the five Profile fields, and `PublicAuthorProfile` from Shared Interfaces. Extend `SiteSettingsInsert` and `SiteSettingsUpdate` through their existing mapped types; do not duplicate database table declarations.

Change the installer readiness settings probe to select `id, author_name, author_avatar_media_id, author_bio_th, author_bio_en, author_links` so an installation with the old settings schema is reported as migration-incomplete.

In `src/lib/installation.ts` add:

```ts
export function invalidateSiteSettingsCache() {
  settingsCache = undefined;
}

export async function getSiteSettingsForOwner(ownerId: string) {
  const { data, error } = await createServiceRoleSupabaseClient()
    .from('site_settings')
    .select('*')
    .eq('id', true)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

Do not use cached `getSiteSettings()` for authorization decisions.

- [ ] **Step 4: Implement the strict Profile endpoint**

Create `src/pages/api/profile.ts` with a PUT handler. Use this schema:

```ts
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Use an HTTP or HTTPS URL.');

const profileSchema = z.object({
  authorAvatarMediaId: z.uuid().nullable(),
  authorBioEn: z.string().trim().max(1000),
  authorBioTh: z.string().trim().max(1000),
  authorLinks: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    url: httpUrl,
  }).strict()).max(5),
  authorName: z.string().trim().max(120),
}).strict();
```

Authenticate first and call `getSiteSettingsForOwner(auth.user.id)`; return `401` without a session and `404` for a non-owner. When an avatar ID is present, require an owned media row:

```ts
const { data: avatar, error } = await auth.supabase
  .from('media_items')
  .select('id')
  .eq('id', input.authorAvatarMediaId)
  .eq('owner_id', auth.user.id)
  .maybeSingle();
if (error) throw error;
if (!avatar) return Response.json({ error: 'Media not found.' }, { status: 404 });
```

Use the service-role client to update only `author_name`, `author_avatar_media_id`, `author_bio_th`, `author_bio_en`, `author_links`, and a server-generated `updated_at: new Date().toISOString()`, with `.eq('id', true).eq('owner_id', auth.user.id)`. Invalidate the cache after success and return `{ settings }`.

- [ ] **Step 5: Implement the strict Settings endpoint**

Create `src/pages/api/settings.ts`. Call `authenticate(cookies, request)` and return `401` when it is null. Call `getSiteSettingsForOwner(auth.user.id)` and return `404` when no matching configured owner exists. Then validate only:

```ts
const settingsSchema = z.object({
  defaultLocale: z.enum(POST_LOCALES),
  siteDescription: z.string().trim().max(160),
  siteName: z.string().trim().min(1).max(120),
  timezone: z.enum(['Asia/Bangkok', 'UTC']),
}).strict();
```

Map to the four snake-case database columns, add a server-generated `updated_at: new Date().toISOString()`, update by both singleton ID and owner ID, invalidate the cache, and return `{ settings }`. Never accept Profile fields or `owner_id` here.

- [ ] **Step 6: Apply, test, and commit the persistence/API slice**

```bash
rtk npx supabase migration up --local
rtk npx supabase db lint --local
rtk npm run test:e2e -- tests/e2e/site-settings.spec.ts --project=desktop
rtk npm run check
rtk git add supabase/migrations/*_add_owner_profile.sql src/types/cms.ts src/lib/installation.ts src/pages/api/profile.ts src/pages/api/settings.ts tests/e2e/support.ts tests/e2e/site-settings.spec.ts
rtk git commit -m "feat: add owner profile and settings APIs"
```

---

### Task 2: Build the responsive Admin shell and configuration screens

**Files:**

- Create: `src/lib/admin.ts`
- Create: `src/components/admin/AdminShell.astro`
- Create: `src/components/admin/ProfileForm.tsx`
- Create: `src/components/admin/SettingsForm.tsx`
- Modify: `src/layouts/AdminLayout.astro`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/pages/admin/media.astro`
- Create: `src/pages/admin/profile.astro`
- Create: `src/pages/admin/settings.astro`
- Modify: `src/styles/global.css`
- Create: `tests/e2e/admin-shell.spec.ts`
- Modify: `tests/e2e/site-settings.spec.ts`

**Interfaces:**

- Consumes: Profile/Settings APIs, existing Media Library, Media Picker, settings types, `authenticate()`, and `getSiteSettingsForOwner()`.
- Produces: `AdminShell`, safe return-path helpers, real Profile/Settings pages, and responsive authenticated navigation used by the Posts task.

- [ ] **Step 1: Write failing shell, return-path, and form tests**

In `admin-shell.spec.ts`, lease and sign in the site owner. Assert desktop navigation includes exactly Posts, Media, Profile, and Settings; excludes Stats; highlights the current page; and signs out. In the mobile project assert the labelled `Open navigation` button opens a dialog, Escape closes it, focus returns to the button, and the document has no horizontal overflow.

Test a protected return path:

```ts
await page.goto('/admin/profile');
await expect(page).toHaveURL(/\/admin\?returnTo=%2Fadmin%2Fprofile$/);
await page.getByLabel('Email address').fill(owner.email);
await page.getByLabel('Password').fill(owner.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await expect(page).toHaveURL(/\/admin\/profile$/);
```

Extend `site-settings.spec.ts` to fill Profile and Settings forms, submit, reload, and assert values persist. Run both files and confirm the missing pages/components fail.

- [ ] **Step 2: Add safe same-origin Admin return paths**

Create `src/lib/admin.ts`:

```ts
const ADMIN_ORIGIN = 'https://admin.invalid';

export function safeAdminReturnTo(value: string | null | undefined) {
  if (!value) return '/admin';
  try {
    const url = new URL(value, ADMIN_ORIGIN);
    const isAdmin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    if (url.origin !== ADMIN_ORIGIN || !isAdmin) return '/admin';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/admin';
  }
}

export function adminLoginPath(path: string) {
  const target = safeAdminReturnTo(path);
  return target === '/admin' ? '/admin' : `/admin?returnTo=${encodeURIComponent(target)}`;
}
```

Import `safeAdminReturnTo` into the login script and navigate to the validated query value after sign-in. Protected Admin pages redirect with `adminLoginPath(Astro.url.pathname + Astro.url.search)`.

For a return-path test, fill the login form on the redirected URL directly so its `returnTo` query is not lost; keep `signInAdmin()` unchanged for tests that start at `/admin`.

- [ ] **Step 3: Separate the Admin document from the shell**

Remove the current top navigation and unconditional `<main>` wrapper from `AdminLayout.astro`; retain the document, fonts, canonical, noindex metadata, `admin-body`, and body slot. Keep the existing optional `showHeader` and `userEmail` props temporarily accepted but unused so the current editor routes still type-check until Plan 3 updates them. The unauthenticated Posts page supplies its own `<main>`, while `AdminShell` owns the authenticated `<main>` landmark.

Create `AdminShell.astro` with:

```astro
interface Props {
  active: 'media' | 'posts' | 'profile' | 'settings';
  siteName: string;
  userEmail?: string | null;
}

const links = [
  { id: 'posts', href: '/admin', label: 'Posts' },
  { id: 'media', href: '/admin/media', label: 'Media' },
  { id: 'profile', href: '/admin/profile', label: 'Profile' },
  { id: 'settings', href: '/admin/settings', label: 'Settings' },
] as const;
```

Render the same link list in a desktop `<aside>` and a mobile `<dialog aria-label="Admin navigation">`; render the content slot inside `<main class="admin-shell-main">`. Use a labelled `Open navigation` button, a visible Close button, `aria-current="page"`, View site in a new tab, and Sign out. The small shell script calls `showModal()`, closes on cancel, restores the opener's focus, and calls `createBrowserSupabaseClient().auth.signOut()` before navigating to `/admin`.

- [ ] **Step 4: Mount existing and new pages correctly**

At `/admin`, render the existing login section inside its own `<main>` directly under `AdminLayout` when unauthenticated. When authenticated, put the complete existing `.admin-page` section inside `AdminShell` with `active="posts"`, `siteName={settings.site_name}`, and `userEmail={userEmail}`. Do not render the shell around login or fatal error states.

Wrap `/admin/media` with the same shell using `active="media"`; do not change `MediaLibrary` props or behavior.

Both new pages authenticate, then require `getSiteSettingsForOwner(auth.user.id)`. Return `404` for an authenticated non-owner and redirect an unauthenticated request through `adminLoginPath()`.

- [ ] **Step 5: Build ProfileForm from the existing Media Picker**

Use this prop contract:

```ts
interface ProfileFormProps {
  initialAvatar?: MediaAsset | null;
  initialSettings: Pick<SiteSettings,
    'author_avatar_media_id' | 'author_bio_en' | 'author_bio_th' | 'author_links' | 'author_name'
  >;
}
```

Keep one controlled `AuthorLink[]` array capped at five. `Choose avatar` opens the existing `MediaPicker`; selecting stores the media ID and preview URL. Submit the camel-case Profile API shape from Task 1. Keep values on failure, show a field/global error, disable duplicate submit, and expose `Saved.` through `role="status"`. Remove avatar by sending `null`.

On the server page, resolve the initial avatar with the authenticated owner client and derive its public URL through `auth.supabase.storage.from('blog-media').getPublicUrl(storage_path)`.

- [ ] **Step 6: Build SettingsForm with an explicit save**

Use controlled fields for `site_name`, `site_description`, `default_locale`, and `timezone`. Locale and timezone use native selects. Submit exactly the camel-case API shape from Task 1; display `Saved.` only after the response succeeds and retain values on error.

```ts
await fetch('/api/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ defaultLocale, siteDescription, siteName, timezone }),
});
```

- [ ] **Step 7: Add shell/form styles from existing tokens**

Add `.admin-shell`, `.admin-sidebar`, `.admin-shell-main`, `.admin-mobile-nav`, `.admin-form-page`, `.profile-avatar`, and `.profile-links`. Reuse `--color-paper`, `--color-paper-2`, `--color-rule`, `--color-focus`, existing controls/buttons, radii, spacing, and reduced-motion rules. Use a fixed 15rem desktop sidebar at `min-width: 64rem`; below that breakpoint hide it and expose the dialog trigger. Native dialog focus and backdrop provide containment; ensure 44px touch targets and no horizontal overflow.

- [ ] **Step 8: Verify and commit the shell/configuration UI**

```bash
rtk npm run test:e2e -- tests/e2e/admin-shell.spec.ts tests/e2e/site-settings.spec.ts
rtk npm run test:e2e -- tests/e2e/media-library.spec.ts --project=desktop
rtk npm run check
rtk git add src/lib/admin.ts src/components/admin/AdminShell.astro src/components/admin/ProfileForm.tsx src/components/admin/SettingsForm.tsx src/layouts/AdminLayout.astro src/pages/admin/index.astro src/pages/admin/media.astro src/pages/admin/profile.astro src/pages/admin/settings.astro src/styles/global.css tests/e2e/admin-shell.spec.ts tests/e2e/site-settings.spec.ts
rtk git commit -m "feat: add admin shell and settings screens"
```

---

### Task 3: Render the owner Profile as a public author block

**Files:**

- Create: `src/lib/profile.ts`
- Create: `src/components/blog/AuthorBlock.astro`
- Modify: `src/components/blog/PostArticle.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/pages/[locale]/blog/[slug].astro`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/public-blog.spec.ts`

**Interfaces:**

- Consumes: `SiteSettings`, `PublicAuthorProfile`, `PostLocale`, public media URLs, and the Plan 1 shared article renderer.
- Produces: `getPublicAuthorProfile()` and a locale-specific author block reused later by authenticated Preview.

- [ ] **Step 1: Add failing public Profile assertions**

Lease the test owner, save an avatar/profile through `/api/profile`, publish Thai and English editions, then assert each route shows the same display name and links but only its matching bio. Assert there is no public Profile link.

```ts
await publicPage.goto(`/th/blog/${thai.slug}`);
const author = publicPage.getByRole('complementary', { name: 'About the author' });
await expect(author.getByText('Tome Owner')).toBeVisible();
await expect(author.getByText('ประวัติภาษาไทย')).toBeVisible();
await expect(author.getByText('English bio')).toHaveCount(0);
await expect(author.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://example.com/about');
```

Clear `author_name` and assert the entire block disappears. Restore the original site settings/owner in `finally`.

- [ ] **Step 2: Resolve only public Profile fields server-side**

Create `src/lib/profile.ts`:

```ts
import { createServiceRoleSupabaseClient } from './supabase';
import type { PostLocale, PublicAuthorProfile, SiteSettings } from '../types/cms';

export async function getPublicAuthorProfile(
  settings: SiteSettings,
  locale: PostLocale,
): Promise<PublicAuthorProfile | null> {
  if (!settings.author_name.trim()) return null;

  let avatarUrl: string | null = null;
  if (settings.author_avatar_media_id) {
    const admin = createServiceRoleSupabaseClient();
    const { data, error } = await admin
      .from('media_items')
      .select('storage_path')
      .eq('id', settings.author_avatar_media_id)
      .eq('owner_id', settings.owner_id)
      .maybeSingle();
    if (error) throw error;
    if (data) avatarUrl = admin.storage.from('blog-media').getPublicUrl(data.storage_path).data.publicUrl;
  }

  return {
    avatarUrl,
    bio: locale === 'th' ? settings.author_bio_th : settings.author_bio_en,
    links: settings.author_links,
    name: settings.author_name,
  };
}
```

Do not fall back to the other language's bio.

- [ ] **Step 3: Render one accessible author component**

Create `AuthorBlock.astro` accepting `{ profile: PublicAuthorProfile }`. Render `<aside aria-label="About the author">`, optional avatar with empty alt because the adjacent name labels it, name as text, optional localized bio, and external links with `rel="noopener noreferrer"`. Do not link the name to a nonexistent public profile.

Add `profile?: PublicAuthorProfile | null` to `PostArticle` and render the block after article content. In the localized article route call `getPublicAuthorProfile(settings, post.locale)` and pass the result.

- [ ] **Step 4: Make article structured data use the person when present**

Add `authorName?: string` to `BaseLayout` and build:

```ts
const author = authorName
  ? { '@type': 'Person', name: authorName }
  : publisher;
```

Use `author` in `BlogPosting` JSON-LD, use `authorName ?? siteName` for the existing author meta tag, and pass `authorName={profile?.name}` from the article route. Keep the publisher as the site organization.

- [ ] **Step 5: Verify and commit the public Profile slice**

```bash
rtk npm run test:e2e -- tests/e2e/public-blog.spec.ts --project=desktop
rtk npm run check
rtk git add src/lib/profile.ts src/components/blog/AuthorBlock.astro src/components/blog/PostArticle.astro src/layouts/BaseLayout.astro 'src/pages/[locale]/blog/[slug].astro' src/styles/global.css tests/e2e/public-blog.spec.ts
rtk git commit -m "feat: show owner profile on posts"
```

---

### Task 4: Replace the dashboard table with a Stories-style Posts screen

**Files:**

- Modify: `src/lib/posts.ts`
- Modify: `src/pages/api/posts/index.ts`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/styles/global.css`
- Create: `tests/e2e/admin-posts.spec.ts`

**Interfaces:**

- Consumes: Locale-aware posts, `AdminShell`, `readingMinutes()`, existing authenticated PUT/DELETE post API, and URL query parameters.
- Produces: `filterAdminPosts()`, owner-scoped PATCH status changes, and the completed Posts management screen.

- [ ] **Step 1: Write failing filter and row-action tests**

Seed one Thai draft, one English draft sibling, and one published post. Verify `/admin` defaults to Drafts, language/search filters produce query URLs, reload and Back restore the same view, each edition is a separate row, and sibling status is visible. A missing sibling is text-only in this plan; Plan 3 adds its translation link when the target route exists.

```ts
await page.goto('/admin');
await expect(page.getByRole('tab', { name: /Drafts/ })).toHaveAttribute('aria-selected', 'true');
await page.getByRole('link', { name: 'Published' }).click();
await expect(page).toHaveURL(/status=published/);
await page.getByLabel('Language').selectOption('en');
await page.getByRole('button', { name: 'Apply filters' }).click();
await expect(page).toHaveURL(/locale=en/);
```

Open one row menu, Publish it, and assert only that edition changes. Unpublish it. Accept Delete confirmation and assert its sibling remains. Run and expect the old dashboard markup to fail.

- [ ] **Step 2: Add one in-memory filter helper**

Append to `src/lib/posts.ts`:

```ts
interface AdminPostFilters {
  locale: 'all' | PostLocale;
  query: string;
  status: 'all' | PostStatus;
}

export function filterAdminPosts(posts: Post[], filters: AdminPostFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  // ponytail: filter one owner's complete list in memory; add DB pagination only when measured volume requires it.
  return posts.filter((post) => (
    (filters.status === 'all' || post.status === filters.status)
    && (filters.locale === 'all' || post.locale === filters.locale)
    && (!query || post.title.toLocaleLowerCase().includes(query))
  ));
}
```

Export `AdminPostFilters` because the page uses the same validated shape.

- [ ] **Step 3: Add a narrow PATCH status action**

Add a `PATCH` handler to the existing post endpoint with:

```ts
const statusSchema = z.object({
  id: z.uuid(),
  status: z.enum(POST_STATUSES),
}).strict();
```

Authenticate, select the owned post, return `404` if missing, and reject publishing when `hasMeaningfulContent(post.content_json)` is false. Update only `status` by both ID and author ID, select the updated row, and return `{ post }`. Database timestamp behavior remains owned by the existing trigger.

- [ ] **Step 4: Render filters and edition rows in Astro**

Validate URL inputs to these defaults:

```ts
const status = ['draft', 'published', 'all'].includes(Astro.url.searchParams.get('status') ?? '')
  ? Astro.url.searchParams.get('status') as 'draft' | 'published' | 'all'
  : 'draft';
const locale = ['th', 'en', 'all'].includes(Astro.url.searchParams.get('locale') ?? '')
  ? Astro.url.searchParams.get('locale') as PostLocale | 'all'
  : 'all';
const query = (Astro.url.searchParams.get('q') ?? '').trim().slice(0, 100);
```

Fetch all owned posts once, then call `filterAdminPosts`. Use anchor tabs inside `role="tablist"` with `role="tab"`/`aria-selected`, and a GET search/filter form with an `Apply filters` submit button so browser history works without client state.

Build a `Map<translation_group_id, Post[]>` for sibling status. Each row renders cover/placeholder, title fallback, locale badge, `readingMinutes`, localized updated/published time, status, and an existing-sibling edit link or text such as `EN missing`. Its native `<details>` overflow menu contains Edit, Publish/Unpublish, and Delete. Plan 3 adds missing-translation and Preview links only after those routes work.

- [ ] **Step 5: Wire row mutations with one delegated script**

Attach one click listener to the Posts container. Buttons carry `data-post-action` and `data-post-id`. For status changes call PATCH; for Delete use `window.confirm()` followed by the existing DELETE endpoint. Disable the chosen button while pending, show one persistent list alert on failure, and reload the current filtered URL after success.

```ts
const response = action === 'delete'
  ? await fetch(`/api/posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  : await fetch('/api/posts', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status: action }),
    });
```

- [ ] **Step 6: Style the Stories hierarchy and responsive rows**

Replace the summary/table-specific styles with `.admin-post-tabs`, `.admin-post-filters`, `.admin-story-list`, `.admin-story-row`, `.admin-story-cover`, `.admin-locale`, and `.admin-story-menu`. Keep subtle rules, white space, tokenized focus, and existing typography. At mobile widths stack metadata below the title, keep the action target 44px, and never turn the full row into a link that contains nested buttons.

- [ ] **Step 7: Verify and commit the Posts screen**

```bash
rtk npm run test:e2e -- tests/e2e/admin-posts.spec.ts
rtk npm run test:e2e -- tests/e2e/admin-shell.spec.ts --project=desktop
rtk npm run check
rtk git add src/lib/posts.ts src/pages/api/posts/index.ts src/pages/admin/index.astro src/styles/global.css tests/e2e/admin-posts.spec.ts
rtk git commit -m "feat: redesign admin posts management"
```

---

## Plan 2 Completion Gate

```bash
rtk npm run check
rtk npm run build
rtk npm run test:e2e -- tests/e2e/admin-shell.spec.ts tests/e2e/site-settings.spec.ts tests/e2e/admin-posts.spec.ts tests/e2e/public-blog.spec.ts tests/e2e/media-library.spec.ts
rtk git diff --check
rtk git status --short
```

Confirm desktop and mobile shell behavior, configured-owner protection for Profile/Settings, localized public author data, independent edition row actions, and no Stats/multi-author/public-profile surface before starting Plan 3.
