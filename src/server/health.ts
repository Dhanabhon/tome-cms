import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { sql } from 'kysely';

import { s3, s3Bucket } from './media/storage';

export interface ReadinessResult {
  status: 'ready' | 'not-ready';
  checks: {
    database: 'ready' | 'unavailable';
    migrations: 'ready' | 'pending' | 'unavailable';
    storage: 'ready' | 'unavailable';
  };
}

let inFlight: { checks: ReadinessResult['checks']; listeners: Set<() => void> } | undefined;

async function probe(checks: ReadinessResult['checks']): Promise<void> {
  await Promise.all([
    (async () => {
      try {
        const { db } = await import('./db/client');
        const { pendingMigrationNames } = await import('./db/migrator');
        await sql`select 1`.execute(db);
        checks.database = 'ready';
        checks.migrations = (await pendingMigrationNames()).length === 0 ? 'ready' : 'pending';
      } catch {
        // Health responses intentionally contain no exception messages or configuration.
      }
    })(),
    (async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: s3Bucket }), { abortSignal: AbortSignal.timeout(1_500) });
        checks.storage = 'ready';
      } catch {
        // Health responses intentionally contain no exception messages or configuration.
      }
    })(),
  ]);
}

export async function checkReadiness(signal?: AbortSignal): Promise<ReadinessResult> {
  const deadline = AbortSignal.timeout(2_000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const unavailable: ReadinessResult['checks'] = {
    database: 'unavailable', migrations: 'unavailable', storage: 'unavailable',
  };
  if (bounded.aborted) return { status: 'not-ready', checks: unavailable };

  if (!inFlight) {
    const current = { checks: unavailable, listeners: new Set<() => void>() };
    inFlight = current;
    // One shared probe settles within the pool's connection and query timeouts.
    void probe(current.checks).finally(() => {
      inFlight = undefined;
      for (const finish of current.listeners) finish();
    });
  }
  const current = inFlight;
  return new Promise(resolve => {
    const finish = () => {
      bounded.removeEventListener('abort', finish);
      current.listeners.delete(finish);
      const checks = { ...current.checks };
      resolve({
        status: checks.database === 'ready' && checks.migrations === 'ready' && checks.storage === 'ready' ? 'ready' : 'not-ready',
        checks,
      });
    };
    current.listeners.add(finish);
    bounded.addEventListener('abort', finish, { once: true });
  });
}
