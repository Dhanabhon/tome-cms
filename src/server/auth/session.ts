import { auth } from './config';

type AuthSession = typeof auth.$Infer.Session;

export type BetterAuthUser = AuthSession['user'];
export type BetterAuthSession = AuthSession['session'];
export type OwnerSession = { user: BetterAuthUser; session: BetterAuthSession };

export class HttpError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function getSession(headers: Headers): Promise<OwnerSession | null> {
  return auth.api.getSession({ headers, query: { disableCookieCache: true } });
}

export async function requireOwner(headers: Headers): Promise<OwnerSession> {
  const current = await getSession(headers);
  if (!current) throw new HttpError(401, 'Authentication required.');
  if (current.user.role !== 'owner') throw new HttpError(403, 'Owner access required.');
  return current;
}

export async function requireInstalledOwner(headers: Headers): Promise<OwnerSession> {
  const current = await requireOwner(headers);
  const { db } = await import('../db/client');
  const settings = await db.selectFrom('site_settings')
    .select('owner_id')
    .where('id', '=', true)
    .executeTakeFirst();
  if (settings?.owner_id !== current.user.id) throw new HttpError(403, 'Owner access required.');
  return current;
}
