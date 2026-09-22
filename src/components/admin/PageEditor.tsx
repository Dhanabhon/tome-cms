import { type JSONContent } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { adminHref, adminPreviewHref, apiErrorMessage } from '../../lib/admin';
import { adminCopy, statusLabel } from '../../lib/admin-i18n';
import { hasMeaningfulContent } from '../../lib/editor-content';
import { POST_LOCALES, type Page, type PageLocale, type PageStatus, type PageTranslationSummary } from '../../types/cms';
import DocumentCanvas from './DocumentCanvas';
import PageSettingsDrawer from './PageSettingsDrawer';
import useAutoGrowTitle from './useAutoGrowTitle';
import useEditorSaveQueue from './useEditorSaveQueue';
import { contentSlug } from '../../lib/slug';
import { requestExcerpt } from './ExcerptSuggestion';
import type { ExcerptPurpose } from '../../lib/excerpt-candidates';
import { atLeast } from '../../lib/busy';
import { confirmUi } from '../../lib/ui-dialog';

interface EditorSourcePage {
  id: string;
}

interface PageEditorProps {
  /** Whether this installation can be asked to suggest a line for the excerpt. */
  canSuggest?: boolean;
  adminPath: string;
  initialPage?: Omit<Page, 'translation_group_id'>;
  locale: PageLocale;
  ownerLocale?: PageLocale | null;
  sourcePage?: EditorSourcePage;
  translations: PageTranslationSummary[];
}

interface PageEditorDraft {
  contentJson: JSONContent;
  excerpt: string;
  metaDescription: string | null;
  metaTitle: string | null;
  slug: string;
  title: string;
}

/**
 * A Zod refusal names the field it refused, and the content's own message says more than
 * the summary above it. Everything else about a failure is read the way the rest of the
 * admin reads it -- a coded refusal never carries issues, so the two cannot collide.
 */
function readContentIssue(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if ('issues' in payload && typeof payload.issues === 'object' && payload.issues !== null
    && 'properties' in payload.issues && typeof payload.issues.properties === 'object' && payload.issues.properties !== null
    && 'contentJson' in payload.issues.properties) {
    const issue = payload.issues.properties.contentJson;
    if (typeof issue === 'object' && issue !== null && 'errors' in issue && Array.isArray(issue.errors)) {
      const message: unknown = issue.errors[0];
      if (typeof message === 'string') return message;
    }
  }
  return null;
}

function readPage(payload: unknown): Page | null {
  if (typeof payload !== 'object' || payload === null || !('page' in payload)) return null;
  const page = payload.page;
  return typeof page === 'object' && page !== null && 'id' in page ? (page as Page) : null;
}

export default function PageEditor({ adminPath, canSuggest = false, initialPage, locale, ownerLocale, sourcePage, translations }: PageEditorProps) {
  const copy = adminCopy(ownerLocale);
  const fallbackSlug = useRef(`page-${crypto.randomUUID().slice(0, 8)}`);
  const pageId = useRef(initialPage?.id);
  const updatedAt = useRef(initialPage?.updated_at);
  const slugTouched = useRef(Boolean(initialPage));
  const actionPending = useRef<boolean | 'navigation'>(false);
  const pageStatusRef = useRef<PageStatus>(initialPage?.status ?? 'draft');
  // The owner's answer to "when", carried in a ref for the same reason the status is:
  // an autosave fires from a callback that must not be rebuilt every keystroke.
  const publishedAtRef = useRef<string | null>(initialPage?.published_at ?? null);
  const [publishedAt, setPublishedAt] = useState<string | null>(initialPage?.published_at ?? null);
  const autosaveTimer = useRef<number>();

  const [title, setTitle] = useState(initialPage?.title ?? '');
  const titleField = useAutoGrowTitle(title);
  const [slug, setSlug] = useState(initialPage?.slug ?? '');
  const [metaTitle, setMetaTitle] = useState(initialPage?.meta_title ?? '');
  const [excerpt, setExcerpt] = useState(initialPage?.excerpt ?? '');
  const [metaDescription, setMetaDescription] = useState(initialPage?.meta_description ?? '');
  const [contentJson, setContentJson] = useState<JSONContent>(initialPage?.content_json ?? { type: 'doc', content: [{ type: 'paragraph' }] });
  const [pageStatus, setPageStatus] = useState<PageStatus>(initialPage?.status ?? 'draft');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageEditions, setLanguageEditions] = useState(translations);
  const [isActionPending, setIsActionPending] = useState(false);
  // Publish or Update's own work. Not the editor's saving: an autosave is shown by the save
  // state beside the button, and a spinner on a button nobody pressed reads as publishing.
  const [publishing, setPublishing] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const draftRef = useRef<PageEditorDraft>({
    contentJson, excerpt,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  });
  draftRef.current = {
    contentJson, excerpt,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  };

  const snapshot = useCallback(() => {
    const draft = draftRef.current;
    if (!draft.title.trim()) throw new Error(copy.editor.titleRequired);
    return draft;
  }, []);

  const save = useCallback(async (draft: PageEditorDraft, status?: PageStatus): Promise<Page> => {
    const id = pageId.current;
    if (id && !updatedAt.current) throw new Error(copy.editor.reloadPage);
    const response = await fetch('/api/admin/pages', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(id ? { id, updatedAt: updatedAt.current } : {}),
        ...(!id && sourcePage ? { locale, sourcePageId: sourcePage.id } : {}),
        ...draft,
        status: status ?? pageStatusRef.current,
        ...(publishedAtRef.current ? { publishedAt: publishedAtRef.current } : {}),
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(readContentIssue(payload)
      ?? apiErrorMessage(payload, { contentRequired: copy.editor.contentRequired, failed: copy.editor.pageNotSaved }));

    const savedPage = readPage(payload);
    if (!savedPage) throw new Error(copy.editor.serverSentInvalidPage);
    setErrorMessage(null);

    const wasNew = !pageId.current;
    pageId.current = savedPage.id;
    updatedAt.current = savedPage.updated_at;
    pageStatusRef.current = savedPage.status;
    // Only when there is one. A draft has no date at all -- the database drops it -- and a
    // date the owner picked before publishing must survive the autosave that files the
    // draft, or pressing Publish sends nothing and the article goes out now.
    if (savedPage.published_at) publishedAtRef.current = savedPage.published_at;
    if (draftRef.current.slug === draft.slug) {
      draftRef.current = { ...draftRef.current, slug: savedPage.slug };
      setSlug(savedPage.slug);
    }
    setPageStatus(savedPage.status);
    if (savedPage.published_at) setPublishedAt(savedPage.published_at);
    setLanguageEditions((current) => [
      ...current.filter((edition) => edition.locale !== savedPage.locale),
      { id: savedPage.id, locale: savedPage.locale, status: savedPage.status, title: savedPage.title },
    ].sort((left, right) => left.locale.localeCompare(right.locale)));

    if (wasNew) window.history.replaceState({}, '', adminHref({ admin_path: adminPath }, `/pages/edit/${savedPage.id}`));
    return savedPage;
  }, [adminPath, locale, sourcePage]);

  const handleSaveError = useCallback((error: unknown) => {
    setErrorMessage(error instanceof Error ? error.message : copy.editor.pageNotSaved);
  }, []);

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
    try {
      let saved = await persist();
      while (dirtyRef.current) saved = await persist();
      if (!previewWindow.closed) previewWindow.location.replace(adminPreviewHref({ admin_path: adminPath }, 'page', saved.id));
    } catch {
      const returnTo = pageId.current ? adminHref({ admin_path: adminPath }, `/pages/edit/${pageId.current}`) : window.location.pathname + window.location.search;
      if (!previewWindow.closed) previewWindow.location.replace(
        `${adminHref({ admin_path: adminPath }, '/preview/pending')}?state=save-error&returnTo=${encodeURIComponent(returnTo)}`,
      );
    } finally {
      actionPending.current = false;
      setIsActionPending(false);
    }
  }, [adminPath, persist]);

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
  }, [dirty, isNavigating, persist, title, slug, contentJson, excerpt, metaDescription, metaTitle]);

  const saveBefore = async (action: (page: Page) => void, status?: PageStatus, leavesEditor = false): Promise<boolean> => {
    if (actionPending.current) return false;
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
    return completed;
  };

  /**
   * Out of the editor, to `href`. Saved first, so nothing is lost on the way -- and asked about
   * when that save cannot happen, with no title yet or no server to reach, because a draft that
   * cannot be saved must not keep its owner in here. A new draft written and taken back again
   * has nothing to save and nothing to lose, so it is not asked about.
   */
  const leave = async (href: string) => {
    if (actionPending.current) return;
    const draft = draftRef.current;
    const blank = !pageId.current && !draft.title.trim() && !draft.excerpt.trim()
      && !draft.metaTitle && !draft.metaDescription && !hasMeaningfulContent(draft.contentJson);
    if (!blank) {
      if (await saveBefore(() => window.location.assign(href), undefined, true)) return;
      const leaving = await confirmUi({
        cancelLabel: copy.editor.stayInEditor,
        confirmLabel: copy.editor.leaveUnsaved,
        message: copy.editor.leaveUnsavedMessage,
        title: copy.editor.leaveUnsavedTitle,
        tone: 'danger',
      });
      if (!leaving) return;
    }
    actionPending.current = 'navigation';
    setIsActionPending(true);
    setIsNavigating(true);
    window.location.assign(href);
  };

  /**
   * Publishing an empty document is refused by the API, and rightly so -- but an error that
   * arrives from the server arrives in the server's English, after a request the owner did
   * not need to send. The check happens here first, in the language they are reading, using
   * the API's own function so the two cannot come to disagree about what counts as content.
   */
  const publish = async () => {
    if (!hasMeaningfulContent(draftRef.current.contentJson)) {
      setErrorMessage(copy.editor.contentRequired);
      return;
    }
    setPublishing(true);
    try {
      await atLeast(saveBefore(() => undefined, 'published'));
    } finally {
      setPublishing(false);
    }
  };

  const changeTitle = (value: string) => {
    setTitle(value);
    if (!slugTouched.current) {
      setSlug(contentSlug(value) || fallbackSlug.current);
    }
    markDirty();
  };

  // The draft as it stands when the button is pressed, saved or not. Absent without a
  // suggester, and then the drawers draw no button for it.
  const suggestPassage = (purpose: ExcerptPurpose) => (canSuggest ? () => requestExcerpt({
    contentJson: draftRef.current.contentJson, locale, title: draftRef.current.title,
  }, purpose) : undefined);

  return (
    <div className="admin-editor">
      <header className="admin-editor-bar">
        <div className="admin-editor-bar__inner">
          <div className="admin-editor-bar__start">
            <a aria-disabled={isActionPending || undefined} className="admin-toolbar-link" href={adminHref({ admin_path: adminPath }, '/pages')} onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              if (actionPending.current) {
                event.preventDefault();
                return;
              }
              if (dirtyRef.current || pendingCount.current) {
                event.preventDefault();
                void leave(adminHref({ admin_path: adminPath }, '/pages'));
              } else {
                actionPending.current = 'navigation';
                setIsActionPending(true);
                setIsNavigating(true);
              }
            }}>
              <span aria-hidden="true">←</span> {copy.editor.backToPages}
            </a>
            <nav className="admin-nav" aria-label={copy.editor.pageLanguages}>
              {POST_LOCALES.map((language) => {
                const translation = languageEditions.find(({ locale: translationLocale }) => translationLocale === language);
                const current = language === locale;
                const label = current
                  ? `${language.toUpperCase()} ${statusLabel(copy, pageStatus)}`
                  : translation
                    ? `${language.toUpperCase()} ${statusLabel(copy, translation.status)}`
                    : `${language.toUpperCase()} ${copy.row.missing}`;
                return current
                  ? <span className="admin-nav__link" aria-current="page" key={language}>{label}</span>
                  : <button aria-label={`${translation ? copy.editor.editTranslation : copy.editor.addTranslation} ${language.toUpperCase()}`} className="admin-nav__link" disabled={isActionPending} key={language} onClick={() => void saveBefore((saved) => {
                    window.location.assign(translation
                      ? adminHref({ admin_path: adminPath }, `/pages/edit/${translation.id}`)
                      : adminHref({ admin_path: adminPath }, `/pages/new?sourcePageId=${saved.id}&locale=${language}`));
                  }, undefined, true)} type="button">{label}</button>;
              })}
            </nav>
          </div>
          <div className="admin-editor-actions">
            <span className="admin-save-state" data-state={saveState} aria-live="polite">
              <span aria-hidden="true">{saveState === 'saved' ? '✓' : '·'}</span> <span>{copy.editor[saveState]}</span>
            </span>
            {saveState === 'failed' && <button className="admin-button admin-button--secondary" disabled={isActionPending} onClick={() => void saveBefore(() => undefined)} type="button">{copy.editor.retrySave}</button>}
            <button aria-describedby={!pageId.current && !title.trim() ? 'preview-disabled-reason' : undefined} className="admin-button admin-button--secondary" disabled={isActionPending || (!pageId.current && !title.trim())} onClick={() => void previewDraft()} type="button">{copy.row.preview}</button>
            <span className="sr-only" id="preview-disabled-reason">{copy.editor.previewNeedsTitle}</span>
            <button aria-expanded={settingsOpen} aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={(event) => {
              event.currentTarget.focus();
              setSettingsOpen(true);
            }} type="button">{copy.nav.settings}</button>
            <button aria-busy={publishing} className="admin-button admin-button--primary" disabled={isActionPending} onClick={() => void publish()} type="button">
              {pageStatus === 'published' ? copy.editor.update : copy.row.publish}
            </button>
          </div>
        </div>
      </header>

      <div className="admin-editor-workspace">
        {isNavigating && <p className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted" role="status">{copy.editor.opening} <button className="admin-button admin-button--secondary" onClick={cancelNavigation} type="button">{copy.editor.stayInEditor}</button></p>}
        {errorMessage && !settingsOpen && <p className="admin-alert" role="alert">{saveState === 'failed' && <strong>{copy.editor.failed}</strong>} {errorMessage}</p>}

        <article className="admin-editor-canvas">
          <label className="sr-only" htmlFor="page-title">{copy.editor.pageTitle}</label>
          <textarea
            className="admin-title-input article-title"
            ref={titleField}
            id="page-title"
            maxLength={200}
            onChange={(event) => changeTitle(event.target.value)}
            placeholder={copy.pages.untitled}
            rows={2}
            value={title}
          />

          <DocumentCanvas initialContent={contentJson} ownerLocale={ownerLocale} onChange={(nextContentJson) => {
            setContentJson(nextContentJson);
            markDirty();
          }} />
        </article>

        <PageSettingsDrawer
          onSuggestDescription={suggestPassage('description')}
          onSuggestExcerpt={suggestPassage('excerpt')}
          publishedAt={publishedAt}
          onChangePublishedAt={(value) => { publishedAtRef.current = value; setPublishedAt(value); markDirty(); }}
          copy={copy}
          errorMessage={errorMessage}
          excerpt={excerpt}
          locale={locale}
          metaDescription={metaDescription}
          metaTitle={metaTitle}
          onChangeExcerpt={(value) => { setExcerpt(value); markDirty(); }}
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
