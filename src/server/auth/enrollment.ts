import { randomUUID } from 'node:crypto';

import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { db } from '../db/client';
import type { Database } from '../db/types';
import { getServerEnv } from '../env';
import {
  ENROLLMENT_TTL_SECONDS,
  hashEnrollmentContext,
  signEnrollmentContext,
  verifyEnrollmentContext,
  type EnrollmentPurpose,
} from './context';

const createEnrollmentSchema = z.object({
  email: z.email(),
  purpose: z.enum(['install', 'recovery']),
  pendingUserId: z.string().min(1),
}).strict();

const INVALID_ENROLLMENT = 'Enrollment context is invalid or expired.';

function readClaims(context: string, purpose?: EnrollmentPurpose) {
  return verifyEnrollmentContext(context, purpose, getServerEnv().TOME_CMS_CONTEXT_SECRET);
}

export async function createEnrollment(input: {
  email: string;
  purpose: EnrollmentPurpose;
  pendingUserId: string;
}): Promise<{ context: string; expiresAt: Date }> {
  const parsed = createEnrollmentSchema.parse(input);
  const id = randomUUID();
  const exp = Math.floor(Date.now() / 1_000) + ENROLLMENT_TTL_SECONDS;
  const expiresAt = new Date(exp * 1_000);
  const context = signEnrollmentContext(
    { v: 1, id, purpose: parsed.purpose, exp },
    getServerEnv().TOME_CMS_CONTEXT_SECRET,
  );

  await db.insertInto('installation_enrollments').values({
    id,
    context_hash: hashEnrollmentContext(context),
    purpose: parsed.purpose,
    pending_user_id: parsed.pendingUserId,
    email: parsed.email,
    expires_at: expiresAt,
  }).execute();
  return { context, expiresAt };
}

export async function resolveEnrollmentUser(input: {
  context?: string | null;
}): Promise<{ id: string; name: string; email: string }> {
  if (!input.context) throw new Error(INVALID_ENROLLMENT);
  const claims = readClaims(input.context);
  let query = db.selectFrom('installation_enrollments as enrollment')
    .innerJoin('user as pending_user', 'pending_user.id', 'enrollment.pending_user_id')
    .select([
      'pending_user.id as id',
      'pending_user.name as name',
      'enrollment.email as email',
    ])
    .where('enrollment.id', '=', claims.id)
    .where('enrollment.context_hash', '=', hashEnrollmentContext(input.context))
    .where('enrollment.purpose', '=', claims.purpose)
    .where('enrollment.consumed_at', 'is', null)
    .where('enrollment.expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
    .whereRef('pending_user.email', '=', 'enrollment.email');

  if (claims.purpose === 'install') {
    query = query.where(({ exists, not, selectFrom }) => not(exists(selectFrom('site_settings').select('id'))));
  }

  const user = await query.executeTakeFirst();
  if (!user) throw new Error(INVALID_ENROLLMENT);
  return user;
}

export async function consumeEnrollment(context: string, trx: Transaction<Database>): Promise<string> {
  const claims = readClaims(context);
  let query = trx.updateTable('installation_enrollments')
    .set({ consumed_at: sql<Date>`CURRENT_TIMESTAMP` })
    .where('id', '=', claims.id)
    .where('context_hash', '=', hashEnrollmentContext(context))
    .where('purpose', '=', claims.purpose)
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
    .returning('pending_user_id');

  if (claims.purpose === 'install') {
    query = query.where(({ exists, not, selectFrom }) => not(exists(selectFrom('site_settings').select('id'))));
  }

  const enrollment = await query.executeTakeFirst();
  if (!enrollment) throw new Error(INVALID_ENROLLMENT);
  return enrollment.pending_user_id;
}
