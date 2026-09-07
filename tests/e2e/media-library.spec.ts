import { expect, test, type Page } from '@playwright/test';

import { chooseUiOption, createOwner, deleteOwner, signInAdmin, type TestOwner } from './support';

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

async function seedMediaItems(owner: TestOwner, count: number, prefix: string, dimensions = { height: 1, width: 1 }) {
  const { error } = await owner.client.from('media_items').insert(
    Array.from({ length: count }, (_, index) => ({
      created_at: new Date(Date.UTC(2026, 8, 5, 0, 0, count - index)).toISOString(),
      height: dimensions.height,
      mime_type: 'image/png',
      original_name: `${prefix}-${String(index + 1).padStart(2, '0')}.png`,
      owner_id: owner.id,
      size_bytes: 68,
      storage_path: `${owner.id}/${crypto.randomUUID()}.png`,
      width: dimensions.width,
    })),
  );
  expect(error).toBeNull();
}

test.describe('media library desktop', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Upload behavior is covered in the desktop project.');
  });

  test('redirects unauthenticated visitors to admin sign in', async ({ page }) => {
    await page.goto('/admin/media');
    await expect(page).toHaveURL(/\/admin\?returnTo=%2Fadmin%2Fmedia$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('presents a dedicated owner sign-in page with password visibility control', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Welcome back', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Write, preview, publish.', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'TomeCMS home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View site' })).toBeVisible();

    const password = page.getByLabel('Password');
    await password.fill('owner-password');
    await page.getByRole('button', { name: 'Show characters' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide characters' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Hide characters' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('keeps the sign-in page inside supported viewport widths', async ({ page }) => {
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect((await page.getByRole('button', { name: 'Sign in' }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(await page.getByRole('link', { name: 'View site' }).evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
      const formTop = (await page.getByRole('heading', { name: 'Welcome back' }).boundingBox())?.y ?? 0;
      const contextTop = (await page.getByRole('heading', { name: 'Write, preview, publish.' }).boundingBox())?.y ?? 0;
      expect(formTop).toBeLessThan(contextTop);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin');
    const submitBox = await page.getByRole('button', { name: 'Sign in' }).boundingBox();
    expect((submitBox?.y ?? 800) + (submitBox?.height ?? 0)).toBeLessThanOrEqual(800);
  });

  test('renders field validation in the form instead of a native browser popup', async ({ page }) => {
    await page.goto('/admin');
    const email = page.getByLabel('Email address');
    const password = page.getByLabel('Password');
    const passwordTop = (await password.boundingBox())?.y;
    await email.fill('ddd');
    await password.fill('not-the-owner-password');
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    expect((await password.boundingBox())?.y).toBe(passwordTop);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toBeFocused();
    await expect(email.evaluate((input) => getComputedStyle(input).outlineColor)).resolves.toBe(
      await email.evaluate((input) => getComputedStyle(input).borderColor),
    );

    await email.fill('owner@example.com');
    await expect(page.getByText('Enter a valid email address.')).toHaveCount(0);
    await expect(email).not.toHaveAttribute('aria-invalid', 'true');

    await password.fill('');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
  });

  test('explains rejected credentials without exposing which field is wrong', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Email address').fill('missing@example.com');
    await page.getByLabel('Password').fill('not-the-owner-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect. Check both fields and try again.');
    await expect(page.getByLabel('Password')).toBeFocused();
  });

  test('shows an in-flight state while owner credentials are checked', async ({ page }) => {
    let releaseRequest = () => {};
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await page.route('**/auth/v1/token**', async (route) => {
      await requestGate;
      await route.abort();
    });
    await page.goto('/admin');
    await page.getByLabel('Email address').fill('owner@example.com');
    await page.getByLabel('Password').fill('owner-password');
    const submit = page.locator('[data-auth-form] button[type="submit"]');
    const authRequest = page.waitForRequest((request) => request.url().includes('/auth/v1/token'));
    await submit.click();
    await authRequest;

    try {
      await expect(submit).toBeDisabled();
      await expect(submit).toHaveText('Signing in…');
      await expect(page.locator('[data-auth-form]')).toHaveAttribute('aria-busy', 'true');
    } finally {
      releaseRequest();
    }

    await expect(page.getByRole('alert')).toHaveText('We could not sign you in. Check your connection and try again.');
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText('Sign in');
  });

  test('retires the legacy upload endpoint without creating orphaned media', async ({ request }) => {
    const response = await request.post('/api/upload');

    expect(response.status()).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: 'This upload endpoint has been retired. Use the authenticated File Library.',
    });
  });

  test('uploads supported images and rejects invalid files before creating a card', async ({ page }) => {
    const owner = await createOwner('media-library-upload');

    try {
      await openMediaLibrary(page, owner);
      await expect(page.getByRole('heading', { name: 'File Library', exact: true })).not.toBeFocused();
      await expect(page.getByText('No files yet')).toBeVisible();
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

      await page.getByLabel('Search files').fill('pixel.webp');
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /pixel\.webp/i })).toBeVisible();

      await page.getByLabel('Search files').fill('');
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

  test('organizes media categories and persists metadata actions', async ({ page }) => {
    const owner = await createOwner('media-library-categories');

    try {
      await openMediaLibrary(page, owner);

      await page.getByLabel('Category name').fill('Headers');
      await page.getByRole('button', { name: 'Create category' }).click();
      await expect(page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Headers', exact: true })).toBeVisible();

      await page.getByLabel('Category name').fill('Headers');
      await page.getByRole('button', { name: 'Create category' }).click();
      await expect(page.getByRole('alert')).toContainText('A category with this name already exists.');
      await expect(page.getByLabel('Category name')).toHaveValue('Headers');

      await page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Headers', exact: true }).click();
      await page.getByLabel('Upload image').setInputFiles(IMAGE_FIXTURES[0]);
      const card = page.getByRole('button', { name: /pixel\.png/i });
      await expect(card).toBeVisible();

      await page.getByRole('button', { name: 'Rename Headers' }).click();
      const rename = page.getByRole('textbox', { name: 'Rename Headers' });
      await rename.fill('Covers');
      await page.getByRole('button', { name: 'Save category name' }).click();
      await expect(page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Covers', exact: true })).toBeVisible();

      await card.click();
      const details = page.getByRole('dialog', { name: 'Image details' });
      await expect(details).toBeVisible();
      await expect(details.getByRole('button', { name: 'Close details' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(details).toHaveCount(0);
      await expect(card).toBeFocused();
      await card.click();
      await details.getByLabel('Alt text').fill('A tiny test image');
      await details.getByRole('button', { name: 'Save' }).click();
      await expect(details.getByRole('status')).toContainText('Saved.');
      await page.reload();
      await page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Covers', exact: true }).click();
      await page.getByRole('button', { name: /pixel\.png/i }).click();
      await expect(page.getByRole('dialog', { name: 'Image details' }).getByLabel('Alt text')).toHaveValue('A tiny test image');

      await chooseUiOption(page.getByRole('dialog', { name: 'Image details' }), 'Category', 'Unsorted');
      await page.getByRole('dialog', { name: 'Image details' }).getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('dialog', { name: 'Image details' }).getByRole('status')).toContainText('Saved.');
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toHaveCount(0);
      await page.getByRole('dialog', { name: 'Image details' }).getByRole('button', { name: 'Close details' }).click();
      await expect(page.getByRole('dialog', { name: 'Image details' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'File Library', exact: true })).toBeFocused();
      await page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Unsorted' }).click();
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();

      await page.getByRole('button', { name: /pixel\.png/i }).click();
      await chooseUiOption(page.getByRole('dialog', { name: 'Image details' }), 'Category', 'Covers');
      await page.getByRole('dialog', { name: 'Image details' }).getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('dialog', { name: 'Image details' }).getByRole('status')).toContainText('Saved.');
      await page.getByRole('dialog', { name: 'Image details' }).getByRole('button', { name: 'Close details' }).click();
      await expect(page.getByRole('dialog', { name: 'Image details' })).toHaveCount(0);
      await page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Covers', exact: true }).click();
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();

      await page.getByRole('button', { name: 'Delete Covers' }).click();
      const deleteCategoryDialog = page.getByRole('dialog', { name: 'Delete category?' });
      await expect(deleteCategoryDialog).toContainText('Covers');
      await deleteCategoryDialog.getByRole('button', { name: 'Delete category' }).click();
      await expect(page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Covers', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();
      await expect
        .poll(async () => {
          const { data, error } = await owner.client.from('media_items').select('folder_id').eq('original_name', 'pixel.png').single();
          if (error) throw error;
          return data.folder_id;
        })
        .toBeNull();
      await page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'All files' }).click();
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();

      await page.getByLabel('Search files').fill('pixel.png');
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();
      await page.getByLabel('Search files').fill('tiny test image');
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toBeVisible();

      await page.getByRole('button', { name: /pixel\.png/i }).click();
      const copyStatus = page.getByRole('dialog', { name: 'Image details' }).getByRole('status');
      await page.getByRole('button', { name: 'Copy URL' }).click();
      await expect(copyStatus).toContainText(/URL copied\.|URL selected\./);
      if (await copyStatus.textContent() === 'URL selected. Copy it with your keyboard shortcut.') {
        expect(await page.evaluate(() => window.getSelection()?.toString())).toMatch(/^https?:\/\//);
      }
    } finally {
      await deleteOwner(owner);
    }
  });

  test('keeps upload refresh coupled to the latest debounced search', async ({ page }) => {
    const owner = await createOwner('media-library-search-race');
    let releaseUpload = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    try {
      await seedMediaItems(owner, 1, 'existing');
      await openMediaLibrary(page, owner);
      await expect(page.getByRole('button', { name: /existing-01\.png/i })).toBeVisible();
      await page.route('**/storage/v1/object/blog-media/**', async (route) => {
        if (route.request().method() === 'POST') await uploadGate;
        return route.continue();
      });

      await page.getByLabel('Upload image').setInputFiles(IMAGE_FIXTURES[0]);
      await expect(page.getByText('Uploading image…')).toBeVisible();
      await page.getByLabel('Search files').fill('no matching asset');
      await expect(page.getByRole('button', { name: /existing-01\.png/i })).toHaveCount(0);
      await expect(page.getByText('No files yet')).toBeVisible();

      releaseUpload();
      await expect(page.getByText('Uploading image…')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /existing-01\.png|pixel\.png/i })).toHaveCount(0);
      await expect(page.getByText('No files yet')).toBeVisible();
    } finally {
      releaseUpload();
      await deleteOwner(owner);
    }
  });

  test('keeps upload refresh coupled to the current category', async ({ page }) => {
    const owner = await createOwner('media-library-category-race');
    let releaseUpload = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    try {
      await openMediaLibrary(page, owner);
      for (const name of ['Headers', 'Covers']) {
        await page.getByLabel('Category name').fill(name);
        await page.getByRole('button', { name: 'Create category' }).click();
        await expect(page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name, exact: true })).toBeVisible();
      }
      await page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Headers', exact: true }).click();
      await page.route('**/storage/v1/object/blog-media/**', async (route) => {
        if (route.request().method() === 'POST') await uploadGate;
        return route.continue();
      });

      await page.getByLabel('Upload image').setInputFiles(IMAGE_FIXTURES[0]);
      await expect(page.getByText('Uploading image…')).toBeVisible();
      await page.getByRole('navigation', { name: 'File categories' }).getByRole('button', { name: 'Covers', exact: true }).click();
      await expect(page.getByText('No files yet')).toBeVisible();

      releaseUpload();
      await expect(page.getByText('Uploading image…')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /pixel\.png/i })).toHaveCount(0);
      await expect(page.getByText('No files yet')).toBeVisible();
    } finally {
      releaseUpload();
      await deleteOwner(owner);
    }
  });

  test('loads 48 media items first and appends the 49th item', async ({ page }) => {
    const owner = await createOwner('media-library-pagination');

    try {
      await seedMediaItems(owner, 49, 'page-item');
      await openMediaLibrary(page, owner);

      const cards = page.getByRole('button', { name: /page-item-\d+\.png/i });
      await expect(cards).toHaveCount(48);
      await expect(page.getByRole('button', { name: /page-item-01\.png/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /page-item-49\.png/i })).toHaveCount(0);
      await page.getByRole('button', { name: 'Load more' }).click();
      await expect(cards).toHaveCount(49);
      await expect(page.getByRole('button', { name: /page-item-01\.png/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /page-item-49\.png/i })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
    } finally {
      await deleteOwner(owner);
    }
  });

  test('does not skip the 49th item after deleting from the first page', async ({ page }) => {
    const owner = await createOwner('media-library-delete-pagination');

    try {
      await seedMediaItems(owner, 49, 'delete-page-item');
      await openMediaLibrary(page, owner);

      const cards = page.getByRole('button', { name: /delete-page-item-\d+\.png/i });
      await expect(cards).toHaveCount(48);
      await page.getByRole('button', { name: /delete-page-item-01\.png/i }).click();
      await page.getByRole('dialog', { name: 'Image details' }).getByRole('button', { name: 'Delete' }).click();
      await page.getByRole('dialog', { name: 'Delete image?' }).getByRole('button', { name: 'Delete image' }).click();

      await expect(page.getByRole('dialog', { name: 'Image details' })).toHaveCount(0);
      await expect(cards).toHaveCount(48);
      await expect(page.getByRole('button', { name: /delete-page-item-49\.png/i })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
    } finally {
      await deleteOwner(owner);
    }
  });

  test('constrains a large image preview inside image details', async ({ page }) => {
    const owner = await createOwner('media-library-large-preview');

    try {
      await seedMediaItems(owner, 1, 'large-preview', { height: 3072, width: 4096 });
      await openMediaLibrary(page, owner);
      await page.getByRole('button', { name: /large-preview-01\.png/i }).click();
      const preview = page.getByRole('dialog', { name: 'Image details' }).locator('img');
      await expect(preview).toBeVisible();
      expect(await preview.evaluate((image) => {
        const dialog = image.closest('dialog');
        return Boolean(dialog && image.getBoundingClientRect().width <= dialog.getBoundingClientRect().width);
      })).toBe(true);
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
      await expect(page.getByText('Loading files…')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('Forced list failure');
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByText('No files yet')).toBeVisible();
    } finally {
      await deleteOwner(owner);
    }
  });

  test('keeps category load failure visible through searches and retries categories', async ({ page }) => {
    const owner = await createOwner('media-library-category-load-retry');
    let folderRequests = 0;

    try {
      await signInAndWait(page, owner);
      await page.route('**/rest/v1/media_folders*', async (route) => {
        if (route.request().method() !== 'GET' || folderRequests++ > 0) return route.continue();
        return route.fulfill({
          body: JSON.stringify({ message: 'Forced category load failure' }),
          contentType: 'application/json',
          status: 500,
        });
      });

      await page.goto('/admin/media');
      await expect(page.getByRole('alert')).toContainText('Forced category load failure');
      await page.getByLabel('Search files').fill('nothing');
      await expect(page.getByRole('alert')).toContainText('Forced category load failure');
      await page.getByRole('button', { name: 'Retry categories' }).click();
      await expect(page.getByText('Forced category load failure')).toHaveCount(0);
      expect(folderRequests).toBe(2);
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

test('mobile media library exposes category selection and category CRUD without overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Responsive behavior is covered in the mobile project.');
  const owner = await createOwner('media-library-mobile');

  try {
    await openMediaLibrary(page, owner);
    await expect(page.getByText('No files yet')).toBeVisible();
    await expect(page.getByLabel('File category')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'File categories' })).toBeHidden();
    await page.getByLabel('Category name').fill('Mobile');
    await page.getByRole('button', { name: 'Create category' }).click();
    await chooseUiOption(page, 'File category', 'Mobile');
    await page.getByRole('button', { name: 'Rename Mobile' }).click();
    await page.getByRole('textbox', { name: 'Rename Mobile' }).fill('Phone');
    await page.getByRole('button', { name: 'Save category name' }).click();
    await page.getByRole('button', { name: 'Delete Phone' }).click();
    await page.getByRole('dialog', { name: 'Delete category?' }).getByRole('button', { name: 'Delete category' }).click();
    await expect(page.getByRole('option', { name: 'Phone', exact: true, includeHidden: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth)).toBe(true);
  } finally {
    await deleteOwner(owner);
  }
});
