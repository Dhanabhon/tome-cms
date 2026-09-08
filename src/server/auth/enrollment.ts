import { randomUUID } from 'node:crypto';

import {
  getCurrentAdapter,
  type BetterAuthOptions,
  type BetterAuthPlugin,
  type DBTransactionAdapter,
} from 'better-auth';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';

import { db } from '../db/client';
import type { Database } from '../db/types';
import { getServerEnv } from '../env';
import {
  ENROLLMENT_TTL_SECONDS,
  EnrollmentContextError,
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

const enrollmentReferenceSchema = z.uuid();
const enrollmentPurposeSchema = z.enum(['install', 'recovery']);

interface EnrollmentUser {
  id: string;
  name: string;
  email: string;
}

interface AdapterEnrollment {
  id: string;
  purpose: string;
  pendingUserId: string;
  email: string;
  expiresAt: Date;
  consumedAt?: Date | null;
}

interface AdapterPasskeyOwner {
  userId: string;
}

interface AdapterSiteOwner {
  ownerId: string;
}

export type AuthIdentityState = 'installed-owner' | 'pending-install' | 'invalid';

export const enrollmentStoragePlugin = {
  id: 'tomecms-enrollment-storage',
  schema: {
    installationEnrollment: {
      modelName: 'installation_enrollments',
      disableMigration: true,
      fields: {
        purpose: { type: 'string', required: true },
        pendingUserId: { type: 'string', required: true, fieldName: 'pending_user_id' },
        email: { type: 'string', required: true },
        expiresAt: { type: 'date', required: true, fieldName: 'expires_at' },
        consumedAt: { type: 'date', required: false, fieldName: 'consumed_at' },
      },
    },
    siteSettings: {
      modelName: 'site_settings',
      disableMigration: true,
      fields: {
        ownerId: { type: 'string', required: true, fieldName: 'owner_id' },
      },
    },
  },
} satisfies BetterAuthPlugin;

function invalidEnrollment(): never {
  throw new EnrollmentContextError();
}

function readClaims(context: string, purpose?: EnrollmentPurpose) {
  return verifyEnrollmentContext(context, purpose, getServerEnv().TOME_CMS_CONTEXT_SECRET);
}

async function readAuthIdentity(
  userId: string,
  executor: Kysely<Database> | Transaction<Database>,
): Promise<AuthIdentityState> {
  const settings = await executor.selectFrom('site_settings').select('owner_id').executeTakeFirst();
  if (settings?.owner_id === userId) return 'installed-owner';
  if (settings) return 'invalid';

  const enrollment = await executor.selectFrom('installation_enrollments as enrollment')
    .innerJoin('user as pending_user', 'pending_user.id', 'enrollment.pending_user_id')
    .select('enrollment.id')
    .where('enrollment.pending_user_id', '=', userId)
    .where('enrollment.purpose', '=', 'install')
    .where('enrollment.consumed_at', 'is', null)
    .where('enrollment.expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
    .whereRef('pending_user.email', '=', 'enrollment.email')
    .executeTakeFirst();
  return enrollment ? 'pending-install' : 'invalid';
}

export async function classifyAuthIdentity(userId: string): Promise<AuthIdentityState> {
  const current = await readAuthIdentity(userId, db);
  if (current !== 'invalid') return current;

  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('tomecms-install'))`.execute(trx);
    const locked = await readAuthIdentity(userId, trx);
    if (locked !== 'invalid') return locked;

    const knownPending = await trx.selectFrom('installation_enrollments')
      .select('id')
      .where('pending_user_id', '=', userId)
      .where('purpose', '=', 'install')
      .executeTakeFirst();
    if (knownPending) await trx.deleteFrom('user').where('id', '=', userId).execute();
    return 'invalid';
  });
}

export async function assertInstalledOwner<Options extends BetterAuthOptions>(input: {
  userId: string;
  fallbackAdapter: DBTransactionAdapter<Options>;
}): Promise<void> {
  const adapter = await getCurrentAdapter(input.fallbackAdapter);
  const settings = await adapter.findOne<AdapterSiteOwner>({
    model: 'siteSettings',
    where: [{ field: 'ownerId', value: input.userId }],
    select: ['ownerId'],
  });
  if (!settings || settings.ownerId !== input.userId) throw new Error('Installed owner authorization failed.');
}

export async function assertInstalledOwnerCredential<Options extends BetterAuthOptions>(input: {
  credentialId: string;
  fallbackAdapter: DBTransactionAdapter<Options>;
}): Promise<void> {
  if (!input.credentialId) throw new Error('Installed owner authorization failed.');
  const adapter = await getCurrentAdapter(input.fallbackAdapter);
  const credential = await adapter.findOne<AdapterPasskeyOwner>({
    model: 'passkey',
    where: [{ field: 'credentialID', value: input.credentialId }],
    select: ['userId'],
  });
  if (!credential) throw new Error('Installed owner authorization failed.');
  await assertInstalledOwner({ userId: credential.userId, fallbackAdapter: input.fallbackAdapter });
}

export async function createEnrollment(input: {
  email: string;
  purpose: EnrollmentPurpose;
  pendingUserId: string;
}, executor: Kysely<Database> | Transaction<Database> = db): Promise<{ context: string; expiresAt: Date }> {
  const parsed = createEnrollmentSchema.parse(input);
  const id = randomUUID();
  const exp = Math.floor(Date.now() / 1_000) + ENROLLMENT_TTL_SECONDS;
  const expiresAt = new Date(exp * 1_000);
  const context = signEnrollmentContext(
    { v: 1, id, purpose: parsed.purpose, exp },
    getServerEnv().TOME_CMS_CONTEXT_SECRET,
  );

  await executor.insertInto('installation_enrollments').values({
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
}): Promise<EnrollmentUser> {
  return (await authorizeEnrollmentContext(input.context)).user;
}

export async function authorizeEnrollmentContext(context?: string | null): Promise<{
  reference: string;
  user: EnrollmentUser;
}> {
  if (!context) invalidEnrollment();
  const claims = readClaims(context);
  let query = db.selectFrom('installation_enrollments as enrollment')
    .innerJoin('user as pending_user', 'pending_user.id', 'enrollment.pending_user_id')
    .select([
      'pending_user.id as id',
      'pending_user.name as name',
      'enrollment.email as email',
    ])
    .where('enrollment.id', '=', claims.id)
    .where('enrollment.context_hash', '=', hashEnrollmentContext(context))
    .where('enrollment.purpose', '=', claims.purpose)
    .where('enrollment.consumed_at', 'is', null)
    .where('enrollment.expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
    .whereRef('pending_user.email', '=', 'enrollment.email');

  if (claims.purpose === 'install') {
    query = query.where(({ exists, not, selectFrom }) => not(exists(selectFrom('site_settings').select('id'))));
  }

  const user = await query.executeTakeFirst();
  if (!user) invalidEnrollment();
  return { reference: claims.id, user };
}

export async function resolveEnrollmentUserByReference(input: {
  reference?: string | null;
}): Promise<EnrollmentUser> {
  const parsedReference = enrollmentReferenceSchema.safeParse(input.reference);
  if (!parsedReference.success) invalidEnrollment();

  const enrollment = await db.selectFrom('installation_enrollments as enrollment')
    .innerJoin('user as pending_user', 'pending_user.id', 'enrollment.pending_user_id')
    .select([
      'pending_user.id as id',
      'pending_user.name as name',
      'enrollment.email as email',
      'enrollment.purpose as purpose',
    ])
    .where('enrollment.id', '=', parsedReference.data)
    .where('enrollment.consumed_at', 'is', null)
    .where('enrollment.expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
    .whereRef('pending_user.email', '=', 'enrollment.email')
    .executeTakeFirst();
  if (!enrollment) invalidEnrollment();
  const purpose = enrollmentPurposeSchema.safeParse(enrollment.purpose);
  if (!purpose.success) invalidEnrollment();
  if (purpose.data === 'install') {
    const installed = await db.selectFrom('site_settings').select('id').executeTakeFirst();
    if (installed) invalidEnrollment();
  }
  return { id: enrollment.id, name: enrollment.name, email: enrollment.email };
}

export async function assertEnrollmentReference<Options extends BetterAuthOptions>(input: {
  reference: string;
  pendingUserId: string;
  fallbackAdapter: DBTransactionAdapter<Options>;
}): Promise<EnrollmentPurpose> {
  const parsedReference = enrollmentReferenceSchema.safeParse(input.reference);
  if (!parsedReference.success || !input.pendingUserId) invalidEnrollment();

  const adapter = await getCurrentAdapter(input.fallbackAdapter);
  const enrollment = await adapter.findOne<AdapterEnrollment>({
    model: 'installationEnrollment',
    where: [
      { field: 'id', value: parsedReference.data },
      { field: 'pendingUserId', value: input.pendingUserId },
      { field: 'consumedAt', value: null },
      { field: 'expiresAt', operator: 'gt', value: new Date() },
    ],
  });
  if (!enrollment) invalidEnrollment();
  const purpose = enrollmentPurposeSchema.safeParse(enrollment.purpose);
  if (!purpose.success) invalidEnrollment();

  const pendingUser = await adapter.findOne<{ id: string; email: string }>({
    model: 'user',
    where: [{ field: 'id', value: input.pendingUserId }],
    select: ['id', 'email'],
  });
  if (!pendingUser || pendingUser.email !== enrollment.email) invalidEnrollment();
  if (purpose.data === 'install' && await adapter.count({ model: 'siteSettings' }) > 0) {
    invalidEnrollment();
  }
  return purpose.data;
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
  if (!enrollment) invalidEnrollment();
  return enrollment.pending_user_id;
}
