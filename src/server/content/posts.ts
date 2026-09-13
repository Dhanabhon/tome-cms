import { randomUUID } from 'node:crypto';

import type { Selectable, Transaction } from 'kysely';
import { z } from 'zod';

import type { Post, PostLocale, PostTranslationSummary } from '../../types/cms';
import { db } from '../db/client';
import type { Database, PostTable } from '../db/types';
import { HttpError } from '../http/errors';
import { replacePostGroupCategories } from './categories';
import {
  assertCurrentVersion,
  contentMutationSchema,
  isUniqueViolation,
  normalizedContentSlug,
  prepareContent,
} from './mutations';

const categoryIdsSchema = z.array(z.uuid()).max(20).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Choose unique Categories.' });
});

export const createPostSchema = contentMutationSchema.omit({ updatedAt: true }).safeExtend({
  categoryIds: categoryIdsSchema,
  coverMediaId: z.null(),
  locale: z.enum(['th', 'en']).optional(),
  sourcePostId: z.uuid().optional(),
}).superRefine(({ locale, sourcePostId }, context) => {
  if (Boolean(locale) !== Boolean(sourcePostId)) {
    context.addIssue({ code: 'custom', message: 'A translated edition requires both locale and sourcePostId.' });
  }
});

export const updatePostSchema = contentMutationSchema.safeExtend({
  categoryIds: categoryIdsSchema,
  coverMediaId: z.null(),
  id: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export function postFromRow(row: Selectable<PostTable>): Post {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    locale: row.locale,
    translation_group_id: row.translation_group_id,
    cover_image: null,
    content_json: row.content_json,
    content_html: row.content_html,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    status: row.status,
    published_at: row.published_at?.toISOString() ?? null,
    author_id: row.owner_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function lockOwner(trx: Transaction<Database>, ownerId: string): Promise<void> {
  const owner = await trx.selectFrom('user').select('id').where('id', '=', ownerId).forUpdate().executeTakeFirst();
  if (!owner) throw new HttpError(404, 'Owner not found.');
}

function writeConflict(error: unknown): never {
  if (isUniqueViolation(error)) throw new HttpError(409, 'That Post language or slug already exists.');
  throw error;
}

export async function listPosts(ownerId: string): Promise<Post[]> {
  return (await db.selectFrom('posts').selectAll()
    .where('owner_id', '=', ownerId).orderBy('updated_at', 'desc').orderBy('id').execute()).map(postFromRow);
}

export async function getPost(ownerId: string, id: string): Promise<Post | null> {
  const row = await db.selectFrom('posts').selectAll()
    .where('id', '=', id).where('owner_id', '=', ownerId).executeTakeFirst();
  return row ? postFromRow(row) : null;
}

export async function listPostTranslations(ownerId: string, translationGroupId: string): Promise<PostTranslationSummary[]> {
  return db.selectFrom('posts').select(['id', 'locale', 'status', 'title'])
    .where('owner_id', '=', ownerId).where('translation_group_id', '=', translationGroupId)
    .orderBy('locale').execute();
}

export async function createPost(ownerId: string, input: CreatePostInput): Promise<Post> {
  const id = randomUUID();
  const content = prepareContent(input);
  try {
    const row = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      let translationGroupId: string = randomUUID();
      let locale: PostLocale;
      let coverMediaId: string | null = null;

      if (input.sourcePostId && input.locale) {
        const source = await trx.selectFrom('posts').select(['cover_media_id', 'locale', 'translation_group_id'])
          .where('id', '=', input.sourcePostId).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
        if (!source) throw new HttpError(404, 'Post not found.');
        if (source.locale === input.locale) throw new HttpError(409, 'That language edition already exists.');
        translationGroupId = source.translation_group_id;
        locale = input.locale;
        coverMediaId = source.cover_media_id;
        await trx.selectFrom('post_translation_groups').select('id')
          .where('id', '=', translationGroupId).where('owner_id', '=', ownerId).forUpdate().executeTakeFirstOrThrow();
      } else {
        const settings = await trx.selectFrom('site_settings').select('default_locale')
          .where('id', '=', true).where('owner_id', '=', ownerId).executeTakeFirst();
        if (!settings) throw new HttpError(503, 'Site settings are unavailable.');
        locale = settings.default_locale;
        await trx.insertInto('post_translation_groups').values({ id: translationGroupId, owner_id: ownerId }).execute();
      }

      const created = await trx.insertInto('posts').values({
        id,
        translation_group_id: translationGroupId,
        locale,
        title: input.title,
        slug: normalizedContentSlug('post', input.slug, input.title, id),
        cover_media_id: coverMediaId,
        content_json: content.contentJson,
        content_html: content.contentHtml,
        meta_title: input.metaTitle,
        meta_description: input.metaDescription,
        status: input.status,
        published_at: null,
        owner_id: ownerId,
      }).returningAll().executeTakeFirstOrThrow();
      await replacePostGroupCategories(trx, ownerId, translationGroupId, input.categoryIds);
      return created;
    });
    return postFromRow(row);
  } catch (error) {
    return writeConflict(error);
  }
}

export async function updatePost(ownerId: string, input: UpdatePostInput): Promise<Post> {
  const content = prepareContent(input);
  try {
    const row = await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      const current = await trx.selectFrom('posts').selectAll()
        .where('id', '=', input.id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
      if (!current) throw new HttpError(404, 'Post not found.');
      assertCurrentVersion(current.updated_at, input.updatedAt, 'post');
      await trx.selectFrom('post_translation_groups').select('id')
        .where('id', '=', current.translation_group_id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirstOrThrow();

      const updated = await trx.updateTable('posts').set({
        title: input.title,
        slug: normalizedContentSlug('post', input.slug, input.title, input.id),
        cover_media_id: null,
        content_json: content.contentJson,
        content_html: content.contentHtml,
        meta_title: input.metaTitle,
        meta_description: input.metaDescription,
        status: input.status,
      }).where('id', '=', input.id).where('owner_id', '=', ownerId).returningAll().executeTakeFirstOrThrow();
      await replacePostGroupCategories(trx, ownerId, current.translation_group_id, input.categoryIds);
      return updated;
    });
    return postFromRow(row);
  } catch (error) {
    return writeConflict(error);
  }
}

export async function updatePostStatus(
  ownerId: string,
  input: { id: string; status: Post['status']; updatedAt: string },
): Promise<Post> {
  const row = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('posts').selectAll()
      .where('id', '=', input.id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Post not found.');
    assertCurrentVersion(current.updated_at, input.updatedAt, 'post');
    const content = input.status === 'published'
      ? prepareContent({ contentJson: current.content_json, status: input.status })
      : null;
    return trx.updateTable('posts').set({
      status: input.status,
      ...(content ? { content_json: content.contentJson, content_html: content.contentHtml } : {}),
    })
      .where('id', '=', input.id).where('owner_id', '=', ownerId).returningAll().executeTakeFirstOrThrow();
  });
  return postFromRow(row);
}

export async function deletePost(ownerId: string, id: string, updatedAt: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await lockOwner(trx, ownerId);
    const current = await trx.selectFrom('posts').select(['translation_group_id', 'updated_at'])
      .where('id', '=', id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Post not found.');
    assertCurrentVersion(current.updated_at, updatedAt, 'post');
    await trx.selectFrom('post_translation_groups').select('id')
      .where('id', '=', current.translation_group_id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirstOrThrow();
    await trx.deleteFrom('posts').where('id', '=', id).where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
    const sibling = await trx.selectFrom('posts').select('id')
      .where('translation_group_id', '=', current.translation_group_id).executeTakeFirst();
    if (!sibling) {
      await trx.deleteFrom('post_translation_groups')
        .where('id', '=', current.translation_group_id).where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
    }
  });
}
