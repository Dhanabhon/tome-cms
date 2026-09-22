import type { Kysely } from 'kysely';

import type { EditorDocument, PostStatus } from '../../types/cms';
import type { Database } from '../db/types';
import { HttpError } from '../http/errors';
import { assertReadyMediaReferences, listReadyDocumentFiles } from '../media/service';
import { editorFileIds, editorMediaIds, parseEditorContent, type StoredEditorContent } from './editor';
import { prepareContent } from './mutations';

/*
 * What a post or a page points at, read from and checked against the library. Kept apart from
 * mutations.ts, whose schemas the public API loads without a database.
 */

/**
 * `prepareContent`, with each card's name, type and size read from the library through
 * `database` -- inside a transaction, the transaction, since the pool may hold no second
 * connection.
 */
export async function prepareContentWithFiles(
  database: Kysely<Database>,
  ownerId: string,
  input: { contentJson: unknown; status: PostStatus },
): Promise<StoredEditorContent> {
  let ids: string[] = [];
  try {
    ids = editorFileIds(parseEditorContent({ contentJson: input.contentJson }));
  } catch {
    // Not a document at all: prepareContent refuses it below, in the words it always has.
  }
  const files = await listReadyDocumentFiles(database, ownerId, ids);
  // A card whose file the library does not have -- deleted while a draft still held it, or never a
  // document -- is named as that, not as content that is invalid.
  if (ids.some((id) => !files.has(id))) throw new HttpError(400, 'Choose a file from this site.');
  return prepareContent(input, files);
}

/** A document's pictures, and `imageIds` beside them, are ready images; its cards, ready documents. */
export async function assertContentMedia(
  database: Kysely<Database>,
  ownerId: string,
  contentJson: EditorDocument,
  imageIds: string[] = [],
): Promise<void> {
  await assertReadyMediaReferences(database, ownerId, [...editorMediaIds(contentJson), ...imageIds]);
  await assertReadyMediaReferences(database, ownerId, editorFileIds(contentJson), 'document');
}
