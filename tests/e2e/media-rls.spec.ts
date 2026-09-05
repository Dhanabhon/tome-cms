import { expect, test } from '@playwright/test';

import { createOwner, deleteOwner, type TestOwner } from './support';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=',
  'base64',
);

test('keeps media metadata and storage listings scoped to each owner', async () => {
  const owners: TestOwner[] = [];

  try {
    const ownerA = await createOwner('media-rls-a');
    owners.push(ownerA);
    const ownerB = await createOwner('media-rls-b');
    owners.push(ownerB);

    const { data: folder, error: folderError } = await ownerA.client
      .from('media_folders')
      .insert({ name: 'Owner A folder', owner_id: ownerA.id })
      .select()
      .single();
    expect(folderError).toBeNull();
    expect(folder).not.toBeNull();

    const ownerAPath = `${ownerA.id}/${crypto.randomUUID()}.png`;
    const { error: itemError } = await ownerA.client.from('media_items').insert({
      folder_id: folder.id,
      height: 1,
      mime_type: 'image/png',
      original_name: 'owner-a.png',
      owner_id: ownerA.id,
      size_bytes: PNG_1X1.byteLength,
      storage_path: ownerAPath,
      width: 1,
    });
    expect(itemError).toBeNull();

    const { data: hiddenFolders, error: hiddenFoldersError } = await ownerB.client
      .from('media_folders')
      .select('id')
      .eq('id', folder.id);
    expect(hiddenFoldersError).toBeNull();
    expect(hiddenFolders).toEqual([]);

    const { data: hiddenItems, error: hiddenItemsError } = await ownerB.client
      .from('media_items')
      .select('id')
      .eq('storage_path', ownerAPath);
    expect(hiddenItemsError).toBeNull();
    expect(hiddenItems).toEqual([]);

    const { error: foreignFolderError } = await ownerB.client.from('media_items').insert({
      folder_id: folder.id,
      height: 1,
      mime_type: 'image/png',
      original_name: 'blocked.png',
      owner_id: ownerB.id,
      size_bytes: PNG_1X1.byteLength,
      storage_path: `${ownerB.id}/${crypto.randomUUID()}.png`,
      width: 1,
    });
    expect(foreignFolderError).not.toBeNull();

    const ownerBPath = `${ownerB.id}/${crypto.randomUUID()}.png`;
    for (const [owner, path] of [
      [ownerA, ownerAPath],
      [ownerB, ownerBPath],
    ] as const) {
      const { error } = await owner.client.storage.from('blog-media').upload(path, PNG_1X1, {
        contentType: 'image/png',
      });
      expect(error).toBeNull();
    }

    const [{ data: ownerAOwn }, { data: ownerAForeign }, { data: ownerBOwn }, { data: ownerBForeign }] =
      await Promise.all([
        ownerA.client.storage.from('blog-media').list(ownerA.id),
        ownerA.client.storage.from('blog-media').list(ownerB.id),
        ownerB.client.storage.from('blog-media').list(ownerB.id),
        ownerB.client.storage.from('blog-media').list(ownerA.id),
      ]);

    expect(ownerAOwn?.map(({ name }) => name)).toEqual([ownerAPath.split('/')[1]]);
    expect(ownerAForeign).toEqual([]);
    expect(ownerBOwn?.map(({ name }) => name)).toEqual([ownerBPath.split('/')[1]]);
    expect(ownerBForeign).toEqual([]);
  } finally {
    await Promise.all(owners.map(deleteOwner));
  }
});
