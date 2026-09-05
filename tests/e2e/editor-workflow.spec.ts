import { expect, test } from '@playwright/test';

import { admin, createOwner, deleteOwner, signInAdmin } from './support';

const draftBody = (title: string, slug: string) => ({
  contentHtml: '<p>Draft body</p>',
  contentJson: { content: [{ content: [{ text: 'Draft body', type: 'text' }], type: 'paragraph' }], type: 'doc' },
  slug,
  status: 'draft' as const,
  title,
});

test('language context resolves owned editions before editor hydration', async ({ page }) => {
  const owner = await createOwner('editor-language-context');
  const foreignOwner = await createOwner('editor-language-context-foreign');
  const coverImage = 'https://example.com/source-cover.jpg';

  try {
    await signInAdmin(page, owner);
    await expect(page.getByRole('link', { name: 'New post' })).toBeVisible();
    const { data: source, error: sourceError } = await owner.client
      .from('posts')
      .insert({
        author_id: owner.id,
        content_html: '<p>Draft body</p>',
        content_json: draftBody('Thai source', `editor-source-${crypto.randomUUID()}`).contentJson,
        cover_image: coverImage,
        locale: 'th',
        slug: `editor-source-${crypto.randomUUID()}`,
        status: 'draft',
        title: 'Thai source',
      })
      .select('id, locale, translation_group_id')
      .single();
    expect(sourceError).toBeNull();
    if (!source) throw new Error('Source post was not created.');
    const targetLocale = source.locale === 'th' ? 'en' : 'th';

    await page.goto(`/admin/edit/${source.id}`);
    const languages = page.getByRole('navigation', { name: 'Post languages' });
    await expect(languages).toContainText(source.locale.toUpperCase());
    await expect(languages).toContainText(`${targetLocale.toUpperCase()} missing`);
    expect(await page.content()).not.toContain(source.translation_group_id);

    await page.goto('/admin');
    await expect(page.getByRole('link', { name: `${targetLocale.toUpperCase()} missing` })).toHaveAttribute(
      'href',
      `/admin/new?sourcePostId=${source.id}&locale=${targetLocale}`,
    );

    await page.goto(`/admin/new?sourcePostId=${source.id}&locale=${targetLocale}`);
    await expect(page.getByLabel('Post title')).toHaveValue('');
    await expect(page.getByText(`${targetLocale.toUpperCase()} draft`)).toBeVisible();
    await expect(page.getByAltText('Current cover')).toHaveAttribute('src', coverImage);

    const { error: duplicateError } = await owner.client.from('posts').insert({
      author_id: owner.id,
      content_html: '<p>Sibling body</p>',
      content_json: draftBody('English sibling', `editor-sibling-${crypto.randomUUID()}`).contentJson,
      locale: targetLocale,
      slug: `editor-sibling-${crypto.randomUUID()}`,
      status: 'draft',
      title: 'English sibling',
      translation_group_id: source.translation_group_id,
    });
    expect(duplicateError).toBeNull();

    const { data: foreignSource, error: foreignSourceError } = await foreignOwner.client
      .from('posts')
      .insert({
        author_id: foreignOwner.id,
        content_html: '<p>Foreign body</p>',
        content_json: draftBody('Foreign source', `foreign-source-${crypto.randomUUID()}`).contentJson,
        locale: source.locale,
        slug: `foreign-source-${crypto.randomUUID()}`,
        status: 'draft',
        title: 'Foreign source',
      })
      .select('id')
      .single();
    expect(foreignSourceError).toBeNull();
    if (!foreignSource) throw new Error('Foreign source was not created.');

    for (const url of [
      `/admin/new?sourcePostId=${source.id}&locale=fr`,
      `/admin/new?sourcePostId=${source.id}&locale=${source.locale}`,
      `/admin/new?sourcePostId=${source.id}&locale=${targetLocale}`,
      `/admin/new?sourcePostId=${crypto.randomUUID()}&locale=${targetLocale}`,
      `/admin/new?sourcePostId=${foreignSource.id}&locale=${targetLocale}`,
    ]) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(404);
      await expect(page.getByText('Post not found.')).toBeVisible();
      await expect(page.getByText('Thai source')).toHaveCount(0);
      await expect(page.getByText('Foreign source')).toHaveCount(0);
    }
  } finally {
    await admin.from('posts').delete().in('author_id', [owner.id, foreignOwner.id]);
    await deleteOwner(owner);
    await deleteOwner(foreignOwner);
  }
});
