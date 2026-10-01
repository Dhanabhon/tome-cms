import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTO_LIMIT, codeLowlight, HIGHLIGHT_BUDGET, highlightCode } from '../../src/lib/code-highlight';
import { CODE_LANGUAGES, codeLanguageLabel, normalizeCodeLanguage } from '../../src/lib/code-languages';
import { sanitizedContentHtmlSchema } from '../../src/lib/editor-content';
import { prepareEditorContent } from '../../src/server/content/editor';
import type { EditorDocument, Json } from '../../src/types/cms';

const JAVA = 'public static void main(String[] args) {}';
const TYPESCRIPT = 'interface User { id: number }\nconst u: User = { id: 1 };\nexport type Id = string | number;';

function block(text: string, language?: Json): EditorDocument {
  return {
    type: 'doc',
    content: [{ type: 'codeBlock', ...(language === undefined ? {} : { attrs: { language } }), content: text ? [{ type: 'text', text }] : [] }],
  };
}

test('the language list has 24 entries, sorted by label, each registered with lowlight', () => {
  assert.equal(CODE_LANGUAGES.length, 24);
  const labels = CODE_LANGUAGES.map((language) => language.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
  assert.equal(codeLanguageLabel('ini'), 'TOML, INI');
  assert.equal(codeLanguageLabel('xml'), 'HTML, XML');
  assert.equal(codeLanguageLabel('nope'), null);
  assert.deepEqual([...codeLowlight.listLanguages()].sort(), CODE_LANGUAGES.map((language) => language.id).sort());
});

test('a stored language is None, Auto or a listed id, and anything else is None', () => {
  assert.equal(normalizeCodeLanguage('java'), 'java');
  assert.equal(normalizeCodeLanguage('auto'), 'auto');
  for (const value of [undefined, null, '', 'klingon', 7, {}, '__proto__', 'constructor', 'toString']) assert.equal(normalizeCodeLanguage(value), null);
});

test('the usual short names, in any case, are the list\'s ids', () => {
  const aliases: Record<string, string> = {
    javascript: 'js jsx mjs cjs', typescript: 'ts tsx', bash: 'sh shell zsh console', python: 'py', ruby: 'rb', yaml: 'yml',
    xml: 'html htm svg xhtml', cpp: 'c++ cc hpp cxx', csharp: 'cs c#', kotlin: 'kt kts', markdown: 'md', rust: 'rs', ini: 'toml',
    go: 'golang', graphql: 'gql', diff: 'patch', c: 'h', json: 'jsonc',
  };
  for (const [id, names] of Object.entries(aliases)) {
    for (const name of names.split(' ')) {
      assert.equal(normalizeCodeLanguage(name), id, name);
      assert.equal(normalizeCodeLanguage(name.toUpperCase()), id, name.toUpperCase());
    }
  }
  assert.equal(normalizeCodeLanguage('Java'), 'java');
  assert.equal(normalizeCodeLanguage(' Auto '), 'auto');
});

test('saving turns an unknown language into None, and keeps a known one and Auto', () => {
  for (const [given, stored] of [['klingon', null], [42, null], ['java', 'java'], ['ts', 'typescript'], ['auto', 'auto'], [null, null]] as const) {
    const content = prepareEditorContent({ contentJson: block('x', given) });
    assert.equal(content.contentJson.content?.[0]?.attrs?.language ?? null, stored, `${String(given)}`);
  }
  // A post from before code blocks had a language has no attribute at all.
  assert.equal(prepareEditorContent({ contentJson: block('x') }).contentJson.content?.[0]?.attrs?.language ?? null, null);
});

test('a chosen language is highlighted on the page and labelled', () => {
  const { contentHtml } = prepareEditorContent({ contentJson: block(JAVA, 'java') });
  assert.match(contentHtml, /^<pre class="code-block" data-language="Java"><code class="language-java">/);
  assert.match(contentHtml, /<span class="hljs-keyword">public<\/span>/);
  assert.ok(contentHtml.replace(/<[^>]+>/g, '').includes(JAVA));
});

test('Auto names what it detected, and says nothing when the guess is noise', () => {
  const typed = prepareEditorContent({ contentJson: block(TYPESCRIPT, 'auto') }).contentHtml;
  assert.match(typed, /^<pre class="code-block" data-language="TypeScript"><code class="language-typescript">.*hljs-keyword/s);
  const noise = prepareEditorContent({ contentJson: block('hello world', 'auto') }).contentHtml;
  assert.equal(noise, '<pre class="code-block"><code>hello world</code></pre>');
});

test('None is the text alone: no spans, no label, no language class', () => {
  for (const language of [undefined, null, 'klingon'] as const) {
    const { contentHtml } = prepareEditorContent({ contentJson: block(JAVA, language) });
    assert.equal(contentHtml, `<pre class="code-block"><code>${JAVA}</code></pre>`);
  }
});

test('code comes out as text, whatever the language', () => {
  const script = '<script>alert(1)</script>';
  for (const language of [undefined, 'auto', 'xml', 'javascript'] as const) {
    const { contentHtml } = prepareEditorContent({ contentJson: block(script, language) });
    assert.doesNotMatch(contentHtml, /<script/i, String(language));
    assert.match(contentHtml.replace(/<[^>]+>/g, ''), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, String(language));
  }
});

test('a block too long to highlight stays plain but keeps its chosen language', () => {
  const long = `int a = 1;\n`.repeat(3000);
  const { contentHtml } = prepareEditorContent({ contentJson: block(long, 'java') });
  assert.doesNotMatch(contentHtml, /hljs-/);
  assert.match(contentHtml, /data-language="Java"/);
  assert.deepEqual(highlightCode('auto', long), { language: null, nodes: null });
});

test('the sanitizer keeps a code block\'s own classes and labels and nothing else', () => {
  const keep = '<pre class="code-block" data-language="TOML, INI"><code class="language-ini"><span class="hljs-built_in">a</span><span class="hljs-title function_">b</span></code></pre>';
  assert.equal(sanitizedContentHtmlSchema.parse(keep), keep.replace(' function_', ''));
  const crafted = sanitizedContentHtmlSchema.parse(
    '<pre class="code-block evil" data-language="&lt;x&gt;" onclick="x()"><code class="language-klingon language-java"><span class="evil hljs-string">a</span><span class="hljs-">b</span></code></pre><p class="code-block">p</p><div class="hljs-string">d</div>',
  );
  assert.equal(
    crafted,
    '<pre class="code-block"><code class="language-java"><span class="hljs-string">a</span><span>b</span></code></pre><p>p</p><div>d</div>',
  );
  assert.equal(sanitizedContentHtmlSchema.parse('<pre data-language="Java"><code>a</code></pre>'), '<pre data-language="Java"><code>a</code></pre>');
  assert.equal(sanitizedContentHtmlSchema.parse('<pre data-language="Fortran"><code>a</code></pre>'), '<pre><code>a</code></pre>');
});

test('an Auto block of one repeated letter saves in well under a second', () => {
  // Detection is slower than linear: 20,000 of one letter took six seconds read whole.
  const started = performance.now();
  const { contentHtml } = prepareEditorContent({ contentJson: block('a'.repeat(20_000), 'auto') });
  const took = performance.now() - started;
  assert.ok(took < 1_000, `took ${Math.round(took)} ms`);
  assert.match(contentHtml, /a{20000}/, 'the text is all there');
});

test('Auto names the language from the start of a long block, and colours all of it', () => {
  const code = Array.from({ length: 80 }, (_, index) => `export async function load${index}(id: number, name: string): Promise<User[]> { const rows: Array<User> = await fetchUsers(id, name); return rows; }\ninterface Row${index} { id: number; name: string }`).join('\n');
  assert.ok(code.length > AUTO_LIMIT * 4);
  const { language, nodes } = highlightCode('auto', code);
  assert.equal(language, 'typescript');
  assert.equal(nodes?.map(function text(node): string { return node.value ?? (node.children ?? []).map(text).join(''); }).join(''), code);
});

test('a document has a budget of code to colour; the blocks past it are plain and keep a chosen label', () => {
  const chunk = `int a = 1;\n`.repeat(Math.floor(15_000 / 'int a = 1;\n'.length));
  const blocks = Math.ceil(HIGHLIGHT_BUDGET / chunk.length) + 2;
  const { contentHtml } = prepareEditorContent({ contentJson: {
    type: 'doc',
    content: Array.from({ length: blocks }, () => ({ type: 'codeBlock', attrs: { language: 'java' }, content: [{ type: 'text', text: chunk }] })),
  } });
  const pres = contentHtml.split('<pre ').slice(1);
  assert.equal(pres.length, blocks);
  assert.match(pres[0]!, /hljs-/, 'the first blocks are coloured');
  assert.doesNotMatch(pres[blocks - 1]!, /hljs-/, 'the last is plain');
  for (const pre of pres) assert.match(pre, /data-language="Java"/, 'every block keeps its label');
  // Each document has a budget of its own: the same document rendered again is the same.
  assert.equal(prepareEditorContent({ contentJson: block(chunk, 'java') }).contentHtml.includes('hljs-'), true);
});
