import { type JSONContent } from 'novel';
import { useCallback, useEffect, useRef, useState } from 'react';
import slugify from 'slugify';

import { uploadImage } from '../../lib/media-client';
import { POST_LOCALES, type MediaAsset, type Post, type PostCategory, type PostLocale, type PostStatus, type PostTranslationSummary } from '../../types/cms';
import DocumentCanvas from './DocumentCanvas';
import PostSettingsDrawer from './PostSettingsDrawer';
import useEditorSaveQueue from './useEditorSaveQueue';

interface EditorSourcePost {
  coverImage: string | null;
  id: string;
}

interface EditorProps {
  categories: PostCategory[];
  initialCategoryIds: string[];
  initialPost?: Omit<Post, 'translation_group_id'>;
  locale: PostLocale;
  sourcePost?: EditorSourcePost;
  translations: PostTranslationSummary[];
}

interface EditorDraft {
  categoryIds: string[];
  contentJson: JSONContent;
  coverImage: string | null;
  metaDescription: string | null;
  metaTitle: string | null;
  slug: string;
  title: string;
}

function selectCategories(categories: PostCategory[], selected: string[]) {
  const allowed = new Set(categories.map(({ id }) => id));
  const custom = [...new Set(selected)].filter((id) => allowed.has(id) && !categories.find((item) => item.id === id)?.is_default);
  return custom.length ? custom : categories.filter(({ is_default }) => is_default).map(({ id }) => id);
}

function readApiError(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return null;
  return typeof payload.error === 'string' ? payload.error : null;
}

function readPost(payload: unknown): Post | null {
  if (typeof payload !== 'object' || payload === null || !('post' in payload)) return null;
  const post = payload.post;
  return typeof post === 'object' && post !== null && 'id' in post ? (post as Post) : null;
}

export default function Editor({ categories, initialCategoryIds, initialPost, locale, sourcePost, translations }: EditorProps) {
  const fallbackSlug = useRef(`post-${crypto.randomUUID().slice(0, 8)}`);
  const postId = useRef(initialPost?.id);
  const slugTouched = useRef(Boolean(initialPost));
  const actionPending = useRef<boolean | 'navigation'>(false);
  const postStatusRef = useRef<PostStatus>(initialPost?.status ?? 'draft');
  const autosaveTimer = useRef<number>();
  const coverOperation = useRef(0);

  const [title, setTitle] = useState(initialPost?.title ?? '');
  const [categoryIds, setCategoryIds] = useState(() => selectCategories(categories, initialCategoryIds));
  const [slug, setSlug] = useState(initialPost?.slug ?? '');
  const [coverImage, setCoverImage] = useState(
    initialPost?.cover_image ?? sourcePost?.coverImage ?? '',
  );
  const [coverAsset, setCoverAsset] = useState<MediaAsset | null>(null);
  const [metaTitle, setMetaTitle] = useState(initialPost?.meta_title ?? '');
  const [metaDescription, setMetaDescription] = useState(initialPost?.meta_description ?? '');
  const [contentJson, setContentJson] = useState<JSONContent>(initialPost?.content_json ?? { type: 'doc', content: [{ type: 'paragraph' }] });
  const [postStatus, setPostStatus] = useState<PostStatus>(initialPost?.status ?? 'draft');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageEditions, setLanguageEditions] = useState(translations);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const draftRef = useRef<EditorDraft>({
    categoryIds, contentJson, coverImage: coverImage || null,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  });
  draftRef.current = {
    categoryIds, contentJson, coverImage: coverImage || null,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  };

  const snapshot = useCallback(() => {
    const draft = draftRef.current;
    if (!draft.title.trim()) throw new Error('Add a title before saving.');
    return draft;
  }, []);

  const save = useCallback(async (draft: EditorDraft, status?: PostStatus): Promise<Post> => {
    const id = postId.current;
    const { categoryIds: selectedCategoryIds, ...contentDraft } = draft;
    const response = await fetch('/api/posts', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(id ? { id } : {}),
        ...(!id && sourcePost ? { locale, sourcePostId: sourcePost.id } : {}),
        ...contentDraft,
        status: status ?? postStatusRef.current,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(readApiError(payload) ?? 'The post could not be saved.');

    const savedPost = readPost(payload);
    if (!savedPost) throw new Error('The server returned an invalid post.');
    postId.current = savedPost.id;
    // Content already persisted: retries must keep its identity and published status.
    postStatusRef.current = savedPost.status;
    const membershipResponse = await fetch('/api/admin/posts/categories', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId: savedPost.id, categoryIds: selectedCategoryIds }),
    });
    const membershipPayload: unknown = await membershipResponse.json();
    if (!membershipResponse.ok) throw new Error(readApiError(membershipPayload) ?? 'Post Categories could not be saved.');
    setErrorMessage(null);
    if (draftRef.current.slug === draft.slug) {
      draftRef.current = { ...draftRef.current, slug: savedPost.slug };
      setSlug(savedPost.slug);
    }
    setPostStatus(savedPost.status);
    setLanguageEditions((current) => [
      ...current.filter((edition) => edition.locale !== savedPost.locale),
      { id: savedPost.id, locale: savedPost.locale, status: savedPost.status, title: savedPost.title },
    ].sort((left, right) => left.locale.localeCompare(right.locale)));

    if (!initialPost) window.history.replaceState({}, '', `/admin/edit/${savedPost.id}`);
    return savedPost;
  }, [initialPost, locale, sourcePost]);

  const handleSaveError = useCallback((error: unknown) => {
    setErrorMessage(error instanceof Error ? error.message : 'The post could not be saved.');
  }, []);

  const { dirty, dirtyRef, markDirty, pendingCount, persist, saveState } = useEditorSaveQueue({
    onError: handleSaveError,
    save,
    snapshot,
  });

  const previewDraft = useCallback(async (target?: Window | null) => {
    if (actionPending.current) return;
    const previewWindow = target ?? window.open('/admin/preview/pending', '_blank');
    if (!previewWindow) {
      setErrorMessage('Allow pop-ups for this site to open Preview.');
      return;
    }

    actionPending.current = true;
    setIsActionPending(true);
    window.clearTimeout(autosaveTimer.current);
    try {
      let saved = await persist();
      while (dirtyRef.current) saved = await persist();
      if (!previewWindow.closed) previewWindow.location.replace(`/admin/preview/${saved.id}`);
    } catch {
      const returnTo = postId.current ? `/admin/edit/${postId.current}` : window.location.pathname + window.location.search;
      if (!previewWindow.closed) previewWindow.location.replace(
        `/admin/preview/pending?state=save-error&returnTo=${encodeURIComponent(returnTo)}`,
      );
    } finally {
      actionPending.current = false;
      setIsActionPending(false);
    }
  }, [persist]);

  const restoreNavigation = useCallback(() => {
    if (actionPending.current !== 'navigation') return;
    actionPending.current = false;
    setIsActionPending(false);
    setIsNavigating(false);
  }, []);

  const cancelNavigation = useCallback(() => {
    if (actionPending.current !== 'navigation') return;
    window.stop();
    restoreNavigation();
    window.dispatchEvent(new Event('tome:navigation-cancelled'));
  }, [restoreNavigation]);

  useEffect(() => {
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    let departure = 0;
    const starting = () => { departure += 1; };
    const failed = () => {
      const cancelledDeparture = departure;
      queueMicrotask(() => {
        // A newer navigation must keep its lock. Stop any residual load before unlocking this document.
        if (cancelledDeparture === departure) cancelNavigation();
      });
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) restoreNavigation();
    };
    const retry = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tome-preview-retry' || !event.source) return;
      void previewDraft(event.source as Window);
    };
    window.addEventListener('pageshow', restore);
    window.addEventListener('message', retry);
    navigation?.addEventListener('navigate', starting);
    navigation?.addEventListener('navigateerror', failed);
    return () => {
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('message', retry);
      navigation?.removeEventListener('navigate', starting);
      navigation?.removeEventListener('navigateerror', failed);
    };
  }, [cancelNavigation, previewDraft, restoreNavigation]);

  useEffect(() => {
    if (!dirty || !title.trim() || actionPending.current) return;

    autosaveTimer.current = window.setTimeout(() => void persist().catch(() => undefined), 900);
    return () => window.clearTimeout(autosaveTimer.current);
  }, [dirty, isNavigating, persist, title, slug, contentJson, coverImage, metaDescription, metaTitle, categoryIds]);

  const saveBefore = async (action: (post: Post) => void, status?: PostStatus, leavesEditor = false) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setIsActionPending(true);
    window.clearTimeout(autosaveTimer.current);
    let completed = false;
    try {
      let saved = await persist(status);
      while (dirtyRef.current) saved = await persist(status);
      if (leavesEditor) {
        actionPending.current = 'navigation';
        setIsNavigating(true);
      }
      action(saved);
      completed = true;
    } catch {
      // persist owns the visible error; navigation/publish stops here.
    } finally {
      // Keep navigation locked while the destination loads and the opener can still receive clicks.
      if (!completed || !leavesEditor) {
        actionPending.current = false;
        setIsActionPending(false);
        setIsNavigating(false);
      }
    }
  };

  const changeTitle = (value: string) => {
    setTitle(value);
    if (!slugTouched.current) {
      setSlug(slugify(value, { lower: true, strict: true, trim: true }) || fallbackSlug.current);
    }
    markDirty();
  };

  const selectCover = async (file?: File, input?: HTMLInputElement) => {
    if (!file) return;
    const operation = ++coverOperation.current;
    setUploadingCover(true);

    try {
      const asset = await uploadImage(file);
      if (operation !== coverOperation.current) return;
      setCoverImage(asset.publicUrl);
      setCoverAsset(asset);
      markDirty();
    } catch (error) {
      if (operation === coverOperation.current) {
        setErrorMessage(error instanceof Error ? error.message : 'The cover image could not be uploaded.');
      }
    } finally {
      if (input) input.value = '';
      setUploadingCover(false);
    }
  };

  const chooseCover = (asset: MediaAsset) => {
    coverOperation.current += 1;
    setCoverImage(asset.publicUrl);
    setCoverAsset(asset);
    markDirty();
  };

  const removeCover = () => {
    coverOperation.current += 1;
    setCoverImage('');
    setCoverAsset(null);
    markDirty();
  };

  return (
    <div className="admin-editor">
      <header className="admin-editor-bar">
        <div className="admin-editor-bar__inner">
          <div className="admin-editor-bar__start">
            <a aria-disabled={isActionPending || undefined} className="admin-toolbar-link" href="/admin" onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              if (actionPending.current) {
                event.preventDefault();
                return;
              }
              if (dirtyRef.current || pendingCount.current) {
                event.preventDefault();
                void saveBefore(() => window.location.assign('/admin'), undefined, true);
              } else {
                actionPending.current = 'navigation';
                setIsActionPending(true);
                setIsNavigating(true);
              }
            }}>
              <span aria-hidden="true">←</span> Back to Posts
            </a>
            <nav className="admin-nav" aria-label="Post languages">
              {POST_LOCALES.map((language) => {
                const translation = languageEditions.find(({ locale: translationLocale }) => translationLocale === language);
                const current = language === locale;
                const label = current
                  ? `${language.toUpperCase()} ${postStatus}`
                  : translation
                    ? `${language.toUpperCase()} ${translation.status}`
                    : `${language.toUpperCase()} missing`;
                return current
                  ? <span className="admin-nav__link" aria-current="page" key={language}>{label}</span>
                  : <button aria-label={`${translation ? 'Edit' : 'Add'} ${language.toUpperCase()} translation`} className="admin-nav__link" disabled={isActionPending} key={language} onClick={() => void saveBefore((saved) => {
                    window.location.assign(translation ? `/admin/edit/${translation.id}` : `/admin/new?sourcePostId=${saved.id}&locale=${language}`);
                  }, undefined, true)} type="button">{label}</button>;
              })}
            </nav>
          </div>
          <div className="admin-editor-actions">
            <span className="admin-save-state" data-state={saveState === 'Saved' ? 'saved' : saveState === 'Saving…' ? 'saving' : 'unsaved'} aria-live="polite">
              <span aria-hidden="true">{saveState === 'Saved' ? '✓' : '·'}</span> <span>{saveState}</span>
            </span>
            {saveState === 'Save failed' && <button className="admin-button admin-button--secondary" disabled={isActionPending} onClick={() => void saveBefore(() => undefined)} type="button">Retry save</button>}
            <button aria-describedby={!postId.current && !title.trim() ? 'preview-disabled-reason' : undefined} className="admin-button admin-button--secondary" disabled={isActionPending || (!postId.current && !title.trim())} onClick={() => void previewDraft()} type="button">Preview</button>
            <span className="sr-only" id="preview-disabled-reason">Add a title before opening Preview.</span>
            <button aria-expanded={settingsOpen} aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={(event) => {
              event.currentTarget.focus();
              setSettingsOpen(true);
            }} type="button">Settings</button>
            <button className="admin-button admin-button--primary" data-state={saveState === 'Saving…' ? 'loading' : undefined} disabled={isActionPending} onClick={() => void saveBefore(() => undefined, 'published')} type="button">
              {postStatus === 'published' ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>
      </header>

      <div className="admin-editor-workspace">
        {isNavigating && <p className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted" role="status">Opening page… <button className="admin-button admin-button--secondary" onClick={cancelNavigation} type="button">Stay in editor</button></p>}
        {errorMessage && !settingsOpen && <p className="admin-alert" role="alert">{saveState === 'Save failed' && <strong>Save failed</strong>} {errorMessage}</p>}

        <article className="admin-editor-canvas">
          <label className="sr-only" htmlFor="post-title">Post title</label>
          <textarea
            className="admin-title-input"
            id="post-title"
            maxLength={200}
            onChange={(event) => changeTitle(event.target.value)}
            placeholder="Untitled post"
            rows={2}
            value={title}
          />

          <DocumentCanvas initialContent={contentJson} onChange={(nextContentJson) => {
            setContentJson(nextContentJson);
            markDirty();
          }} />
        </article>

        <PostSettingsDrawer
          categories={categories}
          coverAsset={coverAsset}
          coverImage={coverImage}
          errorMessage={errorMessage}
          metaDescription={metaDescription}
          metaTitle={metaTitle}
          onChangeCategories={(selected) => { setCategoryIds(selectCategories(categories, selected)); markDirty(); }}
          onChangeMetaDescription={(value) => { setMetaDescription(value); markDirty(); }}
          onChangeMetaTitle={(value) => { setMetaTitle(value); markDirty(); }}
          onChangeSlug={(value) => { slugTouched.current = true; setSlug(value); markDirty(); }}
          onChooseCover={chooseCover}
          onClose={() => setSettingsOpen(false)}
          onManageCategories={() => void saveBefore(() => window.location.assign('/admin/categories'), undefined, true)}
          onRemoveCover={removeCover}
          onUploadCover={selectCover}
          open={settingsOpen}
          selectedCategoryIds={categoryIds}
          slug={slug}
          uploadingCover={uploadingCover}
        />
      </div>
    </div>
  );
}
