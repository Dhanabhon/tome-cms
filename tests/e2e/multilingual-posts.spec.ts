import { expect, test } from '@playwright/test';

import { hasMeaningfulContent, readingMinutes } from '../../src/lib/posts';
import { admin, createOwner, deleteOwner, signInAdmin } from './support';

const draftBody = (title: string, slug: string) => ({
  contentHtml: '<p>Draft body</p>',
  contentJson: { content: [{ content: [{ text: 'Draft body', type: 'text' }], type: 'paragraph' }], type: 'doc' },
  slug,
  status: 'draft' as const,
  title,
});

test('post-content helpers accept image-only documents and segment Thai text', () => {
  expect(hasMeaningfulContent({ content: [{ type: 'paragraph' }], type: 'doc' })).toBe(false);
  expect(hasMeaningfulContent({ content: [{ attrs: { src: 'https://example.com/image.jpg' }, type: 'image' }], type: 'doc' })).toBe(true);
  expect(readingMinutes({ content: [{ content: [{ text: 'ภาษาไทย'.repeat(300), type: 'text' }], type: 'paragraph' }], type: 'doc' })).toBeGreaterThan(1);
});

test('normal posts receive the configured locale and an independent translation group', async ({ page }) => {
  const owner = await createOwner('post-migration');
  const slug = `migration-${crypto.randomUUID()}`;

  try {
    const { data: settings, error: settingsError } = await admin
      .from('site_settings')
      .select('default_locale')
      .eq('id', true)
      .single();
    if (settingsError) throw settingsError;

    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const response = await page.request.post('/api/posts', {
      data: {
        contentHtml: '<p>Existing content</p>',
        contentJson: { content: [{ content: [{ text: 'Existing content', type: 'text' }], type: 'paragraph' }], type: 'doc' },
        slug,
        status: 'draft',
        title: 'Existing post shape',
      },
    });
    expect(response.status()).toBe(201);
    const seeded = (await response.json()).post as { id: string; slug: string; status: string; updated_at: string };

    const { data, error } = await admin
      .from('posts')
      .select('id, locale, slug, status, translation_group_id, updated_at')
      .eq('id', seeded.id)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({
      id: seeded.id,
      locale: settings.default_locale,
      slug: seeded.slug,
      status: seeded.status,
      updated_at: seeded.updated_at,
    });
    expect(data?.translation_group_id).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    await admin.from('posts').delete().eq('author_id', owner.id);
    await deleteOwner(owner);
  }
});

test('linked editions use server-derived groups and reject invalid translation requests', async ({ page }) => {
  const owner = await createOwner('linked-editions');
  const foreignOwner = await createOwner('foreign-source');
  const sharedSlug = `shared-${crypto.randomUUID()}`;

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const sourceResponse = await page.request.post('/api/posts', {
      data: { ...draftBody('Thai source', sharedSlug), coverImage: 'https://example.com/source-cover.jpg' },
    });
    expect(sourceResponse.status()).toBe(201);
    const source = (await sourceResponse.json()).post as {
      id: string;
      locale: 'th' | 'en';
      translation_group_id: string;
      cover_image: string | null;
    };

    const translationResponse = await page.request.post('/api/posts', {
      data: {
        ...draftBody('English edition', sharedSlug),
        locale: source.locale === 'th' ? 'en' : 'th',
        sourcePostId: source.id,
      },
    });
    expect(translationResponse.status()).toBe(201);
    const translation = (await translationResponse.json()).post as {
      locale: 'th' | 'en';
      translation_group_id: string;
      cover_image: string | null;
    };
    expect(translation.translation_group_id).toBe(source.translation_group_id);
    expect(translation.locale).not.toBe(source.locale);
    expect(translation.cover_image).toBe(source.cover_image);

    const duplicate = await page.request.post('/api/posts', {
      data: {
        ...draftBody('Duplicate edition', `duplicate-${crypto.randomUUID()}`),
        locale: translation.locale,
        sourcePostId: source.id,
      },
    });
    expect(duplicate.status()).toBe(409);

    const { data: foreignPost, error: foreignPostError } = await foreignOwner.client
      .from('posts')
      .insert({
        author_id: foreignOwner.id,
        content_html: '<p>Foreign content</p>',
        content_json: { content: [{ content: [{ text: 'Foreign content', type: 'text' }], type: 'paragraph' }], type: 'doc' },
        locale: 'th',
        slug: `foreign-${crypto.randomUUID()}`,
        status: 'draft',
        title: 'Foreign source',
      })
      .select('id')
      .single();
    expect(foreignPostError).toBeNull();
    if (!foreignPost) throw new Error('Foreign source was not created.');

    const foreignSource = await page.request.post('/api/posts', {
      data: { ...draftBody('Foreign edition', `foreign-edition-${crypto.randomUUID()}`), locale: 'en', sourcePostId: foreignPost.id },
    });
    expect(foreignSource.status()).toBe(404);

    const invalidLocale = await page.request.post('/api/posts', {
      data: { ...draftBody('Invalid locale', `invalid-locale-${crypto.randomUUID()}`), locale: 'fr', sourcePostId: source.id },
    });
    expect(invalidLocale.status()).toBe(400);

    const invalidCover = await page.request.post('/api/posts', {
      data: { ...draftBody('Invalid cover', `invalid-cover-${crypto.randomUUID()}`), coverImage: 'javascript:alert(1)' },
    });
    expect(invalidCover.status()).toBe(400);

    for (const field of ['author_id', 'owner_id', 'translation_group_id']) {
      const protectedField = await page.request.post('/api/posts', {
        data: { ...draftBody(`Protected ${field}`, `protected-${crypto.randomUUID()}`), [field]: crypto.randomUUID() },
      });
      expect(protectedField.status()).toBe(400);
    }

    const emptyPublished = await page.request.post('/api/posts', {
      data: {
        contentHtml: '<p></p>',
        contentJson: { content: [{ type: 'paragraph' }], type: 'doc' },
        slug: `empty-published-${crypto.randomUUID()}`,
        status: 'published',
        title: 'Empty published post',
      },
    });
    expect(emptyPublished.status()).toBe(400);
    expect((await emptyPublished.json()).issues.properties.contentJson.errors).toContain('Add content before publishing.');
  } finally {
    await admin.from('posts').delete().in('author_id', [owner.id, foreignOwner.id]);
    await deleteOwner(owner);
    await deleteOwner(foreignOwner);
  }
});
