import { expect, test, type Page } from '@playwright/test';

import type { PostCategory } from '../../src/types/cms';
import { admin, cleanupEditor, createOwner, signInAdmin, type TestOwner } from './support';

async function prepare(page: Page, owner: TestOwner) {
  // Match installation, which creates the site owner's fallback on site_settings INSERT.
  const { error } = await admin.from('categories').insert({ owner_id: owner.id, name: 'Uncategorized', is_default: true });
  if (error) throw error;
  await signInAdmin(page, owner);
  const categories: PostCategory[] = [];
  for (const name of ['Zebra', 'Alpha']) {
    const response = await page.request.post('/api/admin/categories', { data: { name } });
    expect(response.status()).toBe(201);
    categories.push((await response.json()).category);
  }
  await page.goto('/admin/new');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Categories', exact: true })).toBeVisible();
  return categories;
}

async function assignments(owner: TestOwner) {
  const { data, error } = await owner.client.from('post_category_assignments')
    .select('category_id, translation_group_id').eq('owner_id', owner.id).order('category_id');
  if (error) throw error;
  return data;
}

test('new Posts normalize custom selections and restore the fallback immediately', async ({ page }) => {
  const owner = await createOwner('editor-category-default');
  try {
    await prepare(page, owner);
    const group = page.getByRole('group', { name: 'Categories', exact: true });
    const fallback = group.getByRole('checkbox', { name: 'Uncategorized', exact: true });
    await expect(fallback).toBeChecked();
    await expect(group).toContainText('Uncategorized is used when no custom categories are selected.');
    await expect(group.getByRole('checkbox')).toHaveCount(3);
    await expect(group.getByRole('checkbox').nth(1)).toHaveAccessibleName('Alpha');
    await expect(group.getByRole('checkbox').nth(2)).toHaveAccessibleName('Zebra');
    await group.getByRole('checkbox', { name: 'Alpha', exact: true }).check();
    await expect(fallback).not.toBeChecked();
    await expect(fallback).toBeDisabled();
    await group.getByRole('checkbox', { name: 'Zebra', exact: true }).check();
    await group.getByRole('checkbox', { name: 'Alpha', exact: true }).uncheck();
    await expect(fallback).not.toBeChecked();
    await group.getByRole('checkbox', { name: 'Zebra', exact: true }).uncheck();
    await expect(fallback).toBeChecked();
    await expect(fallback).toBeEnabled();
    await fallback.click();
    await expect(fallback).toBeChecked();
  } finally {
    await cleanupEditor(page, owner);
  }
});

for (const action of ['autosave', 'publish'] as const) {
  test(`${action} saves content before membership and retries the created Post without duplication`, async ({ page }) => {
    const owner = await createOwner(`editor-category-${action}`);
    try {
      const [, alpha] = await prepare(page, owner);
      await page.getByRole('checkbox', { name: 'Alpha', exact: true }).check();
      await page.getByRole('button', { name: 'Close settings' }).click();
      let fail = true;
      const contentMethods: string[] = [];
      const storedBeforeMembership: { id: string; title: string; status: string }[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/admin/posts') contentMethods.push(request.method());
      });
      await page.route('**/api/admin/posts/categories', async (route) => {
        const { postId } = route.request().postDataJSON();
        const { data, error } = await owner.client.from('posts').select('id, title, status').eq('id', postId).single();
        expect(error).toBeNull();
        storedBeforeMembership.push(data!);
        if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Post Categories could not be saved.' }) });
        return route.continue();
      });
      await page.getByLabel('Post title').fill('Category retry');
      await page.locator('.ProseMirror').fill('Keep the body');
      if (action === 'publish') await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.locator('.admin-save-state')).toContainText('Save failed');
      expect(storedBeforeMembership[0]).toMatchObject({ title: 'Category retry', status: action === 'publish' ? 'published' : 'draft' });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Close settings' }).click();
      fail = false;
      await page.getByRole('button', { name: 'Retry save' }).click();
      await expect(page.locator('.admin-save-state')).toContainText('Saved');
      await expect(page).toHaveURL(new RegExp(`/admin/edit/${storedBeforeMembership[0].id}$`));
      expect(contentMethods).toEqual(['POST', 'PUT']);
      expect(storedBeforeMembership[1]).toEqual(storedBeforeMembership[0]);
      const posts = await owner.client.from('posts').select('id, content_html').eq('author_id', owner.id);
      expect(posts.data).toEqual([{ id: storedBeforeMembership[0].id, content_html: '<p>Keep the body</p>' }]);
      expect((await assignments(owner)).map(({ category_id }) => category_id)).toEqual([alpha.id]);
    } finally {
      await cleanupEditor(page, owner);
    }
  });
}

test('category changes during membership save remain dirty and serialize the next snapshot', async ({ page }) => {
  const owner = await createOwner('editor-category-race');
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    const [zebra, alpha] = await prepare(page, owner);
    await page.getByRole('checkbox', { name: 'Alpha', exact: true }).check();
    await page.getByRole('button', { name: 'Close settings' }).click();
    const snapshots: string[][] = [];
    let active = 0;
    let maximumActive = 0;
    await page.route('**/api/admin/posts/categories', async (route) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      snapshots.push(route.request().postDataJSON().categoryIds);
      if (snapshots.length === 1) await gate;
      const response = await route.fetch();
      active -= 1;
      await route.fulfill({ response });
    });
    await page.getByLabel('Post title').fill('Category race');
    await expect.poll(() => snapshots.length).toBe(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Zebra', exact: true }).check();
    await expect(page.locator('.admin-save-state')).toContainText('Unsaved');
    release();
    await expect.poll(() => snapshots.length).toBe(2);
    await expect(page.locator('.admin-save-state')).toContainText('Saved');
    expect(snapshots.map((ids) => [...ids].sort())).toEqual([[alpha.id], [alpha.id, zebra.id].sort()]);
    expect(maximumActive).toBe(1);
    expect((await assignments(owner)).map(({ category_id }) => category_id)).toEqual([alpha.id, zebra.id].sort());
  } finally {
    release();
    await cleanupEditor(page, owner);
  }
});

test('new translations inherit shared membership and both editions edit the same assignment rows', async ({ page }) => {
  const owner = await createOwner('editor-category-translations');
  try {
    const [zebra, alpha] = await prepare(page, owner);
    await page.getByRole('checkbox', { name: 'Alpha', exact: true }).check();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByLabel('Post title').fill('Source categories');
    await expect(page).toHaveURL(/\/admin\/edit\//);
    const sourceUrl = page.url();
    const addTranslation = page.getByRole('button', { name: /Add (TH|EN) translation/ });
    await addTranslation.click();
    await expect(page).toHaveURL(/\/admin\/new\?sourcePostId=/);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked();
    const originalAssignments = await assignments(owner);
    expect(originalAssignments).toHaveLength(1);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByLabel('Post title').fill('Translated categories');
    await expect(page).toHaveURL(/\/admin\/edit\//);
    const translationUrl = page.url();
    expect(await assignments(owner)).toEqual(originalAssignments);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Zebra', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Alpha', exact: true }).uncheck();
    await expect(page.locator('.admin-save-state')).toContainText('Saved');
    await page.goto(sourceUrl);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Zebra', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Alpha', exact: true })).not.toBeChecked();
    expect(await assignments(owner)).toEqual([{ category_id: zebra.id, translation_group_id: originalAssignments[0].translation_group_id }]);
    await page.getByRole('checkbox', { name: 'Alpha', exact: true }).check();
    await expect(page.locator('.admin-save-state')).toContainText('Saved');
    await page.goto(translationUrl);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Zebra', exact: true })).toBeChecked();
    expect((await assignments(owner)).map(({ category_id }) => category_id)).toEqual([alpha.id, zebra.id].sort());
  } finally {
    await cleanupEditor(page, owner);
  }
});

test('Manage categories saves dirty content before navigation and stays open after membership failure', async ({ page }) => {
  const owner = await createOwner('editor-category-navigation');
  try {
    const [, alpha] = await prepare(page, owner);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByLabel('Post title').fill('Manage categories draft');
    await page.locator('.ProseMirror').fill('Saved before navigating');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Alpha', exact: true }).check();
    let fail = true;
    await page.route('**/api/admin/posts/categories', (route) => fail
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Post Categories could not be saved.' }) })
      : route.continue());
    await page.getByRole('button', { name: 'Manage categories', exact: true }).click();
    await expect(page.locator('.admin-save-state')).toContainText('Save failed');
    await expect(page.getByRole('dialog', { name: 'Post settings' })).toBeVisible();
    expect(page.url()).not.toContain('/admin/categories');
    await expect(page.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked();
    fail = false;
    await page.getByRole('button', { name: 'Manage categories', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/categories$/);
    const posts = await owner.client.from('posts').select('content_html').eq('author_id', owner.id);
    expect(posts.data).toEqual([{ content_html: '<p>Saved before navigating</p>' }]);
    expect((await assignments(owner)).map(({ category_id }) => category_id)).toEqual([alpha.id]);
  } finally {
    await cleanupEditor(page, owner);
  }
});
