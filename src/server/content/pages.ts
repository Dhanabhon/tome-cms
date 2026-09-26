import { randomUUID } from 'node:crypto';

import type { Selectable } from 'kysely';
import { z } from 'zod';

import { RESERVED_PAGE_SLUGS } from '../../lib/pages';
import type { Page, PageLocale, PageTranslationSummary } from '../../types/cms';
import { db } from '../db/client';
import type { PageTable } from '../db/types';
import { HttpError } from '../http/errors';
import { assertContentMedia, prepareContentWithFiles } from './content-media';
import {
  assertCurrentVersion,
  contentMutationSchema,
  duplicateSlugCandidates,
  duplicateTitle,
  isUniqueViolation,
  normalizedContentSlug,
  plannedAtWrite,
} from './mutations';
import { invalidatePublicNavigationCache } from './navigation';

/** The same bound a post's carries, and for the same reason: see 014_post_excerpt. */
const excerptSchema = z.string().trim().max(120);

export const createPageSchema = contentMutationSchema.omit({ updatedAt: true }).safeExtend({
  excerpt: excerptSchema,
  locale: z.enum(['th', 'en']).optional(),
  sourcePageId: z.uuid().optional(),
}).superRefine(({ locale, sourcePageId }, context) => {
  if (Boolean(locale) !== Boolean(sourcePageId)) {
    context.addIssue({ code: 'custom', message: 'A translated edition requires both locale and sourcePageId.' });
  }
});

export const updatePageSchema = contentMutationSchema.safeExtend({
  excerpt: excerptSchema,
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
    excerpt: row.excerpt,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    status: row.status,
    published_at: row.published_at?.toISOString() ?? null,
    planned_at: row.planned_at?.toISOString() ?? null,
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
  const rows = await db.selectFrom('pages').select(['id', 'locale', 'published_at', 'status', 'title'])
    .where('owner_id', '=', ownerId).where('translation_group_id', '=', translationGroupId)
    .orderBy('locale').execute();
  return rows.map((row) => ({ ...row, published_at: row.published_at?.toISOString() ?? null }));
}

export async function createPage(ownerId: string, input: CreatePageInput): Promise<Page> {
  const id = randomUUID();
  const content = await prepareContentWithFiles(db, ownerId, input);
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

      await assertContentMedia(trx, ownerId, content.contentJson);

      return trx.insertInto('pages').values({
        id,
        translation_group_id: translationGroupId,
        locale,
        title: input.title,
        slug: pageSlug({ id, requested: input.slug, title: input.title }),
        content_json: content.contentJson,
        content_html: content.contentHtml,
        meta_title: input.metaTitle,
        excerpt: input.excerpt,
        meta_description: input.metaDescription,
        status: input.status,
        // A first save can already carry a date: an owner who schedules before the autosave
        // has run is scheduling the post that save creates.
        published_at: input.publishedAt ? new Date(input.publishedAt) : null,
        ...plannedAtWrite(input),
        owner_id: ownerId,
      }).returningAll().executeTakeFirstOrThrow();
    });
    invalidatePublicNavigationCache();
    return pageFromRow(row);
  } catch (error) {
    return writeConflict(error);
  }
}

/**
 * Copies a Page into a new, independent draft. See duplicatePost for why the copy
 * gets its own translation group and why it is always a draft; a Page carries no
 * categories and no cover, so there is nothing else to bring across.
 *
 * The navigation cache is not touched: a draft never appears in a public menu, so
 * there is nothing for readers to see differently yet.
 */
export async function duplicatePage(ownerId: string, id: string): Promise<Page> {
  const copyId = randomUUID();
  try {
    const row = await db.transaction().execute(async (trx) => {
      const source = await trx.selectFrom('pages').selectAll()
        .where('id', '=', id).where('owner_id', '=', ownerId).executeTakeFirst();
      if (!source) throw new HttpError(404, 'Page not found.');

      const [preferred, fallback] = duplicateSlugCandidates(source.slug, copyId);
      const taken = await trx.selectFrom('pages').select('id')
        .where('locale', '=', source.locale).where('slug', '=', preferred).executeTakeFirst();

      const translationGroupId = randomUUID();
      await trx.insertInto('page_translation_groups').values({ id: translationGroupId, owner_id: ownerId }).execute();

      return trx.insertInto('pages').values({
        id: copyId,
        translation_group_id: translationGroupId,
        locale: source.locale,
        title: duplicateTitle(source.title, source.locale),
        slug: taken ? fallback : preferred,
        content_json: source.content_json,
        content_html: source.content_html,
        meta_title: source.meta_title,
        meta_description: source.meta_description,
        status: 'draft',
        published_at: null,
        owner_id: ownerId,
      }).returningAll().executeTakeFirstOrThrow();
    });
    return pageFromRow(row);
  } catch (error) {
    return writeConflict(error);
  }
}

export async function updatePage(ownerId: string, input: UpdatePageInput): Promise<Page> {
  const content = await prepareContentWithFiles(db, ownerId, input);
  try {
    const row = await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('pages').selectAll()
        .where('id', '=', input.id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
      if (!current) throw new HttpError(404, 'Page not found.');
      assertCurrentVersion(current.updated_at, input.updatedAt, 'page');
      await assertContentMedia(trx, ownerId, content.contentJson);
      return trx.updateTable('pages').set({
        title: input.title,
        slug: pageSlug({ id: input.id, requested: input.slug, title: input.title }),
        content_json: content.contentJson,
        content_html: content.contentHtml,
        meta_title: input.metaTitle,
        excerpt: input.excerpt,
        meta_description: input.metaDescription,
        status: input.status,
        // Absent leaves it to the trigger: stamped on a first publish, carried forward after.
        ...(input.publishedAt ? { published_at: new Date(input.publishedAt) } : {}),
        ...plannedAtWrite(input),
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
  input: { id: string; publishedAt?: string | null; status: Page['status']; updatedAt: string },
): Promise<Page> {
  const row = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('pages').selectAll()
      .where('id', '=', input.id).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!current) throw new HttpError(404, 'Page not found.');
    assertCurrentVersion(current.updated_at, input.updatedAt, 'page');
    const content = input.status === 'published'
      ? await prepareContentWithFiles(trx, ownerId, { contentJson: current.content_json, status: input.status })
      : null;
    return trx.updateTable('pages').set({
      status: input.status,
      // Absent leaves it to the trigger, which stamps the moment for a first publish and
      // carries the existing date forward otherwise.
      ...(input.publishedAt ? { published_at: new Date(input.publishedAt) } : {}),
      ...plannedAtWrite(input),
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
