import { randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { sql } from 'kysely';
import { z } from 'zod';

import { createEnrollment } from '../../../server/auth/enrollment';
import { installationInputSchema, installationTokenMatches } from '../../../server/auth/installation';
import { assertSameOrigin } from '../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../server/auth/rate-limit';
import { db } from '../../../server/db/client';
import { getServerEnv } from '../../../server/env';
import { checkReadiness } from '../../../server/health';

const requestSchema = installationInputSchema.extend({
  installationToken: z.string().min(1).max(512),
}).strict();

const env = getServerEnv();
const publicUrl = new URL(env.TOME_CMS_PUBLIC_URL);
const responseHeaders = { 'Cache-Control': 'no-store' };

class InstallRequestError extends Error {
  constructor(readonly status: 400 | 401 | 409 | 503, message: string) {
    super(message);
  }
}

export const POST: APIRoute = async ({ clientAddress, request }) => {
  try {
    try {
      assertSameOrigin(request, publicUrl.origin);
    } catch {
      return Response.json({ error: 'Request origin is not allowed.' }, { headers: responseHeaders, status: 403 });
    }

    try {
      await enforceRateLimit('install', clientAddress);
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) throw error;
      return Response.json({ error: 'Too many installation attempts. Try again later.' }, {
        headers: { ...responseHeaders, 'Retry-After': String(error.retryAfter) },
        status: 429,
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InstallRequestError(400, 'Installation details must be valid JSON.');
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) throw new InstallRequestError(400, 'Check the installation details and try again.');
    if (!installationTokenMatches(parsed.data.installationToken, env.TOME_CMS_INSTALL_TOKEN)) {
      throw new InstallRequestError(401, 'The installation token is not valid.');
    }

    const readiness = await checkReadiness(request.signal);
    if (readiness.status !== 'ready') {
      throw new InstallRequestError(503, 'The database or migrations need attention before installation.');
    }

    const email = parsed.data.email.toLowerCase();
    const enrollment = await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('tomecms-install'))`.execute(trx);
      if (await trx.selectFrom('site_settings').select('id').executeTakeFirst()) {
        throw new InstallRequestError(409, 'TomeCMS is already installed.');
      }

      const abandoned = await trx.selectFrom('installation_enrollments')
        .select('pending_user_id')
        .where('purpose', '=', 'install')
        .where('consumed_at', 'is', null)
        .execute();
      const abandonedUserIds = [...new Set(abandoned.map(({ pending_user_id }) => pending_user_id))];
      if (abandonedUserIds.length) {
        // Cascades revoke abandoned sessions, Passkeys, and enrollment rows.
        await trx.deleteFrom('user').where('id', 'in', abandonedUserIds).execute();
      }

      const pendingUserId = randomUUID();
      await trx.insertInto('user').values({
        id: pendingUserId,
        email,
        emailVerified: false,
        image: null,
        name: email,
        role: 'owner',
      }).execute();
      return createEnrollment({ email, pendingUserId, purpose: 'install' }, trx);
    });

    return Response.json({
      context: enrollment.context,
      expiresAt: enrollment.expiresAt.toISOString(),
      rp: { id: publicUrl.hostname, name: 'TomeCMS' },
    }, { headers: responseHeaders, status: 201 });
  } catch (error) {
    if (error instanceof InstallRequestError) {
      return Response.json({ error: error.message }, { headers: responseHeaders, status: error.status });
    }
    console.error('Installer enrollment failed.');
    return Response.json({ error: 'Could not prepare Passkey registration. Try again.' }, {
      headers: responseHeaders,
      status: 500,
    });
  }
};
