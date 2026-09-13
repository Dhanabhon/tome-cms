import { sql } from 'kysely';

import { db } from '../db/client';
import { HttpError } from '../http/errors';
import type { OwnerSession } from './session';

export const FRESH_SESSION_SECONDS = 5 * 60;

export class FreshSessionRequiredError extends HttpError {
  constructor() { super(403, 'Verify a Passkey and try again.'); }
}

export async function requireFreshOwnerSession(current: OwnerSession): Promise<void> {
  const fresh = await db.selectFrom('session')
    .select('id')
    .where('id', '=', current.session.id)
    .where('token', '=', current.session.token)
    .where('userId', '=', current.user.id)
    .where('expiresAt', '>', sql<Date>`CURRENT_TIMESTAMP`)
    .where('createdAt', '>=', sql<Date>`CURRENT_TIMESTAMP - (${FRESH_SESSION_SECONDS} * interval '1 second')`)
    .executeTakeFirst();
  if (!fresh) throw new FreshSessionRequiredError();
}
