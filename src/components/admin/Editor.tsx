import {
  EditorBubble,
  EditorBubbleItem,
  EditorContent,
  type EditorInstance,
  EditorRoot,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  type JSONContent,
  Placeholder,
  StarterKit,
  TiptapImage,
  TiptapLink,
  UploadImagesPlugin,
  useEditor,
} from 'novel';
import { useCallback, useEffect, useRef, useState } from 'react';
import slugify from 'slugify';

import { uploadImage } from '../../lib/media-client';
import { POST_LOCALES, type MediaAsset, type Post, type PostLocale, type PostStatus, type PostTranslationSummary } from '../../types/cms';
import BlockInsertMenu from './BlockInsertMenu';
import { uploadFn } from './ImageUploader';
import PostSettingsDrawer from './PostSettingsDrawer';
import SlashCommands, { slashCommand } from './SlashCommands';

interface EditorSourcePost {
  coverImage: string | null;
  id: string;
}

interface EditorProps {
  initialPost?: Omit<Post, 'translation_group_id'>;
  locale: PostLocale;
  sourcePost?: EditorSourcePost;
  translations: PostTranslationSummary[];
}

type SaveState = 'Saved' | 'Saving…' | 'Unsaved' | 'Save failed';

interface EditorDraft {
  contentHtml: string;
  contentJson: JSONContent;
  coverImage: string | null;
  metaDescription: string | null;
  metaTitle: string | null;
  slug: string;
  title: string;
}

const editorImage = TiptapImage.extend({
  addProseMirrorPlugins() {
    return [UploadImagesPlugin({ imageClass: 'rounded-lg opacity-50' })];
  },
}).configure({
  allowBase64: false,
  HTMLAttributes: { class: 'rounded-lg' },
});

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: { HTMLAttributes: { class: 'border-l-2 border-accent pl-5 italic' } },
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-ink p-5 font-mono text-sm text-white' } },
  }),
  Placeholder.configure({ placeholder: "Type '/' for commands" }),
  TiptapLink.configure({
    autolink: true,
    openOnClick: false,
    HTMLAttributes: { class: 'text-link underline underline-offset-2', rel: 'noopener noreferrer' },
  }),
  editorImage,
  slashCommand,
];

function readApiError(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return null;
  return typeof payload.error === 'string' ? payload.error : null;
}

function readPost(payload: unknown): Post | null {
  if (typeof payload !== 'object' || payload === null || !('post' in payload)) return null;
  const post = payload.post;
  return typeof post === 'object' && post !== null && 'id' in post ? (post as Post) : null;
}

function normalizedLink(value: string): string | null {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function FormattingBubble() {
  const { editor } = useEditor();
  if (!editor) return null;

  const actions: Array<{
    active: boolean;
    label: string;
    text: string;
    run: (instance: EditorInstance) => void;
  }> = [
    { active: editor.isActive('bold'), label: 'Bold', text: 'B', run: (instance) => void instance.chain().focus().toggleBold().run() },
    { active: editor.isActive('italic'), label: 'Italic', text: 'I', run: (instance) => void instance.chain().focus().toggleItalic().run() },
    {
      active: editor.isActive('link'),
      label: 'Link',
      text: '↗',
      run: (instance) => {
        if (instance.isActive('link')) {
          instance.chain().focus().unsetLink().run();
          return;
        }

        const value = window.prompt('Paste a link');
        const href = value ? normalizedLink(value) : null;
        if (href) instance.chain().focus().setLink({ href }).run();
      },
    },
    { active: editor.isActive('code'), label: 'Inline code', text: '</>', run: (instance) => void instance.chain().focus().toggleCode().run() },
  ];

  return (
    <EditorBubble className="flex overflow-hidden rounded-md border border-line bg-white p-1 font-sans" tippyOptions={{ duration: 100 }}>
      {actions.map((action) => (
        <EditorBubbleItem key={action.label} onSelect={action.run}>
          <button
            aria-label={action.label}
            aria-pressed={action.active}
            className={`min-w-9 rounded px-2 py-1.5 text-sm font-semibold hover:bg-soft ${action.active ? 'bg-soft text-accent' : 'text-ink'}`}
            title={action.label}
            type="button"
          >
            {action.text}
          </button>
        </EditorBubbleItem>
      ))}
    </EditorBubble>
  );
}

export default function Editor({ initialPost, locale, sourcePost, translations }: EditorProps) {
  const fallbackSlug = useRef(`post-${crypto.randomUUID().slice(0, 8)}`);
  const postId = useRef(initialPost?.id);
  const slugTouched = useRef(Boolean(initialPost));
  const changeVersion = useRef(0);
  const saveTail = useRef<Promise<Post | null>>(Promise.resolve(null));
  const pendingSaves = useRef(0);
  const actionPending = useRef<boolean | 'navigation'>(false);
  const dirtyRef = useRef(false);
  const postStatusRef = useRef<PostStatus>(initialPost?.status ?? 'draft');
  const autosaveTimer = useRef<number>();
  const coverOperation = useRef(0);

  const [title, setTitle] = useState(initialPost?.title ?? '');
  const [slug, setSlug] = useState(initialPost?.slug ?? '');
  const [coverImage, setCoverImage] = useState(
    initialPost?.cover_image ?? sourcePost?.coverImage ?? '',
  );
  const [coverAsset, setCoverAsset] = useState<MediaAsset | null>(null);
  const [metaTitle, setMetaTitle] = useState(initialPost?.meta_title ?? '');
  const [metaDescription, setMetaDescription] = useState(initialPost?.meta_description ?? '');
  const [contentJson, setContentJson] = useState<JSONContent>(initialPost?.content_json ?? { type: 'doc', content: [{ type: 'paragraph' }] });
  const [contentHtml, setContentHtml] = useState(initialPost?.content_html ?? '<p></p>');
  const [postStatus, setPostStatus] = useState<PostStatus>(initialPost?.status ?? 'draft');
  const [saveState, setSaveState] = useState<SaveState>('Saved');
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageEditions, setLanguageEditions] = useState(translations);
  const [isActionPending, setIsActionPending] = useState(false);

  const draftRef = useRef<EditorDraft>({
    contentHtml, contentJson, coverImage: coverImage || null,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  });
  draftRef.current = {
    contentHtml, contentJson, coverImage: coverImage || null,
    metaDescription: metaDescription || null, metaTitle: metaTitle || null, slug, title,
  };

  const markDirty = useCallback(() => {
    changeVersion.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaveState((current) => current === 'Save failed' ? current : 'Unsaved');
  }, []);

  const persist = useCallback((status?: PostStatus): Promise<Post> => {
    pendingSaves.current += 1;
    const pending = saveTail.current.catch(() => null).then(async () => {
      const draft = draftRef.current;
      if (!draft.title.trim()) throw new Error('Add a title before saving.');
      const version = changeVersion.current;
      setSaveState((current) => current === 'Save failed' ? current : 'Saving…');
      const id = postId.current;
      const response = await fetch('/api/posts', {
        method: id ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(id ? { id } : {}),
          ...(!id && sourcePost ? { locale, sourcePostId: sourcePost.id } : {}),
          ...draft,
          status: status ?? postStatusRef.current,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readApiError(payload) ?? 'The post could not be saved.');

      const savedPost = readPost(payload);
      if (!savedPost) throw new Error('The server returned an invalid post.');
      setErrorMessage(null);

      const wasNew = !postId.current;
      postId.current = savedPost.id;
      postStatusRef.current = savedPost.status;
      if (draftRef.current.slug === draft.slug) {
        draftRef.current = { ...draftRef.current, slug: savedPost.slug };
        setSlug(savedPost.slug);
      }
      setPostStatus(savedPost.status);
      setLanguageEditions((current) => [
        ...current.filter((edition) => edition.locale !== savedPost.locale),
        { id: savedPost.id, locale: savedPost.locale, status: savedPost.status, title: savedPost.title },
      ].sort((left, right) => left.locale.localeCompare(right.locale)));

      if (wasNew) window.history.replaceState({}, '', `/admin/edit/${savedPost.id}`);
      if (version === changeVersion.current) {
        dirtyRef.current = false;
        setDirty(false);
        setSaveState('Saved');
      } else {
        setSaveState('Unsaved');
      }
      return savedPost;
    }).catch((error: unknown) => {
      setSaveState('Save failed');
      setErrorMessage(error instanceof Error ? error.message : 'The post could not be saved.');
      throw error;
    }).finally(() => {
      pendingSaves.current -= 1;
    });
    saveTail.current = pending.catch(() => null);
    return pending;
  }, [locale, sourcePost]);

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

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted && actionPending.current === 'navigation') {
        actionPending.current = false;
        setIsActionPending(false);
      }
    };
    const retry = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tome-preview-retry' || !event.source) return;
      void previewDraft(event.source as Window);
    };
    window.addEventListener('pageshow', restore);
    window.addEventListener('message', retry);
    return () => {
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('message', retry);
    };
  }, [previewDraft]);

  useEffect(() => {
    if (!dirty || !title.trim() || actionPending.current) return;

    autosaveTimer.current = window.setTimeout(() => void persist().catch(() => undefined), 900);
    return () => window.clearTimeout(autosaveTimer.current);
  }, [dirty, persist, title, slug, contentHtml, contentJson, coverImage, metaDescription, metaTitle]);

  const saveBefore = async (action: (post: Post) => void, status?: PostStatus, leavesEditor = false) => {
    if (actionPending.current) return;
    actionPending.current = leavesEditor ? 'navigation' : true;
    setIsActionPending(true);
    window.clearTimeout(autosaveTimer.current);
    let completed = false;
    try {
      let saved = await persist(status);
      while (dirtyRef.current) saved = await persist(status);
      action(saved);
      completed = true;
    } catch {
      // persist owns the visible error; navigation/publish stops here.
    } finally {
      // Keep navigation locked while the destination loads and the opener can still receive clicks.
      if (!completed || !leavesEditor) {
        actionPending.current = false;
        setIsActionPending(false);
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
              if (dirtyRef.current || pendingSaves.current) {
                event.preventDefault();
                void saveBefore(() => window.location.assign('/admin'), undefined, true);
              } else {
                actionPending.current = 'navigation';
                setIsActionPending(true);
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
            <button className="admin-button admin-button--secondary" disabled={isActionPending || (!postId.current && !title.trim())} title={!postId.current && !title.trim() ? 'Add a title before opening Preview.' : undefined} onClick={() => void previewDraft()} type="button">Preview</button>
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

          <EditorRoot>
            <EditorContent
              className="editor-canvas editor-content admin-editor-content"
              editorProps={{
                attributes: {
                  class: 'prose max-w-none prose-headings:font-sans prose-a:text-link prose-img:rounded-lg',
                },
                handleDOMEvents: { keydown: (_view, event) => handleCommandNavigation(event) },
                handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadFn),
                handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
              }}
              extensions={extensions}
              initialContent={contentJson}
              onUpdate={({ editor }) => {
                setContentJson(editor.getJSON());
                setContentHtml(editor.getHTML());
                markDirty();
              }}
            >
              <SlashCommands />
              <FormattingBubble />
              <BlockInsertMenu />
            </EditorContent>
          </EditorRoot>
        </article>

        <PostSettingsDrawer
          coverAsset={coverAsset}
          coverImage={coverImage}
          errorMessage={errorMessage}
          metaDescription={metaDescription}
          metaTitle={metaTitle}
          onChangeMetaDescription={(value) => { setMetaDescription(value); markDirty(); }}
          onChangeMetaTitle={(value) => { setMetaTitle(value); markDirty(); }}
          onChangeSlug={(value) => { slugTouched.current = true; setSlug(value); markDirty(); }}
          onChooseCover={chooseCover}
          onClose={() => setSettingsOpen(false)}
          onRemoveCover={removeCover}
          onUploadCover={selectCover}
          open={settingsOpen}
          slug={slug}
          uploadingCover={uploadingCover}
        />
      </div>
    </div>
  );
}
