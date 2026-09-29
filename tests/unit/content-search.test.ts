import assert from 'node:assert/strict';
import { test } from 'node:test';

import { likeContaining, searchQuery, searchTerms } from '../../src/server/content/search';

test('a search is split into its words, at most five, each cut to a hundred characters', () => {
  assert.deepEqual(searchTerms('  hello   world  '), ['hello', 'world']);
  assert.deepEqual(searchTerms(undefined), []);
  assert.deepEqual(searchTerms('   '), []);
  assert.deepEqual(searchTerms('a b c d e f g'), ['a', 'b', 'c', 'd', 'e'], 'a sixth word is not asked for');
  assert.equal(searchTerms('x'.repeat(150)).join('').length, 100, 'a hundred characters in all');
  assert.deepEqual(searchTerms('ค้นหา　บทความ'), ['ค้นหา', 'บทความ'], 'an ideographic space also separates words');
  assert.deepEqual(searchTerms('a\u0000b'), ['a', 'b'], 'a NUL cannot be stored in text, so it separates words');
  assert.deepEqual(searchTerms('Q&A'), ['Q&A']);
});

test('the cut is made between characters, never through one', () => {
  const kept = searchTerms('😀'.repeat(150)).join('');
  assert.equal([...kept].length, 100);
  assert.doesNotMatch(kept, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/, 'no half of a pair is left');
});

test('a term is a pattern that finds it anywhere, and % _ and the escape mean themselves', () => {
  assert.equal(likeContaining('cats'), '%cats%');
  assert.equal(likeContaining('100%'), '%100\\%%');
  assert.equal(likeContaining('snake_case'), '%snake\\_case%');
  assert.equal(likeContaining('back\\slash'), '%back\\\\slash%');
  assert.equal(likeContaining('wow!'), '%wow!%', '! is nothing special when the escape is a backslash');
});

test('the query a page shows is the words that were searched, or none', () => {
  assert.equal(searchQuery('  hello   world  '), 'hello world');
  assert.equal(searchQuery('\u0000\u0001\u001f'), undefined, 'control characters alone are no search');
  assert.equal(searchQuery('   '), undefined);
  assert.equal(searchQuery(null), undefined);
  assert.equal(searchQuery(undefined), undefined);
  assert.equal(searchQuery(`${'a'.repeat(99)}😀b`), `${'a'.repeat(99)}😀`, 'cut after 100 characters, and not through the emoji');
});
