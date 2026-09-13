import { sql, type Transaction } from 'kysely';

import type { PostCategory, PostCategorySummary } from '../../types/cms';
import { db } from '../db/client';
import type { Database } from '../db/types';
import { HttpError } from '../http/errors';

function category(row: {
  id: string;
  owner_id: string;
  name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}): PostCategory {
  return { ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() };
}

function nameForWrite(name: string): string {
  const value = name.trim();
  if (!value || value.length > 80) throw new HttpError(400, 'Enter a Category name up to 80 characters.');
  if (value.toLocaleLowerCase('en-US') === 'uncategorized') {
    throw new HttpError(409, 'Uncategorized is protected.');
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

// ponytail: serialize Category mutations per owner; split locks only if measured editor throughput needs it.
async function lockOwner(trx: Transaction<Database>, ownerId: string): Promise<void> {
  const owner = await trx.selectFrom('user').select('id').where('id', '=', ownerId).forUpdate().executeTakeFirst();
  if (!owner) throw new HttpError(404, 'Owner not found.');
}

export async function listCategories(ownerId: string): Promise<PostCategorySummary[]> {
  const rows = await db.selectFrom('categories as category')
    .leftJoin('post_category_assignments as assignment', (join) => join
      .onRef('assignment.category_id', '=', 'category.id')
      .onRef('assignment.owner_id', '=', 'category.owner_id'))
    .selectAll('category')
    .select(({ fn }) => fn.count<number>('assignment.translation_group_id').distinct().as('postCount'))
    .where('category.owner_id', '=', ownerId)
    .groupBy('category.id')
    .execute();
  return rows
    .map((row) => ({ ...category(row), postCount: Number(row.postCount) }))
    .sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.name.localeCompare(right.name));
}

export async function createCategory(ownerId: string, requestedName: string): Promise<PostCategory> {
  const name = nameForWrite(requestedName);
  try {
    const row = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      return trx.insertInto('categories')
        .values({ owner_id: ownerId, name, is_default: false })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return category(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, 'That Category name is already in use.');
    throw error;
  }
}

export async function renameCategory(ownerId: string, id: string, requestedName: string): Promise<PostCategory> {
  const name = nameForWrite(requestedName);
  try {
    const row = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      const current = await trx.selectFrom('categories').select('is_default')
        .where('id', '=', id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
      if (!current) throw new HttpError(404, 'Category not found.');
      if (current.is_default) throw new HttpError(409, 'Uncategorized is protected.');
      return trx.updateTable('categories').set({ name })
        .where('id', '=', id).where('owner_id', '=', ownerId)
        .returningAll().executeTakeFirstOrThrow();
    });
    return category(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, 'That Category name is already in use.');
    throw error;
  }
}

export async function deleteCategory(ownerId: string, id: string): Promise<{ affectedPostGroups: number }> {
  return db.transaction().execute(async (trx) => {
    await lockOwner(trx, ownerId);
    const current = await trx.selectFrom('categories').select('is_default')
      .where('id', '=', id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Category not found.');
    if (current.is_default) throw new HttpError(409, 'Uncategorized is protected.');

    const affected = await trx.selectFrom('post_category_assignments')
      .select('translation_group_id')
      .where('category_id', '=', id)
      .where('owner_id', '=', ownerId)
      .orderBy('translation_group_id')
      .execute();
    const groupIds = affected.map(({ translation_group_id }) => translation_group_id);
    if (groupIds.length) {
      await trx.selectFrom('post_translation_groups').select('id')
        .where('owner_id', '=', ownerId).where('id', 'in', groupIds).orderBy('id').forUpdate().execute();
    }
    const fallback = await trx.selectFrom('categories').select('id')
      .where('owner_id', '=', ownerId).where('is_default', '=', true).executeTakeFirst();
    if (!fallback) throw new HttpError(503, 'The default Category is unavailable.');

    await sql`
      insert into post_category_assignments (translation_group_id, category_id, owner_id)
      select target.translation_group_id, ${fallback.id}::uuid, target.owner_id
      from post_category_assignments as target
      where target.category_id = ${id}::uuid
        and target.owner_id = ${ownerId}
        and not exists (
          select 1 from post_category_assignments as other
          where other.translation_group_id = target.translation_group_id
            and other.category_id <> ${id}::uuid
        )
      on conflict do nothing
    `.execute(trx);
    await trx.deleteFrom('categories').where('id', '=', id).where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
    return { affectedPostGroups: groupIds.length };
  });
}

export async function replacePostCategories(ownerId: string, postId: string, requestedIds: string[]): Promise<string[]> {
  return db.transaction().execute(async (trx) => {
    await lockOwner(trx, ownerId);
    const post = await trx.selectFrom('posts').select('translation_group_id')
      .where('id', '=', postId).where('owner_id', '=', ownerId).executeTakeFirst();
    if (!post) throw new HttpError(404, 'Post not found.');
    await trx.selectFrom('post_translation_groups').select('id')
      .where('id', '=', post.translation_group_id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirstOrThrow();
    return replacePostGroupCategories(trx, ownerId, post.translation_group_id, requestedIds);
  });
}

export async function replacePostGroupCategories(
  trx: Transaction<Database>,
  ownerId: string,
  translationGroupId: string,
  requestedIds: string[],
): Promise<string[]> {
  const ids = [...new Set(requestedIds)];
  if (ids.length !== requestedIds.length || ids.length > 20) {
    throw new HttpError(400, 'Choose up to 20 unique Categories.');
  }
  const selected = ids.length
    ? await trx.selectFrom('categories').select(['id', 'is_default'])
        .where('owner_id', '=', ownerId).where('id', 'in', ids).orderBy('id').forKeyShare().execute()
    : [];
  if (selected.length !== ids.length) throw new HttpError(400, 'Choose Categories that belong to this site.');
  const customIds = selected.filter(({ is_default }) => !is_default).map(({ id }) => id);
  const categoryIds = customIds.length ? customIds : [
    (await trx.selectFrom('categories').select('id')
      .where('owner_id', '=', ownerId).where('is_default', '=', true).executeTakeFirstOrThrow()).id,
  ];

  await trx.deleteFrom('post_category_assignments')
    .where('translation_group_id', '=', translationGroupId).execute();
  await trx.insertInto('post_category_assignments').values(categoryIds.map((categoryId) => ({
    translation_group_id: translationGroupId,
    category_id: categoryId,
    owner_id: ownerId,
  }))).execute();
  return categoryIds.sort();
}

export async function categoryIdsForPost(ownerId: string, postId: string): Promise<string[]> {
  const post = await db.selectFrom('posts').select('translation_group_id')
    .where('id', '=', postId).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!post) throw new HttpError(404, 'Post not found.');
  const rows = await db.selectFrom('post_category_assignments').select('category_id')
    .where('translation_group_id', '=', post.translation_group_id)
    .where('owner_id', '=', ownerId)
    .orderBy('category_id')
    .execute();
  return rows.map(({ category_id }) => category_id);
}
