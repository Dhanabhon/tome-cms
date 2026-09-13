import { expect, test, type Locator, type Page } from '@playwright/test';

import { createOwner, deleteOwner, signInAdmin, type TestOwner } from './support';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=',
  'base64',
);

async function confirmImageDeletion(page: Page, details: Locator) {
  await details.getByRole('button', { name: 'Delete' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete image?' });
  await expect(confirmation).toBeVisible();
  const deleteRequest = page.waitForRequest((request) => request.method() === 'DELETE' && new URL(request.url()).pathname.startsWith('/api/media/'));
  await confirmation.getByRole('button', { name: 'Delete image' }).click();
  expect(await (await deleteRequest).headerValue('content-type')).toBe('application/json');
}

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

type TestMedia = Awaited<ReturnType<typeof createMedia>>;

async function expectMediaPresent(owner: TestOwner, media: TestMedia) {
  const { data: metadata, error: metadataError } = await owner.client
    .from('media_items')
    .select('id, storage_path')
    .eq('id', media.id)
    .single();
  expect(metadataError).toBeNull();
  expect(metadata).toEqual({ id: media.id, storage_path: media.storage_path });

  const { data: objects, error: storageError } = await owner.client.storage.from('blog-media').list(owner.id);
  expect(storageError).toBeNull();
  expect((objects ?? []).map((object) => object.name)).toContain(media.storage_path.split('/')[1]);
}

async function createPost(owner: TestOwner, title: string, coverImage: string | null, contentHtml = '<p></p>') {
  const { data, error } = await owner.client
    .from('posts')
    .insert({
      author_id: owner.id,
      content_html: contentHtml,
      content_json: { content: [], type: 'doc' },
      cover_image: coverImage,
      locale: 'th',
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
  const { error: pagesError } = await owner.client.from('pages').delete().eq('author_id', owner.id);
  expect(pagesError).toBeNull();
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
    const owner = await createOwner('media-delete-unauthenticated');

    try {
      const media = await createMedia(owner, 'authenticated-only.png');
      const response = await request.delete(`/api/media/${media.id}`);

      expect(response.status()).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Authentication required.' });
      await expectMediaPresent(owner, media);
    } finally {
      await deleteTestOwner(owner);
    }
  });

  test('returns 404 for invalid, missing, and another owner media ids without deleting media', async ({ page }) => {
    const owner = await createOwner('media-delete-owner');
    const otherOwner = await createOwner('media-delete-other');

    try {
      const ownedMedia = await createMedia(owner, 'owned.png');
      const otherMedia = await createMedia(otherOwner, 'private.png');
      await signIn(page, owner);

      const invalidResponse = await page.request.delete('/api/media/not-a-uuid');
      expect(invalidResponse.status()).toBe(404);
      await expect(invalidResponse.json()).resolves.toEqual({ error: 'Media not found.' });
      await expectMediaPresent(owner, ownedMedia);

      const missingResponse = await page.request.delete(`/api/media/${crypto.randomUUID()}`);
      expect(missingResponse.status()).toBe(404);
      await expect(missingResponse.json()).resolves.toEqual({ error: 'Media not found.' });
      await expectMediaPresent(owner, ownedMedia);

      const notOwnedResponse = await page.request.delete(`/api/media/${otherMedia.id}`);
      expect(notOwnedResponse.status()).toBe(404);
      await expect(notOwnedResponse.json()).resolves.toEqual({ error: 'Media not found.' });
      await expectMediaPresent(otherOwner, otherMedia);
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
      await confirmImageDeletion(page, details);

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
      const { data: coverPost, error: coverPostError } = await owner.client
        .from('posts')
        .select('cover_image, content_html')
        .eq('id', post.id)
        .single();
      expect(coverPostError).toBeNull();
      expect(coverPost).toEqual({ cover_image: media.publicUrl, content_html: '<p></p>' });
      await expectMediaPresent(owner, media);

      const { error: updateError } = await owner.client
        .from('posts')
        .update({ cover_image: null, content_html: `<p><img src="${media.publicUrl}" alt="Referenced" /></p>` })
        .eq('id', post.id);
      expect(updateError).toBeNull();

      await page.goto('/admin/media');
      await page.getByRole('button', { name: /referenced\.png/i }).click();
      const details = page.getByRole('dialog', { name: 'Image details' });
      await confirmImageDeletion(page, details);

      await expect(details.getByRole('alert')).toContainText('This image is used by 1 post.');
      await expect(details.getByRole('link', { name: 'Referenced post' })).toHaveAttribute('href', `/admin/edit/${post.id}`);
      await expectMediaPresent(owner, media);
      const { data: storedPost, error: postError } = await owner.client
        .from('posts')
        .select('cover_image, content_html')
        .eq('id', post.id)
        .single();
      expect(postError).toBeNull();
      expect(storedPost?.cover_image).toBeNull();
      expect(storedPost?.content_html).toContain(media.publicUrl);
    } finally {
      await deleteTestOwner(owner);
    }
  });

  test('finds a media reference after the first 1000 owner posts and leaves media intact', async ({ page }) => {
    const owner = await createOwner('media-delete-paginated-reference');

    try {
      const media = await createMedia(owner, 'deep-reference.png');
      const referencedPostId = '00000000-0000-4000-8000-000000001000';
      const { error } = await owner.client.from('posts').insert(
        Array.from({ length: 1001 }, (_, index) => ({
          author_id: owner.id,
          content_html: '<p></p>',
          content_json: { content: [], type: 'doc' },
          cover_image: index === 1000 ? media.publicUrl : null,
          id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
          locale: 'th',
          slug: `deep-reference-${owner.id}-${index}`,
          status: 'draft',
          title: index === 1000 ? 'Reference after page one' : `Unreferenced ${index}`,
        })),
      );
      expect(error).toBeNull();
      await signIn(page, owner);

      const response = await page.request.delete(`/api/media/${media.id}`);

      expect(response.status()).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'This image is used by 1 post.',
        posts: [{ id: referencedPostId, title: 'Reference after page one' }],
      });
      await expectMediaPresent(owner, media);
    } finally {
      await deleteTestOwner(owner);
    }
  });

  for (const status of ['draft', 'published'] as const) {
    test(`protects ${status} Page content images and retries after the reference is removed`, async ({ page }) => {
      const owner = await createOwner(`media-delete-page-${status}`);
      try {
        const media = await createMedia(owner, `${status}-page.png`);
        await signIn(page, owner);
        // DocumentCanvas serializes the Media Picker's setImage({ src, alt }) as an image node.
        const created = await page.request.post('/api/admin/pages', { data: {
          title: `${status} image page`, slug: `media-page-${crypto.randomUUID()}`, status,
          contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: media.publicUrl, alt: 'Page image' } }] },
          contentHtml: `<img class="rounded-lg" src="${media.publicUrl}" alt="Page image">`,
        } });
        expect(created.status()).toBe(201);
        const saved = (await created.json()).page as { id: string; title: string; content_html: string };
        expect(saved.content_html).toContain(`src="${media.publicUrl}"`);

        const response = await page.request.delete(`/api/media/${media.id}`);
        expect(response.status()).toBe(409);
        expect(await response.json()).toEqual({
          error: 'This image is used by 1 page.', posts: [], pages: [{ id: saved.id, title: saved.title }],
        });
        await expectMediaPresent(owner, media);

        await page.goto('/admin/media');
        const card = page.getByRole('button', { name: new RegExp(`${status}-page\\.png`, 'i') });
        await card.click();
        const details = page.getByRole('dialog', { name: 'Image details' });
        await confirmImageDeletion(page, details);
        await expect(details.getByRole('alert')).toContainText('This image is used by 1 page.');
        await expect(details.getByRole('alert').getByRole('link')).toHaveCount(0);
        await details.getByRole('button', { name: 'Retry' }).click();
        await expect(details.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
        await expectMediaPresent(owner, media);

        const { error } = await owner.client.from('pages')
          .update({ content_html: '<p>Image removed.</p>', content_json: { type: 'doc', content: [{ type: 'paragraph' }] } })
          .eq('id', saved.id);
        expect(error).toBeNull();
        await details.getByRole('button', { name: 'Retry' }).click();
        await expect(details).toHaveCount(0);
        await expect(card).toHaveCount(0);
        const { data: metadata, error: metadataError } = await owner.client.from('media_items').select('id').eq('id', media.id).maybeSingle();
        expect(metadataError).toBeNull();
        expect(metadata).toBeNull();
        const { data: objects, error: storageError } = await owner.client.storage.from('blog-media').list(owner.id);
        expect(storageError).toBeNull();
        expect(objects?.map((object) => object.name)).not.toContain(media.storage_path.split('/')[1]);
      } finally {
        await deleteTestOwner(owner);
      }
    });
  }

  test('finds a media reference after the first 1000 owner Pages and leaves media intact', async ({ page }) => {
    const owner = await createOwner('media-delete-paginated-page');
    try {
      const media = await createMedia(owner, 'deep-page-reference.png');
      const idPrefix = crypto.randomUUID().slice(0, 24);
      const { error } = await owner.client.from('pages').insert(Array.from({ length: 1001 }, (_, index) => ({
        author_id: owner.id, locale: 'th', status: 'draft',
        id: `${idPrefix}${index.toString().padStart(12, '0')}`,
        title: index === 1000 ? 'Page after first batch' : `Unreferenced page ${index}`,
        slug: `deep-page-${owner.id}-${index}`,
        content_json: { type: 'doc', content: [] },
        content_html: index === 1000 ? `<img src="${media.publicUrl}" alt="Page image">` : '<p></p>',
      })));
      expect(error).toBeNull();
      await signIn(page, owner);
      const response = await page.request.delete(`/api/media/${media.id}`);
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({
        error: 'This image is used by 1 page.', posts: [],
        pages: [{ id: `${idPrefix}000000001000`, title: 'Page after first batch' }],
      });
      await expectMediaPresent(owner, media);
    } finally {
      await deleteTestOwner(owner);
    }
  });

  test('unrelated owner Pages and foreign draft or published Page references do not block deletion', async ({ page }) => {
    const owner = await createOwner('media-delete-page-scope');
    const foreign = await createOwner('media-delete-foreign-page');
    try {
      const media = await createMedia(owner, 'deletable-page-image.png');
      const otherMedia = await createMedia(owner, 'other-page-image.png');
      for (const [author, status, publicUrl] of [
        [owner, 'draft', otherMedia.publicUrl], [foreign, 'draft', media.publicUrl], [foreign, 'published', media.publicUrl],
      ] as const) {
        const { error } = await author.client.from('pages').insert({
          author_id: author.id, title: `${status} private page`, slug: `scope-${crypto.randomUUID()}`,
          locale: 'th', status, content_json: { type: 'doc', content: [] },
          content_html: `<img src="${publicUrl}" alt="Page image">`,
        });
        expect(error).toBeNull();
      }
      await signIn(page, owner);
      const response = await page.request.delete(`/api/media/${media.id}`);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ deleted: true });
      const { data: metadata, error } = await owner.client.from('media_items').select('id').eq('id', media.id).maybeSingle();
      expect(error).toBeNull();
      expect(metadata).toBeNull();
      const { data: objects, error: storageError } = await owner.client.storage.from('blog-media').list(owner.id);
      expect(storageError).toBeNull();
      expect(objects?.map((object) => object.name)).not.toContain(media.storage_path.split('/')[1]);
      await expectMediaPresent(owner, otherMedia);
    } finally {
      await deleteTestOwner(owner);
      await deleteTestOwner(foreign);
    }
  });

  test('keeps a newly selected image isolated from earlier deletion completions', async ({ page }) => {
    const owner = await createOwner('media-delete-selection-race');
    let releaseSuccess = () => {};
    let releaseConflict = () => {};
    let releaseFailure = () => {};
    const successGate = new Promise<void>((resolve) => {
      releaseSuccess = resolve;
    });
    const conflictGate = new Promise<void>((resolve) => {
      releaseConflict = resolve;
    });
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });

    try {
      const first = await createMedia(owner, 'first.png');
      const second = await createMedia(owner, 'second.png');
      const third = await createMedia(owner, 'third.png');
      const fourth = await createMedia(owner, 'fourth.png');
      await openMediaLibrary(page, owner);
      await page.route('**/api/media/*', async (route) => {
        if (route.request().url().endsWith(first.id)) {
          await successGate;
          return route.continue();
        }
        if (route.request().url().endsWith(second.id)) {
          await conflictGate;
          return route.fulfill({
            body: JSON.stringify({
              error: 'This image is used by 1 post.',
              posts: [{ id: crypto.randomUUID(), title: 'Stale post' }],
            }),
            contentType: 'application/json',
            status: 409,
          });
        }
        if (route.request().url().endsWith(third.id)) {
          await failureGate;
          return route.fulfill({
            body: JSON.stringify({ error: 'The image could not be deleted.' }),
            contentType: 'application/json',
            status: 500,
          });
        }
        return route.continue();
      });

      const details = page.getByRole('dialog', { name: 'Image details' });
      await page.getByRole('button', { name: /first\.png/i }).click();
      await confirmImageDeletion(page, details);
      await expect(details.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
      await details.getByRole('button', { name: 'Close details' }).click();
      await page.getByRole('button', { name: /second\.png/i }).click();
      releaseSuccess();

      await expect(page.getByRole('button', { name: /first\.png/i })).toHaveCount(0);
      await expect(details).toBeVisible();
      await expect(details.getByLabel('Image URL')).toHaveValue(second.publicUrl);
      await expect(details.getByRole('alert')).toHaveCount(0);
      await expectMediaPresent(owner, second);

      await confirmImageDeletion(page, details);
      await expect(details.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
      await details.getByRole('button', { name: 'Close details' }).click();
      await page.getByRole('button', { name: /third\.png/i }).click();
      releaseConflict();

      await expect(details.getByRole('button', { name: 'Delete' })).toBeEnabled();
      await expect(details).toBeVisible();
      await expect(details.getByLabel('Image URL')).toHaveValue(third.publicUrl);
      await expect(details.getByRole('alert')).toHaveCount(0);
      await expectMediaPresent(owner, second);
      await expectMediaPresent(owner, third);

      await confirmImageDeletion(page, details);
      await expect(details.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
      await details.getByRole('button', { name: 'Close details' }).click();
      await page.getByRole('button', { name: /fourth\.png/i }).click();
      releaseFailure();

      await expect(details.getByRole('button', { name: 'Delete' })).toBeEnabled();
      await expect(details.getByLabel('Image URL')).toHaveValue(fourth.publicUrl);
      await expect(details.getByRole('alert')).toHaveCount(0);
      await expectMediaPresent(owner, third);
      await expectMediaPresent(owner, fourth);
    } finally {
      releaseSuccess();
      releaseConflict();
      releaseFailure();
      await deleteTestOwner(owner);
    }
  });
});
