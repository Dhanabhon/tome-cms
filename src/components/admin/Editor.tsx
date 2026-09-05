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
    setUploadingCover(true);
    setErrorMessage(null);

    try {
      const asset = await uploadImage(file);
      setCoverImage(asset.publicUrl);
      setCoverAsset(asset);
      markDirty();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The cover image could not be uploaded.');
    } finally {
      if (input) input.value = '';
      setUploadingCover(false);
    }
  };

  const chooseCover = (asset: MediaAsset) => {
    setCoverImage(asset.publicUrl);
    setCoverAsset(asset);
    setPickerOpen(false);
    markDirty();
  };

  const removeCover = () => {
    setCoverImage('');
    setCoverAsset(null);
    markDirty();
  };

  const lowResolution = coverAsset && (
    coverAsset.width < COVER_IMAGE_GUIDANCE.recommendedMinWidth
    || coverAsset.height < COVER_IMAGE_GUIDANCE.recommendedMinHeight
  );

  return (
    <div className="pb-24">
      <div className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <div className="flex items-center gap-6">
            <a className="hidden sm:inline" href="/admin" aria-label="TomeCMS dashboard">
              <img className="h-8 w-auto" src="/brand/tomecms-logo.png" alt="TomeCMS" width="96" height="32" />
            </a>
            <a className="text-sm font-medium text-accent hover:underline sm:border-l sm:border-line sm:pl-6" href="/admin">
              <span aria-hidden="true">←</span> Posts
            </a>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline" aria-live="polite">{saveState}</span>
            <button className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-soft" onClick={() => saveAs('draft')} type="button">
              Save draft
            </button>
            <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" onClick={() => saveAs('published')} type="button">
              {postStatus === 'published' ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 pt-10 sm:px-8">
        {errorMessage && <p className="mb-6 border-l-2 border-red-600 pl-4 text-sm text-red-700" role="alert">{errorMessage}</p>}

        <section aria-label="Post metadata" className="grid gap-x-8 gap-y-5 border-b border-line pb-10 sm:grid-cols-[9rem_minmax(0,28rem)] sm:pl-9">
          <label className="contents">
            <span className="self-center text-sm font-medium">Slug</span>
            <input
              className="w-full rounded-md border border-line px-3 py-2 text-sm"
              onChange={(event) => {
                slugTouched.current = true;
                setSlug(event.target.value);
                markDirty();
              }}
              placeholder="post-slug"
              type="text"
              value={slug}
            />
          </label>
          <label className="contents">
            <span className="self-center text-sm font-medium">Meta title</span>
            <input
              className="w-full rounded-md border border-line px-3 py-2 text-sm"
              maxLength={70}
              onChange={(event) => {
                setMetaTitle(event.target.value);
                markDirty();
              }}
              type="text"
              value={metaTitle}
            />
          </label>
          <label className="contents">
            <span className="pt-2 text-sm font-medium">Meta description</span>
            <textarea
              className="min-h-24 w-full resize-y rounded-md border border-line px-3 py-2 text-sm"
              maxLength={320}
              onChange={(event) => {
                setMetaDescription(event.target.value);
                markDirty();
              }}
              value={metaDescription}
            />
          </label>
          <div className="text-sm font-medium">Cover image</div>
          <div>
            <div className="flex flex-wrap gap-3">
              <button className="rounded-md border border-line px-4 py-3 text-sm font-medium hover:bg-soft" onClick={() => setPickerOpen(true)} ref={coverPickerTrigger} type="button">Choose from library</button>
              <label className="inline-flex cursor-pointer items-center rounded-md border border-dashed border-line px-4 py-3 text-sm font-medium hover:bg-soft">
                <input aria-label="Upload new" className="sr-only" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={uploadingCover} onChange={(event) => void selectCover(event.currentTarget.files?.[0], event.currentTarget)} type="file" />
                {uploadingCover ? 'Uploading…' : 'Upload new'}
              </label>
              {coverImage && <button className="rounded-md px-4 py-3 text-sm font-medium text-muted underline hover:text-ink" onClick={removeCover} type="button">Remove</button>}
            </div>
            <input name="coverImage" type="hidden" value={coverImage} />
            <p className="mt-3 text-xs leading-5 text-muted">
              Recommended: {COVER_IMAGE_GUIDANCE.recommendedWidth} × {COVER_IMAGE_GUIDANCE.recommendedHeight} px (16:9).
              {' '}Minimum: {COVER_IMAGE_GUIDANCE.recommendedMinWidth} × {COVER_IMAGE_GUIDANCE.recommendedMinHeight} px.
              {' '}Best: WebP or JPEG; PNG and AVIF are also supported. GIF is accepted but discouraged for covers, especially when animated.
              {' '}Aim for {COVER_IMAGE_GUIDANCE.recommendedMaxBytes / 1024 / 1024} MB or less; {COVER_IMAGE_GUIDANCE.hardLimitBytes / 1024 / 1024} MB maximum.
            </p>
            {lowResolution && <p className="mt-2 text-sm text-amber-700" role="status">This image is below the recommended minimum of {COVER_IMAGE_GUIDANCE.recommendedMinWidth} × {COVER_IMAGE_GUIDANCE.recommendedMinHeight} px.</p>}
            {coverImage && <img alt="Current cover" className="mt-4 aspect-[16/9] w-full max-w-sm rounded-lg object-cover" src={coverImage} />}
          </div>
        </section>

        {pickerOpen && <MediaPicker onCancel={() => setPickerOpen(false)} onSelect={chooseCover} returnFocus={coverPickerTrigger.current} />}

        <section className="mt-12 md:ml-32">
          <label className="sr-only" htmlFor="post-title">Post title</label>
          <textarea
            className="w-full resize-none overflow-hidden border-0 bg-transparent font-display text-4xl font-semibold leading-tight tracking-tight outline-none placeholder:text-gray-300 sm:text-[2.5rem]"
            id="post-title"
            maxLength={200}
            onChange={(event) => changeTitle(event.target.value)}
            placeholder="Untitled post"
            rows={2}
            value={title}
          />

          <div className="max-w-3xl">
            <EditorRoot>
              <EditorContent
                className="editor-canvas editor-content"
                editorProps={{
                  attributes: {
                    class: 'prose prose-lg max-w-none prose-headings:font-display prose-a:text-accent prose-img:rounded-lg',
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
          </div>
        </section>
      </div>
    </div>
  );
}
