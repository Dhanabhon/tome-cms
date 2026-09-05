# TomeCMS Editor, Translations, and Draft Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing editor into a focused Medium-like writing workspace with safe autosave, TH/EN edition switching, on-demand post settings, and an authenticated latest-draft Preview.

**Architecture:** Keep Tiptap, current media behavior, and the existing post API. Server-rendered new/edit routes resolve locale and sibling metadata, while `Editor` owns one serialized save queue used by autosave, language navigation, Preview, and Publish. Preview opens a same-origin pending tab synchronously, saves the newest draft, then navigates that tab to an owner-scoped route that reuses the public `PostArticle` renderer.

**Tech Stack:** Astro 5 SSR, React 18, TypeScript strict mode, Novel/Tiptap, Supabase Auth/Postgres/RLS, native HTML dialog, existing Media Picker, Tailwind/global CSS, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-05-multilingual-admin-publishing-design.md`](../specs/2026-09-05-multilingual-admin-publishing-design.md)

## Global Constraints

- Complete `2026-09-05-multilingual-data-and-public-routes.md` and `2026-09-05-admin-shell-profile-settings.md` first.
- Run every shell command through `rtk` in this repository.
- Preserve all existing working-tree changes, especially the current Tiptap, Media Picker, slash-command, formatting-bubble, and focused-line block insertion behavior.
- Keep the editor outside the Admin sidebar shell.
- Keep autosave as the sole draft-save UI. Preview, Publish, and language navigation must flush the same queue; do not create parallel save paths.
- A missing translation is manual and empty except for an optional copied cover; do not copy prose/SEO or add AI translation.
- Publishing one locale must not publish its sibling.
- Preview must require authentication/ownership, render persisted data, and carry `noindex, nofollow`; do not add share tokens.
- Reuse the Plan 1 `PostArticle` and Plan 2 public Profile resolver.
- Follow `DESIGN.md` and `DESIGN-TOKENS.json`; do not copy Medium branding.
- Add no dependencies and do not introduce global editor state.
- Run focused tests before each commit and stage only the listed files or reviewed hunks.

## File Map

| Path | Action | Responsibility |
| --- | --- | --- |
| `src/types/cms.ts` | Modify | Add the compact language-edition summary passed to the editor. |
| `src/pages/admin/new.astro` | Modify | Resolve normal/default or missing-translation editor context server-side. |
| `src/pages/admin/edit/[id].astro` | Modify | Load an owned edition and all owned siblings for the locale switcher. |
| `src/pages/admin/index.astro` | Modify | Activate missing-translation and Preview row links after their routes exist. |
| `src/components/admin/Editor.tsx` | Modify | Own locale navigation, latest-draft state, serialized saves, top bar, Preview, and Publish. |
| `src/components/admin/PostSettingsDrawer.tsx` | Create | Hold cover, slug, and SEO controls in one accessible on-demand drawer. |
| `src/pages/admin/preview/pending.astro` | Create | Give the synchronously opened tab loading/failure/retry UI. |
| `src/pages/admin/preview/[id].astro` | Create | Authenticate, owner-scope, and render the saved draft with shared article UI. |
| `src/layouts/AdminLayout.astro` | Modify | Accept the post locale for Preview HTML and remove superseded editor compatibility props. |
| `src/components/blog/PostArticle.astro` | Reuse | Render the same article body in public and preview routes; no duplicate markup. |
| `src/styles/global.css` | Modify | Add focused canvas, top bar, locale switcher, settings drawer, preview banner, and responsive states. |
| `tests/e2e/editor-workflow.spec.ts` | Create | Cover edition creation/switching, serialized autosave, drawer behavior, Preview, ownership, and mobile layout. |
| `tests/e2e/editor-media.spec.ts` | Modify | Open the new settings drawer for cover tests and stop relying on Save draft. |
| `package.json` | Modify | Add one focused publishing E2E script using the existing Playwright dependency. |
| `README.md` | Modify | Document Admin routes, manual translations, Preview, and verification commands. |

## Shared Interfaces

Add to `src/types/cms.ts`:

```ts
export interface PostTranslationSummary {
  id: string;
  locale: PostLocale;
  status: PostStatus;
  title: string;
}
```

Use this editor boundary and do not pass raw translation-group IDs to the browser:

```ts
interface EditorSourcePost {
  coverImage: string | null;
  id: string;
}

interface EditorProps {
  initialPost?: Post;
  locale: PostLocale;
  sourcePost?: EditorSourcePost;
  translations: PostTranslationSummary[];
}
```

The editor's save function is the one imperative contract shared by autosave, navigation, Preview, and Publish:

```ts
type PersistPost = (status: PostStatus) => Promise<Post>;
```

---

### Task 1: Resolve language editions before hydrating the editor

**Files:**

- Modify: `src/types/cms.ts`
- Modify: `src/pages/admin/new.astro`
- Modify: `src/pages/admin/edit/[id].astro`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/components/admin/Editor.tsx`
- Create: `tests/e2e/editor-workflow.spec.ts`

**Interfaces:**

- Consumes: Locale-aware post API/schema, `POST_LOCALES`, `isPostLocale`, default site locale, and authenticated owner queries.
- Produces: `PostTranslationSummary`, the exact `EditorProps` contract above, server-validated translation entry, and a TH/EN editor switcher.

- [ ] **Step 1: Write failing new/edit locale-context tests**

Create `editor-workflow.spec.ts`. Sign in, create a saved source, and verify its edit page shows the current locale and a labelled add action for the missing locale. Open `/admin/new?sourcePostId=<id>&locale=<other>` and assert the new editor starts blank, keeps the source cover, and identifies the target locale.

```ts
await page.goto(`/admin/edit/${source.id}`);
await expect(page.getByRole('navigation', { name: 'Post languages' }))
  .toContainText(source.locale.toUpperCase());
await expect(page.getByRole('navigation', { name: 'Post languages' }))
  .toContainText(`${targetLocale.toUpperCase()} missing`);

await page.goto(`/admin/new?sourcePostId=${source.id}&locale=${targetLocale}`);
await expect(page.getByLabel('Post title')).toHaveValue('');
await expect(page.getByText(`${targetLocale.toUpperCase()} draft`)).toBeVisible();
```

Assert an invalid locale, same-as-source locale, duplicate sibling locale, missing source, and another owner's source all return `404` without exposing post data.

- [ ] **Step 2: Add the summary type and editor props**

Add `PostTranslationSummary` from Shared Interfaces. Change `Editor` to require `locale` and `translations`, with optional `initialPost`/`sourcePost`. Initialize cover as:

```ts
const [coverImage, setCoverImage] = useState(
  initialPost?.cover_image ?? sourcePost?.coverImage ?? '',
);
```

Do not initialize translated title, slug, body, meta title, or meta description from the source.

- [ ] **Step 3: Resolve normal and translated new-post context on the server**

In `admin/new.astro`, authenticate exactly once and load site settings. Treat no query parameters as a normal new post using `settings.default_locale`.

When either translation parameter is present, require both a UUID `sourcePostId` and a valid `locale`. Select the source by ID and authenticated author, then reject the request when target equals source locale or an owned sibling already exists:

```ts
const { data: source, error } = await auth.supabase
  .from('posts')
  .select('cover_image, id, locale, status, title, translation_group_id')
  .eq('id', sourcePostId)
  .eq('author_id', auth.user.id)
  .maybeSingle();
if (error) throw error;

const { data: existing } = source
  ? await auth.supabase
      .from('posts')
      .select('id')
      .eq('translation_group_id', source.translation_group_id)
      .eq('locale', targetLocale)
      .eq('author_id', auth.user.id)
      .maybeSingle()
  : { data: null };
```

Return the same noindex `404` state for all invalid/missing/foreign/duplicate cases. Pass only `{ id, coverImage }` as `sourcePost`; never serialize `translation_group_id`. Pass the source as the sole `PostTranslationSummary` so the unsaved target editor can navigate back to it.

- [ ] **Step 4: Load sibling summaries for edit context**

After loading the owned post in `admin/edit/[id].astro`, query:

```ts
const { data: translations, error: translationsError } = await auth.supabase
  .from('posts')
  .select('id, locale, status, title')
  .eq('translation_group_id', post.translation_group_id)
  .eq('author_id', auth.user.id)
  .order('locale');
```

Pass `initialPost`, `locale={post.locale}`, and `translations` to `Editor`. A normal new editor receives `translations={[]}` until its first save; a translated new editor receives the source summary.

- [ ] **Step 5: Render a top-bar language switcher without navigating yet**

For this data-context task, render only the current locale and existing sibling statuses inside `<nav aria-label="Post languages">`; do not expose navigation or Add controls until Task 2 can protect them with save-before-navigation. The current locale uses `aria-current="page"`.

After the first translated POST in Task 2, add the returned post to the local summaries and replace browser history with `/admin/edit/:id`, as the current editor already does for ordinary new posts.

Now that the validated translation route exists, replace each text-only `TH missing` or `EN missing` indicator on the Posts screen with `/admin/new?sourcePostId=<row-id>&locale=<missing-locale>`.

- [ ] **Step 6: Verify and commit route context**

```bash
rtk npm run test:e2e -- tests/e2e/editor-workflow.spec.ts --project=desktop --grep "language context"
rtk npm run check
rtk git add src/types/cms.ts src/pages/admin/new.astro 'src/pages/admin/edit/[id].astro' src/pages/admin/index.astro src/components/admin/Editor.tsx tests/e2e/editor-workflow.spec.ts
rtk git commit -m "feat: add editor language context"
```

---

### Task 2: Build the focused canvas, settings drawer, and single save queue

**Files:**

- Create: `src/components/admin/PostSettingsDrawer.tsx`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/editor-workflow.spec.ts`
- Modify: `tests/e2e/editor-media.spec.ts`

**Interfaces:**

- Consumes: Existing editor fields, upload/picker behavior, language context, and authenticated post API.
- Produces: One `persist(status): Promise<Post>` queue, Medium-like top bar/canvas, save-before-navigation, and an accessible settings drawer.

Initialize the mutable summaries once inside `Editor` and render the switcher from this state:

```ts
const [languageEditions, setLanguageEditions] = useState(translations);
const dirtyRef = useRef(false);
const postStatusRef = useRef<PostStatus>(initialPost?.status ?? 'draft');

type SaveState = 'Saved' | 'Saving…' | 'Unsaved' | 'Save failed';
```

Update both React state and the matching ref in `markDirty()` and after every successful save; asynchronous actions read the refs.

- [ ] **Step 1: Add failing focused-editor and race tests**

Assert the editor has no Admin sidebar, no `Save draft` button, a centered writing measure no wider than 760px, and a Settings button. Open Settings; assert Slug, Meta title, Meta description, cover controls, initial focus, Escape dismissal, and focus restoration. Update existing cover tests to open Settings before interacting with these controls and wait for `Saved` instead of clicking Save draft.

For serialization, delay the first `/api/posts` request, type newer text while it is pending, trigger language navigation, release the request, and assert the stored post contains the newest text before URL navigation.

```ts
await page.route('**/api/posts', async (route) => {
  if (route.request().method() === 'PUT' && firstSave) {
    firstSave = false;
    await releaseFirstSave;
  }
  return route.continue();
});

await editor.fill('First version');
await expect(page.getByText('Saving…')).toBeVisible();
await editor.fill('Newest version');
await page.getByRole('button', { name: /Edit EN translation|Add EN translation/ }).click();
releaseSave();
```

- [ ] **Step 2: Move settings into one focused component**

Create `PostSettingsDrawer.tsx` with this state boundary:

```ts
interface PostSettingsDrawerProps {
  coverAsset: MediaAsset | null;
  coverImage: string;
  metaDescription: string;
  metaTitle: string;
  onChangeMetaDescription: (value: string) => void;
  onChangeMetaTitle: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onChooseCover: (asset: MediaAsset) => void;
  onClose: () => void;
  onRemoveCover: () => void;
  onUploadCover: (file: File, input: HTMLInputElement) => Promise<void>;
  open: boolean;
  slug: string;
  uploadingCover: boolean;
}
```

Use a native `<dialog aria-label="Post settings">`, `showModal()`, `onCancel`, and a close button with initial focus. Save the opener before opening and restore it after close. Keep Media Picker selection and direct upload on the existing shared paths; the drawer owns only presentation and field callbacks.

- [ ] **Step 3: Make the editor draft available through a ref**

Define the current request body once:

```ts
interface EditorDraft {
  contentHtml: string;
  contentJson: JSONContent;
  coverImage: string | null;
  metaDescription: string | null;
  metaTitle: string | null;
  slug: string;
  title: string;
}

const draftRef = useRef<EditorDraft>({
  contentHtml,
  contentJson,
  coverImage: coverImage || null,
  metaDescription: metaDescription || null,
  metaTitle: metaTitle || null,
  slug,
  title,
});
draftRef.current = {
  contentHtml,
  contentJson,
  coverImage: coverImage || null,
  metaDescription: metaDescription || null,
  metaTitle: metaTitle || null,
  slug,
  title,
};
```

Declare this ref after the field state declarations. Do not use `any`. Keep `postId`, source ID, current status, dirty state, and change version in refs when asynchronous callbacks need the latest value.

- [ ] **Step 4: Replace competing saves with one promise chain**

Replace the current `saveInFlight` gate with:

```ts
const saveTail = useRef<Promise<Post | null>>(Promise.resolve(initialPost ?? null));

const persist = useCallback((status: PostStatus): Promise<Post> => {
  const pending = saveTail.current.catch(() => null).then(async () => {
    const draft = draftRef.current;
    if (!draft.title.trim()) throw new Error('Add a title before saving.');

    const version = changeVersion.current;
    setSaveState('Saving…');
    setErrorMessage(null);

    const id = postId.current;
    const response = await fetch('/api/posts', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(id ? { id } : {}),
        ...(!id && sourcePost ? { locale, sourcePostId: sourcePost.id } : {}),
        ...draft,
        status,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(readApiError(payload) ?? 'The post could not be saved.');
    const saved = readPost(payload);
    if (!saved) throw new Error('The server returned an invalid post.');

    const wasNew = !postId.current;
    postId.current = saved.id;
    postStatusRef.current = saved.status;
    setPostStatus(saved.status);
    setSlug(saved.slug);
    setLanguageEditions((current) => [
      ...current.filter((edition) => edition.locale !== saved.locale),
      { id: saved.id, locale: saved.locale, status: saved.status, title: saved.title },
    ].sort((left, right) => left.locale.localeCompare(right.locale)));
    if (wasNew) window.history.replaceState({}, '', `/admin/edit/${saved.id}`);
    if (version === changeVersion.current) {
      dirtyRef.current = false;
      setDirty(false);
      setSaveState('Saved');
    } else {
      setSaveState('Unsaved');
    }
    return saved;
  }).catch((error: unknown) => {
    setSaveState('Save failed');
    setErrorMessage(error instanceof Error ? error.message : 'The post could not be saved.');
    throw error;
  });

  saveTail.current = pending.catch(() => null);
  return pending;
}, [initialPost, locale, sourcePost]);
```

Autosave cancels/replaces one 900ms timer and calls `persist(postStatusRef.current)`. Callers intentionally catch rejected promises after the UI has recorded the persistent failure.

- [ ] **Step 5: Flush before language navigation and publishing**

Use one function:

```ts
const saveBefore = async (action: (post: Post) => void, status = postStatusRef.current) => {
  window.clearTimeout(autosaveTimer.current);
  try {
    const saved = await persist(status);
    action(saved);
  } catch {
    // persist owns the visible error; navigation/publish stops here.
  }
};
```

Existing-sibling buttons call `saveBefore(() => window.location.assign('/admin/edit/<id>'))`. Missing-sibling buttons require the current post ID after save, then navigate to `/admin/new?sourcePostId=<saved.id>&locale=<target>`. Publish calls `saveBefore(() => undefined, 'published')`; it changes only the current row. Remove the separate Save draft button.

- [ ] **Step 6: Apply the focused visual layout**

Keep the top bar limited to Back to Posts, post/save status, TH/EN switcher, Preview placeholder button, Settings, and Publish/Update. Set the canvas reading column to `min(100%, 46.25rem)` and remove the permanent two-column editor grid/card border. Keep title and content aligned. Preserve the current block `+` gutter behavior; do not calculate its X coordinate from pointer position.

Style the settings dialog as a right drawer on desktop and a full-screen sheet below 40rem. Reuse existing tokens, 44px touch targets, focus rings, and reduced-motion behavior.

- [ ] **Step 7: Verify and commit the focused writer**

```bash
rtk npm run test:e2e -- tests/e2e/editor-workflow.spec.ts tests/e2e/editor-media.spec.ts
rtk npm run check
rtk git add src/components/admin/PostSettingsDrawer.tsx src/components/admin/Editor.tsx src/styles/global.css tests/e2e/editor-workflow.spec.ts tests/e2e/editor-media.spec.ts
rtk git commit -m "feat: focus the post writing experience"
```

---

### Task 3: Preview the newest saved draft in an authenticated tab

**Files:**

- Create: `src/pages/admin/preview/pending.astro`
- Create: `src/pages/admin/preview/[id].astro`
- Modify: `src/layouts/AdminLayout.astro`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/components/admin/Editor.tsx`
- Modify: `src/styles/global.css`
- Modify: `tests/e2e/editor-workflow.spec.ts`

**Interfaces:**

- Consumes: `persist(status)`, authenticated post reads, `getPublicAuthorProfile()`, and `PostArticle`.
- Produces: A popup-safe pending/error handshake and owner-only persisted Draft Preview.

- [ ] **Step 1: Add failing latest-draft and authorization tests**

Type a title/body and click Preview immediately, before the 900ms autosave timer. Capture the popup and assert it eventually displays the newest body, Draft preview banner, Edit action, and noindex metadata.

```ts
const popupPromise = page.waitForEvent('popup');
await page.getByRole('button', { name: 'Preview' }).click();
const preview = await popupPromise;
await expect(preview).toHaveURL(/\/admin\/preview\/[0-9a-f-]+$/);
await expect(preview.getByText('Newest unsaved sentence')).toBeVisible();
await expect(preview.getByText('Draft preview')).toBeVisible();
await expect(preview.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
```

Use a request context without the page cookies and expect `401` for the same preview URL. Sign in owner B and expect `404`. Delay an active save, change content again, click Preview, release the request, and assert the final preview contains only the newest version.

- [ ] **Step 2: Add the same-origin pending/error page**

`pending.astro` uses `AdminLayout`, `noindex, nofollow`, and two states. Default text is `Preparing draft preview…`. When `state=save-error`, validate `returnTo` with `safeAdminReturnTo`, show `The latest draft could not be saved.`, a `Try again` button, and a Return to editor link.

The retry button sends only a fixed same-origin message to its opener:

```ts
document.querySelector('[data-preview-retry]')?.addEventListener('click', () => {
  window.opener?.postMessage({ type: 'tome-preview-retry' }, window.location.origin);
});
```

No post ID or content crosses `postMessage`.

- [ ] **Step 3: Add the owner-scoped preview route**

In `admin/preview/[id].astro`:

1. Validate the UUID; invalid is `404`.
2. Authenticate; missing session is `401`.
3. Select by both post ID and `author_id`; missing/foreign is `404`.
4. Load settings and `getPublicAuthorProfile(settings, post.locale)`.
5. Render a visible Draft preview banner, `/admin/edit/:id` action, and the shared `PostArticle`.

```astro
<AdminLayout lang={post.locale} title={`Preview: ${post.title}`}>
  <div class="admin-preview-bar">
    <strong>Draft preview</strong>
    <a class="admin-button admin-button--secondary" href={`/admin/edit/${post.id}`}>Edit post</a>
  </div>
  <PostArticle post={post} preview profile={profile} settings={settings} />
</AdminLayout>
```

Add `lang?: PostLocale` to `AdminLayout`, default it to `en`, and remove the now-unused `showHeader`/`userEmail` compatibility props after updating new/edit call sites. `AdminLayout` already supplies `noindex, nofollow`; do not use `BaseLayout` or public canonical metadata for preview.

Add Preview to each Posts-row overflow menu as an ordinary link to `/admin/preview/<id>` with `target="_blank"` and `rel="noopener noreferrer"`. The row contains persisted data, so it does not need the editor's save handshake.

- [ ] **Step 4: Make Preview synchronously open, flush, and navigate**

Add:

```ts
const previewDraft = async (target?: Window | null) => {
  const previewWindow = target ?? window.open('/admin/preview/pending', '_blank');
  if (!previewWindow) {
    setErrorMessage('Allow pop-ups for this site to open Preview.');
    return;
  }

  window.clearTimeout(autosaveTimer.current);
  try {
    const saved = await persist(postStatusRef.current);
    previewWindow.location.replace(`/admin/preview/${saved.id}`);
  } catch {
    const returnTo = postId.current ? `/admin/edit/${postId.current}` : window.location.pathname + window.location.search;
    previewWindow.location.replace(
      `/admin/preview/pending?state=save-error&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }
};
```

The Preview click calls `previewDraft()` directly inside the user event. Disable it and explain why when a new draft has no title. Register one message listener on mount:

```ts
useEffect(() => {
  const retry = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== 'tome-preview-retry') return;
    void previewDraft(event.source as Window | null);
  };
  window.addEventListener('message', retry);
  return () => window.removeEventListener('message', retry);
}, [previewDraft]);
```

This internal same-origin handshake intentionally keeps the opener relationship; external links continue using `noopener noreferrer`.

- [ ] **Step 5: Verify preview and commit**

```bash
rtk npm run test:e2e -- tests/e2e/editor-workflow.spec.ts --project=desktop --grep "preview"
rtk npm run check
rtk git add src/pages/admin/preview/pending.astro 'src/pages/admin/preview/[id].astro' src/layouts/AdminLayout.astro src/pages/admin/new.astro 'src/pages/admin/edit/[id].astro' src/pages/admin/index.astro src/components/admin/Editor.tsx src/styles/global.css tests/e2e/editor-workflow.spec.ts
rtk git commit -m "feat: preview the latest saved draft"
```

---

### Task 4: Close responsive, accessibility, documentation, and regression gaps

**Files:**

- Modify: `tests/e2e/editor-workflow.spec.ts`
- Modify: `tests/e2e/editor-media.spec.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: All completed publishing plans and the existing Playwright projects.
- Produces: One repeatable publishing test command, operator documentation, and final desktop/mobile acceptance evidence.

- [ ] **Step 1: Add the mobile/focus regression checks before final polish**

In the mobile project assert:

- Top-bar actions remain reachable without horizontal overflow.
- Settings fills the viewport, Escape closes it, and focus returns to Settings.
- Language controls have at least 44 by 44 CSS-pixel hit targets.
- Block insertion remains inside the gutter and follows the focused final paragraph after scrolling.
- Save failure is announced through `role="alert"` and `Save failed`, not color alone.

Use a reduced-motion context and assert drawer/menu transitions have a duration no greater than 150ms.

- [ ] **Step 2: Add a focused publishing script**

Add without changing existing scripts:

```json
{
  "scripts": {
    "test:e2e:publishing": "node --env-file=.env.local ./node_modules/@playwright/test/cli.js test tests/e2e/multilingual-posts.spec.ts tests/e2e/public-blog.spec.ts tests/e2e/admin-shell.spec.ts tests/e2e/site-settings.spec.ts tests/e2e/admin-posts.spec.ts tests/e2e/editor-workflow.spec.ts tests/e2e/editor-media.spec.ts"
  }
}
```

- [ ] **Step 3: Update the README to match shipped behavior**

Document:

- Admin shell routes: Posts, Media, Profile, Settings.
- Focused editor route outside the shell.
- Manual TH/EN editions and independent publication.
- Public `/<locale>` and `/<locale>/blog/<slug>` routes plus legacy redirects.
- Preview saves the newest draft and requires the owner session.
- Profile fields feed the global post author block.
- `npm run test:e2e:publishing` and the prerequisite local Supabase stack.
- Production order: back up Postgres and Storage, apply pending migrations, deploy the application, then run smoke checks. Never seed or reset production.

- [ ] **Step 4: Run the full acceptance matrix**

Stop a manually running dev server before the build/test sequence so Vite dependencies are not invalidated mid-run. Then run:

```bash
rtk npx supabase migration list --local
rtk npx supabase db lint --local
rtk npm run check
rtk npm run build
rtk npm run test:e2e:publishing
rtk npm run test:e2e:media
rtk git diff --check
rtk git status --short
```

Expected: zero Astro/TypeScript diagnostics, successful production build, all publishing and existing media regressions pass on their configured desktop/mobile projects, and only intentional files remain changed.

- [ ] **Step 5: Inspect the six required widths**

Use Playwright or the browser responsive controls at 320, 375, 414, 768, 1280, and 1440 CSS pixels. Verify Admin shell, Posts filters/list, Profile, Settings, editor, settings drawer, Preview, public indexes, and article switcher. Record a failure as a test before changing CSS.

- [ ] **Step 6: Commit only final verification/docs changes**

```bash
rtk git add package.json README.md tests/e2e/editor-workflow.spec.ts tests/e2e/editor-media.spec.ts
rtk git commit -m "test: verify multilingual publishing workflows"
```

If Step 4 or 5 exposes a source regression, return to the earlier task that owns that behavior, add a failing focused test there, and commit the fix with that task's source files before completing this documentation commit.

---

## Plan 3 Completion Gate

The feature is complete only when the single owner can create a default-language post, add the missing language manually, switch editions without losing edits, open an authenticated Preview containing the latest change, publish/unpublish editions independently, manage the resulting rows through the Admin shell, and visit correct localized public URLs with no public application JavaScript.

Do not add Stats, scheduling, unlisted posts, imports, public profiles, multi-author behavior, AI translation, side-by-side translation, version history, bulk actions, or pagination while closing this plan.
