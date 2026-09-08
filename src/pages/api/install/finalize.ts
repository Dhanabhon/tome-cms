import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { APIRoute } from 'astro';
import { sql } from 'kysely';
import { z } from 'zod';

import { EnrollmentContextError, hashEnrollmentContext, verifyEnrollmentContext } from '../../../server/auth/context';
import { consumeEnrollment } from '../../../server/auth/enrollment';
import { installationInputSchema } from '../../../server/auth/installation';
import { assertSameOrigin } from '../../../server/auth/origin';
import { enforceRateLimit, RateLimitExceededError } from '../../../server/auth/rate-limit';
import { getSession } from '../../../server/auth/session';
import { db } from '../../../server/db/client';
import { getServerEnv } from '../../../server/env';

const requestSchema = installationInputSchema.extend({
  context: z.string().min(1).max(2_048),
}).strict();

const env = getServerEnv();
const configuredOrigin = new URL(env.TOME_CMS_PUBLIC_URL).origin;
const responseHeaders = { 'Cache-Control': 'no-store' };

class FinalizationError extends Error {
  constructor(readonly status: 400 | 401 | 409, message: string) {
    super(message);
  }
}

function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const value = randomBytes(16).toString('hex');
    return Array.from({ length: 8 }, (_, index) => value.slice(index * 4, index * 4 + 4)).join('-');
  });
}

function hashRecoveryCode(code: string): string {
  return createHmac('sha256', env.TOME_CMS_RECOVERY_PEPPER).update(code).digest('hex');
}

export const POST: APIRoute = async ({ clientAddress, request }) => {
  try {
    try {
      assertSameOrigin(request, configuredOrigin);
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
      throw new FinalizationError(400, 'Installation details must be valid JSON.');
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) throw new FinalizationError(400, 'Check the installation details and try again.');

    const claims = verifyEnrollmentContext(parsed.data.context, 'install', env.TOME_CMS_CONTEXT_SECRET);
    const current = await getSession(request.headers);
    if (!current) throw new FinalizationError(401, 'Complete Passkey registration before finalizing installation.');

    const result = await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('tomecms-install'))`.execute(trx);
      if (await trx.selectFrom('site_settings').select('id').executeTakeFirst()) {
        throw new FinalizationError(409, 'TomeCMS is already installed.');
      }

      const enrollment = await trx.selectFrom('installation_enrollments as enrollment')
        .innerJoin('user as pending_user', 'pending_user.id', 'enrollment.pending_user_id')
        .select([
          'enrollment.pending_user_id as pendingUserId',
          'enrollment.email as email',
          'pending_user.email as userEmail',
        ])
        .where('enrollment.id', '=', claims.id)
        .where('enrollment.context_hash', '=', hashEnrollmentContext(parsed.data.context))
        .where('enrollment.purpose', '=', 'install')
        .where('enrollment.consumed_at', 'is', null)
        .where('enrollment.expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
        .forUpdate()
        .executeTakeFirst();
      if (!enrollment || enrollment.email !== enrollment.userEmail || enrollment.email !== parsed.data.email.toLowerCase()) {
        throw new FinalizationError(400, 'The enrollment is invalid or expired. Verify the installation token again.');
      }
      if (current.user.id !== enrollment.pendingUserId) {
        throw new FinalizationError(401, 'The Passkey session does not match this installation.');
      }

      const liveSession = await trx.selectFrom('session')
        .select('id')
        .where('id', '=', current.session.id)
        .where('token', '=', current.session.token)
        .where('userId', '=', enrollment.pendingUserId)
        .where('expiresAt', '>', sql<Date>`CURRENT_TIMESTAMP`)
        .executeTakeFirst();
      if (!liveSession) throw new FinalizationError(401, 'The Passkey session expired. Register the Passkey again.');

      const passkeys = await trx.selectFrom('passkey')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('userId', '=', enrollment.pendingUserId)
        .executeTakeFirstOrThrow();
      if (Number(passkeys.count) < 1) {
        throw new FinalizationError(409, 'Register a primary Passkey before finalizing installation.');
      }

      const ownerId = await consumeEnrollment(parsed.data.context, trx);
      if (ownerId !== enrollment.pendingUserId) throw new FinalizationError(400, 'The enrollment is invalid.');

      await trx.insertInto('site_settings').values({
        id: true,
        owner_id: ownerId,
        site_name: parsed.data.siteName,
        tagline: parsed.data.tagline,
        site_description: parsed.data.siteDescription,
        default_locale: parsed.data.defaultLocale,
        timezone: parsed.data.timezone,
        admin_path: parsed.data.adminPath,
        author_name: '',
        author_avatar_media_id: null,
        author_bio_th: '',
        author_bio_en: '',
      }).execute();

      const recoveryCodes = createRecoveryCodes();
      await trx.insertInto('recovery_codes').values(recoveryCodes.map((code) => ({
        id: randomUUID(),
        user_id: ownerId,
        code_hash: hashRecoveryCode(code),
      }))).execute();

      return { recoveryCodes, redirectTo: parsed.data.adminPath };
    });

    return Response.json(result, { headers: responseHeaders, status: 201 });
  } catch (error) {
    if (error instanceof FinalizationError) {
      return Response.json({ error: error.message }, { headers: responseHeaders, status: error.status });
    }
    if (error instanceof EnrollmentContextError) {
      return Response.json({ error: 'The enrollment is invalid or expired. Verify the installation token again.' }, {
        headers: responseHeaders,
        status: 400,
      });
    }
    console.error('Installer finalization failed.');
    return Response.json({ error: 'Could not finish installation. No partial settings were saved.' }, {
      headers: responseHeaders,
      status: 500,
    });
  }
};
