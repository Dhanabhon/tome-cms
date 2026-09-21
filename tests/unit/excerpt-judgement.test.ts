import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptedExcerpt, excerptCriteria, NONE } from '../../src/server/content/excerpt-judgement';

const candidates = ['The first passage of the article.', 'The passage that says what it is about.'];

test('the passages are the options, with a way out', () => {
  const criteria = excerptCriteria(candidates);
  assert.deepEqual(Object.keys(criteria), [...candidates, NONE], 'an option\'s name is what comes back');
  assert.ok(criteria[NONE], 'the way out says when to take it');
});

test('what is accepted is a passage that was offered, and only that', () => {
  assert.equal(acceptedExcerpt(candidates, { choice: candidates[1]! }), candidates[1]);
  // The promise is that a card shows words the owner wrote. An answer that is not one of
  // the offered passages -- however it came about -- does not reach the card.
  assert.equal(acceptedExcerpt(candidates, { choice: 'A summary nobody wrote.' }), null);
});

test('no line, no answer and no key all come back as nothing', () => {
  assert.equal(acceptedExcerpt(candidates, { choice: NONE }), null, 'nothing works on its own');
  assert.equal(acceptedExcerpt(candidates, null), null, 'the service did not answer');
});
