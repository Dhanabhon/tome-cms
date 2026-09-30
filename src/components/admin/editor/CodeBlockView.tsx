import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';

import { fill, type AdminCopy } from '../../../lib/admin-i18n';
import { highlightCode } from '../../../lib/code-highlight';
import { CODE_LANGUAGES, codeLanguageLabel, normalizeCodeLanguage } from '../../../lib/code-languages';
import { codeBlock } from '../../../lib/editor-code';
import UiSelect from '../UiSelect';

/** How long the writer stops typing before Auto names the language: detection tries every grammar. */
const DETECT_DELAY = 300;
const NONE = 'none';

/** The label of the language Auto finds in `text`, once the typing has paused; null while there is none to say. */
function useDetected(text: string, active: boolean): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !text) {
      setLabel(null);
      return;
    }
    const timer = window.setTimeout(() => setLabel(codeLanguageLabel(highlightCode('auto', text).language)), DETECT_DELAY);
    return () => window.clearTimeout(timer);
  }, [active, text]);
  return label;
}

/**
 * The editor's code block: the language picker in the top-left corner, the code below it. The
 * picker is the admin's own list control, and sits outside what the writer edits. Tab reaches it
 * as it reaches any control; Escape in it closes the list and puts the cursor back in the code.
 */
function codeBlockView(copy: AdminCopy) {
  return function CodeBlockView({ editor, getPos, node, updateAttributes }: NodeViewProps) {
    const id = `code-language-${useId()}`;
    const language = normalizeCodeLanguage(node.attrs.language);
    const detected = useDetected(node.textContent, language === 'auto');
    const options = useMemo(() => [
      { label: copy.blocks.codeLanguageNone, value: NONE },
      { label: detected ? fill(copy.blocks.codeLanguageAutoDetected, { language: detected }) : copy.blocks.codeLanguageAuto, value: 'auto' },
      ...CODE_LANGUAGES.map(({ id: value, label }) => ({ label, value })),
    ], [detected]);

    const backToCode = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const at = getPos();
      if (typeof at === 'number') editor.chain().focus().setTextSelection(at + 1).run();
    };

    return (
      <NodeViewWrapper className="code-block-editor">
        <div className="code-block-editor__header" contentEditable={false} onKeyDown={backToCode}>
          <UiSelect
            ariaLabel={copy.blocks.codeLanguage}
            className="code-block-editor__language"
            id={id}
            onValueChange={(value) => updateAttributes({ language: value === NONE ? null : value })}
            options={options}
            value={language ?? NONE}
          />
        </div>
        <pre>
          <NodeViewContent<'code'> as="code" />
        </pre>
      </NodeViewWrapper>
    );
  };
}

export const createCodeBlock = (copy: AdminCopy) => codeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(codeBlockView(copy));
  },
});
