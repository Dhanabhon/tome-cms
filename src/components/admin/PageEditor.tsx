import { type JSONContent } from 'novel';
import { useCallback, useEffect, useRef, useState } from 'react';
import slugify from 'slugify';

import { POST_LOCALES, type Page, type PageLocale, type PageStatus, type PageTranslationSummary } from '../../types/cms';
import DocumentCanvas from './DocumentCanvas';
import PageSettingsDrawer from './PageSettingsDrawer';
import useEditorSaveQueue from './useEditorSaveQueue';

interface EditorSourcePage {
  id: string;
}

interface PageEditorProps {
  initialPage?: Omit<Page, 'translation_group_id'>;
  locale: PageLocale;
  sourcePage?: EditorSourcePage;
  translations: PageTranslationSummary[];
}

interface PageEditorDraft {
  contentHtml: string;
  contentJson: JSONContent;
  metaDescription: string | null;
  metaTitle: string | null;
  slug: string;
  title: string;
}

function readApiError(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return null;
  if ('issues' in payload && typeof payload.issues === 'object' && payload.issues !== null
    && 'properties' in payload.issues && typeof payload.issues.properties === 'object' && payload.issues.properties !== null
    && 'contentJson' in payload.issues.properties) {
    const issue = payload.issues.properties.contentJson;
    if (typeof issue === 'object' && issue !== null && 'errors' in issue && Array.isArray(issue.errors)) {
      const message: unknown = issue.errors[0];
      if (typeof message === 'string') return message;
    }
  }
  return typeof payload.error === 'string' ? payload.error : null;
}

function readPage(payload: unknown): Page | null {
  if (typeof payload !== 'object' || payload === null || !('page' in payload)) return null;
  const page = payload.page;
  return typeof page === 'object' && page !== null && 'id' in page ? (page as Page) : null;
}

export default function PageEditor({ initialPage, locale, sourcePage, translations }: PageEditorProps) {
  const fallbackSlug = useRef(`page-${crypto.randomUUID().slice(0, 8)}`);
  const pageId = useRef(initialPage?.id);
  const slugTouched = useRef(Boolean(initialPage));
  const actionPending = useRef<boolean | 'navigation'>(false);
  const pageStatusRef = useRef<PageStatus>(initialPage?.status ?? 'draft');
  const autosaveTimer = useRef<number>();

  const [title, setTitle] = useState(initialPage?.title ?? '');
  const [slug, setSlug] = useState(initialPage?.slug ?? '');
  const [metaTitle, setMetaTitle] = useState(initialPage?.meta_title ?? '');
  const [metaDescription, setMetaDescription] = useState(initialPage?.meta_description ?? '');
  const [contentJson, setContentJson] = useState<JSONContent>(initialPage?.content_json ?? { type: 'doc', content: [{ type: 'paragraph' }] });
  const [contentHtml, setContentHtml] = useState(initialPage?.content_html ?? '<p></p>');
  const [pageStatus, setPageStatus] = useState<PageStatus>(initialPage?.status ?? 'draft');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageEditions, setLanguageEditions] = useState(translations);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const draftRef = useRef<PageEditorDraft>({
    contentHtml, contentJson,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  });
  draftRef.current = {
    contentHtml, contentJson,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  };

  const snapshot = useCallback(() => {
    const draft = draftRef.current;
    if (!draft.title.trim()) throw new Error('Add a title before saving.');
    return draft;
  }, []);

  const save = useCallback(async (draft: PageEditorDraft, status?: PageStatus): Promise<Page> => {
    const id = pageId.current;
    const response = await fetch('/api/pages', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(id ? { id } : {}),
        ...(!id && sourcePage ? { locale, sourcePageId: sourcePage.id } : {}),
        ...draft,
        status: status ?? pageStatusRef.current,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(readApiError(payload) ?? 'The page could not be saved.');

    const savedPage = readPage(payload);
    if (!savedPage) throw new Error('The server returned an invalid page.');
    setErrorMessage(null);

    const wasNew = !pageId.current;
    pageId.current = savedPage.id;
    pageStatusRef.current = savedPage.status;
    if (draftRef.current.slug === draft.slug) {
      draftRef.current = { ...draftRef.current, slug: savedPage.slug };
      setSlug(savedPage.slug);
    }
    setPageStatus(savedPage.status);
    setLanguageEditions((current) => [
      ...current.filter((edition) => edition.locale !== savedPage.locale),
      { id: savedPage.id, locale: savedPage.locale, status: savedPage.status, title: savedPage.title },
    ].sort((left, right) => left.locale.localeCompare(right.locale)));

    if (wasNew) window.history.replaceState({}, '', `/admin/pages/edit/${savedPage.id}`);
    return savedPage;
  }, [locale, sourcePage]);

  const handleSaveError = useCallback((error: unknown) => {
    setErrorMessage(error instanceof Error ? error.message : 'The page could not be saved.');
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
      if (!previewWindow.closed) previewWindow.location.replace(`/admin/pages/preview/${saved.id}`);
    } catch {
      const returnTo = pageId.current ? `/admin/pages/edit/${pageId.current}` : window.location.pathname + window.location.search;
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
  }, [dirty, isNavigating, persist, title, slug, contentHtml, contentJson, metaDescription, metaTitle]);

  const saveBefore = async (action: (page: Page) => void, status?: PageStatus, leavesEditor = false) => {
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
      setSlug(slugify(value, { lower: true, strict: true, trim: true }).slice(0, 160).replace(/-+$/, '') || fallbackSlug.current);
    }
    markDirty();
  };

  return (
    <div className="admin-editor">
      <header className="admin-editor-bar">
        <div className="admin-editor-bar__inner">
          <div className="admin-editor-bar__start">
            <a aria-disabled={isActionPending || undefined} className="admin-toolbar-link" href="/admin/pages" onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              if (actionPending.current) {
                event.preventDefault();
                return;
              }
              if (dirtyRef.current || pendingCount.current) {
                event.preventDefault();
                void saveBefore(() => window.location.assign('/admin/pages'), undefined, true);
              } else {
                actionPending.current = 'navigation';
                setIsActionPending(true);
                setIsNavigating(true);
              }
            }}>
              <span aria-hidden="true">←</span> Back to Pages
            </a>
            <nav className="admin-nav" aria-label="Page languages">
              {POST_LOCALES.map((language) => {
                const translation = languageEditions.find(({ locale: translationLocale }) => translationLocale === language);
                const current = language === locale;
                const label = current
                  ? `${language.toUpperCase()} ${pageStatus}`
                  : translation
                    ? `${language.toUpperCase()} ${translation.status}`
                    : `${language.toUpperCase()} missing`;
                return current
                  ? <span className="admin-nav__link" aria-current="page" key={language}>{label}</span>
                  : <button aria-label={`${translation ? 'Edit' : 'Add'} ${language.toUpperCase()} translation`} className="admin-nav__link" disabled={isActionPending} key={language} onClick={() => void saveBefore((saved) => {
                    window.location.assign(translation ? `/admin/pages/edit/${translation.id}` : `/admin/pages/new?sourcePageId=${saved.id}&locale=${language}`);
                  }, undefined, true)} type="button">{label}</button>;
              })}
            </nav>
          </div>
          <div className="admin-editor-actions">
            <span className="admin-save-state" data-state={saveState === 'Saved' ? 'saved' : saveState === 'Saving…' ? 'saving' : 'unsaved'} aria-live="polite">
              <span aria-hidden="true">{saveState === 'Saved' ? '✓' : '·'}</span> <span>{saveState}</span>
            </span>
            {saveState === 'Save failed' && <button className="admin-button admin-button--secondary" disabled={isActionPending} onClick={() => void saveBefore(() => undefined)} type="button">Retry save</button>}
            <button aria-describedby={!pageId.current && !title.trim() ? 'preview-disabled-reason' : undefined} className="admin-button admin-button--secondary" disabled={isActionPending || (!pageId.current && !title.trim())} onClick={() => void previewDraft()} type="button">Preview</button>
            <span className="sr-only" id="preview-disabled-reason">Add a title before opening Preview.</span>
            <button aria-expanded={settingsOpen} aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={(event) => {
              event.currentTarget.focus();
              setSettingsOpen(true);
            }} type="button">Settings</button>
            <button className="admin-button admin-button--primary" data-state={saveState === 'Saving…' ? 'loading' : undefined} disabled={isActionPending} onClick={() => void saveBefore(() => undefined, 'published')} type="button">
              {pageStatus === 'published' ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>
      </header>

      <div className="admin-editor-workspace">
        {isNavigating && <p className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted" role="status">Opening page… <button className="admin-button admin-button--secondary" onClick={cancelNavigation} type="button">Stay in editor</button></p>}
        {errorMessage && !settingsOpen && <p className="admin-alert" role="alert">{saveState === 'Save failed' && <strong>Save failed</strong>} {errorMessage}</p>}

        <article className="admin-editor-canvas">
          <label className="sr-only" htmlFor="page-title">Page title</label>
          <textarea
            className="admin-title-input"
            id="page-title"
            maxLength={200}
            onChange={(event) => changeTitle(event.target.value)}
            placeholder="Untitled page"
            rows={2}
            value={title}
          />

          <DocumentCanvas initialContent={contentJson} onChange={(nextContentJson, nextContentHtml) => {
            setContentJson(nextContentJson);
            setContentHtml(nextContentHtml);
            markDirty();
          }} />
        </article>

        <PageSettingsDrawer
          errorMessage={errorMessage}
          metaDescription={metaDescription}
          metaTitle={metaTitle}
          onChangeMetaDescription={(value) => { setMetaDescription(value); markDirty(); }}
          onChangeMetaTitle={(value) => { setMetaTitle(value); markDirty(); }}
          onChangeSlug={(value) => { slugTouched.current = true; setSlug(value); markDirty(); }}
          onClose={() => setSettingsOpen(false)}
          open={settingsOpen}
          slug={slug}
        />
      </div>
    </div>
  );
}
