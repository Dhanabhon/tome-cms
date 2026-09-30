import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adminCopy } from '../../src/lib/admin-i18n';
import type { ImportLimit, ImportWarning } from '../../src/lib/markdown-import';
import { refusalText, warningText } from '../../src/lib/markdown-import-text';

const LIMITS: ImportLimit[] = ['blocks', 'lines', 'inline', 'emphasis', 'pictures', 'html', 'depth', 'time', 'block-lines', 'definitions', 'size'];
const WARNINGS: ImportWarning[] = [
  { code: 'frontmatter-unreadable' },
  { code: 'status-ignored' },
  { code: 'date-unreadable' },
  { code: 'html-removed', count: 3 },
  { code: 'links-removed', count: 2 },
  { code: 'task-list' },
  { code: 'category-missing', names: ['Travel', 'Food'] },
  { code: 'slug-changed', slug: 'hello-1234' },
];

for (const locale of ['en', 'th'] as const) {
  const { markdownImport: text } = adminCopy(locale);

  test(`every limit a file can run over is told in its own words (${locale})`, () => {
    const lines = LIMITS.map((limit) => refusalText(text, { status: 413, warning: { code: 'too-complex', limit } }));
    assert.equal(new Set(lines).size, LIMITS.length, 'one sentence per limit');
    for (const line of lines) assert.notEqual(line, text.failed);
  });

  test(`a busy server, a file over the size and an unknown failure each have a line (${locale})`, () => {
    assert.equal(refusalText(text, { status: 429, warning: { code: 'busy' } }), text.busy);
    assert.equal(refusalText(text, { status: 413 }), text.tooLarge);
    assert.equal(refusalText(text, { status: 500 }), text.failed);
    assert.equal(refusalText(text, undefined), text.failed);
  });

  test(`every warning of a finished import reads as a sentence (${locale})`, () => {
    for (const warning of WARNINGS) {
      const line = warningText(text, warning);
      assert.ok(line && !/[{}]/.test(line), `${warning.code}: ${line}`);
    }
    assert.match(warningText(text, { code: 'category-missing', names: ['Travel', 'Food'] }), /Travel, Food/);
    assert.match(warningText(text, { code: 'slug-changed', slug: 'hello-1234' }), /hello-1234/);
  });
}
