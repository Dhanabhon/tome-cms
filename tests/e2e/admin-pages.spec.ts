import { expect, test } from '@playwright/test';

import { admin, chooseUiOption, cleanupEditor, createOwner, leaseSiteOwner, signInAdmin } from './support';

const content = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A complete page.' }] }] };

test('Page filters preserve URL history, timezone, translations, and server-rendered responsive rows', async ({ page, browser }) => {
  const owner = await createOwner('page-list');
  const restore = await leaseSiteOwner(owner);
  try {
    expect((await admin.from('site_settings').update({ timezone: 'Asia/Bangkok' }).eq('id', true)).error).toBeNull();
    const group = crypto.randomUUID();
    const { data: pages, error } = await admin.from('pages').insert([
      { title: 'Thai page', locale: 'th', status: 'draft', translation_group_id: group },
      { title: 'English page', locale: 'en', status: 'draft', translation_group_id: group },
      { title: 'Published page', locale: 'en', status: 'published', translation_group_id: crypto.randomUUID(), published_at: '2026-01-01T00:00:00Z' },
    ].map((edition) => ({ ...edition, author_id: owner.id, slug: `page-${crypto.randomUUID()}`, content_json: content, content_html: '<p>A complete page.</p>' }))).select('*');
    expect(error).toBeNull();
    const thai = pages!.find((edition) => edition.locale === 'th')!;
    const english = pages!.find((edition) => edition.title === 'English page')!;
    const published = pages!.find((edition) => edition.status === 'published')!;
    expect((await admin.from('pages').update({ title: english.title }).eq('id', english.id)).error).toBeNull();
    await signInAdmin(page, owner);
    await page.goto('/admin/pages');
    const rows = page.locator('.admin-page-row');
    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible();
    await expect(page.locator('nav a[href="/admin/pages"][aria-current="page"]')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'New page' })).toHaveAttribute('href', '/admin/pages/new');
    await expect(page.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('English page');
    await expect(rows.first()).toContainText(`/en/${english.slug}`);
    await expect(rows.first().getByRole('link', { name: 'TH draft' })).toHaveAttribute('href', `/admin/pages/edit/${thai.id}`);
    const stamp = await rows.first().locator('time').getAttribute('datetime');
    const formatted = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(stamp!));
    await expect(rows.first()).toContainText(`Updated ${formatted} (Asia/Bangkok)`);
    await expect(rows.locator('.admin-story-cover')).toHaveCount(0);
    await expect(rows).not.toContainText(['min read']);
    await page.getByRole('tab', { name: 'Published' }).click();
    await expect(page).toHaveURL(/status=published/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('time')).toHaveText('Jan 1, 2026, 7:00 AM');
    await expect(rows.first()).toContainText('Published Jan 1, 2026, 7:00 AM (Asia/Bangkok)');
    await expect(rows.first().getByRole('link', { name: 'TH missing' })).toHaveAttribute('href', `/admin/pages/new?sourcePageId=${published.id}&locale=th`);
    await page.getByRole('tab', { name: 'All', exact: true }).click();
    await chooseUiOption(page, 'Language', 'English');
    await page.getByLabel('Search pages').fill(' ENGLISH ');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/locale=en/);
    await expect(rows).toHaveCount(1);
    await page.reload();
    await expect(page.getByLabel('Search pages')).toHaveValue('ENGLISH');
    await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveAttribute('data-value', 'en');
    await page.goBack();
    await expect(rows).toHaveCount(3);
    await page.goForward();
    await expect(rows).toHaveCount(1);
    for (const width of [320, 375, 414, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await rows.first().locator('summary').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const control of await rows.first().locator('a, button, summary').all()) {
        const bounds = await control.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      await rows.first().locator('summary').click();
    }
    const noJs = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
    try {
      const document = await noJs.newPage();
      await document.goto('/admin/pages?status=all');
      await expect(document.locator('.admin-page-row')).toHaveCount(3);
      await expect(document.locator('.admin-story-list astro-island, astro-island .admin-story-list')).toHaveCount(0);
    } finally {
      await noJs.close();
    }
    await page.goto('/admin/pages?status=invalid&locale=fr&q=' + 'x'.repeat(120));
    await expect(page.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveAttribute('data-value', 'all');
    await expect(page.getByLabel('Search pages')).toHaveValue('x'.repeat(100));
    await expect(page.getByText('No pages match these filters.')).toBeVisible();
  } finally {
    await restore();
    await cleanupEditor(page, owner);
  }
});

test('Page row actions preserve editions and saved placements on unpublish, then cascade menu references on delete', async ({ page }) => {
  const owner = await createOwner('page-actions');
  try {
    const { data: pages, error } = await admin.from('pages').insert(['th', 'en'].map((locale) => ({
      author_id: owner.id, title: `${locale} edition`, locale, translation_group_id: owner.id,
      slug: `page-action-${crypto.randomUUID()}`, status: 'draft', content_json: content, content_html: '<p>A complete page.</p>',
    }))).select('*');
    expect(error).toBeNull();
    const source = pages!.find((edition) => edition.locale === 'th')!;
    const sibling = pages!.find((edition) => edition.locale === 'en')!;
    expect((await admin.from('navigation_items').insert(['header', 'footer'].map((location) => ({
      owner_id: owner.id, locale: 'th', location, kind: 'page', label: 'Page menu', page_id: source.id, position: 0,
    })))).error).toBeNull();
    await signInAdmin(page, owner);
    await page.goto('/admin/pages?status=all&locale=th&q=edition');
    const row = page.locator('.admin-page-row');
    await row.locator('summary').click();
    await expect(row.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', `/admin/pages/edit/${source.id}`);
    const popupPromise = page.waitForEvent('popup');
    await row.getByRole('link', { name: 'Preview', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(new RegExp(`/admin/pages/preview/${source.id}$`));
    await expect(popup.getByRole('heading', { name: source.title, exact: true })).toBeVisible();
    await popup.close();
    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(row.locator('.admin-status')).toHaveText('published');
    await expect(page).toHaveURL(/status=all&locale=th&q=edition$/);
    const saved = await admin.from('pages').select('*').eq('id', source.id).single();
    const { status, updated_at, published_at, ...unchanged } = saved.data!;
    const { status: oldStatus, updated_at: oldUpdated, published_at: oldPublished, ...original } = source;
    expect(unchanged).toEqual(original);
    expect((await admin.from('pages').select('status').eq('id', sibling.id).single()).data?.status).toBe('draft');
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Unpublish', exact: true }).click();
    const unpublish = page.getByRole('dialog', { name: 'Unpublish page?' });
    await expect(unpublish).toContainText('placements stay saved');
    await expect(unpublish).toContainText('disappear publicly until republished');
    await unpublish.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.locator('.admin-status')).toHaveText('published');
    await row.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await unpublish.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await expect(row.locator('.admin-status')).toHaveText('draft');
    expect((await admin.from('navigation_items').select('id').eq('page_id', source.id)).data).toHaveLength(2);
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: 'Delete page?' });
    await expect(deletion).toContainText('“th edition” (TH)');
    await expect(deletion).toContainText('This edition and its menu references will be permanently removed.');
    await deletion.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteRequest = page.waitForRequest((request) => request.method() === 'DELETE' && new URL(request.url()).pathname === '/api/pages');
    await deletion.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(await (await deleteRequest).headerValue('content-type')).toBe('application/json');
    expect((await admin.from('navigation_items').select('id').eq('page_id', source.id)).data).toEqual([]);
    expect((await admin.from('pages').select('id').eq('id', sibling.id)).data).toEqual([{ id: sibling.id }]);
    await admin.from('pages').update({ content_html: '' }).eq('id', sibling.id);
    await page.goto('/admin/pages');
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Add content before publishing.');
    await expect(row.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
    expect((await admin.from('pages').update({ content_html: '<p>A complete page.</p>' }).eq('id', sibling.id)).error).toBeNull();
    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect((await admin.from('pages').select('status').eq('id', sibling.id).single()).data?.status).toBe('published');
  } finally {
    // Dashboard actions reload after completion; close the page before editor-oriented cleanup tracks stale requests.
    await page.close();
    await cleanupEditor(page, owner);
  }
});

test('Pages login preserves filters and an owner without pages sees the first-page action', async ({ page }) => {
  const owner = await createOwner('page-empty');
  const foreign = await createOwner('page-list-foreign');
  try {
    expect((await admin.from('pages').insert({ author_id: foreign.id, locale: 'en', title: 'Foreign page', slug: `foreign-${crypto.randomUUID()}`, content_json: content, content_html: '<p>Foreign page.</p>', status: 'published' })).error).toBeNull();
    const path = '/admin/pages?status=all&locale=en&q=page';
    await page.goto(path);
    await expect(page).toHaveURL(new URL(`/admin?returnTo=${encodeURIComponent(path)}`, page.url()).href);
    await page.getByLabel('Email address').fill(owner.email);
    await page.getByLabel('Password').fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new URL(path, page.url()).href);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Your first page starts here' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create first page' })).toHaveAttribute('href', '/admin/pages/new');
    await expect(page.locator('.admin-page-row')).toHaveCount(0);
  } finally {
    await cleanupEditor(page, owner, foreign);
  }
});
