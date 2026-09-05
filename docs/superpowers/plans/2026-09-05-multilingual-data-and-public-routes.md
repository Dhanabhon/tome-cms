# TomeCMS Multilingual Data and Public Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Thai and English post editions safely, expose locale-prefixed public indexes and articles, preserve legacy links, and emit correct multilingual SEO without adding client JavaScript to the public site.

**Architecture:** Keep one `posts` row per language edition and link siblings with `translation_group_id`. Extend the existing authenticated post endpoint rather than introducing a second persistence path. Render both localized public routes and the later Admin preview through one server-side article component, with route helpers providing canonical and alternate URLs.

**Tech Stack:** Astro 5 SSR, TypeScript strict mode, Supabase Postgres/Auth/RLS, Zod, sanitize-html, slugify, Tailwind/global CSS, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-05-multilingual-admin-publishing-design.md`](../specs/2026-09-05-multilingual-admin-publishing-design.md)

## Global Constraints

- Run every shell command through `rtk` in this repository.
- Preserve all existing working-tree changes. The current editor, media, layout, style, test, `DESIGN.md`, and `DESIGN-TOKENS.json` changes are user-owned; do not restore them or accidentally stage them with a task commit.
- Before isolated-worktree execution, first preserve the current dirty UI baseline in an owner-approved commit; a worktree created from current `HEAD` alone will not contain it.
- Support exactly `th` and `en`; do not add locale negotiation, machine translation, or translation-provider abstractions.
- Keep one `posts` row per locale and retain only `draft` and `published` statuses.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only and preserve post RLS as the public/owner authorization boundary.
- Do not change existing post IDs, slugs, content, authors, statuses, or timestamps during migration.
- Keep public pages server rendered with no hydration directive or application JavaScript.
- Add no dependencies.
- Apply migrations with `supabase migration up --local`; never use `supabase db reset` against the user's current data.
- Run the focused check before each commit and stage only the files listed for that task.

## File Map

| Path | Action | Responsibility |
| --- | --- | --- |
| `supabase/migrations/*_add_multilingual_posts.sql` | Create via Supabase CLI | Backfill locale/group data and add constraints and indexes without replacing rows. |
| `src/types/cms.ts` | Modify | Define locale-aware post/database/API types shared by all three plans. |
| `src/lib/installation.ts` | Modify | Detect a database that is installed but missing multilingual columns. |
| `src/lib/i18n.ts` | Create | Validate locale values and build locale/index/article paths. |
| `src/lib/posts.ts` | Create | Extract editor text, publishability, excerpts, and reading time once. |
| `src/pages/api/posts/index.ts` | Modify | Derive locale/group server-side and create linked translations safely. |
| `src/components/blog/SEOHead.astro` | Modify | Emit locale alternate links. |
| `src/components/blog/Header.astro` | Modify | Point Writing/home navigation at the current locale and show available languages. |
| `src/components/blog/PostArticle.astro` | Create | Render one reusable server-side article body for public routes and later Preview. |
| `src/layouts/BaseLayout.astro` | Modify | Accept explicit page locale, canonical path, alternates, and localized structured data. |
| `src/pages/index.astro` | Modify | Redirect `/` to the configured default locale. |
| `src/pages/[locale]/index.astro` | Create | Render the localized published-post index. |
| `src/pages/[locale]/blog/[slug].astro` | Create | Render one published locale edition and its published sibling link. |
| `src/pages/blog/[slug].astro` | Modify | Preserve old links with a permanent locale-aware redirect. |
| `src/pages/sitemap.xml.ts` | Modify | Include both locale indexes and every published locale article URL. |
| `tests/e2e/multilingual-posts.spec.ts` | Create | Prove migration constraints, server-derived relationships, and owner isolation. |
| `tests/e2e/public-blog.spec.ts` | Modify | Prove localized rendering, redirects, SEO, sitemap, 404s, and zero JavaScript. |
| `tests/e2e/editor-media.spec.ts` | Modify | Add locale to its one direct post fixture. |
| `tests/e2e/media-deletion.spec.ts` | Modify | Add locale to its direct and bulk post fixtures. |

## Shared Interfaces

Add these contracts to `src/types/cms.ts` in Task 1 and keep their names unchanged in later plans:

```ts
export const POST_LOCALES = ['th', 'en'] as const;
export type PostLocale = (typeof POST_LOCALES)[number];

export interface Post {
  id: string;
  title: string;
  slug: string;
  locale: PostLocale;
  translation_group_id: string;
  cover_image: string | null;
  content_json: EditorDocument;
  content_html: string;
  meta_title: string | null;
  meta_description: string | null;
  status: PostStatus;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostMutationInput {
  title: string;
  slug?: string;
  coverImage?: string | null;
  contentJson: EditorDocument;
  contentHtml: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  status: PostStatus;
  locale?: PostLocale;
  sourcePostId?: string;
}

export interface PostAlternate {
  href: string;
  locale: PostLocale;
}
```

`src/lib/i18n.ts` exports only these small helpers:

```ts
export function isPostLocale(value: string | null | undefined): value is PostLocale;
export function localePath(locale: PostLocale): string;
export function postPath(post: Pick<Post, 'locale' | 'slug'>): string;
export function otherLocale(locale: PostLocale): PostLocale;
```

`src/lib/posts.ts` exports:

```ts
export function editorText(node: EditorNode): string;
export function hasMeaningfulContent(node: EditorNode): boolean;
export function postExcerpt(post: Pick<Post, 'content_json' | 'meta_description'>, fallback: string): string;
export function readingMinutes(node: EditorNode): number;
```

---

### Task 1: Migrate existing posts without changing their identity

**Files:**

- Create via CLI: `supabase/migrations/*_add_multilingual_posts.sql`
- Create: `tests/e2e/multilingual-posts.spec.ts`
- Modify: `src/types/cms.ts`
- Modify: `src/lib/installation.ts`
- Modify: `src/pages/api/posts/index.ts`
- Modify: `tests/e2e/editor-media.spec.ts`
- Modify: `tests/e2e/media-deletion.spec.ts`

**Interfaces:**

- Consumes: Existing `posts`, `site_settings.default_locale`, post RLS, and `authenticate()`.
- Produces: Non-null `Post.locale`, `Post.translation_group_id`, database uniqueness, and a normal POST path that explicitly stores the configured default locale.

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/e2e/multilingual-posts.spec.ts`. Sign in through the existing Admin flow, create a normal post through the current API, then query the new columns and assert they match the current site default and contain a UUID. Keep cleanup owner-scoped.

```ts
import { expect, test } from '@playwright/test';

import { admin, createOwner, deleteOwner, signInAdmin } from './support';

test('normal posts receive the configured locale and an independent translation group', async ({ page }) => {
  const owner = await createOwner('post-migration');
  const slug = `migration-${crypto.randomUUID()}`;

  try {
    const { data: settings, error: settingsError } = await admin
      .from('site_settings')
      .select('default_locale')
      .eq('id', true)
      .single();
    if (settingsError) throw settingsError;

    await signInAdmin(page, owner);
    const response = await page.request.post('/api/posts', { data: {
      contentHtml: '<p>Existing content</p>',
      contentJson: { content: [{ content: [{ text: 'Existing content', type: 'text' }], type: 'paragraph' }], type: 'doc' },
      slug,
      status: 'draft',
      title: 'Existing post shape',
    }});
    expect(response.status()).toBe(201);
    const seeded = (await response.json()).post as { id: string; slug: string; status: string; updated_at: string };

    const { data, error } = await admin
      .from('posts')
      .select('id, locale, slug, status, translation_group_id, updated_at')
      .eq('id', seeded.id)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: seeded.id,
      locale: settings.default_locale,
      slug: seeded.slug,
      status: seeded.status,
      updated_at: seeded.updated_at,
    });
    expect(data?.translation_group_id).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});
```

Run:

```bash
rtk npm run test:e2e -- tests/e2e/multilingual-posts.spec.ts --project=desktop
```

Expected: FAIL because `locale` and `translation_group_id` do not exist.

- [ ] **Step 2: Generate and fill the safe migration**

Run:

```bash
rtk npx supabase migration new add_multilingual_posts
```

Put the following SQL in the generated file:

```sql
create temporary table posts_multilingual_snapshot as
select
  id,
  title,
  slug,
  cover_image,
  content_json,
  content_html,
  meta_title,
  meta_description,
  status,
  published_at,
  author_id,
  created_at,
  updated_at
from public.posts;

alter table public.posts add column locale text;
alter table public.posts add column translation_group_id uuid;

alter table public.posts disable trigger posts_set_timestamps;

update public.posts
set
  locale = coalesce(
    (select default_locale from public.site_settings where id = true),
    'th'
  ),
  translation_group_id = gen_random_uuid()
where locale is null or translation_group_id is null;

alter table public.posts enable trigger posts_set_timestamps;

alter table public.posts
  alter column locale set not null,
  alter column translation_group_id set default gen_random_uuid(),
  alter column translation_group_id set not null;

alter table public.posts
  add constraint posts_locale_check check (locale in ('th', 'en')),
  drop constraint if exists posts_slug_key,
  add constraint posts_locale_slug_key unique (locale, slug),
  add constraint posts_translation_group_locale_key unique (translation_group_id, locale);

create index posts_public_locale_published_idx
  on public.posts (locale, published_at desc)
  where status = 'published';

do $$
begin
  if (select count(*) from public.posts) <> (select count(*) from posts_multilingual_snapshot)
    or exists (
      select 1
      from public.posts as post
      join posts_multilingual_snapshot as snapshot using (id)
      where row(
        post.title,
        post.slug,
        post.cover_image,
        post.content_json,
        post.content_html,
        post.meta_title,
        post.meta_description,
        post.status,
        post.published_at,
        post.author_id,
        post.created_at,
        post.updated_at
      ) is distinct from row(
        snapshot.title,
        snapshot.slug,
        snapshot.cover_image,
        snapshot.content_json,
        snapshot.content_html,
        snapshot.meta_title,
        snapshot.meta_description,
        snapshot.status,
        snapshot.published_at,
        snapshot.author_id,
        snapshot.created_at,
        snapshot.updated_at
      )
    )
  then
    raise exception 'Multilingual migration changed existing post data.';
  end if;
end;
$$;

drop table posts_multilingual_snapshot;
```

Disable only `posts_set_timestamps` around the backfill so adding the two new values does not rewrite `updated_at`; the transaction restores the trigger and rolls back fully if its preservation assertion fails. Do not add a fixed database default for `locale`; the installed default is resolved by the authenticated server API. Before applying this migration to production, make and verify the Postgres backup required by the deployment runbook. The final migration verification must also be run against a disposable copy of a pre-change database containing both draft and published posts.

- [ ] **Step 3: Add locale-aware generated-style types**

Add the shared `POST_LOCALES`, `PostLocale`, `Post.locale`, `Post.translation_group_id`, `PostMutationInput` fields, and `PostAlternate` shown above. Add required `locale` and optional `translation_group_id` to `PostInsert`; let `PostUpdate` inherit both but never expose locale/group mutations through the HTTP update schema.

Keep `Database['public']['Tables']['posts']` mapped through the existing `PostRow`, `DatabasePostInsert`, and `DatabasePostUpdate` aliases.

- [ ] **Step 4: Make normal post creation store the configured default locale**

Import `getSiteSettings` in `src/pages/api/posts/index.ts`. Extend `postValues` with server-owned values rather than accepting locale from the regular client payload:

```ts
function postValues(
  input: z.infer<typeof postSchema>,
  serverValues: { authorId?: string; locale?: PostLocale; translationGroupId?: string } = {},
): PostInsert | PostUpdate {
  const generatedSlug = slugify(input.slug || input.title, { lower: true, strict: true, trim: true });
  return {
    ...(serverValues.authorId ? { author_id: serverValues.authorId } : {}),
    ...(serverValues.locale ? { locale: serverValues.locale } : {}),
    ...(serverValues.translationGroupId ? { translation_group_id: serverValues.translationGroupId } : {}),
    title: input.title,
    slug: generatedSlug || `post-${crypto.randomUUID().slice(0, 8)}`,
    cover_image: input.coverImage || null,
    content_json: input.contentJson,
    content_html: sanitizeHtml(input.contentHtml, sanitizeOptions),
    meta_title: input.metaTitle || null,
    meta_description: input.metaDescription || null,
    status: input.status,
  };
}
```

In `POST`, load settings and insert with `locale: settings.default_locale`. Return `500` with `The site settings could not be loaded.` when settings are absent; do not silently guess for new content.

```ts
const settings = await getSiteSettings();
if (!settings) {
  return Response.json({ error: 'The site settings could not be loaded.' }, { status: 500 });
}

const values = postValues(parsed.data, {
  authorId: auth.user.id,
  locale: settings.default_locale,
});
```

- [ ] **Step 5: Make readiness and existing fixtures understand the columns**

Change the readiness probe for `posts` from `select('id')` to:

```ts
supabase.from('posts').select('id, locale, translation_group_id', { head: true });
```

Add `locale: 'th'` to each direct post insert in `tests/e2e/editor-media.spec.ts` and `tests/e2e/media-deletion.spec.ts`. Do not add `translation_group_id`; its database default must cover new direct fixtures.

- [ ] **Step 6: Apply and verify without resetting local data**

```bash
rtk npx supabase migration up --local
rtk npx supabase migration list --local
rtk npx supabase db lint --local
rtk npm run test:e2e -- tests/e2e/multilingual-posts.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/media-deletion.spec.ts --project=desktop
rtk npm run check
```

Expected: migration and lint pass; old-shape data is preserved; existing fixtures work with explicit locale; normal API creation stores the configured default.

- [ ] **Step 7: Commit the persistence slice**

```bash
rtk git add supabase/migrations/*_add_multilingual_posts.sql src/types/cms.ts src/lib/installation.ts src/pages/api/posts/index.ts tests/e2e/multilingual-posts.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/media-deletion.spec.ts
rtk git commit -m "feat: add multilingual post persistence"
```

---

### Task 2: Create and protect linked language editions

**Files:**

- Create: `src/lib/i18n.ts`
- Create: `src/lib/posts.ts`
- Modify: `src/pages/api/posts/index.ts`
- Modify: `tests/e2e/multilingual-posts.spec.ts`

**Interfaces:**

- Consumes: Locale/group schema, `PostMutationInput`, authenticated post API, and current HTML sanitation.
- Produces: The `i18n.ts`/`posts.ts` functions listed under Shared Interfaces and a POST contract that accepts only `{ locale, sourcePostId }` for translated editions.

- [ ] **Step 1: Extend the API test with failing translation and validation cases**

Add a request helper and assertions for server-derived groups, duplicate editions, same-slug cross-locale support, foreign source IDs, and empty published content:

```ts
const draftBody = (title: string, slug: string) => ({
  contentHtml: '<p>Draft body</p>',
  contentJson: { content: [{ content: [{ text: 'Draft body', type: 'text' }], type: 'paragraph' }], type: 'doc' },
  slug,
  status: 'draft',
  title,
});

const sourceResponse = await page.request.post('/api/posts', {
  data: draftBody('Thai source', sharedSlug),
});
const source = (await sourceResponse.json()).post as Post;

const translationResponse = await page.request.post('/api/posts', {
  data: {
    ...draftBody('English edition', sharedSlug),
    locale: source.locale === 'th' ? 'en' : 'th',
    sourcePostId: source.id,
  },
});
expect(translationResponse.status()).toBe(201);
const translation = (await translationResponse.json()).post as Post;
expect(translation.translation_group_id).toBe(source.translation_group_id);
expect(translation.locale).not.toBe(source.locale);

const duplicate = await page.request.post('/api/posts', {
  data: {
    ...draftBody('Duplicate edition', `duplicate-${crypto.randomUUID()}`),
    locale: translation.locale,
    sourcePostId: source.id,
  },
});
expect(duplicate.status()).toBe(409);
```

Create a second owner and assert using their post as `sourcePostId` returns `404`. Send `locale: 'fr'` and expect `400`. Send `coverImage: 'javascript:alert(1)'` and expect `400`. Send `status: 'published'` with `<p></p>`/an empty document and expect `400` with `Add content before publishing.`.

Run the test and confirm the first translation request fails.

- [ ] **Step 2: Add minimal locale and post-content helpers**

Create `src/lib/i18n.ts`:

```ts
import type { Post, PostLocale } from '../types/cms';
import { POST_LOCALES } from '../types/cms';

export function isPostLocale(value: string | null | undefined): value is PostLocale {
  return POST_LOCALES.some((locale) => locale === value);
}

export const localePath = (locale: PostLocale) => `/${locale}`;
export const postPath = (post: Pick<Post, 'locale' | 'slug'>) => `/${post.locale}/blog/${encodeURIComponent(post.slug)}`;
export const otherLocale = (locale: PostLocale): PostLocale => locale === 'th' ? 'en' : 'th';
```

Create `src/lib/posts.ts`:

```ts
import type { EditorNode, Post } from '../types/cms';

const BLOCKS = new Set(['blockquote', 'bulletList', 'doc', 'listItem', 'orderedList']);

export function editorText(node: EditorNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(editorText).join(BLOCKS.has(node.type ?? '') ? ' ' : '');
}

export function hasMeaningfulContent(node: EditorNode) {
  if (node.type === 'image') return true;
  if (typeof node.text === 'string' && node.text.trim()) return true;
  return (node.content ?? []).some(hasMeaningfulContent);
}

export function postExcerpt(post: Pick<Post, 'content_json' | 'meta_description'>, fallback: string) {
  if (post.meta_description) return post.meta_description;
  const text = editorText(post.content_json).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text) : fallback;
}

export function readingMinutes(node: EditorNode) {
  const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(editorText(node))]
    .filter((segment) => segment.isWordLike)
    .length;
  return Math.max(1, Math.ceil(words / 200));
}
```

Add a direct assertion using Thai text without spaces so the built-in `Intl.Segmenter` path cannot regress to whitespace-only counting.
Also assert `hasMeaningfulContent` rejects an empty paragraph but accepts an image-only document; images are valid editorial content.

- [ ] **Step 3: Split create and update validation without exposing group IDs**

Replace the current unrestricted `nullableUrl` with the HTTP/HTTPS version below, keep the remaining common `postSchema` fields, then add a publishability issue and separate create/update schemas:

```ts
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Use an HTTP or HTTPS URL.');
const nullableUrl = z.union([httpUrl, z.literal(''), z.null()]).optional();

const publishablePostSchema = postSchema.superRefine(({ contentJson, status }, context) => {
  if (status === 'published' && !hasMeaningfulContent(contentJson)) {
    context.addIssue({ code: 'custom', message: 'Add content before publishing.', path: ['contentJson'] });
  }
});

const createSchema = publishablePostSchema.safeExtend({
  locale: z.enum(POST_LOCALES).optional(),
  sourcePostId: z.uuid().optional(),
}).superRefine(({ locale, sourcePostId }, context) => {
  if (Boolean(locale) !== Boolean(sourcePostId)) {
    context.addIssue({ code: 'custom', message: 'A translated edition requires both locale and sourcePostId.' });
  }
});

const updateSchema = publishablePostSchema.safeExtend({ id: z.uuid() });
```

Do not add locale or source fields to `updateSchema`; an edition cannot change language or group after creation.

- [ ] **Step 4: Resolve translation ownership and group on the server**

For a translated create, select only the owned source fields needed by the insert:

```ts
const { data: source, error } = await auth.supabase
  .from('posts')
  .select('cover_image, locale, translation_group_id')
  .eq('id', parsed.data.sourcePostId)
  .eq('author_id', auth.user.id)
  .maybeSingle();
if (error) return databaseError(error);
if (!source) return Response.json({ error: 'Post not found.' }, { status: 404 });
if (source.locale === parsed.data.locale) {
  return Response.json({ error: 'That language edition already exists.' }, { status: 409 });
}

const values = postValues(
  {
    ...parsed.data,
    coverImage: parsed.data.coverImage === undefined ? source.cover_image : parsed.data.coverImage,
  },
  {
    authorId: auth.user.id,
    locale: parsed.data.locale,
    translationGroupId: source.translation_group_id,
  },
);
```

For a normal create, reject a supplied `locale` without `sourcePostId` through the schema and continue to derive the default from settings. Map constraint errors precisely:

```ts
if (error.code === '23505' && error.message.includes('posts_translation_group_locale_key')) {
  return Response.json({ error: 'That language edition already exists.' }, { status: 409 });
}
if (error.code === '23505') {
  return Response.json({ error: 'A post with this slug already exists in this language.' }, { status: 409 });
}
```

- [ ] **Step 5: Verify API, constraints, and existing post behavior**

```bash
rtk npm run test:e2e -- tests/e2e/multilingual-posts.spec.ts --project=desktop
rtk npm run test:e2e -- tests/e2e/editor-media.spec.ts tests/e2e/media-deletion.spec.ts --project=desktop
rtk npm run check
```

Expected: translations share a server-derived group, cross-locale slugs work, duplicates/foreign sources fail safely, published empty content is rejected, and existing Admin saves still pass.

- [ ] **Step 6: Commit the language-edition API**

```bash
rtk git add src/lib/i18n.ts src/lib/posts.ts src/pages/api/posts/index.ts tests/e2e/multilingual-posts.spec.ts
rtk git commit -m "feat: create linked post translations"
```

---

### Task 3: Serve localized pages, redirects, and multilingual SEO

**Files:**

- Create: `src/components/blog/PostArticle.astro`
- Create: `src/pages/[locale]/index.astro`
- Create: `src/pages/[locale]/blog/[slug].astro`
- Modify: `src/components/blog/SEOHead.astro`
- Modify: `src/components/blog/Header.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/blog/[slug].astro`
- Modify: `src/pages/sitemap.xml.ts`
- Modify: `tests/e2e/public-blog.spec.ts`

**Interfaces:**

- Consumes: `Post`, `PostAlternate`, `isPostLocale`, `localePath`, `postPath`, `postExcerpt`, and service-role site settings.
- Produces: Public locale indexes/articles, reusable `PostArticle`, locale-aware `BaseLayout`, legacy redirects, canonical/alternate metadata, and sitemap URLs consumed by Plans 2 and 3.

- [ ] **Step 1: Rewrite the public regression as a failing locale contract**

Keep the current sanitation, structured-data, robots, sitemap, and no-JavaScript assertions. Seed a published source and published sibling through the authenticated API, then assert:

```ts
const rootResponse = await publicPage.request.get('/', { maxRedirects: 0 });
expect(rootResponse.status()).toBe(302);
await publicPage.goto('/');
await expect(publicPage).toHaveURL(new RegExp(`/${defaultLocale}/?$`));

await publicPage.goto(`/${source.locale}/blog/${source.slug}`);
await expect(publicPage.locator('html')).toHaveAttribute('lang', source.locale);
await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute(
  'href',
  new RegExp(`/${source.locale}/blog/${source.slug}$`),
);
await expect(publicPage.locator(`link[rel="alternate"][hreflang="${sibling.locale}"]`))
  .toHaveAttribute('href', new RegExp(`/${sibling.locale}/blog/${sibling.slug}$`));

const legacy = await publicPage.request.get(`/blog/${source.slug}`, { maxRedirects: 0 });
expect(legacy.status()).toBe(301);
expect(legacy.headers().location).toBe(`/${source.locale}/blog/${source.slug}`);
```

Unpublish the sibling and assert both its public route and its switcher/`hreflang` entry disappear. Temporarily change the site default, wait 5.1 seconds for the existing settings cache, assert a legacy slug absent in the new default still falls back to its published original locale, then restore the setting in `finally` and wait for the cache again so later tests do not inherit it.

Run:

```bash
rtk npm run test:e2e -- tests/e2e/public-blog.spec.ts --project=desktop
```

Expected: FAIL because locale routes do not exist.

- [ ] **Step 2: Make SEO and the base layout accept explicit locale context**

Add to `SEOHead.astro`:

```astro
interface AlternateLink {
  href: string;
  hreflang: 'th' | 'en' | 'x-default';
}

interface Props {
  title: string;
  description: string;
  canonical: string;
  author?: string;
  image?: string | null;
  imageAlt?: string;
  locale?: 'th' | 'en';
  modifiedTime?: string | null;
  publishedTime?: string | null;
  robots?: string;
  siteName?: string;
  structuredData?: Record<string, unknown>;
  type?: 'article' | 'website';
  alternates?: AlternateLink[];
}

{alternates?.map(({ href, hreflang }) => (
  <link rel="alternate" hreflang={hreflang} href={href} />
))}
```

Extend `BaseLayout.astro` props with:

```ts
type AlternateLink = { href: string; hreflang: 'th' | 'en' | 'x-default' };

interface Props {
  title?: string;
  description?: string;
  headline?: string;
  image?: string | null;
  modifiedTime?: string | null;
  publishedTime?: string | null;
  robots?: string;
  type?: 'article' | 'website';
  alternates?: PostAlternate[];
  canonicalPath?: string;
  locale?: PostLocale;
  xDefaultHref?: string;
}
```

Use the explicit locale for `<html lang>`, `og:locale`, and structured-data `inLanguage`. Build canonical from `canonicalPath ?? Astro.url.pathname`. Convert the shared route shape once:

```ts
const seoAlternates: AlternateLink[] = [
  ...(alternates ?? []).map(({ href, locale }) => ({
    href: new URL(href, siteUrl).toString(),
    hreflang: locale,
  })),
  ...(xDefaultHref
    ? [{ href: new URL(xDefaultHref, siteUrl).toString(), hreflang: 'x-default' as const }]
    : []),
];
```

Pass `seoAlternates` to `SEOHead` and the original `PostAlternate[]` to `Header`; footer Writing links use `localePath(locale)`.

Update `Header.astro` to accept `locale` and `availableLocales: PostAlternate[]`. Render only those entries and mark the current locale with `aria-current="page"`. Index pages pass both `/th` and `/en`; article pages pass only published editions.

- [ ] **Step 3: Extract the reusable server-only article body**

Move article date/excerpt/body markup out of the legacy route into `PostArticle.astro` with this contract:

```astro
---
import { localePath } from '../../lib/i18n';
import type { Post, SiteSettings } from '../../types/cms';

interface Props {
  post: Post;
  preview?: boolean;
  settings: SiteSettings;
}

const { post, preview = false, settings } = Astro.props;
const formatter = new Intl.DateTimeFormat(post.locale === 'th' ? 'th-TH' : 'en', {
  day: 'numeric',
  month: 'long',
  timeZone: settings.timezone,
  year: 'numeric',
});
---
```

Render the existing title, optional description, dates, cover, and sanitized `content_html`. The All posts link goes to `localePath(post.locale)`. When `preview` is true, label `updated_at` as `Last saved` instead of presenting a draft as published. Language selection belongs to the shared public Header so it is not duplicated inside the article. Do not add a hydration directive.

- [ ] **Step 4: Add localized index and article routes**

In both new routes, reject unsupported locale values before querying:

```astro
const localeValue = Astro.params.locale;
if (!isPostLocale(localeValue)) {
  Astro.response.status = 404;
}
```

`src/pages/[locale]/index.astro` selects published posts with `.eq('locale', locale).eq('status', 'published')`, orders by `published_at desc`, and changes every article link to `postPath(post)`. Pass both locale-index alternatives to `BaseLayout` and use locale-aware date formatting.

`src/pages/[locale]/blog/[slug].astro` selects by locale, slug, and `published`; then selects `locale, slug` for published rows in the same `translation_group_id`. Build `availableLocales: PostAlternate[]`, set `xDefaultHref` only when that list contains the configured default locale, and render:

```astro
<BaseLayout
  alternates={availableLocales}
  canonicalPath={postPath(post)}
  description={postExcerpt(post, fallbackDescription)}
  headline={post.title}
  image={post.cover_image}
  locale={post.locale}
  modifiedTime={post.updated_at}
  publishedTime={post.published_at ?? post.created_at}
  title={post.meta_title ?? post.title}
  type="article"
  xDefaultHref={xDefaultHref}
>
  <PostArticle post={post} settings={settings} />
</BaseLayout>
```

For an unpublished/missing row, return `404` and `noindex, follow` using the requested valid locale.

- [ ] **Step 5: Replace root and legacy pages with redirects**

`src/pages/index.astro` becomes:

```astro
---
import { getSiteSettings } from '../lib/installation';
import { localePath } from '../lib/i18n';

const settings = await getSiteSettings();
return Astro.redirect(localePath(settings?.default_locale ?? 'th'), 302);
---
```

`src/pages/blog/[slug].astro` loads settings, queries a published default-locale match first, and queries the other locale only when the first query returns no row. Return `301` to `postPath(post)` or render the existing noindex 404 state when neither exists. Never redirect to a draft.

- [ ] **Step 6: Make the sitemap locale-aware**

Select `locale, slug, updated_at` and build:

```ts
const entries = [
  { location: new URL('/th', siteUrl).toString() },
  { location: new URL('/en', siteUrl).toString() },
  ...posts.map((post) => ({
    lastModified: post.updated_at,
    location: new URL(postPath(post), siteUrl).toString(),
  })),
];
```

Retain the current XML escaping, cache headers, 1,000-post ceiling comment, and `503` failure behavior.

- [ ] **Step 7: Verify public behavior and zero JavaScript**

```bash
rtk npm run test:e2e -- tests/e2e/public-blog.spec.ts --project=desktop
rtk npm run check
rtk npm run build
```

Expected: localized indexes/articles render, only published siblings appear, legacy links redirect, canonical/alternate/sitemap output is correct, and the existing raw-HTML assertion finds no application module scripts or Astro islands.

- [ ] **Step 8: Commit the public multilingual slice**

```bash
rtk git add src/components/blog/SEOHead.astro src/components/blog/Header.astro src/components/blog/PostArticle.astro src/layouts/BaseLayout.astro src/pages/index.astro 'src/pages/[locale]/index.astro' 'src/pages/[locale]/blog/[slug].astro' 'src/pages/blog/[slug].astro' src/pages/sitemap.xml.ts tests/e2e/public-blog.spec.ts
rtk git commit -m "feat: serve localized public posts"
```

---

## Plan 1 Completion Gate

Run from a local stack with pending migrations applied:

```bash
rtk npm run check
rtk npm run build
rtk npm run test:e2e -- tests/e2e/multilingual-posts.spec.ts tests/e2e/public-blog.spec.ts tests/e2e/editor-media.spec.ts tests/e2e/media-deletion.spec.ts --project=desktop
rtk git diff --check
rtk git status --short
```

Do not start Plan 2 until existing posts are preserved, owner isolation passes, normal/translated creation is server-derived, and the locale-prefixed public routes are green.
