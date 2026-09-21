import assert from 'node:assert/strict';
import test from 'node:test';

import { categoryQuestions, LIKELY, POSSIBLE, suggestionBands } from '../../src/server/content/category-judgement';

const categories = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Architecture' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'สถาปัตยกรรม' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Uncategorized' },
];

test('every category is asked about under the name it has', () => {
  const asked = categoryQuestions(categories);
  assert.equal(asked.size, categories.length);

  // The ids are this file's, not the model's: nothing is sent that says which question is
  // which, so a question that does not name its category is a question about nothing.
  for (const [id, { category, question }] of asked) {
    assert.match(id, /^c\d+$/);
    assert.ok(question.instructions.includes(`"${category.name}"`), `${id} does not name ${category.name}`);
    assert.ok(question.criteria?.true.includes(category.name), `${id} has no yes for ${category.name}`);
    assert.ok(question.criteria?.false.includes(category.name), `${id} has no no for ${category.name}`);
  }
});

test('a passing mention is spelled out as a no', () => {
  // Without it, "does this belong under Design?" is true of any article that says the word
  // once, and the owner is handed every category they have.
  const [first] = [...categoryQuestions(categories).values()];
  assert.match(first!.question.criteria!.false, /in passing/);
});

test('likely, possible and neither are three answers', () => {
  const asked = categoryQuestions(categories);
  const ids = [...asked.keys()];
  const shown = suggestionBands(asked, { [ids[0]!]: 0.55, [ids[1]!]: 0.94, [ids[2]!]: 0.12 });

  assert.deepEqual(
    shown.map(({ band, name }) => [name, band]),
    [['สถาปัตยกรรม', 'likely'], ['Architecture', 'possible']],
    'a clear yes is suggested, a maybe is offered as one, and a clear no is not shown',
  );
  assert.deepEqual(shown.map(({ id }) => id), [categories[1]!.id, categories[0]!.id], 'likeliest first');
});

test('the two sides of a single line are not opposite answers', () => {
  // 0.59 and 0.61 were hidden and suggested. Both are the model saying it is not sure, and
  // both land in the same band now.
  const asked = categoryQuestions(categories);
  const [low, high] = [...asked.keys()];
  const bands = suggestionBands(asked, { [low!]: 0.59, [high!]: 0.61 }).map(({ band }) => band);
  assert.deepEqual(bands, ['possible', 'possible']);
});

test('the edges belong to the band above them', () => {
  const asked = categoryQuestions(categories);
  const [first, second] = [...asked.keys()];
  const shown = suggestionBands(asked, { [first!]: LIKELY, [second!]: POSSIBLE });
  assert.deepEqual(shown.map(({ band }) => band), ['likely', 'possible']);
});

test('an answer that did not come back is not a suggestion', () => {
  // A question the service dropped reads as absent rather than as certain: a missing
  // answer must never file an article, and must never look like a confident no either.
  const asked = categoryQuestions(categories);
  assert.deepEqual(suggestionBands(asked, {}), []);
});
