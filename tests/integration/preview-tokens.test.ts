import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import type { EditorDocument } from '../../src/types/cms';

test('preview tokens are short-lived, scoped, rotated, and private', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
    'use only the disposable Foundation database',
  );
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { createPreviewToken, getPreviewContent, PREVIEW_TOKEN_TTL_MS } = await import('../../src/server/content/previews');
  const { HttpError } = await import('../../src/server/http/errors');
  const { GET } = await import('../../src/pages/api/v1/content/preview/[token]');
  context.after(closeDatabase);

  await migrateToLatest();
  await db.deleteFrom('site_settings').execute();
  await db.deleteFrom('user').execute();
  await db.insertInto('user').values([
    { id: 'owner-a', name: 'Owner A', email: 'a@example.invalid', emailVerified: true, image: null, role: 'owner' },
    { id: 'owner-b', name: 'Owner B', email: 'b@example.invalid', emailVerified: true, image: null, role: 'owner' },
  ]).execute();
  await db.insertInto('site_settings').values({
    id: true, owner_id: 'owner-a', site_name: 'Preview Test', default_locale: 'th', timezone: 'UTC',
    admin_path: '/studio', author_avatar_media_id: null,
  }).execute();
  const [categoryA, categoryB] = await db.insertInto('categories').values([
    { owner_id: 'owner-a', name: 'Uncategorized', is_default: true },
    { owner_id: 'owner-b', name: 'Uncategorized', is_default: true },
  ]).returningAll().execute();

  const postId = randomUUID();
  const siblingId = randomUUID();
  const foreignPostId = randomUUID();
  const pageId = randomUUID();
  const postGroup = randomUUID();
  const foreignPostGroup = randomUUID();
  const pageGroup = randomUUID();
  const content: EditorDocument = {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private draft body' }] }],
  };
  const common = {
    content_json: content,
    content_html: '<p>Private draft body</p>',
    meta_title: null,
    meta_description: null,
    published_at: null,
    status: 'draft' as const,
  };
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('post_translation_groups').values([
      { id: postGroup, owner_id: 'owner-a' },
      { id: foreignPostGroup, owner_id: 'owner-b' },
    ]).execute();
    await trx.insertInto('page_translation_groups').values({ id: pageGroup, owner_id: 'owner-a' }).execute();
    await trx.insertInto('posts').values([
      { ...common, id: postId, translation_group_id: postGroup, locale: 'th', title: 'Scoped draft', slug: 'scoped-draft', cover_media_id: null, owner_id: 'owner-a' },
      { ...common, id: siblingId, translation_group_id: postGroup, locale: 'en', title: 'Sibling draft must stay private', slug: 'sibling-draft', cover_media_id: null, owner_id: 'owner-a' },
      { ...common, id: foreignPostId, translation_group_id: foreignPostGroup, locale: 'th', title: 'Foreign draft', slug: 'foreign-draft', cover_media_id: null, owner_id: 'owner-b' },
    ]).execute();
    await trx.insertInto('post_category_assignments').values([
      { translation_group_id: postGroup, category_id: categoryA.id, owner_id: 'owner-a' },
      { translation_group_id: foreignPostGroup, category_id: categoryB.id, owner_id: 'owner-b' },
    ]).execute();
    await trx.insertInto('pages').values({
      ...common, id: pageId, translation_group_id: pageGroup, locale: 'th', title: 'Scoped page',
      slug: 'scoped-page', owner_id: 'owner-a',
    }).execute();
  });

  const startedAt = Date.now();
  const first = await createPreviewToken('owner-a', { contentId: postId, contentType: 'post' });
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(first.expiresAt.getTime() >= startedAt + PREVIEW_TOKEN_TTL_MS - 1_000);
  assert.ok(first.expiresAt.getTime() <= Date.now() + PREVIEW_TOKEN_TTL_MS + 1_000);
  const stored = await db.selectFrom('preview_tokens').selectAll().where('content_id', '=', postId).executeTakeFirstOrThrow();
  assert.equal(stored.token_hash, createHash('sha256').update(first.token).digest('hex'));
  assert.equal(JSON.stringify(stored).includes(first.token), false);

  const scoped = await getPreviewContent(first.token);
  assert.equal(scoped?.contentType, 'post');
  if (!scoped || scoped.contentType !== 'post') assert.fail('Post preview was not returned.');
  assert.equal(scoped.content.id, postId);
  assert.equal(scoped.content.status, 'draft');
  assert.deepEqual(scoped.content.translations, []);

  await assert.rejects(
    createPreviewToken('owner-a', { contentId: foreignPostId, contentType: 'post' }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  await assert.rejects(
    createPreviewToken('owner-a', { contentId: postId, contentType: 'page' }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );

  const rotated = await createPreviewToken('owner-a', { contentId: postId, contentType: 'post' });
  assert.notEqual(rotated.token, first.token);
  assert.equal(await getPreviewContent(first.token), null);
  assert.equal((await db.selectFrom('preview_tokens').select('revoked_at').where('token_hash', '=', stored.token_hash).executeTakeFirst())?.revoked_at instanceof Date, true);

  await db.updateTable('preview_tokens').set({
    created_at: new Date(Date.now() - 2 * PREVIEW_TOKEN_TTL_MS),
    expires_at: new Date(Date.now() - PREVIEW_TOKEN_TTL_MS),
  }).where('token_hash', '=', createHash('sha256').update(rotated.token).digest('hex')).execute();
  assert.equal(await getPreviewContent(rotated.token), null);

  const active = await createPreviewToken('owner-a', { contentId: postId, contentType: 'post' });
  assert.equal(await db.selectFrom('preview_tokens').select('id').where('owner_id', '=', 'owner-a').where('content_id', '=', postId).execute().then((rows) => rows.length), 1);
  const pageToken = await createPreviewToken('owner-a', { contentId: pageId, contentType: 'page' });
  assert.equal((await getPreviewContent(pageToken.token))?.contentType, 'page');
  assert.equal(await getPreviewContent('A'.repeat(43)), null);

  type PreviewHandler = (context: { params: Record<string, string | undefined>; request: Request }) => Promise<Response> | Response;
  const previewGet = GET as unknown as PreviewHandler;
  const response = await previewGet({
    params: { token: active.token },
    request: new Request(`http://127.0.0.1:4321/api/v1/content/preview/${active.token}`, {
      headers: { Cookie: 'session=must-not-authorize-preview' },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.has('access-control-allow-origin'), false);
  assert.equal(response.headers.has('set-cookie'), false);
  const responseText = await response.text();
  assert.equal(responseText.includes(active.token), false);
  assert.equal(responseText.includes('Sibling draft must stay private'), false);
  const payload = JSON.parse(responseText) as { data: { content: { id: string }; contentType: string } };
  assert.equal(payload.data.contentType, 'post');
  assert.equal(payload.data.content.id, postId);

  const invalid = await previewGet({
    params: { token: 'A'.repeat(43) },
    request: new Request(`http://127.0.0.1:4321/api/v1/content/preview/${'A'.repeat(43)}`, {
      headers: { Cookie: 'session=must-not-authorize-preview' },
    }),
  });
  assert.equal(invalid.status, 404);
  assert.equal(invalid.headers.has('access-control-allow-origin'), false);
  assert.equal((await invalid.text()).includes('A'.repeat(43)), false);
});
