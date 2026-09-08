import { expect, test, type Page } from '@playwright/test';

import { admin, cleanupEditor, createOwner, signInAdmin, type TestOwner } from './support';

function categoryRow(page: Page, name: string) {
  return page.getByRole('list', { name: 'Categories' }).getByRole('listitem').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

async function createPost(owner: TestOwner, title: string) {
  const { data, error } = await owner.client.from('posts').insert({
    author_id: owner.id,
    content_html: '<p>Category manager contract.</p>',
    content_json: { type: 'doc', content: [] },
    locale: 'en',
    slug: `category-manager-${crypto.randomUUID()}`,
    title,
  }).select().single();
  if (error || !data) throw error ?? new Error('Category manager Post was not created.');
  return data;
}

async function ensureDefaultCategory(owner: TestOwner) {
  const post = await createPost(owner, 'Default Category seed');
  const { error } = await owner.client.from('posts').delete().eq('id', post.id);
  if (error) throw error;
}

test('is a protected Posts sub-area with an immutable default Category', async ({ page }) => {
  await page.goto('/admin/categories?view=all');
  await expect(page).toHaveURL(/\/admin\?returnTo=%2Fadmin%2Fcategories%3Fview%3Dall$/);

  const owner = await createOwner('category-manager-shell');
  try {
    await ensureDefaultCategory(owner);
    await signInAdmin(page, owner);
    const heading = page.getByRole('heading', { name: 'Posts', exact: true });
    const actions = heading.locator('xpath=..').locator('xpath=following-sibling::*[1]');
    await expect(actions.getByRole('link')).toHaveText(['Manage categories', 'New post +']);
    await actions.getByRole('link', { name: 'Manage categories' }).click();
    await expect(page).toHaveURL(/\/admin\/categories$/);
    await expect(page.getByRole('navigation', { name: 'Admin', exact: true }).first().getByRole('link')).toHaveText([
      'Posts', 'Pages', 'Files', 'Navigation', 'Profile', 'Settings',
    ]);
    await expect(page.getByRole('link', { name: 'Posts', exact: true }).first()).toHaveAttribute('aria-current', 'page');

    const fallback = categoryRow(page, 'Uncategorized');
    await expect(fallback).toBeVisible();
    await expect(fallback.getByText('Default', { exact: true })).toBeVisible();
    await expect(fallback.getByText('0 Posts', { exact: true })).toBeVisible();
    await expect(fallback.getByRole('button', { name: /Rename|Delete/ })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Categories' }).getByRole('listitem').first()).toContainText('Uncategorized');
  } finally {
    await cleanupEditor(page, owner);
  }
});

test('creates and renames alphabetically while preserving recoverable input and focus', async ({ page }) => {
  const owner = await createOwner('category-manager-mutations');
  try {
    await ensureDefaultCategory(owner);
    const { error } = await owner.client.from('categories').insert({ owner_id: owner.id, name: 'Zeta' });
    if (error) throw error;
    await signInAdmin(page, owner);
    await page.goto('/admin/categories');

    const input = page.getByLabel('Category name', { exact: true });
    let releaseCreate = () => {};
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await createGate;
      await route.continue();
    }, { times: 1 });
    await input.fill('  Alpha  ');
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(page.getByRole('status')).toHaveText('Creating “Alpha”…');
    await expect(input).toHaveValue('  Alpha  ');
    releaseCreate();
    await expect(page.getByRole('status')).toHaveText('Category “Alpha” created.');
    await expect(input).toHaveValue('');
    await expect(page.getByRole('list', { name: 'Categories' }).getByRole('heading')).toHaveText([
      'Uncategorized', 'Alpha', 'Zeta',
    ]);

    await input.fill(' alpha ');
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(page.getByRole('alert')).toContainText('already in use or protected');
    await expect(input).toHaveValue(' alpha ');

    const alpha = categoryRow(page, 'Alpha');
    await alpha.getByRole('button', { name: 'Rename Alpha' }).click();
    const renameInput = page.getByLabel('Category name for Alpha');
    await expect(renameInput).toBeFocused();
    await renameInput.fill('Beta');
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Rename is temporarily unavailable.' }) });
    }, { times: 1 });
    await page.getByRole('button', { name: 'Save Beta' }).click();
    await expect(page.getByRole('alert')).toHaveText('Rename is temporarily unavailable.');
    await expect(renameInput).toHaveValue('Beta');
    await page.getByRole('button', { name: 'Save Beta' }).click();
    const beta = categoryRow(page, 'Beta');
    await expect(beta).toBeVisible();
    await expect(beta.getByRole('button', { name: 'Rename Beta' })).toBeFocused();

    const zeta = categoryRow(page, 'Zeta');
    await zeta.getByRole('button', { name: 'Rename Zeta' }).click();
    await page.getByLabel('Category name for Zeta').fill('Discarded');
    await page.getByRole('button', { name: 'Cancel rename' }).click();
    await expect(categoryRow(page, 'Zeta')).toBeVisible();
    await expect(categoryRow(page, 'Zeta').getByRole('button', { name: 'Rename Zeta' })).toBeFocused();
  } finally {
    await cleanupEditor(page, owner);
  }
});

test('keeps every overlapping action pending until its own request completes', async ({ page }) => {
  const owner = await createOwner('category-manager-pending-ownership');
  let releaseRename = () => {};
  try {
    await ensureDefaultCategory(owner);
    const { error } = await owner.client.from('categories').insert({ owner_id: owner.id, name: 'Alpha' });
    if (error) throw error;
    await signInAdmin(page, owner);
    await page.goto('/admin/categories');

    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await renameGate;
      await route.continue();
    }, { times: 1 });
    await categoryRow(page, 'Alpha').getByRole('button', { name: 'Rename Alpha' }).click();
    await page.getByLabel('Category name for Alpha').fill('Beta');
    const saveRename = page.getByRole('button', { name: 'Save Beta' });
    await saveRename.click();
    await expect(saveRename).toBeDisabled();

    await page.getByLabel('Category name', { exact: true }).fill('Delta');
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(categoryRow(page, 'Delta')).toBeVisible();
    await expect(saveRename).toBeDisabled();
    await expect(page.locator('.category-manager')).toHaveAttribute('aria-busy', 'true');

    releaseRename();
    await expect(categoryRow(page, 'Beta')).toBeVisible();
    await expect(page.locator('.category-manager')).toHaveAttribute('aria-busy', 'false');
  } finally {
    releaseRename();
    await cleanupEditor(page, owner);
  }
});

test('a completed rename does not discard a newer inline edit', async ({ page }) => {
  const owner = await createOwner('category-manager-editor-ownership');
  let releaseRename = () => {};
  try {
    await ensureDefaultCategory(owner);
    const { error } = await owner.client.from('categories').insert([
      { owner_id: owner.id, name: 'Alpha' },
      { owner_id: owner.id, name: 'Zeta' },
    ]);
    if (error) throw error;
    await signInAdmin(page, owner);
    await page.goto('/admin/categories');

    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await renameGate;
      await route.continue();
    }, { times: 1 });
    await categoryRow(page, 'Alpha').getByRole('button', { name: 'Rename Alpha' }).click();
    await page.getByLabel('Category name for Alpha').fill('Beta');
    await page.getByRole('button', { name: 'Save Beta' }).click();
    await categoryRow(page, 'Zeta').getByRole('button', { name: 'Rename Zeta' }).click();
    const newerEdit = page.getByLabel('Category name for Zeta');
    await newerEdit.fill('Zeta draft');
    await expect(newerEdit).toBeFocused();

    releaseRename();
    await expect(categoryRow(page, 'Beta')).toBeVisible();
    await expect(newerEdit).toHaveValue('Zeta draft');
    await expect(newerEdit).toBeFocused();
  } finally {
    releaseRename();
    await cleanupEditor(page, owner);
  }
});

test('confirms non-optimistic deletion, supports retry, and fits long names at 320px', async ({ page }) => {
  const owner = await createOwner('category-manager-delete');
  try {
    const { data: categories, error: categoryError } = await owner.client.from('categories')
      .insert([{ owner_id: owner.id, name: 'Research' }, { owner_id: owner.id, name: 'Secondary' }]).select();
    if (categoryError || !categories) throw categoryError ?? new Error('Categories were not created.');
    const category = categories.find(({ name }) => name === 'Research');
    const secondary = categories.find(({ name }) => name === 'Secondary');
    if (!category || !secondary) throw new Error('Seeded Categories were not returned.');
    const first = await createPost(owner, 'First');
    const second = await createPost(owner, 'Second');
    const { error: assignmentError } = await admin.from('post_category_assignments').update({ category_id: category.id })
      .eq('owner_id', owner.id).in('translation_group_id', [first.translation_group_id, second.translation_group_id]);
    if (assignmentError) throw assignmentError;
    const { error: secondaryAssignmentError } = await admin.from('post_category_assignments').insert({
      category_id: secondary.id,
      owner_id: owner.id,
      translation_group_id: second.translation_group_id,
    });
    if (secondaryAssignmentError) throw secondaryAssignmentError;
    const longName = `Long ${'category'.repeat(9)}`.slice(0, 80);
    const { error: longNameError } = await owner.client.from('categories').insert({ owner_id: owner.id, name: longName });
    if (longNameError) throw longNameError;

    await signInAdmin(page, owner);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/admin/categories');
    await expect(categoryRow(page, 'Research').getByText('2 Posts', { exact: true })).toBeVisible();
    await expect(categoryRow(page, 'Secondary').getByText('1 Post', { exact: true })).toBeVisible();
    const longHeading = categoryRow(page, longName).getByRole('heading', { name: longName });
    await expect(longHeading).toBeVisible();
    expect(await longHeading.evaluate((element) => getComputedStyle(element).overflowWrap)).toBe('anywhere');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const deleteButton = categoryRow(page, 'Research').getByRole('button', { name: 'Delete Research' });
    for (const button of await categoryRow(page, 'Research').getByRole('button').all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await deleteButton.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete Category?' });
    await expect(dialog).toContainText('Research');
    await expect(dialog).toContainText('This affects 2 Posts');
    await expect(dialog).toContainText('Posts without another Category will use Uncategorized.');
    await expect(dialog).not.toContainText('2 Posts will move to Uncategorized');
    await page.keyboard.press('Escape');
    await expect(categoryRow(page, 'Research')).toBeVisible();
    await expect(deleteButton).toBeFocused();

    await page.route('**/api/categories', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Delete is temporarily unavailable.' }) });
    }, { times: 1 });
    await deleteButton.click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Delete is temporarily unavailable.');
    await expect(categoryRow(page, 'Research')).toBeVisible();
    await expect(deleteButton).toBeEnabled();

    let releaseDelete = () => {};
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await deleteGate;
      await route.continue();
    }, { times: 1 });
    await deleteButton.click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(categoryRow(page, 'Research')).toBeVisible();
    await expect(deleteButton).toBeDisabled();
    releaseDelete();
    await expect(categoryRow(page, 'Research')).toHaveCount(0);
    await expect(categoryRow(page, 'Uncategorized').getByText('1 Post', { exact: true })).toBeVisible();
    await expect(categoryRow(page, 'Secondary').getByText('1 Post', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('2 Posts were affected');
  } finally {
    await cleanupEditor(page, owner);
  }
});
