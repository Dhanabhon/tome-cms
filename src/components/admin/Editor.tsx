import { type JSONContent } from 'novel';
import { useCallback, useEffect, useRef, useState } from 'react';
import slugify from 'slugify';

import { adminHref } from '../../lib/admin';
import { adminCopy, statusLabel } from '../../lib/admin-i18n';
import { POST_LOCALES, type MediaAsset, type Post, type PostCategory, type PostLocale, type PostStatus, type PostTranslationSummary } from '../../types/cms';
import DocumentCanvas from './DocumentCanvas';
import PostSettingsDrawer from './PostSettingsDrawer';
import createPreviewUrl from './createPreviewUrl';
import useAutoGrowTitle from './useAutoGrowTitle';
import useEditorSaveQueue from './useEditorSaveQueue';

interface EditorSourcePost {
  cover_image: string | null;
  cover_media_id: string | null;
  id: string;
}

interface EditorProps {
  adminPath: string;
  categories: PostCategory[];
  initialCategoryIds: string[];
  initialPost?: Omit<Post, 'translation_group_id'>;
  locale: PostLocale;
  ownerLocale?: PostLocale | null;
  sourcePost?: EditorSourcePost;
  translations: PostTranslationSummary[];
}

interface EditorDraft {
  categoryIds: string[];
  contentJson: JSONContent;
  coverMediaId: string | null;
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

export default function Editor({ adminPath, categories, initialCategoryIds, initialPost, locale, ownerLocale, sourcePost, translations }: EditorProps) {
  const copy = adminCopy(ownerLocale);
  const fallbackSlug = useRef(`post-${crypto.randomUUID().slice(0, 8)}`);
  const postId = useRef(initialPost?.id);
  const updatedAt = useRef(initialPost?.updated_at);
  const slugTouched = useRef(Boolean(initialPost));
  const actionPending = useRef<boolean | 'navigation'>(false);
  const postStatusRef = useRef<PostStatus>(initialPost?.status ?? 'draft');
  const autosaveTimer = useRef<number>();

  const [title, setTitle] = useState(initialPost?.title ?? '');
  const titleField = useAutoGrowTitle(title);
  const [categoryIds, setCategoryIds] = useState(() => selectCategories(categories, initialCategoryIds));
  const [coverMediaId, setCoverMediaId] = useState(initialPost?.cover_media_id ?? sourcePost?.cover_media_id ?? null);
  const [coverImage, setCoverImage] = useState(initialPost?.cover_image ?? sourcePost?.cover_image ?? null);
  const [slug, setSlug] = useState(initialPost?.slug ?? '');
  const [metaTitle, setMetaTitle] = useState(initialPost?.meta_title ?? '');
  const [metaDescription, setMetaDescription] = useState(initialPost?.meta_description ?? '');
  const [contentJson, setContentJson] = useState<JSONContent>(initialPost?.content_json ?? { type: 'doc', content: [{ type: 'paragraph' }] });
  const [postStatus, setPostStatus] = useState<PostStatus>(initialPost?.status ?? 'draft');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageEditions, setLanguageEditions] = useState(translations);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const draftRef = useRef<EditorDraft>({
    categoryIds, contentJson, coverMediaId,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  });
  draftRef.current = {
    categoryIds, contentJson, coverMediaId,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  };

  const snapshot = useCallback(() => {
    const draft = draftRef.current;
    if (!draft.title.trim()) throw new Error(copy.editor.titleRequired);
    return draft;
  }, [copy]);

  const save = useCallback(async (draft: EditorDraft, status?: PostStatus): Promise<Post> => {
    const id = postId.current;
    if (id && !updatedAt.current) throw new Error(copy.editor.reloadPost);
    const response = await fetch('/api/admin/posts', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(id ? { id, updatedAt: updatedAt.current } : {}),
        ...(!id && sourcePost ? { locale, sourcePostId: sourcePost.id } : {}),
        ...draft,
        status: status ?? postStatusRef.current,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(readApiError(payload) ?? copy.editor.postNotSaved);

    const savedPost = readPost(payload);
    if (!savedPost) throw new Error(copy.editor.serverSentInvalidPost);
    const wasNew = !postId.current;
    postId.current = savedPost.id;
    updatedAt.current = savedPost.updated_at;
    // Content already persisted: retries must keep its identity and published status.
    postStatusRef.current = savedPost.status;
    setErrorMessage(null);
    if (draftRef.current.slug === draft.slug) {
      draftRef.current = { ...draftRef.current, slug: savedPost.slug };
      setSlug(savedPost.slug);
    }
    if (draftRef.current.coverMediaId === draft.coverMediaId) {
      draftRef.current = { ...draftRef.current, coverMediaId: savedPost.cover_media_id };
      setCoverMediaId(savedPost.cover_media_id);
      setCoverImage(savedPost.cover_image);
    }
    setPostStatus(savedPost.status);
    setLanguageEditions((current) => [
      ...current.filter((edition) => edition.locale !== savedPost.locale),
      { id: savedPost.id, locale: savedPost.locale, status: savedPost.status, title: savedPost.title },
    ].sort((left, right) => left.locale.localeCompare(right.locale)));

    if (wasNew) window.history.replaceState({}, '', adminHref({ admin_path: adminPath }, `/edit/${savedPost.id}`));
    return savedPost;
  }, [adminPath, copy, locale, sourcePost]);

  const handleSaveError = useCallback((error: unknown) => {
    setErrorMessage(error instanceof Error ? error.message : copy.editor.postNotSaved);
  }, [copy]);

  const { dirty, dirtyRef, markDirty, pendingCount, persist, saveState } = useEditorSaveQueue({
    onError: handleSaveError,
    save,
    snapshot,
  });

  const previewDraft = useCallback(async (target?: Window | null) => {
    if (actionPending.current) return;
    const previewWindow = target ?? window.open(adminHref({ admin_path: adminPath }, '/preview/pending'), '_blank');
    if (!previewWindow) {
      setErrorMessage(copy.editor.popupBlocked);
      return;
    }

    actionPending.current = true;
    setIsActionPending(true);
    window.clearTimeout(autosaveTimer.current);
    let failureState = 'save-error';
    try {
      let saved = await persist();
      while (dirtyRef.current) saved = await persist();
      failureState = 'preview-error';
      const previewUrl = await createPreviewUrl('post', saved.id);
      if (!previewWindow.closed) previewWindow.location.replace(previewUrl);
    } catch {
      const returnTo = postId.current ? adminHref({ admin_path: adminPath }, `/edit/${postId.current}`) : window.location.pathname + window.location.search;
      if (!previewWindow.closed) previewWindow.location.replace(
        `${adminHref({ admin_path: adminPath }, '/preview/pending')}?state=${failureState}&returnTo=${encodeURIComponent(returnTo)}`,
      );
    } finally {
      actionPending.current = false;
      setIsActionPending(false);
    }
  }, [adminPath, copy, persist]);

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
  }, [dirty, isNavigating, persist, title, slug, contentJson, metaDescription, metaTitle, categoryIds, coverMediaId]);

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

  return (
    <div className="admin-editor">
      <header className="admin-editor-bar">
        <div className="admin-editor-bar__inner">
          <div className="admin-editor-bar__start">
            <a aria-disabled={isActionPending || undefined} className="admin-toolbar-link" href={adminHref({ admin_path: adminPath })} onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              if (actionPending.current) {
                event.preventDefault();
                return;
              }
              if (dirtyRef.current || pendingCount.current) {
                event.preventDefault();
                void saveBefore(() => window.location.assign(adminHref({ admin_path: adminPath })), undefined, true);
              } else {
                actionPending.current = 'navigation';
                setIsActionPending(true);
                setIsNavigating(true);
              }
            }}>
              <span aria-hidden="true">←</span> {copy.editor.backToPosts}
            </a>
            <nav className="admin-nav" aria-label={copy.editor.postLanguages}>
              {POST_LOCALES.map((language) => {
                const translation = languageEditions.find(({ locale: translationLocale }) => translationLocale === language);
                const current = language === locale;
                const label = current
                  ? `${language.toUpperCase()} ${statusLabel(copy, postStatus)}`
                  : translation
                    ? `${language.toUpperCase()} ${statusLabel(copy, translation.status)}`
                    : `${language.toUpperCase()} ${copy.row.missing}`;
                return current
                  ? <span className="admin-nav__link" aria-current="page" key={language}>{label}</span>
                  : <button aria-label={`${translation ? copy.editor.editTranslation : copy.editor.addTranslation} ${language.toUpperCase()}`} className="admin-nav__link" disabled={isActionPending} key={language} onClick={() => void saveBefore((saved) => {
                    window.location.assign(translation
                      ? adminHref({ admin_path: adminPath }, `/edit/${translation.id}`)
                      : adminHref({ admin_path: adminPath }, `/new?sourcePostId=${saved.id}&locale=${language}`));
                  }, undefined, true)} type="button">{label}</button>;
              })}
            </nav>
          </div>
          <div className="admin-editor-actions">
            <span className="admin-save-state" data-state={saveState} aria-live="polite">
              <span aria-hidden="true">{saveState === 'saved' ? '✓' : '·'}</span> <span>{copy.editor[saveState]}</span>
            </span>
            {saveState === 'failed' && <button className="admin-button admin-button--secondary" disabled={isActionPending} onClick={() => void saveBefore(() => undefined)} type="button">{copy.editor.retrySave}</button>}
            <button aria-describedby={!postId.current && !title.trim() ? 'preview-disabled-reason' : undefined} className="admin-button admin-button--secondary" disabled={isActionPending || (!postId.current && !title.trim())} onClick={() => void previewDraft()} type="button">{copy.row.preview}</button>
            <span className="sr-only" id="preview-disabled-reason">{copy.editor.previewNeedsTitle}</span>
            <button aria-expanded={settingsOpen} aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={(event) => {
              event.currentTarget.focus();
              setSettingsOpen(true);
            }} type="button">{copy.nav.settings}</button>
            <button className="admin-button admin-button--primary" data-state={saveState === 'saving' ? 'loading' : undefined} disabled={isActionPending} onClick={() => void saveBefore(() => undefined, 'published')} type="button">
              {postStatus === 'published' ? copy.editor.update : copy.row.publish}
            </button>
          </div>
        </div>
      </header>

      <div className="admin-editor-workspace">
        {isNavigating && <p className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted" role="status">{copy.editor.opening} <button className="admin-button admin-button--secondary" onClick={cancelNavigation} type="button">{copy.editor.stayInEditor}</button></p>}
        {errorMessage && !settingsOpen && <p className="admin-alert" role="alert">{saveState === 'failed' && <strong>{copy.editor.failed}</strong>} {errorMessage}</p>}

        <article className="admin-editor-canvas">
          <label className="sr-only" htmlFor="post-title">{copy.editor.postTitle}</label>
          <textarea
            className="admin-title-input"
            ref={titleField}
            id="post-title"
            maxLength={200}
            onChange={(event) => changeTitle(event.target.value)}
            placeholder={copy.posts.untitled}
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
          copy={copy}
          coverImage={coverImage}
          errorMessage={errorMessage}
          metaDescription={metaDescription}
          metaTitle={metaTitle}
          onChangeCategories={(selected) => { setCategoryIds(selectCategories(categories, selected)); markDirty(); }}
          onChangeCover={(asset: MediaAsset | null) => {
            setCoverMediaId(asset?.id ?? null);
            setCoverImage(asset?.publicUrl ?? null);
            markDirty();
          }}
          onChangeMetaDescription={(value) => { setMetaDescription(value); markDirty(); }}
          onChangeMetaTitle={(value) => { setMetaTitle(value); markDirty(); }}
          onChangeSlug={(value) => { slugTouched.current = true; setSlug(value); markDirty(); }}
          onClose={() => setSettingsOpen(false)}
          onManageCategories={() => void saveBefore(() => window.location.assign(adminHref({ admin_path: adminPath }, '/categories')), undefined, true)}
          open={settingsOpen}
          selectedCategoryIds={categoryIds}
          slug={slug}
        />
      </div>
    </div>
  );
}
