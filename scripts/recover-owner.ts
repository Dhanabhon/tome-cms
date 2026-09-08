import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';

interface RecoveryCliOptions {
  execute: boolean;
  selfTest: boolean;
}

export function parseRecoveryCliOptions(args: string[]): RecoveryCliOptions {
  const unknown = args.filter((argument) => argument !== '--execute' && argument !== '--self-test');
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);
  const options = { execute: args.includes('--execute'), selfTest: args.includes('--self-test') };
  if (options.execute && options.selfTest) throw new Error('--execute and --self-test cannot be combined.');
  return options;
}

export function recoveryConfirmation(origin: string): string {
  return `RECOVER ${new URL(origin).origin}`;
}

function runSelfTest(): void {
  assert.deepEqual(parseRecoveryCliOptions([]), { execute: false, selfTest: false });
  assert.deepEqual(parseRecoveryCliOptions(['--execute']), { execute: true, selfTest: false });
  assert.equal(recoveryConfirmation('https://example.com/path'), 'RECOVER https://example.com');
  assert.throws(() => parseRecoveryCliOptions(['--unknown']), /unknown option/i);
  assert.throws(() => parseRecoveryCliOptions(['--execute', '--self-test']), /cannot be combined/i);
  console.log('Owner recovery CLI self-test passed.');
}

async function main(): Promise<void> {
  const options = parseRecoveryCliOptions(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const [{ db, closeDatabase }, { getServerEnv }] = await Promise.all([
    import('../src/server/db/client'),
    import('../src/server/env'),
  ]);
  try {
    const env = getServerEnv();
    const site = await db.selectFrom('site_settings as settings')
      .innerJoin('user as owner', 'owner.id', 'settings.owner_id')
      .select(['settings.site_name as siteName', 'settings.owner_id as ownerId', 'owner.email as ownerEmail'])
      .where('settings.id', '=', true)
      .executeTakeFirst();
    if (!site) throw new Error('TomeCMS is not installed or the owner record is unavailable.');

    const origin = new URL(env.TOME_CMS_PUBLIC_URL).origin;
    console.log(`Site: ${site.siteName}`);
    console.log(`Public URL: ${origin}`);
    console.log(`Owner: ${site.ownerEmail}`);

    if (!options.execute) {
      console.log('Inspection only. Re-run with --execute to create a one-time recovery link.');
      return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Recovery execution requires an interactive TTY.');
    }

    const expected = recoveryConfirmation(origin);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(`Type "${expected}" to revoke active sessions and continue: `);
    prompt.close();
    if (answer !== expected) throw new Error('Confirmation did not match. No changes were made.');

    const { issueRecoveryEnrollment } = await import('../src/server/auth/recovery');
    const enrollment = await issueRecoveryEnrollment(site.ownerId);
    const recoveryUrl = new URL('/recovery', origin);
    recoveryUrl.searchParams.set('context', enrollment.context);
    console.log(`One-time recovery link (expires ${enrollment.expiresAt.toISOString()}):`);
    console.log(recoveryUrl.href);
  } finally {
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Owner recovery failed.');
  process.exitCode = 1;
});
