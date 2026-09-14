import { useMemo } from 'react';

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
import { promptUi } from '../../lib/ui-dialog';
import BlockInsertMenu from './BlockInsertMenu';
import { uploadFn } from './ImageUploader';
import SlashCommands, { createSlashCommand } from './SlashCommands';
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
    text: string;
    run: (instance: EditorInstance) => void;
  }> = [
    { active: editor.isActive('bold'), label: copy.blocks.bold, text: 'B', run: (instance) => void instance.chain().focus().toggleBold().run() },
    { active: editor.isActive('italic'), label: copy.blocks.italic, text: 'I', run: (instance) => void instance.chain().focus().toggleItalic().run() },
    {
      active: editor.isActive('link'),
      label: copy.blocks.link,
      text: '↗',
      run: (instance) => {
        if (instance.isActive('link')) {
          instance.chain().focus().unsetLink().run();
          return;
        }

        void promptUi({
          title: copy.blocks.linkTitle,
          message: copy.blocks.linkHint,
          label: copy.blocks.linkUrl,
          confirmLabel: copy.blocks.applyLink,
          validate: (value) => normalizedLink(value) ? null : copy.blocks.invalidLink,
        }).then((value) => {
          if (value === null) return;
          const href = normalizedLink(value);
          if (href) instance.chain().focus().setLink({ href }).run();
        });
      },
    },
    { active: editor.isActive('code'), label: copy.blocks.inlineCode, text: '</>', run: (instance) => void instance.chain().focus().toggleCode().run() },
  ];

  return (
    <EditorBubble className="flex overflow-hidden rounded-md border border-line bg-white p-1 font-sans" tippyOptions={{ duration: 100 }}>
      {actions.map((action) => (
        <EditorBubbleItem key={action.label} onSelect={action.run}>
          <button
            aria-label={action.label}
            aria-pressed={action.active}
            className={`min-w-9 rounded px-2 py-1.5 text-sm font-semibold hover:bg-soft ${action.active ? 'bg-soft text-accent' : 'text-ink'}`}
            type="button"
          >
            {action.text}
          </button>
        </EditorBubbleItem>
      ))}
    </EditorBubble>
  );
}

export default function DocumentCanvas({ initialContent, onChange, ownerLocale }: DocumentCanvasProps) {
  const copy = adminCopy(ownerLocale);
  // Rebuilding the extension list would reset the editor, so it is tied to the copy only.
  const extensions = useMemo(() => buildExtensions(copy), [copy]);

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
        <BlockInsertMenu copy={copy} />
      </EditorContent>
    </EditorRoot>
  );
}
