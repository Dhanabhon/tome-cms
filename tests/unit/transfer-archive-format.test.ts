import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ArchiveInputError, itemPath, mediaLink, mediaPath, readFrontMatter, readManifest, writeFrontMatter, type ArchiveManifest, type FrontMatter,
} from '../../src/server/transfer/archive-format';

const KEY = 'owners/11111111-1111-4111-8111-111111111111/2026/10/22222222-2222-4222-8222-222222222222.webp';

const every: FrontMatter = {
  title: 'Bread: "at night"',
  slug: 'bread-at-night',
  language: 'en',
  status: 'published',
  published: '2026-10-01T08:00:00.000Z',
  planned: '2026-10-02T08:00:00.000Z',
  updated: '2026-10-03T08:00:00.000Z',
  categories: ['Baking', 'ขนม'],
  excerpt: 'true',
  cover: mediaLink(KEY),
  show_cover: false,
  meta_title: '12',
  meta_description: 'A loaf, after dark.',
  translation: '33333333-3333-4333-8333-333333333333',
};

test('an item and its media have one place each in the archive', () => {
  assert.equal(itemPath('post', 'th', 'ขนมปัง-ยามค่ำ', '.md'), 'posts/th/ขนมปัง-ยามค่ำ.md');
  assert.equal(itemPath('page', 'en', 'about', '.tome.json'), 'pages/en/about.tome.json');
  assert.equal(mediaPath(KEY), `media/${KEY}`);
  assert.equal(mediaLink(KEY), `../../media/${KEY}`, 'a link from an item file into media/');
});

test('front matter with every field reads back as it was written', () => {
  const source = `${writeFrontMatter(every)}\nThe body.\n`;
  assert.match(source, /^---\ntitle: /);
  const { frontMatter, body } = readFrontMatter(source, 'posts/en/bread-at-night.md');
  assert.deepEqual(frontMatter, every);
  assert.equal(body, 'The body.\n');
});

test('a Thai title and a Thai slug survive byte for byte', () => {
  const thai: FrontMatter = { ...every, title: 'ขนมปังยามค่ำ', slug: 'ขนมปัง-ยามค่ำ', language: 'th' };
  const written = writeFrontMatter(thai);
  assert.ok(written.includes('slug: ขนมปัง-ยามค่ำ\n'), 'written as itself, not escaped');
  const { frontMatter } = readFrontMatter(`${written}\n`, 'posts/th/ขนมปัง-ยามค่ำ.md');
  assert.deepEqual(Buffer.from(frontMatter.title!), Buffer.from('ขนมปังยามค่ำ'));
  assert.deepEqual(Buffer.from(frontMatter.slug!), Buffer.from('ขนมปัง-ยามค่ำ'));
});

test('a field of the wrong type is refused, naming the file', () => {
  const file = 'posts/en/x.md';
  for (const field of ['published: 12', 'show_cover: "yes"', 'categories: Baking', 'language: fr', 'status: live', 'published: soon']) {
    assert.throws(
      () => readFrontMatter(`---\ntitle: X\n${field}\n---\n`, file),
      (error) => error instanceof ArchiveInputError && error.code === 'front_matter_invalid' && error.file === file,
      field,
    );
  }
  for (const source of ['no front matter', '---\nslug: x\n---\n', '---\ntitle: [unclosed\n---\n', '---\n- a list\n---\n']) {
    assert.throws(() => readFrontMatter(source, file), ArchiveInputError, source);
  }
});

test('a hand-written file with only a title reads, and unknown keys are ignored', () => {
  const { frontMatter, body } = readFrontMatter('---\ntitle: Notes\nauthor: Someone\n---\n# Heading\n', 'posts/en/notes.md');
  assert.deepEqual(frontMatter, { title: 'Notes' });
  assert.equal(body, '# Heading\n');
});

test('a file written on Windows, with CRLF line endings and a byte order mark, reads', () => {
  const { frontMatter, body } = readFrontMatter('\uFEFF---\r\ntitle: Notes\r\nstatus: draft\r\n---\r\n\r\nText\r\n', 'posts/en/notes.md');
  assert.deepEqual(frontMatter, { title: 'Notes', status: 'draft' });
  assert.equal(body, 'Text\r\n');
});

const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const manifest: ArchiveManifest = {
  format: 'tomecms-markdown',
  version: 1,
  createdAt: '2026-10-03T08:00:00.000Z',
  applicationVersion: '1.13.0',
  publicUrl: 'https://example.com',
  counts: { posts: 2, pages: 1, media: 1 },
  media: { [MEDIA_ID]: { path: mediaPath(KEY), name: 'ขนม.webp', type: 'image/webp', sha256: `${'A'.repeat(43)}=`, size: 1024 } },
};

test('a manifest reads back as it was written, with each file by its id', () => {
  assert.deepEqual(readManifest(JSON.stringify(manifest)), manifest);
});

test('a manifest that does not hold together is refused', () => {
  const refused = (value: unknown) => assert.throws(
    () => readManifest(typeof value === 'string' ? value : JSON.stringify(value)),
    (error) => error instanceof ArchiveInputError && error.code === 'manifest_invalid' && error.file === 'manifest.json',
  );
  refused('not json');
  refused({ ...manifest, format: 'tomecms-backup' });
  refused({ ...manifest, version: 2 });
  refused({ ...manifest, counts: { ...manifest.counts, media: 2 } });
  refused({ ...manifest, media: { [MEDIA_ID]: { ...manifest.media[MEDIA_ID], path: `../${KEY}` } } });
  refused({ ...manifest, media: { [MEDIA_ID]: { ...manifest.media[MEDIA_ID], path: `media/../${KEY}` } } });
  refused({ ...manifest, media: { [MEDIA_ID]: { ...manifest.media[MEDIA_ID], size: '1024' } } });
});
