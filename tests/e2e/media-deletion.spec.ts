import { expect, test, type Page } from '@playwright/test';

import { createOwner, deleteOwner, signInAdmin, type TestOwner } from './support';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=',
  'base64',
);

async function createMedia(owner: TestOwner, name: string) {
  const storagePath = `${owner.id}/${crypto.randomUUID()}.png`;
  const { error: uploadError } = await owner.client.storage.from('blog-media').upload(storagePath, PNG_1X1, {
    contentType: 'image/png',
  });
  expect(uploadError).toBeNull();

  const { data, error } = await owner.client
    .from('media_items')
    .insert({
      height: 1,
      mime_type: 'image/png',
      original_name: name,
      owner_id: owner.id,
      size_bytes: PNG_1X1.length,
      storage_path: storagePath,
      width: 1,
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Media metadata was not created.');

  return {
    ...data,
    publicUrl: owner.client.storage.from('blog-media').getPublicUrl(storagePath).data.publicUrl,
  };
}

async function createPost(owner: TestOwner, title: string, coverImage: string | null, contentHtml = '<p></p>') {
  const { data, error } = await owner.client
    .from('posts')
    .insert({
      author_id: owner.id,
      content_html: contentHtml,
      content_json: { content: [], type: 'doc' },
      cover_image: coverImage,
      slug: `media-deletion-${crypto.randomUUID()}`,
      status: 'draft',
      title,
    })
    .select('id, title')
    .single();
  if (error || !data) throw error ?? new Error('Referenced post was not created.');
  return data;
}

async function deleteTestOwner(owner: TestOwner) {
  const { error } = await owner.client.from('posts').delete().eq('author_id', owner.id);
  expect(error).toBeNull();
  await deleteOwner(owner);
}

async function openMediaLibrary(page: Page, owner: TestOwner) {
  await signIn(page, owner);
  await page.goto('/admin/media');
}

async function signIn(page: Page, owner: TestOwner) {
  await signInAdmin(page, owner);
  await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
}

test.describe('media deletion', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Deletion behavior is covered in the desktop project.');
  });

  test('returns 401 when unauthenticated', async ({ request }) => {
    const response = await request.delete(`/api/media/${crypto.randomUUID()}`);

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required.' });
  });

  test('returns 404 for invalid and another owner media ids without deleting them', async ({ page }) => {
    const owner = await createOwner('media-delete-owner');
    const otherOwner = await createOwner('media-delete-other');

    try {
      const media = await createMedia(otherOwner, 'private.png');
      await signIn(page, owner);

      for (const id of ['not-a-uuid', crypto.randomUUID(), media.id]) {
        const response = await page.request.delete(`/api/media/${id}`);
        expect(response.status()).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Media not found.' });
      }

      const { data: metadata, error: metadataError } = await otherOwner.client
        .from('media_items')
        .select('id')
        .eq('id', media.id)
        .single();
      expect(metadataError).toBeNull();
      expect(metadata?.id).toBe(media.id);
      const { data: objects, error: storageError } = await otherOwner.client.storage.from('blog-media').list(otherOwner.id);
      expect(storageError).toBeNull();
      expect((objects ?? []).map((object) => object.name)).toContain(media.storage_path.split('/')[1]);
    } finally {
      await deleteTestOwner(owner);
      await deleteTestOwner(otherOwner);
    }
  });

  test('keeps a failed deletion selected and retryable, then removes unused metadata and object', async ({ page }) => {
    const owner = await createOwner('media-delete-unused');
    let deleteRequests = 0;
    let releaseDelete = () => {};
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });

    try {
      const media = await createMedia(owner, 'unused.png');
      await openMediaLibrary(page, owner);
      await page.route('**/api/media/*', async (route) => {
        deleteRequests += 1;
        if (deleteRequests === 1) {
          return route.fulfill({
            body: JSON.stringify({ error: 'The image could not be deleted.' }),
            contentType: 'application/json',
            status: 500,
          });
        }
        await deleteGate;
        return route.continue();
      });

      const card = page.getByRole('button', { name: /unused\.png/i });
      await card.click();
      const details = page.getByRole('dialog', { name: 'Image details' });
      page.once('dialog', (dialog) => dialog.accept());
      await details.getByRole('button', { name: 'Delete' }).click();

      await expect(details).toBeVisible();
      await expect(card).toBeVisible();
      await expect(details.getByRole('alert')).toContainText('The image could not be deleted.');
      await details.getByRole('button', { name: 'Retry' }).click();
      await expect(details.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
      releaseDelete();

      await expect(details).toHaveCount(0);
      await expect(card).toHaveCount(0);
      const { data: metadata, error: metadataError } = await owner.client
        .from('media_items')
        .select('id')
        .eq('id', media.id)
        .maybeSingle();
      expect(metadataError).toBeNull();
      expect(metadata).toBeNull();
      const { data: objects, error: storageError } = await owner.client.storage.from('blog-media').list(owner.id);
      expect(storageError).toBeNull();
      expect((objects ?? []).map((object) => object.name)).not.toContain(media.storage_path.split('/')[1]);
    } finally {
      releaseDelete();
      await deleteTestOwner(owner);
    }
  });

  test('returns post details for cover and content references and leaves media intact', async ({ page }) => {
    const owner = await createOwner('media-delete-referenced');

    try {
      const media = await createMedia(owner, 'referenced.png');
      const post = await createPost(owner, 'Referenced post', media.publicUrl);
      await signIn(page, owner);

      const coverResponse = await page.request.delete(`/api/media/${media.id}`);
      expect(coverResponse.status()).toBe(409);
      await expect(coverResponse.json()).resolves.toEqual({
        error: 'This image is used by 1 post.',
        posts: [{ id: post.id, title: 'Referenced post' }],
      });

      const { error: updateError } = await owner.client
        .from('posts')
        .update({ cover_image: null, content_html: `<p><img src="${media.publicUrl}" alt="Referenced" /></p>` })
        .eq('id', post.id);
      expect(updateError).toBeNull();

      await page.goto('/admin/media');
      await page.getByRole('button', { name: /referenced\.png/i }).click();
      const details = page.getByRole('dialog', { name: 'Image details' });
      page.once('dialog', (dialog) => dialog.accept());
      await details.getByRole('button', { name: 'Delete' }).click();

      await expect(details.getByRole('alert')).toContainText('This image is used by 1 post.');
      await expect(details.getByRole('link', { name: 'Referenced post' })).toHaveAttribute('href', `/admin/edit/${post.id}`);
      const { data: metadata, error: metadataError } = await owner.client
        .from('media_items')
        .select('id')
        .eq('id', media.id)
        .single();
      expect(metadataError).toBeNull();
      expect(metadata?.id).toBe(media.id);
      const { data: storedObjects, error: storageError } = await owner.client.storage.from('blog-media').list(owner.id);
      expect(storageError).toBeNull();
      expect((storedObjects ?? []).map((object) => object.name)).toContain(media.storage_path.split('/')[1]);
      const { data: storedPost, error: postError } = await owner.client
        .from('posts')
        .select('content_html')
        .eq('id', post.id)
        .single();
      expect(postError).toBeNull();
      expect(storedPost?.content_html).toContain(media.publicUrl);
    } finally {
      await deleteTestOwner(owner);
    }
  });
});
