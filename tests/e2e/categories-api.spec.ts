import { expect, test } from '@playwright/test';
import type { APIRoute } from 'astro';
import { createContext } from 'astro/middleware';

import type { Post, PostCategory } from '../../src/types/cms';
import { admin, createOwner, deleteOwner, signInAdmin, type TestOwner } from './support';

const postRow = (owner: TestOwner, locale = 'th', translationGroupId?: string) => ({
  author_id: owner.id,
  content_html: '<p>Category API contract.</p>',
  content_json: { type: 'doc' as const, content: [] },
  locale,
  slug: `category-api-${crypto.randomUUID()}`,
  title: 'Category API contract',
  ...(translationGroupId ? { translation_group_id: translationGroupId } : {}),
});

async function createPost(owner: TestOwner, locale = 'th', translationGroupId?: string) {
  const { data, error } = await owner.client.from('posts').insert(postRow(owner, locale, translationGroupId)).select().single();
  if (error || !data) throw error ?? new Error('Test Post was not created.');
  return data as Post;
}

async function categoryIds(owner: TestOwner, translationGroupId: string) {
  const { data, error } = await owner.client.from('post_category_assignments')
    .select('category_id').eq('translation_group_id', translationGroupId).order('category_id');
  if (error) throw error;
  return data.map(({ category_id }) => category_id);
}

async function cleanup(...owners: TestOwner[]) {
  for (const owner of owners) {
    await admin.from('post_category_assignments').delete().eq('owner_id', owner.id);
    await admin.from('posts').delete().eq('author_id', owner.id);
    await admin.from('categories').delete().eq('owner_id', owner.id).eq('is_default', false);
    await deleteOwner(owner);
  }
}

test('requires authentication and rejects malformed or server-owned payloads', async ({ page, request }) => {
  const id = crypto.randomUUID();
  for (const response of [
    await request.get('/api/categories'),
    await request.post('/api/categories', { data: { name: 'News' } }),
    await request.put('/api/categories', { data: { id, name: 'News' } }),
    await request.delete('/api/categories', { data: { id } }),
    await request.put('/api/posts/categories', { data: { postId: id, categoryIds: [] } }),
  ]) expect(response.status()).toBe(401);

  const owner = await createOwner('category-validation');
  try {
    await signInAdmin(page, owner);
    for (const path of ['/api/categories', '/api/posts/categories']) {
      const malformed = await page.request.fetch(path, {
        method: path === '/api/categories' ? 'POST' : 'PUT',
        data: Buffer.from('{'),
        headers: { 'content-type': 'application/json' },
      });
      expect(malformed.status(), path).toBe(400);
    }

    for (const field of ['owner_id', 'ownerId', 'translation_group_id', 'is_default']) {
      const response = await page.request.post('/api/categories', { data: { name: 'News', [field]: owner.id } });
      expect(response.status(), field).toBe(400);
    }

    const invalidCategoryRequests = [
      page.request.post('/api/categories', { data: { name: '' } }),
      page.request.post('/api/categories', { data: { name: '   ' } }),
      page.request.post('/api/categories', { data: { name: 'x'.repeat(81) } }),
      page.request.put('/api/categories', { data: { id: 'invalid', name: 'News' } }),
      page.request.put('/api/categories', { data: { id, name: ' ' } }),
      page.request.put('/api/categories', { data: { id, name: 'x'.repeat(81) } }),
      page.request.put('/api/categories', { data: { id, name: 'News', ownerId: owner.id } }),
      page.request.delete('/api/categories', { data: { id: 'invalid' } }),
      page.request.delete('/api/categories', { data: { id, owner_id: owner.id } }),
    ];
    for (const response of await Promise.all(invalidCategoryRequests)) expect(response.status()).toBe(400);

    const invalidMemberships = [
      { postId: 'invalid', categoryIds: [] },
      { postId: id, categoryIds: ['invalid'] },
      { postId: id, categoryIds: [id, id] },
      { postId: id, categoryIds: Array.from({ length: 21 }, () => crypto.randomUUID()) },
      { postId: id, categoryIds: [], translation_group_id: id },
      { postId: id, categoryIds: [], owner_id: owner.id },
    ];
    for (const data of invalidMemberships) {
      expect((await page.request.put('/api/posts/categories', { data })).status(), JSON.stringify(data)).toBe(400);
    }
  } finally {
    await cleanup(owner);
  }
});

test('returns every Category and counts assignments beyond Data API row limits', async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await createOwner('category-pagination');
  try {
    const categoryRows = Array.from({ length: 101 }, (_, index) => ({
      owner_id: owner.id,
      name: `Boundary ${String(index).padStart(3, '0')}`,
    }));
    const { data: categories, error: categoryError } = await owner.client.from('categories')
      .insert(categoryRows).select();
    if (categoryError || !categories) throw categoryError ?? new Error('Boundary Categories were not created.');

    const groupIds = Array.from({ length: 1_001 }, () => crypto.randomUUID());
    for (let offset = 0; offset < groupIds.length; offset += 200) {
      const { error } = await owner.client.from('posts').insert(
        groupIds.slice(offset, offset + 200).map((groupId) => postRow(owner, 'th', groupId)),
      );
      if (error) throw error;
    }
    const counted = categories.find(({ name }) => name === 'Boundary 000');
    if (!counted) throw new Error('Counted Category was not returned after seeding.');
    const { error: assignmentError } = await admin.from('post_category_assignments')
      .update({ category_id: counted.id }).eq('owner_id', owner.id);
    if (assignmentError) throw assignmentError;

    await signInAdmin(page, owner);
    const response = await page.request.get('/api/categories');
    expect(response.status()).toBe(200);
    const listed = (await response.json()).categories as Array<PostCategory & { postCount: number }>;
    expect.soft(listed).toHaveLength(102);
    expect.soft(listed.find(({ id }) => id === counted.id)?.postCount).toBe(1_001);
  } finally {
    await cleanup(owner);
  }
});

test('lists logical-group counts and scopes Category create, rename, and delete', async ({ page }) => {
  const owner = await createOwner('category-crud');
  const foreign = await createOwner('category-crud-foreign');
  try {
    const firstPost = await createPost(owner);
    await createPost(owner, 'en', firstPost.translation_group_id);
    const secondPost = await createPost(owner);
    const foreignPost = await createPost(foreign);
    const { data: foreignCategory, error: foreignError } = await foreign.client.from('categories')
      .insert({ owner_id: foreign.id, name: 'Foreign' }).select().single();
    if (foreignError || !foreignCategory) throw foreignError ?? new Error('Foreign Category was not created.');

    await signInAdmin(page, owner);
    const alphaResponse = await page.request.post('/api/categories', { data: { name: '  Alpha  ' } });
    expect(alphaResponse.status()).toBe(201);
    const alpha = (await alphaResponse.json()).category as PostCategory & { postCount: number };
    expect(alpha).toMatchObject({ name: 'Alpha', owner_id: owner.id, is_default: false, postCount: 0 });
    const zetaResponse = await page.request.post('/api/categories', { data: { name: 'Zeta' } });
    expect(zetaResponse.status()).toBe(201);
    const zeta = (await zetaResponse.json()).category as PostCategory;

    const duplicate = await page.request.post('/api/categories', { data: { name: 'aLPHa' } });
    expect(duplicate.status()).toBe(409);
    expect(await duplicate.text()).not.toMatch(/categories_owner_name_key|duplicate key|23505/i);

    expect((await page.request.put('/api/posts/categories', {
      data: { postId: firstPost.id, categoryIds: [alpha.id] },
    })).status()).toBe(200);
    expect((await page.request.put('/api/posts/categories', {
      data: { postId: secondPost.id, categoryIds: [alpha.id, zeta.id] },
    })).status()).toBe(200);

    const listed = await page.request.get('/api/categories');
    expect(listed.status()).toBe(200);
    const categories = (await listed.json()).categories as Array<PostCategory & { postCount: number }>;
    expect(categories.map(({ name, postCount }) => ({ name, postCount }))).toEqual([
      { name: 'Uncategorized', postCount: 0 },
      { name: 'Alpha', postCount: 2 },
      { name: 'Zeta', postCount: 1 },
    ]);

    const fallback = categories[0];
    const renamed = await page.request.put('/api/categories', { data: { id: zeta.id, name: '  Beta  ' } });
    expect(renamed.status()).toBe(200);
    expect((await renamed.json()).category.name).toBe('Beta');
    expect((await page.request.put('/api/categories', { data: { id: zeta.id, name: 'ALPHA' } })).status()).toBe(409);
    expect((await page.request.put('/api/categories', { data: { id: zeta.id, name: 'Uncategorized' } })).status()).toBe(409);
    expect((await page.request.put('/api/categories', { data: { id: fallback.id, name: 'Renamed default' } })).status()).toBe(409);
    for (const target of [foreignCategory.id, crypto.randomUUID()]) {
      expect((await page.request.put('/api/categories', { data: { id: target, name: 'Hidden' } })).status()).toBe(404);
      expect((await page.request.delete('/api/categories', { data: { id: target } })).status()).toBe(404);
    }
    expect((await page.request.delete('/api/categories', { data: { id: fallback.id } })).status()).toBe(409);

    const removed = await page.request.delete('/api/categories', { data: { id: alpha.id } });
    expect(removed.status()).toBe(200);
    expect(await removed.json()).toEqual({ affectedPosts: 2 });
    expect(await categoryIds(owner, firstPost.translation_group_id)).toEqual([fallback.id]);
    expect(await categoryIds(owner, secondPost.translation_group_id)).toEqual([zeta.id]);
    expect(await categoryIds(foreign, foreignPost.translation_group_id)).not.toContain(alpha.id);
  } finally {
    await cleanup(owner, foreign);
  }
});

test('replaces Post membership atomically and hides foreign Posts and Categories', async ({ page }, testInfo) => {
  const owner = await createOwner('category-membership');
  const foreign = await createOwner('category-membership-foreign');
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom', cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  try {
    const post = await createPost(owner);
    const foreignPost = await createPost(foreign);
    const { data: categories, error } = await owner.client.from('categories')
      .insert([{ owner_id: owner.id, name: 'First' }, { owner_id: owner.id, name: 'Second' }]).select();
    if (error || !categories) throw error ?? new Error('Test Categories were not created.');
    const { data: foreignCategory, error: foreignCategoryError } = await foreign.client.from('categories')
      .insert({ owner_id: foreign.id, name: 'Foreign' }).select().single();
    if (foreignCategoryError || !foreignCategory) throw foreignCategoryError ?? new Error('Foreign Category was not created.');
    const [first, second] = categories;
    await signInAdmin(page, owner);

    const selected = await page.request.put('/api/posts/categories', {
      data: { postId: post.id, categoryIds: [first.id] },
    });
    expect(selected.status()).toBe(200);
    expect(await selected.json()).toEqual({ categoryIds: [first.id] });

    const { PUT } = await vite.ssrLoadModule('/src/pages/api/posts/categories.ts') as { PUT: APIRoute };
    const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === '/rest/v1/rpc/replace_post_categories') {
        const body = JSON.parse(String(init?.body));
        body.requested_category_ids.push(crypto.randomUUID());
        return originalFetch(input, { ...init, body: JSON.stringify(body) });
      }
      return originalFetch(input, init);
    };
    const failed = await PUT(createContext({
      request: new Request(new URL('/api/posts/categories', page.url()), {
        method: 'PUT', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: post.id, categoryIds: [second.id] }),
      }), defaultLocale: 'en', locals: {},
    }));
    expect(failed.status).toBe(400);
    expect(await categoryIds(owner, post.translation_group_id)).toEqual([first.id]);
    globalThis.fetch = originalFetch;

    for (const target of [foreignPost.id, crypto.randomUUID()]) {
      expect((await page.request.put('/api/posts/categories', {
        data: { postId: target, categoryIds: [] },
      })).status()).toBe(404);
    }
    for (const categoryId of [foreignCategory.id, crypto.randomUUID()]) {
      expect((await page.request.put('/api/posts/categories', {
        data: { postId: post.id, categoryIds: [categoryId] },
      })).status()).toBe(400);
      expect(await categoryIds(owner, post.translation_group_id)).toEqual([first.id]);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await cleanup(owner, foreign);
  }
});

test('maps provider failures to generic responses without leaking server details', async ({ page }, testInfo) => {
  const owner = await createOwner('category-provider-error');
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom', cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  try {
    const post = await createPost(owner);
    await signInAdmin(page, owner);
    const categoryHandlers = await vite.ssrLoadModule('/src/pages/api/categories/index.ts') as Record<'GET' | 'POST' | 'PUT' | 'DELETE', APIRoute>;
    const membershipHandlers = await vite.ssrLoadModule('/src/pages/api/posts/categories.ts') as { PUT: APIRoute };
    const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
    const privateDetails = `Supabase categories post_category_assignments SQL relation key token ${owner.id}`;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.startsWith('/rest/v1/')) {
        return Response.json({ code: 'XX000', message: privateDetails, details: privateDetails, hint: privateDetails }, { status: 500 });
      }
      return originalFetch(input, init);
    };

    const categoryId = crypto.randomUUID();
    const calls = [
      ['GET', categoryHandlers.GET, undefined],
      ['POST', categoryHandlers.POST, { name: 'Private' }],
      ['PUT', categoryHandlers.PUT, { id: categoryId, name: 'Private' }],
      ['DELETE', categoryHandlers.DELETE, { id: categoryId }],
      ['PUT', membershipHandlers.PUT, { postId: post.id, categoryIds: [] }],
    ] as const;
    for (const [method, handler, body] of calls) {
      const response = await handler(createContext({
        request: new Request(new URL(method === 'PUT' && body && 'postId' in body ? '/api/posts/categories' : '/api/categories', page.url()), {
          method, headers: { cookie, 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }), defaultLocale: 'en', locals: {},
      }));
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain(owner.id);
      expect(text).not.toMatch(/Supabase|post_category_assignments|SQL|relation|key|token|XX000/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await cleanup(owner);
  }
});
