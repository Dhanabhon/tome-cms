import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { getCurrentAdapter, type BetterAuthOptions, type DBTransactionAdapter } from 'better-auth';
import { sql, type Transaction } from 'kysely';

import { db } from '../db/client';
import type { Database } from '../db/types';
import { getServerEnv } from '../env';
import { createEnrollment } from './enrollment';

const RECOVERY_CODE_COUNT = 10;

interface AdapterEnrollment {
  id: string;
}

interface AdapterSiteOwner {
  ownerId: string;
}

export class RecoveryCodeError extends Error {
  constructor() {
    super('Recovery code is invalid or expired.');
    this.name = 'RecoveryCodeError';
  }
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase();
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new RangeError('Invalid recovery code count.');
  return Array.from({ length: count }, () => randomBytes(16).toString('hex').match(/.{4}/g)!.join('-'));
}

export function hashRecoveryCode(code: string): string {
  return createHmac('sha256', getServerEnv().TOME_CMS_RECOVERY_PEPPER)
    .update(normalizeRecoveryCode(code))
    .digest('hex');
}

export function verifyRecoveryCodeHash(code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashRecoveryCode(code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function invalidateRecoveryEnrollments(ownerId: string, trx: Transaction<Database>): Promise<void> {
  await trx.updateTable('installation_enrollments')
    .set({ consumed_at: sql<Date>`CURRENT_TIMESTAMP` })
    .where('pending_user_id', '=', ownerId)
    .where('purpose', '=', 'recovery')
    .where('consumed_at', 'is', null)
    .execute();
}

async function lockInstalledOwner(ownerId: string, trx: Transaction<Database>) {
  return trx.selectFrom('site_settings as settings')
    .innerJoin('user as owner', 'owner.id', 'settings.owner_id')
    .select(['owner.id as id', 'owner.email as email'])
    .where('settings.id', '=', true)
    .where('settings.owner_id', '=', ownerId)
    .forUpdate('settings')
    .executeTakeFirst();
}

export async function storeRecoveryCodes(
  ownerId: string,
  trx: Transaction<Database>,
): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await trx.insertInto('recovery_codes').values(codes.map((code) => ({
    id: randomUUID(),
    user_id: ownerId,
    code_hash: hashRecoveryCode(code),
  }))).execute();
  return codes;
}

async function issueRecoveryEnrollmentInTransaction(
  ownerId: string,
  email: string,
  trx: Transaction<Database>,
): Promise<{ context: string; expiresAt: Date }> {
  await trx.deleteFrom('session').where('userId', '=', ownerId).execute();
  await invalidateRecoveryEnrollments(ownerId, trx);
  return createEnrollment({ email, pendingUserId: ownerId, purpose: 'recovery' }, trx);
}

export async function consumeRecoveryCode(code: string): Promise<{ context: string; expiresAt: Date }> {
  const boundedCode = code.trim();
  if (!boundedCode || boundedCode.length > 128) throw new RecoveryCodeError();

  return db.transaction().execute(async (trx) => {
    const settings = await trx.selectFrom('site_settings as settings')
      .innerJoin('user as owner', 'owner.id', 'settings.owner_id')
      .select(['settings.owner_id as ownerId', 'owner.email as email'])
      .where('settings.id', '=', true)
      .forUpdate('settings')
      .executeTakeFirst();
    if (!settings) throw new RecoveryCodeError();

    const candidates = await trx.selectFrom('recovery_codes')
      .select(['id', 'code_hash'])
      .where('user_id', '=', settings.ownerId)
      .where('consumed_at', 'is', null)
      .forUpdate()
      .execute();
    const matched = candidates.find((candidate) => verifyRecoveryCodeHash(boundedCode, candidate.code_hash));
    if (!matched) throw new RecoveryCodeError();

    const consumed = await trx.updateTable('recovery_codes')
      .set({ consumed_at: sql<Date>`CURRENT_TIMESTAMP` })
      .where('id', '=', matched.id)
      .where('consumed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!consumed) throw new RecoveryCodeError();

    return issueRecoveryEnrollmentInTransaction(settings.ownerId, settings.email, trx);
  });
}

export async function regenerateRecoveryCodes(ownerId: string): Promise<string[]> {
  return db.transaction().execute(async (trx) => {
    const owner = await lockInstalledOwner(ownerId, trx);
    if (!owner) throw new RecoveryCodeError();
    await trx.updateTable('recovery_codes')
      .set({ consumed_at: sql<Date>`CURRENT_TIMESTAMP` })
      .where('user_id', '=', ownerId)
      .where('consumed_at', 'is', null)
      .execute();
    return storeRecoveryCodes(ownerId, trx);
  });
}

export async function issueRecoveryEnrollment(ownerId: string): Promise<{ context: string; expiresAt: Date }> {
  return db.transaction().execute(async (trx) => {
    const owner = await lockInstalledOwner(ownerId, trx);
    if (!owner) throw new RecoveryCodeError();
    return issueRecoveryEnrollmentInTransaction(owner.id, owner.email, trx);
  });
}

export async function consumeRecoveryEnrollmentReference<Options extends BetterAuthOptions>(input: {
  reference: string;
  ownerId: string;
  fallbackAdapter: DBTransactionAdapter<Options>;
}): Promise<void> {
  const adapter = await getCurrentAdapter(input.fallbackAdapter);
  const settings = await adapter.findOne<AdapterSiteOwner>({
    model: 'siteSettings',
    where: [{ field: 'ownerId', value: input.ownerId }],
    select: ['ownerId'],
  });
  if (!settings || settings.ownerId !== input.ownerId) throw new RecoveryCodeError();

  const consumed = await adapter.update<AdapterEnrollment>({
    model: 'installationEnrollment',
    where: [
      { field: 'id', value: input.reference },
      { field: 'pendingUserId', value: input.ownerId },
      { field: 'purpose', value: 'recovery' },
      { field: 'consumedAt', value: null },
      { field: 'expiresAt', operator: 'gt', value: new Date() },
    ],
    update: { consumedAt: new Date() },
  });
  if (!consumed) throw new RecoveryCodeError();

  await adapter.deleteMany({
    model: 'passkey',
    where: [{ field: 'userId', value: input.ownerId }],
  });
}
