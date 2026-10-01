import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';

import { runWithEndpointContext } from '@better-auth/core/context';
import { makeSignature } from 'better-auth/crypto';

import type { EditorDocument } from '../../src/types/cms';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(
  process.env.DATABASE_URL,
  'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test',
  'use only the disposable Foundation database',
);
const { db, closeDatabase } = await import('../../src/server/db/client');
const { migrateToLatest } = await import('../../src/server/db/migrator');
const { writePluginSettings } = await import('../../src/server/plugins/store');
const { createPost, updatePost } = await import('../../src/server/content/posts');
const { createPage } = await import('../../src/server/content/pages');
const presence = await import('../../src/server/mcp/presence');
const snapshots = await import('../../src/server/mcp/snapshots');

const OWNER = 'owner-editing';
const OTHER = 'owner-editing-other';
const ORIGIN = 'http://localhost:4321';
// Loaded after the migration: the auth module checks its tables when it first loads.
let POST: typeof import('../../src/pages/api/admin/editing').POST;
let PUT_BACK: typeof import('../../src/pages/api/admin/ai-snapshots').POST;
let cookie: string;
let categoryId: string;

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function postInput(title: string, category: string) {
  return {
    excerpt: '', categoryIds: [category], coverMediaId: null, contentJson: { type: 'doc', content: [paragraph(title)] } as EditorDocument,
    metaDescription: null, metaTitle: null, slug: `post-${randomUUID()}`, status: 'draft' as const, title,
  };
}

async function editing(body: Record<string, unknown>, origin = ORIGIN) {
  const response = await POST({
    request: new Request(`${ORIGIN}/api/admin/editing`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, origin }, body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof POST>[0]);
  return { status: response.status, headers: response.headers, body: await response.json() as any };
}

async function putBack(body: Record<string, unknown>) {
  const response = await PUT_BACK({
    request: new Request(`${ORIGIN}/api/admin/ai-snapshots`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: ORIGIN }, body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof PUT_BACK>[0]);
  return response.status;
}

before(async () => {
  await migrateToLatest();
  for (const id of [OWNER, OTHER]) {
    await db.insertInto('user').values({ id, name: id, email: `${id}@example.invalid`, emailVerified: true, image: null, role: 'owner' }).execute();
  }
  await db.insertInto('site_settings').values({
    id: true, owner_id: OWNER, site_name: 'Editing', default_locale: 'en', timezone: 'UTC', admin_path: '/admin', author_avatar_media_id: null,
  }).execute();
  categoryId = (await db.insertInto('categories').values({ owner_id: OWNER, name: 'Uncategorized', is_default: true }).returning('id').executeTakeFirstOrThrow()).id;
  await writePluginSettings(OWNER, { enabled: true, id: 'mcp', values: {} });

  await db.insertInto('passkey').values({
    id: 'editing-passkey', name: 'MCP', publicKey: 'editing-key', userId: OWNER, credentialID: 'editing-credential', counter: 0,
    deviceType: 'singleDevice', backedUp: false, transports: '', aaguid: null,
  }).execute();
  ({ POST } = await import('../../src/pages/api/admin/editing'));
  ({ POST: PUT_BACK } = await import('../../src/pages/api/admin/ai-snapshots'));
  const { auth } = await import('../../src/server/auth/config');
  const authContext = await auth.$context;
  const session = await runWithEndpointContext({
    context: authContext as unknown as Parameters<typeof runWithEndpointContext>[0]['context'],
    path: '/passkey/verify-authentication',
    body: { response: { id: 'editing-credential' } },
  }, () => authContext.internalAdapter.createSession(OWNER));
  cookie = `${authContext.authCookies.sessionToken.name}=${session.token}.${await makeSignature(session.token, authContext.secret)}`;
});
beforeEach(() => presence.resetPresenceForTest());
after(closeDatabase);

test('a check-in holds the draft for the owner and says which AI touched it, without its connection', async () => {
  const post = await createPost(OWNER, postInput('Held', categoryId));
  const key = presence.itemKey('post', post.id);
  assert.equal(presence.ownerIsEditing(key), false);

  const quiet = await editing({ kind: 'post', id: post.id, updatedAt: post.updated_at });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.headers.get('cache-control'), 'no-store');
  assert.deepEqual(quiet.body, { ai: null, newer: false });
  assert.equal(presence.ownerIsEditing(key), true);

  const at = Date.now() - 30_000;
  presence.recordTouch(key, { connectionId: 'connection-secret', clientName: 'Claude', brand: 'claude', action: 'read' }, at);
  const touched = await editing({ kind: 'post', id: post.id.toUpperCase(), updatedAt: post.updated_at });
  assert.equal(touched.status, 200);
  assert.deepEqual(touched.body, { ai: { clientName: 'Claude', brand: 'claude', action: 'read', at: new Date(at).toISOString() }, newer: false });

  const page = await createPage(OWNER, {
    title: 'A page', slug: '', contentJson: { type: 'doc', content: [paragraph('Page')] }, metaTitle: null, metaDescription: null, status: 'draft', excerpt: '',
  });
  assert.equal((await editing({ kind: 'page', id: page.id, updatedAt: page.updated_at })).status, 200);
  assert.equal(presence.ownerIsEditing(presence.itemKey('page', page.id)), true);
  assert.equal(presence.ownerIsEditing(presence.itemKey('post', page.id)), false, 'a page beat holds the page only');
});

test('another owner\'s draft, or none at all, is a 404 and holds nothing', async () => {
  // Written directly: the site's settings are this owner's, so the service would not make it.
  const theirs = await db.transaction().execute(async (trx) => {
    const group = randomUUID();
    const category = await trx.insertInto('categories').values({ owner_id: OTHER, name: 'Uncategorized', is_default: true }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('post_translation_groups').values({ id: group, owner_id: OTHER }).execute();
    const post = await trx.insertInto('posts').values({
      translation_group_id: group, locale: 'en', title: 'Theirs', slug: `theirs-${randomUUID()}`, content_json: { type: 'doc', content: [paragraph('x')] },
      content_html: '<p>x</p>', meta_title: null, meta_description: null, status: 'draft', published_at: null, planned_at: null, owner_id: OTHER,
    }).returning(['id', 'updated_at']).executeTakeFirstOrThrow();
    await trx.insertInto('post_category_assignments').values({ translation_group_id: group, category_id: category.id, owner_id: OTHER }).execute();
    return post;
  });
  const answer = await editing({ kind: 'post', id: theirs.id, updatedAt: theirs.updated_at.toISOString() });
  assert.equal(answer.status, 404);
  assert.equal(presence.ownerIsEditing(presence.itemKey('post', theirs.id)), false);
  assert.equal((await editing({ kind: 'page', id: randomUUID(), updatedAt: theirs.updated_at.toISOString() })).status, 404);
});

test('a check-in from another origin is refused, and a malformed one is rejected', async () => {
  const post = await createPost(OWNER, postInput('Origin', categoryId));
  assert.equal((await editing({ kind: 'post', id: post.id, updatedAt: post.updated_at }, 'https://evil.example')).status, 403);
  assert.equal(presence.ownerIsEditing(presence.itemKey('post', post.id)), false);
  assert.equal((await editing({ kind: 'post', id: 'not-a-uuid', updatedAt: post.updated_at })).status, 400);
  assert.equal((await editing({ kind: 'post', id: post.id, updatedAt: post.updated_at, extra: 1 })).status, 400);
});

test('with MCP off it still holds the draft and answers, with no AI', async () => {
  const post = await createPost(OWNER, postInput('Off', categoryId));
  presence.recordTouch(presence.itemKey('post', post.id), { connectionId: 'c', clientName: 'Claude', brand: 'claude', action: 'write' });
  await writePluginSettings(OWNER, { enabled: false, id: 'mcp', values: {} });
  try {
    const answer = await editing({ kind: 'post', id: post.id, updatedAt: post.updated_at });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { ai: null, newer: false });
    assert.equal(presence.ownerIsEditing(presence.itemKey('post', post.id)), true);
  } finally {
    await writePluginSettings(OWNER, { enabled: true, id: 'mcp', values: {} });
  }
});

test('newer is true once the stored draft is later than the editor\'s', async () => {
  const post = await createPost(OWNER, postInput('Before', categoryId));
  const changed = await updatePost(OWNER, {
    id: post.id, updatedAt: post.updated_at, title: 'Changed elsewhere', slug: post.slug, contentJson: post.content_json,
    metaTitle: null, metaDescription: null, status: 'draft', excerpt: '', categoryIds: [categoryId], coverMediaId: null,
  });
  assert.ok(Date.parse(changed.updated_at) > Date.parse(post.updated_at));
  assert.equal((await editing({ kind: 'post', id: post.id, updatedAt: post.updated_at })).body.newer, true);
  assert.equal((await editing({ kind: 'post', id: post.id, updatedAt: changed.updated_at })).body.newer, false);
});

test('putting a draft back forgets the AI\'s touch, so the bar no longer says it changed the draft', async () => {
  const post = await createPost(OWNER, postInput('Before the AI', categoryId));
  const key = presence.itemKey('post', post.id);
  // No connection row is needed for the copy; the column is let go when a connection goes.
  await snapshots.snapshotBeforeAiWrite(db, OWNER, 'post', post, { id: null as unknown as string, clientName: 'Claude' });
  const changed = await updatePost(OWNER, {
    id: post.id, updatedAt: post.updated_at, title: 'By the AI', slug: post.slug, contentJson: post.content_json,
    metaTitle: null, metaDescription: null, status: 'draft', excerpt: '', categoryIds: [categoryId], coverMediaId: null,
  });
  await snapshots.markAiWritten(OWNER, 'post', post.id, changed.updated_at);
  presence.recordTouch(key, { connectionId: 'c', clientName: 'Claude', brand: 'claude', action: 'write' });

  // A put back that does not happen leaves the touch as it was.
  assert.equal(await putBack({ kind: 'post', id: post.id, updatedAt: post.updated_at }), 409);
  assert.equal(presence.lastTouch(key)?.action, 'write');

  assert.equal(await putBack({ kind: 'post', id: post.id.toUpperCase(), updatedAt: changed.updated_at }), 200);
  assert.equal(presence.lastTouch(key), null);
  assert.equal((await editing({ kind: 'post', id: post.id, updatedAt: changed.updated_at })).body.ai, null);
});
