import { getCurrentAdapter, type BetterAuthOptions, type DBTransactionAdapter } from 'better-auth';
import { sql, type Kysely } from 'kysely';

import { db } from '../db/client';
import type { Database } from '../db/types';
import { EnrollmentContextError } from './context';
import { createEnrollment } from './enrollment';
import { lockInstalledOwner } from './recovery';

interface AdapterEnrollment {
  id: string;
}

interface AdapterSiteOwner {
  ownerId: string;
}

async function spendDeviceEnrollments(ownerId: string, executor: Kysely<Database>): Promise<void> {
  await executor.updateTable('installation_enrollments')
    .set({ consumed_at: sql<Date>`CURRENT_TIMESTAMP` })
    .where('pending_user_id', '=', ownerId)
    .where('purpose', '=', 'device')
    .where('consumed_at', 'is', null)
    .execute();
}

/**
 * One link at a time: a new one spends any the owner made before, so a link that leaked stops
 * working the moment another exists. Unlike a recovery, nothing the owner already has is touched.
 */
export async function issueDeviceEnrollment(ownerId: string): Promise<{ context: string; expiresAt: Date }> {
  return db.transaction().execute(async (trx) => {
    const owner = await lockInstalledOwner(ownerId, trx);
    if (!owner) throw new EnrollmentContextError();
    await spendDeviceEnrollments(owner.id, trx);
    return createEnrollment({ email: owner.email, pendingUserId: owner.id, purpose: 'device' }, trx);
  });
}

export async function cancelDeviceEnrollments(ownerId: string): Promise<void> {
  await spendDeviceEnrollments(ownerId, db);
}

export async function consumeDeviceEnrollmentReference<Options extends BetterAuthOptions>(input: {
  reference: string;
  ownerId: string;
  fallbackAdapter: DBTransactionAdapter<Options>;
}): Promise<void> {
  const adapter = await getCurrentAdapter(input.fallbackAdapter);
  // Left unchanged on purpose, as recovery does: inside Better Auth's registration transaction
  // it takes the singleton row lock first, the same order as the session-insert guard.
  const settings = await adapter.update<AdapterSiteOwner>({
    model: 'siteSettings',
    where: [{ field: 'ownerId', value: input.ownerId }],
    update: { ownerId: input.ownerId },
  });
  if (!settings || settings.ownerId !== input.ownerId) throw new EnrollmentContextError();

  // Spending the link is all a device registration does: every passkey and session stays.
  const consumed = await adapter.update<AdapterEnrollment>({
    model: 'installationEnrollment',
    where: [
      { field: 'id', value: input.reference },
      { field: 'pendingUserId', value: input.ownerId },
      { field: 'purpose', value: 'device' },
      { field: 'consumedAt', value: null },
      { field: 'expiresAt', operator: 'gt', value: new Date() },
    ],
    update: { consumedAt: new Date() },
  });
  if (!consumed) throw new EnrollmentContextError();
}
