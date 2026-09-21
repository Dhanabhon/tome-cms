import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptedExcerpt } from '../../src/server/content/excerpt-judgement';
import { excerptCriteria, NONE } from '../../src/plugins/typesafe/questions';

const candidates = ['The first passage of the article.', 'The passage that says what it is about.'];

test('the plugin offers the passages as the options, with a way out', () => {
  const criteria = excerptCriteria(candidates);
  assert.deepEqual(Object.keys(criteria), [...candidates, NONE], 'an option\'s name is what comes back');
  assert.ok(criteria[NONE], 'the way out says when to take it');
});

test('the core keeps a passage that was offered, and only that', () => {
  assert.equal(acceptedExcerpt(candidates, candidates[1]!), candidates[1]);
  // Whichever plugin answered: a card shows words the owner wrote, and an answer that is
  // not one of the offered passages does not reach it.
  assert.equal(acceptedExcerpt(candidates, 'A summary nobody wrote.'), null);
});

test('no line is an answer of its own', () => {
  assert.equal(acceptedExcerpt(candidates, null), null);
});
