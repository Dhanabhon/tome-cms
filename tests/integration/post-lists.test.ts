import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostListAttrs } from '../../src/lib/editor-post-list';
import type { EditorDocument } from '../../src/types/cms';

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const group = (n: number) => id('a', n);

test('a page\'s post lists resolve to the posts a reader may see', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { pagePostListProps, resolvePostLists } = await import('../../src/server/content/post-lists');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.insertInto('user').values({ id: 'owner', name: 'Owner', email: 'o@example.invalid', emailVerified: true, image: null, role: 'owner' }).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner', site_name: 'Lists Test', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [fixed, grown, crowded, doomed, general, misc] = await db.insertInto('categories').values([
    { owner_id: 'owner', name: 'Fixed', is_default: false },
    { owner_id: 'owner', name: 'Grown', is_default: false },
    { owner_id: 'owner', name: 'Crowded', is_default: false },
    { owner_id: 'owner', name: 'Doomed', is_default: false },
    { owner_id: 'owner', name: 'General', is_default: true },
    { owner_id: 'owner', name: 'Misc', is_default: false },
  ]).returningAll().execute();

  const empty: EditorDocument = { type: 'doc', content: [] };
  const day = (offset: number) => new Date(Date.UTC(2026, 8, 20 - offset));
  // One post group per call; an edition per entry in `editions`.
  const seed = async (
    n: number,
    editions: Array<'en' | 'th'>,
    options: { at?: Date; categoryId?: string; status?: 'draft' | 'published' } = {},
  ) => {
    // A group needs a category by the time it is committed.
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('post_translation_groups').values({ id: group(n), owner_id: 'owner' }).execute();
      for (const locale of editions) {
        await trx.insertInto('posts').values({
          id: id('1', n * 10 + (locale === 'en' ? 1 : 2)),
          owner_id: 'owner',
          translation_group_id: group(n),
          locale,
          title: `${locale} ${n}`,
          slug: `${locale}-${n}`,
          excerpt: '',
          content_html: '<p>x</p>',
          content_json: empty,
          cover_media_id: null,
          meta_title: null,
          meta_description: null,
          status: options.status ?? 'published',
          published_at: options.at ?? day(n),
        }).execute();
      }
      await trx.insertInto('post_category_assignments').values({ translation_group_id: group(n), category_id: options.categoryId ?? misc.id, owner_id: 'owner' }).execute();
    });
  };
  const handPicked = (...postGroupIds: string[]): PostListAttrs => (
    { source: 'posts', postGroupIds, categoryId: null, limit: 6, layout: 'grid-3' }
  );
  const ofCategory = (categoryId: string, limit: number): PostListAttrs => (
    { source: 'category', postGroupIds: [], categoryId, limit, layout: 'list' }
  );
  const doc = (...blocks: PostListAttrs[]): EditorDocument => (
    { type: 'doc', content: blocks.map((attrs) => ({ type: 'postList', attrs: { ...attrs } })) }
  );
  const slugs = (list: { posts: Array<{ slug: string }> }) => list.posts.map(({ slug }) => slug);

  await seed(1, ['en', 'th']);
  await seed(2, ['en', 'th']);
  await seed(3, ['en', 'th']);
  await seed(4, ['th']);                                       // no English edition
  await seed(5, ['en'], { status: 'draft' });
  await seed(6, ['en'], { at: new Date(Date.now() + 86_400_000) });
  await seed(7, ['en']);                                       // its group stays; the post is then deleted
  await db.deleteFrom('posts').where('id', '=', id('1', 71)).execute();

  assert.deepEqual(
    (await resolvePostLists(doc(handPicked(group(3), group(1), group(2))), 'en')).map(slugs),
    [['en-3', 'en-1', 'en-2']],
    'the block\'s order, not the date\'s',
  );
  assert.deepEqual(
    (await resolvePostLists(doc(handPicked(group(3), group(1))), 'th')).map(slugs),
    [['th-3', 'th-1']],
    'the page\'s language',
  );
  assert.deepEqual(
    (await resolvePostLists(doc(handPicked(group(1), group(4), group(2))), 'en')).map(slugs),
    [['en-1', 'en-2']],
    'a post without that language\'s edition is skipped',
  );
  assert.deepEqual(
    (await resolvePostLists(doc(handPicked(group(5), group(6), group(7), group(1))), 'en')).map(slugs),
    [['en-1']],
    'a draft, a future-dated and a deleted post do not show',
  );
  const [picked] = await resolvePostLists(doc(handPicked(group(1))), 'en');
  assert.deepEqual([picked?.layout, picked?.moreHref], ['grid-3', null], 'a hand-picked block carries its layout and no link');
  assert.deepEqual(await resolvePostLists(doc(handPicked()), 'en'), [{ layout: 'grid-3', posts: [], moreHref: null }], 'no groups, no query, no posts');

  // Hand-picked: 24 groups, 24 posts.
  const many = Array.from({ length: 24 }, (_, index) => group(100 + index));
  for (const index of many.keys()) await seed(100 + index, ['en'], { at: day(30 + index) });
  const [all] = await resolvePostLists(doc(handPicked(...many)), 'en');
  assert.equal(all?.posts.length, 24, '24 hand-picked posts all resolve');

  // Categories.
  for (let n = 0; n < 5; n += 1) await seed(200 + n, ['en'], { at: day(n), categoryId: grown.id });
  await seed(210, ['en'], { at: day(0), categoryId: fixed.id });
  await seed(211, ['en'], { at: day(1), categoryId: fixed.id });
  assert.deepEqual(
    (await resolvePostLists(doc(ofCategory(grown.id, 3)), 'en')).map(slugs),
    [['en-200', 'en-201', 'en-202']],
    'a category shows newest first, up to its limit',
  );
  const [exactly] = await resolvePostLists(doc(ofCategory(fixed.id, 2)), 'en');
  assert.equal(exactly?.posts.length, 2);
  assert.equal(exactly?.moreHref, null, 'a category that holds exactly the limit has no more');
  await seed(212, ['en'], { at: day(2), categoryId: fixed.id });
  const [over] = await resolvePostLists(doc(ofCategory(fixed.id, 2)), 'en');
  assert.equal(over?.moreHref, `/en/category/${fixed.slug}`, 'one over, and the link is the category\'s page');
  const [thai] = await resolvePostLists(doc(ofCategory(grown.id, 3)), 'th');
  assert.deepEqual(thai?.posts, [], 'a category in a language none of its posts are written in');

  for (let n = 0; n < 4; n += 1) await seed(220 + n, ['en'], { at: day(n), categoryId: general.id });
  const [byDefault] = await resolvePostLists(doc(ofCategory(general.id, 2)), 'en');
  assert.equal(byDefault?.posts.length, 2);
  assert.equal(byDefault?.moreHref, null, 'the default category has no page to link to');

  await db.deleteFrom('categories').where('id', '=', doomed.id).execute();
  assert.deepEqual(
    await resolvePostLists(doc(ofCategory(doomed.id, 3)), 'en'),
    [{ layout: 'list', posts: [], moreHref: null }],
    'a deleted category gives an empty list and does not throw',
  );

  await seed(230, ['en'], { at: day(0), categoryId: crowded.id });
  await db.updateTable('categories').set({ name: 'Crowded, renamed' }).where('id', '=', crowded.id).execute();
  assert.deepEqual(
    (await resolvePostLists(doc(ofCategory(crowded.id, 3)), 'en')).map(slugs),
    [['en-230']],
    'a renamed category still resolves',
  );

  // The page's own props.
  const withBlock = { locale: 'en' as const, content_json: doc(handPicked(group(1))) };
  const props = await pagePostListProps(withBlock);
  assert.equal(props.postLists?.length, 1);
  assert.equal(props.profile, null, 'no author name is set');
  assert.deepEqual(props.settings, { site_name: 'Lists Test', timezone: 'UTC' });
  const bare = await pagePostListProps({ locale: 'en', content_json: { type: 'doc', content: [{ type: 'paragraph' }] } });
  assert.deepEqual(bare, {}, 'a page with no block gets nothing');
  assert.equal('profile' in bare, false);
});
