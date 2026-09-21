import assert from 'node:assert/strict';
import test from 'node:test';

import { excerptCandidates, PASSAGE_LENGTH } from '../../src/lib/excerpt-candidates';

// The opening of an article on this site, as written.
const THAI = 'Claude Code Intent.MD ได้เปลี่ยนวิธีการออกแบบและพัฒนาซอฟต์แวร์ของผมไปอย่างสิ้นเชิงแล้ว '
  + 'ผมได้ลองใช้วิธีนี้กับโปรเจกต์แอปส่วนตัวที่เพิ่งทำไปครับ ไอเดียของแอปนี้มาจากปัญหาที่เจอจริง ๆ '
  + 'นั่นคือเรื่องการจัดการช่วงเวลาระหว่างมื้ออาหาร '
  + 'ผมเลยตัดสินใจสร้างแอปสำหรับการทำ Intermittent Fasting ที่ปรับให้เหมาะกับแต่ละบุคคลขึ้นมา';

test('a Thai paragraph is more than one candidate', () => {
  // ICU reads this whole paragraph as a single sentence. If that were the unit, there would
  // be nothing short enough to choose from and a Thai article would never get a suggestion.
  const found = excerptCandidates(THAI, 'th');
  assert.ok(found.length > 3, `${found.length} candidates`);
  assert.ok(found.includes('ผมได้ลองใช้วิธีนี้กับโปรเจกต์แอปส่วนตัวที่เพิ่งทำไปครับ'), 'a clause on its own');
});

test('a space inside a word or around an English term is not a break', () => {
  const found = excerptCandidates(THAI, 'th');
  // จริง ๆ is one word written with a space, and stays one.
  assert.ok(found.some((passage) => passage.endsWith('จริง ๆ')), 'จริง ๆ was split');
  assert.ok(!found.some((passage) => passage.startsWith('ๆ')), 'a clause cannot start with ๆ');
  // An English term set into a Thai clause belongs to that clause.
  assert.ok(found.some((passage) => passage.includes('การทำ Intermittent Fasting ที่ปรับ')), 'the English term was cut out');
  assert.ok(found.some((passage) => passage.startsWith('Claude Code Intent.MD ได้เปลี่ยน')), 'the opening was cut apart');
});

test('every candidate is the article\'s own words, in its own order', () => {
  // The property the whole design rests on: whatever is chosen was written by the owner.
  for (const [text, locale] of [[THAI, 'th'], ['One sentence here. Another follows it! And a third one, too?', 'en']] as const) {
    const prose = text.replace(/\s+/g, ' ');
    for (const purpose of ['excerpt', 'description'] as const) {
      for (const passage of excerptCandidates(text, locale, purpose)) {
        assert.ok(prose.includes(passage), `"${passage}" is not in the text`);
        assert.ok(passage.length <= PASSAGE_LENGTH[purpose], `${passage.length} is more than the ${purpose} holds`);
      }
    }
  }
});

test('a description may run as long as a search result shows, and no longer', () => {
  const sentences = [
    'TomeCMS keeps every article in PostgreSQL and every file in S3.',
    'The owner signs in with a Passkey and writes in the language their readers read.',
    'Nothing leaves the server unless the owner switches a plugin on.',
  ];
  const text = sentences.join(' ');
  // 144 characters: too long for a card, short enough for a search result.
  const two = sentences.slice(0, 2).join(' ');
  assert.ok(!excerptCandidates(text, 'en').includes(two), 'a card cannot hold two of them');
  const found = excerptCandidates(text, 'en', 'description');
  assert.ok(found.includes(two), 'a search result can');
  assert.ok(!found.includes(text), 'but not all three');
});

test('English sentences are units, and runs of them are candidates too', () => {
  const found = excerptCandidates('The first sentence says little. The second carries the idea. A third wraps it up.', 'en');
  assert.ok(found.includes('The second carries the idea.'));
  assert.ok(found.includes('The first sentence says little. The second carries the idea.'), 'two together is one candidate');
});

test('too short to decide on, too long to hold, and repeats are left out', () => {
  assert.deepEqual(excerptCandidates('Hi. Ok.', 'en'), [], 'fragments are not excerpts');
  assert.deepEqual(excerptCandidates('x'.repeat(200), 'en'), [], 'nothing fits the field');
  const repeated = excerptCandidates('This line appears twice. This line appears twice.', 'en');
  assert.equal(repeated.filter((passage) => passage === 'This line appears twice.').length, 1, 'one of each');
});
