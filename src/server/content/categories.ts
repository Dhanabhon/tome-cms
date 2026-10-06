import { randomUUID } from 'node:crypto';

import { sql, type Selectable, type Transaction } from 'kysely';
import { z } from 'zod';

import { contentSlug, SLUG_LENGTH } from '../../lib/slug';
import type { PostCategory, PostCategoryBadge, PostCategorySummary, PostLocale } from '../../types/cms';
import { db } from '../db/client';
import type { CategoryTable, Database } from '../db/types';
import { HttpError } from '../http/errors';
import { live } from './live';
import { normalizedContentSlugSchema } from './mutations';

/** How long each language's description may be, in characters. */
export const CATEGORY_DESCRIPTION_LENGTH = 160;

const description = z.string().trim().max(CATEGORY_DESCRIPTION_LENGTH);

/**
 * An edit from the category manager. The slug is checked by `updateCategory`, not here: one the
 * category already has is kept whatever it looks like, and only a changed one is held to the rules.
 */
export const categoryUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  slug: z.string().max(SLUG_LENGTH * 2).optional(),
  descriptionTh: description.optional(),
  descriptionEn: description.optional(),
}).strict();

export type CategoryUpdate = Omit<z.infer<typeof categoryUpdateSchema>, 'id'>;

function category(row: Selectable<CategoryTable>): PostCategory {
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

const SLUG_TAKEN = () => new HttpError(409, 'That Category address is already in use.', { code: 'slug_taken' });

/** The unique violation was the address's, not the name's. */
function isSlugViolation(error: unknown): boolean {
  return isUniqueViolation(error) && (error as { constraint?: unknown }).constraint === 'categories_owner_slug_key';
}

// ponytail: serialize Category mutations per owner; split locks only if measured editor throughput needs it.
async function lockOwner(trx: Transaction<Database>, ownerId: string): Promise<void> {
  const owner = await trx.selectFrom('user').select('id').where('id', '=', ownerId).forUpdate().executeTakeFirst();
  if (!owner) throw new HttpError(404, 'Owner not found.');
}

/**
 * The address a name gives, free for this owner: the rules migration 033 filled every category
 * with -- contentSlug, short enough for a -N, `category-` and the id's start when nothing is left --
 * then -2, -3 and so on past the ones taken. Call it with the owner locked.
 */
async function freeCategorySlug(trx: Transaction<Database>, ownerId: string, name: string, id: string): Promise<string> {
  const base = contentSlug(name).slice(0, SLUG_LENGTH - 6).replace(/-+$/, '') || `category-${id.replaceAll('-', '').slice(0, 8)}`;
  // A slug is letters, digits and hyphens, so the base needs no escaping in a LIKE.
  const rows = await trx.selectFrom('categories').select('slug')
    .where('owner_id', '=', ownerId).where('id', '!=', id)
    .where((eb) => eb.or([eb('slug', '=', base), eb('slug', 'like', `${base}-%`)]))
    .execute();
  const taken = new Set(rows.map(({ slug }) => slug));
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
  return slug;
}

async function slugIsFree(trx: Transaction<Database>, ownerId: string, slug: string, id: string): Promise<boolean> {
  return !await trx.selectFrom('categories').select('id')
    .where('owner_id', '=', ownerId).where('slug', '=', slug).where('id', '!=', id).executeTakeFirst();
}

/**
 * A new category, inside a transaction that holds the owner. A slug it is given (an import's) is
 * kept when it is one and free; otherwise the name gives one.
 */
export async function insertCategory(
  trx: Transaction<Database>,
  ownerId: string,
  input: { name: string; slug?: string; descriptionTh?: string; descriptionEn?: string },
): Promise<Selectable<CategoryTable>> {
  const id = randomUUID();
  const requested = normalizedContentSlugSchema.safeParse(input.slug ?? '');
  const slug = requested.success && await slugIsFree(trx, ownerId, requested.data, id)
    ? requested.data
    : await freeCategorySlug(trx, ownerId, input.name, id);
  return trx.insertInto('categories')
    .values({
      id,
      owner_id: ownerId,
      name: input.name,
      slug,
      description_th: input.descriptionTh ?? '',
      description_en: input.descriptionEn ?? '',
      is_default: false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** The installer's Uncategorized, at the address a migrated one has. A second call does nothing. */
export async function insertDefaultCategory(trx: Transaction<Database>, ownerId: string): Promise<void> {
  await sql`
    insert into categories (owner_id, name, slug, is_default)
    values (${ownerId}, 'Uncategorized', 'uncategorized', true)
    on conflict (owner_id) where is_default do nothing
  `.execute(trx);
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

export async function listPublishedCategoriesForOwner(
  ownerId: string,
  locale: PostLocale,
  baseline: Date,
): Promise<{ items: PostCategoryBadge[]; lastModified: Date }> {
  const rows = await db.selectFrom('categories as category')
    .innerJoin('post_category_assignments as assignment', (join) => join
      .onRef('assignment.category_id', '=', 'category.id')
      .onRef('assignment.owner_id', '=', 'category.owner_id'))
    .innerJoin('posts as post', (join) => join
      .onRef('post.translation_group_id', '=', 'assignment.translation_group_id')
      .onRef('post.owner_id', '=', 'assignment.owner_id'))
    .select([
      'category.id',
      'category.name',
      'category.slug',
      'category.is_default',
      'category.updated_at as category_updated_at',
      'assignment.created_at as assignment_created_at',
      'post.updated_at as post_updated_at',
    ])
    .where('category.owner_id', '=', ownerId)
    .where('post.locale', '=', locale)
    .where(live('post'))
    .orderBy('category.is_default', 'desc')
    .orderBy('category.name')
    .orderBy('category.id')
    .execute();
  const items = new Map<string, PostCategoryBadge>();
  let modified = baseline.getTime();
  for (const row of rows) {
    if (!items.has(row.id)) items.set(row.id, { id: row.id, name: row.name, slug: row.slug });
    modified = Math.max(
      modified,
      row.category_updated_at.getTime(),
      row.assignment_created_at.getTime(),
      row.post_updated_at.getTime(),
    );
  }
  return { items: [...items.values()], lastModified: new Date(modified) };
}

export async function createCategory(ownerId: string, requestedName: string): Promise<PostCategory> {
  const name = nameForWrite(requestedName);
  try {
    const row = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      return insertCategory(trx, ownerId, { name });
    });
    return category(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, 'That Category name is already in use.');
    throw error;
  }
}

/**
 * A name, and an address and descriptions when they are given. A rename keeps the address, so
 * links to the category keep working; an empty one is made from the name again. An address the
 * category already has is kept as it is, even one a stricter rule would now refuse.
 */
export async function updateCategory(ownerId: string, id: string, input: CategoryUpdate): Promise<PostCategory> {
  const name = nameForWrite(input.name);
  try {
    const row = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      const current = await trx.selectFrom('categories').select(['is_default', 'slug'])
        .where('id', '=', id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
      if (!current) throw new HttpError(404, 'Category not found.');
      if (current.is_default) throw new HttpError(409, 'Uncategorized is protected.');
      const given = input.slug?.normalize('NFC').trim();
      let slug = current.slug;
      if (given === '') slug = await freeCategorySlug(trx, ownerId, name, id);
      else if (given !== undefined && given !== current.slug) {
        if (!normalizedContentSlugSchema.safeParse(given).success) {
          throw new HttpError(400, 'Use lowercase letters, digits, Thai and single hyphens in the Category address.', { code: 'slug_invalid' });
        }
        if (!await slugIsFree(trx, ownerId, given, id)) throw SLUG_TAKEN();
        slug = given;
      }
      return trx.updateTable('categories')
        .set({
          name,
          slug,
          ...(input.descriptionTh !== undefined ? { description_th: input.descriptionTh.trim() } : {}),
          ...(input.descriptionEn !== undefined ? { description_en: input.descriptionEn.trim() } : {}),
        })
        .where('id', '=', id).where('owner_id', '=', ownerId)
        .returningAll().executeTakeFirstOrThrow();
    });
    return category(row);
  } catch (error) {
    if (isSlugViolation(error)) throw SLUG_TAKEN();
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

/**
 * Categories for a page of posts, in one query.
 *
 * Assignments hang off the translation group rather than the post, so both language
 * editions of a story carry the same set — the admin list shows one row per edition
 * and each gets the group's categories. Keyed by group for that reason, not by post id.
 */
export async function categoriesByPostGroup(
  ownerId: string,
  groupIds: string[],
): Promise<Map<string, PostCategoryBadge[]>> {
  const groups = new Map<string, PostCategoryBadge[]>();
  if (!groupIds.length) return groups;
  const rows = await db.selectFrom('post_category_assignments as assignment')
    .innerJoin('categories as category', (join) => join
      .onRef('category.id', '=', 'assignment.category_id')
      .onRef('category.owner_id', '=', 'assignment.owner_id'))
    .select(['assignment.translation_group_id', 'category.id', 'category.name', 'category.slug'])
    .where('assignment.owner_id', '=', ownerId)
    .where('assignment.translation_group_id', 'in', [...new Set(groupIds)])
    .orderBy('category.is_default', 'desc')
    .orderBy('category.name')
    .orderBy('category.id')
    .execute();
  for (const row of rows) {
    const items = groups.get(row.translation_group_id) ?? [];
    items.push({ id: row.id, name: row.name, slug: row.slug });
    groups.set(row.translation_group_id, items);
  }
  return groups;
}
