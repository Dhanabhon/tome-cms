import { type Editor, isNodeSelection, type JSONContent } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { CellSelection } from '@tiptap/pm/tables';
import { EditorContent, EditorContext, useCurrentEditor, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useMemo, useRef } from 'react';

import { adminCopy, type AdminCopy } from '../../lib/admin-i18n';
import { textAlign } from '../../lib/editor-align';
import { attachment, attachmentMeta } from '../../lib/editor-attachment';
import { tableExtensions } from '../../lib/editor-table';
import { promptWithToggleUi } from '../../lib/ui-dialog';
import { video, type VideoAttrs } from '../../lib/editor-video';
import { VIDEO_PROVIDER_NAMES } from '../../lib/video-link';
import Icon from '../Icon';
import AlignButtons from './AlignButtons';
import BlockInsertMenu from './BlockInsertMenu';
import { handleImageDrop, handleImagePaste, imageUploadPlugin } from './editor/editor-image-upload';
import { createSlashCommand } from './editor/slash-command';
import { handleVideoPaste } from './editor/video-insert';
import { createUploadFn } from './ImageUploader';
import TableBubble from './TableBubble';
import type { PostLocale } from '../../types/cms';

interface DocumentCanvasProps {
  initialContent: JSONContent;
  onChange: (contentJson: JSONContent) => void;
  ownerLocale?: PostLocale | null;
}

const editorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-id'),
        renderHTML: ({ mediaId }) => typeof mediaId === 'string' ? { 'data-media-id': mediaId } : {},
      },
    };
  },
  addProseMirrorPlugins() {
    return [imageUploadPlugin()];
  },
}).configure({
  allowBase64: false,
  HTMLAttributes: { class: 'rounded-lg' },
});

/**
 * The editor draws a card with no link in it: a click selects the card, as a click on a picture
 * does, and a drag moves the card rather than its address. The stored HTML keeps the link.
 */
const editorAttachment = attachment.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('p');
      dom.className = 'file-card';
      const box = document.createElement('span');
      box.className = 'file-card__link';
      const name = document.createElement('span');
      name.className = 'file-card__name';
      name.textContent = String(node.attrs.name ?? '');
      const meta = document.createElement('span');
      meta.className = 'file-card__meta';
      meta.textContent = attachmentMeta({ mimeType: node.attrs.mimeType, size: Number(node.attrs.size) || 0 });
      box.append(name, ' ', meta);
      dom.append(box);
      return { dom };
    };
  },
});

/**
 * The editor draws a video as its poster and caption, with no link in it: a click selects the
 * block, as a click on a card does. Until the server answers, the caption shows the clip's id.
 */
const editorVideo = video.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure');
      dom.className = 'tome-video tome-video--editor';
      const draw = (attrs: VideoAttrs) => {
        const box = document.createElement('span');
        box.className = 'tome-video__play';
        if (attrs.mediaId) {
          const poster = document.createElement('img');
          poster.alt = '';
          poster.src = `/media/${attrs.mediaId}`;
          box.append(poster);
        }
        const caption = document.createElement('figcaption');
        caption.textContent = `${attrs.title || attrs.videoId} · ${VIDEO_PROVIDER_NAMES[attrs.provider]}`;
        dom.replaceChildren(box, caption);
      };
      draw(node.attrs as VideoAttrs);
      return {
        dom,
        update: (next) => {
          if (next.type.name !== 'video') return false;
          draw(next.attrs as VideoAttrs);
          return true;
        },
      };
    };
  },
});

const buildExtensions = (copy: AdminCopy) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: { HTMLAttributes: { class: 'border-l-2 border-accent pl-5 italic' } },
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-code p-5 font-mono text-sm text-ondark' } },
    link: false,
    // StarterKit 3 also appends an empty paragraph after a document that ends in anything but
    // one. A post that ends in a quote or a table would store a paragraph it never had.
    trailingNode: false,
    underline: false,
  }),
  // includeChildren is what puts the hint inside an empty heading or list item, not only in an
  // empty document. The removed editor package set it; now it is said here.
  Placeholder.configure({ includeChildren: true, placeholder: copy.blocks.placeholder }),
  Link.configure({
    autolink: true,
    openOnClick: false,
    HTMLAttributes: { class: 'text-link underline underline-offset-2', rel: 'noopener noreferrer' },
  }),
  editorImage,
  ...tableExtensions,
  textAlign,
  editorAttachment,
  editorVideo,
  createSlashCommand(copy),
];

function normalizedLink(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || /\s/.test(candidate)) return null;
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function FormattingBubble({ copy }: { copy: AdminCopy }) {
  const { editor } = useCurrentEditor();
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance?.isActive('bold') ?? false,
      code: instance?.isActive('code') ?? false,
      italic: instance?.isActive('italic') ?? false,
      link: instance?.isActive('link') ?? false,
    }),
  });
  if (!editor || !active) return null;

  const actions: Array<{
    active: boolean;
    label: string;
    text: ReactNode;
    run: (instance: Editor) => void;
  }> = [
    { active: active.bold, label: copy.blocks.bold, text: 'B', run: (instance) => void instance.chain().focus().toggleBold().run() },
    { active: active.italic, label: copy.blocks.italic, text: 'I', run: (instance) => void instance.chain().focus().toggleItalic().run() },
    {
      active: active.link,
      label: copy.blocks.link,
      text: <Icon name="link" />,
      run: (instance) => {
        if (instance.isActive('link')) {
          instance.chain().focus().unsetLink().run();
          return;
        }

        void promptWithToggleUi({
          title: copy.blocks.linkTitle,
          message: copy.blocks.linkHint,
          label: copy.blocks.linkUrl,
          confirmLabel: copy.blocks.applyLink,
          // Every link opened a new tab before there was a choice, so that is where it starts.
          toggle: { checked: true, label: copy.blocks.linkNewTab },
          validate: (value) => normalizedLink(value) ? null : copy.blocks.invalidLink,
        }).then((answer) => {
          if (answer === null) return;
          const href = normalizedLink(answer.value);
          if (href) instance.chain().focus().setLink({ href, target: answer.checked ? '_blank' : null }).run();
        });
      },
    },
    { active: active.code, label: copy.blocks.inlineCode, text: '</>', run: (instance) => void instance.chain().focus().toggleCode().run() },
  ];

  return (
    <BubbleMenu
      className="editor-menu flex overflow-hidden rounded-md border border-line bg-surface p-1 font-sans"
      editor={editor}
      // Less cells chosen together: those bring the table's bar instead.
      shouldShow={({ editor: instance, state: { selection } }) => instance.isEditable && !instance.isActive('image')
        && !selection.empty && !isNodeSelection(selection) && !(selection instanceof CellSelection)}
    >
      {actions.map((action) => (
        <button
          aria-label={action.label}
          aria-pressed={action.active}
          className={`flex h-8 min-w-9 items-center justify-center rounded px-2 text-sm font-semibold hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4 ${action.active ? 'bg-soft text-accent' : 'text-ink'}`}
          key={action.label}
          onClick={() => action.run(editor)}
          type="button"
        >
          {action.text}
        </button>
      ))}
      <span aria-hidden="true" className="mx-1 w-px self-stretch bg-line" />
      <AlignButtons copy={copy} />
    </BubbleMenu>
  );
}

export default function DocumentCanvas({ initialContent, onChange, ownerLocale }: DocumentCanvasProps) {
  const copy = adminCopy(ownerLocale);
  // Rebuilding the extension list would reset the editor, so it is tied to the copy only.
  const extensions = useMemo(() => buildExtensions(copy), [copy]);
  const uploadFn = useMemo(() => createUploadFn(copy), [copy]);
  // The paste handler is built before useEditor returns the instance it needs, so it reads the
  // editor from a ref that is set right after.
  const editorRef = useRef<Editor | null>(null);
  // The island is client:only, so there is no server render to hold the editor back.
  const editor = useEditor({
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'prose max-w-none prose-headings:font-sans prose-a:text-link prose-img:rounded-lg',
      },
      handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadFn),
      handlePaste: (view, event) => handleImagePaste(view, event, uploadFn) || handleVideoPaste(view, event, editorRef.current, copy),
    },
    extensions,
    onUpdate: ({ editor: instance }) => onChange(instance.getJSON()),
  }, [extensions, uploadFn]);
  editorRef.current = editor;

  if (!editor) return null;

  return (
    <EditorContext.Provider value={{ editor }}>
      {/* One box around the editor and everything that points at it: the + button places
          itself against this element, which is the only positioned one, and its padding is
          the gutter that button sits in. */}
      <div className="editor-canvas editor-content admin-editor-content">
        <EditorContent editor={editor} />
        <FormattingBubble copy={copy} />
        <TableBubble copy={copy} />
        <BlockInsertMenu copy={copy} ownerLocale={ownerLocale} />
      </div>
    </EditorContext.Provider>
  );
}
