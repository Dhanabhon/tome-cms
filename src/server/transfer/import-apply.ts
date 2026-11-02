import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { EditorDocument, EditorMark, EditorNode } from '../../types/cms';
import { placePictures } from '../content/markdown-import';
import { isContentSizeViolation, isUniqueViolation } from '../content/mutations';
import { HttpError } from '../http/errors';
import { ArchiveInputError } from './archive-format';
import { buildPlan, fileKey, readArchiveFile, type ImportPlan, type PlannedItem, type SiteReader } from './import-plan';

/*
 * `tome import` inside the app image. New files go to the library first, each committed, since
 * the content checks lock them as rows they can see. Then every item, its group and its categories
 * are written in one transaction. If that fails, the files it uploaded are taken back, so either
 * every planned item appears or none does, and nothing it brought is left behind.
 */

export interface ImportResult extends ImportPlan {
  /** Files the items named that the archive did not hold: each stands as a line saying so. */
  missingMedia: number;
}

/** What a post list's archived ids are here: post groups by the archive's id, categories by name in lower case. */
interface PostListLinks {
  groups: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
}

/** A card whose file is missing, in the item's own language, as a picture's line is. */
const MISSING_FILE = { th: 'ไฟล์ที่ขาด', en: 'Missing file' } as const;
/** What a plan's group key starts with for a post; the rest is the archive's id for the group. */
const POST_GROUP = 'post:';

/**
 * The exact document with each file the source site named by id pointing at its library item
 * here. A picture without one becomes `placePictures`'s missing-picture line, a card a line of its
 * own, a link plain text, and a video keeps no poster. A post list's posts and category become this
 * site's: a post with no group here is dropped, and a category with no name keeps its archived id,
 * which reads as a deleted category.
 */
function relinkExact(document: EditorDocument, ids: ReadonlyMap<string, string>, locale: 'th' | 'en', lists: PostListLinks): EditorDocument {
  const idOf = (attrs: Record<string, unknown> | undefined) => (typeof attrs?.mediaId === 'string' ? ids.get(attrs.mediaId) : undefined);
  const mark = (held: EditorMark): EditorMark | null => {
    if (held.type !== 'link' || held.attrs?.mediaId === undefined || held.attrs.mediaId === null) return held;
    const id = idOf(held.attrs);
    return id ? { ...held, attrs: { ...held.attrs, href: `/media/${id}`, mediaId: id } } : null;
  };
  const visit = (node: EditorNode): EditorNode => {
    const id = idOf(node.attrs);
    let next: EditorNode = { ...node };
    if (node.type === 'image' && id) next.attrs = { ...node.attrs, src: `/media/${id}`, mediaId: id };
    if (node.type === 'video' && typeof node.attrs?.mediaId === 'string') next.attrs = { ...node.attrs, mediaId: id ?? null };
    if (node.type === 'attachment') {
      if (!id) return { type: 'paragraph', content: [{ type: 'text', text: `[${MISSING_FILE[locale]}: ${String(node.attrs?.name ?? '')}]` }] };
      next.attrs = { ...node.attrs, href: `/media/${id}`, mediaId: id };
    }
    if (node.type === 'postList') {
      const { categoryName, ...attrs } = node.attrs ?? {};
      const categoryId = attrs.source === 'category' && typeof categoryName === 'string' ? lists.categories.get(categoryName.trim().toLowerCase()) : undefined;
      if (categoryId) attrs.categoryId = categoryId;
      // A set: two archive groups can be one group here, and a block may not hold a group twice.
      if (Array.isArray(attrs.postGroupIds)) attrs.postGroupIds = [...new Set(attrs.postGroupIds.flatMap((group) => lists.groups.get(String(group)) ?? []))];
      next.attrs = attrs;
    }
    if (node.marks) {
      const marks = node.marks.map(mark).filter((held): held is EditorMark => held !== null);
      next = { ...next, marks };
      if (!marks.length) delete next.marks;
    }
    if (Array.isArray(node.content)) next.content = node.content.map(visit);
    return next;
  };
  return placePictures({ ...visit(document), type: 'doc' }, new Map([...ids.values()].map((id) => [`/media/${id}`, id])), locale);
}

/** The item's document with its files pointing at library items. */
function itemDocument(item: PlannedItem, byPath: ReadonlyMap<string, string>, lists: PostListLinks): EditorDocument {
  if (item.source === 'md') {
    const matches = new Map([...item.files.pictures].map(([src, path]) => [src, byPath.get(path)!]));
    return placePictures(item.document, matches, item.locale);
  }
  return relinkExact(item.document, new Map([...item.files.ids].map(([id, path]) => [id, byPath.get(path)!])), item.locale, lists);
}

/** What the post or page is made of, as the editor would send it; the schemas check it. */
function editionFields(item: PlannedItem, contentJson: EditorDocument) {
  const fields = item.frontMatter;
  const status = fields.status ?? 'draft';
  // One field carries both: the publication date of a published item, the plan of a draft.
  const date = status === 'published' ? fields.published : fields.planned;
  return {
    title: fields.title,
    slug: item.slug,
    contentJson,
    metaTitle: fields.meta_title ?? null,
    metaDescription: fields.meta_description ?? null,
    status,
    publishedAt: date ? new Date(date).toISOString() : null,
    excerpt: fields.excerpt ?? '',
  };
}

/** A refusal of one item's content, by its file; anything else is not the archive's fault. */
function itemRefusal(error: unknown, path: string): unknown {
  if (error instanceof z.ZodError || (error instanceof HttpError && [400, 404, 409].includes(error.status))
    || isUniqueViolation(error) || isContentSizeViolation(error)) {
    return new ArchiveInputError('content_invalid', path);
  }
  return error;
}

export async function applyImport(root: string, ownerId: string, site?: SiteReader): Promise<ImportResult> {
  const { plan, detail } = await buildPlan(root, ownerId, site);
  const { db } = await import('../db/client');
  const { createMediaFromBytes, deleteImportedMedia } = await import('../media/service');
  const { createPostSchema, insertPostIn } = await import('../content/posts');
  const { createPageSchema, insertPageIn } = await import('../content/pages');
  const { lockOwner } = await import('../content/navigation');
  const { insertCategory } = await import('../content/categories');

  const uploaded: string[] = [];
  try {
    const library = new Map(detail.reuse);
    for (const file of detail.upload) {
      try {
        const media = await createMediaFromBytes(ownerId, await readArchiveFile(root, file.path), file.name);
        uploaded.push(media.id);
        library.set(fileKey(file), media.id);
      } catch (error) {
        if (error instanceof HttpError && error.status === 413) throw new ArchiveInputError('media_too_large', file.path);
        if (error instanceof HttpError && error.status === 415) throw new ArchiveInputError('media_type_unsupported', file.path);
        throw error;
      }
    }
    const byPath = new Map<string, string>();
    for (const [path, file] of detail.files) {
      const id = library.get(fileKey(file));
      if (id) byPath.set(path, id);
    }

    await db.transaction().execute(async (trx) => {
      await lockOwner(trx, ownerId);
      const categories = new Map(detail.categories);
      // In this transaction: createCategory opens one of its own.
      for (const name of plan.categoriesToCreate) {
        const archived = detail.archiveCategories.get(name.toLowerCase());
        const row = await insertCategory(trx, ownerId, { ...archived, name });
        categories.set(name.toLowerCase(), row.id);
      }
      // Every id before any item: a page's file sorts before its posts', and can already name them.
      const groups = new Map(detail.items.map(({ group }) => [group, randomUUID()]));
      const lists = { groups: new Map<string, string>(), categories };
      for (const [translation, { locale, slug }] of detail.skippedGroups) {
        const held = await trx.selectFrom('posts').select('translation_group_id')
          .where('owner_id', '=', ownerId).where('locale', '=', locale).where('slug', '=', slug).executeTakeFirst();
        if (held) lists.groups.set(translation, held.translation_group_id);
      }
      // shortcut: a group the import splits is the one it writes, so a block shows no edition skipped
      // from it; hold both ids in the block if a site needs the skipped one.
      for (const [group, id] of groups) if (group.startsWith(POST_GROUP)) lists.groups.set(group.slice(POST_GROUP.length), id);
      const inserted = new Set<string>();
      for (const item of detail.items) {
        const groupId = groups.get(item.group)!;
        if (!inserted.has(groupId)) {
          inserted.add(groupId);
          await trx.insertInto(item.kind === 'post' ? 'post_translation_groups' : 'page_translation_groups')
            .values({ id: groupId, owner_id: ownerId }).execute();
        }
        const fields = editionFields(item, itemDocument(item, byPath, lists));
        try {
          if (item.kind === 'post') {
            const cover = item.files.cover ? byPath.get(item.files.cover) ?? null : null;
            const input = createPostSchema.parse({
              ...fields,
              // Every edition of a group carries the group's categories, so writing each sets the same.
              categoryIds: [...new Set(item.categories.map((name) => categories.get(name.toLowerCase())!))],
              coverMediaId: cover,
              showCover: item.frontMatter.show_cover ?? true,
            });
            await insertPostIn(trx, ownerId, { ...input, locale: item.locale }, { groupId, keepSlug: true });
          } else {
            await insertPageIn(trx, ownerId, { ...createPageSchema.parse(fields), locale: item.locale }, { groupId, keepSlug: true });
          }
        } catch (error) {
          throw itemRefusal(error, item.path);
        }
      }
    });
  } catch (error) {
    await deleteImportedMedia(ownerId, uploaded).catch((cleanup: unknown) => {
      console.error(`The uploaded files could not all be removed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);
    });
    throw error;
  }
  return { ...plan, missingMedia: detail.items.reduce((total, item) => total + item.missing, 0) };
}
