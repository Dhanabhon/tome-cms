import { expect, test } from '@playwright/test';

import { admin, cleanupEditor, createOwner, deleteOwner } from './support';

test('editor fixture cleanup removes drafts and published posts before their owner', async ({ page }) => {
  const owner = await createOwner('editor-cleanup');
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  let ownerDeleted = false;
  try {
    const { error } = await admin.from('posts').insert(ids.map((id, index) => ({
      id, author_id: owner.id, title: 'Cleanup fixture', locale: 'en', slug: `cleanup-${id}`,
      status: index ? 'published' : 'draft', content_json: { type: 'doc', content: [] }, content_html: '',
    })));
    expect(error).toBeNull();
    await cleanupEditor(page, owner);
    ownerDeleted = true;
    const remaining = await admin.from('posts').select('id, author_id').in('id', ids);
    expect(remaining.error).toBeNull();
    expect(remaining.data).toEqual([]);
  } finally {
    const { error } = await admin.from('posts').delete().in('id', ids);
    if (error) throw error;
    if (!ownerDeleted) await deleteOwner(owner);
  }
});

test('editor fixture cleanup reports database errors before deleting its owner', async ({ page }) => {
  const owner = await createOwner('editor-cleanup-error');
  try {
    await expect(cleanupEditor(page, { ...owner, id: 'not-a-uuid' })).rejects.toMatchObject({ code: '22P02' });
    const { data, error } = await admin.auth.admin.getUserById(owner.id);
    expect(error).toBeNull();
    expect(data.user?.id).toBe(owner.id);
  } finally {
    await deleteOwner(owner);
  }
});

test('deleting the final edition releases its translation group', async () => {
  const firstOwner = await createOwner('translation-cleanup-first');
  const nextOwner = await createOwner('translation-cleanup-next');
  const group = crypto.randomUUID();
  try {
    const firstInsert = await admin.from('posts').insert({
      author_id: firstOwner.id,
      content_html: '',
      content_json: { type: 'doc', content: [] },
      locale: 'en',
      slug: `translation-cleanup-first-${group}`,
      status: 'draft',
      title: 'First owner edition',
      translation_group_id: group,
    });
    expect(firstInsert.error).toBeNull();

    const firstDelete = await admin.from('posts').delete().eq('translation_group_id', group);
    expect(firstDelete.error).toBeNull();

    const nextInsert = await admin.from('posts').insert({
      author_id: nextOwner.id,
      content_html: '',
      content_json: { type: 'doc', content: [] },
      locale: 'en',
      slug: `translation-cleanup-next-${group}`,
      status: 'draft',
      title: 'Next owner edition',
      translation_group_id: group,
    });
    expect(nextInsert.error).toBeNull();
  } finally {
    const { error } = await admin.from('posts').delete().eq('translation_group_id', group);
    if (error) throw error;
    await deleteOwner(firstOwner);
    await deleteOwner(nextOwner);
  }
});
