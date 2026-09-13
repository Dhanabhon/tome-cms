import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { z } from 'zod';

import { db } from '../db/client';
import { HttpError } from '../http/errors';
import { pageFromRow } from './pages';
import { postFromRow } from './posts';
import { enrichPages, enrichPosts, type PublishedPage, type PublishedPost } from './published';

export const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1_000;
const previewTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const createPreviewInputSchema = z.object({
  contentId: z.uuid(),
  contentType: z.enum(['post', 'page']),
}).strict();

export type CreatePreviewInput = z.infer<typeof createPreviewInputSchema>;
export type PreviewContent =
  | { contentType: 'post'; content: PublishedPost }
  | { contentType: 'page'; content: PublishedPage };

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPreviewToken(
  ownerId: string,
  input: CreatePreviewInput,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');

  const expiresAt = await db.transaction().execute(async (trx) => {
    const content = input.contentType === 'post'
      ? await trx.selectFrom('posts').select('id')
        .where('id', '=', input.contentId).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst()
      : await trx.selectFrom('pages').select('id')
        .where('id', '=', input.contentId).where('owner_id', '=', ownerId).forUpdate().executeTakeFirst();
    if (!content) throw new HttpError(404, 'Content not found.');

    await trx.deleteFrom('preview_tokens')
      .where('owner_id', '=', ownerId)
      .where((expression) => expression.or([
        expression('expires_at', '<=', sql<Date>`current_timestamp`),
        expression('revoked_at', 'is not', null),
      ]))
      .execute();
    await trx.updateTable('preview_tokens').set({ revoked_at: sql<Date>`current_timestamp` })
      .where('owner_id', '=', ownerId)
      .where('content_type', '=', input.contentType)
      .where('content_id', '=', input.contentId)
      .where('revoked_at', 'is', null)
      .execute();
    const issued = await trx.insertInto('preview_tokens').values({
      id: randomUUID(),
      owner_id: ownerId,
      token_hash: tokenHash(token),
      content_type: input.contentType,
      content_id: input.contentId,
      expires_at: sql<Date>`current_timestamp + (${PREVIEW_TOKEN_TTL_MS} * interval '1 millisecond')`,
      revoked_at: null,
      created_at: sql<Date>`current_timestamp`,
    }).returning('expires_at').executeTakeFirstOrThrow();
    return issued.expires_at;
  });

  return { token, expiresAt };
}

export async function getPreviewContent(rawToken: string): Promise<PreviewContent | null> {
  const parsed = previewTokenSchema.safeParse(rawToken);
  if (!parsed.success) return null;
  const token = await db.selectFrom('preview_tokens').selectAll()
    .where('token_hash', '=', tokenHash(parsed.data))
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', sql<Date>`current_timestamp`)
    .executeTakeFirst();
  if (!token) return null;

  if (token.content_type === 'post') {
    const row = await db.selectFrom('posts').selectAll()
      .where('id', '=', token.content_id).where('owner_id', '=', token.owner_id).executeTakeFirst();
    if (!row) return null;
    const content = (await enrichPosts(token.owner_id, [postFromRow(row)]))[0];
    return content ? { contentType: 'post', content } : null;
  }

  const row = await db.selectFrom('pages').selectAll()
    .where('id', '=', token.content_id).where('owner_id', '=', token.owner_id).executeTakeFirst();
  if (!row) return null;
  const content = (await enrichPages(token.owner_id, [pageFromRow(row)]))[0];
  return content ? { contentType: 'page', content } : null;
}
