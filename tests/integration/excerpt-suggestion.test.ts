import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

const SENTENCES = [
  'TomeCMS keeps every article in PostgreSQL and every file in S3.',
  'The owner signs in with a Passkey and writes in the language their readers read.',
  'Nothing leaves the server unless the owner switches a plugin on.',
];

/**
 * Which question each field is asked, and over which passages.
 *
 * The browser tests answer these requests in the browser, and the plugin's own test calls the
 * plugin directly, so neither would notice the server asking the card's question for the
 * search result's field -- or offering a description only what a card can hold.
 */
test('a description is asked as a description, over passages a search result can show', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { writePluginSettings } = await import('../../src/server/plugins/store');
  const { suggestExcerpt } = await import('../../src/server/content/excerpt-suggestion');
  const { PASSAGE_LENGTH } = await import('../../src/lib/excerpt-candidates');
  const { DESCRIPTION_INSTRUCTIONS, EXCERPT_INSTRUCTIONS, NONE } = await import('../../src/plugins/typesafe/questions');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('plugin_settings').execute();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values({
    id: 'owner-s', name: 'Owner', email: 'suggest@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();

  // The service, answering with the longest passage it was offered: for a description that
  // is one a card could not have held.
  const asked: { instructions: string; options: string[] }[] = [];
  const realFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    assert.match(String(input), /^https:\/\/api\.typesafe\.ai\//, 'nothing else is asked');
    const { questions } = JSON.parse(String(init?.body)) as { questions: { pick: { criteria: object; instructions: string } } };
    const options = Object.keys(questions.pick.criteria);
    asked.push({ instructions: questions.pick.instructions, options });
    const choice = options.filter((option) => option !== NONE).sort((a, b) => b.length - a.length)[0];
    return Response.json({ answers: { pick: { choice, confidence: 0.9 } } });
  }) as typeof fetch;

  const article = {
    contentJson: {
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: SENTENCES.join(' ') }] }],
    } as EditorDocument,
    locale: 'en' as const,
    title: 'Suggestions',
  };

  assert.equal(await suggestExcerpt(article, 'owner-s', 'description'), null, 'nobody to ask with no plugin on');
  assert.equal(asked.length, 0, 'and nothing was sent');

  await writePluginSettings('owner-s', { enabled: true, id: 'typesafe', values: { apiKey: 'integration-key-never-sent' } });

  const description = await suggestExcerpt(article, 'owner-s', 'description');
  assert.equal(asked[0]?.instructions, DESCRIPTION_INSTRUCTIONS);
  assert.ok(asked[0]?.options.includes(NONE), 'with a way out');
  assert.ok(asked[0]?.options.some((option) => option.length > PASSAGE_LENGTH.excerpt), 'offered only what a card holds');
  assert.ok(asked[0]?.options.every((option) => option === NONE || option.length <= PASSAGE_LENGTH.description));
  // The last two sentences, 145 characters: the owner's own words, as written.
  assert.equal(description, SENTENCES.slice(1).join(' '));

  const excerpt = await suggestExcerpt(article, 'owner-s', 'excerpt');
  assert.equal(asked[1]?.instructions, EXCERPT_INSTRUCTIONS, 'an excerpt is still asked as one');
  assert.ok(asked[1]?.options.every((option) => option === NONE || option.length <= PASSAGE_LENGTH.excerpt));
  assert.equal(excerpt, SENTENCES[1], 'the longest single sentence, since no two fit on a card');
});
