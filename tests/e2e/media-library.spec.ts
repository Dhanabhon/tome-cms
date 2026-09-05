import { expect, test, type Page } from '@playwright/test';

import { createOwner, deleteOwner, signInAdmin, type TestOwner } from './support';

const IMAGE_FIXTURES = [
  {
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=',
      'base64',
    ),
    dimensions: '1 × 1',
    mimeType: 'image/png',
    name: 'pixel.png',
  },
  {
    buffer: Buffer.from(
      '/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAxAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAGAQEBAAAAAAAAAAAAAAAAAAAGBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAIAAgMBIgACEQADEQD/2gAMAwEAAhEDEQA/AIsATX9//9k=',
      'base64',
    ),
    dimensions: '2 × 2',
    mimeType: 'image/jpeg',
    name: 'pixel.jpg',
  },
  {
    buffer: Buffer.from(
      'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAgA0JaACdLoB+AADsAD+8Oj3/yC5YXXI1/8gP+MqfGVP+PIAAAA=',
      'base64',
    ),
    dimensions: '2 × 2',
    mimeType: 'image/webp',
    name: 'pixel.webp',
  },
  {
    buffer: Buffer.from(
      'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACgAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAwbWRhdBIACggYADaICGg0IDIaGUeHhiGHnnnmgAAAkEDJHGFLi9GPUUVOpCA=',
      'base64',
    ),
    dimensions: '2 × 2',
    mimeType: 'image/avif',
    name: 'pixel.avif',
  },
  {
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
    dimensions: '1 × 1',
    mimeType: 'image/gif',
    name: 'pixel.gif',
  },
] as const;

async function openMediaLibrary(page: Page, owner: TestOwner) {
  await signInAndWait(page, owner);
  await page.goto('/admin/media');
}

async function signInAndWait(page: Page, owner: TestOwner) {
  await signInAdmin(page, owner);
  await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
}

test.describe('media library desktop', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Upload behavior is covered in the desktop project.');
  });

  test('redirects unauthenticated visitors to admin sign in', async ({ page }) => {
    await page.goto('/admin/media');
    await expect(page).toHaveURL(/\/admin\/?$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('uploads supported images and rejects invalid files before creating a card', async ({ page }) => {
    const owner = await createOwner('media-library-upload');

    try {
      await openMediaLibrary(page, owner);
      await expect(page.getByText('No media yet')).toBeVisible();
      let storageUploads = 0;
      await page.route('**/storage/v1/object/blog-media/**', async (route) => {
        if (route.request().method() === 'POST' && storageUploads++ === 0) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return route.continue();
      });

      for (const [index, fixture] of IMAGE_FIXTURES.entries()) {
        await page.getByLabel('Upload image').setInputFiles(fixture);
        if (index === 0) await expect(page.getByText('Uploading image…')).toBeVisible();
        const card = page.getByRole('button', { name: new RegExp(fixture.name, 'i') });
        await expect(card).toBeVisible();
        await expect(card).toHaveCount(1);
        await expect(card).toContainText(fixture.dimensions);
        await expect(card).toContainText(fixture.mimeType.replace('image/', '').toUpperCase());
        await expect(card).toContainText(/\d+(?:\.\d+)? (?:B|KB)/);
      }

      await page.getByLabel('Search media').fill('pixel.webp');
      await expect(page.getByRole('button', { name: /pixel\.webp/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toHaveCount(0);

      await page.getByLabel('Search media').fill('');
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();

      const rejected = [
        {
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          error: 'Use a JPEG, PNG, WebP, GIF, or AVIF image.',
          mimeType: 'image/svg+xml',
          name: 'vector.svg',
        },
        { buffer: Buffer.alloc(0), error: 'Images must be at least 1 byte.', mimeType: 'image/png', name: 'empty.png' },
        {
          buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
          error: 'Images must be 8 MB or smaller.',
          mimeType: 'image/png',
          name: 'oversized.png',
        },
        {
          buffer: Buffer.from('not an image'),
          error: 'This image cannot be decoded. Choose a valid image file.',
          mimeType: 'image/png',
          name: 'broken.png',
        },
      ];

      for (const fixture of rejected) {
        await page.getByLabel('Upload image').setInputFiles(fixture);
        await expect(page.getByRole('alert')).toContainText(fixture.error);
        await expect(page.getByRole('button', { name: new RegExp(fixture.name, 'i') })).toHaveCount(0);
      }

      const { data: storedObjects, error: storageError } = await owner.client.storage.from('blog-media').list(owner.id);
      expect(storageError).toBeNull();
      expect(storedObjects).toHaveLength(IMAGE_FIXTURES.length);
    } finally {
      await deleteOwner(owner);
    }
  });

  test('shows loading, error, retry, and empty states', async ({ page }) => {
    const owner = await createOwner('media-library-states');
    let listRequests = 0;

    try {
      await signInAndWait(page, owner);
      await page.route('**/rest/v1/media_items*', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        listRequests += 1;
        if (listRequests === 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return route.fulfill({
            body: JSON.stringify({ message: 'Forced list failure' }),
            contentType: 'application/json',
            status: 500,
          });
        }
        return route.continue();
      });

      await page.goto('/admin/media');
      await expect(page.getByText('Loading media…')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('Forced list failure');
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByText('No media yet')).toBeVisible();
    } finally {
      await deleteOwner(owner);
    }
  });

  test('removes the uploaded object when metadata creation fails', async ({ page }) => {
    const owner = await createOwner('media-library-compensation');

    try {
      await openMediaLibrary(page, owner);
      await page.route('**/rest/v1/media_items*', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({
          body: JSON.stringify({ code: 'TEST_FAILURE', message: 'Forced metadata insert failure' }),
          contentType: 'application/json',
          status: 500,
        });
      });

      await page.getByLabel('Upload image').setInputFiles(IMAGE_FIXTURES[0]);
      await expect(page.getByRole('alert')).toContainText('Forced metadata insert failure');
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toHaveCount(0);
      await expect
        .poll(async () => {
          const { data, error } = await owner.client.storage.from('blog-media').list(owner.id);
          if (error) throw error;
          return data.length;
        })
        .toBe(0);
    } finally {
      await deleteOwner(owner);
    }
  });
});

test('media library has no mobile horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Responsive behavior is covered in the mobile project.');
  const owner = await createOwner('media-library-mobile');

  try {
    await openMediaLibrary(page, owner);
    await expect(page.getByText('No media yet')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth)).toBe(true);
  } finally {
    await deleteOwner(owner);
  }
});
