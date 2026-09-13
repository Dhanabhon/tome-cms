import { randomUUID } from 'node:crypto';

import type { Selectable } from 'kysely';
import { z } from 'zod';

import { RESERVED_PAGE_SLUGS } from '../../lib/pages';
import type { Page, PageLocale, PageTranslationSummary } from '../../types/cms';
import { db } from '../db/client';
import type { PageTable } from '../db/types';
import { HttpError } from '../http/errors';
import { assertReadyMediaReferences } from '../media/service';
import { editorMediaIds } from './editor';
import {
  assertCurrentVersion,
  contentMutationSchema,
  isUniqueViolation,
  normalizedContentSlug,
  prepareContent,
} from './mutations';
import { invalidatePublicNavigationCache } from './navigation';

export const createPageSchema = contentMutationSchema.omit({ updatedAt: true }).safeExtend({
  locale: z.enum(['th', 'en']).optional(),
  sourcePageId: z.uuid().optional(),
}).superRefine(({ locale, sourcePageId }, context) => {
  if (Boolean(locale) !== Boolean(sourcePageId)) {
    context.addIssue({ code: 'custom', message: 'A translated edition requires both locale and sourcePageId.' });
  }
});

export const updatePageSchema = contentMutationSchema.safeExtend({
  id: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;

export function pageFromRow(row: Selectable<PageTable>): Page {
  return {
    id: row.id,
    translation_group_id: row.translation_group_id,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
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

function pageSlug(input: { id: string; requested: string; title: string }): string {
  const slug = normalizedContentSlug('page', input.requested, input.title, input.id);
  if (RESERVED_PAGE_SLUGS.has(slug)) throw new HttpError(400, 'That page slug is reserved.');
  return slug;
}

function writeConflict(error: unknown): never {
  if (isUniqueViolation(error)) throw new HttpError(409, 'That Page language or slug already exists.');
  throw error;
}

export async function listPages(ownerId: string): Promise<Page[]> {
  return (await db.selectFrom('pages').selectAll()
    .where('owner_id', '=', ownerId).orderBy('updated_at', 'desc').orderBy('id').execute()).map(pageFromRow);
}

export async function getPage(ownerId: string, id: string): Promise<Page | null> {
  const row = await db.selectFrom('pages').selectAll()
    .where('id', '=', id).where('owner_id', '=', ownerId).executeTakeFirst();
  return row ? pageFromRow(row) : null;
}

export async function listPageTranslations(ownerId: string, translationGroupId: string): Promise<PageTranslationSummary[]> {
  return db.selectFrom('pages').select(['id', 'locale', 'status', 'title'])
    .where('owner_id', '=', ownerId).where('translation_group_id', '=', translationGroupId)
    .orderBy('locale').execute();
}

export async function createPage(ownerId: string, input: CreatePageInput): Promise<Page> {
  const id = randomUUID();
  const content = prepareContent(input);
  try {
    const row = await db.transaction().execute(async (trx) => {
      let translationGroupId: string = randomUUID();
      let locale: PageLocale;
      if (input.sourcePageId && input.locale) {
        const source = await trx.selectFrom('pages').select(['locale', 'translation_group_id'])
          .where('id', '=', input.sourcePageId).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
        if (!source) throw new HttpError(404, 'Page not found.');
        if (source.locale === input.locale) throw new HttpError(409, 'That language edition already exists.');
        translationGroupId = source.translation_group_id;
        locale = input.locale;
        await trx.selectFrom('page_translation_groups').select('id')
          .where('id', '=', translationGroupId).where('owner_id', '=', ownerId).forUpdate().executeTakeFirstOrThrow();
      } else {
        const settings = await trx.selectFrom('site_settings').select('default_locale')
          .where('id', '=', true).where('owner_id', '=', ownerId).executeTakeFirst();
        if (!settings) throw new HttpError(503, 'Site settings are unavailable.');
        locale = settings.default_locale;
        await trx.insertInto('page_translation_groups').values({ id: translationGroupId, owner_id: ownerId }).execute();
      }

      await assertReadyMediaReferences(trx, ownerId, editorMediaIds(content.contentJson));

      return trx.insertInto('pages').values({
        id,
        translation_group_id: translationGroupId,
        locale,
        title: input.title,
        slug: pageSlug({ id, requested: input.slug, title: input.title }),
        content_json: content.contentJson,
        content_html: content.contentHtml,
        meta_title: input.metaTitle,
        meta_description: input.metaDescription,
        status: input.status,
        published_at: null,
        owner_id: ownerId,
      }).returningAll().executeTakeFirstOrThrow();
    });
    invalidatePublicNavigationCache();
    return pageFromRow(row);
  } catch (error) {
    return writeConflict(error);
  }
}

export async function updatePage(ownerId: string, input: UpdatePageInput): Promise<Page> {
  const content = prepareContent(input);
  try {
    const row = await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('pages').selectAll()
        .where('id', '=', input.id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
      if (!current) throw new HttpError(404, 'Page not found.');
      assertCurrentVersion(current.updated_at, input.updatedAt, 'page');
      await assertReadyMediaReferences(trx, ownerId, editorMediaIds(content.contentJson));
      return trx.updateTable('pages').set({
        title: input.title,
        slug: pageSlug({ id: input.id, requested: input.slug, title: input.title }),
        content_json: content.contentJson,
        content_html: content.contentHtml,
        meta_title: input.metaTitle,
        meta_description: input.metaDescription,
        status: input.status,
      }).where('id', '=', input.id).where('owner_id', '=', ownerId).returningAll().executeTakeFirstOrThrow();
    });
    invalidatePublicNavigationCache();
    return pageFromRow(row);
  } catch (error) {
    return writeConflict(error);
  }
}

export async function updatePageStatus(
  ownerId: string,
  input: { id: string; status: Page['status']; updatedAt: string },
): Promise<Page> {
  const row = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('pages').selectAll()
      .where('id', '=', input.id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Page not found.');
    assertCurrentVersion(current.updated_at, input.updatedAt, 'page');
    const content = input.status === 'published'
      ? prepareContent({ contentJson: current.content_json, status: input.status })
      : null;
    return trx.updateTable('pages').set({
      status: input.status,
      ...(content ? { content_json: content.contentJson, content_html: content.contentHtml } : {}),
    })
      .where('id', '=', input.id).where('owner_id', '=', ownerId).returningAll().executeTakeFirstOrThrow();
  });
  invalidatePublicNavigationCache();
  return pageFromRow(row);
}

export async function deletePage(ownerId: string, id: string, updatedAt: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('pages').select(['translation_group_id', 'updated_at'])
      .where('id', '=', id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Page not found.');
    assertCurrentVersion(current.updated_at, updatedAt, 'page');
    await trx.selectFrom('page_translation_groups').select('id')
      .where('id', '=', current.translation_group_id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirstOrThrow();
    await trx.deleteFrom('pages').where('id', '=', id).where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
    const sibling = await trx.selectFrom('pages').select('id')
      .where('translation_group_id', '=', current.translation_group_id).executeTakeFirst();
    if (!sibling) {
      await trx.deleteFrom('page_translation_groups')
        .where('id', '=', current.translation_group_id).where('owner_id', '=', ownerId).executeTakeFirstOrThrow();
    }
  });
  invalidatePublicNavigationCache();
}
