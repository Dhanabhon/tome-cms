/**
 * Narrows a sign-in to the Passkeys this installation actually knows.
 *
 * Without a list, the browser offers every Passkey it holds for this hostname -- including
 * ones left behind by an earlier installation at the same address, which the server cannot
 * recognise. Choosing one of those is answered with a bare 401 and no way for the owner to
 * tell which of their Passkeys was the wrong one.
 *
 * better-auth fills `allowCredentials` only for a caller who already has a session, because
 * for a site with many users the list would say who they are. TomeCMS has exactly one owner
 * and its sign-in page says so, so the list names nobody: a credential id is an opaque handle
 * that authenticates nothing without the private key it belongs to.
 */
export interface AllowedCredential {
  id: string;
  transports?: string[];
}

export async function ownerAllowedCredentials(): Promise<AllowedCredential[]> {
  // Imported here rather than at the top so the response rewriting above can be read,
  // and tested, without a database or the environment that configures one.
  const { db } = await import('../db/client');
  const rows = await db.selectFrom('passkey')
    .innerJoin('site_settings', 'site_settings.owner_id', 'passkey.userId')
    .select(['passkey.credentialID as id', 'passkey.transports as transports'])
    .where('site_settings.id', '=', true)
    .execute();
  return rows.map(({ id, transports }) => {
    const hints = (transports ?? '').split(',').map((hint) => hint.trim()).filter(Boolean);
    return hints.length ? { id, transports: hints } : { id };
  });
}

/**
 * Adds the list to an options response without disturbing anything else in it -- the challenge
 * cookie the endpoint just set travels in the headers, which are carried over untouched.
 */
export async function withOwnerAllowedCredentials(
  response: Response,
  credentials: () => Promise<AllowedCredential[]> = ownerAllowedCredentials,
): Promise<Response> {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  const options: unknown = await response.clone().json().catch(() => null);
  // A signed-in caller is already narrowed by better-auth itself; an unreadable body is left alone.
  if (typeof options !== 'object' || options === null || 'allowCredentials' in options) return response;
  const allowCredentials = await credentials();
  if (!allowCredentials.length) return response;
  return new Response(JSON.stringify({ ...options, allowCredentials }), {
    headers: response.headers,
    status: response.status,
  });
}
