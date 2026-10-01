import { createHmac } from 'node:crypto';

import { sql } from 'kysely';

import { db } from '../db/client';
import { getServerEnv } from '../env';
import { rateLimitKey, type SenderAddress } from '../http/sender-address';

export type RateLimitAction = 'install' | 'signin' | 'recovery' | 'update-check' | 'update-apply' | 'oauth-register' | 'oauth-token';

const limits: Record<RateLimitAction, { attempts: number; windowSeconds: number }> = {
  install: { attempts: 8, windowSeconds: 15 * 60 },
  signin: { attempts: 10, windowSeconds: 15 * 60 },
  recovery: { attempts: 5, windowSeconds: 30 * 60 },
  'update-check': { attempts: 6, windowSeconds: 10 * 60 },
  'update-apply': { attempts: 3, windowSeconds: 30 * 60 },
  'oauth-register': { attempts: 10, windowSeconds: 60 * 60 },
  'oauth-token': { attempts: 60, windowSeconds: 10 * 60 },
};

export class RateLimitExceededError extends Error {
  readonly status = 429 as const;

  constructor(public readonly retryAfter: number) {
    super('Too many attempts. Try again later.');
    this.name = 'RateLimitExceededError';
  }
}

// A window is at most an hour long, so a row from before that has nothing left to count.
// Sweeping them keeps the table to who has been here lately: with a count for every sender it
// would otherwise grow with every address that ever asked.
const KEEP_SECONDS = 2 * Math.max(...Object.values(limits).map(({ windowSeconds }) => windowSeconds));
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

async function sweepEndedWindows(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  try {
    await sql`delete from security_rate_limits where window_started_at < CURRENT_TIMESTAMP - (${KEEP_SECONDS} * interval '1 second')`.execute(db);
  } catch (error) {
    // Counting goes on without it; the next minute tries again.
    console.error('Rate limit sweep failed:', error);
  }
}

export async function enforceRateLimit(
  action: RateLimitAction,
  address: SenderAddress,
): Promise<{ remaining: number; retryAfter: number }> {
  if (!address || address.length > 512) throw new Error('Client address is unavailable.');
  const { attempts: maximum, windowSeconds } = limits[action];
  const keyHash = createHmac('sha256', getServerEnv().TOME_CMS_CONTEXT_SECRET)
    .update(`${action}\0${rateLimitKey(address)}`)
    .digest('hex');

  const result = await sql<{ attempts: number; retry_after: number }>`
    with updated as (
      insert into security_rate_limits (key_hash, action, window_started_at, attempts)
      values (${keyHash}, ${action}, CURRENT_TIMESTAMP, 1)
      on conflict (key_hash) do update set
        attempts = case
          when security_rate_limits.window_started_at <= CURRENT_TIMESTAMP - (${windowSeconds} * interval '1 second') then 1
          else security_rate_limits.attempts + 1
        end,
        window_started_at = case
          when security_rate_limits.window_started_at <= CURRENT_TIMESTAMP - (${windowSeconds} * interval '1 second') then CURRENT_TIMESTAMP
          else security_rate_limits.window_started_at
        end
      returning attempts, window_started_at
    )
    select attempts,
      greatest(1, ceil(extract(epoch from (window_started_at + (${windowSeconds} * interval '1 second') - CURRENT_TIMESTAMP))))::int as retry_after
    from updated
  `.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error('Rate limit state was not returned.');
  await sweepEndedWindows();
  if (row.attempts > maximum) throw new RateLimitExceededError(row.retry_after);
  return { remaining: maximum - row.attempts, retryAfter: row.retry_after };
}
