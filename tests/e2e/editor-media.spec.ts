import { expect, test } from '@playwright/test';

import { createOwner, deleteOwner, signInAdmin, type TestOwner } from './support';

const PIXEL = {
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=',
    'base64',
  ),
  mimeType: 'image/png',
  name: 'cover-pixel.png',
};

async function seedMedia(owner: TestOwner) {
  const storagePath = `${owner.id}/${crypto.randomUUID()}.png`;
  const { error: uploadError } = await owner.client.storage.from('blog-media').upload(storagePath, PIXEL.buffer, {
    contentType: PIXEL.mimeType,
  });
  expect(uploadError).toBeNull();

  const { data, error } = await owner.client
    .from('media_items')
    .insert({
      height: 900,
      mime_type: PIXEL.mimeType,
      original_name: 'seeded-cover.png',
      owner_id: owner.id,
      size_bytes: PIXEL.buffer.length,
      storage_path: storagePath,
      width: 1600,
    })
    .select('*')
    .single();
  expect(error).toBeNull();

  return {
    ...data,
    publicUrl: owner.client.storage.from('blog-media').getPublicUrl(storagePath).data.publicUrl,
  };
}

test.describe('editor cover media', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Cover uploads are covered in the desktop project.');
  });

  test('cover can be selected from the media library and persists as its public URL', async ({ page }) => {
    const owner = await createOwner('editor-cover-library');
    const title = `Library cover ${crypto.randomUUID()}`;

    try {
      const asset = await seedMedia(owner);
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');
      await page.getByLabel('Post title').fill(title);

      await page.getByRole('button', { name: 'Choose from library' }).click();
      const picker = page.getByRole('dialog', { name: 'Media library' });
      await expect(picker).toBeVisible();
      await expect(picker.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await expect(picker.getByRole('button', { name: 'Create category' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Choose from library' })).toBeFocused();

      await page.getByRole('button', { name: 'Choose from library' }).click();
      await picker.getByRole('button', { name: /Select seeded-cover\.png/i }).click();

      await expect(picker).toHaveCount(0);
      await expect(page.getByAltText('Current cover')).toHaveAttribute('src', asset.publicUrl);
      await expect(page.locator('input[name="coverImage"]')).toHaveValue(asset.publicUrl);

      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const { data, error } = await owner.client
            .from('posts')
            .select('cover_image')
            .eq('title', title)
            .single();
          if (error) throw error;
          return data.cover_image;
        })
        .toBe(asset.publicUrl);
    } finally {
      await owner.client.from('posts').delete().eq('author_id', owner.id);
      await deleteOwner(owner);
    }
  });

  test('cover upload warns about low resolution without blocking save', async ({ page }) => {
    const owner = await createOwner('editor-cover-upload');

    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');

      await page.getByLabel('Upload new').setInputFiles(PIXEL);

      await expect(page.getByAltText('Current cover')).toHaveAttribute('src', /\/storage\/v1\/object\/public\/blog-media\//);
      await expect(page.getByText(/Recommended: 1600 × 900 px \(16:9\)\. Minimum: 1200 × 675 px\./)).toBeVisible();
      await expect(page.getByText(/Best: WebP or JPEG; PNG and AVIF are also supported\. GIF is accepted but discouraged/)).toBeVisible();
      await expect(page.getByText(/Aim for 2 MB or less; 8 MB maximum\./)).toBeVisible();
      await expect(page.getByText('This image is below the recommended minimum of 1200 × 675 px.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    } finally {
      await deleteOwner(owner);
    }
  });

  test('cover upload failure preserves unsaved editor fields', async ({ page }) => {
    const owner = await createOwner('editor-cover-failure');

    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');
      await page.getByLabel('Post title').fill('Keep this unsaved title');
      await page.getByLabel('Meta title').fill('Keep this unsaved meta title');
      await page.route('**/storage/v1/object/blog-media/**', (route) => route.fulfill({
        body: JSON.stringify({ message: 'Forced cover upload failure' }),
        contentType: 'application/json',
        status: 500,
      }));

      const upload = page.getByLabel('Upload new');
      await upload.setInputFiles(PIXEL);

      await expect(page.getByRole('alert')).toContainText('Forced cover upload failure');
      await expect(page.getByLabel('Post title')).toHaveValue('Keep this unsaved title');
      await expect(page.getByLabel('Meta title')).toHaveValue('Keep this unsaved meta title');
      await expect(upload).toHaveValue('');
    } finally {
      await deleteOwner(owner);
    }
  });

  test('existing cover URLs render and can be removed without asset metadata', async ({ page }) => {
    const owner = await createOwner('editor-cover-existing');
    const coverUrl = 'https://example.com/existing-cover.jpg';
    const { data: post, error } = await owner.client
      .from('posts')
      .insert({
        author_id: owner.id,
        content_html: '<p></p>',
        content_json: { type: 'doc', content: [{ type: 'paragraph' }] },
        cover_image: coverUrl,
        slug: `existing-cover-${crypto.randomUUID()}`,
        status: 'draft',
        title: 'Existing cover',
      })
      .select('id')
      .single();
    if (error || !post) throw error ?? new Error('Existing-cover post was not created.');

    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto(`/admin/edit/${post.id}`);

      await expect(page.getByAltText('Current cover')).toHaveAttribute('src', coverUrl);
      await expect(page.getByText(/below the recommended minimum/)).toHaveCount(0);
      await page.getByRole('button', { name: 'Remove' }).click();
      await expect(page.getByAltText('Current cover')).toHaveCount(0);
      await expect(page.locator('input[name="coverImage"]')).toHaveValue('');

      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect
        .poll(async () => {
          const { data, error: queryError } = await owner.client.from('posts').select('cover_image').eq('id', post.id).single();
          if (queryError) throw queryError;
          return data.cover_image;
        })
        .toBeNull();
    } finally {
      await owner.client.from('posts').delete().eq('id', post.id);
      await deleteOwner(owner);
    }
  });
});

test('cover media picker fills the mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile picker layout is covered in the mobile project.');
  const owner = await createOwner('editor-cover-mobile');

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin/new');

    const opener = page.getByRole('button', { name: 'Choose from library' });
    await opener.click();
    const picker = page.getByRole('dialog', { name: 'Media library' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Cancel' })).toBeFocused();
    expect(await picker.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      return Math.abs(bounds.width - window.innerWidth) < 1 && Math.abs(bounds.height - window.innerHeight) < 1;
    })).toBe(true);

    await picker.getByRole('button', { name: 'Cancel' }).click();
    await expect(picker).toHaveCount(0);
    await expect(opener).toBeFocused();
  } finally {
    await deleteOwner(owner);
  }
});
