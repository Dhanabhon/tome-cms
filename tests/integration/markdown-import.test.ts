import assert from 'node:assert/strict';
import test from 'node:test';

import { runWithEndpointContext } from '@better-auth/core/context';
import { makeSignature } from 'better-auth/crypto';

test('a Markdown file becomes a draft in its own language, with its pictures, categories and date', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { importMarkdownPost, previewMarkdownImport } = await import('../../src/server/content/markdown-import-post');
  const { createPost } = await import('../../src/server/content/posts');
  const { HttpError } = await import('../../src/server/http/errors');
  context.after(closeDatabase);

  await migrateToLatest();
  for (const id of ['owner-a', 'owner-b']) {
    await db.insertInto('user').values({ id, name: id, email: `${id}@example.invalid`, emailVerified: true, image: null, role: 'owner' }).execute();
  }
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'Import', default_locale: 'th', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  const [fallback, notes] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
    { owner_id: 'owner-a', name: 'Notes', is_default: false },
  ]).returningAll().execute();

  const mine = '11111111-1111-4111-8111-111111111111';
  const theirs = '22222222-2222-4222-8222-222222222222';
  const guide = '33333333-3333-4333-8333-333333333333';
  const stored = { folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: null, state: 'ready' as const, delete_error_code: null, size_bytes: 1_024 };
  await db.insertInto('media_items').values([
    { ...stored, id: mine, owner_id: 'owner-a', object_key: 'owners/a/2026/09/a.webp', original_name: 'a.webp', mime_type: 'image/webp', width: 1600, height: 900 },
    { ...stored, id: theirs, owner_id: 'owner-b', object_key: 'owners/b/2026/09/b.webp', original_name: 'b.webp', mime_type: 'image/webp', width: 1600, height: 900 },
    { ...stored, id: guide, owner_id: 'owner-a', object_key: 'owners/a/2026/09/g.pdf', original_name: 'g.pdf', mime_type: 'application/pdf' as 'image/webp', width: null, height: null },
  ]).execute();

  const file = [
    '---', 'title: An English post', 'locale: en', 'date: 2021-03-04T05:06:07Z', 'categories: [notes, Missing one]',
    'cover: ./cover.webp', 'status: published', '---', '',
    '![one](./one.webp)', '', '![site](https://x.com/s.jpg)', '', '![two](./two.webp)', '',
  ].join('\n');

  const preview = await previewMarkdownImport('owner-a', { fileName: 'a.md', text: file });
  assert.equal(preview.locale, 'en');
  assert.equal(preview.slug, 'an-english-post');
  assert.deepEqual(preview.categories, ['Notes']);
  assert.deepEqual(preview.pictures.map((picture) => picture.src), ['./cover.webp', './one.webp', 'https://x.com/s.jpg', './two.webp']);
  assert.deepEqual(preview.warnings, [{ code: 'status-ignored' }, { code: 'category-missing', names: ['Missing one'] }]);
  assert.equal(await db.selectFrom('posts').select('id').executeTakeFirst(), undefined, 'a preview saves nothing');

  const { post, warnings } = await importMarkdownPost('owner-a', {
    fileName: 'a.md', text: file, pictures: { './cover.webp': mine, './one.webp': mine },
  });
  assert.equal(post.locale, 'en', 'the file\'s language, not the site default');
  assert.equal(post.status, 'draft', 'always a draft');
  assert.equal(post.show_cover, true, 'the cover is shown, as for any new post');
  assert.equal(post.cover_media_id, mine);
  assert.equal(post.planned_at, '2021-03-04T05:06:07.000Z');
  assert.equal(post.published_at, null, 'the date plans a draft; it does not publish it');
  assert.match(post.content_html, new RegExp(`/media/${mine}`));
  assert.match(post.content_html, /https:\/\/x\.com\/s\.jpg/);
  assert.match(post.content_html, /\[Missing image: two\.webp\]/);
  assert.deepEqual(warnings, preview.warnings);
  const assigned = await db.selectFrom('post_category_assignments').select('category_id')
    .where('translation_group_id', '=', post.translation_group_id).execute();
  assert.deepEqual(assigned.map(({ category_id }) => category_id), [notes!.id]);
  const row = await db.selectFrom('posts').select('show_cover').where('id', '=', post.id).executeTakeFirstOrThrow();
  assert.equal(row.show_cover, true, 'stored as true, not null and not the column\'s absence');

  // The same slug again, in the same language: a changed slug and a warning, not a 409.
  const again = await previewMarkdownImport('owner-a', { fileName: 'a.md', text: file });
  const second = await importMarkdownPost('owner-a', { fileName: 'a.md', text: file });
  assert.match(second.post.slug, /^an-english-post-[0-9a-f]{8}$/);
  assert.deepEqual(second.warnings.at(-1), { code: 'slug-changed', slug: second.post.slug });
  assert.equal(again.slug, second.post.slug, 'the preview shows the address the import makes');
  // Imported a third time, that address is taken too: one of its own, not a 409.
  const third = await importMarkdownPost('owner-a', { fileName: 'a.md', text: file });
  assert.match(third.post.slug, /^an-english-post-[0-9a-f]{8}$/);
  assert.notEqual(third.post.slug, second.post.slug);
  // With no matching category the post gets the default one.
  const plain = await importMarkdownPost('owner-a', { fileName: 'หมายเหตุ.md', text: 'ข้อความ' });
  assert.equal(plain.post.locale, 'th');
  assert.equal(plain.post.title, 'หมายเหตุ');
  const plainCategories = await db.selectFrom('post_category_assignments').select('category_id')
    .where('translation_group_id', '=', plain.post.translation_group_id).execute();
  assert.deepEqual(plainCategories.map(({ category_id }) => category_id), [fallback!.id]);

  // Another owner's picture, or a document, is refused by the media check createPost already runs, as body or cover.
  const counts = async () => Promise.all(['posts', 'post_translation_groups', 'post_category_assignments'].map(async (table) =>
    (await db.selectFrom(table as 'posts').select('created_at' as never).execute()).length));
  const rowsBefore = await counts();
  const refused = (error: unknown) => error instanceof HttpError && error.status === 400;
  for (const id of [theirs, guide, '44444444-4444-4444-8444-444444444444']) {
    await assert.rejects(importMarkdownPost('owner-a', { fileName: 'b.md', text: '![x](./x.webp)', pictures: { './x.webp': id } }), refused);
    await assert.rejects(importMarkdownPost('owner-a', { fileName: 'b.md', text: '---\ncover: ./x.webp\n---\nhi', pictures: { './x.webp': id } }), refused);
  }
  assert.deepEqual(await counts(), rowsBefore, 'a refused import leaves no group, post or assignment behind');
  // A file over the limit is refused before it is parsed.
  await assert.rejects(
    previewMarkdownImport('owner-a', { fileName: 'big.md', text: 'ก'.repeat(300_001) }),
    (error) => error instanceof HttpError && error.status === 413,
  );
  // A file too complex for the parser is a refusal the sheet can show, with the warning's shape; any other parser failure is a 400.
  const complex = await previewMarkdownImport('owner-a', { fileName: 'c.md', text: 'x\n\n'.repeat(4_001) }).catch((error: unknown) => error);
  assert.ok(complex instanceof HttpError && complex.status === 413);
  assert.deepEqual(complex.details, { warning: { code: 'too-complex', limit: 'blocks' } });

  // The editor's own "New post" still gets the site default language, with its cover shown.
  const ordinary = await createPost('owner-a', {
    title: 'Ordinary', slug: '', contentJson: { type: 'doc', content: [] }, metaTitle: null, metaDescription: null,
    status: 'draft', categoryIds: [], coverMediaId: null, excerpt: '',
  });
  assert.equal(ordinary.locale, 'th');
  assert.equal(ordinary.show_cover, true);

  // The routes: a signed-in owner, as a browser would be.
  await db.insertInto('passkey').values({
    id: 'import-passkey', name: 'Import', publicKey: 'import-key', userId: 'owner-a', credentialID: 'import-credential', counter: 0,
    deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null,
  }).execute();
  const { auth } = await import('../../src/server/auth/config');
  const authContext = await auth.$context;
  const session = await runWithEndpointContext({
    context: authContext as unknown as Parameters<typeof runWithEndpointContext>[0]['context'],
    path: '/passkey/verify-authentication',
    body: { response: { id: 'import-credential' } },
  }, () => authContext.internalAdapter.createSession('owner-a'));
  const cookie = `${authContext.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, authContext.secret)}`;
  const { POST: previewRoute } = await import('../../src/pages/api/admin/posts/import/preview');
  const { POST: importRoute } = await import('../../src/pages/api/admin/posts/import/index');
  const call = (route: typeof previewRoute, body: unknown, headers: Record<string, string> = {}) => route({
    request: new Request('http://localhost:4321/api/admin/posts/import', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:4321', ...headers },
    }),
  } as unknown as Parameters<typeof previewRoute>[0]);
  const source = { fileName: 'route.md', text: '# Through the route\n\nhello' };
  const postsBefore = (await db.selectFrom('posts').select('id').execute()).length;

  for (const route of [previewRoute, importRoute]) {
    const anonymous = await route({
      request: new Request('http://localhost:4321/x', { method: 'POST', body: JSON.stringify(source), headers: { 'Content-Type': 'application/json' } }),
    } as unknown as Parameters<typeof route>[0]);
    assert.equal(anonymous.status, 401);
    const foreign = await call(route, source, { Origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal((await call(route, source, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await call(route, { ...source, extra: 1 })).status, 400);
    assert.equal((await call(route, { ...source, pictures: { './x.webp': 'not-an-id' } })).status, 400);
    // Too complex: a 413 the sheet can show, carrying the warning; never a 500 or a raw message.
    const tooComplex = await call(route, { fileName: 'c.md', text: 'x\n\n'.repeat(4_001) });
    assert.equal(tooComplex.status, 413);
    const body = await tooComplex.json() as { error: string; warning: unknown };
    assert.deepEqual(body.warning, { code: 'too-complex', limit: 'blocks' });
    assert.equal(tooComplex.headers.get('cache-control'), 'no-store');
    // A file the parser accepts whose post would be too big to store is refused at the preview, and
    // at the import, not by the database after the pictures are uploaded: 3,500 paragraphs, 794 KB.
    const tooBig = await call(route, { fileName: 'big.md', text: Array.from({ length: 3_500 }, (_, i) => `${i} ${'x'.repeat(220)}`).join('\n\n') });
    assert.equal(tooBig.status, 413);
    assert.deepEqual(((await tooBig.json()) as { warning: unknown }).warning, { code: 'too-complex', limit: 'size' });
    // A body over the JSON cap (quotes double in it) is the body's own 413, before anything is read.
    const overBody = await call(route, { fileName: 'quotes.md', text: '"\n'.repeat(450_000) });
    assert.equal(overBody.status, 413);
    assert.equal(((await overBody.json()) as { error: string }).error, 'The request body is too large.');
  }
  assert.equal((await db.selectFrom('posts').select('id').execute()).length, postsBefore, 'nothing was saved by any of those');

  const previewed = await call(previewRoute, source);
  assert.equal(previewed.status, 200);
  assert.equal(((await previewed.json()) as { preview: { title: string } }).preview.title, 'Through the route');
  assert.equal((await db.selectFrom('posts').select('id').execute()).length, postsBefore, 'a preview saves nothing');
  const imported = await call(importRoute, source);
  assert.equal(imported.status, 201);
  const made = await imported.json() as { post: { status: string; title: string }; warnings: unknown[] };
  assert.equal(made.post.status, 'draft');
  assert.equal(made.post.title, 'Through the route');
  assert.deepEqual(made.warnings, []);
  assert.equal((await db.selectFrom('posts').select('id').execute()).length, postsBefore + 1);

  // A post is measured as the database measures it: jsonb printed as text, a tenth larger than
  // JSON.stringify on a document of many small nodes.
  const { sql } = await import('kysely');
  const { jsonbTextLength, parseMarkdownPost } = await import('../../src/server/content/markdown-import');
  const measured = async (value: unknown) => (await sql<{ length: number }>`select octet_length(${JSON.stringify(value)}::jsonb::text) as length`
    .execute(db)).rows[0]!.length;
  const samples = [
    parseMarkdownPost(['# หัวข้อ *a* **b** `c` [d](https://x.io "t")', '', '| 1 | "2" |', '| - | - |', '| ก | \\ |', '',
      '```js\nconst a = "\t";\n```', '', '1. one', '2. two', '', '> quote', '', '---', '', '![p](./p.webp)'].join('\n'), 's.md').document,
    parseMarkdownPost(Array.from({ length: 50 }, () => '*ab* cd '.repeat(20)).join('\n\n'), 'i.md').document,
    { type: 'doc', numbers: [0, 7, -2, 1.5, 123456789], empty: {}, none: [], nothing: null, yes: true, text: 'tab\t \u0001 😀 " / \\ ไทย' },
  ];
  for (const sample of samples) assert.equal(jsonbTextLength(sample), await measured(sample));

  // A post just under the ceiling, as the database measures it, still imports.
  const nearCap = Array.from({ length: 3_000 }, (_, i) => `${i} ${'x'.repeat(228)}`).join('\n\n');
  const near = await importMarkdownPost('owner-a', { fileName: 'near.md', text: nearCap });
  const { length: nearLength } = await db.selectFrom('posts').select(sql<number>`octet_length(content_json::text)`.as('length'))
    .where('id', '=', near.post.id).executeTakeFirstOrThrow();
  assert.ok(nearLength > 890_000 && nearLength <= 900_000, `stored ${nearLength} bytes`);

  // Should the database refuse a post for its size all the same, the owner is told so as at the
  // preview, and nothing is saved; it is never a 500.
  const postsNow = (await db.selectFrom('posts').select('id').execute()).length;
  for (const [constraint, tight] of [
    ['posts_content_json_check', 'check (octet_length(content_json::text) <= 20)'],
    ['posts_content_html_check', 'check (octet_length(content_html) <= 20)'],
  ] as const) {
    const { definition } = (await sql<{ definition: string }>`select pg_get_constraintdef(oid) as definition from pg_constraint where conname = ${constraint}`
      .execute(db)).rows[0]!;
    const replace = (check: string) => sql`alter table posts drop constraint ${sql.id(constraint)}, add constraint ${sql.id(constraint)} ${sql.raw(check)} not valid`.execute(db);
    await replace(tight);
    const tooBig = await importMarkdownPost('owner-a', { fileName: 'tight.md', text: 'A paragraph that fits neither of the lowered checks.' })
      .catch((error: unknown) => error);
    await replace(definition);
    assert.ok(tooBig instanceof HttpError && tooBig.status === 413, `${constraint}: ${String(tooBig)}`);
    assert.deepEqual(tooBig.details, { warning: { code: 'too-complex', limit: 'size' } });
  }
  assert.equal((await db.selectFrom('posts').select('id').execute()).length, postsNow);
});
