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
 * Code longer than this is shown plain. Highlighting is slower than linear on a long unbroken run
 * (20,000 of one letter takes seconds), and the editor does it again on each key.
 */
export const HIGHLIGHT_LIMIT = 20_000;
/** Auto tries every grammar, the slowest of them first in line: it reads this much of a block to name the language, and the rest is coloured as that language. */
export const AUTO_LIMIT = 2_000;
/**
 * The characters of code one document has coloured, across its blocks. Past it the rest of the
 * blocks are plain, and keep their label when their language was chosen. A post of many long
 * blocks would otherwise hold the server, on a save, for as long as the sum of them.
 */
export const HIGHLIGHT_BUDGET = 50_000;
/** Below this a detection is a guess at noise: "hello world" scores 1 as Java, real code 2 and up. */
const MIN_RELEVANCE = 2;

interface Budget { remaining: number }
let scoped: Budget | null = null;
let ambient: Budget | null = null;

/**
 * Runs `render` with a budget of its own, which is how a document rendered for storage is held to
 * one. Outside a scope (the editor, which colours every block on each change) the budget is the
 * one synchronous pass: it is filled again at the next turn of the event loop.
 */
export function withHighlightBudget<T>(render: () => T): T {
  const outer = scoped;
  scoped = { remaining: HIGHLIGHT_BUDGET };
  try {
    return render();
  } finally {
    scoped = outer;
  }
}

function budget(): Budget {
  if (scoped) return scoped;
  if (!ambient) {
    ambient = { remaining: HIGHLIGHT_BUDGET };
    queueMicrotask(() => { ambient = null; });
  }
  return ambient;
}

/** Takes `length` characters from the budget, or says there are not that many left. */
function spend(length: number): boolean {
  const current = budget();
  if (length > current.remaining) return false;
  current.remaining -= length;
  return true;
}

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
  if (text.length > HIGHLIGHT_LIMIT || !spend(text.length)) return { language: language === 'auto' ? null : language, nodes: null };
  if (language !== 'auto') return { language, nodes: codeLowlight.highlight(language, text).children as HighlightNode[] };
  const result = codeLowlight.highlightAuto(text.slice(0, AUTO_LIMIT), { subset: IDS });
  const detected = normalizeCodeLanguage(result.data?.language);
  if (!detected || detected === 'auto' || Number(result.data?.relevance ?? 0) < MIN_RELEVANCE) return { language: null, nodes: null };
  return {
    language: detected,
    nodes: (text.length > AUTO_LIMIT ? codeLowlight.highlight(detected, text) : result).children as HighlightNode[],
  };
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
