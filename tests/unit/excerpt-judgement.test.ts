import assert from 'node:assert/strict';
import test from 'node:test';

import typesafe from '../../src/plugins/typesafe/index';
import { DESCRIPTION_INSTRUCTIONS, EXCERPT_INSTRUCTIONS, excerptCriteria, NONE } from '../../src/plugins/typesafe/questions';
import { acceptedExcerpt } from '../../src/server/content/excerpt-judgement';

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

test('a description is asked its own question, over the same kind of options', async (context) => {
  // What the service is sent, answered the way it answers: with one of the options by name.
  const sent: { instructions: string; options: string[] }[] = [];
  const realFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const { questions } = JSON.parse(String(init?.body)) as { questions: { pick: { criteria: object; instructions: string } } };
    sent.push({ instructions: questions.pick.instructions, options: Object.keys(questions.pick.criteria) });
    return Response.json({ answers: { pick: { choice: candidates[1], confidence: 0.8 } } });
  }) as typeof fetch;

  const input = { article: { locale: 'en' as const, text: candidates.join(' '), title: 'A title' }, candidates };
  assert.deepEqual(await typesafe.pickDescription?.({ apiKey: 'unit-key' }, input), { passage: candidates[1] });
  assert.deepEqual(await typesafe.pickExcerpt?.({ apiKey: 'unit-key' }, input), { passage: candidates[1] });
  // A card's line and a search result's summary are different judgements about the same
  // passages; asking one for the other would pick a teaser for a summary.
  assert.notEqual(DESCRIPTION_INSTRUCTIONS, EXCERPT_INSTRUCTIONS);
  assert.equal(sent[0]?.instructions, DESCRIPTION_INSTRUCTIONS);
  assert.equal(sent[1]?.instructions, EXCERPT_INSTRUCTIONS);
  assert.deepEqual(sent[0]?.options, [...candidates, NONE], 'the passages, with a way out');
});
