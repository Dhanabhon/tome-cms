import { isNodeSelection } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { type ReactNode, useMemo } from 'react';

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

import { adminCopy, type AdminCopy } from '../../lib/admin-i18n';
import { textAlign } from '../../lib/editor-align';
import { attachment, attachmentMeta } from '../../lib/editor-attachment';
import { tableExtensions } from '../../lib/editor-table';
import { promptWithToggleUi } from '../../lib/ui-dialog';
import Icon from '../Icon';
import AlignButtons from './AlignButtons';
import BlockInsertMenu from './BlockInsertMenu';
import { createUploadFn } from './ImageUploader';
import SlashCommands, { createSlashCommand } from './SlashCommands';
import TableBubble from './TableBubble';
import type { PostLocale } from '../../types/cms';

interface DocumentCanvasProps {
  initialContent: JSONContent;
  onChange: (contentJson: JSONContent) => void;
  ownerLocale?: PostLocale | null;
}

const editorImage = TiptapImage.extend({
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
    return [UploadImagesPlugin({ imageClass: 'rounded-lg opacity-50' })];
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

const buildExtensions = (copy: AdminCopy) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: { HTMLAttributes: { class: 'border-l-2 border-accent pl-5 italic' } },
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-code p-5 font-mono text-sm text-ondark' } },
  }),
  Placeholder.configure({ placeholder: copy.blocks.placeholder }),
  TiptapLink.configure({
    autolink: true,
    openOnClick: false,
    HTMLAttributes: { class: 'text-link underline underline-offset-2', rel: 'noopener noreferrer' },
  }),
  editorImage,
  ...tableExtensions,
  textAlign,
  editorAttachment,
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
  const { editor } = useEditor();
  if (!editor) return null;

  const actions: Array<{
    active: boolean;
    label: string;
    text: ReactNode;
    run: (instance: EditorInstance) => void;
  }> = [
    { active: editor.isActive('bold'), label: copy.blocks.bold, text: 'B', run: (instance) => void instance.chain().focus().toggleBold().run() },
    { active: editor.isActive('italic'), label: copy.blocks.italic, text: 'I', run: (instance) => void instance.chain().focus().toggleItalic().run() },
    {
      active: editor.isActive('link'),
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
    { active: editor.isActive('code'), label: copy.blocks.inlineCode, text: '</>', run: (instance) => void instance.chain().focus().toggleCode().run() },
  ];

  return (
    <EditorBubble
      className="flex overflow-hidden rounded-md border border-line bg-surface p-1 font-sans"
      // novel's own test, less cells chosen together: those bring the table's bar instead.
      shouldShow={({ editor: instance, state: { selection } }) => instance.isEditable && !instance.isActive('image')
        && !selection.empty && !isNodeSelection(selection) && !(selection instanceof CellSelection)}
      tippyOptions={{ duration: 100 }}
    >
      {actions.map((action) => (
        <EditorBubbleItem key={action.label} onSelect={action.run}>
          <button
            aria-label={action.label}
            aria-pressed={action.active}
            className={`flex h-8 min-w-9 items-center justify-center rounded px-2 text-sm font-semibold hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4 ${action.active ? 'bg-soft text-accent' : 'text-ink'}`}
            type="button"
          >
            {action.text}
          </button>
        </EditorBubbleItem>
      ))}
      <span aria-hidden="true" className="mx-1 w-px self-stretch bg-line" />
      <AlignButtons copy={copy} />
    </EditorBubble>
  );
}

export default function DocumentCanvas({ initialContent, onChange, ownerLocale }: DocumentCanvasProps) {
  const copy = adminCopy(ownerLocale);
  // Rebuilding the extension list would reset the editor, so it is tied to the copy only.
  const extensions = useMemo(() => buildExtensions(copy), [copy]);
  const uploadFn = useMemo(() => createUploadFn(copy), [copy]);

  return (
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
        initialContent={initialContent}
        onUpdate={({ editor }) => onChange(editor.getJSON())}
      >
        <SlashCommands copy={copy} />
        <FormattingBubble copy={copy} />
        <TableBubble copy={copy} />
        <BlockInsertMenu copy={copy} ownerLocale={ownerLocale} />
      </EditorContent>
    </EditorRoot>
  );
}
