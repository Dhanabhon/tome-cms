import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

import { CODE_LANGUAGES, normalizeCodeLanguage, type CodeLanguage, type CodeLanguageId } from './code-languages';

/**
 * The grammars behind code-languages.ts, registered with lowlight. Only these are bundled:
 * highlight.js's `common` set would add a third of a megabyte to the editor for languages
 * nobody asked for.
 */
const GRAMMARS = { bash, c, csharp, cpp, css, dart, diff, go, graphql, xml, java, javascript, json, kotlin, markdown, php, python, ruby, rust, sql, swift, ini, typescript, yaml } satisfies Record<CodeLanguageId, unknown>;

export const codeLowlight = createLowlight(GRAMMARS as Parameters<typeof createLowlight>[0]);

const IDS = CODE_LANGUAGES.map((language) => language.id);

/**
 * Code longer than this is shown plain. Auto tries every grammar and the editor does it again
 * on each key, so an unbounded block would stall the tab and, on save, the server.
 */
export const HIGHLIGHT_LIMIT = 20_000;
/** Below this a detection is a guess at noise: "hello world" scores 1 as Java, real code 2 and up. */
const MIN_RELEVANCE = 2;

export interface HighlightNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string[] };
  children?: HighlightNode[];
}

/**
 * The text of a code block as highlighted nodes, and the language that was used -- for Auto, the
 * one detected, or `null` when the guess was too weak to colour anything. `null` nodes mean the
 * text stays plain: None, an unknown language, too long, or an Auto with nothing to go on.
 */
export function highlightCode(language: CodeLanguage, text: string): { language: CodeLanguageId | null; nodes: HighlightNode[] | null } {
  if (!language) return { language: null, nodes: null };
  if (language !== 'auto') {
    return { language, nodes: text.length > HIGHLIGHT_LIMIT ? null : (codeLowlight.highlight(language, text).children as HighlightNode[]) };
  }
  if (text.length > HIGHLIGHT_LIMIT) return { language: null, nodes: null };
  const result = codeLowlight.highlightAuto(text, { subset: IDS });
  const detected = normalizeCodeLanguage(result.data?.language);
  const relevance = Number(result.data?.relevance ?? 0);
  return detected && detected !== 'auto' && relevance >= MIN_RELEVANCE
    ? { language: detected, nodes: result.children as HighlightNode[] }
    : { language: null, nodes: null };
}

/**
 * What the code-block extension's highlighter is given in place of lowlight. Its plugin treats a
 * block with no language as one to guess, which would colour every None block: so None and
 * anything unknown answer with nothing, and `'auto'` is taken as a language of its own.
 */
export const editorLowlight = {
  highlight: (language: string, text: string) => ({ children: highlightCode(normalizeCodeLanguage(language), text).nodes ?? [] }),
  highlightAuto: () => ({ children: [] }),
  listLanguages: () => ['auto', ...IDS],
  registered: (language: string) => normalizeCodeLanguage(language) !== null,
};
