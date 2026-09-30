import { textblockTypeInputRule } from '@tiptap/core';
import { CodeBlockLowlight, type CodeBlockLowlightOptions } from '@tiptap/extension-code-block-lowlight';
import type { DOMOutputSpec } from '@tiptap/pm/model';

import { editorLowlight, highlightCode, type HighlightNode } from './code-highlight';
import { codeLanguageLabel, normalizeCodeLanguage } from './code-languages';

/** A highlighted node as a ProseMirror output spec: text stays a string, so it is escaped when written. */
function spec(node: HighlightNode): DOMOutputSpec | string {
  if (node.type === 'text') return node.value ?? '';
  const className = node.properties?.className?.join(' ');
  return ['span', className ? { class: className } : {}, ...(node.children ?? []).map(spec)];
}

/**
 * The code block, configured once, for the editor and for the HTML the server stores.
 *
 * The node is `codeBlock` with one attribute, `language`: `null` for None, `'auto'` for Auto, or
 * an id from code-languages.ts (the server turns anything else into `null` on save). It renders
 * as `<pre class="code-block" data-language="Java"><code class="language-java">` with the text
 * already split into `hljs-*` spans; None is the text alone, and an Auto too weak to name a
 * language carries no label either.
 */
export const codeBlock = CodeBlockLowlight.extend({
  // Here rather than in a configure() after: an extension that extends this one starts from its
  // options again, and would lose the highlighter.
  addOptions() {
    return { ...this.parent?.(), lowlight: editorLowlight } as CodeBlockLowlightOptions;
  },
  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const name = [...(element.firstElementChild?.classList ?? [])].find((value) => value.startsWith('language-'));
          return normalizeCodeLanguage(name?.slice('language-'.length));
        },
        rendered: false,
      },
    };
  },
  // The base rules store whatever follows the fence; "```ts " stores the id it stands for.
  addInputRules() {
    return [/^```([a-z]+)?[\s\n]$/, /^~~~([a-z]+)?[\s\n]$/].map((find) => textblockTypeInputRule({
      find,
      type: this.type,
      getAttributes: (match) => ({ language: normalizeCodeLanguage(match[1]) }),
    }));
  },
  renderHTML({ node }) {
    const { language, nodes } = highlightCode(normalizeCodeLanguage(node.attrs.language), node.textContent);
    const label = codeLanguageLabel(language);
    return [
      'pre',
      label ? { class: 'code-block', 'data-language': label } : { class: 'code-block' },
      ['code', language ? { class: `language-${language}` } : {}, ...(nodes ?? [{ type: 'text', value: node.textContent }]).map(spec)],
    ];
  },
});
