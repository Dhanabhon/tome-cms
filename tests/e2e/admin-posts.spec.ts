import { expect, test } from '@playwright/test';
import { createContext } from 'astro/middleware';
import { admin, chooseUiOption, createOwner, deleteOwner, signInAdmin } from './support';

const content = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A complete story.' }] }] };

test('PATCH rejects a draft autosaved after publication validation reads its revision', async ({ page }, testInfo) => {
  const owner = await createOwner('story-revision');
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: false, envPrefix: 'PUBLIC_', appType: 'custom',
    cacheDir: testInfo.outputPath('vite-cache'),
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  try {
    await signInAdmin(page, owner);
    await expect(page.locator('select')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const draft = { title: 'Concurrent draft', slug: `revision-${crypto.randomUUID()}`, status: 'draft', contentJson: content, contentHtml: '<p>A complete story.</p>' };
    const created = await page.request.post('/api/posts', { data: draft });
    expect(created.status()).toBe(201);
    const { post } = await created.json();
    const { PATCH } = await vite.ssrLoadModule('/src/pages/api/posts/index.ts');
    let autosaved = false;
    // Interleave a real PUT after the real DB read returns, before PATCH receives its snapshot.
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!autosaved && (init?.method ?? 'GET') === 'GET' && url.pathname === '/rest/v1/posts' && url.searchParams.get('id') === `eq.${post.id}`) {
        autosaved = true;
        const saved = await page.request.put('/api/posts', { data: { ...draft, id: post.id, contentJson: { type: 'doc', content: [] }, contentHtml: '' } });
        expect(saved.status()).toBe(200);
      }
      return response;
    };
    const cookie = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
    const request = new Request(new URL('/api/posts', page.url()), {
      method: 'PATCH', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id: post.id, status: 'published' }),
    });
    const response = await PATCH(createContext({ request, defaultLocale: 'en', locals: {} }));
    expect(autosaved).toBe(true);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/changed.*reload/i);
    const saved = await admin.from('posts').select('status, content_html, updated_at').eq('id', post.id).single();
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ status: 'draft', content_html: '' });
    expect(saved.data?.updated_at).not.toBe(post.updated_at);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('edition filters survive reload and history with sibling state and responsive rows', async ({ page }) => {
  const owner = await createOwner('story-filters');
  const group = crypto.randomUUID();
  try {
    const { error } = await admin.from('posts').insert([
      { title: 'Thai story', locale: 'th', status: 'draft', translation_group_id: group },
      { title: 'English story', locale: 'en', status: 'draft', translation_group_id: group },
      { title: 'Published story', locale: 'en', status: 'published', translation_group_id: crypto.randomUUID() },
    ].map((post) => ({ ...post, author_id: owner.id, slug: `story-${crypto.randomUUID()}`, content_json: content, content_html: '<p>A complete story.</p>' })));
    expect(error).toBeNull();
    // The database trigger owns timestamps; a subsequent write makes this edition newest.
    const refreshed = await admin.from('posts').update({ title: 'English story' }).eq('author_id', owner.id).eq('title', 'English story');
    expect(refreshed.error).toBeNull();
    await signInAdmin(page, owner);
    const rows = page.locator('.admin-story-row');
    await expect(page.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true');
    for (const tab of await page.getByRole('tab').all()) {
      const target = await tab.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('English story');
    await expect(rows.filter({ hasText: 'Thai story' })).toContainText('EN draft');
    await expect(rows.first()).toContainText('1 min read');
    const titleTarget = await rows.first().getByRole('link', { name: 'English story', exact: true }).boundingBox();
    expect(titleTarget?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('tab', { name: 'Published' }).click();
    await expect(page).toHaveURL(/status=published/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('TH missing');
    await page.getByRole('tab', { name: 'All' , exact: true }).click();
    await chooseUiOption(page, 'Language', 'English');
    await page.getByLabel('Search posts').fill(' ENGLISH ');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/locale=en/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('English story');
    await page.reload();
    await expect(page.getByLabel('Search posts')).toHaveValue('ENGLISH');
    await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveAttribute('data-value', 'en');
    await page.goBack();
    await expect(rows).toHaveCount(3);
    await page.goForward();
    await expect(rows).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await rows.first().locator('summary').click();
    const target = await rows.first().getByRole('button', { name: 'Publish', exact: true }).boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/admin?status=invalid&locale=fr&q=' + 'x'.repeat(120));
    await expect(page.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveAttribute('data-value', 'all');
    await expect(page.getByLabel('Search posts')).toHaveValue('x'.repeat(100));
    await expect(page.getByText('No posts match these filters.')).toBeVisible();
  } finally {
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('row actions publish, unpublish and confirm deletion of only one edition; failures remain visible', async ({ page }) => {
  const owner = await createOwner('story-actions');
  try {
    const { data: posts, error } = await admin.from('posts').insert(['th', 'en'].map((locale) => ({
      author_id: owner.id, title: `${locale} edition`, locale, translation_group_id: owner.id,
      slug: `action-${crypto.randomUUID()}`, status: 'draft', content_json: content, content_html: '<p>A complete story.</p>',
    }))).select('*');
    expect(error).toBeNull();
    const [source, sibling] = posts!;
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin?status=all&locale=th&q=edition');
    const row = page.locator('.admin-story-row');
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(row.locator('.admin-status')).toHaveText('published');
    await expect(page).toHaveURL(/status=all&locale=th&q=edition$/);
    const saved = await admin.from('posts').select('*').eq('id', source.id).single();
    const { status, updated_at, published_at, ...unchanged } = saved.data!;
    const { status: oldStatus, updated_at: oldUpdated, published_at: oldPublished, ...original } = source;
    expect(unchanged).toEqual(original);
    expect((await admin.from('posts').select('status').eq('id', sibling.id).single()).data?.status).toBe('draft');
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Unpublish' }).click();
    await expect(row.locator('.admin-status')).toHaveText('draft');
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete post?' });
    await expect(deleteDialog).toContainText(source.title);
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(deleteDialog).toContainText('TH');
    await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect((await admin.from('posts').select('id').eq('id', sibling.id)).data).toEqual([{ id: sibling.id }]);
    await admin.from('posts').update({ content_html: '' }).eq('id', sibling.id);
    await page.goto('/admin');
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Add content before publishing.');
    await expect(row.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
    await row.locator('summary').click();
    await expect(page.getByRole('alert')).toBeVisible();
  } finally {
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('PATCH validates ownership, strict payload and both document and rendered content', async ({ page, request }) => {
  const owner = await createOwner('story-status');
  const foreign = await createOwner('story-foreign');
  try {
    expect((await request.patch('/api/posts', { data: { id: crypto.randomUUID(), status: 'published' } })).status()).toBe(401);
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const { data: other } = await admin.from('posts').insert({ author_id: foreign.id, title: 'Foreign', locale: 'en', slug: `foreign-${crypto.randomUUID()}`, status: 'published', content_json: content, content_html: '<p>Text</p>' }).select('id').single();
    for (const id of [other!.id, crypto.randomUUID()]) {
      expect((await page.request.patch('/api/posts', { data: { id, status: 'draft' } })).status()).toBe(404);
    }
    for (const data of [{ id: 'invalid', status: 'draft' }, { id: other!.id, status: 'bad' }, { id: other!.id, status: 'draft', title: 'Override' }]) {
      expect((await page.request.patch('/api/posts', { data })).status()).toBe(400);
    }
    expect((await page.request.patch('/api/posts', { data: '{', headers: { 'content-type': 'application/json' } })).status()).toBe(400);
    for (const body of [
      { contentJson: content, contentHtml: '<script>alert(1)</script>' },
      { contentJson: content, contentHtml: '<p>&nbsp; &#8203;</p>' },
      { contentJson: { type: 'doc', content: [] }, contentHtml: '<p>Text</p>' },
      { contentJson: { type: 'doc', content: [{ type: 'image' }] }, contentHtml: '<img src="https://">' },
      { contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: '/cover.jpg' } }] }, contentHtml: '<img src="/cover.jpg">' },
    ]) {
      const created = await page.request.post('/api/posts', { data: { ...body, title: 'Draft', slug: `render-${crypto.randomUUID()}`, status: 'draft' } });
      expect(created.status()).toBe(201);
      const { post } = await created.json();
      const result = await page.request.patch('/api/posts', { data: { id: post.id, status: 'published' } });
      expect(result.status()).toBe(body.contentHtml.includes('/cover.jpg') ? 200 : 400);
    }
    expect((await admin.from('posts').select('status').eq('id', other!.id).single()).data?.status).toBe('published');
  } finally {
    await admin.from('posts').delete().in('author_id', [owner.id, foreign.id]);
    await deleteOwner(owner);
    await deleteOwner(foreign);
  }
});
