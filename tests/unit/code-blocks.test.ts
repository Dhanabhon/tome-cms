import assert from 'node:assert/strict';
import test from 'node:test';

import { codeLowlight, highlightCode } from '../../src/lib/code-highlight';
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
  for (const value of [undefined, null, '', 'klingon', 'Java', 7, {}, '__proto__', 'constructor']) assert.equal(normalizeCodeLanguage(value), null);
});

test('saving turns an unknown language into None, and keeps a known one and Auto', () => {
  for (const [given, stored] of [['klingon', null], [42, null], ['java', 'java'], ['auto', 'auto'], [null, null]] as const) {
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
