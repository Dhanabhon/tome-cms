import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('searching the published posts finds words in the title, excerpt and body, and nothing a reader cannot see', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { listPublishedPosts } = await import('../../src/server/content/published');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.insertInto('user').values({ id: 'owner', name: 'Owner', email: 'o@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner', site_name: 'Search Test', default_locale: 'th', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [news, notes] = await db.insertInto('categories').values([
    { owner_id: 'owner', name: 'News', is_default: false },
    { owner_id: 'owner', name: 'Notes', is_default: false },
  ]).returningAll().execute();

  const empty: EditorDocument = { type: 'doc', content: [] };
  const base = { cover_media_id: null, content_json: empty, meta_title: null, meta_description: null, owner_id: 'owner' };
  const day = (offset: number) => new Date(Date.UTC(2026, 8, 20 - offset));
  const seed = [
    // Title, excerpt and body each carry a different word, so each is shown to be searched.
    { key: 'title', locale: 'en' as const, title: 'Gardening in winter', excerpt: '', html: '<p>Nothing here.</p>', at: day(0), category: news.id },
    { key: 'excerpt', locale: 'en' as const, title: 'Second note', excerpt: 'How to prune roses', html: '<p>Nothing here.</p>', at: day(1), category: notes.id },
    { key: 'body', locale: 'en' as const, title: 'Third note', excerpt: '', html: '<p>The <strong>compost</strong> heap needs turning.</p>', at: day(2), category: news.id },
    // A class name and a URL sit in the markup, not in what a reader reads.
    { key: 'markup', locale: 'en' as const, title: 'Fourth note', excerpt: '', html: '<p class="tome-color-red"><a href="https://example.com/secret-path">link</a></p>', at: day(3), category: notes.id },
    // A reader sees Q&A; the stored text says &amp;.
    { key: 'entity', locale: 'en' as const, title: 'Fifth note', excerpt: '', html: '<p>Q&amp;A with the editor, and 100% sure_thing</p>', at: day(4), category: news.id },
    // Thai has no spaces between words: the search is a substring, and it reaches the body.
    { key: 'thai', locale: 'th' as const, title: 'สวนหลังบ้าน', excerpt: 'วิธีปลูกกุหลาบ', html: '<p>ปุ๋ยหมักต้องกลับกองทุกสัปดาห์</p>', at: day(5), category: news.id },
    { key: 'thai-two', locale: 'th' as const, title: 'บันทึกที่สอง', excerpt: '', html: '<p>กุหลาบสีแดง</p>', at: day(6), category: notes.id },
    // Emphasis inside a word is still the word, and a paragraph, a list item, a cell or a line break is a gap.
    { key: 'blocks', locale: 'en' as const, title: 'Blocks', excerpt: '', html: '<p>alpha</p><p>beta</p><ul><li>gamma</li><li>delta</li></ul><table><tbody><tr><td>epsilon</td><td>zeta</td></tr></tbody></table>', at: day(8), category: notes.id },
    { key: 'inline', locale: 'en' as const, title: 'Inline', excerpt: '', html: '<p>Big<em>Bang</em> theory<br>and a<u>b</u>c</p>', at: day(9), category: notes.id },
    // Stored as entities, read as characters. `&amp;lt;` is the four characters &lt; on the page.
    { key: 'entities', locale: 'en' as const, title: 'Markup words', excerpt: '', html: '<p>Use &lt;div&gt; for layout, type &amp;lt; to show it, say wow! or back\\slash.</p>', at: day(10), category: notes.id },
    // A Thai phrase does not stop at the bold word inside it.
    { key: 'thai-inline', locale: 'th' as const, title: 'กาแฟยามเช้า', excerpt: '', html: '<p>ผมชอบ<strong>กาแฟ</strong>ร้อนมาก</p><p>ต่อไปคือย่อหน้าใหม่</p>', at: day(11), category: news.id },
    // Not the public's: a draft, and a post whose day has not come.
    { key: 'draft', locale: 'en' as const, title: 'Draft about compost', excerpt: '', html: '<p>compost</p>', at: day(7), status: 'draft' as const, category: news.id },
    { key: 'scheduled', locale: 'en' as const, title: 'Scheduled compost', excerpt: '', html: '<p>compost</p>', at: new Date(Date.now() + 86_400_000), category: news.id },
  ];
  await db.transaction().execute(async (trx) => {
    for (const [index, item] of seed.entries()) {
      const group = `a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      await trx.insertInto('post_translation_groups').values({ id: group, owner_id: 'owner' }).execute();
      await trx.insertInto('posts').values({
        ...base,
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        translation_group_id: group,
        locale: item.locale,
        title: item.title,
        slug: item.key,
        excerpt: item.excerpt,
        content_html: item.html,
        status: item.status ?? 'published',
        published_at: item.at,
      }).execute();
      await trx.insertInto('post_category_assignments').values({ translation_group_id: group, category_id: item.category, owner_id: 'owner' }).execute();
    }
  });

  const found = async (q: string, extra: { category?: string; locale?: 'en' | 'th' } = {}) =>
    (await listPublishedPosts({ locale: 'en', q, ...extra })).items.map(({ slug }) => slug);

  assert.deepEqual(await found('gardening'), ['title'], 'the title, whatever the case');
  assert.deepEqual(await found('PRUNE'), ['excerpt'], 'the excerpt');
  assert.deepEqual(await found('compost'), ['body'], 'the body, through its markup; the draft and the scheduled post are not there');
  assert.deepEqual(await found('strong'), [], 'a tag name is not text');
  assert.deepEqual(await found('tome-color'), [], 'a class name is not text');
  assert.deepEqual(await found('secret-path'), [], 'nor is a URL in a link');
  assert.deepEqual(await found('link'), ['markup'], 'the words of a link are');
  assert.deepEqual(await found('Q&A'), ['entity'], 'a reader searches for what they read, not for the entity that stores it');
  assert.deepEqual(await found('100%'), ['entity'], '% is a percent sign here, not a wildcard');
  assert.deepEqual(await found('sure_thing'), ['entity']);
  assert.deepEqual(await found('sure_thin_'), [], '_ is an underscore here, not any letter');
  assert.deepEqual(await found('%'), ['entity'], 'a lone % finds the percent sign, not every post');

  // Emphasis does not cut a word; a block does. This is what makes a Thai phrase findable across a bold word.
  assert.deepEqual(await found('BigBang'), ['inline'], 'emphasis inside a word is still the word');
  assert.deepEqual(await found('abc'), ['inline']);
  assert.deepEqual(await found('theory and'), ['inline']);
  assert.deepEqual(await found('theoryand'), [], 'a line break is a gap');
  assert.deepEqual(await found('alpha beta'), ['blocks'], 'two words in two paragraphs');
  assert.deepEqual(await found('alphabeta'), [], 'two paragraphs are not one word');
  assert.deepEqual(await found('gammadelta'), [], 'nor two list items');
  assert.deepEqual(await found('epsilonzeta'), [], 'nor two cells');
  assert.deepEqual(await found('ชอบกาแฟร้อน', { locale: 'th' }), ['thai-inline'], 'a Thai phrase runs across the bold word in it');
  assert.deepEqual(await found('ร้อนมากต่อไป', { locale: 'th' }), [], 'but not across two paragraphs');

  // The characters an article shows, not the entities that store them, in the order that keeps `&amp;lt;` four characters.
  assert.deepEqual(await found('<div>'), ['entities'], '&lt;div&gt; is <div>');
  assert.deepEqual(await found('&lt;'), ['entities'], '&amp;lt; is the four characters &lt;');
  assert.deepEqual(await found('wow!'), ['entities'], 'an exclamation mark is only itself');
  assert.deepEqual(await found('back\\slash'), ['entities'], 'and so is a backslash');

  assert.deepEqual(await found('note editor'), ['entity'], 'every word must be found, wherever they sit');
  assert.deepEqual(await found('note   compost'), ['body'], 'spaces between words are only spaces');
  assert.deepEqual(await found('note zebra'), [], 'one word that is missing is enough');
  const everyEnglishPost = ['title', 'excerpt', 'body', 'markup', 'entity', 'blocks', 'inline', 'entities'];
  assert.deepEqual(await found(''), everyEnglishPost, 'an empty search is no search');
  assert.deepEqual(await found('   '), everyEnglishPost);
  assert.deepEqual(await found('\u0001'), everyEnglishPost, 'nor is a control character');

  assert.deepEqual(await found('note', { category: 'news' }), ['body', 'entity'], 'a category narrows the search, in any case');
  assert.deepEqual(await found('note', { category: 'Notes' }), ['excerpt', 'markup']);

  assert.deepEqual(await found('กุหลาบ', { locale: 'th' }), ['thai', 'thai-two'], 'Thai is found inside a word run, in the excerpt and the body');
  assert.deepEqual(await found('ปุ๋ยหมัก', { locale: 'th' }), ['thai']);
  assert.deepEqual(await found('กุหลาบ'), [], 'a Thai post is not an English result');
  assert.deepEqual(await found('gardening', { locale: 'th' }), [], 'nor an English post a Thai one');

  // Paging keeps the search: a cursor is tied to the words it came from.
  const first = await listPublishedPosts({ locale: 'en', q: 'note', limit: 2 });
  assert.deepEqual(first.items.map(({ slug }) => slug), ['excerpt', 'body']);
  assert.ok(first.hasMore && first.nextCursor);
  const second = await listPublishedPosts({ locale: 'en', q: 'note', limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(({ slug }) => slug), ['markup', 'entity']);
  const sameWords = await listPublishedPosts({ locale: 'en', q: '  note  ', limit: 2, cursor: first.nextCursor });
  assert.deepEqual(sameWords.items.map(({ slug }) => slug), ['markup', 'entity'], 'the same words with other spaces are the same search');
  await assert.rejects(
    listPublishedPosts({ locale: 'en', q: 'compost', limit: 2, cursor: first.nextCursor }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
    'a cursor from one search does not open another',
  );
  await assert.rejects(
    listPublishedPosts({ locale: 'en', limit: 2, cursor: first.nextCursor }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
    'nor the list with no search',
  );
  // The same search over HTTP: the public API takes `q`, keeps it in `links.next`, and refuses nonsense.
  const { GET } = await import('../../src/pages/api/v1/content/posts/index');
  const ask = (query: string, clientAddress = '203.0.113.10') => GET({
    clientAddress, request: new Request(`http://localhost:4321/api/v1/content/posts?${query}`),
  } as Parameters<typeof GET>[0]);
  const api = await ask('locale=en&q=note&limit=2');
  assert.equal(api.status, 200);
  const body = await api.json() as { data: Array<{ slug: string }>; links: { next: string | null }; meta: { hasMore: boolean } };
  assert.deepEqual(body.data.map(({ slug }) => slug), ['excerpt', 'body']);
  assert.ok(body.meta.hasMore && body.links.next?.includes('q=note'), 'the next page keeps the search');
  const next = await ask(new URL(body.links.next!).searchParams.toString());
  assert.deepEqual((await next.json() as typeof body).data.map(({ slug }) => slug), ['markup', 'entity']);
  for (const bad of ['locale=en&q=', `locale=en&q=${'x'.repeat(101)}`, 'locale=en&q=a&q=b']) {
    assert.equal((await ask(bad)).status, 400, bad);
  }

  // A search reads every published post, so one sender may ask only so often.
  const greedy = '203.0.113.99';
  let refused = 0;
  for (let count = 1; count <= 70; count += 1) {
    const answer = await ask('locale=en&q=note&limit=1', greedy);
    if (answer.status === 429) refused += 1;
    else assert.equal(answer.status, 200, `search ${count}`);
  }
  assert.equal(refused, 10, 'sixty a minute, then 429');
  const held = await ask('locale=en&q=note&limit=1', greedy);
  assert.equal(held.status, 429);
  assert.match(held.headers.get('content-type') ?? '', /^application\/problem\+json/, 'the answer is a problem, like the others');
  assert.equal(held.headers.get('retry-after'), '60', 'and says when to come back');
  assert.equal(((await held.json()) as { status: number }).status, 429);

  // A query the API refuses is not a search, and does not spend the sender's minute.
  const careful = '203.0.113.77';
  for (let count = 1; count <= 65; count += 1) assert.equal((await ask('locale=en&q=%00', careful)).status, 400);
  assert.equal((await ask('locale=en&q=note&limit=1', careful)).status, 200, 'sixty-five refusals later it may still search');
  assert.equal((await ask('locale=en&limit=1', greedy)).status, 200, 'a list with no search is never held back');
  assert.equal((await ask('locale=en&q=note&limit=1')).status, 200, 'and another sender is unaffected');

  const plain = await listPublishedPosts({ locale: 'en', limit: 2 });
  const older = await listPublishedPosts({ locale: 'en', limit: 2, cursor: plain.nextCursor! });
  assert.deepEqual(older.items.map(({ slug }) => slug), ['body', 'markup'], 'paging with no search is as it was');
});
