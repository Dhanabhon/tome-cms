import assert from 'node:assert/strict';
import test from 'node:test';

import { LIKELY, POSSIBLE, suggestionBands } from '../../src/server/content/category-judgement';
import { categoryQuestions } from '../../src/plugins/typesafe/questions';

const categories = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Architecture' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'สถาปัตยกรรม' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Uncategorized' },
];
const [architecture, thai, fallback] = categories;

test('the plugin asks about every category under the name it has', () => {
  const asked = categoryQuestions(categories);
  assert.equal(asked.size, categories.length);
  // The ids are the plugin's, not the model's: nothing is sent that says which question is
  // which, so a question that does not name its category is a question about nothing.
  for (const [id, { category, question }] of asked) {
    assert.match(id, /^c\d+$/);
    assert.ok(question.instructions.includes(`"${category.name}"`), `${id} does not name ${category.name}`);
    assert.ok(question.criteria?.true.includes(category.name), `${id} has no yes for ${category.name}`);
    assert.ok(question.criteria?.false.includes(category.name), `${id} has no no for ${category.name}`);
  }
});

test('a passing mention is spelled out as a no', () => {
  const [first] = [...categoryQuestions(categories).values()];
  assert.match(first!.question.criteria!.false, /in passing/);
});

test('likely, possible and neither are three answers, decided by the core', () => {
  const shown = suggestionBands(categories, { [architecture!.id]: 0.55, [thai!.id]: 0.94, [fallback!.id]: 0.12 });
  assert.deepEqual(
    shown.map(({ band, name }) => [name, band]),
    [['สถาปัตยกรรม', 'likely'], ['Architecture', 'possible']],
    'a clear yes is suggested, a maybe is offered as one, and a clear no is not shown',
  );
});

test('the two sides of a single line are not opposite answers', () => {
  const bands = suggestionBands(categories, { [architecture!.id]: 0.59, [thai!.id]: 0.61 }).map(({ band }) => band);
  assert.deepEqual(bands, ['possible', 'possible']);
});

test('the edges belong to the band above them', () => {
  const shown = suggestionBands(categories, { [architecture!.id]: LIKELY, [thai!.id]: POSSIBLE });
  assert.deepEqual(shown.map(({ band }) => band), ['likely', 'possible']);
});

test('a category the judgement did not answer for is not a suggestion', () => {
  // Absent, never a confident no and never a yes: a missing answer must not file an article.
  assert.deepEqual(suggestionBands(categories, {}), []);
  assert.deepEqual(suggestionBands(categories, { 'not-one-of-theirs': 0.99 }), [], 'an id the owner does not have is ignored');
});
