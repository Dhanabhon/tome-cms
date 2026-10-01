import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';

import type { EditorDocument, Page, Post } from '../../types/cms';
import { db } from '../db/client';
import type { Database } from '../db/types';
import { HttpError } from '../http/errors';
import { categoryIdsForPost } from '../content/categories';
import { getPage, updatePage } from '../content/pages';
import { getPost, updatePost } from '../content/posts';

export type ContentKind = 'post' | 'page';

/** Every field an AI can change, as the draft had it. */
interface SnapshotFields {
  title: string;
  slug: string;
  excerpt: string;
  meta_title: string | null;
  meta_description: string | null;
  content_json: EditorDocument;
  cover_media_id?: string | null;
  show_cover?: boolean;
  category_ids?: string[];
}

const column = (kind: ContentKind) => (kind === 'post' ? 'post_id' : 'page_id');
const instant = (value: Date | string) => new Date(value).getTime();

/**
 * Before an AI write: keep what the draft is now, unless a snapshot exists and nobody has changed
 * the draft since the AI last wrote it (its updated_at is still that write's). Then the AI is
 * writing again with nobody in between, and undo must still reach what was there before it began.
 *
 * ponytail: the snapshot, the write and markAiWritten are three steps, not one transaction. A
 * write that fails after the snapshot leaves a snapshot equal to the draft, which undo puts back
 * harmlessly; one transaction would mean threading it through updatePost and updatePage.
 */
export async function snapshotBeforeAiWrite(
  database: Kysely<Database>,
  ownerId: string,
  kind: ContentKind,
  current: Post | Page,
  connection: { id: string; clientName: string },
): Promise<void> {
  const existing = await database.selectFrom('content_ai_snapshots').select('ai_written_at')
    .where(column(kind), '=', current.id).where('owner_id', '=', ownerId).executeTakeFirst();
  if (existing && instant(existing.ai_written_at as unknown as Date) === instant(current.updated_at)) return;
  const fields: SnapshotFields = {
    title: current.title,
    slug: current.slug,
    excerpt: current.excerpt,
    meta_title: current.meta_title,
    meta_description: current.meta_description,
    content_json: current.content_json,
    ...('cover_media_id' in current ? {
      cover_media_id: current.cover_media_id,
      show_cover: current.show_cover,
      category_ids: await categoryIdsForPost(ownerId, current.id),
    } : {}),
  };
  const values = {
    client_name: connection.clientName,
    connection_id: connection.id,
    fields: JSON.stringify(fields),
    // Overwritten by markAiWritten once the write has happened.
    ai_written_at: new Date(current.updated_at),
  };
  await database.insertInto('content_ai_snapshots')
    .values({ id: randomUUID(), owner_id: ownerId, post_id: kind === 'post' ? current.id : null, page_id: kind === 'page' ? current.id : null, ...values })
    .onConflict((conflict) => conflict.column(column(kind)).doUpdateSet(values))
    .execute();
}

/** The AI's write is the draft's latest: an owner edit after it is one with a newer updated_at. */
export async function markAiWritten(ownerId: string, kind: ContentKind, id: string, updatedAt: string): Promise<void> {
  await db.updateTable('content_ai_snapshots').set({ ai_written_at: new Date(updatedAt) })
    .where(column(kind), '=', id).where('owner_id', '=', ownerId).execute();
}

/**
 * Categories belong to a post's translation group, so writing them writes every edition's. An AI
 * may do that only while every edition is still a draft: "drafts only" covers the other language too.
 */
export async function groupIsAllDrafts(ownerId: string, postId: string): Promise<boolean> {
  const live = await db.selectFrom('posts as post')
    .innerJoin('posts as sibling', 'sibling.translation_group_id', 'post.translation_group_id')
    .select('sibling.id')
    .where('post.id', '=', postId).where('post.owner_id', '=', ownerId).where('sibling.status', '!=', 'draft')
    .executeTakeFirst();
  return !live;
}

export async function readSnapshot(ownerId: string, kind: ContentKind, id: string): Promise<{ clientName: string; aiWrittenAt: string; ownerEditedSince: boolean } | null> {
  const row = await db.selectFrom('content_ai_snapshots').select(['client_name', 'ai_written_at'])
    .where(column(kind), '=', id).where('owner_id', '=', ownerId).executeTakeFirst();
  const item = row ? await (kind === 'post' ? getPost : getPage)(ownerId, id) : null;
  if (!row || !item) return null;
  const aiWrittenAt = row.ai_written_at as unknown as Date;
  // Compared in milliseconds, as the editor's updatedAt is: the column keeps microseconds.
  return { clientName: row.client_name, aiWrittenAt: aiWrittenAt.toISOString(), ownerEditedSince: instant(item.updated_at) > instant(aiWrittenAt) };
}

/** Puts the draft back as it was before the AI, with the usual version check, then forgets the copy. */
export async function restoreSnapshot(ownerId: string, kind: ContentKind, id: string, updatedAt: string): Promise<Post | Page> {
  const row = await db.selectFrom('content_ai_snapshots').select(['id', 'fields'])
    .where(column(kind), '=', id).where('owner_id', '=', ownerId).executeTakeFirst();
  if (!row) throw new HttpError(404, 'There is nothing to put back.');
  const fields = row.fields as SnapshotFields;
  const common = {
    id, updatedAt, status: 'draft' as const, title: fields.title, slug: fields.slug, excerpt: fields.excerpt,
    metaTitle: fields.meta_title, metaDescription: fields.meta_description, contentJson: fields.content_json,
  };
  const restored = kind === 'post'
    ? await updatePost(ownerId, {
      ...common,
      coverMediaId: fields.cover_media_id ?? null,
      showCover: fields.show_cover,
      // With an edition published, the group's categories are the owner's now: they stay as they are.
      categoryIds: await groupIsAllDrafts(ownerId, id) ? fields.category_ids ?? [] : await categoryIdsForPost(ownerId, id),
    })
    : await updatePage(ownerId, common);
  await db.deleteFrom('content_ai_snapshots').where('id', '=', row.id).execute();
  return restored;
}
