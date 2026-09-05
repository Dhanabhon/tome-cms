import { expect, test } from '@playwright/test';
import { admin, createOwner, deleteOwner, signInAdmin } from './support';

const content = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A complete story.' }] }] };

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
    await expect(rows.first().getByRole('link', { name: /missing|Preview/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'All' , exact: true }).click();
    await page.getByLabel('Language', { exact: true }).selectOption('en');
    await page.getByLabel('Search posts').fill(' ENGLISH ');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/locale=en/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('English story');
    await page.reload();
    await expect(page.getByLabel('Search posts')).toHaveValue('ENGLISH');
    await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
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
    await expect(page.getByLabel('Language', { exact: true })).toHaveValue('all');
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
    page.once('dialog', async (dialog) => { expect(dialog.message()).toContain(source.title); await dialog.dismiss(); });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(1);
    page.once('dialog', async (dialog) => { expect(dialog.message()).toContain('TH'); await dialog.accept(); });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
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
