import { expect, test, type Page } from '@playwright/test';

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
      alt_text: 'Seeded illustration',
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

async function blockControlBounds(page: Page) {
  const [canvas, editor, menu, trigger] = await Promise.all([
    page.locator('.editor-canvas').boundingBox(),
    page.locator('.ProseMirror').boundingBox(),
    page.getByRole('menu', { name: 'Insert block' }).boundingBox(),
    page.getByRole('button', { name: 'Add block' }).boundingBox(),
  ]);
  const viewport = page.viewportSize();
  if (!canvas || !editor || !menu || !trigger || !viewport) throw new Error('Block controls are not measurable.');
  return { canvas, editor, menu, trigger, viewport };
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

      await page.getByRole('button', { name: 'Settings', exact: true }).click();
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

      await page.getByRole('button', { name: 'Close settings' }).click();
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
    const title = `Low resolution cover ${crypto.randomUUID()}`;

    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');

      await page.getByLabel('Post title').fill(title);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Upload new').setInputFiles(PIXEL);

      await expect(page.getByAltText('Current cover')).toHaveAttribute('src', /\/storage\/v1\/object\/public\/blog-media\//);
      await expect(page.getByText(/Recommended: 1600 × 900 px \(16:9\)\. Minimum: 1200 × 675 px\./)).toBeVisible();
      await expect(page.getByText(/Best: WebP or JPEG; PNG and AVIF are also supported\. GIF is accepted but discouraged/)).toBeVisible();
      await expect(page.getByText(/Aim for 2 MB or less; 8 MB maximum\./)).toBeVisible();
      await expect(page.getByText('This image is below the recommended minimum of 1200 × 675 px.')).toBeVisible();
      await page.getByRole('button', { name: 'Close settings' }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await expect.poll(async () => {
        const { data } = await owner.client.from('posts').select('cover_image').eq('title', title).single();
        return data?.cover_image;
      }).toMatch(/\/storage\/v1\/object\/public\/blog-media\//);
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
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
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

  test('a later library choice wins over a delayed direct cover upload', async ({ page }) => {
    const owner = await createOwner('editor-cover-upload-race');
    let releaseUpload = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    try {
      const asset = await seedMedia(owner);
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.route('**/storage/v1/object/blog-media/**', async (route) => {
        if (route.request().method() === 'POST') await uploadGate;
        return route.continue();
      });

      await page.getByLabel('Upload new').setInputFiles(PIXEL);
      await expect(page.getByText('Uploading…')).toBeVisible();
      await page.getByRole('button', { name: 'Choose from library' }).click();
      await page.getByRole('dialog', { name: 'Media library' }).getByRole('button', { name: /Select seeded-cover\.png/i }).click();
      releaseUpload();

      await expect(page.getByText('Uploading…')).toHaveCount(0);
      await expect(page.getByAltText('Current cover')).toHaveAttribute('src', asset.publicUrl);
      await expect(page.locator('input[name="coverImage"]')).toHaveValue(asset.publicUrl);
    } finally {
      releaseUpload();
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
        locale: 'th',
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

      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByAltText('Current cover')).toHaveAttribute('src', coverUrl);
      await expect(page.getByText(/below the recommended minimum/)).toHaveCount(0);
      await page.getByRole('button', { name: 'Remove' }).click();
      await expect(page.getByAltText('Current cover')).toHaveCount(0);
      await expect(page.locator('input[name="coverImage"]')).toHaveValue('');

      await page.getByRole('button', { name: 'Close settings' }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
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

test.describe('editor block insertion', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Block insertion interactions are covered in the desktop project.');
  });

  test('active block menu changes the block and inserts library media at the saved cursor', async ({ page }) => {
    const owner = await createOwner('editor-block-insertion');

    try {
      const asset = await seedMedia(owner);
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');

      const editor = page.locator('.ProseMirror');
      const addBlock = page.getByRole('button', { name: 'Add block' });
      await editor.click();
      await expect(addBlock).toBeVisible();

      await addBlock.click();
      const blockMenu = page.getByRole('menu', { name: 'Insert block' });
      await expect(blockMenu).toBeVisible();
      await expect(blockMenu.getByRole('menuitem')).toHaveCount(8);
      await expect(blockMenu.getByRole('menuitem', { name: 'Text' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(editor.locator('h2')).toHaveCount(1);

      await editor.locator('h2').click();
      await addBlock.click();
      await blockMenu.getByRole('menuitem', { name: 'Image' }).click();
      const picker = page.getByRole('dialog', { name: 'Media library' });
      await expect(picker).toBeVisible();
      await picker.getByRole('button', { name: /Select seeded-cover\.png/i }).click();

      const insertedImage = editor.locator('img');
      await expect(insertedImage).toHaveCount(1);
      await expect(insertedImage).toHaveAttribute('src', asset.publicUrl);
      await expect(insertedImage).toHaveAttribute('alt', 'Seeded illustration');

      await editor.click();
      await addBlock.click();
      await page.keyboard.press('Escape');
      await expect(blockMenu).toHaveCount(0);
      await expect(editor).toBeFocused();

      await addBlock.click();
      await blockMenu.getByRole('menuitem', { name: 'Image' }).click();
      await expect(picker).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);
      await expect(editor).toBeFocused();
    } finally {
      await deleteOwner(owner);
    }
  });

  test('slash commands and the formatting bubble remain available', async ({ page }) => {
    const owner = await createOwner('editor-tools-regression');

    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');

      const editor = page.locator('.ProseMirror');
      await expect(page.getByRole('button', { name: 'Add block' })).toHaveCount(0);
      await editor.click();
      await page.keyboard.type('/');
      await expect(page.getByText('Large section heading')).toBeVisible();

      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('Format me');
      await editor.locator('p').selectText();
      await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add block' })).toHaveCount(0);
    } finally {
      await deleteOwner(owner);
    }
  });

  test('failed inline upload leaves editor content unchanged', async ({ page }) => {
    const owner = await createOwner('editor-inline-upload-failure');

    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');

      const editor = page.locator('.ProseMirror');
      await editor.click();
      await page.keyboard.type('Keep this content');
      const originalContent = await editor.innerHTML();
      await page.getByRole('button', { name: 'Add block' }).click();
      await page.getByRole('menuitem', { name: 'Image' }).click();
      const picker = page.getByRole('dialog', { name: 'Media library' });
      await expect(picker).toBeVisible();
      await page.route('**/storage/v1/object/blog-media/**', (route) => route.fulfill({
        body: JSON.stringify({ message: 'Forced inline upload failure' }),
        contentType: 'application/json',
        status: 500,
      }));

      await picker.getByLabel('Upload image').setInputFiles(PIXEL);

      await expect(picker.getByRole('alert')).toContainText('Forced inline upload failure');
      await expect(editor).toHaveJSProperty('innerHTML', originalContent);
    } finally {
      await deleteOwner(owner);
    }
  });

  test('a picker selection wins over a delayed picker upload', async ({ page }) => {
    const owner = await createOwner('editor-picker-upload-race');
    let releaseUpload = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    try {
      const asset = await seedMedia(owner);
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');
      const editor = page.locator('.ProseMirror');
      await editor.click();
      await page.getByRole('button', { name: 'Add block' }).click();
      await page.getByRole('menuitem', { name: 'Image' }).click();
      const picker = page.getByRole('dialog', { name: 'Media library' });
      await page.route('**/storage/v1/object/blog-media/**', async (route) => {
        if (route.request().method() === 'POST') await uploadGate;
        return route.continue();
      });

      await picker.getByLabel('Upload image').setInputFiles(PIXEL);
      await expect(picker.getByText('Uploading image…')).toBeVisible();
      await picker.getByRole('button', { name: /Select seeded-cover\.png/i }).click();
      releaseUpload();

      await expect(picker).toHaveCount(0);
      await expect.poll(async () => {
        const { count, error } = await owner.client.from('media_items').select('*', { count: 'exact', head: true });
        if (error) throw error;
        return count;
      }).toBe(2);
      await expect(editor.locator('img')).toHaveCount(1);
      await expect(editor.locator('img')).toHaveAttribute('src', asset.publicUrl);
    } finally {
      releaseUpload();
      await deleteOwner(owner);
    }
  });

  test('block tool stays in the gutter for the active line and keeps its menu in bounds', async ({ page }) => {
    const owner = await createOwner('editor-block-bounds');

    try {
      await signInAdmin(page, owner);
      await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
      await page.goto('/admin/new');

      const editor = page.locator('.ProseMirror');
      const addBlock = page.getByRole('button', { name: 'Add block' });
      await editor.click();
      await page.keyboard.type('i'.repeat(144));
      await addBlock.click();

      let bounds = await blockControlBounds(page);
      expect(bounds.trigger.x).toBeGreaterThanOrEqual(bounds.canvas.x - 1);
      expect(bounds.trigger.x + bounds.trigger.width).toBeLessThanOrEqual(bounds.editor.x + 1);
      expect(bounds.menu.x).toBeGreaterThanOrEqual(bounds.canvas.x - 1);
      expect(bounds.menu.x + bounds.menu.width).toBeLessThanOrEqual(bounds.canvas.x + bounds.canvas.width + 1);

      await page.keyboard.press('Escape');
      for (let index = 0; index < 18; index += 1) {
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(`Block ${index + 1}`);
      }
      const finalBlock = editor.locator('p').last();
      await finalBlock.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        window.scrollBy(0, rect.bottom - window.innerHeight + 40);
      });
      await finalBlock.click({ position: { x: 4, y: 4 } });
      await addBlock.click();

      bounds = await blockControlBounds(page);
      const finalBlockBounds = await finalBlock.boundingBox();
      if (!finalBlockBounds) throw new Error('Focused block is not measurable.');
      expect(bounds.trigger.y).toBeGreaterThan(bounds.viewport.height / 2);
      expect(bounds.trigger.y).toBeGreaterThanOrEqual(finalBlockBounds.y - 1);
      expect(bounds.trigger.y).toBeLessThanOrEqual(finalBlockBounds.y + finalBlockBounds.height + 1);
      expect(bounds.menu.y).toBeGreaterThanOrEqual(8);
      expect(bounds.menu.y + bounds.menu.height).toBeLessThanOrEqual(bounds.viewport.height - 8);
      expect(bounds.menu.y + bounds.menu.height).toBeLessThanOrEqual(bounds.trigger.y + 1);
    } finally {
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

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
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

test('active block menu does not create mobile horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile overflow is covered in the mobile project.');
  const owner = await createOwner('editor-block-mobile');

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    await page.goto('/admin/new');

    await page.locator('.ProseMirror').click();
    await page.getByRole('button', { name: 'Add block' }).click();
    await expect(page.getByRole('menu', { name: 'Insert block' })).toBeVisible();
    const bounds = await blockControlBounds(page);
    expect(bounds.trigger.x).toBeGreaterThanOrEqual(bounds.canvas.x - 1);
    expect(bounds.trigger.x + bounds.trigger.width).toBeLessThanOrEqual(bounds.editor.x + 1);
    expect(bounds.menu.x).toBeGreaterThanOrEqual(bounds.canvas.x - 1);
    expect(bounds.menu.x + bounds.menu.width).toBeLessThanOrEqual(bounds.canvas.x + bounds.canvas.width + 1);
    expect(bounds.menu.y).toBeGreaterThanOrEqual(0);
    expect(bounds.menu.y + bounds.menu.height).toBeLessThanOrEqual(bounds.viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await deleteOwner(owner);
  }
});
