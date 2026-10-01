import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { db } from '../../../server/db/client';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';
import { parseJson } from '../../../server/http/json';
import { mcpConfig } from '../../../server/mcp/config';
import { beat, itemKey, lastTouch } from '../../../server/mcp/presence';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const editingSchema = z.object({
  kind: z.enum(['post', 'page']),
  id: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

/**
 * The open editor's check-in, every 15 s while its tab is visible. It holds the draft for the
 * owner (no AI may write it for 45 s after), and answers with the last AI to touch it and
 * whether the stored draft is newer than the one the editor holds.
 */
export const POST: APIRoute = async ({ request }) => {
  const requestId = randomUUID();
  try {
    const current = await requireInstalledOwner(request.headers);
    try {
      assertSameOrigin(request, configuredOrigin);
    } catch {
      throw new HttpError(403, 'Request origin is not allowed.');
    }
    const { kind, id, updatedAt } = await parseJson(request, editingSchema);
    // Every 15 s from each open editor: the id and version only, never the body.
    const item = await db.selectFrom(kind === 'post' ? 'posts' : 'pages').select(['id', 'updated_at'])
      .where('id', '=', id).where('owner_id', '=', current.user.id).executeTakeFirst();
    if (!item) throw new HttpError(404, kind === 'post' ? 'Post not found.' : 'Page not found.');
    // Keyed by the stored id, never the one the request spelled.
    const key = itemKey(kind, item.id);
    beat(key);
    const touch = (await mcpConfig()) ? lastTouch(key) : null;
    // The connection id stays on the server: the editor needs only who, what and when.
    const ai = touch ? { clientName: touch.clientName, brand: touch.brand, action: touch.action, at: new Date(touch.at).toISOString() } : null;
    const newer = new Date(item.updated_at).getTime() > Date.parse(updatedAt);
    return Response.json({ ai, newer }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
