import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { z } from 'zod';

import { assertSameOrigin } from '../../../server/auth/origin';
import { requireInstalledOwner } from '../../../server/auth/session';
import { getServerEnv } from '../../../server/env';
import { adminErrorResponse, HttpError } from '../../../server/http/errors';
import { parseJson } from '../../../server/http/json';
import { clearTouch, itemKey } from '../../../server/mcp/presence';
import { restoreSnapshot } from '../../../server/mcp/snapshots';

const configuredOrigin = new URL(getServerEnv().TOME_CMS_PUBLIC_URL).origin;
const restoreSchema = z.object({
  kind: z.enum(['post', 'page']),
  id: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

/**
 * Put back: the draft as it was before an AI changed it. The version check is the editor's own,
 * so a draft saved again since the page loaded answers 409 rather than being overwritten blind.
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
    const { kind, id, updatedAt } = await parseJson(request, restoreSchema);
    const restored = await restoreSnapshot(current.user.id, kind, id, updatedAt);
    // Keyed by the stored id, as the editor's check is.
    clearTouch(itemKey(kind, restored.id));
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
};
