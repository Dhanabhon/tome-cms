import assert from 'node:assert/strict';
import { test } from 'node:test';

import { duplicateSlugCandidates, duplicateTitle, normalizedContentSlugSchema } from '../../src/server/content/mutations';

const ID = '123e4567-e89b-42d3-a456-426614174000';

test('a copy never reuses the slug it was made from', () => {
  // (locale, slug) is unique, so reusing it is not untidy, it is a failed insert.
  const [first, second] = duplicateSlugCandidates('hello-world', ID);
  assert.equal(first, 'hello-world-copy');
  assert.equal(second, 'hello-world-copy-123e4567');
  assert.notEqual(first, 'hello-world');
  assert.notEqual(first, second);
});

test('both candidates stay inside the slug column and its pattern', () => {
  for (const slug of ['a', 'hello-world', 'x'.repeat(160), `${'ab-'.repeat(53)}cd`]) {
    for (const candidate of duplicateSlugCandidates(slug, ID)) {
      assert.ok(candidate.length <= 160, `${candidate.length} characters is over the column cap`);
      assert.doesNotThrow(
        () => normalizedContentSlugSchema.parse(candidate),
        `${candidate} does not match the slug pattern the schema enforces`,
      );
    }
  }
});

test('trimming for the suffix never leaves a dangling hyphen', () => {
  // Slicing a slug to make room lands mid-word as often as not, and a trailing
  // hyphen is exactly what the slug pattern rejects.
  const long = `${'word-'.repeat(40)}end`;
  for (const candidate of duplicateSlugCandidates(long, ID)) {
    assert.ok(!candidate.replace(/-copy(-[0-9a-f]{8})?$/, '').endsWith('-'), candidate);
    assert.doesNotThrow(() => normalizedContentSlugSchema.parse(candidate));
  }
});

test('the title marker follows the content language, not the admin', () => {
  assert.equal(duplicateTitle('Hello world', 'en'), 'Hello world (copy)');
  assert.equal(duplicateTitle('สวัสดีชาวโลก', 'th'), 'สวัสดีชาวโลก (สำเนา)');
});

test('a marked title still fits the column', () => {
  for (const locale of ['en', 'th'] as const) {
    const marked = duplicateTitle('ก'.repeat(200), locale);
    assert.ok(marked.length <= 200, `${marked.length} characters is over the 200 the schema allows`);
    assert.ok(marked.endsWith(locale === 'th' ? '(สำเนา)' : '(copy)'), 'the marker is what gets cut, and must not be');
  }
});
