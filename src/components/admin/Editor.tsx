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
import { ACCEPTED_IMAGE_TYPES, COVER_IMAGE_GUIDANCE } from '../../lib/media';
import type { MediaAsset, Post, PostStatus } from '../../types/cms';
import BlockInsertMenu from './BlockInsertMenu';
import { uploadFn } from './ImageUploader';
import MediaPicker from './MediaPicker';
import SlashCommands, { slashCommand } from './SlashCommands';

interface EditorProps {
  initialPost?: Post;
}

type SaveState = 'Saved' | 'Saving…' | 'Unsaved';

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
    HTMLAttributes: { class: 'text-accent underline underline-offset-2', rel: 'noopener noreferrer' },
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
    <EditorBubble className="flex overflow-hidden rounded-md border border-line bg-white p-1 font-sans shadow-lg" tippyOptions={{ duration: 100 }}>
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

export default function Editor({ initialPost }: EditorProps) {
  const fallbackSlug = useRef(`post-${crypto.randomUUID().slice(0, 8)}`);
  const postId = useRef(initialPost?.id);
  const slugTouched = useRef(Boolean(initialPost));
  const changeVersion = useRef(0);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const autosaveTimer = useRef<number>();
  const coverOperation = useRef(0);
  const coverPickerTrigger = useRef<HTMLButtonElement>(null);

  const [title, setTitle] = useState(initialPost?.title ?? '');
  const [slug, setSlug] = useState(initialPost?.slug ?? '');
  const [coverImage, setCoverImage] = useState(initialPost?.cover_image ?? '');
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
  const [pickerOpen, setPickerOpen] = useState(false);

  const markDirty = useCallback(() => {
    changeVersion.current += 1;
    setDirty(true);
    setSaveState('Unsaved');
    setErrorMessage(null);
  }, []);

  const persist = useCallback(
    async (status: PostStatus) => {
      if (!title.trim()) {
        setErrorMessage('Add a title before saving.');
        return;
      }

      while (saveInFlight.current) await saveInFlight.current;

      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      saveInFlight.current = gate;
      const version = changeVersion.current;
      setSaveState('Saving…');
      setErrorMessage(null);

      try {
        const id = postId.current;
        const response = await fetch('/api/posts', {
          method: id ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(id ? { id } : {}),
            contentHtml,
            contentJson,
            coverImage: coverImage || null,
            metaDescription: metaDescription || null,
            metaTitle: metaTitle || null,
            slug,
            status,
            title,
          }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(readApiError(payload) ?? 'The post could not be saved.');

        const savedPost = readPost(payload);
        if (!savedPost) throw new Error('The server returned an invalid post.');

        const wasNew = !postId.current;
        postId.current = savedPost.id;
        setSlug(savedPost.slug);
        setPostStatus(savedPost.status);

        if (wasNew) window.history.replaceState({}, '', `/admin/edit/${savedPost.id}`);
        if (version === changeVersion.current) {
          setDirty(false);
          setSaveState('Saved');
        } else {
          setSaveState('Unsaved');
        }
      } catch (error) {
        setSaveState('Unsaved');
        setErrorMessage(error instanceof Error ? error.message : 'The post could not be saved.');
      } finally {
        if (saveInFlight.current === gate) saveInFlight.current = null;
        release();
      }
    },
    [contentHtml, contentJson, coverImage, metaDescription, metaTitle, slug, title],
  );

  useEffect(() => {
    if (!dirty || !title.trim()) return;

    autosaveTimer.current = window.setTimeout(() => void persist(postStatus), 900);
    return () => window.clearTimeout(autosaveTimer.current);
  }, [dirty, persist, postStatus, title]);

  const saveAs = (status: PostStatus) => {
    window.clearTimeout(autosaveTimer.current);
    void persist(status);
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
    setErrorMessage(null);

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
    setPickerOpen(false);
    markDirty();
  };

  const removeCover = () => {
    coverOperation.current += 1;
    setCoverImage('');
    setCoverAsset(null);
    markDirty();
  };

  const lowResolution = coverAsset && (
    coverAsset.width < COVER_IMAGE_GUIDANCE.recommendedMinWidth
    || coverAsset.height < COVER_IMAGE_GUIDANCE.recommendedMinHeight
  );

  return (
    <div className="admin-editor">
      <header className="admin-editor-bar">
        <div className="admin-editor-bar__inner">
          <div className="admin-editor-bar__start">
            <a className="admin-editor-brand" href="/admin" aria-label="TomeCMS dashboard">
              <img className="admin-logo" src="/brand/tomecms-logo.png" alt="TomeCMS" width="2172" height="724" />
            </a>
            <a className="admin-toolbar-link" href="/admin">
              <span aria-hidden="true">←</span> All posts
            </a>
            <a className="admin-toolbar-link admin-toolbar-link--site" href="/" target="_blank" rel="noopener noreferrer" aria-label="View site (opens in a new tab)">
              View site <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="admin-editor-actions">
            <span className="admin-save-state" data-state={saveState === 'Saved' ? 'saved' : saveState === 'Saving…' ? 'saving' : 'unsaved'} aria-live="polite">
              <span aria-hidden="true">{saveState === 'Saved' ? '✓' : '·'}</span> <span>{saveState}</span>
            </span>
            <button className="admin-button admin-button--secondary" data-state={saveState === 'Saving…' ? 'loading' : undefined} onClick={() => saveAs('draft')} type="button">
              Save draft
            </button>
            <button className="admin-button admin-button--primary" data-state={saveState === 'Saving…' ? 'loading' : undefined} onClick={() => saveAs('published')} type="button">
              {postStatus === 'published' ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>
      </header>

      <div className="admin-editor-workspace">
        {errorMessage && <p className="admin-alert" role="alert">{errorMessage}</p>}

        <div className="admin-editor-grid">
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
                    class: 'prose prose-lg max-w-none prose-headings:font-sans prose-a:text-accent prose-img:rounded-lg',
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

          <aside className="admin-editor-settings" aria-label="Post settings">
            <div className="admin-editor-settings__head">
              <div><h2>Post settings</h2><p>URL, search details, and cover image.</p></div>
              <span className="admin-status" data-status={postStatus}>{postStatus}</span>
            </div>
            <label className="admin-field">
              <span>Slug</span>
              <input
                className="admin-control"
                onChange={(event) => {
                  slugTouched.current = true;
                  setSlug(event.target.value);
                  markDirty();
                }}
                placeholder="post-slug"
                type="text"
                value={slug}
              />
              <small>Used in the post URL.</small>
            </label>
            <label className="admin-field">
              <span>Meta title <small>{metaTitle.length}/70</small></span>
              <input
                className="admin-control"
                maxLength={70}
                onChange={(event) => {
                  setMetaTitle(event.target.value);
                  markDirty();
                }}
                type="text"
                value={metaTitle}
              />
            </label>
            <label className="admin-field">
              <span>Meta description <small>{metaDescription.length}/320</small></span>
              <textarea
                className="admin-control admin-control--textarea"
                maxLength={320}
                onChange={(event) => {
                  setMetaDescription(event.target.value);
                  markDirty();
                }}
                value={metaDescription}
              />
            </label>
            <div className="admin-field">
              <span>Cover image</span>
              <div className="admin-cover-actions">
                <button className="admin-button admin-button--secondary" onClick={() => setPickerOpen(true)} ref={coverPickerTrigger} type="button">
                  Choose from library
                </button>
                <label className="admin-upload" data-state={uploadingCover ? 'loading' : undefined}>
                  <input aria-label="Upload new" className="sr-only" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={uploadingCover} onChange={(event) => void selectCover(event.currentTarget.files?.[0], event.currentTarget)} type="file" />
                  {uploadingCover ? 'Uploading…' : 'Upload new'}
                </label>
                {coverImage && <button className="admin-button admin-button--secondary" onClick={removeCover} type="button">Remove</button>}
              </div>
              <input name="coverImage" type="hidden" value={coverImage} />
              <p className="admin-cover-help">
                Recommended: {COVER_IMAGE_GUIDANCE.recommendedWidth} × {COVER_IMAGE_GUIDANCE.recommendedHeight} px (16:9).
                {' '}Minimum: {COVER_IMAGE_GUIDANCE.recommendedMinWidth} × {COVER_IMAGE_GUIDANCE.recommendedMinHeight} px.
                {' '}Best: WebP or JPEG; PNG and AVIF are also supported. GIF is accepted but discouraged for covers, especially when animated.
                {' '}Aim for {COVER_IMAGE_GUIDANCE.recommendedMaxBytes / 1024 / 1024} MB or less; {COVER_IMAGE_GUIDANCE.hardLimitBytes / 1024 / 1024} MB maximum.
              </p>
              {lowResolution && <p className="admin-cover-warning" role="status">This image is below the recommended minimum of {COVER_IMAGE_GUIDANCE.recommendedMinWidth} × {COVER_IMAGE_GUIDANCE.recommendedMinHeight} px.</p>}
              {coverImage && <img alt="Current cover" className="admin-cover-preview" src={coverImage} />}
            </div>
          </aside>
        </div>
        {pickerOpen && <MediaPicker onCancel={() => setPickerOpen(false)} onSelect={chooseCover} returnFocus={coverPickerTrigger.current} />}
      </div>
    </div>
  );
}
